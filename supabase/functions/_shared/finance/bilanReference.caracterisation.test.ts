// supabase/functions/_shared/finance/bilanReference.caracterisation.test.ts
// =============================================================================
// Lot B1 « bilan unique » — tests de CARACTÉRISATION (aucun moteur modifié).
//
// Ce fichier fige le comportement ACTUEL des deux moteurs de bilan retenus
// comme référence provisoire :
//   · bilan « à l'endroit » (foncier connu → marge)   : computeProForma (proForma.ts) ;
//   · bilan « à rebours »  (marge cible → charge foncière) : calculerChargeFonciere
//     (copilot-chat/agent/rapport.ts) et sa copie du site (bilanCalcul.ts).
// Il documente aussi, par des tests « skip », les écarts entre ces moteurs :
// chaque test ignoré échoue aujourd'hui, et dit pourquoi. Aucun n'est à
// « réparer » sans la réponse d'Albé (voir ECARTS.md et RAPPORT.md du lot).
//
// TOUTES LES ENTRÉES SONT DES VALEURS D'ESSAI, NON REPRÉSENTATIVES : chiffres
// ronds arbitraires, ni prix de marché ni coûts réels. Seules les surfaces des
// cas A et B viennent du dépôt : volume d'étude de la parcelle témoin de
// Montreuil 93048000AS0249 (804 m²), SDP 1 134 m² (emprise 189 m², lot C7b
// moteur) et 1 248 m² (emprise 208 m², lot C7b serveur). La SHAB est prise à
// 0,82 × SDP, coefficient du dépôt (promoteur/shared/surfaceCoefficients.ts).
//
// Lancement : node --test <ce fichier>   ou   deno test --no-lock --no-check -A <ce fichier>
// =============================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFoncierMaxAdmissible, computeProForma, type Assumptions } from './proForma.ts';
import { calculateChatBilan } from './chatBilan.ts';
import { calculerChargeFonciere, hypothesesVides, type Hypotheses } from '../../copilot-chat/agent/rapport.ts';
import { calculerBilan, type EntreesBilan } from '../../../../src/spaces/copilot/agent/rapport/bilanCalcul.ts';

// ── Jeu d'entrées commun — VALEURS D'ESSAI, NON REPRÉSENTATIVES ──────────────
const H = { prix: 5000, cout: 2000, hon: 10, ale: 5, com: 2, ff: 3, fa: 8, marge: 15, taxes: 100_000, vrd: 50_000, demo: 30_000 };
interface Cas { sdp: number; emprise: number; terrain: number; lls: number; prixLls: number | null }
const CAS_A: Cas = { sdp: 1134, emprise: 189, terrain: 804, lls: 0, prixLls: null };   // Montreuil, volume bas
const CAS_B: Cas = { sdp: 1248, emprise: 208, terrain: 804, lls: 0, prixLls: null };   // Montreuil, volume haut
const CAS_C: Cas = { sdp: 3000, emprise: 600, terrain: 2000, lls: 30, prixLls: 3000 }; // cas construit, 30 % de logements sociaux
const shabDe = (c: Cas) => Math.round(c.sdp * 0.82 * 100) / 100;

