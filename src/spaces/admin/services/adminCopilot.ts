// src/spaces/admin/services/adminCopilot.ts
// ─────────────────────────────────────────────────────────────────────────────
// Service admin pour la gestion des crédits Copilot.
// Lit directement les tables copilot_* via le client Supabase (RLS admin).
//
// RPCs Supabase à créer (SQL fourni en bas de ce fichier) :
//   • admin_copilot_stats()
//   • admin_copilot_users()
//   • admin_adjust_copilot_credits(p_user_id, p_delta, p_reason)
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from "../../../lib/supabase";

// ─── Types ───────────────────────────────────────────────────────────────────

export type AdminCopilotStats = {
  totalCreditsAvailable: number;   // Somme des soldes de tous les comptes
  creditsConsumed30d: number;      // Crédits consommés sur les 30 derniers jours
  activeUsers7d: number;           // Users ayant utilisé le Copilot sur 7 jours
  quickCalls30d: number;
  advancedCalls30d: number;
  reportCalls30d: number;
  tokensIn30d: number;
  tokensOut30d: number;
  estimatedCostEur30d: number;     // Coût Anthropic estimé (input + output tokens)
};

export type AdminCopilotUserRow = {
  userId: string;
  email: string;
  balance: number;                  // Solde actuel
  consumed7d: number;               // Crédits consommés sur 7 jours
  consumed30d: number;              // Crédits consommés sur 30 jours
  quickCalls30d: number;
  advancedCalls30d: number;
  lastActivityAt: string | null;    // Dernière conversation
  conversationsCount: number;
};

