// src/spaces/promoteur/bilan-promoteur/syntheseBilan.caracterisation.test.ts
// =============================================================================
// Lot B1 « bilan unique » — caractérisation de calculerSyntheseBilan, la
// fonction pure que la page « Bilan promoteur » utilise pour ses totaux
// (pro forma + terrassement + parking). Aucun moteur modifié.
//
// VALEURS D'ESSAI, NON REPRÉSENTATIVES : chiffres ronds arbitraires. Surfaces :
// volume d'étude de la parcelle témoin de Montreuil (SDP 1 134 m², lot C7b) ;
// SHAB = 0,82 × SDP (coefficient du dépôt).
// =============================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculerSyntheseBilan } from './metreStudio.ts';
import { computeFoncierMaxAdmissible, computeProForma, type Assumptions } from '../../../../supabase/functions/_shared/finance/proForma.ts';

const SDP = 1134, SHAB = 929.88, FONCIER = 800_000, TERRASSEMENT = 40_000, PARKING = 60_000;
const ass = (surcharge: Partial<Assumptions> = {}) => ({
  salePriceEurM2Hab: 5000, commercialisationPct: 100, coefVendable: 1, landPriceEur: FONCIER, notaryFeesPct: 8, acquisitionTaxesPct: 0,
  worksCostEurM2Sdp: 2000, vrdPct: 0, extPct: 0, contingencyPct: 5, surveyorEur: 0, geotechEur: 0, moePct: 10, betPct: 0, spsCtOpcEur: 0,
  insuranceDoPct: 0, miscEur: 0, marketingPctCa: 2, marketingFixedEur: 0, financingRatePct: 3, financingFeesEur: 0, taxeAmenagementEurM2Sdp: 0,
  terrassementEur: 0, nbAscenseurs: 0, ascenseurBaseCostEur: 0, nbSousSols: 0, surfaceSousSolM2: 0, coutSousSolEurM2: 0, rehabMode: false,
  travauxRehabTotal: 0, targetMarginPct: 15, soilType: 'normal', ...surcharge,
}) as Assumptions;
const entree = (a: Assumptions, parkingCost: number) => ({ ass: a, sdpM2: SDP, surfaceVendableM2: SHAB, massing: null, regionFactor: 1, levelsCount: 6, parkingCost });

test('synthèse — sans terrassement ni parking, la synthèse est le pro forma', () => {
  const s = calculerSyntheseBilan(entree(ass(), 0));
  assert.equal(s.coutTotal, s.pf.coutTotal);
  assert.equal(s.marge, s.pf.marge);
});
test('synthèse — le terrassement est ajouté APRÈS le pro forma : ni honoraires, ni aléas, ni intérêts ne portent dessus', () => {
  const sans = calculerSyntheseBilan(entree(ass(), 0));
  const avec = calculerSyntheseBilan(entree(ass({ terrassementEur: TERRASSEMENT }), 0));
  assert.equal(avec.coutTotal - sans.coutTotal, TERRASSEMENT);
  assert.equal(avec.pf.moe, sans.pf.moe);
  assert.equal(avec.pf.intercalaires, sans.pf.intercalaires);
});
test('synthèse — le parking entre dans « total travaux » mais PAS dans le coût total ni dans la marge', () => {
  // La page appelle d'ailleurs calculerSyntheseBilan avec parkingCost = 0, puis ajoute le parking au seul
  // sous-total « Total travaux » (BilanPromoteurPage.tsx, lignes 517 à 528) : même effet.
  const sans = calculerSyntheseBilan(entree(ass(), 0));
  const avec = calculerSyntheseBilan(entree(ass(), PARKING));
  assert.equal(avec.totalTravaux - sans.totalTravaux, PARKING);
  assert.equal(avec.coutTotal, sans.coutTotal);
  assert.equal(avec.marge, sans.marge);
});
test('ÉCART figé — le « foncier max admissible » déduit le parking, alors que la marge affichée ne le compte pas', () => {
  const args = { ass: ass(), sdpEstimatedM2: SDP, surfaceVendableM2: SHAB, massing: null, regionFactor: 1, levelsCount: 6, terrassementEur: 0, targetMarginPct: 15 };
  const sansParking = computeFoncierMaxAdmissible({ ...args, parkingCost: 0 });
  const avecParking = computeFoncierMaxAdmissible({ ...args, parkingCost: PARKING });
  // 60 000 € de parking retirent 53 937 € au foncier max (60 000 ÷ 1,08 ÷ 1,03 : frais d'acquisition et intérêts sur le foncier).
  assert.equal(sansParking, 1_092_306);
  assert.equal(avecParking, 1_038_369);
  // Conséquence : à ce foncier « max », la marge affichée par la synthèse dépasse la cible.
  const s = calculerSyntheseBilan(entree(ass({ landPriceEur: avecParking }), PARKING));
  assert.ok(Math.abs(s.margePct - 16.29) < 0.005, String(s.margePct));
});
test('CONVERGENCE — un coût de parking saisi réduit la marge affichée d\'autant', {
  skip: 'Échoue aujourd\'hui : le parking s\'ajoute au sous-total « Total travaux » mais ni au coût total ni à la marge (60 000 € d\'essai sans effet sur la marge). Attend la réponse d\'Albé (question 5).',
}, () => {
  const sans = calculerSyntheseBilan(entree(ass(), 0));
  const avec = calculerSyntheseBilan(entree(ass(), PARKING));
  assert.equal(sans.marge - avec.marge, PARKING);
});
test('CONVERGENCE — la somme des lignes « total travaux » + autres totaux égale le coût total affiché', {
  skip: 'Échoue aujourd\'hui dès qu\'un parking est chiffré : la somme des sous-totaux dépasse le « coût total opération » du montant du parking.',
}, () => {
  const s = calculerSyntheseBilan(entree(ass({ terrassementEur: TERRASSEMENT }), PARKING));
  const somme = s.pf.totalFoncier + s.pf.totalEtudes + s.totalTravaux + s.pf.totalTaxes + s.pf.totalCom + s.pf.totalFin;
  assert.ok(Math.abs(somme - s.coutTotal) < 0.5, `${somme} ≠ ${s.coutTotal}`);
});
test('synthèse — scénario « +5 % travaux » de la page : le pro forma est recalculé, le terrassement reste au même montant', () => {
  const a = ass({ terrassementEur: TERRASSEMENT });
  const base = computeProForma(a, SDP, SHAB, null, 1, 1, 6);
  const stress = computeProForma(a, SDP, SHAB, null, 1.05, 1, 6);
  assert.ok(Math.abs((stress.travauxBase / base.travauxBase) - 1.05) < 1e-9);
});
