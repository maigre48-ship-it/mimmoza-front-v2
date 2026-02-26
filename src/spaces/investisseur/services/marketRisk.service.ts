/**
 * marketRisk.service.ts
 * ─────────────────────────────────────────────────────────────────────
 * Service pour récupérer les données marché (DVF) et risques (Géorisques)
 * via l'Edge Function "market-risk-v1".
 *
 * Si la fonction n'existe pas ou échoue, retourne un objet MarketRiskResponse
 * avec error rempli (le panel affiche un fallback propre).
 * ─────────────────────────────────────────────────────────────────────
 */

import { supabase } from "@/lib/supabaseClient";
import type { MarketRiskResponse } from "../types/strategy.types";

export interface MarketRiskQuery {
  zipCode: string;
  city: string;
  address?: string;
  lat?: number;
  lng?: number;
}

/**
 * Appelle l'Edge Function market-risk-v1.
 * Retourne toujours un objet valide (jamais de throw non catchée).
 */
export async function fetchMarketRiskData(
  query: MarketRiskQuery
): Promise<MarketRiskResponse> {
  try {
    const { data, error } = await supabase.functions.invoke(
      "market-risk-v1",
      {
        body: {
          zipCode: query.zipCode,
          city: query.city,
          address: query.address ?? "",
          lat: query.lat ?? null,
          lng: query.lng ?? null,
        },
      }
    );

    if (error) {
      console.warn("[marketRisk.service] Edge Function error:", error);
      return buildErrorResponse(
        error.message ??
          "Erreur lors de l'appel à la fonction market-risk-v1."
      );
    }

    // Validation minimale de la réponse
    if (!data || typeof data !== "object") {
      return buildErrorResponse(
        "Réponse invalide de la fonction market-risk-v1."
      );
    }

    return {
      market: data.market ?? null,
      risk: data.risk ?? null,
      confidence: data.confidence ?? null,
      fetchedAt: data.fetchedAt ?? new Date().toISOString(),
      error: data.error ?? undefined,
    } as MarketRiskResponse;
  } catch (err: any) {
    console.warn("[marketRisk.service] Fetch failed:", err);

    // Cas typique : fonction non déployée ou 404
    const message =
      err?.message?.includes("FunctionNotFound") ||
      err?.message?.includes("404")
        ? "La fonction market-risk-v1 n'est pas encore déployée."
        : `Impossible de contacter le service marché/risques: ${
            err?.message ?? "erreur inconnue"
          }.`;

    return buildErrorResponse(message);
  }
}

function buildErrorResponse(errorMsg: string): MarketRiskResponse {
  return {
    market: null,
    risk: null,
    confidence: null,
    fetchedAt: new Date().toISOString(),
    error: errorMsg,
  };
}
