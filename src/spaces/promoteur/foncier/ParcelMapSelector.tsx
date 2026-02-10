// FIX: parcels not visible — added GeoJSON normalization (EPSG handling) + diagnostics
// Detects Lambert 93 (EPSG:2154) coords and reprojects to WGS84 (EPSG:4326).
// Detects lat/lon swap and corrects it. Logs diagnostics once per fetch.

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { MapContainer, TileLayer, useMapEvents, useMap } from "react-leaflet";
import type { FeatureCollection, Feature, Position } from "geojson";
import L from "leaflet";
import { supabase } from "../../../supabaseClient";
import turfArea from "@turf/area";
import proj4 from "proj4";

import "leaflet/dist/leaflet.css";

// ─────────────────────────────────────────────────────────────────────────────
// proj4 definitions — Lambert 93 (EPSG:2154)
// ─────────────────────────────────────────────────────────────────────────────

proj4.defs(
  "EPSG:2154",
  "+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs",
);

const lambert93ToWgs84 = proj4("EPSG:2154", "EPSG:4326");

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type BBox = { minLon: number; minLat: number; maxLon: number; maxLat: number };

type SelectedParcelData = {
  id: string;
  feature?: any;
  area_m2?: number | null;
};

type Props = {
  communeInsee: string;
  selectedIds: string[];
  selectedParcels?: SelectedParcelData[];
  onToggleParcel: (parcelId: string, feature: any, area_m2: number | null) => void;
  initialCenter?: { lat: number; lon: number } | null;
  initialZoom?: number;
  heightPx?: number;
  focusParcelId?: string | null;
  onAutoEnrichSelected?: (updates: { id: string; area_m2: number | null }[]) => void;
};

type CadastreBboxResponse = {
  success: boolean;
  version?: string;
  commune_insee?: string;
  bbox?: BBox;
  featureCollection?: FeatureCollection;
  features?: Feature[];
  count?: number;
  error?: string;
  message?: string;
};

type FetchSource = "fast" | "cache";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MIN_FETCH_ZOOM = 15;
const PHASE2_MAX_COUNT = 300;
const PHASE2_EXPAND_RATIO = 0.2;
const FAST_PATH_TIMEOUT_MS = 4000;

/** ✅ Rayon strict autour de la parcelle cible en focus mode */
const TARGET_RADIUS_M = 500;

const STYLE_DEFAULT: L.PathOptions = {
  color: "#2563eb",
  opacity: 0.9,
  weight: 2,
  fillColor: "#60a5fa",
  fillOpacity: 0.18,
};

const STYLE_SELECTED: L.PathOptions = {
  color: "#16a34a",
  opacity: 1,
  weight: 3,
  fillColor: "#22c55e",
  fillOpacity: 0.35,
};

const STYLE_HOVER_DEFAULT: L.PathOptions = {
  color: "#2563eb",
  opacity: 1,
  weight: 3,
  fillColor: "#60a5fa",
  fillOpacity: 0.28,
};

