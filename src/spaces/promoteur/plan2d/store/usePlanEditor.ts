// src/spaces/promoteur/plan2d/store/usePlanEditor.ts
//
// V1.1 — Ajout du mode outil actif + méthodes de création
//
// NOUVEAUTÉS :
//   • activeTool : "select" | "building" | "parking" | "cotes"
//   • setActiveTool(tool) : change le mode du curseur/canvas
//   • addBuilding(polygon) : crée un nouveau bâtiment et revient en "select"
//   • addParking(polygon)  : crée un nouveau parking et revient en "select"

import { useCallback, useMemo, useState } from "react";
import type { PlanBuilding, PlanParking, PlanProject, Vec2 } from "../plan.types";
import { translatePolygon } from "../geometry/plan.geometry";

// ── Types ──────────────────────────────────────────────────────────────────────

export type ActiveTool = "select" | "building" | "parking" | "cotes";

type SelectedEntity =
  | { kind: "building"; id: string }
  | { kind: "parking";  id: string }
  | null;

type DragState = {
  entity:     SelectedEntity;
  startMouse: { x: number; y: number };
} | null;

// ── Hook ──────────────────────────────────────────────────────────────────────

export function usePlanEditor(initialProject: PlanProject) {
  const [project,     setProject]     = useState<PlanProject>(initialProject);
  const [selected,    setSelected]    = useState<SelectedEntity>(null);
  const [dragState,   setDragState]   = useState<DragState>(null);
  const [activeTool,  setActiveTool]  = useState<ActiveTool>("select");

  // ── Dérivés ───────────────────────────────────────────────────────
  const selectedBuilding = useMemo<PlanBuilding | null>(() => {
    if (!selected || selected.kind !== "building") return null;
    return project.buildings.find(b => b.id === selected.id) ?? null;
  }, [project.buildings, selected]);

  const selectedParking = useMemo<PlanParking | null>(() => {
    if (!selected || selected.kind !== "parking") return null;
    return project.parkings.find(p => p.id === selected.id) ?? null;
  }, [project.parkings, selected]);

  // ── Sélection ──────────────────────────────────────────────────────
  const selectBuilding = useCallback((id: string) => setSelected({ kind: "building", id }), []);
  const selectParking  = useCallback((id: string) => setSelected({ kind: "parking",  id }), []);
  const clearSelection = useCallback(() => setSelected(null), []);

  // ── Drag (déplacement parking via editor) ─────────────────────────
  const beginDrag = useCallback(
    (entity: SelectedEntity, mouseX: number, mouseY: number) => {
      if (!entity) return;
      setDragState({ entity, startMouse: { x: mouseX, y: mouseY } });
      setSelected(entity);
    },
    [],
  );

  const updateDrag = useCallback((mouseX: number, mouseY: number) => {
    setDragState(prev => {
      if (!prev?.entity) return prev;
      const dx = mouseX - prev.startMouse.x;
      const dy = mouseY - prev.startMouse.y;
      if (dx === 0 && dy === 0) return prev;

      setProject(current => {
        if (prev.entity?.kind === "building") {
          return {
            ...current,
            buildings: current.buildings.map(b =>
              b.id === prev.entity?.id
                ? { ...b, polygon: translatePolygon(b.polygon, dx, dy) }
                : b,
            ),
          };
        }
        if (prev.entity?.kind === "parking") {
          return {
            ...current,
            parkings: current.parkings.map(p =>
              p.id === prev.entity?.id
                ? { ...p, polygon: translatePolygon(p.polygon, dx, dy) }
                : p,
            ),
          };
        }
        return current;
      });

      return { ...prev, startMouse: { x: mouseX, y: mouseY } };
    });
  }, []);

  const endDrag = useCallback(() => setDragState(null), []);

  // ── Création de géométries ─────────────────────────────────────────
  //
  // addBuilding / addParking sont appelés par PlanEditorCanvas à la fin
  // d'un tracé rectangulaire (mouseup après click-drag en mode dessin).
  // Le tool repasse automatiquement en "select" après création.

  const addBuilding = useCallback((polygon: Vec2[]) => {
    if (polygon.length < 3) return;
    const id = `building-${Date.now()}`;
    const newBuilding: PlanBuilding = {
      id,
      polygon,
      rotationDeg:        0,
      levels:             2,
      groundFloorHeightM: 2.8,
      typicalFloorHeightM: 2.7,
      usage:              "logement",
      name:               `Bâtiment`,
    };
    setProject(prev => ({
      ...prev,
      buildings: [...prev.buildings, newBuilding],
    }));
    setSelected({ kind: "building", id });
    setActiveTool("select");
    console.debug(`[usePlanEditor] addBuilding → id=${id}, points=${polygon.length}`);
  }, []);

  const addParking = useCallback((polygon: Vec2[]) => {
    if (polygon.length < 3) return;
    const id = `parking-${Date.now()}`;
    const newParking: PlanParking = {
      id,
      polygon,
      kind: "surface",
    };
    setProject(prev => ({
      ...prev,
      parkings: [...prev.parkings, newParking],
    }));
    setSelected({ kind: "parking", id });
    setActiveTool("select");
    console.debug(`[usePlanEditor] addParking → id=${id}, points=${polygon.length}`);
  }, []);

  // ── Suppression ───────────────────────────────────────────────────
  const deleteSelected = useCallback(() => {
    if (!selected) return;
    setProject(prev => ({
      ...prev,
      buildings: selected.kind === "building"
        ? prev.buildings.filter(b => b.id !== selected.id)
        : prev.buildings,
      parkings: selected.kind === "parking"
        ? prev.parkings.filter(p => p.id !== selected.id)
        : prev.parkings,
    }));
    setSelected(null);
  }, [selected]);

  // ── Mise à jour projet ────────────────────────────────────────────
  const updateProject = useCallback(
    (updater: (prev: PlanProject) => PlanProject) => setProject(prev => updater(prev)),
    [],
  );

  return {
    project, setProject, updateProject,

    selected, selectedBuilding, selectedParking,
    selectBuilding, selectParking, clearSelection,

    activeTool, setActiveTool,
    addBuilding, addParking, deleteSelected,

    dragState, beginDrag, updateDrag, endDrag,
  };
}