/**
 * Types et constantes pour le module Sourcing
 * Transversal: utilisable par MDB, Promoteur, Particulier
 */

// ============================================
// ENUMS & TYPES DE BASE
// ============================================

export type ProfileTarget = 'mdb' | 'promoteur' | 'particulier';

export type PropertyType = 'house' | 'apartment' | 'building' | 'land';

export type Ternary = 'oui' | 'non' | 'inconnu';

export type FloorValue = number | 'rdc' | 'n/a';

export type ProximiteTransport = 'metro' | 'tram' | 'rer' | 'bus' | 'aucun';

export type NuisanceLevel = 'calme' | 'moyen' | 'bruyant';

export type Exposition = 'N' | 'E' | 'S' | 'O' | 'inconnu';

export type StandingImmeuble = 'eco' | 'standard' | 'premium' | 'inconnu';

// Options spécifiques maison
export type StationnementMaison = 'aucun' | 'exterieur' | 'garage' | 'inconnu';

// Options spécifiques immeuble
export type EtatGeneral = 'a_renover' | 'standard' | 'bon' | 'inconnu';

// Options spécifiques terrain
export type PenteTerrain = 'plat' | 'leger' | 'pentue' | 'inconnu';
export type AccesTerrain = 'facile' | 'moyen' | 'difficile' | 'inconnu';

// ============================================
// INTERFACES PRINCIPALES
// ============================================

export interface SourcingLocationInput {
  codePostal: string;
  rueProche: string;
  ville?: string;
  arrondissement?: string;
  quartier?: string;
}

export interface SourcingQuartierInput {
  proximiteTransport?: ProximiteTransport;
  distanceTransport?: number; // en mètres
  proximiteCommerces?: boolean;
  nuisances?: NuisanceLevel;
  exposition?: Exposition;
  ruePassante?: boolean;
  standingImmeuble?: StandingImmeuble;
  commentaire?: string;
}

// Options conditionnelles selon le type de bien
export interface HouseOptions {
  jardin?: Ternary;
  terrasse?: Ternary;
  piscine?: Ternary;
  stationnement?: StationnementMaison;
}

export interface ApartmentOptions {
  ascenseur?: Ternary;
  balcon?: Ternary;
  cave?: Ternary;
  parking?: Ternary;
}

export interface BuildingOptions {
  nbLots?: number;
  ascenseur?: Ternary;
  etatGeneral?: EtatGeneral;
  revenusLocatifsConnus?: boolean;
  montantMensuel?: number;
}

export interface LandOptions {
  surfaceParcelle?: number;
  pente?: PenteTerrain;
  acces?: AccesTerrain;
  viabilise?: Ternary;
}

export type PropertySpecificOptions = 
  | { type: 'house'; options: HouseOptions }
  | { type: 'apartment'; options: ApartmentOptions }
  | { type: 'building'; options: BuildingOptions }
  | { type: 'land'; options: LandOptions };

// Structure complète du draft
export interface SourcingInput {
  // Infos obligatoires
  location: SourcingLocationInput;
  propertyType: PropertyType;
  price: number;
  surface: number;
  floor: FloorValue;
  
  // Infos quartier (optionnelles)
  quartier?: SourcingQuartierInput;
  
  // Options spécifiques au type de bien
  houseOptions?: HouseOptions;
  apartmentOptions?: ApartmentOptions;
  buildingOptions?: BuildingOptions;
  landOptions?: LandOptions;
}

export interface SourcingItemDraft extends SourcingInput {
  id?: string;
  createdAt?: Date;
  profileTarget: ProfileTarget;
}

// ============================================
// CONSTANTES & LABELS
// ============================================

export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  house: 'Maison',
  apartment: 'Appartement',
  building: 'Immeuble',
  land: 'Terrain',
};

export const TERNARY_OPTIONS: { value: Ternary; label: string }[] = [
  { value: 'oui', label: 'Oui' },
  { value: 'non', label: 'Non' },
  { value: 'inconnu', label: 'Inconnu' },
];

export const PROXIMITE_TRANSPORT_OPTIONS: { value: ProximiteTransport; label: string }[] = [
  { value: 'metro', label: 'Métro' },
  { value: 'tram', label: 'Tramway' },
  { value: 'rer', label: 'RER' },
  { value: 'bus', label: 'Bus' },
  { value: 'aucun', label: 'Aucun' },
];

export const NUISANCE_OPTIONS: { value: NuisanceLevel; label: string }[] = [
  { value: 'calme', label: 'Calme' },
  { value: 'moyen', label: 'Moyen' },
  { value: 'bruyant', label: 'Bruyant' },
];

export const EXPOSITION_OPTIONS: { value: Exposition; label: string }[] = [
  { value: 'N', label: 'Nord' },
  { value: 'E', label: 'Est' },
  { value: 'S', label: 'Sud' },
  { value: 'O', label: 'Ouest' },
  { value: 'inconnu', label: 'Inconnu' },
];

export const STANDING_OPTIONS: { value: StandingImmeuble; label: string }[] = [
  { value: 'eco', label: 'Économique' },
  { value: 'standard', label: 'Standard' },
  { value: 'premium', label: 'Premium' },
  { value: 'inconnu', label: 'Inconnu' },
];

export const STATIONNEMENT_MAISON_OPTIONS: { value: StationnementMaison; label: string }[] = [
  { value: 'aucun', label: 'Aucun' },
  { value: 'exterieur', label: 'Extérieur' },
  { value: 'garage', label: 'Garage' },
  { value: 'inconnu', label: 'Inconnu' },
];

export const ETAT_GENERAL_OPTIONS: { value: EtatGeneral; label: string }[] = [
  { value: 'a_renover', label: 'À rénover' },
  { value: 'standard', label: 'Standard' },
  { value: 'bon', label: 'Bon état' },
  { value: 'inconnu', label: 'Inconnu' },
];

export const PENTE_OPTIONS: { value: PenteTerrain; label: string }[] = [
  { value: 'plat', label: 'Plat' },
  { value: 'leger', label: 'Légère pente' },
  { value: 'pentue', label: 'Pentue' },
  { value: 'inconnu', label: 'Inconnu' },
];

export const ACCES_OPTIONS: { value: AccesTerrain; label: string }[] = [
  { value: 'facile', label: 'Facile' },
  { value: 'moyen', label: 'Moyen' },
  { value: 'difficile', label: 'Difficile' },
  { value: 'inconnu', label: 'Inconnu' },
];

export const PROFILE_LABELS: Record<ProfileTarget, string> = {
  mdb: 'Marchand de Biens',
  promoteur: 'Promoteur',
  particulier: 'Particulier',
};

export const FLOOR_SPECIAL_VALUES = {
  RDC: 'rdc' as const,
  NA: 'n/a' as const,
};