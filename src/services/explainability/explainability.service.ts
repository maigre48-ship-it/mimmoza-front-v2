// =============================================================================
// Mimmoza — Explainability Engine
// explainability.service.ts
//
// Règles DÉTERMINISTES. Aucune IA. Mêmes entrées => mêmes sorties.
// =============================================================================

import type {
  DecisionInput,
  ExplanationFactor,
  ExplanationResult,
  FactorCategory,
  FactorType,
  MimmozaDecision,
  OpportunityExplainInput,
  ValuationExplainInput,
} from "./explainability.types";

// ----------------------------------------------------------------------------- 
// Helpers
// -----------------------------------------------------------------------------

const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));

const isNum = (x: unknown): x is number =>
  typeof x === "number" && Number.isFinite(x);

/** Contribution signée d'un facteur : magnitude * signe(type). */
const signed = (f: ExplanationFactor): number =>
  f.type === "positive" ? f.impact : f.type === "negative" ? -f.impact : 0;

function factor(
  id: string,
  type: FactorType,
  category: FactorCategory,
  label: string,
  impact: number,
  description?: string,
): ExplanationFactor {
  return { id, type, category, label, impact: clamp(impact, 0, 1), description };
}

/**
 * Score 0..100 reconstruit à partir des facteurs.
 * base 50 (neutre) + somme des contributions signées * WEIGHT, borné [0,100].
 * WEIGHT calibré pour qu'une poignée de facteurs forts déplace le score
 * de façon lisible sans saturer instantanément.
 */
function scoreFromFactors(factors: ExplanationFactor[], base = 50, weight = 16) {
  const delta = factors.reduce((s, f) => s + signed(f) * weight, 0);
  return Math.round(clamp(base + delta, 0, 100));
}

/** Tri d'affichage : magnitude décroissante, positifs avant négatifs. */
function sortForDisplay(factors: ExplanationFactor[]): ExplanationFactor[] {
  const rank = (t: FactorType) => (t === "positive" ? 0 : t === "negative" ? 1 : 2);
  return [...factors].sort(
    (a, b) => rank(a.type) - rank(b.type) || b.impact - a.impact,
  );
}

/** Déduplication par id (les facteurs externes ne doivent pas écraser les calculs). */
function merge(
  internal: ExplanationFactor[],
  external?: ExplanationFactor[],
): ExplanationFactor[] {
  if (!external?.length) return internal;
  const seen = new Set(internal.map((f) => f.id));
  return [...internal, ...external.filter((f) => !seen.has(f.id))];
}

export const selectPositive = (r: ExplanationResult) =>
  sortForDisplay(r.factors.filter((f) => f.type === "positive"));
export const selectNegative = (r: ExplanationResult) =>
  sortForDisplay(r.factors.filter((f) => f.type === "negative"));

// -----------------------------------------------------------------------------
// PHASE 2 — VALORISATION EXPLICABLE
// -----------------------------------------------------------------------------

