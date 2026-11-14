// supabase/functions/copilot-chat/agent/extension-maison.test.ts
// LOT X3 (14/11/2026) — extensions de maison côté site : détection, lecture des réponses, estimation (X1), moteur (X2),
// régime indicatif DP / PC et architecte (F36777, F20568), fiche `projet_extension` (contrat X0), outil complet.
// Données RÉELLES : src/spaces/copilot/studio3d/__fixtures__/extension-x3-reel.json (BD TOPO des essais du 11–12/11,
// contours cadastraux, conception P0646 lue en production en lecture seule).
import * as na from 'node:assert/strict';
const assert = (v: unknown, m?: string) => na.ok(v, m);
const assertEquals = (a: unknown, b: unknown, m?: string) => na.deepStrictEqual(a, b, m);
const assertMatch = (t: string, r: RegExp) => na.match(t, r);
const assertNotMatch = (t: string, r: RegExp) => na.doesNotMatch(t, r);
import { lambert93VersWgs84, wgs84VersLambert93 } from '../../_shared/extension/lambert93.ts';
import {
  anneauParcelle, batimentsSurParcelle, contourEnLambert93, entreeExistant, lireBatimentsWfs, origineParcelle, urlBatimentsParcelle,
  type BatimentBdTopo,
} from '../../_shared/extension/bdtopoParcelle.ts';
import { estimerMaisonExistante } from '../../_shared/extension/maisonExistante.ts';
import { lireProjetExtension, optionTravailExistant } from '../../_shared/extension/contrat.ts';
import { regimeIndicatif, regimeSelonZone, type EntreeRegime } from '../../_shared/extension/reglementation.ts';
import {
  avancerParcours, detecterIntentionExtension, ETAT_INITIAL, lireReponses, reponseAuParcours, sourceLisible, suiteDuParcours,
  type ContexteParcours, type EtatParcours, type SortieParcours,
} from '../../_shared/extension/parcours.ts';
import {
  etatPrecedent, executerOutilExtension, ficheAvecProjetExtension, lireBdnb, MESSAGE_RENDU_EXTENSION_FERME, RENDU_EXTENSION_OUVERT, lireZonage, optionsAvecExistant, projetDesSorties, reglesDeLaConception,
  urlBdnbParcelle, urlCadastre, type DepotExtension,
} from './extension.ts';
import { facadesVoieDeLaParcelle } from './voisines-parcelle.ts';

const FX = JSON.parse(Deno.readTextFileSync(new URL('../../../../src/spaces/copilot/studio3d/__fixtures__/extension-x3-reel.json', import.meta.url)));
type SiteFx = { idu: string; contourWgs84: [number, number][]; surParcelle: string[]; batiments: BatimentBdTopo[] };
const site = (idu: string): SiteFx => FX.bdtopo.sites.find((s: SiteFx) => s.idu === idu);
const P0646 = 'BATIMENT0000000312986202';
const C = FX.conceptionP0646;

function contexte(idu: string, extra: Partial<ContexteParcours> = {}): ContexteParcours {
  const s = site(idu);
  const conception = idu === '930470000P0646' ? C : null;
  const fac = conception ? facadesVoieDeLaParcelle(conception.parcelle) : { facades: FX.sites[idu].facadesVoie.map((f: [number, number][]) => ({ debut: f[0], fin: f[1] })), raison: null };
  return {
    idu, commune: 'Montfermeil', contourWgs84: s.contourWgs84, surfaceParcelleM2: conception?.parcelle.surface_m2 ?? null,
    batiments: s.batiments, raisonBdTopo: null, dateBdTopo: '2026-11-12', bdnb: null, noteBdnb: null,
    zoneU: { valeur: null, source: 'zonage non lu (test)' }, regles: conception ? reglesDeLaConception(conception.regles_plu) : [],
    facadesVoie: fac.facades.map((f: { debut: [number, number]; fin: [number, number] }) => ({ debut: f.debut, fin: f.fin })), raisonFacades: fac.raison,
    ...extra,
  };
}

/** Rejoue un parcours : chaque message utilisateur fait un tour (état + questions du tour précédent). */
function jouer(ctx: ContexteParcours, messages: string[]): SortieParcours[] {
  const out: SortieParcours[] = [];
  let etat: EtatParcours = ETAT_INITIAL;
  let attendues: readonly string[] = [];
  for (const m of messages) {
    const s = avancerParcours(etat, m, attendues, ctx);
    out.push(s);
    etat = s.etat; attendues = s.attendues;
  }
  return out;
}

const OUTILS_INTERNES = /\b(?:get_[a-z_]+|extension_maison|studio_[a-z_]+|lire_regles_plu_importees)\b/;

