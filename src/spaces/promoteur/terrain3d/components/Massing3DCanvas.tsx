// ============================================================================
// FILE: src/spaces/promoteur/terrain3d/components/Massing3DCanvas.tsx
// ✅ MassingEditor3D branché (remplace SceneSvg3D)
// ✅ bbox reliefData convertie L93 → WGS84 avant passage au renderer
// ✅ showTerrain local (ne dépend plus de scene.visibility.terrain)
// ✅ Logs diagnostics pour déboguer le pipeline relief
// ============================================================================

import React, { type FC, useEffect, useMemo, useState } from "react";
import type { Feature, FeatureCollection, Polygon, MultiPolygon, Position } from "geojson";
import proj4 from "proj4";

import { useMassingScene } from "../hooks/useMassingScene";
import { Controls3D } from "./Controls3D";
import type { EarthworksKPIs } from "../types/earthworks.types";
import type { ReliefData } from "./SceneSvg3D";
import type { Implantation2DMeta } from "../../store/promoteurProject.store";
import {
  ensureDepartment, elevationLambert93, type ElevationPoint,
} from "../../../../lib/terrainServiceClient";

import { MassingEditor3D } from "../../massing3d/MassingEditor3D";

const ACCENT = "#5247b8";

// ─── Proj4 Lambert93 ─────────────────────────────────────────────────────────

const E2154 = "+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface Massing3DCanvasProps {
  parcel?: Feature<Polygon | MultiPolygon>;
  buildings?: FeatureCollection<Polygon>;
  parkings?: FeatureCollection<Polygon>;
  height?: string | number;
  className?: string;
  meta?: Implantation2DMeta;
  buildingHeightM?: number;
}

// ─── Relief state ─────────────────────────────────────────────────────────────

type ReliefState = {
  status: "idle" | "loading" | "ready" | "error";
  message?: string;
  deptCode?: string; deptSource?: string; commune?: string; epsg?: string;
  minZ?: number; maxZ?: number; deltaZ?: number;
  meanSlopePct?: number; maxSlopePct?: number;
  reliefData?: ReliefData;
  cutVolume?: number; fillVolume?: number;
  platformLevel?: number; volumeBalance?: number; footprintArea?: number;
  cutCost?: number; evacuationCost?: number; totalCost?: number;
};

// ─── KPI panel ────────────────────────────────────────────────────────────────

const EW_COSTS = { cutCostPerM3: 12, evacuationCostPerM3: 22 };
const fmt    = (v: number | null, u: string, d = 1) => v == null ? "—" : `${v.toFixed(d)} ${u}`;
const fmtEur = (v: number | null) => v == null ? "—" : new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);

