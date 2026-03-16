import type { AccessContext, FeatureKey, PaywallState } from "./access.types";
import {
  canAccessFeature,
  isQuotaExhausted,
  shouldConsumeToken,
  hasSufficientTokens,
} from "./accessPolicies";

// ─── Labels UI ────────────────────────────────────────────────────────────────

const PAYWALL_LABELS: Record<string, string> = {
  no_subscription: "Abonnement requis pour accéder à cette fonctionnalité.",
  no_tokens: "Jetons insuffisants. Rechargez votre compte pour continuer.",
  quota_exceeded: "Limite journalière atteinte. Revenez demain ou passez à un plan supérieur.",
  plan_insufficient: "Votre plan actuel ne donne pas accès à cette fonctionnalité.",
};

// ─── État paywall non bloqué ──────────────────────────────────────────────────

const PAYWALL_OPEN: PaywallState = {
  blocked: false,
  reason: null,
  cta: null,
  label: null,
};

// ─── Moteur paywall ────────────────────────────────────────────────────────────

/**
 * Retourne l'état du paywall pour une feature donnée dans un contexte d'accès.
 *
 * - Admin : toujours `{ blocked: false }`.
 * - Autres : vérifie plan → quota → jetons dans cet ordre.
 *
 * Usage dans un composant :
 * ```tsx
 * const pw = getPaywallState(ctx, "deal.unlock");
 * if (pw.blocked) return <PaywallBanner reason={pw.reason} cta={pw.cta} />;
 * ```
 */
export function getPaywallState(ctx: AccessContext, feature: FeatureKey): PaywallState {
  // Admin — bypass total, jamais bloqué
  if (ctx.isAdmin || ctx.bypassLimits || ctx.hasFullAccess) {
    return PAYWALL_OPEN;
  }

  // Plan insuffisant
  if (!canAccessFeature(ctx, feature)) {
    const reason = ctx.subscriptionActive ? "plan_insufficient" : "no_subscription";
    return {
      blocked: true,
      reason,
      cta: ctx.subscriptionActive ? "upgrade" : "upgrade",
      label: PAYWALL_LABELS[reason] ?? null,
    };
  }

  // Quota journalier épuisé
  if (isQuotaExhausted(ctx, feature)) {
    return {
      blocked: true,
      reason: "quota_exceeded",
      cta: resolveQuotaExceededCta(ctx),
      label: PAYWALL_LABELS.quota_exceeded,
    };
  }

  // Jetons insuffisants
  if (shouldConsumeToken(ctx, feature) && !hasSufficientTokens(ctx, feature)) {
    return {
      blocked: true,
      reason: "no_tokens",
      cta: "buy_tokens",
      label: PAYWALL_LABELS.no_tokens,
    };
  }

  return PAYWALL_OPEN;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveQuotaExceededCta(ctx: AccessContext): PaywallState["cta"] {
  if (!ctx.subscriptionActive) return "upgrade";
  if (ctx.plan === "starter") return "upgrade";
  if (ctx.plan === "pro") return "contact_sales";
  return "upgrade";
}

/**
 * Version booléenne simple pour les guards de navigation.
 * Préférer getPaywallState pour l'UI afin d'obtenir le motif précis.
 */
export function isFeatureBlocked(ctx: AccessContext, feature: FeatureKey): boolean {
  return getPaywallState(ctx, feature).blocked;
}

/**
 * Retourne l'état paywall pour plusieurs features à la fois.
 * Utile pour initialiser une page avec plusieurs sections conditionnelles.
 */
export function getPaywallStates<K extends FeatureKey>(
  ctx: AccessContext,
  features: K[]
): Record<K, PaywallState> {
  return Object.fromEntries(
    features.map((f) => [f, getPaywallState(ctx, f)])
  ) as Record<K, PaywallState>;
}