// ── Lambert-93 et BD TOPO ──────────────────────────────────────────────────────────────────────────────────
Deno.test('X3-1 : Lambert-93 aller-retour < 1 mm ; bâtiments BD TOPO réels retrouvés sur leur parcelle (≥ 50 % de l’emprise, règle du Studio)', () => {
  for (const [lon, lat] of [[2.5501, 48.8915], [-1.55, 47.21], [7.75, 48.58], [2.3488, 48.8534]]) {
    const [x, y] = wgs84VersLambert93(lon, lat);
    const [lo, la] = lambert93VersWgs84(x, y);
    assert(Math.abs(lo - lon) < 1e-8 && Math.abs(la - lat) < 1e-8, `${lon},${lat}`);
  }
  for (const s of FX.bdtopo.sites as SiteFx[]) {
    const ids = batimentsSurParcelle(s.batiments, contourEnLambert93(s.contourWgs84)).map((b) => b.id).sort();
    assertEquals(ids, [...s.surParcelle].sort(), s.idu);
  }
  const url = urlBatimentsParcelle(contourEnLambert93(site('930470000P0646').contourWgs84));
  assertMatch(url, /^https:\/\/data\.geopf\.fr\/wfs\/ows\?SERVICE=WFS&VERSION=2\.0\.0&REQUEST=GetFeature&TYPENAMES=BDTOPO_V3%3Abatiment&OUTPUTFORMAT=application%2Fjson&SRSNAME=EPSG%3A2154&BBOX=/);
});

