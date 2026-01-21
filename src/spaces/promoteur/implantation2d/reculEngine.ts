// src/spaces/promoteur/reculEngine.ts
// Engine for setback (reculs) calculations, facade selection, envelope computation

import { useMemo, useState, useCallback } from "react";
import type { Feature, Polygon, MultiPolygon, LineString, MultiLineString, Position } from "geojson";
import * as turf from "@turf/turf";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------
export interface AppliedReculs {
  recul_avant_m: number;
  recul_lateral_m: number;
  recul_fond_m: number;
  reculMax: number;
  source: "plu";
  mode: "DIRECTIONAL_BY_FACADE" | "UNIFORM" | "FALLBACK_UNIFORM";
  hasData: boolean;
  hasFacade: boolean;
}

interface ResolvedPluRuleset {
  version: string;
  reculs: {
    facades?: {
      avant?: { min_m?: number | null };
      laterales?: { min_m?: number | null };
      fond?: { min_m?: number | null };
    };
    voirie?: { min_m?: number | null };
    limites_separatives?: { min_m?: number | null };
    fond_parcelle?: { min_m?: number | null };
  };
  completeness: {
    ok: boolean;
    missing?: string[];
  };
  [key: string]: unknown;
}

interface ExtractedReculs {
  avant: number | null;
  lateral: number | null;
  fond: number | null;
  mode: "DIRECTIONAL_BY_FACADE" | "UNIFORM";
}

interface SegmentClassification {
  segment: [Position, Position];
  index: number;
  type: "avant" | "lateral" | "fond";
  length: number;
  bearing: number;
  midpoint: Position;
}

export interface SetbackBands {
  avant: Feature<Polygon | MultiPolygon> | null;
  lateral: Feature<Polygon | MultiPolygon> | null;
  fond: Feature<Polygon | MultiPolygon> | null;
}

export interface ReculEngineState {
  facadeSegment: Feature<LineString> | null;
  selectFacadeFromClick: (lngLat: [number, number]) => boolean;
  resetFacade: () => void;
  computedReculs: AppliedReculs | null;
  envelopeFeature: Feature<Polygon | MultiPolygon> | null;
  forbiddenBand: Feature<Polygon | MultiPolygon> | null;
  setbackBands: SetbackBands | null;
  hatchLines: Feature<MultiLineString> | null;
}

interface UseReculEngineProps {
  parcelFeature: Feature<Polygon | MultiPolygon> | null;
  resolvedRuleset: ResolvedPluRuleset | null;
  rulesetValid: boolean;
}

// -----------------------------------------------------------------------------
// Helpers: Number parsing
// -----------------------------------------------------------------------------
function toNumberLooseNullable(v: unknown): number | null {
  if (v === 0) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const s = v.replace(",", ".");
    const m = s.match(/-?\d+(\.\d+)?/);
    if (!m) return null;
    const n = Number(m[0]);
    return Number.isFinite(n) ? n : null;
  }
  if (v !== null && v !== undefined) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// -----------------------------------------------------------------------------
// Extract reculs from ruleset
// -----------------------------------------------------------------------------
function extractReculsFromRuleset(ruleset: ResolvedPluRuleset | null): ExtractedReculs {
  if (!ruleset) {
    return { avant: null, lateral: null, fond: null, mode: "UNIFORM" };
  }

  const facades = ruleset.reculs?.facades;
  const avantMinM = facades?.avant?.min_m;
  const lateralesMinM = facades?.laterales?.min_m;
  const fondMinM = facades?.fond?.min_m;
  const hasFacades =
    (typeof avantMinM === "number" && Number.isFinite(avantMinM)) ||
    (typeof lateralesMinM === "number" && Number.isFinite(lateralesMinM)) ||
    (typeof fondMinM === "number" && Number.isFinite(fondMinM));

  let avant: number | null = null;
  let lateral: number | null = null;
  let fond: number | null = null;

  if (hasFacades) {
    avant = toNumberLooseNullable(facades?.avant?.min_m);
    if (avant === null) {
      avant = toNumberLooseNullable(ruleset.reculs?.voirie?.min_m);
    }
    lateral = toNumberLooseNullable(facades?.laterales?.min_m);
    if (lateral === null) {
      lateral = toNumberLooseNullable(ruleset.reculs?.limites_separatives?.min_m);
    }
    fond = toNumberLooseNullable(facades?.fond?.min_m);
    if (fond === null) {
      fond = toNumberLooseNullable(ruleset.reculs?.fond_parcelle?.min_m);
    }
    return { avant, lateral, fond, mode: "DIRECTIONAL_BY_FACADE" };
  }

  avant = toNumberLooseNullable(ruleset.reculs?.voirie?.min_m);
  lateral = toNumberLooseNullable(ruleset.reculs?.limites_separatives?.min_m);
  fond = toNumberLooseNullable(ruleset.reculs?.fond_parcelle?.min_m);
  return { avant, lateral, fond, mode: "UNIFORM" };
}

