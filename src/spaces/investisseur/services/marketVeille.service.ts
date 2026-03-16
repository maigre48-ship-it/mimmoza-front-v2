import { supabase } from "@/lib/supabase";

export type MarketRefreshParams = {
  zipCode?: string;
  city?: string;
  windowHours?: number;
  limit?: number;
  dryRun?: boolean;
};

export type MarketNarrativeRow = {
  zip_code: string;
  city: string | null;
  stock_message: string;
  new_listings_message: string;
  multi_portal_message: string;
  price_level_message: string;
  price_drop_message: string;
  market_duration_message: string;
};

export type MarketOpportunityNarrativeRow = {
  canonical_key: string;
  zip_code: string;
  city: string | null;
  intro: string;
  price_position: string;
  price_drop_info: string;
  diffusion_info: string;
  opportunity_score: number;
  opportunity_bucket: "faible" | "moyenne" | "forte";
};

type MarketOpportunityDedupedRow = {
  id: string;
  portal: string;
  listing_portal_id: string;
  url: string;
  city: string | null;
  zip_code: string;
  price: number | string | null;
  surface: number | string | null;
  price_m2: number | string | null;
  canonical_key: string | null;
  display_cluster_key: string;
  first_seen_at: string | null;
  seen_at: string | null;
  days_on_market: number | null;
  opportunity_score: number;
  opportunity_reason: string;
  duplicate_count: number | null;
};

type MarketActiveListingSummaryRow = {
  id: string;
  price: number | string | null;
  price_per_m2: number | string | null;
  surface_m2: number | string | null;
  source_portal: string | null;
};

export type MarketSummaryRow = {
  zip_code: string;
  city: string | null;
  unique_listings: number;
  avg_price: number | null;
  avg_price_m2: number | null;
  avg_surface: number | null;
  new_7d: number;
  new_30d: number;
  multi_portal_pct: number | null;
  avg_days_on_market: number | null;
  price_drops_7d: number;
  price_drops_30d: number;
};

export type MarketTensionRow = {
  snapshot_date: string;
  zip_code: string;
  city: string | null;
  unique_listings: number;
  stock_change_7d: number | null;
  stock_change_30d: number | null;
  stock_change_7d_pct: number | null;
  stock_change_30d_pct: number | null;
  tension_signal:
    | "insuffisant"
    | "detente_forte"
    | "detente_moderee"
    | "tension_forte"
    | "tension_moderee"
    | "stable";
  tension_message: string;
};

export type MarketVeilleBundle = {
  summary: MarketSummaryRow | null;
  narrative: MarketNarrativeRow | null;
  opportunities: MarketOpportunityNarrativeRow[];
  tension: MarketTensionRow | null;
};

function normalizeValue(value?: string): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

function applyZoneFilter<T extends { eq: Function; ilike: Function }>(
  query: T,
  zipCode?: string,
  city?: string
): T {
  let next = query;

  const z = normalizeValue(zipCode);
  const c = normalizeValue(city);

  if (z) {
    next = next.eq("zip_code", z);
  }

  if (c) {
    next = next.ilike("city", c);
  }

  return next;
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatCurrency(value: number | null): string {
  if (value === null) return "n.c.";
  return new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 0,
  }).format(value);
}

function buildOpportunityBucket(
  score: number
): "faible" | "moyenne" | "forte" {
  if (score >= 70) return "forte";
  if (score >= 55) return "moyenne";
  return "faible";
}

function average(values: Array<number | null>): number | null {
  const valid = values.filter((value): value is number => value !== null);
  if (valid.length === 0) return null;

  const sum = valid.reduce((acc, value) => acc + value, 0);
  return sum / valid.length;
}

function buildSummaryFromActiveListings(
  rows: MarketActiveListingSummaryRow[],
  zipCode?: string,
  city?: string
): MarketSummaryRow | null {
  if (rows.length === 0) return null;

  const avgPrice = average(rows.map((row) => toNumber(row.price)));
  const avgPriceM2 = average(rows.map((row) => toNumber(row.price_per_m2)));
  const avgSurface = average(rows.map((row) => toNumber(row.surface_m2)));

  const nonEmptyPortals = rows
    .map((row) => row.source_portal?.trim())
    .filter((value): value is string => Boolean(value));

  const distinctPortals = new Set(nonEmptyPortals.map((value) => value.toLowerCase()));
  const multiPortalPct =
    rows.length > 0 && distinctPortals.size > 1
      ? (distinctPortals.size / rows.length) * 100
      : 0;

  return {
    zip_code: normalizeValue(zipCode) ?? "",
    city: normalizeValue(city) ?? null,
    unique_listings: rows.length,
    avg_price: avgPrice,
    avg_price_m2: avgPriceM2,
    avg_surface: avgSurface,
    new_7d: 0,
    new_30d: 0,
    multi_portal_pct: multiPortalPct,
    avg_days_on_market: null,
    price_drops_7d: 0,
    price_drops_30d: 0,
  };
}

