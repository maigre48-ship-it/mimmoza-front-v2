// src/spaces/promoteur/Implantation2DPage.tsx
// Refactored: delegates reculs logic to reculsEngine, draw logic to drawEngine
// Updated: passes meta (buildingKind, floorsSpec, nbLogements, surfaceMoyLogementM2) to store
// Updated: persists to promoteurSnapshot.store for cross-module data sharing
// ✅ V1.1: Uses useFoncierSelection for multi-parcel support + fitBounds on all parcels
// ✅ V1.2: UX fixes - auto edit mode, removed dropdown, sticky layout
// ✅ V1.3: Layout fix - sticky toolbar with proper offset, map height stabilization, scroll anchoring fix
// ✅ V1.5: Layout fix - minimal gap between nav and toolbar (max 20px)
// ✅ V1.6: Layout fix - fixed height layout, no page scroll, only right column scrolls

import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { useSearchParams, useNavigate, useLocation } from "react-router-dom";
import { MapContainer, TileLayer, GeoJSON, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import type {
  Feature,
  FeatureCollection,
  Polygon,
  MultiPolygon,
  Geometry,
  LineString,
  Position,
} from "geojson";
import * as turf from "@turf/turf";

import type { ImplantationUserParams, ImplantationResult, PluRules } from "./types";
import computeImplantationV1 from "./implantation";

// -----------------------------------------------------------------------------
// Engine imports - delegated logic
// -----------------------------------------------------------------------------
import {
  useReculEngine as useReculsEngine,
  type ReculEngineState as ReculsEngineState,
  type AppliedReculs,
} from "./implantation2d/reculEngine";

import {
  useDrawEngine,
  DrawEngineLayers,
  type DrawEngineState,
  type DrawnObject,
  type DrawnObjectType,
  type BuildingTemplate,
  type ParkingTemplate,
} from "./implantation2d/drawEngine";

// -----------------------------------------------------------------------------
// ✅ Import useFoncierSelection for multi-parcel support
// -----------------------------------------------------------------------------
import { useFoncierSelection, extractCommuneInsee, type SelectedParcel } from "./shared/hooks/useFoncierSelection";

// -----------------------------------------------------------------------------
// Zustand store import for handoff to Massing 3D / Bilan Promoteur
// -----------------------------------------------------------------------------
import { usePromoteurProjectStore, type Implantation2DMeta, type FloorsSpec as StoreFloorsSpec } from "./store/promoteurProject.store";

// -----------------------------------------------------------------------------
// Snapshot store import for cross-module persistence
// -----------------------------------------------------------------------------
import { patchPromoteurSnapshot, patchModule } from "./shared/promoteurSnapshot.store";

// Geoman CSS still needed for draw controls styling
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const RESOLVED_RULESET_LOCALSTORAGE_KEY = "mimmoza.plu.resolved_ruleset_v1";

const LS_KEYS = {
  COMMUNE_INSEE_SELECTED: "mimmoza.plu.selected_commune_insee",
  COMMUNE_INSEE_LAST: "mimmoza.plu.last_commune_insee",
  PARCEL_ID_SELECTED: "mimmoza.foncier.selected_parcel_id",
  PARCEL_ID_LAST: "mimmoza.foncier.last_parcel_id",
} as const;

// -----------------------------------------------------------------------------
// Coefficients for surface estimates
// -----------------------------------------------------------------------------
const COEF_SDP = 1.0;
const COEF_HABITABLE_COLLECTIF = 0.82;
const COEF_HABITABLE_INDIVIDUEL = 0.90;

// -----------------------------------------------------------------------------
// Types
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
  [key: string]: unknown;
}

type LocationState = {
  parcelGeometry?: unknown;
  surfaceTerrainM2?: number | null;
  pluRules?: PluRules | null;
  massing?: unknown | null;
  pluRuleset?: ResolvedPluRuleset | null;
  parcelId?: string | null;
  parcel_id?: string | null;
  communeInsee?: string | null;
  commune_insee?: string | null;
};

interface BuildingSpec {
  shape: "rectangle" | "square";
  footprintM2: number;
  floors: number;
  orientation: string;
  facadeMode: { type: string; distanceM?: number };
}

interface ProjectConfig {
  buildings: BuildingSpec[];
  validationRequested: boolean;
}

type BuildingKind = "INDIVIDUEL" | "COLLECTIF";

type FloorsSpec = {
  aboveGroundFloors: number;
  groundFloorHeightM: number;
  typicalFloorHeightM: number;
};

// -----------------------------------------------------------------------------
// Helpers: LocalStorage (safe read)
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
// Helpers: Ruleset validation
// -----------------------------------------------------------------------------
function loadResolvedRulesetFromLocalStorage(): ResolvedPluRuleset | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem(RESOLVED_RULESET_LOCALSTORAGE_KEY);
    if (!raw) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== "object") return null;
    if ((parsed as Record<string, unknown>).version !== "plu_ruleset_v1") return null;
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

// -----------------------------------------------------------------------------
// Helpers: Geometry normalization
// -----------------------------------------------------------------------------
function normalizeToFeature(raw: unknown): Feature<Polygon | MultiPolygon> | null {
  if (!raw) return null;
  const data = raw as Record<string, unknown>;
  if (data.type === "FeatureCollection" && Array.isArray(data.features)) {
    const f = data.features.find((x: unknown) => {
      const feat = x as Record<string, unknown>;
      const geom = feat?.geometry as Record<string, unknown> | undefined;
      return feat?.type === "Feature" && (geom?.type === "Polygon" || geom?.type === "MultiPolygon");
    });
    return f ? (f as Feature<Polygon | MultiPolygon>) : null;
  }
  if (Array.isArray(data.features)) {
    const f = data.features.find((x: unknown) => {
      const feat = x as Record<string, unknown>;
      const geom = feat?.geometry as Record<string, unknown> | undefined;
      return feat?.type === "Feature" && (geom?.type === "Polygon" || geom?.type === "MultiPolygon");
    });
    return f ? (f as Feature<Polygon | MultiPolygon>) : null;
  }
  if (data.type === "Feature" && data.geometry) {
    const g = data.geometry as Record<string, unknown>;
    if (g.type === "Polygon" || g.type === "MultiPolygon") {
      return data as unknown as Feature<Polygon | MultiPolygon>;
    }
  }
  if (data.type === "Polygon" || data.type === "MultiPolygon") {
    return {
      type: "Feature",
      geometry: data as Geometry,
      properties: {},
    } as Feature<Polygon | MultiPolygon>;
  }
  if (data.geometry) {
    const g = data.geometry as Record<string, unknown>;
    if (g.type === "Polygon" || g.type === "MultiPolygon") {
      return {
        type: "Feature",
        geometry: data.geometry as Geometry,
        properties: (data.properties as Record<string, unknown>) ?? {},
      } as Feature<Polygon | MultiPolygon>;
    }
  }
  return null;
}

function findFeatureForParcel(
  fc: FeatureCollection<Geometry, Record<string, unknown>>,
  parcelId: string
): Feature<Geometry, Record<string, unknown>> | null {
  const target = String(parcelId).trim();
  if (!target) return null;
  for (const f of fc.features) {
    const p = (f.properties || {}) as Record<string, unknown>;
    const candidates = [f.id, p.id, p.parcel_id, p.parcelle_id, p.idu, p.IDU]
      .filter((v) => v !== undefined && v !== null)
      .map((v) => String(v).trim());
    if (candidates.includes(target)) return f;
  }
  return null;
}

function extractFeatureCollectionFromAnyResponse(
  data: unknown,
  depth: number = 0
): FeatureCollection<Geometry, Record<string, unknown>> | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  if (obj.type === "FeatureCollection" && Array.isArray(obj.features)) {
    return data as FeatureCollection<Geometry, Record<string, unknown>>;
  }
  if (depth > 4) return null;
  const preferredKeys = ["geojson", "data", "cadastre", "parcelles"];
  for (const key of preferredKeys) {
    const v = obj[key];
    if (v && typeof v === "object") {
      const fc = extractFeatureCollectionFromAnyResponse(v, depth + 1);
      if (fc) return fc;
    }
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") {
      const fc = extractFeatureCollectionFromAnyResponse(v, depth + 1);
      if (fc) return fc;
    }
  }
  return null;
}

