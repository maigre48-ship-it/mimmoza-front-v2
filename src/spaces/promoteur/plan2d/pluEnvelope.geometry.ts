// src/spaces/promoteur/plan2d/pluEnvelope.geometry.ts
// Moteur de calcul de l'enveloppe constructible PLU.
//
// Algorithme :
//   Pour chaque arête de la parcelle :
//     1. Classer : avant / arrière / latéral (selon façade terrain choisie)
//     2. Calculer le recul correspondant
//     3. Décaler l'arête vers l'intérieur de `recul` mètres
//     4. Clipper le polygone courant contre cette arête décalée
//   → Le résultat est le polygone constructible

import type { Point2D } from './editor2d.types';
import type { SetbackRules, EdgeRole } from './pluEnvelope.types';

// ─── UTILITAIRES GÉOMÉTRIQUES ─────────────────────────────────────────

/** Distance d'un point à un segment. */
export function pointToSegmentDist(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x-a.x, dy = b.y-a.y, len2 = dx*dx+dy*dy;
  if (len2 < 1e-10) return Math.sqrt((p.x-a.x)**2 + (p.y-a.y)**2);
  const t = Math.max(0, Math.min(1, ((p.x-a.x)*dx+(p.y-a.y)*dy)/len2));
  return Math.sqrt((p.x-a.x-t*dx)**2 + (p.y-a.y-t*dy)**2);
}

/** Point dans polygone — ray casting. */
export function pointInPolygon(p: Point2D, poly: Point2D[]): boolean {
  let inside = false;
  const n = poly.length;
  for (let i=0, j=n-1; i<n; j=i++) {
    const pi=poly[i], pj=poly[j];
    if ((pi.y>p.y)!==(pj.y>p.y) && p.x<(pj.x-pi.x)*(p.y-pi.y)/(pj.y-pi.y)+pi.x)
      inside = !inside;
  }
  return inside;
}

/** Centroïde d'un polygone. */
function centroid(poly: Point2D[]): Point2D {
  return {
    x: poly.reduce((s,p)=>s+p.x,0)/poly.length,
    y: poly.reduce((s,p)=>s+p.y,0)/poly.length,
  };
}

/**
 * Normale entrante d'une arête (pointe vers l'intérieur du polygone).
 * Robuste quelle que soit l'orientation du polygone (CW ou CCW).
 */
function inwardNormal(
  p1: Point2D, p2: Point2D, polyCenter: Point2D,
): { x:number; y:number } {
  const dx=p2.x-p1.x, dy=p2.y-p1.y, len=Math.sqrt(dx*dx+dy*dy);
  if (len<1e-10) return {x:0,y:0};
  const n1={x:-dy/len, y:dx/len}, n2={x:dy/len, y:-dx/len};
  const mx=(p1.x+p2.x)/2, my=(p1.y+p2.y)/2;
  const dot=n1.x*(polyCenter.x-mx)+n1.y*(polyCenter.y-my);
  return dot>0 ? n1 : n2;
}

// ─── CLASSIFICATION DES ARÊTES ────────────────────────────────────────

/**
 * Classe chaque arête comme 'front' / 'rear' / 'side'.
 *
 * Logique :
 *   - front = arête d'index `frontIdx` (façade terrain choisie)
 *   - rear  = arête dont la normale sortante est la plus opposée à celle du front
 *   - side  = toutes les autres arêtes
 */
export function classifyParcelEdges(poly: Point2D[], frontIdx: number): EdgeRole[] {
  const n = poly.length;
  const c = centroid(poly);

  const fp1=poly[frontIdx], fp2=poly[(frontIdx+1)%n];
  const frontIn  = inwardNormal(fp1, fp2, c);
  const frontOut = { x:-frontIn.x, y:-frontIn.y };

  // Trouver l'arête arrière (normale sortante la plus anti-parallèle au front)
  let rearIdx=-1, minDot=Infinity;
  for (let i=0; i<n; i++) {
    if (i===frontIdx) continue;
    const p1=poly[i], p2=poly[(i+1)%n];
    const inn=inwardNormal(p1,p2,c);
    const out={x:-inn.x,y:-inn.y};
    const dot=out.x*frontOut.x+out.y*frontOut.y;
    if (dot<minDot){ minDot=dot; rearIdx=i; }
  }

  return poly.map((_,i) => i===frontIdx?'front' : i===rearIdx?'rear' : 'side');
}

// ─── CLIPPING SUTHERLAND-HODGMAN ─────────────────────────────────────
//
// Découpe un polygone contre une demi-plane définie par une ligne décalée.
// On conserve le côté "intérieur" (celui de la normale entrante).

