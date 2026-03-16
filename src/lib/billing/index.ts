// src/lib/billing/index.ts
// ─── Moteur billing Mimmoza ───────────────────────────────────────────────────
//
// Point d'entrée unique.
// Toujours importer depuis "@/lib/billing" dans les composants et services,
// jamais depuis un sous-fichier directement.
//
// Exemple :
//
//   import {
//     PLAN_CATALOG,
//     TOKEN_PACK_CATALOG,
//     getBillingProfile,
//     getAdminBillingMetrics,
//     debitTokensForFeature,
//   } from "@/lib/billing";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type {
  PlanCode,
  TokenPackCode,
  SubscriptionStatus,
  BillingProfile,
  TokenLedgerDirection,
  TokenLedgerReason,
  TokenLedgerEntry,
  PaymentStatus,
  InvoiceType,
  InvoiceRow,
  StripeWebhookEventType,
  StripeWebhookLog,
  AdminUserBillingView,
  AdminBillingMetrics,
  BillingPriceTarget,
  StripeCheckoutMode,
  CreateCheckoutSessionInput,
  CreateCheckoutSessionResult,
  AdminBypassConsumeResult,
  AdminFeatureUsageLog,
} from "./billing.types";

// ─── Catalog ───────────────────────────────────────────────────────────────────

export {
  PLAN_CATALOG,
  TOKEN_PACK_CATALOG,
  getPlanCatalogItem,
  getTokenPackCatalogItem,
  getStripePriceIdForPlan,
  getStripePriceIdForTokenPack,
  formatCents,
} from "./catalog";

export type {
  PlanCatalogItem,
  TokenPackCatalogItem,
} from "./catalog";

// ─── Token ledger ──────────────────────────────────────────────────────────────

export {
  applyTokenLedgerEntry,
  creditTokensForPackPurchase,
  creditTokensForSubscriptionGrant,
  creditTokensForRefund,
  debitTokensForFeature,
  getTokenLedgerHistory,
  getTokenLedgerTotals,
} from "./tokenLedger";

export type {
  ApplyTokenLedgerEntryInput,
  TokenLedgerHistoryParams,
  TokenLedgerTotals,
} from "./tokenLedger";

// ─── Subscriptions / billing profiles ─────────────────────────────────────────

export {
  getBillingProfile,
  upsertBillingProfile,
  updateStripeCustomerForUser,
  updateSubscriptionStateForUser,
  clearSubscriptionForUser,
  isSubscriptionActive,
  getProfileMrrCents,
  createStripeCheckoutSession,
} from "./subscriptions";

// ─── Invoices ──────────────────────────────────────────────────────────────────

export {
  upsertInvoiceRow,
  getInvoicesByUser,
  listAllInvoices,
  getInvoiceTotalsByUser,
} from "./invoices";

export type {
  ListInvoicesParams,
  InvoiceTotalsByUser,
} from "./invoices";

// ─── Admin analytics ───────────────────────────────────────────────────────────

export {
  buildAdminUserBillingView,
  listAdminUserBilling,
  getAdminBillingMetrics,
  getTopClients,
} from "./adminAnalytics";

export type {
  ListAdminUserBillingParams,
  TopClientRow,
} from "./adminAnalytics";

// ─── Admin billing / bypass ───────────────────────────────────────────────────

export {
  tryAdminBypassConsume,
  logAdminFeatureUsage,
} from "./adminBilling";