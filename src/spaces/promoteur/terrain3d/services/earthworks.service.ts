// ============================================================================
// FILE: src/spaces/promoteur/terrain3d/services/earthworks.service.ts
// ============================================================================

import type { Feature, Polygon, MultiPolygon } from 'geojson';
import type { TerrainGrid } from '../types/terrain.types';
import type {
  EarthworksResult,
  EarthworkZone,
  PlatformConfig,
  EarthworksKPIs,
} from '../types/earthworks.types';
import { DEFAULT_PLATFORM_CONFIG, EMPTY_EARTHWORKS_KPIS } from '../types/earthworks.types';

/**
 * Service de calcul des terrassements (déblai/remblai)
 * 
 * TODO: Implémenter les calculs volumétriques réels
 */
export class EarthworksService {
  private platformConfig: PlatformConfig;
  
  constructor(config: Partial<PlatformConfig> = {}) {
    this.platformConfig = { ...DEFAULT_PLATFORM_CONFIG, ...config };
  }
  
  /**
   * Calcule les terrassements pour une emprise projet sur un terrain
   * 
   * TODO: Implémenter le calcul réel des volumes
   * Pour l'instant, retourne des valeurs nulles/vides
   */
  computeEarthworks(
    terrainGrid: TerrainGrid,
    projectFootprint: Feature<Polygon | MultiPolygon>,
    platformElevation?: number
  ): EarthworksResult {
    // TODO: Calculer l'altitude de plateforme selon le mode configuré
    const _targetElevation = platformElevation ?? this.computePlatformElevation(terrainGrid);
    
    // TODO: Calculer les zones de déblai
    const cutZones: EarthworkZone[] = [];
    
    // TODO: Calculer les zones de remblai
    const fillZones: EarthworkZone[] = [];
    
    // TODO: Calculer les volumes
    const totalCutVolume = 0;
    const totalFillVolume = 0;
    const balance = totalCutVolume - totalFillVolume;
    const cutFillRatio = totalFillVolume > 0 ? totalCutVolume / totalFillVolume : 0;
    
    return {
      cutZones,
      fillZones,
      totalCutVolume,
      totalFillVolume,
      balance,
      cutFillRatio,
    };
  }
  
  /**
   * Calcule l'altitude de plateforme selon le mode configuré
   * 
   * TODO: Implémenter les différents modes
   */
  computePlatformElevation(terrainGrid: TerrainGrid): number {
    const { elevationMode, elevation } = this.platformConfig;
    
    switch (elevationMode) {
      case 'fixed':
        return elevation;
      case 'average':
        return this.computeAverageElevation(terrainGrid);
      case 'min':
        return this.computeMinElevation(terrainGrid);
      case 'max':
        return this.computeMaxElevation(terrainGrid);
      case 'custom':
        return elevation;
      default:
        return this.computeAverageElevation(terrainGrid);
    }
  }
  
  /**
   * Calcule l'altitude moyenne de la grille
   */
  private computeAverageElevation(grid: TerrainGrid): number {
    let total = 0;
    let count = 0;
    
    for (const row of grid.elevations) {
      for (const elev of row) {
        total += elev;
        count++;
      }
    }
    
    return count > 0 ? total / count : 0;
  }
  
  /**
   * Calcule l'altitude min de la grille
   */
  private computeMinElevation(grid: TerrainGrid): number {
    let min = Infinity;
    
    for (const row of grid.elevations) {
      for (const elev of row) {
        min = Math.min(min, elev);
      }
    }
    
    return min === Infinity ? 0 : min;
  }
  
  /**
   * Calcule l'altitude max de la grille
   */
  private computeMaxElevation(grid: TerrainGrid): number {
    let max = -Infinity;
    
    for (const row of grid.elevations) {
      for (const elev of row) {
        max = Math.max(max, elev);
      }
    }
    
    return max === -Infinity ? 0 : max;
  }
  
  /**
   * Génère les KPIs de terrassement pour l'affichage
   * 
   * TODO: Connecter aux vrais calculs
   */
  computeKPIs(
    terrainGrid: TerrainGrid | null,
    earthworksResult: EarthworksResult | null,
    slopeAverage: number | null,
    slopeMax: number | null
  ): EarthworksKPIs {
    if (!terrainGrid) {
      return { ...EMPTY_EARTHWORKS_KPIS };
    }
    
    return {
      naturalSlope: slopeAverage,
      maxSlope: slopeMax,
      cutVolume: earthworksResult?.totalCutVolume ?? null,
      fillVolume: earthworksResult?.totalFillVolume ?? null,
      balance: earthworksResult?.balance ?? null,
      estimatedCost: null, // TODO: Calculer le coût estimé
    };
  }
  
  /**
   * Met à jour la configuration de plateforme
   */
  updateConfig(config: Partial<PlatformConfig>): void {
    this.platformConfig = { ...this.platformConfig, ...config };
  }
  
  /**
   * Récupère la configuration actuelle
   */
  getConfig(): PlatformConfig {
    return { ...this.platformConfig };
  }
}

/**
 * Instance singleton du service
 */
let earthworksServiceInstance: EarthworksService | null = null;

/**
 * Récupère l'instance du service (singleton)
 */
export function getEarthworksService(
  config?: Partial<PlatformConfig>
): EarthworksService {
  if (!earthworksServiceInstance) {
    earthworksServiceInstance = new EarthworksService(config);
  } else if (config) {
    earthworksServiceInstance.updateConfig(config);
  }
  return earthworksServiceInstance;
}

/**
 * Réinitialise le service (utile pour les tests)
 */
export function resetEarthworksService(): void {
  earthworksServiceInstance = null;
}