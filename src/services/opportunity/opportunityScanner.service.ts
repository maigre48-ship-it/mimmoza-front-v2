// =============================================================
// Mimmoza · Opportunity Engine — Scanner d'annonces (V3)
// Source de lecture : table `portal_snapshots` (alimentée directement par
// `stream-estate-ingest-v1`). On NE lit PLUS `v_market_active_listings`,
// qui pointe sur `market_source_listings` — table NON alimentée par la
// chaîne Stream Estate (d'où 0 annonce auparavant).
//
// Flux : ingestion edge (refreshMarketZone) -> lecture portal_snapshots
//        -> pré-filtre critères -> scoring déterministe -> classement.
// Aucune donnée mockée.
// =============================================================

// ⚠️ CHEMINS À CONFIRMER (services existants).
import { supabase } from '@/lib/supabase';
import { refreshMarketZone } from '@/spaces/investisseur/services/marketRefresh';

import { computeOpportunity } from './opportunityEngine.service';
import type {
  OpportunityAssetType,
  OpportunityResult,
  OpportunityStrategy,
} from './opportunityEngine.types';
import {
  extractAskingPrice,
  extractLandArea,
  extractLivingArea,
  inferAssetTypeFromListing,
  normalizeListingToOpportunityInput,
} from './opportunityListingAdapter.service';
import {
  resolveLocationForZone,
  type LocationContext,
} from './opportunityLocation.service';
import {
  resolveMarketReference,
  type MarketReference,
} from './opportunityMarket.service';

/** Annonce de veille telle que lue depuis `portal_snapshots` (mappée). */
export interface WatchListing {
  external_id: string | null;
  external_source: string | null;
  source_url: string | null;
  title: string | null;
  description: string | null;
  price: number | null;
  surface_m2: number | null;
  land_surface_m2: number | null;
  rooms: number | null;
  property_type: number | null;
  city: string | null;
  zip_code: string | null;
}

interface PortalSnapshotRow {
  portal: string | null;
  listing_portal_id: string | null;
  url: string | null;
  title: string | null;
  description: string | null;
  city: string | null;
  zip_code: string | null;
  price: number | null;
  surface: number | null;
  surface_m2: number | null;
  price_m2: number | null;
  rooms: number | null;
  property_type: number | null;
  land_surface_m2: number | null;
  first_seen_at: string | null;
  seen_at: string | null;
}

export interface ScannedOpportunity {
  listingId: string;
  title: string | null;
  url: string | null;
  result: OpportunityResult;
}

export interface ScanCriteria {
  assetType?: OpportunityAssetType | 'all';
  priceMin?: number | null;
  priceMax?: number | null;
  surfaceMin?: number | null;
  surfaceMax?: number | null;
}

export interface ScanParams {
  city?: string;
  zipCode?: string;
  limit?: number;
  /** Déclenche le pipeline d'ingestion edge avant la lecture. */
  withIngest?: boolean;
  /** Résoudre le contexte PLU par annonce (off par défaut : non bloquant). */
  resolvePlu?: boolean;
  /** Résoudre la localisation (mobilité GTFS) par zone (on par défaut). */
  resolveLocation?: boolean;
  /** Résoudre la référence marché DVF par (zone+type) (on par défaut). */
  resolveMarket?: boolean;
  /** Bypass quotas veille (admin). */
  isAdmin?: boolean;
  bypassLimits?: boolean;
  /** Pré-filtre appliqué AVANT scoring. */
  criteria?: ScanCriteria;
}

export interface IngestSummary {
  attempted: boolean;
  ok: boolean;
  fetched: number | null;
  retained: number | null;
  skipped: boolean;
  skipReason: string | null;
  error: string | null;
}

export interface OpportunityScanOutcome {
  strategy: OpportunityStrategy;
  /** Annonces lues depuis portal_snapshots. */
  fetchedCount: number;
  /** Annonces réellement scorées (après pré-filtre critères). */
  scannedCount: number;
  opportunities: ScannedOpportunity[];
  source: 'portal_snapshots';
  ingest?: IngestSummary;
}

