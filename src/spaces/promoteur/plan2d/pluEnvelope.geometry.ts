// src/spaces/promoteur/plan2d/pluEnvelope.geometry.ts
//
// Géométrie de l'enveloppe constructible — retraits PLU différenciés.
// Repère : parcelleLocal (Y-down, mètres).
//
// Exports publics :
//   computeBuildableEnvelope      retraits front / side / rear par arête
//   polygonAreaM2                 aire fiable d'un polygone en m²
//   nearestParcelEdge             arête de parcelle la plus proche
//   pointInPolygon                test d'inclusion (ray casting)
//   isRectPartiallyInsidePolygon  compat backward

import type { Point2D, OrientedRect } from './editor2d.types';
import { rectCorners } from './editor2d.geometry';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface SetbackRules {
  frontM: number;
  sideM: number;
  rearM: number;
}

// ─── Primitives ────────────────────────────────────────────────────────────

export function polygonAreaM2(poly: Point2D[]): number {
  if (poly.length < 3) return 0;

  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    area += poly[i].x * poly[j].y - poly[j].x * poly[i].y;
  }

  return Math.abs(area) / 2;
}

/** Test d'inclusion point-dans-polygone. */
export function pointInPolygon(p: Point2D, poly: Point2D[]): boolean {
  let inside = false;

  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;

    const intersects =
      yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / ((yj - yi) || 1e-12) + xi;

    if (intersects) inside = !inside;
  }

  return inside;
}

/** Distance d'un point à un segment. */
function ptSegDist(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;

  if (len2 < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);

  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2),
  );

  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

// ─── Simplification Douglas-Peucker ───────────────────────────────────────

function perpDist(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);

  if (len < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);

  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
}

function dpRecurse(
  pts: Point2D[],
  eps: number,
  s: number,
  e: number,
  keep: boolean[],
): void {
  if (e <= s + 1) return;

  let maxD = 0;
  let maxI = s;

  for (let i = s + 1; i < e; i++) {
    const d = perpDist(pts[i], pts[s], pts[e]);
    if (d > maxD) {
      maxD = d;
      maxI = i;
    }
  }

  if (maxD > eps) {
    keep[maxI] = true;
    dpRecurse(pts, eps, s, maxI, keep);
    dpRecurse(pts, eps, maxI, e, keep);
  }
}

function simplifyPolygon(poly: Point2D[], epsilon: number): Point2D[] {
  const n = poly.length;
  if (n <= 5) return poly;

  const pts = [...poly, poly[0]];
  const keep = new Array(pts.length).fill(false);

  keep[0] = true;
  keep[pts.length - 1] = true;

  dpRecurse(pts, epsilon, 0, pts.length - 1, keep);

  const result = pts.filter((_, i) => keep[i]);
  result.pop();

  return result.length >= 4 ? result : poly;
}

function remapFrontEdge(orig: Point2D[], idx: number, simp: Point2D[]): number {
  const a = orig[idx];
  const b = orig[(idx + 1) % orig.length];

  const mid: Point2D = {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };

  let minD = Infinity;
  let best = 0;

  for (let i = 0; i < simp.length; i++) {
    const d = ptSegDist(mid, simp[i], simp[(i + 1) % simp.length]);
    if (d < minD) {
      minD = d;
      best = i;
    }
  }

  return best;
}

// ─── Arête la plus proche ──────────────────────────────────────────────────

export function nearestParcelEdge(
  p: Point2D,
  poly: Point2D[],
  thresholdWorld: number,
): number | null {
  let minDist = Infinity;
  let nearest: number | null = null;

  for (let i = 0; i < poly.length; i++) {
    const d = ptSegDist(p, poly[i], poly[(i + 1) % poly.length]);
    if (d < minDist && d < thresholdWorld) {
      minDist = d;
      nearest = i;
    }
  }

  return nearest;
}

// ─── Normales / classification ─────────────────────────────────────────────

function centroid(poly: Point2D[]): Point2D {
  return {
    x: poly.reduce((s, p) => s + p.x, 0) / poly.length,
    y: poly.reduce((s, p) => s + p.y, 0) / poly.length,
  };
}

