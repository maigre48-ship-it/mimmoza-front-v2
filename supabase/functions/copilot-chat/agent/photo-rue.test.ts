// deno test --no-lock --no-check -A supabase/functions/copilot-chat/agent/photo-rue.test.ts
// LOT P2 (11/11/2026) — « image dans sa rue », côté serveur : options de fond (mêmes règles que le site et la base),
// fond choisi dans la carte du chat (bloc relu dans le message), façades sur voie dans la fiche (contrat §2),
// couverture Panoramax dans le devis, messages de suivi qui ne figent plus l'état du rendu.
// Données RÉELLES : cadastre de la parcelle 93048000AS0249 (Montreuil) et de ses voisines (API Carto IGN, 10/11/2026),
// photos Panoramax de l'instance IGN autour de la même parcelle (relevées le 11/11/2026, lot P1). Réseau simulé.
import * as na from 'node:assert/strict';
import {
  briefDuMessage, executerOutilStudio, ficheDepuisPreparation, MESSAGE_ETAT_EN_DIRECT, validerOptionsRendu,
  type ConceptionLue, type DepotStudio, type EnvStudio, type PreparationLue, type StatsFile, type TravailLu,
} from './studio.ts';
import { facadesVoieDeLaParcelle } from './voisines-parcelle.ts';
import { messageFond } from '../../../../src/spaces/copilot/studio3d/choixFond.ts';
import { verifierCouverture } from '../../../../src/lib/studio/couverturePhotoRue.ts';
import { validerOptions } from '../../../../src/lib/studio/travauxLogique.ts';

const USER = '11111111-1111-4111-8111-111111111111';
const AUTRE = '22222222-2222-4222-8222-222222222222';
const CONV = 'conv-photo-rue';
const PHOTO = `${USER}/33333333-3333-4333-8333-333333333333.jpg`;
const IDU = '93048000AS0249';

const CADASTRE = JSON.parse(await Deno.readTextFile(new URL('../../../../src/spaces/copilot/studio3d/__fixtures__/cadastre-93048000AS0249.json', import.meta.url)));
const PANORAMAX = JSON.parse(await Deno.readTextFile(new URL('../../../../src/lib/studio/__fixtures__/panoramax-montreuil-AS0249.json', import.meta.url)));
const PREPARATION_AE0414 = JSON.parse(await Deno.readTextFile(new URL('../../../../src/spaces/copilot/studio3d/__fixtures__/preparation-AE0414.json', import.meta.url))).ligne as PreparationLue;

/** Parcelle telle que la conception la conserve (lot C7b) : contour + voisines. */
const parcelleAS0249 = () => ({
  idu: IDU, geometrie: CADASTRE.parcelle.geometry, surface_m2: null, source: 'cadastre (relevé réel)',
  voisines: { statut: 'disponibles', source: 'API Carto IGN', parcelles: CADASTRE.voisines.map((v: { geometry: unknown; properties?: { idu?: string } }) => ({ idu: v.properties?.idu ?? null, geometrie: v.geometry })) },
});

