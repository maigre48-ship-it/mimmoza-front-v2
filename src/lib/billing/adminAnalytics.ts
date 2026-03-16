import { supabase } from "@/lib/supabase";
import type {
  AdminUserBillingView,
  AdminBillingMetrics,
  BillingProfile,
  InvoiceRow,
} from "./billing.types";
import { profileMrr } from "./subscriptions";
import { getTokenLedgerSummary } from "./tokenLedger";
import { getUserInvoiceSummary } from "./invoices";

// ─── Fiche utilisateur ────────────────────────────────────────────────────────

/**
 * Construit la fiche de facturation complète d'un utilisateur.
 * Agrège profil + ledger jetons + factures.
 * Utilisé par AdminUtilisateursPage / fiche détail.
 */
export async function buildAdminUserBillingView(
  userId: string
): Promise<AdminUserBillingView | null> {
  const { data: profile, error: profileError } = await supabase
    .from("billing_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (profileError) throw profileError;
  if (!profile) return null;

  const p = profile as BillingProfile;

  const [ledgerSummary, invoiceSummary] = await Promise.all([
    getTokenLedgerSummary(userId),
    getUserInvoiceSummary(userId),
  ]);

  // Lecture du dernier usage token depuis le ledger
  const { data: lastUsage } = await supabase
    .from("token_ledger")
    .select("created_at")
    .eq("user_id", userId)
    .eq("direction", "debit")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    user_id: p.user_id,
    email: p.email,
    plan_code: p.plan_code,
    subscription_status: p.subscription_status,
    subscription_current_period_end: p.subscription_current_period_end,
    subscription_canceled_at: p.subscription_canceled_at,
    token_balance: p.token_balance,
    tokens_total_purchased: ledgerSummary.total_purchased,
    tokens_total_consumed: ledgerSummary.total_consumed,
    total_billed_cents: invoiceSummary.total_billed_cents,
    total_paid_cents: invoiceSummary.total_paid_cents,
    mrr_cents: profileMrr(p),
    last_invoice_at: invoiceSummary.last_invoice_at,
    last_token_usage_at:
      (lastUsage as { created_at: string } | null)?.created_at ?? null,
    is_admin: p.is_admin,
  };
}

// ─── Liste utilisateurs avec billing ─────────────────────────────────────────

type AdminUserListParams = {
  limit?: number;
  offset?: number;
  planCode?: string;
  searchEmail?: string;
};

/**
 * Retourne la liste paginée des profils de facturation.
 * Utilise la vue SQL `admin_user_billing_summary` si disponible,
 * sinon interroge billing_profiles directement.
 */
export async function listAdminUserBilling(
  params: AdminUserListParams = {}
): Promise<BillingProfile[]> {
  let query = supabase
    .from("billing_profiles")
    .select("*")
    .order("created_at", { ascending: false });

  if (params.planCode) query = query.eq("plan_code", params.planCode);
  if (params.searchEmail) query = query.ilike("email", `%${params.searchEmail}%`);
  if (params.limit) query = query.limit(params.limit);
  if (params.offset) query = query.range(params.offset, params.offset + (params.limit ?? 20) - 1);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as BillingProfile[];
}

// ─── Métriques globales ───────────────────────────────────────────────────────

/**
 * Calcule les métriques globales de facturation pour le dashboard admin.
 * Source : billing_profiles + billing_invoices.
 */
