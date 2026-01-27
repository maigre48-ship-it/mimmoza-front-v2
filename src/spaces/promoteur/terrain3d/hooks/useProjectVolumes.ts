// ============================================================================
// FILE: src/spaces/promoteur/terrain3d/hooks/useProjectVolumes.ts
// ============================================================================

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Feature, FeatureCollection, Polygon } from 'geojson';
import type {
  ProjectVolumesState,
  ProjectVolumesData,
  ProjectVolume,
  VolumeType,
} from '../types/volume.types';
import {
  DEFAULT_BUILDING_HEIGHT,
  DEFAULT_PARKING_HEIGHT,
  DEFAULT_LEVEL_HEIGHT,
} from '../types/volume.types';
import type { StubGeometry } from '../three/createTerrainGeometry';
import { createVolumeGeometry } from '../three/createVolumeGeometry';
import { extractBBoxFromFeature, toBBox3D } from '../services/terrainSampling.service';

/**
 * Options du hook useProjectVolumes
 */
export interface UseProjectVolumesOptions {
  /** Hauteur par défaut des bâtiments */
  defaultBuildingHeight?: number;
  /** Hauteur par défaut des parkings */
  defaultParkingHeight?: number;
  /** Altitude de base */
  baseElevation?: number;
  /** Callback en cas d'erreur */
  onError?: (error: Error) => void;
}

/**
 * Résultat du hook useProjectVolumes
 */
export interface UseProjectVolumesResult extends ProjectVolumesState {
  /** Géométries des bâtiments (stubs) */
  buildingGeometries: StubGeometry[];
  /** Géométries des parkings (stubs) */
  parkingGeometries: StubGeometry[];
  /** Recalculer les volumes */
  recalculate: () => void;
}

/**
 * Convertit une feature en ProjectVolume
 */
function featureToVolume(
  feature: Feature<Polygon>,
  type: VolumeType,
  defaultHeight: number,
  baseElevation: number,
  index: number
): ProjectVolume {
  const height = (feature.properties?.height as number) ?? defaultHeight;
  const numLevels = Math.ceil(height / DEFAULT_LEVEL_HEIGHT);
  
  const bbox2d = extractBBoxFromFeature(feature as Feature<Polygon>);
  const area = (bbox2d.maxX - bbox2d.minX) * (bbox2d.maxY - bbox2d.minY); // Approximation
  
  const levels = Array.from({ length: numLevels }, (_, i) => ({
    index: i,
    floorElevation: baseElevation + i * DEFAULT_LEVEL_HEIGHT,
    height: DEFAULT_LEVEL_HEIGHT,
    area,
  }));
  
  return {
    id: (feature.id as string) ?? `${type}-${index}`,
    type,
    footprint: feature,
    levels,
    totalHeight: height,
    baseElevation,
    bbox: toBBox3D(bbox2d, baseElevation, baseElevation + height),
    metadata: feature.properties ?? {},
  };
}

/**
 * Hook pour gérer les volumes du projet (bâtiments, parkings, etc.)
 * 
 * TODO: Connecter aux vraies données projet
 */
export function useProjectVolumes(
  buildings: FeatureCollection<Polygon> | undefined,
  parkings: FeatureCollection<Polygon> | undefined,
  options: UseProjectVolumesOptions = {}
): UseProjectVolumesResult {
  const {
    defaultBuildingHeight = DEFAULT_BUILDING_HEIGHT,
    defaultParkingHeight = DEFAULT_PARKING_HEIGHT,
    baseElevation = 0,
    onError,
  } = options;
  
  const [state, setState] = useState<ProjectVolumesState>({
    isLoading: false,
    error: null,
    data: null,
  });
  
  const [buildingGeometries, setBuildingGeometries] = useState<StubGeometry[]>([]);
  const [parkingGeometries, setParkingGeometries] = useState<StubGeometry[]>([]);
  
  /**
   * Calcule les volumes à partir des features
   */
  const calculateVolumes = useCallback(() => {
    try {
      setState((prev) => ({ ...prev, isLoading: true }));
      
      // Convertir les bâtiments
      const buildingVolumes: ProjectVolume[] = (buildings?.features ?? []).map(
        (f, i) => featureToVolume(f, 'building', defaultBuildingHeight, baseElevation, i)
      );
      
      // Convertir les parkings
      const parkingVolumes: ProjectVolume[] = (parkings?.features ?? []).map(
        (f, i) => featureToVolume(f, 'parking', defaultParkingHeight, baseElevation, i)
      );
      
      // Calculer les totaux
      const totalFloorArea = [
        ...buildingVolumes,
        ...parkingVolumes,
      ].reduce((sum, vol) => {
        return sum + vol.levels.reduce((s, l) => s + l.area, 0);
      }, 0);
      
      const totalVolume = [
        ...buildingVolumes,
        ...parkingVolumes,
      ].reduce((sum, vol) => {
        const baseArea = vol.levels[0]?.area ?? 0;
        return sum + baseArea * vol.totalHeight;
      }, 0);
      
      const volumesData: ProjectVolumesData = {
        buildings: buildingVolumes,
        parkings: parkingVolumes,
        others: [],
        totalFloorArea,
        totalVolume,
      };
      
      // Créer les géométries
      const buildingGeoms = buildingVolumes.map((vol) =>
        createVolumeGeometry(vol.footprint, { height: vol.totalHeight })
      );
      const parkingGeoms = parkingVolumes.map((vol) =>
        createVolumeGeometry(vol.footprint, { height: vol.totalHeight })
      );
      
      setState({
        isLoading: false,
        error: null,
        data: volumesData,
      });
      setBuildingGeometries(buildingGeoms);
      setParkingGeometries(parkingGeoms);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setState({
        isLoading: false,
        error,
        data: null,
      });
      onError?.(error);
    }
  }, [buildings, parkings, defaultBuildingHeight, defaultParkingHeight, baseElevation, onError]);
  
  /**
   * Recalculer automatiquement quand les données changent
   */
  useEffect(() => {
    calculateVolumes();
  }, [calculateVolumes]);
  
  return {
    ...state,
    buildingGeometries,
    parkingGeometries,
    recalculate: calculateVolumes,
  };
}