Deno.test('X3-2 : lecture WFS (GeoJSON Lambert-93) — attributs, hors service écartés, multi-parties nommées', () => {
  const fc = { features: [
    { id: 'batiment.1', properties: { cleabs: 'BATIMENT1', hauteur: 5, nombre_d_etages: 2, altitude_minimale_sol: 100, altitude_minimale_toit: 105, altitude_maximale_toit: null, usage_1: 'Résidentiel', nature: 'Indifférenciée', construction_legere: false, etat_de_l_objet: 'En service' },
      geometry: { type: 'MultiPolygon', coordinates: [[[[0, 0], [10, 0], [10, 8], [0, 8], [0, 0]]], [[[20, 0], [22, 0], [22, 2], [20, 0]]]] } },
    { properties: { cleabs: 'BATIMENT2', etat_de_l_objet: 'En projet' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
    { properties: {}, geometry: null },
  ] };
  const r = lireBatimentsWfs(fc);
  assertEquals(r.batiments.map((b) => b.id), ['BATIMENT1:1', 'BATIMENT1:2']);
  assertEquals(r.batiments[0]!.anneaux[0]!.length, 4);
  assertEquals([r.batiments[0]!.hauteurM, r.batiments[0]!.etages, r.batiments[0]!.altitudeToitMaxM, r.batiments[0]!.legere], [5, 2, null, false]);
  assertEquals(r.avertissements.length, 2);
});

Deno.test('X3-3 : estimation de la maison P0646 identique au Studio (X1 : 183 m², 156–211, égout 5 m mesuré, 2 pans SUPPOSÉ)', () => {
  const s = site('930470000P0646');
  const l93 = contourEnLambert93(s.contourWgs84);
  const b = s.batiments.find((x) => x.id === P0646)!;
  const m = estimerMaisonExistante(entreeExistant(b, origineParcelle(l93)));
  assertEquals([m.surfacePlancher.valeur, m.surfacePlancher.minM2, m.surfacePlancher.maxM2, m.surfacePlancher.statut], [183, 156, 211, 'estimee']);
  assertEquals([m.hauteurEgout.valeur, m.hauteurEgout.statut], [5, 'mesuree']);
  assertEquals([m.toit.forme.valeur, m.toit.forme.statut, m.niveaux.valeur], ['deux-pans', 'supposee', 2]);
  assertEquals(Math.round(m.empriseM2), 104);
});

// ── Détection et lecture des réponses ─────────────────────────────────────────────────────────────────────
Deno.test('X3-4 : détection d’une demande d’extension (et pas d’un « délai d’extension »)', () => {
  for (const t of ['Je voudrais agrandir ma maison', 'extension de ma maison de 20 m²', 'Peut-on faire une surélévation ?', 'je veux construire un garage accolé à la maison',
    'Agrandissement côté jardin de mon pavillon', 'une extension à l’arrière de la maison', 'surélever la maison d’un étage']) {
    assert(detecterIntentionExtension(t).extension, t);
  }
  for (const t of ['prolongation : extension de délai du permis', 'installe une extension Chrome', 'trouve-moi des terrains à Nanterre', 'quel est le prix au m² à Montreuil ?', 'extension du PLU']) {
    assertEquals(detecterIntentionExtension(t).extension, false, t);
  }
  assert(suiteDuParcours('Texte\n```mimmoza-choix\n{"v":1,"questions":[{"id":"x3_toit","libelle":"Toit de la maison","options":["2 pans","4 pans"]}]}\n```'));
  assertEquals(suiteDuParcours('```mimmoza-choix\n{"v":1,"questions":[{"id":"programme","libelle":"P","options":["a","b"]}]}\n```'), false);
  assert(reponseAuParcours('Toit de la maison : 2 pans · Niveaux de la maison : R+1'));
  assert(reponseAuParcours('5 x 4 m'));
  assertEquals(reponseAuParcours('au fait, et le marché immobilier ?'), false);
});

Deno.test('X3-5 : lecture déterministe des réponses (puces et texte libre) — rien d’inventé', () => {
  let e = lireReponses(ETAT_INITIAL, 'Maison existante : Conserver la maison');
  assertEquals(e.conserver, true);
  e = lireReponses(e, 'Toit de la maison : 4 pans · Niveaux de la maison : Plain-pied · Type d’extension : Surélévation · Façade (vue de la rue) : À l’arrière\nhauteur à l’égout 3,2 m');
  assertEquals([e.toit, e.niveaux, e.type, e.facade, e.hauteurEgoutM], ['quatre-pans', 1, 'surelevation', 'arriere', 3.2]);
  e = lireReponses(e, 'Dimensions (largeur × profondeur) : 4,5 × 6 m');
  assertEquals([e.largeurM, e.profondeurM], [4.5, 6]);
  e = lireReponses(e, 'Surface de plancher existante : Je l’indique · 118 m² · Demandeur : Société (personne morale)', ['x3_surface', 'x3_demandeur']);
  assertEquals([e.sdpExistanteM2, e.sdpInconnue, e.demandeur], [118, false, 'personne-morale']);
  e = lireReponses(e, 'Surface de plancher existante : Je ne sais pas');
  assertEquals([e.sdpExistanteM2, e.sdpInconnue], [null, true]);
  // Un nombre isolé n'est lu comme surface existante QUE si c'était la question posée.
  assertEquals(lireReponses(ETAT_INITIAL, 'elle fait 95 m²', []).sdpExistanteM2, null);
  assertEquals(lireReponses(ETAT_INITIAL, 'elle fait 95 m²', ['x3_surface']).sdpExistanteM2, 95);
  // Rien dans le message : état inchangé.
  assertEquals(lireReponses(e, 'merci'), e);
});

// ── Régime indicatif (F36777 / F20568) : cas limites ──────────────────────────────────────────────────────
const R = (creeeEmp: number | null, creeeSdp: number | null, ex: number | null, statut: 'confirmee' | 'estimee' | null, zoneU: boolean | null, demandeur: EntreeRegime['demandeur'] = 'particulier', fourchette = 0) =>
  regimeIndicatif({ creee: { empriseM2: creeeEmp, sdpM2: creeeSdp, sdpMinM2: creeeSdp === null ? null : creeeSdp * (1 - fourchette), sdpMaxM2: creeeSdp === null ? null : creeeSdp * (1 + fourchette) },
    existant: { sdpM2: ex, statut, minM2: ex === null ? null : ex * 0.85, maxM2: ex === null ? null : ex * 1.15 }, zoneU: { valeur: zoneU, source: 'test' }, demandeur });

Deno.test('X3-6 : seuils 20 / 40 m² selon la zone U (F36777)', () => {
  assertEquals(regimeSelonZone(20, false, 100), 'DP');
  assertEquals(regimeSelonZone(20.1, false, 100), 'PC');
  assertEquals(regimeSelonZone(40, true, 100), 'DP');
  assertEquals(regimeSelonZone(40.1, true, 100), 'PC');
  assertEquals(regimeSelonZone(20, true, 200), 'DP');      // 20 m² pile : pas « plus de 20 »
  assertEquals(regimeSelonZone(25, true, 150), 'DP');      // total 150 pile : pas « au-delà de 150 »
  assertEquals(regimeSelonZone(25, true, 150.1), 'PC');
  assertEquals(regimeSelonZone(5, true, 400), 'DP');
});

Deno.test('X3-7 : architecte — DP jamais ; particulier 150 m² sur surface SAISIE seulement ; personne morale toujours en PC (F20568)', () => {
  // DP (zone U, 30 m², total 130 m² saisi) : pas d'architecte, ferme.
  let r = R(30, 26, 104, 'confirmee', true);
  assertEquals([r.regime, r.architecte, r.ferme], ['DP', 'non-obligatoire', true]);
  // Zone U, 30 m² créés, total saisi 120 + 26 = 146 ≤ 150 : DP.
  // Zone U, 30 m² créés et existant saisi 140 m² → 166 > 150 → PC, architecte obligatoire (particulier).
  r = R(30, 26, 140, 'confirmee', true);
  assertEquals([r.regime, r.architecte, r.ferme], ['PC', 'obligatoire', true]);
  // Même cas avec un existant ESTIMÉ à 140 m² : jamais d'alerte ferme.
  r = R(30, 26, 140, 'estimee', true);
  assertEquals(r.ferme, false);
  assertEquals(r.architecte, 'a-confirmer');
  assert(r.lignes.some((l) => /ESTIMÉE/.test(l)));
  // > 40 m² en zone U : PC ; particulier sous 150 m² après travaux (saisi) : pas d'architecte, mention « sans architecte ».
  r = R(45, 40, 90, 'confirmee', true);
  assertEquals([r.regime, r.architecte], ['PC', 'non-obligatoire']);
  assert(r.lignes.some((l) => /sans architecte/.test(l)));
  // Existant déjà > 150 m² AVANT travaux (saisi) : architecte obligatoire en PC.
  r = R(45, 40, 160, 'confirmee', true);
  assertEquals(r.architecte, 'obligatoire');
  // Personne morale : PC → architecte obligatoire, même petite surface ; DP → non obligatoire.
  r = R(45, 40, 60, 'confirmee', true, 'personne-morale');
  assertEquals([r.regime, r.architecte, r.ferme], ['PC', 'obligatoire', true]);
  r = R(15, 12, 60, 'confirmee', true, 'personne-morale');
  assertEquals([r.regime, r.architecte], ['DP', 'non-obligatoire']);
  // Hors zone U : 25 m² → PC.
  assertEquals(R(25, 21, 60, 'confirmee', false).regime, 'PC');
  // Zone inconnue : 30 m² → DP en zone U, PC hors zone U → « DP ou PC ».
  assertEquals(R(30, 26, 60, 'confirmee', null).regime, 'DP ou PC');
  // Surface créée inconnue.
  assertEquals(R(null, null, 60, 'confirmee', true).regime, 'inconnu');
  // Fourchette de surface créée qui enjambe 40 m² : verdict « DP ou PC ».
  assertEquals(R(0, 38, 60, 'confirmee', true, 'particulier', 0.15).regime, 'DP ou PC');
  // Sources et mention toujours présentes.
  assert(r.sources.some((s) => /F36777/.test(s.url)) && r.sources.some((s) => /f20568/.test(s.url)));
  assertMatch(r.mention, /à vérifier auprès du service urbanisme de la mairie/);
});

// ── Parcours complet sur la maison réelle P0646 ───────────────────────────────────────────────────────────
Deno.test('X3-8 : parcours P0646 — arrière 5 × 4 m, plain-pied : moteur OK (16,8 m² estimés), DP, sans architecte, fiche valide', () => {
  const t = jouer(contexte('930470000P0646'), [
    'Je voudrais agrandir ma maison',
    'Maison existante : Conserver la maison',
    'Toit de la maison : 2 pans · Niveaux de la maison : R+1 · Type d’extension : Arrière · Façade (vue de la rue) : À l’arrière',
    'Dimensions (largeur × profondeur) : 5 × 4 m · Hauteur de l’extension : Plain-pied',
    'Surface de plancher existante : Je l’indique · 118 m² · Demandeur : Particulier',
  ]);
  assertEquals(t.map((s) => s.etape), ['conserver', 'confirmer', 'dimensions', 'surface', 'termine']);
  // Tour 2 : estimation affichée avec statuts, suggestion = estimation (jamais présélectionnée).
  assertMatch(t[1]!.texte, /SUPPOSÉE/);
  assertMatch(t[1]!.blocChoix!, /"id":"x3_toit".*"defaut":"2 pans"/);
  assertMatch(t[1]!.blocChoix!, /"id":"x3_niveaux".*"defaut":"R\+1"/);
  const fin = t[4]!;
  assertEquals(fin.blocChoix, null);
  assertEquals(fin.vue.extension!.verdict, 'ok');
  assertEquals(fin.vue.extension!.sdpCreee!.valeur, 16.8);
  assertEquals(fin.vue.extension!.empriseCreeeM2, 20);
  assertEquals([fin.regime!.regime, fin.regime!.architecte, fin.regime!.ferme], ['DP', 'non-obligatoire', true]);
  // Fiche : contrat X0 relu tel quel, maison CONSERVÉE avec corrections confirmées, reculs PLU ESTIMÉS dits « SUPPOSÉS ».
  const lu = lireProjetExtension(JSON.parse(JSON.stringify(fin.projet)));
  assert(lu.ok);
  const p = fin.projet!;
  assertEquals([p.nature, p.existants[0]!.mode, p.existants[0]!.id], ['extension', 'conserver', P0646]);
  assertEquals([p.existants[0]!.formeToit!.statut, p.existants[0]!.niveaux!.statut, p.existants[0]!.surfacePlancherM2!.valeur, p.existants[0]!.surfacePlancherM2!.statut], ['confirmee', 'confirmee', 118, 'confirmee']);
  assertEquals(p.existants[0]!.hauteurEgoutM!.statut, 'mesuree');
  assertEquals([p.extension!.type, p.extension!.facade!.cote, p.extension!.dimensions.largeurM!.valeur, p.extension!.dimensions.profondeurM!.valeur], ['arriere', 'arriere', 5, 4]);
  assertEquals(p.extension!.reculs!.voieM!.statut, 'supposee');
  assertMatch(p.extension!.reculs!.voieM!.source, /ESTIMÉ, non lu dans le règlement/);
  assertEquals(p.demandeur, 'particulier');
  assertEquals(fin.optionTravail, { existant: 'conserver' });
  assertEquals(optionTravailExistant(p), 'conserver');
  // Aucun nom d'outil interne visible, aucune règle estimée présentée comme lue.
  for (const s of t) assertNotMatch(s.texte + JSON.stringify(s.vue), OUTILS_INTERNES);
  assertNotMatch(fin.texte, /lu dans le règlement \(à vérifier\)/);
});

Deno.test('X3-9 : P0646 latérale droite 6 × 4 — REFUS expliqué (RNU SUPPOSÉ 1,69 m < 3 m) ; surface inconnue : architecte « à confirmer »', () => {
  const t = jouer(contexte('930470000P0646', { zoneU: { valeur: true, source: 'zone UC (test)' } }), [
    'Je veux une extension de ma maison',
    'Maison existante : Conserver la maison',
    'Toit de la maison : 2 pans · Niveaux de la maison : R+1 · Type d’extension : Latérale · Façade (vue de la rue) : À droite',
    'Dimensions (largeur × profondeur) : 6 × 4 m · Hauteur de l’extension : Plain-pied',
    'Surface de plancher existante : Je ne sais pas · Demandeur : Particulier',
  ]);
  const fin = t[4]!;
  assertEquals(fin.etape, 'termine');
  assertEquals(fin.vue.extension!.verdict, 'refus');
  assertMatch(fin.vue.extension!.refus.join(' '), /1,69 m < 3,00 m.*R\.111-17 SUPPOSÉ/);
  assertMatch(fin.texte, /\*\*refuse\*\*/);
  // Surface existante non connue : l'estimation (183 m²) n'entraîne aucune alerte ferme.
  assertEquals(fin.regime!.ferme, fin.regime!.regime === 'DP');
  assert(fin.projet !== null, 'le projet reste transmissible (le moteur du Studio refusera et le dira)');
  assertEquals(fin.projet!.existants[0]!.surfacePlancherM2!.statut, 'estimee');
  assertMatch(fin.projet!.existants[0]!.surfacePlancherM2!.source, /surface réelle non communiquée/);
});

Deno.test('X3-10 : P0646 surélévation d’un niveau — toit CONFIRMÉ par le parcours ; 10,31 m refusés par la hauteur ESTIMÉE de 9 m ; sans règle : OK (≈ 82,4 m²) ; PC, architecte obligatoire (118 m² saisis)', () => {
  const messages = [
    'surélever ma maison',
    'Maison existante : Conserver la maison',
    'Toit de la maison : 2 pans · Niveaux de la maison : R+1 · Type d’extension : Surélévation',
    'Niveaux ajoutés : 1 niveau',
    'Surface de plancher existante : 118 m² · Demandeur : Particulier',
  ];
  const avecRegles = jouer(contexte('930470000P0646', { zoneU: { valeur: true, source: 'zone UC (test)' } }), messages)[4]!;
  assertEquals(avecRegles.vue.extension!.verdict, 'refus');
  assertMatch(avecRegles.vue.extension!.refus.join(' '), /Hauteur 10,31 m > hauteur maximale 9,00 m \(PLU ESTIMÉ, non lu dans le règlement/);
  const t = jouer(contexte('930470000P0646', { zoneU: { valeur: true, source: 'zone UC (test)' }, regles: [] }), [
    'surélever ma maison',
    'Maison existante : Conserver la maison',
    'Toit de la maison : 2 pans · Niveaux de la maison : R+1 · Type d’extension : Surélévation',
    'Niveaux ajoutés : 1 niveau',
    'Surface de plancher existante : 118 m² · Demandeur : Particulier',
  ]);
  assertEquals(t.map((s) => s.etape), ['conserver', 'confirmer', 'dimensions', 'surface', 'termine']);
  const fin = t[4]!;
  assertEquals(fin.vue.extension!.verdict, 'ok');
  assertEquals(fin.vue.extension!.sdpCreee!.valeur, 82.4);
  assertEquals([fin.regime!.regime, fin.regime!.architecte, fin.regime!.ferme], ['PC', 'obligatoire', true]);
  assertEquals(fin.projet!.extension!.facade, undefined);
});

Deno.test('X3-11 : démolir → parcours arrêté (projet neuf) ; véranda refusée proprement ; parcelle sans bâtiment', () => {
  const t = jouer(contexte('930470000P0646'), ['agrandir ma maison', 'Maison existante : Démolir (projet neuf)']);
  assertEquals(t[1]!.etape, 'neuf');
  assertEquals(t[1]!.projet, null);
  const v = jouer(contexte('930470000P0646'), ['agrandir ma maison', 'Maison existante : Conserver la maison', 'Toit de la maison : 2 pans · Niveaux de la maison : R+1 · Type d’extension : Véranda (bientôt) · Façade (vue de la rue) : À l’arrière']);
  assertEquals(v[2]!.etape, 'type');
  assert(v[2]!.vue.avertissements.some((a) => /Véranda/.test(a)));
  const vide = avancerParcours(ETAT_INITIAL, 'agrandir ma maison', [], contexte('930470000P0646', { batiments: [] }));
  assertEquals(vide.etape, 'aucun_batiment');
  const hs = avancerParcours(ETAT_INITIAL, 'agrandir ma maison', [], contexte('930470000P0646', { batiments: null, raisonBdTopo: 'HTTP 503' }));
  assertEquals(hs.etape, 'sans_bdtopo');
  assertMatch(hs.texte, /HTTP 503/);
});

Deno.test('X3-12 : O0521 — annexes BD TOPO conservées et prises comme obstacles (arrière 5 × 4 refusé : chevauche …204)', () => {
  const t = jouer(contexte('930470000O0521'), [
    'agrandir ma maison', 'Maison existante : Conserver la maison',
    'Toit de la maison : 4 pans · Niveaux de la maison : R+1 · Type d’extension : Arrière · Façade (vue de la rue) : À l’arrière',
    'Dimensions (largeur × profondeur) : 5 × 4 m · Hauteur de l’extension : Plain-pied',
    'Surface de plancher existante : 100 m² · Demandeur : Particulier',
  ]);
  const fin = t[4]!;
  assertEquals(fin.vue.extension!.verdict, 'refus');
  assertMatch(fin.vue.extension!.refus.join(' '), /BATIMENT0000000312986204/);
  assert(fin.vue.avertissements.some((a) => /2 autre\(s\) bâtiment/.test(a)));
});

// ── Contrat X0 (copie) et options ─────────────────────────────────────────────────────────────────────────
Deno.test('X3-13 : contrat X0 — copie VERBATIM du Studio (empreinte), validation identique, refus du mode « partiel »', async () => {
  const brut = await Deno.readTextFile(new URL('../../_shared/extension/contrat.ts', import.meta.url));
  const m = /sha256 du fichier source : ([0-9a-f]{64})/.exec(brut)!;
  const corps = brut.slice(brut.indexOf('// ----- DÉBUT DE LA COPIE -----\n') + '// ----- DÉBUT DE LA COPIE -----\n'.length);
  const h = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(corps)))).map((b) => b.toString(16).padStart(2, '0')).join('');
  assertEquals(h, m[1]);
  assertEquals(lireProjetExtension(undefined).ok, true);
  const partiel = lireProjetExtension({ format: 'mimmoza-projet-extension', version: 1, nature: 'extension', existants: [{ id: 'B1', source: 'bdtopo', mode: 'partiel' }],
    extension: { type: 'arriere', facade: { cote: 'arriere' }, existantId: 'B1', dimensions: {} } });
  assertEquals(partiel.ok, false);
  const inconnue = lireProjetExtension({ format: 'mimmoza-projet-extension', version: 1, nature: 'neuf', existants: [], bidule: 1 });
  assertEquals(inconnue.ok, false);
});

