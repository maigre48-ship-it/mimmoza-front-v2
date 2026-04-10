// src/spaces/promoteur/components/Plan2DEditorPage.tsx

import React, { useState, useCallback, useEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";
import type { GeoJSON } from "geojson";
import type {
  PlanProject,
  PlanBuilding,
  PlanBuildingWithTransform,
  Vec2,
} from "../plan2d/plan.types";
import type { PluRules } from "../plan2d/plan.plu.types";
import type { PluEngineResult } from "../plan2d/plan.plu.types";
import { getPolygonCentroid } from "../plan2d/plan.geometry";
import { computeParkingSlots } from "../plan2d/editor2d.geometry";
import { usePlanEditor } from "../plan2d/store/usePlanEditor";
import { runPluChecks } from "../plan2d/plan.plu.engine";
import {
  computeBuildableEnvelope,
  type BuildableEnvelopeOptions,
} from "../plan2d/plan.buildableEnvelope";
import type { ZoningOverlay } from "../plan2d/plan.zoning.types";
import { createDemoZoningOverlays } from "../plan2d/plan.zoning";
import { ZoningLegend } from "./ZoningLegend";
import { ParcelDiagnosticsPanel } from "./ParcelDiagnosticsPanel";
import { ImplantationScenariosPanel } from "./ImplantationScenariosPanel";
import { ScenarioComparisonMatrix } from "./ScenarioComparisonMatrix";
import { ScenarioRecommendationCard } from "./ScenarioRecommendationCard";
import { exportScenarioComparisonPdf } from "../services/exportScenarioComparisonPdf";
import { FinancialBridgePanel } from "./FinancialBridgePanel";
import { GeneratedVariantsPanel } from "./GeneratedVariantsPanel";
import { BestImplantationSuggestionCard } from "./BestImplantationSuggestionCard";
import { buildBestImplantationSuggestion } from "../plan2d/plan.bestSuggestion";
import type { BestImplantationSuggestion } from "../plan2d/plan.bestSuggestion.types";
import { computeFinancialBridge } from "../plan2d/plan.financialBridge";
import type {
  FinancialBridgeAssumptions,
  FinancialBridgeResult,
} from "../plan2d/plan.financialBridge.types";
import { generateVariantsFromScenario } from "../plan2d/plan.variantGenerator";
import { computeParcelDiagnostics, type ParcelDiagnostics } from "../plan2d/plan.parcelDiagnostics";
import {
  buildScenarioSummary,
  buildScenarioList,
  computeRealScenarioMetrics,
  scaleScenarioMetrics,
} from "../plan2d/plan.scenarios";
import type { ImplantationScenario } from "../plan2d/plan.scenarios.types";

import PlanEditorCanvas from "./PlanEditorCanvas";
import PlanToolbar from "./PlanToolbar";
import PlanPropertiesPanel from "./PlanPropertiesPanel";
import PluAnalysisPanel from "./PluAnalysisPanel";

// ─── PLU RULES PLACEHOLDER ────────────────────────────────────────────
//
// V1 placeholder rules. Replace this with:
//   - localStorage lookup via ResolvedPluRulesetV1 (already in codebase)
//   - editor.project.site.communeInsee → PLU database query
//   - user manual input panel
//
// Isolate the source here so the rest of the pipeline is source-agnostic.

const PLACEHOLDER_PLU_RULES: PluRules = {
  minSetbackMeters:     3,    // Art. 6–7 — recul min. des limites séparatives
  maxHeightMeters:      15,   // Art. 10  — hauteur maximale des constructions
  maxCoverageRatio:     0.60, // Art. 9   — coefficient d'emprise au sol
  parkingSpacesPerUnit: 1,    // Art. 12  — stationnement par logement
};

// ─── GEOJSON → Vec2[] ─────────────────────────────────────────────────

function extractParcelVec2(
  feature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null,
): Vec2[] {
  if (!feature) return [];
  const ring =
    feature.geometry.type === "Polygon"
      ? (feature.geometry.coordinates[0] as [number, number][])
      : ((feature.geometry.coordinates[0]?.[0] ?? []) as [number, number][]);
  return ring.map(([x, y]) => ({ x, y }));
}

// ─── BUILDING MIGRATION ───────────────────────────────────────────────

function ensureBuildingTransform(b: PlanBuilding): PlanBuildingWithTransform {
  if (
    b.basePolygon && b.basePolygon.length > 0 &&
    b.position    != null &&
    b.scaleX      != null &&
    b.scaleY      != null
  ) {
    return b as PlanBuildingWithTransform;
  }

  const centroid    = getPolygonCentroid(b.polygon);
  const basePolygon = b.polygon.map(p => ({
    x: p.x - centroid.x,
    y: p.y - centroid.y,
  }));

  return {
    ...b,
    basePolygon,
    position:    centroid,
    scaleX:      b.scaleX      ?? 1,
    scaleY:      b.scaleY      ?? 1,
    rotationDeg: b.rotationDeg ?? 0,
  };
}

// ─── OUTER SHELL ──────────────────────────────────────────────────────

export const Plan2DEditorPage: React.FC = () => {
  const location       = useLocation();
  const state          = location.state as { initialPlanProject?: PlanProject } | null;
  const initialProject = state?.initialPlanProject ?? null;

  if (!initialProject) {
    return (
      <div style={{ padding: 40, color: "#64748b", fontFamily: "sans-serif" }}>
        Aucun projet chargé.
      </div>
    );
  }

  return <PlanEditorInner initialProject={initialProject} />;
};

// ─── INNER COMPONENT ──────────────────────────────────────────────────

interface PlanEditorInnerProps {
  initialProject: PlanProject;
}

const PlanEditorInner: React.FC<PlanEditorInnerProps> = ({ initialProject }) => {
  const editor = usePlanEditor(initialProject);

  // ── Authoritative buildings (transform-migrated) ───────────────────
  const [buildings, setBuildings] = useState<PlanBuildingWithTransform[]>(
    () => initialProject.buildings.map(ensureBuildingTransform),
  );

  // Sync with editor.project.buildings (toolbar additions / deletions)
  useEffect(() => {
    setBuildings(prev => {
      const prevById = new Map<string, PlanBuildingWithTransform>(
        prev.map(b => [b.id, b]),
      );
      return editor.project.buildings.map(editorBuilding => {
        const local = prevById.get(editorBuilding.id);
        if (local) return local;
        return ensureBuildingTransform(editorBuilding);
      });
    });
  }, [editor.project.buildings]);

  const handleUpdateBuilding = useCallback(
    (updated: PlanBuildingWithTransform) =>
      setBuildings(prev => prev.map(b => (b.id === updated.id ? updated : b))),
    [],
  );

  // ── Parcel Vec2[] (stable across unrelated renders) ───────────────
  const parcelVec2 = useMemo<Vec2[]>(
    () => extractParcelVec2(editor.project.site.parcel),
    [editor.project.site.parcel],
  );

  // ── PLU engine result ─────────────────────────────────────────────
  // Recomputes only when parcel, buildings, or parkings change.
  // Returns null when no parcel or no buildings — panel shows empty state.
  // ⚠️ Ne PAS utiliser parkings.length (nb d'objets) ni p.slotCount (figé à la création).
  //    computeParkingSlots recalcule dynamiquement depuis la géométrie de chaque parking.
  const providedParkingSpaces = useMemo<number>(
    () => editor.project.parkings.reduce((sum, p) =>
      sum + computeParkingSlots(
        p.rect.width, p.rect.depth,
        p.slotWidth ?? 2.5, p.slotDepth ?? 5.0, p.driveAisleWidth ?? 6.0,
      ), 0),
    [editor.project.parkings],
  );

  const pluResult = useMemo<PluEngineResult | null>(() => {
    if (parcelVec2.length < 3 || buildings.length === 0) return null;
    return runPluChecks({
      parcel:                parcelVec2,
      buildings,
      rules:                 PLACEHOLDER_PLU_RULES,
      providedParkingSpaces,
    });
  }, [parcelVec2, buildings, providedParkingSpaces]);

  // ── Buildable envelope ────────────────────────────────────────────
  // Aggregates all applicable regulatory constraints into a single
  // polygon. V1: uniform setback from PLU rules.
  // V2: will compose side-specific setbacks, frontage, prospect, etc.
  const envelopeOptions: BuildableEnvelopeOptions = {
    setbackMeters: PLACEHOLDER_PLU_RULES.minSetbackMeters ?? 0,
  };

  const buildableEnvelope = useMemo<Vec2[] | null>(() => {
    if (parcelVec2.length < 3) return null;
    const env = computeBuildableEnvelope(parcelVec2, envelopeOptions);
    return env.length >= 3 ? env : null;
  }, [parcelVec2, envelopeOptions.setbackMeters]);

  // ── Zoning overlays ───────────────────────────────────────────────
  // V1: demo overlays derived from the parcel geometry for illustration.
  // Production: replace with overlays from the PLU engine, cadastral
  // data, or user-defined zoning inputs via ZoningLayerSet.
  const zoningOverlays = useMemo<ZoningOverlay[]>(
    () => createDemoZoningOverlays(parcelVec2),
    [parcelVec2],
  );

  // ── Parcel diagnostics ────────────────────────────────────────────
  // Spatial and feasibility diagnostics re-computed whenever the
  // parcel shape, building positions, or envelope change.
  const parcelDiagnostics = useMemo<ParcelDiagnostics | null>(() => {
    if (parcelVec2.length < 3) return null;
    return computeParcelDiagnostics({
      parcel:            parcelVec2,
      buildings,
      buildableEnvelope: buildableEnvelope,
    });
  }, [parcelVec2, buildings, buildableEnvelope]);

  // ── Implantation scenarios ────────────────────────────────────────
  // V1 mock: three scenarios derived from the current building set.
  // Production: replace with scenario engine, user-defined variants,
  // or automated massing alternatives.
  const [activeScenarioId, setActiveScenarioId] = useState<string>("current");

  const implantationScenarios = useMemo<ImplantationScenario[]>(() => {
    if (parcelVec2.length < 3) return [];

    const blocking = pluResult?.rules.filter(r => r.status === "BLOQUANT").length ?? 0;
    const limited  = pluResult?.rules.filter(r => r.status === "LIMITE").length ?? 0;

    // Scenario A: current buildings — real data
    const currentMetrics = computeRealScenarioMetrics({
      buildings,
      parcel:       parcelVec2,
      blockingCount: blocking,
      limitedCount:  limited,
    });

    // Scenario B: +30% footprint — denser programme
    const denserMetrics = scaleScenarioMetrics(currentMetrics, 1.30, PLACEHOLDER_PLU_RULES, 1);

    // Scenario C: −25% footprint — conservative programme
    const conservMetrics = scaleScenarioMetrics(currentMetrics, 0.75, PLACEHOLDER_PLU_RULES, -1);

    const raw: ImplantationScenario[] = [
      buildScenarioSummary({
        id:          "current",
        label:       "Scénario actuel",
        description: "Configuration de référence — implantation en cours d'édition.",
        buildings,
        metrics:     currentMetrics,
        pluRules:    PLACEHOLDER_PLU_RULES,
        active:      true,
      }),
      buildScenarioSummary({
        id:          "dense",
        label:       "Variante densifiée",
        description: "Programme augmenté de 30 % — densification maximale du gabarit autorisé.",
        buildings,
        metrics:     denserMetrics,
        pluRules:    PLACEHOLDER_PLU_RULES,
      }),
      buildScenarioSummary({
        id:          "conservative",
        label:       "Variante conservatrice",
        description: "Programme réduit de 25 % — marges réglementaires renforcées.",
        buildings:   buildings.slice(0, Math.max(1, buildings.length)),
        metrics:     conservMetrics,
        pluRules:    PLACEHOLDER_PLU_RULES,
      }),
    ];

    // buildScenarioList auto-marks the algorithmically recommended scenario
    return buildScenarioList(raw);
  }, [parcelVec2, buildings, pluResult, PLACEHOLDER_PLU_RULES]);

  // ── Active scenario object (derived from id) ─────────────────────
  const activeScenario = useMemo(
    () => implantationScenarios.find(s => s.id === activeScenarioId) ?? null,
    [implantationScenarios, activeScenarioId],
  );

  // ── PDF export state ──────────────────────────────────────────────
  const [isExporting, setIsExporting] = useState(false);

  const handleExportPdf = useCallback(async () => {
    if (isExporting || !implantationScenarios.length) return;
    setIsExporting(true);
    try {
      await exportScenarioComparisonPdf({
        projectTitle:  editor.project.name || undefined,
        activeScenarioId,
        scenarios:     implantationScenarios,
      });
    } finally {
      setIsExporting(false);
    }
  }, [isExporting, implantationScenarios, activeScenarioId, editor.project.name]);

  // ── Financial bridge ──────────────────────────────────────────────
  // V1: placeholder assumptions. Production: expose as editable state
  // or pull from project programme / market data service.
  const financialAssumptions: FinancialBridgeAssumptions = {
    floorEfficiencyRatio:  0.83,
    salePricePerM2:        5500,
    constructionCostPerM2: 1800,
    landCost:              0,
    averageUnitSizeM2:     62,
    fallbackLevels:        4,
  };

  const financialBridgeResult = useMemo<FinancialBridgeResult | null>(
    () => computeFinancialBridge({ scenario: activeScenario, assumptions: financialAssumptions }),
    [activeScenario],
  );

  // ── Auto-generated variants ───────────────────────────────────────
  // Deterministic geometric variants derived from the active scenario.
  // Each variant is converted to a full ImplantationScenario so it reuses
  // the existing scoring / recommendation pipeline.
  const generatedVariantScenarios = useMemo<ImplantationScenario[]>(() => {
    if (!activeScenario || !activeScenario.buildings.length) return [];

    const variants = generateVariantsFromScenario({
      scenario: activeScenario,
      parcel:   parcelVec2.length >= 3 ? parcelVec2 : undefined,
    });

    const blocking = pluResult?.rules.filter(r => r.status === "BLOQUANT").length ?? 0;
    const limited  = pluResult?.rules.filter(r => r.status === "LIMITE").length ?? 0;

    const rawScenarios = variants.map(v => {
      const metrics = computeRealScenarioMetrics({
        buildings:    v.buildings,
        parcel:       parcelVec2,
        blockingCount: blocking,
        limitedCount:  limited,
      });
      return buildScenarioSummary({
        id:          v.id,
        label:       v.label,
        description: v.description,
        buildings:   v.buildings,
        metrics,
        pluRules:    PLACEHOLDER_PLU_RULES,
      });
    });

    return buildScenarioList(rawScenarios);
  }, [activeScenario, parcelVec2, pluResult]);

  // ── Best implantation suggestion ─────────────────────────────────
  // Evaluates all available scenarios (manual + generated) to identify
  // the most promising implantation at the current stage.
  const allScenariosForSuggestion = useMemo(
    () => [...implantationScenarios, ...generatedVariantScenarios],
    [implantationScenarios, generatedVariantScenarios],
  );

  const bestSuggestion = useMemo<BestImplantationSuggestion>(
    () => buildBestImplantationSuggestion({ scenarios: allScenariosForSuggestion }),
    [allScenariosForSuggestion],
  );

  return (
    <div style={{ display: "flex", height: "100vh", background: "#f8fafc" }}>

      {/* ── Canvas area ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Toolbar row: PlanToolbar + export button */}
        <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
          <div style={{ flex: 1 }}>
            <PlanToolbar />
          </div>
          {implantationScenarios.length > 0 && (
            <div style={{ padding: "0 12px", flexShrink: 0 }}>
              <button
                onClick={handleExportPdf}
                disabled={isExporting}
                style={{
                  display:        "inline-flex",
                  alignItems:     "center",
                  gap:            6,
                  padding:        "6px 14px",
                  borderRadius:   8,
                  background:     isExporting ? "#e0e7ff" : "#4f46e5",
                  color:          isExporting ? "#6366f1" : "#ffffff",
                  border:         "none",
                  cursor:         isExporting ? "not-allowed" : "pointer",
                  fontSize:       12,
                  fontWeight:     600,
                  letterSpacing:  "0.01em",
                  transition:     "background 0.12s",
                  whiteSpace:     "nowrap",
                }}
              >
                <span style={{ fontSize: 14 }}>{isExporting ? "⏳" : "↓"}</span>
                {isExporting ? "Export en cours…" : "Exporter PDF"}
              </button>
            </div>
          )}
        </div>
        {/* Relative container so the legend can be positioned absolutely */}
        <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
          <PlanEditorCanvas
            editor={editor}
            buildings={buildings}
            onUpdateBuilding={handleUpdateBuilding}
            pluStatus={pluResult?.globalStatus ?? null}
            buildableEnvelope={buildableEnvelope}
            zoningOverlays={zoningOverlays}
          />

          {/* Floating zoning legend — bottom-left, over the canvas */}
          {zoningOverlays.length > 0 && (
            <div
              style={{
                position:      "absolute",
                bottom:        24,
                left:          24,
                zIndex:        10,
                pointerEvents: "none",
              }}
            >
              <ZoningLegend
                kinds={zoningOverlays.map(o => o.kind)}
                compact={false}
              />
            </div>
          )}
        </div>
      </div>

      {/* ── Right sidebar — fully scrollable, 3 stacked panels ── */}
      <div
        style={{
          width:          380,
          flexShrink:     0,
          display:        "flex",
          flexDirection:  "column",
          height:         "100vh",
          borderLeft:     "1px solid #e2e8f0",
          background:     "#f8fafc",
          overflowY:      "auto",
        }}
      >
        {/* 1. Best implantation suggestion — top of sidebar for prominence */}
        <div style={{ flexShrink: 0, borderBottom: "1px solid #e2e8f0" }}>
          <BestImplantationSuggestionCard
            suggestion={bestSuggestion}
            scenarios={allScenariosForSuggestion}
            onSelectScenario={setActiveScenarioId}
          />
        </div>

        {/* 2. Selection / editing context */}
        <div style={{ flexShrink: 0, borderBottom: "1px solid #e2e8f0" }}>
          <PlanPropertiesPanel editor={editor} />
        </div>

        {/* 2. Parcel diagnostics — spatial metrics */}
        <div style={{ flexShrink: 0, borderBottom: "1px solid #e2e8f0" }}>
          <ParcelDiagnosticsPanel diagnostics={parcelDiagnostics} />
        </div>

        {/* 3. PLU regulatory compliance */}
        <div style={{ flexShrink: 0, borderBottom: "1px solid #e2e8f0" }}>
          <PluAnalysisPanel result={pluResult} />
        </div>

        {/* 4. Implantation scenarios — cards */}
        <div style={{ flexShrink: 0, borderBottom: "1px solid #e2e8f0" }}>
          <ImplantationScenariosPanel
            scenarios={implantationScenarios}
            activeScenarioId={activeScenarioId}
            onSelectScenario={setActiveScenarioId}
          />
        </div>

        {/* 5. Active scenario recommendation card */}
        <div style={{ flexShrink: 0, borderBottom: "1px solid #e2e8f0" }}>
          <ScenarioRecommendationCard scenario={activeScenario} />
        </div>

        {/* 6. Financial bridge — preliminary financial estimation */}
        <div style={{ flexShrink: 0, borderBottom: "1px solid #e2e8f0" }}>
          <FinancialBridgePanel
            result={financialBridgeResult}
            assumptions={financialAssumptions}
          />
        </div>

        {/* 7. Scenario comparison matrix */}
        <div style={{ flexShrink: 0, borderBottom: "1px solid #e2e8f0" }}>
          <ScenarioComparisonMatrix
            scenarios={implantationScenarios}
            activeScenarioId={activeScenarioId}
            onSelectScenario={setActiveScenarioId}
          />
        </div>

        {/* 8. Auto-generated variants */}
        <div style={{ flexShrink: 0 }}>
          <GeneratedVariantsPanel
            variants={generatedVariantScenarios}
            activeScenarioId={activeScenarioId}
            onAdoptVariant={setActiveScenarioId}
          />
        </div>
      </div>

    </div>
  );
};

export default Plan2DEditorPage;