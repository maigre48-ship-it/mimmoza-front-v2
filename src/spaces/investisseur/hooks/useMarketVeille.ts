import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchMarketOpportunities,
  fetchMarketZoneMetrics,
  refreshMarketZone,
  type MarketOpportunity,
  type MarketRefreshResult,
  type MarketZoneMetrics,
} from "../services/marketRefresh";
import {
  useAccessContext,
  canAccessFeature,
  isQuotaExhausted,
  ADMIN_DISPLAY_QUOTA,
  type AccessContext,
} from "@/lib/access";

// ─────────────────────────────────────────────────────────────────────────────

/** Mode transaction unique autorisé dans la veille. */
const SALE_MODE = "sale" as const;

// ─────────────────────────────────────────────────────────────────────────────

type UseMarketVeilleParams = {
  zipCode?: string;
  city?: string;
  /** Toujours "sale" — paramètre conservé pour compatibilité rétro mais ignoré. */
  transactionMode?: "sale";
  autoLoad?: boolean;
  autoRefreshOnMount?: boolean;
  opportunitiesLimit?: number;
  minScore?: number;
  freshnessThresholdHours?: number;
  userId?: string | null;
};

type UseMarketVeilleData = {
  metrics: MarketZoneMetrics | null;
  opportunities: MarketOpportunity[];
  narrative?: MarketZoneMetrics["narrative"];
  summary?: MarketZoneMetrics["summary"];
  tension?: MarketZoneMetrics["tension"];
  daily_refresh_limit?: number;
  remaining_refreshes?: number;
  refresh_blocked?: boolean;
};

type UseMarketVeilleReturn = {
  loading: boolean;
  refreshing: boolean;
  error: string | null;

  data: UseMarketVeilleData | null;
  metrics: MarketZoneMetrics | null;
  opportunities: MarketOpportunity[];

  usedCache: boolean;
  ingestSkipped: boolean;
  skipReason: string | null;
  roiScore: number | null;
  quotaRemaining: number | null;

  /** Contexte d'accès complet — exposé pour VeilleMarchePage. */
  accessCtx: AccessContext | null;
  /** Alias pour la compatibilité rétro. */
  isAdmin: boolean;
  bypassLimits: boolean;

  /** true si le refresh veille est accessible sur le plan/quota actuel. */
  canRefresh: boolean;

  reload: () => Promise<void>;
  reloadOnly: () => Promise<void>;
  refreshPipeline: (options?: { withIngest?: boolean }) => Promise<MarketRefreshResult>;
};

// ─────────────────────────────────────────────────────────────────────────────

function extractStepError(result: MarketRefreshResult): string {
  if (result.error) return result.error;

  const candidates = [
    result.ingest?.body,
    result.dedupe?.body,
    result.metrics?.body,
    result.opportunities?.body,
  ];

  for (const candidate of candidates) {
    if (
      candidate &&
      typeof candidate === "object" &&
      "message" in candidate &&
      typeof (candidate as { message?: unknown }).message === "string"
    ) {
      return (candidate as { message: string }).message;
    }
    if (
      candidate &&
      typeof candidate === "object" &&
      "error" in candidate &&
      typeof (candidate as { error?: unknown }).error === "string"
    ) {
      return (candidate as { error: string }).error;
    }
  }

  return "Une erreur est survenue pendant le refresh marché.";
}

// ─────────────────────────────────────────────────────────────────────────────

