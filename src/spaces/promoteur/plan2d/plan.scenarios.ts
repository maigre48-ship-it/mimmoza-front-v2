// src/spaces/promoteur/plan2d/plan.scenarios.ts

import type { Vec2, PlanBuilding } from "./plan.types";
import type { PluRules } from "./plan.plu.types";
import type {
  ImplantationScenario,
  ImplantationScenarioMetrics,
  ScenarioStatus,
  ScenarioComparison,
} from "./plan.scenarios.types";
import { polygonArea, computeTotalFootprintArea, computeCoverageRatio } from "./plan.plu.metrics";
import { applyScenarioScores, getBestScoringScenarioId } from "./plan.scenarioScore";
import { buildScenarioRecommendationLayer } from "./plan.scenarioNotes";

// ─── STATUS DERIVATION ────────────────────────────────────────────────

/**
 * Derives the global compliance status for a scenario's metrics
 * given a set of PLU rules.
 *
 * Priority: BLOQUANT > LIMITE > CONFORME.
 *
 * Heuristics used (consistent with plan.plu.rules.ts thresholds):
 *   • blockingCount > 0 or CES exceeded                  → BLOQUANT
 *   • limitedCount > 0 or CES within 10 % of max         → LIMITE
 *   • otherwise                                           → CONFORME
 */
function deriveStatus(
  metrics: ImplantationScenarioMetrics,
  rules:   PluRules,
): ScenarioStatus {
  const maxCES = rules.maxCoverageRatio ?? Infinity;

  if (metrics.blockingCount > 0 || metrics.coverageRatio > maxCES) {
    return "BLOQUANT";
  }
  if (metrics.limitedCount > 0 || metrics.coverageRatio > maxCES * 0.90) {
    return "LIMITE";
  }
  return "CONFORME";
}

// ─── RECOMMENDATION DERIVATION ────────────────────────────────────────

function deriveRecommendation(
  status:  ScenarioStatus,
  metrics: ImplantationScenarioMetrics,
): string {
  if (status === "CONFORME") {
    if (metrics.coverageRatio < 0.30) {
      return "Schéma conforme mais sous-densifié — potentiel d'optimisation du programme.";
    }
    return "Schéma conforme — recommandé pour poursuite de l'étude financière.";
  }
  if (status === "LIMITE") {
    return "Schéma acceptable sous réserve d'ajustements — vérifier les points limites avant validation comité.";
  }
  return "Schéma non conforme — révision du plan masse nécessaire avant tout engagement.";
}

// ─── RECOMMENDED SELECTION ────────────────────────────────────────────

/**
 * Selects the recommended scenario from a list, applying a priority order:
 *   1. The only CONFORME scenario if there is exactly one.
 *   2. Among CONFORME scenarios, the one with the highest coverage ratio
 *      (best use of the parcel) without exceeding LIMITE thresholds.
 *   3. Among LIMITE scenarios (if no CONFORME), the one with fewest violations.
 *   4. null if all scenarios are BLOQUANT.
 *
 * Returns the scenario id, or null when no good candidate exists.
 *
 * Pure function — stable results for the same input.
 */
export function selectRecommendedScenario(
  scenarios: readonly ImplantationScenario[],
): string | null {
  const conforme = scenarios.filter(s => s.globalStatus === "CONFORME");
  if (conforme.length > 0) {
    // Best efficiency among compliant scenarios
    const best = [...conforme].sort(
      (a, b) => b.metrics.coverageRatio - a.metrics.coverageRatio,
    )[0];
    return best?.id ?? null;
  }

  const limite = scenarios.filter(s => s.globalStatus === "LIMITE");
  if (limite.length > 0) {
    // Fewest violations
    const best = [...limite].sort(
      (a, b) =>
        (a.metrics.blockingCount + a.metrics.limitedCount) -
        (b.metrics.blockingCount + b.metrics.limitedCount),
    )[0];
    return best?.id ?? null;
  }

  return null;
}

// ─── SCENARIO BUILDER ─────────────────────────────────────────────────

export interface BuildScenarioParams {
  id:          string;
  label:       string;
  description?: string;
  buildings:   readonly PlanBuilding[];
  /** Pre-computed or approximated metrics for this scenario. */
  metrics:     ImplantationScenarioMetrics;
  pluRules:    PluRules;
  active?:     boolean;
  recommended?: boolean;
}

/**
 * Builds a complete ImplantationScenario from its parts.
 *
 * Derives globalStatus and recommendation from the provided metrics + rules
 * so callers only need to supply the raw numbers.
 *
 * Pure function — no side-effects, no mutation.
 */
