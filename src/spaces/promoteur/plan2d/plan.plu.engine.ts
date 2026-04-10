// src/spaces/promoteur/plan2d/plan.plu.engine.ts

import type { Vec2, PlanBuilding } from "./plan.types";
import type { PluRules, PluEngineResult, PluRuleStatus, PluRuleResult } from "./plan.plu.types";
import { PLU_STATUS_WEIGHT } from "./plan.plu.types";
import { computePluMetrics } from "./plan.plu.metrics";
import { ALL_RULE_CHECKERS } from "./plan.plu.rules";

// ─── AGGREGATION HELPERS ──────────────────────────────────────────────

/**
 * Returns the worst (highest-severity) status across a list of results.
 * Falls back to CONFORME when the list is empty (no rules → no violations).
 */
function aggregateStatus(results: PluRuleResult[]): PluRuleStatus {
  if (!results.length) return "CONFORME";

  let worst: PluRuleStatus = "CONFORME";
  for (const r of results) {
    if (PLU_STATUS_WEIGHT[r.status] > PLU_STATUS_WEIGHT[worst]) {
      worst = r.status;
      if (worst === "BLOQUANT") break; // short-circuit — can't get worse
    }
  }
  return worst;
}

// ─── ENGINE ───────────────────────────────────────────────────────────

/**
 * Parameters accepted by the PLU engine.
 *
 * All fields are required for a meaningful check except
 * `providedParkingSpaces`, which defaults to 0 when not supplied
 * (conservative assumption — the project must prove it provides parking).
 */
export interface RunPluChecksParams {
  /** World-space parcel polygon (Vec2[]). */
  parcel: Vec2[];
  /** All buildings in the plan project. */
  buildings: PlanBuilding[];
  /** Normalised PLU rules extracted from the local PLU document. */
  rules: PluRules;
  /**
   * Number of parking spaces provided in the project.
   * Pass `editor.project.parkings.length` or a manually entered value.
   * Defaults to 0 (worst-case assumption) when omitted.
   */
  providedParkingSpaces?: number;
}

/**
 * Runs a full PLU compliance pass over the given project.
 *
 * The function is **pure** — it has no side-effects and always returns a
 * fresh `PluEngineResult`. Memoisation is the caller's responsibility.
 *
 * Pipeline
 * ────────
 * 1. Compute all project metrics (geometry + programme).
 * 2. Run every registered rule-checker; collect non-null results.
 * 3. Aggregate: globalStatus = worst individual status.
 * 4. Build blockingIssues list for summary banners and PDF export.
 *
 * Extensibility
 * ─────────────
 * • Add new rule-checkers to `ALL_RULE_CHECKERS` in plan.plu.rules.ts —
 *   no changes needed here.
 * • Add new fields to `PluRules` and `PluMetricSet` — the engine
 *   forwards the whole metric set to every checker transparently.
 * • Wrap this function to inject pre/post middleware (e.g., PLU zone
 *   lookup, caching, telemetry) without touching core logic.
 */
export function runPluChecks(params: RunPluChecksParams): PluEngineResult {
  const {
    parcel,
    buildings,
    rules,
    providedParkingSpaces = 0,
  } = params;

  // ── 1. Metrics ────────────────────────────────────────────────────
  const metrics = computePluMetrics({
    parcel,
    buildings,
    providedParkingSpaces,
    parkingSpacesPerUnit: rules.parkingSpacesPerUnit,
  });

  // ── 2. Rule evaluation ────────────────────────────────────────────
  const ruleResults: PluRuleResult[] = [];

  for (const checker of ALL_RULE_CHECKERS) {
    const result = checker(metrics, rules);
    if (result !== null) {
      ruleResults.push(result);
    }
  }

  // ── 3. Aggregation ────────────────────────────────────────────────
  const globalStatus = aggregateStatus(ruleResults);

  // ── 4. Blocking issues ────────────────────────────────────────────
  const blockingIssues = ruleResults
    .filter(r => r.status === "BLOQUANT")
    .map(r => r.message);

  return {
    metrics,
    rules:          ruleResults,
    globalStatus,
    blockingIssues,
  };
}

// ─── CONVENIENCE: SINGLE-BUILDING CHECK ──────────────────────────────

/**
 * Runs the PLU engine for a single building against the parcel.
 * Useful for per-building validation during interactive editing
 * (e.g., sidebar warnings while the user drags a building).
 *
 * Identical semantics to runPluChecks — just a convenience wrapper.
 */
export function runPluChecksForBuilding(params: {
  parcel: Vec2[];
  building: PlanBuilding;
  rules: PluRules;
  providedParkingSpaces?: number;
}): PluEngineResult {
  return runPluChecks({
    ...params,
    buildings: [params.building],
  });
}