import { supabase } from "@/lib/supabase";

export type OpportunityPillarScores = {
  discount?: number;
  seller_pressure?: number;
  liquidity?: number;
  watchlist_fit?: number;
  momentum?: number;
  data_confidence?: number;
};

export type Opportunity = {
  id: string;
  title: string | null;
  city: string | null;
  zip_code?: string | null;
  price_eur?: number | null;
  surface_m2?: number | null;
  opportunity_score?: number | null;
  opportunity_label?: string | null;
  confidence_score?: number | null;
  discount_vs_market_pct?: number | null;
  reasons?: string[] | null;
  risk_flags?: string[] | null;
  decision_hint?: string | null;
  trigger_summary?: string | null;
  pillar_scores?: OpportunityPillarScores | null;
};

export async function getUserOpportunities(): Promise<Opportunity[]> {
  const { data, error } = await supabase
    .from("opportunities")
    .select("*")
    .order("opportunity_score", { ascending: false })
    .limit(24);

  if (error) {
    console.error("opportunities error", error);
    return [];
  }

  return (data ?? []) as Opportunity[];
}