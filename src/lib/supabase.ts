// src/lib/supabase.ts
// Ré-export vers l'instance unique (src/lib/supabaseClient.ts).
// Ce module ne crée plus son propre client : il pointe sur le singleton
// global afin d'éviter les multiples GoTrueClient / sessions dédoublées.

import { supabase } from "./supabaseClient";

export { supabase };

// ─────────────────────────────────────────────────────────────
// DEV ONLY
// Expose le client dans la console — MÊME instance que le login.
// ─────────────────────────────────────────────────────────────
if (import.meta.env.DEV) {
  // @ts-ignore
  window.supabase = supabase;
}