export type AdminCopilotDailyRow = {
  date: string;
  quickCalls: number;
  advancedCalls: number;
  reportCalls: number;
  totalCredits: number;
  totalTokensIn: number;
  totalTokensOut: number;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function asNumber(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

// Coût estimé Anthropic claude-sonnet-4 (tarif approximatif en €)
// ~3$/M tokens input, ~15$/M tokens output → en EUR ~0.9x
const COST_PER_M_IN_EUR  = 2.7;   // €/M tokens input
const COST_PER_M_OUT_EUR = 13.5;  // €/M tokens output

function estimateCostEur(tokensIn: number, tokensOut: number): number {
  return (tokensIn / 1_000_000) * COST_PER_M_IN_EUR
       + (tokensOut / 1_000_000) * COST_PER_M_OUT_EUR;
}

// ─── API ─────────────────────────────────────────────────────────────────────

/**
 * Stats globales Copilot.
 * Appelle la RPC admin_copilot_stats().
 */
export async function getAdminCopilotStats(): Promise<AdminCopilotStats> {
  const { data, error } = await supabase.rpc("admin_copilot_stats");
  if (error) throw new Error(`admin_copilot_stats: ${error.message}`);
  const row = (data ?? {}) as Record<string, unknown>;
  const tokensIn  = asNumber(row.tokens_in_30d);
  const tokensOut = asNumber(row.tokens_out_30d);
  return {
    totalCreditsAvailable:  asNumber(row.total_credits_available),
    creditsConsumed30d:     asNumber(row.credits_consumed_30d),
    activeUsers7d:          asNumber(row.active_users_7d),
    quickCalls30d:          asNumber(row.quick_calls_30d),
    advancedCalls30d:       asNumber(row.advanced_calls_30d),
    reportCalls30d:         asNumber(row.report_calls_30d),
    tokensIn30d:            tokensIn,
    tokensOut30d:           tokensOut,
    estimatedCostEur30d:    estimateCostEur(tokensIn, tokensOut),
  };
}

/**
 * Liste des utilisateurs avec leur solde et conso Copilot.
 * Appelle la RPC admin_copilot_users().
 */
export async function getAdminCopilotUsers(): Promise<AdminCopilotUserRow[]> {
  const { data, error } = await supabase.rpc("admin_copilot_users");
  if (error) throw new Error(`admin_copilot_users: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    userId:             asString(row.user_id),
    email:              asString(row.email, "—"),
    balance:            asNumber(row.balance),
    consumed7d:         asNumber(row.consumed_7d),
    consumed30d:        asNumber(row.consumed_30d),
    quickCalls30d:      asNumber(row.quick_calls_30d),
    advancedCalls30d:   asNumber(row.advanced_calls_30d),
    lastActivityAt:     typeof row.last_activity_at === "string" ? row.last_activity_at : null,
    conversationsCount: asNumber(row.conversations_count),
  }));
}

/**
 * Conso agrégée par jour sur N jours (pour le graphique).
 */
export async function getAdminCopilotDailyUsage(days = 30): Promise<AdminCopilotDailyRow[]> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("copilot_usage_daily")
    .select("date, quick_calls, advanced_calls, report_calls, total_credits, total_tokens_in, total_tokens_out")
    .gte("date", sinceStr)
    .order("date", { ascending: true });

  if (error) throw new Error(`copilot_usage_daily: ${error.message}`);

  // Agrégation par date (toutes les lignes sont déjà par user+date → on somme)
  const byDate = new Map<string, AdminCopilotDailyRow>();
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const d = asString(row.date);
    const existing = byDate.get(d) ?? {
      date: d, quickCalls: 0, advancedCalls: 0, reportCalls: 0,
      totalCredits: 0, totalTokensIn: 0, totalTokensOut: 0,
    };
    existing.quickCalls    += asNumber(row.quick_calls);
    existing.advancedCalls += asNumber(row.advanced_calls);
    existing.reportCalls   += asNumber(row.report_calls);
    existing.totalCredits  += asNumber(row.total_credits);
    existing.totalTokensIn += asNumber(row.total_tokens_in);
    existing.totalTokensOut+= asNumber(row.total_tokens_out);
    byDate.set(d, existing);
  }

  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Ajuste les crédits Copilot d'un utilisateur (+ pour ajouter, - pour retirer).
 * Appelle la RPC admin_adjust_copilot_credits(p_user_id, p_delta, p_reason).
 * Retourne le nouveau solde.
 */
export async function adminAdjustCopilotCredits(
  userId: string,
  delta: number,
  reason: string,
): Promise<number> {
  if (delta === 0) throw new Error("Le delta ne peut pas être 0");
  const { data, error } = await supabase.rpc("admin_adjust_copilot_credits", {
    p_user_id: userId,
    p_delta:   delta,
    p_reason:  reason,
  });
  if (error) throw new Error(`admin_adjust_copilot_credits: ${error.message}`);
  return asNumber(typeof data === "object" && data !== null
    ? (data as Record<string, unknown>).new_balance ?? data
    : data);
}

// =============================================================================
// SQL RPCs À CRÉER DANS SUPABASE (Dashboard › SQL Editor)
// =============================================================================
//
// ── 1. admin_copilot_stats ───────────────────────────────────────────────────
/*
CREATE OR REPLACE FUNCTION public.admin_copilot_stats()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result json;
BEGIN
  SELECT json_build_object(
    'total_credits_available', COALESCE((SELECT SUM(balance) FROM copilot_credits), 0),
    'credits_consumed_30d',    COALESCE((
      SELECT SUM(total_credits) FROM copilot_usage_daily
      WHERE date >= CURRENT_DATE - INTERVAL '30 days'
    ), 0),
    'active_users_7d',         COALESCE((
      SELECT COUNT(DISTINCT user_id) FROM copilot_usage_daily
      WHERE date >= CURRENT_DATE - INTERVAL '7 days'
    ), 0),
    'quick_calls_30d',         COALESCE((
      SELECT SUM(quick_calls) FROM copilot_usage_daily
      WHERE date >= CURRENT_DATE - INTERVAL '30 days'
    ), 0),
    'advanced_calls_30d',      COALESCE((
      SELECT SUM(advanced_calls) FROM copilot_usage_daily
      WHERE date >= CURRENT_DATE - INTERVAL '30 days'
    ), 0),
    'report_calls_30d',        COALESCE((
      SELECT SUM(report_calls) FROM copilot_usage_daily
      WHERE date >= CURRENT_DATE - INTERVAL '30 days'
    ), 0),
    'tokens_in_30d',           COALESCE((
      SELECT SUM(total_tokens_in) FROM copilot_usage_daily
      WHERE date >= CURRENT_DATE - INTERVAL '30 days'
    ), 0),
    'tokens_out_30d',          COALESCE((
      SELECT SUM(total_tokens_out) FROM copilot_usage_daily
      WHERE date >= CURRENT_DATE - INTERVAL '30 days'
    ), 0)
  ) INTO result;
  RETURN result;
END;
$$;
*/

// ── 2. admin_copilot_users ───────────────────────────────────────────────────
/*
CREATE OR REPLACE FUNCTION public.admin_copilot_users()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result json;
BEGIN
  SELECT json_agg(row_to_json(t)) INTO result
  FROM (
    SELECT
      cc.user_id,
      au.email,
      cc.balance,
      COALESCE(u7.total_credits,  0) AS consumed_7d,
      COALESCE(u30.total_credits, 0) AS consumed_30d,
      COALESCE(u30.quick_calls,   0) AS quick_calls_30d,
      COALESCE(u30.advanced_calls,0) AS advanced_calls_30d,
      conv.last_activity_at,
      COALESCE(conv.conversations_count, 0) AS conversations_count
    FROM copilot_credits cc
    JOIN auth.users au ON au.id = cc.user_id
    LEFT JOIN LATERAL (
      SELECT SUM(total_credits) AS total_credits
      FROM copilot_usage_daily
      WHERE user_id = cc.user_id AND date >= CURRENT_DATE - INTERVAL '7 days'
    ) u7 ON true
    LEFT JOIN LATERAL (
      SELECT
        SUM(total_credits)   AS total_credits,
        SUM(quick_calls)     AS quick_calls,
        SUM(advanced_calls)  AS advanced_calls
      FROM copilot_usage_daily
      WHERE user_id = cc.user_id AND date >= CURRENT_DATE - INTERVAL '30 days'
    ) u30 ON true
    LEFT JOIN LATERAL (
      SELECT
        MAX(updated_at) AS last_activity_at,
        COUNT(*)        AS conversations_count
      FROM copilot_conversations
      WHERE user_id = cc.user_id
    ) conv ON true
    ORDER BY cc.balance DESC
  ) t;
  RETURN COALESCE(result, '[]'::json);
END;
$$;
*/

// ── 3. admin_adjust_copilot_credits ──────────────────────────────────────────
/*
CREATE OR REPLACE FUNCTION public.admin_adjust_copilot_credits(
  p_user_id uuid,
  p_delta   integer,
  p_reason  text DEFAULT 'admin_adjustment'
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_balance integer;
BEGIN
  UPDATE copilot_credits
  SET balance    = GREATEST(0, balance + p_delta),
      updated_at = now()
  WHERE user_id = p_user_id
  RETURNING balance INTO v_new_balance;

  IF NOT FOUND THEN
    -- Crée le compte si inexistant
    INSERT INTO copilot_credits (user_id, balance, updated_at)
    VALUES (p_user_id, GREATEST(0, p_delta), now())
    RETURNING balance INTO v_new_balance;
  END IF;

  -- Log dans une table d'audit si elle existe
  -- INSERT INTO copilot_credit_logs (user_id, delta, reason, new_balance)
  -- VALUES (p_user_id, p_delta, p_reason, v_new_balance);

  RETURN json_build_object('new_balance', v_new_balance);
END;
$$;
*/