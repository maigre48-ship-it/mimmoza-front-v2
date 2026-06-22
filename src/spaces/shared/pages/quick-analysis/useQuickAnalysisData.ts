// ─────────────────────────────────────────────────────────────────────────────
// useQuickAnalysisData.ts
// Hook d'orchestration des sources de données pour l'Analyse Rapide
// ─────────────────────────────────────────────────────────────────────────────

import {
  fetchBestDvfEstimate,
  fetchDvfCompsNormalized,
} from "@/lib/dvfEstimateApi";
import { supabase } from "@/lib/supabaseClient";
import { useCallback, useState } from "react";
import type { MimmozaValuationInput, RiskLevel } from "../../../valuation/valuation.types";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type GeocodedLocation = {
  lat: number;
  lng: number;
  communeInsee: string;
  codePostal: string;
  city: string;
  label: string;
};

export type QuickAnalysisDataState = {
  loading: boolean;
  error: string | null;
  location: GeocodedLocation | null;
  // Données enrichies prêtes à injecter dans MimmozaValuationInput
  enrichedInput: Partial<MimmozaValuationInput> | null;
  // Statuts individuels par source
  sourceStatus: {
    geocode: "idle" | "loading" | "ok" | "error";
    dvf: "idle" | "loading" | "ok" | "error" | "empty";
    smartscore: "idle" | "loading" | "ok" | "error";
    georisques: "idle" | "loading" | "ok" | "error";
    plu: "idle" | "loading" | "ok" | "error";
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Géocodage adresse → lat/lng + INSEE (API Adresse gouv)
// ─────────────────────────────────────────────────────────────────────────────

async function geocodeAddress(
  address: string,
  city: string,
  postalCode: string
): Promise<GeocodedLocation | null> {
  const q = [address, postalCode, city].filter(Boolean).join(" ").trim();
  if (!q) return null;

  const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=1`;
  const res = await fetch(url);
  if (!res.ok) return null;

  const json = await res.json();
  const feature = json?.features?.[0];
  if (!feature) return null;

  const props = feature.properties;
  const [lng, lat] = feature.geometry.coordinates;

  return {
    lat,
    lng,
    communeInsee: props.citycode ?? props.city ?? "",
    codePostal: props.postcode ?? postalCode ?? "",
    city: props.city ?? city ?? "",
    label: props.label ?? q,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Géorisques via Edge Function risk-study-v1
// ─────────────────────────────────────────────────────────────────────────────

async function fetchGeorisques(
  communeInsee: string,
  lat: number,
  lng: number
): Promise<MimmozaValuationInput["georisques"] | null> {
  try {
    const { data, error } = await supabase.functions.invoke("risk-study-v1", {
      body: {
        commune_insee: communeInsee,
        lat,
        lon: lng,
      },
    });

    if (error || !data) return null;

    // Normaliser la réponse vers notre type GeorisquesInput
    const risks = data?.risks ?? data?.georisques ?? data ?? {};
    const flags = {
      flood: !!(risks.inondation ?? risks.flood ?? risks.AZI),
      clay: !!(risks.argile ?? risks.clay ?? risks.retrait_gonflement),
      ppr: !!(risks.ppr ?? risks.PPR),
      pollutedSoil: !!(risks.basias ?? risks.polluted_soil ?? risks.sol_pollue),
    };

    const flagCount = Object.values(flags).filter(Boolean).length;
    const globalRiskLevel: RiskLevel =
      flagCount >= 2 ? "high" : flagCount === 1 ? "medium" : "low";

    return {
      globalRiskLevel,
      ...flags,
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SmartScore via Edge Function smartscore-enriched-v3
// ─────────────────────────────────────────────────────────────────────────────

async function fetchSmartScoreValue(
  lat: number,
  lng: number,
  communeInsee: string
): Promise<{
  score: number | null;
  market: MimmozaValuationInput["market"] | null;
}> {
  try {
    const { data, error } = await supabase.functions.invoke("smartscore-enriched-v3", {
      body: {
        mode: "standard",
        lat,
        lon: lng,
        commune_insee: communeInsee,
        radius_km: 2,
        horizon_months: 24,
      },
    });

    if (error || !data?.success) return { score: null, market: null };

    const v4 = data?.smartscore_v4 ?? {};
    const mi = data?.market?.market_intelligence ?? data?.market_like?.market_intelligence ?? {};
    const prices = data?.market?.prices ?? data?.market_like?.prices ?? {};

    const score: number | null = v4?.score ?? data?.smartscore?.score ?? null;

    const market: MimmozaValuationInput["market"] = {
      localPricePerSqm: prices?.median_eur_m2 ?? null,
      yearlyPriceEvolutionPct: mi?.price_trend?.slope_pct_per_year ?? null,
      rentalTension:
        mi?.rental_tension?.score >= 70
          ? "high"
          : mi?.rental_tension?.score >= 40
          ? "medium"
          : mi?.rental_tension?.score != null
          ? "low"
          : "unknown",
      vacancyRate: null,
      medianRentPerSqm: mi?.rental_tension?.loyer_estime_m2_mois ?? null,
    };

    return { score, market };
  } catch {
    return { score: null, market: null };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DVF : estimation + comparables
// ─────────────────────────────────────────────────────────────────────────────

async function fetchDvfData(
  communeInsee: string,
  codePostal: string,
  surface: number | null,
  typeLocal?: string | null
): Promise<{
  dvfComparables: MimmozaValuationInput["dvfComparables"];
  localPricePerSqm: number | null;
}> {
  if (!communeInsee) return { dvfComparables: [], localPricePerSqm: null };

  const surfaceForQuery = surface ?? 60; // surface neutre si inconnue

  try {
    // Estimation + comparables en parallèle
    const [estimateRes, compsRes] = await Promise.all([
      fetchBestDvfEstimate(supabase, {
        commune_insee: communeInsee,
        code_postal: codePostal || null,
        surface_m2: surfaceForQuery,
        type_local: typeLocal ?? null,
        months: 24,
      }),
      fetchDvfCompsNormalized(supabase, {
          commune_insee: communeInsee,
          code_postal: codePostal || null,
          type_local: typeLocal ?? null,
          months: 24,
          scope: codePostal ? "cp" : "commune",
        limit: 10,
      }),
    ]);

    // Prix/m² médian depuis l'estimation
    const localPricePerSqm =
      estimateRes.best?.result?.stats?.price_m2_median ?? null;

    // Mapper les comparables vers notre type
    const dvfComparables: MimmozaValuationInput["dvfComparables"] =
      compsRes.data
        .filter((c) => c.valeur_fonciere !== null)
        .slice(0, 8)
        .map((c) => ({
          price: c.valeur_fonciere as number,
          surface: c.surface_reelle_bati,
          pricePerSqm: c.price_m2,
          date: c.date_mutation,
          distanceMeters: null, // RPC commune ne retourne pas la distance
          assetType: c.type_local,
        }));

    return { dvfComparables, localPricePerSqm };
  } catch {
    return { dvfComparables: [], localPricePerSqm: null };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook principal
// ─────────────────────────────────────────────────────────────────────────────

const INITIAL_STATE: QuickAnalysisDataState = {
  loading: false,
  error: null,
  location: null,
  enrichedInput: null,
  sourceStatus: {
    geocode: "idle",
    dvf: "idle",
    smartscore: "idle",
    georisques: "idle",
    plu: "idle",
  },
};

export function useQuickAnalysisData() {
  const [state, setState] = useState<QuickAnalysisDataState>(INITIAL_STATE);

  const setStatus = useCallback(
    (
      source: keyof QuickAnalysisDataState["sourceStatus"],
      status: QuickAnalysisDataState["sourceStatus"][typeof source]
    ) => {
      setState((prev) => ({
        ...prev,
        sourceStatus: { ...prev.sourceStatus, [source]: status },
      }));
    },
    []
  );

  /**
   * Point d'entrée principal.
   * Orchestre le géocodage puis les appels aux sources en parallèle.
   */
  const fetchAllSources = useCallback(
    async (params: {
      address: string;
      city: string;
      postalCode: string;
      parcelId?: string;
      surface?: number | null;
      typeLocal?: string | null;
    }) => {
      setState((prev) => ({
        ...prev,
        loading: true,
        error: null,
        enrichedInput: null,
        sourceStatus: {
          geocode: "loading",
          dvf: "idle",
          smartscore: "idle",
          georisques: "idle",
          plu: "idle",
        },
      }));

      // ── 1. Géocodage ──────────────────────────────────────────────────────
      let location: GeocodedLocation | null = null;
      try {
        location = await geocodeAddress(
          params.address,
          params.city,
          params.postalCode
        );
        if (!location) {
          setState((prev) => ({
            ...prev,
            loading: false,
            error: "Adresse introuvable. Vérifiez les champs adresse / ville.",
            sourceStatus: { ...prev.sourceStatus, geocode: "error" },
          }));
          return;
        }
        setState((prev) => ({
          ...prev,
          location,
          sourceStatus: { ...prev.sourceStatus, geocode: "ok" },
        }));
      } catch {
        setState((prev) => ({
          ...prev,
          loading: false,
          error: "Erreur de géocodage.",
          sourceStatus: { ...prev.sourceStatus, geocode: "error" },
        }));
        return;
      }

      // ── 2. Appels sources en parallèle ────────────────────────────────────
      setStatus("dvf", "loading");
      setStatus("smartscore", "loading");
      setStatus("georisques", "loading");

      const [dvfResult, smartscoreResult, georisquesResult] = await Promise.all([
        fetchDvfData(
          location.communeInsee,
          location.codePostal,
          params.surface ?? null,
          params.typeLocal ?? null
        ).then((r) => {
          setStatus("dvf", (r.dvfComparables?.length ?? 0) > 0 ? "ok" : "empty");
          return r;
        }).catch(() => {
          setStatus("dvf", "error");
          return { dvfComparables: [], localPricePerSqm: null };
        }),

        fetchSmartScoreValue(
          location.lat,
          location.lng,
          location.communeInsee
        ).then((r) => {
          setStatus("smartscore", r.score !== null ? "ok" : "error");
          return r;
        }).catch(() => {
          setStatus("smartscore", "error");
          return { score: null, market: null };
        }),

        fetchGeorisques(
          location.communeInsee,
          location.lat,
          location.lng
        ).then((r) => {
          setStatus("georisques", r !== null ? "ok" : "error");
          return r;
        }).catch(() => {
          setStatus("georisques", "error");
          return null;
        }),
      ]);

      // ── 3. Fusionner dans enrichedInput ───────────────────────────────────
      const market: MimmozaValuationInput["market"] = {
        ...smartscoreResult.market,
        localPricePerSqm:
          smartscoreResult.market?.localPricePerSqm ??
          dvfResult.localPricePerSqm ??
          null,
      };

      const enrichedInput: Partial<MimmozaValuationInput> = {
        city: location.city,
        postalCode: location.codePostal,
        dvfComparables: dvfResult.dvfComparables,
        smartScore: smartscoreResult.score,
        georisques: georisquesResult ?? undefined,
        market,
      };

      setState((prev) => ({
        ...prev,
        loading: false,
        error: null,
        location,
        enrichedInput,
      }));
    },
    [setStatus]
  );

  const reset = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  return { state, fetchAllSources, reset };
}