// src/spaces/promoteur/plan2d/plan.setback.ts

import type { Vec2 } from "./plan.types";
import { isPolygonInsidePolygon } from "./plan.constraint";

// ─── EXTENSIBILITY TYPES ──────────────────────────────────────────────
//
// V1: uniform setback applied identically to all parcel edges.
// Future: per-side setbacks (road frontage, neighbour limit, etc.)

/** Which parcel side(s) the setback rule applies to. */
export type SetbackSide =
  | "all"       // uniform  (V1 default)
  | "road"      // frontage / alignment (Art. 6)
  | "neighbor"  // side / rear limits  (Art. 7)
  | "north" | "south" | "east" | "west"; // cardinal sides

/** One setback specification — maps a side to a distance. */
export type SetbackSpec = {
  side: SetbackSide;
  distanceM: number;
};

/** Result of a per-building setback check. */
export type SetbackCheckResult = {
  buildingId: string;
  violates: boolean;
};

// ─── INTERNAL GEOMETRY HELPERS ────────────────────────────────────────

/**
 * Signed area of a polygon (Shoelace formula).
 *  positive → CCW winding in Y-up world space
 *  negative → CW  winding
 */
function signedArea(polygon: Vec2[]): number {
  const n = polygon.length;
  let sum = 0;
  let j = n - 1;
  for (let i = 0; i < n; i++) {
    sum += (polygon[j].x + polygon[i].x) * (polygon[j].y - polygon[i].y);
    j = i;
  }
  return sum * 0.5;
}

/**
 * Intersection point of two infinite lines defined by segments (p1→p2) and (p3→p4).
 * Returns null when lines are parallel.
 */
function lineLineIntersection(
  p1: Vec2, p2: Vec2,
  p3: Vec2, p4: Vec2,
): Vec2 | null {
  const dx1 = p2.x - p1.x;  const dy1 = p2.y - p1.y;
  const dx2 = p4.x - p3.x;  const dy2 = p4.y - p3.y;

  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-10) return null; // parallel

  const dx3 = p3.x - p1.x;  const dy3 = p3.y - p1.y;
  const t    = (dx3 * dy2 - dy3 * dx2) / denom;

  return { x: p1.x + t * dx1, y: p1.y + t * dy1 };
}

// ─── POLYGON INWARD OFFSET ────────────────────────────────────────────

/**
 * Computes an approximate inward offset of a convex (or near-convex) polygon.
 *
 * Algorithm — edge-inset with miter joins:
 *   1. Determine winding (CCW vs CW) via signed area.
 *   2. For each edge, compute the inward unit normal.
 *   3. Offset each edge inward by `distance`.
 *   4. New vertices = intersections of adjacent offset edges.
 *
 * Accuracy:
 *   • Exact for convex polygons.
 *   • Acceptable approximation for mildly non-convex parcels.
 *   • Reflex vertices produce outward-pointing miters — visually acceptable
 *     for a V1 setback overlay (rare in real parcel data).
 *
 * Returns an empty array when the offset distance collapses the polygon
 * (setback is too large relative to the parcel).
 *
 * Extensibility: future V2 can swap this for a proper straight-skeleton
 * library (e.g. CGAL-JS, polygon-offset) without changing the call sites.
 *
 * @param polygon  World-space polygon to offset (Vec2[]).
 * @param distance Inward offset distance in world units.
 */
export function offsetPolygonInwardApprox(
  polygon: Vec2[],
  distance: number,
): Vec2[] {
  const n = polygon.length;
  if (n < 3 || distance <= 0) return polygon.slice();

  const area = signedArea(polygon);
  if (Math.abs(area) < 1e-10) return [];

  // sign: +1 = CCW (Y-up world) → inward normal is left normal of edge
  //       -1 = CW              → inward normal is right normal
  const sign = area >= 0 ? 1 : -1;

  // ── Step 1: offset each edge inward ──────────────────────────────
  type OffsetEdge = { ax: number; ay: number; bx: number; by: number };
  const offsetEdges: OffsetEdge[] = [];

  for (let i = 0; i < n; i++) {
    const p1 = polygon[i];
    const p2 = polygon[(i + 1) % n];

    const edgeX = p2.x - p1.x;
    const edgeY = p2.y - p1.y;
    const len   = Math.sqrt(edgeX * edgeX + edgeY * edgeY);

    if (len < 1e-10) {
      // Degenerate edge — carry through unchanged
      offsetEdges.push({ ax: p1.x, ay: p1.y, bx: p2.x, by: p2.y });
      continue;
    }

    // Inward unit normal
    // CCW (sign=+1): left  normal of (ex,ey) = (-ey, ex) / len → inward
    // CW  (sign=-1): right normal of (ex,ey) = ( ey,-ex) / len → inward
    const nx = sign * (-edgeY / len);
    const ny = sign * ( edgeX / len);

    offsetEdges.push({
      ax: p1.x + nx * distance,
      ay: p1.y + ny * distance,
      bx: p2.x + nx * distance,
      by: p2.y + ny * distance,
    });
  }

  // ── Step 2: intersect adjacent offset edges to find new vertices ──
  const result: Vec2[] = [];

  for (let i = 0; i < n; i++) {
    const prev = offsetEdges[(i + n - 1) % n];
    const curr = offsetEdges[i];

    const intersection = lineLineIntersection(
      { x: prev.ax, y: prev.ay }, { x: prev.bx, y: prev.by },
      { x: curr.ax, y: curr.ay }, { x: curr.bx, y: curr.by },
    );

    // Fallback for parallel adjacent edges: use the start of the current offset edge
    result.push(intersection ?? { x: curr.ax, y: curr.ay });
  }

  // ── Guard: collapse detection ─────────────────────────────────────
  // If the result polygon's area is too small (< 1 % of original),
  // the setback is too large — return empty to signal no buildable zone.
  const resultArea = Math.abs(signedArea(result));
  const originArea = Math.abs(area);
  if (resultArea < originArea * 0.005) return [];

  return result;
}

// ─── SETBACK VIOLATION CHECK ──────────────────────────────────────────

/**
 * Returns true when the building polygon does NOT fit entirely within
 * the inner buildable zone (i.e., it violates the setback rule).
 *
 * Uses the robust polygon containment check from plan.constraint.ts
 * which handles both vertex containment and edge-crossing cases.
 *
 * @param buildingPolygon   World-space building polygon.
 * @param innerBuildableZone  Inward-offset parcel polygon from offsetPolygonInwardApprox.
 */
export function doesBuildingViolateSetback(
  buildingPolygon: Vec2[],
  innerBuildableZone: Vec2[],
): boolean {
  if (innerBuildableZone.length < 3) return false; // no zone → no constraint
  return !isPolygonInsidePolygon(buildingPolygon, innerBuildableZone);
}