// ── Dépôt en mémoire (même principe que studio.test.ts) ─────────────────────────────────────────────
class Depot implements DepotStudio {
  conceptions: Array<ConceptionLue & { user_id: string }> = [];
  preparations: Array<PreparationLue & { user_id: string }> = [];
  travaux: Array<TravailLu & { user_id: string; fiche: Record<string, unknown>; options: Record<string, unknown> }> = [];
  appels: Array<Record<string, unknown>> = [];
  imageAutorisee: boolean | null = true;
  stats: StatsFile | null = { attente: 0, plusAncienneAttente: null, enCours: 0, derniereActivite: null };
  couvertures = 0;
  async conception(u: string, q: { id?: string | null; idu?: string | null }) {
    return this.conceptions.filter((c) => c.user_id === u && (!q.id || c.id === q.id) && (!q.idu || c.idu === q.idu)).at(-1) ?? null;
  }
  async derniereVersion() { return null; }
  async enregistrerPreparation(u: string, l: Omit<PreparationLue, 'id' | 'cree_le'>) {
    const deja = this.preparations.find((p) => p.user_id === u && p.empreinte === l.empreinte);
    if (deja) return deja.id;
    const id = crypto.randomUUID();
    this.preparations.push({ ...structuredClone(l), id, user_id: u, cree_le: new Date().toISOString() });
    return id;
  }
  async preparation(u: string, q: { id?: string | null; conceptionId?: string | null; conversationId?: string | null }) {
    return this.preparations.filter((p) => p.user_id === u && (!q.id || p.id === q.id) && (!q.conceptionId || p.conception_id === q.conceptionId)).at(-1) ?? null;
  }
  async typeRenduAutorise() { return this.imageAutorisee; }
  async statsFile() { return this.stats; }
  async travauxActifs(u: string) { return this.travaux.filter((t) => t.user_id === u && ['en_attente', 'en_cours'].includes(t.statut)).length; }
  async travailParDevis(u: string, d: string) { return this.travaux.find((t) => t.user_id === u && t.fiche.devis_id === d) ?? null; }
  async questionBriefPosee() { return true; }
  async jetonsDevis() {
    return this.appels.slice().reverse().map((a) => (a.data as { jeton_devis?: unknown } | undefined)?.jeton_devis).filter((j): j is string => typeof j === 'string');
  }
  async insererTravail(u: string, l: { conversation_id: string; type: string; fiche: Record<string, unknown>; options: Record<string, unknown> }) {
    const t = { id: crypto.randomUUID(), user_id: u, conversation_id: l.conversation_id, type: l.type, statut: 'en_attente', progression: 0, etape: null,
      resultat: null, elements_omis: [], erreur: null, cree_le: new Date().toISOString(), demarre_le: null, termine_le: null, fiche: l.fiche, options: l.options };
    this.travaux.push(t);
    return t;
  }
  async travail(u: string, q: { id?: string | null }) { return this.travaux.filter((t) => t.user_id === u && (!q.id || t.id === q.id)).at(-1) ?? null; }
  async positionFile() { return 0; }
  async urlSigneeRendu(c: string) { return `https://exemple.supabase.co/storage/v1/object/sign/studio-rendus/${c}?token=t`; }
  /** Couverture : vrai code (verifierCouverture), réseau simulé avec la réponse RÉELLE de l'instance IGN. */
  async couverturePhotoRue(contour: [number, number][]) {
    this.couvertures++;
    return await verifierCouverture(contour, (async () => new Response(JSON.stringify(PANORAMAX), { status: 200 })) as typeof fetch, () => Date.parse('2026-11-11T12:00:00Z'));
  }
}

const env = (d: DepotStudio, requete: string, extra: Partial<EnvStudio> = {}): EnvStudio =>
  ({ userId: USER, depot: d, secret: 'secret-de-test', requete, conversationId: CONV, origine: 'https://mimmoza.vercel.app', ...extra });

async function depotPrepare(): Promise<Depot> {
  const d = new Depot();
  d.conceptions.push({
    id: '44444444-4444-4444-8444-444444444444', idu: IDU, commune: 'Montreuil', user_id: USER, parcelle: parcelleAS0249(), regles_plu: [],
    programme: { nb_logements: 6, gabarit: 'R+3' },
  });
  const r = await executerOutilStudio('studio_preparer_3d', {}, env(d, 'P0'));
  na.equal(r?.status, 'ok', r?.message);
  return d;
}

// ═══ Options ════════════════════════════════════════════════════════════════════════════════════════

Deno.test('P2-1 : options de fond — étude par défaut (options d’avant inchangées), photo de la rue, photo du client dans SON dossier', () => {
  na.deepEqual(validerOptionsRendu('image', {}), { ok: true, valeur: { vues: ['trois_quarts_gauche'], ambiance: 'jour' } });
  na.deepEqual(validerOptionsRendu('image', { fond: 'etude' }), { ok: true, valeur: { vues: ['trois_quarts_gauche'], ambiance: 'jour' } }, 'étude : rien de recopié');
  na.deepEqual(validerOptionsRendu('image', { fond: 'photo_rue', photo_rue: { id: 'D36C2217-F0A8-4C56-88BB-5092CBE40B93' } }),
    { ok: true, valeur: { vues: ['trois_quarts_gauche'], ambiance: 'jour', fond: 'photo_rue', photo_rue: { id: 'd36c2217-f0a8-4c56-88bb-5092cbe40b93' } } });
  const pc = { fond: 'photo_client', photo_client: { chemin: PHOTO, octets: 3456789, point_de_vue: { lon: 2.4286, lat: 48.8567, cap_deg: 185 } } };
  na.equal(validerOptionsRendu('image', pc, USER).ok, true);
  na.match(String((validerOptionsRendu('image', pc, AUTRE) as { erreur: string }).erreur), /n’appartient pas à ce compte/);
  for (const [o, motif] of [
    [{ fond: 'photo_client' }, /téléversez-la/],
    [{ fond: 'etude', photo_client: pc.photo_client }, /qu’avec le fond « votre photo/],
    [{ fond: 'etude', photo_rue: { id: 'd36c2217-f0a8-4c56-88bb-5092cbe40b93' } }, /qu’avec le fond « photo de la rue »/],
    [{ fond: 'photo_rue', photo_rue: { id: 'pas-un-uuid' } }, /identifiant invalide/],
    [{ fond: 'photo_client', photo_client: { ...pc.photo_client, chemin: `${USER}/x.gif` } }, /emplacement invalide/],
    [{ fond: 'photo_client', photo_client: { ...pc.photo_client, octets: 25_000_000 } }, /20 Mo/],
    [{ fond: 'photo_client', photo_client: { ...pc.photo_client, point_de_vue: { lon: 2, lat: 48, cap_deg: 360 } } }, /direction invalide/],
    [{ fond: 'google' }, /Choisissez un fond/],
    [{ calage_client: {} }, /qu’à une image sur photo/],
  ] as const) {
    const v = validerOptionsRendu('image', o, USER);
    na.equal(v.ok, false, JSON.stringify(o));
    na.match((v as { erreur: string }).erreur, motif);
  }
  na.match(String((validerOptionsRendu('film', { fond: 'photo_rue' }) as { erreur: string }).erreur), /Option inconnue : fond/, 'film inchangé');
});

