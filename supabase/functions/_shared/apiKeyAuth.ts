// supabase/functions/_shared/apiKeyAuth.ts
// ─────────────────────────────────────────────────────────────────────────────
// Identification des clés API Mimmoza (en-tête x-api-key ou Authorization Bearer).
//
// Rôle LIMITÉ depuis la refonte du 22/10/2026 : test du FORMAT de la clé, puis
// recherche de la clé par son EMPREINTE SHA-256. Le contrôle du quota n'a plus
// lieu ici : c'est la réservation atomique `api_reserver_credits` (portée par le
// COMPTE, pas par la clé) qui décide de l'accès et du débit.
//
// Aucun journal de la clé, de son empreinte, des en-têtes ni de la ligne lue :
// les journaux Supabase sont lisibles par toute personne ayant accès au projet.
// ─────────────────────────────────────────────────────────────────────────────

import type { ClientBase } from "./apiBase.ts";

export type CleIdentifiee = {
  id: string;
  user_id: string;
  env: "live" | "test";
};

export type ResultatAuth =
  | { ok: true; cle: CleIdentifiee }
  | { ok: false; status: 401 | 503; code: "cle_absente" | "cle_invalide" | "cle_revoquee" | "service_indisponible"; message: string };

/** Format émis par src/lib/apiKeys.ts : mk_live_ / mk_test_ + 32 alphanumériques (tolérance 20–128). */
const RE_FORMAT_CLE = /^mk_(live|test)_[A-Za-z0-9]{20,128}$/;

export function extraireCle(authorization: string | null, xApiKey: string | null): string | null {
  const x = xApiKey?.trim();
  if (x) return x;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(authorization ?? "");
  return m ? m[1] : null;
}

export function formatCleValide(cle: string): boolean {
  return RE_FORMAT_CLE.test(cle);
}

export async function empreinteSha256(texte: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texte));
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function identifierCle(
  base: ClientBase,
  authorization: string | null,
  xApiKey: string | null,
): Promise<ResultatAuth> {
  const cle = extraireCle(authorization, xApiKey);
  if (!cle) {
    return { ok: false, status: 401, code: "cle_absente", message: "Clé API manquante : en-tête « Authorization: Bearer mk_live_… » ou « x-api-key »." };
  }
  if (!formatCleValide(cle)) {
    return { ok: false, status: 401, code: "cle_invalide", message: "Clé API invalide." };
  }
  const empreinte = await empreinteSha256(cle);
  const { data, error } = await base.selectionner<{ id: string; user_id: string; env: string; revoked_at: string | null }>(
    "api_keys",
    "id,user_id,env,revoked_at",
    { secret_hash: empreinte },
    1,
  );
  if (error) {
    return { ok: false, status: 503, code: "service_indisponible", message: "Service momentanément indisponible, réessayez." };
  }
  const ligne = Array.isArray(data) ? data[0] : undefined;
  if (!ligne) return { ok: false, status: 401, code: "cle_invalide", message: "Clé API invalide." };
  if (ligne.revoked_at) return { ok: false, status: 401, code: "cle_revoquee", message: "Clé API révoquée." };
  return { ok: true, cle: { id: ligne.id, user_id: ligne.user_id, env: ligne.env === "test" ? "test" : "live" } };
}

// ── CORS de l'API publique ─────────────────────────────────────────────────

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-api-key, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Expose-Headers": "X-Credits-Cout, X-Credits-Restants, X-Request-Id, X-Response-Time, Retry-After",
  "Access-Control-Max-Age": "86400",
};
