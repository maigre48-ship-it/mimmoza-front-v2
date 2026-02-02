/**
 * Validateurs pour le module Sourcing
 * Vérifie les champs obligatoires et normalise les données
 */

import type { SourcingInput, FloorValue } from '../types/sourcing.types';

export interface ValidationResult {
  ok: boolean;
  errors: Record<string, string>;
}

// Regex pour code postal français (5 chiffres)
const CODE_POSTAL_REGEX = /^[0-9]{5}$/;

/**
 * Vérifie si une valeur de floor est valide
 */
export function isValidFloor(floor: FloorValue | undefined | null): boolean {
  if (floor === undefined || floor === null) return false;
  if (floor === 'rdc' || floor === 'n/a') return true;
  if (typeof floor === 'number' && Number.isInteger(floor) && floor >= 0) return true;
  return false;
}

/**
 * Parse une chaîne en FloorValue
 */
export function parseFloor(value: string): FloorValue | null {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === 'rdc') return 'rdc';
  if (trimmed === 'n/a' || trimmed === 'na') return 'n/a';
  const num = parseInt(trimmed, 10);
  if (!isNaN(num) && num >= 0) return num;
  return null;
}

/**
 * Formate la valeur floor pour affichage
 */
export function formatFloor(floor: FloorValue | undefined | null): string {
  if (floor === undefined || floor === null) return '-';
  if (floor === 'rdc') return 'RDC';
  if (floor === 'n/a') return 'N/A';
  return `${floor}`;
}

/**
 * Valide un draft complet
 * Retourne ok: true si tous les champs obligatoires sont valides
 */
export function validateDraft(draft: Partial<SourcingInput>): ValidationResult {
  const errors: Record<string, string> = {};

  // === LOCALISATION ===
  
  // Code postal obligatoire + format FR
  if (!draft.location?.codePostal) {
    errors['location.codePostal'] = 'Le code postal est obligatoire';
  } else if (!CODE_POSTAL_REGEX.test(draft.location.codePostal)) {
    errors['location.codePostal'] = 'Le code postal doit contenir 5 chiffres';
  }

  // Rue proche obligatoire
  if (!draft.location?.rueProche || draft.location.rueProche.trim().length < 2) {
    errors['location.rueProche'] = 'La rue proche est obligatoire (min 2 caractères)';
  }

  // === BIEN ===

  // Type de bien obligatoire
  if (!draft.propertyType) {
    errors['propertyType'] = 'Le type de bien est obligatoire';
  }

  // Prix obligatoire et >= 0
  if (draft.price === undefined || draft.price === null) {
    errors['price'] = 'Le prix est obligatoire';
  } else if (typeof draft.price !== 'number' || draft.price < 0) {
    errors['price'] = 'Le prix doit être un nombre positif';
  }

  // Surface obligatoire et >= 0
  if (draft.surface === undefined || draft.surface === null) {
    errors['surface'] = 'La surface est obligatoire';
  } else if (typeof draft.surface !== 'number' || draft.surface <= 0) {
    errors['surface'] = 'La surface doit être un nombre positif';
  }

  // Étage obligatoire
  if (!isValidFloor(draft.floor)) {
    errors['floor'] = 'L\'étage est obligatoire (nombre, RDC, ou N/A pour terrain)';
  }

  return {
    ok: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Normalise les données avant soumission
 */
export function normalizeDraft(draft: SourcingInput): SourcingInput {
  return {
    ...draft,
    location: {
      ...draft.location,
      codePostal: draft.location.codePostal.trim(),
      rueProche: draft.location.rueProche.trim(),
      ville: draft.location.ville?.trim() || undefined,
      arrondissement: draft.location.arrondissement?.trim() || undefined,
      quartier: draft.location.quartier?.trim() || undefined,
    },
    price: Math.max(0, draft.price),
    surface: Math.max(0, draft.surface),
    quartier: draft.quartier ? {
      ...draft.quartier,
      commentaire: draft.quartier.commentaire?.trim() || undefined,
    } : undefined,
  };
}

/**
 * Calcule le prix au m²
 */
export function calculatePricePerSqm(price: number, surface: number): number | null {
  if (surface <= 0) return null;
  return Math.round(price / surface);
}

/**
 * Formate un prix en euros
 */
export function formatPrice(price: number): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(price);
}

/**
 * Formate une surface en m²
 */
export function formatSurface(surface: number): string {
  return `${surface.toLocaleString('fr-FR')} m²`;
}