// src/spaces/promoteur/plan2d/editor2d.types.ts — V4 multi-étages

import type {
  FacadeEdge, RoofType, BuildingType,
  BuildingVolume2D, FloorPlan2D, BuildingLevelProfile,
  Balcon2D, Loggia2D, Terrasse2D,
} from './buildingProgram.types';

export type { FacadeEdge, RoofType, BuildingType, BuildingVolume2D, FloorPlan2D };

// ─── PRIMITIVES ───────────────────────────────────────────────────────

export interface Point2D    { x: number; y: number; }
export interface OrientedRect { center:Point2D; width:number; depth:number; rotationDeg:number; }

// ─── BUILDING2D V4 ────────────────────────────────────────────────────
/**
 * Building2D V4 — architecture multi-étages.
 *
 * `floorPlans[]` contient un plan par étage (FloorPlan2D).
 * Chaque étage a ses propres volumes 2D indépendants.
 *
 * `rect` = bounding box du RDC (niveau 0), utilisé comme ancre de drag.
 *
 * Migration V1/V2/V3 :
 *   - `volumes[]` → `floorPlans[{levelIndex:0, volumes:[...]}]`
 *   - `levels`    → `floorsAboveGround`
 */
export interface Building2D {
  id:   string;
  kind: 'building';
  /** Bounding box du RDC — ancre de drag et de handles. */
  rect: OrientedRect;
  label: string;

  // ── Plans d'étages ────────────────────────────────────────────────
  floorPlans: FloorPlan2D[];

  // ── Programme volumétrique ────────────────────────────────────────
  floorsAboveGround:   number;
  groundFloorHeightM:  number;
  typicalFloorHeightM: number;
  roofType?:           RoofType;
  facadeMainEdge?:     FacadeEdge;
  buildingType?:       BuildingType;

  // ── Programme architectural ───────────────────────────────────────
  levelProfiles?: BuildingLevelProfile[];
  balconies?:     Balcon2D[];
  loggias?:       Loggia2D[];
  terraces?:      Terrasse2D[];

  // ── Compat V1/V2/V3 (nettoyé à la migration) ─────────────────────
  /** @deprecated → migré vers floorPlans[0] */
  volumes?: BuildingVolume2D[];
  /** @deprecated → migré vers floorsAboveGround */
  levels?:  number;
}

export interface Parking2D {
  id:string; kind:'parking'; rect:OrientedRect;
  slotWidth:number; slotDepth:number; driveAisleWidth:number; slotCount:number;
}

// ─── ÉDITEUR ──────────────────────────────────────────────────────────

export type Tool     = 'selection'|'building'|'parking';
export type HandleId =
  | 'resize-nw'|'resize-n'|'resize-ne'|'resize-e'
  | 'resize-se'|'resize-s'|'resize-sw'|'resize-w'|'rotate';

export interface DrawState { tool:'building'|'parking'; origin:Point2D; current:Point2D; square:boolean; fromCenter:boolean; }
export interface DragState { type:'move'|'resize'|'rotate'; entityId:string; handle?:HandleId; startWorld:Point2D; originalRect:OrientedRect; startAngleDeg?:number; }
export interface SnapOptions { grid:boolean; gridSize:number; parcelleVertices:boolean; parcelleEdges:boolean; orthogonal:boolean; thresholdPx:number; }
export interface CotesVisibility { buildingDims:boolean; parcelleSetbacks:boolean; interBuilding:boolean; parkingDims:boolean; }

// ─── STORE ────────────────────────────────────────────────────────────

export interface Editor2DState {
  activeTool:         Tool;
  buildings:          Building2D[];
  parkings:           Parking2D[];
  selectedIds:        string[];
  hoveredId:          string | null;
  snapOptions:        SnapOptions;
  cotesVisible:       boolean;
  cotesVisibility:    CotesVisibility;
  /** Index de l'étage actif dans le sélecteur. 0 = RDC. */
  activeLevelIndex:   number;
  /** Afficher l'étage N-1 en transparence (ghost). */
  showGhost:          boolean;
  /** Arête de la parcelle désignée comme façade terrain. null = non définie. */
  parcelFrontEdgeIndex: number | null;
  /** Règles de recul PLU pour l'enveloppe constructible. */
  setbackRules: { frontM:number; sideM:number; rearM:number };
}

export interface Editor2DActions {
  setTool:              (tool: Tool) => void;
  addBuilding:          (b: Building2D) => void;
  addParking:           (p: Parking2D)  => void;
  updateBuildingRect:   (id: string, rect: OrientedRect, persist?: boolean) => void;
  updateParkingRect:    (id: string, rect: OrientedRect, persist?: boolean) => void;
  updateBuildingProgram:(id: string, patch: Partial<Building2D>) => void;
  /**
   * Mise à jour partielle d'un plan d'étage d'un bâtiment.
   * Utilisé pour ajouter/modifier/supprimer des balcons, loggias, terrasses.
   */
  updateFloorPlan:      (buildingId: string, levelIndex: number, patch: Partial<FloorPlan2D>) => void;
  mergeBuildings:       (ids: string[]) => void;
  splitBuilding:        (id: string) => void;
  deleteSelected:       () => void;
  duplicateSelected:    () => void;
  selectIds:            (ids: string[], add?: boolean) => void;
  clearSelection:       () => void;
  setHovered:           (id: string | null) => void;
  setCotesVisible:      (v: boolean) => void;
  setCotesVisibility:   (patch: Partial<CotesVisibility>) => void;
  loadSnapshot:         (buildings: Building2D[], parkings: Parking2D[]) => void;
  // ── Multi-étages ──────────────────────────────────────────────────
  /** Changer l'étage actif. */
  setActiveLevelIndex:     (idx: number) => void;
  /** Afficher/masquer le ghost de l'étage N-1. */
  setShowGhost:            (v: boolean) => void;
  /** Ajouter un étage vide à tous les bâtiments. */
  addFloorToAll:           (levelIndex: number) => void;
  /** Dupliquer l'étage N-1 → étage actif pour tous les bâtiments. */
  duplicateFloorToActive:  () => void;
  /** Supprimer un étage de tous les bâtiments. */
  removeFloor:             (levelIndex: number) => void;
  // ── Enveloppe PLU / Façade terrain ────────────────────────────────
  /** Définit l'arête de la parcelle désignée comme façade terrain. */
  setParcelFrontEdge:  (idx: number | null) => void;
  /** Met à jour les règles de recul. */
  setSetbackRules:     (patch: Partial<{frontM:number;sideM:number;rearM:number}>) => void;
}