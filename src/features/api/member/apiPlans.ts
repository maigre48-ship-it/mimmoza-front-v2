// ─────────────────────────────────────────────────────────────────────────────
// Mimmoza – API Plans catalog
// Prêt à remplacer par un fetch Supabase : table api_plans
// ─────────────────────────────────────────────────────────────────────────────

export type BillingMode = 'payg' | 'monthly' | 'annual';
export type PlanTier = 'free' | 'starter' | 'growth' | 'scale';
export type PlanEnvironment = 'test' | 'live';

export interface ApiPlan {
  id: PlanTier;
  name: string;
  tagline: string;
  monthlyPrice: number;       // € HT / mois (facturation mensuelle)
  annualPrice: number;        // € HT / mois (facturation annuelle)
  requestsIncluded: number;   // requêtes incluses / mois
  overagePerK: number;        // € pour 1 000 requêtes supplémentaires
  rateLimit: number;          // requêtes / minute
  maxKeys: number;
  features: string[];
  highlighted?: boolean;      // badge "Recommandé"
  contactSales?: boolean;     // tier enterprise → pas de self-serve
}

export interface PayAsYouGoConfig {
  pricePerK: number;          // € pour 1 000 requêtes
  minimumBilling: number;     // montant minimum / mois
  rateLimit: number;
  maxKeys: number;
}

export const PAY_AS_YOU_GO: PayAsYouGoConfig = {
  pricePerK: 2.5,
  minimumBilling: 0,
  rateLimit: 30,
  maxKeys: 2,
};

export const API_PLANS: ApiPlan[] = [
  {
    id: 'starter',
    name: 'Starter',
    tagline: 'Idéal pour démarrer',
    monthlyPrice: 49,
    annualPrice: 39,
    requestsIncluded: 10_000,
    overagePerK: 2.0,
    rateLimit: 60,
    maxKeys: 5,
    features: [
      '10 000 requêtes / mois incluses',
      '60 requêtes / minute',
      '5 clés API maximum',
      'Environnements test & live',
      'Support email standard',
    ],
  },
  {
    id: 'growth',
    name: 'Growth',
    tagline: 'Pour les équipes en croissance',
    monthlyPrice: 149,
    annualPrice: 119,
    requestsIncluded: 50_000,
    overagePerK: 1.5,
    rateLimit: 200,
    maxKeys: 20,
    features: [
      '50 000 requêtes / mois incluses',
      '200 requêtes / minute',
      '20 clés API maximum',
      'Logs & analytics avancés',
      'Webhooks',
      'Support prioritaire',
      'SLA 99,9 %',
    ],
    highlighted: true,
  },
  {
    id: 'scale',
    name: 'Scale',
    tagline: 'Pour les volumes importants',
    monthlyPrice: 499,
    annualPrice: 399,
    requestsIncluded: 250_000,
    overagePerK: 0.8,
    rateLimit: 1000,
    maxKeys: 100,
    features: [
      '250 000 requêtes / mois incluses',
      '1 000 requêtes / minute',
      '100 clés API maximum',
      'Logs & analytics temps réel',
      'IP allowlisting',
      'Support dédié & SLA 99,95 %',
      'Custom rate limits sur demande',
    ],
    contactSales: true,
  },
];

export function getPlanById(id: PlanTier): ApiPlan | undefined {
  return API_PLANS.find((p) => p.id === id);
}

export function getDisplayPrice(plan: ApiPlan, mode: BillingMode): number {
  if (mode === 'annual') return plan.annualPrice;
  return plan.monthlyPrice;
}

export function getAnnualSavingPercent(plan: ApiPlan): number {
  return Math.round(((plan.monthlyPrice - plan.annualPrice) / plan.monthlyPrice) * 100);
}