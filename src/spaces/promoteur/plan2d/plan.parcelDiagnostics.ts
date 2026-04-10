// src/spaces/promoteur/plan2d/plan.parcelDiagnostics.ts

import type { Vec2, PlanBuilding } from "./plan.types";
import {
  polygonArea,
  computeTotalFootprintArea,
  computeCoverageRatio,
  computeMinSetback,
} from "./plan.plu.metrics";
import { isBuildingInsideEnvelope } from "./plan.buildableEnvelope";

// ─── RESULT TYPE ──────────────────────────────────────────────────────

/**
 * Spatial and feasibility diagnostics derived from the current parcel and
 * building scheme.
 *
 * All fields use consistent units (m, m², 0–1 ratios) so downstream
 * consumers (PDF export, committee panels, feasibility scores) can format
 * values without re-deriving them.
 *
 * Extensibility: add new fields here and compute them in
 * computeParcelDiagnostics — no breaking changes to existing consumers.
 *
 * Future additions:
 *   perBuildingDiagnostics?: BuildingDiagnostic[]
 *   parcelPerimeterM?: number
 *   compacityIndex?: number     — perimeter² / (4π × area)
 *   frontageEstimateM?: number  — longest edge approximation
 *   densityUnitsPerHectare?: number
 */
export interface ParcelDiagnostics {
  /** Parcel polygon area (m²). */
  parcelAreaM2: number;
  /** Number of parcel polygon vertices. */
  parcelVertexCount: number;
  /** Number of buildings placed on the parcel. */
  buildingCount: number;
  /** Sum of all building footprint areas (m²). */
  totalFootprintM2: number;
  /** totalFootprintM2 / parcelAreaM2.  Value > 1 indicates overcrowding. */
  coverageRatio: number;
  /** Buildable envelope area (m²), if an envelope was provided. */
  buildableEnvelopeAreaM2?: number;
  /**
   * Fraction of the buildable envelope used by buildings.
   * totalFootprintM2 / buildableEnvelopeAreaM2.
   * Only set when both values are available.
   */
  envelopeUsageRatio?: number;
  /** Buildings fully inside the buildable envelope. */
  buildingsInsideEnvelopeCount: number;
  /** Buildings that breach the buildable envelope. */
  buildingsOutsideEnvelopeCount: number;
  /**
   * Minimum observed distance from any building vertex to any parcel edge (m).
   * Undefined when no buildings are placed.
   */
  minObservedSetbackM?: number;
  /** Single business-readable summary sentence. */
  diagnosticSummary: string;
  /** Array of short vigilance / warning messages. Empty array = all good. */
  vigilancePoints: string[];
}

// ─── SUMMARY DERIVATION ───────────────────────────────────────────────

function deriveSummary(
  buildingCount:               number,
  buildingsInsideEnvelopeCount: number,
  buildingsOutsideEnvelopeCount: number,
  hasEnvelope:                 boolean,
): string {
  if (buildingCount === 0) {
    return "Aucun bâtiment positionné — débutez l'implantation sur le plan masse.";
  }
  if (!hasEnvelope) {
    return `${buildingCount} bâtiment${buildingCount > 1 ? "s" : ""} positionné${buildingCount > 1 ? "s" : ""} — enveloppe constructible non définie.`;
  }
  if (buildingsOutsideEnvelopeCount === buildingCount) {
    return "Révision nécessaire — aucun bâtiment ne respecte l'enveloppe constructible.";
  }
  if (buildingsOutsideEnvelopeCount > 0) {
    return (
      `Implantation partielle — ` +
      `${buildingsInsideEnvelopeCount} conforme${buildingsInsideEnvelopeCount > 1 ? "s" : ""}, ` +
      `${buildingsOutsideEnvelopeCount} hors enveloppe.`
    );
  }
  return "Implantation conforme — tous les bâtiments respectent l'enveloppe constructible.";
}

// ─── VIGILANCE DERIVATION ─────────────────────────────────────────────

