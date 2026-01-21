// src/spaces/promoteur/drawEngine.tsx
// Professional Drawing Engine with PowerPoint-style transforms
// Fixed: version counter to force re-render on rotation/transforms
// Fixed: template sizing for elongated parcels

import React, { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { GeoJSON, Polyline, useMap, useMapEvents, Marker } from "react-leaflet";
import L from "leaflet";
import type { Feature, Polygon, MultiPolygon, Position } from "geojson";
import * as turf from "@turf/turf";

import "@geoman-io/leaflet-geoman-free";

// =============================================================================
// TYPES
// =============================================================================

export type DrawnObjectType = "building" | "parking";
export type BuildingTemplate = "rectangle" | "square" | "l-shape" | "u-shape";
export type ParkingTemplate = "rectangle" | "strip";
export type TransformActionType = "none" | "move" | "scale" | "rotate" | "stretch";
export type HandlePosition = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "rotate";

export interface DrawnObject {
  id: string;
  type: DrawnObjectType;
  feature: Feature<Polygon | MultiPolygon>;
  areaM2: number;
  createdAt: number;
  version: number; // ← INCREMENT ON EVERY CHANGE TO FORCE RE-RENDER
}

export interface SnapSettings {
  enabled: boolean;
  gridSize: number;
  angleSnap: boolean;
  envelopeSnap: boolean;
  objectSnap: boolean;
  snapTolerance: number;
}

export interface DimensionLabel {
  position: Position;
  length: number;
  angle: number;
  midpoint: Position;
}

export interface HistoryEntry {
  buildings: DrawnObject[];
  parkings: DrawnObject[];
  activeObjectId: string | null;
  timestamp: number;
  action: string;
}

interface TransformAction {
  type: TransformActionType;
  objectId: string;
  objectType: DrawnObjectType;
  startLatLng: L.LatLng | null;
  pivotPoint: Position | null;
  originalFeature: Feature<Polygon | MultiPolygon> | null;
  handlePosition?: HandlePosition;
  startBearing?: number;
  startDistance?: number;
  originalBbox?: [number, number, number, number];
  shiftKey?: boolean; // Track if Shift is held for free rotation
}

interface PowerPointHandles {
  nw: Position;
  n: Position;
  ne: Position;
  e: Position;
  se: Position;
  s: Position;
  sw: Position;
  w: Position;
  rotate: Position;
  centroid: Position;
  rotationLineStart: Position;
}

interface LocalProjection {
  centerLng: number;
  centerLat: number;
  metersPerDegreeLng: number;
  metersPerDegreeLat: number;
}

interface SnapGuide {
  type: "horizontal" | "vertical" | "angle" | "envelope";
  start: Position;
  end: Position;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const MAX_HISTORY_SIZE = 50;
const ROTATION_HANDLE_OFFSET = 12;
const DEFAULT_SNAP_SETTINGS: SnapSettings = {
  enabled: true,
  gridSize: 1,
  angleSnap: true,
  envelopeSnap: true,
  objectSnap: true,
  snapTolerance: 10,
};

// =============================================================================
// HELPERS
// =============================================================================

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
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

function formatDistance(meters: number): string {
  if (meters < 1) return `${(meters * 100).toFixed(0)} cm`;
  if (meters < 10) return `${meters.toFixed(2)} m`;
  return `${meters.toFixed(1)} m`;
}

function formatArea(m2: number): string {
  if (m2 < 1) return `${(m2 * 10000).toFixed(0)} cm²`;
  if (m2 < 100) return `${m2.toFixed(1)} m²`;
  return `${m2.toFixed(0)} m²`;
}

// =============================================================================
// DIMENSION CALCULATIONS
// =============================================================================

function computeEdgeDimensions(feature: Feature<Polygon | MultiPolygon>): DimensionLabel[] {
  const dimensions: DimensionLabel[] = [];

  try {
    const coords =
      feature.geometry.type === "Polygon"
        ? feature.geometry.coordinates[0]
        : feature.geometry.coordinates[0][0];

    if (!coords || coords.length < 3) return dimensions;

    const proj = createLocalProjection(feature);

    for (let i = 0; i < coords.length - 1; i++) {
      const p1 = coords[i] as Position;
      const p2 = coords[i + 1] as Position;

      const local1 = toLocalMeters(p1, proj);
      const local2 = toLocalMeters(p2, proj);

      const dx = local2[0] - local1[0];
      const dy = local2[1] - local1[1];
      const length = Math.sqrt(dx * dx + dy * dy);

      if (length < 0.1) continue;

      const midpoint: Position = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI;

      dimensions.push({ position: p1, length, angle, midpoint });
    }
  } catch (err) {
    console.warn("[computeEdgeDimensions] Error:", err);
  }

  return dimensions;
}

function computeDistanceToEnvelope(
  feature: Feature<Polygon | MultiPolygon>,
  envelope: Feature<Polygon | MultiPolygon> | null
): { min: number; points: [Position, Position] | null } {
  if (!envelope) return { min: Infinity, points: null };

  try {
    const envelopeCoords =
      envelope.geometry.type === "Polygon"
        ? envelope.geometry.coordinates[0]
        : envelope.geometry.coordinates[0][0];

    let minDist = Infinity;
    let closestPoints: [Position, Position] | null = null;

    const featureCoords =
      feature.geometry.type === "Polygon"
        ? feature.geometry.coordinates[0]
        : feature.geometry.coordinates[0][0];

    for (const fp of featureCoords) {
      for (let i = 0; i < envelopeCoords.length - 1; i++) {
        const ep1 = envelopeCoords[i];
        const ep2 = envelopeCoords[i + 1];
        const line = turf.lineString([ep1, ep2]);
        const pt = turf.point(fp as Position);
        const nearest = turf.nearestPointOnLine(line, pt);
        const dist = turf.distance(pt, nearest, { units: "meters" });

        if (dist < minDist) {
          minDist = dist;
          closestPoints = [fp as Position, nearest.geometry.coordinates as Position];
        }
      }
    }

    return { min: minDist, points: closestPoints };
  } catch (err) {
    console.warn("[computeDistanceToEnvelope] Error:", err);
    return { min: Infinity, points: null };
  }
}

// =============================================================================
// POWERPOINT HANDLES
// =============================================================================

function computePowerPointHandles(feature: Feature<Polygon | MultiPolygon>): PowerPointHandles | null {
  try {
    const bbox = turf.bbox(feature);
    const [minX, minY, maxX, maxY] = bbox;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const proj = createLocalProjection(feature);
    const topCenterLocal = toLocalMeters([centerX, maxY], proj);
    const rotationHandleLocal: [number, number] = [topCenterLocal[0], topCenterLocal[1] + ROTATION_HANDLE_OFFSET];
    const rotationHandle = fromLocalMeters(rotationHandleLocal, proj);

    return {
      nw: [minX, maxY],
      ne: [maxX, maxY],
      se: [maxX, minY],
      sw: [minX, minY],
      n: [centerX, maxY],
      e: [maxX, centerY],
      s: [centerX, minY],
      w: [minX, centerY],
      rotate: rotationHandle,
      rotationLineStart: [centerX, maxY],
      centroid: [centerX, centerY],
    };
  } catch (err) {
    console.warn("[computePowerPointHandles] Error:", err);
    return null;
  }
}

// =============================================================================
// SNAP
// =============================================================================

function snapToGrid(pos: Position, gridSize: number, proj: LocalProjection): Position {
  const local = toLocalMeters(pos, proj);
  const snappedLocal: [number, number] = [
    Math.round(local[0] / gridSize) * gridSize,
    Math.round(local[1] / gridSize) * gridSize,
  ];
  return fromLocalMeters(snappedLocal, proj);
}

function snapToEnvelopeEdge(
  pos: Position,
  envelope: Feature<Polygon | MultiPolygon>,
  tolerance: number,
): { snapped: Position; guide: SnapGuide | null } {
  const coords =
    envelope.geometry.type === "Polygon"
      ? envelope.geometry.coordinates[0]
      : envelope.geometry.coordinates[0][0];

  const pt = turf.point(pos);
  let minDist = Infinity;
  let snappedPos = pos;
  let guide: SnapGuide | null = null;

  for (let i = 0; i < coords.length - 1; i++) {
    const p1 = coords[i] as Position;
    const p2 = coords[i + 1] as Position;
    const line = turf.lineString([p1, p2]);
    const nearest = turf.nearestPointOnLine(line, pt);
    const dist = turf.distance(pt, nearest, { units: "meters" });

    if (dist < minDist && dist < tolerance) {
      minDist = dist;
      snappedPos = nearest.geometry.coordinates as Position;
      guide = { type: "envelope", start: p1, end: p2 };
    }
  }

  return { snapped: snappedPos, guide };
}

function computeSnapGuides(
  pos: Position,
  objects: DrawnObject[],
  settings: SnapSettings,
  proj: LocalProjection
): SnapGuide[] {
  const guides: SnapGuide[] = [];
  const local = toLocalMeters(pos, proj);

  if (settings.objectSnap) {
    for (const obj of objects) {
      const centroid = turf.centroid(obj.feature as turf.AllGeoJSON);
      const objLocal = toLocalMeters(centroid.geometry.coordinates as Position, proj);

      if (Math.abs(local[1] - objLocal[1]) < settings.gridSize * 2) {
        guides.push({
          type: "horizontal",
          start: fromLocalMeters([local[0] - 50, objLocal[1]], proj),
          end: fromLocalMeters([local[0] + 50, objLocal[1]], proj),
        });
      }

      if (Math.abs(local[0] - objLocal[0]) < settings.gridSize * 2) {
        guides.push({
          type: "vertical",
          start: fromLocalMeters([objLocal[0], local[1] - 50], proj),
          end: fromLocalMeters([objLocal[0], local[1] + 50], proj),
        });
      }
    }
  }

  return guides;
}

// =============================================================================
// TEMPLATES
// =============================================================================

function createRectangleTemplate(
  center: Position,
  widthM: number,
  lengthM: number,
  bearingDeg: number,
  proj: LocalProjection
): Feature<Polygon> {
  const cx = toLocalMeters(center, proj);
  const halfW = widthM / 2;
  const halfL = lengthM / 2;
  const rad = (bearingDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const corners: [number, number][] = [
    [-halfW, -halfL],
    [halfW, -halfL],
    [halfW, halfL],
    [-halfW, halfL],
    [-halfW, -halfL],
  ];

  const rotatedCorners = corners.map(([x, y]) => {
    const rx = x * cos - y * sin + cx[0];
    const ry = x * sin + y * cos + cx[1];
    return fromLocalMeters([rx, ry], proj);
  });

  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [rotatedCorners] },
    properties: { template: "rectangle" },
  };
}

function createLShapeTemplate(center: Position, sizeM: number, bearingDeg: number, proj: LocalProjection): Feature<Polygon> {
  const cx = toLocalMeters(center, proj);
  const s = sizeM;
  const w = s * 0.4;
  const rad = (bearingDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const points: [number, number][] = [
    [-s / 2, -s / 2],
    [-s / 2 + w, -s / 2],
    [-s / 2 + w, s / 2 - w],
    [s / 2, s / 2 - w],
    [s / 2, s / 2],
    [-s / 2, s / 2],
    [-s / 2, -s / 2],
  ];

  const rotatedPoints = points.map(([x, y]) => {
    const rx = x * cos - y * sin + cx[0];
    const ry = x * sin + y * cos + cx[1];
    return fromLocalMeters([rx, ry], proj);
  });

  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [rotatedPoints] },
    properties: { template: "l-shape" },
  };
}

