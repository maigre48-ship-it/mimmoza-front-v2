import { supabase } from "@/lib/supabase";

export type MarketActiveListing = {
  id: string;
  external_id: string;
  external_source: string;
  source_portal: string | null;
  source_listing_id: string | null;
  source_url: string | null;

  title: string | null;
  price: number | null;
  price_per_m2: number | null;
  surface_m2: number | null;
  rooms: number | null;
  bedrooms: number | null;

  property_type: number | null;
  transaction_type: number | null;

  city: string | null;
  zip_code: string | null;
  insee_code: string | null;
  department_code: string | null;
  region_name: string | null;

  latitude: number | null;
  longitude: number | null;

  energy_label: string | null;
  ghg_label: string | null;
  coherent_price: boolean | null;

  pictures: string[] | null;

  first_seen_at: string | null;
  last_seen_at: string | null;
  last_crawled_at: string | null;
};

export type FetchMarketActiveListingsParams = {
  zipCode?: string;
  zipCodes?: string[];
  city?: string;
  cities?: string[];
  limit?: number;
};

function normalizeText(value?: string | null): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

function normalizeList(values?: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      (values ?? [])
        .map((value) => normalizeText(value))
        .filter((value): value is string => Boolean(value))
    )
  );
}

function escapeIlike(value: string): string {
  return value.replace(/[%_]/g, "\\$&");
}

export async function fetchMarketActiveListings(
  params?: FetchMarketActiveListingsParams
): Promise<MarketActiveListing[]> {
  const zipCodes = normalizeList(params?.zipCodes);
  const cities = normalizeList(params?.cities);

  const zipCode = normalizeText(params?.zipCode);
  const city = normalizeText(params?.city);

  const limit =
    typeof params?.limit === "number" && Number.isFinite(params.limit)
      ? Math.max(1, Math.min(Math.floor(params.limit), 200))
      : 20;

  let query = supabase
    .from("v_market_active_listings")
    .select(`
      id,
      external_id,
      external_source,
      source_portal,
      source_listing_id,
      source_url,
      title,
      price,
      price_per_m2,
      surface_m2,
      rooms,
      bedrooms,
      property_type,
      transaction_type,
      city,
      zip_code,
      insee_code,
      department_code,
      region_name,
      latitude,
      longitude,
      energy_label,
      ghg_label,
      coherent_price,
      pictures,
      first_seen_at,
      last_seen_at,
      last_crawled_at
    `)
    .order("last_seen_at", { ascending: false })
    .limit(limit);

  if (zipCodes.length > 0) {
    query = query.in("zip_code", zipCodes);
  } else if (zipCode) {
    query = query.eq("zip_code", zipCode);
  }

  if (cities.length > 0) {
    if (cities.length === 1) {
      query = query.ilike("city", escapeIlike(cities[0]));
    } else {
      const cityOr = cities
        .map((value) => `city.ilike.${escapeIlike(value)}`)
        .join(",");
      query = query.or(cityOr);
    }
  } else if (city) {
    query = query.ilike("city", escapeIlike(city));
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(
      `[fetchMarketActiveListings] ${error.message || "Unknown Supabase error"}`
    );
  }

  return (data ?? []) as MarketActiveListing[];
}