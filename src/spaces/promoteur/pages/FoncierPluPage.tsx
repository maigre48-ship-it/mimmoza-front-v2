// src/spaces/promoteur/pages/FoncierPluPage.tsx
// VERSION 8.0.0
//   - Migration vers usePromoteurStudy + PromoteurStudyService
//   - Hydratation depuis study.foncier / study.plu (JSONB)
//   - Plus de dépendance aux colonnes plates pour la lecture
//   - localStorage = cache secondaire uniquement

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
import { patchModule } from "../shared/promoteurSnapshot.store";
import { PromoteurStudyService } from "../shared/promoteurStudyService";
import { usePromoteurStudy } from "../shared/usePromoteurStudy";
import type {
  PromoteurParcelRaw,
  PromoteurFoncierData,
  PromoteurPluData,
} from "../shared/promoteurStudy.types";

const PLU_PARSER_URL = import.meta.env.VITE_PLU_PARSER_URL || "http://localhost:3000";
const PLU_PARSER_API_KEY = import.meta.env.VITE_PLU_PARSER_API_KEY || "";

const GRAD_PRO = "linear-gradient(90deg, #7c6fcd 0%, #b39ddb 100%)";
const ACCENT_PRO = "#5247b8";

// ─── Types locaux ─────────────────────────────────────────────────────────────
interface SelectedParcel { id: string; feature?: any; area_m2?: number | null; }
interface PluData { zone_code?: string; zone_libelle?: string; ruleset?: any; raw?: any; found?: boolean; }
interface ProjectInfo { parcelId?: string; parcelIds?: string[]; communeInsee?: string; surfaceM2?: number; address?: string; addressLat?: number; addressLon?: number; }
interface AddressSuggestion { label: string; citycode?: string; context?: string; lon: number; lat: number; id: string; }
type BBox = { minLon: number; minLat: number; maxLon: number; maxLat: number };

const DEFAULT_ZOOM = 17;
const IGN_LIMIT = 500;
const IGN_TIMEOUT_MS = 60000;
const FETCH_RADIUS_KM = 0.5;

