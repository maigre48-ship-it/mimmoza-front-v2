// supabase/functions/copilot-chat/agent/extension-x10.test.ts
// LOT X10 (17/11/2026) — essais d'Albé du 17/11 :
//   A. 930470000P0646 : parcours terminé, puis « 3D préparée » présentée comme un immeuble (« Plot », 7 logements) et
//      un brief « logements » envoyé au rendu ;
//   B. 64065000AI0002 : aucune fiche de parcelle → « Côté rue inconnu… Classez la limite sur rue » (impasse), puis
//      « Parfait ! Je lance la préparation de la maquette 3D » alors que le placement était refusé ;
//   D. conclusion incohérente : « Secteur protégé : oui » puis « Secteur protégé non établi » ; « 200 m² après travaux »
//      pour 32 m² créés.
// Données RÉELLES : parcours, contour et voisines de P0646 (fixture X3) ; 3D préparée et cadastre AS0249 (fixtures P2).
// Pour B, la parcelle 64065000AI0002 n'a pas de fixture : on rejoue la MÊME situation (aucune fiche de parcelle) sur le
// contour réel de P0646 — SUPPOSÉ représentatif (même code, mêmes branches).
import * as na from 'node:assert/strict';
import { executerOutilStudio, MESSAGE_EXTENSION_NON_PLACEE, MESSAGE_EXTENSION_SANS_DOSSIER, type ConceptionLue, type DepotStudio, type EnvStudio, type PreparationLue, type StatsFile, type TravailLu } from './studio.ts';
import {
  executerOutilExtension, facadesLuesDesSorties, facadesParVoisines, lireFacadesLues, phraseDeRelance, projetDesSorties, reglesDeLaConception, resultatParcours,
  type DepotExtension,
} from './extension.ts';
import { facadesVoieDeLaParcelle } from './voisines-parcelle.ts';
import { avancerParcours, ETAT_INITIAL, Q, type ContexteParcours, type EtatParcours, type SortieParcours } from '../../_shared/extension/parcours.ts';
import { candidatChoisi, candidatsCoteRue } from '../../_shared/extension/coteRue.ts';
import { regimeIndicatif } from '../../_shared/extension/reglementation.ts';
import { type BatimentBdTopo } from '../../_shared/extension/bdtopoParcelle.ts';
import { verifierCouverture } from '../../../../src/lib/studio/couverturePhotoRue.ts';

const FX = JSON.parse(Deno.readTextFileSync(new URL('../../../../src/spaces/copilot/studio3d/__fixtures__/extension-x3-reel.json', import.meta.url)));
const CADASTRE = JSON.parse(Deno.readTextFileSync(new URL('../../../../src/spaces/copilot/studio3d/__fixtures__/cadastre-93048000AS0249.json', import.meta.url)));
const PANORAMAX = JSON.parse(Deno.readTextFileSync(new URL('../../../../src/lib/studio/__fixtures__/panoramax-montreuil-AS0249.json', import.meta.url)));
type SiteFx = { idu: string; contourWgs84: [number, number][]; batiments: BatimentBdTopo[] };
const P0646 = '930470000P0646';
const SITE: SiteFx = FX.bdtopo.sites.find((s: SiteFx) => s.idu === P0646);
const C = FX.conceptionP0646;
const JARGON = /\b(?:serveur|la fiche|moteur|extension_maison|lot [A-Z]\d)\b/i;

// ── Parcours (pur) ──────────────────────────────────────────────────────────────────────────────────────────
function contexte(avecFacades: boolean): ContexteParcours {
  const fac = facadesVoieDeLaParcelle(C.parcelle);
  return {
    idu: P0646, commune: 'Montfermeil', contourWgs84: SITE.contourWgs84, surfaceParcelleM2: C.parcelle.surface_m2 ?? null,
    batiments: SITE.batiments, raisonBdTopo: null, dateBdTopo: '2026-11-12', bdnb: null, noteBdnb: null,
    zoneU: { valeur: true, source: 'zone UC du PLU (test)' }, regles: reglesDeLaConception(C.regles_plu),
    facadesVoie: avecFacades ? fac.facades.map((f) => ({ debut: f.debut, fin: f.fin })) : [],
    raisonFacades: avecFacades ? fac.raison : 'aucune fiche de parcelle avec ses voisines',
  };
}
function jouer(messages: string[], ctx: ContexteParcours): SortieParcours[] {
  const out: SortieParcours[] = [];
  let etat: EtatParcours = ETAT_INITIAL;
  let attendues: readonly string[] = [];
  for (const m of messages) { const s = avancerParcours(etat, m, attendues, ctx); out.push(s); etat = s.etat; attendues = s.attendues; }
  return out;
}
const PARCOURS = [
  'Je voudrais agrandir ma maison', 'Maison existante : Conserver la maison',
  'Toit de la maison : 2 pans · Niveaux de la maison : R+1 · Type d’extension : Arrière · Façade (vue de la rue) : À l’arrière',
  'Dimensions (largeur × profondeur) : 5 × 4 m · Hauteur de l’extension : Plain-pied', 'Surface de plancher existante : 118 m² · Demandeur : Particulier',
];

