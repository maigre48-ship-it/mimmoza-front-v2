import { supabase } from "@/lib/supabase";
import type { AccessContext } from "@/lib/access";

// ─── Configuration des politiques production ─────────────────────────────────
//
// Ces constantes peuvent à terme être externalisées dans une table Supabase
// `app_config` pour permettre une modification sans redéploiement.

const POLICY = {
  DEFAULT_FRESHNESS_HOURS: 6,
  COOLDOWN_TRIGGER_CONSECUTIVE_ZEROS: 2,
  COOLDOWN_DURATION_HOURS: 2,
  COOLDOWN_LOOKBACK_HOURS: 4,
  QUOTA_DAILY_INGEST_PER_USER: 5,
  QUOTA_DAILY_INGEST_PER_USER_PER_ZONE: 3,
} as const;

const ADMIN_UNLIMITED_QUOTA = 999;

// ─────────────────────────────────────────────────────────────────────────────

export type MarketRefreshParams = {
  zipCode?: string;
  city?: string;
  transactionMode?: "all" | "sale" | "rent";
  withIngest?: boolean;
  dryRun?: boolean;
  limit?: number;
  maxPages?: number;
  startPage?: number;
  windowHours?: number;
  minScore?: number;
  includeSamples?: boolean;
  sampleLimit?: number;
  debugGeo?: boolean;
  freshnessThresholdHours?: number;
  userId?: string;
  /**
   * Contexte d'accès résolu par le moteur centralisé.
   * Si fourni, il prime sur isAdmin/bypassLimits.
   */
  accessCtx?: AccessContext | null;
  /** Compatibilité rétro — sera retiré dans une future version. */
  isAdmin?: boolean;
  bypassLimits?: boolean;
};

export type MarketRefreshStepResult = {
  ok: boolean;
  status?: number;
  body?: unknown;
};

export type MarketRefreshResult = {
  ok: boolean;
  ingest?: MarketRefreshStepResult;
  dedupe?: MarketRefreshStepResult;
  metrics?: MarketRefreshStepResult;
  opportunities?: MarketRefreshStepResult;
  error?: string;
  used_cache?: boolean;
  ingest_skipped?: boolean;
  ingest_skip_reason?: string;
  zone_age_hours?: number | null;
  roi_score?: number | null;
  quota_remaining?: number | null;
};

export type MarketZoneMetrics = {
  zone_key: string;
  city: string | null;
  zip_code: string | null;
  transaction_mode: string | null;
  active_listings: number | null;
  new_listings_7d: number | null;
  median_price_m2: number | null;
  median_days_on_market: number | null;
  liquidity_signal: string | null;
  tension_signal: string | null;
  computed_at: string | null;
  payload: Record<string, unknown> | null;
  narrative?: Record<string, unknown> | null;
  summary?: Record<string, unknown> | null;
  tension?: Record<string, unknown> | null;
  daily_refresh_limit?: number | null;
  remaining_refreshes?: number | null;
  refresh_blocked?: boolean | null;
};

export type MarketOpportunity = {
  canonical_key: string;
  zone_key: string;
  city: string | null;
  zip_code: string | null;
  price: number | null;
  surface: number | null;
  price_m2: number | null;
  portal_count: number | null;
  listing_count: number | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  representative_url: string | null;
  opportunity_score: number | null;
  opportunity_bucket: "faible" | "moyenne" | "forte" | null;
  score_freshness: number | null;
  score_price_position: number | null;
  score_diffusion: number | null;
  score_multi_portal: number | null;
  score_zone_liquidity: number | null;
  price_position_pct: number | null;
  days_on_market: number | null;
  updated_at: string | null;
  payload: Record<string, unknown> | null;
};

// ─── Types internes ───────────────────────────────────────────────────────────

type ZonePolicyDecision =
  | { allow: false; skip_reason: string; zone_age_hours: number | null; quota_remaining: number | null }
  | { allow: true; used_cache: boolean; zone_age_hours: number | null; quota_remaining: number | null };

type RefreshLogRow = {
  retained_count: number;
  created_at: string;
};

// ─── Résolution admin bypass ──────────────────────────────────────────────────
//
// Priorité : accessCtx (moteur centralisé) > isAdmin/bypassLimits (rétro-compat)

