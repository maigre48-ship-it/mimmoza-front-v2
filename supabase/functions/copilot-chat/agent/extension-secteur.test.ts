// supabase/functions/copilot-chat/agent/extension-secteur.test.ts
// LOT X3b (14/11/2026) — secteur protégé (Architecte des Bâtiments de France) dans le parcours « extension de maison ».
// Réponses SIMULÉES mais RÉALISTES des deux services internes, au format exact de leur code déployé (lu le 14/11/2026 en
// lecture seule) : servitudes-gpu-v1 → { status, summary, stats: { couches_interrogees, couches_totales,
// geometrie_utilisee, … }, items: [{ categorie (vide en réel), nom, type_assiette, idass, idgen, partition, date_maj }] } ;
// patrimoine-merimee-v1 → { status, summary, stats: { total, …, dans_perimetre_abf_500m }, items: [{ nom, protection,
// distance_m, … }] }. Les servitudes AC1 de Ciboure et PM1 de Montreuil, et les monuments de Bayonne, reprennent des
// réponses RÉELLES relevées dans copilot_tool_calls (production, lecture seule) ; la panne Mérimée reprend l'erreur réelle.
import * as na from 'node:assert/strict';
const assert = (v: unknown, m?: string) => na.ok(v, m);
const assertEquals = (a: unknown, b: unknown, m?: string) => na.deepStrictEqual(a, b, m);
const assertMatch = (t: string, r: RegExp) => na.match(t, r);
const assertNotMatch = (t: string, r: RegExp) => na.doesNotMatch(t, r);
import {
  categorieServitude, evaluerSecteurProtege, ligneCourteSecteur, lireSecteurEnregistre, type ReponseService,
} from '../../_shared/extension/secteurProtege.ts';
import { regimeIndicatif, type EntreeRegime } from '../../_shared/extension/reglementation.ts';
import { avancerParcours, ETAT_INITIAL, type ContexteParcours, type EtatParcours, type SortieParcours } from '../../_shared/extension/parcours.ts';
import { consulterSecteurProtege, executerOutilExtension, reglesDeLaConception, secteurDesSorties, type DepotExtension, type ServicesPatrimoine } from './extension.ts';
import { facadesVoieDeLaParcelle } from './voisines-parcelle.ts';
import type { BatimentBdTopo } from '../../_shared/extension/bdtopoParcelle.ts';

const FX = JSON.parse(Deno.readTextFileSync(new URL('../../../../src/spaces/copilot/studio3d/__fixtures__/extension-x3-reel.json', import.meta.url)));
const C = FX.conceptionP0646;
type SiteFx = { idu: string; contourWgs84: [number, number][]; batiments: BatimentBdTopo[] };
const SITE = (FX.bdtopo.sites as SiteFx[]).find((s) => s.idu === '930470000P0646')!;
const INTERNES = /\b(?:get_[a-z_]+|extension_maison|servitudes-gpu-v1|patrimoine-merimee-v1|COPILOT_FN_[A-Z_]+)\b/;
const AVERT = "Le Géoportail de l'Urbanisme n'est pas exhaustif : une absence de résultat ne garantit pas l'absence de servitude sur la parcelle.";
const SRC = "Géoportail de l'Urbanisme (SUP) via API Carto IGN";

