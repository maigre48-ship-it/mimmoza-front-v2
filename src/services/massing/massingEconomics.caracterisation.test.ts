// src/services/massing/massingEconomics.caracterisation.test.ts
// =============================================================================
// Lot B1 « bilan unique » — caractérisation du « bilan promoteur synthétique »
// de la page Faisabilité / Massing (computeScenarioEconomics), et écarts avec
// le bilan à rebours du rapport (bilanCalcul.ts). Aucun moteur modifié.
//
// VALEURS D'ESSAI, NON REPRÉSENTATIVES : chiffres ronds arbitraires. Surfaces
// du cas : volume d'étude de la parcelle témoin de Montreuil (SDP 1 134 m²,
// emprise 189 m², lot C7b) ; SHAB = 0,82 × SDP (coefficient du dépôt).
//
// massingEconomics.service.ts importe ses voisins SANS extension (style Vite) :
// le crochet ci-dessous ajoute « .ts » pour que `node --test` puisse le charger.
// =============================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { calculerBilan } from '../../spaces/copilot/agent/rapport/bilanCalcul.ts';

register('data:text/javascript,' + encodeURIComponent(`
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\\.[a-z]+$/i.test(specifier) && context.parentURL && context.parentURL.startsWith('file:')) {
    const u = new URL(specifier + '.ts', context.parentURL);
    if (existsSync(fileURLToPath(u))) return next(u.href, context);
  }
  return next(specifier, context);
}`));
const { computeScenarioEconomics, DEFAULT_HYPOTHESES } = await import('./massingEconomics.service.ts');

const SDP = 1134, EMPRISE = 189, SHAB = 929.88;
const H = { prix: 5000, cout: 2000, hon: 0.10, ff: 0.03, marge: 0.15, taxes: 100_000, vrd: 50_000 };
const scenario = { name: 'balanced', saleableAreaM2: SHAB, sdpM2: SDP, footprintM2: EMPRISE } as never;
const hyp = (foncierTotal: number | null) => ({
  prixSortieM2: H.prix, coutConstructionM2: H.cout, coutVrdM2: H.vrd / EMPRISE, honorairesPct: H.hon,
  taxesM2Sdp: H.taxes / SDP, fraisFinanciersPct: H.ff, margeCiblePct: H.marge, foncierTotal,
});

test('massing — cas Montreuil 1 134 m² : chaque ligne figée', () => {
  const e = computeScenarioEconomics(scenario, hyp(null));
  assert.equal(e.revenue, 4_649_400);
  assert.equal(e.coutTravaux, 2_268_000);
  assert.equal(e.coutVrd, 50_000);
  assert.equal(e.honoraires, 464_940);        // 10 % × CA
  assert.equal(e.taxes, 100_000);
  assert.equal(e.fraisFinanciers, 68_040);    // 3 % × travaux
  assert.equal(e.coutsHorsFoncier, 2_950_980);
  assert.equal(e.landValueMax, 1_001_010);
  assert.equal(e.margin, null);               // pas de foncier → pas de marge
});
test('massing — les honoraires sont un pourcentage du CHIFFRE D\'AFFAIRES (et non des travaux)', () => {
  const e = computeScenarioEconomics(scenario, hyp(null));
  assert.equal(e.honoraires, Math.round(e.revenue * H.hon * 100) / 100);
});
test('massing — les frais financiers sont un pourcentage des TRAVAUX (et non du CA)', () => {
  const e = computeScenarioEconomics(scenario, hyp(null));
  assert.equal(e.fraisFinanciers, Math.round(e.coutTravaux * H.ff * 100) / 100);
});
test('massing — la charge foncière admissible ne déduit ni frais d\'acquisition, ni aléas, ni commercialisation, ni démolition', () => {
  const e = computeScenarioEconomics(scenario, hyp(null));
  assert.equal(e.landValueMax, Math.round((e.revenue * (1 - H.marge) - e.coutsHorsFoncier) * 100) / 100);
});
test('massing — valeurs par défaut du module : honoraires 6 % du CA, frais financiers 3 % des travaux, marge cible 15 %, VRD 90 €/m² d\'emprise', () => {
  assert.equal(DEFAULT_HYPOTHESES.honorairesPct, 0.06);
  assert.equal(DEFAULT_HYPOTHESES.fraisFinanciersPct, 0.03);
  assert.equal(DEFAULT_HYPOTHESES.margeCiblePct, 0.15);
  assert.equal(DEFAULT_HYPOTHESES.coutVrdM2, 90);
  assert.equal(DEFAULT_HYPOTHESES.prixSortieM2, 0); // pas de prix de vente par défaut : à saisir
});

const entreesRebours = {
  nb_logements: null, shab_m2: SHAB, sdp_m2: SDP, prix_vente_libre_eur_m2_shab: H.prix, part_lls_pct: 0, prix_cession_lls_eur_m2_shab: null,
  cout_travaux_eur_m2_sdp: H.cout, honoraires_pct_travaux: H.hon, aleas_pct_travaux: 0, demolition_eur: 0, vrd_eur: H.vrd, taxes_urbanisme_eur: H.taxes,
  commercialisation_pct_ca: 0, frais_financiers_pct_ca: H.ff, frais_acquisition_pct_foncier: 0, marge_cible_pct_ca: H.marge,
  surface_terrain_m2: 804, prix_negocie_eur: null,
};
test('ÉCART figé — mêmes taux, postes absents du massing mis à zéro des deux côtés : 166 698 € d\'écart de charge foncière', () => {
  // Bilan à rebours : honoraires 10 % × travaux = 226 800 ; frais financiers 3 % × CA = 139 482 → CF 1 167 708 €.
  // Massing        : honoraires 10 % × CA      = 464 940 ; frais financiers 3 % × travaux = 68 040 → CF 1 001 010 €.
  const rebours = calculerBilan(entreesRebours).chargeFonciere!;
  const massing = computeScenarioEconomics(scenario, hyp(null)).landValueMax;
  assert.ok(Math.abs(rebours - 1_167_708) < 0.5, String(rebours));
  assert.ok(Math.abs((rebours - massing) - 166_698) < 0.5, String(rebours - massing));
});
test('CONVERGENCE — le bilan de la page Massing donne la même charge foncière que le bilan à rebours du rapport', {
  skip: 'Échoue aujourd\'hui : 1 001 010 € contre 1 167 708 € à taux égaux (assiettes inversées : honoraires sur le CA, frais financiers sur les travaux). Attend les réponses d\'Albé (questions 1 et 2).',
}, () => {
  const rebours = calculerBilan(entreesRebours).chargeFonciere!;
  assert.ok(Math.abs(rebours - computeScenarioEconomics(scenario, hyp(null)).landValueMax) < 1);
});
