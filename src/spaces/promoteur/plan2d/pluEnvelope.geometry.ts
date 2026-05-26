// src/spaces/promoteur/plan2d/pluEnvelope.geometry.ts — v9
//
// Inward offset polygon + résolveur d'auto-intersections.
// Aucun clip Sutherland-Hodgman global → stable sur toutes formes de parcelles.
//
// Pipeline :
//   1. classifyEdgeSetbacks   → front / side / rear
//   2. buildOffsetPolygon     → miter (sommet convexe) / bevel (sommet concave)
//   3. resolvePolygon         → supprime les boucles parasites d'auto-intersection
//                               en gardant le sous-polygone qui contient un point
//                               de référence GARANTI à l'intérieur de la parcelle
//   4. clampToInterior        → sécurité : points hors-parcelle ramenés à l'intérieur
//   5. removeNearDuplicates + removeCollinear
//   6. Validation aire
//
// Robustesse clé :
//   • findInteriorPoint()  → centroïde surfacique (Σ aires), puis scan de l'arête
//                            la plus longue si le centroïde est hors-polygone.
//                            Garantit un point de référence correct même sur
//                            des parcelles très concaves ou en L/U.
//   • resolvePolygon()     → fallback "sous-polygone le plus grand" si le point
//                            de référence tombe dans les deux ou aucune portion.
//
// Exports conservés :
//   polygonAreaM2 · pointInPolygon · nearestParcelEdge
//   computeBuildableEnvelope · isRectPartiallyInsidePolygon

import type { Point2D, OrientedRect } from './editor2d.types';
import { rectCorners } from './editor2d.geometry';

export interface SetbackRules {
  frontM: number;
  sideM:  number;
  rearM:  number;
}

const EPS         = 1e-9;
const SEG_EPS     = 1e-6;
const MITER_LIMIT = 8;
const DEDUP_DIST  = 0.05;
const COLLIN_SIN  = 0.02;

// ── Utilitaires géométriques ───────────────────────────────────────────

export function polygonAreaM2(poly: Point2D[]): number {
  if (poly.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    area += poly[i].x * poly[j].y - poly[j].x * poly[i].y;
  }
  return Math.abs(area) / 2;
}

function shoelaceSigned(poly: Point2D[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    s += poly[i].x * poly[j].y - poly[j].x * poly[i].y;
  }
  return s;
}

function dot(a: Point2D, b: Point2D): number {
  return a.x * b.x + a.y * b.y;
}

function normalize(v: Point2D): Point2D {
  const len = Math.hypot(v.x, v.y);
  return len < EPS ? { x: 0, y: 0 } : { x: v.x / len, y: v.y / len };
}

// Centroïde des sommets (rapide, peut être hors-polygone pour les formes très concaves)
function vertexCentroid(poly: Point2D[]): Point2D {
  return {
    x: poly.reduce((s, p) => s + p.x, 0) / poly.length,
    y: poly.reduce((s, p) => s + p.y, 0) / poly.length,
  };
}

// Centroïde surfacique (formule shoelace pondérée) — plus fiable pour les concaves
function areaCentroid(poly: Point2D[]): Point2D {
  const n = poly.length;
  let cx = 0, cy = 0, signedArea = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const cross = poly[i].x * poly[j].y - poly[j].x * poly[i].y;
    signedArea += cross;
    cx += (poly[i].x + poly[j].x) * cross;
    cy += (poly[i].y + poly[j].y) * cross;
  }
  if (Math.abs(signedArea) < EPS) return vertexCentroid(poly);
  return { x: cx / (3 * signedArea), y: cy / (3 * signedArea) };
}

// Trouve un point GARANTI à l'intérieur de la parcelle.
// Stratégie :
//   1. Centroïde surfacique
//   2. Si hors-polygon → pour chaque arête, sonde des points décalés vers
//      l'intérieur (1 m, 2 m, 5 m) jusqu'à trouver un point intérieur.
//   3. Fallback : centroïde des sommets
function findInteriorPoint(poly: Point2D[]): Point2D {
  const c = areaCentroid(poly);
  if (pointInPolygon(c, poly)) return c;

  // Scan des milieux d'arêtes + décalage vers l'intérieur approximatif
  const vc = vertexCentroid(poly);
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const mid: Point2D = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < EPS) continue;
    // Normale vers le centroïde des sommets (approximation de "vers l'intérieur")
    const nx = -dy / len, ny = dx / len;
    const toVc = dot({ x: vc.x - mid.x, y: vc.y - mid.y }, { x: nx, y: ny });
    const sign = toVc >= 0 ? 1 : -1;
    for (const d of [1, 2, 5, 0.5, 10]) {
      const p: Point2D = { x: mid.x + sign * nx * d, y: mid.y + sign * ny * d };
      if (pointInPolygon(p, poly)) return p;
    }
  }

  return vc; // fallback
}