function createUShapeTemplate(center: Position, sizeM: number, bearingDeg: number, proj: LocalProjection): Feature<Polygon> {
  const cx = toLocalMeters(center, proj);
  const s = sizeM;
  const w = s * 0.3;
  const rad = (bearingDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const points: [number, number][] = [
    [-s / 2, -s / 2],
    [-s / 2 + w, -s / 2],
    [-s / 2 + w, s / 2 - w],
    [s / 2 - w, s / 2 - w],
    [s / 2 - w, -s / 2],
    [s / 2, -s / 2],
    [s / 2, s / 2],
    [-s / 2, s / 2],
    [-s / 2, -s / 2],
  ];

  const rotatedPoints = points.map(([x, y]) => {
    const rx = x * cos - y * sin + cx[0];
    const ry = x * sin + y * cos + cx[1];
    return fromLocalMeters([rx, ry], proj);
  });

  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [rotatedPoints] },
    properties: { template: "u-shape" },
  };
}

// =============================================================================
// IMPROVED TEMPLATE CREATION - handles elongated parcels
// =============================================================================

function createTemplateShape(
  template: BuildingTemplate | ParkingTemplate,
  envelope: Feature<Polygon | MultiPolygon>,
  type: DrawnObjectType
): Feature<Polygon> | null {
  try {
    const centroid = turf.centroid(envelope as turf.AllGeoJSON);
    const center = centroid.geometry.coordinates as Position;
    const proj = createLocalProjection(envelope);
    
    // Calculate the actual area of the envelope to determine appropriate size
    const envelopeArea = turf.area(envelope as turf.AllGeoJSON);
    
    // For elongated parcels, use area-based sizing instead of bbox
    // Target: shape should be about 10-15% of envelope area for buildings
    const targetAreaRatio = type === "building" ? 0.12 : 0.06;
    const targetArea = envelopeArea * targetAreaRatio;
    
    // Calculate base dimension from target area (assuming roughly square for simplicity)
    const baseDimFromArea = Math.sqrt(targetArea);
    
    // Also calculate from bbox as a sanity check
    const bbox = turf.bbox(envelope);
    const bboxWidth = (bbox[2] - bbox[0]) * proj.metersPerDegreeLng;
    const bboxHeight = (bbox[3] - bbox[1]) * proj.metersPerDegreeLat;
    const minBboxDim = Math.min(bboxWidth, bboxHeight);
    
    // Use the smaller of: area-based dimension or 35% of smallest bbox dimension
    // This ensures the shape fits in narrow parcels
    const maxDim = Math.min(baseDimFromArea, minBboxDim * 0.35);
    
    // Ensure minimum viable size (at least 5m) and maximum (50m)
    const safeDim = Math.max(Math.min(maxDim, 50), 5);
    
    // Calculate orientation based on envelope shape
    // For elongated parcels, align the building with the long axis
    let bearing = 0;
    try {
      // Get the longest edge to determine orientation
      const coords = envelope.geometry.type === "Polygon" 
        ? envelope.geometry.coordinates[0] 
        : envelope.geometry.coordinates[0][0];
      
      let maxEdgeLength = 0;
      let longestEdgeBearing = 0;
      
      for (let i = 0; i < coords.length - 1; i++) {
        const p1 = coords[i] as Position;
        const p2 = coords[i + 1] as Position;
        const edgeLength = turf.distance(turf.point(p1), turf.point(p2), { units: "meters" });
        
        if (edgeLength > maxEdgeLength) {
          maxEdgeLength = edgeLength;
          longestEdgeBearing = turf.bearing(turf.point(p1), turf.point(p2));
        }
      }
      
      bearing = longestEdgeBearing;
    } catch {
      bearing = 0;
    }

    switch (template) {
      case "rectangle":
        if (type === "building") {
          // Ratio ~1:1.75 for buildings
          return createRectangleTemplate(center, safeDim * 0.6, safeDim * 1.05, bearing, proj);
        }
        // Ratio ~1:0.6 for parking rectangles
        return createRectangleTemplate(center, safeDim * 0.8, safeDim * 0.5, bearing, proj);
      case "square":
        return createRectangleTemplate(center, safeDim * 0.7, safeDim * 0.7, bearing, proj);
      case "l-shape":
        return createLShapeTemplate(center, safeDim * 0.8, bearing, proj);
      case "u-shape":
        return createUShapeTemplate(center, safeDim * 0.8, bearing, proj);
      case "strip":
        // Strip parking: long and thin, aligned with parcel
        return createRectangleTemplate(center, safeDim * 0.25, safeDim * 1.2, bearing, proj);
      default:
        return createRectangleTemplate(center, safeDim * 0.6, safeDim * 0.8, bearing, proj);
    }
  } catch (err) {
    console.warn("[createTemplateShape] Error:", err);
    return null;
  }
}