const KpiPanel: FC<{
  kpis: EarthworksKPIs; relief?: ReliefState;
  meta?: Implantation2DMeta; buildingHeightM?: number;
}> = ({ kpis, relief, meta, buildingHeightM }) => {
  const row: React.CSSProperties = { display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid #f3f4f6" };
  const lbl: React.CSSProperties = { color: "#6b7280", fontSize: "11px" };
  const val: React.CSSProperties = { fontWeight: 600, fontSize: "11px", fontVariantNumeric: "tabular-nums" };
  const sec: React.CSSProperties = { fontSize: "11px", fontWeight: 700, marginTop: 10, marginBottom: 6, color: "#374151", display: "flex", alignItems: "center", gap: 5, textTransform: "uppercase", letterSpacing: "0.06em" };

  const slope    = relief?.status === "ready" && relief.meanSlopePct != null ? relief.meanSlopePct : kpis.naturalSlope;
  const maxSlope = relief?.status === "ready" && relief.maxSlopePct  != null ? relief.maxSlopePct  : kpis.maxSlope;
  const hasEW    = relief?.status === "ready" && (relief.cutVolume ?? 0) > 0;

  return (
    <div style={{ background: "white", borderRadius: 12, padding: 14, border: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: "#111827" }}>📊 Indicateurs terrain</div>

      {relief && (
        <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 6, lineHeight: 1.4 }}>
          Relief: <b>{relief.status === "ready" ? "OK" : relief.status === "loading" ? "…" : relief.status === "error" ? "KO" : "—"}</b>
          {relief.deptCode && ` · dept ${relief.deptCode}`}
          {relief.commune  && ` · ${relief.commune}`}
          {relief.deltaZ != null && ` · ΔZ ${relief.deltaZ.toFixed(1)}m`}
        </div>
      )}

      {relief?.status === "error" && relief.message && (
        <div style={{ fontSize: 10, color: "#991b1b", padding: "4px 8px", background: "#fff1f2", borderRadius: 6, marginBottom: 6 }}>
          ⚠️ {relief.message}
        </div>
      )}

      {meta?.floorsSpec && (
        <>
          <div style={sec}><span>🏢</span>Volumétrie</div>
          <div style={row}><span style={lbl}>Type</span>   <span style={val}>{meta.buildingKind === "COLLECTIF" ? "Collectif" : "Individuel"}</span></div>
          <div style={row}><span style={lbl}>Niveaux</span><span style={val}>R+{meta.floorsSpec.aboveGroundFloors}</span></div>
          {buildingHeightM != null && <div style={row}><span style={lbl}>Hauteur</span><span style={{ ...val, color: ACCENT }}>{buildingHeightM.toFixed(1)} m</span></div>}
          {meta.nbLogements > 0 && <div style={row}><span style={lbl}>Logements</span><span style={val}>{meta.nbLogements} × {meta.surfaceMoyLogementM2} m²</span></div>}
        </>
      )}

      <div style={sec}><span>📐</span>Pentes</div>
      <div style={row}><span style={lbl}>Moyenne</span><span style={val}>{fmt(slope, "%")}</span></div>
      <div style={row}><span style={lbl}>Max</span>    <span style={val}>{fmt(maxSlope, "%")}</span></div>

      {hasEW && (
        <>
          <div style={sec}><span>🏗</span>Terrassement</div>
          {relief?.footprintArea != null && relief.footprintArea > 0 &&
            <div style={row}><span style={lbl}>Emprise</span>    <span style={val}>{fmt(relief.footprintArea, "m²", 0)}</span></div>}
          {relief?.platformLevel != null &&
            <div style={row}><span style={lbl}>Plateforme</span><span style={val}>{relief.platformLevel.toFixed(2)} m NGF</span></div>}
          <div style={row}><span style={lbl}>Déblai</span><span style={{ ...val, color: "#dc2626" }}>{fmt(relief?.cutVolume ?? 0, "m³", 0)}</span></div>
          <div style={sec}><span>💰</span>Coûts</div>
          <div style={row}><span style={lbl}>Déblai</span>      <span style={val}>{fmtEur(relief?.cutCost ?? 0)}</span></div>
          <div style={row}><span style={lbl}>Évacuation</span>  <span style={val}>{fmtEur(relief?.evacuationCost ?? 0)}</span></div>
          <div style={{ ...row, borderBottom: "none", borderTop: "1.5px solid #e5e7eb", paddingTop: 6, marginTop: 4 }}>
            <span style={{ ...lbl, fontWeight: 700, color: "#111827" }}>Total</span>
            <span style={{ ...val, color: "#111827" }}>{fmtEur(relief?.totalCost ?? 0)}</span>
          </div>
        </>
      )}
    </div>
  );
};

// ─── Geo helpers ──────────────────────────────────────────────────────────────

function looksWgs84(b: [number, number, number, number]) {
  return !b.some(v => Math.abs(v) > 1000);
}

function detectOrd(b: [number, number, number, number]): "lon-lat" | "lat-lon" | "unknown" {
  const [v0, v1, v2, v3] = b;
  const inFR = (lon: number, lat: number) => lon >= -6 && lon <= 11 && lat >= 41 && lat <= 52;
  const ll = inFR(Math.min(v0, v2), Math.min(v1, v3)) && inFR(Math.max(v0, v2), Math.max(v1, v3));
  const lr = inFR(Math.min(v1, v3), Math.min(v0, v2)) && inFR(Math.max(v1, v3), Math.max(v0, v2));
  if (ll && !lr) return "lon-lat";
  if (lr && !ll) return "lat-lon";
  return ll ? "lon-lat" : "unknown";
}

