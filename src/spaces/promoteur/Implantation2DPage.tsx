// src/spaces/promoteur/Implantation2DPage.tsx
// V6.2 — Filtre RDC cohérent avec le tooltip canvas.
//
// Corrections v6.2 :
//   - hasValidRdcContent() : filtre les bâtiments sans contenu au RDC
//     (upper-floor only, volumes vides, connecteurs seuls)
//   - storeBuildings utilise ce filtre → PLU, diagnostics et masterScenario
//     ne voient plus les bâtiments fantômes
//
// Architecture : repère unique parcelleLocal (Y-down, espace éditeur, mètres).

import React, { useMemo, useState, useCallback } from "react";
import { useSearchParams, useNavigate }           from "react-router-dom";
import type { Feature, Polygon, MultiPolygon }    from "geojson";

import { usePromoteurParcelRestore }              from "./shared/hooks/usePromoteurParcelRestore";
import { Plan2DCanvas }                           from "./plan2d/Plan2DCanvas";
import { Plan2DToolbar }                          from "./plan2d/Plan2DToolbar";
import type { Point2D, Building2D }               from "./plan2d/editor2d.types";
import { useEditor2DStore }                       from "./plan2d/editor2d.store";
import { rectCorners, computeParkingSlots }       from "./plan2d/editor2d.geometry";
import { BuildingInspectorPanel }                 from "./plan2d/BuildingInspectorPanel";
import { FloorElementsPanel }                     from "./plan2d/FloorElementsPanel";

import { ParcelDiagnosticsPanel }                 from "./components/ParcelDiagnosticsPanel";
import { PluAnalysisPanel }                       from "./components/PluAnalysisPanel";
import { ScenarioFullPanel }                      from "./components/ScenarioFullPanel";

import { buildMasterScenario }                    from "./plan2d/masterScenario.service";
import type {
  MasterScenario,
  MasterEconomicAssumptions,
}                                                 from "./plan2d/plan.master.types";
import { DEFAULT_MASTER_ECONOMIC_ASSUMPTIONS }    from "./plan2d/plan.master.types";
import { exportDrawnScenarioPdf }                 from "./services/exportDrawnScenarioPdf";

import type { Vec2, PlanBuilding }                from "./plan2d/plan.types";
import type { PluRules, PluEngineResult }         from "./plan2d/plan.plu.types";
import type { ParcelDiagnostics }                 from "./plan2d/plan.parcelDiagnostics";

import { runPluChecks }                           from "./plan2d/plan.plu.engine";
import { computeBuildableEnvelope }               from "./plan2d/plan.buildableEnvelope";
import { computeParcelDiagnostics }               from "./plan2d/plan.parcelDiagnostics";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────────────────────────────────────

const VIOLET   = "#7c6fcd";
const GRAD_PRO = "linear-gradient(90deg, #7c6fcd 0%, #b39ddb 100%)";

const PLACEHOLDER_PLU_RULES: PluRules = {
  minSetbackMeters:     3,
  maxHeightMeters:      15,
  maxCoverageRatio:     0.60,
  parkingSpacesPerUnit: 1,
};

// ─────────────────────────────────────────────────────────────────────────────
// FILTRE RDC
//
// Un bâtiment est "valide" seulement s'il a du contenu réel au RDC.
// Cohérent avec le tooltip "SURFACES — RDC" du canvas qui lit
// floorPlans[levelIndex=0].volumes.
//
// Cas rejetés (bâtiments fantômes) :
//   - floorPlans présents mais aucun pour levelIndex=0
//     (bâtiment créé ou modifié uniquement sur un étage supérieur)
//   - floorPlans[0] présent mais tous les volumes sont connecteurs ou < 0.1 m²
//
// Cas acceptés :
//   - floorPlans[0] avec au moins un volume non-connecteur > 0.1 m²
//   - b.volumes legacy non-vides (bâtiments pre-V4)
//   - pure rect (aucun floorPlan ni volumes : fallback géométrique)
// ─────────────────────────────────────────────────────────────────────────────

