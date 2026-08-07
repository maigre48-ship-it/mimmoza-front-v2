// src/spaces/shared/risques/riskStudy.types.ts
// ============================================================================
// SOCLE PARTAGÉ — TYPES DE L'ÉTUDE DE RISQUES        VERSION 1.0.0
// ============================================================================
// Source unique de vérité pour RisquesPage (promoteur) et InvestisseurRisquesPanel.
// Aligné sur risk-study-v1 @ 1.1.1.
//
// Règle qui gouverne tout ce fichier :
//   `null` ne veut pas dire « zéro », il veut dire « on ne sait pas ».
//   Une source muette n'est pas une absence de risque. Les types portent donc
//   la nullabilité jusqu'à l'affichage, pour que le rendu ne puisse pas
//   fabriquer une valeur rassurante à partir d'un trou de donnée.
// ============================================================================

export type RiskLevel = 'tres_fort' | 'fort' | 'moyen' | 'faible' | 'nul' | 'inconnu';
export type InsightType = 'critical' | 'warning' | 'positive' | 'info';

/** Couverture déclarée par une source. `no_data` / `error` = non mesuré. */
export type Coverage = 'ok' | 'partial' | 'no_data' | 'error' | string;

/**
 * Scores de SÉCURITÉ (100 = sûr). Nullables depuis risk-study v1.1.0 :
 * `null` = catégorie NON MESURÉE (aucune source publique n'a répondu).
 * Ne jamais l'afficher comme une note, ni le traiter comme rassurant.
 */
export interface RiskScores {
  global: number | null;
  naturels: number | null;
  technologiques: number | null;
  pollution: number | null;
  geotechniques: number | null;
  // Indicateurs de confiance (v1.1.0)
  criteres_mesures?: number;
  criteres_total?: number;
  categories_mesurees?: string[];
  categories_non_mesurees?: string[];
  poids_effectifs?: Record<string, number>;
  coverage?: Coverage;
}

export interface RiskItem {
  name: string;
  level: RiskLevel;
  detail: string;
}

export interface RiskCategory {
  name: string;
  score: number | null;
  level: RiskLevel;
  coverage?: Coverage;
  criteres_mesures?: number;
  criteres_total?: number;
  risks: RiskItem[];
}

export interface Insight {
  type: InsightType;
  category: string;
  message: string;
}

export interface CatnatEvent {
  code_national_catnat: string;
  date_debut: string;
  date_fin: string;
  date_publication_jo: string;
  libelle_risque: string;
}

/**
 * GASPAR. `coverage` distingue « l'API a répondu 0 arrêté » (information)
 * de « l'API n'a pas répondu » (absence d'information) — risk-study v1.1.0,
 * où `coverage` est déduit du succès HTTP et non du nombre de résultats.
 */
export interface GasparData {
  catnat_count: number;
  catnat_events: CatnatEvent[];
  ppr_count: number;
  ppr_list: Array<{ code: string; libelle: string; etat: string }>;
  coverage: Coverage;
  /** v1.1.1 — le décompte a été tronqué par la pagination. */
  truncated?: boolean;
}

export interface RadonData {
  /** risk-study v1.1.1 : Géorisques renvoie une chaîne, coercée en amont. */
  classe_potentiel: number | null;
  libelle: string;
  risk_level: RiskLevel;
  coverage: Coverage;
}

export interface Installation {
  nom: string;
  raison_sociale: string;
  adresse: string;
  commune: string;
  regime: string;
  seveso: string | null;
  distance_m: number | null;
  activite: string;
}

export interface IcpeData {
  count: number;
  seveso_haut_count: number;
  seveso_bas_count: number;
  installations: Installation[];
  risk_level: RiskLevel;
  coverage: Coverage;
  truncated?: boolean;
}

export interface SisData {
  count: number;
  sites: Array<{
    id: string;
    nom: string;
    adresse: string;
    commune: string;
    superficie_m2: number | null;
  }>;
  risk_level: RiskLevel;
  coverage: Coverage;
  truncated?: boolean;
}

export interface CaviteData {
  count: number;
  cavites: Array<{
    id: string;
    type: string;
    nom: string;
    profondeur_m: number | null;
    distance_m: number | null;
  }>;
  risk_level: RiskLevel;
  coverage: Coverage;
  truncated?: boolean;
}

export interface MvtData {
  count: number;
  mouvements: Array<{
    id: string;
    type: string;
    date: string;
    precision: string;
    distance_m: number | null;
  }>;
  risk_level: RiskLevel;
  coverage: Coverage;
  truncated?: boolean;
}

export interface ArgilesData {
  niveau_alea: string | null;
  risk_level: RiskLevel;
  coverage: Coverage;
}

/**
 * `ppri === null` / `zone_inondable === null` = GASPAR n'a pas répondu.
 * À ne jamais rendre par « hors zone » / « pas de PPRI ».
 */
export interface InondationData {
  zone_inondable: boolean | null;
  type_zone: string | null;
  tri: string | null;
  ppri: boolean | null;
  risk_level: RiskLevel;
  coverage: Coverage;
}

export interface SeismeData {
  /** `null` = département non résolu. Ne pas retomber sur 1 (« Très faible »). */
  zone: number | null;
  libelle: string;
  risk_level: RiskLevel;
  coverage: Coverage;
}

export interface FeuxForetData {
  zone_risque: boolean | null;
  obligation_debroussaillement: boolean | null;
  risk_level: RiskLevel;
  coverage: Coverage;
}

export interface RiskStudyMeta {
  lat: number;
  lon: number;
  location_source?: string;
  location_label?: string;
  commune_insee: string;
  commune_nom: string;
  departement: string;
  region: string;
  radius_km: number;
  generated_at: string;
}

export interface RiskStudyData {
  gaspar: GasparData;
  radon: RadonData;
  icpe: IcpeData;
  sis: SisData;
  cavites: CaviteData;
  mouvements_terrain: MvtData;
  argiles: ArgilesData;
  inondation: InondationData;
  seisme: SeismeData;
  feux_foret: FeuxForetData;
}

export interface RiskStudyApiResponse {
  success: boolean;
  version: string;
  meta: RiskStudyMeta;
  scores: RiskScores;
  categories: RiskCategory[];
  data: RiskStudyData;
  insights: Insight[];
  debug?: {
    timings: Record<string, number>;
  };
}
