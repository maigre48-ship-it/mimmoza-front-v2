import assert from 'node:assert/strict';
import test from 'node:test';
import { extraireReglesDuTexte, lotsReglesDesMessages, memeZone, reglesPourParcelle, type MessageRegles } from './reglesPlu.ts';

const REGLEMENT = `[Page 41] ARTICLE UB 9 – EMPRISE AU SOL L'emprise au sol des constructions ne peut excéder 50 % de la superficie du terrain. Les piscines ne sont pas comptées dans une emprise de 60 %.
[Page 42] ARTICLE UB 10 – HAUTEUR MAXIMALE DES CONSTRUCTIONS La hauteur maximale des constructions est fixée à 15 mètres à l'égout du toit et 18 m au faîtage. Les annexes sont limitées à 3,5 m.
ARTICLE UB 6 – IMPLANTATION PAR RAPPORT AUX VOIES Les constructions doivent être implantées en retrait de 5 m minimum de l'alignement des voies.
[Page 43] ARTICLE UB 7 – IMPLANTATION PAR RAPPORT AUX LIMITES SÉPARATIVES La distance comptée horizontalement de tout point de la construction au point le plus proche de la limite séparative doit être au moins égale à la moitié de la hauteur (L = H/2) sans pouvoir être inférieure à 4 m.
ARTICLE UB 13 – ESPACES LIBRES 30 % au moins de la superficie du terrain doivent être traités en pleine terre.`;

test('texte du règlement : hauteur égout / faîtage, CES, recul voie, H/2 min, pleine terre, avec article et page', () => {
  const { regles, manquantes } = extraireReglesDuTexte(REGLEMENT, 'Règlement PLUi test');
  const par = (cle: string) => regles.filter(r => r.cle === cle);
  assert.deepEqual(par('emprise_max_ratio').map(r => [r.valeur, r.reference]), [[0.5, 'art. UB 9, p. 41']]);
  assert.deepEqual(par('hauteur_max_m').map(r => r.valeur), [15]);
  assert.deepEqual(par('hauteur_faitage_m').map(r => [r.valeur, r.reference]), [[18, 'art. UB 10, p. 42']]);
  assert.deepEqual(par('recul_voie_m').map(r => r.valeur), [5]);
  assert.deepEqual(par('recul_limites_formule').map(r => [r.valeur, r.minimumM, r.reference]), [[2, 4, 'art. UB 7, p. 43']]);
  assert.deepEqual(par('pleine_terre_min_ratio').map(r => r.valeur), [0.3]);
  assert.ok(regles.every(r => r.statut === 'lue' && r.source === 'Règlement PLUi test'));
  assert.deepEqual(manquantes, []);
  // Annexes (3,5 m) et piscines (60 %) écartées.
  assert.ok(!regles.some(r => r.valeur === 3.5 || r.valeur === 0.6));
  assert.equal(extraireReglesDuTexte('[Page 1] Dispositions générales.', 'x').manquantes.length, 5);
});

const appelPlu = (data: unknown, input: unknown = {}, source = 'plu-reglement-v1 — Géoportail de l’urbanisme'): MessageRegles =>
  ({ role: 'assistant', toolCalls: [{ name: 'get_parcel_plu', status: 'success', input, output: { status: 'ok', source, data } }] });

test('formats réels de get_parcel_plu : parser (regles.*), règlement lu (texte), zonage seul', () => {
  const lots = lotsReglesDesMessages([
    appelPlu({ zone_code: 'UBb', regles: { hauteur_max_m: 12, emprise_sol_max_ratio: 0.4, recul_voirie_m: 4, recul_limites_m: 3, pleine_terre_ratio_min: 0.2, cos_max: 1.5 } }, { cadastral_ref: '92050000AN0412' }, 'plu-parser (Mimmoza)'),
    appelPlu({ niveau_de_detail: 'reglement_lu', zone: 'UB', zone_lue: 'UB', document: { type: 'PLU', territoire: 'Nanterre', date_approbation: '2024-03-01' }, reglement_extrait: REGLEMENT }),
    appelPlu({ niveau_de_detail: 'zonage_seul', zone_code: 'UC' }),
  ]);
  assert.equal(lots.length, 3);
  assert.equal(lots[0].niveau, 'importe');
  assert.equal(lots[0].idu, '92050000AN0412');
  assert.deepEqual(lots[0].regles.map(r => r.cle), ['hauteur_max_m', 'emprise_max_ratio', 'recul_voie_m', 'recul_limites_m', 'pleine_terre_min_ratio']);
  assert.ok(lots[0].manquantes.some(m => /COS/.test(m)));
  assert.equal(lots[1].niveau, 'reglement_lu');
  assert.equal(lots[1].origine, 'Règlement PLU Nanterre approuvé le 2024-03-01');
  assert.equal(lots[1].zone, 'UB');
  assert.equal(lots[2].niveau, 'zonage_seul');
  assert.equal(lots[2].regles.length, 0);
});

