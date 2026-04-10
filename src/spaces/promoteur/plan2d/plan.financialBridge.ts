// src/spaces/promoteur/plan2d/plan.financialBridge.ts

import type { ImplantationScenario } from "./plan.scenarios.types";
import type {
  FinancialBridgeAssumptions,
  FinancialBridgeResult,
} from "./plan.financialBridge.types";

// ─── CONSTANTS ────────────────────────────────────────────────────────

const DEFAULT_AVERAGE_UNIT_SIZE_M2 = 60;
const DEFAULT_FALLBACK_LEVELS       = 4;    // R+3
const MIN_VIABLE_MARGIN_PCT         = 0.08; // 8 % = warning threshold
const MIN_VIABLE_SALEABLE_M2        = 100;  // below = warn

// ─── WEIGHTED AVERAGE LEVELS ──────────────────────────────────────────

/**
 * Estimates the weighted average number of above-ground levels across all
 * buildings in the scenario, using footprint as the weighting factor.
 *
 * Falls back to `fallbackLevels` when no buildings carry level data.
 */
function computeWeightedAverageLevels(
  scenario:       ImplantationScenario,
  fallbackLevels: number,
): number {
  let weightedSum   = 0;
  let totalFootprint = 0;

  for (const b of scenario.buildings) {
    const levels = b.levels ?? 0;
    if (levels > 0) {
      const area = scenario.metrics.totalFootprintM2 / Math.max(1, scenario.buildings.length);
      weightedSum    += levels * area;
      totalFootprint += area;
    }
  }

  if (totalFootprint < 1e-6) return fallbackLevels;
  return weightedSum / totalFootprint;
}

// ─── WARNINGS BUILDER ─────────────────────────────────────────────────

function buildWarnings(params: {
  globalStatus:         string;
  saleableAreaM2:       number;
  grossMarginPct:       number;
  landCostProvided:     boolean;
  usingFallbackLevels:  boolean;
}): string[] {
  const w: string[] = [];

  if (params.globalStatus === "BLOQUANT") {
    w.push("Le scénario présente des non-conformités PLU bloquantes — les résultats financiers sont indicatifs uniquement.");
  } else if (params.globalStatus === "LIMITE") {
    w.push("Le scénario est en limite réglementaire — valider la conformité avant engagement financier.");
  }

  if (params.saleableAreaM2 < MIN_VIABLE_SALEABLE_M2 && params.saleableAreaM2 > 0) {
    w.push(`Surface vendable estimée faible (${Math.round(params.saleableAreaM2)} m²) — vérifier le programme et les niveaux.`);
  }

  if (params.grossMarginPct < MIN_VIABLE_MARGIN_PCT && params.grossMarginPct > -Infinity) {
    if (params.grossMarginPct < 0) {
      w.push("Marge brute négative — opération structurellement déficitaire avec ces hypothèses.");
    } else {
      w.push(`Marge brute faible (${(params.grossMarginPct * 100).toFixed(1)} %) — opération difficile à équilibrer en l'état.`);
    }
  }

  if (!params.landCostProvided) {
    w.push("Coût foncier non renseigné — la marge brute n'intègre pas l'acquisition du terrain.");
  }

  if (params.usingFallbackLevels) {
    w.push("Nombre de niveaux non défini sur les bâtiments — estimation de surface basée sur une valeur par défaut (R+3).");
  }

  w.push("Estimation préliminaire — hypothèses à confirmer avec l'architecte et le commercialisateur.");

  return w;
}

// ─── SUMMARY BUILDER ──────────────────────────────────────────────────