Deno.test('X3-14 : option de travail — « existant : conserver » refusé avec une zone à effacer (masque_existant) ; fiche complétée ; rendu fermé', () => {
  const p = jouer(contexte('930470000P0646'), ['agrandir ma maison', 'Maison existante : Conserver la maison',
    'Toit de la maison : 2 pans · Niveaux de la maison : R+1 · Type d’extension : Arrière · Façade (vue de la rue) : À l’arrière',
    'Dimensions (largeur × profondeur) : 5 × 4 m · Hauteur de l’extension : Plain-pied', 'Surface de plancher existante : Je ne sais pas · Demandeur : Particulier'])[4]!.projet!;
  const f = ficheAvecProjetExtension({ version: 1, charge: { x: 1 }, habillage_batiments: null }, p);
  assertEquals(f.projet_extension, p);
  assertEquals(f.charge, { x: 1 });
  assert(lireProjetExtension(f.projet_extension).ok);
  assertEquals(RENDU_EXTENSION_OUVERT, false);
  assertMatch(MESSAGE_RENDU_EXTENSION_FERME, /RIEN N’A ÉTÉ LANCÉ/);
  assertEquals(optionsAvecExistant({ vues: ['face'] }, 'conserver'), { ok: true, valeur: { vues: ['face'], existant: 'conserver' } });
  const r = optionsAvecExistant({ fond: 'photo_rue', masque_existant: { chemin: 'a/b.png', octets: 1 } }, 'conserver');
  assertEquals(r.ok, false);
  assertEquals(optionsAvecExistant({ masque_existant: { chemin: 'a/b.png', octets: 1 } }, 'effacer').ok, true);
});

