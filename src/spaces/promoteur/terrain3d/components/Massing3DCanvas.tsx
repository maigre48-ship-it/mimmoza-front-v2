// ============================================================================
// FILE: src/spaces/promoteur/terrain3d/components/Massing3DCanvas.tsx
// ============================================================================

import React, { type FC, useEffect, useMemo, useState } from "react";
import type { Feature, FeatureCollection, Polygon, MultiPolygon, Position } from "geojson";
import proj4 from "proj4";

import { useMassingScene } from "../hooks/useMassingScene";
import { Controls3D } from "./Controls3D";
import type { EarthworksKPIs } from "../types/earthworks.types";
import { SceneSvg3D, type ReliefData } from "./SceneSvg3D";

import {
  ensureDepartment,
  elevationLambert93,
  type ElevationPoint,
} from "../../../../lib/terrainServiceClient";

export interface Massing3DCanvasProps {
  parcel?: Feature<Polygon | MultiPolygon>;
  buildings?: FeatureCollection<Polygon>;
  parkings?: FeatureCollection<Polygon>;
  height?: string | number;
  className?: string;
}

/**
 * Coûts unitaires de terrassement (€/m³)
 * Source: estimations moyennes France 2024
 */
const EARTHWORKS_COSTS = {
  /** Déblai (excavation) */
  cutCostPerM3: 12,
  /** Évacuation des terres excédentaires */
  evacuationCostPerM3: 22,
};

function formatKpiValue(value: number | null, unit: string, decimals: number = 1): string {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(decimals)} ${unit}`;
}

function formatCurrency(value: number | null): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value);
}

function looksLikeWgs84Bbox(bbox: [number, number, number, number]): boolean {
  return !bbox.some(v => Math.abs(v) > 1000);
}

function detectCoordOrder(bbox: [number, number, number, number]): "lon-lat" | "lat-lon" | "unknown" {
  const [v0, v1, v2, v3] = bbox;
  const inFrance = (lon: number, lat: number) => (lon >= -6 && lon <= 11 && lat >= 41 && lat <= 52) ||
    (lon >= 45 && lon <= 56 && lat >= -22 && lat <= -11) || (lon >= -64 && lon <= -60 && lat >= 14 && lat <= 18) || (lon >= -55 && lon <= -51 && lat >= 2 && lat <= 6);
  
  const lonLat = { minLon: Math.min(v0, v2), maxLon: Math.max(v0, v2), minLat: Math.min(v1, v3), maxLat: Math.max(v1, v3) };
  const latLon = { minLon: Math.min(v1, v3), maxLon: Math.max(v1, v3), minLat: Math.min(v0, v2), maxLat: Math.max(v0, v2) };
  
  const lonLatOk = inFrance(lonLat.minLon, lonLat.minLat) && inFrance(lonLat.maxLon, lonLat.maxLat);
  const latLonOk = inFrance(latLon.minLon, latLon.minLat) && inFrance(latLon.maxLon, latLon.maxLat);
  
  if (lonLatOk && !latLonOk) return "lon-lat";
  if (latLonOk && !lonLatOk) return "lat-lon";
  return lonLatOk ? "lon-lat" : "unknown";
}

function normalizeDeptCode(input: unknown): string | null {
  if (input == null) return null;
  const s = String(input).trim().toUpperCase();
  if (/^\d{2,3}$/.test(s) || s === "2A" || s === "2B") return s;
  return null;
}

function deptFromPostcode(cp: unknown): string | null {
  if (!cp) return null;
  const s = String(cp).trim();
  if (/^97\d{3}$/.test(s)) return s.slice(0, 3);
  if (/^20\d{3}$/.test(s)) return parseInt(s, 10) >= 20200 ? "2B" : "2A";
  if (/^\d{5}$/.test(s)) return s.slice(0, 2);
  return null;
}

function deptFromInsee(insee: unknown): string | null {
  if (!insee) return null;
  const s = String(insee).trim().toUpperCase();
  if (s.startsWith("2A")) return "2A";
  if (s.startsWith("2B")) return "2B";
  if (/^97\d/.test(s)) return s.slice(0, 3);
  if (/^\d{5}$/.test(s)) return s.slice(0, 2);
  return null;
}

async function deptFromGeoApi(lon: number, lat: number): Promise<{ dept: string | null; commune?: string }> {
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(`https://geo.api.gouv.fr/communes?lon=${lon}&lat=${lat}&fields=nom,codeDepartement&limit=1`, { signal: ctrl.signal });
    if (!r.ok) return { dept: null };
    const j = await r.json();
    if (!Array.isArray(j) || !j.length) return { dept: null };
    return { dept: normalizeDeptCode(j[0].codeDepartement), commune: j[0].nom };
  } catch { return { dept: null }; }
}