function buildSummary(
  marginPct: number,
  revenue:   number,
  units:     number,
): string {
  const fmtK = (v: number) =>
    v >= 1_000_000
      ? `${(v / 1_000_000).toFixed(2)} M€`
      : `${Math.round(v / 1000)} k€`;

  if (revenue <= 0) {
    return "Aucun chiffre d'affaires estimable — vérifier les hypothèses de programme.";
  }

  const marginStr = `${(marginPct * 100).toFixed(1)} %`;

  if (marginPct < 0) {
    return `Programme déficitaire en l'état — CA potentiel ${fmtK(revenue)} pour ${units} lot${units > 1 ? "s" : ""}, marge brute ${marginStr}.`;
  }
  if (marginPct < MIN_VIABLE_MARGIN_PCT) {
    return `Programme sous tension — CA potentiel ${fmtK(revenue)} pour ${units} lot${units > 1 ? "s" : ""}, marge brute limitée à ${marginStr}.`;
  }
  return `Programme préliminairement viable — CA potentiel ${fmtK(revenue)} pour ${units} lot${units > 1 ? "s" : ""}, marge brute ${marginStr}.`;
}

// ─── MAIN FUNCTION ────────────────────────────────────────────────────

/**
 * Computes the financial bridge for the active scenario.
 *
 * Returns null when no scenario is provided (panel shows empty state).
 *
 * Pure function — no side-effects, no mutation.
 *
 * V1 formula chain:
 *   floorArea     = footprint × weightedLevels
 *   saleableArea  = floorArea × floorEfficiencyRatio
 *   unitCount     = saleableArea / averageUnitSizeM2
 *   revenue       = saleableArea × salePricePerM2
 *   constructCost = floorArea × constructionCostPerM2
 *   grossMargin   = revenue − constructCost − landCost
 */
export function computeFinancialBridge(params: {
  scenario:    ImplantationScenario | null;
  assumptions: FinancialBridgeAssumptions;
}): FinancialBridgeResult | null {
  const { scenario, assumptions } = params;
  if (!scenario || scenario.metrics.totalFootprintM2 <= 0) return null;

  const {
    floorEfficiencyRatio,
    salePricePerM2,
    constructionCostPerM2,
    landCost         = 0,
    averageUnitSizeM2 = DEFAULT_AVERAGE_UNIT_SIZE_M2,
    fallbackLevels    = DEFAULT_FALLBACK_LEVELS,
  } = assumptions;

  // ── Levels ──────────────────────────────────────────────────────
  const weightedLevels   = computeWeightedAverageLevels(scenario, fallbackLevels);
  const usingFallback    = weightedLevels === fallbackLevels &&
    !scenario.buildings.some(b => (b.levels ?? 0) > 0);

  // ── Area chain ──────────────────────────────────────────────────
  const footprintM2          = scenario.metrics.totalFootprintM2;
  const floorAreaM2          = footprintM2 * weightedLevels;
  const saleableAreaM2       = floorAreaM2 * Math.min(1, Math.max(0, floorEfficiencyRatio));
  const unitCount            = Math.max(0, Math.floor(saleableAreaM2 / Math.max(1, averageUnitSizeM2)));

  // ── Financial ───────────────────────────────────────────────────
  const revenue              = saleableAreaM2 * Math.max(0, salePricePerM2);
  const constructionCost     = floorAreaM2    * Math.max(0, constructionCostPerM2);
  const landCostSafe         = Math.max(0, landCost);
  const grossMargin          = revenue - constructionCost - landCostSafe;
  const grossMarginPct       = revenue > 0 ? grossMargin / revenue : 0;

  const warnings = buildWarnings({
    globalStatus:        scenario.globalStatus,
    saleableAreaM2,
    grossMarginPct,
    landCostProvided:    landCost > 0,
    usingFallbackLevels: usingFallback,
  });

  return {
    footprintM2,
    estimatedFloorAreaM2:       Math.round(floorAreaM2),
    estimatedSaleableAreaM2:    Math.round(saleableAreaM2),
    estimatedUnitCount:         unitCount,
    estimatedRevenue:           Math.round(revenue),
    estimatedConstructionCost:  Math.round(constructionCost),
    estimatedLandCost:          Math.round(landCostSafe),
    estimatedGrossMargin:       Math.round(grossMargin),
    estimatedGrossMarginPct:    grossMarginPct,
    weightedAverageLevels:      Math.round(weightedLevels * 10) / 10,
    warnings,
    summary: buildSummary(grossMarginPct, revenue, unitCount),
  };
}