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
  TOKEN_PACK_CATALOG, formatCents, getPlanCatalogItem, getStripePriceIdForPlan,
  getStripePriceIdForTokenPack, getTokenPackCatalogItem
} from "./catalog";

export type {
  PlanCatalogItem,
  TokenPackCatalogItem
} from "./catalog";

// ─── Token ledger ──────────────────────────────────────────────────────────────

export {
  applyTokenLedgerEntry,
  creditTokensForPackPurchase, creditTokensForRefund, creditTokensForSubscriptionGrant, debitTokensForFeature,
  getTokenLedgerHistory,
  getTokenLedgerTotals
} from "./tokenLedger";

export type {
  ApplyTokenLedgerEntryInput,
  TokenLedgerHistoryParams,
  TokenLedgerTotals
} from "./tokenLedger";

// ─── Subscriptions / billing profiles ─────────────────────────────────────────

export {
  clearSubscriptionForUser, createStripeCheckoutSession, getBillingProfile, getProfileMrrCents, isSubscriptionActive, updateStripeCustomerForUser,
  updateSubscriptionStateForUser, upsertBillingProfile
} from "./subscriptions";

// ─── Invoices ──────────────────────────────────────────────────────────────────

export {
  getInvoiceTotalsByUser, getInvoicesByUser,
  listAllInvoices, upsertInvoiceRow
} from "./invoices";

export type {
  InvoiceTotalsByUser, ListInvoicesParams
} from "./invoices";

// ─── Admin analytics ───────────────────────────────────────────────────────────

export {
  buildAdminUserBillingView, getAdminBillingMetrics,
  getTopClients, listAdminUserBilling
} from "./adminAnalytics";

export type {
  ListAdminUserBillingParams,
  TopClientRow
} from "./adminAnalytics";

// ─── Admin billing / bypass ───────────────────────────────────────────────────

export {
  logAdminFeatureUsage, tryAdminBypassConsume
} from "./adminBilling";
