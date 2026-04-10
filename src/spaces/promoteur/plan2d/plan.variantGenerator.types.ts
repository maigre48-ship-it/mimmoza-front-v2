// src/spaces/promoteur/plan2d/plan.variantGenerator.types.ts

import type { PlanBuilding } from "./plan.types";

// ─── VARIANT KIND ─────────────────────────────────────────────────────

/**
 * Semantic category of a generated variant.
 *
 * Each kind maps to a deterministic transformation recipe applied to the
 * source scenario's buildings. The category drives both the logic in
 * plan.variantGenerator.ts and the label/description in the UI.
 *
 * Extensibility: add new kinds here and implement the corresponding
 * applyXxxVariant() function — the generator pipeline picks it up.
 *
 * Future additions:
 *   "rotated"            — orientation optimisation
 *   "split_massing"      — divide one large building into two
 *   "courtyard"          — hollow centre for planted open space
 *   "setback_perimeter"  — perimeter-aligned implantation
 */
export type GeneratedVariantKind =
  | "compact"              // reduce footprint to gain setback margin
  | "setback_optimized"    // shift toward parcel centroid + slight reduction
  | "densified";           // increase volume (levels or scale) conservatively

// ─── VARIANT ──────────────────────────────────────────────────────────

/**
 * A deterministically generated alternative to a source scenario.
 *
 * The `buildings` array contains modified PlanBuilding objects that can
 * be fed directly into buildScenarioSummary() via computeRealScenarioMetrics().
 *
 * Extensibility:
 *   transformSummary?  — human-readable diff vs source ("−10 % emprise")
 *   confidenceLevel?   — "high" | "medium" | "low" based on geometry quality
 *   sourceTransforms?  — log of applied transformations for audit
 */
export interface GeneratedVariant {
  /** Stable id: `variant-{kind}-{sourceScenarioId}` */
  id:               string;
  /** Id of the scenario this variant was derived from. */
  sourceScenarioId: string;
  /** Semantic transformation applied. */
  kind:             GeneratedVariantKind;
  /** Short business-readable French label. */
  label:            string;
  /** One-sentence description of the transformation logic. */
  description:      string;
  /** Modified buildings — geometry adjusted but structure preserved. */
  buildings:        PlanBuilding[];
}

// ─── GENERATOR CONFIG ─────────────────────────────────────────────────

/**
 * Parameters controlling the variant generation.
 *
 * All factors are multipliers (1.0 = no change, < 1.0 = reduce).
 * Defaults are conservative to prevent parcel containment violations.
 *
 * Extensibility: add per-kind overrides, PLU constraints, or user-
 * controlled sliders here without touching the generator core.
 */
export interface VariantGeneratorConfig {
  /** Scale reduction factor for the "compact" variant. Default: 0.88 */
  compactScaleFactor?:      number;
  /** Scale reduction factor for "setback_optimized". Default: 0.93 */
  setbackOptScaleFactor?:   number;
  /** Scale increase factor for "densified". Default: 1.12 */
  densifiedScaleFactor?:    number;
  /** Extra level added for "densified" when level data is available. Default: 1 */
  densifiedExtraLevels?:    number;
  /** Maximum scale allowed in any variant (safety cap). Default: 1.5 */
  maxScaleCap?:             number;
  /** Minimum scale allowed in any variant (safety floor). Default: 0.5 */
  minScaleFloor?:           number;
}