Deno.test('X3-15 : sources externes — BDNB (un seul groupe), zonage GPU (U / AU / aucun), cadastre, sources lisibles', () => {
  assertEquals(lireBdnb([{ batiment_groupe_id: 'bdnb-bg-1', nb_niveau: 2, hauteur_mean: 6.1, surface_emprise_sol: 101, mat_toit_txt: 'TUILES', annee_construction: 1962 }]).bdnb,
    { batimentGroupeId: 'bdnb-bg-1', nbNiveaux: 2, hauteurMoyenneM: 6.1, empriseSolM2: 101, materiauToit: 'TUILES', anneeConstruction: 1962 });
  assertEquals(lireBdnb([{}, {}]).bdnb, null);
  assertMatch(lireBdnb([]).note!, /aucun bâtiment/);
  assertEquals(lireZonage({ features: [{ properties: { typezone: 'U', libelle: 'UC' } }] }).valeur, true);
  assertEquals(lireZonage({ features: [{ properties: { typezone: 'AUc', libelle: '1AU' } }] }).valeur, false);
  assertEquals(lireZonage({ features: [{ properties: { typezone: 'N', libelle: 'N' } }] }).valeur, false);
  assertEquals(lireZonage({ features: [] }).valeur, null);
  assertEquals(urlCadastre('930470000P0646'), 'https://apicarto.ign.fr/api/cadastre/parcelle?code_insee=93047&section=0P&numero=0646');
  assertMatch(urlBdnbParcelle('930470000P0646'), /l_parcelle_id=cs\.%7B930470000P0646%7D/);
  assertEquals(sourceLisible('get_prescriptions_urbanisme GPU'), 'prescriptions du Géoportail de l’urbanisme (GPU)');
  assertNotMatch(sourceLisible('outil interne_truc et get_zonage_plu'), OUTILS_INTERNES);
  assertEquals(anneauParcelle(C.parcelle.geometrie)!.length, 8);
});