export function buildValuationExplanation(
  input: ValuationExplainInput,
): ExplanationResult {
  const { valuation, dvf, mobility, risk, market } = input;
  const f: ExplanationFactor[] = [];

  // --- DVF : profondeur & fraîcheur des comparables ------------------------
  if (dvf) {
    if (isNum(dvf.comparablesCount)) {
      if (dvf.comparablesCount >= 8)
        f.push(factor("dvf_comps_high", "positive", "dvf", "Comparables DVF nombreux", 0.7,
          `${dvf.comparablesCount} comparables retenus`));
      else if (dvf.comparablesCount >= 4)
        f.push(factor("dvf_comps_mid", "positive", "dvf", "Comparables DVF suffisants", 0.4,
          `${dvf.comparablesCount} comparables retenus`));
      else if (dvf.comparablesCount < 2)
        f.push(factor("dvf_comps_low", "negative", "dvf", "Comparables DVF insuffisants", 0.5,
          `Seulement ${dvf.comparablesCount} comparable(s)`));
    }
    if (isNum(dvf.recentCount) && dvf.recentCount >= 5)
      f.push(factor("dvf_recent", "positive", "dvf", "Comparables DVF récents", 0.6,
        `${dvf.recentCount} transactions < 12 mois`));

    if (dvf.marketDepth === "high")
      f.push(factor("dvf_depth_high", "positive", "dvf", "Forte profondeur de marché", 0.6));
    else if (dvf.marketDepth === "low")
      f.push(factor("dvf_depth_low", "negative", "dvf", "Faible profondeur de marché", 0.5));
  }

  // --- Marché local --------------------------------------------------------
  if (market) {
    if (isNum(market.dynamism)) {
      if (market.dynamism >= 65)
        f.push(factor("mkt_active", "positive", "market", "Marché local actif", 0.6));
      else if (market.dynamism <= 35)
        f.push(factor("mkt_atone", "negative", "market", "Marché local atone", 0.5));
    }
    if (market.trend === "up")
      f.push(factor("mkt_trend_up", "positive", "market", "Marché haussier", 0.4));
    else if (market.trend === "down")
      f.push(factor("mkt_trend_down", "negative", "market", "Marché en repli", 0.4));
  }

  // --- Mobilité (GTFS) -----------------------------------------------------
  if (mobility && isNum(mobility.score)) {
    if (mobility.score >= 70)
      f.push(factor("mob_good", "positive", "mobility", "Bonne desserte transport", 0.5,
        isNum(mobility.stopsNearby) ? `${mobility.stopsNearby} arrêts à proximité` : undefined));
    else if (mobility.score <= 30)
      f.push(factor("mob_poor", "negative", "mobility", "Faible desserte transport", 0.4));
  }

  // --- Risques (géorisques) ------------------------------------------------
  if (risk) {
    if (risk.flood)
      f.push(factor("risk_flood", "negative", "risk", "Risque inondation", 0.6));
    if (risk.severity === "high")
      f.push(factor("risk_high", "negative", "risk", "Exposition aux risques élevée", 0.6,
        risk.flags?.length ? risk.flags.join(", ") : undefined));
    else if (risk.severity === "low" && !risk.flood)
      f.push(factor("risk_low", "positive", "risk", "Faible exposition aux risques", 0.3));
  }

  // --- Prix demandé vs valeur estimée -------------------------------------
  if (isNum(valuation.askingPrice) && isNum(valuation.estimatedValue) && valuation.estimatedValue > 0) {
    const gap = (valuation.askingPrice - valuation.estimatedValue) / valuation.estimatedValue;
    if (gap > 0.10)
      f.push(factor("price_over", "negative", "market", "Prix demandé supérieur au marché",
        clamp(gap * 3, 0.4, 0.9), `+${Math.round(gap * 100)} % vs estimation`));
    else if (gap < -0.05)
      f.push(factor("price_under", "positive", "market", "Prix demandé inférieur au marché",
        clamp(-gap * 3, 0.4, 0.9), `${Math.round(gap * 100)} % vs estimation`));
  }

  // --- Fiabilité de l'estimation ------------------------------------------
  if (isNum(valuation.confidence)) {
    if (valuation.confidence >= 0.75)
      f.push(factor("val_conf_high", "positive", "dvf", "Estimation fiable", 0.4));
    else if (valuation.confidence <= 0.4)
      f.push(factor("val_conf_low", "negative", "dvf", "Estimation incertaine", 0.4));
  }

  const factors = merge(f, input.externalFactors);

  // Score : on EXPLIQUE le score amont s'il existe, sinon on le reconstruit.
  const score = isNum(valuation.providedScore)
    ? Math.round(clamp(valuation.providedScore, 0, 100))
    : scoreFromFactors(factors);

  return { score, factors, recommendation: valuationRecommendation(score, factors) };
}

function valuationRecommendation(score: number, factors: ExplanationFactor[]): string {
  const over = factors.find((f) => f.id === "price_over");
  if (over) return "Valeur soutenable mais prix affiché au-dessus du marché.";
  if (score >= 70) return "Valorisation solide et bien étayée.";
  if (score <= 40) return "Valorisation fragile : données ou marché insuffisants.";
  return "Valorisation cohérente avec les données disponibles.";
}

// -----------------------------------------------------------------------------
// PHASE 3 — OPPORTUNITÉ EXPLICABLE
// -----------------------------------------------------------------------------