async function deptFromBanReverse(lon: number, lat: number): Promise<{ dept: string | null }> {
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(`https://api-adresse.data.gouv.fr/reverse/?lon=${lon}&lat=${lat}&limit=1`, { signal: ctrl.signal });
    if (!r.ok) return { dept: null };
    const j = await r.json();
    const props = j?.features?.[0]?.properties;
    return { dept: deptFromPostcode(props?.postcode || props?.citycode?.slice(0, 5)) };
  } catch { return { dept: null }; }
}

const EPSG2154 = "+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs";

function bboxWgs84ToLambert93(bbox: [number, number, number, number], coordOrder: string): [number, number, number, number] {
  const [a, b, c, d] = bbox;
  const [minLon, minLat, maxLon, maxLat] = coordOrder === "lat-lon" ? [b, a, d, c] : [a, b, c, d];
  const p1 = proj4("EPSG:4326", EPSG2154, [minLon, minLat]);
  const p2 = proj4("EPSG:4326", EPSG2154, [maxLon, maxLat]);
  return [Math.min(p1[0], p2[0]), Math.min(p1[1], p2[1]), Math.max(p1[0], p2[0]), Math.max(p1[1], p2[1])];
}

function pointWgs84ToLambert93(lon: number, lat: number, coordOrder: string): [number, number] {
  return coordOrder === "lat-lon" ? proj4("EPSG:4326", EPSG2154, [lat, lon]) as [number, number] : proj4("EPSG:4326", EPSG2154, [lon, lat]) as [number, number];
}

function extractRingsFromPolygon(geom: Polygon | MultiPolygon): Position[][] {
  return geom.type === "Polygon" ? geom.coordinates : geom.coordinates.flatMap(p => p);
}

function pointInPolygon(x: number, y: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

function pointInAnyPolygon(x: number, y: number, polygons: [number, number][][]): boolean {
  return polygons.some(ring => pointInPolygon(x, y, ring));
}

function buildGridPointsFromBBox(bbox: [number, number, number, number], stepM = 5, maxPts = 2500) {
  const [minX, minY, maxX, maxY] = bbox;
  const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
  let nx = Math.max(2, Math.floor(w / stepM) + 1), ny = Math.max(2, Math.floor(h / stepM) + 1);
  while (nx * ny > maxPts && (nx > 2 || ny > 2)) { nx = Math.max(2, Math.floor(nx * 0.85)); ny = Math.max(2, Math.floor(ny * 0.85)); }
  const dx = w / (nx - 1), dy = h / (ny - 1);
  const points: ElevationPoint[] = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) points.push({ x: minX + dx * i, y: minY + dy * j });
  return { points, nx, ny, dx, dy };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function computeSlopeKPIs(z: number[], nx: number, ny: number, dx: number, dy: number) {
  const at = (i: number, j: number) => z[j * nx + i];
  let sum = 0, count = 0, max = 0, minZ = Infinity, maxZ = -Infinity;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const z0 = at(i, j);
      if (!Number.isFinite(z0)) continue;
      if (z0 < minZ) minZ = z0;
      if (z0 > maxZ) maxZ = z0;
      let dzdx = 0, dzdy = 0;
      if (i > 0 && i < nx - 1 && Number.isFinite(at(i - 1, j)) && Number.isFinite(at(i + 1, j))) dzdx = (at(i + 1, j) - at(i - 1, j)) / (2 * dx);
      if (j > 0 && j < ny - 1 && Number.isFinite(at(i, j - 1)) && Number.isFinite(at(i, j + 1))) dzdy = (at(i, j + 1) - at(i, j - 1)) / (2 * dy);
      const slope = Math.sqrt(dzdx * dzdx + dzdy * dzdy) * 100;
      sum += slope; count++; if (slope > max) max = slope;
    }
  }
  return { meanPct: count ? sum / count : 0, maxPct: max, minZ: Number.isFinite(minZ) ? minZ : 0, maxZ: Number.isFinite(maxZ) ? maxZ : 0, deltaZ: (Number.isFinite(maxZ) && Number.isFinite(minZ)) ? maxZ - minZ : 0 };
}

