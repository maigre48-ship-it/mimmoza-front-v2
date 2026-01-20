// PARTIE 1/3
// src/spaces/promoteur/Implantation2DPage.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useNavigate, useLocation } from "react-router-dom";
import {
  MapContainer,
  TileLayer,
  GeoJSON,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import type {
  Feature,
  FeatureCollection,
  Polygon,
  MultiPolygon,
  Geometry,
  LineString,
  Point,
  Position,
} from "geojson";
import * as turf from "@turf/turf";
import type {
  ImplantationUserParams,
  ImplantationResult,
  PluRules,
} from "./types";
import computeImplantationV1 from "./implantation";

// Geoman imports
import "@geoman-io/leaflet-geoman-free";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const RESOLVED_RULESET_LOCALSTORAGE_KEY = "mimmoza.plu.resolved_ruleset_v1";

// -----------------------------------------------------------------------------
// LocalStorage keys pour fallback
// -----------------------------------------------------------------------------
const LS_KEYS = {
  COMMUNE_INSEE_SELECTED: "mimmoza.plu.selected_commune_insee",
  COMMUNE_INSEE_LAST: "mimmoza.plu.last_commune_insee",
  PARCEL_ID_SELECTED: "mimmoza.foncier.selected_parcel_id",
  PARCEL_ID_LAST: "mimmoza.foncier.last_parcel_id",
} as const;

// -----------------------------------------------------------------------------
// Type pour le ruleset PLU resolu
// -----------------------------------------------------------------------------
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
  [key: string]: any;
}

type LocationState = {
  parcelGeometry?: any;
  surfaceTerrainM2?: number | null;
  pluRules?: PluRules | null;
  massing?: any | null;
  pluRuleset?: ResolvedPluRuleset | null;
  // Support des deux conventions de nommage
  parcelId?: string | null;
  parcel_id?: string | null;
  communeInsee?: string | null;
  commune_insee?: string | null;
};

// -----------------------------------------------------------------------------
// Helpers : lecture localStorage (safe)
// -----------------------------------------------------------------------------
function safeGetLocalStorage(key: string): string | null {
  try {
    if (typeof window === "undefined") return null;
    const value = localStorage.getItem(key);
    return value && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// Helpers : resolution des parametres avec fallback
// -----------------------------------------------------------------------------
function resolveParcelId(
  queryParam: string | null,
  locationState: LocationState | null
): string | null {
  // Priorité 1 : query param
  if (queryParam && queryParam.trim()) {
    return queryParam.trim();
  }
  // Priorité 2 : location.state (deux conventions)
  if (locationState) {
    const fromState =
      locationState.parcelId ??
      locationState.parcel_id ??
      null;
    if (fromState && String(fromState).trim()) {
      return String(fromState).trim();
    }
  }
  // Priorité 3 : localStorage (selected puis last)
  const selected = safeGetLocalStorage(LS_KEYS.PARCEL_ID_SELECTED);
  if (selected) return selected;
  const last = safeGetLocalStorage(LS_KEYS.PARCEL_ID_LAST);
  if (last) return last;
  // Aucun fallback trouvé
  return null;
}

function resolveCommuneInsee(
  queryParam: string | null,
  locationState: LocationState | null
): string | null {
  // Priorité 1 : query param
  if (queryParam && queryParam.trim()) {
    return queryParam.trim();
  }
  // Priorité 2 : location.state (deux conventions)
  if (locationState) {
    const fromState =
      locationState.communeInsee ??
      locationState.commune_insee ??
      null;
    if (fromState && String(fromState).trim()) {
      return String(fromState).trim();
    }
  }
  // Priorité 3 : localStorage (selected puis last)
  const selected = safeGetLocalStorage(LS_KEYS.COMMUNE_INSEE_SELECTED);
  if (selected) return selected;
  const last = safeGetLocalStorage(LS_KEYS.COMMUNE_INSEE_LAST);
  if (last) return last;
  // Aucun fallback trouvé
  return null;
}

// -----------------------------------------------------------------------------
// Helpers : lecture et validation du ruleset resolu
// -----------------------------------------------------------------------------
function loadResolvedRulesetFromLocalStorage(): ResolvedPluRuleset | null {
  try {
    // 1) Verifier que window existe (SSR safety)
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem(RESOLVED_RULESET_LOCALSTORAGE_KEY);
    if (!raw) return null;
    // 2) JSON.parse safe
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    // 3) Verifier typeof object
    if (!parsed || typeof parsed !== "object") return null;
    // 4) Verifier version === "plu_ruleset_v1"
    if ((parsed as any).version !== "plu_ruleset_v1") return null;
    return parsed as ResolvedPluRuleset;
  } catch {
    return null;
  }
}

function isValidResolvedRuleset(
  ruleset: ResolvedPluRuleset | null | undefined
): ruleset is ResolvedPluRuleset {
  if (!ruleset || typeof ruleset !== "object") return false;
  if (ruleset.version !== "plu_ruleset_v1") return false;
  if (!ruleset.completeness || ruleset.completeness.ok !== true) return false;
  return true;
}

function extractReculsFromRuleset(ruleset: ResolvedPluRuleset): {
  avant: number | null;
  lateral: number | null;
  fond: number | null;
  mode: "DIRECTIONAL_BY_FACADE" | "UNIFORM";
} {
  const facades = ruleset.reculs?.facades;
  // FIX: hasFacades doit etre true uniquement si au moins un min_m est un number (pas null)
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
    // Priorite aux valeurs facades.*
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
  // Fallback vers les valeurs uniformes du PLU
  avant = toNumberLooseNullable(ruleset.reculs?.voirie?.min_m);
  lateral = toNumberLooseNullable(ruleset.reculs?.limites_separatives?.min_m);
  fond = toNumberLooseNullable(ruleset.reculs?.fond_parcelle?.min_m);
  return { avant, lateral, fond, mode: "UNIFORM" };
}

// -----------------------------------------------------------------------------
// Helpers Leaflet : fit bounds
// -----------------------------------------------------------------------------
function FitToFeature({ feature }: { feature: any }) {
  const map = useMap();
  useEffect(() => {
    if (!feature) return;
    try {
      const b = turf.bbox(feature);
      const bounds: any = [
        [b[1], b[0]],
        [b[3], b[2]],
      ];
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 21 });
    } catch {
      // ignore
    }
  }, [feature, map]);
  return null;
}

// -----------------------------------------------------------------------------
// Geoman Toolbar Component
// -----------------------------------------------------------------------------
function GeomanToolbar({
  enabled,
  onCreated,
}: {
  enabled: boolean;
  onCreated: (feature: Feature<Polygon | MultiPolygon>) => void;
}) {
  const map = useMap();

  useEffect(() => {
    if (!map) return;

    // Handler for pm:create event
    const handleCreate = (e: any) => {
      const layer = e.layer;
      if (!layer) return;

      try {
        // Convert layer to GeoJSON
        const geojson = layer.toGeoJSON();
        
        // Normalize to Feature<Polygon | MultiPolygon>
        const normalized = normalizeToFeature(geojson);
        
        if (normalized) {
          onCreated(normalized);
        }

        // Remove the drawn layer from map (we manage it via React state)
        map.removeLayer(layer);
      } catch (err) {
        console.warn("[GeomanToolbar] Error processing created shape:", err);
        // Still remove the layer to avoid duplicates
        try {
          map.removeLayer(layer);
        } catch {
          // ignore
        }
      }
    };

    if (enabled) {
      // Add Geoman controls with only rectangle and polygon
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

      // Set global options for drawing
      map.pm.setGlobalOptions({
        snappable: true,
        snapDistance: 10,
        allowSelfIntersection: false,
        finishOn: "dblclick",
        templineStyle: {
          color: "#0ea5e9",
          weight: 2,
          dashArray: "5,5",
        },
        hintlineStyle: {
          color: "#0ea5e9",
          weight: 2,
          dashArray: "5,5",
        },
        pathOptions: {
          color: "#0ea5e9",
          fillColor: "#bae6fd",
          fillOpacity: 0.4,
          weight: 2,
        },
      });

      // Listen for shape creation
      map.on("pm:create", handleCreate);
    } else {
      // Remove controls and disable drawing
      map.pm.removeControls();
      map.pm.disableDraw();
    }

    // Cleanup
    return () => {
      map.off("pm:create", handleCreate);
      if (!enabled) {
        // Already cleaned up above
      } else {
        map.pm.removeControls();
        map.pm.disableDraw();
      }
    };
  }, [map, enabled, onCreated]);

  return null;
}

// -----------------------------------------------------------------------------
// Cartouche reculs
// -----------------------------------------------------------------------------
function MapReculsControl({
  reculs,
}: {
  reculs: {
    recul_avant_m: number | null;
    recul_lateral_m: number | null;
    recul_fond_m: number | null;
    reculMax: number;
    source: "plu";
    mode?: "DIRECTIONAL_BY_FACADE" | "UNIFORM";
  } | null;
}) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    const control = L.control({ position: "topright" });
    control.onAdd = () => {
      const div = L.DomUtil.create("div");
      div.style.background = "rgba(2, 6, 23, 0.92)";
      div.style.border = "1px solid rgba(148,163,184,0.35)";
      div.style.borderRadius = "12px";
      div.style.padding = "10px 12px";
      div.style.color = "white";
      div.style.fontSize = "12px";
      div.style.lineHeight = "1.35";
      div.style.boxShadow = "0 20px 40px rgba(15,23,42,0.45)";
      div.style.minWidth = "210px";
      div.style.pointerEvents = "auto";

      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.disableScrollPropagation(div);

      const srcLabel = "PLU";
      const formatValue = (v: number | null): string => {
        if (v === null || v === undefined || !Number.isFinite(v))
          return "Non disponible";
        return String(v);
      };
      const a = formatValue(reculs?.recul_avant_m ?? null);
      const l = formatValue(reculs?.recul_lateral_m ?? null);
      const f = formatValue(reculs?.recul_fond_m ?? null);
      const max = Number.isFinite(Number(reculs?.reculMax))
        ? Number(reculs?.reculMax)
        : 0;
      const mode =
        reculs?.mode === "DIRECTIONAL_BY_FACADE"
          ? "directionnel (façade)"
          : "uniforme";

      div.innerHTML = `
        <div style="font-weight:700; margin-bottom:6px;">Reculs (${srcLabel})</div>
        <div>Avant : <b>${a}</b>${a !== "Non disponible" ? " m" : ""}</div>
        <div>Latéral : <b>${l}</b>${l !== "Non disponible" ? " m" : ""}</div>
        <div>Fond : <b>${f}</b>${f !== "Non disponible" ? " m" : ""}</div>
        <div style="margin-top:6px; padding-top:6px; border-top:1px solid rgba(148,163,184,0.25);">
          Appliqué : <b>${mode}</b> — max <b>${max.toFixed(1)}</b> m
        </div>
        <div style="margin-top:6px; opacity:.85;">
          Astuce : clique directement sur un bord pour définir la façade.
        </div>
      `;
      return div;
    };
    control.addTo(map);
    return () => {
      control.remove();
    };
  }, [map, reculs]);
  return null;
}