// ── Outil complet (dépôt et réseau simulés à partir des données réelles) ──────────────────────────────────
function fauxReseau(idu: string): typeof fetch {
  const s = site(idu);
  const features = s.batiments.map((b) => ({
    type: 'Feature', id: b.id,
    properties: { cleabs: b.id, hauteur: b.hauteurM, nombre_d_etages: b.etages, altitude_minimale_sol: b.altitudeSolM, altitude_minimale_toit: b.altitudeToitMinM,
      altitude_maximale_toit: b.altitudeToitMaxM, usage_1: b.usage, nature: b.nature, construction_legere: b.legere, etat_de_l_objet: 'En service' },
    geometry: { type: 'Polygon', coordinates: b.anneaux.map((a) => [...a, a[0]]) },
  }));
  return ((url: string) => {
    const u = String(url);
    const corps = u.startsWith('https://data.geopf.fr/') ? { type: 'FeatureCollection', features }
      : u.startsWith('https://api.bdnb.io/') ? [{ batiment_groupe_id: 'bdnb-bg-test', nb_niveau: 2 }]
      : u.startsWith('https://apicarto.ign.fr/api/gpu/') ? { features: [{ properties: { typezone: 'U', libelle: 'UC' } }] } : null;
    return Promise.resolve(corps ? new Response(JSON.stringify(corps), { status: 200 }) : new Response('{}', { status: 404 }));
  }) as typeof fetch;
}

