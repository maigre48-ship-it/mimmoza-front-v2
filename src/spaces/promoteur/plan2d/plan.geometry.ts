// src/spaces/promoteur/plan2d/plan.geometry.ts

import type { Vec2, ResizeHandle } from "./plan.types";

// ─── BOUNDING BOX ─────────────────────────────────────────────────────

export type BoundingBox = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
};

/**
 * Axis-aligned bounding box for an arbitrary polygon.
 * Works with both world-space and local-space polygons.
 */
export function getBoundingBox(points: Vec2[]): BoundingBox {
  if (!points.length) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0, centerX: 0, centerY: 0 };
  }
  let minX = points[0].x;
  let minY = points[0].y;
  let maxX = points[0].x;
  let maxY = points[0].y;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const width  = maxX - minX;
  const height = maxY - minY;
  return {
    minX, minY, maxX, maxY, width, height,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  };
}

// ─── RESIZE HANDLES ───────────────────────────────────────────────────

export type HandlePosition = {
  handle: ResizeHandle;
  x: number;
  y: number;
};

/**
 * Returns the 8 resize-handle positions in the same space as worldPolygon.
 * Handles sit at the corners and edge-midpoints of the AABB.
 *
 *  nw ── n ── ne
 *   │           │
 *   w     ·     e
 *   │           │
 *  sw ── s ── se
 *
 * Convention: "n" = high world-Y (canvas Y-inversion makes this screen-top).
 */
export function getResizeHandles(worldPolygon: Vec2[]): HandlePosition[] {
  const bb = getBoundingBox(worldPolygon);
  const cx = bb.centerX;
  const cy = bb.centerY;
  return [
    { handle: "n",  x: cx,      y: bb.maxY },
    { handle: "s",  x: cx,      y: bb.minY },
    { handle: "e",  x: bb.maxX, y: cy      },
    { handle: "w",  x: bb.minX, y: cy      },
    { handle: "ne", x: bb.maxX, y: bb.maxY },
    { handle: "nw", x: bb.minX, y: bb.maxY },
    { handle: "se", x: bb.maxX, y: bb.minY },
    { handle: "sw", x: bb.minX, y: bb.minY },
  ];
}

// ─── ROTATION HANDLE ──────────────────────────────────────────────────

/**
 * Fixed offset above the building's north AABB edge, in world-space units.
 *
 * The canvas toScreen() inverts Y so world maxY maps to screen-top.
 * Tune this constant to taste; it is intentionally world-unit-based so
 * future snapping logic can operate in the same coordinate space.
 */
const ROTATION_HANDLE_OFFSET = 30;

/**
 * Returns the world-space position of the rotation handle.
 *
 * The handle sits above the AABB north edge (high world-Y), centred on X.
 * Always pass the fully-transformed world polygon (output of applyTransform)
 * so the handle tracks scale and rotation correctly.
 *
 * Y convention (matches the canvas):
 *   world Y increases upward → toScreen() inverts to screen-top.
 *   maxY + offset  →  above the building visually.
 *
 * Extensibility note:
 *   Angle snapping and parcel constraints will receive the raw rotationDeg
 *   from rotateBuilding() — this function only governs the handle position.
 */
export function getRotationHandle(worldPolygon: Vec2[]): Vec2 {
  const bb = getBoundingBox(worldPolygon);
  return {
    x: bb.centerX,
    y: bb.maxY + ROTATION_HANDLE_OFFSET,
  };
}

// ─── POLYGON HELPERS ──────────────────────────────────────────────────

/** Arithmetic mean of vertices — sufficient for convex footprints. */
export function getPolygonCentroid(points: Vec2[]): Vec2 {
  if (!points.length) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const p of points) { x += p.x; y += p.y; }
  return { x: x / points.length, y: y / points.length };
}

export function translatePolygon(points: Vec2[], dx: number, dy: number): Vec2[] {
  return points.map(p => ({ x: p.x + dx, y: p.y + dy }));
}

// ─── LEGACY ALIASES ───────────────────────────────────────────────────

/** Shape-compatible alias without centerX/centerY, for existing callers. */
export function getPolygonBounds(points: Vec2[]) {
  const bb = getBoundingBox(points);
  return { minX: bb.minX, minY: bb.minY, maxX: bb.maxX, maxY: bb.maxY, width: bb.width, height: bb.height };
}

export function polygonToSvgPoints(points: Vec2[]): string {
  return points.map(p => `${p.x},${p.y}`).join(" ");
}