Deno.test('P2-2 : site et serveur appliquent les MÊMES règles aux options de fond', () => {
  const calage = { version: 1, largeur_image: 4032, hauteur_image: 3024, valide_le: '2026-11-11T12:00:00Z',
    correspondances: [{ image: [100, 2000], monde: [2.4286, 48.8566, 0] }, { image: [3900, 2100], monde: [2.4289, 48.8566, 0] }] };
  const cas: unknown[] = [
    {}, { fond: 'photo_rue' }, { fond: 'photo_client' }, { fond: 'photo_client', photo_client: { chemin: PHOTO, octets: 10 } },
    { fond: 'photo_rue', calage_client: calage }, { fond: 'etude', calage_client: calage },
    { fond: 'photo_rue', calage_client: { ...calage, correspondances: calage.correspondances.slice(0, 1) } },
    { fond: 'photo_rue', calage_client: { ...calage, correspondances: [{ image: [5000, 10], monde: [2.4, 48.8, 0] }, calage.correspondances[0]] } },
    { fond: 'photo_rue', calage_client: { ...calage, valide_le: 'hier' } }, { fond: 'photo_rue', autre: 1 },
  ];
  for (const o of cas) {
    const s = validerOptionsRendu('image', o);
    const f = validerOptions('image', o);
    na.equal(s.ok, f.ok, JSON.stringify(o));
    if (s.ok && f.ok) {
      const { qualite: _q, ...sansQualite } = f.valeur as unknown as Record<string, unknown>;
      na.deepEqual(s.valeur, sansQualite, JSON.stringify(o));
    }
  }
});

// ═══ Bloc du message (carte « Fond de l'image ») ══════════════════════════════════════════════════════

Deno.test('P2-3 : le message de la carte (choixFond.ts, code du site) est relu par le serveur : fond et brief du devis', () => {
  const demande = { actuel: { facade: 'brique', ouvertures: 'fenetres_verticales', balcons: 'loggias', attique: false, rdc: 'logements', ambiance: 'jour',
    toiture: 'terrasse', teinte: 'naturelle', garde_corps: 'metal', menuiseries: 'gris', soubassement: 'aucun', defauts: ['toiture'] } } as Parameters<typeof messageFond>[0];
  const m = messageFond(demande, { fond: 'photo_client', photo_client: { chemin: PHOTO, octets: 3456789 } }) ?? '';
  const lu = briefDuMessage(m);
  na.equal(lu?.ok, true, JSON.stringify(lu));
  const v = (lu as { valeur: { type: string; fond?: unknown; brief: { facade: string; balcons: string } } }).valeur;
  na.equal(v.type, 'image');
  na.deepEqual(v.fond, { fond: 'photo_client', photo_client: { chemin: PHOTO, octets: 3456789 } });
  na.deepEqual([v.brief.facade, v.brief.balcons], ['brique', 'loggias']);
  // Fond pour un film, fond illisible : refusés (jamais devinés).
  na.equal(briefDuMessage(m.replace('"type":"image"', '"type":"film"'))?.ok, false);
  na.equal(briefDuMessage('x\n\n```mimmoza-brief\n{"v":1,"type":"image","brief":{"a_toi_de_choisir":true},"fond":{"fond":"photo_rue","pirate":1}}\n```')?.ok, false);
});

