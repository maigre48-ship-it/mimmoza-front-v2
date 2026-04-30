// Types dédiés au module "Permis de construire".
// Défensifs, explicites, aucun champ n'est supposé présent.

export type PermisConstruireTypeAutorisation =
  | "PC"  // Permis de construire
  | "PA"  // Permis d'aménager
  | "PD"  // Permis de démolir
  | "DP"; // Déclaration préalable

export type PermisConstruireProjectType =
  | "logement_individuel"
  | "logement_collectif"
  | "logement_mixte"
  | "activite"
  | "tous";

export type PermisConstruireStatut =
  | "depose"
  | "en_instruction"
  | "accorde"
  | "refuse"
  | "retire"
  | "inconnu";

export type PermisConstruireSortKey = "distance" | "date" | "logements" | "surface";
export type PermisConstruireSortOrder = "asc" | "desc";

export interface PermisConstruireItem {
  id: string;
  distanceKm: number | null;
  commune: string | null;
  codePostal: string | null;
  dateDepot: string | null;              // ISO yyyy-mm-dd
  typeAutorisation: PermisConstruireTypeAutorisation | null;
  natureProjet: string | null;
  typologie: PermisConstruireProjectType | null;
  nombreLogements: number | null;
  surface: number | null;                // m²
  statut: PermisConstruireStatut | null;
  adresse: string | null;
  referenceDossier: string | null;
  latitude: number | null;
  longitude: number | null;
  source: string | null;
  raw?: Record<string, unknown>;
}

export interface PermisConstruireSearchParams {
  latitude: number;
  longitude: number;
  rayonKm: number;                       // 0 à 25
  periodeMois: number;                   // 12 | 24 | 36 | autre
  periodeStart?: string;                 // ISO, si période personnalisée
  periodeEnd?: string;                   // ISO, si période personnalisée
  typeAutorisation?: PermisConstruireTypeAutorisation[];
  typologie?: PermisConstruireProjectType;
  logementsMin?: number;
  logementsMax?: number;
  surfaceMin?: number;
  surfaceMax?: number;
  commune?: string;
  sortBy?: PermisConstruireSortKey;
  sortOrder?: PermisConstruireSortOrder;
}

export type PermisConstruireSource =
  | "sitadel"
  | "promoteur-permis-construire"
  | "unknown";

export interface PermisConstruireSearchResponse {
  items: PermisConstruireItem[];
  total: number;
  params: PermisConstruireSearchParams;
  generatedAt: string;                   // ISO
  source: PermisConstruireSource;
  partial?: boolean;
  notices?: string[];
}

export interface PermisConstruireState {
  loading: boolean;
  error: string | null;
  response: PermisConstruireSearchResponse | null;
  lastParams: PermisConstruireSearchParams | null;
}