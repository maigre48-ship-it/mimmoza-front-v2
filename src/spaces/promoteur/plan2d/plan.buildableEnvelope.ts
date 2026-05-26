// src/spaces/promoteur/plan2d/plan.buildableEnvelope.ts

import type { Vec2 } from "./plan.types";
import { offsetPolygonInwardApprox } from "./plan.setback";
import { isPolygonInsidePolygon, isPointInPolygon } from "./plan.constraint";

// ─── ENVELOPE OPTIONS ─────────────────────────────────────────────────

export interface BuildableEnvelopeOptions {
  /**
   * Recul uniforme historique.
   * Utilisé en fallback si aucun recul spécifique n'est fourni.
   */
  setbackMeters: number;

  /**
   * Recul côté rue / façade principale.
   * PLU Art. 6.
   */
  frontageSetbackMeters?: number;

  /**
   * Recul sur limites latérales.
   * PLU Art. 7.
   */
  sideSetbackMeters?: number;

  /**
   * Recul en fond de parcelle.
   * PLU Art. 7.
   */
  rearSetbackMeters?: number;

  /**
   * Index du segment considéré comme façade rue.
   * Si non fourni, le moteur utilise une heuristique :
   * segment le plus bas visuellement, donc souvent côté rue dans l'éditeur.
   */
  frontageEdgeIndex?: number | null;

  /**
   * Index du segment considéré comme fond de parcelle.
   * Si non fourni, le moteur prend le segment le plus opposé à la façade.
   */
  rearEdgeIndex?: number | null;
}

// ─── INTERNAL GEOMETRY HELPERS ─────────────────────────────────────────

const EPS = 1e-9;

type Line2D = {
  point: Vec2;
  dir: Vec2;
};

function signedPolygonArea(poly: Vec2[]): number {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

function polygonCentroid(poly: Vec2[]): Vec2 {
  if (poly.length === 0) return { x: 0, y: 0 };

  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p.x;
    y += p.y;
  }

  return {
    x: x / poly.length,
    y: y / poly.length,
  };
}

