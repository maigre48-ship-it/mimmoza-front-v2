export type AdminUserRole = "investisseur" | "promoteur" | "financeur" | "admin";

export type AdminUserStatus = "actif" | "essai" | "suspendu" | "résilié";

export type AdminPlanType =
  | "tokens-10"
  | "tokens-20"
  | "starter"
  | "pro"
  | "promoteur-starter"
  | "promoteur-pro"
  | "promoteur-enterprise"
  | "financeur-pro"
  | "financeur-equipe"
  | "financeur-enterprise"
  | "custom"
  | "none";

export type QuoteSegment = "promoteur" | "financeur" | "investisseur";

export type QuoteStatus =
  | "nouveau"
  | "qualifié"
  | "devis-envoyé"
  | "négociation"
  | "gagné"
  | "perdu";

export type CompanyStatus = "prospect" | "client" | "suspendu";

export type AdminUser = {
  id: string;
  fullName: string;
  email: string;
  role: AdminUserRole;
  status: AdminUserStatus;
  plan: AdminPlanType;
  tokensRemaining: number;
  monthlyQuota?: number | null;
  createdAt: string;
  companyName?: string | null;
};

export type AdminSubscription = {
  id: string;
  userId: string;
  plan: AdminPlanType;
  amountHtEur: number;
  interval: "month" | "one-shot" | "custom";
  status: "active" | "pending" | "canceled";
  quotaIncluded?: number | null;
  renewalDate?: string | null;
};

export type AdminTokenLedger = {
  id: string;
  userId: string;
  type: "purchase" | "consumption" | "bonus" | "adjustment";
  delta: number;
  label: string;
  createdAt: string;
};

export type AdminQuote = {
  id: string;
  companyName: string;
  contactName: string;
  email: string;
  segment: QuoteSegment;
  status: QuoteStatus;
  estimatedAmountHt: number;
  notes: string;
  createdAt: string;
};

export type AdminCompany = {
  id: string;
  name: string;
  segment: QuoteSegment;
  status: CompanyStatus;
  usersCount: number;
  activePlan: AdminPlanType;
  mrrHt: number;
  ownerName: string;
};