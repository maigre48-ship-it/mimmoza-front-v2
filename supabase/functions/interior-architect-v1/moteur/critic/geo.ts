/**
 * INT-06 — Outils géométriques propres au critique (purs, déterministes).
 * Complètent src/geometry sans le modifier (fichier partagé avec les autres lots).
 */
import type { FurnitureSpec, Placement, Vec2 } from '../types';
import { area, clipPolygonHalfPlane, cross, distPointSegment, dot, frontDir, pointInPolygon, signedArea, sub, type Rect } from '../geometry';

/** Pas de grille et d'échantillonnage (CHECKS.md §0.4). */
export const PAS = 0.05;
/** Longueur maximale d'un rayon de mesure de profondeur libre (m). */
export const RAYON_MAX = 5;
/** Tolérance numérique des comparaisons de seuils (m). */
export const TOL = 1e-6;

export type Cote = 'front' | 'back' | 'left' | 'right';

/** Direction monde d'un côté local après rotation (devant = frontDir ; droite = devant tourné de −90°). */
export function directionCote(rot: Placement['rotationDeg'], cote: Cote): Vec2 {
  const f = frontDir(rot);
  switch (cote) {
    case 'front': return f;
    case 'back': return [-f[0], -f[1]];
    case 'right': return [f[1], -f[0]];
    default: return [-f[1], f[0]];
  }
}

/** Rectangle d'un équipement fixe dimensionné (centré sur sa position, aligné sur les axes). */
export function rectFixture(position: Vec2, size: { w: number; d: number }): Rect {
  return { minX: position[0] - size.w / 2, minY: position[1] - size.d / 2, maxX: position[0] + size.w / 2, maxY: position[1] + size.d / 2 };
}

export function distPointRect(p: Vec2, r: Rect): number {
  const dx = Math.max(r.minX - p[0], 0, p[0] - r.maxX);
  const dy = Math.max(r.minY - p[1], 0, p[1] - r.maxY);
  return Math.hypot(dx, dy);
}

export function distRectRect(a: Rect, b: Rect): number {
  const dx = Math.max(a.minX - b.maxX, b.minX - a.maxX, 0);
  const dy = Math.max(a.minY - b.maxY, b.minY - a.maxY, 0);
  return Math.hypot(dx, dy);
}

/** Distance d'un point au bord d'un polygone (0 si le point est dedans). */
export function distPointPolygonePlein(p: Vec2, poly: Vec2[]): number {
  if (pointInPolygon(p, poly)) return 0;
  return distBord(p, poly);
}

/** Distance d'un point aux arêtes d'un polygone. */
export function distBord(p: Vec2, poly: Vec2[]): number {
  let m = Infinity;
  for (let i = 0; i < poly.length; i++) m = Math.min(m, distPointSegment(p, poly[i]!, poly[(i + 1) % poly.length]!));
  return m;
}

/** Découpe un polygone (quelconque) par un rectangle (fenêtre convexe) — Sutherland-Hodgman. */
export function clipParRect(poly: Vec2[], r: Rect): Vec2[] {
  let c = clipPolygonHalfPlane(poly, [1, 0], r.maxX);
  if (c.length) c = clipPolygonHalfPlane(c, [-1, 0], -r.minX);
  if (c.length) c = clipPolygonHalfPlane(c, [0, 1], r.maxY);
  if (c.length) c = clipPolygonHalfPlane(c, [0, -1], -r.minY);
  return c;
}

/** Aire d'intersection polygone ∩ rectangle (exacte : la fenêtre de découpe est convexe). */
export function aireInterPolyRect(poly: Vec2[], r: Rect): number {
  const c = clipParRect(poly, r);
  return c.length < 3 ? 0 : area(c);
}

/** Normale unitaire de [a,b] pointant vers l'intérieur du polygone, ou null si le segment n'est pas en bord. */
export function normaleInterieure(poly: Vec2[], a: Vec2, b: Vec2): Vec2 | null {
  const d = sub(b, a), l = Math.hypot(d[0], d[1]);
  if (l < 1e-9) return null;
  const n: Vec2 = [-d[1] / l, d[0] / l];
  const m: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const plus = pointInPolygon([m[0] + n[0] * 0.05, m[1] + n[1] * 0.05], poly);
  const moins = pointInPolygon([m[0] - n[0] * 0.05, m[1] - n[1] * 0.05], poly);
  if (plus && !moins) return n;
  if (moins && !plus) return [-n[0], -n[1]];
  return null;
}

// ───────────── Rayons ─────────────

/** Paramètre t ≥ 0 d'intersection du rayon o + t·d avec le segment [a,b], ou Infinity. */
function rayonSegment(o: Vec2, d: Vec2, a: Vec2, b: Vec2): number {
  const e = sub(b, a), den = cross(d, e);
  if (Math.abs(den) < 1e-12) return Infinity; // parallèle (rasant) : ne bloque pas
  const ao = sub(a, o);
  const t = cross(ao, e) / den, u = cross(ao, d) / den;
  if (t < -1e-9 || u < -1e-9 || u > 1 + 1e-9) return Infinity;
  return Math.max(0, t);
}

