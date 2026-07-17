// src/spaces/promoteur/Implantation2DPage.tsx
// V6.11 — Source UNIQUE pour l'enveloppe constructible.
//   Le diagnostic parcellaire (RightSidebar) calculait l'enveloppe avec
//   plan.buildableEnvelope (clipping par demi-plans → CONVEXE) et sans
//   frontEdgeIndex, alors que le canvas (Plan2DCanvas) la dessine avec
//   pluEnvelope.geometry (offset CONCAVE) + parcelFrontEdgeIndex + setbackRules
//   issus du store. Deux polygones distincts → un bâtiment visuellement dans la
//   ligne orange ressortait "0/1 conforme".
//   Correctif : la sidebar utilise EXACTEMENT le même moteur et les mêmes
//   entrées que le canvas (pluEnvelope.geometry + store). Fonction pure +
//   mêmes entrées ⇒ même polygone ⇒ diagnostic et canvas ne peuvent plus diverger.
// V6.10 — Hero v2 : design identique à VeilleMarchePage
// V6.9 — Fix MultiPolygon : featureToPoint2D prend le polygone de plus grande surface
// V6.8 — Captures scopées par studyId
// V6.7 — Fix race condition hydration/auto-save (useLayoutEffect + hydratedRef)

import type { Feature, MultiPolygon, Polygon } from "geojson";
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { BuildingInspectorPanel } from "./plan2d/BuildingInspectorPanel";
import { FloorElementsPanel } from "./plan2d/FloorElementsPanel";
import { Plan2DCanvas } from "./plan2d/Plan2DCanvas";
import { Plan2DToolbar } from "./plan2d/Plan2DToolbar";
import { computeParkingSlots, rectCorners } from "./plan2d/editor2d.geometry";
import { useEditor2DStore } from "./plan2d/editor2d.store";
import type { Building2D, Point2D } from "./plan2d/editor2d.types";
import { usePromoteurParcelRestore } from "./shared/hooks/usePromoteurParcelRestore";
// V6.13 — PLU réel de l'étude (au lieu du placeholder en dur)
import { usePromoteurStudy } from "./shared/usePromoteurStudy";

import { ParcelDiagnosticsPanel } from "./components/ParcelDiagnosticsPanel";
import { PluAnalysisPanel } from "./components/PluAnalysisPanel";
import { ScenarioFullPanel } from "./components/ScenarioFullPanel";

import { buildMasterScenario } from "./plan2d/masterScenario.service";
import type {
  MasterEconomicAssumptions,
  MasterScenario,
} from "./plan2d/plan.master.types";
import { DEFAULT_MASTER_ECONOMIC_ASSUMPTIONS } from "./plan2d/plan.master.types";
import { exportDrawnScenarioPdf } from "./services/exportDrawnScenarioPdf";

import type { ParcelDiagnostics } from "./plan2d/plan.parcelDiagnostics";
import type { PluEngineResult, PluRules } from "./plan2d/plan.plu.types";
import type { PlanBuilding, Vec2 } from "./plan2d/plan.types";

import { runPluChecks } from "./plan2d/plan.plu.engine";
// V6.11 — MÊME moteur que le canvas (offset concave), au lieu de plan.buildableEnvelope (convexe).
import { computeParcelDiagnostics } from "./plan2d/plan.parcelDiagnostics";
import { computeBuildableEnvelope } from "./plan2d/pluEnvelope.geometry";

import { supabase } from "../../supabaseClient";
import { buildImplantation2DForPromoteurSnapshot } from "./plan2d/implantation2d.snapshot";
import { writeCapture } from "./shared/captures.store";
import { patchModule } from "./shared/promoteurSnapshot.store";

// V6.12 — Publication du contexte vers l'Analyste Mimmoza
import {
  setActiveCopilotContext,
  clearActiveCopilotContext,
  normalizeStudyId,
  toActivePluRef,
} from "../copilot/store/activeCopilotContext.store";

import {
  HeroPrimaryButton,
  PromoteurPageHero,
  StudyIdBadge,
} from "./shared/components/PromoteurPageHero";
import { userStorage } from "@/lib/storage/userScopedStorage";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────────────────────────────────────

// ⚠️ Valeurs de repli UNIQUEMENT. Utilisées tant qu'aucun règlement PLU n'a été
// importé sur la page Foncier. Un diagnostic calculé dessus est indicatif.
const PLACEHOLDER_PLU_RULES: PluRules = {
  minSetbackMeters:     3,
  maxHeightMeters:      15,
  maxCoverageRatio:     0.60,
  parkingSpacesPerUnit: 1,
};

// ─────────────────────────────────────────────────────────────────────────────
// V6.13 — PLU RÉEL DE L'ÉTUDE
//   Avant : l'éditeur contrôlait la conformité contre PLACEHOLDER_PLU_RULES,
//   même quand le règlement était importé → diagnostics faux (ex. 60 % d'emprise
//   affichés sur une zone SANS règle CES). On lit désormais study.plu.
// ─────────────────────────────────────────────────────────────────────────────