// -----------------------------------------------------------------------------
// Helpers: Implantation fallback (no geometry)
// -----------------------------------------------------------------------------
function computeImplantationWithoutGeom(
  surfaceTerrainM2: number,
  pluRules: PluRules | null,
  userParams: ImplantationUserParams
): ImplantationResult {
  const safeRules = (pluRules ?? {}) as Record<string, unknown>;
  const surfaceTerrainApresReculsM2 = surfaceTerrainM2;
  const empriseObj = safeRules.emprise as Record<string, unknown> | undefined;
  const empriseSolObj = safeRules.emprise_sol as Record<string, unknown> | undefined;
  const empriseRaw = empriseObj?.emprise_max_ratio ?? empriseSolObj?.emprise_sol_max ?? null;
  let empriseRatio = (empriseRaw as number) ?? 0.4;
  if (empriseRatio > 1 && empriseRatio <= 100) empriseRatio = empriseRatio / 100;
  if (empriseRatio <= 0 || !Number.isFinite(empriseRatio)) empriseRatio = 0.4;
  const surfaceEmpriseMaxM2 = surfaceTerrainApresReculsM2 * empriseRatio;
  const stationnement = safeRules.stationnement as Record<string, unknown> | null;
  const placesParLogement = (stationnement?.places_par_logement as number) ?? 1;
  const surfaceParPlaceM2 = (stationnement?.surface_par_place_m2 as number) ?? 25;
  const placesParking = Math.ceil(userParams.nbLogements * placesParLogement);
  const surfaceParkingM2 = placesParking * surfaceParPlaceM2;
  const surfaceMaxDisponiblePourBatimentsM2 = surfaceTerrainApresReculsM2 - surfaceParkingM2;
  const surfaceEmpriseUtilisableM2 = Math.max(0, Math.min(surfaceEmpriseMaxM2, surfaceMaxDisponiblePourBatimentsM2));
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
// Helpers: DrawnObject[] to FeatureCollection<Polygon> conversion
// -----------------------------------------------------------------------------
function drawnObjectsToFeatureCollection(
  objects: DrawnObject[]
): FeatureCollection<Polygon> {
  const features: Feature<Polygon>[] = [];

  for (const obj of objects) {
    const record = obj as unknown as Record<string, unknown>;
    let extractedFeature: Feature<Polygon> | null = null;

    // Try obj.feature (Feature<Polygon>)
    if (record.feature && typeof record.feature === "object") {
      const feat = record.feature as Record<string, unknown>;
      if (feat.type === "Feature" && feat.geometry) {
        const geom = feat.geometry as Record<string, unknown>;
        if (geom.type === "Polygon") {
          extractedFeature = {
            type: "Feature",
            geometry: geom as Polygon,
            properties: (feat.properties as Record<string, unknown>) ?? { id: obj.id },
          };
        }
      }
    }

    // Try obj.geojson (Feature<Polygon> or Geometry Polygon)
    if (!extractedFeature && record.geojson && typeof record.geojson === "object") {
      const gj = record.geojson as Record<string, unknown>;
      if (gj.type === "Feature" && gj.geometry) {
        const geom = gj.geometry as Record<string, unknown>;
        if (geom.type === "Polygon") {
          extractedFeature = {
            type: "Feature",
            geometry: geom as Polygon,
            properties: (gj.properties as Record<string, unknown>) ?? { id: obj.id },
          };
        }
      } else if (gj.type === "Polygon" && Array.isArray(gj.coordinates)) {
        extractedFeature = {
          type: "Feature",
          geometry: gj as Polygon,
          properties: { id: obj.id },
        };
      }
    }

    // Try obj.geometry (Geometry Polygon)
    if (!extractedFeature && record.geometry && typeof record.geometry === "object") {
      const geom = record.geometry as Record<string, unknown>;
      if (geom.type === "Polygon" && Array.isArray(geom.coordinates)) {
        extractedFeature = {
          type: "Feature",
          geometry: geom as Polygon,
          properties: { id: obj.id },
        };
      }
    }

    // If we extracted a valid feature, add it
    if (extractedFeature) {
      features.push(extractedFeature);
    }
  }

  return {
    type: "FeatureCollection",
    features,
  };
}

// -----------------------------------------------------------------------------
// Project defaults
// -----------------------------------------------------------------------------
const DEFAULT_BUILDING_SPEC: BuildingSpec = {
  shape: "rectangle",
  footprintM2: 300,
  floors: 2,
  orientation: "facade",
  facadeMode: { type: "alignement" },
};

function normalizeBuildings(nbBatiments: number, current: BuildingSpec[] | undefined): BuildingSpec[] {
  const n = Math.max(1, Math.min(10, Number(nbBatiments) || 1));
  const arr = Array.isArray(current) ? [...current] : [];
  while (arr.length < n) arr.push({ ...DEFAULT_BUILDING_SPEC });
  if (arr.length > n) arr.length = n;
  return arr;
}

function projectComparable(p: ProjectConfig | undefined) {
  const buildings = Array.isArray(p?.buildings) ? p.buildings : [];
  return {
    validationRequested: !!p?.validationRequested,
    buildings: buildings.map((b) => ({
      shape: b?.shape ?? "rectangle",
      footprintM2: Number(b?.footprintM2) || 0,
      floors: Number(b?.floors) || 0,
      orientation: b?.orientation ?? "facade",
      facadeModeType: b?.facadeMode?.type ?? "alignement",
      facadeOffset: Number(b?.facadeMode?.distanceM) || 0,
    })),
  };
}

// -----------------------------------------------------------------------------
// ✅ Leaflet helper: Fit to multiple features
// -----------------------------------------------------------------------------
function FitToFeatures({ features }: { features: Feature<Polygon | MultiPolygon>[] }) {
  const map = useMap();
  const fittedRef = useRef(false);

  useEffect(() => {
    if (features.length === 0) return;
    if (fittedRef.current) return; // Only fit once on mount

    try {
      // Compute combined bbox of all features
      let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;

      for (const feature of features) {
        const b = turf.bbox(feature);
        minLng = Math.min(minLng, b[0]);
        minLat = Math.min(minLat, b[1]);
        maxLng = Math.max(maxLng, b[2]);
        maxLat = Math.max(maxLat, b[3]);
      }

      if (minLng !== Infinity) {
        const bounds: L.LatLngBoundsExpression = [
          [minLat, minLng],
          [maxLat, maxLng],
        ];
        map.fitBounds(bounds, { padding: [30, 30], maxZoom: 21 });
        fittedRef.current = true;
      }
    } catch (err) {
      console.warn("[FitToFeatures] Error computing bounds:", err);
    }
  }, [features, map]);

  return null;
}

// -----------------------------------------------------------------------------
// Facade Click Handler - delegates to reculsEngine
// -----------------------------------------------------------------------------
function FacadeClickHandler({
  enabled,
  onClickLatLng,
}: {
  enabled: boolean;
  onClickLatLng: (lngLat: [number, number]) => void;
}) {
  useMapEvents({
    click: (e) => {
      if (!enabled) return;
      onClickLatLng([e.latlng.lng, e.latlng.lat]);
    },
  });
  return null;
}

// -----------------------------------------------------------------------------
// Map Reculs Control (UI overlay)
// -----------------------------------------------------------------------------
function MapReculsControl({ reculs }: { reculs: AppliedReculs | null }) {
  const map = useMap();

  useEffect(() => {
    if (!map) return;

    const control = L.control({ position: "topright" });
    control.onAdd = () => {
      const div = L.DomUtil.create("div");
      div.style.background = "rgba(255, 255, 255, 0.96)";
      div.style.border = "1px solid #e2e8f0";
      div.style.borderRadius = "12px";
      div.style.padding = "10px 12px";
      div.style.color = "#0f172a";
      div.style.fontSize = "12px";
      div.style.lineHeight = "1.35";
      div.style.boxShadow = "0 1px 3px rgba(0,0,0,0.06), 0 10px 24px rgba(0,0,0,0.06)";
      div.style.minWidth = "210px";
      div.style.pointerEvents = "auto";

      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.disableScrollPropagation(div);

      if (!reculs) {
        div.innerHTML = `
          <div style="font-weight:700; margin-bottom:6px; color:#0f172a;">Reculs PLU</div>
          <div style="color:#64748b; font-size:11px;">En attente du ruleset PLU…</div>
          <div style="margin-top:8px; opacity:.85; font-size:11px; color:#475569;">Clique sur un bord pour définir la façade</div>
        `;
      } else {
        const formatVal = (v: number): string => `${v} m`;
        let modeLabel: string;
        let modeColor: string;
        switch (reculs.mode) {
          case "DIRECTIONAL_BY_FACADE":
            modeLabel = "directionnel ✓";
            modeColor = "#16a34a";
            break;
          case "FALLBACK_UNIFORM":
            modeLabel = "uniforme (fallback)";
            modeColor = "#ea580c";
            break;
          default:
            modeLabel = "uniforme";
            modeColor = "#64748b";
        }

        const dataNote = reculs.hasData
          ? ""
          : `<div style="margin-top:6px; font-size:11px; color:#ea580c;">⚠️ Aucune donnée PLU, valeurs par défaut (0)</div>`;

        const facadeNote = reculs.hasFacade
          ? `<div style="margin-top:6px; font-size:11px; color:#16a34a;">✓ Façade définie</div>`
          : `<div style="margin-top:6px; opacity:.85; font-size:11px; color:#475569;">Clique sur un bord pour définir la façade</div>`;

        div.innerHTML = `
          <div style="font-weight:700; margin-bottom:6px; color:#0f172a;">Reculs PLU</div>
          <div>Avant : <b>${formatVal(reculs.recul_avant_m)}</b></div>
          <div>Latéral : <b>${formatVal(reculs.recul_lateral_m)}</b></div>
          <div>Fond : <b>${formatVal(reculs.recul_fond_m)}</b></div>
          <div style="margin-top:6px; padding-top:6px; border-top:1px solid #e2e8f0;">
            Mode : <b style="color:${modeColor}">${modeLabel}</b>
          </div>
          ${dataNote}
          ${facadeNote}
        `;
      }
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
// UI Panels
// -----------------------------------------------------------------------------
function PluRulesetBlockingPanel({
  missingFields,
  onReturnClick,
}: {
  missingFields: string[];
  onReturnClick: () => void;
}) {
  const panelStyle: React.CSSProperties = {
    background: "linear-gradient(135deg, rgba(239,68,68,0.08), rgba(249,115,22,0.05))",
    border: "1px solid rgba(239,68,68,0.4)",
    borderRadius: 16,
    padding: 24,
    marginBottom: 16,
  };
  const titleStyle: React.CSSProperties = {
    fontSize: 18,
    fontWeight: 700,
    color: "#dc2626",
    marginBottom: 12,
  };
  const buttonStyle: React.CSSProperties = {
    padding: "12px 20px",
    borderRadius: 999,
    border: "none",
    background: "linear-gradient(135deg, rgba(239,68,68,1), rgba(249,115,22,1))",
    color: "white",
    fontWeight: 600,
    cursor: "pointer",
    marginTop: 16,
  };

  return (
    <div style={panelStyle}>
      <div style={titleStyle}>{"⚠️ Règles PLU absentes ou incomplètes"}</div>
      <p style={{ fontSize: 14, opacity: 0.9, margin: 0, color: "#0f172a" }}>
        {"Le calcul d'implantation nécessite un ruleset PLU résolu et complet."}
      </p>
      {missingFields.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#0f172a" }}>{"Champs manquants :"}</div>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, opacity: 0.85, color: "#334155" }}>
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

function MissingParcelParamsPanel({
  missingParcels,
  missingCommuneInsee,
  onReturnClick,
}: {
  missingParcels: boolean;
  missingCommuneInsee: boolean;
  onReturnClick: () => void;
}) {
  const panelStyle: React.CSSProperties = {
    background: "linear-gradient(135deg, rgba(251,146,60,0.08), rgba(234,179,8,0.05))",
    border: "1px solid rgba(251,146,60,0.4)",
    borderRadius: 16,
    padding: 24,
    marginBottom: 16,
    maxWidth: 600,
  };
  const titleStyle: React.CSSProperties = {
    fontSize: 18,
    fontWeight: 700,
    color: "#ea580c",
    marginBottom: 12,
  };
  const buttonStyle: React.CSSProperties = {
    padding: "12px 20px",
    borderRadius: 999,
    border: "none",
    background: "linear-gradient(135deg, rgba(251,146,60,1), rgba(234,179,8,1))",
    color: "white",
    fontWeight: 600,
    cursor: "pointer",
    marginTop: 16,
  };

  const missingItems: string[] = [];
  if (missingParcels) missingItems.push("Sélection de parcelles");
  if (missingCommuneInsee) missingItems.push("Code INSEE de la commune (commune_insee)");

  return (
    <div style={panelStyle}>
      <div style={titleStyle}>{"⚠️ Paramètres de parcelle manquants"}</div>
      <p style={{ fontSize: 14, opacity: 0.9, margin: 0, color: "#0f172a" }}>
        {"Cette page nécessite une sélection de parcelles."}
      </p>
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#0f172a" }}>{"Paramètres manquants :"}</div>
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, opacity: 0.85, color: "#334155" }}>
          {missingItems.map((item, idx) => (
            <li key={idx}>{item}</li>
          ))}
        </ul>
      </div>
      <button style={buttonStyle} onClick={onReturnClick}>
        {"← Sélectionner une parcelle"}
      </button>
    </div>
  );
}

function DrawnObjectsPanel({
  buildings,
  parkings,
  activeId,
  onSelect,
  onDelete,
  onClearAll,
}: {
  buildings: DrawnObject[];
  parkings: DrawnObject[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onClearAll?: () => void;
}) {
  const card: React.CSSProperties = {
    background: "white",
    borderRadius: 14,
    padding: 14,
    border: "1px solid #e2e8f0",
    boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 10px 24px rgba(0,0,0,0.06)",
  };
  const title: React.CSSProperties = { fontSize: 14, fontWeight: 600, marginBottom: 6, color: "#0f172a" };
  const totalBuildings = buildings.reduce((acc, b) => acc + b.areaM2, 0);
  const totalParkings = parkings.reduce((acc, p) => acc + p.areaM2, 0);

  const ObjectItem = ({ obj }: { obj: DrawnObject }) => {
    const isActive = obj.id === activeId;
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 8px",
          borderRadius: 8,
          background: isActive ? "rgba(56,189,248,0.12)" : "#f8fafc",
          border: isActive ? "1px solid rgba(56,189,248,0.5)" : "1px solid #e2e8f0",
          cursor: "pointer",
          marginBottom: 4,
        }}
        onClick={() => onSelect(obj.id)}
      >
        <span style={{ fontSize: 13, color: "#0f172a" }}>
          {obj.type === "building" ? "🏢" : "🅿️"} {obj.areaM2.toFixed(0)} m²
        </span>
        <button
          style={{
            background: "rgba(239,68,68,0.1)",
            border: "1px solid rgba(239,68,68,0.4)",
            borderRadius: 6,
            color: "#dc2626",
            padding: "2px 8px",
            fontSize: 11,
            cursor: "pointer",
          }}
          onClick={(e) => {
            e.stopPropagation();
            onDelete(obj.id);
          }}
        >
          ✕
        </button>
      </div>
    );
  };

  return (
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={title}>{"Objets dessinés"}</div>
        {(buildings.length > 0 || parkings.length > 0) && onClearAll && (
          <button
            style={{
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: 6,
              color: "#dc2626",
              padding: "4px 8px",
              fontSize: 11,
              cursor: "pointer",
            }}
            onClick={onClearAll}
          >
            {"Tout effacer"}
          </button>
        )}
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#16a34a" }}>
          {"Bâtiments"} <span style={{ opacity: 0.7 }}>({buildings.length})</span>
        </div>
        {buildings.length === 0 ? (
          <div style={{ fontSize: 12, opacity: 0.6, paddingLeft: 8, color: "#64748b" }}>{"Aucun bâtiment"}</div>
        ) : (
          buildings.map((b) => <ObjectItem key={b.id} obj={b} />)
        )}
        {buildings.length > 0 && (
          <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4, paddingLeft: 8, color: "#334155" }}>
            {"Total : "}
            <strong>{totalBuildings.toFixed(0)} m²</strong>
          </div>
        )}
      </div>

      <div>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#9333ea" }}>
          {"Parkings"} <span style={{ opacity: 0.7 }}>({parkings.length})</span>
        </div>
        {parkings.length === 0 ? (
          <div style={{ fontSize: 12, opacity: 0.6, paddingLeft: 8, color: "#64748b" }}>{"Aucun parking"}</div>
        ) : (
          parkings.map((p) => <ObjectItem key={p.id} obj={p} />)
        )}
        {parkings.length > 0 && (
          <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4, paddingLeft: 8, color: "#334155" }}>
            {"Total : "}
            <strong>{totalParkings.toFixed(0)} m²</strong>
          </div>
        )}
      </div>
    </div>
  );
}

