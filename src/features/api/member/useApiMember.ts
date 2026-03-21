// src/features/api/member/useApiMember.ts
//
// Hook unique qui charge depuis Supabase :
//   - les clés API de l'utilisateur connecté (table api_keys)
//   - l'usage mensuel (table api_usage_logs ou vue api_monthly_usage)
//   - l'abonnement actif (table api_subscriptions)
//   - le statut de santé de la plateforme (table api_health_status ou constante)
//
// Retourne { data: ApiMemberData | null, loading: boolean, error: string | null }

import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import type { BillingMode, PlanTier } from './apiPlans';

// ── Types exportés ────────────────────────────────────────────────────────────

export interface ApiKeyRecord {
  id: string;
  name: string;
  prefix: string;
  /** Champ legacy – alias de environment */
  env: 'test' | 'live';
  environment: 'test' | 'live';
  status: 'active' | 'revoked';
  requests_count: number;
  requests_limit: number;
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

export interface ApiLogRecord {
  id: string;
  /** ISO datetime string, ex: "2026-03-20 14:10:22" */
  time: string;
  method: string;
  path: string;
  status: number;
  /** ex: "148ms" */
  latency: string;
}

export interface ApiUsageData {
  /** Requêtes consommées ce mois */
  usedRequests: number;
  /** Quota mensuel total */
  totalRequests: number;
  /** Logs récents (optionnel – peut être vide si table non exposée) */
  logs: ApiLogRecord[];
}

export interface ApiSubscriptionData {
  plan: PlanTier;
  billingMode: BillingMode;
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete';
  currentPeriodEnd: string | null;
}

export interface ApiMemberData {
  keys: ApiKeyRecord[];
  usage: ApiUsageData;
  subscription: ApiSubscriptionData;
  healthStatus: 'operational' | 'degraded' | 'incident';
}

// ── Hook ─────────────────────────────────────────────────────────────────────

interface UseApiMemberReturn {
  data: ApiMemberData | null;
  loading: boolean;
  error: string | null;
  /** Recharge manuellement les données */
  refetch: () => Promise<void>;
}

export function useApiMember(): UseApiMemberReturn {
  const [data, setData] = useState<ApiMemberData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = async () => {
    setLoading(true);
    setError(null);

    try {
      // Récupère l'utilisateur connecté
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) throw new Error(userError.message);
      if (!user) throw new Error('Utilisateur non authentifié.');

      const userId = user.id;

      // ── 1. Clés API ────────────────────────────────────────────────────────
      // On utilise select('*') pour ne pas planter sur des colonnes absentes.
      // Toutes les normalisations se font côté JS via fallbacks.
      const { data: rawKeys, error: keysError } = await supabase
        .from('api_keys')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (keysError) throw new Error(`Clés API : ${keysError.message}`);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const keys: ApiKeyRecord[] = (rawKeys ?? []).map((k: any) => {
        const revokedAt: string | null = k.revoked_at ?? null;
        const envRaw: string = k.env ?? k.environment ?? 'test';
        return {
          id: k.id,
          name: k.name ?? '',
          prefix: k.prefix ?? '',
          env: envRaw as 'test' | 'live',
          environment: envRaw as 'test' | 'live',
          // status peut ne pas exister en DB → dérivé de revoked_at
          status: (k.status ?? (revokedAt ? 'revoked' : 'active')) as 'active' | 'revoked',
          requests_count: k.requests_count ?? 0,
          requests_limit: k.requests_limit ?? 10_000,
          last_used_at: k.last_used_at ?? null,
          created_at: k.created_at ?? new Date().toISOString(),
          revoked_at: revokedAt,
        };
      });

      // ── 2. Usage mensuel ───────────────────────────────────────────────────
      // Essaie d'abord la vue api_monthly_usage, puis fallback sur un agrégat
      let usedRequests = 0;
      let totalRequests = 10_000;
      let logs: ApiLogRecord[] = [];

      const { data: monthlyUsage, error: monthlyError } = await supabase
        .from('api_monthly_usage')
        .select('used_requests, total_requests')
        .eq('user_id', userId)
        .maybeSingle();

      if (!monthlyError && monthlyUsage) {
        usedRequests = monthlyUsage.used_requests ?? 0;
        totalRequests = monthlyUsage.total_requests ?? 10_000;
      } else {
        // Fallback : agrégat depuis la table api_usage_logs
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

        const { count } = await supabase
          .from('api_usage_logs')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .gte('created_at', startOfMonth);

        usedRequests = count ?? 0;
      }

      // Logs récents (10 derniers)
      const { data: rawLogs } = await supabase
        .from('api_usage_logs')
        .select('id, created_at, method, path, status_code, latency_ms')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(10);

      if (rawLogs) {
        logs = rawLogs.map((l) => ({
          id: l.id,
          time: new Date(l.created_at).toLocaleString('fr-FR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          }),
          method: l.method ?? 'POST',
          path: l.path ?? '/v1/scoring/smart',
          status: l.status_code ?? 200,
          latency: l.latency_ms != null ? `${l.latency_ms}ms` : '—',
        }));
      }

      const usage: ApiUsageData = { usedRequests, totalRequests, logs };

      // ── 3. Abonnement ──────────────────────────────────────────────────────
      const { data: rawSub, error: subError } = await supabase
        .from('api_subscriptions')
        .select('plan_code, billing_mode, status, current_period_end')
        .eq('user_id', userId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .maybeSingle();

      // Si pas d'abonnement actif, on fournit un plan "free" par défaut
      const subscription: ApiSubscriptionData = subError || !rawSub
        ? { plan: 'free' as PlanTier, billingMode: 'monthly', status: 'active', currentPeriodEnd: null }
        : {
            plan: (rawSub.plan_code ?? 'free') as PlanTier,
            billingMode: (rawSub.billing_mode ?? 'monthly') as BillingMode,
            status: rawSub.status ?? 'active',
            currentPeriodEnd: rawSub.current_period_end ?? null,
          };

      // ── 4. Health status ───────────────────────────────────────────────────
      // Essaie une table api_health_status, sinon retourne "operational" par défaut
      let healthStatus: ApiMemberData['healthStatus'] = 'operational';

      const { data: health } = await supabase
        .from('api_health_status')
        .select('status')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (health?.status === 'degraded' || health?.status === 'incident') {
        healthStatus = health.status;
      }

      // ── Assemblage ─────────────────────────────────────────────────────────
      setData({ keys, usage, subscription, healthStatus });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur inconnue';
      setError(msg);
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { data, loading, error, refetch: fetchAll };
}