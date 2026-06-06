// ─────────────────────────────────────────────────────────────────────────────
// Mimmoza Valuation Engine — Calcul du score de confiance
// ─────────────────────────────────────────────────────────────────────────────

import type { MimmozaValuationInput } from "./valuation.types";

/**
 * Calcule un score de confiance 0–100 sur la base des données disponibles.
 * Plus les données sont riches et cohérentes, plus le score est élevé.
 */
export function computeValuationConfidence(input: MimmozaValuationInput): number {
  let score = 30; // base neutre

  // ── Données DVF ──────────────────────────────────────────────────────────
  const dvfCount = input.dvfComparables?.length ?? 0;
  if (dvfCount >= 5) score += 20;
  else if (dvfCount >= 2) score += 12;
  else if (dvfCount === 1) score += 6;
  else score -= 8; // absence de DVF = pénalité

  // ── Surface connue ───────────────────────────────────────────────────────
  if (input.surface && input.surface > 0) score += 8;
  else score -= 5;

  // ── Prix demandé connu ───────────────────────────────────────────────────
  if (input.askingPrice && input.askingPrice > 0) score += 5;

  // ── Prix/m² local connu ─────────────────────────────────────────────────
  if (input.market?.localPricePerSqm) score += 8;

  // ── SmartScore disponible ────────────────────────────────────────────────
  if (input.smartScore !== null && input.smartScore !== undefined) score += 7;

  // ── PLU disponible ───────────────────────────────────────────────────────
  if (input.plu) score += 7;

  // ── Géorisques disponible ────────────────────────────────────────────────
  if (input.georisques) {
    score += 5;
    // Pénalité si risque élevé (réduit la fiabilité de la valeur)
    if (input.georisques.globalRiskLevel === "high") score -= 4;
  }

  // ── Sitadel disponible ───────────────────────────────────────────────────
  if (input.sitadel) score += 4;

  // ── Données marché complètes ─────────────────────────────────────────────
  if (input.market?.yearlyPriceEvolutionPct !== undefined) score += 3;
  if (input.market?.rentalTension && input.market.rentalTension !== "unknown") score += 2;

  // ── État du bien ─────────────────────────────────────────────────────────
  if (input.propertyCondition && input.propertyCondition !== "unknown") score += 2;

  // ── Pénalité absence surface + prix demandé ───────────────────────────────
  if (!input.surface && !input.askingPrice) score -= 10;

  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Retourne la marge d'incertitude (ratio) en fonction du score de confiance.
 */
export function getUncertaintyMargin(confidenceScore: number): number {
  if (confidenceScore >= 85) return 0.06;
  if (confidenceScore >= 70) return 0.10;
  if (confidenceScore >= 55) return 0.15;
  return 0.22;
}