// ── Réponses des services (format du code déployé) ─────────────────────────────────────────────────────────
const sup = (items: Record<string, unknown>[], geom: 'parcelle' | 'point' = 'parcelle', lues = 3) => ({
  status: items.length ? 'ok' : 'no_data', summary: `${items.length} servitude(s) … ⚠️ ${AVERT}`,
  stats: { nb_servitudes: items.length, geometrie_utilisee: geom, avertissement: AVERT, source: SRC, couches_interrogees: lues, couches_totales: 3 },
  items,
});
const item = (code: string, nom: string, type: string, n = 1) => ({
  categorie: null, categorie_label: null, nom, type_assiette: type, idass: `${code}-172014607-19072312${60 + n}-1-2`, idgen: `${code}-172014607-19072312${60 + n}-1`,
  partition: `172014607_SUP_64_${code}`, date_maj: null,
});
// Réel (Ciboure, 05/10/2026) : trois AC1 « Périmètre des abords » et un PM1.
const GPU_ABORDS = sup([
  item('AC1', 'Pont sur la Nivelle', 'Périmètre des abords', 8), item('AC1', 'Maison Earle', 'Périmètre des abords', 7),
  { categorie: null, categorie_label: null, nom: 'Plan_de_prevention_des_risques_naturels_previsibles_et_des_risques_miniers', type_assiette: 'Enveloppe des zonages réglementaires', idass: 'PM1-130011570-82-1-1', idgen: 'PM1-130011570-82-1', partition: '130011570_SUP_64_PM1', date_maj: null },
  item('AC1', "Eglise de l'Assomption", 'Périmètre des abords', 6),
]);
// SPR (assiette AC4) + PM1.
const GPU_SPR = sup([
  { categorie: null, categorie_label: null, nom: 'Site patrimonial remarquable de Bayonne', type_assiette: 'Périmètre du site patrimonial remarquable', idass: 'AC4-172014607-2019-1-1', idgen: 'AC4-172014607-2019-1', partition: '172014607_SUP_64_AC4', date_maj: null },
  { categorie: null, categorie_label: null, nom: 'Plan de prévention du risque inondation', type_assiette: 'Enveloppe des zonages réglementaires', idass: 'PM1-130011570-90-1-1', idgen: 'PM1-130011570-90-1', partition: '130011570_SUP_64_PM1', date_maj: null },
]);
// Réel (Montreuil, 10/11/2026) : un PM1 seulement.
const GPU_HORS = sup([{ categorie: null, categorie_label: null, nom: 'Périmètre approuvé du plan de prévention des risques mouvements de terrain de Montreuil', type_assiette: 'Enveloppe des zonages réglementaires', idass: 'PM1-130029325-51-1-1', idgen: 'PM1-130029325-51-1', partition: '130029325_SUP_93_PM1', date_maj: null }]);
const GPU_PANNE = { status: 'error', summary: "L'API Carto (GPU) est momentanément injoignable : aucune couche de servitudes n'a pu être consultée. Ce résultat ne signifie PAS que la parcelle est libre de servitude", stats: null, items: [] };
// Réel (Bayonne, 04/08/2026) : 14 monuments dans 500 m, le plus proche à 169 m.
const MH_BAYONNE = {
  status: 'ok', summary: '14 monument(s) historique(s) trouvé(s) dans un rayon de 500 m. …',
  stats: { total: 14, nb_classes: 4, nb_inscrits: 11, distance_plus_proche_m: 169, dans_perimetre_abf_500m: true },
  items: [
    { nom: 'Immeuble', denomination: 'immeuble', protection: 'inscrit MH partiellement', date_protection: '1988/02/01 : inscrit MH', adresse: '5 rue des Gouverneurs', commune: 'Bayonne', siecle: '14e s.', distance_m: 169 },
    { nom: 'Château-Vieux', denomination: 'château', protection: 'classé MH', date_protection: '1931/11/07 : classé MH', adresse: null, commune: 'Bayonne', siecle: '12e s.;17e s.', distance_m: 191 },
  ],
};
const MH_AUCUN = { status: 'no_data', summary: "Aucun monument historique dans un rayon de 500 m. Le terrain n'est pas dans un périmètre d'abords MH connu à cette distance.", stats: null, items: [] };
// Réel (production, depuis le 26/09/2026) : la source Mérimée renvoie une page HTML.
const MH_PANNE = { status: 'error', summary: "Erreur interrogation Mérimée : Unexpected token '<', \"<!doctype \"... is not valid JSON", stats: null, items: [] };
const ok = (data: unknown): ReponseService => ({ ok: true, data });
const DATE = '2026-11-14';

