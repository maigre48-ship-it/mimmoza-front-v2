// src/spaces/particulier/quartier/quartierApi.ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type QuartierRequest = {
  surface_m2?: number | null;
  prix?: number | null;
  type_local?: string | null;
  parcel_id?: string | null;
  commune_insee?: string | number | null;
  address?: string | null;
  cp?: string | null;
  ville?: string | null;

  radius_km?: number;
  horizon_months?: number;
  debug?: boolean;
};

export type QuartierResponse = {
  success: boolean;
  version?: string;
  orchestrator?: string;
  mode?: string;
  zone_type?: "rural" | "urbain";
  market?: any;
  error?: string;
  details?: string;
  smartscore?: {
    globalScore?: number | null;
    pillarScores?: {
      emplacement_env?: number | null;
      risques_complexite?: number | null;
      [key: string]: number | null | undefined;
    };
    messages?: string[];
    report?: {
      executiveSummary?: string;
      pillarDetails?: Record<string, string>;
    };
    debug?: {
      fallback?: boolean;
      dvfUsed?: boolean;
      travauxUsed?: boolean;
    };
  };
  enrichedModules?: {
    transports?: {
      status?: string;
      notes?: string[];
    };
    risques?: {
      notes?: string[];
    };
    marketInsights?: {
      pricePerM2?: number | string | null;
      medianM2?: number | string | null;
      deltaVsMedian?: number | string | null;
      classification?: string | null;
      liquidityBand?: string | null;
      note?: string | null;
    };
  };
};

export async function fetchQuartierSmartscore(
  supabase: SupabaseClient,
  req: QuartierRequest
): Promise<QuartierResponse> {
  const payload = {
    surface_m2: req.surface_m2 ?? undefined,
    prix: req.prix ?? undefined,
    type_local: req.type_local ?? undefined,
    address: req.address ?? undefined,
    cp: req.cp ?? undefined,
    ville: req.ville ?? undefined,
    parcel_id: req.parcel_id ?? undefined,
    commune_insee: req.commune_insee ?? undefined,
    radius_km: req.radius_km ?? 2,
    horizon_months: req.horizon_months ?? 24,
    debug: !!req.debug,
  };

  const { data, error } = await supabase.functions.invoke("smartscore-enriched-v4", {
    body: payload,
  });

  if (error) {
    return { success: false, error: error.message };
  }
  return data as QuartierResponse;
}