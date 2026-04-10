// massingGeometry3d.ts — Pure 3D geometry helpers
// No Three.js material/scene dependency — geometry only
// Used by facade, roof, terrace engines

import * as THREE from "three";

// ─── 2D point type (scene-space X/Z) ──────────────────────────────────────────

export interface Pt2D {
  x: number;
  y: number; // mapped to Z in 3D
}

// ─── Edge representation ──────────────────────────────────────────────────────

export interface Edge2D {
  a: Pt2D;
  b: Pt2D;
  length: number;
  /** outward-pointing unit normal (2D) */
  nx: number;
  ny: number;
  /** midpoint */
  mx: number;
  my: number;
  /** edge index in the polygon */
  index: number;
}

// ─── Basic 2D ops ─────────────────────────────────────────────────────────────

export function dist2D(a: Pt2D, b: Pt2D): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function centroid2D(pts: Pt2D[]): Pt2D {
  let sx = 0, sy = 0;
  for (const p of pts) { sx += p.x; sy += p.y; }
  const n = pts.length || 1;
  return { x: sx / n, y: sy / n };
}

export function perimeter2D(pts: Pt2D[]): number {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    sum += dist2D(pts[i], pts[(i + 1) % pts.length]);
  }
  return sum;
}

/** Signed area (positive = CCW) */
export function signedArea2D(pts: Pt2D[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return a / 2;
}

/** Ensure CCW winding */
export function ensureCCW(pts: Pt2D[]): Pt2D[] {
  return signedArea2D(pts) < 0 ? [...pts].reverse() : pts;
}

/** AABB of a 2D polygon */
export function aabb2D(pts: Pt2D[]): { minX: number; minY: number; maxX: number; maxY: number; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

// ─── Edge extraction ──────────────────────────────────────────────────────────

/** Extract all edges with outward normals from a CCW polygon */
export function extractEdges(pts: Pt2D[]): Edge2D[] {
  const ccw = ensureCCW(pts);
  const edges: Edge2D[] = [];
  for (let i = 0; i < ccw.length; i++) {
    const a = ccw[i];
    const b = ccw[(i + 1) % ccw.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.01) continue;
    // Outward normal for CCW polygon: rotate edge direction 90° CW
    const nx = dy / len;
    const ny = -dx / len;
    edges.push({
      a, b, length: len,
      nx, ny,
      mx: (a.x + b.x) / 2,
      my: (a.y + b.y) / 2,
      index: i,
    });
  }
  return edges;
}

// ─── Point-in-polygon ─────────────────────────────────────────────────────────

/** Ray-casting point-in-polygon test */
export function pointInPolygon(p: Pt2D, poly: Pt2D[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    if (((yi > p.y) !== (yj > p.y)) && (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

/** Check if edge midpoint is inside another polygon (with small inset) */
export function isEdgeCoveredByPolygon(edge: Edge2D, coverPoly: Pt2D[], inset: number = 0.1): boolean {
  // Test midpoint inset slightly inward
  const mp: Pt2D = { x: edge.mx - edge.nx * inset, y: edge.my - edge.ny * inset };
  return pointInPolygon(mp, coverPoly);
}

// ─── Polygon scaling ──────────────────────────────────────────────────────────

/** Scale polygon around its centroid */
export function scalePolygon(pts: Pt2D[], factor: number): Pt2D[] {
  const c = centroid2D(pts);
  return pts.map(p => ({
    x: c.x + (p.x - c.x) * factor,
    y: c.y + (p.y - c.y) * factor,
  }));
}

/** Inset/offset polygon by a fixed distance (positive = shrink) */
export function insetPolygon(pts: Pt2D[], distance: number): Pt2D[] {
  const edges = extractEdges(pts);
  const result: Pt2D[] = [];
  for (let i = 0; i < edges.length; i++) {
    const e0 = edges[i];
    const e1 = edges[(i + 1) % edges.length];
    // Offset lines
    const ax0 = e0.a.x + e0.nx * distance, ay0 = e0.a.y + e0.ny * distance;
    const bx0 = e0.b.x + e0.nx * distance, by0 = e0.b.y + e0.ny * distance;
    const ax1 = e1.a.x + e1.nx * distance, ay1 = e1.a.y + e1.ny * distance;
    const bx1 = e1.b.x + e1.nx * distance, by1 = e1.b.y + e1.ny * distance;
    // Intersect the two offset lines
    const pt = lineIntersection(ax0, ay0, bx0, by0, ax1, ay1, bx1, by1);
    if (pt) result.push(pt);
    else result.push({ x: bx0, y: by0 }); // fallback
  }
  return result;
}

function lineIntersection(
  x1: number, y1: number, x2: number, y2: number,
  x3: number, y3: number, x4: number, y4: number,
): Pt2D | null {
  const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(d) < 1e-10) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d;
  return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
}

// ─── THREE.Shape from Pt2D[] ──────────────────────────────────────────────────

/** Convert 2D points to a THREE.Shape. Negate Y so that after
 *  rotateX(-PI/2), shape.y maps to +worldZ (matching direct 3D placement). */
export function ptsToShape(pts: Pt2D[]): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(pts[0].x, -pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    shape.lineTo(pts[i].x, -pts[i].y);
  }
  shape.closePath();
  return shape;
}

// ─── Facade basis (3D orientation for a 2D edge) ──────────────────────────────

export interface FacadeBasis {
  /** World position of edge start (3D) */
  origin: THREE.Vector3;
  /** Unit vector along edge (tangent) */
  tangent: THREE.Vector3;
  /** Outward-pointing unit normal (horizontal) */
  normal: THREE.Vector3;
  /** Edge length in scene units */
  width: number;
}

/**
 * Compute 3D facade basis from a 2D edge.
 * Y is up in scene space. The 2D polygon lives in XZ plane.
 */
export function facadeBasisFromEdge(edge: Edge2D, baseY: number): FacadeBasis {
  const origin = new THREE.Vector3(edge.a.x, baseY, edge.a.y);
  const tangent = new THREE.Vector3(edge.b.x - edge.a.x, 0, edge.b.y - edge.a.y).normalize();
  const normal = new THREE.Vector3(edge.nx, 0, edge.ny);
  return { origin, tangent, normal, width: edge.length };
}

// ─── Extrusion helpers ────────────────────────────────────────────────────────

/** Create a vertical wall quad as BufferGeometry */
export function createWallQuad(
  x0: number, z0: number, x1: number, z1: number,
  yBot: number, yTop: number,
): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const dx = x1 - x0, dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  // Vertices
  const positions = new Float32Array([
    x0, yBot, z0,  x1, yBot, z1,  x1, yTop, z1,
    x0, yBot, z0,  x1, yTop, z1,  x0, yTop, z0,
  ]);
  // Normal
  const nx = dz / len, nz = -dx / len;
  const normals = new Float32Array([
    nx, 0, nz, nx, 0, nz, nx, 0, nz,
    nx, 0, nz, nx, 0, nz, nx, 0, nz,
  ]);
  // UVs: u along edge, v along height
  const uvs = new Float32Array([
    0, 0, 1, 0, 1, 1,
    0, 0, 1, 1, 0, 1,
  ]);
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  return geo;
}

/** Create a flat horizontal slab (cap) as BufferGeometry from polygon */
export function createSlabGeo(pts: Pt2D[], y: number): THREE.BufferGeometry {
  const shape = ptsToShape(pts);
  const geo = new THREE.ShapeGeometry(shape);
  // Rotate from XY to XZ plane, set Y
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, y, 0);
  return geo;
}