function edgeInwardNormal(poly: Point2D[], i: number, c: Point2D): Point2D {
  const a = poly[i], b = poly[(i + 1) % poly.length];
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < EPS) return { x: 0, y: 0 };
  const n1: Point2D = { x: -dy / len, y:  dx / len };
  const n2: Point2D = { x:  dy / len, y: -dx / len };
  const mid: Point2D = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const toC: Point2D = { x: c.x - mid.x, y: c.y - mid.y };
  return dot(n1, toC) >= dot(n2, toC) ? n1 : n2;
}

function edgeDir(poly: Point2D[], i: number): Point2D {
  const a = poly[i], b = poly[(i + 1) % poly.length];
  return normalize({ x: b.x - a.x, y: b.y - a.y });
}

function crossTurn(prev: Point2D, curr: Point2D, next: Point2D): number {
  return (curr.x - prev.x) * (next.y - curr.y)
       - (curr.y - prev.y) * (next.x - curr.x);
}

function isVertexConvex(poly: Point2D[], i: number, isCW: boolean): boolean {
  const n    = poly.length;
  const prev = poly[(i - 1 + n) % n];
  const curr = poly[i];
  const next = poly[(i + 1) % n];
  const c    = crossTurn(prev, curr, next);
  return isCW ? c > 0 : c < 0;
}

function lineIntersect(
  p: Point2D, d1: Point2D,
  q: Point2D, d2: Point2D,
): Point2D | null {
  const denom = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(denom) < EPS) return null;
  const ex = q.x - p.x, ey = q.y - p.y;
  const t  = (ex * d2.y - ey * d2.x) / denom;
  return { x: p.x + t * d1.x, y: p.y + t * d1.y };
}

interface SegInter { pt: Point2D; t: number; u: number }
function segSegIntersect(
  a: Point2D, b: Point2D,
  c: Point2D, d: Point2D,
): SegInter | null {
  const d1x = b.x - a.x, d1y = b.y - a.y;
  const d2x = d.x - c.x, d2y = d.y - c.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < EPS) return null;
  const ex = c.x - a.x, ey = c.y - a.y;
  const t  = (ex * d2y - ey * d2x) / denom;
  const u  = (ex * d1y - ey * d1x) / denom;
  if (t > SEG_EPS && t < 1 - SEG_EPS && u > SEG_EPS && u < 1 - SEG_EPS) {
    return { pt: { x: a.x + t * d1x, y: a.y + t * d1y }, t, u };
  }
  return null;
}

export function pointInPolygon(p: Point2D, poly: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const hit =
      yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / ((yj - yi) || 1e-12) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

function ptSegDist(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < EPS) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

export function nearestParcelEdge(
  p: Point2D,
  poly: Point2D[],
  thresholdWorld: number,
): number | null {
  let minDist = Infinity, nearest: number | null = null;
  for (let i = 0; i < poly.length; i++) {
    const d = ptSegDist(p, poly[i], poly[(i + 1) % poly.length]);
    if (d < minDist && d < thresholdWorld) { minDist = d; nearest = i; }
  }
  return nearest;
}

function clampToInterior(p: Point2D, poly: Point2D[], c: Point2D): Point2D {
  let best = p, bestDist = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < EPS) continue;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    const proj: Point2D = { x: a.x + t * dx, y: a.y + t * dy };
    const dist = Math.hypot(p.x - proj.x, p.y - proj.y);
    if (dist < bestDist) { bestDist = dist; best = proj; }
  }
  return {
    x: best.x + (c.x - best.x) * 0.002,
    y: best.y + (c.y - best.y) * 0.002,
  };
}

function removeNearDuplicates(poly: Point2D[], minDist = DEDUP_DIST): Point2D[] {
  if (poly.length === 0) return [];
  const out: Point2D[] = [poly[0]];
  for (let i = 1; i < poly.length; i++) {
    const prev = out[out.length - 1];
    if (Math.hypot(poly[i].x - prev.x, poly[i].y - prev.y) > minDist) {
      out.push(poly[i]);
    }
  }
  if (
    out.length > 2 &&
    Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) <= minDist
  ) {
    out.pop();
  }
  return out;
}

