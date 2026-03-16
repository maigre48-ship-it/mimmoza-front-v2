import { supabase } from "@/lib/supabase";
import type { AccessContext, ConsumeResult, FeatureKey } from "./access.types";
import {
  shouldConsumeToken,
  shouldConsumeQuota,
  getTokenCostForContext,
} from "./accessPolicies";
import { logAccessEvent } from "./audit";

// ─── Consommation de jetons ────────────────────────────────────────────────────

/**
 * Consomme des jetons pour la feature si nécessaire.
 *
 * - Admin (bypassTokens) : ne consomme rien, retourne skipped=true.
 * - Plan sans coût : ne consomme rien, retourne skipped=true.
 * - Autres : décrémente `user_tokens.balance` via Supabase RPC ou UPDATE.
 *
 * La consommation est atomique côté Supabase pour éviter les race conditions.
 */
export async function consumeToken(
  ctx: AccessContext,
  feature: FeatureKey
): Promise<ConsumeResult> {
  // Bypass admin
  if (ctx.bypassTokens || ctx.isAdmin) {
    await logAccessEvent({
      ctx,
      feature,
      eventType: "token_skipped",
      metadata: { skipReason: "admin_bypass" },
    });
    return {
      ok: true,
      consumed: false,
      skipped: true,
      skipReason: "admin_bypass",
      newBalance: null,
      error: null,
    };
  }

  // Feature sans coût sur ce plan
  if (!shouldConsumeToken(ctx, feature)) {
    await logAccessEvent({
      ctx,
      feature,
      eventType: "token_skipped",
      metadata: { skipReason: "no_cost_feature" },
    });
    return {
      ok: true,
      consumed: false,
      skipped: true,
      skipReason: "no_cost_feature",
      newBalance: ctx.tokensRemaining,
      error: null,
    };
  }

  if (!ctx.userId) {
    return { ok: false, consumed: false, skipped: false, skipReason: null, newBalance: null, error: "userId manquant" };
  }

  const cost = getTokenCostForContext(ctx, feature);

  try {
    // Décrémentation atomique — utilise une RPC si disponible, sinon UPDATE conditionnel
    const { data, error } = await supabase.rpc("decrement_user_tokens", {
      p_user_id: ctx.userId,
      p_amount: cost,
    });

    if (error) {
      // Fallback : UPDATE direct si la RPC n'existe pas encore
      const { data: updated, error: updateError } = await supabase
        .from("user_tokens")
        .update({ balance: Math.max(0, ctx.tokensRemaining - cost) })
        .eq("user_id", ctx.userId)
        .gte("balance", cost) // condition atomique : ne décrément pas si insuffisant
        .select("balance")
        .maybeSingle();

      if (updateError || !updated) {
        throw updateError ?? new Error("Décrémentation impossible — solde insuffisant.");
      }

      const newBalance = (updated as { balance: number }).balance;
      await logAccessEvent({ ctx, feature, eventType: "token_consumed", metadata: { cost, newBalance } });
      return { ok: true, consumed: true, skipped: false, skipReason: null, newBalance, error: null };
    }

    const newBalance = typeof data === "number" ? data : null;
    await logAccessEvent({ ctx, feature, eventType: "token_consumed", metadata: { cost, newBalance } });
    return { ok: true, consumed: true, skipped: false, skipReason: null, newBalance, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logAccessEvent({
      ctx,
      feature,
      eventType: "feature_access_denied",
      metadata: { reason: "token_consume_error", error: message },
    });
    return { ok: false, consumed: false, skipped: false, skipReason: null, newBalance: null, error: message };
  }
}

// ─── Consommation de quota ────────────────────────────────────────────────────

/**
 * Enregistre la consommation d'un quota journalier pour la feature.
 *
 * - Admin (bypassLimits) : ne consomme rien, retourne skipped=true.
 * - Feature sans quota : retourne skipped=true.
 * - Autres : insère une ligne dans la table de log correspondante.
 *
 * Note : le quota est calculé a posteriori (count des logs), pas via un
 * compteur décrémenté. Cette approche est plus robuste aux resets.
 */
export async function consumeQuota(
  ctx: AccessContext,
  feature: FeatureKey,
  metadata?: Record<string, unknown>
): Promise<ConsumeResult> {
  // Bypass admin
  if (ctx.bypassLimits || ctx.isAdmin) {
    await logAccessEvent({
      ctx,
      feature,
      eventType: "quota_skipped",
      metadata: { skipReason: "admin_bypass", ...metadata },
    });
    return {
      ok: true,
      consumed: false,
      skipped: true,
      skipReason: "admin_bypass",
      newBalance: null,
      error: null,
    };
  }

  // Feature sans quota
  if (!shouldConsumeQuota(ctx, feature)) {
    return {
      ok: true,
      consumed: false,
      skipped: true,
      skipReason: "no_cost_feature",
      newBalance: null,
      error: null,
    };
  }

  if (!ctx.userId) {
    return { ok: false, consumed: false, skipped: false, skipReason: null, newBalance: null, error: "userId manquant" };
  }

  const logTable = getQuotaLogTable(feature);
  if (!logTable) {
    return { ok: true, consumed: false, skipped: true, skipReason: "no_cost_feature", newBalance: null, error: null };
  }

  try {
    await supabase.from(logTable).insert({
      user_id: ctx.userId,
      feature,
      plan: ctx.plan,
      created_at: new Date().toISOString(),
      ...metadata,
    });

    await logAccessEvent({ ctx, feature, eventType: "quota_consumed", metadata: metadata ?? {} });

    return { ok: true, consumed: true, skipped: false, skipReason: null, newBalance: null, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, consumed: false, skipped: false, skipReason: null, newBalance: null, error: message };
  }
}

// ─── Helper : table de quota par feature ──────────────────────────────────────

function getQuotaLogTable(feature: FeatureKey): string | null {
  switch (feature) {
    case "veille.refresh":
    case "market.ingest":
      // La veille utilise market_zone_refresh_log (déjà existant)
      // La consommation est gérée directement dans marketRefresh.ts
      return null; // géré en amont
    case "deal.unlock":
      return "deal_unlock_log";
    case "deal.analyze":
      return "analysis_log";
    case "report.export":
      return "report_export_log";
    default:
      return null;
  }
}