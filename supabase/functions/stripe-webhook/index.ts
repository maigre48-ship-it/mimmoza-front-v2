// supabase/functions/stripe-webhook/index.ts
//
// Edge Function Supabase qui reçoit les webhooks Stripe et orchestre
// la mise à jour de billing_profiles, token_ledger et billing_invoices.
//
// Variables d'environnement requises :
//   STRIPE_SECRET_KEY        — clé secrète Stripe
//   STRIPE_WEBHOOK_SECRET    — secret du endpoint webhook Stripe
//   SUPABASE_URL             — URL du projet
//   SUPABASE_SERVICE_ROLE_KEY — clé service role (accès total sans RLS)

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  apiVersion: "2024-06-20",
  httpClient: Stripe.createFetchHttpClient(),
});

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";

// ─── Catalogue local (dupliqué pour éviter les imports circulaires) ───────────

const PLAN_PRICE_MAP: Record<string, string> = {
  price_starter_monthly_REPLACE: "starter",
  price_starter_annual_REPLACE: "starter",
  price_pro_monthly_REPLACE: "pro",
  price_pro_annual_REPLACE: "pro",
  price_promo_starter_monthly_REPLACE: "promoteur_starter",
  price_promo_starter_annual_REPLACE: "promoteur_starter",
  price_promo_pro_monthly_REPLACE: "promoteur_pro",
  price_promo_pro_annual_REPLACE: "promoteur_pro",
  price_financeur_pro_monthly_REPLACE: "financeur_pro",
  price_financeur_pro_annual_REPLACE: "financeur_pro",
};

const TOKEN_PACK_MAP: Record<string, { code: string; tokens: number }> = {
  price_tokens_10_REPLACE:  { code: "tokens_10",  tokens: 10  },
  price_tokens_20_REPLACE:  { code: "tokens_20",  tokens: 20  },
  price_tokens_50_REPLACE:  { code: "tokens_50",  tokens: 50  },
  price_tokens_100_REPLACE: { code: "tokens_100", tokens: 100 },
};