Deno.test('X3-16 : outil — état relu d’un tour à l’autre, parcelle de la conception, réponses lues dans le message REÇU', async () => {
  const sorties: Record<string, unknown>[] = [];
  const depot: DepotExtension = {
    conception: async (_u, q) => (q.idu === '930470000P0646' || q.id === 'c-1' ? { id: 'c-1', ...C } : null),
    conceptionDeLaConversation: async () => 'c-1',
    sortiesPrecedentes: async () => [...sorties].reverse(),
  };
  const tour = async (texte: string, input: Record<string, unknown> = {}) => {
    const r = await executerOutilExtension(input, { userId: 'u-1', conversationId: 'conv-1', texteUtilisateur: texte, depot, fetch: fauxReseau('930470000P0646'), maintenant: () => Date.parse('2026-11-14T10:00:00Z') });
    if (r.status === 'ok') sorties.push(r.data!);
    return r;
  };
  const r1 = await tour('je voudrais agrandir ma maison');
  assertEquals(r1.status, 'ok');
  assertEquals(r1.data!.etape, 'conserver');
  assertMatch(String(r1.data!.texte_affiche), /104 m²/);
  // Le modèle ne fournit rien : un paramètre fantaisiste est ignoré, les réponses viennent du texte reçu.
  await tour('Maison existante : Conserver la maison', { largeur: 99 });
  await tour('Toit de la maison : 2 pans · Niveaux de la maison : R+1 · Type d’extension : Arrière · Façade (vue de la rue) : À l’arrière');
  await tour('Dimensions (largeur × profondeur) : 5 × 4 m · Hauteur de l’extension : Plain-pied');
  const r5 = await tour('Surface de plancher existante : 118 m² · Demandeur : Particulier');
  assertEquals(r5.data!.etape, 'termine');
  const vue = r5.data!.vue as { regime: { libelle: string }; maison: { lignes: { libelle: string; source: string }[] } };
  assertMatch(vue.regime.libelle, /Déclaration préalable/);
  // BDNB transmise (niveaux) dans la fiche ; zone U lue au GPU.
  const projet = projetDesSorties([...sorties].reverse());
  assert(projet);
  assertEquals(projet!.projet.existants[0]!.bdnb, { batimentGroupeId: 'bdnb-bg-test', nbNiveaux: 2 });
  assertEquals(projet!.existant, 'conserver');
  assertEquals(etatPrecedent([...sorties].reverse()).etat.sdpExistanteM2, 118);
  assertNotMatch(JSON.stringify(r5), /\bget_[a-z_]+\b/);
  // Sans parcelle connue : une seule question, rien d'estimé.
  const vide = await executerOutilExtension({}, { userId: 'u-1', conversationId: 'conv-2', texteUtilisateur: 'agrandir ma maison', depot: { conception: async () => null, sortiesPrecedentes: async () => [] }, fetch: fauxReseau('930470000P0646') });
  assertEquals(vide.status, 'partial');
  assertMatch(vide.message!, /adresse ou la référence cadastrale/);
});