/** Côté proposé qui porte la vraie limite sur rue (celle déduite des voisines réelles) : milieu de segment à moins de 1 m. */
function coteReel(): string {
  const reelles = facadesVoieDeLaParcelle(C.parcelle).facades;
  const milieu = (a: readonly number[], b: readonly number[]) => [(a[0]! + b[0]!) / 2, (a[1]! + b[1]!) / 2];
  const pres = (p: number[], q: number[]) => Math.hypot((p[0]! - q[0]!) * 111_320 * Math.cos(q[1]! * Math.PI / 180), (p[1]! - q[1]!) * 110_540) < 1;
  const c = candidatsCoteRue(SITE.contourWgs84).find((x) => x.segments.some((s) => reelles.some((r) => pres(milieu(s.debut, s.fin), milieu(r.debut, r.fin)))));
  na.ok(c, 'la vraie limite sur rue fait partie des côtés proposés');
  return c!.libelle;
}

Deno.test('X10-1 : côtés de la parcelle — libellés simples et stables, du plus long au plus court, ≥ 3 m', () => {
  const c = candidatsCoteRue(SITE.contourWgs84);
  na.ok(c.length >= 3 && c.length <= 5, String(c.length));
  for (const x of c) {
    na.match(x.libelle, /^(?:Au|À l’)(?:nord|sud|est|ouest|nord-est|nord-ouest|sud-est|sud-ouest)? ?\S* \(limite de \d+ m(?:, n° \d)?\)$/);
    na.ok(x.longueurM >= 3);
    na.doesNotMatch(x.libelle, /[·:;]/, 'aucun séparateur de réponse dans un libellé');
  }
  na.deepEqual(c.map((x) => x.longueurM), [...c.map((x) => x.longueurM)].sort((a, b) => b - a));
  na.deepEqual(candidatsCoteRue(SITE.contourWgs84).map((x) => x.libelle), c.map((x) => x.libelle), 'déterministe');
  na.equal(candidatChoisi(c, c[0]!.libelle.toUpperCase()), c[0]);
  na.equal(candidatChoisi(c, 'Au nord du jardin'), null);
  na.deepEqual(candidatsCoteRue(null), []);
  na.deepEqual(candidatsCoteRue([[2, 48], [2.0001, 48]]), []);
});

Deno.test('X10-2 (essai B) : sans fiche de parcelle, le côté de la rue est demandé en puces (plus de « classez la limite sur rue ») ; le côté choisi place l’extension', () => {
  const ctx = contexte(false);
  const t = jouer(PARCOURS.slice(0, 3), ctx);
  const q = t[2]!;
  na.equal(q.etape, 'type');
  na.ok(q.attendues.includes(Q.coteRue.id), q.attendues.join(','));
  na.match(q.texte, /\*\*De quel côté de la parcelle se trouve la rue \?\*\* Je n’ai pas pu la situer automatiquement \(aucune fiche de parcelle avec ses voisines\)/);
  na.match(q.blocChoix!, /"id":"x3_cote_rue","libelle":"Côté de la rue"/);
  na.doesNotMatch(q.texte, /Classez la limite|désignez l’arête/);
  // Réponse hors liste : la question revient, rien n'est deviné.
  const hors = jouer([...PARCOURS.slice(0, 3), 'Côté de la rue : Au nord du jardin'], ctx).at(-1)!;
  na.ok(hors.attendues.includes(Q.coteRue.id));
  // Côté réel choisi : le parcours va jusqu'au gabarit, la source le dit.
  const fin = jouer([...PARCOURS.slice(0, 3), `Côté de la rue : ${coteReel()}`, PARCOURS[3]!, PARCOURS[4]!], ctx).at(-1)!;
  na.equal(fin.etape, 'termine', fin.texte);
  na.equal(fin.resultatMoteur!.ok, true, fin.resultatMoteur!.refus.join(' | '));
  na.ok(fin.vue.sources.some((s) => /Limite sur rue : côté « .+ » du contour cadastral, désigné par vous/.test(s)), fin.vue.sources.join(' | '));
  na.doesNotMatch(fin.texte, /Côté rue inconnu/);
  // Même résultat qu'avec la limite déduite des voisines (même parcelle, mêmes réponses).
  const ref = jouer(PARCOURS, contexte(true)).at(-1)!;
  na.equal(fin.vue.extension!.empriseCreeeM2, ref.vue.extension!.empriseCreeeM2);
  // Avec une fiche complète, la question n'est jamais posée.
  na.ok(jouer(PARCOURS, contexte(true)).every((s) => !s.attendues.includes(Q.coteRue.id)));
});

