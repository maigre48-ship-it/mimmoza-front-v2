// ============================================================================
// useSmartScore.ts
// Hook principal pour le SmartScore V4
// Fetch, cache, recalcul temps réel avec poids custom
// ============================================================================

import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabaseClient";

// ─── Types ──────────────────────────────────────────────────────────────────

export type SmartScorePillar =
  | "transport"
  | "commodites"
  | "ecoles"
  | "marche"
  | "sante"
  | "essential_services"
  | "environnement"
  | "concurrence"
  | "demographie";

export type PillarScoreEntry = {
  key: SmartScorePillar;
  label: string;
  score: number | null;
  weight: number;
  color: string;
  icon: string;
};

export type SmartScoreData = {
  score: number;
  verdict: string;
  pillarScores: Record<SmartScorePillar, number | null>;
  weights: Record<SmartScorePillar, number>;
  activeWeights: Record<SmartScorePillar, number>;
  projectNature: string;
  isRural: boolean;
  zoneType: "rural" | "urbain";
  // Market intelligence
  priceTrend: {
    current_estimated_m2: number;
    projected_12m_m2: number;
    projected_12m_range: { low: number; high: number };
    slope_pct_per_year: number;
    trend_label: string;
    confidence: string;
    quarterly_prices: Array<{ quarter: string; median_m2: number; count: number }>;
  } | null;
  liquidity: {
    score: number;
    label: string;
    estimated_days_to_sell: number | null;
    transactions_per_year: number;
  } | null;
  rentalTension: {
    score: number;
    label: string;
    rendement_brut_pct: number | null;
    ratio_prix_loyer: number | null;
    loyer_estime_m2_mois: number;
  } | null;
  // Essential services
  essentialServicesScore: {
    score: number;
    coverage_pct: number;
    missing: string[];
  } | null;
  // Benchmark
  benchmark: {
    percentile: number;
    rank_label: string;
    sample_size: number;
    scope: string;
  } | null;
  // KPIs bruts pour affichage
  kpis: Array<{
    label: string;
    value: string | number | null;
    unit?: string;
    trend?: "up" | "down" | "stable" | null;
    description?: string;
  }>;
  insights: Array<{
    type: "positive" | "negative" | "neutral" | "warning";
    title: string;
    description: string;
    source?: string;
  }>;
  // Métriques pour comparaison
  metrics: {
    prix_median_m2: number | null;
    transactions_count: number | null;
    rendement_brut_pct: number | null;
    liquidite_score: number | null;
    tendance_pct_an: number | null;
    pharmacie_km: number | null;
    commerce_km: number | null;
    medecin_km: number | null;
    hopital_km: number | null;
    population: number | null;
    pct_plus_65: number | null;
  };
};

type UseSmartScoreOptions = {
  mode?: "market_study" | "standard";
  parcelId?: string | null;
  communeInsee?: string | null;
  projectNature?: string;
  lat?: number | null;
  lon?: number | null;
  radiusKm?: number;
  horizonMonths?: number;
  typeLocal?: string | null;
  debug?: boolean;
  enabled?: boolean;
};

type UseSmartScoreReturn = {
  data: SmartScoreData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  // Recalcul avec poids custom (pas de re-fetch)
  recalculateWithWeights: (weights: Record<SmartScorePillar, number>) => number;
  // Piliers formatés pour les composants
  pillarEntries: PillarScoreEntry[];
};

// ─── Pillar meta ────────────────────────────────────────────────────────────

