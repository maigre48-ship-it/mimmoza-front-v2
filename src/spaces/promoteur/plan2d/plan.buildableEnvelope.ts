// src/spaces/promoteur/plan2d/plan.buildableEnvelope.ts
//
// V2 — Reculs robustes :
//   1. Fusion des arêtes colinéaires en "faces" logiques  → la façade n'est plus
//      verrouillée sur un micro-segment du cadastre (34 sommets).
//   2. Offset par clipping de demi-plans (Sutherland-Hodgman) au lieu du mitre
//      par sommet  → aucun point de l'enveloppe ne peut violer un recul.
//      Insensible au sens de parcours du polygone (CW/CCW, flip y).
//
//   Compromis assumé : sur une parcelle concave, le résultat est conservateur
//   (peut rogner un peu plus près des angles rentrants). C'est le comportement
//   voulu pour une enveloppe constructible : ne jamais proposer du non-conforme.

import { isPointInPolygon, isPolygonInsidePolygon } from "./plan.constraint";
import { offsetPolygonInwardApprox } from "./plan.setback";
import type { Vec2 } from "./plan.types";

// ─── ENVELOPE OPTIONS ─────────────────────────────────────────────────

export interface BuildableEnvelopeOptions {
  /** Recul uniforme historique. Fallback si aucun recul spécifique fourni. */
  setbackMeters: number;

  /** Recul côté rue / façade principale. PLU Art. 6. */
  frontageSetbackMeters?: number;

  /** Recul sur limites latérales. PLU Art. 7. */
  sideSetbackMeters?: number;

  /** Recul en fond de parcelle. PLU Art. 7. */
  rearSetbackMeters?: number;

  /**
   * Index d'une ARÊTE considérée comme façade rue.
   * Le moteur retrouve automatiquement la FACE qui contient cette arête,
   * puis applique le recul avant à toute la face.
   * Si non fourni : heuristique (segment le plus bas visuellement = côté rue).
   */
  frontageEdgeIndex?: number | null;

  /** Idem pour le fond de parcelle. Si non fourni : face la plus opposée. */
  rearEdgeIndex?: number | null;

  /**
   * Tolérance d'angle (degrés) pour fusionner deux arêtes consécutives
   * dans une même face. Défaut 12° : absorbe le bruit de numérisation
   * cadastrale sans fusionner des faces réellement distinctes.
   */
  faceAngleToleranceDeg?: number;
}

// ─── HELPERS GÉOMÉTRIE ────────────────────────────────────────────────

const EPS = 1e-9;

function polygonCentroid(poly: Vec2[]): Vec2 {
  if (poly.length === 0) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p.x;
    y += p.y;
  }
  return { x: x / poly.length, y: y / poly.length };
}

function edgeMidpoint(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function edgeLength(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function normalize(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y);
  if (len < EPS) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

function mul(v: Vec2, k: number): Vec2 {
  return { x: v.x * k, y: v.y * k };
}

/** Supprime les points quasi-identiques (artefacts de rendu / intersections). */
function cleanPolygon(poly: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of poly) {
    const prev = out[out.length - 1];
    if (!prev || Math.hypot(prev.x - p.x, prev.y - p.y) > 0.001) {
      out.push(p);
    }
  }
  if (out.length > 2) {
    const first = out[0];
    const last = out[out.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) <= 0.001) {
      out.pop();
    }
  }
  return out;
}

// ─── REGROUPEMENT DES ARÊTES EN FACES ─────────────────────────────────

interface ParcelFace {
  /** Indices d'arêtes (arête i = parcel[i] → parcel[i+1]) composant la face. */
  edgeIndices: number[];
  /** Direction représentative (premier sommet → dernier sommet de la face). */
  dirUnit: Vec2;
  /** Longueur totale cumulée de la face. */
  length: number;
  /** Milieu de la face (du premier au dernier sommet). */
  midpoint: Vec2;
}

/**
 * Fusionne les arêtes consécutives quasi-colinéaires en faces logiques.
 * Gère le wrap-around (la face "rue" peut chevaucher la fin/début du tableau).
 */
function groupCollinearFaces(
  parcel: Vec2[],
  angleToleranceDeg: number,
): ParcelFace[] {
  const n = parcel.length;
  if (n < 3) return [];

  const dirs: Vec2[] = [];
  const lens: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = parcel[i];
    const b = parcel[(i + 1) % n];
    dirs.push(normalize({ x: b.x - a.x, y: b.y - a.y }));
    lens.push(edgeLength(a, b));
  }

  const cosTol = Math.cos((angleToleranceDeg * Math.PI) / 180);

  const groups: number[][] = [];
  for (let i = 0; i < n; i++) {
    if (groups.length === 0) {
      groups.push([i]);
      continue;
    }
    const lastGroup = groups[groups.length - 1];
    const refIdx = lastGroup[lastGroup.length - 1];
    const refDir = dirs[refIdx];
    const curDir = dirs[i];

    // Arête dégénérée : rattachée au groupe courant sans changer la référence.
    if (lens[i] < EPS) {
      lastGroup.push(i);
      continue;
    }

    const aligned = dot(curDir, refDir) >= cosTol; // même sens + angle faible
    if (aligned) {
      lastGroup.push(i);
    } else {
      groups.push([i]);
    }
  }

  // Wrap-around : fusionner la dernière face avec la première si colinéaires.
  if (groups.length > 1) {
    const first = groups[0];
    const last = groups[groups.length - 1];
    const dFirst = dirs[first[0]];
    const dLast = dirs[last[last.length - 1]];
    if (dot(dFirst, dLast) >= cosTol) {
      groups[0] = last.concat(first);
      groups.pop();
    }
  }

  return groups.map((g) => {
    const startV = parcel[g[0]];
    const endV = parcel[(g[g.length - 1] + 1) % n];
    let length = 0;
    for (const k of g) length += lens[k];
    return {
      edgeIndices: g,
      dirUnit: normalize({ x: endV.x - startV.x, y: endV.y - startV.y }),
      length,
      midpoint: edgeMidpoint(startV, endV),
    };
  });
}