// =============================================================================
// TRANSFORMS
// =============================================================================

function translateFeature(
  feature: Feature<Polygon | MultiPolygon>,
  fromLatLng: L.LatLng,
  toLatLng: L.LatLng,
  snapSettings?: SnapSettings,
  envelope?: Feature<Polygon | MultiPolygon> | null
): Feature<Polygon | MultiPolygon> | null {
  try {
    const proj = createLocalProjection(feature);
    let targetPos: Position = [toLatLng.lng, toLatLng.lat];

    if (snapSettings?.enabled) {
      if (snapSettings.gridSize > 0) {
        targetPos = snapToGrid(targetPos, snapSettings.gridSize, proj);
      }
      if (snapSettings.envelopeSnap && envelope) {
        const { snapped } = snapToEnvelopeEdge(targetPos, envelope, snapSettings.gridSize * 3);
        targetPos = snapped;
      }
    }

    const fromLocal = toLocalMeters([fromLatLng.lng, fromLatLng.lat], proj);
    const toLocal = toLocalMeters(targetPos, proj);

    const dx = toLocal[0] - fromLocal[0];
    const dy = toLocal[1] - fromLocal[1];

    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return feature;

    const transformCoords = (coords: Position[]): Position[] =>
      coords.map((pos) => {
        const local = toLocalMeters(pos, proj);
        return fromLocalMeters([local[0] + dx, local[1] + dy], proj);
      });

    const geom = feature.geometry;
    let newGeom: Polygon | MultiPolygon;

    if (geom.type === "Polygon") {
      newGeom = { type: "Polygon", coordinates: geom.coordinates.map((ring) => transformCoords(ring as Position[])) };
    } else {
      newGeom = {
        type: "MultiPolygon",
        coordinates: geom.coordinates.map((poly) => poly.map((ring) => transformCoords(ring as Position[]))),
      };
    }

    return { type: "Feature", geometry: newGeom, properties: { ...feature.properties } };
  } catch (err) {
    console.warn("[translateFeature] Error:", err);
    return null;
  }
}

