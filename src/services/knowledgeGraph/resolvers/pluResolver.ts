// src/services/knowledgeGraph/resolvers/pluResolver.ts
//
// ÉTAPE 3 — Contexte PLU parcelle-précis.
// Fonction réelle : `plu-from-parcelle-v2`.
// Body CONFIRMÉ : { commune_insee, parcel_id }  (ou { commune_insee, address }).
// >>> Le 400 du Knowledge Graph venait de l'ancien body { parcelle } <<<
// Réponse : { success, plu: { found, zone_code, zone_libelle, ruleset }, parcel, zone? }.

import { supabase } from "@/lib/supabaseClient";

export type PluStatus = "PLU_READY" | "PLU_PENDING" | "PLU_FAILED";
export type PluConfidence = "high" | "medium" | "low";

export interface ParcelPluContext {
  status: PluStatus;
  source: string | null;
  zone: string | null;
  constraints: Record<string, unknown> | null;
  confidence: PluConfidence;
}

interface PluV2Response {
  success?: boolean;
  plu?: { found?: boolean; zone_code?: string; zone_libelle?: string; ruleset?: unknown } | null;
  zone?: { zone_code?: string; zone_libelle?: string } | null;
  zone_code?: string;
}

function inseeFromParcel(parcelId: string): string | null {
  const m = parcelId.trim().match(/^(\d{5})/);
  return m ? m[1] : null;
}

function extractZone(data: PluV2Response | null): {
  zone: string | null;
  constraints: Record<string, unknown> | null;
  ok: boolean;
} {
  if (!data) return { zone: null, constraints: null, ok: false };
  const zone = data.plu?.zone_code ?? data.zone?.zone_code ?? data.zone_code ?? null;
  const found = (data.plu?.found ?? data.success) === true;
  const constraints =
    data.plu && typeof data.plu === "object" ? (data.plu as Record<string, unknown>) : null;
  return { zone, constraints, ok: found && !!zone };
}

/**
 * Contexte PLU d'une parcelle.
 * 1) parcel_id (voie principale, contrat réel)
 * 2) address en dernier recours (même fonction)
 */
export async function resolveParcelPluContext(
  parcelId: string,
  address?: string,
): Promise<ParcelPluContext> {
  const insee = inseeFromParcel(parcelId);
  if (!insee) {
    return { status: "PLU_FAILED", source: null, zone: null, constraints: null, confidence: "low" };
  }

  let callSucceeded = false;
  let pendingConstraints: Record<string, unknown> | null = null;

  // 1) Voie principale : parcel_id
  try {
    const { data, error } = await supabase.functions.invoke("plu-from-parcelle-v2", {
      body: { commune_insee: insee, parcel_id: parcelId },
    });
    if (!error) {
      callSucceeded = true;
      const { zone, constraints, ok } = extractZone(data as PluV2Response);
      if (ok) {
        return { status: "PLU_READY", source: "plu-from-parcelle-v2:parcel", zone, constraints, confidence: "high" };
      }
      pendingConstraints = constraints;
    }
  } catch {
    /* fallback adresse */
  }

  // 2) Dernier recours : adresse
  if (address && address.trim()) {
    try {
      const { data, error } = await supabase.functions.invoke("plu-from-parcelle-v2", {
        body: { commune_insee: insee, address: address.trim() },
      });
      if (!error) {
        callSucceeded = true;
        const { zone, constraints, ok } = extractZone(data as PluV2Response);
        if (ok) {
          return { status: "PLU_READY", source: "plu-from-parcelle-v2:address", zone, constraints, confidence: "medium" };
        }
        pendingConstraints = constraints ?? pendingConstraints;
      }
    } catch {
      /* échec final */
    }
  }

  if (callSucceeded) {
    return { status: "PLU_PENDING", source: "plu-from-parcelle-v2:parcel", zone: null, constraints: pendingConstraints, confidence: "low" };
  }
  return { status: "PLU_FAILED", source: null, zone: null, constraints: null, confidence: "low" };
}