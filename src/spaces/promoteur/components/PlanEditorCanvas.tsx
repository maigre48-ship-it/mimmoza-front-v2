// src/spaces/promoteur/components/PlanEditorCanvas.tsx
// V1.3 — Mode dessin pour les outils Bâtiment et Parking
//
// NOUVEAUTÉS :
//   • Quand editor.activeTool === "building" ou "parking" :
//     - Curseur crosshair sur le canvas
//     - Clic-glisser dessine un rectangle de prévisualisation
//     - MouseUp crée la géométrie via editor.addBuilding / editor.addParking
//   • Annulation du tracé si drag < 5px (clic simple sans intention de tracé)
//   • Prévisualisation du rectangle en cours de dessin (stroke tireté)
//   • Aucune interaction de déplacement/resize en mode dessin
//
// V1.2 : Parcelle rendue en deux passes (fill en premier, stroke en dernier).
// V1.1 : Overlay "aucune parcelle" quand canvas vide.

import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import type { GeoJSON } from "geojson";
import type {
  Vec2,
  PlanBuildingWithTransform,
  ResizeHandle,
} from "../plan2d/plan.types";
import {
  getBoundingBox,
  getPolygonBounds,
  getResizeHandles,
  getRotationHandle,
} from "../plan2d/plan.geometry";
import { applyTransform } from "../plan2d/plan.transform";
import { resizeBuilding } from "../plan2d/plan.resize";
import { rotateBuilding } from "../plan2d/plan.rotate";
import {
  snapPosition,
  SNAP_GRID_SIZE,
  SNAP_SCALE_STEP,
  SNAP_ANGLE_STEP,
  type SnapConfig,
} from "../plan2d/plan.snap";
import { constrainBuildingToParcel } from "../plan2d/plan.constraint";
import { isBuildingInsideEnvelope } from "../plan2d/plan.buildableEnvelope";
import type { ZoningOverlay } from "../plan2d/plan.zoning.types";
import {
  sortZoningOverlays,
  getDefaultZoningStyle,
  mergeZoningStyle,
  getOverlayLabelPosition,
} from "../plan2d/plan.zoning";
import type { PluRuleStatus } from "../plan2d/plan.plu.types";
import type { usePlanEditor } from "../plan2d/store/usePlanEditor";

// ─── TYPES ────────────────────────────────────────────────────────────

type PlanEditorHook = ReturnType<typeof usePlanEditor>;

type BuildingInteraction =
  | { type: "drag";   buildingId: string; startBuilding: PlanBuildingWithTransform; startScreenX: number; startScreenY: number; viewScale: number; }
  | { type: "resize"; buildingId: string; handle: ResizeHandle; startBuilding: PlanBuildingWithTransform; startScreenX: number; startScreenY: number; viewScale: number; }
  | { type: "rotate"; buildingId: string; startBuilding: PlanBuildingWithTransform; startMouseWorld: Vec2; viewScale: number; };

// État du tracé rectangulaire en mode dessin
type DrawState = {
  startScreen: Vec2;  // coin de départ en coordonnées SVG
  endScreen:   Vec2;  // coin courant en coordonnées SVG
};

// ─── CONSTANTS ────────────────────────────────────────────────────────

const VIEW_W             = 1200;
const VIEW_H             = 800;
const PADDING            = 60;
const RESIZE_HANDLE_SIZE = 8;
const ROTATION_HANDLE_R  = 6;
const MIN_DRAW_PX        = 5; // distance min pour valider un tracé

const COLOR_VIOLATION_FILL   = "rgba(239,68,68,0.45)";
const COLOR_VIOLATION_STROKE = "#dc2626";
const COLOR_SETBACK_FILL     = "rgba(251,146,60,0.45)";
const COLOR_SETBACK_STROKE   = "#f97316";

// ─── HELPERS ──────────────────────────────────────────────────────────

function worldPolygonToScreenPath(worldPoints: Vec2[], toScreen: (x: number, y: number) => Vec2): string {
  if (worldPoints.length < 3) return "";
  return worldPoints.map((p, i) => { const s = toScreen(p.x, p.y); return `${i === 0 ? "M" : "L"}${s.x.toFixed(2)} ${s.y.toFixed(2)}`; }).join(" ") + " Z";
}