function pluNum(obj: unknown): number | null {
  if (obj == null) return null;
  if (typeof obj === "number") return Number.isFinite(obj) ? obj : null;
  if (typeof obj === "string") { const n = parseFloat(obj); return isNaN(n) ? null : n; }
  if (typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  for (const k of ["valeur", "m", "metres", "max", "max_m", "min", "min_m", "max_ratio", "ratio_min", "pct", "value"]) {
    const n = pluNum(o[k]);
    if (n != null) return n;
  }
  return null;
}

interface StudyPluRules {
  rules:      PluRules;
  source:     "study" | "placeholder";
  zoneCode:   string | null;
  zoneLibelle: string | null;
  cesAbsent:  boolean;
  /** Reculs par type d'arête — alimentent l'enveloppe constructible (canvas). */
  reculVoirieM:  number | null;
  reculLimitesM: number | null;
  reculFondM:    number | null;
}

/**
 * Mappe study.plu → PluRules. Repli sur le placeholder si rien d'importé.
 * ⚠️ « Pas de règle CES » ≠ « emprise 0 % » : on renvoie 1 (100 %, non
 *    contraignant) et on signale l'absence via cesAbsent.
 */
function mapStudyPlu(studyPlu: unknown): StudyPluRules {
  const fallback: StudyPluRules = {
    rules: PLACEHOLDER_PLU_RULES, source: "placeholder",
    zoneCode: null, zoneLibelle: null, cesAbsent: false,
    reculVoirieM: null, reculLimitesM: null,
  };
  if (!studyPlu || typeof studyPlu !== "object") return fallback;

  const p  = studyPlu as Record<string, any>;
  const rs = (p.ruleset ?? p) as Record<string, any>;
  // Format réel (plu_ruleset_v1) : zone_code, hauteur (singulier), ces.max_ratio,
  // reculs.{voirie,limites_separatives}.min_m, stationnement.par_logement.
  const zoneCode = p.zone_code ?? p.zone ?? p.zone_plu ?? rs.zone_code ?? rs.zone ?? null;
  if (!zoneCode && !rs.hauteur && !rs.hauteurs && !rs.ces) return fallback;

  const hauteurs = rs.hauteur ?? rs.hauteurs ?? rs.gabarit ?? {};
  const ces      = rs.ces ?? rs.emprise_sol ?? {};
  const reculs   = rs.reculs ?? rs.recul ?? {};
  const stat     = rs.stationnement ?? rs.parking ?? {};

  // hauteur.max_m = égout (10 m) ; faitage_m = faîtage (13 m). L'égout borne
  // le gabarit constructible → c'est lui qu'on retient.
  const hEgout   = pluNum(hauteurs.max_m) ?? pluNum(hauteurs.egout) ?? pluNum(hauteurs.egout_m);
  const hFaitage = pluNum(hauteurs.faitage_m) ?? pluNum(hauteurs.faitage);
  const hMax     = hEgout ?? hFaitage ?? pluNum(p.hauteur_max_m);

  // ces.max_ratio est un RATIO (0–1), pas un pourcentage. null = pas de règle.
  const cesRatio  = pluNum(ces.max_ratio) ?? pluNum(ces);
  const cesAbsent = cesRatio == null || cesRatio <= 0;

  // reculs.facades.{avant,laterales,fond} est plus précis que voirie/limites
  // quand il est présent ; sinon repli sur le couple générique.
  const fac = reculs.facades ?? {};
  const reculVoirie  = pluNum(fac.avant) ?? pluNum(reculs.voirie) ?? pluNum(reculs.voirie_m);
  const reculLimites = pluNum(fac.laterales) ?? pluNum(reculs.limites_separatives) ?? pluNum(reculs.limites);
  const reculFond    = pluNum(fac.fond) ?? reculLimites;
  const reculMin = [reculVoirie, reculLimites, reculFond].filter((v): v is number => v != null);

  const parking = pluNum(stat.par_logement) ?? pluNum(stat) ?? pluNum(p.parking_par_logement);

  return {
    rules: {
      // ⚠️ PluMetricSet n'expose qu'une distance MINIMALE globale aux arêtes
      // (minDistanceToParcelEdgeM) : le moteur ne sait pas distinguer voirie et
      // limites séparatives. Le contrôle par arête est fait par l'ENVELOPPE
      // constructible (computeBuildableEnvelope + setbackRules), qui fait
      // autorité. On prend donc ici le recul le MOINS contraignant : ce garde-fou
      // grossier ne doit jamais contredire l'enveloppe (avec un max, un bâtiment
      // à 2 m d'une limite latérale — légal — serait faussement bloqué par une
      // règle de recul voirie de 3 m).
      minSetbackMeters:     reculMin.length ? Math.min(...reculMin) : PLACEHOLDER_PLU_RULES.minSetbackMeters,
      maxHeightMeters:      hMax ?? PLACEHOLDER_PLU_RULES.maxHeightMeters,
      // Pas de règle CES → 1 (100 %) : non contraignant, jamais 0.
      maxCoverageRatio:     cesAbsent ? 1 : (cesRatio as number),
      parkingSpacesPerUnit: parking ?? PLACEHOLDER_PLU_RULES.parkingSpacesPerUnit,
    },
    source: "study",
    zoneCode,
    zoneLibelle: p.zone_libelle ?? rs.zone_libelle ?? p.description ?? null,
    cesAbsent,
    reculVoirieM:  reculVoirie,
    reculLimitesM: reculLimites,
    reculFondM:    reculFond,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CLÉS LOCALSTORAGE
// ─────────────────────────────────────────────────────────────────────────────

function editorStorageKey(studyId: string): string {
  return `mimmoza.editor2d.raw.${studyId}`;
}
function parcelFeatureKey(studyId: string): string {
  return `mimmoza.parcelFeature.${studyId}`;
}
function parcelleLocalKey(studyId: string): string {
  return `mimmoza.parcelleLocal.${studyId}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CAPTURE IMPL 2D — scopée par studyId
// ─────────────────────────────────────────────────────────────────────────────

async function captureImpl2D(studyId: string | null): Promise<boolean> {
  try {
    const wrapper = document.getElementById("impl2d-capture-target");
    const nativeCanvas = document.querySelector<HTMLCanvasElement>(
      "#impl2d-capture-target canvas, [data-plan2d-canvas] canvas"
    );

    if (nativeCanvas) {
      const dataUrl = nativeCanvas.toDataURL("image/jpeg", 0.82);
      if (dataUrl && dataUrl.length > 100) {
        const ok = writeCapture(studyId, "impl2d", dataUrl);
        if (ok) {
          console.debug("[Impl2D] capture native canvas OK, taille:",
            Math.round(dataUrl.length / 1024), "Ko", "studyId:", studyId);
          return true;
        }
      }
    }

    if (wrapper) {
      try {
        const { default: html2canvas } = await import("html2canvas");
        const canvas = await html2canvas(wrapper, {
          useCORS: true,
          allowTaint: true,
          logging: false,
          scale: 1.5,
          backgroundColor: "#f8fafc",
        });
        const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
        const ok = writeCapture(studyId, "impl2d", dataUrl);
        if (ok) {
          console.debug("[Impl2D] capture html2canvas OK, taille:",
            Math.round(dataUrl.length / 1024), "Ko", "studyId:", studyId);
          return true;
        }
      } catch {
        // html2canvas absent — silencieux
      }
    }

    console.warn("[Impl2D] capture impossible : aucun canvas trouvé");
    return false;
  } catch (e) {
    console.warn("[Impl2D] captureImpl2D error:", e);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FILTRE RDC
// ─────────────────────────────────────────────────────────────────────────────

function hasValidRdcContent(b: Building2D): boolean {
  if (!b.id) return false;
  if (b.kind && b.kind !== "building") return false;

  if (b.floorPlans && b.floorPlans.length > 0) {
    const rdcPlan = b.floorPlans.find(fp => fp.levelIndex === 0);
    if (!rdcPlan) return false;
    return rdcPlan.volumes.some(
      v => v.role !== "connector" && v.rect.width * v.rect.depth > 0.1,
    );
  }
  if (b.volumes && b.volumes.length > 0) {
    return b.volumes.some(
      v => v.role !== "connector" && v.rect.width * v.rect.depth > 0.1,
    );
  }
  return b.rect.width * b.rect.depth > 0.1;
}

// ─────────────────────────────────────────────────────────────────────────────
// REPÈRE GÉOMÉTRIQUE
// ─────────────────────────────────────────────────────────────────────────────

function asVec2(pts: Point2D[]): Vec2[] {
  return pts as unknown as Vec2[];
}

function building2DToPlanBuilding(b: Building2D): PlanBuilding {
  const polygon: Vec2[] = rectCorners(b.rect).map(p => ({ x: p.x, y: p.y }));
  return {
    id:                  b.id,
    polygon,
    rotationDeg:         b.rect.rotationDeg,
    levels:              1 + (b.floorsAboveGround ?? b.levels ?? 0),
    groundFloorHeightM:  b.groundFloorHeightM  ?? 3.0,
    typicalFloorHeightM: b.typicalFloorHeightM ?? 2.8,
    usage:               "logement" as const,
    name:                b.label,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS GEOJSON → parcelleLocal
// ─────────────────────────────────────────────────────────────────────────────

function wgs84FeatureToLocalMeters(
  feature: Feature<Polygon | MultiPolygon>,
): Feature<Polygon | MultiPolygon> {
  const allRings: number[][][] =
    feature.geometry.type === "Polygon"
      ? (feature.geometry.coordinates as number[][][])
      : (feature.geometry.coordinates as number[][][][]).flat(1);

  const exteriorRing = allRings[0] ?? [];
  if (!exteriorRing.length) return feature;

  const centLon    = exteriorRing.reduce((s, c) => s + c[0], 0) / exteriorRing.length;
  const centLat    = exteriorRing.reduce((s, c) => s + c[1], 0) / exteriorRing.length;
  const mPerDegLon = 111_320 * Math.cos(centLat * (Math.PI / 180));
  const mPerDegLat = 110_574;

  const tc = (c: number[]): number[] => [
    (c[0] - centLon) * mPerDegLon,
    (c[1] - centLat) * mPerDegLat,
    ...c.slice(2),
  ];
  const tr = (ring: number[][]): number[][] => ring.map(tc);

  const newGeometry: Polygon | MultiPolygon =
    feature.geometry.type === "Polygon"
      ? { type: "Polygon",      coordinates: (feature.geometry.coordinates as number[][][]).map(tr) }
      : { type: "MultiPolygon", coordinates: (feature.geometry.coordinates as number[][][][]).map(poly => poly.map(tr)) };

  return { ...feature, geometry: newGeometry };
}

function isWGS84Feature(feature: Feature<Polygon | MultiPolygon>): boolean {
  const coords: number[] | undefined =
    feature.geometry.type === "Polygon"
      ? (feature.geometry.coordinates as number[][][])[0]?.[0]
      : (feature.geometry.coordinates as number[][][][])[0]?.[0]?.[0];
  if (!coords) return false;
  return Math.abs(coords[0]) <= 180 && Math.abs(coords[1]) <= 90;
}

function ringAreaApprox(ring: number[][]): number {
  if (!ring || ring.length < 3) return 0;
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(area / 2);
}

function featureToPoint2D(feature: Feature<Polygon | MultiPolygon>): Point2D[] {
  let rawCoords: number[][] = [];

  if (feature.geometry.type === "Polygon") {
    rawCoords = (feature.geometry.coordinates as number[][][])[0] ?? [];
  } else {
    const polys = (feature.geometry.coordinates as number[][][][]) ?? [];
    if (polys.length > 0) {
      let biggestIdx = 0;
      let biggestArea = -Infinity;
      polys.forEach((poly, idx) => {
        const outerRing = poly?.[0] ?? [];
        const a = ringAreaApprox(outerRing);
        if (a > biggestArea) { biggestArea = a; biggestIdx = idx; }
      });
      rawCoords = polys[biggestIdx]?.[0] ?? [];
      if (polys.length > 1) {
        console.warn(
          `[Implantation2D] MultiPolygon détecté (${polys.length} polygones) — ` +
          `utilisation du plus grand (index ${biggestIdx}, ~${biggestArea.toExponential(2)} deg²). ` +
          `Les parcelles non-adjacentes ou aux bordures incompatibles ne sont pas fusionnées.`,
        );
      }
    }
  }

  if (rawCoords.length < 3) return [];

  const open =
    rawCoords[rawCoords.length - 1][0] === rawCoords[0][0] &&
    rawCoords[rawCoords.length - 1][1] === rawCoords[0][1]
      ? rawCoords.slice(0, -1)
      : rawCoords;

  return open.map(([x, y]) => ({ x, y: -y }));
}

// ─────────────────────────────────────────────────────────────────────────────
// ÉTATS DE CHARGEMENT / ERREUR — hero v2
// ─────────────────────────────────────────────────────────────────────────────

function LoadingScreen({ studyId, label }: { studyId: string | null; label: string }) {
  return (
    <div style={{ background: "#f8fafc", minHeight: "100vh" }}>
      <div>
        <PromoteurPageHero
          badge="Promoteur · Conception"
          title="Implantation 2D"
          metaLines={[
            { text: label },
            ...(studyId ? [{ text: <StudyIdBadge studyId={studyId} /> }] : []),
          ]}
        />
      </div>
      <div style={{ padding: "16px" }}>
        <div style={{ background: "white", borderRadius: 14, padding: "32px 28px", border: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", maxWidth: 480, display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 36, height: 36, borderRadius: "50%", border: "3px solid #e2e8f0", borderTopColor: "#7c6fcd", animation: "spin 0.8s linear infinite", flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#0f172a" }}>Restauration de la sélection foncière</div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 3 }}>{label}</div>
          </div>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function EmptyState({ onGoToFoncier }: { onGoToFoncier: () => void }) {
  return (
    <div style={{ background: "#f8fafc", minHeight: "100vh" }}>
      <div>
        <PromoteurPageHero
          badge="Promoteur · Conception"
          title="Implantation 2D"
          actions={
            <HeroPrimaryButton onClick={onGoToFoncier}>
              Aller dans Foncier →
            </HeroPrimaryButton>
          }
        />
      </div>
      <div style={{ padding: "16px" }}>
        <div style={{ background: "white", borderRadius: 14, padding: "36px 28px", border: "1px solid #e2e8f0", maxWidth: 480 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📍</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", marginBottom: 8 }}>Aucune parcelle sélectionnée</div>
          <div style={{ fontSize: 14, color: "#475569", lineHeight: 1.6 }}>
            Pour ouvrir le Plan 2D, sélectionnez d'abord une parcelle dans l'outil Foncier.
          </div>
        </div>
      </div>
    </div>
  );
}

function ErrorState({ error, parcelIds, communeInsee, onContinueAnyway, onRefetch }: {
  error: string; parcelIds: string[]; communeInsee: string | null;
  onContinueAnyway: () => void; onRefetch: () => void;
}) {
  return (
    <div style={{ background: "#f8fafc", minHeight: "100vh" }}>
      <div>
        <PromoteurPageHero
          badge="Promoteur · Conception"
          title="Implantation 2D"
          actions={
            <>
              <HeroPrimaryButton onClick={onRefetch}>
                🔄 Réessayer
              </HeroPrimaryButton>
              <HeroPrimaryButton onClick={onContinueAnyway}>
                Continuer sans contour →
              </HeroPrimaryButton>
            </>
          }
        />
      </div>
      <div style={{ padding: "16px" }}>
        <div style={{ background: "white", borderRadius: 14, padding: "32px 28px", border: "1px solid #fecaca", maxWidth: 520 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#dc2626", marginBottom: 8 }}>⚠️ Géométrie cadastrale indisponible</div>
          <div style={{ marginBottom: 16, padding: "10px 14px", background: "#f8fafc", borderRadius: 10, border: "1px solid #e2e8f0" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", marginBottom: 6 }}>
              Parcelle{parcelIds.length > 1 ? "s" : ""} concernée{parcelIds.length > 1 ? "s" : ""}
            </div>
            {parcelIds.map(id => (
              <div key={id} style={{ fontSize: 12, fontFamily: "monospace", color: "#0f172a", fontWeight: 600 }}>{id}</div>
            ))}
            {communeInsee && <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>INSEE {communeInsee}</div>}
          </div>
          <div style={{ fontSize: 13, color: "#334155", lineHeight: 1.65 }}>{error}</div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION BLOCK
// ─────────────────────────────────────────────────────────────────────────────

const SectionBlock: React.FC<{
  label:        string;
  color?:       string;
  defaultOpen?: boolean;
  children:     React.ReactNode;
}> = ({ label, color = "#334155", defaultOpen = true, children }) => {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div style={{ flexShrink: 0, borderBottom: "1px solid #e2e8f0" }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", padding: "9px 14px", display: "flex", alignItems: "center",
          justifyContent: "space-between", background: "#f1f5f9", border: "none",
          cursor: "pointer", fontFamily: "Inter,system-ui,sans-serif",
        }}
      >
        <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color }}>
          {label}
        </span>
        <span style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1 }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && <div>{children}</div>}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// RIGHT SIDEBAR
// ─────────────────────────────────────────────────────────────────────────────

interface RightSidebarProps {
  parcelleLocal: Point2D[];
  studyId:       string | null;
  parcelId:      string | null;   // V6.12
  studyPlu:      unknown;         // V6.13 — study.plu brut
}

const RightSidebar: React.FC<RightSidebarProps> = ({ parcelleLocal, studyId, parcelId, studyPlu }) => {
  // V6.13 — Règles PLU effectives : celles de l'étude si importées, sinon repli.
  const pluRules = useMemo(() => mapStudyPlu(studyPlu), [studyPlu]);

  const allBuildings  = useEditor2DStore(s => s.buildings);
  const storeParkings = useEditor2DStore(s => s.parkings);
  const selectedIds   = useEditor2DStore(s => s.selectedIds);

  // V6.11 — MÊMES entrées d'enveloppe que le canvas (Plan2DCanvas lit ces deux
  // valeurs depuis ce store et les passe à pluEnvelope.geometry).
  // ⚠️ Vérifie que les noms de sélecteurs correspondent EXACTEMENT à ceux que
  //    Plan2DCanvas destructure du store (setbackRules / parcelFrontEdgeIndex).
  const setbackRules         = useEditor2DStore(s => s.setbackRules);
  const parcelFrontEdgeIndex = useEditor2DStore(s => s.parcelFrontEdgeIndex);
  const setSetbackRules      = useEditor2DStore(s => s.setSetbackRules);

  // ───────────────────────────────────────────────────────────────────────────
  // V6.13 — Initialisation des reculs depuis le PLU réel
  //   Mapping : recul voirie → frontM · recul limites séparatives → sideM + rearM.
  //   UNE SEULE FOIS par étude : l'utilisateur peut ensuite ajuster librement
  //   (un architecte dévie sciemment, on ne lui écrase pas sa saisie à chaque
  //   rendu). Sans ça, l'enveloppe orange restait sur 5/3/3 en dur.
  // ───────────────────────────────────────────────────────────────────────────
  const setbacksSeededRef = useRef<string | null>(null);

  useEffect(() => {
    if (!studyId) return;
    if (setbacksSeededRef.current === studyId) return;   // déjà initialisé
    if (pluRules.source !== "study") return;             // pas de PLU importé
    if (pluRules.reculVoirieM == null && pluRules.reculLimitesM == null) return;

    setbacksSeededRef.current = studyId;
    setSetbackRules({
      ...(pluRules.reculVoirieM  != null ? { frontM: pluRules.reculVoirieM } : {}),
      ...(pluRules.reculLimitesM != null ? { sideM: pluRules.reculLimitesM } : {}),
      ...(pluRules.reculFondM    != null ? { rearM: pluRules.reculFondM } : {}),
    });
    console.debug("[Implantation2D] reculs initialisés depuis le PLU", {
      studyId, zone: pluRules.zoneCode,
      voirie: pluRules.reculVoirieM, limites: pluRules.reculLimitesM,
    });
  }, [studyId, pluRules, setSetbackRules]);

  const storeBuildings = useMemo(
    () => allBuildings.filter(hasValidRdcContent),
    [allBuildings],
  );

  const hydratedRef = useRef(false);

  useLayoutEffect(() => {
    hydratedRef.current = false;

    if (!studyId) {
      useEditor2DStore.setState({ buildings: [], parkings: [], selectedIds: [] });
      hydratedRef.current = true;
      return;
    }

    const key = editorStorageKey(studyId);
    const raw = userStorage.getItem(key);

    if (!raw) {
      useEditor2DStore.setState({ buildings: [], parkings: [], selectedIds: [] });
      console.debug("[Implantation2D] store reset (nouvelle étude)", { studyId });
      hydratedRef.current = true;
      return;
    }

    try {
      const saved = JSON.parse(raw) as { buildings: Building2D[]; parkings: any[] };
      useEditor2DStore.setState({
        buildings:   saved.buildings ?? [],
        parkings:    saved.parkings  ?? [],
        selectedIds: [],
      });
      console.debug("[Implantation2D] store restauré", {
        studyId,
        buildingCount: saved.buildings?.length ?? 0,
      });
    } catch (e) {
      console.error("[Implantation2D] restauration store échouée:", e);
      useEditor2DStore.setState({ buildings: [], parkings: [], selectedIds: [] });
    }

    hydratedRef.current = true;
  }, [studyId]);

  const implantationSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef          = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;

    const state = useEditor2DStore.getState();
    const freshBuildings = state.buildings;
    const freshParkings  = state.parkings;
    const freshStoreBuildings = freshBuildings.filter(hasValidRdcContent);

    if (studyId) {
      try {
        userStorage.setItem(
            editorStorageKey(studyId),
            JSON.stringify({ buildings: freshBuildings, parkings: freshParkings }),
        );
      } catch (e) {
        console.error("[Implantation2D] save état brut échoué:", e);
      }
    }

    const snap = buildImplantation2DForPromoteurSnapshot(freshStoreBuildings);
    patchModule("implantation2d", snap);

    if (studyId) {
      if (implantationSaveRef.current) clearTimeout(implantationSaveRef.current);
      implantationSaveRef.current = setTimeout(async () => {
        if (!mountedRef.current) return;
        const { error } = await supabase
          .from("promoteur_studies")
          .update({ implantation2d: snap })
          .eq("id", studyId);
        if (error) console.error("[Implantation2D] Supabase persist error:", error.message);
      }, 1_500);
    }

    return () => { if (implantationSaveRef.current) clearTimeout(implantationSaveRef.current); };
  }, [allBuildings, storeParkings, storeBuildings, studyId]);

  const planBuildings = useMemo<PlanBuilding[]>(
    () => storeBuildings.map(building2DToPlanBuilding),
    [storeBuildings],
  );

  const parcelVec2 = useMemo<Vec2[]>(() => asVec2(parcelleLocal), [parcelleLocal]);

  const providedParkingSpaces = useMemo<number>(
    () => storeParkings.reduce((sum, p) => {
      const slots = p.slotCount > 0
        ? p.slotCount
        : computeParkingSlots(p.rect.width, p.rect.depth, p.slotWidth, p.slotDepth, p.driveAisleWidth);
      return sum + slots;
    }, 0),
    [storeParkings],
  );

  const parcelAreaM2 = useMemo<number>(() => {
    if (parcelVec2.length < 3) return 0;
    let area = 0;
    for (let i = 0, j = parcelVec2.length - 1; i < parcelVec2.length; j = i++)
      area += (parcelVec2[j].x + parcelVec2[i].x) * (parcelVec2[j].y - parcelVec2[i].y);
    return Math.abs(area / 2);
  }, [parcelVec2]);

  const [assumptions,          setAssumptions]          = useState<MasterEconomicAssumptions>(DEFAULT_MASTER_ECONOMIC_ASSUMPTIONS);
  const [nbLogements,          setNbLogements]          = useState<number | undefined>(undefined);
  const [surfaceMoyLogementM2, setSurfaceMoyLogementM2] = useState<number | undefined>(undefined);

  const masterScenario = useMemo<MasterScenario | null>(() => {
    if (!storeBuildings.length) return null;
    return buildMasterScenario({
      buildings: storeBuildings, parkings: storeParkings,
      parcelPolygon: parcelleLocal, parcelAreaM2,
      nbLogements, surfaceMoyLogementM2, assumptions,
    });
  }, [storeBuildings, storeParkings, parcelleLocal, parcelAreaM2, nbLogements, surfaceMoyLogementM2, assumptions]);

  const handleExportPdf = useCallback(() => {
    if (!masterScenario) return;
    try { exportDrawnScenarioPdf({ scenario: masterScenario }); }
    catch (err) { alert(`Erreur export PDF : ${err instanceof Error ? err.message : String(err)}`); }
  }, [masterScenario]);

  const selectedBuildingId = useMemo<string | null>(() => {
    if (selectedIds.length !== 1) return null;
    return allBuildings.some(b => b.id === selectedIds[0]) ? selectedIds[0] : null;
  }, [selectedIds, allBuildings]);

  const pluResult = useMemo<PluEngineResult | null>(() => {
    if (parcelVec2.length < 3) return null;
    return runPluChecks({ parcel: parcelVec2, buildings: planBuildings, rules: pluRules.rules, providedParkingSpaces });
  }, [parcelVec2, planBuildings, providedParkingSpaces, pluRules]);

  // V6.11 — Enveloppe constructible : MÊME source que le canvas.
  //   pluEnvelope.geometry::computeBuildableEnvelope(parcelleLocal, frontEdgeIndex, setbackRules)
  //   — fonction pure, mêmes entrées → polygone identique à la ligne orange dessinée.
  //   parcelleLocal (Point2D[]) sert directement de polygone source ; frontEdgeIndex
  //   indexe ce même tableau, exactement comme côté canvas.
  const buildableEnvelope = useMemo<Vec2[] | null>(() => {
    if (parcelleLocal.length < 3) return null;
    const env = computeBuildableEnvelope(
      parcelleLocal,
      parcelFrontEdgeIndex ?? null,
      setbackRules,
    );
    return env.length >= 3 ? asVec2(env) : null;
  }, [parcelleLocal, parcelFrontEdgeIndex, setbackRules]);

  const parcelDiagnostics = useMemo<ParcelDiagnostics | null>(() => {
    if (parcelVec2.length < 3) return null;
    return computeParcelDiagnostics({ parcel: parcelVec2, buildings: planBuildings, buildableEnvelope });
  }, [parcelVec2, planBuildings, buildableEnvelope]);

  // ───────────────────────────────────────────────────────────────────────────
  // V6.12 — Publication du contexte vers l'Analyste Mimmoza
  //   Le panneau Copilot est monté hors de cette page (layout global) : il ne
  //   peut rien recevoir par props. Le seul canal est activeCopilotContext.
  //   Sans cette publication, l'Analyste reçoit une question nue → réponse
  //   générique, sans parcelle ni PLU. Même mécanisme que RisquesPage/risk_study.
  //
  //   ⚠️ Le tableau de deps DOIT contenir l'état vivant du canvas : le snapshot
  //      doit se rafraîchir à chaque déplacement de bâtiment, pas au mount.
  // ───────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    setActiveCopilotContext({
      studyId:  normalizeStudyId(studyId),
      parcelId: parcelId ?? undefined,
      surface:  parcelAreaM2 > 0 ? Math.round(parcelAreaM2) : undefined,
      route:    "/promoteur/implantation-2d",
      vertical: "promoteur",
      // V6.13 — PLU du parser : alimente le tool get_parcel_plu (ctx.plu).
      // Sans ce champ, le tool répond « règlement non importé » alors que le
      // PLU est bien en base — et l'Analyste répète cette erreur à l'écran.
      plu: toActivePluRef(studyPlu),
      pageContext: {
        pathname: "/promoteur/implantation-2d",
        space:    "promoteur",
        mode:     "conception",
        tab:      "implantation",
      },
      implantation_2d: {
        // Parcelle
        parcelle_surface_m2: Math.round(parcelAreaM2),
        parcelle_sommets:    parcelleLocal.length,
        enveloppe_constructible_definie: !!buildableEnvelope,
        // PATCH — vrais noms de champs de setbackRules (editor2d.store: frontM/sideM/rearM).
        recul_facade_m: setbackRules?.frontM ?? null,
        recul_lateral_m: setbackRules?.sideM ?? null,
        recul_fond_m:   setbackRules?.rearM ?? null,

        // Programme dessiné
        nb_batiments: storeBuildings.length,
        nb_parkings_zones: storeParkings.length,
        places_parking_totales: providedParkingSpaces,
        batiments: storeBuildings.map(b => ({
          id:        b.id,
          nom:       b.label ?? null,
          niveaux:   1 + (b.floorsAboveGround ?? b.levels ?? 0),
          emprise_m2: Math.round(b.rect.width * b.rect.depth),
        })),

        // Règles PLU réellement appliquées par le moteur de conformité
        regles_plu: pluRules.rules,
        regles_plu_source: pluRules.source,
        plu_zone: pluRules.zoneCode,
        plu_zone_libelle: pluRules.zoneLibelle,
        plu_ces_absent: pluRules.cesAbsent,
        plu_recul_voirie_m: pluRules.reculVoirieM,
        plu_recul_limites_m: pluRules.reculLimitesM,
        // L'enveloppe fait autorité sur les reculs (contrôle par arête) ;
        // regles_plu.minSetbackMeters n'est qu'un garde-fou global.
        reculs_source: pluRules.source === "study"
          ? "PLU de l'etude (modifiables par l'utilisateur)"
          : "valeurs par defaut de l'editeur",

        // Résultats moteurs — déjà calculés, l'IA n'a pas à les recalculer
        plu_checks:  pluResult  ?? null,
        diagnostics: parcelDiagnostics ?? null,
        scenario:    masterScenario ?? null,

        // Programmation saisie
        nb_logements: nbLogements ?? null,
        surface_moy_logement_m2: surfaceMoyLogementM2 ?? null,
      },
    });
  }, [
    studyId, parcelId, parcelleLocal, parcelAreaM2,
    storeBuildings, storeParkings, providedParkingSpaces,
    buildableEnvelope, setbackRules, pluRules, studyPlu,
    pluResult, parcelDiagnostics, masterScenario,
    nbLogements, surfaceMoyLogementM2,
  ]);

  return (
    <div style={{
      width: 380, flexShrink: 0, display: "flex", flexDirection: "column",
      height: "100%", borderLeft: "1px solid #e2e8f0", background: "#f8fafc",
      overflowY: "auto", fontFamily: "Inter, system-ui, sans-serif",
    }}>
      {selectedBuildingId && (
        <div style={{ flexShrink: 0, background: "#eef2ff", borderBottom: "2px solid #4f46e5" }}>
          <div style={{ padding: "8px 14px 6px", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "#4f46e5" }}>⬜ Bâtiment sélectionné</span>
          </div>
          <div style={{ background: "#fff" }}>
            <BuildingInspectorPanel buildingId={selectedBuildingId} />
          </div>
          <div style={{ borderTop: "1px solid #c7d2fe" }}>
            <div style={{ padding: "6px 14px 4px", display: "flex", alignItems: "center", gap: 6, background: "#eef2ff" }}>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "#0d9488" }}>☀ Éléments d'étage</span>
            </div>
            <FloorElementsPanel buildingId={selectedBuildingId} />
          </div>
        </div>
      )}
      <SectionBlock label="Diagnostic parcellaire" color="#334155">
        <div style={{ padding: "8px 14px" }}><ParcelDiagnosticsPanel diagnostics={parcelDiagnostics} /></div>
      </SectionBlock>
      <SectionBlock label="Analyse PLU" color="#334155">
        <div style={{ padding: "8px 14px" }}><PluAnalysisPanel result={pluResult} /></div>
      </SectionBlock>
      <SectionBlock label="Analyse d'implantation" color="#4f46e5" defaultOpen={!selectedBuildingId}>
        <ScenarioFullPanel
          scenario={masterScenario} assumptions={assumptions}
          nbLogements={nbLogements} surfaceMoyLogementM2={surfaceMoyLogementM2}
          onChangeProgramme={(nb, surf) => { setNbLogements(nb); setSurfaceMoyLogementM2(surf); }}
          onChangeAssumptions={setAssumptions}
          onExportPdf={handleExportPdf}
          isEmpty={storeBuildings.length === 0}
        />
      </SectionBlock>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// BOUTON CAPTURE — prend studyId via props
// ─────────────────────────────────────────────────────────────────────────────

interface CaptureButtonProps {
  studyId: string | null;
}

const CaptureButton: React.FC<CaptureButtonProps> = ({ studyId }) => {
  const [status, setStatus] = useState<"idle" | "capturing" | "ok" | "fail">("idle");

  const handleCapture = useCallback(async () => {
    setStatus("capturing");
    const ok = await captureImpl2D(studyId);
    setStatus(ok ? "ok" : "fail");
    setTimeout(() => setStatus("idle"), 2500);
  }, [studyId]);

  const label =
    status === "capturing" ? "Capture…"
    : status === "ok"      ? "✓ Capturé !"
    : status === "fail"    ? "⚠ Échec"
    : "📸 Synthèse";

  return (
    <button
      onClick={handleCapture}
      disabled={status === "capturing"}
      style={{
        padding: "7px 14px",
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.35)",
        background: status === "ok"   ? "rgba(16,185,129,0.3)"
                  : status === "fail" ? "rgba(239,68,68,0.3)"
                  : "rgba(255,255,255,0.15)",
        color: "white",
        fontWeight: 600,
        fontSize: 12,
        cursor: status === "capturing" ? "wait" : "pointer",
        transition: "background 0.2s",
        flexShrink: 0,
      }}
      title="Capturer cette vue pour la Synthèse Promoteur"
    >
      {label}
    </button>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// PAGE PRINCIPALE — V6.11
// ─────────────────────────────────────────────────────────────────────────────

export const Implantation2DPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate        = useNavigate();
  const studyId         = searchParams.get("study");

  // V6.13 — PLU réel de l'étude (le placeholder ne sert plus que de repli).
  const { study } = usePromoteurStudy(studyId);

  const restore = usePromoteurParcelRestore({ studyId, autoFetchMissingGeometry: true });
  const [forceRenderWithoutGeometry, setForceRenderWithoutGeometry] = useState(false);

  const normalizedCombinedFeature = useMemo(() => {
    if (!restore.combinedFeature) return null;
    if (isWGS84Feature(restore.combinedFeature)) {
      return wgs84FeatureToLocalMeters(restore.combinedFeature);
    }
    return restore.combinedFeature;
  }, [restore.combinedFeature]);

  const parcelleLocal = useMemo<Point2D[]>(() => {
    if (!normalizedCombinedFeature) return [];
    return featureToPoint2D(normalizedCombinedFeature);
  }, [normalizedCombinedFeature]);

  useEffect(() => {
    if (!studyId || !restore.combinedFeature) return;
    try {
      userStorage.setItem(
          parcelFeatureKey(studyId),
          JSON.stringify(restore.combinedFeature),
      );
    } catch (e) {
      console.warn("[Implantation2D] persistance parcelFeature échouée:", e);
    }
  }, [restore.combinedFeature, studyId]);

  useEffect(() => {
    if (!studyId || parcelleLocal.length < 3) return;
    try {
      userStorage.setItem(
          parcelleLocalKey(studyId),
          JSON.stringify(parcelleLocal),
      );
    } catch (e) {
      console.warn("[Implantation2D] persistance parcelleLocal échouée:", e);
    }
  }, [parcelleLocal, studyId]);

  // V6.12 — Purge du contexte Copilot en quittant la page.
  // Sans ça, l'implantation fuit vers les autres routes (Bilan, Marché…) et
  // l'Analyste répond sur une parcelle qui n'est plus à l'écran.
  useEffect(() => () => clearActiveCopilotContext(), []);

  const studyPath = (base: string) =>
    studyId ? `${base}?study=${encodeURIComponent(studyId)}` : base;

  const loadingLabel = (() => {
    switch (restore.status) {
      case "idle":    return "Initialisation…";
      case "loading": return "Récupération du cadastre (Supabase + IGN)…";
      default:        return "Préparation de l'éditeur…";
    }
  })();

  if (!restore.isSettled)
    return <LoadingScreen studyId={studyId} label={loadingLabel} />;

  if (restore.status === "empty" || restore.selectedParcels.length === 0)
    return <EmptyState onGoToFoncier={() => navigate(studyPath("/promoteur/foncier"))} />;

  if (!normalizedCombinedFeature && !forceRenderWithoutGeometry) {
    return (
      <ErrorState
        error={restore.error ?? "La géométrie cadastrale n'a pas pu être récupérée."}
        parcelIds={restore.selectedParcels.map(p => p.id)}
        communeInsee={restore.communeInsee}
        onRefetch={() => { setForceRenderWithoutGeometry(false); restore.refetch(); }}
        onContinueAnyway={() => setForceRenderWithoutGeometry(true)}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#f8fafc", overflow: "hidden" }}>

      {/* ── Hero v2 — design identique à VeilleMarchePage ── */}
      <div style={{ flexShrink: 0 }}>
        <PromoteurPageHero
          badge="Promoteur · Conception"
          title="Implantation 2D"
          metaLines={studyId ? [{ text: <StudyIdBadge studyId={studyId} /> }] : undefined}
          actions={<CaptureButton studyId={studyId} />}
        />
      </div>

      <div style={{ padding: "8px 16px", background: "white", borderBottom: "1px solid #e2e8f0", flexShrink: 0 }}>
        <Plan2DToolbar />
      </div>

      <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
        <div
          id="impl2d-capture-target"
          data-plan2d-canvas
          style={{ flex: 1, position: "relative", overflow: "hidden", minWidth: 0 }}
        >
          <Plan2DCanvas
            parcellePolygon={parcelleLocal}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
          />
        </div>
        <RightSidebar
          parcelleLocal={parcelleLocal}
          studyId={studyId}
          parcelId={restore.selectedParcels[0]?.id ?? null}
          studyPlu={(study as any)?.plu ?? null}
        />
      </div>
    </div>
  );
};

export default Implantation2DPage;