// -----------------------------------------------------------------------------
// Safe Turf wrappers
// -----------------------------------------------------------------------------
function safeBuffer(
  feature: Feature<Polygon | MultiPolygon> | Feature<LineString>,
  meters: number
): Feature<Polygon | MultiPolygon> | null {
  if (!feature) return null;
  if (meters === 0 && feature.geometry.type !== "LineString") {
    return feature as Feature<Polygon | MultiPolygon>;
  }
  try {
    const result = turf.buffer(feature, meters, { units: "meters" });
    if (!result || !result.geometry) return null;
    return normalizeToFeature(result);
  } catch {
    return null;
  }
}

function safeClean(
  feature: Feature<Polygon | MultiPolygon>
): Feature<Polygon | MultiPolygon> {
  try {
    let cleaned = turf.cleanCoords(feature) as Feature<Polygon | MultiPolygon>;
    cleaned = turf.rewind(cleaned, { mutate: false }) as Feature<Polygon | MultiPolygon>;
    return cleaned;
  } catch {
    return feature;
  }
}

function safeDifference(
  a: Feature<Polygon | MultiPolygon>,
  b: Feature<Polygon | MultiPolygon>
): Feature<Polygon | MultiPolygon> | null {
  try {
    const cleanA = safeClean(a);
    const cleanB = safeClean(b);
    const result = turf.difference(
      turf.featureCollection([cleanA as turf.Feature<turf.Polygon | turf.MultiPolygon>]),
      cleanB as turf.Feature<turf.Polygon | turf.MultiPolygon>
    );
    if (!result || !result.geometry) return null;
    return normalizeToFeature(result);
  } catch {
    try {
      const result = turf.difference(
        a as turf.Feature<turf.Polygon | turf.MultiPolygon>,
        b as turf.Feature<turf.Polygon | turf.MultiPolygon>
      );
      if (!result || !result.geometry) return null;
      return normalizeToFeature(result);
    } catch {
      return null;
    }
  }
}

function safeIntersect(
  a: Feature<Polygon | MultiPolygon>,
  b: Feature<Polygon | MultiPolygon>
): Feature<Polygon | MultiPolygon> | null {
  try {
    const cleanA = safeClean(a);
    const cleanB = safeClean(b);
    const result = turf.intersect(
      turf.featureCollection([
        cleanA as turf.Feature<turf.Polygon | turf.MultiPolygon>,
        cleanB as turf.Feature<turf.Polygon | turf.MultiPolygon>,
      ])
    );
    if (!result || !result.geometry) return null;
    return normalizeToFeature(result);
  } catch {
    return null;
  }
}

function safeUnion(
  features: Array<Feature<Polygon | MultiPolygon>>
): Feature<Polygon | MultiPolygon> | null {
  const validFeatures = features.filter((f) => f && f.geometry);
  if (validFeatures.length === 0) return null;
  if (validFeatures.length === 1) return validFeatures[0];

  try {
    let result = safeClean(validFeatures[0]);
    for (let i = 1; i < validFeatures.length; i++) {
      const cleaned = safeClean(validFeatures[i]);
      try {
        const unionResult = turf.union(
          turf.featureCollection([
            result as turf.Feature<turf.Polygon | turf.MultiPolygon>,
            cleaned as turf.Feature<turf.Polygon | turf.MultiPolygon>,
          ])
        );
        if (unionResult && unionResult.geometry) {
          const normalized = normalizeToFeature(unionResult);
          if (normalized) {
            result = normalized;
          }
        }
      } catch {
        // Continue
      }
    }
    return result;
  } catch {
    return validFeatures[0];
  }
}

// -----------------------------------------------------------------------------
// Geometry helpers
// -----------------------------------------------------------------------------
function getRingsFromParcel(parcel: Feature<Polygon | MultiPolygon>): Position[][] {
  const g = parcel.geometry;
  if (g.type === "Polygon") {
    return g.coordinates as Position[][];
  }
  const out: Position[][] = [];
  for (const poly of g.coordinates) {
    for (const ring of poly) out.push(ring as Position[]);
  }
  return out;
}

