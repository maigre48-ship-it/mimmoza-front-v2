// src/spaces/promoteur/plan2d/plan.rotate.ts

import type { Vec2, PlanBuildingWithTransform } from "./plan.types";
import { applyTransform } from "./plan.transform";
import { snapAngle, DEFAULT_SNAP_CONFIG, type SnapConfig } from "./plan.snap";

// ─── ANGLE MATH ───────────────────────────────────────────────────────

/**
 * Angle in radians from `center` toward `p`, in (-π, π].
 * Computed in Y-up world space — consistent with the canvas toScreen() inversion.
 */
export function angleBetween(center: Vec2, p: Vec2): number {
  return Math.atan2(p.y - center.y, p.x - center.x);
}

/** Normalise degrees to [0, 360). */
export function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Radians → degrees. */
export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

// ─── ROTATION ENGINE ──────────────────────────────────────────────────

/**
 * Rotate a building around its centroid (building.position).
 *
 * @param startBuilding  Snapshot captured at drag-start — never mutated.
 *                       Its `rotationDeg` is the fixed baseline angle.
 * @param startMouse     Mouse position in **world space** at drag-start.
 * @param currentMouse   Mouse position in **world space** at this frame.
 * @param snap           Optional snap config. When `snap.enabled`, the
 *                       final rotationDeg is rounded to the nearest
 *                       `snap.angleStep` degree.
 * @returns              New PlanBuildingWithTransform — fully immutable.
 *
 * Drift-free guarantee
 * ────────────────────
 * delta = currentAngle − startAngle, applied once to startBuilding.rotationDeg.
 * Never accumulated frame-to-frame → zero cumulative drift regardless of snap.
 *
 * No-jump guarantee
 * ─────────────────
 * startAngle comes from the actual mousedown position, not the handle centre.
 * The click offset is absorbed silently — the building never jumps at t=0.
 * Snap is applied to the *result* (startDeg + delta), not to the delta itself,
 * so quantisation cannot cause the pivot to jump between snap targets.
 *
 * Extensibility
 * ─────────────
 * Pass a custom SnapConfig with a different `angleStep` for 5°, 45°, etc.
 * Future parcel-alignment snapping should be added here, not at the call site.
 */
export function rotateBuilding(
  startBuilding: PlanBuildingWithTransform,
  startMouse: Vec2,
  currentMouse: Vec2,
  snap: SnapConfig = DEFAULT_SNAP_CONFIG,
): PlanBuildingWithTransform {
  const center = startBuilding.position;

  const startAngle   = angleBetween(center, startMouse);
  const currentAngle = angleBetween(center, currentMouse);

  // Absolute delta → drift-free
  const deltaDeg = radToDeg(currentAngle - startAngle);
  const rawDeg   = startBuilding.rotationDeg + deltaDeg;

  // Apply snap to the final angle, not to the delta — prevents quantisation jumps
  const newRotationDeg = snap.enabled
    ? snapAngle(rawDeg, snap.angleStep)
    : rawDeg;

  const next: PlanBuildingWithTransform = {
    ...startBuilding,
    rotationDeg: newRotationDeg,
  };

  return { ...next, polygon: applyTransform(next) };
}