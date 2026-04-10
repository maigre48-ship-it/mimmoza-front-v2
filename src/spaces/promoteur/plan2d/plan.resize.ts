// src/spaces/promoteur/plan2d/plan.resize.ts

import type { Vec2, PlanBuildingWithTransform, ResizeHandle } from "./plan.types";
import { getBoundingBox } from "./plan.geometry";
import { applyTransform } from "./plan.transform";
import { snapScale, DEFAULT_SNAP_CONFIG, type SnapConfig } from "./plan.snap";

const MIN_SCALE = 0.05; // lower bound: ~5 % of original size

/**
 * Resize a building by moving one of its 8 handles.
 *
 * @param building   Source building snapshot — never mutated.
 * @param handle     Which of the 8 handles is being dragged.
 * @param worldDelta Cumulative mouse displacement in world space from
 *                   drag-start (not incremental). +x = east, +y = north.
 * @param snap       Optional snap config. When `snap.enabled`, scaleX/Y
 *                   are rounded to the nearest `snap.scaleStep` increment
 *                   after the raw value is computed, before the MIN_SCALE
 *                   clamp is re-applied.
 * @returns          New PlanBuildingWithTransform — fully immutable.
 *
 * Algorithm
 * ─────────
 *  1. Un-rotate worldDelta into local space.
 *  2. Compute raw new scale from localDelta + current scale × localSize.
 *  3. Snap scale if enabled.
 *  4. Clamp to MIN_SCALE.
 *  5. Shift centroid (position) so the OPPOSITE edge stays fixed.
 *  6. Re-rotate centroid shift back to world space.
 *  7. Recompute polygon via applyTransform (immutable).
 */
export function resizeBuilding(
  building: PlanBuildingWithTransform,
  handle: ResizeHandle,
  worldDelta: Vec2,
  snap: SnapConfig = DEFAULT_SNAP_CONFIG,
): PlanBuildingWithTransform {
  // ── Local bounding box (stable throughout the resize gesture) ─────
  const localBB = getBoundingBox(building.basePolygon);
  const localW  = Math.max(0.001, localBB.width);
  const localH  = Math.max(0.001, localBB.height);

  // ── Un-rotate worldDelta → localDelta ────────────────────────────
  const invRad = -(building.rotationDeg * Math.PI) / 180;
  const invCos = Math.cos(invRad);
  const invSin = Math.sin(invRad);
  const localDx = worldDelta.x * invCos - worldDelta.y * invSin;
  const localDy = worldDelta.x * invSin + worldDelta.y * invCos;

  // ── Compute new scales + centroid deltas ─────────────────────────
  let newScaleX  = building.scaleX;
  let newScaleY  = building.scaleY;
  let posLocalDx = 0;
  let posLocalDy = 0;

  const isE = handle === "e"  || handle === "ne" || handle === "se";
  const isW = handle === "w"  || handle === "nw" || handle === "sw";
  const isN = handle === "n"  || handle === "ne" || handle === "nw";
  const isS = handle === "s"  || handle === "se" || handle === "sw";

  // Helper: raw → snapped → clamped
  const resolve = (raw: number, step: number): number =>
    Math.max(MIN_SCALE, snap.enabled ? snapScale(raw, step) : raw);

  if (isE) {
    const rawW = (building.scaleX * localW + localDx) / localW;
    newScaleX  = resolve(rawW, snap.scaleStep);
    posLocalDx = (newScaleX - building.scaleX) * localW * 0.5;
  } else if (isW) {
    const rawW = (building.scaleX * localW - localDx) / localW;
    newScaleX  = resolve(rawW, snap.scaleStep);
    posLocalDx = -(newScaleX - building.scaleX) * localW * 0.5;
  }

  if (isN) {
    const rawH = (building.scaleY * localH + localDy) / localH;
    newScaleY  = resolve(rawH, snap.scaleStep);
    posLocalDy = (newScaleY - building.scaleY) * localH * 0.5;
  } else if (isS) {
    const rawH = (building.scaleY * localH - localDy) / localH;
    newScaleY  = resolve(rawH, snap.scaleStep);
    posLocalDy = -(newScaleY - building.scaleY) * localH * 0.5;
  }

  // ── Re-rotate centroid delta → world space ───────────────────────
  const fwdRad = (building.rotationDeg * Math.PI) / 180;
  const fwdCos = Math.cos(fwdRad);
  const fwdSin = Math.sin(fwdRad);

  const newPosition: Vec2 = {
    x: building.position.x + posLocalDx * fwdCos - posLocalDy * fwdSin,
    y: building.position.y + posLocalDx * fwdSin + posLocalDy * fwdCos,
  };

  const next: PlanBuildingWithTransform = {
    ...building,
    scaleX: newScaleX,
    scaleY: newScaleY,
    position: newPosition,
  };

  return { ...next, polygon: applyTransform(next) };
}