function getOuterRing(parcel: Feature<Polygon | MultiPolygon>): Position[] {
  const g = parcel.geometry;
  if (g.type === "Polygon") {
    return g.coordinates[0] as Position[];
  }
  return g.coordinates[0][0] as Position[];
}

function segmentBearing(a: Position, b: Position): number {
  try {
    return turf.bearing(turf.point(a), turf.point(b));
  } catch {
    return 0;
  }
}

function segmentLength(a: Position, b: Position): number {
  try {
    return turf.distance(turf.point(a), turf.point(b), { units: "meters" });
  } catch {
    return 0;
  }
}

function segmentMidpoint(a: Position, b: Position): Position {
  try {
    const mid = turf.midpoint(turf.point(a), turf.point(b));
    return mid.geometry.coordinates as Position;
  } catch {
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  }
}

function normalizeBearing(bearing: number): number {
  let b = bearing % 360;
  if (b < 0) b += 360;
  return b;
}

function bearingDifference(b1: number, b2: number): number {
  const diff = Math.abs(normalizeBearing(b1) - normalizeBearing(b2));
  return diff > 180 ? 360 - diff : diff;
}

function distanceBetweenPoints(p1: Position, p2: Position): number {
  try {
    return turf.distance(turf.point(p1), turf.point(p2), { units: "meters" });
  } catch {
    return Math.sqrt(Math.pow(p1[0] - p2[0], 2) + Math.pow(p1[1] - p2[1], 2)) * 111320;
  }
}

// -----------------------------------------------------------------------------
// Normalize to feature
// -----------------------------------------------------------------------------
function normalizeToFeature(raw: unknown): Feature<Polygon | MultiPolygon> | null {
  if (!raw) return null;
  const data = raw as Record<string, unknown>;
  if (data.type === "Feature" && data.geometry) {
    const g = data.geometry as Record<string, unknown>;
    if (g.type === "Polygon" || g.type === "MultiPolygon") {
      return data as unknown as Feature<Polygon | MultiPolygon>;
    }
  }
  if (data.type === "Polygon" || data.type === "MultiPolygon") {
    return {
      type: "Feature",
      geometry: data as Polygon | MultiPolygon,
      properties: {},
    } as Feature<Polygon | MultiPolygon>;
  }
  return null;
}

// -----------------------------------------------------------------------------
// Find closest edge segment to click
// -----------------------------------------------------------------------------
function findClosestEdgeSegment(
  parcel: Feature<Polygon | MultiPolygon>,
  clickLngLat: [number, number]
): Feature<LineString> | null {
  const rings = getRingsFromParcel(parcel);
  const p = turf.point(clickLngLat);
  let bestSeg: [Position, Position] | null = null;
  let bestDist = Infinity;
  let bestIdx = -1;
  let globalIdx = 0;

  for (const ring of rings) {
    if (!Array.isArray(ring) || ring.length < 2) continue;
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i];
      const b = ring[i + 1];
      if (!a || !b) continue;
      const line = turf.lineString([a, b]);
      const d = turf.pointToLineDistance(p, line, { units: "meters" });
      if (Number.isFinite(d) && d < bestDist) {
        bestDist = d;
        bestSeg = [a, b];
        bestIdx = globalIdx;
      }
      globalIdx++;
    }
  }
  if (!bestSeg) return null;
  const MAX_CLICK_DIST_M = 5.0;
  if (!Number.isFinite(bestDist) || bestDist > MAX_CLICK_DIST_M) return null;
  return {
    type: "Feature",
    geometry: { type: "LineString", coordinates: [bestSeg[0], bestSeg[1]] },
    properties: { kind: "facade", distance_m: bestDist, segmentIndex: bestIdx },
  };
}

