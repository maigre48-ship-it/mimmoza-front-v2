// ============================================================================
// useSmartScoreAlerts.ts
// Hook pour les alertes pipeline
// ============================================================================

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";

type Alert = {
  id: string;
  deal_id: string;
  deal_label: string;
  category: string;
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  previous_value: number | null;
  current_value: number | null;
  delta: number | null;
  delta_pct: number | null;
  pillar?: string;
  action_label?: string;
  action_route?: string;
  created_at: string;
  read_at?: string | null;
};

type UseAlertsReturn = {
  alerts: Alert[];
  loading: boolean;
  counts: { total: number; critical: number; warning: number; info: number };
  markRead: (ids: string[]) => Promise<void>;
  dismiss: (id: string) => Promise<void>;
  refetch: () => void;
};

export function useSmartScoreAlerts(userId: string | null): UseAlertsReturn {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchAlerts = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("get_unread_alerts", {
        p_user_id: userId,
        p_limit: 50,
      });
      if (!error && Array.isArray(data)) {
        setAlerts(data as Alert[]);
      }
    } catch (e) {
      console.warn("[useSmartScoreAlerts] fetch error:", e);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  const markRead = useCallback(
    async (ids: string[]) => {
      if (!userId || ids.length === 0) return;
      try {
        await supabase.rpc("mark_alerts_read", {
          p_user_id: userId,
          p_alert_ids: ids,
        });
        setAlerts((prev) =>
          prev.map((a) =>
            ids.includes(a.id) ? { ...a, read_at: new Date().toISOString() } : a,
          ),
        );
      } catch (e) {
        console.warn("[useSmartScoreAlerts] markRead error:", e);
      }
    },
    [userId],
  );

  const dismiss = useCallback(
    async (id: string) => {
      if (!userId) return;
      try {
        await supabase.rpc("dismiss_alert", {
          p_user_id: userId,
          p_alert_id: id,
        });
        setAlerts((prev) => prev.filter((a) => a.id !== id));
      } catch (e) {
        console.warn("[useSmartScoreAlerts] dismiss error:", e);
      }
    },
    [userId],
  );

  const unread = alerts.filter((a) => !a.read_at);

  return {
    alerts,
    loading,
    counts: {
      total: unread.length,
      critical: unread.filter((a) => a.severity === "critical").length,
      warning: unread.filter((a) => a.severity === "warning").length,
      info: unread.filter((a) => a.severity === "info").length,
    },
    markRead,
    dismiss,
    refetch: fetchAlerts,
  };
}


// ============================================================================
// useUserWeights.ts
// Hook pour la persistance des poids custom utilisateur
// ============================================================================

type SmartScorePillar = string;

type UseUserWeightsReturn = {
  userWeights: Record<SmartScorePillar, number> | null;
  loading: boolean;
  save: (weights: Record<SmartScorePillar, number>, label: string) => Promise<void>;
  reset: () => void;
};

export function useUserWeights(
  userId: string | null,
  space: "promoteur" | "investisseur" | "banque",
  projectNature: string = "logement",
): UseUserWeightsReturn {
  const [userWeights, setUserWeights] = useState<Record<SmartScorePillar, number> | null>(null);
  const [loading, setLoading] = useState(false);

  // Charger les poids sauvegardés
  useEffect(() => {
    if (!userId) return;
    setLoading(true);

    supabase
      .rpc("get_user_weights", {
        p_user_id: userId,
        p_space: space,
        p_project_nature: projectNature,
      })
      .then(({ data }) => {
        if (data && typeof data === "object") {
          setUserWeights(data as Record<SmartScorePillar, number>);
        }
      })
      .catch((e) => console.warn("[useUserWeights] load error:", e))
      .finally(() => setLoading(false));
  }, [userId, space, projectNature]);

  const save = useCallback(
    async (weights: Record<SmartScorePillar, number>, label: string) => {
      if (!userId) return;
      try {
        await supabase.rpc("save_user_weights", {
          p_user_id: userId,
          p_space: space,
          p_project_nature: projectNature,
          p_label: label,
          p_weights: weights,
          p_is_default: true,
        });
        setUserWeights(weights);
      } catch (e) {
        console.warn("[useUserWeights] save error:", e);
      }
    },
    [userId, space, projectNature],
  );

  const reset = useCallback(() => {
    setUserWeights(null);
  }, []);

  return { userWeights, loading, save, reset };
}