function inwardNormal(poly: Point2D[], i: number, c: Point2D): Point2D {
  const n = poly.length;
  const a = poly[i];
  const b = poly[(i + 1) % n];

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);

  if (len < 1e-9) return { x: 0, y: 0 };

  const n1: Point2D = { x: -dy / len, y: dx / len };
  const n2: Point2D = { x: dy / len, y: -dx / len };

  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;

  const d1 = (mx + n1.x - c.x) ** 2 + (my + n1.y - c.y) ** 2;
  const d2 = (mx + n2.x - c.x) ** 2 + (my + n2.y - c.y) ** 2;

  return d1 < d2 ? n1 : n2;
}

function outwardNormal(poly: Point2D[], i: number, c: Point2D): Point2D {
  const inward = inwardNormal(poly, i, c);
  return { x: -inward.x, y: -inward.y };
}

type EdgeClass = 'front' | 'rear' | 'side';

function classifyEdges(poly: Point2D[], frontIdx: number): EdgeClass[] {
  const n = poly.length;
  const c = centroid(poly);
  const frontNorm = outwardNormal(poly, frontIdx, c);

  let minDot = Infinity;
  let rearIdx = (frontIdx + Math.floor(n / 2)) % n;

  for (let i = 0; i < n; i++) {
    if (i === frontIdx) continue;

    const on = outwardNormal(poly, i, c);
    const dot = on.x * frontNorm.x + on.y * frontNorm.y;

    if (dot < minDot) {
      minDot = dot;
      rearIdx = i;
    }
  }

  return poly.map((_, i) =>
    i === frontIdx ? 'front' : i === rearIdx ? 'rear' : 'side',
  ) as EdgeClass[];
}

// ─── Auto-intersections ────────────────────────────────────────────────────

function segSegIntersect(
  a: Point2D,
  b: Point2D,
  c: Point2D,
  d: Point2D,
): Point2D | null {
  const d1x = b.x - a.x;
  const d1y = b.y - a.y;
  const d2x = d.x - c.x;
  const d2y = d.y - c.y;

  const cross = d1x * d2y - d1y * d2x;
  if (Math.abs(cross) < 1e-10) return null;

  const t = ((c.x - a.x) * d2y - (c.y - a.y) * d2x) / cross;
  const u = ((c.x - a.x) * d1y - (c.y - a.y) * d1x) / cross;

  const eps = 1e-6;

  if (t > eps && t < 1 - eps && u > eps && u < 1 - eps) {
    return {
      x: a.x + t * d1x,
      y: a.y + t * d1y,
    };
  }

  return null;
}

function removeSelfIntersections(
  poly: Point2D[],
  refPoint: Point2D,
  depth = 0,
): Point2D[] {
  if (depth > 20 || poly.length < 4) return poly;

  const n = poly.length;

  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];

    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;

      const c = poly[j];
      const d = poly[(j + 1) % n];
      const pt = segSegIntersect(a, b, c, d);

      if (!pt) continue;

      const p1: Point2D[] = [pt];
      for (let k = i + 1; k <= j; k++) p1.push(poly[k]);

      const p2: Point2D[] = [
        ...poly.slice(0, i + 1),
        pt,
        ...poly.slice(j + 1),
      ];

      const chosen = pointInPolygon(refPoint, p1) ? p1 : p2;
      return removeSelfIntersections(chosen, refPoint, depth + 1);
    }
  }

  return poly;
}

// ─── Enveloppe constructible ───────────────────────────────────────────────

type ClipLine = {
  p: Point2D;
  inward: Point2D;
};

function isInsideHalfPlane(p: Point2D, line: ClipLine): boolean {
  const vx = p.x - line.p.x;
  const vy = p.y - line.p.y;

  return vx * line.inward.x + vy * line.inward.y >= -1e-6;
}

