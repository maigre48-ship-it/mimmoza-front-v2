// src/spaces/admin/services/agentCommercial/generateEmail.ts
// ─────────────────────────────────────────────────────────────────────────────
// Client de l'Edge Function agent-commercial-generate.
// Pattern d'appel calqué sur src/spaces/copilot/lib/copilotClient.ts :
// Authorization: Bearer <access_token> + header apikey. verify_jwt = OFF côté
// fonction, mais on transmet quand même le JWT (requireAdmin le vérifie).
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from "@/lib/supabase";
import type { EmailKind } from "@/spaces/admin/types/agentCommercial.types";

export interface GeneratedEmailResult {
  id: string;
  status: string;
  subject: string;
  body: string;
  internal_rationale: string;
  recommended_status: string | null;
  recommended_next_action: string | null;
  ai_model: string;
  tokens_in: number | null;
  tokens_out: number | null;
}

function functionsBaseUrl(): string {
  const url = import.meta.env.VITE_SUPABASE_URL;
  if (!url) throw new Error("VITE_SUPABASE_URL manquant.");
  return `${url}/functions/v1`;
}

export async function generateEmail(
  prospectId: string,
  kind: EmailKind,
): Promise<GeneratedEmailResult> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Session expirée. Reconnecte-toi.");

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (anon) headers["apikey"] = anon;

  const res = await fetch(`${functionsBaseUrl()}/agent-commercial-generate`, {
    method: "POST",
    headers,
    body: JSON.stringify({ prospect_id: prospectId, kind }),
  });

  const json = (await res.json().catch(() => null)) as
    | { ok?: boolean; email?: GeneratedEmailResult; error?: { code?: string; message?: string } }
    | null;

  if (!res.ok || !json?.email) {
    const message = json?.error?.message ?? `Erreur ${res.status}`;
    throw new Error(message);
  }

  return json.email;
}