function hypothesesServeur(c: Cas): Hypotheses {
  return {
    ...hypothesesVides(),
    programme: { nb_logements: null, shab_m2: shabDe(c), sdp_m2: c.sdp, gabarit: null },
    prix_vente_libre_eur_m2_shab: H.prix, part_lls_pct: c.lls, prix_cession_lls_eur_m2_shab: c.prixLls,
    cout_travaux_eur_m2_sdp: H.cout, honoraires_pct_travaux: H.hon, aleas_pct_travaux: H.ale,
    commercialisation_pct_ca: H.com, frais_financiers_pct_ca: H.ff, frais_acquisition_pct_foncier: H.fa,
    taxes_urbanisme_eur: H.taxes, vrd_eur: H.vrd, demolition_eur: H.demo, marge_cible_pct_ca: H.marge,
  };
}
/** Mêmes hypothèses pour la copie du site : pourcentages en FRACTIONS (0,08 = 8 %). */
function entreesSite(c: Cas, prixNegocie: number | null = null): EntreesBilan {
  return {
    nb_logements: null, shab_m2: shabDe(c), sdp_m2: c.sdp, prix_vente_libre_eur_m2_shab: H.prix,
    part_lls_pct: c.lls / 100, prix_cession_lls_eur_m2_shab: c.prixLls, cout_travaux_eur_m2_sdp: H.cout,
    honoraires_pct_travaux: H.hon / 100, aleas_pct_travaux: H.ale / 100, demolition_eur: H.demo, vrd_eur: H.vrd,
    taxes_urbanisme_eur: H.taxes, commercialisation_pct_ca: H.com / 100, frais_financiers_pct_ca: H.ff / 100,
    frais_acquisition_pct_foncier: H.fa / 100, marge_cible_pct_ca: H.marge / 100,
    surface_terrain_m2: c.terrain, prix_negocie_eur: prixNegocie,
  };
}
/**
 * Mêmes hypothèses pour le pro forma de la page « Bilan promoteur ». Le pro
 * forma n'a pas de ligne VRD en euros ni de ligne démolition : les deux
 * forfaits sont passés en « divers » (miscEur) pour que le total des postes
 * soit comparable. Tous les autres taux propres à la page sont mis à zéro.
 */
function hypothesesProForma(c: Cas, foncier: number, surcharge: Partial<Assumptions> = {}): Assumptions {
  return {
    salePriceEurM2Hab: H.prix, commercialisationPct: 100, coefVendable: 1, landPriceEur: foncier,
    notaryFeesPct: H.fa, acquisitionTaxesPct: 0, worksCostEurM2Sdp: H.cout, vrdPct: 0, extPct: 0, contingencyPct: H.ale,
    surveyorEur: 0, geotechEur: 0, moePct: H.hon, betPct: 0, spsCtOpcEur: 0, insuranceDoPct: 0, miscEur: H.vrd + H.demo,
    marketingPctCa: H.com, marketingFixedEur: 0, financingRatePct: H.ff, financingFeesEur: 0,
    taxeAmenagementEurM2Sdp: H.taxes / c.sdp, terrassementEur: 0,
    structureCostEurM2Sdp: 0, facadeCostEurM2: 0, roofTerrasseCostEurM2: 0, roofPenteCostEurM2: 0, balconyCostEurM2: 0,
    windowUnitCostEur: 0, foundationCostEurM2Emprise: 0, soilType: 'normal', parkingType: 'surface', parkingCostPerPlace: 0,
    autoCosts: false, travauxRehabTotal: 0, rehabMode: false, surfaceRehabM2: 0, targetMarginPct: H.marge,
    nbAscenseurs: 0, ascenseurBaseCostEur: 0, nbSousSols: 0, surfaceSousSolM2: 0, coutSousSolEurM2: 0,
    dureeAcquisitionMois: 3, dureePermisMois: 6, dureePurgeMois: 3, dureeTravauxMois: 18, dureeCommercialisationMois: 24,
    margeSecuriteFoncierPct: 15, ...surcharge,
  };
}
const proche = (obtenu: number, attendu: number, tolerance = 0.5) =>
  assert.ok(Math.abs(obtenu - attendu) <= tolerance, `obtenu ${obtenu}, attendu ${attendu} (± ${tolerance})`);

