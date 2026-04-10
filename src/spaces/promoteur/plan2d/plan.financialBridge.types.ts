// src/spaces/promoteur/plan2d/plan.financialBridge.types.ts

// ─── ASSUMPTIONS ──────────────────────────────────────────────────────

/**
 * Input assumptions for the financial bridge.
 *
 * V1: manually set or drawn from project context.
 * V2: will be linked to market data, PLU programme, and zoning.
 *
 * Extensibility roadmap:
 *   vatRatePct?             — TVA rate (5.5 % / 10 % / 20 %)
 *   agencyFeePct?           — commercialisation fee
 *   developerFeePct?        — maîtrise d'ouvrage / fee on revenue
 *   financingCostPct?       — cost of debt as % of total investment
 *   parkingRevenuePerSpace? — for mixed programmes
 *   programMix?             — { logement: 0.8, commerce: 0.2 }
 */
export interface FinancialBridgeAssumptions {
  /**
   * Ratio of saleable area to gross floor area (SHAB / SDP).
   * Typical range: 0.80–0.88 for residential.
   */
  floorEfficiencyRatio: number;
  /** Average sale price per m² of saleable area (€/m²). */
  salePricePerM2: number;
  /** All-in construction cost per m² of gross floor area (€/m²). */
  constructionCostPerM2: number;
  /** Foncier cost — total land acquisition incl. fees (€). Optional: 0 when unknown. */
  landCost?: number;
  /** Average unit size for unit count estimation (m² SHAB). Default: 60 m². */
  averageUnitSizeM2?: number;
  /**
   * Average number of above-ground levels to use when building level data
   * is unavailable. Default: 4 (R+3).
   */
  fallbackLevels?: number;
}

// ─── RESULT ───────────────────────────────────────────────────────────

/**
 * Preliminary financial readout produced by the financial bridge.
 *
 * All monetary values in euros (€).
 * All area values in square metres (m²).
 *
 * Extensibility:
 *   netMargin?       — after agency / developer fees
 *   irr?             — requires cash-flow projection, not V1
 *   breakEvenPrice?  — minimum sale price for margin threshold
 *   sensitivityBand? — margin range for ±10 % price variation
 */
export interface FinancialBridgeResult {
  /** Total building footprint area from scenario (m²). */
  footprintM2: number;
  /** Estimated gross floor area = footprint × weighted levels (m²). */
  estimatedFloorAreaM2: number;
  /** Estimated saleable area = floorArea × floorEfficiencyRatio (m²). */
  estimatedSaleableAreaM2: number;
  /** Estimated number of residential units. */
  estimatedUnitCount: number;
  /** Estimated sales revenue = saleableArea × salePricePerM2 (€). */
  estimatedRevenue: number;
  /** Estimated construction cost = floorArea × constructionCostPerM2 (€). */
  estimatedConstructionCost: number;
  /** Foncier cost as provided in assumptions (€). */
  estimatedLandCost: number;
  /** estimatedRevenue − estimatedConstructionCost − estimatedLandCost (€). */
  estimatedGrossMargin: number;
  /** estimatedGrossMargin / estimatedRevenue (0–1). NaN-safe: 0 when revenue = 0. */
  estimatedGrossMarginPct: number;
  /**
   * Weighted average levels across buildings.
   * Stored for transparency — shown in the panel as a derivation hint.
   */
  weightedAverageLevels: number;
  /** Business-readable warnings about the assumptions or results. */
  warnings: string[];
  /** Single synthesis sentence for panel header and export. */
  summary: string;
}