/**
 * marketStudyPromoteur.service.ts
 * ─────────────────────────────────────────────────────────────────────
 * Appelle l'Edge Function Supabase "market-study-investisseur-v1"
 * pour l'espace Investisseur uniquement.
 *
 * ★ CHANGEMENT: appelle market-study-investisseur-v1 (fork investisseur)
 *   au lieu de market-study-promoteur-v1. Zéro impact sur le module Promoteur.
 *
 * Sécurité : utilise uniquement le client Supabase anon (pas de SERVICE_ROLE).
 * ─────────────────────────────────────────────────────────────────────
 */

import { supabase } from "@/lib/supabaseClient";

// ─── Edge function name ──────────────────────────────────────────────

const EDGE_FUNCTION_NAME = "market-study-investisseur-v1";

// ─── Input ───────────────────────────────────────────────────────────

export interface MarketStudyInput {
  address?: string;
  zipCode?: string;
  city?: string;
  lat?: number;
  lng?: number;
  project_type?: string;
  radius_km?: number;
  debug?: boolean;
}

// ─── Output (sous-ensembles typés de la réponse edge) ────────────────

export interface DvfData {
  nb_transactions: number;
  prix_m2_median: number | null;
  prix_m2_moyen: number | null;
  prix_m2_min: number | null;
  prix_m2_max: number | null;
  evolution_prix_pct: number | null;
  transactions: unknown[];
  coverage: string;
}

export interface InseeData {
  code_commune: string;
  commune_nom: string;
  departement: string;
  region: string;
  population: number;
  densite: number;
  revenu_median: number | null;
  incomeMedianUcEur: number | null;
  incomeMedianUcYear: number | null;
  taux_pauvrete: number | null;
  part_menages_imposes: number | null;
  taux_chomage: number | null;
  pct_moins_15: number | null;
  pct_15_29: number | null;
  pct_30_44: number | null;
  pct_45_59: number | null;
  pct_60_74: number | null;
  pct_75_plus: number | null;
  pct_etudiants: number | null;
  pct_actifs: number | null;
  pct_logements_vacants: number | null;
  pct_locataires: number | null;
  revenu_source: string;
  coverage: string;
  warnings: string[];
}

export interface TransportData {
  score: number;
  stops: Array<{ name: string; type: string; distance_m: number }>;
  nearest_stop_m: number | null;
  has_metro_train: boolean;
  has_tram: boolean;
  coverage: string;
}

export interface BpeData {
  total_equipements: number;
  score: number;
  commerces: { count: number; details: unknown[] };
  sante: { count: number; details: unknown[] };
  services: { count: number; details: unknown[] };
  education: { count: number; details: unknown[] };
  loisirs: { count: number; details: unknown[] };
  nb_ecoles: number;
  nb_pharmacies: number;
  nb_supermarches: number;
  nb_universites: number;
  coverage: string;
}

export interface Scores {
  demande: number;
  offre: number;
  accessibilite: number;
  environnement: number;
  global: number;
}

export interface ScoringDetails {
  weights: Record<string, number>;
  adjustments: Array<{ label: string; value: number; type: "bonus" | "malus" }>;
  explanation: string;
}

export interface Insight {
  type: "positive" | "warning" | "negative" | "neutral";
  category: string;
  message: string;
}

export interface MarketStudyMeta {
  lat: number;
  lon: number;
  location_source: string;
  location_label?: string;
  commune_insee: string | null;
  commune_nom: string | null;
  departement: string | null;
  project_type: string;
  project_type_label: string;
  radius_km: number;
  generated_at: string;
}

export interface MarketStudyResult {
  success: true;
  version: string;
  meta: MarketStudyMeta;
  core: {
    dvf: DvfData | null;
    insee: InseeData | null;
    transport: TransportData | null;
    bpe: BpeData | null;
  };
  specific: Record<string, unknown> | null;
  scores: Scores;
  scoring_details: ScoringDetails;
  insights: Insight[];
  warnings?: string[];
  debug?: Record<string, unknown>;
}

// ─── Result wrapper ──────────────────────────────────────────────────

export type MarketStudyResponse =
  | { ok: true; data: MarketStudyResult }
  | { ok: false; error: string; details?: unknown };

// ─── Build payload ───────────────────────────────────────────────────

function buildPayload(input: MarketStudyInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    project_type: input.project_type ?? "logement",
    radius_km: input.radius_km ?? 5,
  };

  // Priorité 1 : coordonnées
  if (
    input.lat != null &&
    input.lng != null &&
    Number.isFinite(input.lat) &&
    Number.isFinite(input.lng)
  ) {
    payload.lat = input.lat;
    payload.lon = input.lng; // edge attend "lon", le front a "lng"
  }
  // Priorité 2 : adresse complète
  else if (input.address && input.address.trim().length > 3) {
    payload.address = input.address.trim();
  }
  // Priorité 3 : zipCode + city
  else if (input.zipCode && input.city) {
    payload.zipCode = input.zipCode.trim();
    payload.city = input.city.trim();
  }

  // Toujours ajouter zipCode/city si dispo (aide le geocoding côté edge)
  if (input.zipCode && !payload.zipCode) payload.zipCode = input.zipCode.trim();
  if (input.city && !payload.city) payload.city = input.city.trim();

  if (input.debug) payload.debug = true;

  return payload;
}

// ─── Main fetch ──────────────────────────────────────────────────────

export async function fetchMarketStudyPromoteur(
  input: MarketStudyInput,
  signal?: AbortSignal,
): Promise<MarketStudyResponse> {
  const payload = buildPayload(input);

  console.log(`[MarketStudy] calling ${EDGE_FUNCTION_NAME}`, payload);

  try {
    const { data, error } = await supabase.functions.invoke(
      EDGE_FUNCTION_NAME,
      {
        body: payload,
        // @ts-expect-error — supabase-js v2.42+ supports signal on invoke
        signal,
      },
    );

    // supabase-js invoke error (network, CORS, 404, etc.)
    if (error) {
      console.error(`[MarketStudy] invoke error (${EDGE_FUNCTION_NAME})`, error);

      const msg = error.message ?? String(error);

      if (
        msg.includes("Failed to send") ||
        msg.includes("Failed to fetch") ||
        msg.includes("NetworkError") ||
        msg.includes("ERR_")
      ) {
        return {
          ok: false,
          error:
            "Impossible de joindre la fonction. Vérifiez votre connexion ou réessayez.",
          details: msg,
        };
      }

      return { ok: false, error: msg, details: error };
    }

    console.log(`[MarketStudy] response (${EDGE_FUNCTION_NAME})`, data);

    if (!data || data.success !== true) {
      return {
        ok: false,
        error: data?.error ?? "Réponse invalide du serveur",
        details: data,
      };
    }

    return { ok: true, data: data as MarketStudyResult };
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw err;
    }

    console.error(`[MarketStudy] unexpected error (${EDGE_FUNCTION_NAME})`, err);
    return {
      ok: false,
      error: "Erreur inattendue lors de l'appel",
      details: String(err),
    };
  }
}