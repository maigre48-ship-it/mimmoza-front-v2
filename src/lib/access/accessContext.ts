import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getCurrentAdminStatus } from "@/lib/admin";
import type { AccessContext, AccessQuotas, PlanId } from "./access.types";
import { PLAN_CONFIGS } from "./planConfig";

// ─── Constante admin ──────────────────────────────────────────────────────────

/** Quota fictif affiché dans l'UI pour un admin (jamais décrément). */
export const ADMIN_DISPLAY_QUOTA = 9999;

/** Contexte admin — bypass total de toutes les règles. */
const ADMIN_ACCESS_CONTEXT: AccessContext = {
  userId: null,   // sera surchargé par le resolver
  email: null,
  isAdmin: true,
  hasFullAccess: true,
  bypassSubscription: true,
  bypassTokens: true,
  bypassLimits: true,
  plan: null,
  subscriptionActive: true,
  tokensRemaining: ADMIN_DISPLAY_QUOTA,
  quotas: {
    dailyRefreshRemaining: ADMIN_DISPLAY_QUOTA,
    dealUnlockRemaining: ADMIN_DISPLAY_QUOTA,
    analysisRemaining: ADMIN_DISPLAY_QUOTA,
    reportExportRemaining: ADMIN_DISPLAY_QUOTA,
  },
};

/** Contexte minimal pour un utilisateur non authentifié. */
export const ANONYMOUS_ACCESS_CONTEXT: AccessContext = {
  userId: null,
  email: null,
  isAdmin: false,
  hasFullAccess: false,
  bypassSubscription: false,
  bypassTokens: false,
  bypassLimits: false,
  plan: null,
  subscriptionActive: false,
  tokensRemaining: 0,
  quotas: {
    dailyRefreshRemaining: 0,
    dealUnlockRemaining: 0,
    analysisRemaining: 0,
    reportExportRemaining: 0,
  },
};

// ─── Types internes ───────────────────────────────────────────────────────────

type SubscriptionRow = {
  plan_id: string;
  status: string;
  expires_at: string | null;
};

type TokenRow = {
  balance: number;
};

// ─── Resolver principal ───────────────────────────────────────────────────────

/**
 * Construit le contexte d'accès complet pour l'utilisateur courant.
 *
 * Ordre de résolution :
 * 1. Vérifier le statut admin via getCurrentAdminStatus()
 *    → Si admin : retourne ADMIN_ACCESS_CONTEXT immédiatement (sans quota DB)
 * 2. Charger le plan d'abonnement depuis `user_subscriptions`
 * 3. Charger le solde de jetons depuis `user_tokens`
 * 4. Calculer les quotas journaliers restants depuis `market_zone_refresh_log`
 *    et les tables d'usage spécifiques
 * 5. Assembler et retourner l'AccessContext complet
 *
 * Cette fonction est safe : elle ne throw jamais et retourne ANONYMOUS_ACCESS_CONTEXT
 * en cas d'erreur non fatale.
 */