export function useMarketVeille(params: UseMarketVeilleParams): UseMarketVeilleReturn {
  const autoLoad = params.autoLoad ?? params.autoRefreshOnMount ?? false;

  const [loading, setLoading] = useState(Boolean(autoLoad));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<MarketZoneMetrics | null>(null);
  const [opportunities, setOpportunities] = useState<MarketOpportunity[]>([]);
  const [usedCache, setUsedCache] = useState(false);
  const [ingestSkipped, setIngestSkipped] = useState(false);
  const [skipReason, setSkipReason] = useState<string | null>(null);
  const [roiScore, setRoiScore] = useState<number | null>(null);
  const [quotaRemaining, setQuotaRemaining] = useState<number | null>(null);

  // ── Résolution du contexte d'accès via le moteur centralisé ───────────────
  const { ctx: accessCtx, loading: ctxLoading } = useAccessContext(params.userId);

  const isAdmin = accessCtx?.isAdmin ?? false;
  const bypassLimits = accessCtx?.bypassLimits ?? false;

  // ── canRefresh : expose si le bouton doit être actif ──────────────────────
  const canRefresh = useMemo(() => {
    if (!accessCtx) return false;
    if (!canAccessFeature(accessCtx, "veille.refresh")) return false;
    if (isQuotaExhausted(accessCtx, "veille.refresh")) return false;
    return true;
  }, [accessCtx]);

  // ─────────────────────────────────────────────────────────────────────────

  const hasZone = Boolean(params.zipCode?.trim() || params.city?.trim());

  // transactionMode est toujours "sale" — le paramètre entrant est ignoré
  // pour garantir qu'aucune location ne transite dans la veille.
  const baseParams = useMemo(
    () => ({
      zipCode: params.zipCode?.trim(),
      city: params.city?.trim(),
      transactionMode: SALE_MODE,
    }),
    [params.zipCode, params.city]
  );

  const reload = useCallback(async () => {
    if (!hasZone) {
      setMetrics(null);
      setOpportunities([]);
      return;
    }

    setError(null);

    try {
      const [metricsData, opportunitiesData] = await Promise.all([
        fetchMarketZoneMetrics(baseParams),
        fetchMarketOpportunities({
          ...baseParams,
          minScore: params.minScore ?? 0,
          limit: params.opportunitiesLimit ?? 50,
        }),
      ]);

      setMetrics(metricsData);
      setOpportunities(opportunitiesData);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setMetrics(null);
      setOpportunities([]);
    }
  }, [baseParams, hasZone, params.minScore, params.opportunitiesLimit]);

  const reloadOnly = useCallback(async () => {
    await reload();
  }, [reload]);

  const refreshPipeline = useCallback(
    async (options?: { withIngest?: boolean }) => {
      if (!hasZone) {
        const message = "Aucune zone active sélectionnée.";
        setError(message);
        return { ok: false, error: message };
      }

      // ── Vérification d'accès via le moteur centralisé ──────────────────
      if (accessCtx && !canAccessFeature(accessCtx, "veille.refresh")) {
        const message = "Accès veille.refresh non autorisé sur ce plan.";
        setError(message);
        return { ok: false, error: message };
      }

      setRefreshing(true);
      setError(null);
      setUsedCache(false);
      setIngestSkipped(false);
      setSkipReason(null);
      setRoiScore(null);

      try {
        const withIngest = options?.withIngest ?? true;

        if (isAdmin) {
          console.log(
            "[useMarketVeille] admin bypass active — refresh sans quota ni blocage",
            { zone: baseParams.zipCode ?? baseParams.city }
          );
        }

        const result = await refreshMarketZone({
          ...baseParams,
          withIngest,
          freshnessThresholdHours: params.freshnessThresholdHours ?? 6,
          userId: params.userId ?? undefined,
          dryRun: false,
          includeSamples: true,
          sampleLimit: 5,
          minScore: params.minScore ?? 0,
          windowHours: 24 * 30,
          limit: 200,
          maxPages: 5,
          // ── Propagation du bypass admin résolu par le moteur ──────────
          isAdmin,
          bypassLimits,
        });

        setUsedCache(result.used_cache ?? false);
        setIngestSkipped(result.ingest_skipped ?? false);
        setSkipReason(result.ingest_skip_reason ?? null);
        setRoiScore(result.roi_score ?? null);
        setQuotaRemaining(
          isAdmin ? ADMIN_DISPLAY_QUOTA : (result.quota_remaining ?? null)
        );

        if (!result.ok) {
          throw new Error(extractStepError(result));
        }

        await reload();
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        return { ok: false, error: message };
      } finally {
        setRefreshing(false);
      }
    },
    [
      accessCtx,
      baseParams,
      hasZone,
      isAdmin,
      bypassLimits,
      params.minScore,
      params.freshnessThresholdHours,
      params.userId,
      reload,
    ]
  );

  useEffect(() => {
    if (!autoLoad || ctxLoading) return;
    if (!hasZone) {
      setLoading(false);
      setMetrics(null);
      setOpportunities([]);
      return;
    }

    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        await reload();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [autoLoad, ctxLoading, hasZone, reload]);

  // ── data : quotas overridés pour l'admin ──────────────────────────────────
  const data: UseMarketVeilleData | null = useMemo(() => {
    if (!metrics && opportunities.length === 0) return null;

    return {
      metrics,
      opportunities,
      narrative: metrics?.narrative,
      summary: metrics?.summary,
      tension: metrics?.tension,
      daily_refresh_limit: isAdmin ? ADMIN_DISPLAY_QUOTA : (metrics?.daily_refresh_limit ?? undefined),
      remaining_refreshes: isAdmin ? ADMIN_DISPLAY_QUOTA : (metrics?.remaining_refreshes ?? undefined),
      refresh_blocked: isAdmin ? false : (metrics?.refresh_blocked ?? undefined),
    };
  }, [metrics, opportunities, isAdmin]);

  return {
    loading: loading || ctxLoading,
    refreshing,
    error,
    data,
    metrics,
    opportunities,
    usedCache,
    ingestSkipped,
    skipReason,
    roiScore,
    quotaRemaining: isAdmin ? ADMIN_DISPLAY_QUOTA : quotaRemaining,
    accessCtx,
    isAdmin,
    bypassLimits,
    canRefresh,
    reload,
    reloadOnly,
    refreshPipeline,
  };
}