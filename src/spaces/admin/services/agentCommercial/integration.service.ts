// src/spaces/admin/services/agentCommercial/integration.service.ts
// ─────────────────────────────────────────────────────────────────────────────
// Client des Edge Functions d'intégration Google. Le front ne lit JAMAIS les
// jetons : il passe par ces fonctions qui ne renvoient que l'état. Pattern d'appel
// identique à generateEmail (Bearer <access_token> + apikey).
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from "@/lib/supabase";
import type { CommercialIntegrationStatus } from "@/spaces/admin/types/agentCommercial.types";

function functionsBaseUrl(): string {
  const url = import.meta.env.VITE_SUPABASE_URL;
  if (!url) throw new Error("VITE_SUPABASE_URL manquant.");
  return `${url}/functions/v1`;
}

async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Session expirée. Reconnecte-toi.");

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (anon) headers["apikey"] = anon;

  const res = await fetch(`${functionsBaseUrl()}/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const json = (await res.json().catch(() => null)) as
    | (Record<string, unknown> & { error?: { message?: string } })
    | null;

  if (!res.ok || !json) {
    throw new Error(json?.error?.message ?? `Erreur ${res.status}`);
  }
  return json as T;
}

/** Démarre le flux OAuth : renvoie l'URL de consentement Google à ouvrir. */
export async function startGoogleOAuth(): Promise<string> {
  const json = await callFunction<{ url: string }>("agent-commercial-oauth-start", {});
  return json.url;
}

/** État de connexion (sans aucun jeton). */
export async function getIntegrationStatus(): Promise<CommercialIntegrationStatus> {
  return callFunction<CommercialIntegrationStatus>("agent-commercial-integration-status", {
    action: "status",
  });
}

/** Déconnecte Google (révoque le jeton côté serveur). */
export async function disconnectGoogle(): Promise<CommercialIntegrationStatus> {
  return callFunction<CommercialIntegrationStatus>("agent-commercial-integration-status", {
    action: "disconnect",
  });
}
