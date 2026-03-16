// ─── Feature keys ─────────────────────────────────────────────────────────────
//
// Toutes les fonctionnalités soumises à contrôle d'accès.
// Ajouter ici pour étendre le moteur sans toucher aux helpers.

export type FeatureKey =
  | "veille.refresh"         // Actualisation pipeline veille marché (ingest + pipeline)
  | "veille.reload"          // Rechargement données existantes (lecture seule)
  | "deal.unlock"            // Déverrouillage d'un deal premium Marchand
  | "deal.analyze"           // Lancement analyse IA sur un deal
  | "sourcing.access"        // Accès espace Sourcing
  | "execution.access"       // Accès espace Exécution / Kanban
  | "analysis.access"        // Accès espace Analyse Investisseur
  | "report.export"          // Export PDF / rapport
  | "market.ingest"          // Ingest direct données marché
  | "market.opportunity.refresh" // Recalcul score opportunités
  | "banque.comite"          // Accès espace Comité Bancaire
  | "promoteur.plu"          // Accès analyse PLU / Faisabilité
  | "promoteur.implantation" // Accès Implantation 2D
  | "admin.panel";           // Accès panneau admin

// ─── Plans ────────────────────────────────────────────────────────────────────

export type PlanId = "free" | "starter" | "pro" | "enterprise";

// ─── Quotas ───────────────────────────────────────────────────────────────────

export type AccessQuotas = {
  /** Nombre d'actualisations pipeline veille restantes aujourd'hui. */
  dailyRefreshRemaining: number | null;
  /** Nombre de deals déverrouillables restants aujourd'hui. */
  dealUnlockRemaining: number | null;
  /** Nombre d'analyses IA restantes aujourd'hui. */
  analysisRemaining: number | null;
  /** Nombre d'exports PDF restants aujourd'hui. */
  reportExportRemaining: number | null;
};

// ─── Contexte d'accès central ─────────────────────────────────────────────────
//
// Résolu une fois par session (ou par hook) et passé aux helpers.
// C'est le seul objet que tous les composants doivent consommer.

export type AccessContext = {
  /** ID Supabase de l'utilisateur connecté. */
  userId: string | null;
  email: string | null;

  // ── Flags admin — root access ───────────────────────────────────────────
  /** Utilisateur reconnu comme administrateur. */
  isAdmin: boolean;
  /** Accès complet à toutes les features. Alias métier de isAdmin. */
  hasFullAccess: boolean;
  /** Bypass de l'abonnement — jamais bloqué par plan. */
  bypassSubscription: boolean;
  /** Bypass de la consommation de jetons — aucun jeton débité. */
  bypassTokens: boolean;
  /** Bypass de tous les quotas et cooldowns. */
  bypassLimits: boolean;

  // ── Abonnement ──────────────────────────────────────────────────────────
  plan: PlanId | null;
  subscriptionActive: boolean;

  // ── Jetons ─────────────────────────────────────────────────────────────
  tokensRemaining: number;

  // ── Quotas journaliers ──────────────────────────────────────────────────
  quotas: AccessQuotas;
};

// ─── Paywall ──────────────────────────────────────────────────────────────────

export type PaywallBlockReason =
  | "no_subscription"
  | "no_tokens"
  | "quota_exceeded"
  | "plan_insufficient"
  | null;

export type PaywallCTA = "upgrade" | "buy_tokens" | "contact_sales" | null;

export type PaywallState = {
  blocked: boolean;
  reason: PaywallBlockReason;
  cta: PaywallCTA;
  /** Message court affiché dans l'UI. */
  label: string | null;
};

// ─── Consommation ─────────────────────────────────────────────────────────────

export type ConsumeSkipReason = "admin_bypass" | "unlimited_plan" | "no_cost_feature";

export type ConsumeResult = {
  ok: boolean;
  /** Une ressource (jeton ou quota) a effectivement été consommée. */
  consumed: boolean;
  /** La consommation a été ignorée (bypass ou plan illimité). */
  skipped: boolean;
  skipReason: ConsumeSkipReason | null;
  newBalance: number | null;
  error: string | null;
};

// ─── Audit ────────────────────────────────────────────────────────────────────

export type AccessEventType =
  | "feature_access_granted"
  | "feature_access_denied"
  | "token_consumed"
  | "token_skipped"
  | "quota_consumed"
  | "quota_skipped"
  | "quota_exceeded"
  | "admin_bypass"
  | "paywall_shown";

export type AccessAuditEvent = {
  userId: string | null;
  email: string | null;
  feature: FeatureKey;
  eventType: AccessEventType;
  plan: PlanId | null;
  isAdmin: boolean;
  bypassActive: boolean;
  tokensConsumed: number;
  quotaConsumed: number;
  blockReason: PaywallBlockReason;
  metadata: Record<string, unknown>;
  timestamp: string;
};