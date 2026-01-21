// src/spaces/promoteur/Implantation2DPage.tsx
// Refactored: delegates reculs logic to reculsEngine, draw logic to drawEngine

import { useCallback, useEffect, useMemo, useState } from "react";
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
// Helpers: Parameter resolution with fallback
// -----------------------------------------------------------------------------
function resolveParcelId(
  queryParam: string | null,
  locationState: LocationState | null
): string | null {
  if (queryParam && queryParam.trim()) return queryParam.trim();
  if (locationState) {
    const fromState = locationState.parcelId ?? locationState.parcel_id ?? null;
    if (fromState && String(fromState).trim()) return String(fromState).trim();
  }
  const selected = safeGetLocalStorage(LS_KEYS.PARCEL_ID_SELECTED);
  if (selected) return selected;
  const last = safeGetLocalStorage(LS_KEYS.PARCEL_ID_LAST);
  if (last) return last;
  return null;
}

function resolveCommuneInsee(
  queryParam: string | null,
  locationState: LocationState | null
): string | null {
  if (queryParam && queryParam.trim()) return queryParam.trim();
  if (locationState) {
    const fromState = locationState.communeInsee ?? locationState.commune_insee ?? null;
    if (fromState && String(fromState).trim()) return String(fromState).trim();
  }
  const selected = safeGetLocalStorage(LS_KEYS.COMMUNE_INSEE_SELECTED);
  if (selected) return selected;
  const last = safeGetLocalStorage(LS_KEYS.COMMUNE_INSEE_LAST);
  if (last) return last;
  return null;
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
// Helpers: Geometry normalization (kept for cadastre loading)
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
// Leaflet helpers
// -----------------------------------------------------------------------------
function FitToFeature({ feature }: { feature: Feature<Polygon | MultiPolygon> | null }) {
  const map = useMap();
  useEffect(() => {
    if (!feature) return;
    try {
      const b = turf.bbox(feature);
      const bounds: L.LatLngBoundsExpression = [
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

      if (!reculs) {
        div.innerHTML = `
          <div style="font-weight:700; margin-bottom:6px;">Reculs PLU</div>
          <div style="color:#94a3b8; font-size:11px;">En attente du ruleset PLU…</div>
          <div style="margin-top:8px; opacity:.85; font-size:11px;">Clique sur un bord pour définir la façade</div>
        `;
      } else {
        const formatVal = (v: number): string => `${v} m`;
        let modeLabel: string;
        let modeColor: string;
        switch (reculs.mode) {
          case "DIRECTIONAL_BY_FACADE":
            modeLabel = "directionnel ✓";
            modeColor = "#22c55e";
            break;
          case "FALLBACK_UNIFORM":
            modeLabel = "uniforme (fallback)";
            modeColor = "#fb923c";
            break;
          default:
            modeLabel = "uniforme";
            modeColor = "#94a3b8";
        }

        const dataNote = reculs.hasData
          ? ""
          : `<div style="margin-top:6px; font-size:11px; color:#fb923c;">⚠️ Aucune donnée PLU, valeurs par défaut (0)</div>`;

        const facadeNote = reculs.hasFacade
          ? `<div style="margin-top:6px; font-size:11px; color:#22c55e;">✓ Façade définie</div>`
          : `<div style="margin-top:6px; opacity:.85; font-size:11px;">Clique sur un bord pour définir la façade</div>`;

        div.innerHTML = `
          <div style="font-weight:700; margin-bottom:6px;">Reculs PLU</div>
          <div>Avant : <b>${formatVal(reculs.recul_avant_m)}</b></div>
          <div>Latéral : <b>${formatVal(reculs.recul_lateral_m)}</b></div>
          <div>Fond : <b>${formatVal(reculs.recul_fond_m)}</b></div>
          <div style="margin-top:6px; padding-top:6px; border-top:1px solid rgba(148,163,184,0.25);">
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
    background: "linear-gradient(135deg, rgba(239,68,68,0.15), rgba(249,115,22,0.1))",
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
    background: "linear-gradient(135deg, rgba(239,68,68,1), rgba(249,115,22,1))",
    color: "white",
    fontWeight: 600,
    cursor: "pointer",
    marginTop: 16,
  };

  return (
    <div style={panelStyle}>
      <div style={titleStyle}>{"⚠️ Règles PLU absentes ou incomplètes"}</div>
      <p style={{ fontSize: 14, opacity: 0.9, margin: 0 }}>
        {"Le calcul d'implantation nécessite un ruleset PLU résolu et complet."}
      </p>
      {missingFields.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{"Champs manquants :"}</div>
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
    background: "linear-gradient(135deg, rgba(251,146,60,0.15), rgba(234,179,8,0.1))",
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
    background: "linear-gradient(135deg, rgba(251,146,60,1), rgba(234,179,8,1))",
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
        {"Cette page nécessite une parcelle sélectionnée."}
      </p>
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{"Paramètres manquants :"}</div>
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, opacity: 0.85 }}>
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
    background: "#020617",
    borderRadius: 14,
    padding: 14,
    border: "1px solid rgba(148, 163, 184, 0.4)",
    boxShadow: "0 20px 40px rgba(15, 23, 42, 0.7)",
  };
  const title: React.CSSProperties = { fontSize: 14, fontWeight: 600, marginBottom: 6 };
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
          background: isActive ? "rgba(56,189,248,0.2)" : "rgba(148,163,184,0.1)",
          border: isActive ? "1px solid rgba(56,189,248,0.5)" : "1px solid transparent",
          cursor: "pointer",
          marginBottom: 4,
        }}
        onClick={() => onSelect(obj.id)}
      >
        <span style={{ fontSize: 13 }}>
          {obj.type === "building" ? "🏢" : "🅿️"} {obj.areaM2.toFixed(0)} m²
        </span>
        <button
          style={{
            background: "rgba(239,68,68,0.2)",
            border: "1px solid rgba(239,68,68,0.5)",
            borderRadius: 6,
            color: "#f87171",
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
              background: "rgba(239,68,68,0.15)",
              border: "1px solid rgba(239,68,68,0.4)",
              borderRadius: 6,
              color: "#f87171",
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
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#22c55e" }}>
          {"Bâtiments"} <span style={{ opacity: 0.7 }}>({buildings.length})</span>
        </div>
        {buildings.length === 0 ? (
          <div style={{ fontSize: 12, opacity: 0.6, paddingLeft: 8 }}>{"Aucun bâtiment"}</div>
        ) : (
          buildings.map((b) => <ObjectItem key={b.id} obj={b} />)
        )}
        {buildings.length > 0 && (
          <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4, paddingLeft: 8 }}>
            {"Total : "}
            <strong>{totalBuildings.toFixed(0)} m²</strong>
          </div>
        )}
      </div>

      <div>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#a855f7" }}>
          {"Parkings"} <span style={{ opacity: 0.7 }}>({parkings.length})</span>
        </div>
        {parkings.length === 0 ? (
          <div style={{ fontSize: 12, opacity: 0.6, paddingLeft: 8 }}>{"Aucun parking"}</div>
        ) : (
          parkings.map((p) => <ObjectItem key={p.id} obj={p} />)
        )}
        {parkings.length > 0 && (
          <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4, paddingLeft: 8 }}>
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
    background: "#020617",
    borderRadius: 14,
    padding: 14,
    border: "1px solid rgba(148, 163, 184, 0.4)",
    boxShadow: "0 20px 40px rgba(15, 23, 42, 0.7)",
  };
  const title: React.CSSProperties = { fontSize: 14, fontWeight: 600, marginBottom: 10 };
  const buttonStyle: React.CSSProperties = {
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid rgba(148,163,184,0.4)",
    background: "rgba(148,163,184,0.1)",
    color: "white",
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
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: "#22c55e" }}>{"Bâtiments"}</div>
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
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: "#a855f7" }}>{"Parkings"}</div>
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
        <div style={{ fontSize: 11, opacity: 0.6, marginTop: 8 }}>
          {"Activez le mode édition pour utiliser les templates."}
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

  // --------------------------------------------------
  // Parameter resolution
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

  const missingParcelId = !parcelId;
  const missingCommuneInsee = !communeInsee;
  const hasMissingParams = missingParcelId || missingCommuneInsee;

  const [error, setError] = useState<string | null>(null);

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
  // User params state
  // --------------------------------------------------
  const [draftParams, setDraftParams] = useState<ImplantationUserParams>(() => ({
    nbBatiments: 1,
    nbLogements: 10,
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
  const [parcelFeature, setParcelFeature] = useState<Feature<Polygon | MultiPolygon> | null>(null);
  const [autoBuildingFeature, setAutoBuildingFeature] = useState<Feature<Polygon | MultiPolygon> | null>(null);

  // --------------------------------------------------
  // delegated to reculsEngine
  // --------------------------------------------------
  const reculsEngine = useReculsEngine({
    parcelFeature,
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
  // Facade click handler (when not in edit mode)
  // --------------------------------------------------
  const handleFacadeClick = useCallback(
    (lngLat: [number, number]) => {
      if (!parcelFeature) return;
      const success = selectFacadeFromClick(lngLat);
      if (success) {
        setError(null);
      } else {
        setError("Clique sur un bord de la parcelle.");
      }
    },
    [parcelFeature, selectFacadeFromClick]
  );

  // --------------------------------------------------
  // Load cadastre geometry
  // --------------------------------------------------
  useEffect(() => {
    async function loadCadastreGeometry() {
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
          setError("Impossible de charger le cadastre.");
          setParcelFeature(null);
          return;
        }
        const data = await res.json();
        const fc = extractFeatureCollectionFromAnyResponse(data);
        if (!fc || !Array.isArray(fc.features)) {
          setError("Format cadastre invalide.");
          setParcelFeature(null);
          return;
        }
        const found = findFeatureForParcel(fc, parcelId);
        if (!found) {
          setError("Parcelle introuvable dans le cadastre.");
          setParcelFeature(null);
          return;
        }
        const norm = normalizeToFeature(found);
        if (!norm) {
          setError("Géométrie de parcelle invalide.");
          setParcelFeature(null);
          return;
        }
        setParcelFeature(norm);
        setError(null);
      } catch (err) {
        console.error("[Implantation2D] Erreur cadastre:", err);
        setError("Erreur lors du chargement du cadastre.");
        setParcelFeature(null);
      }
    }
    loadCadastreGeometry();
  }, [parcelId, communeInsee]);

  // --------------------------------------------------
  // Compute implantation result
  // --------------------------------------------------
  useEffect(() => {
    if (hasMissingParams || !rulesetValid || !computedReculs) {
      setResult(null);
      setAutoBuildingFeature(null);
      return;
    }

    const basePluRules: PluRules | null = state.pluRules ?? null;
    const surfaceFromState = state.surfaceTerrainM2 ?? null;
    const surfaceFromGeom = parcelFeature ? turf.area(parcelFeature as turf.AllGeoJSON) : null;
    const surfaceTerrainM2 =
      (surfaceFromState && surfaceFromState > 0
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

    if (parcelFeature) {
      try {
        const { result: implResult, buildableGeom } = computeImplantationV1({
          parcelGeometry: parcelFeature,
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
    parcelFeature,
    appliedParams,
    applyTick,
    facadeSegment,
    state.surfaceTerrainM2,
    state.pluRules,
    rulesetValid,
    computedReculs,
    hasMissingParams,
  ]);

  // --------------------------------------------------
  // Map center
  // --------------------------------------------------
  const center = useMemo(() => {
    if (!parcelFeature) return [46.5, 2.5];
    const geom = parcelFeature.geometry;
    let first: number[] | null = null;
    if (geom.type === "Polygon") first = geom.coordinates?.[0]?.[0] ?? null;
    else if (geom.type === "MultiPolygon") first = geom.coordinates?.[0]?.[0]?.[0] ?? null;
    if (!first) return [46.5, 2.5];
    return [first[1], first[0]];
  }, [parcelFeature]);

  // --------------------------------------------------
  // Map bounds (limit panning around parcel)
  // --------------------------------------------------
  const maxBounds = useMemo<L.LatLngBoundsExpression | undefined>(() => {
    if (!parcelFeature) return undefined;
    try {
      const bbox = turf.bbox(parcelFeature);
      // bbox = [minLng, minLat, maxLng, maxLat]
      // Add padding (roughly 50m in each direction at typical latitudes)
      const padding = 0.0005; // ~50m
      return [
        [bbox[1] - padding, bbox[0] - padding], // SW corner
        [bbox[3] + padding, bbox[2] + padding], // NE corner
      ];
    } catch {
      return undefined;
    }
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
    padding: "16px",
    gap: "16px",
    boxSizing: "border-box",
  };
  const leftCol: React.CSSProperties = { flex: 1, display: "flex", flexDirection: "column", gap: "12px", minWidth: 0 };
  const rightCol: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "14px",
    width: 280,
    flexShrink: 0,
  };
  const card: React.CSSProperties = {
    background: "#020617",
    borderRadius: 14,
    padding: 14,
    border: "1px solid rgba(148, 163, 184, 0.4)",
    boxShadow: "0 20px 40px rgba(15, 23, 42, 0.7)",
  };
  const title: React.CSSProperties = { fontSize: 16, fontWeight: 600, marginBottom: 6 };
  const label: React.CSSProperties = { display: "block", fontSize: 13, marginBottom: 4 };
  const input: React.CSSProperties = {
    width: "100%",
    padding: "6px 8px",
    borderRadius: 8,
    border: "1px solid rgba(148,163,184,0.4)",
    background: "#020617",
    color: "white",
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

  const formatReculDisplay = (v: number): string => `${v} m`;

  // --------------------------------------------------
  // Render
  // --------------------------------------------------
  return (
    <div style={pageStyle}>
      {/* Blocking panel: missing params */}
      {hasMissingParams && (
        <div
          style={{ width: "100%", display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: 40 }}
        >
          <MissingParcelParamsPanel
            missingParcelId={missingParcelId}
            missingCommuneInsee={missingCommuneInsee}
            onReturnClick={() => navigate("/promoteur/foncier")}
          />
        </div>
      )}

      {/* Blocking panel: invalid ruleset */}
      {!hasMissingParams && !rulesetValid && (
        <div style={{ width: "100%" }}>
          <PluRulesetBlockingPanel
            missingFields={rulesetMissingFields}
            onReturnClick={() => navigate("/promoteur/plu-faisabilite")}
          />
          {parcelFeature && (
            <div style={card}>
              <div style={title}>{"Aperçu de la parcelle (lecture seule)"}</div>
              <div style={{ height: 400 }}>
                <MapContainer
                  center={center as [number, number]}
                  zoom={19}
                  minZoom={16}
                  maxZoom={22}
                  scrollWheelZoom={true}
                  style={{ height: "100%", width: "100%", borderRadius: 12, background: "#ffffff" }}
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
                    data={parcelFeature}
                    style={() => ({ weight: 2, color: "#f97316", fillColor: "#fed7aa", fillOpacity: 0.14 })}
                  />
                </MapContainer>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Loading state */}
      {!hasMissingParams && rulesetValid && !result && (
        <div style={card}>
          <div style={title}>{"Implantation 2D"}</div>
          <p>{"Chargement des données..."}</p>
        </div>
      )}

      {/* Main content */}
      {!hasMissingParams && rulesetValid && result && (
        <>
          <div style={leftCol}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <button style={ghostButton} onClick={() => navigate(-1)}>
                {"← Retour"}
              </button>
              <button style={primaryButton} disabled>
                {"Envoyer au bilan (bientôt)"}
              </button>
            </div>

            <div style={{ ...card, flex: 1 }}>
              <div style={title}>{"Implantation 2D — Mode PowerPoint"}</div>
              <p style={{ fontSize: 13, opacity: 0.8, marginTop: 0, marginBottom: 8 }}>
                {`Parcelle : ${parcelId ?? "?"} — Commune : ${communeInsee ?? "?"}`}
              </p>

              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
                <button style={tinyButton} onClick={() => setShowOSM((v) => !v)}>
                  {showOSM ? "Masquer OSM" : "Afficher OSM"}
                </button>
                <button
                  style={{ ...tinyButton, borderColor: "rgba(239,68,68,0.7)" }}
                  onClick={() => {
                    resetFacade();
                  }}
                  disabled={!facadeSegment}
                >
                  {"Réinitialiser façade"}
                </button>
                <button
                  style={{
                    ...tinyButton,
                    borderColor: editMode ? "rgba(34,197,94,0.9)" : "rgba(148,163,184,0.5)",
                    background: editMode ? "rgba(34,197,94,0.15)" : "transparent",
                  }}
                  disabled={!parcelFeature}
                  onClick={() => setEditMode((v) => !v)}
                >
                  {editMode ? "✓ Mode édition actif" : "Mode édition"}
                </button>
                {editMode && (
                  <select
                    style={{ ...tinyButton, padding: "4px 8px", background: "#020617" }}
                    value={currentDrawType}
                    onChange={(e) => setCurrentDrawType(e.target.value as DrawnObjectType)}
                  >
                    <option value="building">🏢 Bâtiment</option>
                    <option value="parking">🅿️ Parking</option>
                  </select>
                )}
              </div>

              {/* Edit mode instructions */}
              {editMode && (
                <div
                  style={{
                    fontSize: 11,
                    opacity: 0.7,
                    marginBottom: 8,
                    padding: "8px 10px",
                    background: "rgba(34,197,94,0.1)",
                    borderRadius: 8,
                    border: "1px solid rgba(34,197,94,0.3)",
                  }}
                >
                  <strong>Mode PowerPoint :</strong> Cliquez sur un objet pour le sélectionner. Déplacez en glissant
                  l'objet. Redimensionnez via les coins blancs. Tournez via la poignée orange en haut.
                </div>
              )}

              {error && <p style={{ fontSize: 12, color: "#f97316", marginTop: 0 }}>{error}</p>}

              {/* Message d'instruction pour définir la façade */}
              {parcelFeature && !facadeSegment && !editMode && (
                <div
                  style={{
                    fontSize: 13,
                    padding: "10px 14px",
                    marginBottom: 8,
                    background: "linear-gradient(135deg, rgba(56,189,248,0.15), rgba(59,130,246,0.1))",
                    borderRadius: 10,
                    border: "1px solid rgba(56,189,248,0.4)",
                    color: "#38bdf8",
                  }}
                >
                  {"👆 Cliquez sur un des côtés de la parcelle pour définir la façade et calculer les reculs."}
                </div>
              )}

              {/* Message d'instruction pour activer le mode édition (après façade définie) */}
              {parcelFeature && facadeSegment && !editMode && (
                <div
                  style={{
                    fontSize: 13,
                    padding: "10px 14px",
                    marginBottom: 8,
                    background: "linear-gradient(135deg, rgba(34,197,94,0.15), rgba(22,163,74,0.1))",
                    borderRadius: 10,
                    border: "1px solid rgba(34,197,94,0.4)",
                    color: "#22c55e",
                  }}
                >
                  {"✏️ Cliquez sur \"Mode édition\" pour commencer à dessiner."}
                </div>
              )}

              {/* Warning if forbidden band missing */}
              {!forbiddenBand &&
                parcelFeature &&
                envelopeFeature &&
                computedReculs &&
                computedReculs.reculMax > 0 && (
                  <p style={{ fontSize: 11, color: "#fb923c", marginTop: 0 }}>
                    {"⚠️ Bande inconstructible indisponible (calcul échoué)"}
                  </p>
                )}

              <div style={{ height: "calc(100vh - 240px)", minHeight: 500, overflow: "hidden", borderRadius: 12 }}>
                {parcelFeature ? (
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
                    <FitToFeature feature={parcelFeature} />

                    {/* Reculs control overlay */}
                    <MapReculsControl reculs={computedReculs} />

                    {/* Facade click handler (only when NOT in edit mode) */}
                    <FacadeClickHandler enabled={!editMode && !!parcelFeature} onClickLatLng={handleFacadeClick} />

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

                    {/* Parcel - READ ONLY */}
                    <GeoJSON
                      key="parcel"
                      data={parcelFeature}
                      style={() => ({ weight: 2, color: "#f97316", fillColor: "#fed7aa", fillOpacity: 0.14 })}
                    />

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

                    {/* Buildable envelope - masqué visuellement mais toujours calculé dans reculsEngine */}

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
                      border: "1px dashed rgba(148,163,184,0.4)",
                      fontSize: 13,
                      opacity: 0.8,
                    }}
                  >
                    {"Carte indisponible. Les calculs restent fonctionnels."}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div style={rightCol}>
            {/* PLU constraints */}
            <div style={card}>
              <div style={title}>{"Contraintes PLU"}</div>
              <div style={{ fontSize: 13, display: "flex", flexDirection: "column", gap: 6 }}>
                <div>
                  {"Surface terrain : "}
                  <strong>{`${result.surfaceTerrainM2.toFixed(0)} m²`}</strong>
                </div>
                <div>
                  {"Emprise max : "}
                  <strong>{`${result.surfaceEmpriseMaxM2.toFixed(0)} m²`}</strong>
                </div>
                <div
                  style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(148,163,184,0.25)" }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>
                    {"Reculs : "}
                    <span
                      style={{
                        fontWeight: 400,
                        color:
                          computedReculs?.mode === "DIRECTIONAL_BY_FACADE"
                            ? "#22c55e"
                            : computedReculs?.mode === "FALLBACK_UNIFORM"
                              ? "#fb923c"
                              : "#94a3b8",
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
                        <strong>{formatReculDisplay(computedReculs.recul_avant_m)}</strong>
                      </div>
                      <div>
                        {"Latéral : "}
                        <strong>{formatReculDisplay(computedReculs.recul_lateral_m)}</strong>
                      </div>
                      <div>
                        {"Fond : "}
                        <strong>{formatReculDisplay(computedReculs.recul_fond_m)}</strong>
                      </div>
                      {!computedReculs.hasData && (
                        <div style={{ fontSize: 11, color: "#fb923c", marginTop: 4 }}>
                          {"⚠️ Aucune donnée PLU, valeurs par défaut"}
                        </div>
                      )}
                    </>
                  ) : (
                    <div style={{ opacity: 0.75 }}>{"En attente du ruleset PLU…"}</div>
                  )}
                </div>
                <div
                  style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(148,163,184,0.25)" }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>{"Façade"}</div>
                  {facadeSegment ? (
                    <div style={{ color: "#22c55e" }}>{"✓ Définie — reculs directionnels actifs"}</div>
                  ) : (
                    <div style={{ opacity: 0.75 }}>{"Non définie — clique un bord de parcelle"}</div>
                  )}
                </div>
              </div>
            </div>

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
              <div style={{ fontSize: 13, display: "flex", flexDirection: "column", gap: 4 }}>
                <div>
                  {"Places requises : "}
                  <strong>{result.placesParking}</strong>
                </div>
                <div>
                  {"Surface parkings (estimée) : "}
                  <strong>{`${result.surfaceParkingM2.toFixed(0)} m²`}</strong>
                </div>
                <div>
                  {"Surface résiduelle : "}
                  <strong>{`${result.surfaceEmpriseUtilisableM2.toFixed(0)} m²`}</strong>
                </div>
              </div>
            </div>

            {/* Project parameters */}
            <div style={card}>
              <div style={title}>{"Paramètres"}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default Implantation2DPage;