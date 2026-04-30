// TerrassementPanel.tsx
// Estimation du coût de terrassement pour mise en plateforme sur terrain en pente.
// V3 : export scopé par studyId (lecture via useSearchParams) — plus de fuite entre projets.

import React, { type FC, useMemo, useState, useCallback, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import type { Feature, Polygon, MultiPolygon } from "geojson";
import type { MassingBuildingModel } from "../massingScene.types";
import type { ReliefData } from "./SceneSvg3D";
import { computeSceneProjection, getBuildingScenePts } from "../massingGeometry";
import { TerrainSampler } from "../services/terrainSampler";

const ACCENT = "#5247b8";

// ─── Prix unitaires ───────────────────────────────────────────────────────────

const PRICES_KEY  = "mimmoza.terrassement.prices";

// ─── Clé EXPORT scopée par studyId ────────────────────────────────────────────
// BilanPromoteurPage attend `mimmoza.terrassement.export.${studyId}`.
// Hors contexte d'étude (studyId null), on utilise la clé legacy globale.
function exportKey(studyId: string | null): string {
  return studyId ? `mimmoza.terrassement.export.${studyId}` : "mimmoza.terrassement.export";
}

export interface TerrassementPrices {
  terrassement_m2: number;
  soubassement_m3: number;
  remblai_m3:      number;
  surcoef_forte:   number;
}

export const DEFAULT_PRICES: TerrassementPrices = {
  terrassement_m2: 20,
  soubassement_m3: 195,
  remblai_m3:      38,
  surcoef_forte:   1.30,
};

function loadPrices(): TerrassementPrices {
  try {
    const raw = localStorage.getItem(PRICES_KEY);
    if (raw) return { ...DEFAULT_PRICES, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_PRICES };
}

function savePrices(p: TerrassementPrices): void {
  try { localStorage.setItem(PRICES_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

// ─── Export Bilan ─────────────────────────────────────────────────────────────

export interface TerrassementExport {
  totalFootprintM2:      number;
  totalVolSoubM3:        number;
  totalVolRemblaiM3:     number;
  totalCoutTerrassement: number;
  totalCoutSoubassement: number;
  totalCout:             number;
  slopeWarning:          "none" | "modere" | "fort";
  maxSlopeDeg:           number;
  maxDeltaM:             number;
  prices:                TerrassementPrices;
  updatedAt:             string;
}

// ─── Calcul ───────────────────────────────────────────────────────────────────

interface BldMetrics {
  id:               string;
  name:             string;
  footprintM2:      number;
  deltaNivelee:     number;
  slopeAvgDeg:      number;
  volSoubM3:        number;
  volRemblaiM3:     number;
  coutTerrassement: number;
  coutSoubassement: number;
  coutTotal:        number;
  warning:          "none" | "modere" | "fort";
}

function computeMetrics(
  buildings:  MassingBuildingModel[],
  parcel:     Feature<Polygon | MultiPolygon> | undefined,
  reliefData: ReliefData,
  prices:     TerrassementPrices,
): BldMetrics[] {
  const allPts: [number, number][] = [];
  if (parcel) {
    const ring = parcel.geometry.type === "Polygon"
      ? parcel.geometry.coordinates[0]
      : parcel.geometry.coordinates[0]?.[0];
    if (ring) allPts.push(...ring as [number, number][]);
  }
  if (reliefData.bbox) {
    const [x0, y0, x1, y1] = reliefData.bbox;
    allPts.push([x0, y0], [x1, y1], [x0, y1], [x1, y0]);
  }
  for (const b of buildings) allPts.push(...b.footprint.points as [number, number][]);
  if (allPts.length < 2) return [];

  const proj    = computeSceneProjection(allPts);
  const sampler = new TerrainSampler(reliefData, proj);

  return buildings
    .filter(b => b.visible !== false)
    .map(bld => {
      const scenePts = getBuildingScenePts(bld, proj);
      if (!scenePts || scenePts.length < 3) return null;

      const samplePts = scenePts.map((p: [number, number]) => ({ x: p[0], z: p[1] }));
      const heights   = samplePts.map(p => sampler.getHeight(p.x, p.z));
      const maxH      = Math.max(...heights);
      const minH      = Math.min(...heights);
      const deltaNivelee = maxH - minH;

      const rawPts = bld.footprint.points as [number, number][];
      let geoArea = 0;
      for (let i = 0; i < rawPts.length; i++) {
        const j = (i + 1) % rawPts.length;
        geoArea += rawPts[i][0] * rawPts[j][1] - rawPts[j][0] * rawPts[i][1];
      }
      geoArea = Math.abs(geoArea / 2);
      const avgLat      = rawPts.reduce((s, p) => s + p[1], 0) / rawPts.length;
      const footprintM2 = geoArea * 111000 * 111000 * Math.cos(avgLat * Math.PI / 180);
      if (footprintM2 < 1) return null;

      const footprintDiag = Math.sqrt(footprintM2);
      const slopeAvgDeg   = (Math.atan(deltaNivelee / Math.max(footprintDiag, 1)) * 180) / Math.PI;

      const platformY    = maxH;
      const avgGap       = heights.reduce((s, h) => s + Math.max(0, platformY - h), 0) / heights.length;
      const volSoubM3    = avgGap * footprintM2;
      const volRemblaiM3 = volSoubM3 * 0.30;

      const isForte  = slopeAvgDeg > 25;
      const isModere = slopeAvgDeg > 12 && !isForte;
      const surcoef  = isForte ? prices.surcoef_forte : 1;

      const coutTerrassement = footprintM2 * prices.terrassement_m2 * surcoef;
      const coutSoubassement = (volSoubM3 * prices.soubassement_m3 + volRemblaiM3 * prices.remblai_m3) * surcoef;

      return {
        id:               bld.id,
        name:             bld.name,
        footprintM2:      Math.round(footprintM2),
        deltaNivelee:     Math.round(deltaNivelee * 10) / 10,
        slopeAvgDeg:      Math.round(slopeAvgDeg * 10) / 10,
        volSoubM3:        Math.round(volSoubM3),
        volRemblaiM3:     Math.round(volRemblaiM3),
        coutTerrassement: Math.round(coutTerrassement / 100) * 100,
        coutSoubassement: Math.round(coutSoubassement / 100) * 100,
        coutTotal:        Math.round((coutTerrassement + coutSoubassement) / 100) * 100,
        warning:          isForte ? "fort" : isModere ? "modere" : "none",
      } satisfies BldMetrics;
    })
    .filter((m): m is BldMetrics => m !== null);
}

// ─── Micro-composants ─────────────────────────────────────────────────────────

const SLabel: FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 5, marginTop: 10 }}>
    {children}
  </div>
);

const KV: FC<{ label: string; value: string; bold?: boolean }> = ({ label, value, bold }) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
    <span style={{ fontSize: 11, color: "#64748b" }}>{label}</span>
    <span style={{ fontSize: 11, fontWeight: bold ? 700 : 500, color: "#0f172a" }}>{value}</span>
  </div>
);

const Divider = () => <div style={{ borderTop: "1px solid #f1f5f9", margin: "8px 0" }} />;

const PriceInput: FC<{
  label: string; value: number; unit: string;
  min?: number; max?: number; step?: number;
  onChange: (v: number) => void;
}> = ({ label, value, unit, min = 0, max = 9999, step = 1, onChange }) => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, marginBottom: 6 }}>
    <span style={{ fontSize: 10, color: "#475569", flex: 1, lineHeight: 1.3 }}>{label}</span>
    <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
      <input
        type="number" value={value} min={min} max={max} step={step}
        onChange={e => { const v = parseFloat(e.target.value); if (Number.isFinite(v) && v >= min) onChange(v); }}
        style={{ width: 60, padding: "3px 6px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 11, fontVariantNumeric: "tabular-nums", textAlign: "right", color: "#0f172a" }}
      />
      <span style={{ fontSize: 10, color: "#94a3b8", minWidth: 26, textAlign: "left" }}>{unit}</span>
    </div>
  </div>
);

const fmtEur = (v: number) => v.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " €";
const fmtM3  = (v: number) => v.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " m³";

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  buildings:        MassingBuildingModel[];
  parcel?:          Feature<Polygon | MultiPolygon>;
  reliefData:       ReliefData | null;
  selectedId:       string | null;
  onMetricsChange?: (data: TerrassementExport) => void;
}

