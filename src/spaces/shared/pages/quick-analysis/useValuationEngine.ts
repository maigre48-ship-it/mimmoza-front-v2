// ─────────────────────────────────────────────────────────────────────────────
// useValuationEngine.ts v3
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";

export type AnalysisType = "investisseur" | "rehabilitateur" | "promoteur";
export type PropertyType =
  | "appartement" | "maison" | "immeuble"
  | "terrain" | "local_commercial" | "autre";
export type MarketPosition = "underpriced" | "fair" | "overpriced";
export type ValuationBasis = "comparables" | "market_reference" | "insufficient";

export interface ValuationDriver {
  key: string; label: string; impactPct: number; weight: number;
}

export interface ComparableSale {
  price: number; surface: number; priceM2: number;
  distanceMeters: number; saleDate: string; ageYears: number; weight: number;
  outOfMarket?: boolean;
}

export interface MarketStats {
  medianPriceM2: number; meanPriceM2: number; weightedPriceM2: number;
  sampleSize: number; p25PriceM2?: number; p75PriceM2?: number;
}

export interface RehabPotential {
  budgetTravaux: number; prixAchat: number; valeurApresTravaux: number;
  coutTotal: number; margeBrute: number; margeNette: number;
  margeNettePct: number; triEstime?: number;
}

export interface PromoteurPotential {
  empriseAuSolM2: number; niveaux: number; sdpPotentielM2: number;
  constructibiliteScore: number; densificationScore: number; chargeFonciereM2Sdp: number;
}

export interface MimmozaEngineResult {
  estimatedValue: number; minEstimatedValue: number; maxEstimatedValue: number;
  marketPriceM2: number; valuationBasis: ValuationBasis;
  confidenceScore: number; opportunityScore: number;
  marketPosition: MarketPosition; securityScore: number;
  locationScore: number; locationBreakdown: Record<string, number>; locationAvailable: boolean;
  estimatedRent?: number; grossYield?: number; netYield?: number;
  rehab?: RehabPotential; promoteur?: PromoteurPotential;
  valuationDrivers: ValuationDriver[];
  comparables: ComparableSale[];
  strengths: string[]; weaknesses: string[]; warnings: string[];
  recommendation: string;
  meta: {
    engineVersion: string; analysisType: AnalysisType;
    comparablesUsed: number; computedAt: string; marketStats: MarketStats;
  };
}

export interface EngineInput {
  address: string; city: string; postalCode: string;
  surface: number; landSurface?: number; askingPrice?: number;
  propertyType: PropertyType; analysisType: AnalysisType;
  medianRentM2?: number;
  worksAmount?: number; resaleTarget?: number;
}

interface RawDvfSale {
  price: number; surface: number;
  latitude: number; longitude: number;
  saleDate: string; propertyType?: PropertyType;
}

export interface PluContext {
  zone?: string; cesMaxPercent?: number;
  hauteurMaxM?: number; hauteurMaxNiveaux?: number; pleineTerrePercent?: number;
}
export interface SitadelContext {
  logementsAutorises?: number; permisRecents?: number;
  constructionNeuve?: boolean; pressionPromoteur?: number;
}
export interface CadastreContext {
  section?: string; parcelle?: string; surfaceCadastraleM2?: number;
}
export interface EngineContext {
  plu: PluContext | null;
  sitadel: SitadelContext | null;
  cadastre: CadastreContext | null;
  marketReferenceM2: number | null;
  marketReferenceSource: string | null;
}

export interface EngineState {
  loading: boolean; error: string | null;
  result: MimmozaEngineResult | null;
  location: { lat: number; lng: number; communeInsee: string; codePostal: string; label: string } | null;
  context: EngineContext;
  steps: {
    geocode: "idle" | "loading" | "ok" | "error";
    dvf: "idle" | "loading" | "ok" | "error" | "empty";
    smartscore: "idle" | "loading" | "ok" | "error";
    georisques: "idle" | "loading" | "ok" | "error";
    plu: "idle" | "loading" | "ok" | "error" | "empty";
    sitadel: "idle" | "loading" | "ok" | "error" | "empty";
    cadastre: "idle" | "loading" | "ok" | "error" | "empty";
    engine: "idle" | "loading" | "ok" | "error";
  };
}

