// FILE: src/spaces/promoteur/etudes/marche/types/marketStudy.types.ts

// ─────────────────────────────────────────────────────────────
// REQUEST
// ─────────────────────────────────────────────────────────────
export interface MarketStudyRequest {
  lat?: number;
  lon?: number;
  commune_insee?: string;
  context?: "urban" | "rural";
  radius_km?: number;
  top_n?: number;
}

// ─────────────────────────────────────────────────────────────
// RESPONSE (aligné sur le contrat API)
// ─────────────────────────────────────────────────────────────
export interface MarketStudyResponse {
  version: "market-study-v1";
  request: MarketStudyRequest;
  meta: Meta;
  location: Location;
  context: ContextInfo;
  insee: InseeData;
  pois: PoisData;
  kpis: Kpis;
  comps: CompsData;
}

export interface MarketStudyError {
  version: "market-study-v1";
  error: string;
  status: number;
}

export interface Meta {
  generated_at: string;
  sources: {
    overpass: boolean;
    insee: boolean;
    dvf: boolean;
  };
  warnings: string[];
}

export interface Location {
  lat: number;
  lon: number;
  commune_insee?: string;
  commune_nom?: string;
}

export interface ContextInfo {
  context: "urban" | "rural";
  radius_km: number;
}

// ─────────────────────────────────────────────────────────────
// INSEE
// ─────────────────────────────────────────────────────────────
export interface InseeData {
  insee_partial: boolean;
  population?: number;
  population_year?: number;
  densite_hab_km2?: number;
  taux_chomage?: number;
  taux_pauvrete?: number;
  pct_proprietaires?: number;
  revenu_median?: number;
  pyramide_ages?: {
    "0-14"?: number;
    "15-29"?: number;
    "30-44"?: number;
    "45-59"?: number;
    "60-74"?: number;
    "75+"?: number;
  };
}

// ─────────────────────────────────────────────────────────────
// POI
// ─────────────────────────────────────────────────────────────
export type PoiCategory =
  | "commerces"
  | "medecins"
  | "infirmiers"
  | "specialistes"
  | "pharmacies"
  | "hopitaux"
  | "gendarmerie_police"
  | "ecoles"
  | "creches"
  | "stations_service"
  | "banques";

export const POI_CATEGORY_LABELS: Record<PoiCategory, string> = {
  commerces: "Commerces",
  medecins: "Médecins",
  infirmiers: "Infirmiers",
  specialistes: "Spécialistes",
  pharmacies: "Pharmacies",
  hopitaux: "Hôpitaux",
  gendarmerie_police: "Police/Gendarmerie",
  ecoles: "Écoles",
  creches: "Crèches",
  stations_service: "Stations-service",
  banques: "Banques",
};

export const POI_CATEGORY_ICONS: Record<PoiCategory, string> = {
  commerces: "🛒",
  medecins: "👨‍⚕️",
  infirmiers: "💉",
  specialistes: "🏥",
  pharmacies: "💊",
  hopitaux: "🏨",
  gendarmerie_police: "👮",
  ecoles: "🎓",
  creches: "👶",
  stations_service: "⛽",
  banques: "🏦",
};

export interface Poi {
  id: string;
  category: PoiCategory;
  name?: string;
  lat: number;
  lon: number;
  distance_km: number;
  tags?: Record<string, string>;
}

export interface PoisData {
  categories: Record<PoiCategory, Poi[]>;
  all: Poi[];
}

// ─────────────────────────────────────────────────────────────
// KPIS
// ─────────────────────────────────────────────────────────────
export interface Kpis {
  counts: Record<PoiCategory, number>;
  nearest: Record<PoiCategory, number | null>;
}

// ─────────────────────────────────────────────────────────────
// DVF / COMPS
// ─────────────────────────────────────────────────────────────
export interface DvfTransaction {
  id: string;
  date_mutation: string;
  nature_mutation: string;
  valeur_fonciere: number;
  adresse?: string;
  code_postal?: string;
  commune?: string;
  type_local?: string;
  surface_reelle_bati?: number;
  nombre_pieces_principales?: number;
  surface_terrain?: number;
  lat?: number;
  lon?: number;
  distance_km?: number;
  prix_m2?: number;
}

export interface CompsData {
  dvf_available: boolean;
  items: DvfTransaction[];
}

// ─────────────────────────────────────────────────────────────
// HOOK STATE
// ─────────────────────────────────────────────────────────────
export interface MarketStudyState {
  data: MarketStudyResponse | null;
  loading: boolean;
  error: string | null;
}

export interface MarketStudyParams {
  lat?: number;
  lon?: number;
  commune_insee?: string;
  context?: "urban" | "rural";
  radius_km?: number;
}