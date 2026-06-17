// =============================================================
// Mimmoza · Opportunity Engine — Adaptateur d'annonces (V1)
// Transforme une annonce réelle de la veille (v_market_active_listings,
// type MarketActiveListing) en OpportunityInput.
//
// 100% défensif : aucune donnée manquante ne doit faire planter.
// Aucune donnée inventée : si une info manque -> null/undefined.
// =============================================================

import type {
  OpportunityAssetType,
  OpportunityInput,
  OpportunityStrategy,
} from './opportunityEngine.types';

/**
 * Forme minimale et défensive d'une annonce de veille.
 * Superset optionnel de `MarketActiveListing` : tout est optionnel pour que
 * l'adaptateur reste robuste même si la vue évolue. `MarketActiveListing`
 * (du service réel) est structurellement assignable à ce type.
 */
export interface RawWatchListing {
  id?: string | null;
  external_id?: string | null;
  external_source?: string | null;
  source_portal?: string | null;
  source_listing_id?: string | null;
  source_url?: string | null;
  title?: string | null;
  description?: string | null;
  price?: number | null;
  price_per_m2?: number | null;
  surface_m2?: number | null;
  /** Présent dans portal_snapshots ; peut être absent de la vue. */
  land_surface_m2?: number | null;
  rooms?: number | null;
  bedrooms?: number | null;
  /** Convention Stream Estate : 0 = appartement, 1 = maison, 2 = terrain. */
  property_type?: number | null;
  city?: string | null;
  zip_code?: string | null;
  insee_code?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

const REHAB_HINT_KEYWORDS = [
  'travaux',
  'à rénover',
  'a renover',
  'fort potentiel',
  'rénovation',
  'renovation',
  'plateau',
  'division',
];

// -------------------------------------------------------------
// Helpers défensifs
// -------------------------------------------------------------

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const t = value.trim().replace(/\s/g, '').replace(',', '.');
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.trim();
  return t ? t : undefined;
}

// -------------------------------------------------------------
// Extracteurs
// -------------------------------------------------------------

export function inferAssetTypeFromListing(listing: RawWatchListing): OpportunityAssetType {
  const pt = listing.property_type;
  if (pt === 0) return 'appartement';
  if (pt === 1) return 'maison';
  if (pt === 2) return 'terrain';

  // Repli sur le titre si property_type absent/inconnu.
  const text = (listing.title ?? '').toLowerCase();
  if (!text) return 'unknown';
  if (text.includes('terrain')) return 'terrain';
  if (text.includes('immeuble')) return 'immeuble';
  if (text.includes('local') || text.includes('commerce') || text.includes('bureau')) return 'local';
  if (text.includes('villa') || text.includes('maison')) return 'maison';
  if (
    text.includes('appartement') ||
    text.includes('studio') ||
    /\bt[1-9]\b/.test(text) ||
    /\bf[1-9]\b/.test(text)
  ) {
    return 'appartement';
  }
  return 'unknown';
}

export function extractAskingPrice(listing: RawWatchListing): number | null {
  const p = toFiniteNumber(listing.price);
  return p != null && p > 0 ? p : null;
}

export function extractLivingArea(listing: RawWatchListing): number | null {
  const s = toFiniteNumber(listing.surface_m2);
  return s != null && s > 0 ? s : null;
}

export function extractLandArea(listing: RawWatchListing): number | null {
  const l = toFiniteNumber(listing.land_surface_m2);
  return l != null && l > 0 ? l : null;
}

export function extractCityPostalCode(listing: RawWatchListing): {
  city?: string;
  postalCode?: string;
  codeInsee?: string;
} {
  return {
    city: toTrimmedString(listing.city),
    postalCode: toTrimmedString(listing.zip_code),
    codeInsee: toTrimmedString(listing.insee_code),
  };
}

/**
 * Renvoie le texte normalisé (titre + description) servant à la détection
 * des indices de réhabilitation par le moteur. Ne décide rien ici : le
 * scoring des mots-clés reste dans le moteur.
 */
export function extractDescriptionSignals(description?: string | null): string {
  const text = (description ?? '').toLowerCase();
  if (!text) return '';
  const matched = REHAB_HINT_KEYWORDS.filter((k) => text.includes(k));
  // On retourne le texte tel quel (le moteur refait la détection),
  // mais on garantit qu'il est exploitable.
  return matched.length > 0 ? text : text;
}

// -------------------------------------------------------------
// Normalisation principale
// -------------------------------------------------------------

export function normalizeListingToOpportunityInput(
  listing: RawWatchListing,
  strategy: OpportunityStrategy,
): OpportunityInput {
  const assetType = inferAssetTypeFromListing(listing);
  const askingPrice = extractAskingPrice(listing);
  let livingArea = extractLivingArea(listing);
  let landArea = extractLandArea(listing);

  // Pour un terrain, la surface renseignée est foncière, pas habitable.
  if (assetType === 'terrain') {
    if (landArea == null && livingArea != null) {
      landArea = livingArea;
    }
    livingArea = null;
  }

  const geo = extractCityPostalCode(listing);

  const titleText = toTrimmedString(listing.title);
  const descText = extractDescriptionSignals(
    `${listing.title ?? ''} ${listing.description ?? ''}`,
  );

  const id =
    toTrimmedString(listing.external_id) ??
    toTrimmedString(listing.id) ??
    toTrimmedString(listing.source_listing_id);

  return {
    id,
    source: toTrimmedString(listing.external_source) ?? 'veille',
    address: titleText,
    city: geo.city,
    postalCode: geo.postalCode,
    codeInsee: geo.codeInsee,
    latitude: toFiniteNumber(listing.latitude) ?? undefined,
    longitude: toFiniteNumber(listing.longitude) ?? undefined,
    assetType,
    strategy,
    askingPrice,
    livingArea,
    landArea,
    rooms: toFiniteNumber(listing.rooms),
    description: descText || undefined,
    createdAt: new Date().toISOString(),
  };
}