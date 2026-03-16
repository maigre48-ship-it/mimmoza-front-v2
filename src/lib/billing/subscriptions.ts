import { supabase } from "@/lib/supabase";
import type {
  BillingProfile,
  SubscriptionStatus,
} from "./billing.types";
import type { PlanCode } from "./billing.types";
import { getPlanEntry, planCodeFromStripePriceId } from "./catalog";

// ─── Lecture profil ───────────────────────────────────────────────────────────

export async function getBillingProfile(userId: string): Promise<BillingProfile | null> {
  const { data, error } = await supabase
    .from("billing_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return (data ?? null) as BillingProfile | null;
}

/**
 * Récupère ou crée le profil de facturation pour un utilisateur.
 * Appelé à la première connexion ou lors de l'onboarding.
 */
export async function getOrCreateBillingProfile(
  userId: string,
  email: string | null
): Promise<BillingProfile> {
  const existing = await getBillingProfile(userId);
  if (existing) return existing;

  const { data, error } = await supabase
    .from("billing_profiles")
    .insert({
      user_id: userId,
      email,
      plan_code: "free",
      subscription_status: null,
      token_balance: 2, // jetons offerts à l'inscription
      is_admin: false,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as BillingProfile;
}

// ─── Mise à jour abonnement ───────────────────────────────────────────────────

/**
 * Met à jour le profil suite à un événement Stripe subscription.
 * Appelé depuis le webhook Supabase Edge Function.
 */
export async function updateSubscriptionFromStripe(params: {
  userId: string;
  stripeSubscriptionId: string;
  stripePriceId: string;
  stripeCustomerId: string;
  status: SubscriptionStatus;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  canceledAt: string | null;
  trialEnd: string | null;
}): Promise<void> {
  const planCode = planCodeFromStripePriceId(params.stripePriceId) ?? "free";

  const { error } = await supabase
    .from("billing_profiles")
    .update({
      stripe_customer_id: params.stripeCustomerId,
      stripe_subscription_id: params.stripeSubscriptionId,
      stripe_price_id: params.stripePriceId,
      plan_code: planCode,
      subscription_status: params.status,
      subscription_current_period_start: params.currentPeriodStart,
      subscription_current_period_end: params.currentPeriodEnd,
      subscription_canceled_at: params.canceledAt,
      trial_end: params.trialEnd,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", params.userId);

  if (error) throw error;
}

/**
 * Annule localement l'abonnement (ex: subscription.deleted).
 * Le plan repasse à "free" en fin de période.
 */
export async function markSubscriptionCanceled(params: {
  userId: string;
  canceledAt: string;
}): Promise<void> {
  const { error } = await supabase
    .from("billing_profiles")
    .update({
      subscription_status: "canceled",
      subscription_canceled_at: params.canceledAt,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", params.userId);

  if (error) throw error;
}

/**
 * Downgrade vers free une fois l'abonnement expiré.
 */
export async function downgradeToPlan(userId: string, plan: PlanCode): Promise<void> {
  const { error } = await supabase
    .from("billing_profiles")
    .update({
      plan_code: plan,
      stripe_subscription_id: plan === "free" ? null : undefined,
      stripe_price_id: plan === "free" ? null : undefined,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  if (error) throw error;
}

// ─── Helpers abonnement ───────────────────────────────────────────────────────

export function isSubscriptionActive(profile: BillingProfile | null): boolean {
  if (!profile) return false;
  if (profile.plan_code === "free") return true; // free = toujours actif
  const activeStatuses: SubscriptionStatus[] = ["active", "trialing"];
  if (!activeStatuses.includes(profile.subscription_status ?? "incomplete")) return false;
  if (profile.subscription_current_period_end) {
    return new Date(profile.subscription_current_period_end) > new Date();
  }
  return false;
}

export function daysUntilRenewal(profile: BillingProfile | null): number | null {
  if (!profile?.subscription_current_period_end) return null;
  const end = new Date(profile.subscription_current_period_end);
  const now = new Date();
  const diffMs = end.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diffMs / (1_000 * 3_600 * 24)));
}

/**
 * Calcule le MRR en centimes pour un profil.
 */
export function profileMrr(profile: BillingProfile): number {
  if (!isSubscriptionActive(profile)) return 0;
  const entry = getPlanEntry(profile.plan_code);
  return entry.monthly_price_cents;
}

// ─── Checkout Stripe ──────────────────────────────────────────────────────────
//
// Ces fonctions appellent une Edge Function Supabase qui crée la session Stripe.
// L'Edge Function a accès à STRIPE_SECRET_KEY côté serveur.

export async function createCheckoutSession(params: {
  userId: string;
  priceId: string;
  mode: "subscription" | "payment";
  successUrl: string;
  cancelUrl: string;
}): Promise<{ url: string }> {
  const { data, error } = await supabase.functions.invoke("stripe-create-checkout", {
    body: params,
  });

  if (error) throw error;
  if (!data?.url) throw new Error("URL de checkout manquante dans la réponse.");
  return { url: data.url as string };
}

export async function createBillingPortalSession(params: {
  userId: string;
  returnUrl: string;
}): Promise<{ url: string }> {
  const { data, error } = await supabase.functions.invoke("stripe-billing-portal", {
    body: params,
  });

  if (error) throw error;
  if (!data?.url) throw new Error("URL du portail manquante dans la réponse.");
  return { url: data.url as string };
}