function removeCollinear(poly: Point2D[], sinTol = COLLIN_SIN): Point2D[] {
  if (poly.length < 3) return poly;
  const out: Point2D[] = [];
  for (let i = 0; i < poly.length; i++) {
    const prev = poly[(i - 1 + poly.length) % poly.length];
    const curr = poly[i];
    const next = poly[(i + 1) % poly.length];
    const cross = Math.abs(
      (curr.x - prev.x) * (next.y - curr.y) -
      (curr.y - prev.y) * (next.x - curr.x),
    );
    const d1 = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const d2 = Math.hypot(next.x - curr.x, next.y - curr.y);
    if (d1 * d2 < EPS || cross / (d1 * d2) > sinTol) {
      out.push(curr);
    }
  }
  return out.length >= 3 ? out : poly;
}

// ── Classification des reculs par arête ───────────────────────────────

function classifyEdgeSetbacks(
  n:              number,
  frontEdgeIndex: number | null,
  rules:          SetbackRules,
): number[] {
  if (frontEdgeIndex === null) {
    const uniform = Math.max(
      Number.isFinite(rules.frontM) ? rules.frontM : 0,
      Number.isFinite(rules.sideM)  ? rules.sideM  : 0,
      Number.isFinite(rules.rearM)  ? rules.rearM  : 0,
    );
    return Array(n).fill(uniform);
  }
  const rearIndex = (frontEdgeIndex + Math.floor(n / 2)) % n;
  return Array.from({ length: n }, (_, i) => {
    if (i === frontEdgeIndex) return Math.max(0, rules.frontM ?? 0);
    if (i === rearIndex)      return Math.max(0, rules.rearM  ?? 0);
    return Math.max(0, rules.sideM ?? 0);
  });
}

// ── Construction du polygone offset (miter / bevel) ───────────────────
//
// Pour chaque sommet i (jonction arête prevEdge=(i-1) et currEdge=i) :
//   aPrev = poly[i] + normal[prevEdge] * setback[prevEdge]
//   aCurr = poly[i] + normal[currEdge] * setback[currEdge]
//
//   Convexe → intersection miter (limitée par MITER_LIMIT)
//   Concave → bevel : aPrev + aCurr (pan coupé propre, pas de pic)

function buildOffsetPolygon(
  poly:     Point2D[],
  setbacks: number[],
  c:        Point2D,
  isCW:     boolean,
): Point2D[] {
  const n = poly.length;

  const normals: Point2D[] = [];
  const dirs:    Point2D[] = [];
  for (let i = 0; i < n; i++) {
    normals.push(edgeInwardNormal(poly, i, c));
    dirs.push(edgeDir(poly, i));
  }

  const result: Point2D[] = [];

  for (let i = 0; i < n; i++) {
    const prevEdge = (i - 1 + n) % n;
    const currEdge = i;

    const aPrev: Point2D = {
      x: poly[i].x + normals[prevEdge].x * setbacks[prevEdge],
      y: poly[i].y + normals[prevEdge].y * setbacks[prevEdge],
    };
    const aCurr: Point2D = {
      x: poly[i].x + normals[currEdge].x * setbacks[currEdge],
      y: poly[i].y + normals[currEdge].y * setbacks[currEdge],
    };

    if (isVertexConvex(poly, i, isCW)) {
      const inter = lineIntersect(aPrev, dirs[prevEdge], aCurr, dirs[currEdge]);
      if (inter !== null) {
        const miterLen = Math.hypot(inter.x - poly[i].x, inter.y - poly[i].y);
        const maxMiter = Math.max(setbacks[prevEdge], setbacks[currEdge]) * MITER_LIMIT + 1;
        if (miterLen <= maxMiter) {
          result.push(inter);
        } else {
          // Angle très aigu → bevel de sécurité
          result.push(aPrev);
          result.push(aCurr);
        }
      } else {
        // Arêtes parallèles
        result.push({ x: (aPrev.x + aCurr.x) / 2, y: (aPrev.y + aCurr.y) / 2 });
      }
    } else {
      // Sommet concave : bevel (les droites divergent vers l'extérieur)
      result.push(aPrev);
      result.push(aCurr);
    }
  }

  return result;
}

// ── Résolveur d'auto-intersections ────────────────────────────────────
//
// Trouver la première auto-intersection du polygone offset, la couper en
// deux sous-polygones, garder celui qui contient le point de référence
// intérieur de la parcelle. Fallback : le plus grand des deux.
//
// Itérer jusqu'à absence totale d'auto-intersection (max 40 passes).