Deno.test('X3b-1 : catégorie lue dans idgen / partition (le champ « categorie » est vide en réel)', () => {
  assertEquals(categorieServitude(item('AC1', 'x', 'y')), 'AC1');
  assertEquals(categorieServitude({ categorie: null, partition: '130029325_SUP_93_PM1' }), 'PM1');
  assertEquals(categorieServitude({ categorie: 'ac4' }), 'AC4');
  assertEquals(categorieServitude({ nom: 'sans identifiant' }), null);
});

Deno.test('X3b-2 : SPR (AC4) + monuments à moins de 500 m → oui ; accord ABF ; seuil de 20 m² ; délai majoré ; sources', () => {
  const s = evaluerSecteurProtege('640000000AB0001', DATE, ok(GPU_SPR), ok(MH_BAYONNE));
  assertEquals([s.etat, s.libelle, s.seuil20], ['oui', 'oui', true]);
  assertEquals(s.protections.map((p) => p.code), ['AC4', 'MH']);
  const t = s.lignes.join('\n');
  assertMatch(t, /Site patrimonial remarquable « Site patrimonial remarquable de Bayonne »/);
  assertMatch(t, /ACCORD requis en site patrimonial remarquable/);
  assertMatch(t, /« Immeuble » \(inscrit MH partiellement\) à environ 169 m du centre de la parcelle, et 1 autre\(s\)/);
  assertMatch(t, /jusqu’à 20 m² créés, même en zone U/);
  assertMatch(t, /2 mois au lieu de 1 \(F17578\).*3 mois au lieu de 2 \(F1986\).*R423-24/);
  assert(s.sources.some((x) => /F36777/.test(x.url)) && s.sources.some((x) => /F17578/.test(x.url)) && s.sources.some((x) => /F1986/.test(x.url)));
  assertNotMatch(JSON.stringify(s), INTERNES);
  assertMatch(ligneCourteSecteur(s), /^Secteur protégé : \*\*oui\*\* — site patrimonial remarquable « Site patrimonial remarquable de Bayonne », monument historique à moins de 500 m \(.*14\/11\/2026\)\.$/);
});

Deno.test('X3b-3 : abords (AC1 réels de Ciboure) + Mérimée en PANNE → oui, covisibilité, régime « possible » ; vérification incomplète dite', () => {
  const s = evaluerSecteurProtege('640000000AB0002', DATE, ok(GPU_ABORDS), ok(MH_PANNE));
  assertEquals([s.etat, s.seuil20], ['oui', null]);
  assertEquals(s.protections.map((p) => p.nom), ['Pont sur la Nivelle', 'Maison Earle', "Eglise de l'Assomption"]);
  const t = s.lignes.join('\n');
  assertMatch(t, /visible du monument ou en même temps que lui, à moins de 500 m \(covisibilité appréciée par l’ABF\)/);
  assertMatch(t, /Effet possible sur l’autorisation/);
  assertMatch(t, /Vérification incomplète — base Mérimée.*n’a pas pu être consultée/);
  assertNotMatch(t, /Unexpected token|doctype/);
  // Périmètre délimité publié : effet certain.
  const d = evaluerSecteurProtege('x', DATE, ok(sup([item('AC1', 'Église', 'Périmètre délimité des abords')])), ok(MH_AUCUN));
  assertEquals(d.seuil20, true);
});