/** Paramètre d'entrée du rayon dans un rectangle (0 si l'origine est strictement dedans), ou Infinity. Contact rasant ignoré. */
function rayonRect(o: Vec2, d: Vec2, r: Rect): number {
  const e = 1e-9;
  if (o[0] > r.minX + e && o[0] < r.maxX - e && o[1] > r.minY + e && o[1] < r.maxY - e) return 0;
  let tE = 0, tL = Infinity;
  const axes: Array<[number, number, number, number]> = [[o[0], d[0], r.minX, r.maxX], [o[1], d[1], r.minY, r.maxY]];
  for (const [oc, dc, lo, hi] of axes) {
    if (Math.abs(dc) < 1e-12) { if (oc <= lo + e || oc >= hi - e) return Infinity; continue; }
    let t1 = (lo - oc) / dc, t2 = (hi - oc) / dc;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tE = Math.max(tE, t1); tL = Math.min(tL, t2);
  }
  return tE <= tL + 1e-12 && tL >= -1e-9 ? Math.max(0, tE) : Infinity;
}

/** Intervalle [tE, tL] du rayon (segment [0, tMax]) dans un polygone convexe (Cyrus-Beck), ou null. */
export function rayonConvexe(o: Vec2, d: Vec2, poly: Vec2[], tMax: number): [number, number] | null {
  const s = signedArea(poly) >= 0 ? 1 : -1;
  let tE = 0, tL = tMax;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!, q = poly[(i + 1) % poly.length]!;
    const e = sub(q, p);
    const n: Vec2 = s > 0 ? [e[1], -e[0]] : [-e[1], e[0]]; // normale sortante
    if (Math.abs(n[0]) + Math.abs(n[1]) < 1e-12) continue;
    const num = dot(n, sub(p, o)), den = dot(n, d);
    if (Math.abs(den) < 1e-12) { if (num < -1e-12) return null; continue; }
    const t = num / den;
    if (den > 0) tL = Math.min(tL, t); else tE = Math.max(tE, t);
    if (tE > tL) return null;
  }
  return [tE, tL];
}

export interface ObstaclesRayon {
  segments: Array<[Vec2, Vec2]>;
  rects: Rect[];
  /** Débattements (convexes) et pénétration tolérée. */
  zones: Vec2[][];
  tolZone: number;
}

/** Longueur libre d'un rayon (plafonnée à RAYON_MAX). */
export function longueurRayon(o: Vec2, d: Vec2, obs: ObstaclesRayon): number {
  let t = RAYON_MAX;
  for (const [a, b] of obs.segments) t = Math.min(t, rayonSegment(o, d, a, b));
  for (const r of obs.rects) t = Math.min(t, rayonRect(o, d, r));
  for (const z of obs.zones) {
    const iv = rayonConvexe(o, d, z, RAYON_MAX);
    if (!iv) continue;
    const [tE, tL] = iv;
    if (tL - tE <= obs.tolZone + 1e-9) continue; // traversée dans la tolérance
    t = Math.min(t, tE + obs.tolZone);
  }
  return Math.max(0, t);
}

/** Abscisses d'échantillonnage sur [0, L] : de PAS à L − PAS par pas de PAS (au moins le milieu). */
export function echantillons(L: number): number[] {
  if (L <= 2 * PAS + 1e-9) return [L / 2];
  const out: number[] = [];
  for (let k = 1; k * PAS <= L - PAS + 1e-9; k++) out.push(k * PAS);
  if (L - PAS - out[out.length - 1]! > 1e-9) out.push(L - PAS);
  return out;
}

/**
 * Points de départ des rayons d'un côté de l'emprise, et direction.
 * `zoneLongueur` (côtés latéraux) : points mesurés depuis le bord arrière, prolongés au-delà du côté si besoin.
 */
export function pointsCote(p: Placement, spec: FurnitureSpec, fp: Rect, cote: Cote, zoneLongueur?: number): { dir: Vec2; pts: Array<{ pt: Vec2; prolongement: boolean }> } {
  const dir = directionCote(p.rotationDeg, cote);
  const c: Vec2 = [(fp.minX + fp.maxX) / 2, (fp.minY + fp.maxY) / 2];
  const W = fp.maxX - fp.minX, H = fp.maxY - fp.minY;
  const horiz = Math.abs(dir[0]) > 0.5;
  const off = horiz ? W / 2 : H / 2;
  const base: Vec2 = [c[0] + dir[0] * off, c[1] + dir[1] * off];
  const lateral = cote === 'left' || cote === 'right';
  if (lateral && zoneLongueur !== undefined) {
    const f = frontDir(p.rotationDeg);
    const prof = spec.size.d; // profondeur locale (axe devant)
    const depart: Vec2 = [base[0] - f[0] * prof / 2, base[1] - f[1] * prof / 2];
    return { dir, pts: echantillons(zoneLongueur).map((t) => ({ pt: [depart[0] + f[0] * t, depart[1] + f[1] * t] as Vec2, prolongement: t > prof + 1e-9 })) };
  }
  const L = horiz ? H : W;
  const u: Vec2 = horiz ? [0, 1] : [1, 0];
  return { dir, pts: echantillons(L).map((t) => ({ pt: [base[0] + u[0] * (t - L / 2), base[1] + u[1] * (t - L / 2)] as Vec2, prolongement: false })) };
}

/** Point local (x, y) du meuble converti en monde (rotation anti-horaire de rotationDeg). */
export function localVersMonde(p: Placement, x: number, y: number): Vec2 {
  const f = frontDir(p.rotationDeg); // image de (0,1)
  const r: Vec2 = [f[1], -f[0]];     // image de (1,0)
  return [p.center[0] + r[0] * x + f[0] * y, p.center[1] + r[1] * x + f[1] * y];
}

/** Milieu du bord avant de l'emprise. */
export function milieuAvant(p: Placement, spec: FurnitureSpec): Vec2 {
  return localVersMonde(p, 0, spec.size.d / 2);
}