function clipByOffsetLine(
  poly:     Point2D[],
  lineP1:   Point2D, lineP2: Point2D,
  inwardN:  { x:number; y:number },
): Point2D[] {
  if (!poly.length) return [];

  // Un point est "inside" si son produit scalaire avec la normale est >= 0
  const inside = (p: Point2D) =>
    (p.x-lineP1.x)*inwardN.x + (p.y-lineP1.y)*inwardN.y >= -1e-8;

  const intersect = (a: Point2D, b: Point2D): Point2D => {
    const dxAB=b.x-a.x, dyAB=b.y-a.y;
    const denom=dxAB*inwardN.x+dyAB*inwardN.y;
    if (Math.abs(denom)<1e-10) return a;
    const t=((lineP1.x-a.x)*inwardN.x+(lineP1.y-a.y)*inwardN.y)/denom;
    return {x:a.x+t*dxAB, y:a.y+t*dyAB};
  };

  const result: Point2D[] = [];
  const n = poly.length;
  for (let i=0; i<n; i++) {
    const cur=poly[i], nxt=poly[(i+1)%n];
    const cIn=inside(cur), nIn=inside(nxt);
    if (cIn) result.push(cur);
    if (cIn!==nIn) result.push(intersect(cur,nxt));
  }
  return result;
}

// ─── API PUBLIQUE ─────────────────────────────────────────────────────

/**
 * Trouve l'arête de la parcelle la plus proche d'un point,
 * dans un rayon `thresholdM` mètres.
 *
 * @returns index de l'arête, ou null si aucune dans le rayon.
 */
export function nearestParcelEdge(
  p:          Point2D,
  poly:       Point2D[],
  thresholdM: number,
): number | null {
  const n=poly.length;
  let best=-1, bestD=Infinity;
  for (let i=0; i<n; i++) {
    const d=pointToSegmentDist(p, poly[i], poly[(i+1)%n]);
    if (d<thresholdM && d<bestD){ bestD=d; best=i; }
  }
  return best>=0 ? best : null;
}

/** Retourne le milieu d'une arête du polygone. */
export function edgeMidpoint(poly: Point2D[], idx: number): Point2D {
  const n=poly.length, p1=poly[idx], p2=poly[(idx+1)%n];
  return {x:(p1.x+p2.x)/2, y:(p1.y+p2.y)/2};
}

/**
 * Calcule l'enveloppe constructible (polygone intérieur) à partir de :
 *   - `parcel`           : polygone de la parcelle (Point2D[])
 *   - `frontEdgeIndex`   : arête façade terrain (null = non sélectionnée)
 *   - `rules`            : reculs front / latéraux / arrière en mètres
 *
 * @returns polygone constructible (≥3 points), ou null si impossible.
 *
 * Algorithme : Sutherland-Hodgman sur chaque arête décalée vers l'intérieur.
 */
export function computeBuildableEnvelope(
  parcel:         Point2D[],
  frontEdgeIndex: number | null,
  rules:          SetbackRules,
): Point2D[] | null {
  if (parcel.length < 3 || frontEdgeIndex === null) return null;

  const n   = parcel.length;
  const c   = centroid(parcel);
  const roles = classifyParcelEdges(parcel, frontEdgeIndex);

  let result = [...parcel];

  for (let i=0; i<n; i++) {
    const role    = roles[i];
    const setback = role==='front' ? rules.frontM : role==='rear' ? rules.rearM : rules.sideM;
    const p1=parcel[i], p2=parcel[(i+1)%n];
    const inn=inwardNormal(p1,p2,c);

    // Arête décalée vers l'intérieur
    const op1={x:p1.x+inn.x*setback, y:p1.y+inn.y*setback};
    const op2={x:p2.x+inn.x*setback, y:p2.y+inn.y*setback};

    result=clipByOffsetLine(result, op1, op2, inn);
    if (!result.length) return null;
  }

  return result.length>=3 ? result : null;
}

/**
 * Vérifie si un rectangle (ses 4 coins) est entièrement à l'intérieur
 * d'un polygone.
 */
export function isRectInsidePolygon(
  corners: Point2D[],
  poly:    Point2D[],
): boolean {
  return corners.every(c => pointInPolygon(c, poly));
}

/**
 * Vérifie si au moins un coin du rectangle est à l'intérieur du polygone.
 */
export function isRectPartiallyInsidePolygon(
  corners: Point2D[],
  poly:    Point2D[],
): boolean {
  return corners.some(c => pointInPolygon(c, poly));
}