export function buildOpportunityExplanation(
  input: OpportunityExplainInput,
): ExplanationResult {
  const { opportunity, market, dvf } = input;
  const f: ExplanationFactor[] = [];

  // --- Décote --------------------------------------------------------------
  if (isNum(opportunity.discountPct)) {
    if (opportunity.discountPct >= 5)
      f.push(factor("opp_discount", "positive", "opportunity",
        `Décote ${Math.round(opportunity.discountPct)} %`,
        clamp(opportunity.discountPct / 20, 0.3, 0.9)));
    else if (opportunity.discountPct <= -3)
      f.push(factor("opp_premium", "negative", "opportunity",
        `Surcote ${Math.abs(Math.round(opportunity.discountPct))} %`,
        clamp(-opportunity.discountPct / 20, 0.3, 0.9)));
  }

  // --- Marché / liquidité --------------------------------------------------
  if (market) {
    if (isNum(market.dynamism) && market.dynamism >= 65)
      f.push(factor("opp_mkt_dyn", "positive", "market", "Marché dynamique", 0.5));
    if (market.liquidity === "high")
      f.push(factor("opp_liq_high", "positive", "market", "Bonne liquidité", 0.5));
    else if (market.liquidity === "low")
      f.push(factor("opp_liq_low", "negative", "market", "Faible liquidité", 0.5));
  }
  if (dvf?.marketDepth === "high")
    f.push(factor("opp_depth", "positive", "dvf", "Forte profondeur de marché", 0.4));

  // --- Rentabilité ---------------------------------------------------------
  if (isNum(opportunity.yieldPct)) {
    if (opportunity.yieldPct >= 6)
      f.push(factor("opp_yield_good", "positive", "opportunity", "Bonne rentabilité", 0.6,
        `${opportunity.yieldPct.toFixed(1)} %`));
    else if (opportunity.yieldPct < 3)
      f.push(factor("opp_yield_low", "negative", "opportunity", "Faible rentabilité", 0.6,
        `${opportunity.yieldPct.toFixed(1)} %`));
  }

  // --- Travaux -------------------------------------------------------------
  if (opportunity.worksHeavy)
    f.push(factor("opp_works", "negative", "opportunity", "Travaux importants",
      isNum(opportunity.worksCost) ? clamp(opportunity.worksCost / 300000, 0.4, 0.9) : 0.6,
      isNum(opportunity.worksCost)
        ? `${Math.round(opportunity.worksCost).toLocaleString("fr-FR")} €`
        : undefined));

  const factors = merge(f, input.externalFactors);

  const score = isNum(opportunity.providedScore)
    ? Math.round(clamp(opportunity.providedScore, 0, 100))
    : scoreFromFactors(factors);

  return { score, factors, recommendation: opportunityRecommendation(score) };
}

function opportunityRecommendation(score: number): string {
  if (score >= 70) return "Opportunité attractive.";
  if (score <= 40) return "Opportunité limitée.";
  return "Opportunité moyenne, à affiner.";
}

// -----------------------------------------------------------------------------
// PHASE 5 — DÉCISION MIMMOZA (synthèse déterministe)
// -----------------------------------------------------------------------------

const VERDICT_MESSAGE = {
  ACHAT_DECONSEILLE: "Achat déconseillé au prix affiché.",
  NEGOCIATION_RECOMMANDEE: "Négociation fortement recommandée.",
  PRIX_COHERENT: "Prix cohérent avec le marché.",
  POTENTIEL_INVESTISSEUR_FAIBLE: "Potentiel investisseur faible.",
  POTENTIEL_PROMOTEUR_LIMITE: "Potentiel promoteur limité.",
} as const;

export function buildMimmozaDecision(input: DecisionInput): MimmozaDecision {
  const {
    estimatedValue, askingPrice, profile = "auto",
    yieldPct, worksHeavy, riskSeverity, valuation, opportunity,
  } = input;

  // Écart prix demandé / valeur estimée
  const over =
    isNum(askingPrice) && isNum(estimatedValue) && estimatedValue > 0
      ? (askingPrice - estimatedValue) / estimatedValue
      : null;

  const negatives = selectNegative(opportunity).concat(selectNegative(valuation));
  const drivers = negatives.slice(0, 3);

  let verdict: keyof typeof VERDICT_MESSAGE;

  if (riskSeverity === "high" && over !== null && over > 0.10) {
    verdict = "ACHAT_DECONSEILLE";
  } else if (over !== null && over > 0.15) {
    verdict = "ACHAT_DECONSEILLE";
  } else if (over !== null && over > 0.05) {
    verdict = "NEGOCIATION_RECOMMANDEE";
  } else if (profile === "investisseur" &&
    (((isNum(yieldPct) && yieldPct < 3)) || (worksHeavy && isNum(yieldPct) && yieldPct < 4))) {
    verdict = "POTENTIEL_INVESTISSEUR_FAIBLE";
  } else if (profile === "promoteur" && opportunity.score < 40) {
    verdict = "POTENTIEL_PROMOTEUR_LIMITE";
  } else if (over !== null && Math.abs(over) <= 0.05) {
    verdict = "PRIX_COHERENT";
  } else if (opportunity.score >= 60 && valuation.score >= 55) {
    verdict = "PRIX_COHERENT";
  } else if (profile === "investisseur") {
    verdict = "POTENTIEL_INVESTISSEUR_FAIBLE";
  } else if (profile === "promoteur") {
    verdict = "POTENTIEL_PROMOTEUR_LIMITE";
  } else {
    verdict = "NEGOCIATION_RECOMMANDEE";
  }

  return { verdict, message: VERDICT_MESSAGE[verdict], drivers };
}