function rotateFeature(
  feature: Feature<Polygon | MultiPolygon>,
  pivot: Position,
  angleDegrees: number,
  snapSettings?: SnapSettings,
  freeRotation?: boolean
): Feature<Polygon | MultiPolygon> | null {
  try {
    let finalAngle = angleDegrees;

    // Snap to 5° increments unless freeRotation is enabled (Shift key held)
    if (snapSettings?.enabled && snapSettings.angleSnap && !freeRotation) {
      const snapAngle = 5; // 5° snap for finer control
      finalAngle = Math.round(angleDegrees / snapAngle) * snapAngle;
    }

    const proj = createLocalProjection(feature);
    const pivotLocal = toLocalMeters(pivot, proj);
    const rad = (finalAngle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const transformCoords = (coords: Position[]): Position[] =>
      coords.map((pos) => {
        const local = toLocalMeters(pos, proj);
        const dx = local[0] - pivotLocal[0];
        const dy = local[1] - pivotLocal[1];
        const rx = dx * cos - dy * sin + pivotLocal[0];
        const ry = dx * sin + dy * cos + pivotLocal[1];
        return fromLocalMeters([rx, ry], proj);
      });

    const geom = feature.geometry;
    let newGeom: Polygon | MultiPolygon;

    if (geom.type === "Polygon") {
      newGeom = { type: "Polygon", coordinates: geom.coordinates.map((ring) => transformCoords(ring as Position[])) };
    } else {
      newGeom = {
        type: "MultiPolygon",
        coordinates: geom.coordinates.map((poly) => poly.map((ring) => transformCoords(ring as Position[]))),
      };
    }

    return { type: "Feature", geometry: newGeom, properties: { ...feature.properties } };
  } catch (err) {
    console.warn("[rotateFeature] Error:", err);
    return null;
  }
}

function scaleFeature(
  feature: Feature<Polygon | MultiPolygon>,
  pivot: Position,
  scaleFactor: number
): Feature<Polygon | MultiPolygon> | null {
  try {
    if (scaleFactor <= 0.1 || scaleFactor > 10) return feature;

    const proj = createLocalProjection(feature);
    const pivotLocal = toLocalMeters(pivot, proj);

    const transformCoords = (coords: Position[]): Position[] =>
      coords.map((pos) => {
        const local = toLocalMeters(pos, proj);
        const dx = local[0] - pivotLocal[0];
        const dy = local[1] - pivotLocal[1];
        const sx = dx * scaleFactor + pivotLocal[0];
        const sy = dy * scaleFactor + pivotLocal[1];
        return fromLocalMeters([sx, sy], proj);
      });

    const geom = feature.geometry;
    let newGeom: Polygon | MultiPolygon;

    if (geom.type === "Polygon") {
      newGeom = { type: "Polygon", coordinates: geom.coordinates.map((ring) => transformCoords(ring as Position[])) };
    } else {
      newGeom = {
        type: "MultiPolygon",
        coordinates: geom.coordinates.map((poly) => poly.map((ring) => transformCoords(ring as Position[]))),
      };
    }

    return { type: "Feature", geometry: newGeom, properties: { ...feature.properties } };
  } catch (err) {
    console.warn("[scaleFeature] Error:", err);
    return null;
  }
}

function stretchFeature(
  feature: Feature<Polygon | MultiPolygon>,
  handlePosition: HandlePosition,
  originalBbox: [number, number, number, number],
  currentLatLng: L.LatLng,
  snapSettings?: SnapSettings
): Feature<Polygon | MultiPolygon> | null {
  try {
    const [origMinX, origMinY, origMaxX, origMaxY] = originalBbox;
    const proj = createLocalProjection(feature);

    let targetPos: Position = [currentLatLng.lng, currentLatLng.lat];

    if (snapSettings?.enabled && snapSettings.gridSize > 0) {
      targetPos = snapToGrid(targetPos, snapSettings.gridSize, proj);
    }

    let newMinX = origMinX;
    let newMinY = origMinY;
    let newMaxX = origMaxX;
    let newMaxY = origMaxY;

    switch (handlePosition) {
      case "nw": newMinX = targetPos[0]; newMaxY = targetPos[1]; break;
      case "n": newMaxY = targetPos[1]; break;
      case "ne": newMaxX = targetPos[0]; newMaxY = targetPos[1]; break;
      case "e": newMaxX = targetPos[0]; break;
      case "se": newMaxX = targetPos[0]; newMinY = targetPos[1]; break;
      case "s": newMinY = targetPos[1]; break;
      case "sw": newMinX = targetPos[0]; newMinY = targetPos[1]; break;
      case "w": newMinX = targetPos[0]; break;
    }

    const minSize = 0.00001;
    if (newMaxX - newMinX < minSize) return feature;
    if (newMaxY - newMinY < minSize) return feature;

    const origWidth = origMaxX - origMinX;
    const origHeight = origMaxY - origMinY;
    const newWidth = newMaxX - newMinX;
    const newHeight = newMaxY - newMinY;

    const transformCoords = (coords: Position[]): Position[] =>
      coords.map((pos) => {
        const normalizedX = (pos[0] - origMinX) / origWidth;
        const normalizedY = (pos[1] - origMinY) / origHeight;
        const newX = newMinX + normalizedX * newWidth;
        const newY = newMinY + normalizedY * newHeight;
        return [newX, newY];
      });

    const geom = feature.geometry;
    let newGeom: Polygon | MultiPolygon;

    if (geom.type === "Polygon") {
      newGeom = { type: "Polygon", coordinates: geom.coordinates.map((ring) => transformCoords(ring as Position[])) };
    } else {
      newGeom = {
        type: "MultiPolygon",
        coordinates: geom.coordinates.map((poly) => poly.map((ring) => transformCoords(ring as Position[]))),
      };
    }

    return { type: "Feature", geometry: newGeom, properties: { ...feature.properties } };
  } catch (err) {
    console.warn("[stretchFeature] Error:", err);
    return null;
  }
}

function computeAngle(pivot: Position, point: Position): number {
  const dx = point[0] - pivot[0];
  const dy = point[1] - pivot[1];
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

function computeDistance(a: Position, b: Position): number {
  try {
    return turf.distance(turf.point(a), turf.point(b), { units: "meters" });
  } catch {
    return 0;
  }
}

// =============================================================================
// MAIN HOOK
// =============================================================================

export interface DrawEngineState {
  editMode: boolean;
  setEditMode: React.Dispatch<React.SetStateAction<boolean>>;
  currentDrawType: DrawnObjectType;
  setCurrentDrawType: React.Dispatch<React.SetStateAction<DrawnObjectType>>;
  activeObjectId: string | null;
  setActiveObjectId: React.Dispatch<React.SetStateAction<string | null>>;

  drawnBuildings: DrawnObject[];
  drawnParkings: DrawnObject[];

  handleObjectCreated: (feature: Feature<Polygon | MultiPolygon>) => void;
  createFromTemplate: (template: BuildingTemplate | ParkingTemplate, type: DrawnObjectType) => void;
  deleteObject: (id: string) => void;
  clearAll: () => void;

  transformActionRef: React.MutableRefObject<TransformAction>;
  startTransform: (
    type: TransformActionType,
    objectId: string,
    objectType: DrawnObjectType,
    startLatLng: L.LatLng,
    originalFeature: Feature<Polygon | MultiPolygon>,
    handlePosition?: HandlePosition
  ) => void;
  applyTransform: (currentLatLng: L.LatLng, shiftKey?: boolean) => void;
  endTransform: () => void;

  getActiveObject: () => DrawnObject | null;
  updateObjectGeometry: (id: string, type: DrawnObjectType, newFeature: Feature<Polygon | MultiPolygon>) => void;
  isWithinEnvelope: (feature: Feature<Polygon | MultiPolygon>) => boolean;

  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  historyIndex: number;
  historyLength: number;

  snapSettings: SnapSettings;
  setSnapSettings: React.Dispatch<React.SetStateAction<SnapSettings>>;
  snapGuides: SnapGuide[];

  showDimensions: boolean;
  setShowDimensions: React.Dispatch<React.SetStateAction<boolean>>;

  currentRotationAngle: number | null;
  isRotationFreeMode: boolean;
}

interface UseDrawEngineProps {
  envelopeFeature: Feature<Polygon | MultiPolygon> | null;
  onError: (msg: string | null) => void;
}

export function useDrawEngine({ envelopeFeature, onError }: UseDrawEngineProps): DrawEngineState {
  const [editMode, setEditMode] = useState(false);
  const [currentDrawType, setCurrentDrawType] = useState<DrawnObjectType>("building");
  const [drawnBuildings, setDrawnBuildings] = useState<DrawnObject[]>([]);
  const [drawnParkings, setDrawnParkings] = useState<DrawnObject[]>([]);
  const [activeObjectId, setActiveObjectId] = useState<string | null>(null);

  const [snapSettings, setSnapSettings] = useState<SnapSettings>(DEFAULT_SNAP_SETTINGS);
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);

  const [showDimensions, setShowDimensions] = useState(true);

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const isUndoRedoAction = useRef(false);

  const [currentRotationAngle, setCurrentRotationAngle] = useState<number | null>(null);
  const [isRotationFreeMode, setIsRotationFreeMode] = useState(false);

  const transformActionRef = useRef<TransformAction>({
    type: "none",
    objectId: "",
    objectType: "building",
    startLatLng: null,
    pivotPoint: null,
    originalFeature: null,
  });

  const pushToHistory = useCallback(
    (action: string) => {
      if (isUndoRedoAction.current) {
        isUndoRedoAction.current = false;
        return;
      }

      const entry: HistoryEntry = {
        buildings: JSON.parse(JSON.stringify(drawnBuildings)),
        parkings: JSON.parse(JSON.stringify(drawnParkings)),
        activeObjectId,
        timestamp: Date.now(),
        action,
      };

      setHistory((prev) => {
        const newHistory = prev.slice(0, historyIndex + 1);
        newHistory.push(entry);
        if (newHistory.length > MAX_HISTORY_SIZE) newHistory.shift();
        return newHistory;
      });

      setHistoryIndex((prev) => Math.min(prev + 1, MAX_HISTORY_SIZE - 1));
    },
    [drawnBuildings, drawnParkings, activeObjectId, historyIndex]
  );

  const undo = useCallback(() => {
    if (historyIndex <= 0) return;
    isUndoRedoAction.current = true;
    const prevEntry = history[historyIndex - 1];
    setDrawnBuildings(JSON.parse(JSON.stringify(prevEntry.buildings)));
    setDrawnParkings(JSON.parse(JSON.stringify(prevEntry.parkings)));
    setActiveObjectId(prevEntry.activeObjectId);
    setHistoryIndex((prev) => prev - 1);
  }, [history, historyIndex]);

  const redo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    isUndoRedoAction.current = true;
    const nextEntry = history[historyIndex + 1];
    setDrawnBuildings(JSON.parse(JSON.stringify(nextEntry.buildings)));
    setDrawnParkings(JSON.parse(JSON.stringify(nextEntry.parkings)));
    setActiveObjectId(nextEntry.activeObjectId);
    setHistoryIndex((prev) => prev + 1);
  }, [history, historyIndex]);

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  const deleteObject = useCallback(
    (id: string) => {
      pushToHistory("Supprimer");
      setDrawnBuildings((prev) => prev.filter((b) => b.id !== id));
      setDrawnParkings((prev) => prev.filter((p) => p.id !== id));
      if (activeObjectId === id) setActiveObjectId(null);
    },
    [activeObjectId, pushToHistory]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!editMode) return;

      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        redo();
      }

      if ((e.key === "Delete" || e.key === "Backspace") && activeObjectId) {
        e.preventDefault();
        deleteObject(activeObjectId);
      }

      if (e.key === "Escape") {
        setActiveObjectId(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editMode, undo, redo, activeObjectId, deleteObject]);

  const isWithinEnvelope = useCallback(
    (feature: Feature<Polygon | MultiPolygon>): boolean => {
      if (!envelopeFeature) return true;
      try {
        return turf.booleanWithin(feature as turf.AllGeoJSON, envelopeFeature as turf.AllGeoJSON);
      } catch {
        return false;
      }
    },
    [envelopeFeature]
  );

  const getActiveObject = useCallback((): DrawnObject | null => {
    if (!activeObjectId) return null;
    const building = drawnBuildings.find((b) => b.id === activeObjectId);
    if (building) return building;
    const parking = drawnParkings.find((p) => p.id === activeObjectId);
    return parking ?? null;
  }, [activeObjectId, drawnBuildings, drawnParkings]);

  // CRITICAL: Increment version on every geometry update
  const updateObjectGeometry = useCallback(
    (id: string, type: DrawnObjectType, newFeature: Feature<Polygon | MultiPolygon>) => {
      const areaM2 = turf.area(newFeature as turf.AllGeoJSON);
      if (type === "building") {
        setDrawnBuildings((prev) =>
          prev.map((b) =>
            b.id === id
              ? { ...b, feature: newFeature, areaM2, version: b.version + 1 }
              : b
          )
        );
      } else {
        setDrawnParkings((prev) =>
          prev.map((p) =>
            p.id === id
              ? { ...p, feature: newFeature, areaM2, version: p.version + 1 }
              : p
          )
        );
      }
    },
    []
  );

  const handleObjectCreated = useCallback(
    (feature: Feature<Polygon | MultiPolygon>) => {
      const areaM2 = turf.area(feature as turf.AllGeoJSON);
      const newObj: DrawnObject = {
        id: generateId(),
        type: currentDrawType,
        feature,
        areaM2,
        createdAt: Date.now(),
        version: 0,
      };

      if (!isWithinEnvelope(feature)) {
        onError("L'objet dessiné doit rester dans l'enveloppe constructible.");
        return;
      }

      if (currentDrawType === "building") {
        setDrawnBuildings((prev) => [...prev, newObj]);
      } else {
        setDrawnParkings((prev) => [...prev, newObj]);
      }

      setActiveObjectId(newObj.id);
      onError(null);
      setTimeout(() => pushToHistory(`Créer ${currentDrawType}`), 0);
    },
    [currentDrawType, isWithinEnvelope, onError, pushToHistory]
  );

  const createFromTemplate = useCallback(
    (template: BuildingTemplate | ParkingTemplate, type: DrawnObjectType) => {
      if (!envelopeFeature) {
        onError("Aucune enveloppe disponible pour créer une forme.");
        return;
      }

      const shape = createTemplateShape(template, envelopeFeature, type);
      if (!shape) {
        onError("Impossible de créer la forme.");
        return;
      }

      // Try to fit the shape, if it doesn't fit, try reducing size progressively
      let finalShape = shape;
      let attempts = 0;
      const maxAttempts = 5;
      
      while (!isWithinEnvelope(finalShape) && attempts < maxAttempts) {
        attempts++;
        const scaleFactor = 1 - (attempts * 0.15); // Reduce by 15% each attempt
        const centroid = turf.centroid(finalShape as turf.AllGeoJSON).geometry.coordinates as Position;
        const scaled = scaleFeature(finalShape, centroid, scaleFactor);
        if (scaled) {
          finalShape = scaled as Feature<Polygon>;
        } else {
          break;
        }
      }

      if (!isWithinEnvelope(finalShape)) {
        onError("La forme générée ne peut pas tenir dans l'enveloppe. Essayez de dessiner manuellement.");
        return;
      }

      const areaM2 = turf.area(finalShape as turf.AllGeoJSON);
      const newObj: DrawnObject = {
        id: generateId(),
        type,
        feature: finalShape,
        areaM2,
        createdAt: Date.now(),
        version: 0,
      };

      if (type === "building") {
        setDrawnBuildings((prev) => [...prev, newObj]);
      } else {
        setDrawnParkings((prev) => [...prev, newObj]);
      }

      setActiveObjectId(newObj.id);
      onError(null);
      setTimeout(() => pushToHistory(`Template ${template}`), 0);
    },
    [envelopeFeature, isWithinEnvelope, onError, pushToHistory]
  );

  const clearAll = useCallback(() => {
    pushToHistory("Tout effacer");
    setDrawnBuildings([]);
    setDrawnParkings([]);
    setActiveObjectId(null);
  }, [pushToHistory]);

  const startTransform = useCallback(
    (
      type: TransformActionType,
      objectId: string,
      objectType: DrawnObjectType,
      startLatLng: L.LatLng,
      originalFeature: Feature<Polygon | MultiPolygon>,
      handlePosition?: HandlePosition
    ) => {
      const centroid = turf.centroid(originalFeature as turf.AllGeoJSON).geometry.coordinates as Position;
      const bbox = turf.bbox(originalFeature) as [number, number, number, number];

      let startBearing: number | undefined;
      let startDistance: number | undefined;

      if (type === "rotate") {
        startBearing = computeAngle(centroid, [startLatLng.lng, startLatLng.lat]);
      }

      if (type === "scale") {
        startDistance = computeDistance(centroid, [startLatLng.lng, startLatLng.lat]);
      }

      transformActionRef.current = {
        type,
        objectId,
        objectType,
        startLatLng,
        pivotPoint: centroid,
        originalFeature,
        handlePosition,
        startBearing,
        startDistance,
        originalBbox: bbox,
      };

      pushToHistory(`Début ${type}`);
    },
    [pushToHistory]
  );

  const applyTransform = useCallback(
    (currentLatLng: L.LatLng, shiftKey?: boolean) => {
      const action = transformActionRef.current;
      if (action.type === "none" || !action.originalFeature || !action.pivotPoint) return;

      let newFeature: Feature<Polygon | MultiPolygon> | null = null;

      switch (action.type) {
        case "move":
          if (action.startLatLng) {
            newFeature = translateFeature(
              action.originalFeature,
              action.startLatLng,
              currentLatLng,
              snapSettings,
              envelopeFeature
            );
          }
          break;
        case "rotate":
          if (action.startBearing !== undefined) {
            const currentAngle = computeAngle(action.pivotPoint, [currentLatLng.lng, currentLatLng.lat]);
            const deltaAngle = currentAngle - action.startBearing;
            
            // Show actual angle (snapped or free depending on Shift key)
            let displayAngle = deltaAngle;
            if (snapSettings.enabled && snapSettings.angleSnap && !shiftKey) {
              displayAngle = Math.round(deltaAngle / 5) * 5;
            }
            setCurrentRotationAngle(Math.round(displayAngle));
            setIsRotationFreeMode(!!shiftKey);
            
            newFeature = rotateFeature(
              action.originalFeature,
              action.pivotPoint,
              deltaAngle,
              snapSettings,
              shiftKey // Pass shiftKey for free rotation
            );
          }
          break;
        case "scale":
          if (action.startDistance !== undefined && action.startDistance > 0) {
            const currentDistance = computeDistance(action.pivotPoint, [currentLatLng.lng, currentLatLng.lat]);
            const scaleFactor = currentDistance / action.startDistance;
            if (scaleFactor > 0.2 && scaleFactor < 5) {
              newFeature = scaleFeature(action.originalFeature, action.pivotPoint, scaleFactor);
            }
          }
          break;
        case "stretch":
          if (action.handlePosition && action.originalBbox) {
            newFeature = stretchFeature(
              action.originalFeature,
              action.handlePosition,
              action.originalBbox,
              currentLatLng,
              snapSettings
            );
          }
          break;
      }

      if (!newFeature) return;
      if (!isWithinEnvelope(newFeature)) return;

      updateObjectGeometry(action.objectId, action.objectType, newFeature);
      onError(null);

      if (snapSettings.enabled && envelopeFeature) {
        const proj = createLocalProjection(newFeature);
        const allObjects = [...drawnBuildings, ...drawnParkings].filter((o) => o.id !== action.objectId);
        const centroid = turf.centroid(newFeature as turf.AllGeoJSON).geometry.coordinates as Position;
        const guides = computeSnapGuides(centroid, allObjects, snapSettings, proj);
        setSnapGuides(guides);
      }
    },
    [snapSettings, envelopeFeature, isWithinEnvelope, updateObjectGeometry, onError, drawnBuildings, drawnParkings]
  );

  const endTransform = useCallback(() => {
    transformActionRef.current = {
      type: "none",
      objectId: "",
      objectType: "building",
      startLatLng: null,
      pivotPoint: null,
      originalFeature: null,
    };
    setSnapGuides([]);
    setCurrentRotationAngle(null);
    setIsRotationFreeMode(false);
  }, []);

  return {
    editMode,
    setEditMode,
    currentDrawType,
    setCurrentDrawType,
    drawnBuildings,
    drawnParkings,
    activeObjectId,
    setActiveObjectId,
    handleObjectCreated,
    createFromTemplate,
    deleteObject,
    clearAll,
    transformActionRef,
    startTransform,
    applyTransform,
    endTransform,
    getActiveObject,
    updateObjectGeometry,
    isWithinEnvelope,
    canUndo,
    canRedo,
    undo,
    redo,
    historyIndex,
    historyLength: history.length,
    snapSettings,
    setSnapSettings,
    snapGuides,
    showDimensions,
    setShowDimensions,
    currentRotationAngle,
    isRotationFreeMode,
  };
}