test('rattachement : règles de la parcelle ou de sa zone appliquées, règles d’une autre zone ignorées', () => {
  assert.ok(memeZone('UBb', 'UB'));
  assert.ok(memeZone('ubb', 'UBB'));
  assert.ok(!memeZone('UBb', 'UC'));
  assert.ok(!memeZone('UB', 'UBb'));
  const lots = lotsReglesDesMessages([
    appelPlu({ zone_code: 'UC', regles: { hauteur_max_m: 21 } }, { cadastral_ref: '920500000N0606' }, 'plu-parser (Mimmoza)'),
    appelPlu({ niveau_de_detail: 'reglement_lu', zone_lue: 'UB', reglement_extrait: REGLEMENT, document: {} }),
  ]);
  const ubb = reglesPourParcelle(lots, { idu: '92050000AN0412', zone: 'UBb' }, false);
  assert.equal(ubb.source, 'plu-chiffre');
  assert.ok(!ubb.regles.some(r => r.valeur === 21), 'règles UC ignorées');
  assert.ok(ubb.regles.some(r => r.cle === 'hauteur_faitage_m' && r.valeur === 18));
  assert.ok(ubb.nonAppliquees.some(l => /zone UC/.test(l)), ubb.nonAppliquees.join('\n'));
  const uc = reglesPourParcelle(lots, { idu: '920500000N0606', zone: 'UC' }, false);
  assert.deepEqual(uc.regles.map(r => r.valeur), [21]);
  assert.ok(uc.nonAppliquees.some(l => /zone UB ignorées/.test(l)));
  // Zone de la parcelle inconnue, plusieurs parcelles en jeu : rien n'est appliqué au hasard.
  const inconnue = reglesPourParcelle(lots.slice(1), { idu: '92050000AT0204', zone: null }, false);
  assert.equal(inconnue.regles.length, 0);
  assert.equal(inconnue.source, 'aucune');
  // Une seule parcelle dans la conversation : le lot sans zone lui est rattaché, en le disant.
  const seule = reglesPourParcelle(lotsReglesDesMessages([appelPlu({ regles: { hauteur_max_m: 9 } }, {}, 'plu-parser')]), { idu: '92050000AN0412', zone: null }, true);
  assert.deepEqual(seule.regles.map(r => r.valeur), [9]);
  assert.ok(seule.nonAppliquees.some(l => /seule parcelle/.test(l)));
});

test('règles de conception (agent) rattachées à la parcelle de recuperer_parcelle', () => {
  const lots = lotsReglesDesMessages([{ role: 'assistant', toolCalls: [
    { name: 'recuperer_parcelle', status: 'success', input: { idu: '92050000AE0376' } },
    { name: 'enregistrer_regles_conception', status: 'success', input: { regles: [
      { cle: 'hauteur_max_m', valeur: 16, statut: 'confirme', source: 'Règlement PLU', article: 'UA 10' },
      { cle: 'emprise_sol_max_pct', valeur: 60, statut: 'estime', source: 'import' },
      { cle: 'recul_limites_formule', valeur: 'H/2 min 3 m', statut: 'estime', source: 'import' },
      { cle: 'mixite_sociale_pct', valeur: 30, statut: 'confirme', source: 'GPU' },
    ] } },
  ] }]);
  const r = reglesPourParcelle(lots, { idu: '92050000AE0376', zone: null }, false);
  assert.deepEqual(r.regles.map(x => [x.cle, x.valeur, x.statut]), [['hauteur_max_m', 16, 'lue'], ['emprise_max_ratio', 0.6, 'estimee'], ['recul_limites_formule', 2, 'estimee']]);
  assert.equal(r.regles[2].minimumM, 3);
  assert.equal(reglesPourParcelle(lots, { idu: '92050000AN0412', zone: null }, false).regles.length, 0);
});