const PLAN_INCLUDED_TOKENS: Record<string, number> = {
  starter: 10, pro: 25, promoteur_starter: 15,
  promoteur_pro: 50, financeur_pro: 100, enterprise: 999,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function resolveUserIdFromCustomer(stripeCustomerId: string): Promise<string | null> {
  const { data } = await supabase
    .from("billing_profiles")
    .select("user_id")
    .eq("stripe_customer_id", stripeCustomerId)
    .maybeSingle();
  return (data as { user_id: string } | null)?.user_id ?? null;
}

async function applyTokenLedgerEntry(params: {
  userId: string;
  direction: "credit" | "debit";
  amount: number;
  reason: string;
  sourceRef: string | null;
  metadata: Record<string, unknown>;
}): Promise<void> {
  const { error } = await supabase.rpc("apply_token_ledger_entry", {
    p_user_id:         params.userId,
    p_direction:       params.direction,
    p_amount:          params.amount,
    p_reason:          params.reason,
    p_source_ref:      params.sourceRef,
    p_metadata:        params.metadata,
    p_is_admin_action: false,
  });
  if (error) throw error;
}

async function logWebhookEvent(
  stripeEventId: string,
  eventType: string,
  payload: unknown,
  error?: string
): Promise<void> {
  await supabase.from("stripe_webhook_logs").upsert(
    {
      stripe_event_id: stripeEventId,
      event_type:      eventType,
      processed:       !error,
      error:           error ?? null,
      payload,
    },
    { onConflict: "stripe_event_id" }
  );
}

// ─── Handlers par type d'événement ───────────────────────────────────────────

async function handleSubscriptionUpsert(sub: Stripe.Subscription): Promise<void> {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const userId = await resolveUserIdFromCustomer(customerId);
  if (!userId) throw new Error(`user introuvable pour customer ${customerId}`);

  const priceId = sub.items.data[0]?.price.id ?? "";
  const planCode = PLAN_PRICE_MAP[priceId] ?? "free";

  await supabase.from("billing_profiles").update({
    stripe_customer_id:                customerId,
    stripe_subscription_id:            sub.id,
    stripe_price_id:                   priceId,
    plan_code:                         planCode,
    subscription_status:               sub.status,
    subscription_current_period_start: new Date(sub.current_period_start * 1000).toISOString(),
    subscription_current_period_end:   new Date(sub.current_period_end   * 1000).toISOString(),
    subscription_canceled_at:          sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : null,
    trial_end:                         sub.trial_end   ? new Date(sub.trial_end   * 1000).toISOString() : null,
    updated_at:                        new Date().toISOString(),
  }).eq("user_id", userId);

  // Créditer les jetons inclus à la première activation
  if (sub.status === "active" && planCode !== "free") {
    const included = PLAN_INCLUDED_TOKENS[planCode] ?? 0;
    if (included > 0) {
      await applyTokenLedgerEntry({
        userId,
        direction:  "credit",
        amount:     included,
        reason:     "subscription_grant",
        sourceRef:  sub.id,
        metadata:   { plan_code: planCode },
      });
    }
  }
}

async function handleSubscriptionDeleted(sub: Stripe.Subscription): Promise<void> {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const userId = await resolveUserIdFromCustomer(customerId);
  if (!userId) return;

  await supabase.from("billing_profiles").update({
    subscription_status:      "canceled",
    subscription_canceled_at: new Date().toISOString(),
    plan_code:                "free",
    updated_at:               new Date().toISOString(),
  }).eq("user_id", userId);
}

async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id ?? "";
  const userId = await resolveUserIdFromCustomer(customerId);
  if (!userId) throw new Error(`user introuvable pour customer ${customerId}`);

  const priceId = invoice.lines.data[0]?.price?.id ?? "";
  const isPack = priceId in TOKEN_PACK_MAP;
  const packInfo = isPack ? TOKEN_PACK_MAP[priceId] : null;

  const invoiceType = isPack ? "token_pack" : "subscription";
  const planCode = !isPack ? (PLAN_PRICE_MAP[priceId] ?? null) : null;

  // Enregistrer la facture
  await supabase.from("billing_invoices").upsert({
    user_id:                  userId,
    stripe_invoice_id:        invoice.id,
    stripe_payment_intent_id: typeof invoice.payment_intent === "string" ? invoice.payment_intent : null,
    stripe_customer_id:       customerId,
    invoice_type:             invoiceType,
    plan_code:                planCode,
    token_pack_code:          packInfo?.code ?? null,
    amount_cents:             invoice.subtotal,
    tax_cents:                invoice.tax ?? 0,
    total_cents:              invoice.total,
    currency:                 invoice.currency,
    status:                   "succeeded",
    invoice_pdf_url:          invoice.invoice_pdf,
    invoice_hosted_url:       invoice.hosted_invoice_url,
    period_start:             invoice.period_start ? new Date(invoice.period_start * 1000).toISOString() : null,
    period_end:               invoice.period_end   ? new Date(invoice.period_end   * 1000).toISOString() : null,
    paid_at:                  new Date().toISOString(),
  }, { onConflict: "stripe_invoice_id" });

  // Si achat de pack : créditer les jetons
  if (packInfo) {
    await applyTokenLedgerEntry({
      userId,
      direction:  "credit",
      amount:     packInfo.tokens,
      reason:     "pack_purchase",
      sourceRef:  typeof invoice.payment_intent === "string" ? invoice.payment_intent : null,
      metadata:   { pack_code: packInfo.code, invoice_id: invoice.id },
    });
  }
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  if (!invoice.id) return;

  await supabase.from("billing_invoices").upsert({
    stripe_invoice_id: invoice.id,
    status:            "failed",
    failed_at:         new Date().toISOString(),
  }, { onConflict: "stripe_invoice_id" });

  // Marquer past_due sur l'abonnement
  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id ?? "";
  const userId = await resolveUserIdFromCustomer(customerId);
  if (userId) {
    await supabase.from("billing_profiles").update({
      subscription_status: "past_due",
      updated_at:          new Date().toISOString(),
    }).eq("user_id", userId);
  }
}

async function handleChargeRefunded(charge: Stripe.Charge): Promise<void> {
  const amountRefunded = charge.amount_refunded;
  if (!amountRefunded) return;

  // Retrouver la facture via payment_intent
  const piId = typeof charge.payment_intent === "string" ? charge.payment_intent : null;
  if (!piId) return;

  await supabase.from("billing_invoices").update({
    status:               amountRefunded < charge.amount ? "partially_refunded" : "refunded",
    refund_amount_cents:  amountRefunded,
    refunded_at:          new Date().toISOString(),
  }).eq("stripe_payment_intent_id", piId);
}

// ─── Handler principal ────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const body        = await req.text();
  const signature   = req.headers.get("stripe-signature") ?? "";

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, WEBHOOK_SECRET);
  } catch (err) {
    console.error("[stripe-webhook] signature invalide:", err);
    return new Response("Webhook signature verification failed", { status: 400 });
  }

  // Idempotence : ignorer les événements déjà traités
  const { data: existing } = await supabase
    .from("stripe_webhook_logs")
    .select("processed")
    .eq("stripe_event_id", event.id)
    .maybeSingle();

  if (existing && (existing as { processed: boolean }).processed) {
    return new Response(JSON.stringify({ ok: true, skipped: true }), { status: 200 });
  }

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
        await handleSubscriptionUpsert(event.data.object as Stripe.Subscription);
        break;

      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      case "invoice.paid":
        await handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;

      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      case "charge.refunded":
        await handleChargeRefunded(event.data.object as Stripe.Charge);
        break;

      default:
        console.log(`[stripe-webhook] événement non géré: ${event.type}`);
    }

    await logWebhookEvent(event.id, event.type, event.data.object);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[stripe-webhook] erreur sur ${event.type}:`, message);
    await logWebhookEvent(event.id, event.type, event.data.object, message);
    return new Response(JSON.stringify({ ok: false, error: message }), { status: 500 });
  }
});