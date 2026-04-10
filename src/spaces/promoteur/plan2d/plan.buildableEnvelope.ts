// src/spaces/promoteur/plan2d/plan.buildableEnvelope.ts

import type { Vec2 } from "./plan.types";
import { offsetPolygonInwardApprox } from "./plan.setback";
import { isPolygonInsidePolygon, isPointInPolygon } from "./plan.constraint";

// ─── ENVELOPE OPTIONS ─────────────────────────────────────────────────

/**
 * Parameters driving the buildable envelope computation.
 *
 * V1: uniform setback on all sides.
 *
 * Extensibility roadmap (add fields here, update computeBuildableEnvelope):
 *   frontageSetbackMeters?  — road-side setback (Art. 6), can differ from Art. 7
 *   neighborSetbackMeters?  — side / rear limit setback (Art. 7)
 *   plantedOpenSpaceRatio?  — minimum non-built fraction (Art. 13)
 *   prospectRatio?          — H/2 angular view-plane rule
 *   maxCoverageRatio?       — CES capping the envelope footprint
 *   zoneCode?               — identifier for future zone-specific overrides
 */
export interface BuildableEnvelopeOptions {
  /** Uniform inward setback applied to all parcel edges (metres). Art. 6–7. */
  setbackMeters: number;
}

// ─── ENVELOPE COMPUTATION ─────────────────────────────────────────────

/**
 * Computes the theoretical buildable envelope polygon for a given parcel.
 *
 * The envelope is the intersection of all applicable regulatory constraints
 * inset onto the parcel. V1 applies a single uniform setback; future versions
 * will intersect multiple constraint layers (per-side setbacks, planted open
 * space, prospect, etc.).
 *
 * @param parcel  World-space parcel polygon (Vec2[]).
 * @param options Envelope parameters (see BuildableEnvelopeOptions).
 * @returns       World-space envelope polygon, or an empty array when the
 *                setback is too large and the parcel collapses to nothing.
 *
 * V1 algorithm: delegates to offsetPolygonInwardApprox (edge-inset with
 * miter joins). Replace the body of this function in V2 to support per-side
 * setbacks, straight-skeleton libraries, or regulatory zone overrides —
 * without changing any call sites.
 */
export function computeBuildableEnvelope(
  parcel: Vec2[],
  options: BuildableEnvelopeOptions,
): Vec2[] {
  if (parcel.length < 3) return [];

  // V1: single uniform inward offset.
  // V2: compose multiple constraint layers (frontage, prospect, CES, etc.)
  if (options.setbackMeters <= 0) return parcel.slice();

  const envelope = offsetPolygonInwardApprox(parcel, options.setbackMeters);

  // Guard: offsetPolygonInwardApprox returns [] on collapse.
  return envelope.length >= 3 ? envelope : [];
}

// ─── CONTAINMENT CHECK ────────────────────────────────────────────────

/**
 * Returns true when the building polygon is fully contained within the
 * buildable envelope (all vertices inside, no edge crossings).
 *
 * Uses the robust dual-test from plan.constraint (vertex containment +
 * edge intersection) so it handles non-convex envelopes correctly.
 *
 * @param buildingPolygon  World-space building polygon.
 * @param envelope         World-space buildable envelope polygon from
 *                         computeBuildableEnvelope.
 */
export function isBuildingInsideEnvelope(
  buildingPolygon: Vec2[],
  envelope: Vec2[],
): boolean {
  if (envelope.length < 3) return true; // no envelope → no constraint
  return isPolygonInsidePolygon(buildingPolygon, envelope);
}

// ─── DIAGNOSTICS ──────────────────────────────────────────────────────

export type BuildableEnvelopeDiagnostics = {
  /** True when the building is fully inside the envelope. */
  inside: boolean;
  /**
   * Number of building vertices that lie outside the envelope.
   * 0 does not necessarily mean full containment (edges may still cross)
   * — use `inside` for the authoritative answer.
   * Useful for UI severity hints: outsidePointCount > 2 is more serious.
   */
  outsidePointCount: number;
  /**
   * Fraction of building vertices outside the envelope (0 = all in, 1 = all out).
   * Useful for colour-coding severity in overlay renderers.
   */
  outsideFraction: number;
};

/**
 * Returns detailed diagnostics about a building's relationship to the
 * buildable envelope.
 *
 * This function is intentionally richer than a simple boolean so that
 * future UI layers (heatmaps, severity badges, committee reports) can
 * use fine-grained data without re-computing geometry.
 */
export function getBuildableEnvelopeDiagnostics(
  buildingPolygon: Vec2[],
  envelope: Vec2[],
): BuildableEnvelopeDiagnostics {
  if (envelope.length < 3) {
    return { inside: true, outsidePointCount: 0, outsideFraction: 0 };
  }

  const outsidePoints = buildingPolygon.filter(
    p => !isPointInPolygon(p, envelope),
  );

  const outsidePointCount = outsidePoints.length;
  const outsideFraction   =
    buildingPolygon.length > 0
      ? outsidePointCount / buildingPolygon.length
      : 0;

  // Full containment check (includes edge-crossing test).
  const inside = isPolygonInsidePolygon(buildingPolygon, envelope);

  return { inside, outsidePointCount, outsideFraction };
}