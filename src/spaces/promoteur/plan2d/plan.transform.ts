// src/spaces/promoteur/plan2d/plan.transform.ts

import type { Vec2, PlanBuildingWithTransform } from "./plan.types";

type TransformParams = Pick<
  PlanBuildingWithTransform,
  "basePolygon" | "position" | "rotationDeg" | "scaleX" | "scaleY"
>;

/**
 * Applies the full transform pipeline to basePolygon:
 *   1. Scale  (scaleX, scaleY) — around local origin
 *   2. Rotate (rotationDeg)    — around local origin
 *   3. Translate to position   — world centroid
 *
 * Returns a new world-space polygon.  No mutation.
 */
export function applyTransform(params: TransformParams): Vec2[] {
  const rad = (params.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  return params.basePolygon.map(p => {
    // 1 — scale
    const sx = p.x * params.scaleX;
    const sy = p.y * params.scaleY;
    // 2 — rotate
    const rx = sx * cos - sy * sin;
    const ry = sx * sin + sy * cos;
    // 3 — translate
    return {
      x: rx + params.position.x,
      y: ry + params.position.y,
    };
  });
}