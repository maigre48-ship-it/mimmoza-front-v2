// FILE: src/lib/supabaseClient.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Vite: variables d'env exposées côté client
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!SUPABASE_URL) {
  // eslint-disable-next-line no-console
  console.error("[supabaseClient] Missing VITE_SUPABASE_URL");
}
if (!SUPABASE_ANON_KEY) {
  // eslint-disable-next-line no-console
  console.error("[supabaseClient] Missing VITE_SUPABASE_ANON_KEY");
}

// Singleton global (évite les multiples GoTrueClient)
declare global {
  // eslint-disable-next-line no-var
  var __mimmoza_supabase__: SupabaseClient | undefined;
}

export const supabase: SupabaseClient =
  globalThis.__mimmoza_supabase__ ??
  createClient(SUPABASE_URL ?? "", SUPABASE_ANON_KEY ?? "", {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: "mimmoza.auth.token.v1", // évite collisions si plusieurs apps
    },
  });

globalThis.__mimmoza_supabase__ = supabase;
