// src/lib/billing/projectUnlock.ts
// Service generique de deverrouillage de projet (tous espaces).
// S'appuie sur la RPC Supabase atomique `unlock_project` (decompte 1 jeton + log).

import { supabase } from "../supabase";

export type ProjectSpace =
  | "promoteur"
  | "rehabilitation"
  | "apporteur"
  | "marchand";

export type UnlockProjectResult =
  | {
      ok: true;
      alreadyUnlocked: boolean;
      newBalance: number;
      ledgerId: string | null;
    }
  | {
      ok: false;
      reason: "NOT_AUTHENTICATED" | "NO_TOKENS" | "ERROR";
      message: string;
    };

type UnlockRpcRow = {
  already_unlocked: boolean;
  new_balance: number;
  ledger_id: string | null;
};

/**
 * Deverrouille un projet pour l'utilisateur courant (1 jeton).
 * Idempotent : si deja deverrouille (et dans la fenetre de validite), ne redebite pas.
 */
export async function unlockProject(
  space: ProjectSpace,
  projectId: string,
  label?: string,
  validityDays?: number
): Promise<UnlockProjectResult> {
  const { data, error } = await supabase.rpc("unlock_project", {
    p_space: space,
    p_project_id: projectId,
    p_label: label ?? null,
    p_validity_days: typeof validityDays === "number" ? validityDays : 30,
  });

  if (error) {
    const msg = (error.message || "").toUpperCase();
    if (msg.includes("NOT_AUTHENTICATED")) {
      return { ok: false, reason: "NOT_AUTHENTICATED", message: "Utilisateur non connecte." };
    }
    if (msg.includes("NO_TOKENS")) {
      return { ok: false, reason: "NO_TOKENS", message: "Solde de jetons insuffisant." };
    }
    return { ok: false, reason: "ERROR", message: error.message };
  }

  const row: UnlockRpcRow | undefined = Array.isArray(data)
    ? (data[0] as UnlockRpcRow | undefined)
    : (data as UnlockRpcRow | undefined);

  if (!row) {
    return { ok: false, reason: "ERROR", message: "Reponse RPC vide." };
  }

  return {
    ok: true,
    alreadyUnlocked: Boolean(row.already_unlocked),
    newBalance: typeof row.new_balance === "number" ? row.new_balance : 0,
    ledgerId: row.ledger_id ?? null,
  };
}

/**
 * Indique si un projet est deja deverrouille ET valide (fenetre de validite).
 * Retourne false en cas d'erreur (fail-closed cote acces premium).
 */
export async function isProjectUnlocked(
  space: ProjectSpace,
  projectId: string,
  validityDays?: number
): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const days = typeof validityDays === "number" ? validityDays : 30;
  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("project_unlocks")
    .select("id, unlocked_at")
    .eq("user_id", user.id)
    .eq("space", space)
    .eq("project_id", projectId)
    .gte("unlocked_at", sinceIso)
    .order("unlocked_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return false;
  return Boolean(data);
}

/**
 * Lit le solde de jetons de l'utilisateur courant (credit_accounts).
 */
export async function getCreditsBalance(): Promise<number> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 0;

  const { data, error } = await supabase
    .from("credit_accounts")
    .select("current_credits")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !data) return 0;
  const credits = (data as { current_credits: number }).current_credits;
  return typeof credits === "number" ? credits : 0;
}
export type SpendResult =
  | { ok: true; newBalance: number }
  | { ok: false; reason: "NOT_AUTHENTICATED" | "NO_TOKENS" | "ERROR"; message: string };

/** Debite des jetons sur credit_accounts (compteur unifie) + log credit_transactions. */
export async function spendCredits(
  amount: number,
  description?: string,
  type = "analysis"
): Promise<SpendResult> {
  const { data, error } = await supabase.rpc("spend_credits", {
    p_amount: amount,
    p_description: description ?? null,
    p_type: type,
  });

  if (error) {
    const msg = (error.message || "").toUpperCase();
    if (msg.includes("NO_TOKENS")) return { ok: false, reason: "NO_TOKENS", message: "Solde de jetons insuffisant." };
    if (msg.includes("NOT_AUTHENTICATED")) return { ok: false, reason: "NOT_AUTHENTICATED", message: "Utilisateur non connecte." };
    return { ok: false, reason: "ERROR", message: error.message };
  }

  return { ok: true, newBalance: typeof data === "number" ? data : 0 };
}