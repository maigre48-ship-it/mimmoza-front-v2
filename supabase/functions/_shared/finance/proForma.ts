// Moteur unique utilisé par la page Bilan et le tchat. Aucun accès navigateur ni réseau.
type MassingMetrics = { totaux: { sdpM2: number; surfaceFacadeNetteM2: number; surfaceToitureTerrasseM2: number; surfaceToiturePenteM2: number; surfaceBalconsM2: number; nbMenuiseries: number; empriseSolM2: number } };
function n(v: unknown, fallback = 0): number { const x = Number(v); return Number.isFinite(x) ? x : fallback; }
function pct(v: unknown, fallback = 0): number { return Math.max(0, Math.min(100, n(v, fallback))); }
/** Convention promoteur : marge sur recettes, avant fiscalité du résultat. */
export function computeFinancialBalance(caTotal: number, coutTotal: number, surfaceVendableM2 = 0, sdpEstimatedM2 = 0) {
  const marge = caTotal - coutTotal;
  return {
    caTotal, coutTotal, marge,
    margePct: caTotal > 0 ? (marge / caTotal) * 100 : 0,
    coutRevientEurM2Hab: surfaceVendableM2 > 0 ? coutTotal / surfaceVendableM2 : 0,
    coutRevientEurM2Sdp: sdpEstimatedM2 > 0 ? coutTotal / sdpEstimatedM2 : 0,
  };
}
export type Assumptions = {
  salePriceEurM2Hab: number; commercialisationPct: number; coefVendable: number;
  landPriceEur: number; notaryFeesPct: number; acquisitionTaxesPct: number;
  worksCostEurM2Sdp: number; vrdPct: number; extPct: number; contingencyPct: number;
  surveyorEur: number; geotechEur: number; moePct: number; betPct: number;
  spsCtOpcEur: number; insuranceDoPct: number; miscEur: number;
  marketingPctCa: number; marketingFixedEur: number;
  financingRatePct: number; financingFeesEur: number; taxeAmenagementEurM2Sdp: number;
  terrassementEur: number;
  // Chiffrage détaillé depuis le métré Massing 3D (prix unitaires éditables).
  structureCostEurM2Sdp: number;   // gros œuvre / structure (remplace le forfait quand massing)
  facadeCostEurM2: number;         // ravalement / ITE
  roofTerrasseCostEurM2: number;   // étanchéité
  roofPenteCostEurM2: number;      // charpente + couverture
  balconyCostEurM2: number;        // dalles de balcon
  windowUnitCostEur: number;       // menuiserie à l'unité
  foundationCostEurM2Emprise: number; // fondations €/m² d'emprise
  soilType: "normal" | "argileux" | "pieux"; // nature du sol → multiplicateur fondations
  parkingType: "surface" | "aerien" | "sous_sol"; // type de parking
  parkingCostPerPlace: number;        // € HT par place
  /** true = prix construction calculés auto depuis la géométrie ; false = personnalisés */
  autoCosts: boolean;
  /** Montant travaux depuis simulation réhabilitation (0 = non défini) */
  travauxRehabTotal: number;
  /** true = utiliser travauxRehabTotal et surfaceRehabM2 */
  rehabMode: boolean;
  /** Surface SDP réhabilitée (m²) — transmise depuis la simulation ou saisie manuelle */
  surfaceRehabM2: number;
  /** Marge cible promoteur (%) — base du foncier max admissible */
  targetMarginPct: number;
  /** Ascenseurs — coût base × coeff hauteur */
  nbAscenseurs: number;
  ascenseurBaseCostEur: number;
  /** Sous-sol */
  nbSousSols: number;
  surfaceSousSolM2: number;
  coutSousSolEurM2: number;
  /** Planning opération (ÉV.4) — en mois */
  dureeAcquisitionMois: number;
  dureePermisMois: number;
  dureePurgeMois: number;
  dureeTravauxMois: number;
  dureeCommercialisationMois: number;
  /** Marge de sécurité appliquée au foncier max → prix terrain conseillé (ÉV.1) */
  margeSecuriteFoncierPct: number;
};

export function ascenseurHeightCoef(levelsCount: number): number {
  const rPlus = Math.max(0, Math.round(levelsCount) - 1); // levelsCount inclut le RDC → R+rPlus
  if (rPlus <= 2) return 1;     // R+0 à R+2
  if (rPlus <= 4) return 1.2;   // R+3 à R+4
  if (rPlus <= 7) return 1.45;  // R+5 à R+7
  return 1.8;                   // R+8 et plus
}
function computeAscenseurCost(nbAscenseurs: number, levelsCount: number, baseCost: number): number {
  return Math.max(0, nbAscenseurs) * Math.max(0, baseCost) * ascenseurHeightCoef(levelsCount);
}

