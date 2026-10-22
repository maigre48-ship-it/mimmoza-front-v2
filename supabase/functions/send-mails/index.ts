// supabase/functions/send-mails/index.ts
// =============================================================================
// Envoi groupé d'e-mails libres via Resend (≤ 50 par appel).
//
// 22/10/2026 — durcissement :
//   · RÉSERVÉ AUX ADMINISTRATEURS (admin_users actif ou billing_profiles.is_admin) :
//     auparavant, tout compte connecté pouvait envoyer n'importe quel message à
//     n'importe quelle adresse au nom de Mimmoza (relais ouvert). Aucun appel à
//     cette fonction n'existe dans le front.
//   · Adresse d'expédition configurable : secret EMAIL_FROM (l'ancienne valeur
//     codée en dur, notifications@mimmoza.com, reste le repli).
//   · Version texte jointe à la version HTML.
// Les e-mails de cycle de vie passent par la fonction emails-cycle-vie.
// =============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const EMAIL_FROM = (Deno.env.get("EMAIL_FROM") ?? "").trim() || "Mimmoza <notifications@mimmoza.com>";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function toHtml(message: string): string {
  return message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br />");
}

function premiereCleJson(v: string | undefined): string | null {
  if (!v) return null;
  try {
    for (const val of Object.values(JSON.parse(v) as Record<string, unknown>)) {
      if (typeof val === "string" && val) return val;
    }
  } catch { /* pas du JSON */ }
  return null;
}

function reponse(corps: unknown, status: number): Response {
  return new Response(JSON.stringify(corps), { status, headers: { "Content-Type": "application/json", ...CORS } });
}

async function estAdministrateur(req: Request): Promise<boolean> {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const url = Deno.env.get("SUPABASE_URL");
  const cle = premiereCleJson(Deno.env.get("SUPABASE_SECRET_KEYS")) ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!jwt || !url || !cle) return false;
  const db = createClient(url, cle, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error } = await db.auth.getUser(jwt);
  if (error || !auth.user) return false;
  const [{ data: a }, { data: b }] = await Promise.all([
    db.from("admin_users").select("user_id").eq("user_id", auth.user.id).eq("is_active", true).maybeSingle(),
    db.from("billing_profiles").select("is_admin").eq("user_id", auth.user.id).maybeSingle(),
  ]);
  return Boolean(a) || Boolean((b as { is_admin?: boolean } | null)?.is_admin);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    if (!(await estAdministrateur(req))) {
      return reponse({ success: false, error: "Réservé aux administrateurs." }, 403);
    }

    if (!RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY manquante.");
    }

    const { emails } = await req.json();

    if (!Array.isArray(emails) || emails.length === 0) {
      throw new Error("Aucun email à envoyer.");
    }

    if (emails.length > 50) {
      throw new Error("Maximum 50 emails par envoi.");
    }

    const results = [];

    for (const e of emails) {
      if (!e.to || !e.subject || !e.message || !e.replyTo) {
        throw new Error("Payload email incomplet.");
      }

      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: EMAIL_FROM,
          to: [e.to],
          subject: e.subject,
          html: toHtml(e.message),
          text: String(e.message),
          reply_to: e.replyTo,
        }),
      });

      const data = await resp.json();

      if (!resp.ok) {
        console.error("[MIMMOZA][SEND_MAIL_ERROR]", data);
        throw new Error(data?.message ?? "Erreur Resend.");
      }

      results.push({
        to: e.to,
        status: "sent",
        providerId: data?.id ?? null,
      });
    }

    return reponse({ success: true, results }, 200);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur inconnue.";
    return reponse({ success: false, error: msg }, 500);
  }
});
