// Ré-export vers l'instance unique (src/lib/supabaseClient.ts).
// Évite les multiples GoTrueClient / sessions dédoublées.
export { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "./lib/supabaseClient";