/**
 * Calcule les volumes de terrassement sous les emprises
 * 
 * LOGIQUE:
 * - Niveau plateforme = altitude MINIMALE sous l'emprise
 * - Le bâtiment est posé au point le plus bas du terrain
 * - On creuse (déblai) tout ce qui dépasse ce niveau pour aplatir
 * - Pas de remblai technique (on ne rajoute pas de terre)
 * - Le bâtiment sera visuellement posé au bon niveau sur le terrain 3D
 */
function computeEarthworksUnderFootprints(
  elevations: number[], nx: number, ny: number, dx: number, dy: number,
  bbox: [number, number, number, number], footprints: [number, number][][]
) {
  const [minX, minY] = bbox;
  const cellArea = dx * dy;
  
  // Collecter les élévations sous les emprises
  const zUnderFootprint: number[] = [];
  const cellsUnderFootprint: { i: number; j: number; z: number }[] = [];
  
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = minX + i * dx;
      const y = minY + j * dy;
      const z = elevations[j * nx + i];
      if (Number.isFinite(z) && pointInAnyPolygon(x, y, footprints)) {
        zUnderFootprint.push(z);
        cellsUnderFootprint.push({ i, j, z });
      }
    }
  }

  if (zUnderFootprint.length === 0) {
    return { cutVolume: 0, fillVolume: 0, platformLevel: 0, balance: 0, footprintArea: 0 };
  }

  // NIVEAU PLATEFORME = ALTITUDE MINIMALE (on pose le bâtiment au point le plus bas)
  const platformLevel = Math.min(...zUnderFootprint);
  
  // DÉBLAI = tout ce qui est au-dessus du niveau plateforme
  // PAS DE REMBLAI car on pose au niveau min (pas besoin d'apporter de terre)
  let cutVolume = 0;
  
  for (const cell of cellsUnderFootprint) {
    const diff = cell.z - platformLevel;
    if (diff > 0) {
      cutVolume += diff * cellArea;
    }
    // Pas de remblai car platformLevel = min, donc diff ne peut pas être négatif
  }

  return {
    cutVolume: Math.round(cutVolume),
    fillVolume: 0, // Pas de remblai avec cette stratégie
    platformLevel: Math.round(platformLevel * 100) / 100,
    balance: Math.round(cutVolume), // Tout est évacué
    footprintArea: Math.round(zUnderFootprint.length * cellArea),
  };
}

function computeEarthworksCosts(cutVolume: number, costs = EARTHWORKS_COSTS) {
  const cutCost = cutVolume * costs.cutCostPerM3;
  const evacuationCost = cutVolume * costs.evacuationCostPerM3;
  return { cutCost: Math.round(cutCost), evacuationCost: Math.round(evacuationCost), totalCost: Math.round(cutCost + evacuationCost) };
}

function convertFootprintsToLambert93(
  buildings: FeatureCollection<Polygon> | undefined,
  parkings: FeatureCollection<Polygon> | undefined,
  coordOrder: string, isWgs84: boolean
): [number, number][][] {
  const result: [number, number][][] = [];
  const process = (fc: FeatureCollection<Polygon> | undefined) => {
    if (!fc?.features) return;
    for (const f of fc.features) {
      if (!f.geometry) continue;
      for (const ring of extractRingsFromPolygon(f.geometry)) {
        result.push(ring.map(pos => isWgs84 ? pointWgs84ToLambert93(pos[0], pos[1], coordOrder) : [pos[0], pos[1]] as [number, number]));
      }
    }
  };
  process(buildings);
  process(parkings);
  return result;
}

