// supabase/functions/stripe-create-checkout/index.ts

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

serve(async (req: Request) => {
  const { userId, priceId, mode, successUrl, cancelUrl } = await req.json() as {
    userId: string;
    priceId: string;
    mode: "subscription" | "payment";
    successUrl: string;
    cancelUrl: string;
  };

  if (!userId || !priceId) {
    return new Response(JSON.stringify({ error: "userId et priceId requis" }), { status: 400 });
  }

  // Récupérer ou créer le customer Stripe
  const { data: profile } = await supabase
    .from("billing_profiles")
    .select("stripe_customer_id, email")
    .eq("user_id", userId)
    .maybeSingle();

  let customerId = (profile as { stripe_customer_id: string | null; email: string | null } | null)
    ?.stripe_customer_id;

  if (!customerId) {
    const email = (profile as { email: string | null } | null)?.email ?? undefined;
    const customer = await stripe.customers.create({
      email,
      metadata: { supabase_user_id: userId },
    });
    customerId = customer.id;

    // Sauvegarder le customer ID
    await supabase
      .from("billing_profiles")
      .update({ stripe_customer_id: customerId })
      .eq("user_id", userId);
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url:  cancelUrl,
    metadata:    { supabase_user_id: userId },
    ...(mode === "subscription" && {
      subscription_data: { metadata: { supabase_user_id: userId } },
    }),
  });

  return new Response(JSON.stringify({ url: session.url }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});