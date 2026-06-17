// src/spaces/promoteur/plan2d/pluEnvelope.geometry.ts — v12
//
// Inward offset polygon + résolveur d'auto-intersections.
// Aucun clip Sutherland-Hodgman global → stable sur toutes formes de parcelles.
//
// CHANGEMENTS v12 (vs v11) — corrige le notch persistant aux pointes :
//   • simplifyClosed (Douglas-Peucker) en TÊTE de computeBuildableEnvelope.
//     CAUSE RACINE : buildOffsetPolygon itère sur chaque sommet BRUT du cadastre
//     (le regroupement en faces ne sert qu'à l'attribution des reculs, pas à la
//     géométrie de l'offset). Aux pointes, chaque micro-sommet émet un point
//     offset → ils zigzaguent → notch. DP retire le bruit des côtés mais garde
//     les vrais coins/pointes (forte déviation) → l'offset tourne sur une
//     géométrie propre, la pointe = 1 seul apex net.
//   • buildOffsetPolygon : sur angle aigu, l'apex est borné LE LONG de la
//     bissectrice (vers l'intérieur) au lieu de pousser aPrev/aCurr (qui
//     débordaient vers la pointe).
//   • frontEdgeIndex est remappé sur le polygone simplifié (par proximité du
//     milieu de l'arête façade d'origine).
//
// CHANGEMENTS v11 :
//   • removeSpikes : supprime les "aiguilles" (rebroussements) laissées par
//     resolvePolygon sur les pointes trop étroites pour le recul.
//
// CHANGEMENTS v10 :
//   1. classifyEdgeSetbacks raisonne sur des FACES (groupes d'arêtes colinéaires).
//   2. buildOffsetPolygon : garde-fou quasi-colinéaire (bissecteur).
//
// Pipeline :
//   0. simplifyClosed         → Douglas-Peucker (retire le bruit cadastral)
//   1. classifyEdgeSetbacks   → front / side / rear (par faces)
//   2. buildOffsetPolygon     → miter (convexe) / bevel (concave) / bissecteur
//   3. resolvePolygon         → supprime les boucles parasites d'auto-intersection
//   4. clampToInterior        → points hors-parcelle ramenés à l'intérieur
//   5. removeNearDuplicates + removeCollinear + removeSpikes
//   6. Validation aire
//
// Exports conservés :
//   polygonAreaM2 · pointInPolygon · nearestParcelEdge
//   computeBuildableEnvelope · isRectPartiallyInsidePolygon

import { rectCorners } from './editor2d.geometry';
import type { OrientedRect, Point2D } from './editor2d.types';

export interface SetbackRules {
  frontM: number;
  sideM:  number;
  rearM:  number;
}

const EPS                = 1e-9;
const SEG_EPS            = 1e-6;
const MITER_LIMIT        = 8;
const DEDUP_DIST         = 0.05;
const COLLIN_SIN         = 0.02;
const NEAR_COLLINEAR_SIN = 0.07;  // ~4° : seuil de quasi-colinéarité (miter)
const FACE_ANGLE_TOL_DEG = 12;    // tolérance de regroupement des arêtes en faces
const SPIKE_REVERSE_DOT  = -0.7;  // rebroussement > ~134° = aiguille à supprimer
const SIMPLIFY_EPS_M     = 0.5;   // Douglas-Peucker : tolérance de simplification (m)

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

function crossZ(a: Point2D, b: Point2D): number {
  return a.x * b.y - a.y * b.x;
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

// ── Simplification Douglas-Peucker (polygone fermé) ────────────────────
//
// Retire les micro-segments parasites de la numérisation cadastrale tout en
// conservant les vrais coins (forte déviation). C'est ce polygone qui alimente
// l'offset → plus de points offset parasites aux pointes.

// Distance point → DROITE (a,b) (pas segment) : DP travaille sur la droite.
function perpLineDist(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < EPS) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs(dx * (a.y - p.y) - (a.x - p.x) * dy) / len;
}

function douglasPeuckerOpen(pts: Point2D[], eps: number): Point2D[] {
  if (pts.length < 3) return pts.slice();
  let maxD = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpLineDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD > eps) {
    const left  = douglasPeuckerOpen(pts.slice(0, idx + 1), eps);
    const right = douglasPeuckerOpen(pts.slice(idx), eps);
    return left.slice(0, -1).concat(right);
  }
  return [pts[0], pts[pts.length - 1]];
}

