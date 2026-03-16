import type { FeatureKey, PlanId } from "./access.types";

// ─── Quotas par plan (valeurs journalières) ────────────────────────────────────
//
// null = illimité.
// Ces valeurs peuvent être externalisées en base (remote config) sans changer
// le code applicatif — il suffira d'alimenter PlanConfig dynamiquement.

export type PlanConfig = {
  id: PlanId;
  label: string;

  // Quotas journaliers
  dailyRefreshQuota: number | null;
  dealUnlockQuota: number | null;
  analysisQuota: number | null;
  reportExportQuota: number | null;

  // Coûts en jetons (0 = gratuit sur ce plan)
  tokenCostPerDealUnlock: number;
  tokenCostPerAnalysis: number;
  tokenCostPerReport: number;

  // Features autorisées sur ce plan
  features: ReadonlySet<FeatureKey>;
};

// ─── Définition des plans ──────────────────────────────────────────────────────

const FREE_FEATURES: ReadonlySet<FeatureKey> = new Set<FeatureKey>([
  "veille.reload",
  "sourcing.access",
]);

const STARTER_FEATURES: ReadonlySet<FeatureKey> = new Set<FeatureKey>([
  "veille.reload",
  "veille.refresh",
  "deal.analyze",
  "sourcing.access",
  "execution.access",
  "analysis.access",
]);

const PRO_FEATURES: ReadonlySet<FeatureKey> = new Set<FeatureKey>([
  "veille.reload",
  "veille.refresh",
  "deal.unlock",
  "deal.analyze",
  "sourcing.access",
  "execution.access",
  "analysis.access",
  "report.export",
  "market.ingest",
  "market.opportunity.refresh",
  "banque.comite",
  "promoteur.plu",
  "promoteur.implantation",
]);

const ENTERPRISE_FEATURES: ReadonlySet<FeatureKey> = new Set<FeatureKey>([
  "veille.reload",
  "veille.refresh",
  "deal.unlock",
  "deal.analyze",
  "sourcing.access",
  "execution.access",
  "analysis.access",
  "report.export",
  "market.ingest",
  "market.opportunity.refresh",
  "banque.comite",
  "promoteur.plu",
  "promoteur.implantation",
  "admin.panel",
]);

export const PLAN_CONFIGS: Readonly<Record<PlanId, PlanConfig>> = {
  free: {
    id: "free",
    label: "Gratuit",
    dailyRefreshQuota: 0,
    dealUnlockQuota: 0,
    analysisQuota: 2,
    reportExportQuota: 0,
    tokenCostPerDealUnlock: 1,
    tokenCostPerAnalysis: 1,
    tokenCostPerReport: 2,
    features: FREE_FEATURES,
  },

  starter: {
    id: "starter",
    label: "Starter",
    dailyRefreshQuota: 3,
    dealUnlockQuota: 2,
    analysisQuota: 5,
    reportExportQuota: 2,
    tokenCostPerDealUnlock: 1,
    tokenCostPerAnalysis: 1,
    tokenCostPerReport: 1,
    features: STARTER_FEATURES,
  },

  pro: {
    id: "pro",
    label: "Pro",
    dailyRefreshQuota: 10,
    dealUnlockQuota: null, // illimité
    analysisQuota: null,
    reportExportQuota: 10,
    tokenCostPerDealUnlock: 0, // inclus dans l'abonnement
    tokenCostPerAnalysis: 0,
    tokenCostPerReport: 1,
    features: PRO_FEATURES,
  },

  enterprise: {
    id: "enterprise",
    label: "Enterprise",
    dailyRefreshQuota: null,
    dealUnlockQuota: null,
    analysisQuota: null,
    reportExportQuota: null,
    tokenCostPerDealUnlock: 0,
    tokenCostPerAnalysis: 0,
    tokenCostPerReport: 0,
    features: ENTERPRISE_FEATURES,
  },
} as const;

// ─── Helpers plan ──────────────────────────────────────────────────────────────

export function getPlanConfig(planId: PlanId | null | undefined): PlanConfig {
  if (planId && planId in PLAN_CONFIGS) {
    return PLAN_CONFIGS[planId];
  }
  return PLAN_CONFIGS.free;
}

export function planHasFeature(planId: PlanId | null | undefined, feature: FeatureKey): boolean {
  return getPlanConfig(planId).features.has(feature);
}

/** Retourne le coût en jetons pour une feature sur un plan donné. */
export function getTokenCost(planId: PlanId | null | undefined, feature: FeatureKey): number {
  const cfg = getPlanConfig(planId);
  switch (feature) {
    case "deal.unlock":
      return cfg.tokenCostPerDealUnlock;
    case "deal.analyze":
      return cfg.tokenCostPerAnalysis;
    case "report.export":
      return cfg.tokenCostPerReport;
    default:
      return 0;
  }
}

/** Retourne la quota journalière pour une feature sur un plan donné. */
export function getDailyQuota(planId: PlanId | null | undefined, feature: FeatureKey): number | null {
  const cfg = getPlanConfig(planId);
  switch (feature) {
    case "veille.refresh":
    case "market.ingest":
      return cfg.dailyRefreshQuota;
    case "deal.unlock":
      return cfg.dealUnlockQuota;
    case "deal.analyze":
      return cfg.analysisQuota;
    case "report.export":
      return cfg.reportExportQuota;
    default:
      return null; // pas de quota pour cette feature
  }
}