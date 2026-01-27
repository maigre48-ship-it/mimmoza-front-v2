// ============================================================================
// FILE: src/spaces/promoteur/terrain3d/types/volume.types.ts
// ============================================================================

import type { Feature, FeatureCollection, Polygon } from 'geojson';
import type { Point3D, BBox3D } from './terrain.types';

/**
 * Type de volume projeté
 */
export type VolumeType = 'building' | 'parking' | 'infrastructure' | 'vegetation';

/**
 * Définition d'un niveau/étage
 */
export interface VolumeLevel {
  /** Index du niveau (0 = RDC, -1 = sous-sol, etc.) */
  index: number;
  /** Altitude du plancher bas */
  floorElevation: number;
  /** Hauteur du niveau */
  height: number;
  /** Surface au sol */
  area: number;
}

/**
 * Volume 3D d'un bâtiment ou élément
 */
export interface ProjectVolume {
  /** Identifiant unique */
  id: string;
  /** Type de volume */
  type: VolumeType;
  /** Emprise au sol (GeoJSON Polygon) */
  footprint: Feature<Polygon>;
  /** Niveaux du volume */
  levels: VolumeLevel[];
  /** Hauteur totale */
  totalHeight: number;
  /** Altitude de base (terrain naturel ou plateforme) */
  baseElevation: number;
  /** Bounding box 3D */
  bbox: BBox3D;
  /** Métadonnées optionnelles */
  metadata?: Record<string, unknown>;
}

/**
 * Collection de volumes du projet
 */
export interface ProjectVolumesData {
  buildings: ProjectVolume[];
  parkings: ProjectVolume[];
  others: ProjectVolume[];
  /** Surface totale de plancher */
  totalFloorArea: number;
  /** Volume total */
  totalVolume: number;
}

/**
 * État des volumes projet
 */
export interface ProjectVolumesState {
  isLoading: boolean;
  error: Error | null;
  data: ProjectVolumesData | null;
}

/**
 * Props pour le composant ProjectVolumes
 */
export interface ProjectVolumesProps {
  buildings?: FeatureCollection<Polygon>;
  parkings?: FeatureCollection<Polygon>;
  visible?: boolean;
  showBuildings?: boolean;
  showParkings?: boolean;
  /** Hauteur par défaut des bâtiments si non spécifiée */
  defaultBuildingHeight?: number;
  /** Hauteur par défaut des parkings si non spécifiée */
  defaultParkingHeight?: number;
}

/**
 * Configuration d'extrusion de volume
 */
export interface VolumeExtrusionConfig {
  /** Hauteur d'extrusion */
  height: number;
  /** Décalage de base */
  baseOffset: number;
  /** Biseautage des arêtes */
  bevelEnabled: boolean;
  /** Taille du biseau */
  bevelSize: number;
}

/**
 * Vertex d'un volume pour le mesh
 */
export interface VolumeVertex {
  position: Point3D;
  normal: Point3D;
  uv: { u: number; v: number };
}

/**
 * Valeurs par défaut
 */
export const DEFAULT_BUILDING_HEIGHT = 9; // 3 étages × 3m
export const DEFAULT_PARKING_HEIGHT = 2.5;
export const DEFAULT_LEVEL_HEIGHT = 3;