function ShapeLibraryPanel({
  onCreateShape,
  disabled,
}: {
  onCreateShape: (template: BuildingTemplate | ParkingTemplate, type: DrawnObjectType) => void;
  disabled: boolean;
}) {
  const card: React.CSSProperties = {
    background: "white",
    borderRadius: 14,
    padding: 14,
    border: "1px solid #e2e8f0",
    boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 10px 24px rgba(0,0,0,0.06)",
  };
  const title: React.CSSProperties = { fontSize: 14, fontWeight: 600, marginBottom: 10, color: "#0f172a" };
  const buttonStyle: React.CSSProperties = {
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid #cbd5e1",
    background: "#f8fafc",
    color: "#0f172a",
    fontSize: 12,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    flex: 1,
    textAlign: "center",
  };

  const buildingTemplates: { label: string; template: BuildingTemplate }[] = [
    { label: "▭ Rectangle", template: "rectangle" },
    { label: "□ Carré", template: "square" },
    { label: "⌐ L", template: "l-shape" },
    { label: "⊓ U", template: "u-shape" },
  ];

  const parkingTemplates: { label: string; template: ParkingTemplate }[] = [
    { label: "▭ Rectangle", template: "rectangle" },
    { label: "▬ Bande", template: "strip" },
  ];

  return (
    <div style={card}>
      <div style={title}>{"Bibliothèque de formes"}</div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: "#16a34a" }}>{"Bâtiments"}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {buildingTemplates.map(({ label, template }) => (
            <button
              key={template}
              style={buttonStyle}
              disabled={disabled}
              onClick={() => !disabled && onCreateShape(template, "building")}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: "#9333ea" }}>{"Parkings"}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {parkingTemplates.map(({ label, template }) => (
            <button
              key={template}
              style={buttonStyle}
              disabled={disabled}
              onClick={() => !disabled && onCreateShape(template, "parking")}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {disabled && (
        <div style={{ fontSize: 11, opacity: 0.6, marginTop: 8, color: "#64748b" }}>
          {"Sélectionnez une façade pour activer le mode édition."}
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Volumetry Summary Panel
// -----------------------------------------------------------------------------
function VolumetrySummaryPanel({
  buildingKind,
  floorsSpec,
  drawnBuildings,
}: {
  buildingKind: BuildingKind;
  floorsSpec: FloorsSpec;
  drawnBuildings: DrawnObject[];
}) {
  const card: React.CSSProperties = {
    background: "white",
    borderRadius: 14,
    padding: 14,
    border: "1px solid #e2e8f0",
    boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 10px 24px rgba(0,0,0,0.06)",
  };
  const title: React.CSSProperties = { fontSize: 14, fontWeight: 600, marginBottom: 10, color: "#0f172a" };

  const levelsCount = 1 + floorsSpec.aboveGroundFloors;
  const totalHeightM = floorsSpec.groundFloorHeightM + floorsSpec.aboveGroundFloors * floorsSpec.typicalFloorHeightM;
  const footprintTotal = drawnBuildings.reduce((acc, b) => acc + b.areaM2, 0);
  const sdpEstimee = footprintTotal * levelsCount * COEF_SDP;
  const coefHabitable = buildingKind === "COLLECTIF" ? COEF_HABITABLE_COLLECTIF : COEF_HABITABLE_INDIVIDUEL;
  const habitableEstimee = sdpEstimee * coefHabitable;

  return (
    <div style={card}>
      <div style={title}>{"Volumétrie & surfaces (estimations)"}</div>
      <div style={{ fontSize: 13, display: "flex", flexDirection: "column", gap: 6, color: "#334155" }}>
        <div>
          {"Type de bâtiment : "}
          <strong style={{ color: "#0f172a" }}>{buildingKind === "COLLECTIF" ? "Collectif" : "Individuel"}</strong>
        </div>
        <div>
          {"Niveaux : "}
          <strong style={{ color: "#0f172a" }}>R+{floorsSpec.aboveGroundFloors} ({levelsCount} niveaux)</strong>
        </div>
        <div>
          {"Hauteur totale estimée : "}
          <strong style={{ color: "#0f172a" }}>{totalHeightM.toFixed(1)} m</strong>
        </div>
        <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid #e2e8f0" }}>
          {"Empreinte bâtiments : "}
          <strong style={{ color: "#0f172a" }}>{footprintTotal.toFixed(0)} m²</strong>
        </div>
        <div>
          {"SDP estimée : "}
          <strong style={{ color: "#0f172a" }}>{sdpEstimee.toFixed(0)} m²</strong>
        </div>
        <div>
          {"Habitable estimée : "}
          <strong style={{ color: "#0f172a" }}>{habitableEstimee.toFixed(0)} m²</strong>
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// ✅ Selected Parcels Summary Panel
// -----------------------------------------------------------------------------
function SelectedParcelsPanel({
  parcels,
  totalAreaM2,
}: {
  parcels: { id: string; area_m2: number | null }[];
  totalAreaM2: number | null;
}) {
  const card: React.CSSProperties = {
    background: "white",
    borderRadius: 14,
    padding: 14,
    border: "1px solid #e2e8f0",
    boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 10px 24px rgba(0,0,0,0.06)",
  };
  const title: React.CSSProperties = { fontSize: 14, fontWeight: 600, marginBottom: 10, color: "#0f172a" };

  return (
    <div style={card}>
      <div style={title}>{"Parcelles sélectionnées"} <span style={{ opacity: 0.6 }}>({parcels.length})</span></div>
      <div style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4, maxHeight: 120, overflowY: "auto" }}>
        {parcels.map((p) => (
          <div key={p.id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #f1f5f9" }}>
            <span style={{ fontFamily: "monospace", color: "#334155" }}>{p.id}</span>
            <span style={{ color: "#64748b" }}>{p.area_m2 != null ? `${Math.round(p.area_m2).toLocaleString("fr-FR")} m²` : "—"}</span>
          </div>
        ))}
      </div>
      {totalAreaM2 != null && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontWeight: 600, color: "#0f172a" }}>{"Surface totale"}</span>
          <span style={{ fontWeight: 700, color: "#0f172a", background: "#e0f2fe", padding: "2px 8px", borderRadius: 6 }}>
            {Math.round(totalAreaM2).toLocaleString("fr-FR")} m²
          </span>
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Main Component
// -----------------------------------------------------------------------------
export const Implantation2DPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state || {}) as LocationState;

  // ✅ Extract studyId from query params
  const studyId = searchParams.get("study");

  // --------------------------------------------------
  // ✅ Use useFoncierSelection hook for multi-parcel support
  // --------------------------------------------------
  const {
    selectedParcels,
    communeInsee: foncierCommuneInsee,
    focusParcelId,
    totalAreaM2: foncierTotalAreaM2,
    isHydrated: foncierIsHydrated,
  } = useFoncierSelection({ studyId });

  // --------------------------------------------------
  // Zustand store action for handoff to Massing 3D / Bilan Promoteur
  // --------------------------------------------------
  const setFromImplantation2D = usePromoteurProjectStore((s) => s.setFromImplantation2D);

  // --------------------------------------------------
  // ✅ Derived values from foncier selection
  // --------------------------------------------------
  const parcelIds = useMemo(() => selectedParcels.map((p) => p.id), [selectedParcels]);
  const primaryParcelId = focusParcelId || parcelIds[0] || null;
  const communeInsee = foncierCommuneInsee || (primaryParcelId ? extractCommuneInsee(primaryParcelId) : null);

  const missingParcels = parcelIds.length === 0;
  const missingCommuneInsee = !communeInsee;
  const hasMissingParams = missingParcels || missingCommuneInsee;

  const [error, setError] = useState<string | null>(null);
  const [isLoadingGeometry, setIsLoadingGeometry] = useState(false);

  // --------------------------------------------------
  // Ruleset validation
  // --------------------------------------------------
  const resolvedRuleset = useMemo<ResolvedPluRuleset | null>(() => {
    if (state.pluRuleset && typeof state.pluRuleset === "object") {
      return state.pluRuleset;
    }
    return loadResolvedRulesetFromLocalStorage();
  }, [state.pluRuleset]);

  const rulesetValid = useMemo(() => isValidResolvedRuleset(resolvedRuleset), [resolvedRuleset]);

  const rulesetMissingFields = useMemo<string[]>(() => {
    if (!resolvedRuleset) return ["Ruleset PLU non trouvé"];
    if (resolvedRuleset.version !== "plu_ruleset_v1") {
      return [`Version invalide: ${resolvedRuleset.version ?? "undefined"}`];
    }
    if (!resolvedRuleset.completeness) return ["Champ completeness absent"];
    if (resolvedRuleset.completeness.ok !== true) {
      return resolvedRuleset.completeness.missing ?? ["Complétude non validée"];
    }
    return [];
  }, [resolvedRuleset]);

  // --------------------------------------------------
  // Building kind state (COLLECTIF / INDIVIDUEL)
  // --------------------------------------------------
  const [buildingKind, setBuildingKind] = useState<BuildingKind>("COLLECTIF");

  // --------------------------------------------------
  // Floors spec state
  // --------------------------------------------------
  const [floorsSpec, setFloorsSpec] = useState<FloorsSpec>({
    aboveGroundFloors: 1,
    groundFloorHeightM: 2.8,
    typicalFloorHeightM: 2.7,
  });

  // --------------------------------------------------
  // User params state
  // --------------------------------------------------
  const [draftParams, setDraftParams] = useState<ImplantationUserParams>(() => ({
    nbBatiments: 1,
    nbLogements: 1,
    surfaceMoyLogementM2: 60,
    project: { buildings: [DEFAULT_BUILDING_SPEC], validationRequested: false },
  }));

  const [appliedParams, setAppliedParams] = useState<ImplantationUserParams>(draftParams);
  const [applyTick, setApplyTick] = useState(0);

  useEffect(() => {
    setDraftParams((p) => {
      const proj = (p as Record<string, unknown>)?.project as ProjectConfig | undefined ?? {
        buildings: [],
        validationRequested: false,
      };
      const normalized = normalizeBuildings(p.nbBatiments, proj.buildings);
      if (normalized.length === (proj.buildings?.length ?? 0)) return p;
      return { ...p, project: { ...proj, buildings: normalized, validationRequested: false } };
    });
  }, [draftParams.nbBatiments]);

  const isDirty = useMemo(() => {
    const a = appliedParams as Record<string, unknown>;
    const d = draftParams as Record<string, unknown>;
    const coreDirty =
      d.nbBatiments !== a.nbBatiments ||
      d.nbLogements !== a.nbLogements ||
      d.surfaceMoyLogementM2 !== a.surfaceMoyLogementM2;
    const projDirty =
      JSON.stringify(projectComparable(d.project as ProjectConfig | undefined)) !==
      JSON.stringify(projectComparable(a.project as ProjectConfig | undefined));
    return coreDirty || projDirty;
  }, [draftParams, appliedParams]);

  // --------------------------------------------------
  // UI state
  // --------------------------------------------------
  const [showOSM, setShowOSM] = useState(true);
  const [result, setResult] = useState<ImplantationResult | null>(null);
  const [autoBuildingFeature, setAutoBuildingFeature] = useState<Feature<Polygon | MultiPolygon> | null>(null);

  // --------------------------------------------------
  // ✅ State for ALL parcel features (multi-parcel support)
  // --------------------------------------------------
  const [parcelFeatures, setParcelFeatures] = useState<Feature<Polygon | MultiPolygon>[]>([]);

  // ✅ Primary parcel feature (for reculs calculation - use first/focus parcel)
  const primaryParcelFeature = useMemo(() => {
    if (parcelFeatures.length === 0) return null;
    // Find the feature matching focusParcelId, or use first
    if (focusParcelId) {
      const found = parcelFeatures.find((f) => {
        const props = f.properties || {};
        return props.parcel_id === focusParcelId || props.id === focusParcelId;
      });
      if (found) return found;
    }
    return parcelFeatures[0];
  }, [parcelFeatures, focusParcelId]);

  // ✅ Combined parcel feature (union of all parcels) for total area calculation
  const combinedParcelFeature = useMemo<Feature<Polygon | MultiPolygon> | null>(() => {
    if (parcelFeatures.length === 0) return null;
    if (parcelFeatures.length === 1) return parcelFeatures[0];

    try {
      // Union all parcel geometries
      let combined: Feature<Polygon | MultiPolygon> = parcelFeatures[0];
      for (let i = 1; i < parcelFeatures.length; i++) {
        const unioned = turf.union(
          turf.featureCollection([combined, parcelFeatures[i]])
        );
        if (unioned) {
          combined = unioned as Feature<Polygon | MultiPolygon>;
        }
      }
      return combined;
    } catch (err) {
      console.warn("[Implantation2D] Failed to union parcel features:", err);
      // Fallback: return first feature
      return parcelFeatures[0];
    }
  }, [parcelFeatures]);

  // --------------------------------------------------
  // delegated to reculsEngine (uses primary parcel for now)
  // --------------------------------------------------
  const reculsEngine = useReculsEngine({
    parcelFeature: primaryParcelFeature,
    resolvedRuleset,
    rulesetValid,
  });

  // Destructure what we need from reculsEngine
  const {
    facadeSegment,
    selectFacadeFromClick,
    resetFacade,
    computedReculs,
    envelopeFeature,
    forbiddenBand,
  } = reculsEngine;

  // --------------------------------------------------
  // delegated to drawEngine
  // --------------------------------------------------
  const drawEngine = useDrawEngine({
    envelopeFeature,
    onError: setError,
  });

  // Destructure what we need from drawEngine
  const {
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
  } = drawEngine;

  // --------------------------------------------------
  // ✅ FIX 1: Ref to track if user explicitly toggled edit mode off
  // --------------------------------------------------
  const userDisabledEditModeRef = useRef(false);

  // ✅ FIX 1: Auto-activate edit mode when facade is defined (on hydration/restore)
  useEffect(() => {
    if (facadeSegment && !editMode && !userDisabledEditModeRef.current) {
      setEditMode(true);
    }
  }, [facadeSegment, editMode, setEditMode]);

  // ✅ FIX 2: Set default draw type to "building" when edit mode activates
  useEffect(() => {
    if (editMode) {
      setCurrentDrawType("building");
    }
  }, [editMode, setCurrentDrawType]);

  // --------------------------------------------------
  // ✅ Load cadastre geometry for ALL selected parcels
  // --------------------------------------------------
  useEffect(() => {
    async function loadAllParcelGeometries() {
      if (!foncierIsHydrated) return;
      if (parcelIds.length === 0 || !communeInsee) {
        setParcelFeatures([]);
        return;
      }

      const insee = communeInsee.trim();
      if (!insee || insee.length < 5) {
        setError("Code INSEE invalide.");
        return;
      }

      setIsLoadingGeometry(true);
      setError(null);

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
          setError("Impossible de charger le cadastre.");
          setParcelFeatures([]);
          return;
        }

        const data = await res.json();
        const fc = extractFeatureCollectionFromAnyResponse(data);

        if (!fc || !Array.isArray(fc.features)) {
          setError("Format cadastre invalide.");
          setParcelFeatures([]);
          return;
        }

        // ✅ Find ALL selected parcels in the cadastre
        const features: Feature<Polygon | MultiPolygon>[] = [];
        const notFound: string[] = [];

        for (const pid of parcelIds) {
          const found = findFeatureForParcel(fc, pid);
          if (found) {
            const norm = normalizeToFeature(found);
            if (norm) {
              // Add parcel_id to properties for later identification
              norm.properties = { ...norm.properties, parcel_id: pid };
              features.push(norm);
            } else {
              notFound.push(pid);
            }
          } else {
            notFound.push(pid);
          }
        }

        if (features.length === 0) {
          setError(`Aucune parcelle trouvée dans le cadastre pour: ${parcelIds.join(", ")}`);
          setParcelFeatures([]);
          return;
        }

        if (notFound.length > 0) {
          console.warn("[Implantation2D] Parcelles non trouvées:", notFound);
        }

        setParcelFeatures(features);
        setError(null);
        console.log(`[Implantation2D] Loaded ${features.length}/${parcelIds.length} parcel geometries`);

      } catch (err) {
        console.error("[Implantation2D] Erreur cadastre:", err);
        setError("Erreur lors du chargement du cadastre.");
        setParcelFeatures([]);
      } finally {
        setIsLoadingGeometry(false);
      }
    }

    loadAllParcelGeometries();
  }, [parcelIds, communeInsee, foncierIsHydrated]);

  // --------------------------------------------------
  // Sync to Zustand store for Massing 3D / Bilan Promoteur handoff
  // AND persist to snapshot store for cross-module data sharing
  // --------------------------------------------------
  useEffect(() => {
    if (!combinedParcelFeature) {
      return;
    }

    const buildingsFC = drawnObjectsToFeatureCollection(drawnBuildings);
    const parkingsFC = drawnObjectsToFeatureCollection(drawnParkings);
    const bbox = turf.bbox(combinedParcelFeature) as [number, number, number, number];

    // Build meta object for business parameters handoff
    const meta: Implantation2DMeta = {
      buildingKind,
      floorsSpec: {
        aboveGroundFloors: floorsSpec.aboveGroundFloors,
        groundFloorHeightM: floorsSpec.groundFloorHeightM,
        typicalFloorHeightM: floorsSpec.typicalFloorHeightM,
      },
      nbLogements: appliedParams.nbLogements,
      surfaceMoyLogementM2: appliedParams.surfaceMoyLogementM2,
    };

    setFromImplantation2D({
      parcel: combinedParcelFeature,
      buildings: buildingsFC,
      parkings: parkingsFC,
      epsg: "EPSG:4326",
      bbox,
      meta,
    });

    // -------------------------------------------------------------------------
    // Persist to snapshot store (non-blocking)
    // -------------------------------------------------------------------------
    try {
      // Compute center from parcel for project info
      const parcelCenter = turf.center(combinedParcelFeature);
      const centerCoords = parcelCenter.geometry.coordinates;

      // Patch project info
      patchPromoteurSnapshot({
        project: {
          parcelId: primaryParcelId ?? undefined,
          commune_insee: communeInsee ?? undefined,
          surfaceM2: result?.surfaceTerrainM2 ?? foncierTotalAreaM2 ?? state.surfaceTerrainM2 ?? undefined,
          lat: centerCoords[1],
          lon: centerCoords[0],
        },
      });

      // Build summary string for module
      const summaryParts: string[] = [];
      summaryParts.push(`${parcelIds.length} parcelle(s)`);
      if (result) {
        summaryParts.push(`Terrain ${result.surfaceTerrainM2.toFixed(0)} m²`);
        summaryParts.push(`Emprise max ${result.surfaceEmpriseMaxM2.toFixed(0)} m²`);
        summaryParts.push(`Emprise utilisable ${result.surfaceEmpriseUtilisableM2.toFixed(0)} m²`);
        summaryParts.push(`Parkings ${result.placesParking}`);
      }
      const summary = summaryParts.length > 0 ? summaryParts.join(" · ") : "Implantation en cours";

      // Patch implantation2d module
      patchModule("implantation2d", {
        ok: !!(result && result.surfaceTerrainM2 > 0),
        summary,
        data: {
          parcelIds,
          primaryParcelId,
          communeInsee: communeInsee ?? null,
          result: result ?? null,
          computedReculs: computedReculs ?? null,
          facadeSegment: facadeSegment ?? null,
          drawnBuildings: buildingsFC,
          drawnParkings: parkingsFC,
          envelopeFeature: envelopeFeature ?? null,
          forbiddenBand: forbiddenBand ?? null,
          meta: {
            buildingKind,
            floorsSpec: {
              aboveGroundFloors: floorsSpec.aboveGroundFloors,
              groundFloorHeightM: floorsSpec.groundFloorHeightM,
              typicalFloorHeightM: floorsSpec.typicalFloorHeightM,
            },
            nbLogements: appliedParams.nbLogements,
            surfaceMoyLogementM2: appliedParams.surfaceMoyLogementM2,
          },
          bbox,
          epsg: "EPSG:4326",
        },
      });
    } catch (snapshotError) {
      // Non-blocking: log but don't break the app
      console.warn("[Implantation2D] Snapshot persistence error:", snapshotError);
    }
  }, [
    combinedParcelFeature,
    drawnBuildings,
    drawnParkings,
    buildingKind,
    floorsSpec,
    appliedParams.nbLogements,
    appliedParams.surfaceMoyLogementM2,
    setFromImplantation2D,
    parcelIds,
    primaryParcelId,
    communeInsee,
    result,
    foncierTotalAreaM2,
    state.surfaceTerrainM2,
    computedReculs,
    facadeSegment,
    envelopeFeature,
    forbiddenBand,
  ]);

  // --------------------------------------------------
  // ✅ FIX 1: Facade click handler - auto-activate edit mode on success
  // --------------------------------------------------
  const handleFacadeClick = useCallback(
    (lngLat: [number, number]) => {
      if (!primaryParcelFeature) return;
      const success = selectFacadeFromClick(lngLat);
      if (success) {
        setError(null);
        // ✅ Auto-activate edit mode after successful facade selection
        userDisabledEditModeRef.current = false;
        setEditMode(true);
      } else {
        setError("Clique sur un bord de la parcelle.");
      }
    },
    [primaryParcelFeature, selectFacadeFromClick, setEditMode]
  );

  // --------------------------------------------------
  // ✅ FIX 1: Handler for explicit edit mode toggle by user
  // --------------------------------------------------
  const handleEditModeToggle = useCallback(() => {
    const newValue = !editMode;
    if (!newValue) {
      // User is explicitly disabling edit mode
      userDisabledEditModeRef.current = true;
    } else {
      userDisabledEditModeRef.current = false;
    }
    setEditMode(newValue);
  }, [editMode, setEditMode]);

  // --------------------------------------------------
  // Compute implantation result (uses combined parcel area)
  // --------------------------------------------------
  useEffect(() => {
    if (hasMissingParams || !rulesetValid || !computedReculs) {
      setResult(null);
      setAutoBuildingFeature(null);
      return;
    }

    const basePluRules: PluRules | null = state.pluRules ?? null;

    // ✅ Use foncierTotalAreaM2 for total area (sum of all parcels)
    const surfaceFromFoncier = foncierTotalAreaM2;
    const surfaceFromState = state.surfaceTerrainM2 ?? null;
    const surfaceFromGeom = combinedParcelFeature ? turf.area(combinedParcelFeature as turf.AllGeoJSON) : null;

    const surfaceTerrainM2 =
      (surfaceFromFoncier && surfaceFromFoncier > 0
        ? surfaceFromFoncier
        : surfaceFromState && surfaceFromState > 0
          ? surfaceFromState
          : surfaceFromGeom && surfaceFromGeom > 0
            ? surfaceFromGeom
            : null) ?? 0;

    const userParamsWithReculs: ImplantationUserParams = {
      ...appliedParams,
      reculs: {
        avant_m: computedReculs.recul_avant_m,
        lateral_m: computedReculs.recul_lateral_m,
        arriere_m: computedReculs.recul_fond_m,
        alignement_obligatoire: false,
        source: "PLU_RULESET",
      } as Record<string, unknown>,
    };
    (userParamsWithReculs as Record<string, unknown>).facade = facadeSegment ?? null;

    if (surfaceTerrainM2 <= 0) {
      const minimal = computeImplantationWithoutGeom(1, basePluRules, userParamsWithReculs);
      setResult({
        ...minimal,
        surfaceTerrainM2: 0,
        surfaceTerrainApresReculsM2: 0,
        surfaceEmpriseMaxM2: 0,
        surfaceEmpriseUtilisableM2: 0,
      });
      setAutoBuildingFeature(null);
      return;
    }

    // ✅ Use combinedParcelFeature for implantation calculation
    if (combinedParcelFeature) {
      try {
        const { result: implResult, buildableGeom } = computeImplantationV1({
          parcelGeometry: combinedParcelFeature,
          surfaceTerrainM2,
          pluRules: basePluRules,
          userParams: userParamsWithReculs,
        });
        setResult(implResult);
        const normBuildable = normalizeToFeature(
          buildableGeom ?? (implResult as Record<string, unknown>)?.buildableGeom
        );
        setAutoBuildingFeature(normBuildable);
        setError(null);
        return;
      } catch (e) {
        console.warn("[Implantation2D] computeImplantationV1 failed:", e);
      }
    }

    const fallbackResult = computeImplantationWithoutGeom(surfaceTerrainM2, basePluRules, userParamsWithReculs);
    setResult(fallbackResult);
    setAutoBuildingFeature(null);
  }, [
    combinedParcelFeature,
    appliedParams,
    applyTick,
    facadeSegment,
    foncierTotalAreaM2,
    state.surfaceTerrainM2,
    state.pluRules,
    rulesetValid,
    computedReculs,
    hasMissingParams,
  ]);

  // --------------------------------------------------
  // Map center (computed from all parcel features)
  // --------------------------------------------------
  const center = useMemo(() => {
    if (parcelFeatures.length === 0) return [46.5, 2.5];

    try {
      // Compute center of all parcels
      const fc = turf.featureCollection(parcelFeatures);
      const centroid = turf.center(fc);
      return [centroid.geometry.coordinates[1], centroid.geometry.coordinates[0]];
    } catch {
      // Fallback to first parcel
      const geom = parcelFeatures[0].geometry;
      let first: number[] | null = null;
      if (geom.type === "Polygon") first = geom.coordinates?.[0]?.[0] ?? null;
      else if (geom.type === "MultiPolygon") first = geom.coordinates?.[0]?.[0]?.[0] ?? null;
      if (!first) return [46.5, 2.5];
      return [first[1], first[0]];
    }
  }, [parcelFeatures]);

  // --------------------------------------------------
  // Map bounds (limit panning around ALL parcels)
  // --------------------------------------------------
  const maxBounds = useMemo<L.LatLngBoundsExpression | undefined>(() => {
    if (parcelFeatures.length === 0) return undefined;
    try {
      // Compute combined bbox
      let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
      for (const feature of parcelFeatures) {
        const bbox = turf.bbox(feature);
        minLng = Math.min(minLng, bbox[0]);
        minLat = Math.min(minLat, bbox[1]);
        maxLng = Math.max(maxLng, bbox[2]);
        maxLat = Math.max(maxLat, bbox[3]);
      }

      // Add padding (roughly 100m in each direction)
      const padding = 0.001;
      return [
        [minLat - padding, minLng - padding], // SW corner
        [maxLat + padding, maxLng + padding], // NE corner
      ];
    } catch {
      return undefined;
    }
  }, [parcelFeatures]);

  // --------------------------------------------------
  // ✅ V1.6: Styles - Fixed height layout, no page scroll
  // La page utilise toute la hauteur disponible sans scroll
  // Seule la colonne droite peut scroller si nécessaire
  // --------------------------------------------------
  const pageStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "row",
    height: "calc(100vh - 180px)", // ✅ V1.6: Hauteur fixe = viewport - header/nav/tabs
    background: "#f8fafc",
    color: "#0f172a",
    padding: "12px 16px 16px 16px",
    gap: "16px",
    boxSizing: "border-box",
    overflow: "hidden", // ✅ V1.6: Pas de scroll sur la page
  };
  const leftCol: React.CSSProperties = {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    minWidth: 0,
    overflow: "hidden", // ✅ V1.6: Pas de scroll
  };
  // ✅ V1.6: Right column - scrollable if content exceeds height
  const rightCol: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "14px",
    width: 280,
    flexShrink: 0,
    height: "100%", // ✅ V1.6: Full height
    overflowY: "auto", // ✅ V1.6: Scroll si nécessaire
  };
  const card: React.CSSProperties = {
    background: "white",
    borderRadius: 14,
    padding: 14,
    border: "1px solid #e2e8f0",
    boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 10px 24px rgba(0,0,0,0.06)",
  };
  const title: React.CSSProperties = { fontSize: 16, fontWeight: 600, marginBottom: 6, color: "#0f172a" };
  const label: React.CSSProperties = { display: "block", fontSize: 13, marginBottom: 4, color: "#334155" };
  const input: React.CSSProperties = {
    width: "100%",
    padding: "6px 8px",
    borderRadius: 8,
    border: "1px solid #cbd5e1",
    background: "white",
    color: "#0f172a",
    fontSize: 13,
  };
  const primaryButton: React.CSSProperties = {
    padding: "10px 16px",
    borderRadius: 999,
    border: "none",
    background: "linear-gradient(135deg, rgba(56,189,248,1), rgba(59,130,246,1))",
    color: "white",
    fontWeight: 600,
    cursor: "pointer",
  };
  const ghostButton: React.CSSProperties = {
    padding: "10px 16px",
    borderRadius: 999,
    border: "1px solid #cbd5e1",
    background: "white",
    color: "#0f172a",
    fontWeight: 500,
    cursor: "pointer",
  };
  const tinyButton: React.CSSProperties = {
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid #cbd5e1",
    background: "white",
    color: "#0f172a",
    fontWeight: 500,
    cursor: "pointer",
    fontSize: 12,
  };
  // ✅ V1.6: Toolbar - normal flow, no sticky
  const toolbarStyle: React.CSSProperties = {
    background: "white",
    borderRadius: 12,
    padding: "10px 14px",
    border: "1px solid #e2e8f0",
    boxShadow: "0 2px 8px rgba(0,0,0,0.08), 0 4px 16px rgba(0,0,0,0.04)",
    display: "flex",
    gap: 8,
    alignItems: "center",
    flexWrap: "wrap",
    flexShrink: 0, // ✅ V1.6: Ne pas rétrécir
  };

  // ✅ V1.6: Map container - fills remaining space
  const mapContainerStyle: React.CSSProperties = {
    flex: 1, // ✅ V1.6: Prend tout l'espace restant
    minHeight: 300,
    overflow: "hidden",
    borderRadius: 12,
  };

  const formatReculDisplay = (v: number): string => `${v} m`;

  // --------------------------------------------------
  // Render
  // --------------------------------------------------

  // ✅ Show loading state while foncier selection is hydrating
  if (!foncierIsHydrated) {
    return (
      <div style={pageStyle}>
        <div style={card}>
          <div style={title}>{"Implantation 2D"}</div>
          <p style={{ color: "#334155" }}>{"Chargement de la sélection foncière..."}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      {/* Blocking panel: missing params */}
      {hasMissingParams && (
        <div
          style={{ width: "100%", display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: 40 }}
        >
          <MissingParcelParamsPanel
            missingParcels={missingParcels}
            missingCommuneInsee={missingCommuneInsee}
            onReturnClick={() => {
              const path = studyId ? `/promoteur/foncier?study=${encodeURIComponent(studyId)}` : "/promoteur/foncier";
              navigate(path);
            }}
          />
        </div>
      )}

      {/* Blocking panel: invalid ruleset */}
      {!hasMissingParams && !rulesetValid && (
        <div style={{ width: "100%" }}>
          <PluRulesetBlockingPanel
            missingFields={rulesetMissingFields}
            onReturnClick={() => {
              const path = studyId ? `/promoteur/plu-faisabilite?study=${encodeURIComponent(studyId)}` : "/promoteur/plu-faisabilite";
              navigate(path);
            }}
          />
          {parcelFeatures.length > 0 && (
            <div style={card}>
              <div style={title}>{"Aperçu des parcelles (lecture seule)"}</div>
              <div style={{ height: 400 }}>
                <MapContainer
                  center={center as [number, number]}
                  zoom={19}
                  minZoom={16}
                  maxZoom={22}
                  scrollWheelZoom={true}
                  style={{ height: "100%", width: "100%", borderRadius: 12, background: "#ffffff" }}
                >
                  <FitToFeatures features={parcelFeatures} />
                  <TileLayer
                    attribution="&copy; OpenStreetMap"
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    maxNativeZoom={19}
                    maxZoom={22}
                  />
                  {parcelFeatures.map((feature, idx) => (
                    <GeoJSON
                      key={`parcel-readonly-${idx}`}
                      data={feature}
                      style={() => ({ weight: 2, color: "#f97316", fillColor: "#fed7aa", fillOpacity: 0.14 })}
                    />
                  ))}
                </MapContainer>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Loading geometry state */}
      {!hasMissingParams && rulesetValid && isLoadingGeometry && (
        <div style={card}>
          <div style={title}>{"Implantation 2D"}</div>
          <p style={{ color: "#334155" }}>{"Chargement des géométries de parcelles..."}</p>
        </div>
      )}

      {/* Loading state */}
      {!hasMissingParams && rulesetValid && !isLoadingGeometry && !result && (
        <div style={card}>
          <div style={title}>{"Implantation 2D"}</div>
          <p style={{ color: "#334155" }}>{"Chargement des données..."}</p>
        </div>
      )}

      {/* Main content */}
      {!hasMissingParams && rulesetValid && !isLoadingGeometry && result && (
        <>
          <div style={leftCol}>
            {/* ✅ V1.5: Toolbar with minimal gap from nav */}
            <div style={toolbarStyle}>
              <button style={ghostButton} onClick={() => navigate(-1)}>
                {"← Retour"}
              </button>
              <button
                style={primaryButton}
                onClick={() => {
                  const path = studyId ? `/promoteur/bilan?study=${encodeURIComponent(studyId)}` : "/promoteur/bilan";
                  navigate(path);
                }}
              >
                {"Voir le bilan promoteur →"}
              </button>
              <div style={{ flex: 1 }} />
              <button style={tinyButton} onClick={() => setShowOSM((v) => !v)}>
                {showOSM ? "Masquer OSM" : "Afficher OSM"}
              </button>
              <button
                style={{ ...tinyButton, borderColor: "rgba(239,68,68,0.5)" }}
                onClick={() => {
                  if (facadeSegment) {
                    resetFacade();
                    setError(null);
                    // Reset edit mode state when facade is reset
                    userDisabledEditModeRef.current = false;
                    setEditMode(false);
                  } else {
                    setError("Clique sur un bord de la parcelle pour définir la façade.");
                  }
                }}
                disabled={parcelFeatures.length === 0}
              >
                {facadeSegment ? "Réinitialiser la façade" : "Choisir la façade"}
              </button>
              <button
                style={{
                  ...tinyButton,
                  borderColor: editMode ? "#16a34a" : "#cbd5e1",
                  background: editMode ? "rgba(22,163,74,0.1)" : "white",
                }}
                disabled={parcelFeatures.length === 0 || !facadeSegment}
                onClick={handleEditModeToggle}
              >
                {editMode ? "✓ Mode édition actif" : "Mode édition"}
              </button>
              {/* ✅ FIX 2: REMOVED the building/parking dropdown - type is now controlled via ShapeLibraryPanel */}
            </div>

            {/* ✅ V1.6: Card with map - fills remaining space */}
            <div style={{ ...card, flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <div style={title}>{"Implantation 2D — Mode Édition"}</div>
              <p style={{ fontSize: 13, opacity: 0.8, marginTop: 0, marginBottom: 8, color: "#475569" }}>
                {`${parcelIds.length} parcelle(s) — Commune : ${communeInsee ?? "?"}`}
                {studyId && (
                  <span style={{ marginLeft: 8, fontSize: 11, color: "#64748b", background: "#f1f5f9", padding: "2px 6px", borderRadius: 4 }}>
                    Étude: {studyId.slice(0, 12)}…
                  </span>
                )}
              </p>

              {/* Edit mode instructions */}
              {editMode && (
                <div
                  style={{
                    fontSize: 11,
                    opacity: 0.9,
                    marginBottom: 8,
                    padding: "8px 10px",
                    background: "rgba(22,163,74,0.08)",
                    borderRadius: 8,
                    border: "1px solid rgba(22,163,74,0.25)",
                    color: "#166534",
                  }}
                >
                  <strong>Mode Édition :</strong> Cliquez sur un objet pour le sélectionner. Déplacez en glissant
                  l'objet. Redimensionnez via les coins blancs. Tournez via la poignée orange en haut. Utilisez la bibliothèque de formes pour créer bâtiments ou parkings.
                </div>
              )}

              {error && <p style={{ fontSize: 12, color: "#ea580c", marginTop: 0 }}>{error}</p>}

              {/* Message d'instruction pour définir la façade */}
              {parcelFeatures.length > 0 && !facadeSegment && !editMode && (
                <div
                  style={{
                    fontSize: 13,
                    padding: "10px 14px",
                    marginBottom: 8,
                    background: "rgba(56,189,248,0.08)",
                    borderRadius: 10,
                    border: "1px solid rgba(56,189,248,0.3)",
                    color: "#0284c7",
                  }}
                >
                  {"👆 Cliquez sur un des côtés de la parcelle pour définir la façade. Le mode édition s'activera automatiquement."}
                </div>
              )}

              {/* ✅ FIX 1: REMOVED the message asking to click "Mode édition" - it's now automatic */}

              {/* Warning if forbidden band missing */}
              {!forbiddenBand &&
                parcelFeatures.length > 0 &&
                envelopeFeature &&
                computedReculs &&
                computedReculs.reculMax > 0 && (
                  <p style={{ fontSize: 11, color: "#ea580c", marginTop: 0 }}>
                    {"⚠️ Bande inconstructible indisponible (calcul échoué)"}
                  </p>
                )}

              {/* ✅ V1.6: Map container fills remaining space */}
              <div style={mapContainerStyle}>
                {parcelFeatures.length > 0 ? (
                  <MapContainer
                    center={center as [number, number]}
                    zoom={19}
                    minZoom={17}
                    maxZoom={22}
                    scrollWheelZoom={true}
                    doubleClickZoom={!editMode}
                    zoomSnap={0.25}
                    zoomDelta={0.5}
                    maxBounds={maxBounds}
                    maxBoundsViscosity={0.9}
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
                    {/* ✅ Fit bounds to ALL parcel features */}
                    <FitToFeatures features={parcelFeatures} />

                    {/* Reculs control overlay */}
                    <MapReculsControl reculs={computedReculs} />

                    {/* Facade click handler (only when NOT in edit mode) */}
                    <FacadeClickHandler enabled={!editMode && parcelFeatures.length > 0} onClickLatLng={handleFacadeClick} />

                    {/* delegated to drawEngine - Geoman controls + transform handlers */}
                    <DrawEngineLayers
                      drawEngine={drawEngine}
                      onCreated={handleObjectCreated}
                    />

                    {showOSM && (
                      <TileLayer
                        attribution="&copy; OpenStreetMap"
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        maxNativeZoom={19}
                        maxZoom={22}
                      />
                    )}

                    {/* ✅ ALL Parcels - READ ONLY */}
                    {parcelFeatures.map((feature, idx) => {
                      const isPrimary = feature.properties?.parcel_id === primaryParcelId;
                      return (
                        <GeoJSON
                          key={`parcel-${idx}`}
                          data={feature}
                          style={() => ({
                            weight: isPrimary ? 3 : 2,
                            color: isPrimary ? "#f97316" : "#fb923c",
                            fillColor: isPrimary ? "#fed7aa" : "#ffedd5",
                            fillOpacity: isPrimary ? 0.2 : 0.1,
                          })}
                        />
                      );
                    })}

                    {/* Forbidden band (setback zone) - delegated to reculsEngine */}
                    {forbiddenBand && (
                      <GeoJSON
                        key={`forbidden-band-${Date.now()}`}
                        data={forbiddenBand}
                        style={() => ({
                          weight: 2,
                          color: "#dc2626",
                          fillColor: "#fecaca",
                          fillOpacity: 0.35,
                          dashArray: "6,4",
                        })}
                      />
                    )}

                    {/* Auto building (when no drawn objects and not in edit mode) */}
                    {autoBuildingFeature && drawnBuildings.length === 0 && !editMode && (
                      <GeoJSON
                        key="auto-building"
                        data={autoBuildingFeature}
                        style={() => ({ weight: 2, color: "#22c55e", fillColor: "#bbf7d0", fillOpacity: 0.35 })}
                      />
                    )}

                    {/* Facade segment - delegated to reculsEngine */}
                    {facadeSegment && (
                      <GeoJSON
                        key={`facade-${Date.now()}`}
                        data={facadeSegment}
                        style={() => ({ weight: 6, color: "#ef4444", opacity: 0.95 })}
                      />
                    )}
                  </MapContainer>
                ) : (
                  <div
                    style={{
                      height: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: 12,
                      border: "1px dashed #cbd5e1",
                      fontSize: 13,
                      opacity: 0.8,
                      color: "#64748b",
                    }}
                  >
                    {"Carte indisponible. Les calculs restent fonctionnels."}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div style={rightCol}>
            {/* ✅ Selected parcels summary */}
            <SelectedParcelsPanel
              parcels={selectedParcels.map((p) => ({ id: p.id, area_m2: p.area_m2 ?? null }))}
              totalAreaM2={foncierTotalAreaM2}
            />

            {/* PLU constraints */}
            <div style={card}>
              <div style={title}>{"Contraintes PLU"}</div>
              <div style={{ fontSize: 13, display: "flex", flexDirection: "column", gap: 6, color: "#334155" }}>
                <div>
                  {"Surface terrain : "}
                  <strong style={{ color: "#0f172a" }}>{`${result.surfaceTerrainM2.toFixed(0)} m²`}</strong>
                </div>
                <div>
                  {"Emprise max : "}
                  <strong style={{ color: "#0f172a" }}>{`${result.surfaceEmpriseMaxM2.toFixed(0)} m²`}</strong>
                </div>
                <div
                  style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #e2e8f0" }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 6, color: "#0f172a" }}>
                    {"Reculs : "}
                    <span
                      style={{
                        fontWeight: 400,
                        color:
                          computedReculs?.mode === "DIRECTIONAL_BY_FACADE"
                            ? "#16a34a"
                            : computedReculs?.mode === "FALLBACK_UNIFORM"
                              ? "#ea580c"
                              : "#64748b",
                      }}
                    >
                      {computedReculs?.mode === "DIRECTIONAL_BY_FACADE"
                        ? "directionnels ✓"
                        : computedReculs?.mode === "FALLBACK_UNIFORM"
                          ? "uniformes (fallback)"
                          : "uniformes"}
                    </span>
                  </div>
                  {computedReculs ? (
                    <>
                      <div>
                        {"Avant : "}
                        <strong style={{ color: "#0f172a" }}>{formatReculDisplay(computedReculs.recul_avant_m)}</strong>
                      </div>
                      <div>
                        {"Latéral : "}
                        <strong style={{ color: "#0f172a" }}>{formatReculDisplay(computedReculs.recul_lateral_m)}</strong>
                      </div>
                      <div>
                        {"Fond : "}
                        <strong style={{ color: "#0f172a" }}>{formatReculDisplay(computedReculs.recul_fond_m)}</strong>
                      </div>
                      {!computedReculs.hasData && (
                        <div style={{ fontSize: 11, color: "#ea580c", marginTop: 4 }}>
                          {"⚠️ Aucune donnée PLU, valeurs par défaut"}
                        </div>
                      )}
                    </>
                  ) : (
                    <div style={{ opacity: 0.75 }}>{"En attente du ruleset PLU…"}</div>
                  )}
                </div>
                <div
                  style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #e2e8f0" }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 6, color: "#0f172a" }}>{"Façade"}</div>
                  {facadeSegment ? (
                    <div style={{ color: "#16a34a" }}>{"✓ Définie — reculs directionnels actifs"}</div>
                  ) : (
                    <div style={{ opacity: 0.75 }}>{"Non définie — clique un bord de parcelle"}</div>
                  )}
                </div>
              </div>
            </div>

            {/* Volumetry & surfaces summary */}
            <VolumetrySummaryPanel
              buildingKind={buildingKind}
              floorsSpec={floorsSpec}
              drawnBuildings={drawnBuildings}
            />

            {/* Drawn objects - data from drawEngine */}
            <DrawnObjectsPanel
              buildings={drawnBuildings}
              parkings={drawnParkings}
              activeId={activeObjectId}
              onSelect={setActiveObjectId}
              onDelete={deleteObject}
              onClearAll={clearAll}
            />

            {/* Shape library - delegates creation to drawEngine */}
            <ShapeLibraryPanel
              onCreateShape={createFromTemplate}
              disabled={!editMode || !envelopeFeature}
            />

            {/* Parking & emprise */}
            <div style={card}>
              <div style={title}>{"Parkings & emprise"}</div>
              <div style={{ fontSize: 13, display: "flex", flexDirection: "column", gap: 4, color: "#334155" }}>
                <div>
                  {"Places requises : "}
                  <strong style={{ color: "#0f172a" }}>{result.placesParking}</strong>
                </div>
                <div>
                  {"Surface parkings (estimée) : "}
                  <strong style={{ color: "#0f172a" }}>{`${result.surfaceParkingM2.toFixed(0)} m²`}</strong>
                </div>
                <div>
                  {"Surface résiduelle : "}
                  <strong style={{ color: "#0f172a" }}>{`${result.surfaceEmpriseUtilisableM2.toFixed(0)} m²`}</strong>
                </div>
              </div>
            </div>

            {/* Project parameters */}
            <div style={card}>
              <div style={title}>{"Paramètres"}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <label style={label}>
                  {"Type de bâtiment"}
                  <select
                    style={input}
                    value={buildingKind}
                    onChange={(e) => setBuildingKind(e.target.value as BuildingKind)}
                  >
                    <option value="COLLECTIF">Collectif</option>
                    <option value="INDIVIDUEL">Individuel</option>
                  </select>
                </label>
                <label style={label}>
                  {"Étages (R+N)"}
                  <input
                    type="number"
                    min={0}
                    max={50}
                    style={input}
                    value={floorsSpec.aboveGroundFloors}
                    onChange={(e) =>
                      setFloorsSpec((f) => ({ ...f, aboveGroundFloors: Math.max(0, Number(e.target.value) || 0) }))
                    }
                  />
                </label>
                <label style={label}>
                  {"Hauteur RDC (m)"}
                  <input
                    type="number"
                    min={2}
                    max={10}
                    step={0.1}
                    style={input}
                    value={floorsSpec.groundFloorHeightM}
                    onChange={(e) =>
                      setFloorsSpec((f) => ({ ...f, groundFloorHeightM: Math.max(2, Number(e.target.value) || 2.8) }))
                    }
                  />
                </label>
                <label style={label}>
                  {"Hauteur étage (m)"}
                  <input
                    type="number"
                    min={2}
                    max={10}
                    step={0.1}
                    style={input}
                    value={floorsSpec.typicalFloorHeightM}
                    onChange={(e) =>
                      setFloorsSpec((f) => ({ ...f, typicalFloorHeightM: Math.max(2, Number(e.target.value) || 2.7) }))
                    }
                  />
                </label>
                <div style={{ borderTop: "1px solid #e2e8f0", marginTop: 4, paddingTop: 10 }} />
                <label style={label}>
                  {"Nombre de logements"}
                  <input
                    type="number"
                    min={1}
                    max={500}
                    style={input}
                    value={draftParams.nbLogements}
                    onChange={(e) =>
                      setDraftParams((p) => ({ ...p, nbLogements: Math.max(1, Number(e.target.value) || 1) }))
                    }
                  />
                </label>
                <label style={label}>
                  {"Surface moyenne / logement (m²)"}
                  <input
                    type="number"
                    min={20}
                    max={200}
                    style={input}
                    value={draftParams.surfaceMoyLogementM2}
                    onChange={(e) =>
                      setDraftParams((p) => ({
                        ...p,
                        surfaceMoyLogementM2: Math.max(20, Number(e.target.value) || 20),
                      }))
                    }
                  />
                </label>
                <button
                  style={{
                    ...primaryButton,
                    opacity: isDirty ? 1 : 0.55,
                    cursor: isDirty ? "pointer" : "not-allowed",
                  }}
                  disabled={!isDirty}
                  onClick={() => {
                    setAppliedParams({ ...draftParams });
                    setApplyTick((t) => t + 1);
                  }}
                >
                  {"Recalculer"}
                </button>
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 8, lineHeight: 1.4 }}>
                  {"Applique les paramètres ci-dessus et recalcule les surfaces, l'emprise et les besoins en stationnement."}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default Implantation2DPage;