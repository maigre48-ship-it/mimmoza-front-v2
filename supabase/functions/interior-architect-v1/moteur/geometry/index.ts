/** Géométrie 2D partagée (pure, déterministe). Rotations limitées à 0/90/180/270 => emprises = AABB. */
import type { Vec2, Placement, FurnitureSpec } from '../types';

export const EPS = 1e-6;

export const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
export const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
export const scale = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k];
export const dot = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1];
export const cross = (a: Vec2, b: Vec2): number => a[0] * b[1] - a[1] * b[0];
export const len = (a: Vec2): number => Math.hypot(a[0], a[1]);
export const dist = (a: Vec2, b: Vec2): number => len(sub(a, b));
export const normalize = (a: Vec2): Vec2 => { const l = len(a); return l < EPS ? [0, 0] : [a[0] / l, a[1] / l]; };
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Aire signée (positive si anti-horaire). */
export function signedArea(poly: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) { const p = poly[i]!, q = poly[(i + 1) % poly.length]!; s += p[0] * q[1] - q[0] * p[1]; }
  return s / 2;
}
export const area = (poly: Vec2[]): number => Math.abs(signedArea(poly));

export function bbox(poly: Vec2[]): { min: Vec2; max: Vec2 } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of poly) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  return { min: [minX, minY], max: [maxX, maxY] };
}

export function centroid(poly: Vec2[]): Vec2 {
  const A = signedArea(poly); if (Math.abs(A) < EPS) return poly[0] ?? [0, 0];
  let cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) { const p = poly[i]!, q = poly[(i + 1) % poly.length]!; const f = p[0] * q[1] - q[0] * p[1]; cx += (p[0] + q[0]) * f; cy += (p[1] + q[1]) * f; }
  return [cx / (6 * A), cy / (6 * A)];
}

/** Point dans polygone (règle pair-impair). Les points sur le bord comptent comme dedans à EPS près. */
export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  for (let i = 0; i < poly.length; i++) if (distPointSegment(p, poly[i]!, poly[(i + 1) % poly.length]!) < 1e-4) return true;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function distPointSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a), l2 = dot(ab, ab);
  if (l2 < EPS) return dist(p, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return dist(p, lerp(a, b, t));
}

export function segmentsIntersect(p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2): boolean {
  const d1 = cross(sub(q2, q1), sub(p1, q1)), d2 = cross(sub(q2, q1), sub(p2, q1));
  const d3 = cross(sub(p2, p1), sub(q1, p1)), d4 = cross(sub(p2, p1), sub(q2, p1));
  return ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS));
}

// ───────────── Rectangles alignés (emprises de meubles) ─────────────

export interface Rect { minX: number; minY: number; maxX: number; maxY: number }

export const rectW = (r: Rect) => r.maxX - r.minX;
export const rectH = (r: Rect) => r.maxY - r.minY;
export const rectArea = (r: Rect) => Math.max(0, rectW(r)) * Math.max(0, rectH(r));
export const rectCorners = (r: Rect): Vec2[] => [[r.minX, r.minY], [r.maxX, r.minY], [r.maxX, r.maxY], [r.minX, r.maxY]];

export function rectsOverlap(a: Rect, b: Rect, tol = 1e-3): boolean {
  return a.minX < b.maxX - tol && b.minX < a.maxX - tol && a.minY < b.maxY - tol && b.minY < a.maxY - tol;
}
export function rectIntersection(a: Rect, b: Rect): Rect | null {
  const r = { minX: Math.max(a.minX, b.minX), minY: Math.max(a.minY, b.minY), maxX: Math.min(a.maxX, b.maxX), maxY: Math.min(a.maxY, b.maxY) };
  return r.minX < r.maxX && r.minY < r.maxY ? r : null;
}