function faceIndexContainingEdge(faces: ParcelFace[], edgeIndex: number): number {
  for (let i = 0; i < faces.length; i++) {
    if (faces[i].edgeIndices.includes(edgeIndex)) return i;
  }
  return 0;
}

/**
 * Façade : face contenant l'arête la plus "basse" visuellement (max y du
 * midpoint, tie-break longueur) — conserve l'heuristique historique mais
 * l'applique désormais à la FACE entière, plus à un micro-segment.
 */
function resolveFrontageFaceIndex(
  parcel: Vec2[],
  faces: ParcelFace[],
  explicitEdgeIndex?: number | null,
): number {
  if (
    explicitEdgeIndex != null &&
    Number.isInteger(explicitEdgeIndex) &&
    explicitEdgeIndex >= 0 &&
    explicitEdgeIndex < parcel.length
  ) {
    return faceIndexContainingEdge(faces, explicitEdgeIndex);
  }

  let bestEdge = 0;
  let bestY = -Infinity;
  let bestLen = -Infinity;
  for (let i = 0; i < parcel.length; i++) {
    const a = parcel[i];
    const b = parcel[(i + 1) % parcel.length];
    const mid = edgeMidpoint(a, b);
    const len = edgeLength(a, b);
    if (mid.y > bestY || (Math.abs(mid.y - bestY) < EPS && len > bestLen)) {
      bestEdge = i;
      bestY = mid.y;
      bestLen = len;
    }
  }
  return faceIndexContainingEdge(faces, bestEdge);
}

/** Fond : face dont le milieu est le plus éloigné de la façade le long de
 *  l'axe façade → centroïde. */
function resolveRearFaceIndex(
  parcel: Vec2[],
  faces: ParcelFace[],
  frontageFaceIndex: number,
  explicitEdgeIndex?: number | null,
): number {
  if (
    explicitEdgeIndex != null &&
    Number.isInteger(explicitEdgeIndex) &&
    explicitEdgeIndex >= 0 &&
    explicitEdgeIndex < parcel.length
  ) {
    return faceIndexContainingEdge(faces, explicitEdgeIndex);
  }

  const frontMid = faces[frontageFaceIndex].midpoint;
  const centroid = polygonCentroid(parcel);
  const axis = normalize({
    x: centroid.x - frontMid.x,
    y: centroid.y - frontMid.y,
  });

  let bestIndex = frontageFaceIndex;
  let bestProjection = -Infinity;
  for (let i = 0; i < faces.length; i++) {
    if (i === frontageFaceIndex) continue;
    const mid = faces[i].midpoint;
    const projection = dot({ x: mid.x - frontMid.x, y: mid.y - frontMid.y }, axis);
    if (projection > bestProjection) {
      bestProjection = projection;
      bestIndex = i;
    }
  }
  return bestIndex;
}

// ─── CLIPPING PAR DEMI-PLANS (Sutherland-Hodgman) ─────────────────────

/** Intersection segment [a,b] avec la frontière du demi-plan (P, N). */
function segmentPlaneIntersection(a: Vec2, b: Vec2, P: Vec2, N: Vec2): Vec2 | null {
  const ab = { x: b.x - a.x, y: b.y - a.y };
  const denom = dot(ab, N);
  if (Math.abs(denom) < EPS) return null;
  const t = dot({ x: P.x - a.x, y: P.y - a.y }, N) / denom;
  const tc = Math.max(0, Math.min(1, t));
  return { x: a.x + ab.x * tc, y: a.y + ab.y * tc };
}

/** Conserve la portion du polygone du côté intérieur du demi-plan (P, N). */
function clipByHalfPlane(poly: Vec2[], P: Vec2, N: Vec2): Vec2[] {
  if (poly.length === 0) return [];
  const inside = (pt: Vec2) => dot({ x: pt.x - P.x, y: pt.y - P.y }, N) >= -1e-7;

  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i];
    const nxt = poly[(i + 1) % poly.length];
    const curIn = inside(cur);
    const nxtIn = inside(nxt);

    if (curIn) out.push(cur);
    if (curIn !== nxtIn) {
      const inter = segmentPlaneIntersection(cur, nxt, P, N);
      if (inter) out.push(inter);
    }
  }
  return out;
}

