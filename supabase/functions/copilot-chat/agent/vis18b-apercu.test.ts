// deno test --no-lock --no-check -A supabase/functions/copilot-chat/agent/vis18b-apercu.test.ts
// VIS-18b (20/11/2026) — côté serveur :
//   · aperçu du film et de la visite : `qualite: "apercu"` validée (mêmes règles que le site, le worker et la migration
//     20261120080000), durée annoncée réaliste, résumé ; « finale » / absente : options IDENTIQUES à avant ;
//   · fond de l'image choisi dans l'étape 6 du parcours (instantané de l'écran → env.fondParcours) repris par le devis
//     d'une image : priorité carte > fond photo écrit dans la demande > parcours ; photo d'un autre compte → étude, dit ;
//   · gamme / cible du parcours sans étude : lues dans l'instantané (bloc PARCOURS : étape 5 faite).
// Dépôt en mémoire et données réelles : mêmes que photo-rue.test.ts (parcelle 93048000AS0249, Panoramax IGN).
import * as na from 'node:assert/strict';
import {
  briefDuMessage, dureeAnnoncee, executerOutilStudio, resumeOptions, validerOptionsRendu,
  type ConceptionLue, type DepotStudio, type EnvStudio, type PreparationLue, type StatsFile, type TravailLu,
} from './studio.ts';
import { messageFond } from '../../../../src/spaces/copilot/studio3d/choixFond.ts';
import { verifierCouverture } from '../../../../src/lib/studio/couverturePhotoRue.ts';
import { validerOptions } from '../../../../src/lib/studio/travauxLogique.ts';
import { fondDuParcours } from '../../../../src/lib/studio/parcours.ts';
import { blocParcoursServeur, FORMAT_TEMOIN_LU, temoinDeLaBase } from './parcours-chat.ts';
import { creerTemoin, FORMAT_TEMOIN, VERSION_TEMOIN } from '../../../../src/spaces/promoteur/shared/echangeStudio/pontParcoursStudio.ts';

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

// ═══ Aperçu du film et de la visite ══════════════════════════════════════════════════════════════════

Deno.test('VIS18b-1 : film / visite — qualite « apercu » gardée, « finale » ou absente : sortie IDENTIQUE à avant, autre valeur refusée', () => {
  na.deepEqual(validerOptionsRendu('film', { qualite: 'finale' }), validerOptionsRendu('film', {}));
  na.deepEqual(validerOptionsRendu('film', {}), { ok: true, valeur: { duree_s: 60, ambiance: 'jour', format: '16:9', interieurs: true, musique: true } });
  na.deepEqual(validerOptionsRendu('film', { duree_s: 30, qualite: 'apercu' }), { ok: true, valeur: { duree_s: 30, ambiance: 'jour', format: '16:9', interieurs: true, musique: true, qualite: 'apercu' } });
  na.deepEqual(validerOptionsRendu('visite360', { qualite: 'apercu', resolution: '8k' }), { ok: true, valeur: { ambiance: 'jour', interieurs: true, resolution: '8k', qualite: 'apercu' } });
  na.deepEqual(validerOptionsRendu('visite360', { qualite: 'finale' }), validerOptionsRendu('visite360', {}));
  for (const q of ['brouillon', 1, true, '8k']) {
    na.equal(validerOptionsRendu('film', { qualite: q }).ok, false, `film ${String(q)}`);
    na.equal(validerOptionsRendu('visite360', { qualite: q }).ok, false, `visite ${String(q)}`);
  }
  // Mêmes réponses que le site (travauxLogique.validerOptions) — film et visite, avec et sans aperçu.
  for (const [t, o] of [['film', { qualite: 'apercu' }], ['film', { qualite: 'x' }], ['film', {}], ['visite360', { qualite: 'apercu' }], ['visite360', { qualite: 2 }]] as const) {
    const s = validerOptionsRendu(t, o); const f = validerOptions(t, o);
    na.equal(s.ok, f.ok, `${t} ${JSON.stringify(o)}`);
    if (s.ok && f.ok) na.equal((s.valeur as { qualite?: string }).qualite, (f.valeur as { qualite?: string }).qualite);
  }
});