async function geocode(address: string, city: string, postalCode: string) {
  const q = [address, postalCode, city].filter(Boolean).join(" ");
  if (!q.trim()) return null;
  const res = await fetch(
    `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=1`
  );
  if (!res.ok) return null;
  const json = await res.json();
  const f = json?.features?.[0];
  if (!f) return null;
  const [lng, lat] = f.geometry.coordinates;
  return {
    lat: lat as number, lng: lng as number,
    communeInsee: f.properties.citycode as string,
    codePostal: (f.properties.postcode ?? postalCode) as string,
    label: f.properties.label as string,
  };
}

async function fetchDvfSales(
  communeInsee: string,
  codePostal: string,
  _surface: number,
  propertyType: PropertyType
): Promise<RawDvfSale[]> {
  const typeLocal =
    propertyType === "appartement" ? "Appartement"
    : propertyType === "maison" ? "Maison"
    : null;

  try {
    const { data, error } = await supabase.rpc("get_dvf_comps_v1", {
      p_commune_insee: communeInsee,
      p_code_postal: codePostal || null,
      p_type_local: typeLocal,
      p_months: 60,
      p_limit: 80,
      p_pieces: null,
    });
    if (error || !data) return [];

    return (data as Record<string, unknown>[])
      .filter((r) => Number(r.valeur_fonciere) > 0 && Number(r.surface_reelle_bati) > 0)
      .map((r) => ({
        price:   Number(r.valeur_fonciere),
        surface: Number(r.surface_reelle_bati),
        latitude:  0,
        longitude: 0,
        saleDate:  String(r.date_mutation ?? ""),
        propertyType: typeLocal === "Appartement" ? "appartement" as PropertyType
          : typeLocal === "Maison" ? "maison" as PropertyType : undefined,
      }));
  } catch {
    return [];
  }
}

function dvfMedianPriceM2(sales: RawDvfSale[]): number | null {
  const pm2 = sales
    .filter((s) => s.surface > 0 && s.price > 0)
    .map((s) => s.price / s.surface)
    .filter((v) => isFinite(v) && v > 300 && v < 40000)
    .sort((a, b) => a - b);
  if (pm2.length === 0) return null;
  const mid = Math.floor(pm2.length / 2);
  const med = pm2.length % 2 ? pm2[mid] : (pm2[mid - 1] + pm2[mid]) / 2;
  return Math.round(med);
}

async function fetchSmartScoreSignals(lat: number, lng: number, communeInsee: string) {
  try {
    const { data, error } = await supabase.functions.invoke("smartscore-enriched-v3", {
      body: { mode: "standard", lat, lon: lng, commune_insee: communeInsee,
        radius_km: 2, horizon_months: 24 },
    });
    if (error || !data?.success) return null;

    const mi     = data?.market?.market_intelligence ?? data?.market_like?.market_intelligence ?? {};
    const prices = data?.market?.prices ?? data?.market_like?.prices ?? {};
    const ss     = data?.smartscore_v4 ?? data?.smartscore ?? {};
    const comps  = ss?.components ?? ss?.pillar_scores ?? {};

    return {
      locationSignals: {
        transportScore:   comps.transport  ?? null,
        shopsScore:       comps.services   ?? null,
        schoolsScore:     comps.ecoles     ?? null,
        localMarketScore: comps.market     ?? null,
      },
      marketContext: {
        trend12mPct:  mi?.price_trend?.slope_pct_per_year ?? null,
        tensionIndex: mi?.rental_tension?.score           ?? null,
        liquidity:
          (mi?.liquidity?.score ?? 0) >= 70 ? "forte" as const
          : (mi?.liquidity?.score ?? 0) >= 40 ? "normale" as const : "faible" as const,
      },
      medianRentM2:     mi?.rental_tension?.loyer_estime_m2_mois ?? null,
      localPricePerSqm: prices?.median_eur_m2 ?? null,
    };
  } catch {
    return null;
  }
}

async function fetchRisk(communeInsee: string, lat: number, lng: number) {
  try {
    const { data, error } = await supabase.functions.invoke("risk-study-v1", {
      body: { commune_insee: communeInsee, lat, lon: lng },
    });
    if (error || !data) return null;
    const r = data?.risks ?? data?.georisques ?? data ?? {};
    return {
      floodRisk:         !!(r.inondation ?? r.flood ?? r.AZI),
      clayShrinkSwell:   r.argile === "fort" ? "fort" as const
                         : r.argile === "moyen" ? "moyen" as const : undefined,
      technologicalRisk: !!(r.technologique ?? r.seveso),
      globalRiskLevel:   r.niveau_global ?? r.global_risk_level ?? undefined,
    };
  } catch {
    return null;
  }
}

