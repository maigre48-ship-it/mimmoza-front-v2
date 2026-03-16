// src/spaces/marchand/services/dealUnlock.ts

import { supabase } from "../../../lib/supabase";
import {
  LS_MARCHAND_SNAPSHOT_V1,
  type MarchandDeal,
  type MarchandSnapshotV1,
} from "../shared/marchandSnapshot.store";

type UnlockDealResult =
  | {
      ok: true;
      alreadyUnlocked: boolean;
      consumedToken: boolean;
      ledgerId: string | null;
      deal: MarchandDeal;
    }
  | {
      ok: false;
      reason: "NOT_AUTHENTICATED" | "DEAL_NOT_FOUND" | "NO_TOKENS" | "ERROR";
      message: string;
    };

function createId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function readSnapshot(): MarchandSnapshotV1 {
  const raw = localStorage.getItem(LS_MARCHAND_SNAPSHOT_V1);
  if (!raw) throw new Error("Snapshot Marchand introuvable.");
  return JSON.parse(raw) as MarchandSnapshotV1;
}

function writeSnapshot(snapshot: MarchandSnapshotV1): void {
  localStorage.setItem(LS_MARCHAND_SNAPSHOT_V1, JSON.stringify(snapshot));
  window.dispatchEvent(new CustomEvent("mimmoza:marchand:snapshot"));
}

function getDealLabel(deal: MarchandDeal): string {
  return (
    deal.title?.trim() ||
    deal.address?.trim() ||
    [deal.zipCode, deal.city].filter(Boolean).join(" ").trim() ||
    deal.id
  );
}

function ensureDealsArray(snapshot: MarchandSnapshotV1): MarchandDeal[] {
  const deals = (snapshot as { deals?: MarchandDeal[] }).deals;
  if (!Array.isArray(deals)) {
    throw new Error("Le snapshot Marchand ne contient pas de liste de deals.");
  }
  return deals;
}

export async function unlockDealIfNeeded(dealId: string): Promise<UnlockDealResult> {
  // 1. Lire le snapshot local
  const snapshot = readSnapshot();
  const deals = ensureDealsArray(snapshot);
  const deal = deals.find((item) => item.id === dealId);

  if (!deal) {
    return { ok: false, reason: "DEAL_NOT_FOUND", message: "Projet introuvable." };
  }

  // 2. Déjà déverrouillé → rien à faire
  if (deal.premiumUnlocked) {
    return {
      ok: true,
      alreadyUnlocked: true,
      consumedToken: false,
      ledgerId: deal.premiumUnlockLedgerId ?? null,
      deal,
    };
  }

  // 3. Récupérer l'utilisateur connecté
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      ok: false,
      reason: "NOT_AUTHENTICATED",
      message: "Utilisateur non connecte.",
    };
  }

  // 4. Lire le solde dans credit_accounts
  const { data: account, error: accountError } = await supabase
    .from("credit_accounts")
    .select("id, current_credits")
    .eq("user_id", user.id)
    .maybeSingle();

  if (accountError) {
    return {
      ok: false,
      reason: "ERROR",
      message: accountError.message,
    };
  }

  const currentCredits = account?.current_credits ?? 0;

  if (currentCredits <= 0) {
    return {
      ok: false,
      reason: "NO_TOKENS",
      message: "Vous n'avez plus de jetons disponibles.",
    };
  }

  // 5. Déduire 1 jeton dans credit_accounts
  const { error: updateError } = await supabase
    .from("credit_accounts")
    .update({ current_credits: currentCredits - 1 })
    .eq("id", account!.id);

  if (updateError) {
    return { ok: false, reason: "ERROR", message: updateError.message };
  }

  // 6. Enregistrer la transaction dans credit_transactions
  const ledgerId = createId("tok_deal_unlock");
  const nowIso = new Date().toISOString();
  const dealLabel = getDealLabel(deal);

  const { error: txError } = await supabase
    .from("credit_transactions")
    .insert({
      user_id:     user.id,
      amount:      -1,
      type:        "deal_unlock",
      description: `Deverrouillage deal investisseur : ${dealLabel}`,
      created_at:  nowIso,
    });

  if (txError) {
    // Rollback : restituer le jeton
    await supabase
      .from("credit_accounts")
      .update({ current_credits: currentCredits })
      .eq("id", account!.id);

    return { ok: false, reason: "ERROR", message: txError.message };
  }

  // 7. Mettre à jour le snapshot local
  deal.premiumUnlocked = true;
  deal.premiumUnlockedAt = nowIso;
  deal.premiumUnlockLedgerId = ledgerId;
  writeSnapshot(snapshot);

  return {
    ok: true,
    alreadyUnlocked: false,
    consumedToken: true,
    ledgerId,
    deal,
  };
}

export function isDealPremiumUnlocked(dealId: string): boolean {
  try {
    const snapshot = readSnapshot();
    const deals = ensureDealsArray(snapshot);
    const deal = deals.find((item) => item.id === dealId);
    return Boolean(deal?.premiumUnlocked);
  } catch {
    return false;
  }
}