Deno.test('X10-3 (essai C) : refus — relance avec la vraie cause ; consigne « n’annonce aucun lancement »', () => {
  const ctx = contexte(true);
  const refus = jouer([PARCOURS[0]!, PARCOURS[1]!, 'Toit de la maison : 2 pans · Niveaux de la maison : R+1 · Type d’extension : Latérale · Façade (vue de la rue) : À gauche',
    'Dimensions (largeur × profondeur) : 5 × 6 m · Hauteur de l’extension : Plain-pied', PARCOURS[4]!], ctx).at(-1)!;
  na.equal(refus.resultatMoteur!.ok, false);
  const m = resultatParcours(refus).message!;
  na.match(m, /L’extension N’EST PAS PLACÉE : n’appelle aucun outil de 3D ni de rendu/);
  na.match(m, /n’annonce aucune préparation, maquette, image ni lancement/);
  const coteInconnu = { etape: 'termine' as const, projet: null, resultatMoteur: { ok: false, refus: ['Côté rue inconnu (aucune limite sur rue connue sur la parcelle) : …'] } as never };
  na.match(phraseDeRelance(coteInconnu), /Je ne sais pas encore de quel côté de la parcelle se trouve la rue/);
  na.doesNotMatch(phraseDeRelance(coteInconnu), /dimensions/);
  na.doesNotMatch(phraseDeRelance(coteInconnu), JARGON);
  // Placée : l'appel exact pour l'image, sans brief, jamais un immeuble.
  const ok = jouer(PARCOURS, ctx).at(-1)!;
  na.match(resultatParcours(ok).message!, /appelle studio_lancer_rendu avec type « image », SANS brief/);
  na.match(resultatParcours(ok).message!, /jamais d’un immeuble ni de logements/);
  na.doesNotMatch(resultatParcours(ok).message!, /N’EST PAS PLACÉE/);
});

