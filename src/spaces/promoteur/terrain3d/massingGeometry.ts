// massingGeometry.ts
// Helpers de géométrie pour le Massing Engine
// Séparé du renderer : pas d'import Three.js ici → testable unitairement

import type { Pt2D, MassingBuildingModel, BuildingTransform } from "./massingScene.types";
import { polygonArea } from "./massingScene.types";

// ─── Coordinate system ────────────────────────────────────────────────────────

/**
 * Détecte si une bbox est en WGS84 (degrés) ou en Lambert93 (mètres)
 */
export function detectIsGeographic(pts: [number, number][]): boolean {
  for (const [x, y] of pts) {
    if (Math.abs(x) > 180 || Math.abs(y) > 90) return false;
  }
  return true;
}

/**
 * Résolution approximative (mètres par unité de coordonnée géographique)
 * Pour WGS84 : ~111 000 m/degré en latitude
 */
export function metersPerGeoUnit(pts: [number, number][]): number {
  return detectIsGeographic(pts) ? 111_000 : 1;
}

// ─── Projection scène ─────────────────────────────────────────────────────────

/**
 * Calcule le centre et l'échelle pour projeter un ensemble de points
 * dans un espace scène de taille TARGET_SCENE_UNITS unités.
 */
const TARGET_SCENE_UNITS = 520;

export interface SceneProjection {
  cx:    number;  // centroïde X des coords source
  cy:    number;  // centroïde Y des coords source
  scale: number;  // unités-scène / unité-source
  zScale: number; // unités-scène / mètre réel
}

export function computeSceneProjection(
  allPts: [number, number][],
): SceneProjection {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of allPts) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const cx    = (x0 + x1) / 2;
  const cy    = (y0 + y1) / 2;
  const spanX = Math.max(1e-9, x1 - x0);
  const spanY = Math.max(1e-9, y1 - y0);
  const scale = TARGET_SCENE_UNITS / Math.max(spanX, spanY);
  const isGeo = detectIsGeographic(allPts);
  const mPU   = isGeo ? 111_000 : 1;
  const zScale = scale / mPU;
  return { cx, cy, scale, zScale };
}

/**
 * Projette un point source → coordonnées scène XY (pour ExtrudeGeometry)
 * Attention : après rotation.x = -PI/2, shape.y → world.-z
 */
export function projectPt(
  p: [number, number],
  proj: SceneProjection,
): Pt2D {
  return [
    (p[0] - proj.cx) * proj.scale,
    (p[1] - proj.cy) * proj.scale,
  ];
}

/**
 * Projette tous les points d'un anneau
 */
export function projectRing(
  ring: [number, number][],
  proj: SceneProjection,
): Pt2D[] {
  return ring.map(p => projectPt(p, proj));
}

// ─── Transform de bâtiment ────────────────────────────────────────────────────

/**
 * Applique un BuildingTransform à un tableau de points projetés
 * offsetX/Y sont en unités-scène (déjà scalées)
 */
export function applyTransformToPts(
  pts: Pt2D[],
  transform: BuildingTransform,
): Pt2D[] {
  const { offsetX, offsetY, rotationRad } = transform;
  if (offsetX === 0 && offsetY === 0 && rotationRad === 0) return pts;

  const cos = Math.cos(rotationRad);
  const sin = Math.sin(rotationRad);

  // Centroïde local des pts
  let cxL = 0, cyL = 0;
  for (const [x, y] of pts) { cxL += x; cyL += y; }
  cxL /= pts.length; cyL /= pts.length;

  return pts.map(([x, y]) => {
    // Rotation autour du centroïde local
    const rx = x - cxL, ry = y - cyL;
    const rotX = rx * cos - ry * sin;
    const rotY = rx * sin + ry * cos;
    // Translation
    return [cxL + rotX + offsetX, cyL + rotY + offsetY];
  });
}

/**
 * Retourne les points projetés ET transformés d'un bâtiment
 */
export function getBuildingScenePts(
  b: MassingBuildingModel,
  proj: SceneProjection,
): Pt2D[] {
  const raw = projectRing(b.footprint.points, proj);
  return applyTransformToPts(raw, b.transform);
}

// ─── Setbacks ─────────────────────────────────────────────────────────────────

/**
 * Retourne les points réduits d'un facteur scale autour du centroïde
 */
export function scalePtsAround(pts: Pt2D[], factor: number): Pt2D[] {
  if (factor === 1) return pts;
  let cx = 0, cy = 0;
  for (const [x, y] of pts) { cx += x; cy += y; }
  cx /= pts.length; cy /= pts.length;
  return pts.map(([x, y]) => [cx + (x - cx) * factor, cy + (y - cy) * factor]);
}

/**
 * Retourne les tranches de volumes à créer selon les setbacks
 * [{pts, f0, f1}]
 */
export interface VolumeSlice {
  pts:     Pt2D[];
  f0:      number; // floor start (inclus)
  f1:      number; // floor end   (exclus)
}

export function computeVolumeSlices(
  basePts: Pt2D[],
  totalFloors: number,
  numSetbacks: number,
): VolumeSlice[] {
  if (numSetbacks === 0 || totalFloors <= 3) {
    return [{ pts: basePts, f0: 0, f1: totalFloors }];
  }
  if (numSetbacks === 1 || totalFloors <= 6) {
    return [
      { pts: basePts,                      f0: 0,              f1: totalFloors - 2 },
      { pts: scalePtsAround(basePts, 0.84), f0: totalFloors - 2, f1: totalFloors },
    ];
  }
  // numSetbacks === 2
  return [
    { pts: basePts,                       f0: 0,               f1: 3 },
    { pts: scalePtsAround(basePts, 0.88), f0: 3,               f1: totalFloors - 3 },
    { pts: scalePtsAround(basePts, 0.72), f0: totalFloors - 3, f1: totalFloors },
  ];
}

// ─── Centroïde ────────────────────────────────────────────────────────────────

export function centroidPts(pts: Pt2D[]): Pt2D {
  let cx = 0, cy = 0;
  for (const [x, y] of pts) { cx += x; cy += y; }
  return [cx / pts.length, cy / pts.length];
}

// ─── Périmètre ────────────────────────────────────────────────────────────────

export function perimeterPts(pts: Pt2D[]): number {
  let p = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    const dx = pts[j][0] - pts[i][0], dy = pts[j][1] - pts[i][1];
    p += Math.sqrt(dx * dx + dy * dy);
  }
  return p;
}

// ─── Rectangle de travée ─────────────────────────────────────────────────────

/**
 * Génère les points d'un rectangle aux dimensions métriques,
 * centré sur (0,0), en coordonnées source (degrés ou mètres)
 */
export function rectFootprintPoints(
  centerX: number,
  centerY: number,
  widthGeoUnits: number,
  depthGeoUnits: number,
): [number, number][] {
  const hw = widthGeoUnits / 2, hd = depthGeoUnits / 2;
  return [
    [centerX - hw, centerY - hd],
    [centerX + hw, centerY - hd],
    [centerX + hw, centerY + hd],
    [centerX - hw, centerY + hd],
  ];
}

// ─── Snap to grid ────────────────────────────────────────────────────────────

export function snapToGrid(v: number, step: number): number {
  if (step <= 0) return v;
  return Math.round(v / step) * step;
}

// ─── AABB (bounding box 2D) ───────────────────────────────────────────────────

export interface AABB {
  minX: number; minY: number;
  maxX: number; maxY: number;
  width: number; height: number;
}

export function aabbOfPts(pts: Pt2D[]): AABB {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}