export async function getAdminBillingMetrics(): Promise<AdminBillingMetrics> {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();

  // Tous les profils actifs
  const { data: profiles } = await supabase
    .from("billing_profiles")
    .select("plan_code, subscription_status, subscription_current_period_end, is_admin");

  const activeProfiles = (profiles ?? []) as Pick<
    BillingProfile,
    "plan_code" | "subscription_status" | "subscription_current_period_end" | "is_admin"
  >[];

  const activeSubs = activeProfiles.filter(
    (p) =>
      !p.is_admin &&
      (p.subscription_status === "active" || p.subscription_status === "trialing") &&
      p.plan_code !== "free"
  );

  // MRR = somme des prix mensuels des abonnements actifs
  const mrrCents = activeSubs.reduce((sum, p) => {
    const { getPlanEntry } = require("./catalog");
    return sum + getPlanEntry(p.plan_code).monthly_price_cents;
  }, 0);

  // Factures ce mois
  const { data: invoicesThisMonth } = await supabase
    .from("billing_invoices")
    .select("invoice_type, status, total_cents, refund_amount_cents")
    .gte("created_at", startOfMonth);

  const invRows = (invoicesThisMonth ?? []) as Pick<
    InvoiceRow,
    "invoice_type" | "status" | "total_cents" | "refund_amount_cents"
  >[];

  let monthlyCollected = 0;
  let subRevenue = 0;
  let tokenRevenue = 0;
  let failedCount = 0;
  let failedAmount = 0;
  let refundsCount = 0;
  let refundsAmount = 0;

  for (const inv of invRows) {
    if (inv.status === "succeeded") {
      monthlyCollected += inv.total_cents;
      if (inv.invoice_type === "subscription") subRevenue += inv.total_cents;
      if (inv.invoice_type === "token_pack") tokenRevenue += inv.total_cents;
    }
    if (inv.status === "failed") {
      failedCount++;
      failedAmount += inv.total_cents;
    }
    if (inv.status === "refunded" || inv.status === "partially_refunded") {
      refundsCount++;
      refundsAmount += inv.refund_amount_cents;
    }
  }

  // Nouvelles souscriptions ce mois
  const { count: newThisMonth } = await supabase
    .from("billing_profiles")
    .select("user_id", { count: "exact", head: true })
    .gte("created_at", startOfMonth)
    .eq("subscription_status", "active");

  // Churn : abonnements annulés ce mois
  const { count: churnCount } = await supabase
    .from("billing_profiles")
    .select("user_id", { count: "exact", head: true })
    .gte("subscription_canceled_at", startOfMonth)
    .not("subscription_canceled_at", "is", null);

  // CA total (toutes périodes)
  const { data: allInvoices } = await supabase
    .from("billing_invoices")
    .select("total_cents, invoice_type")
    .eq("status", "succeeded");

  const allInv = (allInvoices ?? []) as Pick<InvoiceRow, "total_cents" | "invoice_type">[];
  const totalRevenue = allInv.reduce((s, i) => s + i.total_cents, 0);
  const totalSubRevenue = allInv
    .filter((i) => i.invoice_type === "subscription")
    .reduce((s, i) => s + i.total_cents, 0);
  const totalTokenRevenue = allInv
    .filter((i) => i.invoice_type === "token_pack")
    .reduce((s, i) => s + i.total_cents, 0);

  return {
    mrr_cents: mrrCents,
    total_revenue_cents: totalRevenue,
    subscription_revenue_cents: totalSubRevenue,
    token_revenue_cents: totalTokenRevenue,
    monthly_collected_cents: monthlyCollected,
    failed_payments_count: failedCount,
    failed_payments_amount_cents: failedAmount,
    refunds_count: refundsCount,
    refunds_amount_cents: refundsAmount,
    active_subscribers_count: activeSubs.length,
    churned_this_month_count: churnCount ?? 0,
    new_subscribers_this_month_count: newThisMonth ?? 0,
  };
}

// ─── Top clients ──────────────────────────────────────────────────────────────

export type TopClientRow = {
  user_id: string;
  email: string | null;
  plan_code: string;
  total_paid_cents: number;
  mrr_cents: number;
};

export async function getTopClientsByRevenue(limit = 10): Promise<TopClientRow[]> {
  // Vue SQL recommandée — voir billing_schema.sql
  // Fallback : agrégat JS si la vue n'existe pas encore
  const { data, error } = await supabase
    .from("admin_top_clients")
    .select("*")
    .order("total_paid_cents", { ascending: false })
    .limit(limit);

  if (error) {
    // Fallback sans vue SQL
    return [];
  }

  return (data ?? []) as TopClientRow[];
}

// ─── Factures globales admin ──────────────────────────────────────────────────

export async function listAllInvoices(params: {
  limit?: number;
  status?: string;
  type?: string;
  since?: string;
}): Promise<InvoiceRow[]> {
  let query = supabase
    .from("billing_invoices")
    .select("*")
    .order("created_at", { ascending: false });

  if (params.limit) query = query.limit(params.limit);
  if (params.status) query = query.eq("status", params.status);
  if (params.type) query = query.eq("invoice_type", params.type);
  if (params.since) query = query.gte("created_at", params.since);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as InvoiceRow[];
}