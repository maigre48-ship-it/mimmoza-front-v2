// supabase/functions/copilot-chat/agent/extension-x7.test.ts
// LOT X7 (16/11/2026) — parcours extension : questions fermées supplémentaires (pente et sens du faîtage pour un toit en
// pente, hauteur à l'égout si connue, clôture sur rue, menuiseries, baie vitrée), transmises dans `projet_extension` avec
// leur statut (confirmée ; « je ne sais pas » ou sans réponse : estimée, jamais inventée). Contrat X0 recopié du Studio.
// Données RÉELLES : src/spaces/copilot/studio3d/__fixtures__/extension-x3-reel.json (P0646).
import * as na from 'node:assert/strict';
const assert = (v: unknown, m?: string) => na.ok(v, m);
const assertEquals = (a: unknown, b: unknown, m?: string) => na.deepStrictEqual(a, b, m);
const assertMatch = (t: string, r: RegExp) => na.match(t, r);
import type { BatimentBdTopo } from '../../_shared/extension/bdtopoParcelle.ts';
import { lireProjetExtension, MENUISERIES_CONTRAT } from '../../_shared/extension/contrat.ts';
import { avancerParcours, ETAT_INITIAL, lireEtat, Q, type ContexteParcours, type EtatParcours, type SortieParcours } from '../../_shared/extension/parcours.ts';
import { reglesDeLaConception } from './extension.ts';
import { facadesVoieDeLaParcelle } from './voisines-parcelle.ts';

const FX = JSON.parse(Deno.readTextFileSync(new URL('../../../../src/spaces/copilot/studio3d/__fixtures__/extension-x3-reel.json', import.meta.url)));
type SiteFx = { idu: string; contourWgs84: [number, number][]; batiments: BatimentBdTopo[] };
const S: SiteFx = FX.bdtopo.sites.find((s: SiteFx) => s.idu === '930470000P0646');
const C = FX.conceptionP0646;
const fac = facadesVoieDeLaParcelle(C.parcelle);
const CTX: ContexteParcours = {
  idu: S.idu, commune: 'Montfermeil', contourWgs84: S.contourWgs84, surfaceParcelleM2: C.parcelle.surface_m2 ?? null, batiments: S.batiments, raisonBdTopo: null,
  dateBdTopo: '2026-11-12', bdnb: null, noteBdnb: null, zoneU: { valeur: null, source: 'zonage non lu (test)' }, regles: reglesDeLaConception(C.regles_plu),
  facadesVoie: fac.facades.map((f) => ({ debut: f.debut, fin: f.fin })), raisonFacades: fac.raison,
};
function jouer(messages: string[]): SortieParcours[] {
  const out: SortieParcours[] = [];
  let etat: EtatParcours = ETAT_INITIAL;
  let att: readonly string[] = [];
  for (const m of messages) { const s = avancerParcours(etat, m, att, CTX); out.push(s); etat = s.etat; att = s.attendues; }
  return out;
}
const DEBUT = ['agrandir ma maison', 'Maison existante : Conserver la maison', 'Toit de la maison : 2 pans · Niveaux de la maison : R+1 · Type d’extension : Arrière · Façade (vue de la rue) : À l’arrière'];
const existant = (s: SortieParcours) => s.projet!.existants[0]!;

Deno.test('X7-1 : toit en pente → pente, sens du faîtage et égout posés avec les dimensions ; options fermées', () => {
  const t = jouer(DEBUT);
  const ids = t[2]!.attendues;
  for (const id of [Q.dimensions.id, Q.penteToit.id, Q.faitage.id, Q.egout.id]) assert(ids.includes(id), id);
  const bloc = t[2]!.blocChoix!;
  assertMatch(bloc, /Faible \(≈ 25°\)/);
  assertMatch(bloc, /Moyenne \(≈ 35°\)/);
  assertMatch(bloc, /Forte \(≈ 45°\)/);
  assertMatch(bloc, /Dans la longueur de la maison/);
  assertMatch(t[2]!.texte, /hauteur à l’égout/);
});

Deno.test('X7-2 : réponses confirmées → projet_extension (pente, faîtage, égout, clôture, menuiseries, baie) ; contrat valide', () => {
  const t = jouer([...DEBUT,
    'Dimensions (largeur × profondeur) : 5 × 4 m · Hauteur de l’extension : Plain-pied · Pente du toit de la maison : Moyenne (≈ 35°) · Sens du faîtage : Dans la longueur de la maison · Hauteur à l’égout de la maison : 5,2 m',
    'Surface de plancher existante : Je ne sais pas · Demandeur : Particulier · Clôture sur rue : ≈ 1,5 m · Menuiseries de l’extension : Blanc · Baie vitrée : Avec baie vitrée',
  ]);
  const fin = t[4]!;
  assertEquals(fin.etape, 'termine');
  const e = existant(fin);
  assertEquals(e.penteToitDeg!.valeur, 35);
  assertEquals(e.penteToitDeg!.statut, 'confirmee');
  assertEquals(e.orientationFaitage, { valeur: 'grand-axe', statut: 'confirmee', source: e.orientationFaitage!.source });
  assertEquals(e.hauteurEgoutM!.valeur, 5.2);
  assertEquals(e.hauteurEgoutM!.statut, 'confirmee');
  assertEquals(fin.projet!.clotureRue!.hauteurM!.valeur, 1.5);
  assertEquals(fin.projet!.clotureRue!.presence.valeur, true);
  assertEquals(fin.projet!.extension!.habillage!.menuiserie!.valeur, 'av-aluminium-blanc');
  assertEquals(fin.projet!.extension!.habillage!.baies!.valeur, 'auto');
  assert(lireProjetExtension(JSON.parse(JSON.stringify(fin.projet))).ok);
  assert(MENUISERIES_CONTRAT.includes(fin.projet!.extension!.habillage!.menuiserie!.valeur));
});

