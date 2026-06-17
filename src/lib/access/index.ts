// ─── Moteur d'accès Mimmoza ────────────────────────────────────────────────────
//
// Point d'entrée unique. Toujours importer depuis "@/lib/access" dans les
// composants et services, jamais depuis un sous-fichier directement.

// Types
export type {
  AccessAuditEvent, AccessContext, AccessEventType, AccessQuotas, ConsumeResult,
  ConsumeSkipReason, FeatureKey, PaywallBlockReason,
  PaywallCTA,
  PaywallState, PlanId
} from "./access.types";

// Plan config (interne au moteur d'accès — pas de billing ici)
export { PLAN_CONFIGS, getDailyQuota, getPlanConfig, getTokenCost, planHasFeature } from "./planConfig";
export type { PlanConfig } from "./planConfig";

// Context resolver
export {
  ADMIN_DISPLAY_QUOTA,
  ANONYMOUS_ACCESS_CONTEXT, buildUserAccessContext,
  useAccessContext
} from "./accessContext";

// Policies
export {
  canAccessFeature, checkAccess, getTokenCostForContext, hasSufficientTokens, isQuotaExhausted, shouldConsumeQuota, shouldConsumeToken
} from "./accessPolicies";
export type { AccessCheckResult } from "./accessPolicies";

// Paywall
export { getPaywallState, getPaywallStates, isFeatureBlocked } from "./paywall";

// Consumption
export { consumeQuota, consumeToken } from "./consumption";

// Audit
export { logAccessEvent, logFeatureAccess } from "./audit";
