// ============================================================================
// FILE: src/spaces/promoteur/terrain3d/services/terrainSampling.service.ts
// ============================================================================

import type { Feature, Polygon, MultiPolygon, Position } from 'geojson';
import type {
  TerrainGrid,
  TerrainData,
  TerrainConfig,
  BBox2D,
  BBox3D,
  ElevationSample,
} from '../types/terrain.types';
import { DEFAULT_TERRAIN_CONFIG } from '../types/terrain.types';
import { createEmptyTerrainGrid, computeOptimalGridStep } from '../utils/grid.utils';

/**
 * Extrait la bounding box d'une feature GeoJSON Polygon/MultiPolygon
 */
export function extractBBoxFromFeature(
  feature: Feature<Polygon | MultiPolygon>
): BBox2D {
  const coords: Position[] = [];
  
  const geometry = feature.geometry;
  if (geometry.type === 'Polygon') {
    geometry.coordinates.forEach((ring) => coords.push(...ring));
  } else if (geometry.type === 'MultiPolygon') {
    geometry.coordinates.forEach((polygon) =>
      polygon.forEach((ring) => coords.push(...ring))
    );
  }
  
  if (coords.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  
  for (const coord of coords) {
    minX = Math.min(minX, coord[0]);
    minY = Math.min(minY, coord[1]);
    maxX = Math.max(maxX, coord[0]);
    maxY = Math.max(maxY, coord[1]);
  }
  
  return { minX, minY, maxX, maxY };
}

/**
 * Crée une BBox3D à partir d'une BBox2D et de valeurs Z
 */
export function toBBox3D(bbox2d: BBox2D, minZ: number, maxZ: number): BBox3D {
  return {
    ...bbox2d,
    minZ,
    maxZ,
  };
}

/**
 * Service de sampling du terrain
 * 
 * TODO: Implémenter le fetch réel vers une API d'altimétrie (IGN, etc.)
 */
export class TerrainSamplingService {
  private config: TerrainConfig;
  
  constructor(config: Partial<TerrainConfig> = {}) {
    this.config = { ...DEFAULT_TERRAIN_CONFIG, ...config };
  }
  
  /**
   * Échantillonne le terrain pour une parcelle donnée
   * 
   * TODO: Implémenter l'appel à l'API d'altimétrie
   * Pour l'instant, retourne une grille plate à l'altitude par défaut
   */
  async sampleTerrain(
    parcel: Feature<Polygon | MultiPolygon>
  ): Promise<TerrainData> {
    const bbox2d = extractBBoxFromFeature(parcel);
    const step = computeOptimalGridStep(bbox2d);
    
    // TODO: Remplacer par un vrai fetch d'altimétrie
    const grid = createEmptyTerrainGrid(bbox2d, step, this.config.defaultElevation);
    
    const bbox3d = toBBox3D(
      bbox2d,
      this.config.defaultElevation,
      this.config.defaultElevation
    );
    
    return {
      parcel,
      grid,
      bbox: bbox3d,
      config: this.config,
    };
  }
  
  /**
   * Échantillonne l'altitude à une position donnée
   * 
   * TODO: Implémenter le fetch réel
   */
  async sampleElevationAt(position: Position): Promise<ElevationSample> {
    // TODO: Appeler l'API d'altimétrie
    return {
      position,
      elevation: this.config.defaultElevation,
      source: 'default',
    };
  }
  
  /**
   * Échantillonne l'altitude à plusieurs positions
   * 
   * TODO: Implémenter le batch fetch
   */
  async sampleElevationsAt(positions: Position[]): Promise<ElevationSample[]> {
    // TODO: Appeler l'API d'altimétrie en batch
    return positions.map((position) => ({
      position,
      elevation: this.config.defaultElevation,
      source: 'default' as const,
    }));
  }
  
  /**
   * Met à jour la configuration
   */
  updateConfig(config: Partial<TerrainConfig>): void {
    this.config = { ...this.config, ...config };
  }
  
  /**
   * Récupère la configuration actuelle
   */
  getConfig(): TerrainConfig {
    return { ...this.config };
  }
}

/**
 * Instance singleton du service
 */
let serviceInstance: TerrainSamplingService | null = null;

/**
 * Récupère l'instance du service (singleton)
 */
export function getTerrainSamplingService(
  config?: Partial<TerrainConfig>
): TerrainSamplingService {
  if (!serviceInstance) {
    serviceInstance = new TerrainSamplingService(config);
  } else if (config) {
    serviceInstance.updateConfig(config);
  }
  return serviceInstance;
}

/**
 * Réinitialise le service (utile pour les tests)
 */
export function resetTerrainSamplingService(): void {
  serviceInstance = null;
}