Deno.test('X7-3 : « je ne sais pas » ou question laissée sans réponse → valeurs ESTIMÉES (jamais confirmées), pas de clôture ni d’habillage inventés', () => {
  const t = jouer([...DEBUT,
    'Dimensions (largeur × profondeur) : 5 × 4 m · Hauteur de l’extension : Plain-pied · Pente du toit de la maison : Je ne sais pas',
    'Surface de plancher existante : Je ne sais pas · Demandeur : Particulier',
  ]);
  const fin = t[4]!;
  assertEquals(fin.etape, 'termine');
  const e = existant(fin);
  assert(e.penteToitDeg!.statut !== 'confirmee');
  assertEquals(e.orientationFaitage, undefined);
  assert(e.hauteurEgoutM!.statut !== 'confirmee');
  assertEquals(fin.projet!.clotureRue, undefined);
  assertEquals(fin.projet!.extension!.habillage, undefined);
  assertEquals(fin.etat.penteToit, 'inconnue');
  assertEquals(fin.etat.faitage, 'inconnu');
  assertEquals(fin.etat.egoutInconnu, true);
  assertEquals(fin.etat.cloture, 'inconnue');
});

Deno.test('X7-4 : toit plat → ni pente ni faîtage demandés ; clôture « aucune », bois, sans baie', () => {
  const t = jouer(['agrandir ma maison', 'Maison existante : Conserver la maison', 'Toit de la maison : Toit plat · Niveaux de la maison : R+1 · Type d’extension : Arrière · Façade (vue de la rue) : À l’arrière',
    'Dimensions (largeur × profondeur) : 5 × 4 m · Hauteur de l’extension : Plain-pied · Hauteur à l’égout de la maison : Je ne sais pas (estimation)',
    'Surface de plancher existante : Je ne sais pas · Demandeur : Particulier · Clôture sur rue : Aucune clôture · Menuiseries de l’extension : Bois · Baie vitrée : Sans baie (murs pleins)']);
  assert(!t[2]!.attendues.includes(Q.penteToit.id));
  assert(!t[2]!.attendues.includes(Q.faitage.id));
  const fin = t[4]!;
  assertEquals(fin.projet!.clotureRue!.presence.valeur, false);
  assertEquals(fin.projet!.clotureRue!.hauteurM, undefined);
  assertEquals(fin.projet!.extension!.habillage!.menuiserie!.valeur, 'av-chene-porte');
  assertEquals(fin.projet!.extension!.habillage!.baies!.valeur, 'aucune');
  assertEquals(existant(fin).penteToitDeg, undefined);
});

Deno.test('X7-5 : « Plus de 2 m » → présence seule (hauteur non chiffrée) ; égout écrit en texte libre lu', () => {
  const t = jouer([...DEBUT, 'Dimensions (largeur × profondeur) : 5 × 4 m · Hauteur de l’extension : Plain-pied · égout 6,1 m',
    'Surface de plancher existante : Je ne sais pas · Demandeur : Particulier · Clôture sur rue : Plus de 2 m']);
  const fin = t[4]!;
  assertEquals(fin.projet!.clotureRue!.presence.valeur, true);
  assertEquals(fin.projet!.clotureRue!.hauteurM, undefined);
  assertEquals(existant(fin).hauteurEgoutM!.valeur, 6.1);
  assertEquals(existant(fin).hauteurEgoutM!.statut, 'confirmee');
});

Deno.test('X7-6 : état stocké antérieur (sans les clés X7) relu sans erreur ; valeurs hors bornes ignorées', () => {
  const e = lireEtat({ v: 1, conserver: true, toit: 'deux-pans' });
  assertEquals(e.penteToit, null);
  assertEquals(e.cloture, null);
  assertEquals(lireEtat({ v: 1, penteToit: 89, cloture: 9, menuiserie: 'av-or' }).penteToit, null);
  assertEquals(lireEtat({ v: 1, cloture: 9 }).cloture, null);
  assertEquals(lireEtat({ v: 1, menuiserie: 'av-or' }).menuiserie, null);
});