export function buildScenarioSummary(
  params: BuildScenarioParams,
): ImplantationScenario {
  const globalStatus   = deriveStatus(params.metrics, params.pluRules);
  const recommendation = deriveRecommendation(globalStatus, params.metrics);

  return {
    id:             params.id,
    label:          params.label,
    description:    params.description,
    buildings:      params.buildings,
    metrics:        params.metrics,
    globalStatus,
    recommendation,
    active:         params.active  ?? false,
    recommended:    params.recommended ?? false,
    recommendationLayer: buildScenarioRecommendationLayer({
      label:         params.label,
      globalStatus,
      blockingCount: params.metrics.blockingCount,
      limitedCount:  params.metrics.limitedCount,
      coverageRatio: params.metrics.coverageRatio,
      recommended:   params.recommended ?? false,
    }),
  };
}

// ─── LIST BUILDER ─────────────────────────────────────────────────────

/**
 * Builds a list of scenarios, scores them, and marks the recommended one.
 * The recommended scenario is the highest-scoring one (score engine).
 * Falls back to selectRecommendedScenario if no scores are available.
 *
 * Pure — returns a new array. Input scenarios are never mutated.
 */
export function buildScenarioList(
  scenarios: ImplantationScenario[],
): ImplantationScenario[] {
  // Apply scores + ranks
  const scored = applyScenarioScores(scenarios);
  // Use the score engine to determine the recommended scenario
  const recommendedId = getBestScoringScenarioId(scored) ?? selectRecommendedScenario(scored);
  return scored.map(s => {
    const isRecommended = s.id === recommendedId;
    const refreshedLayer = buildScenarioRecommendationLayer({
      label:         s.label,
      globalStatus:  s.globalStatus,
      blockingCount: s.metrics.blockingCount,
      limitedCount:  s.metrics.limitedCount,
      coverageRatio: s.metrics.coverageRatio,
      scoreOverall:  s.score?.breakdown.overall,
      recommended:   isRecommended,
    });
    return {
      ...s,
      recommended:         isRecommended,
      recommendationLayer: refreshedLayer,
    };
  });
}

// ─── COMPARISON BUILDER ───────────────────────────────────────────────

/**
 * Assembles the full ScenarioComparison context object.
 * Computes parcel area and resolves active / recommended IDs.
 */
export function buildScenarioComparison(params: {
  parcel:          Vec2[];
  scenarios:       ImplantationScenario[];
  activeScenarioId: string | null;
}): ScenarioComparison {
  const recommendedScenarioId = selectRecommendedScenario(params.scenarios);
  return {
    parcelAreaM2:         polygonArea(params.parcel),
    scenarios:            params.scenarios,
    activeScenarioId:     params.activeScenarioId,
    recommendedScenarioId,
  };
}

// ─── MOCK SCENARIO HELPERS ────────────────────────────────────────────
//
// These helpers generate approximate metrics for demo / V1 scenarios.
// Replace with proper PLU-engine-driven computation in production.

/**
 * Computes approximate scenario metrics from a buildings array + parcel.
 * Suitable for the "current" scenario where real data is available.
 */
export function computeRealScenarioMetrics(params: {
  buildings:   readonly PlanBuilding[];
  parcel:      Vec2[];
  blockingCount: number;
  limitedCount:  number;
}): ImplantationScenarioMetrics {
  const totalFootprintM2 = computeTotalFootprintArea(params.buildings as PlanBuilding[]);
  const parcelArea       = polygonArea(params.parcel);
  const coverageRatio    = computeCoverageRatio(totalFootprintM2, parcelArea);
  return {
    totalFootprintM2,
    coverageRatio,
    buildingCount:  params.buildings.length,
    blockingCount:  params.blockingCount,
    limitedCount:   params.limitedCount,
  };
}

/**
 * Scales a base metric set by a footprint factor.
 * Used for synthetic "denser" / "conservative" demo scenarios.
 *
 * `footprintFactor` > 1 = denser, < 1 = smaller.
 * PLU violation counts are re-derived from the scaled CES.
 */
export function scaleScenarioMetrics(
  base:          ImplantationScenarioMetrics,
  footprintFactor: number,
  pluRules:      PluRules,
  buildingCountDelta: number = 0,
): ImplantationScenarioMetrics {
  const totalFootprintM2 = base.totalFootprintM2 * footprintFactor;
  const coverageRatio    = base.coverageRatio    * footprintFactor;
  const maxCES           = pluRules.maxCoverageRatio ?? 0.60;

  const blockingCount = coverageRatio > maxCES ? 1 : 0;
  const limitedCount  = !blockingCount && coverageRatio > maxCES * 0.90 ? 1 : 0;

  return {
    totalFootprintM2,
    coverageRatio,
    buildingCount:  Math.max(1, base.buildingCount + buildingCountDelta),
    blockingCount,
    limitedCount,
  };
}