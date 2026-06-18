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
  AdminBillingMetrics, AdminBypassConsumeResult,
  AdminFeatureUsageLog, AdminUserBillingView, BillingPriceTarget, BillingProfile, CreateCheckoutSessionInput,
  CreateCheckoutSessionResult, InvoiceRow, InvoiceType, PaymentStatus, PlanCode, StripeCheckoutMode, StripeWebhookEventType,
  StripeWebhookLog, SubscriptionStatus, TokenLedgerDirection, TokenLedgerEntry, TokenLedgerReason, TokenPackCode
} from "./billing.types";

// ─── Catalog ───────────────────────────────────────────────────────────────────

export {
  PLAN_CATALOG,
  TOKEN_PACK_CATALOG, formatCents, getPlanEntry, getTokenPackEntry
} from "./catalog";

export type {
  PlanCatalogEntry,
  TokenPackCatalogEntry
} from "./catalog";

// ─── Token ledger ──────────────────────────────────────────────────────────────

export {
  getTokenBalance, writeLedgerEntry,
  creditTokensForPackPurchase, creditTokensForSubscription, adminCreditTokens, debitTokensForFeature,
  getTokenLedgerHistory,
  getTokenLedgerSummary
} from "./tokenLedger";

export type {
  TokenLedgerSummary
} from "./tokenLedger";

// ─── Subscriptions / billing profiles ─────────────────────────────────────────

export {
  getBillingProfile, getOrCreateBillingProfile, updateSubscriptionFromStripe, markSubscriptionCanceled,
  downgradeToPlan, isSubscriptionActive, daysUntilRenewal, profileMrr,
  createCheckoutSession, createBillingPortalSession
} from "./subscriptions";

// ─── Invoices ──────────────────────────────────────────────────────────────────

export {
  getInvoices, getInvoiceById, upsertInvoiceFromStripe,
  markInvoiceRefunded, markInvoiceFailed, getUserInvoiceSummary
} from "./invoices";

export type {
  UserInvoiceSummary
} from "./invoices";

// ─── Admin analytics ───────────────────────────────────────────────────────────

export {
  buildAdminUserBillingView, getAdminBillingMetrics,
  getTopClientsByRevenue, listAdminUserBilling, listAllInvoices
} from "./adminAnalytics";

export type {
  TopClientRow
} from "./adminAnalytics";

// ─── Admin billing / bypass ───────────────────────────────────────────────────

export {
  buildAdminBypassConsumeResult, isAdminBypassActive,
  tryAdminBypassConsume, tryAdminBypassQuota, logAdminFeatureUsage
} from "./adminBilling";