Deno.test('X3b-4 : hors secteur (PM1 réel de Montreuil, aucun monument) → « non trouvé », jamais « hors secteur protégé » ; panne → « non vérifié »', () => {
  const s = evaluerSecteurProtege('930480000AB0001', DATE, ok(GPU_HORS), ok(MH_AUCUN));
  assertEquals([s.etat, s.libelle, s.seuil20, s.protections.length], ['non_trouve', 'non trouvé', false, 0]);
  assertMatch(s.lignes.join(' '), /ce n’est PAS une garantie que la parcelle est hors secteur protégé/);
  // Panne GPU, Mérimée muette : non vérifié, rien conclu.
  for (const [g, m] of [[ok(GPU_PANNE), ok(MH_AUCUN)], [{ ok: false, raison: 'servitudes-gpu-v1 → HTTP 500' }, ok(MH_PANNE)], [null, null], [ok(GPU_HORS), ok(MH_PANNE)]] as [ReponseService, ReponseService][]) {
    const p = evaluerSecteurProtege('930480000AB0001', DATE, g, m);
    assertEquals([p.etat, p.libelle, p.seuil20], ['non_verifie', 'non vérifié', null]);
    assertMatch(p.lignes.join(' '), /Rien ne permet de dire que la parcelle est hors secteur protégé/);
    assertNotMatch(JSON.stringify(p), INTERNES);
    assertNotMatch(JSON.stringify(p), /HTTP 500|Unexpected token/);
  }
  // Une couche sur trois non lue, ou recherche au point : inventaire partiel → non vérifié.
  assertEquals(evaluerSecteurProtege('x', DATE, ok(sup([], 'parcelle', 2)), ok(MH_AUCUN)).etat, 'non_verifie');
  assertEquals(evaluerSecteurProtege('x', DATE, ok(sup([], 'point')), ok(MH_AUCUN)).etat, 'non_verifie');
  // Monument seul (pas de servitude publiée) : oui, indicatif.
  const mh = evaluerSecteurProtege('x', DATE, ok(GPU_HORS), ok(MH_BAYONNE));
  assertEquals([mh.etat, mh.seuil20], ['oui', null]);
  assertMatch(mh.lignes.join(' '), /seul l’ABF peut en juger/);
  // Site inscrit seul : avis simple, pas de seuil de 20 m² (F36777 ne le cite pas).
  const si = evaluerSecteurProtege('x', DATE, ok(sup([item('AC2', 'Site inscrit des bords de Nivelle', 'Périmètre du site')])), ok(MH_AUCUN));
  assertEquals([si.etat, si.seuil20], ['oui', false]);
  assertMatch(si.lignes.join(' '), /AVIS SIMPLE de l’ABF/);
  assertMatch(si.lignes.join(' '), /2 mois au lieu de 1 en site inscrit \(F17578\)/);
});

const R = (sp: EntreeRegime['secteurProtege'], creee = 30, zoneU: boolean | null = true) => regimeIndicatif({
  creee: { empriseM2: creee, sdpM2: creee * 0.85, sdpMinM2: creee * 0.85 * 0.85, sdpMaxM2: creee * 0.85 * 1.15 },
  existant: { sdpM2: 90, statut: 'confirmee' }, zoneU: { valeur: zoneU, source: 'zone UC (test)' }, demandeur: 'particulier', ...(sp !== undefined ? { secteurProtege: sp } : {}),
});

Deno.test('X3b-5 : régime — 30 m² en zone U : DP hors secteur ; PC en secteur protégé ; « DP ou PC » si non établi ; non trouvé : DP + mention', () => {
  assertEquals(R(undefined).regime, 'DP');
  const oui = R({ valeur: true, source: 'test' });
  assertEquals([oui.regime, oui.architecte], ['PC', 'non-obligatoire']);
  assert(oui.lignes.some((l) => /Secteur protégé \(test\) : déclaration préalable jusqu’à 20 m² créés seulement.*ici PC/.test(l)));
  const nul = R({ valeur: null, source: 'test' });
  assertEquals(nul.regime, 'DP ou PC');
  assert(nul.lignes.some((l) => /hors secteur protégé, DP ; en secteur protégé .*PC/.test(l)));
  const non = R({ valeur: false, source: 'test' });
  assertEquals(non.regime, 'DP');
  assert(non.lignes.some((l) => /Aucun secteur protégé trouvé.*le seuil serait de 20 m² : PC/.test(l)));
  // 15 m² : DP partout, aucune ligne de plus quand rien ne change.
  assertEquals(R({ valeur: true, source: 't' }, 15).regime, 'DP');
  assertEquals(R({ valeur: false, source: 't' }, 15).lignes.length, R(undefined, 15).lignes.length);
  // Hors zone U : déjà 20 m².
  assertEquals(R({ valeur: null, source: 't' }, 30, false).regime, 'PC');
});

