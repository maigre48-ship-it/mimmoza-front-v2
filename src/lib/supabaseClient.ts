// src/lib/supabaseClient.ts
import { createClient } from "@supabase/supabase-js";

const DEFAULT_REMOTE_URL = "https://fwvrqngbafqdaekbdfnm.supabase.co";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || DEFAULT_REMOTE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

export { SUPABASE_URL, SUPABASE_ANON_KEY };