const toL93 = (b: [number, number, number, number], ord: string): [number, number, number, number] => {
  const [a, bv, c, d] = b;
  const [mnLon, mnLat, mxLon, mxLat] = ord === "lat-lon" ? [bv, a, d, c] : [a, bv, c, d];
  const p1 = proj4("EPSG:4326", E2154, [mnLon, mnLat]) as [number, number];
  const p2 = proj4("EPSG:4326", E2154, [mxLon, mxLat]) as [number, number];
  return [Math.min(p1[0], p2[0]), Math.min(p1[1], p2[1]), Math.max(p1[0], p2[0]), Math.max(p1[1], p2[1])];
};

/**
 * Convertit une bbox Lambert93 [x0,y0,x1,y1] → WGS84 [lon0,lat0,lon1,lat1].
 * CRITIQUE : MassingRenderer projette en WGS84. Une bbox en mètres L93
 * serait interprétée comme des degrés → décalage de centaines de km.
 */
const l93ToWgs84Bbox = (b: [number, number, number, number]): [number, number, number, number] => {
  const sw = proj4(E2154, "EPSG:4326", [b[0], b[1]]) as [number, number];
  const ne = proj4(E2154, "EPSG:4326", [b[2], b[3]]) as [number, number];
  return [sw[0], sw[1], ne[0], ne[1]];
};

const pt2L93 = (lon: number, lat: number, ord: string): [number, number] => (
  ord === "lat-lon"
    ? proj4("EPSG:4326", E2154, [lat, lon])
    : proj4("EPSG:4326", E2154, [lon, lat])
) as [number, number];

const normDept      = (v: unknown): string | null => { if (!v) return null; const s = String(v).trim().toUpperCase(); return (/^\d{2,3}$/.test(s) || s === "2A" || s === "2B") ? s : null; };
const deptFromInsee = (v: unknown): string | null => { if (!v) return null; const s = String(v).trim().toUpperCase(); if (s.startsWith("2A")) return "2A"; if (s.startsWith("2B")) return "2B"; if (/^97\d/.test(s)) return s.slice(0, 3); if (/^\d{5}$/.test(s)) return s.slice(0, 2); return null; };
const deptFromCp    = (v: unknown): string | null => { if (!v) return null; const s = String(v).trim(); if (/^97\d{3}$/.test(s)) return s.slice(0, 3); if (/^20\d{3}$/.test(s)) return parseInt(s, 10) >= 20200 ? "2B" : "2A"; if (/^\d{5}$/.test(s)) return s.slice(0, 2); return null; };

async function deptGeoApi(lon: number, lat: number): Promise<{ dept: string | null; commune?: string }> {
  try {
    const r = await fetch(`https://geo.api.gouv.fr/communes?lon=${lon}&lat=${lat}&fields=nom,codeDepartement&limit=1`);
    if (!r.ok) return { dept: null };
    const j = await r.json();
    if (!Array.isArray(j) || !j.length) return { dept: null };
    return { dept: normDept(j[0].codeDepartement), commune: j[0].nom };
  } catch { return { dept: null }; }
}

async function deptBan(lon: number, lat: number): Promise<{ dept: string | null }> {
  try {
    const r = await fetch(`https://api-adresse.data.gouv.fr/reverse/?lon=${lon}&lat=${lat}&limit=1`);
    if (!r.ok) return { dept: null };
    const j = await r.json();
    return { dept: deptFromCp(j?.features?.[0]?.properties?.postcode) };
  } catch { return { dept: null }; }
}

function extractRings(g: Polygon | MultiPolygon): Position[][] {
  return g.type === "Polygon" ? g.coordinates : g.coordinates.flatMap(p => p);
}
function inPoly(x: number, y: number, r: [number, number][]): boolean {
  let ins = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) ins = !ins;
  }
  return ins;
}
function inAny(x: number, y: number, ps: [number, number][][]): boolean {
  return ps.some(r => inPoly(x, y, r));
}

