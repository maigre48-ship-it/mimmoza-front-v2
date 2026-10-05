import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateChatBilan } from './chatBilan.ts';
import { computeProForma, type Assumptions } from './proForma.ts';
import { selectToolNames } from '../copilot-routing/selector.ts';

const input = {
  base_montants: 'HT', recettes_eur: 2_000_000, surface_vendable_m2: 500,
  foncier_eur: 400_000, frais_acquisition_eur: 30_000, travaux_eur: 900_000,
  honoraires_eur: 200_000, assurances_eur: 20_000, taxes_eur: 50_000,
  commercialisation_eur: 40_000, financement_eur: 60_000, aleas_eur: 50_000, autres_couts_eur: 0,
  fonds_propres_eur: 300_000, marge_cible_pct: 20,
};
const calculated = (value: Record<string, unknown>) => {
  const result = calculateChatBilan(value);
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') throw new Error(result.message);
  return result.data;
};

test('bilan complet : chaque poste est compté une fois, marge sur CA et seuil', () => {
  const data = calculated(input);
  assert.equal(data.cout_total_eur, 1_750_000);
  assert.equal(data.resultat_eur, 250_000);
  assert.equal(data.marge_sur_ca_pct, 12.5);
  assert.equal(data.prix_equilibre_m2_eur, 3500);
  assert.equal(data.recettes_pour_marge_cible_eur, 2_187_500);
  assert.equal(data.resultat_sur_fonds_propres_pct, 83.33);
  assert.equal(data.ecart_cible_points, -7.5);
});
test('les stress portent sur ventes et travaux, sans modifier les autres coûts', () => {
  const scenarios = calculated(input).scenarios;
  assert.equal(scenarios[1].resultat_eur, 150_000);
  assert.equal(scenarios[2].resultat_eur, 160_000);
  assert.equal(scenarios[3].resultat_eur, 60_000);
});
test('un coût absent bloque la marge, tandis qu’un zéro déclaré est accepté', () => {
  const result = calculateChatBilan({ ...input, assurances_eur: undefined });
  assert.equal(result.status, 'partial');
  if (result.status !== 'partial') throw new Error('statut');
  assert.deepEqual(result.data.missing, ['Assurances']);
  assert.equal('resultat_eur' in result.data, false);
  assert.equal(calculated({ ...input, assurances_eur: 0 }).resultat_eur, 270_000);
});
test('les montants non numériques, négatifs et infinis sont rejetés', () => {
  for (const bad of ['900000', -1, NaN, Infinity]) assert.equal(calculateChatBilan({ ...input, travaux_eur: bad }).status, 'error');
  assert.equal(calculateChatBilan({ ...input, marge_cible_pct: 100 }).status, 'error');
});
test('la base TVA doit être confirmée et le TTC garde sa réserve', () => {
  assert.equal(calculateChatBilan({ ...input, base_montants: undefined }).status, 'partial');
  const ttc = calculated({ ...input, base_montants: 'TTC' });
  assert.match(ttc.reserves[1], /avant traitement de la TVA/);
  assert.equal(ttc.resultat_eur, 250_000);
});
test('le CA est dérivé d’une surface vendable, les bases contradictoires sont rejetées', () => {
  assert.equal(calculated({ ...input, recettes_eur: undefined, prix_vente_m2_eur: 4000 }).recettes_eur, 2_000_000);
  assert.equal(calculateChatBilan({ ...input, prix_vente_m2_eur: 5000 }).status, 'error');
  assert.equal(calculateChatBilan({ ...input, surface_vendable_m2: 0 }).status, 'error');
});
test('une variante conserve les postes et permet d’afficher une perte sans inventer un TRI', () => {
  const data = calculated({ ...input, recettes_eur: 1_600_000, fonds_propres_eur: 0 });
  assert.equal(data.resultat_eur, -150_000);
  assert.equal(data.marge_sur_ca_pct, -9.38);
  assert.equal('tri_pct' in data, false);
  assert.equal('resultat_sur_fonds_propres_pct' in data, false);
  assert.equal(data.chiffres_entree.foncier_eur, 400_000);
});
test('le moteur extrait conserve les coûts régionaux, honoraires, financement et marge de la page', () => {
  const ass = {
    salePriceEurM2Hab: 5000, commercialisationPct: 100, landPriceEur: 100_000,
    notaryFeesPct: 10, acquisitionTaxesPct: 0, worksCostEurM2Sdp: 2000,
    vrdPct: 6, extPct: 3, contingencyPct: 3, surveyorEur: 1000, geotechEur: 2000,
    moePct: 10, betPct: 3, spsCtOpcEur: 3000, insuranceDoPct: 2, miscEur: 4000,
    marketingPctCa: 2, marketingFixedEur: 1000, financingRatePct: 4, financingFeesEur: 8000,
    taxeAmenagementEurM2Sdp: 10, nbAscenseurs: 0, nbSousSols: 0,
  } as Assumptions;
  const pf = computeProForma(ass, 100, 80, null, 1, 1.1);
  assert.ok(Math.abs(pf.travauxBase - 220_000) < 0.001);
  assert.ok(Math.abs(pf.totalTravaux - 246_400) < 0.001);
  assert.ok(Math.abs(pf.totalEtudes - 43_000) < 0.001);
  assert.ok(Math.abs(pf.totalFin - 17_328) < 0.001);
  assert.ok(Math.abs(pf.coutTotal - 426_728) < 0.001);
  assert.ok(Math.abs(pf.marge + 26_728) < 0.001);
});
test('le calcul reste disponible lors des études de parcelle et des échanges financiers', () => {
  const available = ['calculer_bilan_financier', 'get_parcel_plu', 'get_etude_parcelle', 'get_loyers_reference'];
  for (const text of ['Analyse complète de cette parcelle', 'Calcule le bilan financier et la marge', 'Quelle faisabilité PLU avec la hauteur autorisée ?']) {
    assert.ok(selectToolNames(text, available).toolNames.includes('calculer_bilan_financier'));
  }
});