const STYLE_HOVER_SELECTED: L.PathOptions = {
  color: "#16a34a",
  opacity: 1,
  weight: 4,
  fillColor: "#22c55e",
  fillOpacity: 0.45,
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — generic
// ─────────────────────────────────────────────────────────────────────────────

const canvasRenderer = L.canvas({ padding: 0.5 });

function getParcelIdFromFeature(f: any): string | null {
  const p = f?.properties ?? {};
  const pid = p.parcel_id ?? p.idu ?? p.id ?? p.IDU ?? p.ID ?? null;
  if (pid && typeof pid === "string") return pid;

  const section = p.section || p.SECTION;
  const numero = p.numero || p.NUMERO;
  const code_insee = p.code_insee || p.CODE_INSEE;
  if (code_insee && section && numero) {
    return `${String(code_insee)}-${String(section)}-${String(numero)}`;
  }
  return null;
}

function getAreaFromFeature(feature: any): number | null {
  const p = feature?.properties ?? {};
  const contenance = p.contenance ?? p.CONTENANCE ?? p.surface ?? p.area_m2 ?? null;
  if (contenance != null && typeof contenance === "number" && contenance > 0) {
    return Math.round(contenance);
  }
  if (!feature?.geometry) return null;
  try {
    return Math.round(turfArea(feature));
  } catch {
    return null;
  }
}

function makeBboxKey(b: BBox): string {
  const r = (x: number) => Math.round(x * 1e4) / 1e4;
  return `${r(b.minLon)},${r(b.minLat)},${r(b.maxLon)},${r(b.maxLat)}`;
}

function boundsToBBox(bounds: L.LatLngBounds): BBox {
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  return { minLon: sw.lng, minLat: sw.lat, maxLon: ne.lng, maxLat: ne.lat };
}

function expandBbox(bbox: BBox, ratio: number): BBox {
  const dLon = (bbox.maxLon - bbox.minLon) * ratio;
  const dLat = (bbox.maxLat - bbox.minLat) * ratio;
  return {
    minLon: bbox.minLon - dLon,
    minLat: bbox.minLat - dLat,
    maxLon: bbox.maxLon + dLon,
    maxLat: bbox.maxLat + dLat,
  };
}

function debounce<T extends (...args: any[]) => void>(fn: T, ms: number) {
  let t: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function buildFeatureIndex(fc: FeatureCollection): Map<string, Feature> {
  const m = new Map<string, Feature>();
  for (const f of fc.features) {
    const pid = getParcelIdFromFeature(f);
    if (pid) m.set(pid, f);
  }
  return m;
}

function mergeFeatureCollections(existing: FeatureCollection, incoming: FeatureCollection): FeatureCollection {
  const byId = new Map<string, Feature>();
  for (const f of existing.features) {
    const pid = getParcelIdFromFeature(f);
    byId.set(pid ?? `_anon_${byId.size}`, f);
  }
  for (const f of incoming.features) {
    const pid = getParcelIdFromFeature(f);
    byId.set(pid ?? `_anon_${byId.size}`, f);
  }
  return { type: "FeatureCollection", features: Array.from(byId.values()) };
}

function extractFcFromPayload(payload: CadastreBboxResponse): FeatureCollection | null {
  const fc =
    payload.featureCollection ??
    (payload.features ? ({ type: "FeatureCollection", features: payload.features } as FeatureCollection) : null);
  if (!fc || fc.type !== "FeatureCollection") return null;
  return fc;
}

// ─────────────────────────────────────────────────────────────────────────────
// ✅ GeoJSON normalization — detect CRS + fix coords
// ─────────────────────────────────────────────────────────────────────────────

type CoordSystem = "wgs84" | "lambert93" | "latlon-swapped" | "unknown";

/**
 * Extract the first few coordinate points from a FeatureCollection for inspection.
 * Returns up to `max` [x,y] pairs from the first features that have geometry.
 */
function sampleCoords(fc: FeatureCollection, max = 3): Position[] {
  const samples: Position[] = [];
  for (const f of fc.features) {
    if (samples.length >= max) break;
    const g = f?.geometry as any;
    if (!g?.coordinates) continue;

    try {
      if (g.type === "Polygon" && g.coordinates[0]?.[0]) {
        samples.push(g.coordinates[0][0]);
      } else if (g.type === "MultiPolygon" && g.coordinates[0]?.[0]?.[0]) {
        samples.push(g.coordinates[0][0][0]);
      }
    } catch {
      // skip malformed
    }
  }
  return samples;
}

/**
 * Detect coordinate system from sample points.
 * - Lambert 93: x ~ 100_000 – 1_300_000, y ~ 6_000_000 – 7_200_000
 * - WGS84 [lon,lat]: lon ~ -180..180, lat ~ -90..90 (France: lon ~ -5..10, lat ~ 41..52)
 * - Swapped [lat,lon]: lat in first position (41..52), lon in second (-5..10)
 */
function detectCoordSystem(samples: Position[]): CoordSystem {
  if (samples.length === 0) return "unknown";

  // Check all samples for consensus
  let lambert = 0;
  let wgs84 = 0;
  let swapped = 0;

  for (const [x, y] of samples) {
    const absX = Math.abs(x);
    const absY = Math.abs(y);

    // Lambert 93: large metric values
    if (absX > 100_000 && absY > 1_000_000) {
      lambert++;
      continue;
    }

    // Generous bounds for any projected CRS with large values
    if (absX > 1000 || absY > 1000) {
      lambert++; // likely some projected CRS, treat like Lambert93 for French data
      continue;
    }

    // WGS84 range check
    if (absX <= 180 && absY <= 90) {
      // Could be correct [lon,lat] or swapped [lat,lon]
      // For France: lon ∈ [-5.5, 10], lat ∈ [41, 51.5]
      // In GeoJSON, coordinates are [lon, lat]
      // If x (first) looks like lat (41-52) and y (second) looks like lon (-6..10):
      if (x >= 35 && x <= 60 && y >= -10 && y <= 20) {
        swapped++;
      } else {
        wgs84++;
      }
      continue;
    }

    // y > 90 but < 1000 → might still be swapped or borderline
    if (absX <= 180 && absY > 90 && absY < 1000) {
      // Unusual — flag as unknown
      lambert++;
      continue;
    }
  }

  if (lambert > 0 && lambert >= wgs84 && lambert >= swapped) return "lambert93";
  if (swapped > 0 && swapped > wgs84) return "latlon-swapped";
  if (wgs84 > 0) return "wgs84";
  return "unknown";
}

/** Transform a single coordinate pair based on detected system */
function transformCoord(coord: Position, system: CoordSystem): Position {
  if (system === "lambert93") {
    const [easting, northing] = coord;
    const [lon, lat] = lambert93ToWgs84.forward([easting, northing]);
    // Preserve any additional values (e.g. altitude)
    return coord.length > 2 ? [lon, lat, ...coord.slice(2)] : [lon, lat];
  }
  if (system === "latlon-swapped") {
    // coord is [lat, lon] — swap to [lon, lat]
    return coord.length > 2 ? [coord[1], coord[0], ...coord.slice(2)] : [coord[1], coord[0]];
  }
  return coord;
}

/** Recursively transform all coordinates in a nested array structure */
function transformCoords(coords: any, system: CoordSystem): any {
  if (!Array.isArray(coords)) return coords;
  // If it's a coordinate pair: [number, number, ...]
  if (typeof coords[0] === "number") {
    return transformCoord(coords as Position, system);
  }
  // Otherwise it's a nested array (ring, polygon, multi-polygon)
  return coords.map((c: any) => transformCoords(c, system));
}

/** Transform a single Feature's geometry coordinates */
function transformFeature(feature: Feature, system: CoordSystem): Feature {
  if (system === "wgs84" || system === "unknown") return feature;
  const geom = feature.geometry as any;
  if (!geom?.coordinates) return feature;

  return {
    ...feature,
    geometry: {
      ...geom,
      coordinates: transformCoords(geom.coordinates, system),
    },
  };
}

/**
 * Main normalization entry point.
 * Inspects a FeatureCollection, detects CRS, and reprojects if needed.
 * Logs diagnostics once per call.
 */
function normalizeFeatureCollection(fc: FeatureCollection, label: string = ""): FeatureCollection {
  if (!fc || fc.features.length === 0) return fc;

  const samples = sampleCoords(fc, 3);
  const detected = detectCoordSystem(samples);

  // Diagnostic log (compact, once per normalization)
  const tag = label ? `[Normalize:${label}]` : "[Normalize]";
  console.log(
    `${tag} features=${fc.features.length} samples=${JSON.stringify(samples.map((s) => [+s[0].toFixed(2), +s[1].toFixed(2)]))} detected=${detected}`,
  );

  if (detected === "wgs84" || detected === "unknown") {
    if (detected === "unknown" && samples.length > 0) {
      console.warn(`${tag} ⚠ Could not determine CRS — coords passed through as-is`);
    }
    // Validate that at least one feature produces a valid Leaflet bounds
    try {
      const testFeature = fc.features[0];
      if (testFeature?.geometry) {
        const testLayer = L.geoJSON(testFeature as any);
        const bounds = testLayer.getBounds();
        if (bounds.isValid()) {
          const sw = bounds.getSouthWest();
          const ne = bounds.getNorthEast();
          console.log(
            `${tag} ✓ bounds valid: SW(${sw.lat.toFixed(4)},${sw.lng.toFixed(4)}) NE(${ne.lat.toFixed(4)},${ne.lng.toFixed(4)})`,
          );
        } else {
          console.warn(`${tag} ⚠ First feature produces invalid Leaflet bounds — geometry may be malformed`);
        }
      }
    } catch (e: any) {
      console.warn(`${tag} ⚠ Bounds validation error: ${e?.message}`);
    }
    return fc;
  }

  // Transform all features
  console.log(`${tag} 🔄 Reprojecting ${fc.features.length} features from ${detected} → WGS84`);
  const t0 = performance.now();

  const transformed: Feature[] = [];
  let errors = 0;

  for (const f of fc.features) {
    try {
      transformed.push(transformFeature(f, detected));
    } catch (e: any) {
      errors++;
      if (errors <= 2) {
        console.warn(`${tag} Transform error on feature:`, e?.message);
      }
      // Keep original feature as fallback
      transformed.push(f);
    }
  }

  const elapsed = Math.round(performance.now() - t0);

  // Log post-transform sample
  const resultFc: FeatureCollection = { type: "FeatureCollection", features: transformed };
  const postSamples = sampleCoords(resultFc, 2);
  console.log(
    `${tag} ✓ Done in ${elapsed}ms errors=${errors} post-samples=${JSON.stringify(postSamples.map((s) => [+s[0].toFixed(5), +s[1].toFixed(5)]))}`,
  );

  return resultFc;
}

/**
 * Normalize a single Feature (used for individual parcel lookups in focus mode).
 */
function normalizeFeature(feature: Feature, label: string = ""): Feature {
  const fc = normalizeFeatureCollection(
    { type: "FeatureCollection", features: [feature] },
    label,
  );
  return fc.features[0] ?? feature;
}

// ─────────────────────────────────────────────────────────────────────────────
// ✅ Helpers — Focus mode (radius-based)
// ─────────────────────────────────────────────────────────────────────────────

function bboxAroundPointMeters(lat: number, lon: number, radiusM: number): BBox {
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  return {
    minLat: lat - dLat,
    maxLat: lat + dLat,
    minLon: lon - dLon,
    maxLon: lon + dLon,
  };
}

// ✅ Centre ultra-rapide (pas de L.geoJSON dans une boucle)
function getFeatureCenterFastLatLng(feature: any): { lat: number; lon: number } | null {
  const g = feature?.geometry;
  if (!g) return null;

  let minLon = Infinity,
    minLat = Infinity,
    maxLon = -Infinity,
    maxLat = -Infinity;

  const scanRing = (ring: any[]) => {
    for (const c of ring) {
      if (!Array.isArray(c) || c.length < 2) continue;
      const lon = Number(c[0]);
      const lat = Number(c[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
  };

  try {
    if (g.type === "Polygon") {
      const rings = g.coordinates || [];
      for (const ring of rings) scanRing(ring);
    } else if (g.type === "MultiPolygon") {
      const polys = g.coordinates || [];
      for (const poly of polys) {
        for (const ring of poly) scanRing(ring);
      }
    } else {
      return null;
    }
  } catch {
    return null;
  }

  if (
    !Number.isFinite(minLon) ||
    !Number.isFinite(minLat) ||
    !Number.isFinite(maxLon) ||
    !Number.isFinite(maxLat)
  ) {
    return null;
  }

  return { lat: (minLat + maxLat) / 2, lon: (minLon + maxLon) / 2 };
}

function filterFeaturesWithinRadiusFast(fc: FeatureCollection, center: L.LatLng, radiusM: number): FeatureCollection {
  const kept: Feature[] = [];
  for (const f of fc.features) {
    const c = getFeatureCenterFastLatLng(f);
    if (!c) continue;
    const d = center.distanceTo(L.latLng(c.lat, c.lon));
    if (d <= radiusM) kept.push(f);
  }
  return { type: "FeatureCollection", features: kept };
}

/** Injecte une feature dans une FeatureCollection si elle n'y est pas déjà (par pid). */
function ensureFeatureInFc(fc: FeatureCollection, feature: Feature, pid: string): FeatureCollection {
  const exists = fc.features.some((f) => getParcelIdFromFeature(f) === pid);
  if (exists) return fc;
  return { type: "FeatureCollection", features: [feature, ...fc.features] };
}

// ─────────────────────────────────────────────────────────────────────────────
// ImperativeParcelLayer
// ─────────────────────────────────────────────────────────────────────────────

function ImperativeParcelLayer({
  fc,
  selectedIds,
  selectedParcels,
  onToggleParcel,
}: {
  fc: FeatureCollection;
  selectedIds: string[];
  selectedParcels: SelectedParcelData[];
  onToggleParcel: (pid: string, feature: any, area_m2: number | null) => void;
}) {
  const map = useMap();
  const layerGroupRef = useRef<L.GeoJSON | null>(null);
  const layerByIdRef = useRef<Map<string, L.Path>>(new Map());
  const selectedIdsRef = useRef<Set<string>>(new Set());
  const selectedOverlayRef = useRef<L.GeoJSON | null>(null);
  const onToggleRef = useRef(onToggleParcel);

  useEffect(() => {
    selectedIdsRef.current = new Set(selectedIds);
  }, [selectedIds]);
  useEffect(() => {
    onToggleRef.current = onToggleParcel;
  }, [onToggleParcel]);

  useEffect(() => {
    if (layerGroupRef.current) {
      map.removeLayer(layerGroupRef.current);
      layerGroupRef.current = null;
    }
    layerByIdRef.current.clear();

    if (fc.features.length === 0) return;

    // Diagnostic: verify first feature bounds are in map's viewport area
    try {
      const firstFeature = fc.features[0];
      const sampleCenter = getFeatureCenterFastLatLng(firstFeature);
      if (sampleCenter) {
        const mapBounds = map.getBounds();
        const isVisible = mapBounds.contains(L.latLng(sampleCenter.lat, sampleCenter.lon));
        console.log(
          `[ImperativeParcelLayer] Rendering ${fc.features.length} features. First feature center: (${sampleCenter.lat.toFixed(5)}, ${sampleCenter.lon.toFixed(5)}) visible=${isVisible} mapZoom=${map.getZoom()}`,
        );
      }
    } catch {
      // non-critical diagnostic
    }

    const layer = L.geoJSON(fc as any, {
      renderer: canvasRenderer,
      interactive: true,
      bubblingMouseEvents: false,
      style: (feature) => {
        if (!feature) return STYLE_DEFAULT;
        const pid = getParcelIdFromFeature(feature);
        return pid && selectedIdsRef.current.has(pid) ? STYLE_SELECTED : STYLE_DEFAULT;
      },
      onEachFeature: (feature, layer) => {
        const pid = getParcelIdFromFeature(feature);
        if (!pid) return;
        layerByIdRef.current.set(pid, layer as L.Path);

        layer.on("mouseover", () => {
          const sel = selectedIdsRef.current.has(pid);
          (layer as L.Path).setStyle(sel ? STYLE_HOVER_SELECTED : STYLE_HOVER_DEFAULT);
        });
        layer.on("mouseout", () => {
          const sel = selectedIdsRef.current.has(pid);
          (layer as L.Path).setStyle(sel ? STYLE_SELECTED : STYLE_DEFAULT);
        });
        layer.on("click", () => {
          const area_m2 = getAreaFromFeature(feature);
          onToggleRef.current(pid, feature, area_m2);
        });
      },
    });

    layer.addTo(map);
    layerGroupRef.current = layer;

    return () => {
      if (layerGroupRef.current) {
        map.removeLayer(layerGroupRef.current);
        layerGroupRef.current = null;
      }
      layerByIdRef.current.clear();
    };
  }, [map, fc]);

  useEffect(() => {
    const selSet = new Set(selectedIds);
    layerByIdRef.current.forEach((layer, pid) => {
      layer.setStyle(selSet.has(pid) ? STYLE_SELECTED : STYLE_DEFAULT);
    });
  }, [selectedIds]);

  useEffect(() => {
    if (selectedOverlayRef.current) {
      map.removeLayer(selectedOverlayRef.current);
      selectedOverlayRef.current = null;
    }

    const fcIds = new Set(fc.features.map((f) => getParcelIdFromFeature(f)).filter(Boolean));
    const outsideFeatures = selectedParcels.filter((p) => !fcIds.has(p.id) && p.feature?.geometry).map((p) => p.feature);

    if (outsideFeatures.length === 0) return;

    const overlay = L.geoJSON({ type: "FeatureCollection", features: outsideFeatures } as any, {
      renderer: canvasRenderer,
      style: STYLE_SELECTED,
      interactive: false,
    });
    overlay.addTo(map);
    overlay.bringToFront();
    selectedOverlayRef.current = overlay;

    return () => {
      if (selectedOverlayRef.current) {
        map.removeLayer(selectedOverlayRef.current);
        selectedOverlayRef.current = null;
      }
    };
  }, [map, fc, selectedParcels]);

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// MapInvalidateSizeHandler
// ─────────────────────────────────────────────────────────────────────────────

function MapInvalidateSizeHandler() {
  const map = useMap();

  useEffect(() => {
    if (!map) return;
    map.invalidateSize();
    const t1 = setTimeout(() => map.invalidateSize(), 100);
    const t2 = setTimeout(() => map.invalidateSize(), 300);
    const container = map.getContainer();
    let ro: ResizeObserver | null = null;
    if (container && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => map.invalidateSize());
      ro.observe(container);
    }
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      ro?.disconnect();
    };
  }, [map]);

  useEffect(() => {
    if (!map) return;
    const handler = () => {
      if (document.visibilityState === "visible") setTimeout(() => map.invalidateSize(), 100);
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [map]);

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// MapController — initial fetch + focus parcel fit
// ─────────────────────────────────────────────────────────────────────────────

function MapController({
  onViewportBbox,
  fc,
  focusParcelId,
  focusMode,
}: {
  onViewportBbox: (bbox: BBox) => void;
  fc: FeatureCollection;
  focusParcelId: string | null | undefined;
  focusMode: boolean;
}) {
  const map = useMap();
  const didInitialFetchRef = useRef(false);
  const didFitForParcelRef = useRef<string | null>(null);

  useEffect(() => {
    if (!map || didInitialFetchRef.current) return;
    if (focusMode) {
      didInitialFetchRef.current = true;
      return;
    }
    didInitialFetchRef.current = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        map.invalidateSize();
        if (map.getZoom() < MIN_FETCH_ZOOM) {
          map.setZoom(MIN_FETCH_ZOOM);
          return;
        }
        onViewportBbox(boundsToBBox(map.getBounds()));
      });
    });
  }, [map, onViewportBbox, focusMode]);

  useEffect(() => {
    if (!map || !focusParcelId || fc.features.length === 0) return;
    if (didFitForParcelRef.current === focusParcelId) return;

    const targetFeature = fc.features.find((f) => getParcelIdFromFeature(f) === focusParcelId);
    if (!targetFeature) return;

    try {
      const gj = L.geoJSON(targetFeature as any);
      const bounds = gj.getBounds();
      if (bounds.isValid()) {
        didFitForParcelRef.current = focusParcelId;
        console.log(
          `[MapController] fitBounds for focus parcel ${focusParcelId}: SW(${bounds.getSouthWest().lat.toFixed(5)},${bounds.getSouthWest().lng.toFixed(5)}) NE(${bounds.getNorthEast().lat.toFixed(5)},${bounds.getNorthEast().lng.toFixed(5)})`,
        );
        map.fitBounds(bounds, { padding: [60, 60], maxZoom: 18, animate: true });
      } else {
        console.warn(`[MapController] fitBounds INVALID for focus parcel ${focusParcelId} — bounds not valid`);
      }
    } catch (e) {
      console.warn("[ParcelMapSelector] Error fitting to focus parcel:", e);
    }
  }, [map, fc, focusParcelId]);

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// MapMoveHandler — viewport refetch (DÉSACTIVÉ en focus mode)
// ─────────────────────────────────────────────────────────────────────────────

function MapMoveHandler({
  onViewportBbox,
  onZoomTooLow,
  disabled,
}: {
  onViewportBbox: (bbox: BBox) => void;
  onZoomTooLow: (tooLow: boolean) => void;
  disabled: boolean;
}) {
  const disabledRef = useRef(disabled);
  useEffect(() => {
    disabledRef.current = disabled;
  }, [disabled]);

  const handler = useMemo(
    () =>
      debounce((map: L.Map) => {
        if (disabledRef.current) return;
        const zoom = map.getZoom();
        if (zoom < MIN_FETCH_ZOOM) {
          onZoomTooLow(true);
          return;
        }
        onZoomTooLow(false);
        onViewportBbox(boundsToBBox(map.getBounds()));
      }, 350),
    [onViewportBbox, onZoomTooLow],
  );

  useMapEvents({
    moveend(e) {
      handler(e.target as L.Map);
    },
    zoomend(e) {
      handler(e.target as L.Map);
    },
  });

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Composant principal
// ─────────────────────────────────────────────────────────────────────────────

export default function ParcelMapSelector({
  communeInsee,
  selectedIds,
  selectedParcels = [],
  onToggleParcel,
  initialCenter,
  initialZoom = 17,
  heightPx = 440,
  focusParcelId,
  onAutoEnrichSelected,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emptyWarning, setEmptyWarning] = useState<string | null>(null);
  const [zoomTooLow, setZoomTooLow] = useState(false);

  const [fc, setFc] = useState<FeatureCollection>({ type: "FeatureCollection", features: [] });

  const [backendCount, setBackendCount] = useState<number | null>(null);
  const [fetchTimeMs, setFetchTimeMs] = useState<number | null>(null);
  const [fetchSource, setFetchSource] = useState<FetchSource>("cache");

  const [focusCenter, setFocusCenter] = useState<L.LatLng | null>(null);
  const [focusRawCount, setFocusRawCount] = useState<number | null>(null);
  const focusFeatureRef = useRef<Feature | null>(null);
  const focusFetchDoneRef = useRef<string | null>(null);

  const requestIdRef = useRef(0);
  const cacheRef = useRef<Map<string, FeatureCollection>>(new Map());
  const lastKeyRef = useRef<string>("");
  const enrichedIdsRef = useRef<Set<string>>(new Set());
  const featureIndexRef = useRef<Map<string, Feature>>(new Map());
  const mapKeyRef = useRef<string>(`map-${communeInsee}-${Date.now()}`);

  const focusMode = Boolean(focusParcelId);

  const center = useMemo(() => {
    if (initialCenter?.lat != null && initialCenter?.lon != null) {
      return [initialCenter.lat, initialCenter.lon] as [number, number];
    }
    return [43.345, -1.621] as [number, number];
  }, [initialCenter]);

  useEffect(() => {
    featureIndexRef.current = buildFeatureIndex(fc);
  }, [fc]);

  // ─────────────────────────────────────────────────────────────────────────
  // Backend invocations (Supabase FAST ONLY) — ✅ with normalization
  // ─────────────────────────────────────────────────────────────────────────

  const invokeFastPath = useCallback(
    async (
      commune_insee: string,
      bbox: BBox,
      thisReqId: number,
    ): Promise<{ fc: FeatureCollection; count: number | null; source: FetchSource } | null> => {
      try {
        const result = await Promise.race([
          supabase.functions.invoke("cadastre-parcelles-bbox-v1", {
            body: { commune_insee, bbox },
          }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), FAST_PATH_TIMEOUT_MS)),
        ]);

        if (requestIdRef.current !== thisReqId) return null;
        if (!result) {
          console.log(`[ParcelMapSelector] fast-path TIMEOUT reqId=${thisReqId}`);
          return null;
        }

        const { data, error } = result as { data: any; error: any };
        if (error) {
          console.log(`[ParcelMapSelector] fast-path error reqId=${thisReqId}:`, error?.message ?? error);
          return null;
        }

        const payload = data as CadastreBboxResponse | null;
        if (!payload || payload.success !== true) return null;

        let fc = extractFcFromPayload(payload);
        if (!fc) return null;

        // ✅ FIX: Normalize coordinates (detect Lambert93 / swapped lat-lon)
        fc = normalizeFeatureCollection(fc, `fast-req${thisReqId}`);

        return { fc, count: typeof payload.count === "number" ? payload.count : null, source: "fast" };
      } catch (e: any) {
        console.log(`[ParcelMapSelector] fast-path exception reqId=${thisReqId}:`, e?.message);
        return null;
      }
    },
    [],
  );

  // ─────────────────────────────────────────────────────────────────────────
  // ✅ Résoudre la feature de la parcelle cible (focus mode) — with normalization
  // ─────────────────────────────────────────────────────────────────────────

  const resolveFocusFeature = useCallback(
    async (
      parcelId: string,
      commune_insee: string,
      currentFc: FeatureCollection,
      currentSelectedParcels: SelectedParcelData[],
    ): Promise<Feature | null> => {
      const fromSelected = currentSelectedParcels.find((p) => p.id === parcelId && p.feature?.geometry);
      if (fromSelected?.feature) {
        console.log(`[ParcelMapSelector][FOCUS] Feature from selectedParcels: ${parcelId}`);
        return normalizeFeature(fromSelected.feature as Feature, `sel:${parcelId}`);
      }

      const fromFc = currentFc.features.find((f) => getParcelIdFromFeature(f) === parcelId);
      if (fromFc) {
        console.log(`[ParcelMapSelector][FOCUS] Feature from fc: ${parcelId}`);
        // Already normalized if came through invokeFastPath
        return fromFc;
      }

      if (focusFeatureRef.current) {
        const refPid = getParcelIdFromFeature(focusFeatureRef.current);
        if (refPid === parcelId) {
          console.log(`[ParcelMapSelector][FOCUS] Feature from ref cache: ${parcelId}`);
          return focusFeatureRef.current;
        }
      }

      console.log(`[ParcelMapSelector][FOCUS] Fetching feature from backend: ${parcelId}`);
      try {
        const { data, error } = await supabase.functions.invoke("cadastre-parcelle-by-id", {
          body: { parcel_id: parcelId, commune_insee },
        });

        if (error) {
          console.warn(`[ParcelMapSelector][FOCUS] cadastre-parcelle-by-id error:`, error);
          return null;
        }

        const payload = data as any;
        const feature: Feature | null =
          payload?.feature ??
          payload?.parcel?.geojson ??
          payload?.parcel?.geometry ??
          (payload?.type === "Feature" ? payload : null) ??
          payload?.featureCollection?.features?.[0] ??
          payload?.features?.[0] ??
          null;

        if (feature?.geometry) {
          console.log(`[ParcelMapSelector][FOCUS] Feature resolved from backend: ${parcelId}`);
          // ✅ FIX: Normalize individual feature from backend
          return normalizeFeature(feature, `focus-by-id:${parcelId}`);
        }

        console.warn(`[ParcelMapSelector][FOCUS] No geometry in backend response for ${parcelId}`);
        return null;
      } catch (e: any) {
        console.warn(`[ParcelMapSelector][FOCUS] Exception resolving feature:`, e?.message);
        return null;
      }
    },
    [],
  );

  // ─────────────────────────────────────────────────────────────────────────
  // ✅ FOCUS MODE: Supabase only + rayon strict 500m (filtrage FAST)
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!focusMode || !focusParcelId || !communeInsee) return;
    if (focusFetchDoneRef.current === focusParcelId) return;

    let cancelled = false;
    const thisReqId = ++requestIdRef.current;

    (async () => {
      setLoading(true);
      setError(null);
      setEmptyWarning(null);
      setFocusRawCount(null);

      const t0 = performance.now();

      try {
        const focusFeature = await resolveFocusFeature(focusParcelId, communeInsee, fc, selectedParcels);
        if (cancelled || requestIdRef.current !== thisReqId) return;

        if (!focusFeature) {
          if (initialCenter?.lat != null && initialCenter?.lon != null) {
            console.log(`[ParcelMapSelector][FOCUS] No feature found, using initialCenter as fallback`);
            const centerLl = L.latLng(initialCenter.lat, initialCenter.lon);
            setFocusCenter(centerLl);

            const bbox = bboxAroundPointMeters(centerLl.lat, centerLl.lng, TARGET_RADIUS_M);

            const result = await invokeFastPath(communeInsee, bbox, thisReqId);
            if (cancelled || requestIdRef.current !== thisReqId) return;

            if (!result) {
              throw new Error("cadastre-parcelles-bbox-v1 indisponible ou timeout (mode Supabase only).");
            }

            const raw = result.fc.features.length;
            const filtered = filterFeaturesWithinRadiusFast(result.fc, centerLl, TARGET_RADIUS_M);
            const elapsed = Math.round(performance.now() - t0);

            console.log(
              `[ParcelMapSelector][FOCUS] Fallback OK: raw=${raw} filtered=${filtered.features.length} source=${result.source} elapsed=${elapsed}ms reqId=${thisReqId}`,
            );

            setFocusRawCount(raw);
            setFc(filtered);
            setFetchTimeMs(elapsed);
            setFetchSource(result.source);
            setBackendCount(result.count);
            cacheRef.current.set(`focus::${focusParcelId}`, filtered);
            focusFetchDoneRef.current = focusParcelId;
          } else {
            setError(`Impossible de localiser la parcelle ${focusParcelId}.`);
          }
          return;
        }

        focusFeatureRef.current = focusFeature;

        // Centre robuste mais rapide: bbox-centre sur coords
        const c = getFeatureCenterFastLatLng(focusFeature);
        if (!c) {
          setError(`Impossible de calculer le centre de la parcelle ${focusParcelId}.`);
          return;
        }
        const centerLl = L.latLng(c.lat, c.lon);
        setFocusCenter(centerLl);

        const bbox = bboxAroundPointMeters(centerLl.lat, centerLl.lng, TARGET_RADIUS_M);

        console.log(
          `[ParcelMapSelector][FOCUS] bbox: r=${TARGET_RADIUS_M}m center=${centerLl.lat.toFixed(5)},${centerLl.lng.toFixed(
            5,
          )} reqId=${thisReqId}`,
        );

        const result = await invokeFastPath(communeInsee, bbox, thisReqId);
        if (cancelled || requestIdRef.current !== thisReqId) return;

        if (!result) {
          throw new Error("cadastre-parcelles-bbox-v1 indisponible ou timeout (mode Supabase only).");
        }

        const rawCount = result.fc.features.length;

        // Filtrage disque 500m (FAST)
        let filtered = filterFeaturesWithinRadiusFast(result.fc, centerLl, TARGET_RADIUS_M);

        // Injecter parcelle focus si absente
        filtered = ensureFeatureInFc(filtered, focusFeature, focusParcelId);

        const elapsed = Math.round(performance.now() - t0);

        console.log(
          `[ParcelMapSelector][FOCUS] OK: raw=${rawCount} filtered=${filtered.features.length} source=${result.source} elapsed=${elapsed}ms reqId=${thisReqId}`,
        );

        setFocusRawCount(rawCount);
        setFc(filtered);
        setFetchTimeMs(elapsed);
        setFetchSource(result.source);
        setBackendCount(result.count);
        cacheRef.current.set(`focus::${focusParcelId}`, filtered);
        focusFetchDoneRef.current = focusParcelId;
      } catch (e: any) {
        if (cancelled || requestIdRef.current !== thisReqId) return;
        const msg = e?.message ? String(e.message) : "Erreur lors du chargement des parcelles.";
        console.error(`[ParcelMapSelector][FOCUS] ERROR reqId=${thisReqId}:`, msg, e);
        setError(msg);
      } finally {
        if (!cancelled && requestIdRef.current === thisReqId) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusParcelId, communeInsee, focusMode]);

  // ─────────────────────────────────────────────────────────────────────────
  // Viewport mode: Supabase only (fast path) + phase2
  // ─────────────────────────────────────────────────────────────────────────

  const fetchBbox = useCallback(
    async (bbox: BBox) => {
      if (!communeInsee) return;
      if (focusMode) return;

      const bboxKey = makeBboxKey(bbox);
      const key = `${communeInsee}::${bboxKey}`;

      if (lastKeyRef.current === key) return;
      lastKeyRef.current = key;

      const cached = cacheRef.current.get(key);
      if (cached) {
        console.log(`[ParcelMapSelector] CACHE HIT key=${bboxKey} features=${cached.features.length}`);
        setFc(cached);
        setError(null);
        setFetchSource("cache");
        setEmptyWarning(cached.features.length === 0 ? "0 parcelles en cache pour cette zone" : null);
        return;
      }

      const thisReqId = ++requestIdRef.current;
      setLoading(true);
      setError(null);
      setEmptyWarning(null);

      const t0 = performance.now();

      try {
        let result = await invokeFastPath(communeInsee, bbox, thisReqId);
        if (requestIdRef.current !== thisReqId) return;

        if (!result) throw new Error("cadastre-parcelles-bbox-v1 indisponible ou timeout (viewport mode).");

        const elapsed = Math.round(performance.now() - t0);

        console.log(
          `[ParcelMapSelector] Phase1 OK: source=${result.source} reqId=${thisReqId} bbox=${bboxKey} features=${result.fc.features.length} elapsed=${elapsed}ms`,
        );

        setFc(result.fc);
        setFetchTimeMs(elapsed);
        setFetchSource(result.source);
        setBackendCount(result.count);
        cacheRef.current.set(key, result.fc);

        if (result.fc.features.length === 0) {
          setEmptyWarning("0 parcelles trouvées — zoomez/déplacez ou vérifiez le code commune");
          return;
        }

        const count1 = result.fc.features.length;
        if (count1 >= PHASE2_MAX_COUNT || requestIdRef.current !== thisReqId) return;

        const expandedBbox = expandBbox(bbox, PHASE2_EXPAND_RATIO);
        const expandedKey = `${communeInsee}::${makeBboxKey(expandedBbox)}`;
        if (cacheRef.current.has(expandedKey)) return;

        const t1 = performance.now();
        const phase2 = await invokeFastPath(communeInsee, expandedBbox, thisReqId);
        if (requestIdRef.current !== thisReqId) return;

        if (phase2) {
          const merged = mergeFeatureCollections(result.fc, phase2.fc);
          console.log(
            `[ParcelMapSelector] Phase2 OK: +${merged.features.length - count1} parcelles merged=${merged.features.length} elapsed=${Math.round(
              performance.now() - t1,
            )}ms`,
          );
          setFc(merged);
          cacheRef.current.set(key, merged);
          cacheRef.current.set(expandedKey, merged);
        }
      } catch (e: any) {
        if (requestIdRef.current !== thisReqId) return;
        console.error(`[ParcelMapSelector] ERROR reqId=${thisReqId}:`, e?.message, e);
        setError(e?.message ? String(e.message) : "Erreur lors du chargement des parcelles.");
      } finally {
        if (requestIdRef.current === thisReqId) setLoading(false);
      }
    },
    [communeInsee, focusMode, invokeFastPath],
  );

  // ── Auto-enrichissement ──
  useEffect(() => {
    if (!onAutoEnrichSelected || fc.features.length === 0 || selectedIds.length === 0) return;

    const idx = featureIndexRef.current;
    const updates: { id: string; area_m2: number | null }[] = [];

    for (const pid of selectedIds) {
      if (enrichedIdsRef.current.has(pid)) continue;
      const feature = idx.get(pid);
      if (feature) {
        updates.push({ id: pid, area_m2: getAreaFromFeature(feature) });
        enrichedIdsRef.current.add(pid);
      }
    }
    if (updates.length > 0) {
      console.log(`[ParcelMapSelector] Auto-enriching ${updates.length} parcels`);
      onAutoEnrichSelected(updates);
    }
  }, [fc, selectedIds, onAutoEnrichSelected]);

  // Reset tout si commune change
  useEffect(() => {
    cacheRef.current.clear();
    lastKeyRef.current = "";
    enrichedIdsRef.current.clear();
    featureIndexRef.current.clear();
    focusFeatureRef.current = null;
    focusFetchDoneRef.current = null;
    requestIdRef.current++;
    setFc({ type: "FeatureCollection", features: [] });
    setBackendCount(null);
    setFetchTimeMs(null);
    setFocusCenter(null);
    setFocusRawCount(null);
    setEmptyWarning(null);
    setZoomTooLow(false);
    mapKeyRef.current = `map-${communeInsee}-${Date.now()}`;
  }, [communeInsee]);

  // Reset focus state si focusParcelId change
  useEffect(() => {
    focusFetchDoneRef.current = null;
    focusFeatureRef.current = null;
    setFocusCenter(null);
    setFocusRawCount(null);
  }, [focusParcelId]);

  return (
    <div
      style={{
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        overflow: "hidden",
        background: "#fff",
        height: heightPx,
        minHeight: heightPx,
        position: "relative",
      }}
    >
      <MapContainer
        key={mapKeyRef.current}
        center={center}
        zoom={initialZoom}
        style={{ height: "100%", width: "100%", minHeight: heightPx }}
        scrollWheelZoom
        preferCanvas
      >
        <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

        <MapInvalidateSizeHandler />

        <MapController onViewportBbox={fetchBbox} fc={fc} focusParcelId={focusParcelId} focusMode={focusMode} />

        <MapMoveHandler onViewportBbox={fetchBbox} onZoomTooLow={setZoomTooLow} disabled={focusMode} />

        <ImperativeParcelLayer
          fc={fc}
          selectedIds={selectedIds}
          selectedParcels={selectedParcels}
          onToggleParcel={onToggleParcel}
        />
      </MapContainer>

      {/* ── Info overlay ── */}
      <div
        style={{
          position: "absolute",
          top: 10,
          right: 10,
          padding: "6px 10px",
          borderRadius: 8,
          background: "rgba(30, 41, 59, 0.88)",
          color: "#e2e8f0",
          fontSize: 11,
          fontFamily: "monospace",
          lineHeight: 1.6,
          zIndex: 1000,
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span>{fc.features.length} parcelles</span>

          {fetchTimeMs != null && (
            <span
              style={{
                color: fetchTimeMs > 5000 ? "#fca5a5" : fetchTimeMs > 2000 ? "#fde68a" : "#86efac",
              }}
            >
              {fetchTimeMs}ms
            </span>
          )}

          {fetchSource !== "cache" && (
            <span
              style={{
                padding: "1px 5px",
                borderRadius: 4,
                fontSize: 10,
                fontWeight: 700,
                background: "#065f46",
                color: "#a7f3d0",
              }}
            >
              FAST
            </span>
          )}

          {selectedIds.length > 0 && <span style={{ color: "#86efac" }}>· {selectedIds.length} sel.</span>}
        </div>

        {focusMode && focusCenter && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#93c5fd" }}>
            <span
              style={{
                padding: "1px 5px",
                borderRadius: 4,
                fontSize: 10,
                fontWeight: 700,
                background: "#1e3a5f",
                color: "#93c5fd",
              }}
            >
              FOCUS
            </span>
            <span>r={TARGET_RADIUS_M}m</span>
            <span>
              {focusCenter.lat.toFixed(4)},{focusCenter.lng.toFixed(4)}
            </span>
            {focusRawCount != null && focusRawCount !== fc.features.length && (
              <span style={{ color: "#fde68a" }}>
                raw:{focusRawCount}→{fc.features.length}
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Zoom too low (viewport mode only) ── */}
      {zoomTooLow && !loading && !focusMode && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            padding: "16px 24px",
            borderRadius: 12,
            background: "rgba(255,255,255,0.95)",
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            zIndex: 1000,
            textAlign: "center",
            maxWidth: 300,
          }}
        >
          <div style={{ fontSize: 24, marginBottom: 8 }}>🔍</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 4 }}>Zoomez pour voir les parcelles</div>
          <div style={{ fontSize: 12, color: "#64748b" }}>Le niveau de zoom est trop faible pour charger le cadastre.</div>
        </div>
      )}

      {/* ── Loading ── */}
      {loading && (
        <div
          style={{
            position: "absolute",
            top: 10,
            left: 10,
            padding: "6px 10px",
            borderRadius: 10,
            background: "rgba(15,23,42,0.88)",
            color: "white",
            fontSize: 12,
            fontWeight: 700,
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span
            style={{
              display: "inline-block",
              width: 12,
              height: 12,
              border: "2px solid rgba(255,255,255,0.3)",
              borderTopColor: "white",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
            }}
          />
          {focusMode ? "Chargement rayon 500m…" : "Chargement…"}
        </div>
      )}

      {/* ── Empty warning ── */}
      {emptyWarning && !error && !loading && (
        <div
          style={{
            position: "absolute",
            bottom: 10,
            left: 10,
            right: 10,
            padding: "8px 10px",
            borderRadius: 10,
            background: "rgba(254, 249, 195, 0.95)",
            border: "1px solid #fde047",
            color: "#854d0e",
            fontSize: 12,
            fontWeight: 600,
            zIndex: 1000,
          }}
        >
          ⚠️ {emptyWarning}
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div
          style={{
            position: "absolute",
            bottom: 10,
            left: 10,
            right: 10,
            padding: "8px 10px",
            borderRadius: 10,
            background: "rgba(254,242,242,0.95)",
            border: "1px solid #fecaca",
            color: "#991b1b",
            fontSize: 12,
            fontWeight: 700,
            zIndex: 1000,
          }}
        >
          ❌ {error}
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}