function contexte(extra: Partial<ContexteParcours> = {}): ContexteParcours {
  const fac = facadesVoieDeLaParcelle(C.parcelle);
  return {
    idu: '930470000P0646', commune: 'Montfermeil', contourWgs84: SITE.contourWgs84, surfaceParcelleM2: C.parcelle.surface_m2,
    batiments: SITE.batiments, raisonBdTopo: null, dateBdTopo: DATE, bdnb: null, noteBdnb: null,
    zoneU: { valeur: true, source: 'zone UC (test)' }, regles: reglesDeLaConception(C.regles_plu),
    facadesVoie: fac.facades.map((f) => ({ debut: f.debut, fin: f.fin })), raisonFacades: fac.raison, ...extra,
  };
}
function jouer(ctx: ContexteParcours, messages: string[]): SortieParcours[] {
  const out: SortieParcours[] = [];
  let etat: EtatParcours = ETAT_INITIAL;
  let attendues: readonly string[] = [];
  for (const m of messages) { const s = avancerParcours(etat, m, attendues, ctx); out.push(s); etat = s.etat; attendues = s.attendues; }
  return out;
}
const PARCOURS = [
  'Je voudrais agrandir ma maison', 'Maison existante : Conserver la maison',
  'Toit de la maison : 2 pans · Niveaux de la maison : R+1 · Type d’extension : Arrière · Façade (vue de la rue) : À l’arrière',
  'Dimensions (largeur × profondeur) : 6 × 5 m · Hauteur de l’extension : Plain-pied',
  'Surface de plancher existante : Je l’indique · 90 m² · Demandeur : Particulier',
];

Deno.test('X3b-6 : parcours P0646 (zone U), arrière 6 × 5 m — SPR : dit dès l’étape 1, PC à la synthèse ; non trouvé : DP ; panne : « DP ou PC », jamais « hors »', () => {
  const spr = evaluerSecteurProtege('930470000P0646', DATE, ok(GPU_SPR), ok(MH_BAYONNE));
  const t = jouer(contexte({ secteur: spr }), PARCOURS);
  assertEquals(t.map((s) => s.etape), ['conserver', 'confirmer', 'dimensions', 'surface', 'termine']);
  assertMatch(t[0]!.texte, /Secteur protégé : \*\*oui\*\* — site patrimonial remarquable/);
  for (const s of t) assertEquals(s.vue.secteur!.etat, 'oui');
  const fin = t[4]!;
  assertEquals(fin.regime!.regime, 'PC');
  assertMatch(fin.texte, /\*\*Secteur protégé \(indicatif\) : oui\*\* — Géoportail de l’urbanisme et base Mérimée des monuments historiques, consultés le 14\/11\/2026\./);
  assertMatch(fin.texte, /ACCORD requis en site patrimonial remarquable/);
  assertMatch(fin.texte, /\[Service-public\.gouv\.fr — Déclaration préalable \(F17578, délai en secteur protégé\)\]\(https:\/\/www\.service-public\.gouv\.fr\/particuliers\/vosdroits\/F17578\)/);
  assertMatch(fin.texte, /Permis de construire \(probable\)/);
  for (const s of t) assertNotMatch(s.texte + JSON.stringify(s.vue), INTERNES);
  // Non trouvé : DP (zone U, 30 m²), avec la mention du seuil de 20 m².
  const hors = jouer(contexte({ secteur: evaluerSecteurProtege('930470000P0646', DATE, ok(GPU_HORS), ok(MH_AUCUN)) }), PARCOURS)[4]!;
  assertEquals(hors.regime!.regime, 'DP');
  assertMatch(hors.texte, /Secteur protégé \(indicatif\) : non trouvé/);
  assertMatch(hors.texte, /le seuil serait de 20 m² : PC/);
  // Panne : non vérifié, « DP ou PC ».
  const panne = jouer(contexte({ secteur: evaluerSecteurProtege('930470000P0646', DATE, ok(GPU_PANNE), ok(MH_PANNE)) }), PARCOURS);
  assertMatch(panne[0]!.texte, /Secteur protégé : \*\*non vérifié\*\*/);
  assertEquals(panne[4]!.regime!.regime, 'DP ou PC');
  assertMatch(panne[4]!.texte, /Rien ne permet de dire que la parcelle est hors secteur protégé/);
  assertNotMatch(panne[4]!.texte, /non trouvé|Aucun secteur protégé trouvé/);
  // Sans secteur évalué (comportement X3) : DP, aucune ligne de secteur.
  const x3 = jouer(contexte(), PARCOURS)[4]!;
  assertEquals([x3.regime!.regime, x3.vue.secteur], ['DP', null]);
  assertNotMatch(x3.texte, /Secteur protégé/);
});

