// ─── Moteur d'accès Mimmoza ────────────────────────────────────────────────────
//
// Point d'entrée unique. Toujours importer depuis "@/lib/access" dans les
// composants et services, jamais depuis un sous-fichier directement.

// Types
export type {
  FeatureKey,
  PlanId,
  AccessQuotas,
  AccessContext,
  PaywallBlockReason,
  PaywallCTA,
  PaywallState,
  ConsumeResult,
  ConsumeSkipReason,
  AccessEventType,
  AccessAuditEvent,
} from "./access.types";

// Plan config (interne au moteur d'accès — pas de billing ici)
export { PLAN_CONFIGS, getPlanConfig, planHasFeature, getTokenCost, getDailyQuota } from "./planConfig";
export type { PlanConfig } from "./planConfig";

// Context resolver
export {
  buildUserAccessContext,
  useAccessContext,
  ADMIN_DISPLAY_QUOTA,
  ANONYMOUS_ACCESS_CONTEXT,
} from "./accessContext";

// Policies
export {
  canAccessFeature,
  shouldConsumeToken,
  shouldConsumeQuota,
  getTokenCostForContext,
  isQuotaExhausted,
  hasSufficientTokens,
  checkAccess,
} from "./accessPolicies";
export type { AccessCheckResult } from "./accessPolicies";

// Paywall
export { getPaywallState, isFeatureBlocked, getPaywallStates } from "./paywall";

// Consumption
export { consumeToken, consumeQuota } from "./consumption";

// Audit
export { logAccessEvent, logFeatureAccess } from "./audit";