// ─── Composant ───────────────────────────────────────────────────────────────

export const TerrassementPanel: FC<Props> = ({
  buildings, parcel, reliefData, selectedId, onMetricsChange,
}) => {
  // ── studyId depuis l'URL (scope l'export par étude) ────────────────────────
  const [searchParams] = useSearchParams();
  const studyId = searchParams.get("study");

  // ── Prix éditables ──────────────────────────────────────────────────────────
  const [prices, setPrices]       = useState<TerrassementPrices>(loadPrices);
  const [showPrices, setShowPrices] = useState(false);

  const updatePrice = useCallback((key: keyof TerrassementPrices, val: number) => {
    setPrices(prev => { const next = { ...prev, [key]: val }; savePrices(next); return next; });
  }, []);

  const resetPrices = useCallback(() => { setPrices(DEFAULT_PRICES); savePrices(DEFAULT_PRICES); }, []);

  const pricesModified = (Object.keys(DEFAULT_PRICES) as (keyof TerrassementPrices)[]).some(
    k => prices[k] !== DEFAULT_PRICES[k],
  );

  // ── Calcul ──────────────────────────────────────────────────────────────────
  const metrics = useMemo(() => {
    if (!reliefData?.elevations?.length || buildings.length === 0) return null;
    try { return computeMetrics(buildings, parcel, reliefData, prices); }
    catch (e) { console.warn("[TerrassementPanel]", e); return null; }
  }, [buildings, parcel, reliefData, prices]);

  // ── Export Bilan (scopé par studyId) ────────────────────────────────────────
  // Si pas de bâtiments / pas de métriques pour CETTE étude, on purge la clé
  // scopée. Empêche la fuite de l'ancienne valeur d'un projet vers un autre.
  useEffect(() => {
    const key = exportKey(studyId);

    if (!metrics?.length) {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
      return;
    }

    const exp: TerrassementExport = {
      totalFootprintM2:      metrics.reduce((s, m) => s + m.footprintM2, 0),
      totalVolSoubM3:        metrics.reduce((s, m) => s + m.volSoubM3, 0),
      totalVolRemblaiM3:     metrics.reduce((s, m) => s + m.volRemblaiM3, 0),
      totalCoutTerrassement: metrics.reduce((s, m) => s + m.coutTerrassement, 0),
      totalCoutSoubassement: metrics.reduce((s, m) => s + m.coutSoubassement, 0),
      totalCout:             metrics.reduce((s, m) => s + m.coutTotal, 0),
      slopeWarning:  metrics.some(m => m.warning === "fort") ? "fort"
                   : metrics.some(m => m.warning === "modere") ? "modere" : "none",
      maxSlopeDeg:   Math.max(...metrics.map(m => m.slopeAvgDeg)),
      maxDeltaM:     Math.max(...metrics.map(m => m.deltaNivelee)),
      prices,
      updatedAt:     new Date().toISOString(),
    };

    try { localStorage.setItem(key, JSON.stringify(exp)); } catch { /* ignore */ }

    if (onMetricsChange) onMetricsChange(exp);
  }, [metrics, prices, onMetricsChange, studyId]);

  // ── Aggrégation ─────────────────────────────────────────────────────────────
  const selected  = metrics?.find(m => m.id === selectedId);
  const displayed = selected ? [selected] : (metrics ?? []);
  const isTotal   = !selected && displayed.length > 1;

  const totals = useMemo(() => {
    if (!displayed.length) return null;
    return {
      footprintM2:      displayed.reduce((s, m) => s + m.footprintM2, 0),
      volSoubM3:        displayed.reduce((s, m) => s + m.volSoubM3, 0),
      volRemblaiM3:     displayed.reduce((s, m) => s + m.volRemblaiM3, 0),
      coutTerrassement: displayed.reduce((s, m) => s + m.coutTerrassement, 0),
      coutSoubassement: displayed.reduce((s, m) => s + m.coutSoubassement, 0),
      coutTotal:        displayed.reduce((s, m) => s + m.coutTotal, 0),
      maxSlope: Math.max(...displayed.map(m => m.slopeAvgDeg)),
      maxDelta: Math.max(...displayed.map(m => m.deltaNivelee)),
      warning:  displayed.some(m => m.warning === "fort") ? "fort"
              : displayed.some(m => m.warning === "modere") ? "modere"
              : "none" as "none" | "modere" | "fort",
    };
  }, [displayed]);

  return (
    <div style={{ background: "white", borderRadius: 12, padding: 14, border: "1px solid #e2e8f0" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#0f172a", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 15 }}>🏗</span> Terrassement & fondations
        </div>
        <button
          onClick={() => setShowPrices(v => !v)}
          title="Modifier les prix unitaires"
          style={{
            padding: "3px 8px", borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: "pointer",
            border: showPrices ? `1.5px solid ${ACCENT}` : "1.5px solid #e2e8f0",
            background: showPrices ? `rgba(82,71,184,0.08)` : "white",
            color: showPrices ? ACCENT : "#64748b",
            display: "flex", alignItems: "center", gap: 4,
          }}
        >
          ✎ Prix{pricesModified ? <span style={{ color: ACCENT, marginLeft: 2 }}>•</span> : null}
        </button>
      </div>
      <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 10 }}>
        {isTotal ? `Total ${displayed.length} bâtiments` : selected ? selected.name : "Aucun bâtiment"}
      </div>

      {/* Pas de relief */}
      {!reliefData?.elevations?.length && (
        <div style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(234,179,8,0.07)", border: "1px solid rgba(234,179,8,0.3)", fontSize: 11, color: "#a16207" }}>
          <strong>Relief non chargé.</strong><br />Les données terrain sont nécessaires pour estimer le terrassement.
        </div>
      )}

      {/* Métriques */}
      {totals && (<>
        <SLabel>Terrain sous emprise</SLabel>
        <KV label="Surface emprise"       value={`${totals.footprintM2.toLocaleString("fr-FR")} m²`} />
        <KV label="Dénivelé max"          value={`${totals.maxDelta.toFixed(1)} m`} />
        <KV label="Pente moy. dominante"  value={`${totals.maxSlope.toFixed(1)}°`} />

        <Divider />

        <SLabel>Volumes estimés</SLabel>
        <KV label="Soubassement béton"    value={fmtM3(totals.volSoubM3)} />
        <KV label="Remblai / talus"       value={fmtM3(totals.volRemblaiM3)} />

        <Divider />

        <SLabel>Estimatif HT</SLabel>
        <KV label="Terrassement VRD"       value={fmtEur(totals.coutTerrassement)} />
        <KV label="Soubassement + remblai" value={fmtEur(totals.coutSoubassement)} />

        {/* Total */}
        <div style={{ marginTop: 8, padding: "10px 12px", borderRadius: 8, background: "rgba(82,71,184,0.06)", border: "1px solid rgba(82,71,184,0.18)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#0f172a" }}>Total estimé</span>
          <span style={{ fontSize: 14, fontWeight: 800, color: ACCENT }}>{fmtEur(totals.coutTotal)}</span>
        </div>

        {/* Alertes */}
        {totals.warning === "fort" && (
          <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 8, background: "rgba(220,38,38,0.06)", border: "1px solid rgba(220,38,38,0.25)", fontSize: 10, color: "#b91c1c" }}>
            <strong>⚠ Pente forte (&gt;25°)</strong> — surcoût ×{prices.surcoef_forte.toFixed(2)} appliqué. Validation bureau d'études structure obligatoire.
          </div>
        )}
        {totals.warning === "modere" && (
          <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 8, background: "rgba(234,179,8,0.07)", border: "1px solid rgba(234,179,8,0.3)", fontSize: 10, color: "#a16207" }}>
            <strong>⚡ Pente modérée (&gt;12°)</strong> — prévoir une étude de sol G2. Coût fondations à affiner.
          </div>
        )}
        {totals.warning === "none" && totals.maxDelta < 0.5 && (
          <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 8, background: "rgba(22,163,74,0.07)", border: "1px solid rgba(22,163,74,0.25)", fontSize: 10, color: "#15803d" }}>
            ✓ Terrain quasi-plat — terrassement standard, soubassement minimal.
          </div>
        )}

        <div style={{ marginTop: 10, fontSize: 9, color: "#94a3b8", lineHeight: 1.5, borderTop: "1px solid #f1f5f9", paddingTop: 8 }}>
          Indicatif ±35% · HT · hors VRD extérieurs · hors raccordements réseaux
        </div>
      </>)}

      {/* Prix éditables */}
      {showPrices && (
        <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 8, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>
            Prix unitaires (HT)
          </div>
          <PriceInput label="Terrassement VRD"      value={prices.terrassement_m2} unit="€/m²" min={5}   max={200}  step={1}    onChange={v => updatePrice("terrassement_m2", v)} />
          <PriceInput label="Soubassement béton armé" value={prices.soubassement_m3} unit="€/m³" min={50}  max={800}  step={5}    onChange={v => updatePrice("soubassement_m3", v)} />
          <PriceInput label="Remblai compacté"       value={prices.remblai_m3}      unit="€/m³" min={10}  max={200}  step={1}    onChange={v => updatePrice("remblai_m3", v)} />
          <PriceInput label="Surcoef pente forte (×)" value={prices.surcoef_forte}   unit="×"    min={1.0} max={3.0}  step={0.05} onChange={v => updatePrice("surcoef_forte", v)} />
          {pricesModified && (
            <button onClick={resetPrices} style={{ marginTop: 4, padding: "4px 10px", borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: "pointer", border: "1px solid #e2e8f0", background: "white", color: "#64748b" }}>
              ↺ Réinitialiser
            </button>
          )}
        </div>
      )}
    </div>
  );
};