function segmentLineIntersection(
  a: Point2D,
  b: Point2D,
  line: ClipLine,
): Point2D | null {
  const abx = b.x - a.x;
  const aby = b.y - a.y;

  const denom = abx * line.inward.x + aby * line.inward.y;
  if (Math.abs(denom) < 1e-10) return null;

  const t =
    ((line.p.x - a.x) * line.inward.x +
      (line.p.y - a.y) * line.inward.y) /
    denom;

  if (t < -1e-6 || t > 1 + 1e-6) return null;

  return {
    x: a.x + abx * t,
    y: a.y + aby * t,
  };
}

function clipPolygon(subject: Point2D[], line: ClipLine): Point2D[] {
  if (subject.length < 3) return [];

  const output: Point2D[] = [];

  for (let i = 0; i < subject.length; i++) {
    const curr = subject[i];
    const prev = subject[(i - 1 + subject.length) % subject.length];

    const currInside = isInsideHalfPlane(curr, line);
    const prevInside = isInsideHalfPlane(prev, line);

    if (currInside) {
      if (!prevInside) {
        const inter = segmentLineIntersection(prev, curr, line);
        if (inter) output.push(inter);
      }

      output.push(curr);
    } else if (prevInside) {
      const inter = segmentLineIntersection(prev, curr, line);
      if (inter) output.push(inter);
    }
  }

  return output;
}

export function computeBuildableEnvelope(
  poly: Point2D[],
  frontEdgeIndex: number | null,
  rules: SetbackRules,
): Point2D[] {
  if (poly.length < 3) return [];

  const parcelArea = polygonAreaM2(poly);
  if (parcelArea < 0.5) return [];

  const simp = simplifyPolygon(poly, 1.0);
  const sn = simp.length;
  if (sn < 3) return [];

  const c = centroid(simp);

  const simpFrontIdx =
    frontEdgeIndex !== null ? remapFrontEdge(poly, frontEdgeIndex, simp) : null;

  const setbacks: number[] = (() => {
    if (simpFrontIdx !== null) {
      const classes = classifyEdges(simp, simpFrontIdx);

      return classes.map((edgeClass) => {
        if (edgeClass === 'front') return Math.max(0, rules.frontM);
        if (edgeClass === 'rear') return Math.max(0, rules.rearM);
        return Math.max(0, rules.sideM);
      });
    }

    const uniform = Math.max(
      0,
      Math.min(rules.frontM, rules.sideM, rules.rearM),
    );

    return new Array(sn).fill(uniform);
  })();

  const clipLines: ClipLine[] = [];

  for (let i = 0; i < sn; i++) {
    const a = simp[i];
    const inward = inwardNormal(simp, i, c);

    const setback = setbacks[i];

    if (!Number.isFinite(setback)) continue;
    if (Math.hypot(inward.x, inward.y) < 1e-9) continue;

    clipLines.push({
      p: {
        x: a.x + inward.x * setback,
        y: a.y + inward.y * setback,
      },
      inward,
    });
  }

  let envelope = [...simp];

  for (const line of clipLines) {
    envelope = clipPolygon(envelope, line);
    if (envelope.length < 3) return [];
  }

  const clean = removeSelfIntersections(envelope, c);
  if (clean.length < 3) return [];

  const cleanArea = polygonAreaM2(clean);

  if (cleanArea < 0.5) return [];

  // Verrou de sécurité : l'enveloppe constructible ne peut jamais dépasser la parcelle.
  // Si cela arrive, on renvoie une enveloppe vide plutôt qu'une donnée fausse.
  if (cleanArea > parcelArea * 1.001) {
    console.warn('[Mimmoza][PLU] Enveloppe rejetée : aire supérieure à la parcelle', {
      parcelArea,
      cleanArea,
      poly,
      clean,
      rules,
      frontEdgeIndex,
    });

    return [];
  }

  return clean;
}

// ─── Compat backward ────────────────────────────────────────────────────────

export function isRectPartiallyInsidePolygon(
  rect: OrientedRect,
  poly: Point2D[],
): boolean {
  if (poly.length < 3) return false;
  return rectCorners(rect).some((corner) => pointInPolygon(corner, poly));
}