function mergeSummaryWithActiveListings(
  summary: MarketSummaryRow | null,
  activeRows: MarketActiveListingSummaryRow[],
  zipCode?: string,
  city?: string
): MarketSummaryRow | null {
  if (!summary) {
    return buildSummaryFromActiveListings(activeRows, zipCode, city);
  }

  return {
    ...summary,
    unique_listings: activeRows.length,
  };
}

function mapDedupedOpportunityToNarrative(
  row: MarketOpportunityDedupedRow
): MarketOpportunityNarrativeRow {
  const price = toNumber(row.price);
  const surface = toNumber(row.surface);
  const priceM2 = toNumber(row.price_m2);
  const duplicateCount = row.duplicate_count ?? 1;
  const daysOnMarket = row.days_on_market ?? 0;
  const score = row.opportunity_score;

  const introParts: string[] = [];

  if (surface) {
    introParts.push(`${surface} m²`);
  }

  if (price !== null) {
    introParts.push(`${formatCurrency(price)} €`);
  }

  if (row.city) {
    introParts.push(row.city);
  }

  const intro =
    introParts.length > 0
      ? `Bien détecté : ${introParts.join(" • ")}.`
      : "Bien détecté par la veille marché.";

  const pricePosition =
    priceM2 !== null
      ? `${row.opportunity_reason} (${formatCurrency(priceM2)} €/m²).`
      : `${row.opportunity_reason}.`;

  const priceDropInfo =
    daysOnMarket > 0
      ? `Ancienneté estimée sur le marché : ${daysOnMarket} jour${
          daysOnMarket > 1 ? "s" : ""
        }.`
      : "Ancienneté de diffusion non significative à ce stade.";

  const diffusionInfo =
    duplicateCount > 1
      ? `Détecté sur ${duplicateCount} annonces similaires / portails proches.`
      : `Source principale détectée : ${row.portal}.`;

  return {
    canonical_key:
      row.canonical_key ?? row.display_cluster_key ?? row.listing_portal_id,
    zip_code: row.zip_code,
    city: row.city,
    intro,
    price_position: pricePosition,
    price_drop_info: priceDropInfo,
    diffusion_info: diffusionInfo,
    opportunity_score: score,
    opportunity_bucket: buildOpportunityBucket(score),
  };
}

async function fetchActiveListingsSummaryRows(
  zipCode?: string,
  city?: string
): Promise<MarketActiveListingSummaryRow[]> {
  let query = supabase
    .from("v_market_active_listings")
    .select("id, price, price_per_m2, surface_m2, source_portal");

  query = applyZoneFilter(query, zipCode, city);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []) as MarketActiveListingSummaryRow[];
}

export async function runMarketDedupe(
  params: MarketRefreshParams = {}
): Promise<Record<string, unknown>> {
  const payload = {
    window_hours: params.windowHours ?? 48,
    zip_code: normalizeValue(params.zipCode),
    city: normalizeValue(params.city),
    limit: params.limit ?? 5000,
    dry_run: Boolean(params.dryRun),
    include_groups: false,
    delete_stale_canonical: false,
  };

  const { data, error } = await supabase.functions.invoke("market-dedupe-v3", {
    body: payload,
  });

  if (error) throw error;
  return (data ?? {}) as Record<string, unknown>;
}

export async function runMarketPriceHistory(
  params: MarketRefreshParams = {}
): Promise<Record<string, unknown>> {
  const payload = {
    window_hours: params.windowHours ?? 72,
    zip_code: normalizeValue(params.zipCode),
    city: normalizeValue(params.city),
    limit: params.limit ?? 5000,
    dry_run: Boolean(params.dryRun),
  };

  const { data, error } = await supabase.functions.invoke(
    "market-price-history-v1",
    {
      body: payload,
    }
  );

  if (error) throw error;
  return (data ?? {}) as Record<string, unknown>;
}