// -----------------------------------------------------------------------------
// Helpers geometrie (parcelle / reponses)
// -----------------------------------------------------------------------------
// VERSION ROBUSTE (FeatureCollection + objets imbriques)
function normalizeToFeature(raw: any): Feature<Polygon | MultiPolygon> | null {
  if (!raw) return null;
  // FeatureCollection GeoJSON standard
  if (raw.type === "FeatureCollection" && Array.isArray(raw.features)) {
    const f = raw.features.find(
      (x: any) =>
        x?.type === "Feature" &&
        (x?.geometry?.type === "Polygon" || x?.geometry?.type === "MultiPolygon"),
    );
    return f ? (f as Feature<Polygon | MultiPolygon>) : null;
  }
  // Certains retours: { features:[...] } sans type
  if (Array.isArray(raw.features)) {
    const f = raw.features.find(
      (x: any) =>
        x?.type === "Feature" &&
        (x?.geometry?.type === "Polygon" || x?.geometry?.type === "MultiPolygon"),
    );
    return f ? (f as Feature<Polygon | MultiPolygon>) : null;
  }
  // Feature<Polygon|MultiPolygon>
  if (raw.type === "Feature" && raw.geometry) {
    const g = raw.geometry;
    if (g.type === "Polygon" || g.type === "MultiPolygon") {
      return raw as Feature<Polygon | MultiPolygon>;
    }
  }
  // Geometry Polygon|MultiPolygon
  if (raw.type === "Polygon" || raw.type === "MultiPolygon") {
    return {
      type: "Feature",
      geometry: raw as Geometry,
      properties: {},
    } as Feature<Polygon | MultiPolygon>;
  }
  // Objet contenant geometry Polygon|MultiPolygon
  if (
    raw.geometry &&
    (raw.geometry.type === "Polygon" || raw.geometry.type === "MultiPolygon")
  ) {
    return {
      type: "Feature",
      geometry: raw.geometry as Geometry,
      properties: raw.properties ?? {},
    } as Feature<Polygon | MultiPolygon>;
  }
  return null;
}

function findFeatureForParcel(
  fc: FeatureCollection<Geometry, any>,
  parcelId: string,
): any | null {
  const target = String(parcelId).trim();
  if (!target) return null;
  for (const f of fc.features) {
    const p = (f.properties || {}) as any;
    const candidates = [f.id, p.id, p.parcel_id, p.parcelle_id, p.idu, p.IDU]
      .filter((v) => v !== undefined && v !== null)
      .map((v) => String(v).trim());
    if (candidates.includes(target)) return f;
  }
  return null;
}

function extractFeatureCollectionFromAnyResponse(
  data: any,
  depth: number = 0,
): FeatureCollection<Geometry, any> | null {
  if (!data || typeof data !== "object") return null;
  if (data.type === "FeatureCollection" && Array.isArray(data.features)) {
    return data as FeatureCollection<Geometry, any>;
  }
  if (depth > 4) return null;
  const preferredKeys = ["geojson", "data", "cadastre", "parcelles"];
  for (const key of preferredKeys) {
    const v = (data as any)[key];
    if (v && typeof v === "object") {
      const fc = extractFeatureCollectionFromAnyResponse(v, depth + 1);
      if (fc) return fc;
    }
  }
  for (const v of Object.values(data)) {
    if (v && typeof v === "object") {
      const fc = extractFeatureCollectionFromAnyResponse(v, depth + 1);
      if (fc) return fc;
    }
  }
  return null;
}

// -----------------------------------------------------------------------------
// Facade : segments + selection au clic
// -----------------------------------------------------------------------------
function getRingsFromParcel(
  parcel: Feature<Polygon | MultiPolygon>,
): number[][][] {
  const g = parcel.geometry;
  if (g.type === "Polygon") {
    return (g.coordinates as any) as number[][][];
  }
  const out: number[][][] = [];
  for (const poly of g.coordinates as any) {
    for (const ring of poly) out.push(ring);
  }
  return out;
}

function findClosestEdgeSegment(
  parcel: Feature<Polygon | MultiPolygon>,
  clickLngLat: [number, number],
): Feature<LineString> | null {
  const rings = getRingsFromParcel(parcel);
  const p = turf.point(clickLngLat);
  let bestSeg: [number[], number[]] | null = null;
  let bestDist = Infinity;
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
      }
    }
  }
  if (!bestSeg) return null;
  const MAX_CLICK_DIST_M = 0.8;
  if (!Number.isFinite(bestDist) || bestDist > MAX_CLICK_DIST_M) return null;
  return {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: [bestSeg[0], bestSeg[1]],
    },
    properties: {
      kind: "facade",
      distance_m: bestDist,
    },
  };
}

function FacadeClickHandler({
  enabled,
  parcelFeature,
  onSelect,
  onMiss,
}: {
  enabled: boolean;
  parcelFeature: Feature<Polygon | MultiPolygon> | null;
  onSelect: (seg: Feature<LineString>) => void;
  onMiss?: () => void;
}) {
  useMapEvents({
    click: (e) => {
      if (!enabled) return;
      if (!parcelFeature) return;
      const seg = findClosestEdgeSegment(parcelFeature, [
        e.latlng.lng,
        e.latlng.lat,
      ]);
      if (seg) onSelect(seg);
      else onMiss?.();
    },
  });
  return null;
}

// -----------------------------------------------------------------------------
// Normalisation reculs (PLU / massing) + mapping vers userParams.reculs
// -----------------------------------------------------------------------------
function toNumberLooseNullable(v: any): number | null {
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

function computeImplantationWithoutGeom(
  surfaceTerrainM2: number,
  pluRules: PluRules | null,
  userParams: ImplantationUserParams,
): ImplantationResult {
  const safeRules: any = pluRules ?? {};
  const surfaceTerrainApresReculsM2 = surfaceTerrainM2;
  const empriseRaw =
    safeRules.emprise?.emprise_max_ratio ??
    safeRules.emprise_sol?.emprise_sol_max ??
    null;
  let empriseRatio = empriseRaw ?? 0.4;
  if (empriseRatio > 1 && empriseRatio <= 100) empriseRatio = empriseRatio / 100;
  if (empriseRatio <= 0 || !Number.isFinite(empriseRatio)) empriseRatio = 0.4;
  const surfaceEmpriseMaxM2 = surfaceTerrainApresReculsM2 * empriseRatio;
  const stationnement = safeRules.stationnement ?? null;
  const placesParLogement = stationnement?.places_par_logement ?? 1;
  const surfaceParPlaceM2 = stationnement?.surface_par_place_m2 ?? 25;
  const placesParking = Math.ceil(userParams.nbLogements * placesParLogement);
  const surfaceParkingM2 = placesParking * surfaceParPlaceM2;
  const surfaceMaxDisponiblePourBatimentsM2 =
    surfaceTerrainApresReculsM2 - surfaceParkingM2;
  const surfaceEmpriseUtilisableM2 = Math.max(
    0,
    Math.min(surfaceEmpriseMaxM2, surfaceMaxDisponiblePourBatimentsM2),
  );
  return {
    surfaceTerrainM2,
    surfaceTerrainApresReculsM2,
    surfaceParkingM2,
    surfaceEmpriseMaxM2,
    surfaceEmpriseUtilisableM2,
    nbBatiments: userParams.nbBatiments,
    nbLogements: userParams.nbLogements,
    placesParking,
  };
}

// -----------------------------------------------------------------------------
// Projet (UI) : defaults + helpers
// -----------------------------------------------------------------------------
const DEFAULT_BUILDING_SPEC = {
  shape: "rectangle",
  footprintM2: 300,
  floors: 2,
  orientation: "facade",
  facadeMode: { type: "alignement" },
} as any;

function normalizeBuildings(nbBatiments: number, current: any[] | undefined) {
  const n = Math.max(1, Math.min(10, Number(nbBatiments) || 1));
  const arr = Array.isArray(current) ? [...current] : [];
  while (arr.length < n) arr.push({ ...DEFAULT_BUILDING_SPEC });
  if (arr.length > n) arr.length = n;
  return arr;
}

function projectComparable(p: any) {
  const buildings = Array.isArray(p?.buildings) ? p.buildings : [];
  return {
    validationRequested: !!p?.validationRequested,
    buildings: buildings.map((b: any) => ({
      shape: b?.shape ?? "rectangle",
      footprintM2: Number(b?.footprintM2) || 0,
      floors: Number(b?.floors) || 0,
      orientation: b?.orientation ?? "facade",
      facadeModeType: b?.facadeMode?.type ?? "alignement",
      facadeOffset: Number(b?.facadeMode?.distanceM) || 0,
    })),
  };
}// PARTIE 2/3
// -----------------------------------------------------------------------------
// Helpers edition batiment (V1)
// -----------------------------------------------------------------------------
type EditAction =
  | { type: "none" }
  | { type: "move"; startLatLng: L.LatLng; original: Feature<Polygon | MultiPolygon> }
  | {
      type: "rotate";
      startBearing: number;
      pivot: Feature<Point>;
      original: Feature<Polygon | MultiPolygon>;
    }
  | {
      type: "scale";
      startDistM: number;
      pivot: Feature<Point>;
      original: Feature<Polygon | MultiPolygon>;
    };

function getFirstPolygonCoords(f: Feature<Polygon | MultiPolygon>): Position[] {
  if (f.geometry.type === "Polygon") {
    const ring = (f.geometry.coordinates?.[0] ?? []) as any[];
    return ring as Position[];
  }
  const ring = (f.geometry.coordinates?.[0]?.[0] ?? []) as any[];
  return ring as Position[];
}

function unique4CornersFromRing(ring: Position[]): Position[] | null {
  if (!Array.isArray(ring) || ring.length < 4) return null;
  const pts = ring.slice(0, -1);
  const uniq: Position[] = [];
  for (const p of pts) {
    const key = `${(p[0] as number).toFixed(10)}|${(p[1] as number).toFixed(
      10,
    )}`;
    if (
      !uniq.some(
        (q) =>
          `${(q[0] as number).toFixed(10)}|${(q[1] as number).toFixed(10)}` ===
          key,
      )
    ) {
      uniq.push(p);
    }
  }
  return uniq.length >= 4 ? uniq.slice(0, 4) : null;
}

function centroidPointFeature(
  f: Feature<Polygon | MultiPolygon>,
): Feature<Point> {
  const c = turf.centroid(f as any) as any;
  return c as Feature<Point>;
}

function pointFeatureFromLngLat(
  lng: number,
  lat: number,
  props?: any,
): Feature<Point> {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lng, lat] },
    properties: props ?? {},
  };
}