/** Le rectangle est-il entièrement dans le polygone (coins + milieux de côtés + aucun bord du polygone ne le traverse) ? */
export function rectInPolygon(r: Rect, poly: Vec2[], tol = 1e-3): boolean {
  const shrunk: Rect = { minX: r.minX + tol, minY: r.minY + tol, maxX: r.maxX - tol, maxY: r.maxY - tol };
  const pts = rectCorners(shrunk);
  for (const p of pts) if (!pointInPolygon(p, poly)) return false;
  for (let i = 0; i < 4; i++) for (let j = 0; j < poly.length; j++)
    if (segmentsIntersect(pts[i]!, pts[(i + 1) % 4]!, poly[j]!, poly[(j + 1) % poly.length]!)) return false;
  return true;
}

/** Dimensions (sur x, y monde) d'un meuble tourné. */
export function rotatedSize(spec: FurnitureSpec, rot: Placement['rotationDeg']): { w: number; d: number } {
  return rot === 90 || rot === 270 ? { w: spec.size.d, d: spec.size.w } : { w: spec.size.w, d: spec.size.d };
}

/** Direction monde du « devant » (+y local) après rotation (sens anti-horaire). */
export function frontDir(rot: Placement['rotationDeg']): Vec2 {
  switch (rot) { case 0: return [0, 1]; case 90: return [-1, 0]; case 180: return [0, -1]; default: return [1, 0]; }
}

/** Emprise au sol d'un placement. */
export function footprint(p: Placement, spec: FurnitureSpec): Rect {
  const { w, d } = rotatedSize(spec, p.rotationDeg);
  return { minX: p.center[0] - w / 2, minY: p.center[1] - d / 2, maxX: p.center[0] + w / 2, maxY: p.center[1] + d / 2 };
}

/**
 * Dégagements effectifs d'un placement : ceux de la spec, gauche/droite permutés si `p.mirrored` (INT-05b).
 */
export function effectiveClearances(p: Pick<Placement, 'mirrored'>, spec: FurnitureSpec): FurnitureSpec['clearances'] {
  const c = spec.clearances;
  return p.mirrored ? { front: c.front, back: c.back, left: c.right, right: c.left } : c;
}

/** Emprise + dégagements (devant/derrière/gauche/droite exprimés en repère local puis tournés ; `mirrored` permute gauche/droite). */
export function clearanceRect(p: Placement, spec: FurnitureSpec): Rect {
  const f = footprint(p, spec), c = effectiveClearances(p, spec);
  // local : front=+y, back=-y, right=+x, left=-x
  const ext = { px: c.right, nx: c.left, py: c.front, ny: c.back };
  let r: { px: number; nx: number; py: number; ny: number };
  switch (p.rotationDeg) {
    case 0: r = ext; break;
    case 90: r = { px: ext.ny, nx: ext.py, py: ext.px, ny: ext.nx }; break;
    case 180: r = { px: ext.nx, nx: ext.px, py: ext.ny, ny: ext.py }; break;
    default: r = { px: ext.py, nx: ext.ny, py: ext.nx, ny: ext.px }; break;
  }
  return { minX: f.minX - r.nx, minY: f.minY - r.ny, maxX: f.maxX + r.px, maxY: f.maxY + r.py };
}

/** Zone de dégagement devant seulement (la plus importante pour l'usage). */
export function frontClearanceRect(p: Placement, spec: FurnitureSpec): Rect | null {
  const f = footprint(p, spec), d = spec.clearances.front; if (d <= 0) return null;
  switch (p.rotationDeg) {
    case 0: return { minX: f.minX, minY: f.maxY, maxX: f.maxX, maxY: f.maxY + d };
    case 90: return { minX: f.minX - d, minY: f.minY, maxX: f.minX, maxY: f.maxY };
    case 180: return { minX: f.minX, minY: f.minY - d, maxX: f.maxX, maxY: f.minY };
    default: return { minX: f.maxX, minY: f.minY, maxX: f.maxX + d, maxY: f.maxY };
  }
}

// ───────────── Découpage de polygones et intervalles (ajouts INT-03) ─────────────

/**
 * Découpe (Sutherland-Hodgman) d'un polygone par le demi-plan { p : dot(n, p) <= c }.
 * Exact pour un polygone convexe ; renvoie [] si rien ne subsiste.
 */
