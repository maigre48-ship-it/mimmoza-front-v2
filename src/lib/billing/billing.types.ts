// src/lib/billing/billing.types.ts

// ─── Plans ────────────────────────────────────────────────────────────────────

export type PlanCode =
  | "free"
  | "starter"
  | "pro"
  | "promoteur_starter"
  | "promoteur_pro"
  | "financeur_pro"
  | "enterprise";

// ─── Packs de jetons ──────────────────────────────────────────────────────────

export type TokenPackCode =
  | "tokens_10"
  | "tokens_20"
  | "tokens_50"
  | "tokens_100";

// ─── Abonnement ───────────────────────────────────────────────────────────────

export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "incomplete"
  | "incomplete_expired"
  | "paused";

export type BillingProfile = {
  user_id: string;
  email: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  plan_code: PlanCode;
  subscription_status: SubscriptionStatus | null;
  subscription_current_period_start: string | null;
  subscription_current_period_end: string | null;
  subscription_canceled_at: string | null;
  trial_end: string | null;
  token_balance: number;
  is_admin: boolean;
  created_at: string;
  updated_at: string;
};

// ─── Ledger jetons ────────────────────────────────────────────────────────────

export type TokenLedgerDirection = "credit" | "debit";

export type TokenLedgerReason =
  | "pack_purchase"
  | "feature_usage"
  | "admin_adjustment"
  | "promo_bonus"
  | "subscription_grant"
  | "refund_credit";

export type TokenLedgerEntry = {
  id: string;
  user_id: string;
  direction: TokenLedgerDirection;
  amount: number;
  /** Solde après mouvement (snapshot). */
  balance_after: number;
  reason: TokenLedgerReason;
  /** Clé de feature Mimmoza consommée (ex: "deal.unlock"). */
  feature_code: string | null;
  /** Référence externe : stripe_payment_intent_id, pack_code, invoice_id, etc. */
  source_ref: string | null;
  /** Métadonnées libres (deal_id, zone_key, pack_code, notes admin, etc.). */
  metadata: Record<string, unknown> | null;
  is_admin_action: boolean;
  created_at: string;
};

// ─── Ledger paiements / factures ──────────────────────────────────────────────

export type PaymentStatus =
  | "succeeded"
  | "pending"
  | "failed"
  | "refunded"
  | "partially_refunded"
  | "disputed";

export type InvoiceType =
  | "subscription"
  | "token_pack"
  | "one_time"
  | "credit_note";

export type InvoiceRow = {
  id: string;
  user_id: string;
  stripe_invoice_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_customer_id: string | null;
  invoice_type: InvoiceType;
  plan_code: PlanCode | null;
  token_pack_code: TokenPackCode | null;
  /** Montant HT en centimes (ex: 2999 = 29,99 €). */
  amount_cents: number;
  /** TVA en centimes. */
  tax_cents: number;
  /** Montant TTC = amount_cents + tax_cents. */
  total_cents: number;
  currency: string;
  status: PaymentStatus;
  invoice_pdf_url: string | null;
  invoice_hosted_url: string | null;
  period_start: string | null;
  period_end: string | null;
  paid_at: string | null;
  failed_at: string | null;
  refunded_at: string | null;
  refund_amount_cents: number;
  created_at: string;
};

// ─── Événement Stripe webhook ─────────────────────────────────────────────────

export type StripeWebhookEventType =
  | "customer.subscription.created"
  | "customer.subscription.updated"
  | "customer.subscription.deleted"
  | "invoice.paid"
  | "invoice.payment_failed"
  | "checkout.session.completed"
  | "payment_intent.succeeded"
  | "payment_intent.payment_failed"
  | "charge.refunded";

export type StripeWebhookLog = {
  id: string;
  stripe_event_id: string;
  event_type: StripeWebhookEventType;
  processed: boolean;
  error: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
};

// ─── Vue admin utilisateur ────────────────────────────────────────────────────

export type AdminUserBillingView = {
  user_id: string;
  email: string | null;
  plan_code: PlanCode;
  subscription_status: SubscriptionStatus | null;
  subscription_current_period_end: string | null;
  subscription_canceled_at: string | null;
  token_balance: number;
  tokens_total_purchased: number;
  tokens_total_consumed: number;
  total_billed_cents: number;
  total_paid_cents: number;
  mrr_cents: number;
  last_invoice_at: string | null;
  last_token_usage_at: string | null;
  is_admin: boolean;
};

// ─── Analytics global ─────────────────────────────────────────────────────────

export type AdminBillingMetrics = {
  /** Revenu mensuel récurrent en centimes. */
  mrr_cents: number;
  /** CA total (abonnements + jetons). */
  total_revenue_cents: number;
  subscription_revenue_cents: number;
  token_revenue_cents: number;
  /** Encaissements réussis sur la période / ce mois selon la requête. */
  monthly_collected_cents: number;
  /** Paiements échoués. */
  failed_payments_count: number;
  failed_payments_amount_cents: number;
  /** Remboursements. */
  refunds_count: number;
  refunds_amount_cents: number;
  /** Utilisateurs. */
  active_subscribers_count: number;
  churned_this_month_count: number;
  new_subscribers_this_month_count: number;
};

// ─── Checkout / catalog ───────────────────────────────────────────────────────

export type BillingPriceTarget =
  | { kind: "plan"; plan_code: PlanCode }
  | { kind: "token_pack"; token_pack_code: TokenPackCode };

export type StripeCheckoutMode = "subscription" | "payment";

export type CreateCheckoutSessionInput = {
  user_id: string;
  email?: string | null;
  success_url: string;
  cancel_url: string;
} & BillingPriceTarget;

export type CreateCheckoutSessionResult = {
  url: string;
  stripe_customer_id: string | null;
  mode: StripeCheckoutMode;
};

// ─── Admin bypass / usage ─────────────────────────────────────────────────────

export type AdminBypassConsumeResult = {
  skipped: true;
  reason: "admin_bypass";
  balance_after: number;
};

export type AdminFeatureUsageLog = {
  id: string;
  user_id: string;
  feature_code: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};