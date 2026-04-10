// src/spaces/promoteur/plan2d/plan.constraint.ts

import type { Vec2, PlanBuildingWithTransform } from "./plan.types";
import { applyTransform } from "./plan.transform";

// ─── EXTENSIBLE RESULT TYPES ──────────────────────────────────────────
//
// ConstraintViolation is a discriminated union so future rules
// (setbacks, density, height, collision) can be added without
// changing call sites. Consumers switch on `kind`.

export type ConstraintViolationKind =
  | "outside_parcel"       // building exits the parcel boundary
  | "setback_violation"    // PLU setback infringement (future)
  | "collision"            // overlaps with another building  (future)
  | "density_exceeded";    // CES / COS rule violation        (future)

export type ConstraintViolation = {
  kind: ConstraintViolationKind;
  /** Human-readable explanation for UI tooltips / panels. */
  message: string;
};

export type ConstraintResult = {
  /** True only when ALL constraints pass. */
  valid: boolean;
  /**
   * The building to use for rendering / state updates:
   *   - valid → the attempted building (unchanged)
   *   - invalid → the last-known-good building (caller's responsibility
   *               to pass it in via constrainBuildingToParcel's 3rd param)
   */
  building: PlanBuildingWithTransform;
  violations: ConstraintViolation[];
};

// ─── RAY-CASTING POINT-IN-POLYGON ─────────────────────────────────────

/**
 * Returns true when `point` is strictly inside `polygon`.
 *
 * Uses the ray-casting (Jordan curve) algorithm with the horizontal
 * ray cast rightward from `point`. The crossing test is:
 *
 *   cross  →  one edge crosses the ray
 *   toggle →  parity of crossings = inside/outside
 *
 * Robustness notes:
 *   • Vertices exactly on the ray boundary are handled by the
 *     strict-inequality check (yi > point.y) on both endpoints,
 *     which consistently classifies horizontal-edge degeneracies.
 *   • Points exactly on an edge are classified as outside (strict <).
 *     This prevents buildings from being "barely valid" at the boundary.
 */
export function isPointInPolygon(point: Vec2, polygon: Vec2[]): boolean {
  const n = polygon.length;
  if (n < 3) return false;

  let inside = false;
  let j = n - 1;

  for (let i = 0; i < n; i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    // The edge (j→i) crosses the horizontal ray iff one endpoint is
    // strictly above and the other is at-or-below point.y.
    const crossesRay = (yi > point.y) !== (yj > point.y);

    if (crossesRay) {
      // x-coordinate of the intersection of the edge with y = point.y
      const xIntersect = ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
      if (point.x < xIntersect) {
        inside = !inside;
      }
    }

    j = i;
  }

  return inside;
}

// ─── SEGMENT–SEGMENT INTERSECTION ────────────────────────────────────

/**
 * Returns true when open segments (p1→p2) and (p3→p4) properly intersect
 * (i.e. they cross in their interiors, excluding shared endpoints).
 *
 * Used by isPolygonInsidePolygon to catch the case where all building
 * vertices are inside the parcel but an edge crosses the parcel boundary
 * (can happen for non-convex parcels or large buildings).
 */
function segmentsProperlyIntersect(
  p1: Vec2, p2: Vec2,
  p3: Vec2, p4: Vec2,
): boolean {
  const d1x = p2.x - p1.x;  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;  const d2y = p4.y - p3.y;

  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-12) return false; // parallel / collinear

  const dx = p3.x - p1.x;
  const dy = p3.y - p1.y;

  const t = (dx * d2y - dy * d2x) / denom;
  const u = (dx * d1y - dy * d1x) / denom;

  // Strict inequalities: endpoints are not considered intersections.
  // This prevents false positives when two polygons share a vertex.
  return t > 1e-10 && t < 1 - 1e-10 && u > 1e-10 && u < 1 - 1e-10;
}

// ─── POLYGON CONTAINMENT ──────────────────────────────────────────────

/**
 * Returns true when `poly` is fully contained inside `parcel`.
 *
 * Two necessary-and-sufficient conditions for containment:
 *   1. Every vertex of `poly` is inside `parcel`.
 *   2. No edge of `poly` properly intersects any edge of `parcel`.
 *
 * Condition 2 catches the non-convex edge-crossing case even when
 * all vertices pass the point-in-polygon test.
 *
 * Complexity: O(m × n) where m = |poly|, n = |parcel|.
 * For typical real-estate polygons (m≤8, n≤60) this is ≤480 ops —
 * fast enough to run on every animation frame.
 */
export function isPolygonInsidePolygon(poly: Vec2[], parcel: Vec2[]): boolean {
  if (poly.length < 3 || parcel.length < 3) return false;

  // ── 1. All vertices inside ────────────────────────────────────────
  for (const pt of poly) {
    if (!isPointInPolygon(pt, parcel)) return false;
  }

  // ── 2. No edge crossings ──────────────────────────────────────────
  const pm = poly.length;
  const pn = parcel.length;

  for (let i = 0; i < pm; i++) {
    const a1 = poly[i];
    const a2 = poly[(i + 1) % pm];

    for (let j = 0; j < pn; j++) {
      const b1 = parcel[j];
      const b2 = parcel[(j + 1) % pn];

      if (segmentsProperlyIntersect(a1, a2, b1, b2)) return false;
    }
  }

  return true;
}

// ─── BUILDING CONSTRAINT ──────────────────────────────────────────────

/**
 * Validates whether `building` lies entirely within `parcel`.
 *
 * @param building     The attempted (possibly out-of-bounds) building.
 * @param parcel       Parcel polygon in world-space Vec2[].
 * @param lastValid    The last known valid building — returned as-is
 *                     when the constraint fails. Defaults to `building`
 *                     (caller must pass the previous good state).
 * @returns            ConstraintResult with `valid`, `building`, and
 *                     any `violations` for UI consumption.
 *
 * Design decisions:
 *   • NO geometric clipping / projection onto the boundary.
 *     The building is either accepted or reverted. This keeps geometry
 *     stable and predictable (no drift from repeated projections).
 *   • NO mutation of either argument.
 *   • The function is a pure predicate + selector; all side-effects
 *     (state updates, visual feedback) are handled by the caller.
 *
 * Extensibility:
 *   Add new constraint kinds by pushing additional ConstraintViolation
 *   entries into `violations` and ANDing their results into `valid`.
 */
export function constrainBuildingToParcel(
  building: PlanBuildingWithTransform,
  parcel: Vec2[],
  lastValid: PlanBuildingWithTransform = building,
): ConstraintResult {
  // Empty or degenerate parcel → no constraint
  if (parcel.length < 3) {
    return { valid: true, building, violations: [] };
  }

  const worldPolygon = applyTransform(building);
  const inside       = isPolygonInsidePolygon(worldPolygon, parcel);

  if (inside) {
    return { valid: true, building, violations: [] };
  }

  return {
    valid: false,
    building: lastValid, // caller receives the safe fallback
    violations: [
      {
        kind: "outside_parcel",
        message: "Le bâtiment dépasse les limites de la parcelle.",
      },
    ],
  };
}