function resolveAdminBypass(params: MarketRefreshParams): boolean {
  if (params.accessCtx != null) {
    return Boolean(params.accessCtx.bypassLimits) || Boolean(params.accessCtx.isAdmin);
  }
  return Boolean(params.isAdmin) || Boolean(params.bypassLimits);
}

function resolveUserId(params: MarketRefreshParams): string | null {
  return params.accessCtx?.userId ?? params.userId ?? null;
}

function buildUnlimitedQuotaState(): Extract<ZonePolicyDecision, { allow: true }> {
  return { allow: true, used_cache: false, zone_age_hours: null, quota_remaining: ADMIN_UNLIMITED_QUOTA };
}

// ─── Utilitaires ──────────────────────────────────────────────────────────────

function normalizeText(value?: string): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

function normalizeCityKey(city: string): string {
  return city
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['']/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function buildZoneFunctionPayload(params: {
  zipCode?: string;
  city?: string;
  transactionMode?: "all" | "sale" | "rent";
}) {
  return {
    zip_code: normalizeText(params.zipCode),
    city: normalizeText(params.city),
    transaction_mode: params.transactionMode ?? "all",
  };
}

function computeRoiScore(params: {
  fetched_adverts: number;
  retained_count: number;
  opportunities_computed: number;
}): number {
  const retentionComponent =
    params.fetched_adverts > 0
      ? Math.min((params.retained_count / params.fetched_adverts) * 60, 60)
      : 0;
  const opportunityComponent = Math.min(params.opportunities_computed * 4, 40);
  return Math.round(retentionComponent + opportunityComponent);
}

// ─── Politique zone ───────────────────────────────────────────────────────────

/**
 * Vérifie fraîcheur, cooldown et quota.
 * Court-circuite immédiatement si admin bypass actif (défense en profondeur).
 */
async function checkZonePolicy(
  zoneKey: string,
  params: MarketRefreshParams
): Promise<ZonePolicyDecision> {
  // ── [0] Court-circuit admin ───────────────────────────────────────────────
  if (resolveAdminBypass(params)) {
    console.log("[marketRefresh] policy skipped (admin)", { zone_key: zoneKey });
    return buildUnlimitedQuotaState();
  }

  const freshnessThreshold = params.freshnessThresholdHours ?? POLICY.DEFAULT_FRESHNESS_HOURS;
  const userId = resolveUserId(params);
  const now = Date.now();
  const oneDayAgo = new Date(now - 24 * 3_600_000).toISOString();

  // ── [1] Fraîcheur ─────────────────────────────────────────────────────────
  const { data: zoneMetrics } = await supabase
    .from("market_zone_metrics")
    .select("computed_at, active_listings")
    .eq("zone_key", zoneKey)
    .maybeSingle();

  let zone_age_hours: number | null = null;

  if (zoneMetrics?.computed_at) {
    const ageMs = now - new Date(zoneMetrics.computed_at).getTime();
    zone_age_hours = Math.round((ageMs / (1_000 * 3_600)) * 10) / 10;

    const hasRealData =
      typeof zoneMetrics.active_listings === "number" &&
      zoneMetrics.active_listings > 0;

    if (hasRealData && freshnessThreshold > 0 && zone_age_hours < freshnessThreshold) {
      return { allow: false, skip_reason: "fresh_enough_data", zone_age_hours, quota_remaining: null };
    }
  }

  // ── [2] Cooldown zone ─────────────────────────────────────────────────────
  const cooldownLookbackAt = new Date(
    now - POLICY.COOLDOWN_LOOKBACK_HOURS * 3_600_000
  ).toISOString();

  const { data: recentLogs } = await supabase
    .from("market_zone_refresh_log")
    .select("retained_count, created_at")
    .eq("zone_key", zoneKey)
    .eq("ingest_skipped", false)
    .gte("created_at", cooldownLookbackAt)
    .order("created_at", { ascending: false })
    .limit(POLICY.COOLDOWN_TRIGGER_CONSECUTIVE_ZEROS + 1);

  if (recentLogs && recentLogs.length >= POLICY.COOLDOWN_TRIGGER_CONSECUTIVE_ZEROS) {
    const lastN = (recentLogs as RefreshLogRow[]).slice(0, POLICY.COOLDOWN_TRIGGER_CONSECUTIVE_ZEROS);
    const allZeros = lastN.every((r) => r.retained_count === 0);

    if (allZeros) {
      const mostRecentAt = new Date(lastN[0].created_at).getTime();
      const cooldownExpiresAt = mostRecentAt + POLICY.COOLDOWN_DURATION_HOURS * 3_600_000;

      if (now < cooldownExpiresAt) {
        return { allow: false, skip_reason: "low_roi_cooldown", zone_age_hours, quota_remaining: null };
      }
    }
  }

  // ── [3] Quota utilisateur ─────────────────────────────────────────────────
  let quota_remaining: number | null = null;

  if (userId) {
    const { count: dailyTotal } = await supabase
      .from("market_zone_refresh_log")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("ingest_skipped", false)
      .gte("created_at", oneDayAgo);

    const usedTotal = dailyTotal ?? 0;
    const remainingTotal = POLICY.QUOTA_DAILY_INGEST_PER_USER - usedTotal;

    if (remainingTotal <= 0) {
      return { allow: false, skip_reason: "quota_exceeded", zone_age_hours, quota_remaining: 0 };
    }

    const { count: zoneTotal } = await supabase
      .from("market_zone_refresh_log")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("zone_key", zoneKey)
      .eq("ingest_skipped", false)
      .gte("created_at", oneDayAgo);

    const usedZone = zoneTotal ?? 0;
    const remainingZone = POLICY.QUOTA_DAILY_INGEST_PER_USER_PER_ZONE - usedZone;

    if (remainingZone <= 0) {
      return { allow: false, skip_reason: "quota_exceeded_zone", zone_age_hours, quota_remaining: 0 };
    }

    quota_remaining = Math.min(remainingTotal, remainingZone);
  }

  return { allow: true, used_cache: false, zone_age_hours, quota_remaining };
}

// ─── Log refresh ──────────────────────────────────────────────────────────────

async function logZoneRefresh(params: {
  zoneKey: string;
  userId: string | null;
  fetchedAdverts: number;
  retainedCount: number;
  upserted: number;
  opportunitiesComputed: number;
  roiScore: number;
  ingestSkipped: boolean;
  skipReason: string | null;
  earlyBail: boolean;
  costEfficiencySignal: string | null;
  pagesFetched: number;
}): Promise<void> {
  try {
    await supabase.from("market_zone_refresh_log").insert({
      zone_key: params.zoneKey,
      user_id: params.userId,
      fetched_adverts: params.fetchedAdverts,
      retained_count: params.retainedCount,
      upserted: params.upserted,
      opportunities_computed: params.opportunitiesComputed,
      roi_score: params.roiScore,
      ingest_skipped: params.ingestSkipped,
      skip_reason: params.skipReason,
      early_bail: params.earlyBail,
      cost_efficiency_signal: params.costEfficiencySignal,
      pages_fetched: params.pagesFetched,
    });
  } catch (err) {
    console.warn("[marketRefresh] logZoneRefresh failed (non-blocking):", err);
  }
}

// ─── Invocation edge functions ────────────────────────────────────────────────

async function invokeFunction<T = unknown>(
  fnName: string,
  payload: Record<string, unknown>
): Promise<MarketRefreshStepResult & { data?: T }> {
  console.log(`[marketRefresh] invoke ${fnName}`, payload);

  const { data, error } = await supabase.functions.invoke(fnName, { body: payload });

  console.log(`[marketRefresh] response ${fnName}`, { data, error: error ?? null });

  if (error) {
    return {
      ok: false,
      body: { message: error.message, name: error.name, context: error.context },
    };
  }

  const isOk =
    typeof data === "object" &&
    data !== null &&
    "ok" in data &&
    (data as { ok?: boolean }).ok === true;

  return { ok: isOk, data: data as T, body: data };
}

// ─── Pipeline principal ───────────────────────────────────────────────────────

export async function refreshMarketZone(
  params: MarketRefreshParams
): Promise<MarketRefreshResult> {
  const zonePayload = buildZoneFunctionPayload(params);
  const zoneKey = buildZoneKey(params);
  const dryRun = Boolean(params.dryRun);
  const userId = resolveUserId(params);

  const isAdminBypass = resolveAdminBypass(params);

  if (isAdminBypass) {
    console.log("[marketRefresh] admin bypass active", {
      zone_key: zoneKey,
      source: params.accessCtx ? "accessCtx" : "legacy_flags",
    });
  }

  const result: MarketRefreshResult = { ok: false };

  if (params.withIngest) {
    // checkZonePolicy gère déjà le bypass admin en interne (défense en profondeur)
    const policy = await checkZonePolicy(zoneKey, params);

    if (!policy.allow) {
      console.log("[marketRefresh] ingest BLOCKED by policy", JSON.stringify({
        zone_key: zoneKey,
        skip_reason: policy.skip_reason,
        zone_age_hours: policy.zone_age_hours,
        quota_remaining: policy.quota_remaining,
      }));

      result.ingest = {
        ok: true,
        body: { skipped: true, reason: policy.skip_reason, zone_age_hours: policy.zone_age_hours },
      };
      result.ingest_skipped = true;
      result.ingest_skip_reason = policy.skip_reason;
      result.zone_age_hours = policy.zone_age_hours;
      result.used_cache = policy.skip_reason === "fresh_enough_data";
      result.quota_remaining = policy.quota_remaining;
      result.roi_score = null;

      await logZoneRefresh({
        zoneKey, userId,
        fetchedAdverts: 0, retainedCount: 0, upserted: 0, opportunitiesComputed: 0,
        roiScore: 0, ingestSkipped: true, skipReason: policy.skip_reason,
        earlyBail: false, costEfficiencySignal: null, pagesFetched: 0,
      });
    } else {
      console.log("[marketRefresh] ingest ALLOWED", JSON.stringify({
        zone_key: zoneKey,
        zone_age_hours: policy.zone_age_hours,
        quota_remaining: policy.quota_remaining,
        ...(isAdminBypass && { reason: "admin bypass active" }),
      }));

      const ingest = await invokeFunction("stream-estate-ingest-v1", {
        ...zonePayload,
        limit: params.limit ?? 500,
        max_pages: params.maxPages ?? 10,
        start_page: params.startPage ?? 1,
        dry_run: dryRun,
        debug_geo: Boolean(params.debugGeo),
      });

      result.ingest = ingest;
      result.zone_age_hours = policy.zone_age_hours;
      result.quota_remaining = isAdminBypass
        ? ADMIN_UNLIMITED_QUOTA
        : policy.quota_remaining !== null
        ? policy.quota_remaining - 1
        : null;

      if (!ingest.ok) {
        await logZoneRefresh({
          zoneKey, userId,
          fetchedAdverts: 0, retainedCount: 0, upserted: 0, opportunitiesComputed: 0,
          roiScore: 0, ingestSkipped: false, skipReason: "ingest_error",
          earlyBail: false, costEfficiencySignal: "zero", pagesFetched: 0,
        });

        return {
          ...result,
          error: extractFunctionError(ingest.body) ?? "stream-estate-ingest-v1 failed",
        };
      }

      const ingestBody = ingest.body as Record<string, unknown> | null;
      const fetchedAdverts = typeof ingestBody?.fetched_adverts === "number" ? ingestBody.fetched_adverts : 0;
      const retainedCount = typeof ingestBody?.retained_count === "number" ? ingestBody.retained_count : 0;
      const upserted = typeof ingestBody?.upserted === "number" ? ingestBody.upserted : 0;
      const earlyBail = Boolean(ingestBody?.early_bail);
      const costEfficiencySignal = typeof ingestBody?.cost_efficiency_signal === "string" ? ingestBody.cost_efficiency_signal : null;
      const pagesFetched = typeof ingestBody?.pages_fetched === "number" ? ingestBody.pages_fetched : 0;

      const partialRoi = computeRoiScore({ fetched_adverts: fetchedAdverts, retained_count: retainedCount, opportunities_computed: 0 });
      result.roi_score = partialRoi;

      if (retainedCount === 0) {
        console.warn("[marketRefresh] ⚠ ingest retained=0", JSON.stringify({
          zone_key: zoneKey, fetched_adverts: fetchedAdverts, early_bail: earlyBail,
        }));
      }

      await logZoneRefresh({
        zoneKey, userId,
        fetchedAdverts, retainedCount, upserted, opportunitiesComputed: 0,
        roiScore: partialRoi, ingestSkipped: false, skipReason: null,
        earlyBail, costEfficiencySignal, pagesFetched,
      });
    }
  }

  // ── Dedupe ────────────────────────────────────────────────────────────────
  const dedupe = await invokeFunction("market-dedupe-v1", {
    ...zonePayload,
    window_hours: params.windowHours ?? 24 * 30,
    dry_run: dryRun,
    include_groups: false,
    delete_stale_canonical: false,
  });

  result.dedupe = dedupe;
  if (!dedupe.ok) return { ...result, error: extractFunctionError(dedupe.body) ?? "market-dedupe-v1 failed" };

  // ── Métriques zone ────────────────────────────────────────────────────────
  const metrics = await invokeFunction("market-metrics-zone-v1", {
    ...zonePayload,
    dry_run: dryRun,
    include_samples: Boolean(params.includeSamples),
    sample_limit: params.sampleLimit ?? 5,
  });

  result.metrics = metrics;
  if (!metrics.ok) return { ...result, error: extractFunctionError(metrics.body) ?? "market-metrics-zone-v1 failed" };

  // ── Opportunités ──────────────────────────────────────────────────────────
  const opportunities = await invokeFunction("market-opportunity-refresh-v1", {
    ...zonePayload,
    dry_run: dryRun,
    include_samples: Boolean(params.includeSamples),
    sample_limit: params.sampleLimit ?? 5,
    min_score: params.minScore ?? 0,
  });

  result.opportunities = opportunities;
  if (!opportunities.ok) return { ...result, error: extractFunctionError(opportunities.body) ?? "market-opportunity-refresh-v1 failed" };

  // ── ROI score final ───────────────────────────────────────────────────────
  if (params.withIngest && !result.ingest_skipped) {
    const oppBody = opportunities.body as Record<string, unknown> | null;
    const opportunitiesComputed = typeof oppBody?.opportunities_computed === "number" ? oppBody.opportunities_computed : 0;
    const ingestBody = result.ingest?.body as Record<string, unknown> | null;
    const fetchedAdverts = typeof ingestBody?.fetched_adverts === "number" ? ingestBody.fetched_adverts : 0;
    const retainedCount = typeof ingestBody?.retained_count === "number" ? ingestBody.retained_count : 0;
    const finalRoi = computeRoiScore({ fetched_adverts: fetchedAdverts, retained_count: retainedCount, opportunities_computed: opportunitiesComputed });
    result.roi_score = finalRoi;
  }

  return { ...result, ok: true };
}

// ─── Helpers exports ──────────────────────────────────────────────────────────

function extractFunctionError(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  if ("message" in body && typeof (body as { message?: unknown }).message === "string") {
    return (body as { message: string }).message;
  }
  if ("error" in body && typeof (body as { error?: unknown }).error === "string") {
    return (body as { error: string }).error;
  }
  return null;
}

export function buildZoneKey(input: {
  zipCode?: string;
  city?: string;
  transactionMode?: "all" | "sale" | "rent";
}): string {
  const tx = input.transactionMode ?? "all";
  const zip = normalizeText(input.zipCode);
  if (zip) return `${zip}|${tx}`;
  const city = normalizeText(input.city);
  if (!city) return `all|${tx}`;
  return `${normalizeCityKey(city)}|${tx}`;
}

export async function fetchMarketZoneMetrics(input: {
  zipCode?: string;
  city?: string;
  transactionMode?: "all" | "sale" | "rent";
}): Promise<MarketZoneMetrics | null> {
  const zoneKey = buildZoneKey(input);
  const { data, error } = await supabase.from("market_zone_metrics").select("*").eq("zone_key", zoneKey).maybeSingle();
  if (error) throw error;
  return (data ?? null) as MarketZoneMetrics | null;
}

export async function fetchMarketOpportunities(input: {
  zipCode?: string;
  city?: string;
  transactionMode?: "all" | "sale" | "rent";
  minScore?: number;
  limit?: number;
}): Promise<MarketOpportunity[]> {
  const zoneKey = buildZoneKey(input);
  let query = supabase.from("market_opportunities").select("*").eq("zone_key", zoneKey).order("opportunity_score", { ascending: false });
  if (typeof input.minScore === "number") query = query.gte("opportunity_score", input.minScore);
  if (typeof input.limit === "number") query = query.limit(input.limit);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as MarketOpportunity[];
}