type ReliefState = {
  status: "idle" | "loading" | "ready" | "error";
  message?: string;
  deptCode?: string;
  deptSource?: string;
  commune?: string;
  epsg?: string;
  minZ?: number; maxZ?: number; deltaZ?: number;
  meanSlopePct?: number; maxSlopePct?: number;
  reliefData?: ReliefData;
  cutVolume?: number; fillVolume?: number;
  platformLevel?: number; volumeBalance?: number; footprintArea?: number;
  cutCost?: number; evacuationCost?: number; totalCost?: number;
};

const KpiPanel: FC<{ kpis: EarthworksKPIs; isLoading: boolean; relief?: ReliefState }> = ({ kpis, isLoading, relief }) => {
  const row: React.CSSProperties = { display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #f3f4f6" };
  const label: React.CSSProperties = { color: "#6b7280", fontSize: "12px" };
  const value: React.CSSProperties = { fontWeight: 600, fontSize: "12px", fontVariantNumeric: "tabular-nums" };
  const section: React.CSSProperties = { fontSize: "13px", fontWeight: 600, marginTop: "12px", marginBottom: "8px", color: "#374151", display: "flex", alignItems: "center", gap: "6px" };

  const slope = relief?.status === "ready" && relief.meanSlopePct != null ? relief.meanSlopePct : kpis.naturalSlope;
  const maxSlope = relief?.status === "ready" && relief.maxSlopePct != null ? relief.maxSlopePct : kpis.maxSlope;
  const hasEarthworks = relief?.status === "ready" && (relief.cutVolume ?? 0) > 0;

  return (
    <div style={{ padding: "14px", backgroundColor: "#fff", borderRadius: "8px", boxShadow: "0 1px 3px rgba(0,0,0,0.1)", minWidth: "240px", maxHeight: "520px", overflowY: "auto", opacity: isLoading ? 0.6 : 1 }}>
      <div style={{ fontSize: "14px", fontWeight: 600, marginBottom: "10px", color: "#111827" }}>📊 Indicateurs terrain</div>

      {relief && (
        <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 8, lineHeight: 1.4 }}>
          Relief: <b>{relief.status === "ready" ? "OK" : relief.status === "loading" ? "…" : relief.status === "error" ? "KO" : "—"}</b>
          {relief.deptCode && ` · dept ${relief.deptCode}`}
          {relief.commune && ` · ${relief.commune}`}
          {relief.deltaZ != null && ` · ΔZ ${relief.deltaZ.toFixed(1)}m`}
        </div>
      )}

      <div style={section}><span>📐</span> Pentes (parcelle)</div>
      <div style={row}><span style={label}>Pente moyenne</span><span style={value}>{formatKpiValue(slope, "%")}</span></div>
      <div style={row}><span style={label}>Pente max</span><span style={value}>{formatKpiValue(maxSlope, "%")}</span></div>

      {hasEarthworks ? (
        <>
          <div style={section}><span>🏗️</span> Terrassement (emprises)</div>
          {relief?.footprintArea != null && relief.footprintArea > 0 && (
            <div style={row}><span style={label}>Emprise à terrasser</span><span style={value}>{formatKpiValue(relief.footprintArea, "m²", 0)}</span></div>
          )}
          {relief?.platformLevel != null && (
            <div style={row}><span style={label}>Niveau plateforme</span><span style={value}>{relief.platformLevel.toFixed(2)} m NGF</span></div>
          )}
          <div style={row}><span style={label}>Volume de déblai</span><span style={{ ...value, color: "#dc2626" }}>{formatKpiValue(relief?.cutVolume ?? 0, "m³", 0)}</span></div>
          
          <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 4, marginBottom: 8, fontStyle: "italic" }}>
            💡 Plateforme au point le plus bas → tout en déblai, pas de remblai
          </div>

          <div style={section}><span>💰</span> Coûts de terrassement</div>
          <div style={row}><span style={label}>Déblai ({EARTHWORKS_COSTS.cutCostPerM3}€/m³)</span><span style={value}>{formatCurrency(relief?.cutCost ?? 0)}</span></div>
          <div style={row}><span style={label}>Évacuation ({EARTHWORKS_COSTS.evacuationCostPerM3}€/m³)</span><span style={value}>{formatCurrency(relief?.evacuationCost ?? 0)}</span></div>
          <div style={{ ...row, borderBottom: "none", paddingTop: "8px", marginTop: "4px", borderTop: "2px solid #e5e7eb" }}>
            <span style={{ ...label, fontWeight: 600, color: "#111827" }}>TOTAL TERRASSEMENT</span>
            <span style={{ ...value, fontSize: "14px", color: "#111827" }}>{formatCurrency(relief?.totalCost ?? 0)}</span>
          </div>
        </>
      ) : (
        <div style={{ ...section, color: "#9ca3af", fontWeight: 400, fontSize: "12px" }}>
          <span>🏗️</span> Ajoutez des bâtiments ou parkings pour le terrassement
        </div>
      )}
    </div>
  );
};

