import type { AccessContext, FeatureKey } from "./access.types";
import { planHasFeature, getTokenCost, getDailyQuota } from "./planConfig";

// ─── Accès feature ─────────────────────────────────────────────────────────────
//
// Règle centrale : si admin → toujours true. Pas d'exception.
// Pour les autres : vérifie plan + abonnement actif.

/**
 * Retourne true si l'utilisateur peut accéder à la feature.
 *
 * - Admin : toujours true.
 * - Autres : plan actif + feature incluse dans le plan.
 */
export function canAccessFeature(ctx: AccessContext, feature: FeatureKey): boolean {
  // Admin bypass total
  if (ctx.bypassLimits || ctx.hasFullAccess || ctx.isAdmin) {
    return true;
  }

  // Pas d'abonnement actif = accès limité au plan free
  const effectivePlan = ctx.subscriptionActive ? ctx.plan : "free";
  return planHasFeature(effectivePlan, feature);
}

// ─── Consommation de jetons ────────────────────────────────────────────────────

/**
 * Retourne true si un jeton doit être débité pour cette feature.
 *
 * - Admin : toujours false (bypassTokens).
 * - Plan gratuit ou sans abonnement : coût non nul = doit consommer.
 * - Plan avec coût = 0 pour cette feature : false.
 */
export function shouldConsumeToken(ctx: AccessContext, feature: FeatureKey): boolean {
  if (ctx.bypassTokens || ctx.isAdmin) return false;

  const effectivePlan = ctx.subscriptionActive ? ctx.plan : "free";
  const cost = getTokenCost(effectivePlan, feature);
  return cost > 0;
}

/**
 * Retourne le nombre de jetons à débiter pour cette feature.
 * Toujours 0 pour un admin.
 */
export function getTokenCostForContext(ctx: AccessContext, feature: FeatureKey): number {
  if (ctx.bypassTokens || ctx.isAdmin) return 0;

  const effectivePlan = ctx.subscriptionActive ? ctx.plan : "free";
  return getTokenCost(effectivePlan, feature);
}

// ─── Consommation de quota ────────────────────────────────────────────────────

/**
 * Retourne true si un quota journalier doit être décrémenté pour cette feature.
 *
 * - Admin : toujours false.
 * - Feature sans quota (ex: veille.reload) : false.
 * - Quota null (illimité sur ce plan) : false.
 */
export function shouldConsumeQuota(ctx: AccessContext, feature: FeatureKey): boolean {
  if (ctx.bypassLimits || ctx.isAdmin) return false;

  const effectivePlan = ctx.subscriptionActive ? ctx.plan : "free";
  const quota = getDailyQuota(effectivePlan, feature);

  // null = illimité, pas de quota à décrémenter
  return quota !== null && quota > 0;
}

/**
 * Retourne true si le quota journalier est épuisé pour cette feature.
 * Toujours false pour un admin.
 */
export function isQuotaExhausted(ctx: AccessContext, feature: FeatureKey): boolean {
  if (ctx.bypassLimits || ctx.isAdmin) return false;

  switch (feature) {
    case "veille.refresh":
    case "market.ingest":
      return ctx.quotas.dailyRefreshRemaining !== null &&
             ctx.quotas.dailyRefreshRemaining <= 0;
    case "deal.unlock":
      return ctx.quotas.dealUnlockRemaining !== null &&
             ctx.quotas.dealUnlockRemaining <= 0;
    case "deal.analyze":
      return ctx.quotas.analysisRemaining !== null &&
             ctx.quotas.analysisRemaining <= 0;
    case "report.export":
      return ctx.quotas.reportExportRemaining !== null &&
             ctx.quotas.reportExportRemaining <= 0;
    default:
      return false;
  }
}

/**
 * Retourne true si l'utilisateur a assez de jetons pour la feature.
 * Toujours true pour un admin.
 */
export function hasSufficientTokens(ctx: AccessContext, feature: FeatureKey): boolean {
  if (ctx.bypassTokens || ctx.isAdmin) return true;

  const cost = getTokenCostForContext(ctx, feature);
  if (cost === 0) return true;

  return ctx.tokensRemaining >= cost;
}

// ─── Check combiné ─────────────────────────────────────────────────────────────

export type AccessCheckResult = {
  allowed: boolean;
  reason: "ok" | "no_feature" | "quota_exhausted" | "insufficient_tokens" | "admin_bypass";
};

/**
 * Vérifie l'ensemble des conditions d'accès pour une feature.
 * Retourne le motif de blocage précis pour faciliter le debug et l'audit.
 */
export function checkAccess(ctx: AccessContext, feature: FeatureKey): AccessCheckResult {
  if (ctx.isAdmin || ctx.bypassLimits) {
    return { allowed: true, reason: "admin_bypass" };
  }

  if (!canAccessFeature(ctx, feature)) {
    return { allowed: false, reason: "no_feature" };
  }

  if (isQuotaExhausted(ctx, feature)) {
    return { allowed: false, reason: "quota_exhausted" };
  }

  if (shouldConsumeToken(ctx, feature) && !hasSufficientTokens(ctx, feature)) {
    return { allowed: false, reason: "insufficient_tokens" };
  }

  return { allowed: true, reason: "ok" };
}