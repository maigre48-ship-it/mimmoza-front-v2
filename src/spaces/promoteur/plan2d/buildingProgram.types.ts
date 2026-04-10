// src/spaces/promoteur/plan2d/buildingProgram.types.ts — V4
// FloorPlan2D contient maintenant ses propres éléments architecturaux (balcons/loggias/terrasses)

export type FacadeEdge        = 'north' | 'east' | 'south' | 'west';
export type RoofType          = 'flat'  | 'pitched' | 'attic';
export type BuildingType      = 'plot'  | 'barre' | 'angle' | 'villa' | 'residence';
export type BuildingVolumeRole = 'main' | 'wing'  | 'attic' | 'podium' | 'annex' | 'connector';

// ─── VOLUMES ──────────────────────────────────────────────────────────

export interface BuildingVolume2D {
  id:    string;
  rect:  { center:{x:number;y:number}; width:number; depth:number; rotationDeg:number };
  role?: BuildingVolumeRole;
}

// ─── ÉLÉMENTS DE FAÇADE ───────────────────────────────────────────────

export interface Balcon2D {
  id:         string;
  edge:       FacadeEdge;
  /** Décalage latéral en mètres depuis le milieu de la façade. */
  offsetM:    number;
  widthM:     number;
  /** Profondeur de saillie (perpendiculaire à la façade). */
  depthM:     number;
  levelStart: number;
  levelEnd:   number;
}

export interface Loggia2D {
  id:         string;
  edge:       FacadeEdge;
  offsetM:    number;
  widthM:     number;
  /** Profondeur de creusement vers l'intérieur. */
  depthM:     number;
  levelStart: number;
  levelEnd:   number;
}

export interface Terrasse2D {
  id:         string;
  kind:       'roof' | 'setback';
  edge?:      FacadeEdge;
  insetM?:    number;
  widthM:     number;
  depthM:     number;
  levelIndex: number;
}

// ─── PLAN D'ÉTAGE ─────────────────────────────────────────────────────
/**
 * Plan 2D d'un étage.
 *
 * Les éléments architecturaux (balcons, loggias, terrasses) sont
 * PROPRES À CET ÉTAGE. Modifier le R+1 ne touche pas le RDC.
 *
 * La duplication d'étage copie également ces éléments.
 */
export interface FloorPlan2D {
  id:         string;
  levelIndex: number;
  label:      string;
  volumes:    BuildingVolume2D[];
  // ── Éléments architecturaux de cet étage ──────────────────────────
  balconies?: Balcon2D[];
  loggias?:   Loggia2D[];
  terraces?:  Terrasse2D[];
}

// ─── NIVEAUX ──────────────────────────────────────────────────────────

export interface BuildingLevelProfile {
  levelIndex: number;
  kind:       'ground' | 'typical' | 'attic' | 'roof';
  heightM:    number;
  setbackEdges?: Partial<Record<FacadeEdge, number>>;
}

// ─── EXPORT JSON ──────────────────────────────────────────────────────

export interface ExportedBuildingVolume {
  id:string; role?:BuildingVolumeRole;
  footprint:{ center:{x:number;y:number}; width:number; depth:number; rotationDeg:number; polygonLocal:{x:number;y:number}[] };
}
export interface ExportedBuilding {
  id:string; label:string; buildingType?:BuildingType;
  footprint:{ center:{x:number;y:number}; width:number; depth:number; rotationDeg:number; polygonLocal:{x:number;y:number}[] };
  volumes:  ExportedBuildingVolume[];
  floorPlans?: {
    levelIndex:number; label:string;
    volumes:ExportedBuildingVolume[];
    balconies?:Balcon2D[]; loggias?:Loggia2D[]; terraces?:Terrasse2D[];
  }[];
  program:{ floorsAboveGround:number; groundFloorHeightM:number; typicalFloorHeightM:number; totalHeightM:number; roofType:RoofType; facadeMainEdge?:FacadeEdge };
  levels?:BuildingLevelProfile[];
}
export interface ExportedParking {
  id:string; footprint:{ center:{x:number;y:number}; width:number; depth:number; rotationDeg:number };
  slotCount:number; slotWidth:number; slotDepth:number;
}
export interface ExportedScene {
  version:"1.0"; exportedAt:string;
  site:{ parcelPolygon:{x:number;y:number}[] };
  buildings:ExportedBuilding[]; parkings:ExportedParking[];
}