async function fetchPlu(
  communeInsee: string,
  lat: number,
  lng: number,
  address?: string,
  city?: string,
  postalCode?: string
): Promise<PluContext | null> {
  try {
    const fullAddress = `${address ?? ""} ${postalCode ?? ""} ${city ?? ""}`.trim();
    const { data, error } = await supabase.functions.invoke("plu-from-address", {
      body: { address: fullAddress },
    });
    if (error || !data) return null;
    const z = data?.zone ?? data?.plu ?? data?.result ?? data ?? {};
    const ctx: PluContext = {
      zone:               z.zone_code       ?? z.zone         ?? undefined,
      cesMaxPercent:      z.ces_max         ?? z.emprise_sol  ?? undefined,
      hauteurMaxM:        z.hauteur_max_m   ?? z.hauteur_m    ?? undefined,
      hauteurMaxNiveaux:  z.hauteur_niveaux ?? undefined,
      pleineTerrePercent: z.pleine_terre    ?? undefined,
    };
    // Zéro donnée fictive : si aucune info exploitable, on ne renvoie rien.
    return ctx.zone !== undefined || ctx.cesMaxPercent !== undefined ? ctx : null;
  } catch {
    return null;
  }
}

async function fetchSitadel(communeInsee: string): Promise<SitadelContext | null> {
  try {
    // Récupère le code EPCI depuis la commune
    const geoRes = await fetch(`https://geo.api.gouv.fr/communes/${communeInsee}?fields=codeEpci`);
    if (!geoRes.ok) return null;
    const geoData = await geoRes.json();
    const epciCode = geoData?.codeEpci;
    if (!epciCode) return null;

    const { data, error } = await supabase.functions.invoke("sitadel-v1", {
      body: { epciCode },
    });
    if (error || !data) return null;
    const s = data?.sitadel ?? data?.stats ?? data ?? {};
    const ctx: SitadelContext = {
      logementsAutorises: s.logements_autorises ?? s.nb_logements ?? undefined,
      permisRecents:      s.permis_recents      ?? s.nb_permis    ?? undefined,
      constructionNeuve:  s.construction_neuve  ?? undefined,
      pressionPromoteur:  s.pression_promoteur  ?? s.pression     ?? undefined,
    };
    const hasData =
      ctx.logementsAutorises !== undefined ||
      ctx.permisRecents !== undefined ||
      ctx.pressionPromoteur !== undefined;
    return hasData ? ctx : null;
  } catch {
    return null;
  }
}

async function fetchCadastre(_communeInsee: string, _lat: number, _lng: number): Promise<CadastreContext | null> {
  return null;
}

const INITIAL: EngineState = {
  loading: false, error: null, result: null, location: null,
  context: { plu: null, sitadel: null, cadastre: null, marketReferenceM2: null, marketReferenceSource: null },
  steps: {
    geocode: "idle", dvf: "idle", smartscore: "idle", georisques: "idle",
    plu: "idle", sitadel: "idle", cadastre: "idle", engine: "idle",
  },
};

