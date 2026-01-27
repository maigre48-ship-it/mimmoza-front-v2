// ============================================================================
// FILE: src/spaces/promoteur/terrain3d/types/terrain.types.ts
// ============================================================================

import type { Feature, Polygon, MultiPolygon, Position } from 'geojson';

/**
 * Point 3D avec coordonnées x, y, z
 */
export interface Point3D {
  x: number;
  y: number;
  z: number;
}

/**
 * Grille d'échantillonnage du terrain
 */
export interface TerrainGrid {
  /** Origine de la grille (coin bas-gauche) */
  origin: Point3D;
  /** Nombre de colonnes */
  cols: number;
  /** Nombre de lignes */
  rows: number;
  /** Pas de la grille en mètres */
  step: number;
  /** Altitudes échantillonnées [row][col] */
  elevations: number[][];
}

/**
 * Bounding box 2D
 */
export interface BBox2D {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Bounding box 3D
 */
export interface BBox3D extends BBox2D {
  minZ: number;
  maxZ: number;
}

/**
 * Configuration du terrain
 */
export interface TerrainConfig {
  /** Résolution de la grille en mètres */
  gridResolution: number;
  /** Exagération verticale pour visualisation */
  verticalExaggeration: number;
  /** Altitude par défaut si pas de données */
  defaultElevation: number;
}

/**
 * Données de terrain parsées
 */
export interface TerrainData {
  /** Parcelle source */
  parcel: Feature<Polygon | MultiPolygon>;
  /** Grille d'élévation */
  grid: TerrainGrid;
  /** Bounding box 3D */
  bbox: BBox3D;
  /** Configuration utilisée */
  config: TerrainConfig;
}

/**
 * État du mesh terrain
 */
export interface TerrainMeshState {
  isLoading: boolean;
  error: Error | null;
  data: TerrainData | null;
}

/**
 * Props pour le composant TerrainMesh
 */
export interface TerrainMeshProps {
  parcel?: Feature<Polygon | MultiPolygon>;
  visible?: boolean;
  wireframe?: boolean;
  config?: Partial<TerrainConfig>;
}

/**
 * Résultat d'échantillonnage d'altitude
 */
export interface ElevationSample {
  position: Position;
  elevation: number;
  source: 'api' | 'interpolated' | 'default';
}

/**
 * Configuration par défaut du terrain
 */
export const DEFAULT_TERRAIN_CONFIG: TerrainConfig = {
  gridResolution: 5,
  verticalExaggeration: 1,
  defaultElevation: 0,
};