// FILE: src/lib/supabaseClient.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Vite: variables d'env exposées côté client
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!SUPABASE_URL) {
   
  console.error("[supabaseClient] Missing VITE_SUPABASE_URL");
}
if (!SUPABASE_ANON_KEY) {
   
  console.error("[supabaseClient] Missing VITE_SUPABASE_ANON_KEY");
}

// Singleton global (évite les multiples GoTrueClient)
declare global {
   
  var __mimmoza_supabase__: SupabaseClient | undefined;
}

export const supabase: SupabaseClient =
  globalThis.__mimmoza_supabase__ ??
  createClient(SUPABASE_URL ?? "", SUPABASE_ANON_KEY ?? "", {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // PAS de storageKey custom : on garde la clé par défaut
      // (sb-<ref>-auth-token), celle où ta session de login est déjà écrite.
    },
  });

globalThis.__mimmoza_supabase__ = supabase;