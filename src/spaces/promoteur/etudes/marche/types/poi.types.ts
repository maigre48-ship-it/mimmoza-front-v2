// FILE: src/spaces/promoteur/etudes/marche/types/poi.types.ts

/** Catégorie de POI */
export type PoiCategoryId = 
  | "hospital"
  | "emergency"
  | "pharmacy"
  | "general_practitioner"
  | "specialist"
  | "supermarket"
  | "grocery"
  | "bakery"
  | "bank"
  | "atm"
  | "post_office"
  | "gas_station"
  | "police"
  | "gendarmerie"
  | "fire_station"
  | "school_primary"
  | "school_secondary"
  | "high_school"
  | "university"
  | "daycare"
  | "bus_stop"
  | "train_station"
  | "metro"
  | "parking"
  | "restaurant"
  | "hotel"
  | "ehpad"
  | "rss"
  | "student_residence"
  | "coworking"
  | "congress_center"
  | "sports"
  | "cinema"
  | "library"
  | "park";

/** Définition d'une catégorie de POI */
export interface PoiCategory {
  id: PoiCategoryId;
  label: string;
  labelPlural: string;
  icon: string;
  color: string;
  bpeCode?: string;
  osmTag?: string;
}

/** POI individuel */
export interface Poi {
  id: string;
  category: PoiCategoryId;
  name: string;
  lat: number;
  lon: number;
  distance: number;
  commune?: string;
  address?: string;
  
  // Métadonnées spécifiques
  metadata?: {
    capacity?: number;
    occupancyRate?: number;
    stars?: number;
    type?: string;
    phone?: string;
    website?: string;
    openingHours?: string;
  };
}

/** Résultat de recherche POI par catégorie */
export interface PoiSearchResult {
  category: PoiCategoryId;
  count: number;
  items: Poi[];
  nearest?: Poi;
  radiusKm: number;
}

/** Priorité de POI selon le type de projet */
export type PoiPriority = "critical" | "important" | "secondary";

/** Configuration POI pour un type de projet */
export interface PoiProjectConfig {
  category: PoiCategoryId;
  priority: PoiPriority;
  maxRadius: number;
  minExpected?: number;
  scoreWeight?: number;
}