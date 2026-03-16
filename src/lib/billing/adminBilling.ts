import type { AccessContext } from "@/lib/access";
import type { TokenLedgerEntry } from "./billing.types";

// ─── Résultat fictif admin ────────────────────────────────────────────────────
//
// Quand un admin utilise une feature payante :
// - aucun jeton n'est débité
// - aucun quota n'est consommé
// - un log d'usage admin peut être inscrit pour traçabilité si souhaité
// - la facture N'EST PAS créée (pas de fausse facturation)

/**
 * Résultat de consommation fictif retourné pour un admin.
 * Le solde renvoyé est toujours 9999 (ADMIN_DISPLAY_QUOTA).
 */
export function buildAdminBypassConsumeResult(): TokenLedgerEntry {
  return {
    id: `admin-bypass-${Date.now()}`,
    user_id: "admin",
    direction: "debit",
    amount: 0,
    balance_after: 9999,
    reason: "admin_adjustment",
    feature_code: null,
    source_ref: "admin_bypass",
    metadata: { bypassed: true },
    is_admin_action: true,
    created_at: new Date().toISOString(),
  };
}

/**
 * Guard de bypass admin pour tout appel de consommation.
 *
 * Usage :
 * ```ts
 * if (isAdminBypassActive(ctx)) return buildAdminBypassConsumeResult();
 * // ... logique normale
 * ```
 */
export function isAdminBypassActive(ctx: AccessContext): boolean {
  return ctx.isAdmin || ctx.bypassLimits || ctx.bypassTokens;
}

/**
 * Wrapper qui court-circuite toute consommation de jeton pour un admin.
 * Appeler cette fonction AVANT debitTokensForFeature().
 *
 * Retourne null si l'utilisateur n'est pas admin (logique normale à exécuter).
 * Retourne le résultat fictif si admin (aucune écriture en base).
 */
export function tryAdminBypassConsume(
  ctx: AccessContext,
  featureCode: string
): TokenLedgerEntry | null {
  if (!isAdminBypassActive(ctx)) return null;

  console.log(`[adminBilling] bypass consume — feature: ${featureCode}`, {
    userId: ctx.userId,
    isAdmin: ctx.isAdmin,
  });

  return buildAdminBypassConsumeResult();
}

/**
 * Wrapper qui court-circuite tout check de quota pour un admin.
 *
 * Retourne true si admin (toujours autorisé).
 * Retourne null si utilisateur normal (appliquer la logique de quota normale).
 */
export function tryAdminBypassQuota(ctx: AccessContext): true | null {
  if (!isAdminBypassActive(ctx)) return null;
  return true;
}

// ─── Log usage admin (optionnel) ─────────────────────────────────────────────
//
// L'admin peut laisser une trace d'usage dans une table dédiée
// sans créer de fausse facturation.

import { supabase } from "@/lib/supabase";

type AdminUsageLogParams = {
  userId: string;
  featureCode: string;
  metadata?: Record<string, unknown>;
};

/**
 * Inscrit un log d'usage admin non-facturable.
 * Non-bloquant — ne throw jamais.
 */
export async function logAdminFeatureUsage(params: AdminUsageLogParams): Promise<void> {
  try {
    await supabase.from("admin_usage_log").insert({
      user_id: params.userId,
      feature_code: params.featureCode,
      metadata: params.metadata ?? {},
      created_at: new Date().toISOString(),
    });
  } catch {
    // Silencieux
  }
}