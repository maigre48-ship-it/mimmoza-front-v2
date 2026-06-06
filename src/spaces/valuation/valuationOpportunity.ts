// ─────────────────────────────────────────────────────────────────────────────
// Mimmoza Valuation Engine — Score d'opportunité
// ─────────────────────────────────────────────────────────────────────────────

import type {
  MimmozaValuationInput,
  OpportunityBadge,
} from "./valuation.types";

interface OpportunityPartialResult {
  opportunityScore: number;
  opportunityValue: number | null;
  opportunityLabel: OpportunityBadge;
}

/**
 * Calcule le score d'opportunité (0–100) et la valeur d'opportunité (delta).
 */
export function computeOpportunityScore(
  input: MimmozaValuationInput,
  marketValue: number | null
): OpportunityPartialResult {
  let score = 40; // base neutre

  // ── Delta prix demandé vs valeur marché ───────────────────────────────────
  let opportunityValue: number | null = null;
  if (marketValue !== null && input.askingPrice) {
    opportunityValue = marketValue - input.askingPrice;
    const decotePct = opportunityValue / marketValue;
    if (decotePct >= 0.15) score += 25;
    else if (decotePct >= 0.08) score += 15;
    else if (decotePct >= 0.03) score += 8;
    else if (decotePct < 0) score -= 10; // surcoté
  }

  // ── SmartScore ────────────────────────────────────────────────────────────
  if (input.smartScore !== null && input.smartScore !== undefined) {
    if (input.smartScore >= 80) score += 12;
    else if (input.smartScore >= 60) score += 7;
    else if (input.smartScore < 40) score -= 8;
  }

  // ── Risques géo ───────────────────────────────────────────────────────────
  const riskLevel = input.georisques?.globalRiskLevel;
  if (riskLevel === "low") score += 8;
  else if (riskLevel === "medium") score += 2;
  else if (riskLevel === "high") score -= 12;

  // ── PLU favorable ─────────────────────────────────────────────────────────
  if (input.plu?.constructible === true) score += 6;
  if (input.plu?.estimatedSdp && input.plu.estimatedSdp > 0) score += 4;

  // ── Tension locative ─────────────────────────────────────────────────────
  const tension = input.market?.rentalTension;
  if (tension === "high") score += 8;
  else if (tension === "medium") score += 3;
  else if (tension === "low") score -= 3;

  // ── Évolution prix ────────────────────────────────────────────────────────
  const evolution = input.market?.yearlyPriceEvolutionPct;
  if (evolution !== undefined && evolution !== null) {
    if (evolution >= 5) score += 6;
    else if (evolution >= 2) score += 3;
    else if (evolution < 0) score -= 5;
  }

  // ── Dynamique Sitadel ─────────────────────────────────────────────────────
  const sitadelTrend = input.sitadel?.trend;
  if (sitadelTrend === "up") score += 5;
  else if (sitadelTrend === "down") score -= 3;

  const finalScore = Math.max(0, Math.min(100, Math.round(score)));

  return {
    opportunityScore: finalScore,
    opportunityValue,
    opportunityLabel: resolveOpportunityLabel(finalScore),
  };
}

function resolveOpportunityLabel(score: number): OpportunityBadge {
  if (score >= 85) return "Opportunité forte";
  if (score >= 70) return "Opportunité intéressante";
  if (score >= 50) return "À vérifier";
  return "Risqué";
}