Deno.test('VIS18b-2 : durée annoncée réaliste et résumé de l’aperçu ; finale inchangée', () => {
  na.match(dureeAnnoncee('film', { qualite: 'apercu' }), /^environ 30 min à 1 h 30 .*film court de contrôle en basse définition/);
  na.match(dureeAnnoncee('visite360', { qualite: 'apercu' }), /^environ 30 min à 2 h .*3K/);
  na.match(dureeAnnoncee('film', {}), /^plusieurs heures possibles/);
  na.match(dureeAnnoncee('visite360', { resolution: '6k' }), /^plusieurs heures possibles/);
  na.equal(resumeOptions('film', { duree_s: 30, ambiance: 'jour', format: '16:9', interieurs: false, musique: true }), '30 s · en journée · paysage · musique');
  na.match(resumeOptions('film', { duree_s: 30, ambiance: 'jour', format: '16:9', interieurs: false, musique: true, qualite: 'apercu' }), /· aperçu \(film court basse définition, sans musique\)$/);
  na.equal(resumeOptions('visite360', { ambiance: 'jour', resolution: '6k', interieurs: true, qualite: 'apercu' }), 'en journée · aperçu 3K · intérieurs');
  na.equal(resumeOptions('visite360', { ambiance: 'jour', resolution: '6k', interieurs: true }), 'en journée · 6K · intérieurs');
});

Deno.test('VIS18b-3 : devis d’un APERÇU de film depuis le chat — options, durée et lancement portent qualite « apercu »', async () => {
  const d = await depotPrepare();
  const r = await executerOutilStudio('studio_lancer_rendu', { type: 'film', options: { duree_s: 30, qualite: 'apercu' }, brief: { a_toi_de_choisir: true } }, env(d, 'F1'));
  na.equal(r?.status, 'confirmation_requise', r?.message);
  na.equal((r!.data!.options as Record<string, unknown>).qualite, 'apercu');
  na.match(JSON.stringify(r!.data), /30 min à 1 h 30/);
  d.appels.push(structuredClone(r!) as unknown as Record<string, unknown>);
  const ok = await executerOutilStudio('studio_lancer_rendu', { confirmer: true }, env(d, 'F2'));
  na.equal(ok?.status, 'ok', ok?.message);
  na.equal(d.travaux.at(-1)!.options.qualite, 'apercu');
  na.equal(d.travaux.at(-1)!.type, 'film');
});

// ═══ Fond du parcours repris par le devis d'image ═══════════════════════════════════════════════════

const PC = { chemin: PHOTO, octets: 3456789, point_de_vue: { lon: 2.42862, lat: 48.85662, cap_deg: 10 } };

Deno.test('VIS18b-4 : fond choisi dans le parcours (instantané) → repris par le devis d’une image', async () => {
  const d = await depotPrepare();
  const fond = fondDuParcours({ rendu: { vues: [], fond: { fond: 'photo_client', photo_client: PC } } });
  na.deepEqual(fond, { fond: 'photo_client', photo_client: PC });
  const r = await executerOutilStudio('studio_lancer_rendu', { type: 'image', brief: { a_toi_de_choisir: true } }, env(d, 'R1', { fondParcours: fond }));
  na.equal(r?.status, 'confirmation_requise', r?.message);
  na.deepEqual((r!.data!.options as Record<string, unknown>).photo_client, PC);
  na.equal((r!.data!.fond_image as { choisi: string }).choisi, 'photo_client');
  // Un fond « étude » recopié par le modèle ne masque pas le choix du parcours.
  const r2 = await executerOutilStudio('studio_lancer_rendu', { type: 'image', options: { fond: 'etude' }, brief: { a_toi_de_choisir: true } }, env(d, 'R2', { fondParcours: fond }));
  na.equal((r2!.data!.options as Record<string, unknown>).fond, 'photo_client');
  // Sans fond du parcours : comportement d'avant (étude).
  const r3 = await executerOutilStudio('studio_lancer_rendu', { type: 'image', brief: { a_toi_de_choisir: true } }, env(d, 'R3'));
  na.equal((r3!.data!.options as Record<string, unknown>).fond, undefined);
});