export function clipPolygonHalfPlane(poly: Vec2[], n: Vec2, c: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!, q = poly[(i + 1) % poly.length]!;
    const fp = dot(n, p) - c, fq = dot(n, q) - c;
    const pIn = fp <= 0, qIn = fq <= 0;
    if (pIn) out.push(p);
    if (pIn !== qIn) out.push(lerp(p, q, fp / (fp - fq)));
  }
  return out;
}

/** Intervalle fermé [s, e] sur un axe 1D. */
export type Interval = [number, number];

/** Soustrait une liste d'intervalles à [s, e] ; résultat trié, intervalles de longueur > EPS. */
export function subtractIntervals(base: Interval, cuts: Interval[]): Interval[] {
  let parts: Interval[] = [base];
  const sorted = [...cuts].sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  for (const [cs, ce] of sorted) {
    const next: Interval[] = [];
    for (const [s, e] of parts) {
      if (ce <= s + EPS || cs >= e - EPS) { next.push([s, e]); continue; }
      if (cs > s + EPS) next.push([s, cs]);
      if (ce < e - EPS) next.push([ce, e]);
    }
    parts = next;
  }
  return parts.filter(([s, e]) => e - s > EPS);
}

/** Point strictement intérieur (à plus de `tol` du bord). */
export function pointStrictlyInPolygon(p: Vec2, poly: Vec2[], tol = 1e-3): boolean {
  for (let i = 0; i < poly.length; i++) if (distPointSegment(p, poly[i]!, poly[(i + 1) % poly.length]!) <= tol) return false;
  return pointInPolygon(p, poly);
}

// ───────────── Zone libre devant un équipement fixe (ajout INT-05b) ─────────────

/**
 * Zone libre devant un équipement fixe adossé (tableau électrique…) : rectangle s'appuyant sur l'arête axiale du
 * polygone la plus proche de `f.position`, de profondeur `prof` vers l'intérieur, centré sur la projection de
 * l'équipement, de largeur = emprise de l'équipement le long de l'arête (ou `largeurDefaut` si inconnue).
 * null si aucune arête axiale ne convient.
 */
export function zoneAvant(poly: Vec2[], f: { position: Vec2; size?: { w: number; d: number } }, prof: number, largeurDefaut: number): Rect | null {
  let best: { a: Vec2; b: Vec2; d: number } | null = null;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    if (!(Math.abs(a[0] - b[0]) < 1e-9 || Math.abs(a[1] - b[1]) < 1e-9)) continue;
    const d = distPointSegment(f.position, a, b);
    if (!best || d < best.d - 1e-12) best = { a, b, d };
  }
  if (!best) return null;
  const { a, b } = best;
  const m: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  if (Math.abs(a[0] - b[0]) < 1e-9) {
    const dedans = pointInPolygon([m[0] + 0.05, m[1]], poly) && !pointInPolygon([m[0] - 0.05, m[1]], poly);
    const L = f.size ? f.size.d : largeurDefaut, x = a[0];
    return dedans ? { minX: x, maxX: x + prof, minY: f.position[1] - L / 2, maxY: f.position[1] + L / 2 } : { minX: x - prof, maxX: x, minY: f.position[1] - L / 2, maxY: f.position[1] + L / 2 };
  }
  const dedans = pointInPolygon([m[0], m[1] + 0.05], poly) && !pointInPolygon([m[0], m[1] - 0.05], poly);
  const L = f.size ? f.size.w : largeurDefaut, y = a[1];
  return dedans ? { minX: f.position[0] - L / 2, maxX: f.position[0] + L / 2, minY: y, maxY: y + prof } : { minX: f.position[0] - L / 2, maxX: f.position[0] + L / 2, minY: y - prof, maxY: y };
}

// ───────────── Hasard déterministe ─────────────

/** PRNG mulberry32 : même graine => même suite. Ne jamais utiliser Math.random dans le cœur. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export const round = (x: number, d = 3) => Math.round(x * 10 ** d) / 10 ** d;
