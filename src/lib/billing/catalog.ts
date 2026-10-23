import type { PlanCode, TokenPackCode } from "./billing.types";
import { PACKS_JETONS, formule, type Formule } from "./grille";

// ─── Alignement sur la grille unique (audit du 21/10/2026) ───────────────────
//
// Les codes serveur historiques (free / starter / pro / promoteur_* /
// financeur_pro / enterprise) sont conservés : ils peuvent figurer dans
// billing_profiles.plan_code. Leurs PRIX et JETONS INCLUS sont désormais lus
// dans grille.ts, via la même correspondance que syncPlanFromServer :
//   free → Découverte · starter, promoteur_starter → Indépendant ·
//   pro → Pro · promoteur_pro, financeur_pro, enterprise → Pro.
// La formule « Équipe » a été retirée de l'offre le 23/10/2026 : ces trois
// anciens codes donnent les droits de Pro, ne sont plus vendus (is_active: false)
// et ne figurent plus sur aucune grille.
function prixGrille(f: Formule) {
  return {
    monthly_price_cents: Math.round(f.prixMensuelHT * 100),
    annual_price_cents: f.prixMensuelAnnuelHT == null ? null : Math.round(f.prixMensuelAnnuelHT * 12 * 100),
    included_tokens: f.jetonsMensuels,
  };
}

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
    label: "Découverte",
    description: "Découvrez Mimmoza sans engagement",
    ...prixGrille(formule("basique")),
    currency: "eur",
    stripe_monthly_price_id: null,
    stripe_annual_price_id: null,
    features: [
      ...formule("basique").points,
    ],
    is_active: true,
  },

  starter: {
    code: "starter",
    label: "Indépendant",
    description: "Pour les investisseurs qui démarrent",
    ...prixGrille(formule("avance")),
    currency: "eur",
    stripe_monthly_price_id: "price_starter_monthly_REPLACE",
    stripe_annual_price_id: "price_starter_annual_REPLACE",
    features: [...formule("avance").points],
    is_active: true,
  },

  pro: {
    code: "pro",
    label: "Pro",
    description: "Pour les marchands de biens actifs",
    ...prixGrille(formule("pro")),
    currency: "eur",
    stripe_monthly_price_id: "price_pro_monthly_REPLACE",
    stripe_annual_price_id: "price_pro_annual_REPLACE",
    features: [...formule("pro").points],
    is_active: true,
  },

  promoteur_starter: {
    code: "promoteur_starter",
    label: "Indépendant (ancien code Promoteur Starter)",
    description: "Pour les promoteurs en phase d'exploration",
    ...prixGrille(formule("avance")),
    currency: "eur",
    stripe_monthly_price_id: "price_promo_starter_monthly_REPLACE",
    stripe_annual_price_id: "price_promo_starter_annual_REPLACE",
    features: [...formule("avance").points],
    is_active: true,
  },

  promoteur_pro: {
    code: "promoteur_pro",
    label: "Pro (ancien code Promoteur Pro)",
    description: "Ancien code, traité comme la formule Pro",
    ...prixGrille(formule("pro")),
    currency: "eur",
    stripe_monthly_price_id: "price_promo_pro_monthly_REPLACE",
    stripe_annual_price_id: "price_promo_pro_annual_REPLACE",
    features: [...formule("pro").points],
    is_active: false,
  },

  financeur_pro: {
    code: "financeur_pro",
    label: "Pro (ancien code Financeur Pro)",
    description: "Ancien code, traité comme la formule Pro",
    ...prixGrille(formule("pro")),
    currency: "eur",
    stripe_monthly_price_id: "price_financeur_pro_monthly_REPLACE",
    stripe_annual_price_id: "price_financeur_pro_annual_REPLACE",
    features: [...formule("pro").points],
    is_active: false,
  },

  enterprise: {
    code: "enterprise",
    label: "Pro (ancien code Enterprise)",
    description: "Ancien code sur devis, traité comme la formule Pro",
    monthly_price_cents: 0, // ancien prix sur devis : inconnu, MRR non calculé
    annual_price_cents: null,
    included_tokens: formule("pro").jetonsMensuels,
    currency: "eur",
    stripe_monthly_price_id: null, // géré manuellement via Stripe
    stripe_annual_price_id: null,
    features: [...formule("pro").points],
    is_active: false,
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
> = Object.fromEntries(
  PACKS_JETONS.map((p) => {
    const base = PACKS_JETONS[0].prixHT / PACKS_JETONS[0].jetons;
    const parJeton = p.prixHT / p.jetons;
    const entry: TokenPackCatalogEntry = {
      code: p.code,
      label: `Pack ${p.jetons.toLocaleString("fr-FR")} jetons`,
      tokens: p.jetons,
      price_cents: Math.round(p.prixHT * 100),
      currency: "eur",
      // Stripe non branché : à renseigner à l'ouverture du paiement en ligne.
      stripe_price_id: null,
      price_per_token_cents: Math.round(parJeton * 100 * 10) / 10,
      savings_pct: parJeton < base ? Math.round((1 - parJeton / base) * 100) : null,
      is_active: true,
    };
    return [p.code, entry];
  }),
) as Record<TokenPackCode, TokenPackCatalogEntry>;

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