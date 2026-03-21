// src/lib/apiKeys.ts
// ─────────────────────────────────────────────────────────────────────────────
// Service layer — gestion des clés API Mimmoza via Supabase
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from "./supabase";

// ── Types ──────────────────────────────────────────────────────────────────

export type ApiKeyEnv = "live" | "test";

export type ApiKey = {
  id: string;
  user_id: string;
  name: string;
  prefix: string;         // ex: "mk_live_AbCd"
  env: ApiKeyEnv;
  plan: "starter" | "pro" | "enterprise";
  requests_count: number;
  requests_limit: number;
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
};

export type ApiUsageDay = {
  date: string;           // ISO date "2026-03-01"
  requests: number;
  errors: number;
};

export type CreateApiKeyInput = {
  name: string;
  env: ApiKeyEnv;
};

export type CreateApiKeyResult = {
  key: ApiKey;
  secret: string;         // affiché UNE seule fois — "mk_live_xxxxxxxxxxxxxxxx"
};

// ── Helpers ────────────────────────────────────────────────────────────────

function generateSecret(env: ApiKeyEnv): string {
  const prefix = env === "live" ? "mk_live_" : "mk_test_";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let rand = "";
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  for (const byte of array) {
    rand += chars[byte % chars.length];
  }
  return `${prefix}${rand}`;
}

async function hashSecret(secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(secret);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── API ────────────────────────────────────────────────────────────────────

/**
 * Crée une nouvelle clé API pour l'utilisateur connecté.
 * Retourne la clé en clair UNE SEULE FOIS — à stocker côté client immédiatement.
 */
export async function createApiKey(
  input: CreateApiKeyInput
): Promise<CreateApiKeyResult> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) throw new Error("Non authentifié");

  const secret = generateSecret(input.env);
  const hash = await hashSecret(secret);
  // prefix = 12 premiers caractères pour l'affichage (ex: "mk_live_AbCd")
  const prefix = secret.slice(0, 12);

  const { data, error } = await supabase
    .from("api_keys")
    .insert({
      user_id: user.id,
      name: input.name,
      prefix,
      secret_hash: hash,
      env: input.env,
      plan: "starter",
      requests_count: 0,
      requests_limit: 10_000,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  return { key: data as ApiKey, secret };
}

/**
 * Liste toutes les clés actives (non révoquées) de l'utilisateur connecté.
 */
export async function listApiKeys(): Promise<ApiKey[]> {
  const { data, error } = await supabase
    .from("api_keys")
    .select("*")
    .is("revoked_at", null)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as ApiKey[];
}

/**
 * Révoque une clé API (soft delete via revoked_at).
 */
export async function revokeApiKey(keyId: string): Promise<void> {
  const { error } = await supabase
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", keyId);

  if (error) throw new Error(error.message);
}

/**
 * Récupère les 30 derniers jours d'utilisation pour une clé donnée.
 */
export async function getApiKeyUsage(keyId: string): Promise<ApiUsageDay[]> {
  const since = new Date();
  since.setDate(since.getDate() - 30);

  const { data, error } = await supabase
    .from("api_usage_logs")
    .select("date, requests, errors")
    .eq("api_key_id", keyId)
    .gte("date", since.toISOString().slice(0, 10))
    .order("date", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as ApiUsageDay[];
}

/**
 * Récupère l'usage agrégé du mois en cours pour toutes les clés de l'utilisateur.
 */
export async function getMonthlyUsage(): Promise<{
  requests: number;
  limit: number;
  percent: number;
}> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { requests: 0, limit: 10_000, percent: 0 };

  const firstOfMonth = new Date();
  firstOfMonth.setDate(1);
  firstOfMonth.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from("api_usage_logs")
    .select("requests, api_keys!inner(user_id, requests_limit)")
    .eq("api_keys.user_id", user.id)
    .gte("date", firstOfMonth.toISOString().slice(0, 10));

  if (error || !data) return { requests: 0, limit: 10_000, percent: 0 };

  const requests = data.reduce((sum, row) => sum + (row.requests ?? 0), 0);
  const limit = (data[0] as any)?.api_keys?.requests_limit ?? 10_000;
  return {
    requests,
    limit,
    percent: Math.min(100, Math.round((requests / limit) * 100)),
  };
}