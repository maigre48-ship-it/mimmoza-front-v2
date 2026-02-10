// FIX: cadastre parcels not visible
// Normalizes GeoJSON from IGN/Supabase (EPSG:3857 / EPSG:2154 / swapped lat-lon) to WGS84 before Leaflet rendering
// src/spaces/promoteur/pages/FoncierPluPage.tsx
// ============================================
// Page fusionnée Foncier + PLU
// VERSION 4.6.0 — Distance-filtered parcels + PLU parser fix
// ============================================

import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import {
  MapPin, Building2, Layers, FileText,
  Check, AlertTriangle, Loader2, RefreshCw, Eye, EyeOff,
  Navigation, Search, X, Info, Upload, MapPinned, FileUp
} from "lucide-react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { supabase } from "../../../supabaseClient";
import proj4 from "proj4"; // npm i proj4 @types/proj4

// ─── proj4 CRS definitions ──────────────────────────────────────────────────
proj4.defs("EPSG:2154",
  "+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 " +
  "+x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs");
proj4.defs("EPSG:3857",
  "+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 " +
  "+x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs +type=crs");

const fromLambert93 = proj4("EPSG:2154", "EPSG:4326");
const fromWebMercator = proj4("EPSG:3857", "EPSG:4326");

const PLU_PARSER_URL = import.meta.env.VITE_PLU_PARSER_URL || "http://localhost:3000";
const PLU_PARSER_API_KEY = import.meta.env.VITE_PLU_PARSER_API_KEY || "";

// ─── Interfaces ──────────────────────────────────────────────────────────────
interface SelectedParcel {
  id: string;
  feature?: any;
  area_m2?: number | null;
}

interface PluRuleset {
  hauteur?: { max_hauteur_m?: number; hauteur_max_m?: number; note?: string } | number;
  emprise?: { emprise_max_ratio?: number } | number;
  emprise_sol?: { emprise_sol_max?: number; emprise_max_ratio?: number; note?: string } | number;
  ces?: { ces_max?: number; max_ratio?: number } | number;
  reculs?: any;
  reculs_alignements?: { voie?: number; limites?: number; commentaire?: string } | any;
  stationnement?: any;
  densite?: { cos_max?: number; cos_existe?: boolean } | any;
}

interface PluData {
  zone_code?: string;
  zone_libelle?: string;
  ruleset?: PluRuleset;
  raw?: any;
  found?: boolean;
}

interface ProjectInfo {
  parcelId?: string;
  parcelIds?: string[];
  communeInsee?: string;
  surfaceM2?: number;
  address?: string;
  addressLat?: number;
  addressLon?: number;
}

interface AddressSuggestion {
  label: string;
  housenumber?: string;
  street?: string;
  postcode?: string;
  city?: string;
  citycode?: string;
  context?: string;
  lon: number;
  lat: number;
  id: string;
}

type BBox = {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
};

const DEFAULT_ZOOM = 18;
// ──────────────────────────────────────────────────────────────────────────────
// ⚡ RADIUS CONTROLS — parcels beyond this are DROPPED after fetch
// ──────────────────────────────────────────────────────────────────────────────
const PARCEL_RADIUS_M  = 500;                    // 500m max display radius
const FETCH_RADIUS_M   = PARCEL_RADIUS_M + 100;  // fetch slightly larger to avoid edge clipping
const FETCH_RADIUS_KM  = FETCH_RADIUS_M / 1000;
const MAX_FEATURES_LIMIT = 500;

// ═══════════════════════════════════════════════════════════════════════════════
// DISTANCE UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/** Haversine distance in meters between two WGS84 points */
function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Get the centroid [lon, lat] of a GeoJSON feature (WGS84) */
function getFeatureCentroid(feature: any): [number, number] | null {
  try {
    const g = feature?.geometry;
    if (!g?.coordinates) return null;
    let ring: number[][] = [];
    if (g.type === "Polygon") ring = g.coordinates[0];
    else if (g.type === "MultiPolygon") ring = g.coordinates[0][0];
    if (!ring || ring.length === 0) return null;
    let sumLon = 0, sumLat = 0;
    for (const c of ring) { sumLon += c[0]; sumLat += c[1]; }
    return [sumLon / ring.length, sumLat / ring.length];
  } catch { return null; }
}

/**
 * Filter features to only those within `radiusM` of (centerLat, centerLon).
 * Works on WGS84-normalized features.
 */
