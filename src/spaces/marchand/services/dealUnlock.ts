// src/spaces/marchand/services/dealUnlock.ts

import { userStorage } from "@/lib/storage/userScopedStorage";
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
  const raw = userStorage.getItem(LS_MARCHAND_SNAPSHOT_V1);
  if (!raw) throw new Error("Snapshot Marchand introuvable.");
  return JSON.parse(raw) as MarchandSnapshotV1;
}

function writeSnapshot(snapshot: MarchandSnapshotV1): void {
  userStorage.setItem(LS_MARCHAND_SNAPSHOT_V1, JSON.stringify(snapshot));
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

  // 4. Débiter le jeton — par la RPC, jamais en écriture directe.
  //
  // Ce qui se passait avant : le solde était lu, puis `credit_accounts` était
  // mis à jour DEPUIS LE NAVIGATEUR, puis la ligne de transaction était insérée.
  // Or `credit_accounts` n'a AUCUNE policy RLS d'UPDATE pour le propriétaire —
  // seulement pour les admins. L'update était donc rejeté sans lever d'erreur
  // (supabase-js ne signale pas « 0 ligne modifiée »), tandis que l'insert dans
  // `credit_transactions`, lui, passait grâce à `credit_transactions_insert_own`.
  //
  // Résultat constaté en production : le grand livre affichait un débit qui
  // n'avait jamais eu lieu, et l'utilisateur obtenait le déblocage gratuitement.
  // Trois comptes présentaient un écart solde/journal exactement égal à leurs
  // `deal_unlock`. Seul le compte admin fonctionnait, sa policy l'autorisant.
  //
  // `spend_credits` est SECURITY DEFINER : elle verrouille la ligne (`for
  // update`), vérifie le solde, débite et journalise dans la MÊME transaction.
  // Plus de lecture-puis-écriture, plus de course, plus de rollback manuel.
  const dealLabel = getDealLabel(deal);
  const { error: spendError } = await supabase.rpc("spend_credits", {
    p_amount: 1,
    p_description: `Deverrouillage deal investisseur : ${dealLabel}`,
    p_type: "deal_unlock",
  });

  if (spendError) {
    // La RPC lève NO_TOKENS (solde insuffisant), NO_ACCOUNT (pas de compte) ou
    // NOT_AUTHENTICATED. Seul le premier a un message dédié ; les autres sont
    // des anomalies et remontent tels quels pour ne pas masquer la cause.
    // Comparaison en majuscules, comme spendCredits() dans projectUnlock.ts :
    // robuste si le libellé SQL est un jour reformulé.
    const brut = spendError.message ?? "";
    if (brut.toUpperCase().includes("NO_TOKENS")) {
      return {
        ok: false,
        reason: "NO_TOKENS",
        message: "Vous n'avez plus de jetons disponibles.",
      };
    }
    return { ok: false, reason: "ERROR", message: brut };
  }

  const ledgerId = createId("tok_deal_unlock");
  const nowIso = new Date().toISOString();

  // 5. Mettre à jour le snapshot local
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