function hasValidRdcContent(b: Building2D): boolean {
  if (!b.id) return false;
  if (b.kind && b.kind !== "building") return false;

  if (b.floorPlans && b.floorPlans.length > 0) {
    const rdcPlan = b.floorPlans.find(fp => fp.levelIndex === 0);
    if (!rdcPlan) return false; // upper-floor only → fantôme
    return rdcPlan.volumes.some(
      v => v.role !== "connector" && v.rect.width * v.rect.depth > 0.1,
    );
  }
  // Legacy pre-V4 : volumes directs
  if (b.volumes && b.volumes.length > 0) {
    return b.volumes.some(
      v => v.role !== "connector" && v.rect.width * v.rect.depth > 0.1,
    );
  }
  // Pure rect fallback
  return b.rect.width * b.rect.depth > 0.1;
}

// ─────────────────────────────────────────────────────────────────────────────
// REPÈRE GÉOMÉTRIQUE DE RÉFÉRENCE
//
// Repère unique : parcelleLocal (Y-down, espace éditeur, mètres).
// Point2D et Vec2 sont structurellement identiques → cast direct.
// Un seul flip Y dans featureToPoint2D — aucune autre transformation.
// ─────────────────────────────────────────────────────────────────────────────

function asVec2(pts: Point2D[]): Vec2[] {
  return pts as unknown as Vec2[];
}

// ─────────────────────────────────────────────────────────────────────────────
// BUILDING2D → PLANBUILDING
//
// Produit un PlanBuilding dans le repère parcelleLocal (Y-down).
// Aucun flip Y : PLU engine, diagnostics et masterScenario reçoivent
// la même géométrie que le canvas.
// ─────────────────────────────────────────────────────────────────────────────

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

/**
 * GeoJSON → parcelleLocal (Y-down, mètres).
 * Seul endroit où Y est inversé dans toute la chaîne.
 */
function featureToPoint2D(feature: Feature<Polygon | MultiPolygon>): Point2D[] {
  const rawCoords: number[][] =
    feature.geometry.type === "Polygon"
      ? (feature.geometry.coordinates as number[][][])[0] ?? []
      : (feature.geometry.coordinates as number[][][][])[0]?.[0] ?? [];

  if (rawCoords.length < 3) return [];

  const open =
    rawCoords[rawCoords.length - 1][0] === rawCoords[0][0] &&
    rawCoords[rawCoords.length - 1][1] === rawCoords[0][1]
      ? rawCoords.slice(0, -1)
      : rawCoords;

  return open.map(([x, y]) => ({ x, y: -y }));
}

// ─────────────────────────────────────────────────────────────────────────────
// ÉTATS DE CHARGEMENT
// ─────────────────────────────────────────────────────────────────────────────