const PILLAR_META: Record<SmartScorePillar, { label: string; icon: string; color: string }> = {
  transport:          { label: "Transports",    icon: "🚆", color: "#3b82f6" },
  commodites:         { label: "Commodités",    icon: "🛍️", color: "#8b5cf6" },
  ecoles:             { label: "Écoles",        icon: "🎓", color: "#f59e0b" },
  marche:             { label: "Marché",        icon: "📈", color: "#10b981" },
  sante:              { label: "Santé",         icon: "❤️", color: "#ef4444" },
  essential_services: { label: "Services",      icon: "📍", color: "#06b6d4" },
  environnement:      { label: "Environnement", icon: "🌿", color: "#22c55e" },
  concurrence:        { label: "Concurrence",   icon: "🏗️", color: "#f97316" },
  demographie:        { label: "Démographie",   icon: "👥", color: "#a855f7" },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function extractMetrics(raw: any): SmartScoreData["metrics"] {
  const market = raw?.market ?? raw?.market_like ?? {};
  const services = market?.services_ruraux ?? {};
  const insee = market?.insee ?? {};

  return {
    prix_median_m2: market?.prices?.median_eur_m2 ?? null,
    transactions_count: market?.transactions?.count ?? null,
    rendement_brut_pct: market?.market_intelligence?.rental_tension?.rendement_brut_pct ?? null,
    liquidite_score: market?.market_intelligence?.liquidity?.score ?? null,
    tendance_pct_an: market?.market_intelligence?.price_trend?.slope_pct_per_year ?? null,
    pharmacie_km: services?.pharmacie_proche?.distance_km ?? null,
    commerce_km: services?.supermarche_proche?.distance_km ?? null,
    medecin_km: services?.medecin_proche?.distance_km ?? null,
    hopital_km: market?.healthSummary?.hopital_proche?.distance_km ?? null,
    population: insee?.population ?? null,
    pct_plus_65: insee?.pct_plus_65 ?? null,
  };
}

function extractPillarScores(raw: any): Record<SmartScorePillar, number | null> {
  const v4 = raw?.smartscore_v4 ?? {};
  if (v4.pillar_scores) return v4.pillar_scores;

  // Fallback : construire depuis les données brutes
  const market = raw?.market ?? raw?.market_like ?? {};
  const smartscore = raw?.smartscore ?? {};

  return {
    transport: smartscore?.components?.transport ?? market?.transport?.score ?? null,
    commodites: smartscore?.components?.commodites ?? market?.commoditesScore ?? null,
    ecoles: smartscore?.components?.ecoles ?? market?.ecoles?.scoreEcoles ?? null,
    marche: smartscore?.components?.marche ?? null,
    sante: smartscore?.components?.sante ?? null,
    essential_services: market?.essential_services_score?.score ?? null,
    environnement: null,
    concurrence: null,
    demographie: null,
  };
}

function parseResponse(raw: any): SmartScoreData {
  const market = raw?.market ?? raw?.market_like ?? {};
  const v4 = raw?.smartscore_v4 ?? {};
  const mi = market?.market_intelligence ?? {};

  const pillarScores = extractPillarScores(raw);
  const activeWeights = v4?.active_weights ?? v4?.weights ?? {};

  return {
    score: v4?.score ?? raw?.smartscore?.score ?? market?.score ?? 50,
    verdict: v4?.verdict ?? raw?.smartscore?.verdict ?? market?.verdict ?? "",
    pillarScores,
    weights: v4?.weights ?? {},
    activeWeights,
    projectNature: v4?.project_nature ?? raw?.input?.project_nature ?? "standard",
    isRural: v4?.is_rural ?? raw?.zone_type === "rural",
    zoneType: raw?.zone_type ?? "urbain",
    priceTrend: mi?.price_trend ?? null,
    liquidity: mi?.liquidity ?? null,
    rentalTension: mi?.rental_tension ?? null,
    essentialServicesScore: v4?.essential_services_score ?? market?.essential_services_score ?? null,
    benchmark: v4?.benchmark ?? null,
    kpis: market?.kpis ?? [],
    insights: market?.insights ?? [],
    metrics: extractMetrics(raw),
  };
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useSmartScore(options: UseSmartScoreOptions): UseSmartScoreReturn {
  const {
    mode = "standard",
    parcelId,
    communeInsee,
    projectNature = "logement",
    lat,
    lon,
    radiusKm = 2,
    horizonMonths = 24,
    typeLocal,
    debug = false,
    enabled = true,
  } = options;

  const [data, setData] = useState<SmartScoreData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchScore = useCallback(async () => {
    if (!enabled) return;
    if (!parcelId && !communeInsee && (lat == null || lon == null)) return;

    setLoading(true);
    setError(null);

    try {
      const payload: Record<string, any> = {
        mode,
        debug,
        radius_km: radiusKm,
        horizon_months: horizonMonths,
      };

      if (parcelId) payload.parcel_id = parcelId;
      if (communeInsee) payload.commune_insee = communeInsee;
      if (lat != null && lon != null) {
        payload.lat = lat;
        payload.lon = lon;
      }

      if (mode === "market_study") {
        payload.project_nature = projectNature;
      } else {
        if (typeLocal) payload.type_local = typeLocal;
      }

      const { data: result, error: rpcError } = await supabase.functions.invoke(
        "smartscore-enriched-v3",
        { body: payload },
      );

      if (rpcError) throw new Error(rpcError.message);
      if (!result?.success) throw new Error(result?.error ?? "Erreur SmartScore");

      setData(parseResponse(result));
    } catch (e: any) {
      console.error("[useSmartScore] error:", e);
      setError(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [enabled, mode, parcelId, communeInsee, lat, lon, projectNature, radiusKm, horizonMonths, typeLocal, debug]);

  useEffect(() => {
    fetchScore();
  }, [fetchScore]);

  // Recalcul avec poids custom (côté client, pas de re-fetch)
  const recalculateWithWeights = useCallback(
    (weights: Record<SmartScorePillar, number>): number => {
      if (!data) return 50;
      let totalW = 0;
      let totalS = 0;
      for (const [pillar, weight] of Object.entries(weights)) {
        if (weight <= 0) continue;
        const score = data.pillarScores[pillar as SmartScorePillar];
        if (score == null) continue;
        totalW += weight;
        totalS += score * weight;
      }
      return totalW > 0 ? Math.round(totalS / totalW) : 50;
    },
    [data],
  );

  // Piliers formatés pour les composants UI
  const pillarEntries = useMemo((): PillarScoreEntry[] => {
    if (!data) return [];
    return (Object.keys(PILLAR_META) as SmartScorePillar[])
      .map((key) => ({
        key,
        label: PILLAR_META[key].label,
        score: data.pillarScores[key],
        weight: data.activeWeights[key] ?? 0,
        color: PILLAR_META[key].color,
        icon: PILLAR_META[key].icon,
      }))
      .filter((p) => p.weight > 0)
      .sort((a, b) => b.weight - a.weight);
  }, [data]);

  return {
    data,
    loading,
    error,
    refetch: fetchScore,
    recalculateWithWeights,
    pillarEntries,
  };
}