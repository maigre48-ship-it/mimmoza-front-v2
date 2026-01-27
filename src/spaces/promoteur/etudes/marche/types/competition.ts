// FILE: src/spaces/promoteur/etudes/marche/types/competition.ts
// À ajouter ou fusionner avec vos types existants

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

/**
 * Types de projets supportés
 */
export type ProjectType = "ehpad" | "residence_senior" | "logement" | "commerce" | "bureau";