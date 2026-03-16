import type { PlanCode, TokenPackCode } from "./billing.types";

// ─── Configuration des plans ──────────────────────────────────────────────────
//
// Les stripe_price_id sont à remplacer par vos vrais IDs depuis le dashboard Stripe.
// En développement, utiliser les price_id de l'environnement test.

export type PlanCatalogEntry = {
  code: PlanCode;
  label: string;
  description: string;
  /** Prix mensuel en centimes. 0 = gratuit. */
  monthly_price_cents: number;
  /** Prix annuel en centimes (optionnel). */
  annual_price_cents: number | null;
  currency: string;
  stripe_monthly_price_id: string | null;
  stripe_annual_price_id: string | null;
  /** Jetons offerts à l'activation du plan. */
  included_tokens: number;
  /** Fonctionnalités textuelles (pour page pricing). */
  features: string[];
  is_active: boolean;
};

export const PLAN_CATALOG: Readonly<Record<PlanCode, PlanCatalogEntry>> = {
  free: {
    code: "free",
    label: "Gratuit",
    description: "Découvrez Mimmoza sans engagement",
    monthly_price_cents: 0,
    annual_price_cents: null,
    currency: "eur",
    stripe_monthly_price_id: null,
    stripe_annual_price_id: null,
    included_tokens: 2,
    features: [
      "Accès veille (lecture seule)",
      "2 analyses offertes",
      "Sourcing limité",
    ],
    is_active: true,
  },

  starter: {
    code: "starter",
    label: "Starter",
    description: "Pour les investisseurs qui démarrent",
    monthly_price_cents: 4900,
    annual_price_cents: 49900,
    currency: "eur",
    stripe_monthly_price_id: "price_starter_monthly_REPLACE",
    stripe_annual_price_id: "price_starter_annual_REPLACE",
    included_tokens: 10,
    features: [
      "Veille marché 3 zones",
      "5 analyses IA / jour",
      "Pipeline Kanban",
      "Export limité",
    ],
    is_active: true,
  },

  pro: {
    code: "pro",
    label: "Pro",
    description: "Pour les marchands de biens actifs",
    monthly_price_cents: 9900,
    annual_price_cents: 99900,
    currency: "eur",
    stripe_monthly_price_id: "price_pro_monthly_REPLACE",
    stripe_annual_price_id: "price_pro_annual_REPLACE",
    included_tokens: 25,
    features: [
      "Veille illimitée",
      "Analyses illimitées",
      "Deal unlock inclus",
      "Export PDF illimité",
      "Opportunités IA",
    ],
    is_active: true,
  },

  promoteur_starter: {
    code: "promoteur_starter",
    label: "Promoteur Starter",
    description: "Pour les promoteurs en phase d'exploration",
    monthly_price_cents: 7900,
    annual_price_cents: 79900,
    currency: "eur",
    stripe_monthly_price_id: "price_promo_starter_monthly_REPLACE",
    stripe_annual_price_id: "price_promo_starter_annual_REPLACE",
    included_tokens: 15,
    features: [
      "PLU & Faisabilité",
      "Implantation 2D",
      "Étude de marché",
      "10 exports / mois",
    ],
    is_active: true,
  },

  promoteur_pro: {
    code: "promoteur_pro",
    label: "Promoteur Pro",
    description: "Pour les promoteurs avec volume d'opérations",
    monthly_price_cents: 14900,
    annual_price_cents: 149900,
    currency: "eur",
    stripe_monthly_price_id: "price_promo_pro_monthly_REPLACE",
    stripe_annual_price_id: "price_promo_pro_annual_REPLACE",
    included_tokens: 50,
    features: [
      "Tout Promoteur Starter",
      "Exports illimités",
      "Multi-parcelles",
      "API IGN avancée",
    ],
    is_active: true,
  },

  financeur_pro: {
    code: "financeur_pro",
    label: "Financeur Pro",
    description: "Pour les banques et assurances",
    monthly_price_cents: 19900,
    annual_price_cents: 199900,
    currency: "eur",
    stripe_monthly_price_id: "price_financeur_pro_monthly_REPLACE",
    stripe_annual_price_id: "price_financeur_pro_annual_REPLACE",
    included_tokens: 100,
    features: [
      "Espace Comité Bancaire",
      "SmartScore 9 piliers",
      "Rapports comité",
      "Stress tests",
    ],
    is_active: true,
  },

  enterprise: {
    code: "enterprise",
    label: "Enterprise",
    description: "Pour les grands comptes — sur mesure",
    monthly_price_cents: 0, // prix sur devis
    annual_price_cents: null,
    currency: "eur",
    stripe_monthly_price_id: null, // géré manuellement via Stripe
    stripe_annual_price_id: null,
    included_tokens: 999,
    features: [
      "Accès total",
      "Jetons illimités",
      "SLA dédié",
      "Onboarding personnalisé",
      "Multi-utilisateurs",
    ],
    is_active: true,
  },
} as const;

// ─── Catalogue des packs de jetons ────────────────────────────────────────────