// ── Outil complet : services simulés, corps envoyés, réutilisation d'un tour à l'autre ─────────────────────
function fauxReseau(): typeof fetch {
  const features = SITE.batiments.map((b) => ({
    type: 'Feature', id: b.id,
    properties: { cleabs: b.id, hauteur: b.hauteurM, nombre_d_etages: b.etages, altitude_minimale_sol: b.altitudeSolM, altitude_minimale_toit: b.altitudeToitMinM,
      altitude_maximale_toit: b.altitudeToitMaxM, usage_1: b.usage, nature: b.nature, construction_legere: b.legere, etat_de_l_objet: 'En service' },
    geometry: { type: 'Polygon', coordinates: b.anneaux.map((a) => [...a, a[0]]) },
  }));
  return ((url: string) => {
    const u = String(url);
    const corps = u.startsWith('https://data.geopf.fr/') ? { type: 'FeatureCollection', features }
      : u.startsWith('https://api.bdnb.io/') ? [] : u.startsWith('https://apicarto.ign.fr/api/gpu/') ? { features: [{ properties: { typezone: 'U', libelle: 'UC' } }] } : null;
    return Promise.resolve(corps ? new Response(JSON.stringify(corps), { status: 200 }) : new Response('{}', { status: 404 }));
  }) as typeof fetch;
}