export const SOIL_MULT: Record<Assumptions["soilType"], number> = { normal: 1, argileux: 1.45, pieux: 2.3 };
// ── computeProForma (NE PAS MODIFIER) ───────────────────────────────────────────
//  Le coefficient régional (regionFactor) ne s'applique QU'aux coûts de
//  construction principaux : forfait €/m² SDP et gros œuvre Massing.
export function computeProForma(
  ass: Assumptions,
  sdpEstimatedM2: number,
  surfaceVendableM2: number,
  massing: MassingMetrics | null = null,
  worksMultiplier = 1,
  regionFactor = 1,
  levelsCount = 1,
) {
  const useRehab   = ass.rehabMode && ass.travauxRehabTotal > 0;
  const useMassing = !ass.rehabMode && !!massing && massing.totaux.sdpM2 > 0;

  // Chiffrage détaillé depuis le métré Massing 3D (quantités) × prix unitaires.
  const structureCost    = useMassing ? sdpEstimatedM2 * n(ass.structureCostEurM2Sdp, 0) * regionFactor : 0;
  const facadeCost       = useMassing ? massing!.totaux.surfaceFacadeNetteM2 * n(ass.facadeCostEurM2, 0) : 0;
  const roofTerrasseCost = useMassing ? massing!.totaux.surfaceToitureTerrasseM2 * n(ass.roofTerrasseCostEurM2, 0) : 0;
  const roofPenteCost    = useMassing ? massing!.totaux.surfaceToiturePenteM2 * n(ass.roofPenteCostEurM2, 0) : 0;
  const balconyCost      = useMassing ? massing!.totaux.surfaceBalconsM2 * n(ass.balconyCostEurM2, 0) : 0;
  const menuiserieCost   = useMassing ? massing!.totaux.nbMenuiseries * n(ass.windowUnitCostEur, 0) : 0;
  const foundationCost   = useMassing ? massing!.totaux.empriseSolM2 * n(ass.foundationCostEurM2Emprise, 0) * (SOIL_MULT[ass.soilType] ?? 1) : 0;
  const massingTravaux   = structureCost + foundationCost + facadeCost + roofTerrasseCost + roofPenteCost + balconyCost + menuiserieCost;

  const travauxBaseRaw = useRehab
    ? n(ass.travauxRehabTotal, 0)
    : useMassing
      ? massingTravaux
      : sdpEstimatedM2 * n(ass.worksCostEurM2Sdp, 0) * regionFactor;
  const travauxBase = travauxBaseRaw * worksMultiplier;

  // Coûts directs — non soumis au coefficient régional ni aux % (VRD/MOE/BET/aléas),
  // mais stressés comme des travaux (worksMultiplier) pour le scénario +5 %.
  const ascenseursCost = computeAscenseurCost(n(ass.nbAscenseurs, 0), levelsCount, n(ass.ascenseurBaseCostEur, 0)) * worksMultiplier;
  const sousSolCost    = n(ass.nbSousSols, 0) * n(ass.surfaceSousSolM2, 0) * n(ass.coutSousSolEurM2, 0) * worksMultiplier;

  const caLogements  = surfaceVendableM2 * n(ass.salePriceEurM2Hab, 0) * (pct(ass.commercialisationPct, 100) / 100);
  const caTotal      = caLogements;
  const foncier      = n(ass.landPriceEur, 0);
  const fraisNotaire = foncier * (pct(ass.notaryFeesPct, 7.5) / 100);
  const taxesAcq     = foncier * (pct(ass.acquisitionTaxesPct, 0) / 100);
  const totalFoncier = foncier + fraisNotaire + taxesAcq;
  const surveyor     = n(ass.surveyorEur, 0);
  const geotech      = n(ass.geotechEur, 0);
  const moe          = travauxBase * (pct(ass.moePct, 10) / 100);
  const bet          = travauxBase * (pct(ass.betPct, 3) / 100);
  const spsCtOpc     = n(ass.spsCtOpcEur, 0);
  const insuranceDo  = travauxBase * (pct(ass.insuranceDoPct, 2) / 100);
  const misc         = n(ass.miscEur, 0);
  const totalEtudes  = surveyor + geotech + moe + bet + spsCtOpc + insuranceDo + misc;
  const vrd          = travauxBase * (pct(ass.vrdPct, 6) / 100);
  const ext          = travauxBase * (pct(ass.extPct, 3) / 100);
  const aleas        = travauxBase * (pct(ass.contingencyPct, 3) / 100);
  const totalTravaux = travauxBase + vrd + ext + aleas + ascenseursCost + sousSolCost;
  const taxeAmenagement = sdpEstimatedM2 * n(ass.taxeAmenagementEurM2Sdp, 0);
  const totalTaxes   = taxeAmenagement;
  const marketingPct = caTotal * (pct(ass.marketingPctCa, 2) / 100);
  const marketingFixed = n(ass.marketingFixedEur, 0);
  const totalCom     = marketingPct + marketingFixed;
  const baseFin      = totalFoncier + 0.5 * totalTravaux;
  const intercalaires = baseFin * (pct(ass.financingRatePct, 4) / 100);
  const fraisFin     = n(ass.financingFeesEur, 0);
  const totalFin     = intercalaires + fraisFin;
  const coutTotal    = totalFoncier + totalEtudes + totalTravaux + totalTaxes + totalCom + totalFin;
  const { marge, margePct, coutRevientEurM2Hab, coutRevientEurM2Sdp } = computeFinancialBalance(caTotal, coutTotal, surfaceVendableM2, sdpEstimatedM2);
  const travauxEurM2Sdp = sdpEstimatedM2 > 0 ? travauxBase / sdpEstimatedM2 : 0;
  return {
    useRehab, useMassing, travauxBase, travauxEurM2Sdp,
    structureCost, foundationCost, facadeCost, roofTerrasseCost, roofPenteCost, balconyCost, menuiserieCost,
    ascenseursCost, sousSolCost,
    caLogements, caTotal, foncier, fraisNotaire, taxesAcq, totalFoncier,
    surveyor, geotech, moe, bet, spsCtOpc, insuranceDo, misc, totalEtudes,
    vrd, ext, aleas, totalTravaux, taxeAmenagement, totalTaxes,
    marketingPct, marketingFixed, totalCom, intercalaires, fraisFin, totalFin,
    coutTotal, marge, margePct, coutRevientEurM2Hab, coutRevientEurM2Sdp,
  };
}

