// massingArchitectureGeometry.ts
// Géométrie pure pour la V1 architecture : socle / corps / attique / retraits
// Ce fichier ne dépend pas de React ni de Three renderer.
// Il calcule des slices volumétriques à partir d'une empreinte 2D.

import type {
  Pt2D,
  MassingArchitectureStyle,
  BuildingSide,
} from "./massingScene.types";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES PUBLICS
// ═══════════════════════════════════════════════════════════════════════════════

export type ArchitectureSliceRole = "socle" | "upper" | "attic";

export interface ArchitectureSlice {
  role: ArchitectureSliceRole;
  footprint: Pt2D[];
  zBase: number;
  height: number;
  levelStart: number;
  levelCount: number;
}

export interface BuildArchitectureSlicesInput {
  footprint: Pt2D[];
  baseZ?: number;
  architecture: MassingArchitectureStyle;
}

export interface BuildArchitectureSlicesResult {
  slices: ArchitectureSlice[];
  totalHeight: number;
}

export interface PolygonBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
}

export interface SideSegmentInfo {
  side: BuildingSide;
  a: Pt2D;
  b: Pt2D;
  length: number;
}

export interface FacadeRun {
  side: BuildingSide;
  start: Pt2D;
  end: Pt2D;
  width: number;
  zBase: number;
  height: number;
  role: ArchitectureSliceRole;
}

// ═══════════════════════════════════════════════════════════════════════════════
// API PRINCIPALE
// ═══════════════════════════════════════════════════════════════════════════════