Deno.test('X3b-7 : outil — services appelés au centre de la parcelle, secteur réutilisé d’un tour à l’autre, réinterrogé s’il était « non vérifié »', async () => {
  const appels: { f: string; corps: Record<string, unknown> }[] = [];
  let gpu: unknown = GPU_ABORDS;
  const services: ServicesPatrimoine = {
    servitudes: async (corps) => { appels.push({ f: 'sup', corps }); if (gpu instanceof Error) throw gpu; return gpu; },
    merimee: async (corps) => { appels.push({ f: 'mh', corps }); return MH_AUCUN; },
  };
  const sorties: Record<string, unknown>[] = [];
  const depot: DepotExtension = {
    conception: async (_u, q) => (q.idu === '930470000P0646' || q.id === 'c-1' ? { id: 'c-1', ...C } : null),
    conceptionDeLaConversation: async () => 'c-1',
    sortiesPrecedentes: async () => [...sorties].reverse(),
  };
  const tour = async (texte: string, patrimoine: ServicesPatrimoine | null = services) => {
    const r = await executerOutilExtension({}, { userId: 'u', conversationId: 'conv', texteUtilisateur: texte, depot, fetch: fauxReseau(), patrimoine, maintenant: () => Date.parse('2026-11-14T10:00:00Z') });
    if (r.status === 'ok') sorties.push(r.data!);
    return r;
  };
  // 1er tour : service des servitudes en panne → non vérifié (aucune conclusion), puis réinterrogé au tour suivant.
  gpu = new Error('servitudes-gpu-v1 → HTTP 503');
  const r1 = await tour('je voudrais agrandir ma maison');
  assertEquals((r1.data!.vue as { secteur: { etat: string } }).secteur.etat, 'non_verifie');
  assertMatch(String(r1.data!.texte_affiche), /Secteur protégé : \*\*non vérifié\*\*/);
  assertNotMatch(JSON.stringify(r1), INTERNES);
  assertNotMatch(JSON.stringify(r1), /HTTP 503/);
  gpu = GPU_ABORDS;
  const r2 = await tour('Maison existante : Conserver la maison');
  assertEquals((r2.data!.vue as { secteur: { etat: string } }).secteur.etat, 'oui');
  assertEquals(appels.length, 4);
  const c = appels[2]!.corps;
  assertEquals(c.cadastral_ref, '930470000P0646');
  assert(typeof c.lat === 'number' && typeof c.lon === 'number' && Math.abs((c.lat as number) - 48.86) < 0.05 && Math.abs((c.lon as number) - 2.57) < 0.05, JSON.stringify(c));
  assertEquals(Object.keys(appels[3]!.corps).sort(), ['lat', 'lon']);
  // Tours suivants : réutilisé (aucun nouvel appel), même date.
  await tour('Toit de la maison : 2 pans · Niveaux de la maison : R+1 · Type d’extension : Arrière · Façade (vue de la rue) : À l’arrière');
  await tour('Dimensions (largeur × profondeur) : 6 × 5 m · Hauteur de l’extension : Plain-pied');
  const r5 = await tour('Surface de plancher existante : 90 m² · Demandeur : Particulier');
  assertEquals(appels.length, 4);
  assertEquals(r5.data!.etape, 'termine');
  assertMatch(String(r5.data!.texte_affiche), /Abords de monument historique \(« Pont sur la Nivelle »\)/);
  assertMatch(String(r5.data!.texte_affiche), /Déclaration préalable ou permis de construire \(à préciser\)/);
  assertNotMatch(JSON.stringify(r5), INTERNES);
  assertEquals(secteurDesSorties([...sorties].reverse(), '930470000P0646')!.etat, 'oui');
  assertEquals(secteurDesSorties([...sorties].reverse(), '930470000P0999'), null);
  // Services non branchés : non vérifié, jamais « hors ».
  const nb = await consulterSecteurProtege('930470000P0646', 2.57, 48.86, null, DATE);
  assertEquals([nb.etat, nb.verifications.map((v) => v.etat)], ['non_verifie', ['non_branchee', 'non_branchee']]);
  // Relecture défensive.
  assertEquals(lireSecteurEnregistre({ v: 1, idu: 'x', date: DATE, etat: 'hors' }), null);
});

Deno.test('X3b-8 : service trop lent → borné, « non vérifié »', async () => {
  const lent: ServicesPatrimoine = { servitudes: () => new Promise(() => {}), merimee: async () => MH_AUCUN };
  const orig = globalThis.setTimeout;
  // Délai accéléré pour le test : tout minuteur > 1 s part à 1 ms.
  (globalThis as { setTimeout: unknown }).setTimeout = ((f: () => void, ms?: number) => orig(f, ms && ms > 1000 ? 1 : ms)) as typeof setTimeout;
  try {
    const s = await consulterSecteurProtege('930470000P0646', 2.57, 48.86, lent, DATE);
    assertEquals([s.etat, s.verifications[0]!.etat], ['non_verifie', 'echec']);
  } finally { (globalThis as { setTimeout: unknown }).setTimeout = orig; }
});