// ═══ Façades sur voie (contrat §2) ═══════════════════════════════════════════════════════════════════

Deno.test('P2-4 : façades sur voie de AS0249 (cadastre réel) : deux segments au sud, 28,65 m, en WGS 84 ; rien d’inventé sans voisines', () => {
  const r = facadesVoieDeLaParcelle(parcelleAS0249());
  na.equal(r.raison, null);
  na.equal(r.facades.length, 2);
  const total = r.facades.reduce((s, f) => s + f.longueurM, 0);
  na.ok(Math.abs(total - 28.65) < 0.05, String(total));
  const lats = (CADASTRE.parcelle.geometry.coordinates as number[][][][]).flat(2).map((c) => c[1]);
  const latMilieu = (Math.min(...lats) + Math.max(...lats)) / 2;
  for (const f of r.facades) {
    na.equal(f.source, 'cadastre-voisines');
    na.ok(f.debut[1] < latMilieu && f.fin[1] < latMilieu, 'façade au sud (rue de Paris)');
    na.ok(Math.abs(f.debut[0] - 2.428) < 0.002 && Math.abs(f.debut[1] - 48.857) < 0.002, JSON.stringify(f));
  }
  const sansVoisines = facadesVoieDeLaParcelle({ geometrie: CADASTRE.parcelle.geometry });
  na.deepEqual(sansVoisines.facades, []);
  na.match(sansVoisines.raison ?? '', /Parcelles voisines absentes/);
  const indispo = facadesVoieDeLaParcelle({ geometrie: CADASTRE.parcelle.geometry, voisines: { statut: 'indisponibles', parcelles: [], source: 'x', raison: 'Le cadastre n’a pas répondu.' } });
  na.deepEqual([indispo.facades, indispo.raison], [[], 'Le cadastre n’a pas répondu.']);
});

Deno.test('P2-5 : fiche du travail — charge.site.facadesVoie présent si identifié, absent sinon', () => {
  const facades = facadesVoieDeLaParcelle(parcelleAS0249()).facades;
  const avec = ficheDepuisPreparation(PREPARATION_AE0414, CONV, '2026-11-11T12:00:00.000Z', crypto.randomUUID(), 'https://mimmoza.vercel.app', null, facades);
  const sans = ficheDepuisPreparation(PREPARATION_AE0414, CONV, '2026-11-11T12:00:00.000Z', crypto.randomUUID(), 'https://mimmoza.vercel.app', null, []);
  na.equal(avec.ok && sans.ok, true);
  const site = (f: typeof avec) => ((f as unknown as { valeur: { charge: { site: Record<string, unknown> } } }).valeur.charge.site);
  na.deepEqual(site(avec).facadesVoie, facades);
  na.equal('facadesVoie' in site(sans), false);
  // Le reste de la fiche ne change pas.
  const { facadesVoie: _f, ...resteSite } = site(avec);
  na.deepEqual(resteSite, site(sans));
});

// ═══ Devis et lancement de bout en bout (dépôt en mémoire) ═════════════════════════════════════════════

