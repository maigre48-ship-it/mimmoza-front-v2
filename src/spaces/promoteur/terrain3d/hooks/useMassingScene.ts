// ============================================================================
// FILE: src/spaces/promoteur/terrain3d/hooks/useMassingScene.ts
// ============================================================================

import { useState, useCallback, useMemo, useEffect } from 'react';
import type { Feature, FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import type { EarthworksKPIs } from '../types/earthworks.types';
import { EMPTY_EARTHWORKS_KPIS } from '../types/earthworks.types';
import { useTerrainMesh, type UseTerrainMeshResult } from './useTerrainMesh';
import { useProjectVolumes, type UseProjectVolumesResult } from './useProjectVolumes';
import { getSlopeService } from '../services/slope.service';
import { getEarthworksService } from '../services/earthworks.service';
import type { StubMaterial } from '../three/materials';
import { createSceneMaterials, disposeSceneMaterials } from '../three/materials';

/**
 * État de visibilité des éléments
 */
export interface SceneVisibility {
  terrain: boolean;
  buildings: boolean;
  parkings: boolean;
  wireframe: boolean;
  earthworks: boolean;
}

/**
 * Mode de visualisation du terrain
 */
export type TerrainViewMode = 'natural' | 'project';

/**
 * Options du hook useMassingScene
 */
export interface UseMassingSceneOptions {
  /** Visibilité initiale */
  initialVisibility?: Partial<SceneVisibility>;
  /** Mode de vue initial */
  initialViewMode?: TerrainViewMode;
}

/**
 * Résultat du hook useMassingScene
 */
export interface UseMassingSceneResult {
  /** État du terrain */
  terrain: UseTerrainMeshResult;
  /** État des volumes */
  volumes: UseProjectVolumesResult;
  /** KPIs de terrassement */
  kpis: EarthworksKPIs;
  /** Visibilité des éléments */
  visibility: SceneVisibility;
  /** Mode de visualisation du terrain */
  viewMode: TerrainViewMode;
  /** Matériaux de la scène */
  materials: Record<string, StubMaterial>;
  /** Chargement global en cours */
  isLoading: boolean;
  /** Erreur globale */
  error: Error | null;
  /** Toggle visibilité d'un élément */
  toggleVisibility: (key: keyof SceneVisibility) => void;
  /** Définir la visibilité */
  setVisibility: (visibility: Partial<SceneVisibility>) => void;
  /** Changer le mode de vue */
  setViewMode: (mode: TerrainViewMode) => void;
  /** Recharger toute la scène */
  reloadScene: () => Promise<void>;
}

/**
 * Visibilité par défaut
 */
const DEFAULT_VISIBILITY: SceneVisibility = {
  terrain: true,
  buildings: true,
  parkings: true,
  wireframe: false,
  earthworks: false,
};

/**
 * Hook principal pour gérer la scène de massing 3D
 * 
 * Orchestre les hooks terrain, volumes et calculs de terrassement
 */
export function useMassingScene(
  parcel: Feature<Polygon | MultiPolygon> | undefined,
  buildings: FeatureCollection<Polygon> | undefined,
  parkings: FeatureCollection<Polygon> | undefined,
  options: UseMassingSceneOptions = {}
): UseMassingSceneResult {
  const {
    initialVisibility = {},
    initialViewMode = 'natural',
  } = options;
  
  // État local
  const [visibility, setVisibilityState] = useState<SceneVisibility>({
    ...DEFAULT_VISIBILITY,
    ...initialVisibility,
  });
  const [viewMode, setViewMode] = useState<TerrainViewMode>(initialViewMode);
  const [kpis, setKpis] = useState<EarthworksKPIs>(EMPTY_EARTHWORKS_KPIS);
  
  // Hooks terrain et volumes
  const terrain = useTerrainMesh(parcel);
  const volumes = useProjectVolumes(buildings, parkings, {
    baseElevation: terrain.data?.bbox.minZ ?? 0,
  });
  
  // Matériaux (créés une fois)
  const materials = useMemo(() => createSceneMaterials(), []);
  
  // Nettoyage des matériaux
  useEffect(() => {
    return () => {
      disposeSceneMaterials(materials);
    };
  }, [materials]);
  
  // Calcul des KPIs quand le terrain change
  useEffect(() => {
    if (!terrain.data) {
      setKpis(EMPTY_EARTHWORKS_KPIS);
      return;
    }
    
    const slopeService = getSlopeService();
    const earthworksService = getEarthworksService();
    
    const slopeData = slopeService.computeSlopeData(terrain.data.grid);
    const earthworksResult = parcel
      ? earthworksService.computeEarthworks(terrain.data.grid, parcel)
      : null;
    
    const newKpis = earthworksService.computeKPIs(
      terrain.data.grid,
      earthworksResult,
      slopeData.averageSlope,
      slopeData.maxSlope
    );
    
    setKpis(newKpis);
  }, [terrain.data, parcel]);
  
  // Actions
  const toggleVisibility = useCallback((key: keyof SceneVisibility) => {
    setVisibilityState((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }, []);
  
  const setVisibility = useCallback((newVisibility: Partial<SceneVisibility>) => {
    setVisibilityState((prev) => ({
      ...prev,
      ...newVisibility,
    }));
  }, []);
  
  const reloadScene = useCallback(async () => {
    await terrain.reload();
    volumes.recalculate();
  }, [terrain, volumes]);
  
  // États agrégés
  const isLoading = terrain.isLoading || volumes.isLoading;
  const error = terrain.error ?? volumes.error;
  
  return {
    terrain,
    volumes,
    kpis,
    visibility,
    viewMode,
    materials,
    isLoading,
    error,
    toggleVisibility,
    setVisibility,
    setViewMode,
    reloadScene,
  };
}