// ============================================================================
// useSmartScoreComparison.ts
// Hook pour la comparaison multi-sites
// ============================================================================

import type { SmartScoreData } from "./useSmartScore";

type SiteForComparison = {
  id: string;
  label: string;
  // Params pour fetch le SmartScore
  parcelId?: string;
  communeInsee?: string;
  lat?: number;
  lon?: number;
};

type ComparisonSite = {
  id: string;
  label: string;
  score: number;
  pillarScores: Record<string, number | null>;
  metrics: SmartScoreData["metrics"];
  loading: boolean;
  error: string | null;
};

type UseComparisonReturn = {
  sites: ComparisonSite[];
  allLoaded: boolean;
  addSite: (site: SiteForComparison) => void;
  removeSite: (id: string) => void;
  clearAll: () => void;
};

export function useSmartScoreComparison(
  projectNature: string = "logement",
): UseComparisonReturn {
  const [sites, setSites] = useState<ComparisonSite[]>([]);

  const addSite = useCallback(
    async (site: SiteForComparison) => {
      // Ajouter en loading
      setSites((prev) => {
        if (prev.find((s) => s.id === site.id)) return prev;
        if (prev.length >= 5) return prev;
        return [
          ...prev,
          {
            id: site.id,
            label: site.label,
            score: 0,
            pillarScores: {},
            metrics: {
              prix_median_m2: null,
              transactions_count: null,
              rendement_brut_pct: null,
              liquidite_score: null,
              tendance_pct_an: null,
              pharmacie_km: null,
              commerce_km: null,
              medecin_km: null,
              hopital_km: null,
              population: null,
              pct_plus_65: null,
            },
            loading: true,
            error: null,
          },
        ];
      });

      // Fetch
      try {
        const payload: Record<string, any> = {
          mode: "market_study",
          project_nature: projectNature,
          radius_km: 2,
          horizon_months: 24,
        };
        if (site.parcelId) payload.parcel_id = site.parcelId;
        if (site.communeInsee) payload.commune_insee = site.communeInsee;
        if (site.lat != null && site.lon != null) {
          payload.lat = site.lat;
          payload.lon = site.lon;
        }

        const { data: result, error } = await supabase.functions.invoke(
          "smartscore-enriched-v3",
          { body: payload },
        );

        if (error || !result?.success) {
          setSites((prev) =>
            prev.map((s) =>
              s.id === site.id
                ? { ...s, loading: false, error: error?.message ?? result?.error ?? "Erreur" }
                : s,
            ),
          );
          return;
        }

        // Parser
        const market = result?.market ?? result?.market_like ?? {};
        const v4 = result?.smartscore_v4 ?? {};
        const mi = market?.market_intelligence ?? {};
        const services = market?.services_ruraux ?? {};
        const insee = market?.insee ?? {};

        setSites((prev) =>
          prev.map((s) =>
            s.id === site.id
              ? {
                  ...s,
                  loading: false,
                  error: null,
                  score: v4?.score ?? result?.smartscore?.score ?? market?.score ?? 50,
                  pillarScores: v4?.pillar_scores ?? {},
                  metrics: {
                    prix_median_m2: market?.prices?.median_eur_m2 ?? null,
                    transactions_count: market?.transactions?.count ?? null,
                    rendement_brut_pct: mi?.rental_tension?.rendement_brut_pct ?? null,
                    liquidite_score: mi?.liquidity?.score ?? null,
                    tendance_pct_an: mi?.price_trend?.slope_pct_per_year ?? null,
                    pharmacie_km: services?.pharmacie_proche?.distance_km ?? null,
                    commerce_km: services?.supermarche_proche?.distance_km ?? null,
                    medecin_km: services?.medecin_proche?.distance_km ?? null,
                    hopital_km: market?.healthSummary?.hopital_proche?.distance_km ?? null,
                    population: insee?.population ?? null,
                    pct_plus_65: insee?.pct_plus_65 ?? null,
                  },
                }
              : s,
          ),
        );
      } catch (e: any) {
        setSites((prev) =>
          prev.map((s) =>
            s.id === site.id ? { ...s, loading: false, error: e.message } : s,
          ),
        );
      }
    },
    [projectNature],
  );

  const removeSite = useCallback((id: string) => {
    setSites((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setSites([]);
  }, []);

  const allLoaded = sites.length > 0 && sites.every((s) => !s.loading);

  return { sites, allLoaded, addSite, removeSite, clearAll };
}