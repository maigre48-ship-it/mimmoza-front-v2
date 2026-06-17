// ─────────────────────────────────────────────────────────────────────────────
// Mimmoza Valuation Engine — Recommandation textuelle
// ─────────────────────────────────────────────────────────────────────────────

import type { MimmozaValuationInput, MimmozaValuationResult } from "./valuation.types";

/**
 * Construit la recommandation textuelle et les listes strengths/weaknesses/warnings
 * à partir du résultat partiel et de l'input.
 */
export function buildValuationRecommendation(
  result: Pick<
    MimmozaValuationResult,
    | "opportunityScore"
    | "confidenceScore"
    | "riskLevel"
    | "grossYield"
    | "merchantValue"
    | "developerValue"
    | "marketValue"
    | "vertical"
  >,
  input: MimmozaValuationInput
): {
  recommendation: string;
  strengths: string[];
  weaknesses: string[];
  warnings: string[];
} {
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const warnings: string[] = [];

  // ── Recommandation principale ─────────────────────────────────────────────
  let recommendation: string;
  if (result.opportunityScore >= 85) {
    recommendation = "Très forte opportunité — à approfondir rapidement.";
  } else if (result.opportunityScore >= 70) {
    recommendation =
      "Opportunité intéressante, sous réserve de validation des hypothèses clés.";
  } else if (result.opportunityScore >= 50) {
    recommendation =
      "Potentiel correct, mais plusieurs points méritent vérification avant engagement.";
  } else {
    recommendation =
      "Opportunité limitée ou trop risquée en l'état des données disponibles.";
  }

  // ── Strengths ─────────────────────────────────────────────────────────────
  if (result.marketValue !== null && input.askingPrice) {
    const delta = result.marketValue - input.askingPrice;
    if (delta > 0) strengths.push("Décote estimée positive vs. valeur marché");
  }

  const trend = input.market?.yearlyPriceEvolutionPct;
  if (trend !== undefined && trend !== null && trend >= 2) {
    strengths.push(`Marché local en progression (+${trend.toFixed(1)} %/an)`);
  }

  if (result.riskLevel === "low") {
    strengths.push("Niveau de risque faible sur la zone");
  }

  if (input.plu?.constructible === true) {
    strengths.push("Parcelle constructible selon PLU");
  }

  if (input.market?.rentalTension === "high") {
    strengths.push("Tension locative forte — vacance limitée");
  }

  if (input.smartScore !== null && input.smartScore !== undefined && input.smartScore >= 70) {
    strengths.push(`SmartScore élevé (${input.smartScore}/100)`);
  }

  if (input.sitadel?.trend === "up") {
    strengths.push("Dynamique de construction positive sur le secteur");
  }

  // ── Weaknesses ────────────────────────────────────────────────────────────
  const dvfCount = input.dvfComparables?.length ?? 0;
  if (dvfCount < 2) {
    weaknesses.push("Données DVF insuffisantes — valorisation moins fiable");
  }

  if (result.confidenceScore < 55) {
    weaknesses.push("Fourchette de valorisation large (données incomplètes)");
  }

  if (
    result.vertical === "investisseur" &&
    result.grossYield !== null &&
    result.grossYield !== undefined &&
    result.grossYield < 4
  ) {
    weaknesses.push(`Rentabilité brute faible (${result.grossYield.toFixed(1)} %)`);
  }

  if (result.riskLevel === "high") {
    weaknesses.push("Risque réglementaire ou environnemental élevé");
  }

  if (input.market?.rentalTension === "low") {
    weaknesses.push("Faible tension locative — risque de vacance");
  }

  if (
    result.vertical === "rehabilitateur" &&
    result.merchantValue !== null &&
    result.merchantValue !== undefined &&
    result.merchantValue < 0
  ) {
    weaknesses.push("Marge nette estimée négative avec les hypothèses actuelles");
  }

  // ── Warnings ──────────────────────────────────────────────────────────────
  warnings.push("Analyse indicative — ne constitue pas une expertise immobilière");

  if (result.vertical === "promoteur") {
    if (!input.plu) {
      warnings.push(
        "Données PLU insuffisantes pour calculer une valeur promoteur fiable"
      );
    } else {
      warnings.push(
        "La valeur promoteur dépend de la validation complète du PLU et du programme"
      );
    }
  }

  if (dvfCount > 0) {
    warnings.push(
      "Les données DVF doivent être confirmées par des comparables récents sur le terrain"
    );
  }

  if (result.confidenceScore < 60) {
    warnings.push(
      "Score de confiance modéré — envisagez une analyse approfondie pour affiner"
    );
  }

  return { recommendation, strengths, weaknesses, warnings };
}