export function useValuationEngine() {
  const [state, setState] = useState<EngineState>(INITIAL);

  const setStep = useCallback(
    (step: keyof EngineState["steps"], status: EngineState["steps"][typeof step]) => {
      setState((p) => ({ ...p, steps: { ...p.steps, [step]: status } }));
    }, []
  );

  const run = useCallback(async (input: EngineInput) => {
    setState({
      ...INITIAL, loading: true,
      steps: { ...INITIAL.steps, geocode: "loading" },
    });

    let loc: EngineState["location"] = null;
    try {
      loc = await geocode(input.address, input.city, input.postalCode);
      if (!loc) {
        setState((p) => ({ ...p, loading: false,
          error: "Adresse introuvable — vérifiez adresse / ville / code postal.",
          steps: { ...p.steps, geocode: "error" } }));
        return;
      }
      setState((p) => ({ ...p, location: loc, steps: {
        ...p.steps, geocode: "ok",
        dvf: "loading", smartscore: "loading", georisques: "loading",
        plu: "loading", sitadel: "loading", cadastre: "loading",
      }}));
    } catch {
      setState((p) => ({ ...p, loading: false, error: "Erreur de géocodage.",
        steps: { ...p.steps, geocode: "error" } }));
      return;
    }

    const [dvfSales, ssResult, riskResult, pluCtx, sitadelCtx, cadastreCtx] = await Promise.all([
      fetchDvfSales(loc.communeInsee, loc.codePostal, input.surface, input.propertyType)
        .then((r) => { setStep("dvf", r.length > 0 ? "ok" : "empty"); return r; })
        .catch(() => { setStep("dvf", "error"); return [] as RawDvfSale[]; }),

      fetchSmartScoreSignals(loc.lat, loc.lng, loc.communeInsee)
        .then((r) => { setStep("smartscore", r ? "ok" : "error"); return r; })
        .catch(() => { setStep("smartscore", "error"); return null; }),

      fetchRisk(loc.communeInsee, loc.lat, loc.lng)
        .then((r) => { setStep("georisques", r ? "ok" : "error"); return r; })
        .catch(() => { setStep("georisques", "error"); return null; }),

      fetchPlu(loc.communeInsee, loc.lat, loc.lng, input.address, input.city, input.postalCode)
        .then((r) => { setStep("plu", r ? "ok" : "empty"); return r; })
        .catch(() => { setStep("plu", "error"); return null; }),

      fetchSitadel(loc.communeInsee)
        .then((r) => { setStep("sitadel", r ? "ok" : "empty"); return r; })
        .catch(() => { setStep("sitadel", "error"); return null; }),

      fetchCadastre(loc.communeInsee, loc.lat, loc.lng)
        .then((r) => { setStep("cadastre", r ? "ok" : "empty"); return r; })
        .catch(() => { setStep("cadastre", "error"); return null; }),
    ]);

    const ssPrice = ssResult?.localPricePerSqm ?? null;
    const dvfPrice = dvfMedianPriceM2(dvfSales);
    let marketReferenceM2: number | null = null;
    let marketReferenceSource: string | null = null;
    if (ssPrice && ssPrice > 0) { marketReferenceM2 = Math.round(ssPrice); marketReferenceSource = "SmartScore"; }
    else if (dvfPrice && dvfPrice > 0) { marketReferenceM2 = dvfPrice; marketReferenceSource = "DVF commune/CP"; }

    setState((p) => ({ ...p, context: {
      plu: pluCtx, sitadel: sitadelCtx, cadastre: cadastreCtx,
      marketReferenceM2, marketReferenceSource,
    }}));
    setStep("engine", "loading");

    try {
      const dvfWithCoords: RawDvfSale[] = dvfSales.map((s) => ({
        ...s,
        latitude:  s.latitude  || loc!.lat,
        longitude: s.longitude || loc!.lng,
      }));

      const payload = {
        address:      input.address,
        city:         input.city,
        postalCode:   input.postalCode,
        latitude:     loc.lat,
        longitude:    loc.lng,
        surface:      input.surface,
        landSurface:  input.landSurface,
        askingPrice:  input.askingPrice,
        propertyType: input.propertyType,
        analysisType: input.analysisType,
        worksAmount:  input.worksAmount,
        resaleTarget: input.resaleTarget,
        dvfSales:        dvfWithCoords,
        medianRentM2:    input.medianRentM2 ?? ssResult?.medianRentM2 ?? undefined,
        locationSignals: ssResult?.locationSignals ?? undefined,
        marketContext:   ssResult?.marketContext   ?? undefined,
        risk:            riskResult                ?? undefined,
        plu:             pluCtx ?? undefined,
        marketReference: marketReferenceM2
          ? { pricePerM2: marketReferenceM2, source: marketReferenceSource ?? undefined }
          : undefined,
        sources: {
          dvf:        dvfSales.length > 0,
          georisques: !!riskResult,
          plu:        !!pluCtx,
          cadastre:   !!cadastreCtx,
          sitadel:    false, // récupéré et exposé dans context, pas envoyé au moteur (contrat à confirmer)
        },
      };

      const { data, error } = await supabase.functions.invoke("valuation-engine", {
        body: payload,
      });

      if (error) throw new Error(error.message);
      if (!data || data.error) throw new Error(data?.error ?? "Réponse invalide du moteur");

      setStep("engine", "ok");
      setState((p) => ({ ...p, loading: false, result: data as MimmozaEngineResult }));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setStep("engine", "error");
      setState((p) => ({ ...p, loading: false,
        error: `Erreur moteur de valorisation : ${msg}` }));
    }
  }, [setStep]);

  const reset = useCallback(() => setState(INITIAL), []);

  return { state, run, reset };
}