const styles = {
  container: { padding: "24px", maxWidth: "1400px", margin: "0 auto", fontFamily: "'Inter', -apple-system, sans-serif", position: "relative" as const, zIndex: 1 } as React.CSSProperties,
  grid: { display: "grid", gridTemplateColumns: "1fr 380px", gap: "20px" } as React.CSSProperties,
  card: { background: "white", borderRadius: "14px", border: "1px solid #e2e8f0", overflow: "hidden", position: "relative" as const } as React.CSSProperties,
  cardHeader: { padding: "16px 18px", borderBottom: "1px solid #e2e8f0", background: "#f8fafc", display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 5, position: "relative" as const } as React.CSSProperties,
  cardTitle: { fontSize: "14px", fontWeight: 700, color: "#0f172a", display: "flex", alignItems: "center", gap: "8px", margin: 0 } as React.CSSProperties,
  cardBody: { padding: "18px" } as React.CSSProperties,
  badge: { display: "inline-flex", alignItems: "center", padding: "4px 10px", borderRadius: "6px", fontSize: "11px", fontWeight: 600 } as React.CSSProperties,
  button: { display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", padding: "10px 16px", borderRadius: "10px", border: "none", fontSize: "13px", fontWeight: 600, cursor: "pointer" } as React.CSSProperties,
  input: { width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1px solid #e2e8f0", fontSize: "13px", outline: "none", boxSizing: "border-box" as const } as React.CSSProperties,
  inputLabel: { fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "6px", display: "block" } as React.CSSProperties,
};

// ─── Utilities ────────────────────────────────────────────────────────────────
function formatAreaM2(area: number | null | undefined): string {
  if (area == null) return "—";
  return area.toLocaleString("fr-FR") + " m²";
}

function extractCommuneInsee(parcelId: string | null | undefined): string | null {
  if (!parcelId) return null;
  const clean = parcelId.replace(/[-\s]/g, "");
  return clean.length >= 5 ? clean.slice(0, 5) : null;
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
    return `${String(code_insee)}${prefixe}${String(section).padStart(2, "0")}${String(numero).padStart(4, "0")}`;
  }
  return null;
}

function calculatePolygonArea(geometry: any): number | null {
  try {
    if (!geometry) return null;
    let rings: number[][][] = [];
    if (geometry.type === "Polygon") rings = [geometry.coordinates[0]];
    else if (geometry.type === "MultiPolygon") rings = geometry.coordinates.map((p: any) => p[0]);
    else return null;
    let total = 0;
    for (const ring of rings) {
      if (!ring || ring.length < 3) continue;
      const R = 6371000;
      let area = 0;
      for (let i = 0; i < ring.length - 1; i++) {
        const toRad = (d: number) => d * Math.PI / 180;
        area += (toRad(ring[i + 1][0]) - toRad(ring[i][0])) * (2 + Math.sin(toRad(ring[i][1])) + Math.sin(toRad(ring[i + 1][1])));
      }
      total += Math.abs(area * R * R / 2);
    }
    return Math.round(total);
  } catch { return null; }
}

function getFeatureArea(feature: any): number | null {
  const p = feature?.properties || {};
  if (p.contenance && typeof p.contenance === "number" && p.contenance > 0) return p.contenance;
  if (feature?.geometry) return calculatePolygonArea(feature.geometry);
  return null;
}

function getFeatureBoundsCenter(feature: any): { center: [number, number] } | null {
  try {
    if (!feature?.geometry) return null;
    const layer = L.geoJSON(feature);
    const bounds = layer.getBounds();
    if (!bounds.isValid()) return null;
    const c = bounds.getCenter();
    return { center: [c.lat, c.lng] };
  } catch { return null; }
}

function getBboxAroundPoint(lat: number, lon: number, radiusKm: number): BBox {
  const dLat = radiusKm / 111;
  const dLon = radiusKm / (111 * Math.cos(lat * Math.PI / 180));
  return { minLat: lat - dLat, maxLat: lat + dLat, minLon: lon - dLon, maxLon: lon + dLon };
}

async function geocodeCommuneCenter(communeInsee: string): Promise<[number, number] | null> {
  try {
    const r = await fetch(
      `https://api-adresse.data.gouv.fr/search/?q=${communeInsee}&type=municipality&limit=1`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (r.ok) {
      const d = await r.json();
      const coords = d?.features?.[0]?.geometry?.coordinates;
      if (coords) return [coords[1], coords[0]];
    }
  } catch { /**/ }
  return null;
}

function legacyRulesetToResolved(plu: PluData): object | null {
  const rs = plu.ruleset;
  if (!rs) return null;
  return {
    version: "plu_ruleset_v1",
    zone_code: plu.zone_code,
    zone_libelle: plu.zone_libelle,
    hauteur: { max_m: rs.hauteur?.hauteur_egout_m ?? rs.hauteur?.hauteur_max_m ?? null, faitage_m: rs.hauteur?.hauteur_faitage_m ?? null, note: rs.hauteur?.note ?? null },
    ces: { max_ratio: rs.emprise_sol?.emprise_sol_max ?? null, note: rs.emprise_sol?.note ?? null },
    reculs: {
      voirie: { min_m: rs.reculs?.voirie?.min_m ?? null, note: rs.reculs?.voirie?.note ?? null },
      limites_separatives: { min_m: rs.reculs?.limites_separatives?.min_m ?? null, note: rs.reculs?.limites_separatives?.note ?? null },
      facades: { avant: { min_m: rs.reculs?.voirie?.min_m ?? null }, laterales: { min_m: rs.reculs?.limites_separatives?.min_m ?? null }, fond: { min_m: rs.reculs?.limites_separatives?.min_m ?? null } },
    },
    stationnement: { par_logement: rs.stationnement?.places_par_logement ?? null, note: rs.stationnement?.note ?? null },
    pleine_terre: { ratio_min: rs.pleine_terre?.min_pct != null ? rs.pleine_terre.min_pct / 100 : null, note: rs.pleine_terre?.note ?? null },
    cos: { max: rs.densite?.cos_max ?? null, note: rs.densite?.note ?? null },
    completeness: { ok: true, missing: [] },
  };
}

// ─── Canvas + styles carte ────────────────────────────────────────────────────
const cadastreCanvas = L.canvas({ padding: 0.5 });
const STYLE_DEFAULT: L.PathOptions        = { color: "#2563eb", opacity: 0.9, weight: 2, fillColor: "#60a5fa", fillOpacity: 0.22 };
const STYLE_SELECTED: L.PathOptions       = { color: "#16a34a", opacity: 1,   weight: 3, fillColor: "#22c55e", fillOpacity: 0.45 };
const STYLE_HOVER_DEFAULT: L.PathOptions  = { color: "#2563eb", opacity: 1,   weight: 3, fillColor: "#60a5fa", fillOpacity: 0.4  };
const STYLE_HOVER_SELECTED: L.PathOptions = { color: "#16a34a", opacity: 1,   weight: 4, fillColor: "#22c55e", fillOpacity: 0.6  };

// ─── ImperativeParcelLayer ────────────────────────────────────────────────────
function ImperativeParcelLayer({ fc, selectedIds, onToggleParcel }: {
  fc: any; selectedIds: string[];
  onToggleParcel: (pid: string, feature: any, area_m2: number | null) => void;
}) {
  const map = useMap();
  const layerRef       = useRef<L.GeoJSON | null>(null);
  const layerByIdRef   = useRef<Map<string, L.Path>>(new Map());
  const selectedIdsRef = useRef<Set<string>>(new Set(selectedIds));
  const onToggleRef    = useRef(onToggleParcel);

  useEffect(() => { selectedIdsRef.current = new Set(selectedIds); }, [selectedIds]);
  useEffect(() => { onToggleRef.current = onToggleParcel; }, [onToggleParcel]);

  useEffect(() => {
    if (layerRef.current) { map.removeLayer(layerRef.current); layerRef.current = null; }
    layerByIdRef.current.clear();
    const features = fc?.features;
    if (!features?.length) return;
    const layer = L.geoJSON({ type: "FeatureCollection", features } as any, {
      renderer: cadastreCanvas, interactive: true, bubblingMouseEvents: false,
      style: (feature?: any) => {
        const pid = feature ? getParcelIdFromFeature(feature) : null;
        return pid && selectedIdsRef.current.has(pid) ? STYLE_SELECTED : STYLE_DEFAULT;
      },
      onEachFeature: (feature: any, lyr: L.Layer) => {
        const pid = getParcelIdFromFeature(feature);
        if (!pid) return;
        layerByIdRef.current.set(pid, lyr as L.Path);
        lyr.on({
          mouseover: () => (lyr as L.Path).setStyle(selectedIdsRef.current.has(pid) ? STYLE_HOVER_SELECTED : STYLE_HOVER_DEFAULT),
          mouseout:  () => (lyr as L.Path).setStyle(selectedIdsRef.current.has(pid) ? STYLE_SELECTED : STYLE_DEFAULT),
          click:     () => onToggleRef.current(pid, feature, getFeatureArea(feature)),
        });
        const area = getFeatureArea(feature);
        lyr.bindTooltip(
          `<div style="font-family:Inter,sans-serif;font-size:12px"><strong>${pid}</strong>${area ? `<br/><b>${area.toLocaleString("fr-FR")} m²</b>` : ""}</div>`,
          { sticky: true, className: "parcel-tooltip" }
        );
      },
    });
    layer.addTo(map); layerRef.current = layer;
    return () => { if (layerRef.current) { map.removeLayer(layerRef.current); layerRef.current = null; } layerByIdRef.current.clear(); };
  }, [map, fc]);

  useEffect(() => {
    const sel = new Set(selectedIds);
    layerByIdRef.current.forEach((lyr, pid) => { (lyr as L.Path).setStyle(sel.has(pid) ? STYLE_SELECTED : STYLE_DEFAULT); });
  }, [selectedIds]);

  return null;
}

function MapCenterHandler({ center }: { center: [number, number] }) {
  const map = useMap();
  const lastCenter = useRef<string>("");
  useEffect(() => {
    const key = `${center[0].toFixed(5)},${center[1].toFixed(5)}`;
    if (lastCenter.current === key) return;
    lastCenter.current = key;
    map.setView(center, DEFAULT_ZOOM, { animate: true });
  }, [center, map]);
  return null;
}

// ─── CadastreMap ─────────────────────────────────────────────────────────────
function CadastreMap({ communeInsee, center, selectedIds, selectedParcels, onToggleParcel, heightPx = 400 }: {
  communeInsee: string; center: [number, number]; selectedIds: string[];
  selectedParcels: { id: string; feature?: any; area_m2?: number | null }[];
  onToggleParcel: (pid: string, feature: any, area_m2: number | null) => void;
  heightPx?: number;
}) {
  const [fc, setFc]                     = useState<any>(null);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [featureCount, setFeatureCount] = useState<number | null>(null);
  const [fetchMs, setFetchMs]           = useState<number | null>(null);
  const lastKeyRef = useRef<string>("");
  const cacheRef   = useRef<Map<string, any>>(new Map());

  const fetchParcelles = useCallback(async (lat: number, lon: number, insee: string) => {
    const bbox = getBboxAroundPoint(lat, lon, FETCH_RADIUS_KM);
    const key = `${insee}:${lat.toFixed(4)},${lon.toFixed(4)}`;
    if (lastKeyRef.current === key) return;
    lastKeyRef.current = key;
    if (cacheRef.current.has(key)) { const cached = cacheRef.current.get(key); setFc(cached); setFeatureCount(cached.features.length); return; }
    setLoading(true); setError(null);
    const t0 = performance.now();
    let features: any[] = [];
    try {
      const result = await supabase.functions.invoke("cadastre-parcelles-bbox-v1", { body: { commune_insee: insee, bbox } });
      const feat = result.data?.featureCollection?.features || result.data?.features || [];
      if (feat.length > 0) features = feat;
    } catch (e: any) { console.warn("[CadastreMap] Supabase proxy failed:", e?.message); }
    if (features.length === 0) {
      let page = 0, keepFetching = true;
      while (keepFetching) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), IGN_TIMEOUT_MS);
          const url = `https://apicarto.ign.fr/api/cadastre/parcelle?code_insee=${insee}&_limit=${IGN_LIMIT}&_start=${page * IGN_LIMIT}`;
          const res = await fetch(url, { signal: controller.signal });
          clearTimeout(timeout);
          if (!res.ok) { keepFetching = false; break; }
          const data = await res.json();
          const batch: any[] = data?.features ?? [];
          features = [...features, ...batch];
          if (batch.length < IGN_LIMIT) { keepFetching = false; } else { page++; }
          if (page >= 10) { keepFetching = false; }
        } catch { keepFetching = false; }
      }
    }
    let filtered = features;
    for (const sp of selectedParcels) {
      if (sp.feature?.geometry && !filtered.some((f: any) => getParcelIdFromFeature(f) === sp.id)) filtered = [sp.feature, ...filtered];
    }
    const elapsed = Math.round(performance.now() - t0);
    if (filtered.length === 0) { setError("0 parcelles trouvées — vérifiez le code commune ou déplacez la carte"); setLoading(false); setFeatureCount(0); return; }
    const result = { type: "FeatureCollection", features: filtered };
    cacheRef.current.set(key, result);
    setFc(result); setFeatureCount(filtered.length); setFetchMs(elapsed); setLoading(false);
  }, [selectedParcels]);

  useEffect(() => { if (center && communeInsee) fetchParcelles(center[0], center[1], communeInsee); }, [center, communeInsee, fetchParcelles]);

  return (
    <div style={{ position: "relative", height: heightPx, overflow: "hidden", borderRadius: "0 0 14px 14px" }}>
      <MapContainer center={center} zoom={DEFAULT_ZOOM} style={{ height: "100%", width: "100%" }} scrollWheelZoom preferCanvas>
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <MapCenterHandler center={center} />
        {fc && <ImperativeParcelLayer fc={fc} selectedIds={selectedIds} onToggleParcel={onToggleParcel} />}
      </MapContainer>
      <div style={{ position: "absolute", top: 10, right: 10, padding: "5px 10px", borderRadius: 6, background: "rgba(15,23,42,0.85)", color: "#e2e8f0", fontSize: 11, fontFamily: "monospace", zIndex: 1000, display: "flex", alignItems: "center", gap: 6 }}>
        {featureCount != null && <span>{featureCount} parcelles</span>}
        {fetchMs != null && <span style={{ color: fetchMs > 4000 ? "#fca5a5" : "#86efac" }}>{fetchMs}ms</span>}
        {selectedIds.length > 0 && <span style={{ color: "#86efac" }}>· {selectedIds.length} sel.</span>}
        <span style={{ background: "#065f46", color: "#a7f3d0", padding: "1px 5px", borderRadius: 4, fontSize: 10, fontWeight: 700 }}>IGN</span>
      </div>
      {loading && <div style={{ position: "absolute", top: 10, left: 10, padding: "6px 12px", borderRadius: 8, background: "rgba(15,23,42,0.9)", color: "white", fontSize: 12, fontWeight: 600, zIndex: 1000, display: "flex", alignItems: "center", gap: 6 }}><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />Chargement…</div>}
      {error && !loading && <div style={{ position: "absolute", bottom: 40, left: 10, right: 10, padding: "8px 12px", borderRadius: 8, background: "rgba(254,243,199,0.95)", border: "1px solid #fde68a", color: "#92400e", fontSize: 12, fontWeight: 600, zIndex: 1000 }}>⚠️ {error}</div>}
      <div style={{ position: "absolute", bottom: 10, right: 10, padding: "5px 10px", borderRadius: 6, background: "rgba(255,255,255,0.9)", fontSize: 11, color: "#64748b", zIndex: 1000 }}>Cliquez sur une parcelle pour la sélectionner</div>
    </div>
  );
}