function deriveVigilance(params: {
  buildingCount:                 number;
  buildingsOutsideEnvelopeCount: number;
  coverageRatio:                 number;
  minObservedSetbackM:           number | undefined;
  parcelAreaM2:                  number;
  envelopeUsageRatio:            number | undefined;
}): string[] {
  const points: string[] = [];

  if (params.buildingCount === 0) {
    points.push("Aucun bâtiment positionné sur le plan masse.");
    return points; // no further analysis possible
  }

  if (params.buildingsOutsideEnvelopeCount > 0) {
    const n = params.buildingsOutsideEnvelopeCount;
    points.push(
      `${n} bâtiment${n > 1 ? "s" : ""} hors enveloppe constructible — recul ou gabarit à corriger.`,
    );
  }

  if (params.coverageRatio > 0.70) {
    points.push(
      `Taux d'emprise de ${(params.coverageRatio * 100).toFixed(0)} % — vérifier le CES autorisé par le PLU.`,
    );
  } else if (params.coverageRatio > 0.55) {
    points.push(
      `Taux d'emprise de ${(params.coverageRatio * 100).toFixed(0)} % — marge réduite sur le coefficient d'occupation.`,
    );
  }

  if (
    params.minObservedSetbackM !== undefined &&
    params.minObservedSetbackM !== Infinity &&
    params.minObservedSetbackM < 3.5
  ) {
    points.push(
      `Recul minimal observé de ${params.minObservedSetbackM.toFixed(1)} m — à sécuriser avant dépôt.`,
    );
  }

  if (params.parcelAreaM2 < 300 && params.parcelAreaM2 > 0) {
    points.push("Parcelle de petite taille — vérifier la faisabilité du programme retenu.");
  }

  if (params.envelopeUsageRatio !== undefined && params.envelopeUsageRatio > 0.85) {
    points.push(
      `L'emprise occupe ${(params.envelopeUsageRatio * 100).toFixed(0)} % de l'enveloppe constructible — marge très réduite.`,
    );
  }

  return points;
}

// ─── MAIN FUNCTION ────────────────────────────────────────────────────

/**
 * Computes spatial and feasibility diagnostics from the current parcel and
 * building scheme.
 *
 * @param params.parcel            World-space parcel polygon.
 * @param params.buildings         All PlanBuilding objects in the project.
 * @param params.buildableEnvelope Pre-computed buildable envelope polygon,
 *                                  or null/undefined to skip envelope checks.
 * @returns                        ParcelDiagnostics — fully immutable result.
 *
 * Pure function — no side-effects, no mutation.
 */
export function computeParcelDiagnostics(params: {
  parcel:            Vec2[];
  buildings:         PlanBuilding[];
  buildableEnvelope?: Vec2[] | null;
}): ParcelDiagnostics {
  const { parcel, buildings, buildableEnvelope } = params;

  // ── Parcel metrics ────────────────────────────────────────────────
  const parcelAreaM2      = polygonArea(parcel);
  const parcelVertexCount = parcel.length;

  // ── Building metrics ──────────────────────────────────────────────
  const buildingCount    = buildings.length;
  const totalFootprintM2 = computeTotalFootprintArea(buildings);
  const coverageRatio    = computeCoverageRatio(totalFootprintM2, parcelAreaM2);

  // ── Envelope metrics ──────────────────────────────────────────────
  const hasEnvelope = !!buildableEnvelope && buildableEnvelope.length >= 3;

  const buildableEnvelopeAreaM2: number | undefined = hasEnvelope
    ? polygonArea(buildableEnvelope!)
    : undefined;

  const envelopeUsageRatio: number | undefined =
    hasEnvelope && buildableEnvelopeAreaM2 && buildableEnvelopeAreaM2 > 0
      ? totalFootprintM2 / buildableEnvelopeAreaM2
      : undefined;

  let buildingsInsideEnvelopeCount  = 0;
  let buildingsOutsideEnvelopeCount = 0;

  if (hasEnvelope) {
    for (const b of buildings) {
      if (isBuildingInsideEnvelope(b.polygon, buildableEnvelope!)) {
        buildingsInsideEnvelopeCount++;
      } else {
        buildingsOutsideEnvelopeCount++;
      }
    }
  }

  // ── Setback metric ────────────────────────────────────────────────
  const rawSetback = buildings.length > 0 && parcel.length >= 2
    ? computeMinSetback(buildings, parcel)
    : undefined;

  const minObservedSetbackM =
    rawSetback === undefined || rawSetback === Infinity
      ? undefined
      : rawSetback;

  // ── Derived text ──────────────────────────────────────────────────
  const diagnosticSummary = deriveSummary(
    buildingCount,
    buildingsInsideEnvelopeCount,
    buildingsOutsideEnvelopeCount,
    hasEnvelope,
  );

  const vigilancePoints = deriveVigilance({
    buildingCount,
    buildingsOutsideEnvelopeCount,
    coverageRatio,
    minObservedSetbackM,
    parcelAreaM2,
    envelopeUsageRatio,
  });

  return {
    parcelAreaM2,
    parcelVertexCount,
    buildingCount,
    totalFootprintM2,
    coverageRatio,
    buildableEnvelopeAreaM2,
    envelopeUsageRatio,
    buildingsInsideEnvelopeCount,
    buildingsOutsideEnvelopeCount,
    minObservedSetbackM,
    diagnosticSummary,
    vigilancePoints,
  };
}