function withinEnvelope(
  candidate: Feature<Polygon | MultiPolygon>,
  envelope: Feature<Polygon | MultiPolygon> | null,
): boolean {
  if (!envelope) return true;
  try {
    return turf.booleanWithin(candidate as any, envelope as any);
  } catch {
    return false;
  }
}

function translateFeatureByLatLngDelta(
  f: Feature<Polygon | MultiPolygon>,
  from: L.LatLng,
  to: L.LatLng,
): Feature<Polygon | MultiPolygon> {
  const p1 = turf.point([from.lng, from.lat]);
  const p2 = turf.point([to.lng, to.lat]);
  const distKm = turf.distance(p1, p2, { units: "kilometers" });
  const distM = distKm * 1000;
  const bearing = turf.bearing(p1, p2);
  if (!Number.isFinite(distM) || distM <= 0) return f;
  const moved = turf.transformTranslate(f as any, distM, bearing, {
    units: "meters",
  }) as any;
  return moved as Feature<Polygon | MultiPolygon>;
}

function rotateFeatureAround(
  f: Feature<Polygon | MultiPolygon>,
  pivot: Feature<Point>,
  deltaDeg: number,
): Feature<Polygon | MultiPolygon> {
  const rotated = turf.transformRotate(f as any, deltaDeg, {
    pivot: pivot.geometry.coordinates as any,
  }) as any;
  return rotated as Feature<Polygon | MultiPolygon>;
}

function scaleFeatureAround(
  f: Feature<Polygon | MultiPolygon>,
  pivot: Feature<Point>,
  scale: number,
): Feature<Polygon | MultiPolygon> {
  const s = Math.max(0.2, Math.min(5, scale));
  const scaled = (turf as any).transformScale
    ? ((turf as any).transformScale(f as any, s, {
        origin: pivot.geometry.coordinates as any,
      }) as any)
    : (f as any);
  return scaled as Feature<Polygon | MultiPolygon>;
}

function bearingFromPivot(pivot: Feature<Point>, latlng: L.LatLng): number {
  try {
    return turf.bearing(
      turf.point(pivot.geometry.coordinates as any),
      turf.point([latlng.lng, latlng.lat]),
    );
  } catch {
    return 0;
  }
}

function distanceFromPivotM(pivot: Feature<Point>, latlng: L.LatLng): number {
  try {
    const km = turf.distance(
      turf.point(pivot.geometry.coordinates as any),
      turf.point([latlng.lng, latlng.lat]),
      { units: "kilometers" },
    );
    return km * 1000;
  } catch {
    return 0;
  }
}

// -----------------------------------------------------------------------------
// Fallback building (si computeImplantationV1 ne renvoie pas de footprint)
// -----------------------------------------------------------------------------
function degToBearing(from: [number, number], to: [number, number]) {
  try {
    return turf.bearing(turf.point(from), turf.point(to));
  } catch {
    return 0;
  }
}

function offsetPoint(
  center: Feature<Point>,
  distM: number,
  bearingDeg: number,
): Feature<Point> {
  const km = distM / 1000;
  const p = turf.destination(center as any, km, bearingDeg, {
    units: "kilometers",
  }) as any;
  return p as Feature<Point>;
}

function buildRectangleAroundCenter(
  center: Feature<Point>,
  lengthM: number,
  widthM: number,
  bearingDeg: number,
): Feature<Polygon> {
  const halfL = Math.max(0.5, lengthM / 2);
  const halfW = Math.max(0.5, widthM / 2);
  const b = bearingDeg;
  const p = b + 90;
  const c1 = offsetPoint(offsetPoint(center, +halfL, b), +halfW, p);
  const c2 = offsetPoint(offsetPoint(center, +halfL, b), -halfW, p);
  const c3 = offsetPoint(offsetPoint(center, -halfL, b), -halfW, p);
  const c4 = offsetPoint(offsetPoint(center, -halfL, b), +halfW, p);
  const coords = [
    c1.geometry.coordinates,
    c2.geometry.coordinates,
    c3.geometry.coordinates,
    c4.geometry.coordinates,
    c1.geometry.coordinates,
  ];
  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [coords as any] },
    properties: { kind: "fallback_building" },
  };
}

