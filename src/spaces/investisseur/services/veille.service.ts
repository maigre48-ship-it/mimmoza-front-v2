import { supabase } from "@/lib/supabase";

export type VeilleSummary = {
  user_id: string;
  active_watchlists: number;
  total_active_properties: number;
  total_alerts_last_7d: number;
  total_new_properties_last_7d: number;
  total_price_drops_last_7d: number;
  best_watchlist_id: string | null;
  best_watchlist_name: string | null;
  best_city: string | null;
  best_zip_code: string | null;
  best_normalized_address: string | null;
  best_opportunity_score: number | null;
  best_opportunity_bucket: string | null;
};

export async function getVeilleSummary(): Promise<VeilleSummary | null> {
  const { data, error } = await supabase
    .from("veille_user_summary")
    .select("*")
    .maybeSingle();

  if (error) {
    console.error("veille summary error", error);
    return null;
  }

  return data as VeilleSummary | null;
}