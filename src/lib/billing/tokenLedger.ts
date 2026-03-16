import { supabase } from "@/lib/supabase";
import type {
  TokenLedgerEntry,
  TokenLedgerDirection,
  TokenLedgerReason,
} from "./billing.types";

// ─── Lecture solde ────────────────────────────────────────────────────────────

/**
 * Lit le solde de jetons actuel depuis billing_profiles.
 * Source de vérité : la colonne token_balance (mise à jour par trigger ou RPC).
 */
export async function getTokenBalance(userId: string): Promise<number> {
  const { data, error } = await supabase
    .from("billing_profiles")
    .select("token_balance")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return (data as { token_balance: number } | null)?.token_balance ?? 0;
}

// ─── Écriture ledger ──────────────────────────────────────────────────────────

type WriteLedgerParams = {
  userId: string;
  direction: TokenLedgerDirection;
  amount: number;
  reason: TokenLedgerReason;
  featureCode?: string | null;
  sourceRef?: string | null;
  metadata?: Record<string, unknown>;
  isAdminAction?: boolean;
};

/**
 * Inscrit un mouvement dans le ledger et met à jour le solde atomiquement.
 *
 * Utilise la RPC `apply_token_ledger_entry` côté Supabase pour garantir
 * l'atomicité (lecture + calcul + écriture en une transaction).
 *
 * Retourne l'entrée créée avec le solde après mouvement.
 */
export async function writeLedgerEntry(
  params: WriteLedgerParams
): Promise<TokenLedgerEntry> {
  const {
    userId,
    direction,
    amount,
    reason,
    featureCode = null,
    sourceRef = null,
    metadata = {},
    isAdminAction = false,
  } = params;

  if (amount <= 0) {
    throw new Error(`[tokenLedger] amount invalide : ${amount}`);
  }

  const { data, error } = await supabase.rpc("apply_token_ledger_entry", {
    p_user_id: userId,
    p_direction: direction,
    p_amount: amount,
    p_reason: reason,
    p_feature_code: featureCode,
    p_source_ref: sourceRef,
    p_metadata: metadata,
    p_is_admin_action: isAdminAction,
  });

  if (error) throw error;

  return data as TokenLedgerEntry;
}

// ─── Crédit ───────────────────────────────────────────────────────────────────

/** Crédite des jetons suite à un achat de pack. */
export async function creditTokensForPackPurchase(params: {
  userId: string;
  amount: number;
  packCode: string;
  stripePaymentIntentId: string;
}): Promise<TokenLedgerEntry> {
  return writeLedgerEntry({
    userId: params.userId,
    direction: "credit",
    amount: params.amount,
    reason: "pack_purchase",
    sourceRef: params.stripePaymentIntentId,
    metadata: { pack_code: params.packCode },
  });
}

/** Crédite des jetons offerts à l'activation d'un plan. */
export async function creditTokensForSubscription(params: {
  userId: string;
  amount: number;
  planCode: string;
  stripeSubscriptionId: string;
}): Promise<TokenLedgerEntry> {
  return writeLedgerEntry({
    userId: params.userId,
    direction: "credit",
    amount: params.amount,
    reason: "subscription_grant",
    sourceRef: params.stripeSubscriptionId,
    metadata: { plan_code: params.planCode },
  });
}

/** Ajustement manuel admin (crédit). */
export async function adminCreditTokens(params: {
  userId: string;
  amount: number;
  note?: string;
}): Promise<TokenLedgerEntry> {
  return writeLedgerEntry({
    userId: params.userId,
    direction: "credit",
    amount: params.amount,
    reason: "admin_adjustment",
    metadata: { note: params.note ?? "" },
    isAdminAction: true,
  });
}

// ─── Débit ────────────────────────────────────────────────────────────────────

/**
 * Débite des jetons pour usage d'une feature.
 * Vérifie préalablement que le solde est suffisant.
 */
export async function debitTokensForFeature(params: {
  userId: string;
  amount: number;
  featureCode: string;
  metadata?: Record<string, unknown>;
}): Promise<TokenLedgerEntry> {
  const balance = await getTokenBalance(params.userId);
  if (balance < params.amount) {
    throw new Error(
      `[tokenLedger] solde insuffisant (${balance} < ${params.amount}) pour ${params.featureCode}`
    );
  }

  return writeLedgerEntry({
    userId: params.userId,
    direction: "debit",
    amount: params.amount,
    reason: "feature_usage",
    featureCode: params.featureCode,
    metadata: params.metadata ?? {},
  });
}

// ─── Historique ───────────────────────────────────────────────────────────────

type LedgerHistoryParams = {
  userId: string;
  limit?: number;
  direction?: TokenLedgerDirection;
  reason?: TokenLedgerReason;
  since?: string;
};

export async function getTokenLedgerHistory(
  params: LedgerHistoryParams
): Promise<TokenLedgerEntry[]> {
  let query = supabase
    .from("token_ledger")
    .select("*")
    .eq("user_id", params.userId)
    .order("created_at", { ascending: false });

  if (params.limit) query = query.limit(params.limit);
  if (params.direction) query = query.eq("direction", params.direction);
  if (params.reason) query = query.eq("reason", params.reason);
  if (params.since) query = query.gte("created_at", params.since);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as TokenLedgerEntry[];
}

// ─── Agrégats ─────────────────────────────────────────────────────────────────

export type TokenLedgerSummary = {
  total_purchased: number;
  total_consumed: number;
  balance: number;
};

export async function getTokenLedgerSummary(userId: string): Promise<TokenLedgerSummary> {
  const { data, error } = await supabase
    .from("token_ledger")
    .select("direction, amount")
    .eq("user_id", userId);

  if (error) throw error;

  const rows = (data ?? []) as { direction: TokenLedgerDirection; amount: number }[];

  const totalPurchased = rows
    .filter((r) => r.direction === "credit")
    .reduce((sum, r) => sum + r.amount, 0);

  const totalConsumed = rows
    .filter((r) => r.direction === "debit")
    .reduce((sum, r) => sum + r.amount, 0);

  return {
    total_purchased: totalPurchased,
    total_consumed: totalConsumed,
    balance: totalPurchased - totalConsumed,
  };
}