function LoadingScreen({ studyId, label }: { studyId: string | null; label: string }) {
  return (
    <div style={{ padding: "16px 0 0 0", background: "#f8fafc", minHeight: "100vh" }}>
      <div style={{ padding: "0 16px", marginBottom: 16 }}>
        <div style={{ background: GRAD_PRO, borderRadius: 14, padding: "20px 24px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", marginBottom: 6 }}>Promoteur › Conception</div>
            <div style={{ fontSize: 22, fontWeight: 600, color: "white", marginBottom: 4 }}>Implantation 2D</div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.75)" }}>Chargement de la parcelle…</div>
          </div>
          {studyId && (
            <div style={{ padding: "6px 12px", borderRadius: 8, background: "rgba(255,255,255,0.15)", color: "white", fontSize: 11, fontWeight: 500, flexShrink: 0, marginTop: 4, border: "1px solid rgba(255,255,255,0.25)" }}>
              Étude {studyId.slice(0, 8)}…
            </div>
          )}
        </div>
      </div>
      <div style={{ padding: "0 16px" }}>
        <div style={{ background: "white", borderRadius: 14, padding: "32px 28px", border: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", maxWidth: 480, display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 36, height: 36, borderRadius: "50%", border: "3px solid #e2e8f0", borderTopColor: VIOLET, animation: "spin 0.8s linear infinite", flexShrink: 0 }} />
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
    <div style={{ padding: "16px 0 0 0", background: "#f8fafc", minHeight: "100vh" }}>
      <div style={{ padding: "0 16px", marginBottom: 16 }}>
        <div style={{ background: GRAD_PRO, borderRadius: 14, padding: "20px 24px" }}>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", marginBottom: 6 }}>Promoteur › Conception</div>
          <div style={{ fontSize: 22, fontWeight: 600, color: "white" }}>Implantation 2D</div>
        </div>
      </div>
      <div style={{ padding: "0 16px" }}>
        <div style={{ background: "white", borderRadius: 14, padding: "36px 28px", border: "1px solid #e2e8f0", maxWidth: 480 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📍</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", marginBottom: 8 }}>Aucune parcelle sélectionnée</div>
          <div style={{ fontSize: 14, color: "#475569", lineHeight: 1.6, marginBottom: 24 }}>
            Pour ouvrir le Plan 2D, sélectionnez d'abord une parcelle dans l'outil Foncier.
          </div>
          <button onClick={onGoToFoncier} style={{ padding: "10px 22px", borderRadius: 999, border: "none", background: GRAD_PRO, color: "white", fontWeight: 600, fontSize: 14, cursor: "pointer" }}>
            Aller dans Foncier →
          </button>
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
    <div style={{ padding: "16px 0 0 0", background: "#f8fafc", minHeight: "100vh" }}>
      <div style={{ padding: "0 16px", marginBottom: 16 }}>
        <div style={{ background: GRAD_PRO, borderRadius: 14, padding: "20px 24px" }}>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", marginBottom: 6 }}>Promoteur › Conception</div>
          <div style={{ fontSize: 22, fontWeight: 600, color: "white" }}>Implantation 2D</div>
        </div>
      </div>
      <div style={{ padding: "0 16px" }}>
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
          <div style={{ fontSize: 13, color: "#334155", marginBottom: 20, lineHeight: 1.65 }}>{error}</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={onRefetch} style={{ padding: "9px 20px", borderRadius: 999, border: "1px solid #e2e8f0", background: "white", color: "#374151", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
              🔄 Réessayer
            </button>
            <button onClick={onContinueAnyway} style={{ padding: "9px 20px", borderRadius: 999, border: "none", background: GRAD_PRO, color: "white", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
              Continuer sans contour →
            </button>
          </div>
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
}

const RightSidebar: React.FC<RightSidebarProps> = ({ parcelleLocal }) => {

  const allBuildings  = useEditor2DStore(s => s.buildings);
  const storeParkings = useEditor2DStore(s => s.parkings);
  const selectedIds   = useEditor2DStore(s => s.selectedIds);

  // ── Bâtiments valides : RDC réel requis ──────────────────────────
  // hasValidRdcContent() garantit la cohérence avec le tooltip canvas.
  // Les bâtiments "upper-floor only" et les fantômes sont exclus.
  const storeBuildings = useMemo(
    () => allBuildings.filter(hasValidRdcContent),
    [allBuildings],
  );

  // PlanBuilding[] pour PLU engine et diagnostics — repère parcelleLocal.
  const planBuildings = useMemo<PlanBuilding[]>(
    () => storeBuildings.map(building2DToPlanBuilding),
    [storeBuildings],
  );

  // Parcelle en Vec2[] — cast trivial, même repère (parcelleLocal, Y-down).
  const parcelVec2 = useMemo<Vec2[]>(
    () => asVec2(parcelleLocal),
    [parcelleLocal],
  );

  // Places parking : p.slotCount en priorité (source de vérité éditeur).
  const providedParkingSpaces = useMemo<number>(
    () => storeParkings.reduce((sum, p) => {
      const slots = p.slotCount > 0
        ? p.slotCount
        : computeParkingSlots(p.rect.width, p.rect.depth, p.slotWidth, p.slotDepth, p.driveAisleWidth);
      return sum + slots;
    }, 0),
    [storeParkings],
  );

  // Aire parcelle (shoelace sur parcelleLocal).
  const parcelAreaM2 = useMemo<number>(() => {
    if (parcelVec2.length < 3) return 0;
    let area = 0;
    for (let i = 0, j = parcelVec2.length - 1; i < parcelVec2.length; j = i++) {
      area += (parcelVec2[j].x + parcelVec2[i].x) * (parcelVec2[j].y - parcelVec2[i].y);
    }
    return Math.abs(area / 2);
  }, [parcelVec2]);

  // ── Hypothèses ────────────────────────────────────────────────────
  const [assumptions,          setAssumptions]          = useState<MasterEconomicAssumptions>(DEFAULT_MASTER_ECONOMIC_ASSUMPTIONS);
  const [nbLogements,          setNbLogements]          = useState<number | undefined>(undefined);
  const [surfaceMoyLogementM2, setSurfaceMoyLogementM2] = useState<number | undefined>(undefined);

  // ── Scénario maître ───────────────────────────────────────────────
  // storeBuildings sont filtrés (RDC valide uniquement).
  // buildings.rect et parcelPolygon sont dans le même repère (parcelleLocal).
  const masterScenario = useMemo<MasterScenario | null>(() => {
    if (!storeBuildings.length) return null;
    return buildMasterScenario({
      buildings:    storeBuildings,
      parkings:     storeParkings,
      parcelPolygon: parcelleLocal,
      parcelAreaM2,
      nbLogements,
      surfaceMoyLogementM2,
      assumptions,
    });
  }, [storeBuildings, storeParkings, parcelleLocal, parcelAreaM2, nbLogements, surfaceMoyLogementM2, assumptions]);

  // ── Export PDF ────────────────────────────────────────────────────
  const handleExportPdf = useCallback(() => {
    if (!masterScenario) return;
    try {
      exportDrawnScenarioPdf({ scenario: masterScenario });
    } catch (err) {
      console.error("[Mimmoza] PDF export failed:", err);
      alert(`Erreur export PDF : ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [masterScenario]);

  // ── Bâtiment sélectionné ──────────────────────────────────────────
  const selectedBuildingId = useMemo<string | null>(() => {
    if (selectedIds.length !== 1) return null;
    // On garde la sélection même si le bâtiment est un fantôme (pour l'inspecteur).
    return allBuildings.some(b => b.id === selectedIds[0]) ? selectedIds[0] : null;
  }, [selectedIds, allBuildings]);

  // ── PLU engine ────────────────────────────────────────────────────
  const pluResult = useMemo<PluEngineResult | null>(() => {
    if (parcelVec2.length < 3) return null;
    return runPluChecks({
      parcel:               parcelVec2,
      buildings:            planBuildings,
      rules:                PLACEHOLDER_PLU_RULES,
      providedParkingSpaces,
    });
  }, [parcelVec2, planBuildings, providedParkingSpaces]);

  // ── Enveloppe constructible ───────────────────────────────────────
  const buildableEnvelope = useMemo<Vec2[] | null>(() => {
    if (parcelVec2.length < 3) return null;
    const env = computeBuildableEnvelope(parcelVec2, {
      setbackMeters: PLACEHOLDER_PLU_RULES.minSetbackMeters ?? 0,
    });
    return env.length >= 3 ? env : null;
  }, [parcelVec2]);

  // ── Diagnostics parcellaires ──────────────────────────────────────
  const parcelDiagnostics = useMemo<ParcelDiagnostics | null>(() => {
    if (parcelVec2.length < 3) return null;
    return computeParcelDiagnostics({
      parcel:            parcelVec2,
      buildings:         planBuildings,
      buildableEnvelope,
    });
  }, [parcelVec2, planBuildings, buildableEnvelope]);

  return (
    <div style={{
      width: 380, flexShrink: 0,
      display: "flex", flexDirection: "column",
      height: "100%",
      borderLeft: "1px solid #e2e8f0",
      background: "#f8fafc",
      overflowY: "auto",
      fontFamily: "Inter, system-ui, sans-serif",
    }}>

      {/* ══ A. BÂTIMENT SÉLECTIONNÉ ══════════════════════════════════════ */}
      {selectedBuildingId && (
        <div style={{ flexShrink: 0, background: "#eef2ff", borderBottom: "2px solid #4f46e5" }}>
          <div style={{ padding: "8px 14px 6px", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "#4f46e5" }}>
              ⬜ Bâtiment sélectionné
            </span>
          </div>
          <div style={{ background: "#fff" }}>
            <BuildingInspectorPanel buildingId={selectedBuildingId} />
          </div>
          <div style={{ borderTop: "1px solid #c7d2fe" }}>
            <div style={{ padding: "6px 14px 4px", display: "flex", alignItems: "center", gap: 6, background: "#eef2ff" }}>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "#0d9488" }}>
                ☀ Éléments d'étage
              </span>
            </div>
            <FloorElementsPanel buildingId={selectedBuildingId} />
          </div>
        </div>
      )}

      {/* ══ B. DIAGNOSTIC PARCELLAIRE ════════════════════════════════════ */}
      <SectionBlock label="Diagnostic parcellaire" color="#334155">
        <div style={{ padding: "8px 14px" }}>
          <ParcelDiagnosticsPanel diagnostics={parcelDiagnostics} />
        </div>
      </SectionBlock>

      {/* ══ C. ANALYSE PLU ═══════════════════════════════════════════════ */}
      <SectionBlock label="Analyse PLU" color="#334155">
        <div style={{ padding: "8px 14px" }}>
          <PluAnalysisPanel result={pluResult} />
        </div>
      </SectionBlock>

      {/* ══ D. SCÉNARIO MAÎTRE ═══════════════════════════════════════════ */}
      <SectionBlock label="Analyse d'implantation" color="#4f46e5" defaultOpen={!selectedBuildingId}>
        <ScenarioFullPanel
          scenario={masterScenario}
          assumptions={assumptions}
          nbLogements={nbLogements}
          surfaceMoyLogementM2={surfaceMoyLogementM2}
          onChangeProgramme={(nb, surf) => {
            setNbLogements(nb);
            setSurfaceMoyLogementM2(surf);
          }}
          onChangeAssumptions={setAssumptions}
          onExportPdf={handleExportPdf}
          isEmpty={storeBuildings.length === 0}
        />
      </SectionBlock>

    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// PAGE PRINCIPALE — V6.2
// ─────────────────────────────────────────────────────────────────────────────

export const Implantation2DPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate        = useNavigate();
  const studyId         = searchParams.get("study");

  const restore = usePromoteurParcelRestore({
    studyId,
    autoFetchMissingGeometry: true,
  });

  const [forceRenderWithoutGeometry, setForceRenderWithoutGeometry] = useState(false);

  const normalizedCombinedFeature = useMemo(() => {
    if (!restore.combinedFeature) return null;
    if (isWGS84Feature(restore.combinedFeature)) {
      return wgs84FeatureToLocalMeters(restore.combinedFeature);
    }
    return restore.combinedFeature;
  }, [restore.combinedFeature]);

  // parcelleLocal = repère éditeur (Y-down, mètres).
  // Référence géométrique unique de toute l'analyse.
  const parcelleLocal = useMemo<Point2D[]>(() => {
    if (!normalizedCombinedFeature) return [];
    return featureToPoint2D(normalizedCombinedFeature);
  }, [normalizedCombinedFeature]);

  const studyPath = (base: string) =>
    studyId ? `${base}?study=${encodeURIComponent(studyId)}` : base;

  const loadingLabel = (() => {
    switch (restore.status) {
      case "idle":    return "Initialisation…";
      case "loading": return "Récupération du cadastre (Supabase + IGN)…";
      default:        return "Préparation de l'éditeur…";
    }
  })();

  if (!restore.isSettled) {
    return <LoadingScreen studyId={studyId} label={loadingLabel} />;
  }

  if (restore.status === "empty" || restore.selectedParcels.length === 0) {
    return <EmptyState onGoToFoncier={() => navigate(studyPath("/promoteur/foncier"))} />;
  }

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
    <div style={{
      display:       "flex",
      flexDirection: "column",
      height:        "100vh",
      background:    "#f8fafc",
      overflow:      "hidden",
    }}>

      {/* ── Header ── */}
      <div style={{
        padding:        "14px 20px",
        background:     GRAD_PRO,
        flexShrink:     0,
        display:        "flex",
        alignItems:     "center",
        justifyContent: "space-between",
      }}>
        <div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", marginBottom: 2 }}>
            Promoteur › Conception
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "white" }}>
            Implantation 2D
          </div>
        </div>
        {studyId && (
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", background: "rgba(255,255,255,0.15)", padding: "4px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.2)" }}>
            Étude {studyId.slice(0, 8)}…
          </div>
        )}
      </div>

      {/* ── Toolbar ── */}
      <div style={{ padding: "8px 16px", background: "white", borderBottom: "1px solid #e2e8f0", flexShrink: 0 }}>
        <Plan2DToolbar />
      </div>

      {/* ── Corps : 2 colonnes ── */}
      <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>

        <div style={{ flex: 1, position: "relative", overflow: "hidden", minWidth: 0 }}>
          <Plan2DCanvas
            parcellePolygon={parcelleLocal}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
          />
        </div>

        <RightSidebar parcelleLocal={parcelleLocal} />
      </div>
    </div>
  );
};

export default Implantation2DPage;