// =============================================================================
// SNAP GUIDES COMPONENT
// =============================================================================

function SnapGuidesLayer({ guides }: { guides: SnapGuide[] }): React.ReactElement {
  const guideStyles: Record<SnapGuide["type"], L.PathOptions> = {
    horizontal: { color: "#06b6d4", weight: 1, dashArray: "4,4", opacity: 0.8 },
    vertical: { color: "#06b6d4", weight: 1, dashArray: "4,4", opacity: 0.8 },
    angle: { color: "#f59e0b", weight: 1, dashArray: "2,2", opacity: 0.8 },
    envelope: { color: "#10b981", weight: 2, dashArray: "6,3", opacity: 0.9 },
  };

  return (
    <>
      {guides.map((guide, idx) => (
        <Polyline
          key={`guide-${idx}`}
          positions={[[guide.start[1], guide.start[0]], [guide.end[1], guide.end[0]]]}
          pathOptions={guideStyles[guide.type]}
        />
      ))}
    </>
  );
}

// =============================================================================
// HANDLE ICONS
// =============================================================================

const createSquareHandleIcon = (size: number = 10, color: string = "#0ea5e9") =>
  L.divIcon({
    className: "custom-handle",
    html: `<div style="
      width: ${size}px;
      height: ${size}px;
      background: white;
      border: 2px solid ${color};
      border-radius: 2px;
      cursor: pointer;
      box-shadow: 0 1px 3px rgba(0,0,0,0.3);
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });

const createRotationHandleIcon = () =>
  L.divIcon({
    className: "rotation-handle",
    html: `<div style="
      width: 20px;
      height: 20px;
      background: white;
      border: 2px solid #f97316;
      border-radius: 50%;
      cursor: grab;
      box-shadow: 0 2px 4px rgba(0,0,0,0.3);
      display: flex;
      align-items: center;
      justify-content: center;
    ">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2.5">
        <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
        <polyline points="21 3 21 9 15 9"/>
      </svg>
    </div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });

// =============================================================================
// DRAW ENGINE LAYERS
// =============================================================================

interface DrawEngineLayersProps {
  drawEngine: DrawEngineState;
  envelopeFeature?: Feature<Polygon | MultiPolygon> | null;
  onCreated: (feature: Feature<Polygon | MultiPolygon>) => void;
}

export function DrawEngineLayers({
  drawEngine,
  envelopeFeature,
  onCreated,
}: DrawEngineLayersProps): React.ReactElement | null {
  const map = useMap();
  const mapInteractionsDisabledRef = useRef(false);

  const {
    editMode,
    drawnBuildings,
    drawnParkings,
    activeObjectId,
    setActiveObjectId,
    transformActionRef,
    startTransform,
    applyTransform,
    endTransform,
    getActiveObject,
    snapGuides,
    showDimensions,
    currentRotationAngle,
    isRotationFreeMode,
  } = drawEngine;

  const disableMapInteractions = useCallback(() => {
    if (mapInteractionsDisabledRef.current) return;
    map.dragging.disable();
    map.doubleClickZoom.disable();
    map.scrollWheelZoom.disable();
    mapInteractionsDisabledRef.current = true;
  }, [map]);

  const enableMapInteractions = useCallback(() => {
    if (!mapInteractionsDisabledRef.current) return;
    map.dragging.enable();
    map.doubleClickZoom.enable();
    map.scrollWheelZoom.enable();
    mapInteractionsDisabledRef.current = false;
  }, [map]);

  useMapEvents({
    mousemove: (e) => {
      if (!editMode) return;
      if (transformActionRef.current.type !== "none") {
        const shiftKey = e.originalEvent?.shiftKey ?? false;
        applyTransform(e.latlng, shiftKey);
      }
    },
    mouseup: () => {
      if (!editMode) return;
      if (transformActionRef.current.type !== "none") {
        endTransform();
        enableMapInteractions();
      }
    },
  });

  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (transformActionRef.current.type !== "none") {
        endTransform();
        enableMapInteractions();
      }
    };
    window.addEventListener("mouseup", handleGlobalMouseUp);
    return () => window.removeEventListener("mouseup", handleGlobalMouseUp);
  }, [endTransform, enableMapInteractions, transformActionRef]);

  // Geoman
  useEffect(() => {
    if (!map) return;

    const handleCreate = (e: L.LeafletEvent & { layer?: L.Layer }) => {
      const layer = e.layer;
      if (!layer) return;
      try {
        const geojson = (layer as L.Polygon).toGeoJSON();
        const normalized = normalizeToFeature(geojson);
        if (normalized) onCreated(normalized);
        map.removeLayer(layer);
      } catch (err) {
        console.warn("[GeomanDrawControls] Error:", err);
        try { map.removeLayer(layer); } catch { /* ignore */ }
      }
    };

    if (editMode) {
      map.pm.addControls({
        position: "topleft",
        drawMarker: false,
        drawCircle: false,
        drawCircleMarker: false,
        drawPolyline: false,
        drawRectangle: true,
        drawPolygon: true,
        drawText: false,
        editMode: false,
        dragMode: false,
        cutPolygon: false,
        removalMode: false,
        rotateMode: false,
      });

      map.pm.setGlobalOptions({
        snappable: true,
        snapDistance: 10,
        allowSelfIntersection: false,
        finishOn: "dblclick",
        templineStyle: { color: "#0ea5e9", weight: 2, dashArray: "5,5" },
        hintlineStyle: { color: "#0ea5e9", weight: 2, dashArray: "5,5" },
        pathOptions: { color: "#0ea5e9", fillColor: "#bae6fd", fillOpacity: 0.4, weight: 2 },
      });

      map.on("pm:create", handleCreate);
    } else {
      map.pm.removeControls();
      map.pm.disableDraw();
    }

    return () => {
      map.off("pm:create", handleCreate);
      map.pm.removeControls();
      map.pm.disableDraw();
    };
  }, [map, editMode, onCreated]);

  const getObjectStyle = (obj: DrawnObject, isActive: boolean): L.PathOptions => {
    const baseColor = obj.type === "building" ? "#22c55e" : "#a855f7";
    const baseFill = obj.type === "building" ? "#bbf7d0" : "#e9d5ff";

    if (isActive && editMode) {
      return { weight: 3, color: "#0ea5e9", fillColor: "#bae6fd", fillOpacity: 0.5 };
    }

    return { weight: 2, color: baseColor, fillColor: baseFill, fillOpacity: 0.35 };
  };

  const createEventHandlers = (obj: DrawnObject) => ({
    click: (e: L.LeafletMouseEvent) => {
      if (e.originalEvent) {
        e.originalEvent.stopPropagation();
        e.originalEvent.preventDefault();
      }
      L.DomEvent.stop(e);
      setActiveObjectId(obj.id);
    },
    mousedown: (e: L.LeafletMouseEvent) => {
      if (editMode && obj.id === activeObjectId) {
        if (e.originalEvent) {
          e.originalEvent.stopPropagation();
          e.originalEvent.preventDefault();
        }
        L.DomEvent.stop(e);
        disableMapInteractions();
        startTransform("move", obj.id, obj.type, e.latlng, obj.feature);
      }
    },
  });

  const handleStretchMouseDown = (e: L.LeafletMouseEvent, position: HandlePosition) => {
    const activeObj = getActiveObject();
    if (!activeObj || !editMode) return;

    if (e.originalEvent) {
      e.originalEvent.stopPropagation();
      e.originalEvent.preventDefault();
    }
    L.DomEvent.stop(e);
    disableMapInteractions();
    startTransform("stretch", activeObj.id, activeObj.type, e.latlng, activeObj.feature, position);
  };

  const handleRotateMouseDown = (e: L.LeafletMouseEvent) => {
    const activeObj = getActiveObject();
    if (!activeObj || !editMode) return;

    if (e.originalEvent) {
      e.originalEvent.stopPropagation();
      e.originalEvent.preventDefault();
    }
    L.DomEvent.stop(e);
    disableMapInteractions();
    startTransform("rotate", activeObj.id, activeObj.type, e.latlng, activeObj.feature, "rotate");
  };

  const activeObject = getActiveObject();
  const handles = activeObject ? computePowerPointHandles(activeObject.feature) : null;

  // Compute dimensions from CURRENT feature (not cached)
  const activeDimensions = useMemo(() => {
    if (!activeObject || !showDimensions) return null;
    return computeEdgeDimensions(activeObject.feature);
  }, [activeObject?.id, activeObject?.version, showDimensions]);

  const activeArea = useMemo(() => {
    if (!activeObject) return 0;
    return turf.area(activeObject.feature as turf.AllGeoJSON);
  }, [activeObject?.id, activeObject?.version]);

  const activeCentroid = useMemo(() => {
    if (!activeObject) return null;
    return turf.centroid(activeObject.feature as turf.AllGeoJSON).geometry.coordinates as Position;
  }, [activeObject?.id, activeObject?.version]);

  const distanceToEnvelope = useMemo(() => {
    if (!activeObject || !envelopeFeature) return null;
    return computeDistanceToEnvelope(activeObject.feature, envelopeFeature);
  }, [activeObject?.id, activeObject?.version, envelopeFeature]);

  const squareHandleIcon = useMemo(() => createSquareHandleIcon(10, "#0ea5e9"), []);
  const rotationHandleIcon = useMemo(() => createRotationHandleIcon(), []);

  const handlePositions: HandlePosition[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

  // KEY INCLUDES VERSION TO FORCE RE-RENDER
  const getObjectKey = (obj: DrawnObject) => `${obj.id}-v${obj.version}`;

  return (
    <>
      <SnapGuidesLayer guides={snapGuides} />

      {/* Buildings - key includes version */}
      {drawnBuildings.map((obj) => (
        <GeoJSON
          key={`building-${getObjectKey(obj)}`}
          data={obj.feature}
          style={() => getObjectStyle(obj, obj.id === activeObjectId)}
          eventHandlers={createEventHandlers(obj)}
        />
      ))}

      {/* Parkings - key includes version */}
      {drawnParkings.map((obj) => (
        <GeoJSON
          key={`parking-${getObjectKey(obj)}`}
          data={obj.feature}
          style={() => getObjectStyle(obj, obj.id === activeObjectId)}
          eventHandlers={createEventHandlers(obj)}
        />
      ))}

      {/* Dimensions - key includes version */}
      {editMode && activeObject && showDimensions && activeDimensions && (
        <>
          {activeDimensions.map((dim, idx) => (
            <Marker
              key={`dim-${activeObject.id}-v${activeObject.version}-${idx}`}
              position={[dim.midpoint[1], dim.midpoint[0]]}
              icon={L.divIcon({
                className: "dimension-label",
                html: `<div style="
                  background: rgba(255,255,255,0.95);
                  padding: 2px 6px;
                  border-radius: 4px;
                  font-size: 11px;
                  font-weight: 600;
                  color: ${activeObject.type === "building" ? "#22c55e" : "#a855f7"};
                  border: 1px solid ${activeObject.type === "building" ? "#22c55e" : "#a855f7"};
                  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
                  white-space: nowrap;
                  transform: translate(-50%, -50%);
                  pointer-events: none;
                ">${formatDistance(dim.length)}</div>`,
                iconSize: [0, 0],
                iconAnchor: [0, 0],
              })}
              interactive={false}
            />
          ))}

          {activeCentroid && (
            <Marker
              key={`area-${activeObject.id}-v${activeObject.version}`}
              position={[activeCentroid[1], activeCentroid[0]]}
              icon={L.divIcon({
                className: "area-label",
                html: `<div style="
                  background: ${activeObject.type === "building" ? "#22c55e" : "#a855f7"};
                  padding: 4px 8px;
                  border-radius: 6px;
                  font-size: 12px;
                  font-weight: 700;
                  color: #fff;
                  box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                  white-space: nowrap;
                  transform: translate(-50%, -50%);
                  pointer-events: none;
                ">${formatArea(activeArea)}</div>`,
                iconSize: [0, 0],
                iconAnchor: [0, 0],
              })}
              interactive={false}
            />
          )}
        </>
      )}

      {/* Distance to envelope */}
      {editMode && activeObject && distanceToEnvelope?.points && distanceToEnvelope.min < 50 && (
        <>
          <Polyline
            key={`envelope-line-${activeObject.id}-v${activeObject.version}`}
            positions={[
              [distanceToEnvelope.points[0][1], distanceToEnvelope.points[0][0]],
              [distanceToEnvelope.points[1][1], distanceToEnvelope.points[1][0]],
            ]}
            pathOptions={{ color: "#ef4444", weight: 1.5, dashArray: "3,3" }}
          />
          <Marker
            key={`envelope-label-${activeObject.id}-v${activeObject.version}`}
            position={[
              (distanceToEnvelope.points[0][1] + distanceToEnvelope.points[1][1]) / 2,
              (distanceToEnvelope.points[0][0] + distanceToEnvelope.points[1][0]) / 2,
            ]}
            icon={L.divIcon({
              className: "distance-label",
              html: `<div style="
                background: #ef4444;
                color: #fff;
                padding: 2px 6px;
                border-radius: 4px;
                font-size: 10px;
                font-weight: 600;
                transform: translate(-50%, -50%);
                pointer-events: none;
              ">${formatDistance(distanceToEnvelope.min)}</div>`,
              iconSize: [0, 0],
              iconAnchor: [0, 0],
            })}
            interactive={false}
          />
        </>
      )}

      {/* Transform handles */}
      {editMode && activeObject && handles && (
        <>
          <Polyline
            key={`rotation-stem-${activeObject.id}-v${activeObject.version}`}
            positions={[
              [handles.rotationLineStart[1], handles.rotationLineStart[0]],
              [handles.rotate[1], handles.rotate[0]],
            ]}
            pathOptions={{ color: "#f97316", weight: 2, dashArray: "4,4" }}
          />

          {handlePositions.map((pos) => (
            <Marker
              key={`handle-${pos}-${activeObject.id}-v${activeObject.version}`}
              position={[handles[pos][1], handles[pos][0]]}
              icon={squareHandleIcon}
              eventHandlers={{ mousedown: (e) => handleStretchMouseDown(e, pos) }}
            />
          ))}

          <Marker
            key={`rotation-handle-${activeObject.id}-v${activeObject.version}`}
            position={[handles.rotate[1], handles.rotate[0]]}
            icon={rotationHandleIcon}
            eventHandlers={{ mousedown: handleRotateMouseDown }}
          />

          {currentRotationAngle !== null && (
            <Marker
              key={`rotation-indicator-${activeObject.id}`}
              position={[handles.rotate[1], handles.rotate[0]]}
              icon={L.divIcon({
                className: "rotation-indicator",
                html: `<div style="
                  background: ${isRotationFreeMode ? '#10b981' : '#f97316'};
                  color: #fff;
                  padding: 2px 6px;
                  border-radius: 4px;
                  font-size: 11px;
                  font-weight: 600;
                  transform: translate(15px, -50%);
                  white-space: nowrap;
                  pointer-events: none;
                ">${currentRotationAngle}°${isRotationFreeMode ? ' FREE' : ''}</div>`,
                iconSize: [0, 0],
                iconAnchor: [0, 0],
              })}
              interactive={false}
            />
          )}
        </>
      )}
    </>
  );
}

