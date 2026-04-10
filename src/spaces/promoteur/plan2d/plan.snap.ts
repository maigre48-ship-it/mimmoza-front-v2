// src/spaces/promoteur/plan2d/plan.snap.ts

import type { Vec2 } from "./plan.types";

// ─── DEFAULT CONSTANTS ────────────────────────────────────────────────
// Centralised here so future constraints (PLU, parcel) can override them
// by passing a custom SnapConfig rather than touching call sites.

export const SNAP_GRID_SIZE  = 1;    // world-space units (position)
export const SNAP_SCALE_STEP = 0.1;  // scale increment  (resize)
export const SNAP_ANGLE_STEP = 15;   // degrees           (rotation)

// ─── CONFIG TYPE ──────────────────────────────────────────────────────

/**
 * Passed through the interaction pipeline.
 * `enabled` is toggled by the Shift key in the canvas.
 *
 * Extensibility: add fields here for future constraints:
 *   parcelBounds?: BoundingBox
 *   collisionPolygons?: Vec2[][]
 *   pluMaxHeight?: number
 */
export type SnapConfig = {
  enabled: boolean;
  gridSize: number;   // world units for position snap
  scaleStep: number;  // multiplier increment for resize snap
  angleStep: number;  // degrees per snap step for rotation
};

export const DEFAULT_SNAP_CONFIG: SnapConfig = {
  enabled:   false,
  gridSize:  SNAP_GRID_SIZE,
  scaleStep: SNAP_SCALE_STEP,
  angleStep: SNAP_ANGLE_STEP,
};

// ─── PURE SNAP FUNCTIONS ──────────────────────────────────────────────

/**
 * Snap a scalar value to the nearest multiple of `gridSize`.
 *
 * snapToGrid(1.37, 1)    → 1
 * snapToGrid(1.6,  0.5)  → 1.5
 * snapToGrid(47,   15)   → 45
 */
export function snapToGrid(value: number, gridSize: number): number {
  if (gridSize <= 0) return value;
  return Math.round(value / gridSize) * gridSize;
}

/**
 * Snap a 2-D world position to the nearest grid intersection.
 * Pure — returns a new Vec2.
 */
export function snapPosition(pos: Vec2, gridSize: number): Vec2 {
  return {
    x: snapToGrid(pos.x, gridSize),
    y: snapToGrid(pos.y, gridSize),
  };
}

/**
 * Snap a scale factor to the nearest multiple of `step`.
 *
 * snapScale(1.23, 0.1)  → 1.2
 * snapScale(0.87, 0.25) → 0.75
 */
export function snapScale(scale: number, step: number): number {
  return snapToGrid(scale, step);
}

/**
 * Snap an angle (in degrees) to the nearest multiple of `step`.
 * Works with any angle range — no normalisation assumed.
 *
 * snapAngle(17,  15) → 15
 * snapAngle(23,  15) → 30
 * snapAngle(-8,  15) → 0
 * snapAngle(370, 45) → 360
 */
export function snapAngle(angleDeg: number, step: number): number {
  return snapToGrid(angleDeg, step);
}