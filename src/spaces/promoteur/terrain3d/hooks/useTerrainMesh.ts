// ============================================================================
// FILE: src/spaces/promoteur/terrain3d/hooks/useTerrainMesh.ts
// ============================================================================

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Feature, Polygon, MultiPolygon } from 'geojson';
import type {
  TerrainMeshState,
  TerrainData,
  TerrainConfig,
} from '../types/terrain.types';
import { DEFAULT_TERRAIN_CONFIG } from '../types/terrain.types';
import { getTerrainSamplingService } from '../services/terrainSampling.service';
import type { StubGeometry } from '../three/createTerrainGeometry';
import { createTerrainGeometry } from '../three/createTerrainGeometry';

/**
 * Options du hook useTerrainMesh
 */
export interface UseTerrainMeshOptions {
  /** Configuration du terrain */
  config?: Partial<TerrainConfig>;
  /** Activer le chargement automatique */
  autoLoad?: boolean;
  /** Callback en cas d'erreur */
  onError?: (error: Error) => void;
}

/**
 * Résultat du hook useTerrainMesh
 */
export interface UseTerrainMeshResult extends TerrainMeshState {
  /** Géométrie Three.js (stub) */
  geometry: StubGeometry | null;
  /** Recharger les données */
  reload: () => Promise<void>;
  /** Mettre à jour la configuration */
  updateConfig: (config: Partial<TerrainConfig>) => void;
}

/**
 * Hook pour gérer le mesh de terrain
 * 
 * TODO: Implémenter le chargement réel des données d'altimétrie
 */
export function useTerrainMesh(
  parcel: Feature<Polygon | MultiPolygon> | undefined,
  options: UseTerrainMeshOptions = {}
): UseTerrainMeshResult {
  const { config: initialConfig, autoLoad = true, onError } = options;
  
  const [state, setState] = useState<TerrainMeshState>({
    isLoading: false,
    error: null,
    data: null,
  });
  
  const [config, setConfig] = useState<TerrainConfig>({
    ...DEFAULT_TERRAIN_CONFIG,
    ...initialConfig,
  });
  
  const [geometry, setGeometry] = useState<StubGeometry | null>(null);
  
  /**
   * Charge les données de terrain
   */
  const loadTerrain = useCallback(async () => {
    if (!parcel) {
      setState({ isLoading: false, error: null, data: null });
      setGeometry(null);
      return;
    }
    
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    
    try {
      const service = getTerrainSamplingService(config);
      const terrainData = await service.sampleTerrain(parcel);
      
      // Créer la géométrie
      const geom = createTerrainGeometry(terrainData.grid, {
        verticalExaggeration: config.verticalExaggeration,
      });
      
      setState({
        isLoading: false,
        error: null,
        data: terrainData,
      });
      setGeometry(geom);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setState({
        isLoading: false,
        error,
        data: null,
      });
      setGeometry(null);
      onError?.(error);
    }
  }, [parcel, config, onError]);
  
  /**
   * Met à jour la configuration
   */
  const updateConfig = useCallback((newConfig: Partial<TerrainConfig>) => {
    setConfig((prev) => ({ ...prev, ...newConfig }));
  }, []);
  
  /**
   * Chargement automatique
   */
  useEffect(() => {
    if (autoLoad) {
      loadTerrain();
    }
  }, [autoLoad, loadTerrain]);
  
  return {
    ...state,
    geometry,
    reload: loadTerrain,
    updateConfig,
  };
}