function niceGridStep(scale: number): number {
  const rawStep = 60 / scale;
  const mag     = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm    = rawStep / mag;
  if (norm < 1.5) return mag;
  if (norm < 3.5) return 2 * mag;
  if (norm < 7.5) return 5 * mag;
  return 10 * mag;
}

function getCursorForHandle(h: ResizeHandle): React.CSSProperties["cursor"] {
  if (h === "n" || h === "s")   return "ns-resize";
  if (h === "e" || h === "w")   return "ew-resize";
  if (h === "ne" || h === "sw") return "nesw-resize";
  return "nwse-resize";
}

function extractFeatureRing(feature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null): [number, number][] {
  if (!feature) return [];
  if (feature.geometry.type === "Polygon") return feature.geometry.coordinates[0] as [number, number][];
  return (feature.geometry.coordinates[0]?.[0] ?? []) as [number, number][];
}

// ─── WORLD BOUNDS ─────────────────────────────────────────────────────

type WorldBounds = { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number; };

function computeWorldBounds(editor: PlanEditorHook, buildings: PlanBuildingWithTransform[]): WorldBounds {
  const allX: number[] = [];
  const allY: number[] = [];
  const push = (coords: [number, number][]) => { for (const [x, y] of coords) { allX.push(x); allY.push(y); } };
  push(extractFeatureRing(editor.project.site.parcel));
  push(extractFeatureRing(editor.project.site.buildableEnvelope));
  push(extractFeatureRing(editor.project.site.forbiddenBand));
  for (const b of buildings) for (const p of b.polygon) { allX.push(p.x); allY.push(p.y); }
  for (const pk of editor.project.parkings) for (const pt of pk.polygon) { allX.push(pt.x); allY.push(pt.y); }
  if (!allX.length) return { minX: 0, minY: 0, maxX: 100, maxY: 100, width: 100, height: 100 };
  const minX = Math.min(...allX), minY = Math.min(...allY), maxX = Math.max(...allX), maxY = Math.max(...allY);
  return { minX, minY, maxX, maxY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

// ─── COMPONENT ────────────────────────────────────────────────────────

interface PlanEditorCanvasProps {
  editor: PlanEditorHook;
  buildings: PlanBuildingWithTransform[];
  onUpdateBuilding: (building: PlanBuildingWithTransform) => void;
  pluStatus?: PluRuleStatus | null;
  buildableEnvelope?: Vec2[] | null;
  zoningOverlays?: ZoningOverlay[];
}

const PlanEditorCanvas: React.FC<PlanEditorCanvasProps> = ({
  editor,
  buildings,
  onUpdateBuilding,
  pluStatus       = null,
  buildableEnvelope = null,
  zoningOverlays  = [],
}) => {
  const [interaction, setInteraction] = useState<BuildingInteraction | null>(null);
  const [violatingIds, setViolatingIds] = useState<ReadonlySet<string>>(new Set());
  const lastValidRef = useRef<Map<string, PlanBuildingWithTransform>>(new Map());
  const [drawState, setDrawState] = useState<DrawState | null>(null);

  useEffect(() => {
    for (const b of buildings) { if (!lastValidRef.current.has(b.id)) lastValidRef.current.set(b.id, b); }
    for (const id of lastValidRef.current.keys()) { if (!buildings.some(b => b.id === id)) lastValidRef.current.delete(id); }
  }, [buildings]);

  // ── Snap ──────────────────────────────────────────────────────────
  const [shiftHeld, setShiftHeld] = useState(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === "Shift") setShiftHeld(true); };
    const up   = (e: KeyboardEvent) => { if (e.key === "Shift") setShiftHeld(false); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup",   up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  const snapConfig: SnapConfig = { enabled: shiftHeld, gridSize: SNAP_GRID_SIZE, scaleStep: SNAP_SCALE_STEP, angleStep: SNAP_ANGLE_STEP };

  // ── Parcel Vec2[] ─────────────────────────────────────────────────
  const parcelVec2 = useMemo<Vec2[] | null>(() => {
    const ring = extractFeatureRing(editor.project.site.parcel);
    if (ring.length < 3) return null;
    return ring.map(([x, y]) => ({ x, y }));
  }, [editor.project.site.parcel]);

  // ── Envelope violation ────────────────────────────────────────────
  const envelopeViolatingIds = useMemo<ReadonlySet<string>>(() => {
    if (!buildableEnvelope || buildableEnvelope.length < 3) return new Set();
    return new Set(buildings.filter(b => !isBuildingInsideEnvelope(b.polygon, buildableEnvelope)).map(b => b.id));
  }, [buildings, buildableEnvelope]);

  // ── Viewport ──────────────────────────────────────────────────────
  const stableBoundsRef = useRef<WorldBounds | null>(null);
  const liveBounds = useMemo(() => computeWorldBounds(editor, buildings), [editor, buildings]);
  const isInteracting = interaction !== null || !!editor.dragState || drawState !== null;
  if (!isInteracting) stableBoundsRef.current = liveBounds;
  const bounds = stableBoundsRef.current ?? liveBounds;

  const scale = Math.min(
    (VIEW_W - PADDING * 2) / bounds.width,
    (VIEW_H - PADDING * 2) / bounds.height,
  );

  // ── Debug init ────────────────────────────────────────────────────
  const debugRef = useRef(false);
  useEffect(() => {
    if (debugRef.current) return;
    debugRef.current = true;
    const ring = extractFeatureRing(editor.project.site.parcel);
    console.debug("[PlanEditorCanvas] INIT →", {
      hasParcel: !!editor.project.site.parcel, ringLength: ring.length,
      buildings: buildings.length, scale: scale.toFixed(2),
      bounds: { w: bounds.width.toFixed(1), h: bounds.height.toFixed(1) },
    });
  });

  // ── Transforms ────────────────────────────────────────────────────
  const toScreen = (x: number, y: number): Vec2 => ({
    x: PADDING + (x - bounds.minX) * scale,
    y: VIEW_H - (PADDING + (y - bounds.minY) * scale),
  });
  const toWorld = (sx: number, sy: number): Vec2 => ({
    x: (sx - PADDING) / scale + bounds.minX,
    y: bounds.minY + (VIEW_H - PADDING - sy) / scale,
  });
  const featureToPoints = (feature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null): string =>
    extractFeatureRing(feature).map(([x, y]) => { const p = toScreen(x, y); return `${p.x},${p.y}`; }).join(" ");

  // ── Cursor ────────────────────────────────────────────────────────
  const isDrawingTool = editor.activeTool === "building" || editor.activeTool === "parking";
  const svgCursor = ((): React.CSSProperties["cursor"] => {
    if (isDrawingTool)            return "crosshair";
    if (interaction?.type === "resize") return getCursorForHandle(interaction.handle);
    if (interaction?.type === "rotate") return "crosshair";
    if (interaction?.type === "drag")   return "grabbing";
    if (editor.dragState)               return "grabbing";
    return "default";
  })();

  // ── Snap grid ─────────────────────────────────────────────────────
  const snapGridLines = useMemo((): { v: number[]; h: number[] } => {
    if (!shiftHeld) return { v: [], h: [] };
    const step = niceGridStep(scale); const MAX = 120;
    const v: number[] = []; const h: number[] = [];
    for (let x = Math.ceil(bounds.minX / step) * step; x <= bounds.maxX + step * 0.5 && v.length < MAX; x += step) v.push(x);
    for (let y = Math.ceil(bounds.minY / step) * step; y <= bounds.maxY + step * 0.5 && h.length < MAX; y += step) h.push(y);
    return { v, h };
  }, [shiftHeld, scale, bounds]);

  // ── Constraint ────────────────────────────────────────────────────
  const applyConstraint = useCallback((attempted: PlanBuildingWithTransform): PlanBuildingWithTransform => {
    if (!parcelVec2) return attempted;
    const lastValid = lastValidRef.current.get(attempted.id) ?? attempted;
    const { valid, building } = constrainBuildingToParcel(attempted, parcelVec2, lastValid);
    if (valid) {
      lastValidRef.current.set(attempted.id, attempted);
      setViolatingIds(prev => { if (!prev.has(attempted.id)) return prev; const n = new Set(prev); n.delete(attempted.id); return n; });
    } else {
      setViolatingIds(prev => { if (prev.has(attempted.id)) return prev; return new Set([...prev, attempted.id]); });
    }
    return building;
  }, [parcelVec2]);

  // ── rectToWorldPolygon ────────────────────────────────────────────
  // Convertit deux coins écran en rectangle monde (4 sommets + fermeture).
  const rectToWorldPolygon = useCallback((a: Vec2, b: Vec2): Vec2[] => {
    const wA = toWorld(a.x, a.y);
    const wB = toWorld(b.x, b.y);
    return [
      { x: wA.x, y: wA.y },
      { x: wB.x, y: wA.y },
      { x: wB.x, y: wB.y },
      { x: wA.x, y: wB.y },
    ];
  }, [toWorld]);

  // ── Mouse handlers ────────────────────────────────────────────────

  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    const sx = e.nativeEvent.offsetX;
    const sy = e.nativeEvent.offsetY;

    // Mode dessin : démarre le tracé si clic sur fond (pas un élément)
    if (isDrawingTool && e.target === e.currentTarget) {
      e.stopPropagation();
      setDrawState({ startScreen: { x: sx, y: sy }, endScreen: { x: sx, y: sy } });
      return;
    }
    // Mode sélection : désélectionne si clic sur fond
    if (e.target === e.currentTarget) editor.clearSelection();
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const sx = e.nativeEvent.offsetX;
    const sy = e.nativeEvent.offsetY;

    // Mode dessin : met à jour le coin courant
    if (drawState) {
      setDrawState(prev => prev ? { ...prev, endScreen: { x: sx, y: sy } } : null);
      return;
    }

    // Mode sélection : interactions existantes
    if (interaction) {
      let attempted: PlanBuildingWithTransform | null = null;
      if (interaction.type === "drag") {
        const rawPos: Vec2 = { x: interaction.startBuilding.position.x + (sx - interaction.startScreenX) / interaction.viewScale, y: interaction.startBuilding.position.y - (sy - interaction.startScreenY) / interaction.viewScale };
        const newPos = snapConfig.enabled ? snapPosition(rawPos, snapConfig.gridSize) : rawPos;
        const b = interaction.startBuilding;
        attempted = { ...b, position: newPos, polygon: applyTransform({ ...b, position: newPos }) };
      } else if (interaction.type === "resize") {
        attempted = resizeBuilding(interaction.startBuilding, interaction.handle, { x: (sx - interaction.startScreenX) / interaction.viewScale, y: -(sy - interaction.startScreenY) / interaction.viewScale }, snapConfig);
      } else if (interaction.type === "rotate") {
        attempted = rotateBuilding(interaction.startBuilding, interaction.startMouseWorld, toWorld(sx, sy), snapConfig);
      }
      if (attempted) onUpdateBuilding(applyConstraint(attempted));
      return;
    }
    if (editor.dragState) editor.updateDrag(sx, sy);
  };

  const handleMouseUp = (e: React.MouseEvent<SVGSVGElement>) => {
    // Mode dessin : finalise le tracé
    if (drawState) {
      const { startScreen, endScreen } = drawState;
      const dx = Math.abs(endScreen.x - startScreen.x);
      const dy = Math.abs(endScreen.y - startScreen.y);
      if (dx >= MIN_DRAW_PX && dy >= MIN_DRAW_PX) {
        const polygon = rectToWorldPolygon(startScreen, endScreen);
        if (editor.activeTool === "building") {
          console.debug("[PlanEditorCanvas] draw building →", polygon);
          editor.addBuilding(polygon);
        } else if (editor.activeTool === "parking") {
          console.debug("[PlanEditorCanvas] draw parking →", polygon);
          editor.addParking(polygon);
        }
      } else {
        console.debug(`[PlanEditorCanvas] tracé trop petit (${dx}×${dy}px) — ignoré`);
      }
      setDrawState(null);
      return;
    }
    setInteraction(null);
    setViolatingIds(new Set());
    editor.endDrag();
  };

  // Interaction starters
  const startBuildingDrag   = (b: PlanBuildingWithTransform, sx: number, sy: number) => { lastValidRef.current.set(b.id, b); setInteraction({ type: "drag",   buildingId: b.id, startBuilding: { ...b }, startScreenX: sx, startScreenY: sy, viewScale: scale }); };
  const startBuildingResize = (b: PlanBuildingWithTransform, handle: ResizeHandle, sx: number, sy: number) => { lastValidRef.current.set(b.id, b); setInteraction({ type: "resize", buildingId: b.id, handle, startBuilding: { ...b }, startScreenX: sx, startScreenY: sy, viewScale: scale }); };
  const startBuildingRotate = (b: PlanBuildingWithTransform, sx: number, sy: number) => { lastValidRef.current.set(b.id, b); setInteraction({ type: "rotate", buildingId: b.id, startBuilding: { ...b }, startMouseWorld: toWorld(sx, sy), viewScale: scale }); };

  // ── Scène vide ────────────────────────────────────────────────────
  const isSceneEmpty = !editor.project.site.parcel && buildings.length === 0 && editor.project.parkings.length === 0;

  // ── Prévisualisation du tracé en cours ────────────────────────────
  const drawPreviewRect = drawState ? (() => {
    const { startScreen: a, endScreen: b } = drawState;
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
  })() : null;

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div style={{ width: "100%", height: "100%", padding: 16, boxSizing: "border-box" }}>
      <div style={{ position: "relative", width: "100%", height: "100%", background: "white", border: "1px solid #e2e8f0", borderRadius: 16, overflow: "hidden", boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.06)" }}>

        {/* Status badges */}
        <div style={{ position: "absolute", top: 16, right: 16, zIndex: 10, display: "flex", flexDirection: "column", gap: 6, pointerEvents: "none", userSelect: "none" }}>
          {isDrawingTool && (
            <span style={{ background: "rgba(124,111,205,0.90)", color: "white", fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", padding: "4px 10px", borderRadius: 20 }}>
              ✏ Mode {editor.activeTool === "building" ? "Bâtiment" : "Parking"} — Cliquez-glissez
            </span>
          )}
          {shiftHeld && <span style={{ background: "rgba(99,102,241,0.90)", color: "white", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", padding: "4px 10px", borderRadius: 20 }}>⌗ SNAP ON</span>}
          {violatingIds.size > 0 && <span style={{ background: "rgba(220,38,38,0.90)", color: "white", fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", padding: "4px 10px", borderRadius: 20 }}>⚠ Hors parcelle</span>}
          {envelopeViolatingIds.size > 0 && violatingIds.size === 0 && <span style={{ background: "rgba(234,88,12,0.90)", color: "white", fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", padding: "4px 10px", borderRadius: 20 }}>⚠ Hors enveloppe constructible</span>}
          {pluStatus === "BLOQUANT" && violatingIds.size === 0 && <span style={{ background: "rgba(185,28,28,0.88)", color: "white", fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", padding: "4px 10px", borderRadius: 20 }}>✗ Non conforme PLU</span>}
          {pluStatus === "LIMITE"   && violatingIds.size === 0 && <span style={{ background: "rgba(180,83,9,0.88)",  color: "white", fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", padding: "4px 10px", borderRadius: 20 }}>⚠ Conformité limite</span>}
        </div>

        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          width="100%" height="100%"
          style={{ display: "block", background: "#ffffff", cursor: svgCursor }}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onMouseDown={handleMouseDown}
        >
          {/* Grid */}
          <defs>
            <pattern id="plan-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(15,23,42,0.06)" strokeWidth="1" />
            </pattern>
          </defs>
          <rect x="0" y="0" width={VIEW_W} height={VIEW_H} fill="url(#plan-grid)" />

          {/* Snap grid */}
          {shiftHeld && (
            <g pointerEvents="none">
              {snapGridLines.v.map(wx => { const sx = toScreen(wx, 0).x; return <line key={`sv${wx}`} x1={sx} y1={0} x2={sx} y2={VIEW_H} stroke="rgba(99,102,241,0.18)" strokeWidth={1} />; })}
              {snapGridLines.h.map(wy => { const sy = toScreen(0, wy).y; return <line key={`sh${wy}`} x1={0} y1={sy} x2={VIEW_W} y2={sy} stroke="rgba(99,102,241,0.18)" strokeWidth={1} />; })}
            </g>
          )}

          {/* Parcelle — FILL (passe 1, en premier) */}
          {editor.project.site.parcel && (
            <polygon points={featureToPoints(editor.project.site.parcel)} fill="rgba(14,165,233,0.18)" stroke="none" pointerEvents="none" />
          )}

          {/* Zoning overlays */}
          {zoningOverlays.length > 0 && (() => {
            const sorted = sortZoningOverlays(zoningOverlays);
            return (
              <g pointerEvents="none">
                {sorted.map(overlay => {
                  if (overlay.polygon.length < 3) return null;
                  const style = mergeZoningStyle(getDefaultZoningStyle(overlay.kind), overlay.style);
                  const screenPoints = overlay.polygon.map(p => { const s = toScreen(p.x, p.y); return `${s.x},${s.y}`; }).join(" ");
                  const labelPos    = getOverlayLabelPosition(overlay);
                  const labelScreen = toScreen(labelPos.x, labelPos.y);
                  const labelW      = overlay.label.length * 5.2 + 12;
                  return (
                    <g key={overlay.id}>
                      <polygon points={screenPoints} fill={style.fill} fillOpacity={style.fillOpacity} stroke={style.stroke} strokeWidth={style.strokeWidth} strokeDasharray={style.dashArray === "none" ? undefined : style.dashArray} />
                      <g><rect x={labelScreen.x - labelW / 2} y={labelScreen.y - 8} width={labelW} height={15} rx={4} fill="rgba(255,255,255,0.88)" stroke={style.stroke} strokeWidth={0.75} strokeOpacity={0.6} /><text x={labelScreen.x} y={labelScreen.y + 4} textAnchor="middle" fontSize={8.5} fontWeight={700} letterSpacing="0.06em" fill={style.stroke} style={{ userSelect: "none" } as React.CSSProperties}>{overlay.label.toUpperCase()}</text></g>
                    </g>
                  );
                })}
              </g>
            );
          })()}

          {/* Buildable envelope */}
          {parcelVec2 && buildableEnvelope && buildableEnvelope.length >= 3 && (() => {
            const parcelPath   = worldPolygonToScreenPath(parcelVec2, toScreen);
            const envelopePath = worldPolygonToScreenPath(buildableEnvelope, toScreen);
            return (
              <g pointerEvents="none">
                <path d={`${parcelPath} ${envelopePath}`} fillRule="evenodd" fill="rgba(239,68,68,0.07)" stroke="none" />
                <path d={envelopePath} fill="rgba(99,102,241,0.04)" stroke="none" />
                <path d={envelopePath} fill="none" stroke="#6366f1" strokeWidth={1.75} strokeDasharray="8 5" opacity={0.85} />
              </g>
            );
          })()}

          {editor.project.site.buildableEnvelope && <polygon points={featureToPoints(editor.project.site.buildableEnvelope)} fill="rgba(34,197,94,0.12)" stroke="#16a34a" strokeWidth={2} strokeDasharray="8 6" />}
          {editor.project.site.forbiddenBand     && <polygon points={featureToPoints(editor.project.site.forbiddenBand)}     fill="rgba(239,68,68,0.12)" stroke="#dc2626" strokeWidth={2} strokeDasharray="8 6" />}

          {/* Buildings */}
          {buildings.map(b => {
            const isSelected          = editor.selected?.kind === "building" && editor.selected.id === b.id;
            const isParcelViolating   = violatingIds.has(b.id);
            const isEnvelopeViolating = !isParcelViolating && envelopeViolatingIds.has(b.id);
            const screenPoints  = b.polygon.map(p => { const s = toScreen(p.x, p.y); return `${s.x},${s.y}`; }).join(" ");
            const screenPolygon = b.polygon.map(p => toScreen(p.x, p.y));
            const screenBB      = getPolygonBounds(screenPolygon);
            const fillColor   = isParcelViolating ? COLOR_VIOLATION_FILL   : isEnvelopeViolating ? COLOR_SETBACK_FILL   : isSelected ? "rgba(245,158,11,0.55)" : "rgba(251,191,36,0.45)";
            const strokeColor = isParcelViolating ? COLOR_VIOLATION_STROKE : isEnvelopeViolating ? COLOR_SETBACK_STROKE : isSelected ? "#b45309" : "#92400e";
            const strokeWidth = isSelected || isParcelViolating || isEnvelopeViolating ? 3 : 2;
            const showFrame   = isSelected || isParcelViolating || isEnvelopeViolating;
            const frameColor  = isParcelViolating ? COLOR_VIOLATION_STROKE : isEnvelopeViolating ? COLOR_SETBACK_STROKE : shiftHeld ? "#6366f1" : "#f59e0b";
            return (
              <g key={b.id}>
                <polygon points={screenPoints} fill={fillColor} stroke={strokeColor} strokeWidth={strokeWidth}
                  style={{ cursor: isDrawingTool ? "crosshair" : "grab" }}
                  onMouseDown={e => {
                    if (isDrawingTool) return; // en mode dessin, les éléments existants ne bloquent pas
                    e.stopPropagation();
                    editor.selectBuilding(b.id);
                    startBuildingDrag(b, e.nativeEvent.offsetX, e.nativeEvent.offsetY);
                  }}
                  onClick={e => { if (!isDrawingTool) { e.stopPropagation(); editor.selectBuilding(b.id); } }}
                />
                {showFrame && <rect x={screenBB.minX - 6} y={screenBB.minY - 6} width={screenBB.width + 12} height={screenBB.height + 12} fill="none" stroke={frameColor} strokeWidth={2} strokeDasharray={isParcelViolating || isEnvelopeViolating ? "3 3" : "6 4"} pointerEvents="none" />}
                {isSelected && !isDrawingTool && <BuildingResizeHandles building={b} toScreen={toScreen} snapActive={shiftHeld} onHandleMouseDown={(h, sx, sy) => startBuildingResize(b, h, sx, sy)} />}
                {isSelected && !isDrawingTool && <BuildingRotationHandle building={b} toScreen={toScreen} snapActive={shiftHeld} onHandleMouseDown={(sx, sy) => startBuildingRotate(b, sx, sy)} />}
              </g>
            );
          })}

          {/* Parkings */}
          {editor.project.parkings.map(pk => {
            const points     = pk.polygon.map(pt => { const s = toScreen(pt.x, pt.y); return `${s.x},${s.y}`; }).join(" ");
            const isSelected = editor.selected?.kind === "parking" && editor.selected.id === pk.id;
            const screenBB   = getPolygonBounds(pk.polygon.map(pt => toScreen(pt.x, pt.y)));
            return (
              <g key={pk.id}>
                <polygon points={points} fill={isSelected ? "rgba(139,92,246,0.45)" : "rgba(196,181,253,0.45)"} stroke={isSelected ? "#6d28d9" : "#7c3aed"} strokeWidth={isSelected ? 3 : 2}
                  style={{ cursor: isDrawingTool ? "crosshair" : editor.dragState ? "grabbing" : "grab" }}
                  onMouseDown={e => {
                    if (isDrawingTool) return;
                    e.stopPropagation();
                    editor.beginDrag({ kind: "parking", id: pk.id }, e.nativeEvent.offsetX, e.nativeEvent.offsetY);
                  }}
                  onClick={e => { if (!isDrawingTool) { e.stopPropagation(); editor.selectParking(pk.id); } }}
                />
                {isSelected && <rect x={screenBB.minX - 6} y={screenBB.minY - 6} width={screenBB.width + 12} height={screenBB.height + 12} fill="none" stroke="#8b5cf6" strokeWidth={2} strokeDasharray="6 4" pointerEvents="none" />}
              </g>
            );
          })}

          {/* Parcelle — STROKE (passe 2, en dernier — toujours visible) */}
          {editor.project.site.parcel && (
            <polygon points={featureToPoints(editor.project.site.parcel)} fill="none" stroke="#0284c7" strokeWidth={3} pointerEvents="none" />
          )}

          {/* ── Prévisualisation du tracé en cours ── */}
          {drawPreviewRect && (
            <g pointerEvents="none">
              <rect
                x={drawPreviewRect.x}
                y={drawPreviewRect.y}
                width={drawPreviewRect.w}
                height={drawPreviewRect.h}
                fill={editor.activeTool === "building" ? "rgba(251,191,36,0.25)" : "rgba(196,181,253,0.30)"}
                stroke={editor.activeTool === "building" ? "#f59e0b" : "#7c3aed"}
                strokeWidth={2}
                strokeDasharray="8 4"
              />
              {/* Dimensions du tracé */}
              {drawPreviewRect.w > 30 && drawPreviewRect.h > 30 && (() => {
                const wWorld = drawPreviewRect.w / scale;
                const hWorld = drawPreviewRect.h / scale;
                return (
                  <text
                    x={drawPreviewRect.x + drawPreviewRect.w / 2}
                    y={drawPreviewRect.y + drawPreviewRect.h / 2}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={12}
                    fontWeight={600}
                    fill={editor.activeTool === "building" ? "#92400e" : "#5b21b6"}
                    style={{ userSelect: "none" } as React.CSSProperties}
                  >
                    {wWorld.toFixed(1)}m × {hWorld.toFixed(1)}m
                  </text>
                );
              })()}
            </g>
          )}
        </svg>

        {/* Overlay "aucune parcelle" */}
        {isSceneEmpty && (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "rgba(248,250,252,0.94)", borderRadius: 16, zIndex: 20, pointerEvents: "none", userSelect: "none" }}>
            <div style={{ textAlign: "center", maxWidth: 380, padding: "0 24px" }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>📐</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#1e293b", marginBottom: 10 }}>Parcelle non disponible dans l'éditeur</div>
              <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.65, marginBottom: 20 }}>
                La géométrie cadastrale n'a pas pu être chargée. Vous pouvez placer des bâtiments manuellement via la barre d'outils.
              </div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 16px", borderRadius: 10, background: "#fef3c7", border: "1px solid #fde68a", fontSize: 12, color: "#92400e", fontWeight: 600 }}>
                💡 Retournez dans <strong>Foncier</strong> et revalidez la sélection.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── RESIZE HANDLES ───────────────────────────────────────────────────

interface BuildingResizeHandlesProps {
  building: PlanBuildingWithTransform; toScreen: (x: number, y: number) => Vec2;
  snapActive: boolean; onHandleMouseDown: (handle: ResizeHandle, sx: number, sy: number) => void;
}
const BuildingResizeHandles: React.FC<BuildingResizeHandlesProps> = ({ building, toScreen, snapActive, onHandleMouseDown }) => {
  const worldPolygon = applyTransform(building);
  const handles = getResizeHandles(worldPolygon); const half = RESIZE_HANDLE_SIZE / 2;
  const stroke = snapActive ? "#6366f1" : "#f59e0b";
  return <>{handles.map(h => { const sp = toScreen(h.x, h.y); return <rect key={h.handle} x={sp.x - half} y={sp.y - half} width={RESIZE_HANDLE_SIZE} height={RESIZE_HANDLE_SIZE} rx={1.5} fill="white" stroke={stroke} strokeWidth={1.5} style={{ cursor: getCursorForHandle(h.handle) }} onMouseDown={e => { e.stopPropagation(); onHandleMouseDown(h.handle, e.nativeEvent.offsetX, e.nativeEvent.offsetY); }} />; })}</>;
};

// ─── ROTATION HANDLE ──────────────────────────────────────────────────

interface BuildingRotationHandleProps {
  building: PlanBuildingWithTransform; toScreen: (x: number, y: number) => Vec2;
  snapActive: boolean; onHandleMouseDown: (sx: number, sy: number) => void;
}
const BuildingRotationHandle: React.FC<BuildingRotationHandleProps> = ({ building, toScreen, snapActive, onHandleMouseDown }) => {
  const worldPolygon = applyTransform(building);
  const handleWorld  = getRotationHandle(worldPolygon);
  const handleScreen = toScreen(handleWorld.x, handleWorld.y);
  const bb           = getBoundingBox(worldPolygon);
  const stemAnchor   = toScreen(bb.centerX, bb.maxY);
  const stroke       = snapActive ? "#6366f1" : "#3b82f6";
  return <>
    <line x1={stemAnchor.x} y1={stemAnchor.y} x2={handleScreen.x} y2={handleScreen.y} stroke={stroke} strokeWidth={1.5} strokeDasharray="4 3" opacity={0.7} pointerEvents="none" />
    <circle cx={handleScreen.x} cy={handleScreen.y} r={ROTATION_HANDLE_R} fill="white" stroke={stroke} strokeWidth={1.5} style={{ cursor: "crosshair" }} onMouseDown={e => { e.stopPropagation(); onHandleMouseDown(e.nativeEvent.offsetX, e.nativeEvent.offsetY); }} />
    <circle cx={handleScreen.x} cy={handleScreen.y} r={2.5} fill={stroke} pointerEvents="none" />
  </>;
};

export default PlanEditorCanvas;