const Scene3D: FC<{
  parcel?: Feature<Polygon | MultiPolygon>;
  buildings?: FeatureCollection<Polygon>;
  parkings?: FeatureCollection<Polygon>;
  visibility: { terrain: boolean; buildings: boolean; parkings: boolean; wireframe?: boolean };
  isLoading: boolean;
  relief?: ReliefState;
}> = ({ parcel, buildings, parkings, visibility, isLoading, relief }) => (
  <div style={{ flex: 1, backgroundColor: "#f8fafc", borderRadius: "8px", display: "flex", flexDirection: "column", overflow: "hidden", minHeight: "400px", border: "1px solid #e2e8f0" }}>
    <div style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", borderBottom: "1px solid #e2e8f0", backgroundColor: "#fff" }}>
      <div style={{ color: "#475569", fontSize: 12 }}>
        <span style={{ fontWeight: 600, color: "#1e293b" }}>Vue 3D du terrain</span>
        <span style={{ opacity: 0.8 }}> · Bâtiments: <b>{buildings?.features?.length ?? 0}</b> · Parkings: <b>{parkings?.features?.length ?? 0}</b></span>
        {relief?.status === "ready" && <span style={{ marginLeft: 8, color: "#16a34a" }}>· Relief OK</span>}
      </div>
      <div style={{ color: "#94a3b8", fontSize: 11 }}>Drag : orbit · Wheel : zoom</div>
    </div>
    <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center", padding: "12px" }}>
      {isLoading ? (
        <div style={{ textAlign: "center", color: "#64748b" }}>
          <div style={{ fontSize: "28px", marginBottom: "12px" }}>⏳</div>
          <div style={{ fontSize: "14px" }}>Chargement...</div>
        </div>
      ) : (
        <SceneSvg3D
          parcel={parcel} buildings={buildings} parkings={parkings}
          showTerrain={visibility.terrain} showBuildings={visibility.buildings} showParkings={visibility.parkings}
          showWireframe={Boolean(visibility.wireframe)} reliefData={relief?.reliefData}
        />
      )}
    </div>
  </div>
);