Deno.test('VIS18b-5 : priorités — carte du devis > fond photo écrit dans la demande > parcours ; photo d’un autre compte → étude, dit', async () => {
  const d = await depotPrepare();
  const parcours = { fond: 'photo_client' as const, photo_client: PC };
  const demande = { actuel: { facade: 'enduit_clair', ouvertures: 'fenetres_verticales', balcons: 'balcons', attique: false, rdc: 'logements', ambiance: 'jour',
    toiture: 'terrasse', teinte: 'naturelle', garde_corps: 'metal', menuiseries: 'gris', soubassement: 'aucun', defauts: [] } } as Parameters<typeof messageFond>[0];
  const carte = briefDuMessage(messageFond(demande, { fond: 'etude' }));
  const rc = await executerOutilStudio('studio_lancer_rendu', { type: 'image' }, env(d, 'C1', { briefCarte: carte, fondParcours: parcours }));
  na.equal(rc?.status, 'confirmation_requise', rc?.message);
  na.equal((rc!.data!.options as Record<string, unknown>).photo_client, undefined, 'la carte l’emporte');
  const rm = await executerOutilStudio('studio_lancer_rendu', { type: 'image', options: { fond: 'photo_rue' }, brief: { a_toi_de_choisir: true } }, env(d, 'C2', { fondParcours: parcours }));
  na.equal((rm!.data!.options as Record<string, unknown>).fond, 'photo_rue', 'fond photo demandé explicitement');
  // Photo rangée dans le dossier d'un AUTRE compte (stockage du navigateur modifié) : jamais utilisée, devis d'étude, dit.
  const etrangere = { fond: 'photo_client' as const, photo_client: { ...PC, chemin: PHOTO.replace(USER, AUTRE) } };
  const autre = await executerOutilStudio('studio_lancer_rendu', { type: 'image', brief: { a_toi_de_choisir: true } }, env(d, 'C3', { fondParcours: etrangere }));
  na.equal(autre?.status, 'confirmation_requise', autre?.message);
  na.equal((autre!.data!.options as Record<string, unknown>)?.photo_client, undefined);
  na.match(JSON.stringify(autre!.data), /Fond choisi dans le parcours \(votre photo du trottoir\) non retenu/);
  // Film : le fond du parcours ne s'applique jamais.
  const f = await executerOutilStudio('studio_lancer_rendu', { type: 'film', brief: { a_toi_de_choisir: true } }, env(d, 'C4', { fondParcours: parcours }));
  na.equal(f?.status, 'confirmation_requise', f?.message);
});

Deno.test('VIS18b-6 : gamme / cible du parcours sans étude — lues dans l’instantané, étape 5 FAITE dans le bloc PARCOURS', () => {
  const { bloc } = blocParcoursServeur({
    instantane: { type: 'image', habillage: null, interieurs: { gamme: 'standard', typologie: null, cible: 'Familles', origine: 'conversation' },
      rendu: { vues: [], vuesChoisies: false, ambiance: null, saison: null, etudeRattachee: false }, film: null, visite: null },
    mission: null, preparation: { idu: '64065000AI0001', resume: { batiments: 1, gabarit: 'R+1' } }, travaux: [], textesUtilisateur: [], messageCourant: 'je veux des images',
  });
  na.match(bloc, /5\. Intérieurs — FAIT — Logement témoin gamme confort/);
  na.match(bloc, /4\. Style & façades — À FAIRE — .* · pour : familles/);
  na.match(bloc, /film court basse définition|« film »/);
});

Deno.test('VIS18b-7 : témoin personnalisé dans le Studio (ligne studio_temoins, VIS-18a) → Mimmo le cite à l’étape 5', () => {
  const t = creerTemoin({
    personnalise: true,
    logement: { cle: 'b1|N2|w0#L4', buildingId: 'b1', floorKey: 'N2', wingId: 'w0', logementId: 'L4', lot: 'A204', niveau: 'R+2', rangNiveau: 2, typologie: 'T3', surfaceM2: 64 },
    style: 'scandinave', gamme: 'standard', cible: 'famille', seed: 3, meubles: 18,
    finitions: [{ fonction: 'sejour', sol: 'av-parquet', murs: 'av-mur-peint-lin' }],
    modifications: { ajouts: 1, suppressions: 0, ajustements: 2, finitions: 1, planModifie: false },
  }, new Date('2026-11-20T10:00:00Z'));
  na.equal(FORMAT_TEMOIN_LU, FORMAT_TEMOIN); na.equal(VERSION_TEMOIN, 1); // même format que le pont VIS-18a
  na.equal(temoinDeLaBase({ temoin: { ...JSON.parse(JSON.stringify(t)), personnalise: false } }), null);
  const lu = temoinDeLaBase({ temoin: JSON.parse(JSON.stringify(t)) });
  na.equal(lu?.fait, true);
  na.equal(lu?.resume, t.resume);
  na.equal(temoinDeLaBase(null), null);
  na.equal(temoinDeLaBase({ temoin: { format: 'autre' } }), null);
  const { bloc } = blocParcoursServeur({
    instantane: null, mission: null, preparation: { idu: '64065000AI0001', resume: { batiments: 1, gabarit: 'R+1' } }, travaux: [],
    textesUtilisateur: [], messageCourant: 'je veux des images', temoin: { temoin: t },
  });
  na.match(bloc, new RegExp(`5\\. Intérieurs — FAIT — Logement témoin personnalisé dans le Studio : ${t.resume.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
});