// -----------------------------------------------------------------------------
// Classify segments based on facade
// -----------------------------------------------------------------------------
function classifySegments(
  parcel: Feature<Polygon | MultiPolygon>,
  facadeSegment: Feature<LineString> | null
): SegmentClassification[] {
  const ring = getOuterRing(parcel);
  if (ring.length < 4) return [];

  const segments: SegmentClassification[] = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i];
    const b = ring[i + 1];
    const bearing = segmentBearing(a, b);
    const length = segmentLength(a, b);
    const midpoint = segmentMidpoint(a, b);
    segments.push({
      segment: [a, b],
      index: i,
      type: "lateral",
      length,
      bearing,
      midpoint,
    });
  }

  if (!facadeSegment || segments.length < 3) {
    return segments;
  }

  const facadeCoords = facadeSegment.geometry.coordinates;
  const facadeMidpoint = segmentMidpoint(facadeCoords[0] as Position, facadeCoords[1] as Position);

  let facadeIdx = -1;
  let minDist = Infinity;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const midDist = distanceBetweenPoints(seg.midpoint, facadeMidpoint);

    if (midDist < minDist && midDist < 10) {
      minDist = midDist;
      facadeIdx = i;
    }
  }

  if (facadeIdx === -1) {
    const propIdx = (facadeSegment.properties as Record<string, unknown>)?.segmentIndex;
    if (typeof propIdx === "number" && propIdx >= 0 && propIdx < segments.length) {
      facadeIdx = propIdx;
    }
  }

  if (facadeIdx === -1) return segments;

  segments[facadeIdx].type = "avant";

  const avantBearing = segments[facadeIdx].bearing;
  const avantMidpoint = segments[facadeIdx].midpoint;

  let fondIdx = -1;
  let bestFondScore = -Infinity;

  for (let i = 0; i < segments.length; i++) {
    if (i === facadeIdx) continue;

    const seg = segments[i];
    const bearingDiff = bearingDifference(seg.bearing, avantBearing);
    const oppositenessDegrees = Math.abs(180 - bearingDiff);
    const distFromAvant = distanceBetweenPoints(seg.midpoint, avantMidpoint);

    const oppositeScore = (60 - Math.min(oppositenessDegrees, 60)) / 60;
    const distanceScore = distFromAvant / 50;

    let totalScore: number;
    if (oppositenessDegrees < 60) {
      totalScore = oppositeScore * 3 + distanceScore;
    } else {
      totalScore = distanceScore * 0.3;
    }

    if (totalScore > bestFondScore) {
      bestFondScore = totalScore;
      fondIdx = i;
    }
  }

  if (fondIdx !== -1) {
    segments[fondIdx].type = "fond";
  }

  return segments;
}

// -----------------------------------------------------------------------------
// Local projection helpers
// -----------------------------------------------------------------------------
interface LocalProjection {
  centerLng: number;
  centerLat: number;
  metersPerDegreeLng: number;
  metersPerDegreeLat: number;
}

function createLocalProjection(feature: Feature<Polygon | MultiPolygon>): LocalProjection {
  const centroid = turf.centroid(feature as turf.AllGeoJSON);
  const [lng, lat] = centroid.geometry.coordinates;
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLng = 111320 * Math.cos((lat * Math.PI) / 180);
  return { centerLng: lng, centerLat: lat, metersPerDegreeLng, metersPerDegreeLat };
}

function toLocalMeters(pos: Position, proj: LocalProjection): [number, number] {
  const x = (pos[0] - proj.centerLng) * proj.metersPerDegreeLng;
  const y = (pos[1] - proj.centerLat) * proj.metersPerDegreeLat;
  return [x, y];
}

function fromLocalMeters(xy: [number, number], proj: LocalProjection): Position {
  const lng = xy[0] / proj.metersPerDegreeLng + proj.centerLng;
  const lat = xy[1] / proj.metersPerDegreeLat + proj.centerLat;
  return [lng, lat];
}

// -----------------------------------------------------------------------------
// Line-line intersection
// -----------------------------------------------------------------------------
function lineLineIntersection(
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  p4: [number, number]
): [number, number] | null {
  const x1 = p1[0], y1 = p1[1];
  const x2 = p2[0], y2 = p2[1];
  const x3 = p3[0], y3 = p3[1];
  const x4 = p4[0], y4 = p4[1];

  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-10) return null;

  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;

  // Check if intersection is within both segments
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    const x = x1 + t * (x2 - x1);
    const y = y1 + t * (y2 - y1);
    return [x, y];
  }

  return null;
}

// Extended line intersection (for envelope calculation)
function lineLineIntersectionExtended(
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  p4: [number, number]
): [number, number] | null {
  const x1 = p1[0], y1 = p1[1];
  const x2 = p2[0], y2 = p2[1];
  const x3 = p3[0], y3 = p3[1];
  const x4 = p4[0], y4 = p4[1];

  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-10) return null;

  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;

  const x = x1 + t * (x2 - x1);
  const y = y1 + t * (y2 - y1);

  return [x, y];
}