export const Massing3DCanvas: FC<Massing3DCanvasProps> = ({ parcel, buildings, parkings, height = "600px", className }) => {
  const scene = useMassingScene(parcel, buildings, parkings);
  const [relief, setRelief] = useState<ReliefState>({ status: "idle" });

  const parcelBBoxRaw = useMemo((): [number, number, number, number] | null => {
    const b = (parcel as any)?.bbox;
    if (Array.isArray(b) && b.length === 4 && b.every((n: any) => typeof n === "number")) return b as [number, number, number, number];
    const geom: any = parcel?.geometry;
    if (!geom) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const visit = (c: any) => {
      if (!Array.isArray(c)) return;
      if (typeof c[0] === "number" && typeof c[1] === "number") { minX = Math.min(minX, c[0]); minY = Math.min(minY, c[1]); maxX = Math.max(maxX, c[0]); maxY = Math.max(maxY, c[1]); return; }
      for (const sub of c) visit(sub);
    };
    visit(geom.coordinates);
    return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : null;
  }, [parcel]);

  const parcelEpsg = useMemo(() => parcelBBoxRaw && looksLikeWgs84Bbox(parcelBBoxRaw) ? "EPSG:4326" : "EPSG:2154", [parcelBBoxRaw]);
  const coordOrder = useMemo(() => parcelBBoxRaw && parcelEpsg === "EPSG:4326" ? detectCoordOrder(parcelBBoxRaw) : "lon-lat", [parcelBBoxRaw, parcelEpsg]);

  const deptFromProps = useMemo(() => {
    const props: any = (parcel as any)?.properties ?? {};
    for (const k of ["commune_insee", "insee", "code_insee", "citycode"]) if (props[k]) { const d = deptFromInsee(props[k]); if (d) return { dept: d, source: "insee" }; }
    for (const k of ["code_postal", "cp", "postcode", "postal_code"]) if (props[k]) { const d = deptFromPostcode(props[k]); if (d) return { dept: d, source: "postcode" }; }
    for (const k of ["deptCode", "code_dept", "departement", "dept"]) if (props[k]) { const d = normalizeDeptCode(props[k]); if (d) return { dept: d, source: "props" }; }
    return { dept: null, source: null };
  }, [parcel]);

  const [deptResolved, setDeptResolved] = useState<{ dept: string; source: string; commune?: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (deptFromProps.dept) { if (!cancelled) setDeptResolved({ dept: deptFromProps.dept, source: deptFromProps.source! }); return; }
      if (parcelBBoxRaw && parcelEpsg === "EPSG:4326") {
        const [v0, v1, v2, v3] = parcelBBoxRaw;
        const [lon, lat] = coordOrder === "lat-lon" ? [(v1 + v3) / 2, (v0 + v2) / 2] : [(v0 + v2) / 2, (v1 + v3) / 2];
        let r = await deptFromGeoApi(lon, lat);
        if (!cancelled && r.dept) { setDeptResolved({ dept: r.dept, source: "geoapi", commune: r.commune }); return; }
        r = await deptFromGeoApi(lat, lon);
        if (!cancelled && r.dept) { setDeptResolved({ dept: r.dept, source: "geoapi", commune: r.commune }); return; }
        let b = await deptFromBanReverse(lon, lat);
        if (!cancelled && b.dept) { setDeptResolved({ dept: b.dept, source: "ban" }); return; }
        b = await deptFromBanReverse(lat, lon);
        if (!cancelled && b.dept) { setDeptResolved({ dept: b.dept, source: "ban" }); return; }
      }
      if (!cancelled) setDeptResolved({ dept: "75", source: "fallback" });
    })();
    return () => { cancelled = true; };
  }, [deptFromProps, parcelBBoxRaw, parcelEpsg, coordOrder]);

  const parcelBBox2154 = useMemo(() => parcelBBoxRaw ? (parcelEpsg === "EPSG:4326" ? bboxWgs84ToLambert93(parcelBBoxRaw, coordOrder) : parcelBBoxRaw) : null, [parcelBBoxRaw, parcelEpsg, coordOrder]);
  const footprintsLambert = useMemo(() => convertFootprintsToLambert93(buildings, parkings, coordOrder, parcelEpsg === "EPSG:4326"), [buildings, parkings, coordOrder, parcelEpsg]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!parcelBBox2154 || !deptResolved?.dept || !scene.visibility?.terrain) { setRelief({ status: "idle" }); return; }
      setRelief({ status: "loading", deptCode: deptResolved.dept, deptSource: deptResolved.source, commune: deptResolved.commune, epsg: parcelEpsg });
      try {
        const pad = 20;
        const padded: [number, number, number, number] = [parcelBBox2154[0] - pad, parcelBBox2154[1] - pad, parcelBBox2154[2] + pad, parcelBBox2154[3] + pad];
        await ensureDepartment(deptResolved.dept);
        const { points, nx, ny, dx, dy } = buildGridPointsFromBBox(padded, 5, 2500);
        const elevations: (number | null)[] = [];
        for (const batch of chunk(points, 800)) { const r = await elevationLambert93(deptResolved.dept, batch); elevations.push(...(r.elevations ?? [])); }
        
        const valid = elevations.filter(v => typeof v === "number" && Number.isFinite(v)) as number[];
        if (valid.length / elevations.length < 0.6) throw new Error(`Relief insuffisant (${Math.round(valid.length / elevations.length * 100)}% valid)`);
        
        const median = [...valid].sort((a, b) => a - b)[Math.floor(valid.length / 2)];
        const filled = elevations.map(v => (typeof v === "number" && Number.isFinite(v)) ? v : median);
        const slopes = computeSlopeKPIs(filled, nx, ny, dx, dy);
        const earthworks = computeEarthworksUnderFootprints(filled, nx, ny, dx, dy, padded, footprintsLambert);
        const costs = computeEarthworksCosts(earthworks.cutVolume);

        if (cancelled) return;
        setRelief({
          status: "ready",
          deptCode: deptResolved.dept, deptSource: deptResolved.source, commune: deptResolved.commune, epsg: parcelEpsg,
          minZ: slopes.minZ, maxZ: slopes.maxZ, deltaZ: slopes.deltaZ,
          meanSlopePct: slopes.meanPct, maxSlopePct: slopes.maxPct,
          reliefData: { elevations: filled, nx, ny, dx, dy, minZ: slopes.minZ, maxZ: slopes.maxZ, bbox: padded, platformLevel: earthworks.platformLevel },
          cutVolume: earthworks.cutVolume, fillVolume: earthworks.fillVolume,
          platformLevel: earthworks.platformLevel, volumeBalance: earthworks.balance, footprintArea: earthworks.footprintArea,
          cutCost: costs.cutCost, evacuationCost: costs.evacuationCost, totalCost: costs.totalCost,
        });
      } catch (e: any) {
        if (!cancelled) setRelief({ status: "error", deptCode: deptResolved.dept, message: e?.message ?? String(e) });
      }
    })();
    return () => { cancelled = true; };
  }, [parcelBBox2154, deptResolved, parcelEpsg, scene.visibility?.terrain, footprintsLambert]);

  return (
    <div className={className} style={{ display: "flex", flexDirection: "column", height: typeof height === "number" ? `${height}px` : height, backgroundColor: "#f8fafc", borderRadius: "12px", overflow: "hidden", border: "1px solid #e2e8f0" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid #e2e8f0", backgroundColor: "#fff" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "16px" }}>🎯</span>
          <span style={{ fontWeight: 600, color: "#111827", fontSize: "14px" }}>Massing 3D</span>
          <span style={{ marginLeft: 6, fontSize: 11, color: "#64748b" }}>
            Dept: {deptResolved?.dept ?? "—"} ({deptResolved?.source ?? "—"})
            {deptResolved?.commune && ` - ${deptResolved.commune}`}
          </span>
          <span style={{ marginLeft: 8, fontSize: 11, padding: "2px 8px", borderRadius: 999, border: "1px solid #e5e7eb",
            color: relief.status === "ready" ? "#065f46" : relief.status === "error" ? "#991b1b" : "#334155",
            background: relief.status === "ready" ? "#ecfdf5" : relief.status === "error" ? "#fff1f2" : "#f8fafc" }}>
            Relief: {relief.status === "ready" ? "OK" : relief.status === "loading" ? "…" : relief.status === "error" ? "KO" : "—"}
          </span>
        </div>
      </div>
      <div style={{ flex: 1, display: "flex", gap: "12px", padding: "12px", overflow: "hidden" }}>
        <Scene3D parcel={parcel} buildings={buildings} parkings={parkings}
          visibility={{ terrain: scene.visibility.terrain, buildings: scene.visibility.buildings, parkings: scene.visibility.parkings, wireframe: (scene.visibility as any)?.wireframe }}
          isLoading={scene.isLoading} relief={relief} />
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", flexShrink: 0 }}>
          <Controls3D visibility={scene.visibility} viewMode={scene.viewMode} onToggleVisibility={scene.toggleVisibility} onViewModeChange={scene.setViewMode} disabled={scene.isLoading} />
          <KpiPanel kpis={scene.kpis} isLoading={scene.isLoading} relief={relief} />
        </div>
      </div>
    </div>
  );
};

Massing3DCanvas.displayName = "Massing3DCanvas";