function edgeMidpoint(a: Vec2, b: Vec2): Vec2 {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
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

function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

function mul(v: Vec2, k: number): Vec2 {
  return { x: v.x * k, y: v.y * k };
}

function lineIntersection(l1: Line2D, l2: Line2D): Vec2 | null {
  const denom = cross(l1.dir, l2.dir);
  if (Math.abs(denom) < EPS) return null;

  const delta = {
    x: l2.point.x - l1.point.x,
    y: l2.point.y - l1.point.y,
  };

  const t = cross(delta, l2.dir) / denom;

  return {
    x: l1.point.x + l1.dir.x * t,
    y: l1.point.y + l1.dir.y * t,
  };
}

/**
 * Supprime les points quasi-identiques pour éviter les artefacts de rendu.
 */
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

function resolveFrontageEdgeIndex(
  parcel: Vec2[],
  explicitIndex?: number | null,
): number {
  if (
    explicitIndex != null &&
    Number.isInteger(explicitIndex) &&
    explicitIndex >= 0 &&
    explicitIndex < parcel.length
  ) {
    return explicitIndex;
  }

  // Heuristique écran/local : la rue est souvent le segment le plus bas.
  // On prend donc le segment dont le midpoint a le y le plus grand.
  let bestIndex = 0;
  let bestY = -Infinity;
  let bestLength = -Infinity;

  for (let i = 0; i < parcel.length; i++) {
    const a = parcel[i];
    const b = parcel[(i + 1) % parcel.length];
    const mid = edgeMidpoint(a, b);
    const len = edgeLength(a, b);

    if (mid.y > bestY || (Math.abs(mid.y - bestY) < EPS && len > bestLength)) {
      bestIndex = i;
      bestY = mid.y;
      bestLength = len;
    }
  }

  return bestIndex;
}

function resolveRearEdgeIndex(
  parcel: Vec2[],
  frontageIndex: number,
  explicitIndex?: number | null,
): number {
  if (
    explicitIndex != null &&
    Number.isInteger(explicitIndex) &&
    explicitIndex >= 0 &&
    explicitIndex < parcel.length
  ) {
    return explicitIndex;
  }

  const frontA = parcel[frontageIndex];
  const frontB = parcel[(frontageIndex + 1) % parcel.length];
  const frontMid = edgeMidpoint(frontA, frontB);
  const centroid = polygonCentroid(parcel);
  const axis = normalize({
    x: centroid.x - frontMid.x,
    y: centroid.y - frontMid.y,
  });

  let bestIndex = frontageIndex;
  let bestProjection = -Infinity;

  for (let i = 0; i < parcel.length; i++) {
    if (i === frontageIndex) continue;

    const a = parcel[i];
    const b = parcel[(i + 1) % parcel.length];
    const mid = edgeMidpoint(a, b);
    const projection = dot(
      {
        x: mid.x - frontMid.x,
        y: mid.y - frontMid.y,
      },
      axis,
    );

    if (projection > bestProjection) {
      bestProjection = projection;
      bestIndex = i;
    }
  }

  return bestIndex;
}

function computeDirectionalInsetPolygon(
  parcel: Vec2[],
  options: BuildableEnvelopeOptions,
): Vec2[] {
  if (parcel.length < 3) return [];

  const fallback = Math.max(0, options.setbackMeters ?? 0);

  const frontageSetback = Math.max(
    0,
    options.frontageSetbackMeters ?? fallback,
  );
  const sideSetback = Math.max(
    0,
    options.sideSetbackMeters ?? fallback,
  );
  const rearSetback = Math.max(
    0,
    options.rearSetbackMeters ?? sideSetback,
  );

  const frontageIndex = resolveFrontageEdgeIndex(
    parcel,
    options.frontageEdgeIndex,
  );
  const rearIndex = resolveRearEdgeIndex(
    parcel,
    frontageIndex,
    options.rearEdgeIndex,
  );

  const isClockwise = signedPolygonArea(parcel) < 0;

  const offsetLines: Line2D[] = [];

  for (let i = 0; i < parcel.length; i++) {
    const a = parcel[i];
    const b = parcel[(i + 1) % parcel.length];

    const dir = normalize({
      x: b.x - a.x,
      y: b.y - a.y,
    });

    if (Math.hypot(dir.x, dir.y) < EPS) continue;

    // Pour un polygone CCW, l'intérieur est à gauche des segments.
    // Pour un polygone CW, l'intérieur est à droite.
    const inwardNormal = isClockwise
      ? { x: dir.y, y: -dir.x }
      : { x: -dir.y, y: dir.x };

    const setback =
      i === frontageIndex
        ? frontageSetback
        : i === rearIndex
          ? rearSetback
          : sideSetback;

    offsetLines.push({
      point: add(a, mul(inwardNormal, setback)),
      dir,
    });
  }

  if (offsetLines.length < 3) return [];

  const envelope: Vec2[] = [];

  for (let i = 0; i < offsetLines.length; i++) {
    const prev = offsetLines[(i - 1 + offsetLines.length) % offsetLines.length];
    const curr = offsetLines[i];

    const p = lineIntersection(prev, curr);

    if (!p) {
      // Segments quasi parallèles : fallback local sur le point courant.
      envelope.push(curr.point);
      continue;
    }

    envelope.push(p);
  }

  const cleaned = cleanPolygon(envelope);

  if (cleaned.length < 3) return [];

  // Garde-fou : si l'offset directionnel produit une enveloppe invalide
  // ou trop agressive sur une parcelle très anguleuse, on revient au moteur
  // historique uniforme avec le recul max. Cela évite les rendus cassés.
  const allInside = cleaned.every((p) => isPointInPolygon(p, parcel));
  if (!allInside) {
    const maxSetback = Math.max(frontageSetback, sideSetback, rearSetback);
    return offsetPolygonInwardApprox(parcel, maxSetback);
  }

  return cleaned;
}

// ─── ENVELOPE COMPUTATION ─────────────────────────────────────────────

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

  const outsidePoints = buildingPolygon.filter(
    p => !isPointInPolygon(p, envelope),
  );

  const outsidePointCount = outsidePoints.length;
  const outsideFraction =
    buildingPolygon.length > 0
      ? outsidePointCount / buildingPolygon.length
      : 0;

  const inside = isPolygonInsidePolygon(buildingPolygon, envelope);

  return { inside, outsidePointCount, outsideFraction };
}