function simplifyClosed(poly: Point2D[], eps: number): Point2D[] {
  const n = poly.length;
  if (n < 4) return poly.slice();

  // Ancrer sur le sommet le plus éloigné du centroïde : c'est un vrai coin
  // (souvent une pointe) → on garantit qu'il survit à la simplification.
  const c = vertexCentroid(poly);
  let anchor = 0, far = -Infinity;
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(poly[i].x - c.x, poly[i].y - c.y);
    if (d > far) { far = d; anchor = i; }
  }

  const rotated: Point2D[] = [];
  for (let k = 0; k <= n; k++) rotated.push(poly[(anchor + k) % n]); // boucle fermée (anchor dupliqué)

  const simplified = douglasPeuckerOpen(rotated, eps);
  simplified.pop(); // retire le doublon de fermeture

  return simplified.length >= 3 ? simplified : poly.slice();
}

// Trouve un point GARANTI à l'intérieur de la parcelle.
function findInteriorPoint(poly: Point2D[]): Point2D {
  const c = areaCentroid(poly);
  if (pointInPolygon(c, poly)) return c;

  const vc = vertexCentroid(poly);
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const mid: Point2D = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < EPS) continue;
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

// Supprime les "aiguilles" : sommets où le contour rebrousse chemin (directions
// entrante/sortante quasi opposées). Ce sont les moignons laissés par
// resolvePolygon sur les pointes trop étroites pour le recul. Les coins normaux
// (même aigus) ne rebroussent jamais à ce point → non touchés.
function removeSpikes(poly: Point2D[], reverseDot = SPIKE_REVERSE_DOT, maxIter = 6): Point2D[] {
  let pts = poly.slice();
  for (let iter = 0; iter < maxIter; iter++) {
    if (pts.length <= 4) break;
    let removed = -1;
    for (let i = 0; i < pts.length; i++) {
      const n = pts.length;
      const prev = pts[(i - 1 + n) % n];
      const curr = pts[i];
      const next = pts[(i + 1) % n];
      const ix = curr.x - prev.x, iy = curr.y - prev.y;
      const ox = next.x - curr.x, oy = next.y - curr.y;
      const il = Math.hypot(ix, iy), ol = Math.hypot(ox, oy);
      if (il < EPS || ol < EPS) { removed = i; break; }
      const d = (ix / il) * (ox / ol) + (iy / il) * (oy / ol);
      if (d < reverseDot) { removed = i; break; }
    }
    if (removed < 0) break;
    pts.splice(removed, 1);
  }
  return pts;
}

// ── Regroupement des arêtes en faces colinéaires ───────────────────────

interface ParcelFace {
  edgeIndices: number[];
  midpoint:    Point2D;
}

function groupCollinearFaces(
  poly: Point2D[],
  angleToleranceDeg: number,
): ParcelFace[] {
  const n = poly.length;
  if (n < 3) {
    return [{ edgeIndices: Array.from({ length: n }, (_, i) => i), midpoint: vertexCentroid(poly) }];
  }

  const dirs: Point2D[] = [];
  const lens: number[]  = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    dirs.push(normalize({ x: b.x - a.x, y: b.y - a.y }));
    lens.push(Math.hypot(b.x - a.x, b.y - a.y));
  }

  const cosTol = Math.cos((angleToleranceDeg * Math.PI) / 180);

  const groups: number[][] = [];
  for (let i = 0; i < n; i++) {
    if (groups.length === 0) { groups.push([i]); continue; }
    const last = groups[groups.length - 1];
    const refDir = dirs[last[last.length - 1]];

    if (lens[i] < SEG_EPS) { last.push(i); continue; }

    if (dot(dirs[i], refDir) >= cosTol) last.push(i);
    else groups.push([i]);
  }

  if (groups.length > 1) {
    const first = groups[0];
    const last  = groups[groups.length - 1];
    if (dot(dirs[first[0]], dirs[last[last.length - 1]]) >= cosTol) {
      groups[0] = last.concat(first);
      groups.pop();
    }
  }

  return groups.map((g) => {
    const startV = poly[g[0]];
    const endV   = poly[(g[g.length - 1] + 1) % n];
    return {
      edgeIndices: g,
      midpoint: { x: (startV.x + endV.x) / 2, y: (startV.y + endV.y) / 2 },
    };
  });
}

function faceOfEdge(faces: ParcelFace[], edgeIndex: number): number {
  for (let i = 0; i < faces.length; i++) {
    if (faces[i].edgeIndices.includes(edgeIndex)) return i;
  }
  return 0;
}

// ── Classification des reculs par arête (via faces) ───────────────────