export function buildArchitectureSlices(
  input: BuildArchitectureSlicesInput,
): BuildArchitectureSlicesResult {
  const footprint = sanitizeFootprint(input.footprint);
  const baseZ = input.baseZ ?? 0;
  const architecture = input.architecture;
  const vertical = architecture.vertical;

  const slices: ArchitectureSlice[] = [];

  let currentZ = baseZ;
  let currentLevelStart = 0;

  const socleLevels = Math.max(0, Math.floor(vertical.socleLevels));
  const upperLevels = Math.max(0, Math.floor(vertical.upperLevels));
  const atticLevels = Math.max(0, Math.floor(vertical.atticLevels));

  const socleHeight = socleLevels * vertical.socleHeightM;
  const upperHeight = upperLevels * vertical.upperFloorHeightM;
  const atticHeight = atticLevels * vertical.atticFloorHeightM;

  if (socleLevels > 0 && socleHeight > 0) {
    slices.push({
      role: "socle",
      footprint: clonePolygon(footprint),
      zBase: currentZ,
      height: socleHeight,
      levelStart: currentLevelStart,
      levelCount: socleLevels,
    });
    currentZ += socleHeight;
    currentLevelStart += socleLevels;
  }

  if (upperLevels > 0 && upperHeight > 0) {
    slices.push({
      role: "upper",
      footprint: clonePolygon(footprint),
      zBase: currentZ,
      height: upperHeight,
      levelStart: currentLevelStart,
      levelCount: upperLevels,
    });
    currentZ += upperHeight;
    currentLevelStart += upperLevels;
  }

  if (atticLevels > 0 && atticHeight > 0) {
    const atticInset = resolveAtticInsets(architecture);
    const atticFootprint = insetAxisAlignedPolygon(footprint, atticInset);

    if (isValidPolygon(atticFootprint)) {
      slices.push({
        role: "attic",
        footprint: atticFootprint,
        zBase: currentZ,
        height: atticHeight,
        levelStart: currentLevelStart,
        levelCount: atticLevels,
      });
      currentZ += atticHeight;
      currentLevelStart += atticLevels;
    }
  }

  return {
    slices,
    totalHeight: currentZ - baseZ,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ATTIQUE / INSETS
// ═══════════════════════════════════════════════════════════════════════════════

export function resolveAtticInsets(
  architecture: MassingArchitectureStyle,
): { front: number; back: number; left: number; right: number } {
  const defaultInset = Math.max(0, architecture.roof.atticSetbackM ?? 0);

  if (!architecture.setback.enabled) {
    return {
      front: defaultInset,
      back: defaultInset,
      left: defaultInset,
      right: defaultInset,
    };
  }

  return {
    front: Math.max(defaultInset, architecture.setback.frontM),
    back: Math.max(defaultInset, architecture.setback.backM),
    left: Math.max(defaultInset, architecture.setback.leftM),
    right: Math.max(defaultInset, architecture.setback.rightM),
  };
}

/**
 * Inset simple pour empreintes rectangulaires / quasi-rectangulaires.
 * Hypothèse V1 : on travaille sur l'AABB de l'empreinte.
 * Convient très bien pour la plupart des volumes de massing.
 */
export function insetAxisAlignedPolygon(
  polygon: Pt2D[],
  inset: { front: number; back: number; left: number; right: number },
): Pt2D[] {
  const pts = sanitizeFootprint(polygon);
  if (pts.length < 3) return [];

  const bounds = getPolygonBounds(pts);

  const minX = bounds.minX + Math.max(0, inset.left);
  const maxX = bounds.maxX - Math.max(0, inset.right);
  const minY = bounds.minY + Math.max(0, inset.back);
  const maxY = bounds.maxY - Math.max(0, inset.front);

  if (maxX - minX <= 0.25 || maxY - minY <= 0.25) {
    return [];
  }

  return [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ];
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACADES / SEGMENTS
// ═══════════════════════════════════════════════════════════════════════════════

export function buildFacadeRunsForSlice(slice: ArchitectureSlice): FacadeRun[] {
  const pts = sanitizeFootprint(slice.footprint);
  if (pts.length < 3) return [];

  const segments = getFacadeSegmentsFromPolygon(pts);

  return segments.map((seg) => ({
    side: seg.side,
    start: seg.a,
    end: seg.b,
    width: seg.length,
    zBase: slice.zBase,
    height: slice.height,
    role: slice.role,
  }));
}

export function getFacadeSegmentsFromPolygon(polygon: Pt2D[]): SideSegmentInfo[] {
  const pts = sanitizeFootprint(polygon);
  if (pts.length < 3) return [];

  const bounds = getPolygonBounds(pts);
  const cx = (bounds.minX + bounds.maxX) * 0.5;
  const cy = (bounds.minY + bounds.maxY) * 0.5;

  const segments: SideSegmentInfo[] = [];

  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const mx = (a[0] + b[0]) * 0.5;
    const my = (a[1] + b[1]) * 0.5;

    const dx = Math.abs(b[0] - a[0]);
    const dy = Math.abs(b[1] - a[1]);

    let side: BuildingSide;

    if (dx >= dy) {
      side = my >= cy ? "front" : "back";
    } else {
      side = mx >= cx ? "right" : "left";
    }

    segments.push({
      side,
      a,
      b,
      length: distance2D(a, b),
    });
  }

  return segments;
}

// ═══════════════════════════════════════════════════════════════════════════════
// BOUNDS / VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

export function getPolygonBounds(polygon: Pt2D[]): PolygonBounds {
  const pts = sanitizeFootprint(polygon);

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}

export function isValidPolygon(polygon: Pt2D[]): boolean {
  const pts = sanitizeFootprint(polygon);
  if (pts.length < 3) return false;

  const area = polygonAreaSigned(pts);
  if (Math.abs(area) < 0.01) return false;

  const bounds = getPolygonBounds(pts);
  if (bounds.width < 0.25 || bounds.height < 0.25) return false;

  return true;
}

export function sanitizeFootprint(points: Pt2D[]): Pt2D[] {
  const out: Pt2D[] = [];

  for (const pt of points) {
    if (!pt || pt.length < 2) continue;
    const x = Number(pt[0]);
    const y = Number(pt[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

    const prev = out[out.length - 1];
    if (prev && nearlyEqual(prev[0], x) && nearlyEqual(prev[1], y)) {
      continue;
    }

    out.push([x, y]);
  }

  if (out.length >= 2) {
    const first = out[0];
    const last = out[out.length - 1];
    if (nearlyEqual(first[0], last[0]) && nearlyEqual(first[1], last[1])) {
      out.pop();
    }
  }

  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS GÉOMÉTRIQUES
// ═══════════════════════════════════════════════════════════════════════════════

export function clonePolygon(points: Pt2D[]): Pt2D[] {
  return points.map((p) => [p[0], p[1]]);
}

export function distance2D(a: Pt2D, b: Pt2D): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return Math.hypot(dx, dy);
}

export function polygonAreaSigned(points: Pt2D[]): number {
  const pts = sanitizeFootprint(points);
  let sum = 0;

  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    sum += x1 * y2 - x2 * y1;
  }

  return sum / 2;
}

export function polygonAreaAbs(points: Pt2D[]): number {
  return Math.abs(polygonAreaSigned(points));
}

export function getSliceTopZ(slice: ArchitectureSlice): number {
  return slice.zBase + slice.height;
}

export function getArchitectureHeight(
  architecture: MassingArchitectureStyle,
): number {
  const v = architecture.vertical;
  return (
    v.socleLevels * v.socleHeightM +
    v.upperLevels * v.upperFloorHeightM +
    v.atticLevels * v.atticFloorHeightM
  );
}

export function getSliceFloorHeight(
  architecture: MassingArchitectureStyle,
  role: ArchitectureSliceRole,
): number {
  switch (role) {
    case "socle":
      return architecture.vertical.socleHeightM;
    case "upper":
      return architecture.vertical.upperFloorHeightM;
    case "attic":
      return architecture.vertical.atticFloorHeightM;
    default:
      return architecture.vertical.upperFloorHeightM;
  }
}

export function getSliceEstimatedFloorCount(
  architecture: MassingArchitectureStyle,
  role: ArchitectureSliceRole,
): number {
  switch (role) {
    case "socle":
      return Math.max(0, Math.floor(architecture.vertical.socleLevels));
    case "upper":
      return Math.max(0, Math.floor(architecture.vertical.upperLevels));
    case "attic":
      return Math.max(0, Math.floor(architecture.vertical.atticLevels));
    default:
      return 0;
  }
}

function nearlyEqual(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) <= eps;
}