Deno.test('X10-4 (essai D) : conclusion — secteur « oui » jamais dit « non établi » ; surface après travaux = existante + créée', () => {
  const base = { zoneU: { valeur: true, source: 'zone UC' }, demandeur: 'particulier' as const };
  const r = regimeIndicatif({
    ...base, creee: { empriseM2: 32, sdpM2: null, sdpMinM2: null, sdpMaxM2: null },
    existant: { sdpM2: 200, statut: 'confirmee', minM2: 200, maxM2: 200, empriseM2: 147 },
    secteurProtege: { valeur: null, source: 'Géoportail de l’urbanisme', etat: 'oui' },
  });
  na.ok(r.lignes.some((l) => /^Secteur protégé : oui \(Géoportail de l’urbanisme\), mais son effet sur le seuil de 20 m² n’est pas certain/.test(l)), r.lignes.join(' | '));
  na.ok(!r.lignes.some((l) => /non établi/.test(l)));
  na.ok(r.lignes.some((l) => /après travaux ≈ 232 m² \(32 m² de surface créée retenue ajoutés/.test(l)), r.lignes.join(' | '));
  na.equal(r.totalApresM2, 232);
  // Non vérifié : vocabulaire inchangé (« non établi »).
  const nv = regimeIndicatif({ ...base, creee: { empriseM2: 32, sdpM2: 30, sdpMinM2: 26, sdpMaxM2: 34 }, existant: { sdpM2: 100, statut: 'confirmee', minM2: 100, maxM2: 100, empriseM2: 80 },
    secteurProtege: { valeur: null, source: 'bases', etat: 'non_verifie' } });
  na.ok(nv.lignes.some((l) => /^Secteur protégé non établi/.test(l)));
  na.ok(nv.lignes.some((l) => /après travaux ≈ 130 m²/.test(l)) || nv.lignes.some((l) => /après travaux entre/.test(l)), nv.lignes.join(' | '));
});

// ── Limite sur rue lue au cadastre quand la fiche manque (réseau simulé) ───────────────────────────────────────
function reseauSansFiche(compteur: { voisines: number }, pannesVoisines = 0): typeof fetch {
  const bats = SITE.batiments.map((b) => ({
    type: 'Feature', id: b.id,
    properties: { cleabs: b.id, hauteur: b.hauteurM, nombre_d_etages: b.etages, altitude_minimale_sol: b.altitudeSolM, altitude_minimale_toit: b.altitudeToitMinM,
      altitude_maximale_toit: b.altitudeToitMaxM, usage_1: b.usage, nature: b.nature, construction_legere: b.legere, etat_de_l_objet: 'En service' },
    geometry: { type: 'Polygon', coordinates: b.anneaux.map((a) => [...a, a[0]]) },
  }));
  const parcelle = { type: 'Feature', properties: { idu: P0646, contenance: C.parcelle.surface_m2 ?? 500 }, geometry: C.parcelle.geometrie };
  const voisines = (C.parcelle.voisines.parcelles as { idu: string | null; geometrie: unknown }[]).map((v) => ({ type: 'Feature', properties: { idu: v.idu }, geometry: v.geometrie }));
  return ((url: string) => {
    const u = String(url);
    if (u.startsWith('https://data.geopf.fr/')) return Promise.resolve(new Response(JSON.stringify({ type: 'FeatureCollection', features: bats }), { status: 200 }));
    if (u.startsWith('https://apicarto.ign.fr/api/cadastre/parcelle') && u.includes('geom=')) {
      compteur.voisines += 1;
      if (compteur.voisines <= pannesVoisines) return Promise.resolve(new Response('', { status: 503 }));
      return Promise.resolve(new Response(JSON.stringify({ type: 'FeatureCollection', features: [parcelle, ...voisines] }), { status: 200 }));
    }
    if (u.startsWith('https://apicarto.ign.fr/api/cadastre/parcelle')) return Promise.resolve(new Response(JSON.stringify({ type: 'FeatureCollection', features: [parcelle] }), { status: 200 }));
    if (u.startsWith('https://apicarto.ign.fr/api/gpu/')) return Promise.resolve(new Response(JSON.stringify({ features: [{ properties: { typezone: 'U', libelle: 'UC' } }] }), { status: 200 }));
    return Promise.resolve(new Response('{}', { status: 404 }));
  }) as typeof fetch;
}

Deno.test('X10-5 : sans fiche de parcelle, la limite sur rue est lue au cadastre (voisines, 2 tentatives), mémorisée, et le parcours ne demande pas le côté', async () => {
  const compteur = { voisines: 0 };
  const lu = await facadesParVoisines(P0646, C.parcelle.geometrie, reseauSansFiche(compteur, 1), 1);
  na.equal(compteur.voisines, 2, 'une panne, puis une seconde demande');
  na.deepEqual(lu.facades, facadesVoieDeLaParcelle(C.parcelle).facades, 'même limite que la fiche (même calcul)');
  na.equal(lireFacadesLues({ idu: P0646, date: '2026-11-17', facades: lu.facades })!.facades.length, lu.facades.length);
  na.equal(lireFacadesLues({ idu: P0646, date: '2026-11-17', facades: [{ ...lu.facades[0]!, source: 'devinee' }] }), null);
  na.equal(lireFacadesLues({ idu: 'x', date: '2026-11-17', facades: lu.facades }), null);
  // Parcours complet sans aucune fiche (essai B) : une seule lecture des voisines, réutilisée aux tours suivants.
  const sorties: Record<string, unknown>[] = [];
  const c2 = { voisines: 0 };
  const depot: DepotExtension = { conception: async () => null, sortiesPrecedentes: async () => [...sorties].reverse() };
  const tour = async (t: string) => {
    const r = await executerOutilExtension({ idu: P0646 }, { userId: 'u-1', conversationId: 'conv-x10-5', texteUtilisateur: t, depot, fetch: reseauSansFiche(c2), maintenant: () => Date.parse('2026-11-17T15:09:00Z') });
    if (r.status === 'ok') sorties.push(r.data!);
    return r;
  };
  const r: Awaited<ReturnType<typeof tour>>[] = [];
  for (const m of PARCOURS) r.push(await tour(m));
  na.equal(c2.voisines, 1, 'voisines lues une fois puis mémorisées');
  na.ok(facadesLuesDesSorties([...sorties].reverse(), P0646));
  na.ok(r.every((x) => !(x.data!.attendues as string[]).includes(Q.coteRue.id)));
  const fin = r.at(-1)!;
  na.equal(fin.data!.etape, 'termine', String(fin.data!.texte_affiche));
  const vue = fin.data!.vue as { extension: { verdict: string }; sources: string[] };
  na.equal(vue.extension.verdict, 'ok');
  na.ok(vue.sources.some((s) => /Limite sur rue : déduite du cadastre et des parcelles voisines \(API Carto IGN, lue le 2026-11-17\)/.test(s)), vue.sources.join(' | '));
});

// ── Chaîne extension → image (essai A) ───────────────────────────────────────────────────────────────────────
const USER = '11111111-1111-4111-8111-111111111111';
const CONV = 'conv-x10';
const IDU_AS = '93048000AS0249';
class Depot implements DepotStudio {
  conceptions: Array<ConceptionLue & { user_id: string }> = [];
  preparations: Array<PreparationLue & { user_id: string }> = [];
  travaux: Array<TravailLu & { user_id: string; fiche: Record<string, unknown>; options: Record<string, unknown> }> = [];
  appels: Array<Record<string, unknown>> = [];
  sorties: Record<string, unknown>[] = [];
  stats: StatsFile | null = { attente: 0, plusAncienneAttente: null, enCours: 0, derniereActivite: null };
  async conception(u: string, q: { id?: string | null; idu?: string | null }) {
    return this.conceptions.filter((c) => c.user_id === u && (!q.id || c.id === q.id) && (!q.idu || c.idu === q.idu)).at(-1) ?? null;
  }
  async derniereVersion() { return null; }
  async enregistrerPreparation(u: string, l: Omit<PreparationLue, 'id' | 'cree_le'>) {
    const id = crypto.randomUUID();
    this.preparations.push({ ...structuredClone(l), id, user_id: u, cree_le: new Date().toISOString() });
    return id;
  }
  async preparation(u: string, q: { id?: string | null; conceptionId?: string | null }) {
    return this.preparations.filter((p) => p.user_id === u && (!q.id || p.id === q.id) && (!q.conceptionId || p.conception_id === q.conceptionId)).at(-1) ?? null;
  }
  async typeRenduAutorise() { return true; }
  async statsFile() { return this.stats; }
  async travauxActifs() { return 0; }
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
  async travail(u: string) { return this.travaux.filter((t) => t.user_id === u).at(-1) ?? null; }
  async positionFile() { return 0; }
  async urlSigneeRendu(c: string) { return `https://exemple.supabase.co/storage/v1/object/sign/studio-rendus/${c}?token=t`; }
  async couverturePhotoRue(contour: [number, number][]) {
    return await verifierCouverture(contour, (async () => new Response(JSON.stringify(PANORAMAX), { status: 200 })) as typeof fetch, () => Date.parse('2026-11-11T12:00:00Z'));
  }
  async sortiesExtension() { return [...this.sorties]; }
}
const env = (d: DepotStudio, requete: string): EnvStudio => ({ userId: USER, depot: d, secret: 'secret-de-test', requete, conversationId: CONV, origine: 'https://mimmoza.vercel.app' });
function depotAvecConception(): Depot {
  const d = new Depot();
  d.conceptions.push({
    id: '44444444-4444-4444-8444-444444444444', idu: IDU_AS, commune: 'Montreuil', user_id: USER, regles_plu: [], programme: { nb_logements: 6, gabarit: 'R+3' },
    parcelle: {
      idu: IDU_AS, geometrie: CADASTRE.parcelle.geometry, surface_m2: null, source: 'cadastre (relevé réel)',
      voisines: { statut: 'disponibles', source: 'API Carto IGN', parcelles: CADASTRE.voisines.map((v: { geometry: unknown; idu?: string }) => ({ idu: v.idu ?? null, geometrie: v.geometry })) },
    },
  });
  return d;
}
const FIN = jouer(PARCOURS, contexte(true)).at(-1)!;
const sortie = (verdict: 'ok' | 'refus' | null) => ({
  etape: 'termine', etat: FIN.etat, projet_extension: FIN.projet, option_travail: FIN.optionTravail,
  ...(verdict ? { vue: { ...FIN.vue, extension: { ...FIN.vue.extension!, verdict } } } : {}),
});
const BRIEF_LOGEMENTS = { rdc: 'logements', facade: 'enduit_clair', balcons: 'aucun', toiture: 'deux_pans_tuiles', ambiance: 'jour', ouvertures: 'baies_vitrees', menuiseries: 'anthracite' };

Deno.test('X10-6 (essai A) : extension placée → la « 3D préparée » n’est qu’un support de parcelle (ni Plot, ni logements) ; le rendu lancé porte l’extension, sans brief', async () => {
  const d = depotAvecConception();
  // Sans extension : la préparation habituelle (volume, formes) — inchangée.
  const neuf = await executerOutilStudio('studio_preparer_3d', {}, env(d, 'N0'));
  na.equal(neuf?.status, 'ok', neuf?.message);
  na.ok('volume' in (neuf!.data as Record<string, unknown>));
  // Avec l'extension du parcours (verdict « ok ») : rien de l'immeuble n'est rendu au modèle.
  d.sorties = [sortie('ok')];
  const p = await executerOutilStudio('studio_preparer_3d', {}, env(d, 'P0'));
  na.equal(p?.status, 'ok', p?.message);
  const data = p!.data as Record<string, unknown>;
  na.equal(data.support_extension, true);
  for (const k of ['volume', 'forme_retenue', 'formes_comparees', 'origine_forme']) na.equal(k in data, false, k);
  na.doesNotMatch(JSON.stringify(data), /logement|Plot|SDP/i);
  na.match(p!.message!, /N’écris AUCUN volume, aucune forme, aucun logement/);
  na.match(p!.message!, /appelle MAINTENANT studio_lancer_rendu avec type « image », SANS brief/);
  // Le modèle envoie quand même un brief « logements » (essai du 17/11) : il est ignoré, le rendu porte l'extension.
  const r1 = await executerOutilStudio('studio_lancer_rendu', { type: 'image', brief: BRIEF_LOGEMENTS }, env(d, 'R1'));
  na.equal(r1?.status, 'confirmation_requise', r1?.message);
  na.equal('habillage' in (r1!.data!.devis as Record<string, unknown>), false);
  d.appels.push(structuredClone(r1!) as unknown as Record<string, unknown>);
  const r2 = await executerOutilStudio('studio_lancer_rendu', { confirmer: true }, env(d, 'R2'));
  na.equal(r2?.status, 'ok', r2?.message);
  const t = d.travaux.at(-1)!;
  na.deepEqual(t.fiche.projet_extension, FIN.projet, 'l’image part de l’extension du parcours');
  na.equal((t.fiche.projet_extension as { nature: string }).nature, 'extension');
  na.equal('brief_rendu' in t.fiche, false, 'aucun brief « logements »');
  na.equal('habillage_batiments' in t.fiche, false);
  na.equal(t.options.existant, 'conserver');
});

Deno.test('X10-7 (essai B/C) : extension NON placée → ni 3D ni rendu (préparation et devis refusés, rien d’écrit)', async () => {
  const d = depotAvecConception();
  d.sorties = [sortie('refus')];
  na.equal(projetDesSorties(d.sorties)!.placee, false);
  na.equal(projetDesSorties([sortie('ok')])!.placee, true);
  na.equal(projetDesSorties([sortie(null)])!.placee, true, 'sortie antérieure au lot : lue comme placée');
  const p = await executerOutilStudio('studio_preparer_3d', {}, env(d, 'P0'));
  na.equal(p?.status, 'partial');
  na.equal(p!.message, MESSAGE_EXTENSION_NON_PLACEE);
  na.equal(d.preparations.length, 0, 'aucune préparation enregistrée');
  const r = await executerOutilStudio('studio_lancer_rendu', { type: 'image' }, env(d, 'R0'));
  na.equal(r?.status, 'partial');
  na.equal(r!.message, MESSAGE_EXTENSION_NON_PLACEE);
  na.equal(d.travaux.length, 0);
  na.doesNotMatch(MESSAGE_EXTENSION_NON_PLACEE, /\b(?:serveur|moteur|worker|lot)\b/i);
});

Deno.test('X10-8 : extension placée mais aucun dossier de parcelle → rien n’est préparé, phrase honnête', async () => {
  const d = new Depot();
  d.sorties = [sortie('ok')];
  const p = await executerOutilStudio('studio_preparer_3d', { idu: '64065000AI0002' }, env(d, 'P0'));
  na.equal(p?.status, 'partial');
  na.equal(p!.message, MESSAGE_EXTENSION_SANS_DOSSIER);
  na.equal(d.preparations.length, 0);
});