function buildGrid(b: [number, number, number, number], step = 5, max = 2500) {
  const [mnX, mnY, mxX, mxY] = b;
  const w = Math.max(1, mxX - mnX), h = Math.max(1, mxY - mnY);
  let nx = Math.max(2, Math.floor(w / step) + 1), ny = Math.max(2, Math.floor(h / step) + 1);
  while (nx * ny > max && (nx > 2 || ny > 2)) {
    nx = Math.max(2, Math.floor(nx * 0.85));
    ny = Math.max(2, Math.floor(ny * 0.85));
  }
  const dx = w / (nx - 1), dy = h / (ny - 1);
  const pts: ElevationPoint[] = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) pts.push({ x: mnX + dx * i, y: mnY + dy * j });
  return { pts, nx, ny, dx, dy };
}

function chunk<T>(a: T[], n: number): T[][] {
  const o: T[][] = [];
  for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n));
  return o;
}

function slopeKPIs(z: number[], nx: number, ny: number, dx: number, dy: number) {
  const at = (i: number, j: number) => z[j * nx + i];
  let s = 0, cnt = 0, mx = 0, mn = Infinity, mxZ = -Infinity;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const z0 = at(i, j); if (!Number.isFinite(z0)) continue;
    if (z0 < mn) mn = z0; if (z0 > mxZ) mxZ = z0;
    let dzdx = 0, dzdy = 0;
    if (i > 0 && i < nx - 1 && Number.isFinite(at(i - 1, j)) && Number.isFinite(at(i + 1, j)))
      dzdx = (at(i + 1, j) - at(i - 1, j)) / (2 * dx);
    if (j > 0 && j < ny - 1 && Number.isFinite(at(i, j - 1)) && Number.isFinite(at(i, j + 1)))
      dzdy = (at(i, j + 1) - at(i, j - 1)) / (2 * dy);
    const sl = Math.sqrt(dzdx * dzdx + dzdy * dzdy) * 100;
    s += sl; cnt++; if (sl > mx) mx = sl;
  }
  return {
    meanPct: cnt ? s / cnt : 0, maxPct: mx,
    minZ: Number.isFinite(mn) ? mn : 0,
    maxZ: Number.isFinite(mxZ) ? mxZ : 0,
    deltaZ: (Number.isFinite(mxZ) && Number.isFinite(mn)) ? mxZ - mn : 0,
  };
}

function ewUnder(
  e: number[], nx: number, ny: number, dx: number, dy: number,
  b: [number, number, number, number], fps: [number, number][][],
) {
  const [mnX, mnY] = b, cA = dx * dy;
  const zU: number[] = [], cs: { i: number; j: number; z: number }[] = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = mnX + i * dx, y = mnY + j * dy, z = e[j * nx + i];
    if (Number.isFinite(z) && inAny(x, y, fps)) { zU.push(z); cs.push({ i, j, z }); }
  }
  if (!zU.length) return { cutVolume: 0, fillVolume: 0, platformLevel: 0, balance: 0, footprintArea: 0 };
  const pl = Math.min(...zU);
  let cut = 0;
  for (const c of cs) { const d = c.z - pl; if (d > 0) cut += d * cA; }
  return {
    cutVolume: Math.round(cut), fillVolume: 0,
    platformLevel: Math.round(pl * 100) / 100,
    balance: Math.round(cut),
    footprintArea: Math.round(zU.length * cA),
  };
}

function ewCosts(cut: number) {
  return {
    cutCost:       Math.round(cut * EW_COSTS.cutCostPerM3),
    evacuationCost: Math.round(cut * EW_COSTS.evacuationCostPerM3),
    totalCost:     Math.round(cut * (EW_COSTS.cutCostPerM3 + EW_COSTS.evacuationCostPerM3)),
  };
}

function fpsL93(
  b: FeatureCollection<Polygon> | undefined,
  p: FeatureCollection<Polygon> | undefined,
  ord: string, isW: boolean,
): [number, number][][] {
  const r: [number, number][][] = [];
  const proc = (fc: FeatureCollection<Polygon> | undefined) => {
    if (!fc?.features) return;
    for (const f of fc.features) {
      if (!f.geometry) continue;
      for (const ring of extractRings(f.geometry as Polygon | MultiPolygon))
        r.push(ring.map(pos => isW ? pt2L93(pos[0], pos[1], ord) : [pos[0], pos[1]] as [number, number]));
    }
  };
  proc(b); proc(p); return r;
}

// ─── Main component ───────────────────────────────────────────────────────────