function filterFeaturesByDistance(
  features: any[],
  centerLat: number,
  centerLon: number,
  radiusM: number,
): any[] {
  return features.filter((f) => {
    const c = getFeatureCentroid(f);
    if (!c) return false; // drop features without geometry
    const dist = haversineM(centerLat, centerLon, c[1], c[0]);
    return dist <= radiusM;
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// CRS DETECTION + NORMALIZATION
// ═══════════════════════════════════════════════════════════════════════════════

type CoordSystem = "wgs84" | "latlon-swapped" | "webmercator" | "lambert93" | "unknown";

function sampleCoordFromFeature(feature: any): [number, number] | null {
  const g = feature?.geometry;
  if (!g?.coordinates) return null;
  try {
    if (g.type === "Polygon" && g.coordinates[0]?.[0]) {
      const c = g.coordinates[0][0];
      return [c[0], c[1]];
    }
    if (g.type === "MultiPolygon" && g.coordinates[0]?.[0]?.[0]) {
      const c = g.coordinates[0][0][0];
      return [c[0], c[1]];
    }
  } catch { /* skip */ }
  return null;
}

function detectCoordSystem(x: number, y: number): CoordSystem {
  const absX = Math.abs(x);
  const absY = Math.abs(y);
  if (x >= 100_000 && x <= 1_500_000 && y >= 5_500_000 && y <= 7_500_000) return "lambert93";
  if (absX <= 2_500_000 && y >= 4_000_000 && y <= 8_500_000) return "webmercator";
  if (absX > 1_000 || absY > 1_000) return "lambert93";
  if (absX <= 180 && absY <= 90) {
    if (x >= 35 && x <= 60 && y >= -10 && y <= 20) return "latlon-swapped";
    return "wgs84";
  }
  return "unknown";
}

function transformCoord(coord: number[], system: CoordSystem): number[] {
  const rest = coord.length > 2 ? coord.slice(2) : [];
  switch (system) {
    case "lambert93": { const [lon, lat] = fromLambert93.forward([coord[0], coord[1]]); return [lon, lat, ...rest]; }
    case "webmercator": { const [lon, lat] = fromWebMercator.forward([coord[0], coord[1]]); return [lon, lat, ...rest]; }
    case "latlon-swapped": return [coord[1], coord[0], ...rest];
    default: return coord;
  }
}

function transformCoordsDeep(coords: any, system: CoordSystem): any {
  if (!Array.isArray(coords)) return coords;
  if (typeof coords[0] === "number") return transformCoord(coords, system);
  return coords.map((c: any) => transformCoordsDeep(c, system));
}

function normalizeFeatureCollectionToWgs84(
  fc: { type: string; features: any[] },
  label = "",
): { type: string; features: any[] } {
  if (!fc?.features?.length) return fc;

  const valid = fc.features.filter((f: any) => {
    const t = f?.geometry?.type;
    return t === "Polygon" || t === "MultiPolygon";
  });
  const dropped = fc.features.length - valid.length;
  if (valid.length === 0) {
    console.warn(`[CRS] ${label} — 0 valid geometries (${fc.features.length} dropped)`);
    return { type: "FeatureCollection", features: [] };
  }

  let detectedSystem: CoordSystem = "unknown";
  let sampleXY: [number, number] | null = null;
  for (const f of valid.slice(0, 3)) {
    const s = sampleCoordFromFeature(f);
    if (s) { sampleXY = s; detectedSystem = detectCoordSystem(s[0], s[1]); if (detectedSystem !== "unknown") break; }
  }

  console.log(`[CRS] ${label} detected=${detectedSystem} sample=(${sampleXY?.[0]?.toFixed(2) ?? "?"}, ${sampleXY?.[1]?.toFixed(2) ?? "?"}) valid=${valid.length}${dropped ? ` dropped=${dropped}` : ""}`);

  if (detectedSystem === "wgs84") return { type: "FeatureCollection", features: valid };
  if (detectedSystem === "unknown") return { type: "FeatureCollection", features: valid };

  const t0 = performance.now();
  let errors = 0;
  const transformed = valid.map((f: any) => {
    try {
      const geom = f.geometry;
      if (!geom?.coordinates) return f;
      return { ...f, geometry: { ...geom, coordinates: transformCoordsDeep(geom.coordinates, detectedSystem) } };
    } catch (e: any) { errors++; if (errors <= 2) console.warn(`[CRS] transform error:`, e?.message); return f; }
  });

  const elapsed = Math.round(performance.now() - t0);
  const postSample = sampleCoordFromFeature(transformed[0]);
  console.log(`[CRS] ${label} → WGS84 ${elapsed}ms (errors=${errors}) post=(${postSample?.[0]?.toFixed(5) ?? "?"}, ${postSample?.[1]?.toFixed(5) ?? "?"})`);

  return { type: "FeatureCollection", features: transformed };
}

function normalizeSingleFeature(feature: any, label = ""): any {
  if (!feature?.geometry) return feature;
  const fc = normalizeFeatureCollectionToWgs84({ type: "FeatureCollection", features: [feature] }, label);
  return fc.features[0] ?? feature;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════════════════════
const styles = {
  container: { padding: "24px", maxWidth: "1400px", margin: "0 auto", fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif", position: "relative" as const, zIndex: 1 } as React.CSSProperties,
  header: { marginBottom: "24px", position: "relative" as const, zIndex: 10 } as React.CSSProperties,
  title: { fontSize: "24px", fontWeight: 700, color: "#0f172a", margin: "0 0 8px 0", display: "flex", alignItems: "center", gap: "12px" } as React.CSSProperties,
  subtitle: { fontSize: "14px", color: "#64748b", margin: 0 } as React.CSSProperties,
  grid: { display: "grid", gridTemplateColumns: "1fr 380px", gap: "20px", position: "relative" as const, zIndex: 1 } as React.CSSProperties,
  card: { background: "white", borderRadius: "14px", border: "1px solid #e2e8f0", overflow: "hidden", position: "relative" as const } as React.CSSProperties,
  cardHeader: { padding: "16px 18px", borderBottom: "1px solid #e2e8f0", background: "#f8fafc", display: "flex", alignItems: "center", justifyContent: "space-between", position: "relative" as const, zIndex: 5 } as React.CSSProperties,
  cardTitle: { fontSize: "14px", fontWeight: 700, color: "#0f172a", display: "flex", alignItems: "center", gap: "8px", margin: 0 } as React.CSSProperties,
  cardBody: { padding: "18px" } as React.CSSProperties,
  badge: { display: "inline-flex", alignItems: "center", gap: "4px", padding: "4px 10px", borderRadius: "6px", fontSize: "11px", fontWeight: 600 } as React.CSSProperties,
  button: { display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", padding: "10px 16px", borderRadius: "10px", border: "none", fontSize: "13px", fontWeight: 600, cursor: "pointer", transition: "all 0.2s" } as React.CSSProperties,
  input: { width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1px solid #e2e8f0", fontSize: "13px", outline: "none", transition: "border-color 0.2s", boxSizing: "border-box" as const } as React.CSSProperties,
  inputLabel: { fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "6px", display: "block" } as React.CSSProperties,
};

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════
function formatAreaM2(area: number | null | undefined): string {
  if (area == null) return "—";
  return area.toLocaleString("fr-FR") + " m²";
}

function extractCommuneInsee(parcelId: string | null | undefined): string | null {
  if (!parcelId) return null;
  const clean = parcelId.replace(/[-\s]/g, "");
  if (clean.length >= 5) return clean.slice(0, 5);
  return null;
}

function getParcelIdFromFeature(f: any): string | null {
  const p = f?.properties ?? {};
  const pid = p.parcel_id ?? p.idu ?? p.id ?? p.IDU ?? p.ID ?? null;
  if (pid && typeof pid === "string") return pid;
  const code_insee = p.code_insee || p.CODE_INSEE || p.commune;
  const prefixe = p.prefixe || p.com_abs || "000";
  const section = p.section || p.SECTION;
  const numero = p.numero || p.NUMERO;
  if (code_insee && section && numero) {
    const prefix = prefixe || "000";
    return `${String(code_insee)}${prefix}${String(section).padStart(2, "0")}${String(numero).padStart(4, "0")}`;
  }
  return null;
}

function calculatePolygonArea(geometry: any): number | null {
  try {
    if (!geometry) return null;
    let coordinates: number[][][] = [];
    if (geometry.type === "Polygon") coordinates = [geometry.coordinates[0]];
    else if (geometry.type === "MultiPolygon") coordinates = geometry.coordinates.map((poly: number[][][]) => poly[0]);
    else return null;
    let totalArea = 0;
    for (const ring of coordinates) {
      if (!ring || ring.length < 3) continue;
      const toRad = (deg: number) => (deg * Math.PI) / 180;
      const R = 6371000;
      let area = 0;
      for (let i = 0; i < ring.length - 1; i++) {
        const lon1 = toRad(ring[i][0]), lat1 = toRad(ring[i][1]);
        const lon2 = toRad(ring[i + 1][0]), lat2 = toRad(ring[i + 1][1]);
        area += (lon2 - lon1) * (2 + Math.sin(lat1) + Math.sin(lat2));
      }
      totalArea += Math.abs((area * R * R) / 2);
    }
    return Math.round(totalArea);
  } catch { return null; }
}

function getFeatureArea(feature: any): number | null {
  const props = feature?.properties || {};
  if (props.contenance && typeof props.contenance === "number" && props.contenance > 0) return props.contenance;
  const surfaceKey = Object.keys(props).find((k) => k.toLowerCase().includes("surface") || k.toLowerCase().includes("area"));
  if (surfaceKey && typeof props[surfaceKey] === "number" && props[surfaceKey] > 0) return props[surfaceKey];
  if (feature?.geometry) return calculatePolygonArea(feature.geometry);
  return null;
}

function getFeatureBoundsCenter(feature: any): { center: [number, number]; bounds: L.LatLngBounds } | null {
  try {
    if (!feature?.geometry) return null;
    const layer = L.geoJSON(feature);
    const bounds = layer.getBounds();
    if (!bounds.isValid()) return null;
    const center = bounds.getCenter();
    return { center: [center.lat, center.lng], bounds };
  } catch { return null; }
}

function getBboxAroundPoint(lat: number, lon: number, radiusKm: number): BBox {
  const latDelta = radiusKm / 111;
  const lonDelta = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
  return { minLat: lat - latDelta, maxLat: lat + latDelta, minLon: lon - lonDelta, maxLon: lon + lonDelta };
}

function getBboxKey(bbox: BBox): string {
  return `${bbox.minLon.toFixed(4)},${bbox.minLat.toFixed(4)},${bbox.maxLon.toFixed(4)},${bbox.maxLat.toFixed(4)}`;
}

function mergeFeatures(existing: any[], newFeatures: any[]): any[] {
  const seenIds = new Set<string>();
  const result: any[] = [];
  for (const f of existing) { const pid = getParcelIdFromFeature(f); if (pid && !seenIds.has(pid)) { seenIds.add(pid); result.push(f); } else if (!pid) result.push(f); }
  for (const f of newFeatures) { const pid = getParcelIdFromFeature(f); if (pid && !seenIds.has(pid)) { seenIds.add(pid); result.push(f); } }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAP COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════
function MapController({ center, focusParcelId, parcelsData, onMapReady }: {
  center: [number, number] | null; focusParcelId?: string | null; parcelsData?: any; onMapReady?: (map: L.Map) => void;
}) {
  const map = useMap();
  const hasFocused = useRef(false);
  const hasInitialized = useRef(false);
  const lastCenterRef = useRef<string | null>(null);

  useEffect(() => { if (!hasInitialized.current) { hasInitialized.current = true; onMapReady?.(map); } }, [map, onMapReady]);

  useEffect(() => {
    if (!center) return;
    const [lat, lon] = center;
    const centerKey = `${lat.toFixed(5)},${lon.toFixed(5)}`;
    if (lastCenterRef.current === centerKey) return;
    lastCenterRef.current = centerKey;
    console.log(`[MapCtrl] setView [${lat.toFixed(5)}, ${lon.toFixed(5)}]`);
    map.setView([lat, lon], DEFAULT_ZOOM, { animate: true });
    hasFocused.current = false;
  }, [center, map]);

  useEffect(() => {
    if (focusParcelId && parcelsData?.features && !hasFocused.current) {
      const feature = parcelsData.features.find((f: any) => getParcelIdFromFeature(f) === focusParcelId);
      if (feature?.geometry) {
        try {
          const layer = L.geoJSON(feature);
          const bounds = layer.getBounds();
          if (bounds.isValid()) { map.fitBounds(bounds, { padding: [80, 80], maxZoom: 19, animate: true }); hasFocused.current = true; }
        } catch { /* safe */ }
      }
    }
  }, [focusParcelId, parcelsData, map]);

  return null;
}

// ─── FIXED ParcelLayer ───────────────────────────────────────────────────────
// Replaces the declarative <GeoJSON> approach with imperative L.geoJSON()
// to fix the "parcels not visible" bug in react-leaflet.
//
// Drop this into FoncierPluPage.tsx, replacing the existing ParcelLayer function.
// ─────────────────────────────────────────────────────────────────────────────

function ParcelLayer({ data, selectedIds, onToggleParcel }: {
  data: any;
  selectedIds: string[];
  onToggleParcel: (parcelId: string, feature: any, area_m2: number | null) => void;
}) {
  const map = useMap();
  const geoJsonRef = useRef<L.GeoJSON | null>(null);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  // Refs to avoid stale closures in Leaflet event handlers
  const onToggleRef = useRef(onToggleParcel);
  onToggleRef.current = onToggleParcel;
  const selectedSetRef = useRef(selectedSet);
  selectedSetRef.current = selectedSet;

  // ── Build / rebuild layer when DATA changes ───────────────────────────
  useEffect(() => {
    if (geoJsonRef.current) {
      geoJsonRef.current.remove();
      geoJsonRef.current = null;
    }

    if (!data?.features?.length) return;

    // Diagnostic: log first feature coords to verify CRS
    try {
      const g = data.features[0]?.geometry;
      const ring =
        g?.type === "MultiPolygon" ? g.coordinates?.[0]?.[0]?.[0] :
        g?.type === "Polygon"      ? g.coordinates?.[0]?.[0] :
        null;
      console.log(
        `[ParcelLayer] ✅ Rendering ${data.features.length} features — first coord:`,
        ring,
        `(expect ~[-1.6, 43.3] for Ascain)`,
      );
    } catch { /* safe */ }

    const layer = L.geoJSON(data, {
      style: (feature?: any) => {
        const pid = feature ? getParcelIdFromFeature(feature) : null;
        const sel = pid ? selectedSetRef.current.has(pid) : false;
        return {
          color: sel ? "#16a34a" : "#2563eb",
          weight: sel ? 3 : 1.5,
          fillColor: sel ? "#86efac" : "#93c5fd",
          fillOpacity: sel ? 0.5 : 0.15,
          opacity: 1,
        };
      },
      onEachFeature: (feature: any, lyr: L.Layer) => {
        const pid = getParcelIdFromFeature(feature);
        if (!pid) return;

        lyr.on({
          click: () => {
            onToggleRef.current(pid, feature, getFeatureArea(feature));
          },
          mouseover: (e: any) => {
            const t = e.target;
            const s = selectedSetRef.current.has(pid);
            t.setStyle({
              weight: s ? 4 : 3,
              fillOpacity: s ? 0.6 : 0.35,
              fillColor: s ? "#86efac" : "#60a5fa",
            });
            try { t.bringToFront(); } catch {}
          },
          mouseout: (e: any) => {
            const t = e.target;
            const s = selectedSetRef.current.has(pid);
            t.setStyle({
              weight: s ? 3 : 1.5,
              fillOpacity: s ? 0.5 : 0.15,
              fillColor: s ? "#86efac" : "#93c5fd",
            });
          },
        });

        const area = getFeatureArea(feature);
        lyr.bindTooltip(
          `<div style="font-family:Inter,sans-serif;font-size:12px">` +
          `<strong>${pid}</strong>` +
          `${area ? `<br/><b>${area.toLocaleString("fr-FR")} m²</b>` : ""}` +
          `</div>`,
          { sticky: true, className: "parcel-tooltip" },
        );
      },
    });

    layer.addTo(map);
    geoJsonRef.current = layer;

    console.log(`[ParcelLayer] Layer added to map, bounds:`, layer.getBounds().toBBoxString());

    return () => {
      if (geoJsonRef.current) {
        geoJsonRef.current.remove();
        geoJsonRef.current = null;
      }
    };
  }, [data, map]);

  // ── Update styles when SELECTION changes (no rebuild) ─────────────────
  useEffect(() => {
    if (!geoJsonRef.current) return;
    geoJsonRef.current.setStyle((feature?: any) => {
      const pid = feature ? getParcelIdFromFeature(feature) : null;
      const sel = pid ? selectedSet.has(pid) : false;
      return {
        color: sel ? "#16a34a" : "#2563eb",
        weight: sel ? 3 : 1.5,
        fillColor: sel ? "#86efac" : "#93c5fd",
        fillOpacity: sel ? 0.5 : 0.15,
        opacity: 1,
      };
    });
  }, [selectedSet]);

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PARCEL MAP SELECTOR — with distance filtering
// ═══════════════════════════════════════════════════════════════════════════════
function ParcelMapSelector({ communeInsee, selectedIds, onToggleParcel, focusParcelId, focusFeature, heightPx = 400, onMapReady, mapCenter }: {
  communeInsee: string; selectedIds: string[]; onToggleParcel: (parcelId: string, feature: any, area_m2: number | null) => void;
  focusParcelId?: string | null; focusFeature?: any; heightPx?: number; onMapReady?: (map: L.Map) => void; mapCenter: [number, number] | null;
}) {
  const [parcelsData, setParcelsData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<string | null>(null);
  const [fetchTime, setFetchTime] = useState<number | null>(null);

  const cacheRef = useRef<Map<string, any>>(new Map());
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastFetchKeyRef = useRef<string | null>(null);

  const fetchParcelsAroundCenter = useCallback(
    async (center: [number, number], targetFeature?: any) => {
      const [lat, lon] = center;
      const startTime = performance.now();

      const normalizedTarget = targetFeature ? normalizeSingleFeature(targetFeature, "focus-inject") : undefined;

      // ── Build bbox around center (FETCH_RADIUS_KM ~ 600m) ─────────────
      const bbox = getBboxAroundPoint(lat, lon, FETCH_RADIUS_KM);
      const cacheKey = `${communeInsee}:${getBboxKey(bbox)}`;

      if (lastFetchKeyRef.current === cacheKey && parcelsData?.features?.length > 0) return;
      if (cacheRef.current.has(cacheKey)) {
        const cached = cacheRef.current.get(cacheKey);
        // Only use cache if it has actual results
        if (cached.data?.features?.length > 0) {
          setParcelsData(cached.data); setDataSource(cached.source + " (cache)"); setFetchTime(0);
          lastFetchKeyRef.current = cacheKey; return;
        } else {
          // Don't use empty cache, re-fetch
          cacheRef.current.delete(cacheKey);
        }
      }

      if (abortControllerRef.current) abortControllerRef.current.abort();
      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;

      lastFetchKeyRef.current = cacheKey;
      setParcelsData(null); setLoading(true); setError(null); setDataSource(null);

      console.log(`[Parcels] Fetch around [${lat.toFixed(5)}, ${lon.toFixed(5)}] bbox=${getBboxKey(bbox)}`);

      let allFeatures: any[] = [];
      let sources: string[] = [];

      // ── 1. PRIMARY: IGN bbox-only (best for local parcels) ────────────
      try {
        const url = `https://apicarto.ign.fr/api/cadastre/parcelle?_limit=${MAX_FEATURES_LIMIT}&box=${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`;
        console.log(`[Parcels] IGN bbox: ${url}`);
        const response = await fetch(url, { signal });
        if (signal.aborted) return;
        if (response.ok) {
          const data = await response.json();
          const feat = data?.features || [];
          console.log(`[Parcels] IGN (bbox): ${feat.length} features`);
          if (feat.length > 0) { allFeatures = feat; sources.push("IGN"); }
        } else {
          console.warn(`[Parcels] IGN (bbox) HTTP ${response.status}`);
        }
      } catch (e: any) {
        if (signal.aborted) return;
        console.warn("[Parcels] IGN (bbox) failed:", e.message);
      }

      // ── 2. FALLBACK: IGN with code_insee + bbox ───────────────────────
      if (allFeatures.length === 0 && communeInsee) {
        try {
          const url = `https://apicarto.ign.fr/api/cadastre/parcelle?code_insee=${communeInsee}&_limit=${MAX_FEATURES_LIMIT}&box=${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`;
          const response = await fetch(url, { signal });
          if (signal.aborted) return;
          if (response.ok) {
            const data = await response.json();
            const feat = data?.features || [];
            console.log(`[Parcels] IGN (insee+bbox): ${feat.length} features`);
            if (feat.length > 0) { allFeatures = feat; sources.push("IGN-insee"); }
          }
        } catch (e: any) {
          if (signal.aborted) return;
          console.warn("[Parcels] IGN (insee) failed:", e.message);
        }
      }

      // ── 3. LAST RESORT: Supabase ──────────────────────────────────────
      if (allFeatures.length === 0) {
        try {
          const result = await supabase.functions.invoke("cadastre-parcelles-bbox-v1", {
            body: { commune_insee: communeInsee, bbox },
          });
          if (signal.aborted) return;
          const feat = result.data?.featureCollection?.features || result.data?.features || [];
          console.log(`[Parcels] Supabase: ${feat.length} features`);
          if (feat.length > 0) { allFeatures = feat; sources.push("Supabase"); }
        } catch (e: any) {
          if (signal.aborted) return;
          console.warn("[Parcels] Supabase failed:", e.message);
        }
      }

      if (signal.aborted) return;

      // ── Inject focus parcel if missing ────────────────────────────────────
      if (normalizedTarget && focusParcelId) {
        const exists = allFeatures.some((f: any) => getParcelIdFromFeature(f) === focusParcelId);
        if (!exists) { allFeatures = [normalizedTarget, ...allFeatures]; console.log(`[Parcels] Injected focus: ${focusParcelId}`); }
      }

      // ── NORMALIZE TO WGS84 ────────────────────────────────────────────────
      const sourceStr = sources.join("+") || "none";
      const normalized = normalizeFeatureCollectionToWgs84(
        { type: "FeatureCollection", features: allFeatures }, sourceStr,
      );

      // ══════════════════════════════════════════════════════════════════════
      // ⚡ DISTANCE FILTER — keep only parcels within PARCEL_RADIUS_M
      // ══════════════════════════════════════════════════════════════════════
      const beforeFilter = normalized.features.length;

      // Diagnostic: show distances of first 5 features to help debug
      if (beforeFilter > 0) {
        const sampleDistances = normalized.features.slice(0, 5).map((f: any) => {
          const c = getFeatureCentroid(f);
          if (!c) return { id: getParcelIdFromFeature(f), dist: "no-geom" };
          const dist = haversineM(lat, lon, c[1], c[0]);
          return { id: getParcelIdFromFeature(f)?.slice(-8), lon: c[0].toFixed(4), lat: c[1].toFixed(4), dist: Math.round(dist) };
        });
        console.log(`[Parcels] 📏 Filter center: [${lat.toFixed(5)}, ${lon.toFixed(5)}], radius: ${PARCEL_RADIUS_M}m`);
        console.table(sampleDistances);
      }

      let filtered = filterFeaturesByDistance(normalized.features, lat, lon, PARCEL_RADIUS_M);

      // Always keep the focus parcel even if slightly outside radius
      if (focusParcelId) {
        const focusInFiltered = filtered.some((f: any) => getParcelIdFromFeature(f) === focusParcelId);
        if (!focusInFiltered) {
          const focusF = normalized.features.find((f: any) => getParcelIdFromFeature(f) === focusParcelId);
          if (focusF) filtered = [focusF, ...filtered];
        }
      }

      // If distance filter killed everything but we had features, skip the filter
      // (safety net: CRS mismatch or wrong center would cause this)
      if (filtered.length === 0 && beforeFilter > 0) {
        console.warn(`[Parcels] ⚠ Distance filter dropped ALL ${beforeFilter} features! Disabling filter as safety fallback.`);
        filtered = normalized.features;
      }

      console.log(`[Parcels] ✅ ${beforeFilter} raw → ${filtered.length} kept (radius=${PARCEL_RADIUS_M}m)`);

      const finalData = { type: "FeatureCollection", features: filtered, _crsNormKey: Date.now() } as any;
      const elapsed = Math.round(performance.now() - startTime);

      // Only cache if we actually have results (don't poison cache with 0)
      if (filtered.length > 0) {
        cacheRef.current.set(cacheKey, { data: finalData, source: sourceStr });
      }
      setParcelsData(finalData);
      setDataSource(sourceStr);
      setFetchTime(elapsed);
      if (filtered.length === 0) setError("Aucune parcelle trouvée");
      setLoading(false);
    },
    [communeInsee, focusParcelId, parcelsData],
  );

  useEffect(() => {
    if (mapCenter) fetchParcelsAroundCenter(mapCenter, focusFeature);
    return () => { abortControllerRef.current?.abort(); };
  }, [mapCenter, focusFeature, fetchParcelsAroundCenter]);

  const handleMapReady = useCallback((map: L.Map) => { onMapReady?.(map); }, [onMapReady]);

  if (!mapCenter) {
    return (
      <div style={{ height: heightPx, display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc", borderRadius: "0 0 14px 14px", color: "#64748b", fontSize: "14px" }}>
        <div style={{ textAlign: "center" }}><MapPin size={32} style={{ marginBottom: "8px", opacity: 0.5 }} /><p style={{ margin: 0 }}>Sélectionnez une adresse ou une parcelle</p></div>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", height: heightPx, borderRadius: "0 0 14px 14px", overflow: "hidden", zIndex: 1 }}>
      <MapContainer center={mapCenter} zoom={DEFAULT_ZOOM} style={{ height: "100%", width: "100%", zIndex: 1 }} scrollWheelZoom={true}>
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <MapController center={mapCenter} focusParcelId={focusParcelId} parcelsData={parcelsData} onMapReady={handleMapReady} />
        {parcelsData && <ParcelLayer data={parcelsData} selectedIds={selectedIds} onToggleParcel={onToggleParcel} />}
      </MapContainer>
      {loading && (
        <div style={{ position: "absolute", top: 10, left: 50, padding: "6px 12px", borderRadius: 8, background: "rgba(15,23,42,0.9)", color: "white", fontSize: 12, fontWeight: 600, zIndex: 1000, display: "flex", alignItems: "center", gap: 6 }}>
          <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />Chargement…
        </div>
      )}
      <div style={{ position: "absolute", top: 10, right: 10, padding: "6px 10px", borderRadius: 6, background: "rgba(255,255,255,0.95)", fontSize: 11, color: "#475569", fontWeight: 600, zIndex: 1000, border: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 6 }}>
        {parcelsData?.features?.length || 0} parcelles
        {fetchTime !== null && <span style={{ color: "#94a3b8" }}>{fetchTime}ms</span>}
        {dataSource && (
          <span style={{ background: dataSource.includes("IGN") ? "#dbeafe" : "#f0fdf4", color: dataSource.includes("IGN") ? "#1d4ed8" : "#166534", padding: "2px 6px", borderRadius: 4, fontSize: 9, fontWeight: 700 }}>{dataSource}</span>
        )}
      </div>
      {error && (
        <div style={{ position: "absolute", bottom: 40, left: 10, right: 10, padding: "8px 12px", borderRadius: 8, background: "rgba(254,243,199,0.95)", border: "1px solid #fde68a", color: "#92400e", fontSize: 12, fontWeight: 600, zIndex: 1000, display: "flex", alignItems: "center", gap: 8 }}>
          <AlertTriangle size={14} />{error}
        </div>
      )}
      <div style={{ position: "absolute", bottom: 10, right: 10, padding: "6px 10px", borderRadius: 6, background: "rgba(255,255,255,0.9)", fontSize: 11, color: "#64748b", zIndex: 1000 }}>
        Cliquez sur une parcelle pour la sélectionner
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLU COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════
function PluUploaderPanel({ communeInsee, communeNom, targetZoneCode, onPluParsed }: { communeInsee: string; communeNom?: string; targetZoneCode?: string; onPluParsed: (pluData: PluData) => void; }) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pluServerStatus, setPluServerStatus] = useState<"unknown" | "ok" | "down">("unknown");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Check PLU server health on mount ──────────────────────────────────
  useEffect(() => {
    fetch(`${PLU_PARSER_URL}/health`, { signal: AbortSignal.timeout(3000) })
      .then((r) => r.ok ? setPluServerStatus("ok") : setPluServerStatus("down"))
      .catch(() => setPluServerStatus("down"));
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected && selected.type === "application/pdf") { setFile(selected); setError(null); }
    else setError("Veuillez sélectionner un fichier PDF");
  };

  const fileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const handleUploadAndParse = async () => {
    if (!file) return;
    setUploading(true); setError(null); setProgress("Préparation...");
    try {
      // Check server first
      try {
        const healthCheck = await fetch(`${PLU_PARSER_URL}/health`, { signal: AbortSignal.timeout(3000) });
        if (!healthCheck.ok) throw new Error("Server not responding");
        setPluServerStatus("ok");
      } catch {
        setPluServerStatus("down");
        throw new Error(`Le serveur PLU Parser n'est pas accessible (${PLU_PARSER_URL}). Lancez-le avec: cd mimmoza-plu-parser && node index.cjs`);
      }

      const base64Data = await fileToBase64(file);
      setProgress("Analyse PLU en cours...");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (PLU_PARSER_API_KEY) headers["x-api-key"] = PLU_PARSER_API_KEY;

      const parseResponse = await fetch(`${PLU_PARSER_URL}/api/plu-parse`, {
        method: "POST", headers,
        body: JSON.stringify({ commune_insee: communeInsee, commune_nom: communeNom || `Commune ${communeInsee}`, target_zone_code: targetZoneCode, pdf_base64: base64Data, pdf_filename: file.name }),
      });
      if (!parseResponse.ok) {
        const ed = await parseResponse.json().catch(() => ({ message: parseResponse.statusText }));
        throw new Error(ed.message || `Erreur ${parseResponse.status}`);
      }
      const parseResult = await parseResponse.json();
      setProgress("Terminé !");
      if (parseResult.success && parseResult.zones_rulesets?.length > 0) {
        let zoneData = parseResult.zones_rulesets[0];
        if (targetZoneCode) {
          const m = parseResult.zones_rulesets.find((z: any) => z.zone_code?.toUpperCase() === targetZoneCode.toUpperCase());
          if (m) zoneData = m;
        }
        const plu: PluData = { zone_code: zoneData.zone_code, zone_libelle: zoneData.zone_libelle, ruleset: zoneData.ruleset, raw: parseResult, found: true };
        try {
          await supabase.from("plu_parsed").upsert({ commune_insee: communeInsee, zone_code: plu.zone_code, ruleset: plu.ruleset, source_file: file.name, parsed_at: new Date().toISOString() }, { onConflict: "commune_insee,zone_code" });
        } catch (saveErr) { console.warn("[PLU] Could not save:", saveErr); }
        onPluParsed(plu);
      } else throw new Error(parseResult.message || "Aucune zone PLU trouvée");
    } catch (err: any) { setError(err.message || "Erreur analyse PLU"); }
    finally { setUploading(false); setProgress(""); }
  };

  return (
    <div style={{ ...styles.card, marginTop: "16px" }}>
      <div style={styles.cardHeader}>
        <h3 style={styles.cardTitle}><FileUp size={18} color="#f59e0b" />Importer le règlement PLU</h3>
        {/* Server status indicator */}
        <span style={{
          ...styles.badge,
          background: pluServerStatus === "ok" ? "#f0fdf4" : pluServerStatus === "down" ? "#fef2f2" : "#f8fafc",
          color: pluServerStatus === "ok" ? "#16a34a" : pluServerStatus === "down" ? "#dc2626" : "#94a3b8",
        }}>
          {pluServerStatus === "ok" ? "● Serveur OK" : pluServerStatus === "down" ? "● Serveur OFF" : "● …"}
        </span>
      </div>
      <div style={styles.cardBody}>
        {pluServerStatus === "down" && (
          <div style={{ marginBottom: "16px", padding: "12px 14px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "10px", fontSize: "12px", color: "#991b1b", lineHeight: 1.5 }}>
            <strong>⚠ Serveur PLU Parser non accessible</strong><br />
            Lancez le serveur dans un terminal :<br />
            <code style={{ background: "#fee2e2", padding: "2px 6px", borderRadius: "4px", fontSize: "11px" }}>
              cd mimmoza-plu-parser && node index.cjs
            </code>
          </div>
        )}
        <p style={{ fontSize: "13px", color: "#64748b", margin: "0 0 16px" }}>Uploadez le PDF du règlement pour extraire les règles.</p>
        <div onClick={() => fileInputRef.current?.click()} style={{ padding: "24px", border: "2px dashed #cbd5e1", borderRadius: "12px", background: file ? "#f0fdf4" : "#f8fafc", cursor: "pointer", textAlign: "center" }}>
          <input ref={fileInputRef} type="file" accept=".pdf" style={{ display: "none" }} onChange={handleFileSelect} />
          {file ? (<div><Check size={32} color="#16a34a" style={{ marginBottom: "8px" }} /><p style={{ fontSize: "14px", fontWeight: 600, color: "#16a34a", margin: "0 0 4px" }}>{file.name}</p><p style={{ fontSize: "12px", color: "#64748b", margin: 0 }}>{(file.size / 1024 / 1024).toFixed(2)} MB</p></div>) : (<div><Upload size={32} color="#94a3b8" style={{ marginBottom: "8px" }} /><p style={{ fontSize: "14px", fontWeight: 600, color: "#475569", margin: "0 0 4px" }}>Cliquez pour sélectionner</p><p style={{ fontSize: "12px", color: "#94a3b8", margin: 0 }}>PDF du règlement PLU</p></div>)}
        </div>
        {targetZoneCode && (<div style={{ marginTop: "12px", padding: "8px 12px", background: "#f3e8ff", borderRadius: "8px", fontSize: "12px", color: "#7c3aed" }}><strong>Zone cible:</strong> {targetZoneCode}</div>)}
        <button onClick={handleUploadAndParse} disabled={!file || uploading || pluServerStatus === "down"} style={{ ...styles.button, width: "100%", marginTop: "16px", background: !file || uploading || pluServerStatus === "down" ? "#e2e8f0" : "#0f172a", color: !file || uploading || pluServerStatus === "down" ? "#94a3b8" : "white", cursor: !file || uploading || pluServerStatus === "down" ? "not-allowed" : "pointer" }}>
          {uploading ? <><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />{progress}</> : <><FileText size={16} />Analyser le PLU</>}
        </button>
        {error && (<div style={{ marginTop: "12px", padding: "10px 12px", borderRadius: "8px", background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", fontSize: "12px" }}><strong>Erreur:</strong> {error}</div>)}
      </div>
    </div>
  );
}

interface PluFieldValue { value: string | number | null; unit?: string; note?: string; }
interface EditablePluFields { hauteur_max: PluFieldValue; ces_max: PluFieldValue; recul_voie: PluFieldValue; recul_limites: PluFieldValue; stationnement: PluFieldValue; pleine_terre: PluFieldValue; hauteur_faitage: PluFieldValue; cos: PluFieldValue; }

function PluInfoCard({ pluData, loading, onPluParsed }: { pluData: PluData | null; loading: boolean; onPluParsed?: (plu: PluData) => void; }) {
  const [showRaw, setShowRaw] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editableFields, setEditableFields] = useState<EditablePluFields>({ hauteur_max: { value: null, unit: 'm' }, ces_max: { value: null, unit: '%' }, recul_voie: { value: null, unit: 'm' }, recul_limites: { value: null, unit: 'm' }, stationnement: { value: null, unit: 'pl/logt' }, pleine_terre: { value: null, unit: '%' }, hauteur_faitage: { value: null, unit: 'm' }, cos: { value: null, unit: '' } });

  useEffect(() => {
    if (pluData?.ruleset) {
      const rs = pluData.ruleset as any;
      setEditableFields({ hauteur_max: { value: rs.hauteur?.hauteur_max_m ?? rs.hauteur?.hauteur_egout_m ?? null, unit: 'm', note: rs.hauteur?.note }, ces_max: { value: rs.emprise_sol?.emprise_sol_max != null ? (rs.emprise_sol.emprise_sol_max <= 1 ? rs.emprise_sol.emprise_sol_max * 100 : rs.emprise_sol.emprise_sol_max) : null, unit: '%', note: rs.emprise_sol?.note }, recul_voie: { value: rs.reculs?.voirie?.min_m ?? null, unit: 'm', note: rs.reculs?.voirie?.note }, recul_limites: { value: rs.reculs?.limites_separatives?.min_m ?? null, unit: 'm', note: rs.reculs?.limites_separatives?.note }, stationnement: { value: rs.stationnement?.places_par_logement ?? null, unit: 'pl/logt', note: rs.stationnement?.note }, pleine_terre: { value: rs.pleine_terre?.min_pct ?? null, unit: '%', note: rs.pleine_terre?.note }, hauteur_faitage: { value: rs.hauteur?.hauteur_faitage_m ?? null, unit: 'm' }, cos: { value: rs.densite?.cos_max ?? null, unit: '', note: rs.densite?.note } });
    }
  }, [pluData]);

  const handleFieldChange = (field: keyof EditablePluFields, newValue: string) => { setEditableFields(prev => ({ ...prev, [field]: { ...prev[field], value: newValue === '' ? null : parseFloat(newValue.replace(',', '.')) } })); };
  const formatDisplayValue = (field: PluFieldValue): string => { if (field.value === null || field.value === undefined) return '—'; if (field.note === "Pas de règle") return '—'; return `${field.value}${field.unit ? ' ' + field.unit : ''}`; };

  if (loading) { return (<div style={{ ...styles.card }}><div style={styles.cardHeader}><h3 style={styles.cardTitle}><FileText size={18} color="#8b5cf6" />Règles PLU</h3></div><div style={{ ...styles.cardBody, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px" }}><Loader2 size={24} color="#8b5cf6" style={{ animation: "spin 1s linear infinite" }} /><span style={{ marginLeft: "12px", color: "#64748b" }}>Chargement PLU...</span></div></div>); }

  const hasPluData = pluData?.found && pluData?.zone_code;
  const fieldsConfig: { key: keyof EditablePluFields; label: string }[] = [
    { key: 'hauteur_max', label: 'Hauteur max (égout)' }, { key: 'hauteur_faitage', label: 'Hauteur faîtage' },
    { key: 'ces_max', label: 'Emprise au sol (CES)' }, { key: 'recul_voie', label: 'Recul voie' },
    { key: 'recul_limites', label: 'Recul limites' }, { key: 'stationnement', label: 'Stationnement' },
    { key: 'pleine_terre', label: 'Pleine terre min' }, { key: 'cos', label: 'COS' }
  ];

  return (
    <div style={{ ...styles.card }}>
      <div style={styles.cardHeader}>
        <h3 style={styles.cardTitle}><FileText size={18} color="#8b5cf6" />Règles PLU</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {hasPluData && (<button onClick={() => setIsEditing(!isEditing)} style={{ padding: '4px 10px', background: isEditing ? '#fef3c7' : '#f1f5f9', border: 'none', borderRadius: '6px', fontSize: '11px', fontWeight: 600, color: isEditing ? '#92400e' : '#64748b', cursor: 'pointer' }}>{isEditing ? '✓ Terminer' : '✏️ Modifier'}</button>)}
          {pluData?.zone_code ? (<span style={{ ...styles.badge, background: "#f3e8ff", color: "#7c3aed" }}>Zone {pluData.zone_code}</span>) : (<span style={{ ...styles.badge, background: "#fef3c7", color: "#92400e" }}>Non disponible</span>)}
        </div>
      </div>
      <div style={styles.cardBody}>
        {hasPluData ? (
          <>
            <div style={{ padding: "12px 14px", background: "#f8fafc", borderRadius: "10px", marginBottom: "16px" }}><div style={{ fontSize: "11px", color: "#64748b", fontWeight: 600, textTransform: "uppercase" }}>Zone</div><div style={{ fontSize: "20px", fontWeight: 800, color: "#0f172a", marginTop: "2px" }}>{pluData.zone_code}</div><div style={{ fontSize: "13px", color: "#475569", marginTop: "4px" }}>{pluData.zone_libelle || "Zone urbaine"}</div></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
              {fieldsConfig.map(({ key, label }) => { const field = editableFields[key]; const hasValue = field.value !== null && field.note !== "Pas de règle"; return (<div key={key} style={{ padding: '12px', background: '#f8fafc', borderRadius: '10px', border: isEditing ? '1px solid #cbd5e1' : '1px solid #e2e8f0' }}><div style={{ fontSize: '10px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '4px' }}>{label}</div>{isEditing ? (<div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><input type="text" value={field.value ?? ''} onChange={(e) => handleFieldChange(key, e.target.value)} placeholder="—" style={{ width: '60px', padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '14px', fontWeight: 700, textAlign: 'center' }} /><span style={{ fontSize: '12px', color: '#64748b' }}>{field.unit}</span></div>) : (<div style={{ fontSize: '16px', fontWeight: 800, color: hasValue ? '#0f172a' : '#94a3b8' }}>{formatDisplayValue(field)}</div>)}{field.note && !isEditing && <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '2px', fontStyle: 'italic' }}>{field.note}</div>}</div>); })}
            </div>
            <div style={{ marginTop: '16px', padding: '10px 12px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', display: 'flex', alignItems: 'flex-start', gap: '8px' }}><AlertTriangle size={14} color="#d97706" style={{ marginTop: '1px', flexShrink: 0 }} /><p style={{ fontSize: '11px', color: '#92400e', margin: 0, lineHeight: '1.4' }}>Vérifiez les valeurs avec le document officiel.</p></div>
            <button onClick={() => setShowRaw(!showRaw)} style={{ ...styles.button, width: "100%", marginTop: "12px", background: "#f1f5f9", color: "#475569", padding: '8px 12px' }}>{showRaw ? <EyeOff size={14} /> : <Eye size={14} />}{showRaw ? "Masquer JSON" : "Voir JSON brut"}</button>
            {showRaw && pluData.raw && (<div style={{ marginTop: "12px", padding: "12px", background: "#0f172a", borderRadius: "8px", maxHeight: "200px", overflow: "auto" }}><pre style={{ margin: 0, fontSize: "11px", color: "#e2e8f0", whiteSpace: "pre-wrap" }}>{JSON.stringify(pluData.raw, null, 2)}</pre></div>)}
          </>
        ) : (<div style={{ textAlign: "center", padding: "20px" }}><AlertTriangle size={32} color="#f59e0b" style={{ marginBottom: "12px" }} /><p style={{ color: "#64748b", fontSize: "13px", margin: 0 }}>PLU non disponible. Importez le règlement PDF.</p></div>)}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROJECT SELECTOR
// ═══════════════════════════════════════════════════════════════════════════════
function ProjectSelector({ projectInfo, onProjectChange, onSearch, loading }: { projectInfo: ProjectInfo; onProjectChange: (updates: Partial<ProjectInfo>) => void; onSearch: (searchParams?: Partial<ProjectInfo>) => void; loading: boolean; }) {
  const [parcelInput, setParcelInput] = useState(projectInfo.parcelId || "");
  const [addressInput, setAddressInput] = useState(projectInfo.address || "");
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedAddress, setSelectedAddress] = useState<AddressSuggestion | null>(null);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const addressInputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => { if (projectInfo.parcelId && projectInfo.parcelId !== parcelInput) setParcelInput(projectInfo.parcelId); }, [projectInfo.parcelId]);
  useEffect(() => { const h = (e: MouseEvent) => { if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node) && addressInputRef.current && !addressInputRef.current.contains(e.target as Node)) setShowSuggestions(false); }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, []);

  const fetchAddressSuggestions = useCallback(async (query: string) => { if (query.length < 3) { setSuggestions([]); return; } setIsLoadingSuggestions(true); try { const r = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query)}&limit=6&autocomplete=1`); const d = await r.json(); if (d.features && Array.isArray(d.features)) { setSuggestions(d.features.map((f: any) => ({ label: f.properties.label, housenumber: f.properties.housenumber, street: f.properties.street, postcode: f.properties.postcode, city: f.properties.city, citycode: f.properties.citycode, context: f.properties.context, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], id: f.properties.id }))); setShowSuggestions(true); } } catch { setSuggestions([]); } finally { setIsLoadingSuggestions(false); } }, []);
  const handleAddressChange = useCallback((value: string) => { setAddressInput(value); setSelectedAddress(null); if (debounceRef.current) clearTimeout(debounceRef.current); debounceRef.current = setTimeout(() => fetchAddressSuggestions(value), 300); }, [fetchAddressSuggestions]);
  const handleSelectSuggestion = useCallback((s: AddressSuggestion) => { setAddressInput(s.label); setSelectedAddress(s); setShowSuggestions(false); setSuggestions([]); onProjectChange({ address: s.label, communeInsee: s.citycode || undefined, addressLat: s.lat, addressLon: s.lon }); }, [onProjectChange]);
  const handleSubmit = (e?: React.FormEvent) => { e?.preventDefault(); let insee = extractCommuneInsee(parcelInput); if (!insee && selectedAddress?.citycode) insee = selectedAddress.citycode; const sp: Partial<ProjectInfo> = { parcelId: parcelInput || undefined, communeInsee: insee || undefined, address: addressInput || undefined, addressLat: selectedAddress?.lat, addressLon: selectedAddress?.lon }; onProjectChange(sp); onSearch(sp); };
  const canSubmit = parcelInput.length > 0 || selectedAddress !== null;

  return (
    <div style={{ ...styles.card, marginBottom: "20px" }}>
      <div style={styles.cardHeader}><h3 style={styles.cardTitle}><MapPinned size={18} color="#3b82f6" />Localisation du projet</h3></div>
      <form onSubmit={handleSubmit} style={styles.cardBody}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
          <div><label style={styles.inputLabel}>Identifiant de parcelle</label><input type="text" value={parcelInput} onChange={(e) => setParcelInput(e.target.value.toUpperCase())} placeholder="ex: 64065000AI0001" style={styles.input} /><p style={{ fontSize: "11px", color: "#94a3b8", margin: "4px 0 0" }}>Format: code INSEE + section + numéro</p></div>
          <div style={{ position: "relative" }}>
            <label style={styles.inputLabel}>Adresse {selectedAddress && <span style={{ marginLeft: "8px", color: "#16a34a", fontWeight: 500, fontSize: "10px", background: "#f0fdf4", padding: "2px 6px", borderRadius: "4px" }}>✓ Sélectionnée</span>}</label>
            <div style={{ position: "relative" }}><input ref={addressInputRef} type="text" value={addressInput} onChange={(e) => handleAddressChange(e.target.value)} onFocus={() => suggestions.length > 0 && setShowSuggestions(true)} placeholder="Tapez une adresse..." style={{ ...styles.input, paddingRight: "36px", borderColor: selectedAddress ? "#86efac" : "#e2e8f0", background: selectedAddress ? "#f0fdf4" : "white" }} /><div style={{ position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)", display: "flex", alignItems: "center" }}>{isLoadingSuggestions ? <Loader2 size={16} color="#94a3b8" style={{ animation: "spin 1s linear infinite" }} /> : addressInput && <button type="button" onClick={() => { setAddressInput(""); setSelectedAddress(null); setSuggestions([]); addressInputRef.current?.focus(); }} style={{ background: "none", border: "none", cursor: "pointer", padding: "2px", display: "flex", alignItems: "center" }}><X size={14} color="#94a3b8" /></button>}</div></div>
            {showSuggestions && suggestions.length > 0 && (<div ref={suggestionsRef} style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "white", border: "1px solid #e2e8f0", borderRadius: "10px", boxShadow: "0 10px 25px rgba(0,0,0,0.15)", zIndex: 1000, maxHeight: "280px", overflow: "auto" }}>{suggestions.map((s, idx) => (<div key={s.id || idx} onClick={() => handleSelectSuggestion(s)} style={{ padding: "12px 14px", cursor: "pointer", borderBottom: idx < suggestions.length - 1 ? "1px solid #f1f5f9" : "none", transition: "background 0.15s" }} onMouseEnter={(e) => { e.currentTarget.style.background = "#f8fafc"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "white"; }}><div style={{ fontSize: "13px", fontWeight: 600, color: "#0f172a", display: "flex", alignItems: "center", gap: "8px" }}><MapPin size={14} color="#3b82f6" />{s.label}</div><div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px", marginLeft: "22px" }}>{s.context}{s.citycode && <span style={{ marginLeft: "8px", background: "#e0f2fe", color: "#0369a1", padding: "1px 6px", borderRadius: "4px", fontSize: "10px", fontWeight: 600 }}>INSEE {s.citycode}</span>}</div></div>))}</div>)}
            <p style={{ fontSize: "11px", color: "#94a3b8", margin: "4px 0 0" }}>{selectedAddress ? `Code INSEE: ${selectedAddress.citycode}` : "Sélectionnez une suggestion"}</p>
          </div>
        </div>
        {!parcelInput && !selectedAddress && (<div style={{ marginTop: "12px", padding: "10px 14px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: "8px", display: "flex", alignItems: "center", gap: "10px" }}><Info size={16} color="#3b82f6" /><p style={{ fontSize: "12px", color: "#1e40af", margin: 0 }}>Renseignez l'identifiant de parcelle <strong>ou</strong> sélectionnez une adresse.</p></div>)}
        <button type="submit" disabled={loading || !canSubmit} style={{ ...styles.button, marginTop: "16px", background: loading || !canSubmit ? "#e2e8f0" : "#0f172a", color: loading || !canSubmit ? "#94a3b8" : "white", cursor: loading || !canSubmit ? "not-allowed" : "pointer" }}>{loading ? <><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />Recherche...</> : <><Search size={16} />Rechercher la parcelle</>}</button>
      </form>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PARCELS SIDEBAR
// ═══════════════════════════════════════════════════════════════════════════════
function ParcelsSidebar({ selectedParcels, totalAreaM2, onRemoveParcel, onClearAll, onValidateSelection, onAddManualParcel, onUpdateParcelArea, isValid, validationMessage, isValidated }: {
  selectedParcels: SelectedParcel[]; totalAreaM2: number | null;
  onRemoveParcel: (id: string) => void; onClearAll: () => void; onValidateSelection: () => void;
  onAddManualParcel: (id: string, area_m2: number | null) => void;
  onUpdateParcelArea: (id: string, area_m2: number) => void;
  isValid: boolean; validationMessage?: string | null; isValidated: boolean;
}) {
  const [manualId, setManualId] = useState("");
  const [manualArea, setManualArea] = useState("");
  const idInputRef = useRef<HTMLInputElement>(null);

  const handleAddManual = () => {
    const id = manualId.trim().toUpperCase();
    if (!id) return;
    const area = manualArea ? parseFloat(manualArea.replace(",", ".")) : null;
    onAddManualParcel(id, area && !isNaN(area) ? Math.round(area) : null);
    setManualId("");
    setManualArea("");
    idInputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); handleAddManual(); }
  };

  return (
    <div style={{ ...styles.card }}>
      <div style={styles.cardHeader}>
        <h3 style={styles.cardTitle}><Layers size={18} color="#0ea5e9" />Parcelles ({selectedParcels.length})</h3>
        {selectedParcels.length > 0 && <button onClick={onClearAll} style={{ padding: "4px 8px", background: "#fef2f2", border: "none", borderRadius: "6px", color: "#dc2626", fontSize: "11px", fontWeight: 600, cursor: "pointer" }}>Tout effacer</button>}
      </div>

      {/* ── Manual add form ──────────────────────────────────────────────── */}
      <div style={{ padding: "14px 18px", borderBottom: "1px solid #e2e8f0", background: "#f8fafc" }}>
        <div style={{ fontSize: "11px", fontWeight: 600, color: "#475569", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.3px" }}>Ajouter une parcelle</div>
        <div style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <input
              ref={idInputRef}
              type="text"
              value={manualId}
              onChange={(e) => setManualId(e.target.value.toUpperCase())}
              onKeyDown={handleKeyDown}
              placeholder="N° parcelle"
              style={{ ...styles.input, fontSize: "12px", padding: "8px 10px" }}
            />
          </div>
          <div style={{ width: "90px" }}>
            <input
              type="text"
              value={manualArea}
              onChange={(e) => setManualArea(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="m²"
              style={{ ...styles.input, fontSize: "12px", padding: "8px 10px", textAlign: "right" }}
            />
          </div>
          <button
            onClick={handleAddManual}
            disabled={!manualId.trim()}
            style={{
              ...styles.button,
              padding: "8px 12px",
              background: manualId.trim() ? "#0f172a" : "#e2e8f0",
              color: manualId.trim() ? "white" : "#94a3b8",
              cursor: manualId.trim() ? "pointer" : "not-allowed",
              borderRadius: "8px",
              fontSize: "16px",
              fontWeight: 700,
              minWidth: "38px",
            }}
            title="Ajouter"
          >+</button>
        </div>
        <p style={{ fontSize: "10px", color: "#94a3b8", margin: "4px 0 0" }}>Ex: 64065000AI0001 — la surface est récupérée automatiquement</p>
      </div>

      {/* ── Parcel list ──────────────────────────────────────────────────── */}
      <div style={{ ...styles.cardBody, maxHeight: "300px", overflow: "auto", padding: "12px 18px" }}>
        {selectedParcels.length === 0 ? (
          <div style={{ textAlign: "center", padding: "20px", color: "#94a3b8", fontSize: "13px" }}>
            <Layers size={24} style={{ marginBottom: "8px", opacity: 0.5 }} />
            <p style={{ margin: 0 }}>Aucune parcelle</p>
            <p style={{ margin: "4px 0 0", fontSize: "12px" }}>Ajoutez manuellement ou cliquez sur la carte</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {selectedParcels.map((p) => (
              <div key={p.id} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "8px 10px", background: isValidated ? "#f0fdf4" : "#f8fafc",
                borderRadius: "8px", border: `1px solid ${isValidated ? "#bbf7d0" : "#e2e8f0"}`,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "12px", fontWeight: 600, color: "#0f172a", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.id}</div>
                  {/* Editable area */}
                  <div style={{ display: "flex", alignItems: "center", gap: "4px", marginTop: "2px" }}>
                    <input
                      type="text"
                      value={p.area_m2 != null ? String(p.area_m2) : ""}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value.replace(",", "."));
                        if (!isNaN(v) && v > 0) onUpdateParcelArea(p.id, Math.round(v));
                      }}
                      placeholder="—"
                      style={{
                        width: "70px", padding: "2px 6px", border: "1px solid #e2e8f0",
                        borderRadius: "4px", fontSize: "11px", fontWeight: 600,
                        color: "#475569", textAlign: "right", background: "white",
                        outline: "none",
                      }}
                    />
                    <span style={{ fontSize: "10px", color: "#94a3b8" }}>m²</span>
                  </div>
                </div>
                <button onClick={() => onRemoveParcel(p.id)} style={{
                  padding: "4px 6px", background: "white", border: "1px solid #fecaca",
                  borderRadius: "4px", color: "#dc2626", cursor: "pointer",
                  display: "flex", alignItems: "center", marginLeft: "8px",
                }}><X size={12} /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Total + validate ─────────────────────────────────────────────── */}
      {selectedParcels.length > 0 && (
        <div style={{ padding: "14px 18px", borderTop: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "13px", fontWeight: 600, color: "#334155" }}>Surface totale</span>
          <span style={{ fontSize: "18px", fontWeight: 800, color: "#0f172a", background: "#e0f2fe", padding: "6px 14px", borderRadius: "8px" }}>
            {totalAreaM2 != null ? formatAreaM2(totalAreaM2) : <span style={{ color: "#94a3b8", fontSize: "13px" }}>Renseignez les m²</span>}
          </span>
        </div>
      )}
      <div style={{ padding: "0 18px 18px" }}>
        <button onClick={onValidateSelection} disabled={!isValid} style={{
          ...styles.button, width: "100%",
          background: isValidated ? "#16a34a" : isValid ? "#10b981" : "#e2e8f0",
          color: isValid ? "white" : "#94a3b8",
          cursor: isValid ? "pointer" : "not-allowed",
        }}>
          {isValidated ? <><Check size={16} />Sélection validée</> : <><Check size={16} />Valider la sélection</>}
        </button>
        {validationMessage && (
          <div style={{ marginTop: "10px", padding: "8px 12px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "8px", display: "flex", alignItems: "center", gap: "8px" }}>
            <Check size={14} color="#16a34a" />
            <span style={{ fontSize: "12px", color: "#166534", fontWeight: 500 }}>{validationMessage}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════
export function FoncierPluPage() {
  const [searchParams] = useSearchParams();
  const studyId = searchParams.get("study");
  const mapRef = useRef<L.Map | null>(null);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [mapCenter, setMapCenter] = useState<[number, number] | null>(null);
  const [projectInfo, setProjectInfo] = useState<ProjectInfo>({});
  const [selectedParcels, setSelectedParcels] = useState<SelectedParcel[]>([]);
  const [pluData, setPluData] = useState<PluData | null>(null);
  const [pluLoading, setPluLoading] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [focusFeature, setFocusFeature] = useState<any>(null);

  const hasProject = !!(mapCenter && projectInfo.communeInsee);
  const totalAreaM2 = useMemo(() => { const a = selectedParcels.map(p => p.area_m2).filter((v): v is number => typeof v === "number"); return a.length > 0 ? a.reduce((s, v) => s + v, 0) : null; }, [selectedParcels]);

  const fetchPlu = useCallback(async () => {
    if (!projectInfo.parcelId || !projectInfo.communeInsee) return;
    setPluLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("plu-from-parcelle-v2", { body: { parcel_id: projectInfo.parcelId, commune_insee: projectInfo.communeInsee } });
      if (error) throw error;
      setPluData({ zone_code: data?.plu?.zone_code || data?.zone_code, zone_libelle: data?.plu?.zone_libelle || data?.zone_libelle, ruleset: data?.plu?.ruleset || data?.ruleset, raw: data, found: data?.plu?.found ?? data?.success ?? false });
    } catch (err) { console.error("[PLU] error:", err); setPluData({ found: false }); }
    finally { setPluLoading(false); }
  }, [projectInfo.parcelId, projectInfo.communeInsee]);

  const fetchParcelAndCenter = useCallback(async (parcelId: string, communeInsee: string) => {
    console.log(`[Search] Fetching parcel: ${parcelId}`);
    try {
      const { data, error } = await supabase.functions.invoke("cadastre-parcelle-by-id", { body: { parcel_id: parcelId, commune_insee: communeInsee } });
      if (error || !data?.feature?.geometry) { console.warn("[Search] Could not fetch parcel geometry"); return null; }
      const feature = normalizeSingleFeature(data.feature, `parcel-by-id:${parcelId}`);
      const boundsData = getFeatureBoundsCenter(feature);
      if (boundsData) return { feature, center: boundsData.center };
      return null;
    } catch (e) { console.error("[Search] Error:", e); return null; }
  }, []);

  const handleSearch = useCallback(async (sp?: Partial<ProjectInfo>) => {
    const params = sp ? { ...projectInfo, ...sp } : projectInfo;
    if (!params.parcelId && !params.addressLat) return;
    setSearchLoading(true); setFocusFeature(null);
    if (params.parcelId) localStorage.setItem("mimmoza.session.parcel_id", params.parcelId);
    if (params.communeInsee) localStorage.setItem("mimmoza.session.commune_insee", params.communeInsee);
    if (params.parcelId && params.communeInsee) {
      const pd = await fetchParcelAndCenter(params.parcelId, params.communeInsee);
      if (pd?.feature && pd?.center) {
        const area = getFeatureArea(pd.feature);
        setSelectedParcels(prev => prev.some(p => p.id === params.parcelId) ? prev : [...prev, { id: params.parcelId!, feature: pd.feature, area_m2: area }]);
        setMapCenter(pd.center); setFocusFeature(pd.feature);
      } else {
        setSelectedParcels(prev => prev.some(p => p.id === params.parcelId) ? prev : [...prev, { id: params.parcelId! }]);
      }
      if (sp) setProjectInfo(prev => ({ ...prev, ...sp }));
      await fetchPlu();
    } else if (params.addressLat && params.addressLon && params.communeInsee) {
      setMapCenter([params.addressLat, params.addressLon]);
      if (sp) setProjectInfo(prev => ({ ...prev, ...sp }));
    }
    setSearchLoading(false);
  }, [projectInfo, fetchPlu, fetchParcelAndCenter]);

  const handleProjectChange = useCallback((u: Partial<ProjectInfo>) => setProjectInfo(p => ({ ...p, ...u })), []);
  const handleToggleParcel = useCallback((pid: string, feature?: any, area_m2?: number | null) => {
    setSelectedParcels(prev => {
      if (prev.some(p => p.id === pid)) return prev.filter(p => p.id !== pid);
      // If feature has contenance, use it
      const contenance = feature?.properties?.contenance;
      const finalArea = area_m2 || contenance || null;
      return [...prev, { id: pid, feature, area_m2: finalArea }];
    });
    setIsValidated(false);
  }, []);
  const handleRemoveParcel = useCallback((pid: string) => { setSelectedParcels(prev => prev.filter(p => p.id !== pid)); setIsValidated(false); }, []);
  const handleClearAll = useCallback(() => { setSelectedParcels([]); setIsValidated(false); }, []);
  const [isValidated, setIsValidated] = useState(false);

  const handleAddManualParcel = useCallback((id: string, area_m2: number | null) => {
    // Add immediately with provided area (or null)
    setSelectedParcels(prev => {
      if (prev.some(p => p.id === id)) return prev;
      return [...prev, { id, area_m2 }];
    });
    setIsValidated(false);

    // Auto-fetch surface from IGN cadastre if no area provided
    if (area_m2 == null || area_m2 === 0) {
      const insee = extractCommuneInsee(id);
      if (insee && id.length >= 10) {
        // Parse parcel ID: 64065 000 AI 0001
        // Format: code_insee(5) + prefixe(3) + section(2) + numero(4)
        const afterInsee = id.slice(5);
        // Try to extract section + numero
        const match = afterInsee.match(/(?:\d{0,3})([A-Z]{1,2})(\d{1,4})$/);
        if (match) {
          const section = match[1];
          const numero = match[2];
          const url = `https://apicarto.ign.fr/api/cadastre/parcelle?code_insee=${insee}&section=${section}&numero=${numero.padStart(4, "0")}&_limit=1`;
          console.log(`[Parcels] Auto-fetch surface: ${url}`);
          fetch(url)
            .then(r => r.ok ? r.json() : null)
            .then(data => {
              const feat = data?.features?.[0];
              if (feat) {
                const contenance = feat.properties?.contenance;
                const calcArea = contenance || calculatePolygonArea(feat.geometry);
                if (calcArea && calcArea > 0) {
                  console.log(`[Parcels] ✅ Auto surface for ${id}: ${calcArea} m²`);
                  setSelectedParcels(prev => prev.map(p =>
                    p.id === id && (p.area_m2 == null || p.area_m2 === 0)
                      ? { ...p, area_m2: Math.round(calcArea), feature: feat }
                      : p
                  ));
                }
              }
            })
            .catch(e => console.warn(`[Parcels] Auto-fetch failed for ${id}:`, e.message));
        }
      }
    }
  }, []);

  const handleUpdateParcelArea = useCallback((id: string, area_m2: number) => {
    setSelectedParcels(prev => prev.map(p => p.id === id ? { ...p, area_m2 } : p));
    setIsValidated(false);
  }, []);

  const handleValidateSelection = useCallback(() => {
    if (selectedParcels.length === 0) return;
    const parcelIds = selectedParcels.map(p => p.id);
    const primary = selectedParcels[0];
    const insee = extractCommuneInsee(primary.id);
    setProjectInfo(prev => ({ ...prev, parcelId: primary.id, parcelIds, communeInsee: insee || prev.communeInsee, surfaceM2: totalAreaM2 || undefined }));
    localStorage.setItem("mimmoza.promoteur.foncier.selected_v1", JSON.stringify(selectedParcels));
    localStorage.setItem("mimmoza.promoteur.foncier.focus_v1", primary.id);
    if (insee) localStorage.setItem("mimmoza.promoteur.foncier.commune_v1", insee);
    localStorage.setItem("mimmoza.session.parcel_id", primary.id);
    localStorage.setItem("mimmoza.session.parcel_ids", JSON.stringify(parcelIds));
    if (insee) localStorage.setItem("mimmoza.session.commune_insee", insee);
    if (totalAreaM2) localStorage.setItem("mimmoza.session.surface_m2", String(totalAreaM2));
    localStorage.removeItem("mimmoza.plu.resolved_ruleset_v1");
    localStorage.removeItem("mimmoza.plu.ai_extract_result");
    localStorage.removeItem("mimmoza.plu.detected_zone_code");
    localStorage.removeItem("mimmoza.plu.selected_zone_code");
    localStorage.removeItem("mimmoza.plu.selected_document_id");
    localStorage.removeItem("mimmoza.plu.selected_commune_insee");
    setValidationMessage(`✓ ${parcelIds.length} parcelle${parcelIds.length > 1 ? 's' : ''} validée${parcelIds.length > 1 ? 's' : ''} (${formatAreaM2(totalAreaM2)})`);
    setIsValidated(true);
    setTimeout(() => setValidationMessage(null), 5000);
  }, [selectedParcels, totalAreaM2]);

  const handlePluParsed = useCallback((plu: PluData) => setPluData(plu), []);

  const handleReset = useCallback(() => {
    setProjectInfo({}); setSelectedParcels([]); setPluData(null); setMapCenter(null); setFocusFeature(null);
    ["mimmoza.session.parcel_id","mimmoza.session.commune_insee","mimmoza.session.parcel_ids","mimmoza.session.surface_m2","mimmoza.promoteur.foncier.selected_v1","mimmoza.promoteur.foncier.focus_v1","mimmoza.promoteur.foncier.commune_v1","mimmoza.plu.resolved_ruleset_v1","mimmoza.plu.ai_extract_result","mimmoza.plu.detected_zone_code","mimmoza.plu.selected_zone_code","mimmoza.plu.selected_document_id","mimmoza.plu.selected_commune_insee"].forEach(k => localStorage.removeItem(k));
  }, []);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>
          <Building2 size={28} color="#0f172a" />Foncier & PLU
          {studyId && <span style={{ fontSize: "11px", fontWeight: 500, color: "#64748b", background: "#f1f5f9", padding: "4px 8px", borderRadius: "6px", marginLeft: "8px" }}>Étude: {studyId.slice(0, 8)}…</span>}
        </h1>
        <p style={styles.subtitle}>Sélectionnez votre terrain et consultez les règles d'urbanisme.</p>
      </div>

      {hasProject ? (
        <div style={{ ...styles.card, marginBottom: "20px", padding: "12px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <MapPinned size={20} color="#3b82f6" />
            <div>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "#0f172a", fontFamily: "monospace" }}>{projectInfo.parcelId || projectInfo.address || "—"}</div>
              <div style={{ fontSize: "12px", color: "#64748b" }}>INSEE {projectInfo.communeInsee} • {formatAreaM2(totalAreaM2)}</div>
            </div>
          </div>
          <button onClick={handleReset} style={{ ...styles.button, padding: "8px 14px", background: "#f1f5f9", color: "#475569" }}><RefreshCw size={14} />Changer</button>
        </div>
      ) : (
        <ProjectSelector projectInfo={projectInfo} onProjectChange={handleProjectChange} onSearch={handleSearch} loading={searchLoading} />
      )}

      {hasProject ? (
        <div style={styles.grid}>
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <div style={{ ...styles.card }}>
              <div style={styles.cardHeader}><h3 style={styles.cardTitle}><MapPin size={18} color="#3b82f6" />Carte cadastrale</h3><span style={{ ...styles.badge, background: "#dbeafe", color: "#1d4ed8" }}>INSEE {projectInfo.communeInsee}</span></div>
              <ParcelMapSelector communeInsee={projectInfo.communeInsee!} selectedIds={selectedParcels.map(p => p.id)} onToggleParcel={handleToggleParcel} focusParcelId={projectInfo.parcelId} focusFeature={focusFeature} heightPx={380} onMapReady={(map) => { mapRef.current = map; }} mapCenter={mapCenter} />
            </div>
            <PluInfoCard pluData={pluData} loading={pluLoading} onPluParsed={handlePluParsed} />
            {projectInfo.communeInsee && <PluUploaderPanel communeInsee={projectInfo.communeInsee} communeNom={projectInfo.address} targetZoneCode={pluData?.zone_code} onPluParsed={handlePluParsed} />}
          </div>
          <div>
            <ParcelsSidebar selectedParcels={selectedParcels} totalAreaM2={totalAreaM2} onRemoveParcel={handleRemoveParcel} onClearAll={handleClearAll} onValidateSelection={handleValidateSelection} onAddManualParcel={handleAddManualParcel} onUpdateParcelArea={handleUpdateParcelArea} isValid={selectedParcels.length > 0} validationMessage={validationMessage} isValidated={isValidated} />
            <div style={{ ...styles.card, marginTop: "20px" }}>
              <div style={styles.cardHeader}><h3 style={styles.cardTitle}><Navigation size={18} color="#10b981" />Étapes suivantes</h3></div>
              <div style={styles.cardBody}>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <a href={`/promoteur/implantation-2d${studyId ? `?study=${studyId}` : ""}`} style={{ ...styles.button, background: "#f1f5f9", color: "#475569", textDecoration: "none" }}><Layers size={16} />Implantation 2D</a>
                  <a href={`/promoteur/marche${studyId ? `?study=${studyId}` : ""}`} style={{ ...styles.button, background: "#f1f5f9", color: "#475569", textDecoration: "none" }}><Building2 size={16} />Étude de marché</a>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ ...styles.card, padding: "60px 40px", textAlign: "center" }}>
          <div style={{ width: "80px", height: "80px", borderRadius: "50%", background: "#e0f2fe", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px" }}><MapPin size={36} color="#0284c7" /></div>
          <h2 style={{ fontSize: "20px", fontWeight: 700, color: "#0f172a", margin: "0 0 12px" }}>Commencez par localiser votre projet</h2>
          <p style={{ fontSize: "14px", color: "#64748b", margin: "0 0 24px", maxWidth: "400px", marginLeft: "auto", marginRight: "auto" }}>Entrez l'identifiant de la parcelle cadastrale ou recherchez par adresse.</p>
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .leaflet-container { font-family: inherit; }
        .leaflet-interactive { outline: none !important; }
        .leaflet-interactive:focus { outline: none !important; }
        path.leaflet-interactive { outline: none !important; }
        path.leaflet-interactive:focus { outline: none !important; }
        .leaflet-tooltip.parcel-tooltip { background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); font-family: 'Inter', -apple-system, sans-serif; }
        .leaflet-tooltip.parcel-tooltip::before { display: none; }
      `}</style>
    </div>
  );
}

export default FoncierPluPage;