// -----------------------------------------------------------------------------
// Generate hatch lines - ROBUST VERSION
// -----------------------------------------------------------------------------
function generateHatchLines(
  parcel: Feature<Polygon | MultiPolygon>,
  envelope: Feature<Polygon | MultiPolygon>,
  spacingMeters: number = 2,
  angleDegrees: number = 45
): Feature<MultiLineString> | null {
  try {
    const proj = createLocalProjection(parcel);

    // Get all rings from parcel and envelope
    const parcelRing = getOuterRing(parcel).map((p) => toLocalMeters(p, proj));
    const envelopeRing = getOuterRing(envelope).map((p) => toLocalMeters(p, proj));

    // Calculate bounding box in local coords
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of parcelRing) {
      minX = Math.min(minX, p[0]);
      minY = Math.min(minY, p[1]);
      maxX = Math.max(maxX, p[0]);
      maxY = Math.max(maxY, p[1]);
    }

    const diagonal = Math.sqrt(Math.pow(maxX - minX, 2) + Math.pow(maxY - minY, 2));
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const angleRad = (angleDegrees * Math.PI) / 180;
    const cosA = Math.cos(angleRad);
    const sinA = Math.sin(angleRad);

    const clippedLines: Position[][] = [];
    const numLines = Math.ceil(diagonal / spacingMeters) + 1;

    // Helper: find intersections of a line with a ring
    function findIntersectionsWithRing(
      lineStart: [number, number],
      lineEnd: [number, number],
      ring: [number, number][]
    ): [number, number][] {
      const intersections: [number, number][] = [];

      for (let i = 0; i < ring.length - 1; i++) {
        const segStart = ring[i];
        const segEnd = ring[i + 1];
        const inter = lineLineIntersection(lineStart, lineEnd, segStart, segEnd);
        if (inter) {
          intersections.push(inter);
        }
      }

      // Sort by position along line
      intersections.sort((a, b) => {
        const distA = (a[0] - lineStart[0]) * cosA + (a[1] - lineStart[1]) * sinA;
        const distB = (b[0] - lineStart[0]) * cosA + (b[1] - lineStart[1]) * sinA;
        return distA - distB;
      });

      return intersections;
    }

    // Helper: check if point is inside ring
    function isPointInRing(point: [number, number], ring: [number, number][]): boolean {
      let inside = false;
      const x = point[0], y = point[1];

      for (let i = 0, j = ring.length - 2; i < ring.length - 1; j = i++) {
        const xi = ring[i][0], yi = ring[i][1];
        const xj = ring[j][0], yj = ring[j][1];

        if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
          inside = !inside;
        }
      }

      return inside;
    }

    for (let i = -numLines; i <= numLines; i++) {
      const offset = i * spacingMeters;

      // Perpendicular offset
      const perpX = -sinA * offset;
      const perpY = cosA * offset;

      // Line endpoints
      const lineStart: [number, number] = [
        centerX + perpX - cosA * diagonal,
        centerY + perpY - sinA * diagonal,
      ];
      const lineEnd: [number, number] = [
        centerX + perpX + cosA * diagonal,
        centerY + perpY + sinA * diagonal,
      ];

      // Find intersections with parcel and envelope
      const parcelIntersections = findIntersectionsWithRing(lineStart, lineEnd, parcelRing);
      const envelopeIntersections = findIntersectionsWithRing(lineStart, lineEnd, envelopeRing);

      // Merge all intersections
      const allIntersections: Array<{ point: [number, number]; type: "parcel" | "envelope" }> = [
        ...parcelIntersections.map((p) => ({ point: p, type: "parcel" as const })),
        ...envelopeIntersections.map((p) => ({ point: p, type: "envelope" as const })),
      ];

      // Sort by position along line
      allIntersections.sort((a, b) => {
        const distA = (a.point[0] - lineStart[0]) * cosA + (a.point[1] - lineStart[1]) * sinA;
        const distB = (b.point[0] - lineStart[0]) * cosA + (b.point[1] - lineStart[1]) * sinA;
        return distA - distB;
      });

      // Generate line segments in forbidden zone (inside parcel, outside envelope)
      let inParcel = false;
      let inEnvelope = false;
      let segmentStart: [number, number] | null = null;

      for (const inter of allIntersections) {
        const wasInForbidden = inParcel && !inEnvelope;

        if (inter.type === "parcel") {
          inParcel = !inParcel;
        } else {
          inEnvelope = !inEnvelope;
        }

        const isInForbidden = inParcel && !inEnvelope;

        if (!wasInForbidden && isInForbidden) {
          // Entering forbidden zone
          segmentStart = inter.point;
        } else if (wasInForbidden && !isInForbidden && segmentStart) {
          // Leaving forbidden zone
          const segmentEnd = inter.point;
          const segLength = Math.sqrt(
            Math.pow(segmentEnd[0] - segmentStart[0], 2) +
            Math.pow(segmentEnd[1] - segmentStart[1], 2)
          );

          if (segLength > 0.5) {
            clippedLines.push([
              fromLocalMeters(segmentStart, proj),
              fromLocalMeters(segmentEnd, proj),
            ]);
          }
          segmentStart = null;
        }
      }
    }

    if (clippedLines.length === 0) return null;

    return {
      type: "Feature",
      geometry: {
        type: "MultiLineString",
        coordinates: clippedLines,
      },
      properties: { kind: "hatch_lines" },
    };
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// Compute envelope
// -----------------------------------------------------------------------------
interface EnvelopeResult {
  envelope: Feature<Polygon | MultiPolygon> | null;
  envelopeRingLocal: [number, number][] | null;
  segments: SegmentClassification[];
  proj: LocalProjection | null;
}