export const Massing3DCanvas: FC<Massing3DCanvasProps> = ({
  parcel, buildings, parkings, height = "600px", className, meta, buildingHeightM,
}) => {
  const scene = useMassingScene(parcel, buildings, parkings);
  const [relief, setRelief] = useState<ReliefState>({ status: "idle" });

  // ── BBox brute ────────────────────────────────────────────────────────────
  const rawBBox = useMemo((): [number, number, number, number] | null => {
    const b = (parcel as any)?.bbox;
    if (Array.isArray(b) && b.length === 4 && b.every((n: any) => typeof n === "number"))
      return b as [number, number, number, number];
    const geom: any = parcel?.geometry; if (!geom) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const v = (c: any) => {
      if (!Array.isArray(c)) return;
      if (typeof c[0] === "number" && typeof c[1] === "number") {
        x0 = Math.min(x0, c[0]); y0 = Math.min(y0, c[1]);
        x1 = Math.max(x1, c[0]); y1 = Math.max(y1, c[1]); return;
      }
      for (const s of c) v(s);
    };
    v(geom.coordinates);
    return Number.isFinite(x0) ? [x0, y0, x1, y1] : null;
  }, [parcel]);

  const parcelEpsg = useMemo(() => rawBBox && looksWgs84(rawBBox) ? "EPSG:4326" : "EPSG:2154", [rawBBox]);
  const coordOrd   = useMemo(() => rawBBox && parcelEpsg === "EPSG:4326" ? detectOrd(rawBBox) : "lon-lat", [rawBBox, parcelEpsg]);

  // ── Dept ──────────────────────────────────────────────────────────────────
  const deptFromProps = useMemo(() => {
    const p: any = (parcel as any)?.properties ?? {};
    for (const k of ["commune_insee", "insee", "code_insee", "citycode"])
      if (p[k]) { const d = deptFromInsee(p[k]); if (d) return { dept: d, source: "insee" }; }
    for (const k of ["code_postal", "cp", "postcode", "postal_code"])
      if (p[k]) { const d = deptFromCp(p[k]);    if (d) return { dept: d, source: "postcode" }; }
    for (const k of ["deptCode", "code_dept", "departement", "dept"])
      if (p[k]) { const d = normDept(p[k]);      if (d) return { dept: d, source: "props" }; }
    return { dept: null, source: null };
  }, [parcel]);

  const [deptRes, setDeptRes] = useState<{ dept: string; source: string; commune?: string } | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      if (deptFromProps.dept) {
        if (!cancel) setDeptRes({ dept: deptFromProps.dept, source: deptFromProps.source! });
        return;
      }
      if (rawBBox && parcelEpsg === "EPSG:4326") {
        const [v0, v1, v2, v3] = rawBBox;
        const [lon, lat] = coordOrd === "lat-lon" ? [(v1 + v3) / 2, (v0 + v2) / 2] : [(v0 + v2) / 2, (v1 + v3) / 2];
        let r = await deptGeoApi(lon, lat); if (!cancel && r.dept) { setDeptRes({ dept: r.dept, source: "geoapi", commune: r.commune }); return; }
        r     = await deptGeoApi(lat, lon); if (!cancel && r.dept) { setDeptRes({ dept: r.dept, source: "geoapi", commune: r.commune }); return; }
        let bv = await deptBan(lon, lat);   if (!cancel && bv.dept) { setDeptRes({ dept: bv.dept, source: "ban" }); return; }
        bv     = await deptBan(lat, lon);   if (!cancel && bv.dept) { setDeptRes({ dept: bv.dept, source: "ban" }); return; }
      }
      if (!cancel) setDeptRes({ dept: "75", source: "fallback" });
    })();
    return () => { cancel = true; };
  }, [deptFromProps, rawBBox, parcelEpsg, coordOrd]);

  const bbox2154 = useMemo(() =>
    rawBBox ? (parcelEpsg === "EPSG:4326" ? toL93(rawBBox, coordOrd) : rawBBox) : null,
    [rawBBox, parcelEpsg, coordOrd],
  );
  const fpL93_ = useMemo(() =>
    fpsL93(buildings, parkings, coordOrd, parcelEpsg === "EPSG:4326"),
    [buildings, parkings, coordOrd, parcelEpsg],
  );

  // ── Fetch élévations ──────────────────────────────────────────────────────
  // ⚠️  On ne conditionne PAS sur scene.visibility.terrain — ce flag est souvent
  //     false par défaut dans useMassingScene, ce qui bloquait silencieusement
  //     tout le pipeline. La visibilité terrain est gérée dans MassingEditor3D.
  useEffect(() => {
    let cancel = false;
    (async () => {
      if (!bbox2154 || !deptRes?.dept) {
        console.log("[Relief] En attente — bbox2154:", bbox2154, "dept:", deptRes?.dept);
        return;
      }

      console.log("[Relief] Démarrage fetch — dept:", deptRes.dept, "bbox L93:", bbox2154);
      setRelief({ status: "loading", deptCode: deptRes.dept, deptSource: deptRes.source, commune: deptRes.commune, epsg: parcelEpsg });

      try {
        const pad = 20;
        const paddedL93: [number, number, number, number] = [
          bbox2154[0] - pad, bbox2154[1] - pad,
          bbox2154[2] + pad, bbox2154[3] + pad,
        ];

        console.log("[Relief] Ensure department:", deptRes.dept);
        await ensureDepartment(deptRes.dept);

        const { pts, nx, ny, dx, dy } = buildGrid(paddedL93, 5, 2500);
        console.log("[Relief] Grid:", { nx, ny, totalPoints: pts.length, dx: dx.toFixed(1), dy: dy.toFixed(1) });

        const elevs: (number | null)[] = [];
        for (const batch of chunk(pts, 800)) {
          const r = await elevationLambert93(deptRes.dept, batch);
          elevs.push(...(r.elevations ?? []));
        }

        const valid = elevs.filter(v => typeof v === "number" && Number.isFinite(v)) as number[];
        console.log("[Relief] Élévations reçues:", elevs.length, "| valides:", valid.length, "| ratio:", (valid.length / elevs.length * 100).toFixed(1) + "%");

        if (valid.length / elevs.length < 0.6)
          throw new Error(`Relief insuffisant: ${valid.length}/${elevs.length} points valides`);

        const median = [...valid].sort((a, b) => a - b)[Math.floor(valid.length / 2)];
        const filled = elevs.map(v => (typeof v === "number" && Number.isFinite(v)) ? v : median);

        const sl = slopeKPIs(filled, nx, ny, dx, dy);
        console.log("[Relief] Altitude:", { minZ: sl.minZ.toFixed(1), maxZ: sl.maxZ.toFixed(1), deltaZ: sl.deltaZ.toFixed(1), meanSlope: sl.meanPct.toFixed(1) + "%" });

        const ew = ewUnder(filled, nx, ny, dx, dy, paddedL93, fpL93_);
        const co = ewCosts(ew.cutVolume);

        // ── CONVERSION CRITIQUE bbox L93 → WGS84 ─────────────────────────
        // MassingRenderer projette en WGS84. Une bbox L93 en mètres serait
        // interprétée comme des degrés → décalage de ~700 km vers l'est.
        const bboxWgs84 = l93ToWgs84Bbox(paddedL93);
        console.log("[Relief] bbox WGS84 (pour renderer):", bboxWgs84.map(v => v.toFixed(5)));

        if (cancel) return;
        setRelief({
          status: "ready",
          deptCode: deptRes.dept, deptSource: deptRes.source, commune: deptRes.commune, epsg: parcelEpsg,
          minZ: sl.minZ, maxZ: sl.maxZ, deltaZ: sl.deltaZ,
          meanSlopePct: sl.meanPct, maxSlopePct: sl.maxPct,
          reliefData: {
            elevations:    filled,
            nx, ny, dx, dy,
            minZ:          sl.minZ,
            maxZ:          sl.maxZ,
            bbox:          bboxWgs84,     // ← WGS84 obligatoire pour MassingRenderer
            platformLevel: ew.platformLevel,
          },
          cutVolume:      ew.cutVolume,
          fillVolume:     ew.fillVolume,
          platformLevel:  ew.platformLevel,
          volumeBalance:  ew.balance,
          footprintArea:  ew.footprintArea,
          cutCost:        co.cutCost,
          evacuationCost: co.evacuationCost,
          totalCost:      co.totalCost,
        });

        console.log("[Relief] ✅ Données prêtes — nx:", nx, "ny:", ny, "points:", filled.length);
      } catch (e: any) {
        console.error("[Relief] ❌ Erreur:", e?.message ?? e);
        if (!cancel) setRelief({ status: "error", deptCode: deptRes.dept, message: e?.message ?? String(e) });
      }
    })();
    return () => { cancel = true; };
    // ⚠️  scene.visibility.terrain VOLONTAIREMENT ABSENT des deps —
    //     il était false par défaut et bloquait le pipeline.
  }, [bbox2154, deptRes, parcelEpsg, fpL93_]);

  // ─── Layout ───────────────────────────────────────────────────────────────
  return (
    <div className={className} style={{
      display: "flex", flexDirection: "column",
      height: typeof height === "number" ? `${height}px` : height,
      backgroundColor: "#f8fafc", borderRadius: "12px",
      overflow: "hidden", border: "1px solid #e2e8f0",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 14px", borderBottom: "1px solid #e2e8f0", backgroundColor: "#fff", flexShrink: 0 }}>
        <span style={{ fontSize: 15 }}>🎯</span>
        <span style={{ fontWeight: 600, color: "#111827", fontSize: 13 }}>Massing 3D</span>
        <span style={{ fontSize: 10, color: "#64748b" }}>
          {deptRes?.dept ?? "—"} · {deptRes?.commune ?? "—"}
        </span>
        {buildingHeightM != null && (
          <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 999, border: `1px solid rgba(82,71,184,0.3)`, color: ACCENT, background: "#f0eeff", fontWeight: 600 }}>
            H {buildingHeightM.toFixed(1)} m · R+{meta?.floorsSpec?.aboveGroundFloors ?? "?"}
          </span>
        )}
        {/* Indicateur relief */}
        <span style={{
          fontSize: 10, padding: "2px 7px", borderRadius: 999, border: "1px solid #e5e7eb",
          color:      relief.status === "ready" ? "#065f46" : relief.status === "error" ? "#991b1b" : "#334155",
          background: relief.status === "ready" ? "#ecfdf5" : relief.status === "error" ? "#fff1f2" : "#f8fafc",
        }}>
          Relief: {relief.status === "ready" ? `OK · ΔZ ${relief.deltaZ?.toFixed(1)}m` : relief.status === "loading" ? "…" : relief.status === "error" ? "KO" : "—"}
        </span>
        {relief.status === "error" && relief.message && (
          <span style={{ fontSize: 10, color: "#991b1b", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={relief.message}>
            ⚠️ {relief.message}
          </span>
        )}
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: "flex", gap: 0, overflow: "hidden", minHeight: 0 }}>

        {/* Vue 3D — MassingEditor3D */}
        <div style={{ flex: 1, overflow: "hidden", position: "relative", minWidth: 0 }}>
          {scene.isLoading ? (
            <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b" }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 24, marginBottom: 8 }}>⏳</div>
                Chargement...
              </div>
            </div>
          ) : (
            <MassingEditor3D
              parcel={parcel}
              buildings={buildings}
              parkings={parkings}
              reliefData={relief.status === "ready" ? relief.reliefData : null}
              buildingHeightM={buildingHeightM}
              meta={meta}
              height="100%"
            />
          )}
        </div>

        {/* Sidebar KPI */}
        <div style={{
          width: 220, flexShrink: 0,
          display: "flex", flexDirection: "column", gap: 8,
          padding: "10px 8px", height: "100%",
          overflowY: "auto", overflowX: "hidden",
          borderLeft: "1px solid #e2e8f0", background: "#f8fafc",
          scrollbarWidth: "thin", scrollbarColor: "#cbd5e1 transparent",
        }}>
          <Controls3D
            visibility={scene.visibility} viewMode={scene.viewMode}
            onToggleVisibility={scene.toggleVisibility} onViewModeChange={scene.setViewMode}
            disabled={scene.isLoading}
          />
          <KpiPanel kpis={scene.kpis} relief={relief} meta={meta} buildingHeightM={buildingHeightM} />
          <div style={{ height: 4, flexShrink: 0 }} />
        </div>
      </div>
    </div>
  );
};

Massing3DCanvas.displayName = "Massing3DCanvas";