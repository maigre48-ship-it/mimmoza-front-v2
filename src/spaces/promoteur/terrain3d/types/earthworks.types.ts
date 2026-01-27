// ============================================================================
// FILE: src/spaces/promoteur/terrain3d/types/earthworks.types.ts
// ============================================================================

import type { Feature, Polygon, MultiPolygon } from 'geojson';
import type { Point3D, TerrainGrid } from './terrain.types';

/**
 * Type de mouvement de terre
 */
export type EarthworkType = 'cut' | 'fill';

/**
 * Zone de terrassement
 */
export interface EarthworkZone {
  /** Identifiant unique */
  id: string;
  /** Type (déblai ou remblai) */
  type: EarthworkType;
  /** Emprise de la zone */
  boundary: Feature<Polygon>;
  /** Volume en m³ */
  volume: number;
  /** Profondeur/hauteur moyenne */
  averageDepth: number;
  /** Profondeur/hauteur max */
  maxDepth: number;
  /** Surface impactée en m² */
  area: number;
}

/**
 * Résultat de calcul des terrassements
 */
export interface EarthworksResult {
  /** Zones de déblai */
  cutZones: EarthworkZone[];
  /** Zones de remblai */
  fillZones: EarthworkZone[];
  /** Volume total de déblai en m³ */
  totalCutVolume: number;
  /** Volume total de remblai en m³ */
  totalFillVolume: number;
  /** Balance (positif = excédent, négatif = déficit) */
  balance: number;
  /** Ratio déblai/remblai */
  cutFillRatio: number;
}

/**
 * Données de pente
 */
export interface SlopeData {
  /** Pente moyenne en % */
  averageSlope: number;
  /** Pente max en % */
  maxSlope: number;
  /** Pente min en % */
  minSlope: number;
  /** Direction de la pente principale (azimut en degrés) */
  mainDirection: number;
  /** Grille des pentes [row][col] */
  slopeGrid: number[][];
}

/**
 * Configuration de plateforme projet
 */
export interface PlatformConfig {
  /** Altitude de la plateforme */
  elevation: number;
  /** Mode de calcul de l'altitude */
  elevationMode: 'fixed' | 'average' | 'min' | 'max' | 'custom';
  /** Pente de talus pour déblai (ratio H:V) */
  cutSlopeRatio: number;
  /** Pente de talus pour remblai (ratio H:V) */
  fillSlopeRatio: number;
}

/**
 * Profil de terrain le long d'une ligne
 */
export interface TerrainProfile {
  /** Points du profil */
  points: Array<{
    distance: number;
    elevation: number;
    position: Point3D;
  }>;
  /** Longueur totale */
  totalLength: number;
  /** Dénivelé total */
  totalElevationChange: number;
}

/**
 * KPIs de terrassement pour l'affichage
 */
export interface EarthworksKPIs {
  /** Pente moyenne du terrain naturel */
  naturalSlope: number | null;
  /** Pente max du terrain naturel */
  maxSlope: number | null;
  /** Volume de déblai */
  cutVolume: number | null;
  /** Volume de remblai */
  fillVolume: number | null;
  /** Balance */
  balance: number | null;
  /** Coût estimé (optionnel) */
  estimatedCost: number | null;
}

/**
 * État des calculs de terrassement
 */
export interface EarthworksState {
  isLoading: boolean;
  error: Error | null;
  slopeData: SlopeData | null;
  earthworksResult: EarthworksResult | null;
  kpis: EarthworksKPIs;
}

/**
 * Valeurs par défaut des KPIs
 */
export const EMPTY_EARTHWORKS_KPIS: EarthworksKPIs = {
  naturalSlope: null,
  maxSlope: null,
  cutVolume: null,
  fillVolume: null,
  balance: null,
  estimatedCost: null,
};

/**
 * Configuration par défaut de plateforme
 */
export const DEFAULT_PLATFORM_CONFIG: PlatformConfig = {
  elevation: 0,
  elevationMode: 'average',
  cutSlopeRatio: 1,
  fillSlopeRatio: 1.5,
};