function computeEnvelopeWithData(
  parcel: Feature<Polygon | MultiPolygon>,
  facadeSegment: Feature<LineString> | null,
  reculAvant: number,
  reculLateral: number,
  reculFond: number
): EnvelopeResult {
  const maxRecul = Math.max(reculAvant, reculLateral, reculFond);
  const segments = classifySegments(parcel, facadeSegment);

  if (segments.length < 3 || maxRecul <= 0) {
    return { envelope: parcel, envelopeRingLocal: null, segments, proj: null };
  }

  const ring = getOuterRing(parcel);
  const proj = createLocalProjection(parcel);
  const localRing = ring.map((p) => toLocalMeters(p, proj));
  const isClockwise = turf.booleanClockwise(turf.lineString(ring));
  const sign = isClockwise ? -1 : 1;

  const n = segments.length;

  const offsetSegments: Array<{ p1: [number, number]; p2: [number, number] }> = [];

  for (let i = 0; i < n; i++) {
    const seg = segments[i];
    let offset: number;
    switch (seg.type) {
      case "avant": offset = reculAvant; break;
      case "fond": offset = reculFond; break;
      default: offset = reculLateral;
    }

    const p1 = localRing[i];
    const p2 = localRing[(i + 1) % n] || localRing[i + 1];

    if (!p1 || !p2) continue;

    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    const len = Math.sqrt(dx * dx + dy * dy);

    if (len < 0.001) {
      offsetSegments.push({ p1, p2 });
      continue;
    }

    const nx = -dy / len;
    const ny = dx / len;

    offsetSegments.push({
      p1: [p1[0] + sign * nx * offset, p1[1] + sign * ny * offset],
      p2: [p2[0] + sign * nx * offset, p2[1] + sign * ny * offset],
    });
  }

  if (offsetSegments.length < 3) {
    const safeEnvelope = safeBuffer(parcel, -maxRecul);
    return { envelope: safeEnvelope, envelopeRingLocal: null, segments, proj };
  }

  const envelopeRingLocal: [number, number][] = [];

  for (let i = 0; i < offsetSegments.length; i++) {
    const curr = offsetSegments[i];
    const next = offsetSegments[(i + 1) % offsetSegments.length];

    const intersection = lineLineIntersectionExtended(curr.p1, curr.p2, next.p1, next.p2);

    if (intersection) {
      const origPoint = localRing[(i + 1) % n];
      if (origPoint) {
        const distFromOrig = Math.sqrt(
          Math.pow(intersection[0] - origPoint[0], 2) +
          Math.pow(intersection[1] - origPoint[1], 2)
        );
        if (distFromOrig < maxRecul * 3 + 50) {
          envelopeRingLocal.push(intersection);
        } else {
          envelopeRingLocal.push([(curr.p2[0] + next.p1[0]) / 2, (curr.p2[1] + next.p1[1]) / 2]);
        }
      } else {
        envelopeRingLocal.push(intersection);
      }
    } else {
      envelopeRingLocal.push(curr.p2);
    }
  }

  if (envelopeRingLocal.length < 3) {
    const safeEnvelope = safeBuffer(parcel, -maxRecul);
    return { envelope: safeEnvelope, envelopeRingLocal: null, segments, proj };
  }

  const closedEnvelopeLocal = [...envelopeRingLocal, envelopeRingLocal[0]];
  const wgs84Ring = closedEnvelopeLocal.map((xy) => fromLocalMeters(xy, proj));

  const envelope: Feature<Polygon> = {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [wgs84Ring] },
    properties: { kind: "envelope_after_reculs" },
  };

  try {
    const envelopeArea = turf.area(envelope);
    const parcelArea = turf.area(parcel);

    if (envelopeArea > 0 && envelopeArea < parcelArea * 0.999) {
      const cleaned = safeClean(envelope);
      const intersected = safeIntersect(cleaned, parcel);
      return {
        envelope: intersected || cleaned,
        envelopeRingLocal,
        segments,
        proj,
      };
    }
  } catch {
    // Fall through
  }

  const safeEnvelope = safeBuffer(parcel, -maxRecul);
  return { envelope: safeEnvelope, envelopeRingLocal: null, segments, proj };
}

