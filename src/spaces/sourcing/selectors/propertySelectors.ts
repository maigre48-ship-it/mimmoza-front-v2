/**
 * Sélecteurs et options pour les dropdowns du module Sourcing
 * Centralisé pour faciliter la réutilisation et les traductions futures
 */

import {
  PROPERTY_TYPE_LABELS,
  TERNARY_OPTIONS,
  PROXIMITE_TRANSPORT_OPTIONS,
  NUISANCE_OPTIONS,
  EXPOSITION_OPTIONS,
  STANDING_OPTIONS,
  STATIONNEMENT_MAISON_OPTIONS,
  ETAT_GENERAL_OPTIONS,
  PENTE_OPTIONS,
  ACCES_OPTIONS,
  type PropertyType,
  type Ternary,
  type ProximiteTransport,
  type NuisanceLevel,
  type Exposition,
  type StandingImmeuble,
  type StationnementMaison,
  type EtatGeneral,
  type PenteTerrain,
  type AccesTerrain,
} from '../types/sourcing.types';

// ============================================
// TYPES GÉNÉRIQUES POUR OPTIONS
// ============================================

export interface SelectOption<T = string> {
  value: T;
  label: string;
}

// ============================================
// SÉLECTEURS PRINCIPAUX
// ============================================

export function getPropertyTypeOptions(): SelectOption<PropertyType>[] {
  return Object.entries(PROPERTY_TYPE_LABELS).map(([value, label]) => ({
    value: value as PropertyType,
    label,
  }));
}

export function getTernaryOptions(): SelectOption<Ternary>[] {
  return TERNARY_OPTIONS;
}

export function getProximiteTransportOptions(): SelectOption<ProximiteTransport>[] {
  return PROXIMITE_TRANSPORT_OPTIONS;
}

export function getNuisanceOptions(): SelectOption<NuisanceLevel>[] {
  return NUISANCE_OPTIONS;
}

export function getExpositionOptions(): SelectOption<Exposition>[] {
  return EXPOSITION_OPTIONS;
}

export function getStandingOptions(): SelectOption<StandingImmeuble>[] {
  return STANDING_OPTIONS;
}

// ============================================
// SÉLECTEURS SPÉCIFIQUES PAR TYPE DE BIEN
// ============================================

// Maison
export function getStationnementMaisonOptions(): SelectOption<StationnementMaison>[] {
  return STATIONNEMENT_MAISON_OPTIONS;
}

// Immeuble
export function getEtatGeneralOptions(): SelectOption<EtatGeneral>[] {
  return ETAT_GENERAL_OPTIONS;
}

// Terrain
export function getPenteOptions(): SelectOption<PenteTerrain>[] {
  return PENTE_OPTIONS;
}

export function getAccesOptions(): SelectOption<AccesTerrain>[] {
  return ACCES_OPTIONS;
}

// ============================================
// OPTIONS ÉTAGE
// ============================================

export interface FloorOption {
  value: string;
  label: string;
}

export function getFloorOptions(): FloorOption[] {
  const options: FloorOption[] = [
    { value: 'rdc', label: 'RDC' },
    { value: 'n/a', label: 'N/A (terrain)' },
  ];
  
  // Ajouter les étages 1 à 20
  for (let i = 1; i <= 20; i++) {
    options.push({ value: String(i), label: `${i}${i === 1 ? 'er' : 'ème'} étage` });
  }
  
  return options;
}

// ============================================
// OPTIONS DISTANCE TRANSPORT
// ============================================

export function getDistanceTransportOptions(): SelectOption<number>[] {
  return [
    { value: 50, label: '< 50m' },
    { value: 100, label: '~ 100m' },
    { value: 200, label: '~ 200m' },
    { value: 300, label: '~ 300m' },
    { value: 500, label: '~ 500m' },
    { value: 1000, label: '~ 1km' },
    { value: 2000, label: '> 1km' },
  ];
}

// ============================================
// OPTIONS OUI/NON SIMPLE (sans inconnu)
// ============================================

export function getBooleanOptions(): SelectOption<string>[] {
  return [
    { value: 'true', label: 'Oui' },
    { value: 'false', label: 'Non' },
  ];
}

// ============================================
// HELPERS AFFICHAGE
// ============================================

export function getPropertyTypeLabel(type: PropertyType): string {
  return PROPERTY_TYPE_LABELS[type] || type;
}

export function getTernaryLabel(value: Ternary | undefined): string {
  if (!value) return '-';
  return TERNARY_OPTIONS.find(o => o.value === value)?.label || value;
}

export function getExpositionLabel(value: Exposition | undefined): string {
  if (!value) return '-';
  return EXPOSITION_OPTIONS.find(o => o.value === value)?.label || value;
}

export function getStandingLabel(value: StandingImmeuble | undefined): string {
  if (!value) return '-';
  return STANDING_OPTIONS.find(o => o.value === value)?.label || value;
}

export function getNuisanceLabel(value: NuisanceLevel | undefined): string {
  if (!value) return '-';
  return NUISANCE_OPTIONS.find(o => o.value === value)?.label || value;
}

export function getTransportLabel(value: ProximiteTransport | undefined): string {
  if (!value) return '-';
  return PROXIMITE_TRANSPORT_OPTIONS.find(o => o.value === value)?.label || value;
}