const DEFAULT_SCAN_LIMIT = 100;

function readNumber(body: Record<string, unknown> | null, key: string): number | null {
  if (!body) return null;
  const v = body[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function assetLabel(propertyType: number | null): string {
  if (propertyType === 2) return 'Terrain';
  if (propertyType === 1) return 'Maison';
  if (propertyType === 0) return 'Appartement';
  return 'Bien';
}

/** Libellé descriptif de repli (si l'annonce n'a pas de vrai titre). */
function buildTitle(r: PortalSnapshotRow): string {
  const type = assetLabel(r.property_type);
  let surfPart = '';
  if (r.surface_m2 && r.surface_m2 > 0) surfPart = ` ${Math.round(r.surface_m2)} m²`;
  else if (r.land_surface_m2 && r.land_surface_m2 > 0) surfPart = ` ${Math.round(r.land_surface_m2)} m² terrain`;
  const loc = [r.city, r.zip_code].filter(Boolean).join(' ');
  return `${type}${surfPart}${loc ? ' · ' + loc : ''}`.trim();
}

function mapSnapshot(r: PortalSnapshotRow): WatchListing {
  const realTitle = r.title?.trim();
  return {
    external_id: r.listing_portal_id,
    external_source: r.portal,
    source_url: r.url,
    title: realTitle && realTitle.length > 0 ? realTitle : buildTitle(r),
    description: r.description?.trim() || null,
    price: r.price,
    surface_m2: r.surface_m2 ?? r.surface,
    land_surface_m2: r.land_surface_m2,
    rooms: r.rooms,
    property_type: r.property_type,
    city: r.city,
    zip_code: r.zip_code,
  };
}

/**
 * Déclenche l'ingestion edge (Stream Estate) pour peupler portal_snapshots.
 * Ne jette jamais : renvoie un résumé exploitable par l'UI.
 */
export async function ingestZone(params: ScanParams): Promise<IngestSummary> {
  if (!params.city && !params.zipCode) {
    return {
      attempted: false,
      ok: false,
      fetched: null,
      retained: null,
      skipped: false,
      skipReason: 'NO_ZONE',
      error: null,
    };
  }

  try {
    const result = await refreshMarketZone({
      zipCode: params.zipCode,
      city: params.city,
      withIngest: true,
      dryRun: false,
      includeSamples: false,
      minScore: 0,
      windowHours: 24 * 30,
      limit: 200,
      maxPages: 5,
      isAdmin: params.isAdmin ?? false,
      bypassLimits: params.bypassLimits ?? false,
    });

    const ingestBody = (result.ingest?.body ?? null) as Record<string, unknown> | null;

    return {
      attempted: true,
      ok: Boolean(result.ok),
      fetched: readNumber(ingestBody, 'fetched_adverts'),
      retained: readNumber(ingestBody, 'retained_count'),
      skipped: Boolean(result.ingest_skipped),
      skipReason: result.ingest_skip_reason ?? null,
      error: result.error ?? null,
    };
  } catch (e) {
    return {
      attempted: true,
      ok: false,
      fetched: null,
      retained: null,
      skipped: false,
      skipReason: null,
      error: e instanceof Error ? e.message : 'INGEST_FAILED',
    };
  }
}

/**
 * Lecture des annonces réelles depuis `portal_snapshots`.
 * Filtre par code postal (prioritaire) ou ville.
 * Dédoublonne par clé canonique (zone + surface + prix + type) pour éviter
 * les annonces identiques répétées (même bien sur plusieurs portails/snapshots).
 */
export async function fetchWatchListings(params?: ScanParams): Promise<WatchListing[]> {
  const limit =
    typeof params?.limit === 'number' && Number.isFinite(params.limit)
      ? Math.max(1, Math.min(Math.floor(params.limit), 500))
      : DEFAULT_SCAN_LIMIT;

  let query = supabase
    .from('portal_snapshots')
    .select(
      'portal, listing_portal_id, url, title, description, city, zip_code, price, surface, surface_m2, price_m2, rooms, property_type, land_surface_m2, first_seen_at, seen_at',
    )
    .order('seen_at', { ascending: false })
    .limit(limit);

  const zip = params?.zipCode?.trim();
  const city = params?.city?.trim();
  if (zip) query = query.eq('zip_code', zip);
  else if (city) query = query.ilike('city', `%${city}%`);

  const { data, error } = await query;
  if (error) {
    throw new Error(`[fetchWatchListings] ${error.message || 'Supabase error'}`);
  }

  const rows = (data ?? []) as PortalSnapshotRow[];

  // Clé canonique : un même bien à prix/surface/zone/type identiques est
  // considéré comme un doublon (même annonce dupliquée). On garde le premier
  // (le plus récent, car trié par seen_at desc).
  const seen = new Set<string>();
  const listings: WatchListing[] = [];
  for (const r of rows) {
    const zoneK = (r.zip_code ?? r.city ?? '').trim().toLowerCase();
    const priceK = r.price != null ? Math.round(r.price) : 'na';
    const surfK =
      r.surface_m2 != null
        ? Math.round(r.surface_m2)
        : r.surface != null
          ? Math.round(r.surface)
          : 'na';
    const typeK = r.property_type ?? 'na';
    const canonical =
      priceK !== 'na' && surfK !== 'na'
        ? `${zoneK}|${surfK}|${priceK}|${typeK}`
        : r.url ?? `${r.portal}:${r.listing_portal_id}`;

    if (seen.has(canonical)) continue;
    seen.add(canonical);
    listings.push(mapSnapshot(r));
  }
  return listings;
}

/**
 * Pré-filtre une annonce sur les critères de recherche (avant scoring).
 */
export function listingMatchesCriteria(listing: WatchListing, criteria?: ScanCriteria): boolean {
  if (!criteria) return true;

  if (criteria.assetType && criteria.assetType !== 'all') {
    if (inferAssetTypeFromListing(listing) !== criteria.assetType) return false;
  }

  const price = extractAskingPrice(listing);
  if (criteria.priceMin != null && (price == null || price < criteria.priceMin)) return false;
  if (criteria.priceMax != null && (price == null || price > criteria.priceMax)) return false;

  const surface = extractLivingArea(listing) ?? extractLandArea(listing);
  if (criteria.surfaceMin != null && (surface == null || surface < criteria.surfaceMin)) return false;
  if (criteria.surfaceMax != null && (surface == null || surface > criteria.surfaceMax)) return false;

  return true;
}

/**
 * Score une annonce unique.
 */
export async function scanSingleListing(
  listing: WatchListing,
  strategy: OpportunityStrategy,
  options?: { resolvePlu?: boolean; location?: LocationContext; market?: MarketReference },
): Promise<ScannedOpportunity> {
  const input = normalizeListingToOpportunityInput(listing, strategy);

  // Injection du contexte de localisation (résolu par zone, en amont).
  if (options?.location) {
    const loc = options.location;
    if (loc.latitude != null) input.latitude = loc.latitude;
    if (loc.longitude != null) input.longitude = loc.longitude;
    if (loc.codeInsee) input.codeInsee = input.codeInsee ?? loc.codeInsee;
    input.mobilityScore = loc.mobilityScore;
  }

  // Injection de la référence marché DVF (résolue par zone+type, en amont).
  if (options?.market) {
    input.marketRefPriceM2 = options.market.refPriceM2;
    input.marketSampleSize = options.market.sampleSize;
  }

  const result = await computeOpportunity(input, { resolvePlu: options?.resolvePlu ?? false });

  return {
    listingId:
      input.id ?? listing.external_id ?? `${listing.external_source ?? 'veille'}-${listing.title ?? ''}`,
    title: listing.title,
    url: listing.source_url,
    result,
  };
}

/**
 * Classe par score décroissant, puis par confiance.
 */
export function rankOpportunities(items: ScannedOpportunity[]): ScannedOpportunity[] {
  const confidenceRank: Record<OpportunityResult['confidence'], number> = {
    high: 3,
    medium: 2,
    low: 1,
  };
  return [...items].sort((a, b) => {
    if (b.result.scoreTotal !== a.result.scoreTotal) {
      return b.result.scoreTotal - a.result.scoreTotal;
    }
    return confidenceRank[b.result.confidence] - confidenceRank[a.result.confidence];
  });
}

/**
 * Scan complet : (ingestion edge optionnelle) -> lecture portal_snapshots
 * -> pré-filtre critères -> score -> classement.
 */
export async function scanOpportunities(
  strategy: OpportunityStrategy,
  params?: ScanParams,
): Promise<OpportunityScanOutcome> {
  let ingest: IngestSummary | undefined;
  if (params?.withIngest) {
    ingest = await ingestZone(params);
  }

  const listings = await fetchWatchListings(params);
  const matching = listings.filter((l) => listingMatchesCriteria(l, params?.criteria));

  // Résolution de la localisation PAR ZONE (1 géocodage + 1 mobilité par CP).
  const resolveLocation = params?.resolveLocation ?? true;
  const locByZone = new Map<string, LocationContext>();
  if (resolveLocation) {
    const zones = new Map<string, { zip?: string; city?: string }>();
    for (const l of matching) {
      const key = (l.zip_code?.trim() || l.city?.trim() || '').toLowerCase();
      if (key && !zones.has(key)) {
        zones.set(key, { zip: l.zip_code ?? undefined, city: l.city ?? undefined });
      }
    }
    const resolved = await Promise.all(
      [...zones.entries()].map(
        async ([key, z]) => [key, await resolveLocationForZone(z.zip, z.city)] as const,
      ),
    );
    for (const [key, ctx] of resolved) locByZone.set(key, ctx);
  }

  // Référence marché DVF PAR (zone + type de bien). 1 appel DVF par combinaison.
  const resolveMarket = params?.resolveMarket ?? true;
  const marketByKey = new Map<string, MarketReference>();
  if (resolveMarket) {
    const combos = new Map<string, { insee: string | null; zip?: string; assetType: ReturnType<typeof inferAssetTypeFromListing> }>();
    for (const l of matching) {
      const zoneKey = (l.zip_code?.trim() || l.city?.trim() || '').toLowerCase();
      const at = inferAssetTypeFromListing(l);
      const k = `${zoneKey}|${at}`;
      if (!combos.has(k)) {
        const loc = locByZone.get(zoneKey);
        combos.set(k, { insee: loc?.codeInsee ?? null, zip: l.zip_code ?? undefined, assetType: at });
      }
    }
    const resolvedMarket = await Promise.all(
      [...combos.entries()].map(
        async ([k, c]) =>
          [k, await resolveMarketReference({ codeInsee: c.insee, zip: c.zip, assetType: c.assetType })] as const,
      ),
    );
    for (const [k, ref] of resolvedMarket) marketByKey.set(k, ref);
  }

  const resolvePlu = params?.resolvePlu ?? false;
  const scored = await Promise.all(
    matching.map((listing) => {
      const zoneKey = (listing.zip_code?.trim() || listing.city?.trim() || '').toLowerCase();
      const location = locByZone.get(zoneKey);
      const marketKey = `${zoneKey}|${inferAssetTypeFromListing(listing)}`;
      const market = marketByKey.get(marketKey);
      return scanSingleListing(listing, strategy, { resolvePlu, location, market });
    }),
  );

  return {
    strategy,
    fetchedCount: listings.length,
    scannedCount: matching.length,
    opportunities: rankOpportunities(scored),
    source: 'portal_snapshots',
    ingest,
  };
}