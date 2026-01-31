// FILE: src/spaces/promoteur/etudes/marche/types/market.types.ts
// Contrats types minimaux alignés sur MarchePage.tsx (UI)
// Objectif: figer la forme de result.market sans inventer de champs

export type ProjectType =
  | "logement"
  | "residence_senior"
  | "residence_etudiante"
  | "ehpad"
  | "bureaux"
  | "commerce"
  | "hotel";

export type DataSourceType =
  | "insee"
  | "finess"
  | "dvf"
  | "bpe"
  | "mesr"
  | "adt"
  | "sirene";

export interface AddressSuggestion {
  label: string;
  lat: number;
  lon: number;
  citycode?: string; // INSEE
  // optionnels : certains services d'adresse peuvent fournir ces infos
  postcode?: string;
  city?: string;
}

export interface ParcelInfo {
  id: string;
  lat?: number;
  lon?: number;
  commune_insee?: string;
}

export interface InseeData {
  code_commune?: string;
  commune?: string;
  departement?: string;

  population?: number | null;

  // ✅ utilisé par MarchePage (densité fallback) / affichage surface
  surface_km2?: number | null;

  densite?: number | null;

  // dynamiques
  evolution_pop_5ans?: number | null;

  // revenus / social
  revenu_median?: number | null; // €/an
  taux_chomage?: number | null;

  // segments age (noms alignés avec ton UI actuel)
  pct_moins_15?: number | null;
  pct_moins_25?: number | null;
  pct_15_29?: number | null;
  pct_25_39?: number | null;
  pct_30_44?: number | null;
  pct_45_59?: number | null;

  pct_plus_60?: number | null;
  pct_plus_65?: number | null;
  pct_plus_75?: number | null;
  pct_plus_85?: number | null;

  evolution_75_plus_5ans?: number | null;
}

export interface ServiceProche {
  nom?: string | null;
  commune?: string | null;
  distance_km?: number | null;
  distance_m?: number | null;
}

export interface PricesData {
  median_eur_m2?: number | null;
  min_eur_m2?: number | null;
  q1_eur_m2?: number | null;
  q3_eur_m2?: number | null;
  max_eur_m2?: number | null;
  evolution_1an?: number | null; // %
}

export interface TransactionsData {
  count?: number | null;
}

/**
 * ✅ BPE tel qu'utilisé dans MarchePage.tsx :
 * - extractBpeData lit `bpe.source` (string ou objet)
 * - ServicesCard affiche un badge OSM/OVERPASS
 */
export interface BpeData {
  nb_commerces?: number | null;
  nb_sante?: number | null;
  nb_services?: number | null;
  nb_enseignement?: number | null;
  nb_sport_culture?: number | null;

  source?:
    | string
    | {
        provider: string;
        note?: string;
      };
}

// correspond à ce que ServicesCard lit via services.supermarche_proche etc.
// Tu peux étendre sans casser l’UI, mais on reste minimal.
export interface ServicesRuraux {
  supermarche_proche?: ServiceProche | null;
  superette_proche?: ServiceProche | null;
  station_service_proche?: ServiceProche | null;
  banque_proche?: ServiceProche | null;
  poste_proche?: ServiceProche | null;

  medecin_proche?: ServiceProche | null;
  pharmacie_proche?: ServiceProche | null;

  gendarmerie_proche?: ServiceProche | null;
  commissariat_proche?: ServiceProche | null;

  // fallback générique si backend renvoie d’autres clés
  [k: string]: ServiceProche | null | undefined;
}

/**
 * ✅ Nouveau: market.shops (vient de market-context-v1)
 * - Top 5 par catégorie avec name + distance_m
 * - Sert à alimenter ServicesCard quand smartscore/services_ruraux sont absents
 */
export type OsmElementType = "node" | "way" | "relation";

export interface ShopTopItem {
  name: string;
  distance_m: number;
  osm_type: OsmElementType;
  osm_id: number;
  lat?: number;
  lon?: number;
}

export interface ShopCategory {
  count: number;
  top: ShopTopItem[];
}

export interface MarketShops {
  radius_m_used: number;
  categories: {
    supermarket?: ShopCategory;
    fuel?: ShopCategory;
    bank_atm?: ShopCategory;
    post?: ShopCategory;
    doctor?: ShopCategory;
    pharmacy?: ShopCategory;
    gendarmerie?: ShopCategory;
    commissariat?: ShopCategory;
    // si le backend ajoute d'autres catégories plus tard
    [k: string]: ShopCategory | undefined;
  };
  source?: {
    provider: string;
    note?: string;
  };
}

export interface EhpadFacility {
  nom: string;
  commune: string;
  distance_km: number;

  capacite?: number;
  finess?: string;
  adresse?: string;
  telephone?: string;
  prix_journalier?: number;
  taux_occupation?: number;
}

export interface EhpadAnalyseConcurrence {
  capacite_totale?: number;
  densite_lits_1000_seniors?: number;
  verdict?: string;
}

export interface EHPADData {
  count: number;
  liste: EhpadFacility[];
  analyse_concurrence?: EhpadAnalyseConcurrence;
}

// insights affichés en UI
export interface MarketInsight {
  type: "positive" | "opportunity" | "warning" | "negative";
  title: string;
  description: string;
  value?: string;
}

// transport affiché comme market.transport?.score
export interface TransportData {
  score?: number | null;
}

// result.market consommé dans MarchePage.tsx
export interface MarketData {
  score?: number | null;
  verdict?: string | null;

  insights?: MarketInsight[] | null;

  insee?: InseeData | null;

  prices?: PricesData | null;
  transactions?: TransactionsData | null;

  // comps passés à PrixImmobilierCard mais pas utilisés en détail dans ton extrait
  comps?: any[] | null;

  bpe?: BpeData | null;
  services_ruraux?: ServicesRuraux | null;

  // ✅ Nouveau : utilisé par ServicesCard (fallback top5)
  shops?: MarketShops | null;

  ehpad?: EHPADData | null;

  demographieScore?: number | null;
  commoditesScore?: number | null;
  transport?: TransportData | null;

  // UNIQUEMENT utilisé pour ehpad / résidence senior (UI)
  healthScore?: number | null;
}

export interface MarketStudyInput {
  resolved_point?: { lat: number; lon: number } | null;
  radius_km?: number | null;
  commune_insee?: string | null;
}

export interface MarketStudyResult {
  success: boolean;

  // setAnalysisResult(result) => result.market
  market?: MarketData | null;

  // utilisé dans MarketStudyResults: data.input?.resolved_point etc.
  input?: MarketStudyInput | null;

  zone_type?: string | null;

  error?: string | null;
  message?: string | null;
}