// ═════════════════════════════════════════════════════════════════════════════
// 1. Bilan à rebours — moteur serveur (calculerChargeFonciere) : comportement figé
// ═════════════════════════════════════════════════════════════════════════════
test('à rebours, serveur — cas A (Montreuil, SDP 1 134 m²) : chaque ligne figée', () => {
  const b = calculerChargeFonciere(hypothesesServeur(CAS_A), {}, CAS_A.terrain);
  assert.equal(b.statut, 'complet');
  assert.deepEqual(b.detail, {
    ca_libre_ht: 4_649_400, ca_lls_ht: 0, travaux_ht: 2_268_000, honoraires_ht: 226_800, aleas_ht: 113_400,
    demolition_ht: 30_000, vrd_ht: 50_000, taxes_urbanisme_ht: 100_000, commercialisation_ht: 92_988, frais_financiers_ht: 139_482,
  });
  assert.equal(b.ca_ht, 4_649_400);
  assert.equal(b.couts_hors_foncier_ht, 3_020_670);
  assert.equal(b.charge_fonciere_admissible_ht, 862_333);
  assert.equal(b.charge_fonciere_eur_m2_terrain, 1073);
  assert.equal(b.charge_fonciere_eur_m2_sdp, 760);
});
test('à rebours, serveur — cas B (Montreuil, SDP 1 248 m²)', () => {
  const b = calculerChargeFonciere(hypothesesServeur(CAS_B), {}, CAS_B.terrain);
  assert.equal(b.ca_ht, 5_116_800);
  assert.equal(b.couts_hors_foncier_ht, 3_306_240);
  assert.equal(b.charge_fonciere_admissible_ht, 965_778);
  assert.equal(b.charge_fonciere_eur_m2_terrain, 1201);
  assert.equal(b.charge_fonciere_eur_m2_sdp, 774);
});
test('à rebours, serveur — cas C (30 % de logements sociaux à prix de cession distinct)', () => {
  const b = calculerChargeFonciere(hypothesesServeur(CAS_C), {}, CAS_C.terrain);
  assert.equal(b.detail.ca_libre_ht, 8_610_000);
  assert.equal(b.detail.ca_lls_ht, 2_214_000);
  assert.equal(b.ca_ht, 10_824_000);
  assert.equal(b.couts_hors_foncier_ht, 7_621_200);
  assert.equal(b.charge_fonciere_admissible_ht, 1_462_222);
});
test('à rebours, serveur — les frais financiers sont un pourcentage du CA, sans durée ni foncier', () => {
  // Formule codée : frais financiers = ff % × CA. Ni le foncier, ni la durée, ni un taux d'intérêt n'entrent.
  const b = calculerChargeFonciere(hypothesesServeur(CAS_A), {}, CAS_A.terrain);
  assert.equal(b.detail.frais_financiers_ht, Math.round(b.ca_ht! * H.ff / 100));
});
test('à rebours, serveur — honoraires et aléas sont assis sur les travaux seuls (hors VRD et démolition)', () => {
  const b = calculerChargeFonciere(hypothesesServeur(CAS_A), {}, CAS_A.terrain);
  assert.equal(b.detail.honoraires_ht, 2_268_000 * H.hon / 100);
  assert.equal(b.detail.aleas_ht, 2_268_000 * H.ale / 100);
});
test('à rebours, serveur — taxes, VRD ou démolition inconnus : comptés 0 et signalés, statut « partiel »', () => {
  const h = { ...hypothesesServeur(CAS_A), taxes_urbanisme_eur: null, vrd_eur: null, demolition_eur: null };
  const b = calculerChargeFonciere(h, {}, CAS_A.terrain);
  assert.equal(b.statut, 'partiel');
  assert.equal(b.couts_hors_foncier_ht, 3_020_670 - 180_000);
  assert.equal(b.manques.filter((m) => m.endsWith('non compté')).length, 3);
});
test('à rebours, serveur — une hypothèse essentielle absente : aucun chiffre', () => {
  const b = calculerChargeFonciere({ ...hypothesesServeur(CAS_A), marge_cible_pct_ca: null }, {}, CAS_A.terrain);
  assert.equal(b.charge_fonciere_admissible_ht, null);
  assert.equal(b.ca_ht, null);
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Bilan à rebours — la copie du site donne les mêmes chiffres que le serveur
// ═════════════════════════════════════════════════════════════════════════════
for (const [nom, c] of [['A', CAS_A], ['B', CAS_B], ['C', CAS_C]] as const) {
  test(`à rebours — site (bilanCalcul.ts) = serveur (rapport.ts), cas ${nom}, à l'euro près`, () => {
    const serveur = calculerChargeFonciere(hypothesesServeur(c), {}, c.terrain);
    const site = calculerBilan(entreesSite(c));
    assert.equal(site.etat, 'complet');
    assert.equal(Math.round(site.ca!), serveur.ca_ht);
    assert.equal(Math.round(site.coutsHorsFoncier!), serveur.couts_hors_foncier_ht);
    assert.equal(Math.round(site.chargeFonciere!), serveur.charge_fonciere_admissible_ht);
    assert.equal(Math.round(site.chargeFonciereM2Terrain!), serveur.charge_fonciere_eur_m2_terrain);
    assert.equal(Math.round(site.chargeFonciereM2Sdp!), serveur.charge_fonciere_eur_m2_sdp);
  });
}
test('à rebours — deux conventions de pourcentage coexistent : POURCENT au serveur, FRACTION sur le site', () => {
  // Même valeur « 8 » lue comme 8 % par le serveur et comme 800 % par bilanCalcul : la conversion est faite
  // par rapportModele.ts (pctVersFraction). Ce test fige le fait que les deux moteurs n'ont pas la même unité.
  const site = calculerBilan({ ...entreesSite(CAS_A), frais_acquisition_pct_foncier: 8 });
  proche(site.chargeFonciere!, (4_649_400 * 0.85 - 3_020_670) / 9, 0.01);
});
test('à rebours, site — au prix négocié égal à la charge foncière admissible, la marge réelle vaut la marge cible', () => {
  const cf = calculerBilan(entreesSite(CAS_A)).chargeFonciere!;
  const r = calculerBilan(entreesSite(CAS_A, cf));
  proche(r.margeReellePct! * 100, H.marge, 1e-9);
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. Bilan à l'endroit — computeProForma : comportement figé
// ═════════════════════════════════════════════════════════════════════════════
test('pro forma — cas A, foncier 862 333,33 € (charge foncière à rebours) : chaque ligne figée', () => {
  const cf = calculerBilan(entreesSite(CAS_A)).chargeFonciere!;
  const pf = computeProForma(hypothesesProForma(CAS_A, cf), CAS_A.sdp, shabDe(CAS_A), null, 1, 1, 6);
  proche(pf.caTotal, 4_649_400);
  proche(pf.travauxBase, 2_268_000);
  proche(pf.moe, 226_800);
  proche(pf.aleas, 113_400);
  proche(pf.totalTravaux, 2_381_400);     // travaux + aléas (les aléas sont DANS « total travaux »)
  proche(pf.totalEtudes, 306_800);        // honoraires 226 800 + « divers » 80 000 (VRD et démolition d'essai)
  proche(pf.totalTaxes, 100_000);
  proche(pf.totalCom, 92_988);
  proche(pf.fraisNotaire, 68_987);
  proche(pf.totalFoncier, 931_320);
  proche(pf.intercalaires, 63_661);       // 3 % × (foncier acte en main + 0,5 × total travaux)
  proche(pf.coutTotal, 3_876_169);
  proche(pf.marge, 773_231);
  proche(pf.margePct, 16.63, 0.005);
});
test('pro forma — assiette des intérêts intercalaires : taux × (foncier + frais + 0,5 × total travaux), sans durée', () => {
  const cf = 1_000_000;
  const pf = computeProForma(hypothesesProForma(CAS_A, cf), CAS_A.sdp, shabDe(CAS_A), null, 1, 1, 6);
  proche(pf.intercalaires, (H.ff / 100) * (pf.totalFoncier + 0.5 * pf.totalTravaux), 1e-6);
  // Les durées du planning (dureeTravauxMois…) n'entrent pas dans le calcul : résultat identique à 36 mois.
  const long = computeProForma(hypothesesProForma(CAS_A, cf, { dureeTravauxMois: 36, dureeCommercialisationMois: 48 }), CAS_A.sdp, shabDe(CAS_A), null, 1, 1, 6);
  assert.equal(long.intercalaires, pf.intercalaires);
});
test('pro forma — honoraires (MOE, BET) et assurance DO assis sur travauxBase, hors VRD, extérieurs, aléas, ascenseurs, sous-sol', () => {
  const pf = computeProForma(hypothesesProForma(CAS_A, 0, { vrdPct: 6, extPct: 3, betPct: 3, insuranceDoPct: 2, nbAscenseurs: 1, ascenseurBaseCostEur: 100_000 }), CAS_A.sdp, shabDe(CAS_A), null, 1, 1, 6);
  proche(pf.moe, 226_800); proche(pf.bet, 68_040); proche(pf.insuranceDo, 45_360);
  proche(pf.ascenseursCost, 145_000);     // 1 × 100 000 × 1,45 (R+5)
  proche(pf.totalTravaux, 2_268_000 * 1.14 + 145_000);
});
test('pro forma — le coefficient régional ne majore que le coût principal, pas les prix unitaires annexes', () => {
  const pf = computeProForma(hypothesesProForma(CAS_A, 0), CAS_A.sdp, shabDe(CAS_A), null, 1, 1.15, 6);
  proche(pf.travauxBase, 2_268_000 * 1.15);
});
test('pro forma — taux par défaut APPLIQUÉS PAR LE MOTEUR quand un champ manque : notaire 7,5 %, MOE 10 %, BET 3 %, DO 2 %, VRD 6 %, extérieurs 3 %, aléas 3 %, commercialisation 2 %, intérêts 4 %', () => {
  // Un champ absent (undefined) ne vaut pas 0 : pct(v, défaut) applique le défaut en dur du moteur.
  const nu = { salePriceEurM2Hab: H.prix, landPriceEur: 1_000_000, worksCostEurM2Sdp: H.cout } as Assumptions;
  const pf = computeProForma(nu, 1000, 820, null, 1, 1, 1);
  proche(pf.fraisNotaire, 75_000);
  proche(pf.moe, 200_000); proche(pf.bet, 60_000); proche(pf.insuranceDo, 40_000);
  proche(pf.vrd, 120_000); proche(pf.ext, 60_000); proche(pf.aleas, 60_000);
  proche(pf.marketingPct, 82_000);
  proche(pf.intercalaires, 0.04 * (1_075_000 + 0.5 * 2_240_000));
});
test('pro forma — foncier max admissible (dichotomie) : la marge au prix trouvé vaut la marge cible, à 1 € près', () => {
  const ass = hypothesesProForma(CAS_A, 0);
  const max = computeFoncierMaxAdmissible({ ass, sdpEstimatedM2: CAS_A.sdp, surfaceVendableM2: shabDe(CAS_A), massing: null, regionFactor: 1, levelsCount: 6, terrassementEur: 0, parkingCost: 0, targetMarginPct: H.marge });
  assert.equal(max, 930_494);
  const pf = computeProForma({ ...ass, landPriceEur: max }, CAS_A.sdp, shabDe(CAS_A), null, 1, 1, 6);
  proche(pf.margePct, H.marge, 0.001);
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. Bilan du tchat (calculateChatBilan) : simple addition des postes déclarés
// ═════════════════════════════════════════════════════════════════════════════
test('tchat — avec les postes du bilan à rebours et sa charge foncière, la marge retombe sur la cible', () => {
  const r = calculerBilan(entreesSite(CAS_A)); const cf = r.chargeFonciere!;
  const b = calculateChatBilan({
    base_montants: 'HT', surface_vendable_m2: shabDe(CAS_A), prix_vente_m2_eur: H.prix, foncier_eur: cf, frais_acquisition_eur: cf * H.fa / 100,
    travaux_eur: r.travaux! + H.vrd + H.demo, honoraires_eur: r.honoraires, assurances_eur: 0, taxes_eur: H.taxes,
    commercialisation_eur: r.commercialisation, financement_eur: r.fraisFinanciers, aleas_eur: r.aleas, autres_couts_eur: 0, marge_cible_pct: H.marge,
  });
  assert.equal(b.status, 'ok');
  const d = (b as unknown as { data: Record<string, number> }).data;
  assert.equal(d.recettes_eur, 4_649_400);
  assert.equal(d.cout_total_eur, 3_951_990);
  assert.equal(d.resultat_eur, 697_410);
  assert.equal(d.marge_sur_ca_pct, 15);
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. ÉCARTS ENTRE MOTEURS — tests ignorés : ils échouent aujourd'hui
// ═════════════════════════════════════════════════════════════════════════════
test('ÉCART figé — même terrain, mêmes taux : le pro forma annonce 16,63 % de marge là où le bilan à rebours vise 15 %', () => {
  // Cause unique sur ce jeu : les frais financiers. À rebours : 3 % × CA = 139 482 €.
  // Pro forma : 3 % × (foncier acte en main + 0,5 × total travaux) = 63 661 €. Écart : 75 821 €.
  const cf = calculerBilan(entreesSite(CAS_A)).chargeFonciere!;
  const pf = computeProForma(hypothesesProForma(CAS_A, cf), CAS_A.sdp, shabDe(CAS_A), null, 1, 1, 6);
  const rebours = calculerChargeFonciere(hypothesesServeur(CAS_A), {}, CAS_A.terrain);
  proche(rebours.detail.frais_financiers_ht! - pf.totalFin, 75_821);
  proche(pf.marge - 4_649_400 * 0.15, 75_821);
});
test('CONVERGENCE — la charge foncière à rebours, injectée comme foncier dans le pro forma, redonne la marge cible', {
  skip: 'Échoue aujourd\'hui : 16,63 % au lieu de 15 % (cas A). Les deux moteurs n\'ont pas la même assiette de frais financiers (% du CA contre taux × (foncier + 0,5 × travaux)). Attend la réponse d\'Albé (question 1).',
}, () => {
  const cf = calculerBilan(entreesSite(CAS_A)).chargeFonciere!;
  const pf = computeProForma(hypothesesProForma(CAS_A, cf), CAS_A.sdp, shabDe(CAS_A), null, 1, 1, 6);
  proche(pf.margePct, H.marge, 0.01);
});
test('CONVERGENCE — « foncier max admissible » de la page Bilan = « charge foncière admissible » du rapport, à hypothèses égales', {
  skip: 'Échoue aujourd\'hui : 930 494 € (page, dichotomie sur le pro forma) contre 862 333 € (rapport, formule à rebours), soit +68 161 € sur le cas A. Même cause que le test précédent.',
}, () => {
  const ass = hypothesesProForma(CAS_A, 0);
  const max = computeFoncierMaxAdmissible({ ass, sdpEstimatedM2: CAS_A.sdp, surfaceVendableM2: shabDe(CAS_A), massing: null, regionFactor: 1, levelsCount: 6, terrassementEur: 0, parkingCost: 0, targetMarginPct: H.marge });
  const rebours = calculerChargeFonciere(hypothesesServeur(CAS_A), {}, CAS_A.terrain);
  proche(max, rebours.charge_fonciere_admissible_ht!, 1);
});
test('CONVERGENCE — le pro forma sait chiffrer une part de logements sociaux à prix de cession distinct', {
  skip: 'Échoue aujourd\'hui : computeProForma n\'a qu\'un prix de vente. Cas C : CA 12 300 000 € au pro forma contre 10 824 000 € à rebours (30 % de LLS à 3 000 €/m² d\'essai). Attend la réponse d\'Albé (question 6).',
}, () => {
  const pf = computeProForma(hypothesesProForma(CAS_C, 0), CAS_C.sdp, shabDe(CAS_C), null, 1, 1, 6);
  proche(pf.caTotal, calculerChargeFonciere(hypothesesServeur(CAS_C), {}, CAS_C.terrain).ca_ht!);
});
test('CONVERGENCE — le bilan à rebours connaît les postes que la page Bilan compte par défaut (BET, assurance DO, géomètre, étude de sol, SPS/CT/OPC, extérieurs)', {
  skip: 'Échoue aujourd\'hui : ces postes n\'existent pas dans calculerChargeFonciere / bilanCalcul. Avec les taux par défaut de la page (VRD 6 %, extérieurs 3 %, BET 3 %, DO 2 %), le cas A passe de 16,63 % à 10,81 % de marge pour le même foncier. Attend la réponse d\'Albé (question 3).',
}, () => {
  const cles = Object.keys(hypothesesVides());
  for (const attendu of ['bet_pct_travaux', 'assurance_do_pct_travaux']) assert.ok(cles.includes(attendu), `clé absente : ${attendu}`);
});