// -----------------------------------------------------------------------------
// Create colored bands
// -----------------------------------------------------------------------------
function computeColoredBands(
  parcel: Feature<Polygon | MultiPolygon>,
  envelopeRingLocal: [number, number][],
  segments: SegmentClassification[],
  proj: LocalProjection
): SetbackBands {
  const emptyBands: SetbackBands = { avant: null, lateral: null, fond: null };

  if (!envelopeRingLocal || envelopeRingLocal.length < 3 || segments.length < 3) {
    return emptyBands;
  }

  try {
    const ring = getOuterRing(parcel);
    const localRing = ring.map((p) => toLocalMeters(p, proj));
    const n = segments.length;

    const avantPolys: Feature<Polygon>[] = [];
    const lateralPolys: Feature<Polygon>[] = [];
    const fondPolys: Feature<Polygon>[] = [];

    for (let i = 0; i < n; i++) {
      const seg = segments[i];

      const origP1 = localRing[i];
      const origP2 = localRing[(i + 1) % n];

      const envP1 = envelopeRingLocal[(i - 1 + n) % n];
      const envP2 = envelopeRingLocal[i];

      if (!origP1 || !origP2 || !envP1 || !envP2) continue;

      const quadCoords: Position[] = [
        fromLocalMeters(origP1, proj),
        fromLocalMeters(origP2, proj),
        fromLocalMeters(envP2, proj),
        fromLocalMeters(envP1, proj),
        fromLocalMeters(origP1, proj),
      ];

      const bandPoly: Feature<Polygon> = {
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [quadCoords] },
        properties: { type: seg.type },
      };

      const clipped = safeIntersect(bandPoly, parcel);
      if (clipped) {
        switch (seg.type) {
          case "avant":
            avantPolys.push(clipped as Feature<Polygon>);
            break;
          case "fond":
            fondPolys.push(clipped as Feature<Polygon>);
            break;
          default:
            lateralPolys.push(clipped as Feature<Polygon>);
        }
      }
    }

    return {
      avant: avantPolys.length > 0 ? safeUnion(avantPolys) : null,
      lateral: lateralPolys.length > 0 ? safeUnion(lateralPolys) : null,
      fond: fondPolys.length > 0 ? safeUnion(fondPolys) : null,
    };
  } catch {
    return emptyBands;
  }
}

// -----------------------------------------------------------------------------
// Main computation
// -----------------------------------------------------------------------------
interface ComputeResult {
  envelope: Feature<Polygon | MultiPolygon> | null;
  forbiddenBand: Feature<Polygon | MultiPolygon> | null;
  setbackBands: SetbackBands | null;
  hatchLines: Feature<MultiLineString> | null;
}

function computeAllSetbacks(
  parcel: Feature<Polygon | MultiPolygon>,
  facadeSegment: Feature<LineString> | null,
  reculAvant: number,
  reculLateral: number,
  reculFond: number
): ComputeResult {
  const maxRecul = Math.max(reculAvant, reculLateral, reculFond);

  if (maxRecul <= 0) {
    return { envelope: parcel, forbiddenBand: null, setbackBands: null, hatchLines: null };
  }

  const { envelope, envelopeRingLocal, segments, proj } = computeEnvelopeWithData(
    parcel,
    facadeSegment,
    reculAvant,
    reculLateral,
    reculFond
  );

  if (!envelope) {
    return { envelope: parcel, forbiddenBand: null, setbackBands: null, hatchLines: null };
  }

  // Compute forbidden band using turf difference
  let forbiddenBand = safeDifference(parcel, envelope);

  // Compute colored bands
  let setbackBands: SetbackBands | null = null;
  if (facadeSegment && envelopeRingLocal && proj && segments.length >= 3) {
    setbackBands = computeColoredBands(parcel, envelopeRingLocal, segments, proj);

    // If turf difference failed, compute forbiddenBand from setbackBands
    if (!forbiddenBand && setbackBands) {
      const allBands = [setbackBands.avant, setbackBands.lateral, setbackBands.fond].filter(
        (b): b is Feature<Polygon | MultiPolygon> => b !== null
      );
      if (allBands.length > 0) {
        forbiddenBand = safeUnion(allBands);
      }
    }
  } else if (forbiddenBand) {
    setbackBands = { avant: null, lateral: forbiddenBand, fond: null };
  }

  // Generate hatch lines directly from parcel and envelope geometry
  let hatchLines: Feature<MultiLineString> | null = null;
  if (envelope && maxRecul > 0) {
    hatchLines = generateHatchLines(parcel, envelope, 2, 45);
  }

  return { envelope, forbiddenBand, setbackBands, hatchLines };
}