// ─── PluUploaderPanel ─────────────────────────────────────────────────────────
function PluUploaderPanel({ communeInsee, communeNom, targetZoneCode, onPluParsed }: {
  communeInsee: string; communeNom?: string; targetZoneCode?: string; onPluParsed: (pluData: PluData) => void;
}) {
  const [file, setFile]               = useState<File | null>(null);
  const [uploading, setUploading]     = useState(false);
  const [progress, setProgress]       = useState<string>("");
  const [error, setError]             = useState<string | null>(null);
  const [pluServerStatus, setPluServerStatus] = useState<"unknown" | "ok" | "down">("unknown");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`${PLU_PARSER_URL}/health`, { signal: AbortSignal.timeout(3000) })
      .then(r => r.ok ? setPluServerStatus("ok") : setPluServerStatus("down"))
      .catch(() => setPluServerStatus("down"));
  }, []);

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
      const healthCheck = await fetch(`${PLU_PARSER_URL}/health`, { signal: AbortSignal.timeout(3000) });
      if (!healthCheck.ok) throw new Error("Serveur non accessible");
      const base64Data = await fileToBase64(file);
      setProgress("Analyse PLU en cours...");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (PLU_PARSER_API_KEY) headers["x-api-key"] = PLU_PARSER_API_KEY;
      const res = await fetch(`${PLU_PARSER_URL}/api/plu-parse`, {
        method: "POST", headers,
        body: JSON.stringify({ commune_insee: communeInsee, commune_nom: communeNom || `Commune ${communeInsee}`, target_zone_code: targetZoneCode, pdf_base64: base64Data, pdf_filename: file.name }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({ message: res.statusText }))).message);
      const result = await res.json();
      setProgress("Terminé !");
      if (result.success && result.zones_rulesets?.length > 0) {
        let zoneData = result.zones_rulesets[0];
        if (targetZoneCode) { const m = result.zones_rulesets.find((z: any) => z.zone_code?.toUpperCase() === targetZoneCode.toUpperCase()); if (m) zoneData = m; }
        const plu: PluData = { zone_code: zoneData.zone_code, zone_libelle: zoneData.zone_libelle, ruleset: zoneData.ruleset, raw: result, found: true };
        try { await supabase.from("plu_parsed").upsert({ commune_insee: communeInsee, zone_code: plu.zone_code, ruleset: plu.ruleset, source_file: file.name, parsed_at: new Date().toISOString() }, { onConflict: "commune_insee,zone_code" }); } catch { /**/ }
        onPluParsed(plu);
      } else throw new Error(result.message || "Aucune zone PLU trouvée");
    } catch (err: any) { setError(err.message || "Erreur"); }
    finally { setUploading(false); setProgress(""); }
  };

  return (
    <div style={{ ...styles.card, marginTop: "16px" }}>
      <div style={styles.cardHeader}>
        <h3 style={styles.cardTitle}><FileUp size={18} color="#f59e0b" />Importer le règlement PLU</h3>
        <span style={{ ...styles.badge, background: pluServerStatus === "ok" ? "#f0fdf4" : "#fef2f2", color: pluServerStatus === "ok" ? "#16a34a" : "#dc2626" }}>
          {pluServerStatus === "ok" ? "● Serveur OK" : pluServerStatus === "down" ? "● Serveur OFF" : "● …"}
        </span>
      </div>
      <div style={styles.cardBody}>
        {pluServerStatus === "down" && <div style={{ marginBottom: 16, padding: "12px 14px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, fontSize: 12, color: "#991b1b" }}><strong>⚠ Serveur non accessible</strong><br /><code style={{ fontSize: 11 }}>cd mimmoza-plu-parser && node index.cjs</code></div>}
        <p style={{ fontSize: 13, color: "#64748b", margin: "0 0 16px" }}>Uploadez le PDF du règlement pour extraire les règles.</p>
        <div onClick={() => fileInputRef.current?.click()} style={{ padding: 24, border: "2px dashed #cbd5e1", borderRadius: 12, background: file ? "#f0fdf4" : "#f8fafc", cursor: "pointer", textAlign: "center" }}>
          <input ref={fileInputRef} type="file" accept=".pdf" style={{ display: "none" }} onChange={e => { const s = e.target.files?.[0]; if (s?.type === "application/pdf") { setFile(s); setError(null); } else setError("PDF requis"); }} />
          {file ? (<div><Check size={32} color="#16a34a" style={{ marginBottom: 8 }} /><p style={{ fontSize: 14, fontWeight: 600, color: "#16a34a", margin: "0 0 4px" }}>{file.name}</p></div>) : (<div><Upload size={32} color="#94a3b8" style={{ marginBottom: 8 }} /><p style={{ fontSize: 14, fontWeight: 600, color: "#475569", margin: "0 0 4px" }}>Cliquez pour sélectionner</p><p style={{ fontSize: 12, color: "#94a3b8", margin: 0 }}>PDF du règlement PLU</p></div>)}
        </div>
        {targetZoneCode && <div style={{ marginTop: 12, padding: "8px 12px", background: "#ede9fe", borderRadius: 8, fontSize: 12, color: ACCENT_PRO }}><strong>Zone cible:</strong> {targetZoneCode}</div>}
        <button onClick={handleUploadAndParse} disabled={!file || uploading || pluServerStatus === "down"} style={{ ...styles.button, width: "100%", marginTop: 16, background: !file || uploading || pluServerStatus === "down" ? "#e2e8f0" : "#0f172a", color: !file || uploading || pluServerStatus === "down" ? "#94a3b8" : "white", cursor: !file || uploading || pluServerStatus === "down" ? "not-allowed" : "pointer" }}>
          {uploading ? <><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />{progress}</> : <><FileText size={16} />Analyser le PLU</>}
        </button>
        {error && <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 8, background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", fontSize: 12 }}><strong>Erreur:</strong> {error}</div>}
      </div>
    </div>
  );
}

// ─── PluInfoCard ──────────────────────────────────────────────────────────────
function ratioToPct(v: number | null | undefined): number | null {
  if (v == null) return null;
  return v < 1 ? Math.round(v * 100) : Math.round(v);
}

type FieldValue = { value: string | number | null; unit?: string; note?: string | null };
type FieldMap = { hauteur_max: FieldValue; hauteur_faitage: FieldValue; ces_max: FieldValue; recul_voie: FieldValue; recul_limites: FieldValue; stationnement: FieldValue; pleine_terre: FieldValue; cos: FieldValue; };
const EMPTY_FIELDS: FieldMap = { hauteur_max: { value: null, unit: "m" }, hauteur_faitage: { value: null, unit: "m" }, ces_max: { value: null, unit: "%" }, recul_voie: { value: null, unit: "m" }, recul_limites: { value: null, unit: "m" }, stationnement: { value: null, unit: "pl/logt" }, pleine_terre: { value: null, unit: "%" }, cos: { value: null, unit: "" } };

function resolveRulesetSource(pluData: PluData | null): { rs: any; format: "resolved_v1" | "plu_ruleset_v2" | "legacy" } | null {
  // Priorité : ruleset déjà dans pluData (vient de Supabase)
  const rs = pluData?.ruleset;
  if (!rs) {
    // Fallback : localStorage (cache secondaire)
    try {
      const raw = localStorage.getItem("mimmoza.plu.resolved_ruleset_v1");
      if (raw) { const parsed = JSON.parse(raw); if (parsed?.version === "plu_ruleset_v1") return { rs: parsed, format: "resolved_v1" }; }
    } catch { /**/ }
    return null;
  }
  if (rs.version === "plu_ruleset_v1") return { rs, format: "resolved_v1" };
  const isPluV2 = rs.densite_emprise !== undefined || rs.hauteurs !== undefined || rs.implantation?.recul_min_rue_m !== undefined;
  if (isPluV2) return { rs, format: "plu_ruleset_v2" };
  return { rs, format: "legacy" };
}

function mapToFields(rs: any, format: "resolved_v1" | "plu_ruleset_v2" | "legacy"): FieldMap {
  if (format === "resolved_v1") return { hauteur_max: { value: rs.hauteur?.max_m ?? null, unit: "m", note: rs.hauteur?.note }, hauteur_faitage: { value: rs.hauteur?.faitage_m ?? null, unit: "m", note: rs.hauteur?.faitage_note }, ces_max: { value: ratioToPct(rs.ces?.max_ratio), unit: "%", note: rs.ces?.note ?? (rs.ces?.max_ratio == null ? "Pas de règle" : null) }, recul_voie: { value: rs.reculs?.voirie?.min_m ?? null, unit: "m", note: rs.reculs?.voirie?.note }, recul_limites: { value: rs.reculs?.limites_separatives?.min_m ?? null, unit: "m", note: rs.reculs?.limites_separatives?.note }, stationnement: { value: rs.stationnement?.par_logement ?? null, unit: "pl/logt", note: rs.stationnement?.note }, pleine_terre: { value: ratioToPct(rs.pleine_terre?.ratio_min), unit: "%", note: rs.pleine_terre?.note }, cos: { value: rs.cos?.max ?? null, unit: "", note: rs.cos?.note ?? (rs.cos?.max == null ? "Pas de COS" : null) } };
  if (format === "plu_ruleset_v2") { const egout = rs.hauteurs?.h_max_egout_m ?? rs.hauteur?.max_m ?? null; const faitage = rs.hauteurs?.h_max_faitage_m ?? rs.hauteur?.faitage_m ?? null; return { hauteur_max: { value: egout, unit: "m", note: rs.hauteurs?.h_max_egout_note ?? rs.hauteur?.note }, hauteur_faitage: { value: faitage, unit: "m", note: rs.hauteurs?.h_max_faitage_note }, ces_max: { value: ratioToPct(rs.densite_emprise?.emprise_max_ratio), unit: "%", note: rs.densite_emprise?.emprise_max_note }, recul_voie: { value: rs.implantation?.recul_min_rue_m ?? rs.reculs?.voirie?.min_m ?? null, unit: "m", note: rs.implantation?.recul_min_rue_note ?? rs.reculs?.voirie?.note }, recul_limites: { value: rs.implantation?.recul_min_limite_laterale_m ?? rs.reculs?.limites_separatives?.min_m ?? null, unit: "m", note: rs.implantation?.recul_min_limite_laterale_note }, stationnement: { value: rs.stationnement?.logement?.places_par_logement ?? rs.stationnement?.par_logement ?? null, unit: "pl/logt", note: rs.stationnement?.logement?.places_par_logement_note ?? rs.stationnement?.commentaires }, pleine_terre: { value: ratioToPct(rs.pleine_terre?.ratio_min), unit: "%", note: rs.pleine_terre?.ratio_min_note }, cos: { value: rs.densite_emprise?.cos_max ?? null, unit: "", note: rs.densite_emprise?.cos_note ?? (rs.densite_emprise?.cos_existe === false ? "Sans objet" : null) } }; }
  const cesRaw = rs.emprise_sol?.emprise_sol_max ?? rs.emprise_sol?.ces_max_ratio ?? rs.ces?.max_ratio ?? null;
  const ptRaw  = rs.pleine_terre?.min_pct ?? rs.pleine_terre?.ratio_min ?? null;
  return { hauteur_max: { value: rs.hauteur?.hauteur_max_m ?? rs.hauteur?.max_m ?? null, unit: "m", note: rs.hauteur?.note }, hauteur_faitage: { value: rs.hauteur?.hauteur_faitage_m ?? null, unit: "m" }, ces_max: { value: ratioToPct(cesRaw), unit: "%", note: rs.emprise_sol?.note }, recul_voie: { value: rs.reculs?.voirie?.min_m ?? null, unit: "m", note: rs.reculs?.voirie?.note }, recul_limites: { value: rs.reculs?.limites_separatives?.min_m ?? null, unit: "m", note: rs.reculs?.limites_separatives?.note }, stationnement: { value: rs.stationnement?.places_par_logement ?? null, unit: "pl/logt", note: rs.stationnement?.note }, pleine_terre: { value: ratioToPct(ptRaw), unit: "%", note: rs.pleine_terre?.note }, cos: { value: rs.densite?.cos_max ?? rs.cos?.max ?? null, unit: "", note: rs.densite?.note } };
}

function PluInfoCard({ pluData, loading }: { pluData: PluData | null; loading: boolean }) {
  const [showRaw, setShowRaw]     = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [fields, setFields]       = useState<FieldMap>(EMPTY_FIELDS);

  useEffect(() => {
    const source = resolveRulesetSource(pluData);
    if (!source) { setFields(EMPTY_FIELDS); return; }
    setFields(mapToFields(source.rs, source.format));
  }, [pluData]);

  if (loading) return (<div style={styles.card}><div style={styles.cardHeader}><h3 style={styles.cardTitle}><FileText size={18} color="#8b5cf6" />Règles PLU</h3></div><div style={{ ...styles.cardBody, display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}><Loader2 size={24} color={ACCENT_PRO} style={{ animation: "spin 1s linear infinite" }} /><span style={{ marginLeft: 12, color: "#64748b" }}>Chargement PLU...</span></div></div>);

  const source      = resolveRulesetSource(pluData);
  const zoneCode    = pluData?.zone_code    ?? (source?.format === "resolved_v1" ? source.rs.zone_code    : null);
  const zoneLibelle = pluData?.zone_libelle ?? (source?.format === "resolved_v1" ? source.rs.zone_libelle : null);
  const hasPlu      = !!(zoneCode || pluData?.found);
  const cfg: { key: keyof FieldMap; label: string }[] = [
    { key: "hauteur_max",     label: "HAUTEUR MAX (ÉGOUT)" },
    { key: "hauteur_faitage", label: "HAUTEUR FAÎTAGE" },
    { key: "ces_max",         label: "EMPRISE AU SOL (CES)" },
    { key: "recul_voie",      label: "RECUL VOIRIE" },
    { key: "recul_limites",   label: "RECUL LIMITES" },
    { key: "stationnement",   label: "STATIONNEMENT" },
    { key: "pleine_terre",    label: "PLEINE TERRE MIN" },
    { key: "cos",             label: "COS" },
  ];

  return (
    <div style={styles.card}>
      <div style={styles.cardHeader}>
        <h3 style={styles.cardTitle}><FileText size={18} color={ACCENT_PRO} />Règles PLU</h3>
        <div style={{ display: "flex", gap: 8 }}>
          {hasPlu && <button onClick={() => setIsEditing(!isEditing)} style={{ padding: "4px 10px", background: isEditing ? "#fef3c7" : "#f1f5f9", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 600, color: isEditing ? "#92400e" : "#64748b", cursor: "pointer" }}>{isEditing ? "✓ Terminer" : "✏️ Modifier"}</button>}
          {zoneCode ? <span style={{ ...styles.badge, background: "#ede9fe", color: ACCENT_PRO }}>Zone {zoneCode}</span> : <span style={{ ...styles.badge, background: "#fef3c7", color: "#92400e" }}>Non disponible</span>}
        </div>
      </div>
      <div style={styles.cardBody}>
        {hasPlu ? (<>
          <div style={{ padding: "12px 14px", background: "#f8fafc", borderRadius: 10, marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase" }}>Zone</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>{zoneCode ?? "—"}</div>
            <div style={{ fontSize: 13, color: "#475569", marginTop: 4 }}>{zoneLibelle || "Zone urbaine"}</div>
          </div>
          <div style={{ marginBottom: 14, padding: "10px 12px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, display: "flex", gap: 8, alignItems: "flex-start" }}>
            <AlertTriangle size={14} color="#d97706" style={{ marginTop: 1, flexShrink: 0 }} />
            <p style={{ fontSize: 11, color: "#92400e", margin: 0, lineHeight: 1.5 }}>Mimmoza peut faire des erreurs. Vérifiez les valeurs avec le document officiel.</p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
            {cfg.map(({ key, label }) => { const f = fields[key]; const hasVal = f.value !== null; return (<div key={key} style={{ padding: "12px 14px", background: "#f8fafc", borderRadius: 10, border: isEditing ? "1px solid #cbd5e1" : "1px solid #e2e8f0", display: "flex", flexDirection: "column", gap: 2 }}><div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>{isEditing ? (<div style={{ display: "flex", alignItems: "center", gap: 4 }}><input type="text" value={f.value ?? ""} onChange={e => { const v = e.target.value === "" ? null : parseFloat(e.target.value.replace(",", ".")); setFields(prev => ({ ...prev, [key]: { ...prev[key], value: v } })); }} placeholder="—" style={{ width: 60, padding: "4px 8px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 14, fontWeight: 700, textAlign: "center" }} /><span style={{ fontSize: 12, color: "#64748b" }}>{f.unit}</span></div>) : (<div style={{ fontSize: 18, fontWeight: 800, color: hasVal ? "#0f172a" : "#94a3b8" }}>{hasVal ? `${f.value}${f.unit ? " " + f.unit : ""}` : "—"}</div>)}{f.note && !isEditing && <div style={{ fontSize: 10, color: "#94a3b8", fontStyle: "italic", lineHeight: 1.4, marginTop: 2 }}>{f.note}</div>}</div>); })}
          </div>
          <button onClick={() => setShowRaw(!showRaw)} style={{ ...styles.button, width: "100%", marginTop: 14, background: "#f1f5f9", color: "#475569", padding: "8px 12px" }}>{showRaw ? <EyeOff size={14} /> : <Eye size={14} />}{showRaw ? "Masquer JSON" : "Voir JSON brut"}</button>
          {showRaw && <div style={{ marginTop: 12, padding: 12, background: "#0f172a", borderRadius: 8, maxHeight: 200, overflow: "auto" }}><pre style={{ margin: 0, fontSize: 11, color: "#e2e8f0", whiteSpace: "pre-wrap" }}>{JSON.stringify(source?.rs ?? pluData?.raw, null, 2)}</pre></div>}
        </>) : (<div style={{ textAlign: "center", padding: 20 }}><AlertTriangle size={32} color="#f59e0b" style={{ marginBottom: 12 }} /><p style={{ color: "#64748b", fontSize: 13, margin: 0 }}>PLU non disponible. Importez le règlement PDF.</p></div>)}
      </div>
    </div>
  );
}

// ─── ProjectSelector ──────────────────────────────────────────────────────────
function ProjectSelector({ projectInfo, onProjectChange, onSearch, loading }: {
  projectInfo: ProjectInfo; onProjectChange: (u: Partial<ProjectInfo>) => void;
  onSearch: (sp?: Partial<ProjectInfo>) => void; loading: boolean;
}) {
  const [parcelInput, setParcelInput]   = useState(projectInfo.parcelId || "");
  const [addressInput, setAddressInput] = useState(projectInfo.address || "");
  const [suggestions, setSuggestions]   = useState<AddressSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedAddress, setSelectedAddress] = useState<AddressSuggestion | null>(null);
  const [isLoadingSugg, setIsLoadingSugg] = useState(false);
  const addressRef = useRef<HTMLInputElement>(null);
  const suggRef    = useRef<HTMLDivElement>(null);
  const debRef     = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => { if (projectInfo.parcelId && projectInfo.parcelId !== parcelInput) setParcelInput(projectInfo.parcelId); }, [projectInfo.parcelId]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (suggRef.current && !suggRef.current.contains(e.target as Node) && addressRef.current && !addressRef.current.contains(e.target as Node)) setShowSuggestions(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, []);

  const fetchSuggestions = useCallback(async (q: string) => {
    if (q.length < 3) { setSuggestions([]); return; }
    setIsLoadingSugg(true);
    try {
      const r = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=6&autocomplete=1`);
      const d = await r.json();
      if (d.features) { setSuggestions(d.features.map((f: any) => ({ label: f.properties.label, citycode: f.properties.citycode, context: f.properties.context, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], id: f.properties.id }))); setShowSuggestions(true); }
    } catch { setSuggestions([]); } finally { setIsLoadingSugg(false); }
  }, []);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    let insee = extractCommuneInsee(parcelInput);
    if (!insee && selectedAddress?.citycode) insee = selectedAddress.citycode;
    const sp: Partial<ProjectInfo> = { parcelId: parcelInput || undefined, communeInsee: insee || undefined, address: addressInput || undefined, addressLat: selectedAddress?.lat, addressLon: selectedAddress?.lon };
    onProjectChange(sp); onSearch(sp);
  };

  return (
    <div style={{ ...styles.card, marginBottom: 20 }}>
      <div style={styles.cardHeader}><h3 style={styles.cardTitle}><MapPinned size={18} color={ACCENT_PRO} />Localisation du projet</h3></div>
      <form onSubmit={handleSubmit} style={styles.cardBody}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <label style={styles.inputLabel}>Identifiant de parcelle</label>
            <input type="text" value={parcelInput} onChange={e => setParcelInput(e.target.value.toUpperCase())} placeholder="ex: 64065000AI0001" style={styles.input} />
            <p style={{ fontSize: 11, color: "#94a3b8", margin: "4px 0 0" }}>Format: code INSEE + section + numéro</p>
          </div>
          <div style={{ position: "relative" }}>
            <label style={styles.inputLabel}>Adresse {selectedAddress && <span style={{ marginLeft: 8, color: "#16a34a", fontSize: 10, background: "#f0fdf4", padding: "2px 6px", borderRadius: 4 }}>✓</span>}</label>
            <div style={{ position: "relative" }}>
              <input ref={addressRef} type="text" value={addressInput} onChange={e => { setAddressInput(e.target.value); setSelectedAddress(null); if (debRef.current) clearTimeout(debRef.current); debRef.current = setTimeout(() => fetchSuggestions(e.target.value), 300); }} onFocus={() => suggestions.length > 0 && setShowSuggestions(true)} placeholder="Tapez une adresse..." style={{ ...styles.input, paddingRight: 36, borderColor: selectedAddress ? "#86efac" : "#e2e8f0" }} />
              <div style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)" }}>
                {isLoadingSugg ? <Loader2 size={16} color="#94a3b8" style={{ animation: "spin 1s linear infinite" }} /> : addressInput && <button type="button" onClick={() => { setAddressInput(""); setSelectedAddress(null); setSuggestions([]); }} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={14} color="#94a3b8" /></button>}
              </div>
            </div>
            {showSuggestions && suggestions.length > 0 && (
              <div ref={suggRef} style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "white", border: "1px solid #e2e8f0", borderRadius: 10, boxShadow: "0 10px 25px rgba(0,0,0,0.15)", zIndex: 1000, maxHeight: 280, overflow: "auto" }}>
                {suggestions.map((s, i) => (
                  <div key={s.id || i} onClick={() => { setAddressInput(s.label); setSelectedAddress(s); setShowSuggestions(false); setSuggestions([]); onProjectChange({ address: s.label, communeInsee: s.citycode, addressLat: s.lat, addressLon: s.lon }); }} style={{ padding: "12px 14px", cursor: "pointer", borderBottom: i < suggestions.length - 1 ? "1px solid #f1f5f9" : "none" }} onMouseEnter={e => { e.currentTarget.style.background = "#f8fafc"; }} onMouseLeave={e => { e.currentTarget.style.background = "white"; }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#0f172a", display: "flex", alignItems: "center", gap: 8 }}><MapPin size={14} color={ACCENT_PRO} />{s.label}</div>
                    {s.context && <div style={{ fontSize: 11, color: "#64748b", marginTop: 2, marginLeft: 22 }}>{s.context}{s.citycode && <span style={{ marginLeft: 8, background: "#ede9fe", color: ACCENT_PRO, padding: "1px 6px", borderRadius: 4, fontSize: 10, fontWeight: 600 }}>INSEE {s.citycode}</span>}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        {!parcelInput && !selectedAddress && (
          <div style={{ marginTop: 12, padding: "10px 14px", background: "#ede9fe", border: "1px solid #c4b5fd", borderRadius: 8, display: "flex", alignItems: "center", gap: 10 }}>
            <Info size={16} color={ACCENT_PRO} /><p style={{ fontSize: 12, color: ACCENT_PRO, margin: 0 }}>Renseignez l'identifiant de parcelle <strong>ou</strong> sélectionnez une adresse.</p>
          </div>
        )}
        <button type="submit" disabled={loading || (!parcelInput && !selectedAddress)} style={{ ...styles.button, marginTop: 16, background: loading || (!parcelInput && !selectedAddress) ? "#e2e8f0" : "#0f172a", color: loading || (!parcelInput && !selectedAddress) ? "#94a3b8" : "white", cursor: loading || (!parcelInput && !selectedAddress) ? "not-allowed" : "pointer" }}>
          {loading ? <><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />Recherche...</> : <><Search size={16} />Rechercher la parcelle</>}
        </button>
      </form>
    </div>
  );
}

// ─── ParcelsSidebar ───────────────────────────────────────────────────────────
function ParcelsSidebar({ selectedParcels, totalAreaM2, onRemoveParcel, onClearAll, onValidateSelection, onAddManualParcel, onUpdateParcelArea, isValid, validationMessage, isValidated, isSaving }: {
  selectedParcels: SelectedParcel[]; totalAreaM2: number | null;
  onRemoveParcel: (id: string) => void; onClearAll: () => void; onValidateSelection: () => void;
  onAddManualParcel: (id: string, area_m2: number | null) => void;
  onUpdateParcelArea: (id: string, area_m2: number) => void;
  isValid: boolean; validationMessage?: string | null; isValidated: boolean; isSaving: boolean;
}) {
  const [manualId, setManualId]     = useState("");
  const [manualArea, setManualArea] = useState("");
  const idRef = useRef<HTMLInputElement>(null);

  const handleAdd = () => {
    const id = manualId.trim().toUpperCase();
    if (!id) return;
    const area = manualArea ? parseFloat(manualArea.replace(",", ".")) : null;
    onAddManualParcel(id, area && !isNaN(area) ? Math.round(area) : null);
    setManualId(""); setManualArea(""); idRef.current?.focus();
  };

  return (
    <div style={styles.card}>
      <div style={styles.cardHeader}>
        <h3 style={styles.cardTitle}><Layers size={18} color={ACCENT_PRO} />Parcelles ({selectedParcels.length})</h3>
        {selectedParcels.length > 0 && <button onClick={onClearAll} style={{ padding: "4px 8px", background: "#fef2f2", border: "none", borderRadius: 6, color: "#dc2626", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Tout effacer</button>}
      </div>
      <div style={{ padding: "14px 18px", borderBottom: "1px solid #e2e8f0", background: "#f8fafc" }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#475569", marginBottom: 8, textTransform: "uppercase" }}>Ajouter une parcelle</div>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1 }}><input ref={idRef} type="text" value={manualId} onChange={e => setManualId(e.target.value.toUpperCase())} onKeyDown={e => e.key === "Enter" && (e.preventDefault(), handleAdd())} placeholder="N° parcelle" style={{ ...styles.input, fontSize: 12, padding: "8px 10px" }} /></div>
          <div style={{ width: 90 }}><input type="text" value={manualArea} onChange={e => setManualArea(e.target.value)} onKeyDown={e => e.key === "Enter" && (e.preventDefault(), handleAdd())} placeholder="m²" style={{ ...styles.input, fontSize: 12, padding: "8px 10px", textAlign: "right" }} /></div>
          <button onClick={handleAdd} disabled={!manualId.trim()} style={{ ...styles.button, padding: "8px 12px", background: manualId.trim() ? ACCENT_PRO : "#e2e8f0", color: manualId.trim() ? "white" : "#94a3b8", cursor: manualId.trim() ? "pointer" : "not-allowed", fontSize: 16, fontWeight: 700, minWidth: 38 }}>+</button>
        </div>
        <p style={{ fontSize: 10, color: "#94a3b8", margin: "4px 0 0" }}>Ex: 64065000AI0001 — la surface est récupérée automatiquement</p>
      </div>
      <div style={{ ...styles.cardBody, maxHeight: 300, overflow: "auto", padding: "12px 18px" }}>
        {selectedParcels.length === 0
          ? (<div style={{ textAlign: "center", padding: 20, color: "#94a3b8", fontSize: 13 }}><Layers size={24} style={{ marginBottom: 8, opacity: 0.5 }} /><p style={{ margin: 0 }}>Aucune parcelle</p><p style={{ margin: "4px 0 0", fontSize: 12 }}>Cliquez sur la carte ou ajoutez manuellement</p></div>)
          : (<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {selectedParcels.map(p => (
                <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", background: isValidated ? "#f0fdf4" : "#f8fafc", borderRadius: 8, border: `1px solid ${isValidated ? "#bbf7d0" : "#e2e8f0"}` }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#0f172a", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.id}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                      <input type="text" value={p.area_m2 != null ? String(p.area_m2) : ""} onChange={e => { const v = parseFloat(e.target.value.replace(",", ".")); if (!isNaN(v) && v > 0) onUpdateParcelArea(p.id, Math.round(v)); }} placeholder="—" style={{ width: 70, padding: "2px 6px", border: "1px solid #e2e8f0", borderRadius: 4, fontSize: 11, fontWeight: 600, color: "#475569", textAlign: "right", background: "white", outline: "none" }} />
                      <span style={{ fontSize: 10, color: "#94a3b8" }}>m²</span>
                    </div>
                  </div>
                  <button onClick={() => onRemoveParcel(p.id)} style={{ padding: "4px 6px", background: "white", border: "1px solid #fecaca", borderRadius: 4, color: "#dc2626", cursor: "pointer", display: "flex", alignItems: "center", marginLeft: 8 }}><X size={12} /></button>
                </div>
              ))}
            </div>)}
      </div>
      {selectedParcels.length > 0 && (
        <div style={{ padding: "14px 18px", borderTop: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#334155" }}>Surface totale</span>
          <span style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", background: "#ede9fe", padding: "6px 14px", borderRadius: 8 }}>
            {totalAreaM2 != null ? formatAreaM2(totalAreaM2) : <span style={{ color: "#94a3b8", fontSize: 13 }}>Renseignez les m²</span>}
          </span>
        </div>
      )}
      <div style={{ padding: "0 18px 18px" }}>
        <button onClick={onValidateSelection} disabled={!isValid || isSaving} style={{ ...styles.button, width: "100%", background: isSaving ? "#a78bfa" : isValidated ? "#16a34a" : isValid ? ACCENT_PRO : "#e2e8f0", color: isValid ? "white" : "#94a3b8", cursor: isValid && !isSaving ? "pointer" : "not-allowed" }}>
          {isSaving ? <><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />Enregistrement…</> : isValidated ? <><Check size={16} />Sélection validée</> : <><Check size={16} />Valider la sélection</>}
        </button>
        {validationMessage && (
          <div style={{ marginTop: 10, padding: "8px 12px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, display: "flex", alignItems: "center", gap: 8 }}>
            <Check size={14} color="#16a34a" /><span style={{ fontSize: 12, color: "#166534", fontWeight: 500 }}>{validationMessage}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════════
export function FoncierPluPage() {
  const [searchParams] = useSearchParams();
  const studyId = searchParams.get("study");

  // ── Source de vérité unique ────────────────────────────────────────────────
  const { study, loadState, patchFoncier, patchPlu } = usePromoteurStudy(studyId);

  // ── State local UI ────────────────────────────────────────────────────────
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving]                   = useState(false);
  const [mapCenter, setMapCenter]                 = useState<[number, number] | null>(null);
  const [projectInfo, setProjectInfo]             = useState<ProjectInfo>({});
  const [selectedParcels, setSelectedParcels]     = useState<SelectedParcel[]>([]);
  const [pluData, setPluData]                     = useState<PluData | null>(null);
  const [pluLoading, setPluLoading]               = useState(false);
  const [searchLoading, setSearchLoading]         = useState(false);
  const [isValidated, setIsValidated]             = useState(false);
  const [searchDone, setSearchDone]               = useState(false);

  // Guard unmount
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── Hydratation depuis Supabase (lecture JSONB) ────────────────────────────
  useEffect(() => {
    if (loadState !== "ready" || !study) return;

    const f = study.foncier;   // PromoteurFoncierData | null
    const p = study.plu;       // PromoteurPluData | null

    // ── Foncier ──────────────────────────────────────────────────────────────
    if (f?.commune_insee) {
      // Priorité : parcels_raw (avec géométries), fallback : parcel_ids seuls
      const parcels: SelectedParcel[] = (f.parcels_raw ?? []).length > 0
        ? f.parcels_raw.map(r => ({
            id:      r.id,
            area_m2: r.area_m2 ?? null,
            feature: r.feature ?? undefined,
          }))
        : (f.parcel_ids ?? []).map(id => ({
            id,
            area_m2: (f.parcel_ids ?? []).length === 1 ? f.surface_m2 : null,
          }));

      if (parcels.length > 0) {
        setSelectedParcels(parcels);
        setProjectInfo({
          parcelId:     f.focus_id || parcels[0]?.id,
          parcelIds:    f.parcel_ids,
          communeInsee: f.commune_insee,
          surfaceM2:    f.surface_m2 ?? undefined,
        });
        setIsValidated(f.done);
        setSearchDone(true);

        // Cache session secondaire (pages aval non encore migrées)
        const focusId = f.focus_id || parcels[0]?.id;
        if (focusId) localStorage.setItem("mimmoza.session.parcel_id", focusId);
        localStorage.setItem("mimmoza.session.parcel_ids",    JSON.stringify(f.parcel_ids ?? []));
        localStorage.setItem("mimmoza.session.commune_insee", f.commune_insee);
        if (f.surface_m2) localStorage.setItem("mimmoza.session.surface_m2", String(f.surface_m2));

        // Compat store éphémère (à retirer quand toutes les pages migrées)
        patchModule("foncier", {
          parcelId:     focusId,
          parcelIds:    f.parcel_ids,
          communeInsee: f.commune_insee,
          surfaceM2:    f.surface_m2,
        });

        // Centrer la carte
        const firstParcel = parcels[0];
if (firstParcel?.feature) {
  // Priorité : centrer sur la géométrie de la parcelle stockée
  const bc = getFeatureBoundsCenter(firstParcel.feature);
  if (bc) {
    setMapCenter(bc.center);
  } else {
    geocodeCommuneCenter(f.commune_insee).then(center => {
      if (center && mountedRef.current) setMapCenter(center);
    });
  }
} else {
  // Fallback : centre de la commune
  geocodeCommuneCenter(f.commune_insee).then(center => {
    if (center && mountedRef.current) setMapCenter(center);
  });
}
      }
    }

    // ── PLU ──────────────────────────────────────────────────────────────────
    if (p?.ruleset) {
      setPluData({
        zone_code:    p.zone_code    ?? undefined,
        zone_libelle: p.zone_libelle ?? undefined,
        ruleset:      p.ruleset,
        found:        true,
      });
      // Cache secondaire localStorage
      localStorage.setItem("mimmoza.plu.resolved_ruleset_v1", JSON.stringify(p.ruleset));
    }
  }, [loadState, study]);

  // ── Dérivés ───────────────────────────────────────────────────────────────
  const hasProject = !!(projectInfo.communeInsee && (selectedParcels.length > 0 || searchDone));

  const totalAreaM2 = useMemo(() => {
    const a = selectedParcels.map(p => p.area_m2).filter((v): v is number => typeof v === "number");
    return a.length > 0 ? a.reduce((s, v) => s + v, 0) : null;
  }, [selectedParcels]);

  const parcelMapSelectedParcels = useMemo(() =>
    selectedParcels.map(p => ({ id: p.id, feature: p.feature, area_m2: p.area_m2 })),
    [selectedParcels]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const fetchPlu = useCallback(async () => {
    if (!projectInfo.parcelId || !projectInfo.communeInsee) return;
    setPluLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("plu-from-parcelle-v2", { body: { parcel_id: projectInfo.parcelId, commune_insee: projectInfo.communeInsee } });
      if (error) throw error;
      setPluData({ zone_code: data?.plu?.zone_code || data?.zone_code, zone_libelle: data?.plu?.zone_libelle || data?.zone_libelle, ruleset: data?.plu?.ruleset || data?.ruleset, raw: data, found: data?.plu?.found ?? data?.success ?? false });
    } catch { setPluData({ found: false }); }
    finally { setPluLoading(false); }
  }, [projectInfo.parcelId, projectInfo.communeInsee]);

  const fetchParcelAndCenter = useCallback(async (parcelId: string, communeInsee: string) => {
    try {
      const { data, error } = await supabase.functions.invoke("cadastre-parcelle-by-id", { body: { parcel_id: parcelId, commune_insee: communeInsee } });
      if (error || !data?.feature?.geometry) return null;
      const bc = getFeatureBoundsCenter(data.feature);
      return bc ? { feature: data.feature, center: bc.center } : null;
    } catch { return null; }
  }, []);

  const handleSearch = useCallback(async (sp?: Partial<ProjectInfo>) => {
    const params = sp ? { ...projectInfo, ...sp } : projectInfo;
    if (!params.parcelId && !params.addressLat) return;
    setSearchLoading(true);
    if (params.parcelId && params.communeInsee) {
      const pd = await fetchParcelAndCenter(params.parcelId, params.communeInsee);
      if (pd?.center) {
        const area = getFeatureArea(pd.feature);
        setSelectedParcels(prev => prev.some(p => p.id === params.parcelId) ? prev : [...prev, { id: params.parcelId!, feature: pd.feature, area_m2: area }]);
        setMapCenter(pd.center);
      } else {
        setSelectedParcels(prev => prev.some(p => p.id === params.parcelId) ? prev : [...prev, { id: params.parcelId! }]);
        const fallback = await geocodeCommuneCenter(params.communeInsee);
        if (fallback) setMapCenter(fallback);
      }
      if (sp) setProjectInfo(prev => ({ ...prev, ...sp }));
      await fetchPlu();
    } else if (params.addressLat && params.addressLon && params.communeInsee) {
      setMapCenter([params.addressLat, params.addressLon]);
      if (sp) setProjectInfo(prev => ({ ...prev, ...sp }));
    }
    setSearchDone(true);
    setSearchLoading(false);
  }, [projectInfo, fetchPlu, fetchParcelAndCenter]);

  const handleToggleParcel = useCallback((pid: string, feature?: any, area_m2?: number | null) => {
    setSelectedParcels(prev => prev.some(p => p.id === pid) ? prev.filter(p => p.id !== pid) : [...prev, { id: pid, feature, area_m2: area_m2 || feature?.properties?.contenance || null }]);
    setIsValidated(false);
  }, []);

  const handleRemoveParcel  = useCallback((pid: string) => { setSelectedParcels(prev => prev.filter(p => p.id !== pid)); setIsValidated(false); }, []);
  const handleClearAll      = useCallback(() => { setSelectedParcels([]); setIsValidated(false); }, []);

  const handleAddManualParcel = useCallback((id: string, area_m2: number | null) => {
    setSelectedParcels(prev => prev.some(p => p.id === id) ? prev : [...prev, { id, area_m2 }]);
    setIsValidated(false);
    if (area_m2 == null || area_m2 === 0) {
      const insee = extractCommuneInsee(id);
      if (insee && id.length >= 10) {
        const after = id.slice(5);
        const m = after.match(/(?:\d{0,3})([A-Z]{1,2})(\d{1,4})$/);
        if (m) {
          fetch(`https://apicarto.ign.fr/api/cadastre/parcelle?code_insee=${insee}&section=${m[1]}&numero=${m[2].padStart(4, "0")}&_limit=1`)
            .then(r => r.ok ? r.json() : null)
            .then(data => {
              const feat = data?.features?.[0];
              if (feat) { const calcArea = feat.properties?.contenance || calculatePolygonArea(feat.geometry); if (calcArea && calcArea > 0) setSelectedParcels(prev => prev.map(p => p.id === id && (p.area_m2 == null || p.area_m2 === 0) ? { ...p, area_m2: Math.round(calcArea), feature: feat } : p)); }
            }).catch(() => { /**/ });
        }
      }
    }
  }, []);

  const handleUpdateParcelArea = useCallback((id: string, area_m2: number) => {
    setSelectedParcels(prev => prev.map(p => p.id === id ? { ...p, area_m2 } : p));
    setIsValidated(false);
  }, []);

  // ── Validation + persistance Supabase ─────────────────────────────────────
  const handleValidateSelection = useCallback(async () => {
    if (selectedParcels.length === 0 || !studyId) return;
    setIsSaving(true);

    const parcelIds = selectedParcels.map(p => p.id);
    const primary   = selectedParcels[0];
    const insee     = extractCommuneInsee(primary.id) ?? projectInfo.communeInsee ?? "";

    const foncierPayload: PromoteurFoncierData = {
      parcel_ids:    parcelIds,
      focus_id:      primary.id,
      commune_insee: insee,
      surface_m2:    totalAreaM2,
      parcels_raw:   selectedParcels.map(p => ({
        id:      p.id,
        area_m2: p.area_m2 ?? null,
        feature: p.feature
          ? (JSON.stringify(p.feature).length < 50_000 ? p.feature : null)
          : null,
      } satisfies PromoteurParcelRaw)),
      done: true,
    };

    // patchFoncier met à jour study dans le hook ET écrit dans Supabase
    const result = await patchFoncier(foncierPayload);

    setIsSaving(false);

    if (!result.ok) {
      console.error("[FoncierPluPage] Supabase save failed:", result.error);
      // Fallback localStorage uniquement en cas d'échec réseau
      localStorage.setItem(
        `mimmoza.promoteur.foncier.${studyId}.fallback_v2`,
        JSON.stringify(foncierPayload)
      );
    }

    // Sync state local + cache session secondaire
    setProjectInfo(prev => ({ ...prev, parcelId: primary.id, parcelIds, communeInsee: insee, surfaceM2: totalAreaM2 || undefined }));
    patchModule("foncier", { parcelId: primary.id, parcelIds, communeInsee: insee, surfaceM2: totalAreaM2 });
    localStorage.setItem("mimmoza.session.parcel_id",     primary.id);
    localStorage.setItem("mimmoza.session.parcel_ids",    JSON.stringify(parcelIds));
    if (insee)       localStorage.setItem("mimmoza.session.commune_insee", insee);
    if (totalAreaM2) localStorage.setItem("mimmoza.session.surface_m2",    String(totalAreaM2));
    ["mimmoza.plu.ai_extract_result", "mimmoza.plu.detected_zone_code", "mimmoza.plu.selected_zone_code",
     "mimmoza.plu.selected_document_id", "mimmoza.plu.selected_commune_insee"].forEach(k => localStorage.removeItem(k));

    setValidationMessage(`✓ ${parcelIds.length} parcelle${parcelIds.length > 1 ? "s" : ""} enregistrée${parcelIds.length > 1 ? "s" : ""} (${formatAreaM2(totalAreaM2)})`);
    setIsValidated(true);
    setTimeout(() => setValidationMessage(null), 5000);
  }, [selectedParcels, totalAreaM2, studyId, projectInfo.communeInsee, patchFoncier]);

  const handleReset = useCallback(() => {
    setProjectInfo({}); setSelectedParcels([]); setPluData(null);
    setMapCenter(null); setIsValidated(false); setSearchDone(false);
    patchModule("plu", null); patchModule("foncier", null);
    ["mimmoza.session.parcel_id", "mimmoza.session.commune_insee", "mimmoza.session.parcel_ids",
     "mimmoza.session.surface_m2", "mimmoza.plu.resolved_ruleset_v1", "mimmoza.plu.ai_extract_result",
     "mimmoza.plu.detected_zone_code", "mimmoza.plu.selected_zone_code", "mimmoza.plu.selected_document_id",
     "mimmoza.plu.selected_commune_insee"].forEach(k => localStorage.removeItem(k));
  }, []);

  const handlePluParsed = useCallback(async (plu: PluData) => {
    const resolved = legacyRulesetToResolved(plu);

    const pluPayload: PromoteurPluData = {
      zone_code:    plu.zone_code    ?? null,
      zone_libelle: plu.zone_libelle ?? null,
      ruleset:      resolved ?? (plu.ruleset ?? null),
      source:       "upload",
      done:         true,
    };

    if (studyId) {
      await patchPlu(pluPayload); // hook gère setStudy
    }

    if (resolved) {
      localStorage.setItem("mimmoza.plu.resolved_ruleset_v1", JSON.stringify(resolved));
      patchModule("plu", resolved); // compat store
    } else {
      localStorage.removeItem("mimmoza.plu.resolved_ruleset_v1");
      patchModule("plu", null);
    }
    localStorage.removeItem("mimmoza.plu.ai_extract_result");
    setPluData(plu);
  }, [studyId, patchPlu]);

  // ── Loading / Error ───────────────────────────────────────────────────────
  if (loadState === "loading") {
    return (
      <div style={{ ...styles.container, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 300 }}>
        <Loader2 size={32} color={ACCENT_PRO} style={{ animation: "spin 1s linear infinite" }} />
        <span style={{ marginLeft: 16, fontSize: 15, color: "#64748b" }}>Chargement de l'étude…</span>
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div style={{ ...styles.container, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 300 }}>
        <AlertTriangle size={40} color="#f59e0b" />
        <p style={{ color: "#64748b", marginTop: 16, fontSize: 14 }}>
          Impossible de charger l'étude {studyId ? `(${studyId.slice(0, 8)}…)` : ""}.
        </p>
        <button onClick={() => window.location.reload()} style={{ ...styles.button, marginTop: 12, background: ACCENT_PRO, color: "white" }}>
          Réessayer
        </button>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={styles.container}>
      {/* Banner */}
      <div style={{ background: GRAD_PRO, borderRadius: 14, padding: "20px 24px", marginBottom: 20, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", marginBottom: 6 }}>Promoteur › Foncier</div>
          <div style={{ fontSize: 22, fontWeight: 600, color: "white", marginBottom: 4 }}>Foncier & PLU</div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.75)" }}>Sélectionnez votre terrain et consultez les règles d'urbanisme.</div>
        </div>
        {studyId && (
          <div style={{ padding: "6px 12px", borderRadius: 8, background: "rgba(255,255,255,0.15)", color: "white", fontSize: 11, fontWeight: 500, flexShrink: 0, marginTop: 4, border: "1px solid rgba(255,255,255,0.25)" }}>
            Étude&nbsp;{studyId.slice(0, 8)}…
          </div>
        )}
      </div>

      {/* Projet actif ou formulaire */}
      {hasProject ? (
        <div style={{ ...styles.card, marginBottom: 20, padding: "12px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <MapPinned size={20} color={ACCENT_PRO} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", fontFamily: "monospace" }}>{projectInfo.parcelId || projectInfo.address || "—"}</div>
              <div style={{ fontSize: 12, color: "#64748b" }}>INSEE {projectInfo.communeInsee} • {formatAreaM2(totalAreaM2)}</div>
            </div>
          </div>
          <button onClick={handleReset} style={{ ...styles.button, padding: "8px 14px", background: "#f1f5f9", color: "#475569" }}><RefreshCw size={14} />Changer</button>
        </div>
      ) : (
        <ProjectSelector projectInfo={projectInfo} onProjectChange={u => setProjectInfo(p => ({ ...p, ...u }))} onSearch={handleSearch} loading={searchLoading} />
      )}

      {hasProject ? (
        <div style={styles.grid}>
          {/* Colonne gauche */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={styles.card}>
              <div style={styles.cardHeader}>
                <h3 style={styles.cardTitle}><MapPin size={18} color={ACCENT_PRO} />Carte cadastrale</h3>
                <span style={{ ...styles.badge, background: "#ede9fe", color: ACCENT_PRO }}>INSEE {projectInfo.communeInsee}</span>
              </div>
              <CadastreMap
                communeInsee={projectInfo.communeInsee!}
                center={mapCenter ?? [46.603354, 1.888334]}
                selectedIds={selectedParcels.map(p => p.id)}
                selectedParcels={parcelMapSelectedParcels}
                onToggleParcel={handleToggleParcel}
                heightPx={400}
              />
            </div>
            <PluInfoCard pluData={pluData} loading={pluLoading} />
            {projectInfo.communeInsee && (
              <PluUploaderPanel
                communeInsee={projectInfo.communeInsee}
                communeNom={projectInfo.address}
                targetZoneCode={pluData?.zone_code}
                onPluParsed={handlePluParsed}
              />
            )}
          </div>

          {/* Colonne droite */}
          <div>
            <ParcelsSidebar
              selectedParcels={selectedParcels}
              totalAreaM2={totalAreaM2}
              onRemoveParcel={handleRemoveParcel}
              onClearAll={handleClearAll}
              onValidateSelection={handleValidateSelection}
              onAddManualParcel={handleAddManualParcel}
              onUpdateParcelArea={handleUpdateParcelArea}
              isValid={selectedParcels.length > 0}
              validationMessage={validationMessage}
              isValidated={isValidated}
              isSaving={isSaving}
            />
            <div style={{ ...styles.card, marginTop: 20 }}>
              <div style={styles.cardHeader}><h3 style={styles.cardTitle}><Navigation size={18} color="#10b981" />Étapes suivantes</h3></div>
              <div style={styles.cardBody}>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <a href={`/promoteur/implantation-2d${studyId ? `?study=${studyId}` : ""}`} style={{ ...styles.button, background: "#f1f5f9", color: "#475569", textDecoration: "none" }}><Layers size={16} />Implantation 2D</a>
                  <a href={`/promoteur/marche${studyId ? `?study=${studyId}` : ""}`} style={{ ...styles.button, background: "#f1f5f9", color: "#475569", textDecoration: "none" }}><Building2 size={16} />Étude de marché</a>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ ...styles.card, padding: "60px 40px", textAlign: "center" }}>
          <div style={{ width: 80, height: 80, borderRadius: "50%", background: "#ede9fe", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px" }}>
            <MapPin size={36} color={ACCENT_PRO} />
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: "#0f172a", margin: "0 0 12px" }}>Commencez par localiser votre projet</h2>
          <p style={{ fontSize: 14, color: "#64748b", margin: "0 0 24px", maxWidth: 400, marginLeft: "auto", marginRight: "auto" }}>
            Entrez l'identifiant de la parcelle cadastrale ou recherchez par adresse.
          </p>
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .leaflet-container { font-family: inherit; }
        .leaflet-tooltip.parcel-tooltip { background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
        .leaflet-tooltip.parcel-tooltip::before { display: none; }
      `}</style>
    </div>
  );
}

export default FoncierPluPage;