Deno.test('P2-6 : devis d’une image — couverture Panoramax (Licence Ouverte) et façade dites ; fond de la carte ; lancement avec facadesVoie', async () => {
  const d = await depotPrepare();
  // Devis « étude » : la couverture est vérifiée et dite, le modèle est invité à proposer la photo de la rue.
  const r1 = await executerOutilStudio('studio_lancer_rendu', { type: 'image', brief: { a_toi_de_choisir: true } }, env(d, 'R1'));
  na.equal(r1?.status, 'confirmation_requise', r1?.message);
  const fi = r1!.data!.fond_image as { choisi: string; couverture: { couverte: boolean; photos: { distanceM: number; date: string }[] }; facade_sur_voie: string; contour: unknown[] };
  na.equal(fi.choisi, 'etude');
  na.equal(fi.couverture.couverte, true);
  na.ok(fi.couverture.photos.length >= 1 && fi.couverture.photos.every((p, i, t) => p.distanceM <= 60 && (i === 0 || t[i - 1].distanceM <= p.distanceM)));
  na.match(fi.facade_sur_voie, /^identifiée : 28,6[45] m/);
  na.ok(fi.contour.length >= 3 && fi.contour.length <= 48);
  na.equal((r1!.data!.devis as { fond: string }).fond, 'Étude seule');
  na.match(r1!.message!, /FOND DE L’IMAGE/);
  d.appels.push(structuredClone(r1!) as unknown as Record<string, unknown>);
  // L'utilisateur choisit sa photo dans la carte : le serveur lit le fond dans le message (le modèle ne recopie rien).
  const demande = { actuel: { facade: 'enduit_clair', ouvertures: 'fenetres_verticales', balcons: 'balcons', attique: false, rdc: 'logements', ambiance: 'jour',
    toiture: 'terrasse', teinte: 'naturelle', garde_corps: 'metal', menuiseries: 'gris', soubassement: 'aucun', defauts: [] } } as Parameters<typeof messageFond>[0];
  const pc = { chemin: PHOTO, octets: 3456789, point_de_vue: { lon: 2.42862, lat: 48.85662, cap_deg: 10 } };
  const carte = briefDuMessage(messageFond(demande, { fond: 'photo_client', photo_client: pc }));
  // Photo d'un AUTRE compte : refusée, rien de chiffré.
  const refus = await executerOutilStudio('studio_lancer_rendu', { type: 'image' }, env(d, 'R2', { userId: AUTRE, briefCarte: carte }));
  na.equal(refus?.status, 'error');
  na.match(refus!.message!, /n’appartient pas à ce compte/);
  const r2 = await executerOutilStudio('studio_lancer_rendu', { type: 'image', options: { fond: 'etude' } }, env(d, 'R2', { briefCarte: carte }));
  na.equal(r2?.status, 'confirmation_requise', r2?.message);
  na.deepEqual((r2!.data!.options as Record<string, unknown>).photo_client, pc, 'le fond de la carte l’emporte sur celui du modèle');
  na.match(String((r2!.data!.devis as { rendu: string }).rendu), /^Image du projet — .* · fond : votre photo du trottoir$/);
  na.ok((r2!.data!.devis as { avertissements: string[] }).avertissements.some((a) => /visages et plaques ne sont pas floutés/.test(a)));
  d.appels.push(structuredClone(r2!) as unknown as Record<string, unknown>);
  // Accord au tour suivant : le travail porte le fond et les façades sur voie ; le message ne fige plus l'état.
  const r3 = await executerOutilStudio('studio_lancer_rendu', { confirmer: true }, env(d, 'R3'));
  na.equal(r3?.status, 'ok', r3?.message);
  const t = d.travaux.at(-1)!;
  na.deepEqual(t.options.photo_client, pc);
  const fv = ((t.fiche.charge as { site: { facadesVoie?: { longueurM: number }[] } }).site.facadesVoie) ?? [];
  na.equal(fv.length, 2);
  na.ok(r3!.message!.includes(MESSAGE_ETAT_EN_DIRECT) && !/Dis exactement cela, avec la phrase sur la machine/.test(r3!.message!));
});

Deno.test('P2-7 : base pas encore migrée — un fond photo est refusé avec la bonne raison ; l’étude reste possible', async () => {
  const d = await depotPrepare();
  d.imageAutorisee = false;
  const r = await executerOutilStudio('studio_lancer_rendu', { type: 'image', options: { fond: 'photo_rue' }, brief: { a_toi_de_choisir: true } }, env(d, 'R1'));
  na.equal(r?.status, 'not_configured');
  na.match(r!.message!, /20261111120000_studio_image_photo_rue/);
  const e = await executerOutilStudio('studio_lancer_rendu', { type: 'image', brief: { a_toi_de_choisir: true } }, env(d, 'R1'));
  na.match(e!.message!, /migration du lot E0/, 'image d’étude : message d’origine inchangé');
});

Deno.test('P2-8 : sans voisines dans la conception, le devis d’une photo de rue le dit (image d’étude annoncée)', async () => {
  const d = await depotPrepare();
  (d.conceptions[0].parcelle as Record<string, unknown>).voisines = undefined;
  const r = await executerOutilStudio('studio_lancer_rendu', { type: 'image', options: { fond: 'photo_rue' }, brief: { a_toi_de_choisir: true } }, env(d, 'R1'));
  na.equal(r?.status, 'confirmation_requise', r?.message);
  na.match((r!.data!.fond_image as { facade_sur_voie: string }).facade_sur_voie, /^non identifiée — Parcelles voisines absentes/);
  na.ok((r!.data!.devis as { avertissements: string[] }).avertissements.some((a) => /Façade sur voie non identifiée .* l’image d’étude sera livrée/.test(a)));
});