export type TokenPackCatalogEntry = {
  code: TokenPackCode;
  label: string;
  tokens: number;
  price_cents: number;
  currency: string;
  stripe_price_id: string | null;
  /** Prix par jeton en centimes (calculé). */
  price_per_token_cents: number;
  /** Économie affichée en % vs pack de base (pour badge marketing). */
  savings_pct: number | null;
  is_active: boolean;
};

export const TOKEN_PACK_CATALOG: Readonly<
  Record<TokenPackCode, TokenPackCatalogEntry>
> = {
  tokens_10: {
    code: "tokens_10",
    label: "Pack 10 jetons",
    tokens: 10,
    price_cents: 990,
    currency: "eur",
    stripe_price_id: "price_tokens_10_REPLACE",
    price_per_token_cents: 99,
    savings_pct: null,
    is_active: true,
  },

  tokens_20: {
    code: "tokens_20",
    label: "Pack 20 jetons",
    tokens: 20,
    price_cents: 1790,
    currency: "eur",
    stripe_price_id: "price_tokens_20_REPLACE",
    price_per_token_cents: 90,
    savings_pct: 9,
    is_active: true,
  },

  tokens_50: {
    code: "tokens_50",
    label: "Pack 50 jetons",
    tokens: 50,
    price_cents: 3990,
    currency: "eur",
    stripe_price_id: "price_tokens_50_REPLACE",
    price_per_token_cents: 80,
    savings_pct: 19,
    is_active: true,
  },

  tokens_100: {
    code: "tokens_100",
    label: "Pack 100 jetons",
    tokens: 100,
    price_cents: 6900,
    currency: "eur",
    stripe_price_id: "price_tokens_100_REPLACE",
    price_per_token_cents: 69,
    savings_pct: 30,
    is_active: true,
  },
} as const;

// ─── Listes dérivées ──────────────────────────────────────────────────────────

export const PLAN_CATALOG_LIST = Object.values(
  PLAN_CATALOG
) as PlanCatalogEntry[];

export const TOKEN_PACK_CATALOG_LIST = Object.values(
  TOKEN_PACK_CATALOG
) as TokenPackCatalogEntry[];

export const ACTIVE_PLAN_CATALOG_LIST = PLAN_CATALOG_LIST.filter(
  (entry) => entry.is_active
);

export const ACTIVE_TOKEN_PACK_CATALOG_LIST = TOKEN_PACK_CATALOG_LIST.filter(
  (entry) => entry.is_active
);

// ─── Helpers catalogue ────────────────────────────────────────────────────────

export function getPlanEntry(
  code: PlanCode | null | undefined
): PlanCatalogEntry {
  if (!code) return PLAN_CATALOG.free;
  return PLAN_CATALOG[code] ?? PLAN_CATALOG.free;
}

export function getTokenPackEntry(
  code: TokenPackCode
): TokenPackCatalogEntry {
  return TOKEN_PACK_CATALOG[code];
}

/**
 * Résout le PlanCode depuis un Stripe Price ID.
 * Utilisé dans le webhook Stripe pour identifier le plan souscrit.
 */
export function planCodeFromStripePriceId(
  priceId: string | null | undefined
): PlanCode | null {
  if (!priceId) return null;

  for (const entry of PLAN_CATALOG_LIST) {
    if (
      entry.stripe_monthly_price_id === priceId ||
      entry.stripe_annual_price_id === priceId
    ) {
      return entry.code;
    }
  }

  return null;
}

/**
 * Résout le TokenPackCode depuis un Stripe Price ID.
 */
export function tokenPackFromStripePriceId(
  priceId: string | null | undefined
): TokenPackCode | null {
  if (!priceId) return null;

  for (const entry of TOKEN_PACK_CATALOG_LIST) {
    if (entry.stripe_price_id === priceId) {
      return entry.code;
    }
  }

  return null;
}

/**
 * MRR en centimes estimé pour un plan.
 * Plans enterprise (price=0) ou sur devis retournent null.
 */
export function planMrrCents(
  code: PlanCode | null | undefined
): number | null {
  const entry = getPlanEntry(code);

  if (entry.code === "enterprise") return null;
  return entry.monthly_price_cents;
}

/**
 * ARR théorique en centimes si le plan a un prix annuel,
 * sinon 12 x mensuel. Enterprise retourne null.
 */
export function planArrCents(
  code: PlanCode | null | undefined
): number | null {
  const entry = getPlanEntry(code);

  if (entry.code === "enterprise") return null;
  if (entry.annual_price_cents != null) return entry.annual_price_cents;

  return entry.monthly_price_cents * 12;
}

export function isFreePlan(code: PlanCode | null | undefined): boolean {
  return getPlanEntry(code).code === "free";
}

export function isEnterprisePlan(
  code: PlanCode | null | undefined
): boolean {
  return getPlanEntry(code).code === "enterprise";
}

// ─── Formatage monétaire ──────────────────────────────────────────────────────

/** Convertit des centimes en string formatée (ex: 9900 → "99,00 €"). */
export function formatCents(cents: number, currency = "EUR"): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}