// =============================================================================
// TOOLBAR
// =============================================================================

interface DrawToolbarProps {
  drawEngine: DrawEngineState;
}

export function DrawToolbar({ drawEngine }: DrawToolbarProps): React.ReactElement {
  const {
    canUndo, canRedo, undo, redo, historyIndex, historyLength,
    snapSettings, setSnapSettings, showDimensions, setShowDimensions,
  } = drawEngine;

  return (
    <div style={{
      display: "flex", gap: "8px", alignItems: "center",
      padding: "8px 12px", background: "rgba(255,255,255,0.95)",
      borderRadius: "8px", boxShadow: "0 2px 8px rgba(0,0,0,0.15)", fontSize: "13px",
    }}>
      <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
        <button onClick={undo} disabled={!canUndo} title="Annuler (Ctrl+Z)" style={{
          padding: "6px 10px", border: "1px solid #d1d5db", borderRadius: "6px",
          background: canUndo ? "#fff" : "#f3f4f6",
          cursor: canUndo ? "pointer" : "not-allowed", opacity: canUndo ? 1 : 0.5, fontWeight: 500,
        }}>↶</button>
        <button onClick={redo} disabled={!canRedo} title="Rétablir (Ctrl+Y)" style={{
          padding: "6px 10px", border: "1px solid #d1d5db", borderRadius: "6px",
          background: canRedo ? "#fff" : "#f3f4f6",
          cursor: canRedo ? "pointer" : "not-allowed", opacity: canRedo ? 1 : 0.5, fontWeight: 500,
        }}>↷</button>
        <span style={{ color: "#6b7280", fontSize: "11px", marginLeft: "4px" }}>
          {historyIndex + 1}/{historyLength || 1}
        </span>
      </div>

      <div style={{ width: "1px", height: "24px", background: "#e5e7eb" }} />

      <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
        <input type="checkbox" checked={snapSettings.enabled}
          onChange={(e) => setSnapSettings((s) => ({ ...s, enabled: e.target.checked }))}
          style={{ width: "16px", height: "16px" }} />
        <span>Snap</span>
      </label>

      {snapSettings.enabled && (
        <select value={snapSettings.gridSize}
          onChange={(e) => setSnapSettings((s) => ({ ...s, gridSize: parseFloat(e.target.value) }))}
          style={{ padding: "4px 8px", border: "1px solid #d1d5db", borderRadius: "4px", fontSize: "12px" }}>
          <option value={0.25}>0.25m</option>
          <option value={0.5}>0.5m</option>
          <option value={1}>1m</option>
          <option value={2}>2m</option>
          <option value={5}>5m</option>
        </select>
      )}

      <div style={{ width: "1px", height: "24px", background: "#e5e7eb" }} />

      <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
        <input type="checkbox" checked={showDimensions}
          onChange={(e) => setShowDimensions(e.target.checked)}
          style={{ width: "16px", height: "16px" }} />
        <span>Cotations</span>
      </label>
    </div>
  );
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
  computeEdgeDimensions,
  computeDistanceToEnvelope,
  computePowerPointHandles,
  formatDistance,
  formatArea,
  createTemplateShape,
  snapToGrid,
};