// supabase/functions/copilot-chat/agent/extension-dossier.test.ts
// LOT D9 (16/11/2026) — « Préparer mon dossier » : aperçu des pièces établi par le SERVEUR à la fin du parcours
// d'extension (aucun texte du modèle), régime brut transmis à la carte, question « DP ou PC » posée par le serveur.
// Parcours rejoué sur la maison RÉELLE P0646 (fixture extension-x3-reel.json, comme X3-8).
import * as na from 'node:assert/strict';
const assert = (v: unknown, m?: string) => na.ok(v, m);
const assertEquals = (a: unknown, b: unknown, m?: string) => na.deepStrictEqual(a, b, m);
const assertMatch = (t: string, r: RegExp) => na.match(t, r);
const assertNotMatch = (t: string, r: RegExp) => na.doesNotMatch(t, r);
import { avancerParcours, ETAT_INITIAL, type ContexteParcours, type EtatParcours, type SortieParcours } from '../../_shared/extension/parcours.ts';
import { COUT_DOSSIER, dossierPrevisionnel } from '../../_shared/extension/dossier.ts';
import { reglesDeLaConception } from './extension.ts';
import { facadesVoieDeLaParcelle } from './voisines-parcelle.ts';
import type { BatimentBdTopo } from '../../_shared/extension/bdtopoParcelle.ts';

const FX = JSON.parse(Deno.readTextFileSync(new URL('../../../../src/spaces/copilot/studio3d/__fixtures__/extension-x3-reel.json', import.meta.url)));
type SiteFx = { idu: string; contourWgs84: [number, number][]; batiments: BatimentBdTopo[] };
const SITE = (FX.bdtopo.sites as SiteFx[]).find((s) => s.idu === '930470000P0646')!;
const C = FX.conceptionP0646;
const INTERNES = /\b(?:get_[a-z_]+|extension_maison|studio_[a-z_]+|dossierPrevisionnel|dossierDepuisProjet)\b/;

function contexte(zoneU: boolean | null): ContexteParcours {
  const fac = facadesVoieDeLaParcelle(C.parcelle);
  return {
    idu: '930470000P0646', commune: 'Montfermeil', contourWgs84: SITE.contourWgs84, surfaceParcelleM2: C.parcelle.surface_m2 ?? null,
    batiments: SITE.batiments, raisonBdTopo: null, dateBdTopo: '2026-11-12', bdnb: null, noteBdnb: null,
    zoneU: { valeur: zoneU, source: zoneU === null ? 'zonage non lu (test)' : 'zone UC (test)' }, regles: reglesDeLaConception(C.regles_plu),
    facadesVoie: fac.facades.map((f) => ({ debut: f.debut, fin: f.fin })), raisonFacades: fac.raison,
  };
}
function jouer(ctx: ContexteParcours, dims: string, sdp = '118'): SortieParcours[] {
  const messages = [
    'Je voudrais agrandir ma maison', 'Maison existante : Conserver la maison',
    'Toit de la maison : 2 pans · Niveaux de la maison : R+1 · Type d’extension : Arrière · Façade (vue de la rue) : À l’arrière',
    `Dimensions (largeur × profondeur) : ${dims} · Hauteur de l’extension : Plain-pied`,
    `Surface de plancher existante : Je l’indique · ${sdp} m² · Demandeur : Particulier`,
  ];
  const out: SortieParcours[] = [];
  let etat: EtatParcours = ETAT_INITIAL;
  let attendues: readonly string[] = [];
  for (const m of messages) { const s = avancerParcours(etat, m, attendues, ctx); out.push(s); etat = s.etat; attendues = s.attendues; }
  return out;
}

Deno.test('D9-S1 : parcours P0646 5 × 4 m terminé (DP) → aperçu DP1…DP8 (+DP11 secteur non évalué), régime brut, gratuit ; aucune vue dossier avant la fin', () => {
  const t = jouer(contexte(null), '5 × 4 m');
  assertEquals(t.map((s) => s.etape), ['conserver', 'confirmer', 'dimensions', 'surface', 'termine']);
  for (const s of t.slice(0, 4)) assertEquals(s.vue.dossier, undefined);
  const fin = t[4]!;
  assertEquals(fin.vue.regime!.code, 'DP');
  const d = fin.vue.dossier!;
  assertEquals([d.regimeIndicatif, d.choix, d.question], ['DP', ['DP'], null]);
  assertEquals(d.pieces.DP!.map((p) => p.code), ['DP1', 'DP2', 'DP3', 'DP4', 'DP6', 'DP7', 'DP8', 'DP11']);
  assertEquals(d.pieces.PC, undefined);
  assertEquals(d.cout, COUT_DOSSIER);
  assertMatch(d.mention, /sans architecte, à vérifier/);
  assertNotMatch(fin.texte, /Pour préparer votre dossier/);
  assertNotMatch(JSON.stringify(fin.vue), INTERNES);
});

Deno.test('D9-S2 : zonage inconnu, 6 × 5 m → « DP ou PC » : le serveur pose la question (texte et carte), deux listes de pièces', () => {
  const fin = jouer(contexte(null), '6 × 5 m', '90').at(-1)!;
  assertEquals(fin.etape, 'termine');
  assertEquals(fin.vue.regime!.code, 'DP ou PC');
  const d = fin.vue.dossier!;
  assertEquals(d.choix, ['DP', 'PC']);
  assertMatch(d.question!, /déclaration préalable ou d’un permis de construire/);
  assertEquals(d.pieces.PC!.map((p) => p.code), ['PCMI1', 'PCMI2', 'PCMI3', 'PCMI4', 'PCMI5', 'PCMI6', 'PCMI7', 'PCMI8']);
  assertMatch(fin.texte, /Pour préparer votre dossier :\*\* déclaration préalable ou permis de construire \?/);
  assertNotMatch(fin.texte, INTERNES);
});

Deno.test('D9-S3 : extension refusée → aucun aperçu ; dossierPrevisionnel : secteur non trouvé sans DP11, régime inconnu sans bouton', () => {
  const refus = jouer(contexte(true), '30 × 30 m').at(-1)!;
  if (refus.etape === 'termine') {
    assertEquals(refus.vue.extension!.verdict, 'refus');
    assertEquals(refus.vue.dossier, undefined);
  }
  assertEquals(dossierPrevisionnel('DP', 'non_trouve').pieces.DP!.some((p) => p.code === 'DP11'), false);
  assertEquals(dossierPrevisionnel('DP', 'oui').pieces.DP!.some((p) => p.code === 'DP11'), true);
  const inc = dossierPrevisionnel('inconnu', null);
  assertEquals([inc.choix, Object.keys(inc.pieces)], [[], []]);
  assert(inc.question && /surface de plancher existante réelle/.test(inc.question));
});