function resolveSelfIntersectionOnce(
  poly:      Point2D[],
  refPoint:  Point2D,
): Point2D[] | null {
  const n = poly.length;

  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];

    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;

      const inter = segSegIntersect(a, b, poly[j], poly[(j + 1) % n]);
      if (!inter) continue;

      const P = inter.pt;

      // subA : boucle entre les deux arêtes croisées
      const subA: Point2D[] = [P];
      for (let k = i + 1; k <= j; k++) subA.push(poly[k]);

      // subB : le reste
      const subB: Point2D[] = [P];
      for (let k = j + 1; k < n; k++) subB.push(poly[k]);
      for (let k = 0; k <= i; k++)     subB.push(poly[k]);

      const cInA = subA.length >= 3 && pointInPolygon(refPoint, subA);
      const cInB = subB.length >= 3 && pointInPolygon(refPoint, subB);

      let chosen: Point2D[];
      if (cInA && !cInB) {
        chosen = subA;
      } else if (cInB && !cInA) {
        chosen = subB;
      } else {
        // Fallback : garder le plus grand (boucle parasite = plus petite)
        chosen = polygonAreaM2(subA) >= polygonAreaM2(subB) ? subA : subB;
      }

      return removeNearDuplicates(chosen, DEDUP_DIST);
    }
  }

  return null;
}

function resolvePolygon(
  poly:     Point2D[],
  refPoint: Point2D,
  maxIter = 40,
): Point2D[] {
  let result = poly;
  for (let iter = 0; iter < maxIter; iter++) {
    if (result.length < 3) return [];
    const next = resolveSelfIntersectionOnce(result, refPoint);
    if (next === null) break;
    result = next;
  }
  return result;
}

// ── Enveloppe constructible ────────────────────────────────────────────

export function computeBuildableEnvelope(
  poly:           Point2D[],
  frontEdgeIndex: number | null,
  rules:          SetbackRules,
): Point2D[] {
  if (poly.length < 3) return [];

  const parcelArea = polygonAreaM2(poly);
  if (parcelArea < 0.5) return [];

  const n    = poly.length;
  const isCW = shoelaceSigned(poly) > 0;

  // Point de référence intérieur garanti (robuste aux parcelles très concaves)
  const refPoint = findInteriorPoint(poly);

  const edgeSetbacks = classifyEdgeSetbacks(n, frontEdgeIndex, rules);

  if (edgeSetbacks.every(s => s <= 0)) return [...poly];

  // 1. Polygone offset (miter/bevel, peut être auto-intersectant)
  let offset = buildOffsetPolygon(poly, edgeSetbacks, refPoint, isCW);
  if (offset.length < 3) {
    console.warn('[Mimmoza][PLU] buildOffsetPolygon → polygone vide');
    return [];
  }

  // 2. Résolution des boucles parasites
  offset = resolvePolygon(offset, refPoint);
  if (offset.length < 3) {
    console.warn('[Mimmoza][PLU] resolvePolygon → polygone vide');
    return [];
  }

  // 3. Sécurité : ramener les points hors-parcelle à l'intérieur
  offset = offset.map(p =>
    pointInPolygon(p, poly) ? p : clampToInterior(p, poly, refPoint),
  );

  // 4. Nettoyage géométrique
  let clean = removeNearDuplicates(offset, DEDUP_DIST);
  clean = removeCollinear(clean, COLLIN_SIN);

  if (clean.length < 3) {
    console.warn('[Mimmoza][PLU] Enveloppe dégénérée après nettoyage');
    return [];
  }

  // 5. Validation aire
  const envelopeArea = polygonAreaM2(clean);

  if (envelopeArea < 0.5) {
    console.warn('[Mimmoza][PLU] Enveloppe rejetée : aire trop faible', { envelopeArea });
    return [];
  }

  if (envelopeArea > parcelArea * 1.001) {
    console.warn('[Mimmoza][PLU] Enveloppe rejetée : aire > parcelle', {
      parcelArea, envelopeArea, rules,
    });
    return [];
  }

  return clean;
}

// ── Helpers exportés ───────────────────────────────────────────────────

export function isRectPartiallyInsidePolygon(
  rect: OrientedRect,
  poly: Point2D[],
): boolean {
  if (poly.length < 3) return false;
  return rectCorners(rect).some(corner => pointInPolygon(corner, poly));
}