export async function buildUserAccessContext(userId?: string | null): Promise<AccessContext> {
  // ── [1] Résolution admin ─────────────────────────────────────────────────
  let adminStatus;
  try {
    adminStatus = await getCurrentAdminStatus();
  } catch {
    adminStatus = null;
  }

  const resolvedUserId = userId ?? adminStatus?.userId ?? null;
  const resolvedEmail = adminStatus?.email ?? null;

  const isAdmin =
    Boolean(adminStatus?.isAdmin) &&
    Boolean(adminStatus?.hasFullAccess) &&
    Boolean(adminStatus?.bypassLimits);

  if (isAdmin) {
    console.log("[accessContext] admin bypass résolu", {
      userId: resolvedUserId,
      email: resolvedEmail,
    });
    return {
      ...ADMIN_ACCESS_CONTEXT,
      userId: resolvedUserId,
      email: resolvedEmail,
    };
  }

  if (!resolvedUserId) {
    return { ...ANONYMOUS_ACCESS_CONTEXT };
  }

  // ── [2] Abonnement ───────────────────────────────────────────────────────
  let plan: PlanId | null = null;
  let subscriptionActive = false;

  try {
    const { data: sub } = await supabase
      .from("user_subscriptions")
      .select("plan_id, status, expires_at")
      .eq("user_id", resolvedUserId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (sub) {
      const row = sub as SubscriptionRow;
      const isPlanValid = row.plan_id in PLAN_CONFIGS;
      const isActive =
        row.status === "active" &&
        (row.expires_at == null || new Date(row.expires_at) > new Date());

      if (isPlanValid && isActive) {
        plan = row.plan_id as PlanId;
        subscriptionActive = true;
      }
    }
  } catch {
    // Table inexistante ou erreur réseau — fallback plan free silencieux
  }

  // ── [3] Jetons ───────────────────────────────────────────────────────────
  let tokensRemaining = 0;

  try {
    const { data: tokens } = await supabase
      .from("user_tokens")
      .select("balance")
      .eq("user_id", resolvedUserId)
      .maybeSingle();

    if (tokens) {
      tokensRemaining = Math.max(0, (tokens as TokenRow).balance ?? 0);
    }
  } catch {
    // Table inexistante — on reste à 0
  }

  // ── [4] Quotas journaliers ────────────────────────────────────────────────
  const quotas = await resolveQuotas(resolvedUserId, plan);

  return {
    userId: resolvedUserId,
    email: resolvedEmail,
    isAdmin: false,
    hasFullAccess: false,
    bypassSubscription: false,
    bypassTokens: false,
    bypassLimits: false,
    plan,
    subscriptionActive,
    tokensRemaining,
    quotas,
  };
}

// ─── Résolution des quotas journaliers ────────────────────────────────────────

async function resolveQuotas(
  userId: string,
  plan: PlanId | null
): Promise<AccessQuotas> {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 3_600_000).toISOString();

  const planConfig = plan ? PLAN_CONFIGS[plan] : null;

  // Refresh veille (depuis market_zone_refresh_log)
  const dailyRefreshRemaining = await resolveRefreshQuota(userId, oneDayAgo, planConfig);

  // Deal unlock (depuis deal_unlock_log si disponible)
  const dealUnlockRemaining = await resolveSimpleQuota(
    userId,
    "deal_unlock_log",
    oneDayAgo,
    planConfig?.dealUnlockQuota ?? 0
  );

  // Analyse IA (depuis analysis_log si disponible)
  const analysisRemaining = await resolveSimpleQuota(
    userId,
    "analysis_log",
    oneDayAgo,
    planConfig?.analysisQuota ?? 2
  );

  // Export rapport (depuis report_export_log si disponible)
  const reportExportRemaining = await resolveSimpleQuota(
    userId,
    "report_export_log",
    oneDayAgo,
    planConfig?.reportExportQuota ?? 0
  );

  return {
    dailyRefreshRemaining,
    dealUnlockRemaining,
    analysisRemaining,
    reportExportRemaining,
  };
}

async function resolveRefreshQuota(
  userId: string,
  since: string,
  planConfig: (typeof PLAN_CONFIGS)[PlanId] | null
): Promise<number | null> {
  const maxQuota = planConfig?.dailyRefreshQuota ?? 1; // free = 1 par défaut
  if (maxQuota === null) return null; // illimité sur ce plan

  try {
    const { count } = await supabase
      .from("market_zone_refresh_log")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("ingest_skipped", false)
      .gte("created_at", since);

    const used = count ?? 0;
    return Math.max(0, maxQuota - used);
  } catch {
    return maxQuota; // fallback conservateur
  }
}

async function resolveSimpleQuota(
  userId: string,
  tableName: string,
  since: string,
  maxQuota: number | null
): Promise<number | null> {
  if (maxQuota === null) return null; // illimité

  try {
    const { count } = await supabase
      .from(tableName)
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", since);

    const used = count ?? 0;
    return Math.max(0, maxQuota - used);
  } catch {
    // Table inexistante ou erreur — retourne quota max (permissif)
    return maxQuota;
  }
}

// ─── Hook React ───────────────────────────────────────────────────────────────

type UseAccessContextReturn = {
  ctx: AccessContext | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

/**
 * Hook React qui expose l'AccessContext résolu pour l'utilisateur courant.
 *
 * Usage :
 * ```tsx
 * const { ctx, loading } = useAccessContext();
 * if (!loading && ctx && canAccessFeature(ctx, "veille.refresh")) {
 *   // ...
 * }
 * ```
 *
 * Le contexte est résolu une seule fois au montage du composant.
 * Appeler `refresh()` pour forcer une résolution fraîche (ex: après achat
 * de jetons, changement de plan).
 */
export function useAccessContext(userId?: string | null): UseAccessContextReturn {
  const [ctx, setCtx] = useState<AccessContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const userIdRef = useRef<string | null | undefined>(userId);

  const resolve = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resolved = await buildUserAccessContext(userIdRef.current);
      setCtx(resolved);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setCtx({ ...ANONYMOUS_ACCESS_CONTEXT });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    userIdRef.current = userId;
    void resolve();
  }, [userId, resolve]);

  return { ctx, loading, error, refresh: resolve };
}