function computeFallbackBuilding(
  envelope: Feature<Polygon | MultiPolygon>,
  footprintM2: number,
  shape: "rectangle" | "square",
  facadeSeg: Feature<LineString> | null,
): Feature<Polygon | MultiPolygon> | null {
  try {
    const envPoly = envelope as any;
    const c = turf.centroid(envPoly) as Feature<Point>;
    const bearing =
      facadeSeg?.geometry?.coordinates?.length === 2
        ? degToBearing(
            facadeSeg.geometry.coordinates[0] as any,
            facadeSeg.geometry.coordinates[1] as any,
          )
        : 0;
    const area = Math.max(10, Number(footprintM2) || 300);
    const ratio = shape === "square" ? 1 : 3;
    const width = Math.sqrt(area / ratio);
    const length = width * ratio;
    let scale = 1.0;
    for (let i = 0; i < 12; i++) {
      const rect = buildRectangleAroundCenter(c, length * scale, width * scale, bearing);
      const ok =
        turf.booleanWithin(rect as any, envPoly) ||
        (turf.booleanIntersects(rect as any, envPoly) &&
          turf.area(rect as any) > 5);
      if (ok) return rect as any;
      scale *= 0.85;
    }
    const buf = turf.buffer(c as any, 6, { units: "meters" }) as any;
    if (
      buf?.geometry?.type === "Polygon" ||
      buf?.geometry?.type === "MultiPolygon"
    ) {
      return buf as any;
    }
    return null;
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// Panneau bloquant : regles PLU absentes ou incompletes
// -----------------------------------------------------------------------------
function PluRulesetBlockingPanel({
  missingFields,
  onReturnClick,
}: {
  missingFields: string[];
  onReturnClick: () => void;
}) {
  const panelStyle: React.CSSProperties = {
    background:
      "linear-gradient(135deg, rgba(239,68,68,0.15), rgba(249,115,22,0.1))",
    border: "1px solid rgba(239,68,68,0.5)",
    borderRadius: 16,
    padding: 24,
    marginBottom: 16,
  };
  const titleStyle: React.CSSProperties = {
    fontSize: 18,
    fontWeight: 700,
    color: "#f87171",
    marginBottom: 12,
  };
  const buttonStyle: React.CSSProperties = {
    padding: "12px 20px",
    borderRadius: 999,
    border: "none",
    background:
      "linear-gradient(135deg, rgba(239,68,68,1), rgba(249,115,22,1))",
    color: "white",
    fontWeight: 600,
    cursor: "pointer",
    marginTop: 16,
  };

  return (
    <div style={panelStyle}>
      <div style={titleStyle}>{"⚠️ Règles PLU absentes ou incomplètes"}</div>
      <p style={{ fontSize: 14, opacity: 0.9, margin: 0 }}>
        {"Le calcul d'implantation nécessite un ruleset PLU résolu et complet. Veuillez d'abord compléter l'étape PLU & Faisabilité."}
      </p>
      {missingFields.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
            {"Champs manquants :"}
          </div>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, opacity: 0.85 }}>
            {missingFields.slice(0, 10).map((field, idx) => (
              <li key={idx}>{field}</li>
            ))}
            {missingFields.length > 10 && (
              <li style={{ opacity: 0.7 }}>{`+ ${missingFields.length - 10} autres…`}</li>
            )}
          </ul>
        </div>
      )}
      <button style={buttonStyle} onClick={onReturnClick}>
        {"← Retour PLU & Faisabilité"}
      </button>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Panneau bloquant : parametres parcelle manquants
// -----------------------------------------------------------------------------
function MissingParcelParamsPanel({
  missingParcelId,
  missingCommuneInsee,
  onReturnClick,
}: {
  missingParcelId: boolean;
  missingCommuneInsee: boolean;
  onReturnClick: () => void;
}) {
  const panelStyle: React.CSSProperties = {
    background:
      "linear-gradient(135deg, rgba(251,146,60,0.15), rgba(234,179,8,0.1))",
    border: "1px solid rgba(251,146,60,0.5)",
    borderRadius: 16,
    padding: 24,
    marginBottom: 16,
    maxWidth: 600,
  };
  const titleStyle: React.CSSProperties = {
    fontSize: 18,
    fontWeight: 700,
    color: "#fb923c",
    marginBottom: 12,
  };
  const buttonStyle: React.CSSProperties = {
    padding: "12px 20px",
    borderRadius: 999,
    border: "none",
    background:
      "linear-gradient(135deg, rgba(251,146,60,1), rgba(234,179,8,1))",
    color: "white",
    fontWeight: 600,
    cursor: "pointer",
    marginTop: 16,
  };

  const missingItems: string[] = [];
  if (missingParcelId) missingItems.push("Identifiant de parcelle (parcel_id)");
  if (missingCommuneInsee) missingItems.push("Code INSEE de la commune (commune_insee)");

  return (
    <div style={panelStyle}>
      <div style={titleStyle}>{"⚠️ Paramètres de parcelle manquants"}</div>
      <p style={{ fontSize: 14, opacity: 0.9, margin: 0 }}>
        {"Cette page nécessite une parcelle sélectionnée. Aucune donnée n'a été trouvée dans l'URL, le state de navigation, ou le localStorage."}
      </p>
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
          {"Paramètres manquants :"}
        </div>
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, opacity: 0.85 }}>
          {missingItems.map((item, idx) => (
            <li key={idx}>{item}</li>
          ))}
        </ul>
      </div>
      <div style={{ marginTop: 12, fontSize: 13, opacity: 0.8 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>{"Sources vérifiées :"}</div>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li>{"Query params URL (?parcel_id=...&commune_insee=...)"}</li>
          <li>{"State de navigation (location.state)"}</li>
          <li>{"localStorage (mimmoza.foncier.* / mimmoza.plu.*)"}</li>
        </ul>
      </div>
      <button style={buttonStyle} onClick={onReturnClick}>
        {"← Sélectionner une parcelle"}
      </button>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Composant
// -----------------------------------------------------------------------------
export const Implantation2DPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state || {}) as LocationState;

  // --------------------------------------------------
  // Resolution des parametres avec fallback
  // --------------------------------------------------
  const parcelIdFromQuery = searchParams.get("parcel_id");
  const communeInseeFromQuery = searchParams.get("commune_insee");

  const parcelId = useMemo(
    () => resolveParcelId(parcelIdFromQuery, state),
    [parcelIdFromQuery, state]
  );

  const communeInsee = useMemo(
    () => resolveCommuneInsee(communeInseeFromQuery, state),
    [communeInseeFromQuery, state]
  );

  // Verification des parametres manquants
  const missingParcelId = !parcelId;
  const missingCommuneInsee = !communeInsee;
  const hasMissingParams = missingParcelId || missingCommuneInsee;

  const [error, setError] = useState<string | null>(null);

  // --------------------------------------------------
  // Lecture et validation du ruleset PLU resolu
  // --------------------------------------------------
  const resolvedRuleset = useMemo<ResolvedPluRuleset | null>(() => {
    // Priorite 1 : location.state.pluRuleset
    if (state.pluRuleset && typeof state.pluRuleset === "object") {
      return state.pluRuleset;
    }
    // Priorite 2 : localStorage
    return loadResolvedRulesetFromLocalStorage();
  }, [state.pluRuleset]);

  const rulesetValid = useMemo(
    () => isValidResolvedRuleset(resolvedRuleset),
    [resolvedRuleset]
  );

  const rulesetMissingFields = useMemo<string[]>(() => {
    if (!resolvedRuleset) return ["Ruleset PLU non trouvé"];
    if (resolvedRuleset.version !== "plu_ruleset_v1") {
      return [`Version invalide: ${resolvedRuleset.version ?? "undefined"} (attendu: plu_ruleset_v1)`];
    }
    if (!resolvedRuleset.completeness) {
      return ["Champ completeness absent"];
    }
    if (resolvedRuleset.completeness.ok !== true) {
      return resolvedRuleset.completeness.missing ?? ["Complétude non validée (completeness.ok !== true)"];
    }
    return [];
  }, [resolvedRuleset]);

  // --------------------------------------------------
  // Etats principaux
  // --------------------------------------------------
  const [draftParams, setDraftParams] = useState<ImplantationUserParams>(() => {
    const base: ImplantationUserParams = {
      nbBatiments: 1,
      nbLogements: 10,
      surfaceMoyLogementM2: 60,
      project: {
        buildings: [DEFAULT_BUILDING_SPEC],
        validationRequested: false,
      } as any,
    };
    return base;
  });

  const [appliedParams, setAppliedParams] =
    useState<ImplantationUserParams>(draftParams);
  const [applyTick, setApplyTick] = useState(0);

  useEffect(() => {
    setDraftParams((p: any) => {
      const proj = p?.project ?? { buildings: [], validationRequested: false };
      const normalized = normalizeBuildings(p.nbBatiments, proj.buildings);
      if (normalized.length === (proj.buildings?.length ?? 0)) return p;
      return {
        ...p,
        project: {
          ...proj,
          buildings: normalized,
          validationRequested: false,
        },
      };
    });
  }, [draftParams.nbBatiments]);

  const isDirty = useMemo(() => {
    const a: any = appliedParams;
    const d: any = draftParams;
    const coreDirty =
      d.nbBatiments !== a.nbBatiments ||
      d.nbLogements !== a.nbLogements ||
      d.surfaceMoyLogementM2 !== a.surfaceMoyLogementM2;
    const projDirty =
      JSON.stringify(projectComparable(d.project)) !==
      JSON.stringify(projectComparable(a.project));
    return coreDirty || projDirty;
  }, [draftParams, appliedParams]);

  // showOSM avec défaut true pour afficher le fond de carte par défaut
  const [showOSM, setShowOSM] = useState(true);

  const [result, setResult] = useState<ImplantationResult | null>(null);
  const [parcelFeature, setParcelFeature] = useState<Feature<Polygon | MultiPolygon> | null>(null);
  const [afterReculsFeature, setAfterReculsFeature] = useState<Feature<Polygon | MultiPolygon> | null>(null);
  const [buildableFeature, setBuildableFeature] = useState<Feature<Polygon | MultiPolygon> | null>(null);
  const [reculsUsed, setReculsUsed] = useState<{
    recul_avant_m: number | null;
    recul_lateral_m: number | null;
    recul_fond_m: number | null;
    reculMax: number;
    source: "plu";
    mode?: "DIRECTIONAL_BY_FACADE" | "UNIFORM";
  } | null>(null);
  const [facadeSegment, setFacadeSegment] = useState<Feature<LineString> | null>(null);

  // Micro-animations
  const [pulseEnvelope, setPulseEnvelope] = useState(false);
  const [pulseBuilding, setPulseBuilding] = useState(false);

  // Edition batiment
  const [editMode, setEditMode] = useState(false);
  const [manualBuilding, setManualBuilding] = useState<Feature<Polygon | MultiPolygon> | null>(null);
  const actionRef = useRef<EditAction>({ type: "none" });
  const displayedBuilding = manualBuilding ?? buildableFeature;
  const envelopeForConstraints = afterReculsFeature ?? null;

  // --------------------------------------------------
  // Geoman callback for shape creation
  // --------------------------------------------------
  const handleGeomanCreated = (feature: Feature<Polygon | MultiPolygon>) => {
    setManualBuilding(feature);
    setPulseBuilding(true);
    setTimeout(() => setPulseBuilding(false), 200);
  };

  // --------------------------------------------------
  // 1) Charger cadastre (seulement si parametres disponibles)
  // --------------------------------------------------
  useEffect(() => {
    async function loadCadastreGeometry() {
      // Ne pas charger si parametres manquants
      if (!parcelId || !communeInsee) {
        setParcelFeature(null);
        return;
      }
      const insee = communeInsee.trim();
      if (!insee || insee.length < 5) {
        setError("Code INSEE invalide.");
        return;
      }
      try {
        const url = `${SUPABASE_URL}/functions/v1/cadastre-from-commune`;
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({ commune_insee: insee }),
        });
        if (!res.ok) {
          setError(
            "Impossible de charger le cadastre (Edge Function cadastre-from-commune).",
          );
          setParcelFeature(null);
          return;
        }
        const data = await res.json();
        const fc = extractFeatureCollectionFromAnyResponse(data);
        if (!fc || !Array.isArray(fc.features)) {
          setError("Le format du cadastre renvoyé est invalide.");
          setParcelFeature(null);
          return;
        }
        const found = findFeatureForParcel(fc, parcelId);
        if (!found) {
          setError(
            "Parcelle introuvable dans le cadastre. Les calculs restent disponibles sans carte.",
          );
          setParcelFeature(null);
          return;
        }
        const norm = normalizeToFeature(found);
        if (!norm) {
          setError("Géométrie de la parcelle invalide dans le cadastre.");
          setParcelFeature(null);
          return;
        }
        setParcelFeature(norm);
        setError(null);
      } catch (err) {
        console.error("[Implantation2D] Erreur cadastre-from-commune:", err);
        setError("Erreur lors du chargement du cadastre (Edge Function).");
        setParcelFeature(null);
      }
    }
    loadCadastreGeometry();
  }, [parcelId, communeInsee]);

  // --------------------------------------------------
  // 2) Calcul implantation (UNIQUEMENT si ruleset valide ET params disponibles)
  // --------------------------------------------------
  useEffect(() => {
    // Hard-stop si parametres manquants
    if (hasMissingParams) {
      setResult(null);
      setBuildableFeature(null);
      setAfterReculsFeature(null);
      setManualBuilding(null);
      setEditMode(false);
      setReculsUsed(null);
      return;
    }

    // Hard-stop si ruleset invalide
    if (!rulesetValid) {
      setResult(null);
      setBuildableFeature(null);
      setAfterReculsFeature(null);
      setManualBuilding(null);
      setEditMode(false);
      setReculsUsed(null);
      return;
    }

    // Extraire les reculs depuis le ruleset resolu
    const extractedReculs = extractReculsFromRuleset(resolvedRuleset!);
    const finalReculAvant = extractedReculs.avant;
    const finalReculLat = extractedReculs.lateral;
    const finalReculFond = extractedReculs.fond;
    const reculMode = extractedReculs.mode;

    // Calculer reculMax en ignorant null/NaN
    const validReculs = [finalReculAvant, finalReculLat, finalReculFond].filter(
      (x): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0
    );
    const reculMax = validReculs.length > 0 ? Math.max(...validReculs) : 0;

    const basePluRules: PluRules | null = state.pluRules ?? null;
    const surfaceFromState = state.surfaceTerrainM2 ?? null;
    const surfaceFromGeom = parcelFeature
      ? turf.area(parcelFeature as any)
      : null;
    const surfaceTerrainM2 =
      (surfaceFromState && surfaceFromState > 0
        ? surfaceFromState
        : surfaceFromGeom && surfaceFromGeom > 0
        ? surfaceFromGeom
        : null) ?? null;

    const userParamsWithReculs: ImplantationUserParams = {
      ...appliedParams,
      reculs: {
        avant_m: typeof finalReculAvant === "number" ? finalReculAvant : 0,
        lateral_m: typeof finalReculLat === "number" ? finalReculLat : 0,
        arriere_m: typeof finalReculFond === "number" ? finalReculFond : 0,
        alignement_obligatoire: false,
        source: "PLU_RULESET",
      } as any,
    };
    (userParamsWithReculs as any).facade = facadeSegment ?? null;

    if (!surfaceTerrainM2 || surfaceTerrainM2 <= 0) {
      setError(
        "Surface terrain indisponible pour le moment. Vérifie le retour Promoteur ou attends le chargement du cadastre.",
      );
      const minimal = computeImplantationWithoutGeom(
        1,
        basePluRules,
        userParamsWithReculs,
      );
      setResult({
        ...minimal,
        surfaceTerrainM2: 0,
        surfaceTerrainApresReculsM2: 0,
        surfaceEmpriseMaxM2: 0,
        surfaceEmpriseUtilisableM2: 0,
        surfaceParkingM2: 0,
        placesParking: minimal.placesParking,
      });
      setBuildableFeature(null);
      setAfterReculsFeature(null);
      setManualBuilding(null);
      setEditMode(false);
      setReculsUsed({
        recul_avant_m: finalReculAvant,
        recul_lateral_m: finalReculLat,
        recul_fond_m: finalReculFond,
        reculMax,
        source: "plu",
        mode: reculMode,
      });
      return;
    }

    // Calcul de l'enveloppe apres reculs
    let computedAfterReculsFeature: Feature<Polygon | MultiPolygon> | null =
      null;
    if (parcelFeature && reculMax > 0) {
      try {
        const buffered = turf.buffer(parcelFeature as any, -reculMax, {
          units: "meters",
        }) as any;
        if (
          buffered?.geometry &&
          (buffered.geometry.type === "Polygon" ||
            buffered.geometry.type === "MultiPolygon")
        ) {
          computedAfterReculsFeature = buffered as any;
          setAfterReculsFeature(buffered as any);
        } else {
          setAfterReculsFeature(null);
        }
      } catch {
        setAfterReculsFeature(null);
      }
    } else {
      setAfterReculsFeature(null);
    }

    if (parcelFeature) {
      try {
        const { result, buildableGeom } = computeImplantationV1({
          parcelGeometry: parcelFeature,
          surfaceTerrainM2,
          pluRules: basePluRules,
          userParams: userParamsWithReculs,
        });
        setResult(result);

        // FIX ROBUSTE: le batiment peut etre dans plusieurs champs (Feature/Geometry/FC)
        const candidate =
          buildableGeom ??
          (result as any)?.buildableGeom ??
          (result as any)?.building ??
          (result as any)?.buildingGeom ??
          (result as any)?.buildingFeature ??
          (result as any)?.footprint ??
          null;
        const normBuildable = normalizeToFeature(candidate);

        // fallback front si le moteur ne renvoie rien
        const envelopeForFallback = computedAfterReculsFeature;
        if (!normBuildable && envelopeForFallback) {
          const shape = (((appliedParams as any)?.project?.buildings?.[0]
            ?.shape ?? "rectangle") as "rectangle" | "square");
          const footprintM2 = Number(
            (appliedParams as any)?.project?.buildings?.[0]?.footprintM2 ?? 300,
          );
          const fb = computeFallbackBuilding(
            envelopeForFallback,
            footprintM2,
            shape,
            facadeSegment ?? null,
          );
          setBuildableFeature(fb as any);
        } else {
          setBuildableFeature(normBuildable);
        }

        // reset edition si le moteur regenere
        setManualBuilding(null);
        setEditMode(false);

        // FIX ROBUSTE: enveloppe peut etre Geometry/Feature/FeatureCollection
        const envRaw =
          (result as any)?.envelopeAfterReculs ??
          (result as any)?.afterReculs ??
          null;
        const envFeat = normalizeToFeature(envRaw);
        if (envFeat) {
          setAfterReculsFeature(envFeat);
        }

        setReculsUsed({
          recul_avant_m: finalReculAvant,
          recul_lateral_m: finalReculLat,
          recul_fond_m: finalReculFond,
          reculMax,
          source: "plu",
          mode: reculMode,
        });

        // Pulse sur recalcul
        setPulseEnvelope(true);
        setTimeout(() => setPulseEnvelope(false), 300);
        setPulseBuilding(true);
        setTimeout(() => setPulseBuilding(false), 300);

        setError(null);
        return;
      } catch (e) {
        console.warn(
          "[Implantation2D] computeImplantationV1 FAILED -> fallback",
          e,
        );
      }
    }

    const fallbackResult = computeImplantationWithoutGeom(
      surfaceTerrainM2,
      basePluRules,
      userParamsWithReculs,
    );
    setResult(fallbackResult);
    setBuildableFeature(null);
    setManualBuilding(null);
    setEditMode(false);
    setReculsUsed({
      recul_avant_m: finalReculAvant,
      recul_lateral_m: finalReculLat,
      recul_fond_m: finalReculFond,
      reculMax,
      source: "plu",
      mode: reculMode,
    });
  }, [
    parcelFeature,
    appliedParams,
    applyTick,
    facadeSegment,
    state.surfaceTerrainM2,
    state.pluRules,
    state.massing,
    rulesetValid,
    resolvedRuleset,
    hasMissingParams,
  ]);

  // --------------------------------------------------
  // Centre carte
  // --------------------------------------------------
  const center = useMemo(() => {
    if (!parcelFeature) return [46.5, 2.5];
    const geom: any = parcelFeature.geometry;
    let first: number[] | null = null;
    if (geom.type === "Polygon") first = geom.coordinates?.[0]?.[0] ?? null;
    else if (geom.type === "MultiPolygon")
      first = geom.coordinates?.[0]?.[0]?.[0] ?? null;
    if (!first) return [46.5, 2.5];
    return [first[1], first[0]];
  }, [parcelFeature]);

  // --------------------------------------------------
  // Styles
  // --------------------------------------------------
  const pageStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "row",
    minHeight: "100vh",
    background: "#020617",
    color: "white",
    padding: "24px",
    gap: "24px",
    boxSizing: "border-box",
  };
  const leftCol: React.CSSProperties = {
    flex: 2,
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  };
  const rightCol: React.CSSProperties = {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  };
  const card: React.CSSProperties = {
    background: "#020617",
    borderRadius: 16,
    padding: 16,
    border: "1px solid rgba(148, 163, 184, 0.4)",
    boxShadow: "0 20px 40px rgba(15, 23, 42, 0.7)",
  };
  const title: React.CSSProperties = {
    fontSize: 18,
    fontWeight: 600,
    marginBottom: 8,
  };
  const label: React.CSSProperties = {
    display: "block",
    fontSize: 13,
    marginBottom: 4,
  };
  const input: React.CSSProperties = {
    width: "100%",
    padding: "6px 8px",
    borderRadius: 8,
    border: "1px solid rgba(148,163,184,0.4)",
    background: "#020617",
    color: "white",
    fontSize: 13,
  };
  const select: React.CSSProperties = {
    ...input,
    padding: "7px 8px",
  };
  const primaryButton: React.CSSProperties = {
    padding: "10px 16px",
    borderRadius: 999,
    border: "none",
    background:
      "linear-gradient(135deg, rgba(56,189,248,1), rgba(59,130,246,1))",
    color: "white",
    fontWeight: 600,
    cursor: "pointer",
  };
  const ghostButton: React.CSSProperties = {
    padding: "10px 16px",
    borderRadius: 999,
    border: "1px solid rgba(148,163,184,0.5)",
    background: "transparent",
    color: "white",
    fontWeight: 500,
    cursor: "pointer",
  };
  const tinyButton: React.CSSProperties = {
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid rgba(148,163,184,0.5)",
    background: "transparent",
    color: "white",
    fontWeight: 500,
    cursor: "pointer",
    fontSize: 12,
  };

  // Hooks d'edition (toujours appeles, meme quand result est null)
  const validation = (result as any)?.validation ?? null;
  const validationErrors: any[] = Array.isArray(validation?.errors)
    ? validation.errors
    : [];
  const validationOk = validation?.ok === true;

  const corners = useMemo(() => {
    const b = displayedBuilding;
    if (!b) return null;
    const ring = getFirstPolygonCoords(b);
    const c = unique4CornersFromRing(ring);
    return c;
  }, [displayedBuilding]);

  const pivotPt = useMemo(() => {
    const b = displayedBuilding;
    if (!b) return null;
    return centroidPointFeature(b);
  }, [displayedBuilding]);

  const rotateHandle = useMemo(() => {
    if (!pivotPt) return null;
    try {
      const ph = turf.transformTranslate(pivotPt as any, 12, 0, {
        units: "meters",
      }) as any;
      return ph as Feature<Point>;
    } catch {
      return null;
    }
  }, [pivotPt]);

  function EditBuildingMapEvents() {
    const map = useMap();
    useMapEvents({
      mousemove: (e) => {
        if (!editMode) return;
        const action = actionRef.current;
        if (action.type === "none") return;
        const env = envelopeForConstraints;
        if (action.type === "move") {
          const moved = translateFeatureByLatLngDelta(
            action.original,
            action.startLatLng,
            e.latlng,
          );
          if (!env || withinEnvelope(moved, env)) {
            setManualBuilding(moved);
            setPulseBuilding(true);
            setTimeout(() => setPulseBuilding(false), 200);
          }
          return;
        }
        if (action.type === "rotate") {
          const curBearing = bearingFromPivot(action.pivot, e.latlng);
          const delta = curBearing - action.startBearing;
          const rotated = rotateFeatureAround(
            action.original,
            action.pivot,
            delta,
          );
          if (!env || withinEnvelope(rotated, env)) {
            setManualBuilding(rotated);
            setPulseBuilding(true);
            setTimeout(() => setPulseBuilding(false), 200);
          }
          return;
        }
        if (action.type === "scale") {
          const curDist = distanceFromPivotM(action.pivot, e.latlng);
          const scale =
            action.startDistM > 0 ? curDist / action.startDistM : 1;
          const scaled = scaleFeatureAround(action.original, action.pivot, scale);
          if (!env || withinEnvelope(scaled, env)) {
            setManualBuilding(scaled);
            setPulseBuilding(true);
            setTimeout(() => setPulseBuilding(false), 200);
          }
          return;
        }
      },
      mouseup: () => {
        if (!editMode) return;
        actionRef.current = { type: "none" };
      },
    });
    useEffect(() => {
      if (!map) return;
      if (editMode) {
        map.dragging.disable();
        map.doubleClickZoom.disable();
      } else {
        map.dragging.enable();
        map.doubleClickZoom.enable();
      }
    }, [map, editMode]);
    return null;
  }

  // Helper pour formater les valeurs de recul dans l'UI
  const formatReculValue = (v: number | null | undefined): string => {
    if (v === null || v === undefined || !Number.isFinite(v))
      return "Non disponible";
    return `${v}`;
  };// PARTIE 3/3
  // --------------------------------------------------
  // JSX
  // --------------------------------------------------
  return (
    <div style={pageStyle}>
      {/* Panneau bloquant si parametres parcelle manquants */}
      {hasMissingParams && (
        <div style={{ width: "100%", display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: 40 }}>
          <MissingParcelParamsPanel
            missingParcelId={missingParcelId}
            missingCommuneInsee={missingCommuneInsee}
            onReturnClick={() => navigate("/promoteur/foncier")}
          />
        </div>
      )}

      {/* Panneau bloquant si ruleset invalide (mais params OK) */}
      {!hasMissingParams && !rulesetValid && (
        <div style={{ width: "100%" }}>
          <PluRulesetBlockingPanel
            missingFields={rulesetMissingFields}
            onReturnClick={() => navigate("/promoteur/plu-faisabilite")}
          />
          {/* Afficher la parcelle si disponible (lecture seule) */}
          {parcelFeature && (
            <div style={card}>
              <div style={title}>{"Aperçu de la parcelle (lecture seule)"}</div>
              <p style={{ fontSize: 13, opacity: 0.8, marginTop: 0, marginBottom: 8 }}>
                {`Parcelle : ${parcelId ?? "?"} — Commune INSEE : ${communeInsee ?? "?"}`}
              </p>
              <div style={{ height: 400 }}>
                <MapContainer
                  center={center as any}
                  zoom={19}
                  minZoom={16}
                  maxZoom={22}
                  scrollWheelZoom={true}
                  doubleClickZoom={true}
                  zoomSnap={0.25}
                  zoomDelta={0.5}
                  style={{
                    height: "100%",
                    width: "100%",
                    borderRadius: 12,
                    background: "#ffffff",
                    backgroundImage:
                      "linear-gradient(to right, rgba(15,23,42,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(15,23,42,0.06) 1px, transparent 1px)",
                    backgroundSize: "40px 40px",
                  }}
                >
                  <FitToFeature feature={parcelFeature} />
                  <TileLayer
                    attribution="&copy; OpenStreetMap"
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    maxNativeZoom={19}
                    maxZoom={22}
                  />
                  <GeoJSON
                    key="parcel-readonly"
                    data={parcelFeature as any}
                    style={() => ({
                      weight: 2,
                      color: "#f97316",
                      fillColor: "#fed7aa",
                      fillOpacity: 0.14,
                    })}
                  />
                </MapContainer>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Contenu principal si params OK et ruleset valide */}
      {!hasMissingParams && rulesetValid && !result && (
        <div style={card}>
          <div style={title}>{"Implantation 2D"}</div>
          <p>{"Chargement des données..."}</p>
        </div>
      )}

      {!hasMissingParams && rulesetValid && result && (
        <>
          <div style={leftCol}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 8,
              }}
            >
              <button style={ghostButton} onClick={() => navigate(-1)}>
                {"← Retour à l'étape précédente"}
              </button>
              <button style={primaryButton} disabled>
                {"Envoyer au bilan promoteur (bientôt)"}
              </button>
            </div>
            <div style={{ ...card, flex: 1 }}>
              <div style={title}>{"Implantation 2D — reculs & parkings"}</div>
              <p
                style={{
                  fontSize: 13,
                  opacity: 0.8,
                  marginTop: 0,
                  marginBottom: 8,
                }}
              >
                {`Parcelle : ${parcelId ?? "?"} — Commune INSEE : ${communeInsee ?? "?"}`}
              </p>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  marginBottom: 8,
                  flexWrap: "wrap",
                }}
              >
                <button style={tinyButton} onClick={() => setShowOSM((v) => !v)}>
                  {showOSM ? "Masquer fond OSM" : "Afficher fond OSM"}
                </button>
                <button
                  style={{
                    ...tinyButton,
                    borderColor: "rgba(239,68,68,0.7)",
                  }}
                  onClick={() => setFacadeSegment(null)}
                  disabled={!facadeSegment}
                  title="Réinitialiser la façade"
                >
                  {"Réinitialiser façade"}
                </button>
                <button
                  style={{
                    ...tinyButton,
                    borderColor: editMode
                      ? "rgba(34,197,94,0.9)"
                      : "rgba(148,163,184,0.5)",
                    background: editMode
                      ? "rgba(34,197,94,0.15)"
                      : "transparent",
                  }}
                  disabled={!parcelFeature}
                  onClick={() => {
                    setEditMode((v) => !v);
                    setManualBuilding((m) => m ?? displayedBuilding ?? null);
                    actionRef.current = { type: "none" };
                  }}
                  title="Activer l'édition du bâtiment (drag/resize/rotation) ou dessiner un nouveau bâtiment"
                >
                  {editMode ? "Terminer édition" : "Éditer / Dessiner bâtiment"}
                </button>
                {editMode && (
                  <button
                    style={{
                      ...tinyButton,
                      borderColor: "rgba(56,189,248,0.75)",
                    }}
                    onClick={() => {
                      setManualBuilding(null);
                      setEditMode(false);
                      actionRef.current = { type: "none" };
                    }}
                    title="Revenir au bâtiment calculé automatiquement"
                  >
                    {"Revenir auto"}
                  </button>
                )}
                <span style={{ fontSize: 12, opacity: 0.85 }}>
                  {editMode
                    ? "Mode édition actif — Utilisez les outils en haut à gauche pour dessiner un rectangle ou polygone."
                    : "Clique directement sur un bord (sinon la sélection est ignorée)."}
                </span>
              </div>
              {error && (
                <p style={{ fontSize: 12, color: "#f97316", marginTop: 0 }}>
                  {error}
                </p>
              )}
              <div style={{ height: "100%", minHeight: 420 }}>
                {parcelFeature ? (
                  <MapContainer
                    center={center as any}
                    zoom={19}
                    minZoom={16}
                    maxZoom={22}
                    scrollWheelZoom={true}
                    doubleClickZoom={true}
                    zoomSnap={0.25}
                    zoomDelta={0.5}
                    style={{
                      height: "100%",
                      width: "100%",
                      borderRadius: 12,
                      background: "#ffffff",
                      backgroundImage:
                        "linear-gradient(to right, rgba(15,23,42,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(15,23,42,0.06) 1px, transparent 1px)",
                      backgroundSize: "40px 40px",
                    }}
                  >
                    <FitToFeature feature={parcelFeature} />
                    <MapReculsControl reculs={reculsUsed} />
                    <EditBuildingMapEvents />
                    <FacadeClickHandler
                      enabled={!editMode}
                      parcelFeature={parcelFeature}
                      onSelect={(seg) => {
                        setFacadeSegment(seg);
                        setError(null);
                      }}
                      onMiss={() => {
                        setError(
                          "Clique sur le bord de la parcelle pour définir la façade.",
                        );
                      }}
                    />
                    {/* Geoman Toolbar - visible only in edit mode */}
                    <GeomanToolbar
                      enabled={editMode}
                      onCreated={handleGeomanCreated}
                    />
                    {showOSM && (
                      <TileLayer
                        attribution="&copy; OpenStreetMap"
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        maxNativeZoom={19}
                        maxZoom={22}
                      />
                    )}
                    <GeoJSON
                      key="parcel"
                      data={parcelFeature as any}
                      style={() => ({
                        weight: 2,
                        color: "#f97316",
                        fillColor: "#fed7aa",
                        fillOpacity: 0.14,
                      })}
                    />
                    {afterReculsFeature && (
                      <GeoJSON
                        key="after-reculs"
                        data={afterReculsFeature as any}
                        style={() => ({
                          weight: pulseEnvelope ? 4 : 2,
                          color: "#16a34a",
                          dashArray: "6 6",
                          fillColor: "#86efac",
                          fillOpacity: pulseEnvelope ? 0.22 : 0.14,
                        })}
                      />
                    )}
                    {displayedBuilding && (
                      <GeoJSON
                        key={`buildable-${editMode ? "edit" : "auto"}-${manualBuilding ? "manual" : "computed"}`}
                        data={displayedBuilding as any}
                        eventHandlers={{
                          mousedown: (e: any) => {
                            if (!editMode) return;
                            if (!displayedBuilding) return;
                            e?.originalEvent?.stopPropagation?.();
                            e?.originalEvent?.preventDefault?.();
                            actionRef.current = {
                              type: "move",
                              startLatLng: e.latlng as L.LatLng,
                              original: displayedBuilding,
                            };
                          },
                        }}
                        style={() => ({
                          weight: pulseBuilding ? 4 : 2,
                          color: editMode ? "#0ea5e9" : "#22c55e",
                          fillColor: editMode ? "#bae6fd" : "#bbf7d0",
                          fillOpacity: pulseBuilding ? 0.45 : 0.35,
                        })}
                      />
                    )}
                    {editMode &&
                      displayedBuilding &&
                      corners &&
                      pivotPt &&
                      corners.length >= 4 && (
                        <>
                          <GeoJSON
                            key="handles-corners"
                            data={
                              {
                                type: "FeatureCollection",
                                features: corners.map((c, i) =>
                                  pointFeatureFromLngLat(
                                    c[0] as number,
                                    c[1] as number,
                                    { idx: i, kind: "corner" },
                                  ),
                                ),
                              } as any
                            }
                            pointToLayer={(_, latlng) =>
                              L.circleMarker(latlng, {
                                radius: 6,
                                weight: 2,
                                color: "#0ea5e9",
                                fillColor: "#ffffff",
                                fillOpacity: 0.95,
                              })
                            }
                            eventHandlers={{
                              mousedown: (e: any) => {
                                if (!editMode || !displayedBuilding || !pivotPt)
                                  return;
                                e?.originalEvent?.stopPropagation?.();
                                e?.originalEvent?.preventDefault?.();
                                const startDistM = distanceFromPivotM(
                                  pivotPt,
                                  e.latlng,
                                );
                                actionRef.current = {
                                  type: "scale",
                                  startDistM: Math.max(1, startDistM),
                                  pivot: pivotPt,
                                  original: displayedBuilding,
                                };
                              },
                            }}
                          />
                          {rotateHandle && (
                            <GeoJSON
                              key="handle-rotate"
                              data={rotateHandle as any}
                              pointToLayer={(_, latlng) =>
                                L.circleMarker(latlng, {
                                  radius: 5,
                                  weight: 2,
                                  color: "#f59e0b",
                                  fillColor: "#ffffff",
                                  fillOpacity: 0.95,
                                })
                              }
                              eventHandlers={{
                                mousedown: (e: any) => {
                                  if (
                                    !editMode ||
                                    !displayedBuilding ||
                                    !pivotPt
                                  )
                                    return;
                                  e?.originalEvent?.stopPropagation?.();
                                  e?.originalEvent?.preventDefault?.();
                                  const startBearing = bearingFromPivot(
                                    pivotPt,
                                    e.latlng,
                                  );
                                  actionRef.current = {
                                    type: "rotate",
                                    startBearing,
                                    pivot: pivotPt,
                                    original: displayedBuilding,
                                  };
                                },
                              }}
                            />
                          )}
                        </>
                      )}
                    {facadeSegment && (
                      <GeoJSON
                        key="facade"
                        data={facadeSegment as any}
                        style={() => ({
                          weight: 6,
                          color: "#ef4444",
                          opacity: 0.95,
                        })}
                      />
                    )}
                  </MapContainer>
                ) : (
                  <div
                    style={{
                      height: "100%",
                      minHeight: 420,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: 12,
                      border: "1px dashed rgba(148,163,184,0.4)",
                      fontSize: 13,
                      opacity: 0.8,
                    }}
                  >
                    {"Carte indisponible (géométrie non trouvée dans le cadastre). Les calculs sont néanmoins réalisés."}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div style={rightCol}>
            {/* Contraintes PLU */}
            <div style={card}>
              <div style={title}>{"Contraintes PLU (v1)"}</div>
              <p style={{ fontSize: 13, margin: 0, opacity: 0.8 }}>
                {"Reculs et stationnement. La hauteur viendra ensuite."}
              </p>
              <div
                style={{
                  marginTop: 12,
                  fontSize: 13,
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <div>
                  {"Surface terrain : "}
                  <strong>{`${result.surfaceTerrainM2.toFixed(0)} m²`}</strong>
                </div>
                <div>
                  {"Après reculs : "}
                  <strong>
                    {`${result.surfaceTerrainApresReculsM2.toFixed(0)} m²`}
                  </strong>
                </div>
                <div>
                  {"Emprise max (ratio PLU) : "}
                  <strong>{`${result.surfaceEmpriseMaxM2.toFixed(0)} m²`}</strong>
                </div>
                <div
                  style={{
                    marginTop: 10,
                    paddingTop: 10,
                    borderTop: "1px solid rgba(148,163,184,0.25)",
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>
                    {"Reculs appliqués (PLU) : "}
                    <strong>
                      {reculsUsed?.mode === "DIRECTIONAL_BY_FACADE"
                        ? "directionnels (façade)"
                        : "uniformes"}
                    </strong>
                  </div>
                  <div>
                    {"Avant : "}
                    <strong>
                      {formatReculValue(reculsUsed?.recul_avant_m)}
                      {reculsUsed?.recul_avant_m !== null &&
                      reculsUsed?.recul_avant_m !== undefined &&
                      Number.isFinite(reculsUsed?.recul_avant_m)
                        ? " m"
                        : ""}
                    </strong>
                  </div>
                  <div>
                    {"Latéral : "}
                    <strong>
                      {formatReculValue(reculsUsed?.recul_lateral_m)}
                      {reculsUsed?.recul_lateral_m !== null &&
                      reculsUsed?.recul_lateral_m !== undefined &&
                      Number.isFinite(reculsUsed?.recul_lateral_m)
                        ? " m"
                        : ""}
                    </strong>
                  </div>
                  <div>
                    {"Fond : "}
                    <strong>
                      {formatReculValue(reculsUsed?.recul_fond_m)}
                      {reculsUsed?.recul_fond_m !== null &&
                      reculsUsed?.recul_fond_m !== undefined &&
                      Number.isFinite(reculsUsed?.recul_fond_m)
                        ? " m"
                        : ""}
                    </strong>
                  </div>
                  <div>
                    {"Max : "}
                    <strong>
                      {`${reculsUsed?.reculMax?.toFixed(1) ?? "0"} m`}
                    </strong>
                  </div>
                </div>
                <div
                  style={{
                    marginTop: 10,
                    paddingTop: 10,
                    borderTop: "1px solid rgba(148,163,184,0.25)",
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>
                    {"Façade (clic)"}
                  </div>
                  {facadeSegment ? (
                    <div style={{ opacity: 0.9 }}>
                      {"Segment sélectionné — distance clic ~ "}
                      <strong>
                        {`${Number(
                          (facadeSegment.properties as any)?.distance_m ?? 0,
                        ).toFixed(2)} m`}
                      </strong>
                    </div>
                  ) : (
                    <div style={{ opacity: 0.75 }}>
                      {"Non définie — clique un bord de parcelle."}
                    </div>
                  )}
                </div>
              </div>
            </div>
            {/* Parametres projet (enrichi) */}
            <div style={card}>
              <div style={title}>{"Paramètres projet"}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <label style={label}>
                  {"Nombre de bâtiments"}
                  <input
                    type="number"
                    min={1}
                    max={10}
                    style={input}
                    value={draftParams.nbBatiments}
                    onChange={(e) => {
                      const nb = Math.max(
                        1,
                        Math.min(10, Number(e.target.value) || 1),
                      );
                      setDraftParams((p: any) => {
                        const proj = p?.project ?? {
                          buildings: [],
                          validationRequested: false,
                        };
                        return {
                          ...p,
                          nbBatiments: nb,
                          project: {
                            ...proj,
                            buildings: normalizeBuildings(nb, proj.buildings),
                            validationRequested: false,
                          },
                        };
                      });
                    }}
                  />
                </label>
                <label style={label}>
                  {"Nombre de logements"}
                  <input
                    type="number"
                    min={1}
                    max={500}
                    style={input}
                    value={draftParams.nbLogements}
                    onChange={(e) =>
                      setDraftParams((p) => ({
                        ...p,
                        nbLogements: Math.max(1, Number(e.target.value) || 1),
                      }))
                    }
                  />
                </label>
                <label style={label}>
                  {"Surface moyenne par logement (m²)"}
                  <input
                    type="number"
                    min={20}
                    max={200}
                    style={input}
                    value={draftParams.surfaceMoyLogementM2}
                    onChange={(e) =>
                      setDraftParams((p) => ({
                        ...p,
                        surfaceMoyLogementM2: Math.max(
                          20,
                          Number(e.target.value) || 20,
                        ),
                      }))
                    }
                  />
                </label>
                <div
                  style={{
                    marginTop: 4,
                    paddingTop: 10,
                    borderTop: "1px solid rgba(148,163,184,0.25)",
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>
                    {"Bâtiment (gabarit)"}
                  </div>
                  <label style={label}>
                    {"Forme"}
                    <select
                      style={select}
                      value={
                        ((draftParams as any).project?.buildings?.[0]?.shape ??
                          "rectangle") as any
                      }
                      onChange={(e) => {
                        const v = e.target.value;
                        setDraftParams((p: any) => {
                          const proj = p?.project ?? {
                            buildings: [],
                            validationRequested: false,
                          };
                          const buildings = normalizeBuildings(
                            p.nbBatiments,
                            proj.buildings,
                          );
                          buildings[0] = { ...buildings[0], shape: v };
                          const propagated = buildings.map((b: any) => ({
                            ...b,
                            shape: v,
                          }));
                          return {
                            ...p,
                            project: {
                              ...proj,
                              buildings: propagated,
                              validationRequested: false,
                            },
                          };
                        });
                      }}
                    >
                      <option value="rectangle">{"Rectangle"}</option>
                      <option value="square">{"Carré"}</option>
                    </select>
                  </label>
                  <label style={label}>
                    {"Emprise souhaitée (m²) — par bâtiment"}
                    <input
                      type="number"
                      min={10}
                      max={5000}
                      style={input}
                      value={Number(
                        (draftParams as any).project?.buildings?.[0]
                          ?.footprintM2 ?? 300,
                      )}
                      onChange={(e) => {
                        const v = Math.max(10, Number(e.target.value) || 10);
                        setDraftParams((p: any) => {
                          const proj = p?.project ?? {
                            buildings: [],
                            validationRequested: false,
                          };
                          const buildings = normalizeBuildings(
                            p.nbBatiments,
                            proj.buildings,
                          );
                          buildings[0] = { ...buildings[0], footprintM2: v };
                          const propagated = buildings.map((b: any) => ({
                            ...b,
                            footprintM2: v,
                          }));
                          return {
                            ...p,
                            project: {
                              ...proj,
                              buildings: propagated,
                              validationRequested: false,
                            },
                          };
                        });
                      }}
                    />
                  </label>
                  <label style={label}>
                    {"Nombre d'étages"}
                    <input
                      type="number"
                      min={1}
                      max={20}
                      style={input}
                      value={Number(
                        (draftParams as any).project?.buildings?.[0]?.floors ??
                          2,
                      )}
                      onChange={(e) => {
                        const v = Math.max(1, Number(e.target.value) || 1);
                        setDraftParams((p: any) => {
                          const proj = p?.project ?? {
                            buildings: [],
                            validationRequested: false,
                          };
                          const buildings = normalizeBuildings(
                            p.nbBatiments,
                            proj.buildings,
                          );
                          buildings[0] = { ...buildings[0], floors: v };
                          const propagated = buildings.map((b: any) => ({
                            ...b,
                            floors: v,
                          }));
                          return {
                            ...p,
                            project: {
                              ...proj,
                              buildings: propagated,
                              validationRequested: false,
                            },
                          };
                        });
                      }}
                    />
                  </label>
                  <label style={label}>
                    {"Orientation"}
                    <select
                      style={select}
                      value={
                        ((draftParams as any).project?.buildings?.[0]
                          ?.orientation ?? "facade") as any
                      }
                      onChange={(e) => {
                        const v = e.target.value;
                        setDraftParams((p: any) => {
                          const proj = p?.project ?? {
                            buildings: [],
                            validationRequested: false,
                          };
                          const buildings = normalizeBuildings(
                            p.nbBatiments,
                            proj.buildings,
                          );
                          buildings[0] = { ...buildings[0], orientation: v };
                          const propagated = buildings.map((b: any) => ({
                            ...b,
                            orientation: v,
                          }));
                          return {
                            ...p,
                            project: {
                              ...proj,
                              buildings: propagated,
                              validationRequested: false,
                            },
                          };
                        });
                      }}
                    >
                      <option value="facade">{"Parallèle à la façade"}</option>
                      <option value="north">{"Nord"}</option>
                      <option value="south">{"Sud"}</option>
                      <option value="east">{"Est"}</option>
                      <option value="west">{"Ouest"}</option>
                    </select>
                  </label>
                  <label style={label}>
                    {"Façade"}
                    <select
                      style={select}
                      value={
                        ((draftParams as any).project?.buildings?.[0]?.facadeMode
                          ?.type ?? "alignement") as any
                      }
                      onChange={(e) => {
                        const v = e.target.value;
                        setDraftParams((p: any) => {
                          const proj = p?.project ?? {
                            buildings: [],
                            validationRequested: false,
                          };
                          const buildings = normalizeBuildings(
                            p.nbBatiments,
                            proj.buildings,
                          );
                          let fm: any = { type: "alignement" };
                          if (v === "retrait") {
                            const cur = buildings[0]?.facadeMode?.distanceM;
                            fm = {
                              type: "retrait",
                              distanceM: Number(cur) > 0 ? Number(cur) : 5,
                            };
                          }
                          buildings[0] = { ...buildings[0], facadeMode: fm };
                          const propagated = buildings.map((b: any) => ({
                            ...b,
                            facadeMode: fm,
                          }));
                          return {
                            ...p,
                            project: {
                              ...proj,
                              buildings: propagated,
                              validationRequested: false,
                            },
                          };
                        });
                      }}
                    >
                      <option value="alignement">{"Alignement"}</option>
                      <option value="retrait">{"Retrait"}</option>
                    </select>
                  </label>
                  {(((draftParams as any).project?.buildings?.[0]?.facadeMode
                    ?.type ?? "alignement") as any) === "retrait" && (
                    <label style={label}>
                      {"Retrait (m)"}
                      <input
                        type="number"
                        min={0}
                        max={100}
                        style={input}
                        value={Number(
                          (draftParams as any).project?.buildings?.[0]
                            ?.facadeMode?.distanceM ?? 5,
                        )}
                        onChange={(e) => {
                          const v = Math.max(0, Number(e.target.value) || 0);
                          setDraftParams((p: any) => {
                            const proj = p?.project ?? {
                              buildings: [],
                              validationRequested: false,
                            };
                            const buildings = normalizeBuildings(
                              p.nbBatiments,
                              proj.buildings,
                            );
                            const fm = { type: "retrait", distanceM: v };
                            buildings[0] = { ...buildings[0], facadeMode: fm };
                            const propagated = buildings.map((b: any) => ({
                              ...b,
                              facadeMode: fm,
                            }));
                            return {
                              ...p,
                              project: {
                                ...proj,
                                buildings: propagated,
                                validationRequested: false,
                              },
                            };
                          });
                        }}
                      />
                    </label>
                  )}
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      marginTop: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <button
                      style={{
                        ...primaryButton,
                        opacity: isDirty ? 1 : 0.55,
                        cursor: isDirty ? "pointer" : "not-allowed",
                        flex: 1,
                      }}
                      disabled={!isDirty}
                      onClick={() => {
                        setAppliedParams(() => {
                          const next: any = { ...draftParams };
                          if (next?.project)
                            next.project.validationRequested = false;
                          return next;
                        });
                        setApplyTick((t) => t + 1);
                      }}
                    >
                      {"Valider et recalculer"}
                    </button>
                    <button
                      style={{
                        ...ghostButton,
                        borderColor: "rgba(56,189,248,0.55)",
                        opacity: isDirty ? 0.55 : 1,
                        cursor: isDirty ? "not-allowed" : "pointer",
                        flex: 1,
                      }}
                      disabled={isDirty}
                      title={
                        isDirty
                          ? "Valide d'abord tes paramètres."
                          : "Lance la validation PLU"
                      }
                      onClick={() => {
                        setAppliedParams((p: any) => {
                          const proj =
                            p?.project ??
                            ({
                              buildings: normalizeBuildings(p.nbBatiments, []),
                              validationRequested: false,
                            } as any);
                          return {
                            ...p,
                            project: {
                              ...proj,
                              buildings: normalizeBuildings(
                                p.nbBatiments,
                                proj.buildings,
                              ),
                              validationRequested: true,
                            },
                          };
                        });
                        setApplyTick((t) => t + 1);
                      }}
                    >
                      {"Vérifier conformité PLU"}
                    </button>
                  </div>
                  <div style={{ marginTop: 10 }}>
                    {validationOk ? (
                      <div style={{ fontSize: 13, color: "#86efac" }}>
                        {"✅ Projet compatible avec les contraintes PLU (v1)"}
                      </div>
                    ) : validationErrors.length > 0 ? (
                      <div style={{ fontSize: 13, color: "#fb7185" }}>
                        <div style={{ fontWeight: 700, marginBottom: 6 }}>
                          {"❌ Incompatibilités détectées"}
                        </div>
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                          {validationErrors
                            .slice(0, 8)
                            .map((er: any, idx: number) => (
                              <li key={idx} style={{ marginBottom: 4 }}>
                                {er?.message ?? String(er)}
                              </li>
                            ))}
                        </ul>
                        {validationErrors.length > 8 && (
                          <div style={{ opacity: 0.9, marginTop: 6 }}>
                            {`+ ${validationErrors.length - 8} autres…`}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div style={{ fontSize: 13, opacity: 0.75 }}>
                        {"Renseigne les paramètres puis clique "}
                        <b>{"Vérifier conformité PLU"}</b>{"."}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
            {/* Parkings */}
            <div style={card}>
              <div style={title}>{"Parkings & emprise utile"}</div>
              <div
                style={{
                  fontSize: 13,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <div>
                  {"Places de parking requises : "}
                  <strong>{result.placesParking}</strong>
                </div>
                <div>
                  {"Surface parkings (incl. manoeuvres) : "}
                  <strong>{`${result.surfaceParkingM2.toFixed(0)} m²`}</strong>
                </div>
                <div>
                  {"Surface résiduelle pour les bâtiments : "}
                  <strong>{`${result.surfaceEmpriseUtilisableM2.toFixed(0)} m²`}</strong>
                </div>
                <div style={{ marginTop: 8, opacity: 0.8 }}>
                  {"(v1 : enveloppe après reculs + parkings, puis validation PLU avant génération du bâtiment.)"}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

// pour compat : import { Implantation2DPage } ET import default
export default Implantation2DPage;