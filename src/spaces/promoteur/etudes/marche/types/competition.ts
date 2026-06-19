// FILE: src/spaces/promoteur/etudes/marche/types/competition.ts
// À ajouter ou fusionner avec vos types existants

// ProjectType est défini de façon canonique dans market.types.ts.
// On le ré-exporte ici (et on l'utilise en interne) pour éviter une
// définition divergente (l'ancienne version locale avait "bureau" au lieu
// de "bureaux" et omettait residence_etudiante/hotel).
export type { ProjectType } from "./market.types";
import type { ProjectType } from "./market.types";

/**
 * Données d'un concurrent (EHPAD/établissement)
 */
export interface Competitor {
  id: string;
  name: string;
  type: string;
  address: string;
  lat: number;
  lon: number;
  capacity: number;
  distance: number; // Distance en km
  finess?: string;
  telephone?: string;
}

/**
 * Données de concurrence agrégées
 */
export interface CompetitionData {
  count: number;
  totalCapacity: number;
  avgCapacity: number;
  nearestDistance: number | null;
  competitors: Competitor[];
}

/**
 * Statut d'une source de données
 */
export type DataSourceStatus = "success" | "error" | "unavailable" | "loading";

/**
 * Résultat d'une source de données
 */
export interface DataSourceResult<T> {
  status: DataSourceStatus;
  data: T | null;
  error?: string;
}

/**
 * Données démographiques
 */
export interface DemographicsData {
  population: number;
  pop75Plus?: number;
  popGrowth?: number;
  density?: number;
}

/**
 * Données immobilières
 */
export interface RealEstateData {
  medianPrice: number;
  avgPrice?: number;
  transactionCount?: number;
}

/**
 * Résultat complet de l'étude de marché
 */
export interface MarketStudyResult {
  // Métadonnées
  projectType: ProjectType;
  location: { lat: number; lon: number };
  communeInsee: string | null;
  radiusKm: number;
  generatedAt: string;

  // Sources de données
  dataSources: {
    insee: DataSourceResult<any>;
    finess: DataSourceResult<CompetitionData>;
    dvf: DataSourceResult<any>;
    bpe: DataSourceResult<any>;
  };

  // Données agrégées
  competition: CompetitionData;
  demographics: DemographicsData | null;
  realEstate: RealEstateData | null;
  pois: any;
}