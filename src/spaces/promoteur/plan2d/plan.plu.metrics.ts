// src/spaces/promoteur/plan2d/plan.plu.metrics.ts

import type { Vec2, PlanBuilding } from "./plan.types";
import type { PluMetricSet } from "./plan.plu.types";

// ─── POLYGON AREA (Shoelace / Gauss) ─────────────────────────────────

/**
 * Returns the absolute area of an arbitrary (possibly non-convex) polygon
 * using the Shoelace (surveyor's) formula.
 *
 * Works in any consistent unit — the caller is responsible for ensuring
 * coordinates are in metres (or whichever unit the rest of the system uses).
 *
 * Complexity: O(n).
 */
export function polygonArea(points: Vec2[]): number {
  const n = points.length;
  if (n < 3) return 0;

  let sum = 0;
  let j = n - 1;
  for (let i = 0; i < n; i++) {
    sum += (points[j].x + points[i].x) * (points[j].y - points[i].y);
    j = i;
  }

  return Math.abs(sum * 0.5);
}

// ─── POINT-TO-SEGMENT DISTANCE ────────────────────────────────────────

/**
 * Squared distance from point `p` to the finite segment (a → b).
 * Using squared distance avoids a sqrt per call inside tight loops.
 */
function pointToSegmentDistSq(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq < 1e-14) {
    // Degenerate segment → distance to endpoint a
    const ex = p.x - a.x;
    const ey = p.y - a.y;
    return ex * ex + ey * ey;
  }

  // Project p onto the line, clamped to [0, 1]
  const t = Math.max(0, Math.min(1,
    ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq,
  ));

  const cx = a.x + t * dx - p.x;
  const cy = a.y + t * dy - p.y;
  return cx * cx + cy * cy;
}

// ─── BUILDING FOOTPRINT AREA ──────────────────────────────────────────

/**
 * Total footprint area across all buildings.
 * Uses `building.polygon` (already transformed / world-space).
 */
export function computeTotalFootprintArea(buildings: PlanBuilding[]): number {
  return buildings.reduce((sum, b) => sum + polygonArea(b.polygon), 0);
}

// ─── COVERAGE RATIO ───────────────────────────────────────────────────

/**
 * footprintArea / parcelArea clamped to [0, +∞).
 * A ratio > 1 indicates an overcrowded parcel (useful for BLOQUANT detection).
 */
export function computeCoverageRatio(
  footprintAreaM2: number,
  parcelAreaM2: number,
): number {
  if (parcelAreaM2 < 1e-6) return 0;
  return footprintAreaM2 / parcelAreaM2;
}

// ─── BUILDING HEIGHT ──────────────────────────────────────────────────

/**
 * Estimated height of a single building from its level data.
 *
 * Formula: groundFloor + (aboveGround - 1) × typicalFloor
 *
 * Falls back to 0 if the building has no level data (levels = 0 treated
 * as "not set" — the engine will skip the height rule in that case).
 */
export function estimateBuildingHeight(b: PlanBuilding): number {
  const floors = b.levels ?? 0;
  if (floors <= 0) return 0;

  const ground  = b.groundFloorHeightM   ?? 3.5;
  const typical = b.typicalFloorHeightM  ?? 3.0;

  return ground + Math.max(0, floors - 1) * typical;
}

/**
 * Maximum estimated height across all buildings.
 */
export function computeMaxHeight(buildings: PlanBuilding[]): number {
  if (!buildings.length) return 0;
  return Math.max(...buildings.map(estimateBuildingHeight));
}

// ─── SETBACK / MIN DISTANCE TO PARCEL ────────────────────────────────

/**
 * Minimum Euclidean distance (in metres) from any vertex of any building
 * polygon to any edge of the parcel polygon.
 *
 * This approximation is the standard V1 setback metric:
 *   • Building vertex → parcel edge (point-to-segment)
 *   • All combinations
 *
 * Complexity: O(V_buildings × E_parcel) — typically (8 × 30) = 240 ops.
 */
export function computeMinSetback(
  buildings: PlanBuilding[],
  parcel: Vec2[],
): number {
  const pn = parcel.length;
  if (pn < 2 || !buildings.length) return Infinity;

  let minDistSq = Infinity;

  for (const b of buildings) {
    for (const vertex of b.polygon) {
      for (let i = 0; i < pn; i++) {
        const a = parcel[i];
        const c = parcel[(i + 1) % pn];
        const dSq = pointToSegmentDistSq(vertex, a, c);
        if (dSq < minDistSq) minDistSq = dSq;
      }
    }
  }

  return minDistSq === Infinity ? Infinity : Math.sqrt(minDistSq);
}

// ─── PARKING ──────────────────────────────────────────────────────────

/**
 * Total number of residential units across all buildings.
 * Counts units from buildings whose usage is "logement" or "mixte".
 *
 * For a V1 approximation, `levels × floor(footprint / avgUnitSize)` is
 * used when explicit unit count is not embedded in the building data.
 * The `averageUnitSizeM2` default (60 m²) matches French PLU conventions.
 */
export function computeTotalUnits(
  buildings: PlanBuilding[],
  averageUnitSizeM2 = 60,
): number {
  let total = 0;
  for (const b of buildings) {
    if (b.usage !== "logement" && b.usage !== "mixte") continue;
    const footprint = polygonArea(b.polygon);
    const floors    = b.levels ?? 1;
    const units     = Math.floor((footprint * floors) / averageUnitSizeM2);
    total += Math.max(0, units);
  }
  return total;
}

/**
 * Required parking spaces given a unit count and a parking ratio.
 * Rounds up (ceiling) to the nearest whole space.
 */
export function computeRequiredParking(
  totalUnits: number,
  parkingSpacesPerUnit: number,
): number {
  return Math.ceil(totalUnits * parkingSpacesPerUnit);
}

// ─── FULL METRIC COMPUTATION ──────────────────────────────────────────

/**
 * Computes all PLU metrics in one pass.
 *
 * @param parcel               World-space parcel polygon (Vec2[]).
 * @param buildings            All PlanBuilding objects in the project.
 * @param providedParkingSpaces Explicitly provided parking count (from
 *                             editor parking objects or manual input).
 * @param parkingSpacesPerUnit PLU parking ratio — needed here only to
 *                             compute `requiredParkingSpaces`; also
 *                             passed to the rule-checker separately.
 */
export function computePluMetrics(params: {
  parcel: Vec2[];
  buildings: PlanBuilding[];
  providedParkingSpaces: number;
  parkingSpacesPerUnit?: number;
}): PluMetricSet {
  const { parcel, buildings, providedParkingSpaces, parkingSpacesPerUnit = 0 } = params;

  const parcelAreaM2     = polygonArea(parcel);
  const footprintAreaM2  = computeTotalFootprintArea(buildings);
  const coverageRatio    = computeCoverageRatio(footprintAreaM2, parcelAreaM2);
  const estimatedHeightM = computeMaxHeight(buildings);
  const minDistanceToParcelEdgeM = computeMinSetback(buildings, parcel);

  const totalUnits            = computeTotalUnits(buildings);
  const requiredParkingSpaces = computeRequiredParking(totalUnits, parkingSpacesPerUnit);

  return {
    footprintAreaM2,
    parcelAreaM2,
    coverageRatio,
    estimatedHeightM,
    minDistanceToParcelEdgeM,
    requiredParkingSpaces,
    providedParkingSpaces,
    totalUnits,
  };
}