// -----------------------------------------------------------------------------
// Main hook
// -----------------------------------------------------------------------------
export function useReculEngine({
  parcelFeature,
  resolvedRuleset,
  rulesetValid,
}: UseReculEngineProps): ReculEngineState {
  const [facadeSegment, setFacadeSegment] = useState<Feature<LineString> | null>(null);

  const selectFacadeFromClick = useCallback(
    (lngLat: [number, number]): boolean => {
      if (!parcelFeature) return false;
      const seg = findClosestEdgeSegment(parcelFeature, lngLat);
      if (seg) {
        setFacadeSegment(seg);
        return true;
      }
      return false;
    },
    [parcelFeature]
  );

  const resetFacade = useCallback(() => {
    setFacadeSegment(null);
  }, []);

  const computedReculs = useMemo<AppliedReculs | null>(() => {
    if (!rulesetValid || !resolvedRuleset) return null;

    const extracted = extractReculsFromRuleset(resolvedRuleset);

    const appliedAvant =
      typeof extracted.avant === "number" && Number.isFinite(extracted.avant) ? extracted.avant : 0;
    const appliedLateral =
      typeof extracted.lateral === "number" && Number.isFinite(extracted.lateral) ? extracted.lateral : 0;
    const appliedFond =
      typeof extracted.fond === "number" && Number.isFinite(extracted.fond) ? extracted.fond : 0;

    const hasData = [extracted.avant, extracted.lateral, extracted.fond].some(
      (v) => typeof v === "number" && Number.isFinite(v)
    );

    const hasFacade = facadeSegment !== null;
    let mode: AppliedReculs["mode"];

    if (hasFacade && extracted.mode === "DIRECTIONAL_BY_FACADE") {
      mode = "DIRECTIONAL_BY_FACADE";
    } else if (hasFacade) {
      mode = "FALLBACK_UNIFORM";
    } else {
      mode = "UNIFORM";
    }

    const reculMax = Math.max(appliedAvant, appliedLateral, appliedFond);

    return {
      recul_avant_m: appliedAvant,
      recul_lateral_m: appliedLateral,
      recul_fond_m: appliedFond,
      reculMax,
      source: "plu",
      mode,
      hasData,
      hasFacade,
    };
  }, [rulesetValid, resolvedRuleset, facadeSegment]);

  const { envelopeFeature, forbiddenBand, setbackBands, hatchLines } = useMemo(() => {
    if (!parcelFeature) {
      return { envelopeFeature: null, forbiddenBand: null, setbackBands: null, hatchLines: null };
    }
    if (!computedReculs) {
      return { envelopeFeature: parcelFeature, forbiddenBand: null, setbackBands: null, hatchLines: null };
    }

    const { recul_avant_m, recul_lateral_m, recul_fond_m, mode } = computedReculs;

    const result = computeAllSetbacks(
      parcelFeature,
      mode === "DIRECTIONAL_BY_FACADE" ? facadeSegment : null,
      recul_avant_m,
      recul_lateral_m,
      recul_fond_m
    );

    return {
      // CRITICAL: Always fallback to parcelFeature if envelope computation fails
      // This ensures templates and other features that depend on envelopeFeature work
      envelopeFeature: result.envelope || parcelFeature,
      forbiddenBand: result.forbiddenBand,
      setbackBands: result.setbackBands,
      hatchLines: result.hatchLines,
    };
  }, [parcelFeature, computedReculs, facadeSegment]);

  return {
    facadeSegment,
    selectFacadeFromClick,
    resetFacade,
    computedReculs,
    envelopeFeature,
    forbiddenBand,
    setbackBands,
    hatchLines,
  };
}