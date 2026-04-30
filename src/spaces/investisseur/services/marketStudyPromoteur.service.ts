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

// ─── Edge function name ──────────────────────────────────────────────

const EDGE_FUNCTION_NAME = "market-study-investisseur-v1";
const REQUEST_TIMEOUT_MS = 20_000;

// ─── Env helpers ─────────────────────────────────────────────────────

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

function buildFunctionUrl(functionName: string): string | null {
  const base = SUPABASE_URL?.trim();
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/functions/v1/${functionName}`;
}

function mergeAbortSignals(
  externalSignal?: AbortSignal,
  timeoutMs = REQUEST_TIMEOUT_MS,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  let timeoutId: number | null = null;

  const abortFromExternal = () => {
    controller.abort();
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", abortFromExternal, { once: true });
    }
  }

  timeoutId = window.setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  return {
    signal: controller.signal,
    cleanup: () => {
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
      }
      if (externalSignal) {
        externalSignal.removeEventListener("abort", abortFromExternal);
      }
    },
  };
}

async function readResponseBodySafe(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.toLowerCase().includes("application/json");

  try {
    if (isJson) {
      return await response.json();
    }

    const text = await response.text();
    return text ? { raw: text } : null;
  } catch {
    try {
      const clone = response.clone();
      const text = await clone.text();
      return text ? { raw: text } : null;
    } catch {
      return null;
    }
  }
}

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

  if (
    input.lat != null &&
    input.lng != null &&
    Number.isFinite(input.lat) &&
    Number.isFinite(input.lng)
  ) {
    payload.lat = input.lat;
    payload.lon = input.lng;
  } else if (input.address && input.address.trim().length > 3) {
    payload.address = input.address.trim();
  } else if (input.zipCode && input.city) {
    payload.zipCode = input.zipCode.trim();
    payload.city = input.city.trim();
  }

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
  const functionUrl = buildFunctionUrl(EDGE_FUNCTION_NAME);

  console.log(`[MarketStudy] calling ${EDGE_FUNCTION_NAME}`, payload);

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !functionUrl) {
    const details = {
      hasUrl: Boolean(SUPABASE_URL),
      hasAnonKey: Boolean(SUPABASE_ANON_KEY),
      functionUrl,
    };

    console.error(`[MarketStudy] missing Supabase env`, details);

    return {
      ok: false,
      error:
        "Configuration Supabase manquante côté front (URL ou clé publique introuvable).",
      details,
    };
  }

  const startedAt = performance.now();
  const { signal: requestSignal, cleanup } = mergeAbortSignals(signal, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(functionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(payload),
      signal: requestSignal,
    });

    console.log(
      `[MarketStudy] HTTP response (${EDGE_FUNCTION_NAME}) in ${Math.round(performance.now() - startedAt)}ms`,
      response.status,
      response.statusText,
    );

    const parsedBody = await readResponseBodySafe(response);

    console.log(
      `[MarketStudy] parsed response (${EDGE_FUNCTION_NAME}) in ${Math.round(performance.now() - startedAt)}ms`,
      parsedBody,
    );

    if (!response.ok) {
      console.error(
        `[MarketStudy] HTTP error (${EDGE_FUNCTION_NAME})`,
        response.status,
        parsedBody,
      );

      const message =
        typeof parsedBody === "object" &&
        parsedBody !== null &&
        "error" in parsedBody &&
        typeof (parsedBody as { error?: unknown }).error === "string"
          ? (parsedBody as { error: string }).error
          : `Erreur serveur (${response.status})`;

      return {
        ok: false,
        error: message,
        details: {
          status: response.status,
          statusText: response.statusText,
          body: parsedBody,
          durationMs: Math.round(performance.now() - startedAt),
        },
      };
    }

    if (
      !parsedBody ||
      typeof parsedBody !== "object" ||
      !("success" in parsedBody) ||
      (parsedBody as { success?: unknown }).success !== true
    ) {
      return {
        ok: false,
        error:
          typeof parsedBody === "object" &&
          parsedBody !== null &&
          "error" in parsedBody &&
          typeof (parsedBody as { error?: unknown }).error === "string"
            ? (parsedBody as { error: string }).error
            : "Réponse invalide du serveur",
        details: {
          body: parsedBody,
          durationMs: Math.round(performance.now() - startedAt),
        },
      };
    }

    return { ok: true, data: parsedBody as MarketStudyResult };
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      const durationMs = Math.round(performance.now() - startedAt);

      if (signal?.aborted) {
        console.warn(
          `[MarketStudy] request cancelled by caller (${EDGE_FUNCTION_NAME}) after ${durationMs}ms`,
        );

        return {
          ok: false,
          error: "Requête annulée.",
          details: {
            reason: "aborted_by_caller",
            durationMs,
          },
        };
      }

      console.error(
        `[MarketStudy] timeout (${EDGE_FUNCTION_NAME}) after ${REQUEST_TIMEOUT_MS}ms`,
      );

      return {
        ok: false,
        error: "La fonction a mis trop de temps à répondre.",
        details: {
          reason: "timeout",
          timeoutMs: REQUEST_TIMEOUT_MS,
          durationMs,
        },
      };
    }

    console.error(`[MarketStudy] unexpected error (${EDGE_FUNCTION_NAME})`, err);

    const message = err instanceof Error ? err.message : String(err);

    if (
      message.includes("Failed to fetch") ||
      message.includes("NetworkError") ||
      message.includes("ERR_") ||
      message.includes("Load failed")
    ) {
      return {
        ok: false,
        error:
          "Impossible de joindre la fonction. Vérifiez votre connexion ou réessayez.",
        details: {
          message,
          durationMs: Math.round(performance.now() - startedAt),
        },
      };
    }

    return {
      ok: false,
      error: "Erreur inattendue lors de l'appel",
      details: {
        message,
        durationMs: Math.round(performance.now() - startedAt),
      },
    };
  } finally {
    cleanup();
  }
}