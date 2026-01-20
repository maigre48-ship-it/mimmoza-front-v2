import type { SupabaseClient } from "@supabase/supabase-js";

export type DvfEstimateParams = {
  commune_insee: string; // ex "64065" (optionnel en scope=cp, mais requis par signature)
  code_postal?: string | null; // ex "64310"
  surface_m2: number;
  type_local?: "Maison" | "Appartement" | string | null;
  pieces?: number | null;
  months?: number; // ex 24
};

export type DvfEstimateResult = {
  success: boolean;
  stats?: {
    transactions_count: number;
    price_m2_median: number | null;
    price_m2_p25: number | null;
    price_m2_p75: number | null;
  };
  estimate?: {
    low: number | null;
    target: number | null;
    high: number | null;
  };
  confidence?: "HIGH" | "MEDIUM" | "LOW";
  meta?: any;
  error?: string;
  message?: string;
};

export type DvfCompRow = {
  date_mutation: string | null;
  nature_mutation: string | null;
  valeur_fonciere: number | string | null;
  surface_reelle_bati: number | string | null;
  price_m2: number | string | null;
  type_local: string | null;
  nombre_pieces_principales: number | null;
  code_postal: string | null;
  code_departement: string | null;
  code_commune: string | null;
  commune: string | null;
};

// ============================================================================
// Normalisation comparables (évite number|string partout)
// - On ne casse pas l'existant : fetchDvfComps continue de renvoyer DvfCompRow[]
// - On ajoute DvfComp + normalize + fetchDvfCompsNormalized
// ============================================================================

export type DvfComp = Omit<
  DvfCompRow,
  "valeur_fonciere" | "surface_reelle_bati" | "price_m2"
> & {
  valeur_fonciere: number | null;
  surface_reelle_bati: number | null;
  price_m2: number | null;
};

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;

  if (typeof v === "number") {
    return Number.isFinite(v) ? v : null;
  }

  if (typeof v === "string") {
    const s = v.trim().replace(",", ".");
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  return null;
}

export function normalizeDvfCompRow(row: DvfCompRow): DvfComp {
  return {
    ...row,
    valeur_fonciere: toNumber(row.valeur_fonciere),
    surface_reelle_bati: toNumber(row.surface_reelle_bati),
    price_m2: toNumber(row.price_m2),
  };
}

// ============================================================================
// Estimation (RPC get_dvf_estimate_v3)
// ============================================================================

export async function fetchDvfEstimate(
  supabase: SupabaseClient,
  params: DvfEstimateParams & { scope: "commune" | "cp" }
): Promise<DvfEstimateResult> {
  const { commune_insee, code_postal, surface_m2, type_local, pieces, months, scope } = params;

  const rpcParams = {
    p_commune_insee: commune_insee,
    p_surface_m2: surface_m2,
    p_months: months ?? 24,
    p_type_local: type_local ?? null,
    p_pieces: pieces ?? null,
    p_code_postal: scope === "cp" ? (code_postal ?? null) : null,
  };

  const { data, error } = await supabase.rpc("get_dvf_estimate_v3", rpcParams);

  if (error) {
    return { success: false, error: "RPC_ERROR", message: error.message };
  }

  const payload = (data as any) ?? null;

  if (!payload || typeof payload !== "object") {
    return { success: false, error: "INVALID_RESPONSE", message: "Réponse RPC invalide" };
  }

  return payload as DvfEstimateResult;
}

export async function fetchBestDvfEstimate(
  supabase: SupabaseClient,
  params: DvfEstimateParams
): Promise<{
  best: { scope: "cp" | "commune"; result: DvfEstimateResult } | null;
  commune: DvfEstimateResult | null;
  cp: DvfEstimateResult | null;
  usedFallbackNoType: boolean;
}> {
  const base = { ...params };

  // 1) Essai strict: avec type_local (si fourni)
  const commune = await fetchDvfEstimate(supabase, { ...base, scope: "commune" });

  const cp = base.code_postal
    ? await fetchDvfEstimate(supabase, { ...base, scope: "cp" })
    : null;

  const pick = (c: DvfEstimateResult, p: DvfEstimateResult | null) => {
    if (p?.success && (p.stats?.transactions_count ?? 0) >= 30) return { scope: "cp" as const, result: p };
    if (c.success && (c.stats?.transactions_count ?? 0) >= 10) return { scope: "commune" as const, result: c };
    if (p?.success && (p.stats?.transactions_count ?? 0) > 0) return { scope: "cp" as const, result: p };
    if (c.success && (c.stats?.transactions_count ?? 0) > 0) return { scope: "commune" as const, result: c };
    return null;
  };

  let best = pick(commune, cp);
  let usedFallbackNoType = false;

  // 2) Fallback: si aucune donnée, réessayer sans type_local (tolérant)
  if (!best && base.type_local) {
    usedFallbackNoType = true;

    const commune2 = await fetchDvfEstimate(supabase, {
      ...base,
      type_local: null,
      scope: "commune",
    });

    const cp2 = base.code_postal
      ? await fetchDvfEstimate(supabase, { ...base, type_local: null, scope: "cp" })
      : null;

    best = pick(commune2, cp2);

    return { best, commune: commune2, cp: cp2, usedFallbackNoType };
  }

  return { best, commune, cp, usedFallbackNoType };
}

// ============================================================================
// Comparables (RPC get_dvf_comps_v1)
// ============================================================================

export async function fetchDvfComps(
  supabase: SupabaseClient,
  params: DvfEstimateParams & { scope: "commune" | "cp"; limit?: number }
): Promise<{ success: boolean; data: DvfCompRow[]; error?: string; message?: string }> {
  const { commune_insee, code_postal, type_local, pieces, months, scope, limit } = params;

  const rpcParams = {
    p_commune_insee: commune_insee,
    p_months: months ?? 24,
    p_type_local: type_local ?? null,
    p_pieces: pieces ?? null,
    p_code_postal: scope === "cp" ? (code_postal ?? null) : null,
    p_limit: Math.min(Math.max(limit ?? 30, 1), 50),
  };

  const { data, error } = await supabase.rpc("get_dvf_comps_v1", rpcParams);

  if (error) {
    return { success: false, data: [], error: "RPC_ERROR", message: error.message };
  }

  return { success: true, data: (data as any[]) ?? [] };
}

/**
 * Variante "safe" : comparables normalisés (numbers garantis)
 * Recommandé pour tout affichage / tri / calcul dans le front.
 */
export async function fetchDvfCompsNormalized(
  supabase: SupabaseClient,
  params: DvfEstimateParams & { scope: "commune" | "cp"; limit?: number }
): Promise<{ success: boolean; data: DvfComp[]; error?: string; message?: string }> {
  const res = await fetchDvfComps(supabase, params);
  return {
    ...res,
    data: res.data.map(normalizeDvfCompRow),
  };
}