// ── Rendu d'un projet d'extension : fermé tant que la machine de rendu ne sait pas le dessiner (lot X4) ─────
Deno.test('X3-17 : rendu demandé dans une conversation qui porte un projet d’extension → refus dit, rien n’est lancé ; sans projet : devis inchangé', async () => {
  const { executerOutilStudio } = await import('./studio.ts');
  const p = jouer(contexte('930470000P0646'), ['agrandir ma maison', 'Maison existante : Conserver la maison',
    'Toit de la maison : 2 pans · Niveaux de la maison : R+1 · Type d’extension : Arrière · Façade (vue de la rue) : À l’arrière',
    'Dimensions (largeur × profondeur) : 5 × 4 m · Hauteur de l’extension : Plain-pied', 'Surface de plancher existante : 118 m² · Demandeur : Particulier'])[4]!;
  let inserts = 0;
  const depot = (sorties: Record<string, unknown>[]) => ({
    conception: async () => ({ id: '5a1c0e00-0000-4000-8000-0000000000c1', idu: '930470000P0646', commune: null, parcelle: null, regles_plu: [], programme: null }),
    derniereVersion: async () => ({ n: 1, modele_ref: 'modele-1' }),
    enregistrerPreparation: async () => 'p', preparation: async () => null, typeRenduAutorise: async () => true,
    statsFile: async () => null, travauxActifs: async () => 0, travailParDevis: async () => null, jetonsDevis: async () => [],
    questionBriefPosee: async () => true, insererTravail: async () => { inserts += 1; throw new Error('jamais'); }, travail: async () => null,
    positionFile: async () => null, urlSigneeRendu: async () => null,
    sortiesExtension: async () => sorties,
  });
  const envS = (sorties: Record<string, unknown>[]) => ({ userId: 'u-1', depot: depot(sorties) as never, secret: 's', requete: 'r-1', conversationId: 'c-1', origine: 'https://mimmoza.vercel.app' });
  const sortie = { etape: 'termine', projet_extension: p.projet, option_travail: p.optionTravail };
  const r = await executerOutilStudio('studio_lancer_rendu', { type: 'film', brief: { a_toi_de_choisir: true } }, envS([sortie]));
  assertEquals(r?.status, 'partial');
  assertMatch(r!.message!, /RIEN N’A ÉTÉ LANCÉ.*EXTENSION/);
  assertEquals(inserts, 0);
  // Parcours arrêté (« démolir ») ou projet absent : le devis habituel est rendu.
  const neuf = await executerOutilStudio('studio_lancer_rendu', { type: 'film', brief: { a_toi_de_choisir: true } }, envS([{ etape: 'neuf' }]));
  assertEquals(neuf?.status, 'confirmation_requise', neuf?.message);
});