function classifyEdgeSetbacks(
  poly:           Point2D[],
  frontEdgeIndex: number | null,
  rules:          SetbackRules,
): number[] {
  const n = poly.length;

  if (frontEdgeIndex === null) {
    const uniform = Math.max(
      Number.isFinite(rules.frontM) ? rules.frontM : 0,
      Number.isFinite(rules.sideM)  ? rules.sideM  : 0,
      Number.isFinite(rules.rearM)  ? rules.rearM  : 0,
    );
    return Array(n).fill(uniform);
  }

  const front = Math.max(0, rules.frontM ?? 0);
  const side  = Math.max(0, rules.sideM  ?? 0);
  const rear  = Math.max(0, rules.rearM  ?? 0);

  const faces = groupCollinearFaces(poly, FACE_ANGLE_TOL_DEG);

  const safeFrontIdx = ((frontEdgeIndex % n) + n) % n;
  const frontFaceIdx = faceOfEdge(faces, safeFrontIdx);

  const frontMid = faces[frontFaceIdx].midpoint;
  const c = areaCentroid(poly);
  const axis = normalize({ x: c.x - frontMid.x, y: c.y - frontMid.y });

  let rearFaceIdx = frontFaceIdx;
  let bestProj = -Infinity;
  for (let i = 0; i < faces.length; i++) {
    if (i === frontFaceIdx) continue;
    const m = faces[i].midpoint;
    const proj = (m.x - frontMid.x) * axis.x + (m.y - frontMid.y) * axis.y;
    if (proj > bestProj) { bestProj = proj; rearFaceIdx = i; }
  }

  const setbacks = Array(n).fill(side);
  for (const e of faces[frontFaceIdx].edgeIndices) setbacks[e] = front;
  if (rearFaceIdx !== frontFaceIdx) {
    for (const e of faces[rearFaceIdx].edgeIndices) setbacks[e] = rear;
  }

  return setbacks;
}

// ── Construction du polygone offset (miter / bevel / bissecteur) ──────

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

    // Garde-fou quasi-colinéaire : entre deux arêtes presque alignées,
    // l'intersection miter est instable → point stable sur le bissecteur.
    const turnSin = crossZ(dirs[prevEdge], dirs[currEdge]);
    if (Math.abs(turnSin) < NEAR_COLLINEAR_SIN) {
      result.push({ x: (aPrev.x + aCurr.x) / 2, y: (aPrev.y + aCurr.y) / 2 });
      continue;
    }

    if (isVertexConvex(poly, i, isCW)) {
      const inter = lineIntersect(aPrev, dirs[prevEdge], aCurr, dirs[currEdge]);
      if (inter !== null) {
        const miterLen = Math.hypot(inter.x - poly[i].x, inter.y - poly[i].y);
        const maxMiter = Math.max(setbacks[prevEdge], setbacks[currEdge]) * MITER_LIMIT + 1;
        if (miterLen <= maxMiter) {
          result.push(inter);
        } else {
          // Angle très aigu : on BORNE l'apex le long de la bissectrice (vers
          // l'intérieur), au lieu de pousser aPrev/aCurr qui débordent vers la pointe.
          const bx = (inter.x - poly[i].x) / miterLen;
          const by = (inter.y - poly[i].y) / miterLen;
          result.push({ x: poly[i].x + bx * maxMiter, y: poly[i].y + by * maxMiter });
        }
      } else {
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

      const subA: Point2D[] = [P];
      for (let k = i + 1; k <= j; k++) subA.push(poly[k]);

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

  // 0. Pré-simplification (Douglas-Peucker) : retire le bruit cadastral mais
  //    garde les vrais coins. L'offset tourne ensuite sur une géométrie propre.
  const origN = poly.length;
  const fiOrig = frontEdgeIndex;
  let origFrontMid: Point2D | null = null;
  if (fiOrig != null) {
    const fi = ((fiOrig % origN) + origN) % origN;
    const a = poly[fi], b = poly[(fi + 1) % origN];
    origFrontMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  const work = simplifyClosed(poly, SIMPLIFY_EPS_M);
  if (work.length < 3) return [];

  // Remap de l'arête façade sur le polygone simplifié.
  const frontIdx = origFrontMid ? nearestParcelEdge(origFrontMid, work, Infinity) : null;

  const parcelArea = polygonAreaM2(work);
  if (parcelArea < 0.5) return [];

  const isCW = shoelaceSigned(work) > 0;

  const refPoint = findInteriorPoint(work);

  const edgeSetbacks = classifyEdgeSetbacks(work, frontIdx, rules);

  if (edgeSetbacks.every(s => s <= 0)) return [...work];

  // 1. Polygone offset (miter/bevel/bissecteur, peut être auto-intersectant)
  let offset = buildOffsetPolygon(work, edgeSetbacks, refPoint, isCW);
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
    pointInPolygon(p, work) ? p : clampToInterior(p, work, refPoint),
  );

  // 4. Nettoyage géométrique
  let clean = removeNearDuplicates(offset, DEDUP_DIST);
  clean = removeCollinear(clean, COLLIN_SIN);
  clean = removeSpikes(clean);

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