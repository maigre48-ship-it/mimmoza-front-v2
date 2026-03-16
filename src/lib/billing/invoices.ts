import { supabase } from "@/lib/supabase";
import type { InvoiceRow, InvoiceType, PaymentStatus } from "./billing.types";
import type { PlanCode, TokenPackCode } from "./billing.types";

// ─── Lecture ──────────────────────────────────────────────────────────────────

export async function getInvoices(params: {
  userId: string;
  limit?: number;
  status?: PaymentStatus;
  type?: InvoiceType;
}): Promise<InvoiceRow[]> {
  let query = supabase
    .from("billing_invoices")
    .select("*")
    .eq("user_id", params.userId)
    .order("created_at", { ascending: false });

  if (params.limit) query = query.limit(params.limit);
  if (params.status) query = query.eq("status", params.status);
  if (params.type) query = query.eq("invoice_type", params.type);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as InvoiceRow[];
}

export async function getInvoiceById(id: string): Promise<InvoiceRow | null> {
  const { data, error } = await supabase
    .from("billing_invoices")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return (data ?? null) as InvoiceRow | null;
}

// ─── Création / synchronisation depuis webhook ───────────────────────────────

/**
 * Inscrit ou met à jour une facture Stripe en base.
 * Appelé depuis la Supabase Edge Function de webhook Stripe.
 */
export async function upsertInvoiceFromStripe(params: {
  userId: string;
  stripeInvoiceId: string;
  stripePaymentIntentId: string | null;
  stripeCustomerId: string;
  invoiceType: InvoiceType;
  planCode: PlanCode | null;
  tokenPackCode: TokenPackCode | null;
  amountCents: number;
  taxCents: number;
  currency: string;
  status: PaymentStatus;
  invoicePdfUrl: string | null;
  invoiceHostedUrl: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  paidAt: string | null;
  failedAt: string | null;
}): Promise<InvoiceRow> {
  const totalCents = params.amountCents + params.taxCents;

  const { data, error } = await supabase
    .from("billing_invoices")
    .upsert(
      {
        user_id: params.userId,
        stripe_invoice_id: params.stripeInvoiceId,
        stripe_payment_intent_id: params.stripePaymentIntentId,
        stripe_customer_id: params.stripeCustomerId,
        invoice_type: params.invoiceType,
        plan_code: params.planCode,
        token_pack_code: params.tokenPackCode,
        amount_cents: params.amountCents,
        tax_cents: params.taxCents,
        total_cents: totalCents,
        currency: params.currency,
        status: params.status,
        invoice_pdf_url: params.invoicePdfUrl,
        invoice_hosted_url: params.invoiceHostedUrl,
        period_start: params.periodStart,
        period_end: params.periodEnd,
        paid_at: params.paidAt,
        failed_at: params.failedAt,
        refund_amount_cents: 0,
      },
      { onConflict: "stripe_invoice_id" }
    )
    .select("*")
    .single();

  if (error) throw error;
  return data as InvoiceRow;
}

/** Marque une facture comme remboursée. */
export async function markInvoiceRefunded(params: {
  stripeInvoiceId: string;
  refundAmountCents: number;
  refundedAt: string;
}): Promise<void> {
  const partial = params.refundAmountCents > 0;

  const { error } = await supabase
    .from("billing_invoices")
    .update({
      status: partial ? "partially_refunded" : "refunded",
      refund_amount_cents: params.refundAmountCents,
      refunded_at: params.refundedAt,
    })
    .eq("stripe_invoice_id", params.stripeInvoiceId);

  if (error) throw error;
}

/** Marque une facture comme échouée. */
export async function markInvoiceFailed(params: {
  stripeInvoiceId: string;
  failedAt: string;
}): Promise<void> {
  const { error } = await supabase
    .from("billing_invoices")
    .update({ status: "failed", failed_at: params.failedAt })
    .eq("stripe_invoice_id", params.stripeInvoiceId);

  if (error) throw error;
}

// ─── Agrégats par utilisateur ─────────────────────────────────────────────────

export type UserInvoiceSummary = {
  total_billed_cents: number;
  total_paid_cents: number;
  total_refunded_cents: number;
  subscription_revenue_cents: number;
  token_revenue_cents: number;
  failed_count: number;
  last_invoice_at: string | null;
};

export async function getUserInvoiceSummary(userId: string): Promise<UserInvoiceSummary> {
  const { data, error } = await supabase
    .from("billing_invoices")
    .select("invoice_type, status, total_cents, refund_amount_cents, created_at")
    .eq("user_id", userId);

  if (error) throw error;

  const rows = (data ?? []) as {
    invoice_type: InvoiceType;
    status: PaymentStatus;
    total_cents: number;
    refund_amount_cents: number;
    created_at: string;
  }[];

  let totalBilled = 0;
  let totalPaid = 0;
  let totalRefunded = 0;
  let subRevenue = 0;
  let tokenRevenue = 0;
  let failedCount = 0;
  let lastAt: string | null = null;

  for (const row of rows) {
    totalBilled += row.total_cents;
    if (row.status === "succeeded") {
      totalPaid += row.total_cents;
      if (row.invoice_type === "subscription") subRevenue += row.total_cents;
      if (row.invoice_type === "token_pack") tokenRevenue += row.total_cents;
    }
    if (row.status === "refunded" || row.status === "partially_refunded") {
      totalRefunded += row.refund_amount_cents;
    }
    if (row.status === "failed") failedCount++;
    if (!lastAt || row.created_at > lastAt) lastAt = row.created_at;
  }

  return {
    total_billed_cents: totalBilled,
    total_paid_cents: totalPaid,
    total_refunded_cents: totalRefunded,
    subscription_revenue_cents: subRevenue,
    token_revenue_cents: tokenRevenue,
    failed_count: failedCount,
    last_invoice_at: lastAt,
  };
}