// ── ÉV.1 — Foncier max admissible EXACT (résolution dichotomique). ──────────────
//  On cherche le prix de foncier X tel que marge(X) = marge cible, en réutilisant
//  computeProForma (non modifié) avec landPriceEur surchargé. La marge décroît de
//  façon monotone avec X → la dichotomie converge. Tolérance : 1 €.
export function computeFoncierMaxAdmissible(args: {
  ass: Assumptions; sdpEstimatedM2: number; surfaceVendableM2: number;
  massing: MassingMetrics | null; regionFactor: number; levelsCount: number;
  terrassementEur: number; parkingCost: number; targetMarginPct: number;
}): number {
  const { ass, sdpEstimatedM2, surfaceVendableM2, massing, regionFactor, levelsCount, terrassementEur, parkingCost, targetMarginPct } = args;
  const t = pct(targetMarginPct, 18) / 100;
  const caRef = computeProForma(ass, sdpEstimatedM2, surfaceVendableM2, massing, 1, regionFactor, levelsCount).caTotal;
  if (!(caRef > 0)) return 0;
  const margeCible = caRef * t;

  // marge nette pour un prix de foncier x (terrassement + parking ajoutés hors computeProForma).
  const margeAt = (x: number): number => {
    const pf = computeProForma({ ...ass, landPriceEur: x }, sdpEstimatedM2, surfaceVendableM2, massing, 1, regionFactor, levelsCount);
    return pf.caTotal - (pf.coutTotal + terrassementEur + parkingCost);
  };

  // Si même à 0 € de foncier la marge cible n'est pas atteinte → 0 (projet non finançable).
  if (margeAt(0) - margeCible <= 0) return 0;
  // Si même à X = CA la marge reste ≥ cible (cas théorique) → borne haute.
  if (margeAt(caRef) - margeCible >= 0) return Math.round(caRef);

  let lo = 0, hi = caRef;
  for (let i = 0; i < 80 && hi - lo > 1; i++) {
    const mid = (lo + hi) / 2;
    const f = margeAt(mid) - margeCible;
    if (f > 0) lo = mid; else hi = mid; // marge décroissante : si surplus, on peut payer plus cher
  }
  return Math.round((lo + hi) / 2);
}