export async function runMarketStockHistory(
  params: MarketRefreshParams = {}
): Promise<Record<string, unknown>> {
  const payload = {
    zip_code: normalizeValue(params.zipCode),
    city: normalizeValue(params.city),
    dry_run: Boolean(params.dryRun),
    limit: params.limit ?? 5000,
  };

  const { data, error } = await supabase.functions.invoke(
    "market-stock-history-v1",
    {
      body: payload,
    }
  );

  if (error) throw error;
  return (data ?? {}) as Record<string, unknown>;
}

export async function refreshMarketPipeline(
  params: MarketRefreshParams = {}
): Promise<{
  dedupe: Record<string, unknown>;
  priceHistory: Record<string, unknown>;
  stockHistory: Record<string, unknown>;
}> {
  const dedupe = await runMarketDedupe(params);
  const priceHistory = await runMarketPriceHistory(params);
  const stockHistory = await runMarketStockHistory(params);

  return {
    dedupe,
    priceHistory,
    stockHistory,
  };
}

export async function fetchMarketSummary(
  zipCode?: string,
  city?: string
): Promise<MarketSummaryRow | null> {
  const [summaryResponse, activeRows] = await Promise.all([
    (async () => {
      let query = supabase.from("market_summary_v2").select("*").limit(1);
      query = applyZoneFilter(query, zipCode, city);

      const { data, error } = await query;
      if (error) throw error;

      return ((data ?? [])[0] as MarketSummaryRow | undefined) ?? null;
    })(),
    fetchActiveListingsSummaryRows(zipCode, city),
  ]);

  return mergeSummaryWithActiveListings(summaryResponse, activeRows, zipCode, city);
}

export async function fetchMarketNarrative(
  zipCode?: string,
  city?: string
): Promise<MarketNarrativeRow | null> {
  let query = supabase.from("market_narrative_summary").select("*").limit(1);
  query = applyZoneFilter(query, zipCode, city);

  const { data, error } = await query;
  if (error) throw error;

  return ((data ?? [])[0] as MarketNarrativeRow | undefined) ?? null;
}

export async function fetchMarketOpportunities(
  zipCode?: string,
  city?: string,
  limit = 5
): Promise<MarketOpportunityNarrativeRow[]> {
  let query = supabase
    .from("watchlist_opportunities_deduped")
    .select(
      `
      id,
      portal,
      listing_portal_id,
      url,
      city,
      zip_code,
      price,
      surface,
      price_m2,
      canonical_key,
      display_cluster_key,
      first_seen_at,
      seen_at,
      days_on_market,
      opportunity_score,
      opportunity_reason,
      duplicate_count
    `
    )
    .order("opportunity_score", { ascending: false })
    .order("price", { ascending: true })
    .limit(limit);

  query = applyZoneFilter(query, zipCode, city);

  const { data, error } = await query;
  if (error) throw error;

  return ((data ?? []) as MarketOpportunityDedupedRow[]).map(
    mapDedupedOpportunityToNarrative
  );
}

export async function fetchMarketTension(
  zipCode?: string,
  city?: string
): Promise<MarketTensionRow | null> {
  let query = supabase.from("market_tension_signal").select("*").limit(1);
  query = applyZoneFilter(query, zipCode, city);

  const { data, error } = await query;
  if (error) throw error;

  return ((data ?? [])[0] as MarketTensionRow | undefined) ?? null;
}

export async function fetchMarketVeilleBundle(
  zipCode?: string,
  city?: string
): Promise<MarketVeilleBundle> {
  const [summary, narrative, opportunities, tension] = await Promise.all([
    fetchMarketSummary(zipCode, city),
    fetchMarketNarrative(zipCode, city),
    fetchMarketOpportunities(zipCode, city, 5),
    fetchMarketTension(zipCode, city),
  ]);

  return {
    summary,
    narrative,
    opportunities,
    tension,
  };
}

export async function refreshAndLoadMarketVeille(
  params: MarketRefreshParams = {}
): Promise<{
  pipeline: {
    dedupe: Record<string, unknown>;
    priceHistory: Record<string, unknown>;
    stockHistory: Record<string, unknown>;
  };
  bundle: MarketVeilleBundle;
}> {
  const pipeline = await refreshMarketPipeline(params);
  const bundle = await fetchMarketVeilleBundle(params.zipCode, params.city);

  return {
    pipeline,
    bundle,
  };
}