/**
 * Enveloppe = parcelle clippée par un demi-plan par arête, chaque demi-plan
 * décalé vers l'intérieur du recul de la FACE à laquelle l'arête appartient.
 * Normale intérieure déterminée via le centroïde → indépendant du sens (CW/CCW).
 */
function computeDirectionalInsetPolygon(
  parcel: Vec2[],
  options: BuildableEnvelopeOptions,
): Vec2[] {
  const cleaned = cleanPolygon(parcel);
  const n = cleaned.length;
  if (n < 3) return [];

  const fallback = Math.max(0, options.setbackMeters ?? 0);
  const frontageSetback = Math.max(0, options.frontageSetbackMeters ?? fallback);
  const sideSetback = Math.max(0, options.sideSetbackMeters ?? fallback);
  const rearSetback = Math.max(0, options.rearSetbackMeters ?? sideSetback);
  const angleTol = options.faceAngleToleranceDeg ?? 12;

  const faces = groupCollinearFaces(cleaned, angleTol);
  if (faces.length === 0) return [];

  const frontageFaceIdx = resolveFrontageFaceIndex(
    cleaned,
    faces,
    options.frontageEdgeIndex,
  );
  const rearFaceIdx = resolveRearFaceIndex(
    cleaned,
    faces,
    frontageFaceIdx,
    options.rearEdgeIndex,
  );

  // Recul par arête, dérivé du rôle de sa face.
  const setbackPerEdge = new Array<number>(n).fill(sideSetback);
  for (const e of faces[frontageFaceIdx].edgeIndices) setbackPerEdge[e] = frontageSetback;
  if (rearFaceIdx !== frontageFaceIdx) {
    for (const e of faces[rearFaceIdx].edgeIndices) setbackPerEdge[e] = rearSetback;
  }

  const centroid = polygonCentroid(cleaned);
  let envelope: Vec2[] = cleaned.slice();

  for (let i = 0; i < n; i++) {
    const a = cleaned[i];
    const b = cleaned[(i + 1) % n];
    const dir = normalize({ x: b.x - a.x, y: b.y - a.y });
    if (Math.hypot(dir.x, dir.y) < EPS) continue;

    // Normale, orientée vers l'intérieur (côté centroïde).
    let normal: Vec2 = { x: -dir.y, y: dir.x };
    const mid = edgeMidpoint(a, b);
    if (dot({ x: centroid.x - mid.x, y: centroid.y - mid.y }, normal) < 0) {
      normal = { x: -normal.x, y: -normal.y };
    }

    const setback = setbackPerEdge[i] ?? sideSetback;
    const P = add(a, mul(normal, setback));

    envelope = clipByHalfPlane(envelope, P, normal);
    if (envelope.length < 3) return []; // recul > demi-largeur : rien de constructible
  }

  const result = cleanPolygon(envelope);
  return result.length >= 3 ? result : [];
}

// ─── API PUBLIQUE ─────────────────────────────────────────────────────

export function computeBuildableEnvelope(
  parcel: Vec2[],
  options: BuildableEnvelopeOptions,
): Vec2[] {
  if (parcel.length < 3) return [];

  const hasDirectionalSetbacks =
    options.frontageSetbackMeters != null ||
    options.sideSetbackMeters != null ||
    options.rearSetbackMeters != null ||
    options.frontageEdgeIndex != null ||
    options.rearEdgeIndex != null;

  if (!hasDirectionalSetbacks) {
    if (options.setbackMeters <= 0) return parcel.slice();
    const envelope = offsetPolygonInwardApprox(parcel, options.setbackMeters);
    return envelope.length >= 3 ? envelope : [];
  }

  const envelope = computeDirectionalInsetPolygon(parcel, options);
  return envelope.length >= 3 ? envelope : [];
}

// ─── CONTAINMENT CHECK ────────────────────────────────────────────────

export function isBuildingInsideEnvelope(
  buildingPolygon: Vec2[],
  envelope: Vec2[],
): boolean {
  if (envelope.length < 3) return true;
  return isPolygonInsidePolygon(buildingPolygon, envelope);
}

// ─── DIAGNOSTICS ──────────────────────────────────────────────────────

export type BuildableEnvelopeDiagnostics = {
  inside: boolean;
  outsidePointCount: number;
  outsideFraction: number;
};

export function getBuildableEnvelopeDiagnostics(
  buildingPolygon: Vec2[],
  envelope: Vec2[],
): BuildableEnvelopeDiagnostics {
  if (envelope.length < 3) {
    return { inside: true, outsidePointCount: 0, outsideFraction: 0 };
  }

  const outsidePoints = buildingPolygon.filter((p) => !isPointInPolygon(p, envelope));
  const outsidePointCount = outsidePoints.length;
  const outsideFraction =
    buildingPolygon.length > 0 ? outsidePointCount / buildingPolygon.length : 0;
  const inside = isPolygonInsidePolygon(buildingPolygon, envelope);

  return { inside, outsidePointCount, outsideFraction };
}