// FILE: src/spaces/promoteur/etudes/marche/types/project.types.ts

import { LucideIcon } from "lucide-react";

/** Types de projets supportés */
export type ProjectType = 
  | "logement"
  | "residence_senior"
  | "ehpad"
  | "residence_etudiante"
  | "bureaux"
  | "commerce"
  | "hotel";

/** Segment démographique cible */
export interface DemographicSegment {
  id: string;
  label: string;
  ageRange?: [number, number];
  inseeField: string;
  color: string;
  isPrimary: boolean;
}

/** Configuration des rayons d'analyse */
export interface RadiusConfig {
  critical: number;    // km - services critiques
  important: number;   // km - services importants
  secondary: number;   // km - services secondaires
  analysis: number;    // km - rayon global d'analyse
}

/** Pondération pour le calcul de score */
export interface ScoreWeights {
  demographics: number;
  market: number;
  competition: number;
  services: number;
  accessibility: number;
  healthcare?: number;
}

/** Configuration complète d'un type de projet */
export interface ProjectTypeConfig {
  id: ProjectType;
  label: string;
  icon: LucideIcon;
  color: string;
  description: string;
  
  // Segments démographiques
  demographicSegments: DemographicSegment[];
  primaryDemographicField: string;
  
  // KPIs
  primaryKpis: string[];
  secondaryKpis: string[];
  
  // POI
  criticalPoiCategories: string[];
  importantPoiCategories: string[];
  secondaryPoiCategories: string[];
  
  // Rayons
  radius: RadiusConfig;
  
  // Pondérations score
  scoreWeights: ScoreWeights;
  
  // Sources de données requises
  requiredDataSources: DataSourceType[];
  
  // Insights prioritaires
  insightsPriority: string[];
  
  // Champs spécifiques à afficher
  specificFields: string[];
}

/** Types de sources de données */
export type DataSourceType = "insee" | "finess" | "dvf" | "bpe" | "mesr" | "adt" | "sirene";

/** Statut d'une source de données */
export interface DataSourceStatus {
  source: DataSourceType;
  available: boolean;
  year?: number;
  coverage?: "complete" | "partial" | "unavailable";
  lastUpdate?: string;
}