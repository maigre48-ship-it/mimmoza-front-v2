// ─────────────────────────────────────────────────────────────────────────────
// Mimmoza Valuation Engine — Moteur principal v2
// Principe : zéro valeur fictive. Tout champ absent = null.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  AssetType,
  MimmozaValuationInput,
  MimmozaValuationResult,
  RiskLevel,
  SourceStatus,
} from "./valuation.types";
import { computeValuationConfidence, getUncertaintyMargin } from "./valuationConfidence";
import { computeOpportunityScore } from "./valuationOpportunity";
import { buildValuationRecommendation } from "./valuationRecommendation";

// ─────────────────────────────────────────────────────────────────────────────
// Interfaces futures (moteur de valorisation avancé)
// Laissées à null tant que l'Edge Function n'est pas connectée.
// ─────────────────────────────────────────────────────────────────────────────

export interface ValuationPricingDetail {
  /** Prix/m² moyen des comparables DVF (calculé, pas inventé) */
  dvfMeanPricePerSqm: number | null;
  /** Prix/m² médian des comparables DVF */
  dvfMedianPricePerSqm: number | null;
  /** Prix/m² retenu pour la valorisation */
  retainedPricePerSqm: number | null;
  /** Nombre de comparables utilisés */
  dvfComparableCount: number;
  /** Source ayant déterminé le prix retenu */
  priceSource: "dvf_weighted" | "dvf_median" | "market_local" | "asking_price_proxy" | null;
}

export interface ConfidenceBreakdown {
  /** Facteurs positifs réellement appliqués */
  positiveFactors: string[];
  /** Facteurs négatifs réellement appliqués */
  negativeFactors: string[];
}

export interface MarketPositionDetail {
  askingPrice: number | null;
  estimatedPrice: number | null;
  /** Écart en % — null si l'un des deux prix manque */
  gapPct: number | null;
  /** Surcote (+) ou décote (-) en valeur absolue */
  gapAbsolute: number | null;
}

export interface ComparableScore {
  /** Score de pertinence 0–100 calculé depuis nb comps + récence + distance */
  score: number | null;
  /** Nombre de comparables disponibles */
  count: number;
  /** True si au moins un comparable a une distance réelle */
  hasDistance: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers internes
// ─────────────────────────────────────────────────────────────────────────────

/** Filtre IQR + calcul prix/m² médian pondéré distance+récence. */
function computeWeightedDvfPricePerSqm(
  comparables: NonNullable<MimmozaValuationInput["dvfComparables"]>
): { weighted: number | null; median: number | null; mean: number | null } {
  const rawPrices = comparables
    .map((c) => {
      const psqm = c.pricePerSqm
        ?? (c.surface && c.surface > 0 ? c.price / c.surface : null);
      return psqm && psqm > 0 ? psqm : null;
    })
    .filter((v): v is number => v !== null);

  if (rawPrices.length === 0) return { weighted: null, median: null, mean: null };

  // IQR pour exclure aberrants
  const sorted = [...rawPrices].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr;
  const hi = q3 + 1.5 * iqr;

  const filtered = comparables.filter((c) => {
    const psqm = c.pricePerSqm
      ?? (c.surface && c.surface > 0 ? c.price / c.surface : null);
    return psqm !== null && psqm >= lo && psqm <= hi;
  });

  if (filtered.length === 0) return { weighted: null, median: null, mean: null };

  const filteredPrices = filtered.map((c) =>
    c.pricePerSqm ?? c.price / c.surface!
  );

  const mean = filteredPrices.reduce((a, b) => a + b, 0) / filteredPrices.length;
  const mid = Math.floor(filteredPrices.length / 2);
  const fSorted = [...filteredPrices].sort((a, b) => a - b);
  const median = fSorted.length % 2 === 0
    ? (fSorted[mid - 1] + fSorted[mid]) / 2
    : fSorted[mid];

  // Pondération distance + récence
  let wSum = 0; let wTotal = 0;
  for (const c of filtered) {
    const psqm = c.pricePerSqm ?? c.price / c.surface!;
    let dw = 1;
    if (c.distanceMeters != null) dw = Math.max(0.2, 1 - c.distanceMeters / 2000);
    let tw = 1;
    if (c.date) {
      const ageMonths = (Date.now() - new Date(c.date).getTime()) / (1000 * 60 * 60 * 24 * 30);
      tw = Math.max(0.3, 1 - ageMonths / 48);
    }
    const w = dw * tw;
    wSum += psqm * w;
    wTotal += w;
  }

  return {
    weighted: wTotal > 0 ? wSum / wTotal : null,
    median,
    mean,
  };
}

function resolveRiskLevel(input: MimmozaValuationInput): RiskLevel {
  if (input.georisques?.globalRiskLevel) return input.georisques.globalRiskLevel;
  if (input.georisques) {
    const n = [input.georisques.flood, input.georisques.clay,
      input.georisques.ppr, input.georisques.pollutedSoil].filter(Boolean).length;
    if (n >= 2) return "high";
    if (n === 1) return "medium";
    return "low";
  }
  return "unknown";
}

function resolveAssetType(input: MimmozaValuationInput): AssetType {
  return input.assetType ?? "unknown";
}

function buildSourceStatus(input: MimmozaValuationInput): SourceStatus {
  return {
    dvf:       (input.dvfComparables?.length ?? 0) > 0,
    plu:       !!input.plu,
    georisques:!!input.georisques,
    sitadel:   !!input.sitadel,
    marketData:!!input.market?.localPricePerSqm,
    smartScore:input.smartScore != null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Calcul valeur marché — retourne aussi le détail de pricing
// ─────────────────────────────────────────────────────────────────────────────

function computeMarketValue(input: MimmozaValuationInput): {
  marketValue: number | null;
  estimatedPricePerSqm: number | null;
  pricingDetail: ValuationPricingDetail;
} {
  const surface = input.surface ?? null;
  const dvfCount = input.dvfComparables?.length ?? 0;

  const detail: ValuationPricingDetail = {
    dvfMeanPricePerSqm:   null,
    dvfMedianPricePerSqm: null,
    retainedPricePerSqm:  null,
    dvfComparableCount:   dvfCount,
    priceSource:          null,
  };

  // Priorité 1 : DVF comparables
  if (dvfCount > 0 && surface) {
    const { weighted, median, mean } = computeWeightedDvfPricePerSqm(input.dvfComparables!);
    detail.dvfMeanPricePerSqm   = mean   !== null ? Math.round(mean)   : null;
    detail.dvfMedianPricePerSqm = median !== null ? Math.round(median) : null;

    const retained = weighted ?? median;
    if (retained) {
      detail.retainedPricePerSqm = Math.round(retained);
      detail.priceSource         = weighted ? "dvf_weighted" : "dvf_median";
      return {
        marketValue:          Math.round(retained * surface),
        estimatedPricePerSqm: Math.round(retained),
        pricingDetail:        detail,
      };
    }
  }

  // Priorité 2 : prix marché local
  if (input.market?.localPricePerSqm && surface) {
    const psqm = input.market.localPricePerSqm;
    detail.retainedPricePerSqm = Math.round(psqm);
    detail.priceSource         = "market_local";
    return {
      marketValue:          Math.round(psqm * surface),
      estimatedPricePerSqm: Math.round(psqm),
      pricingDetail:        detail,
    };
  }

  // Priorité 3 : prix demandé comme proxy (confiance très faible)
  if (input.askingPrice) {
    detail.priceSource = "asking_price_proxy";
    return {
      marketValue:          input.askingPrice,
      estimatedPricePerSqm: surface ? Math.round(input.askingPrice / surface) : null,
      pricingDetail:        detail,
    };
  }

  return { marketValue: null, estimatedPricePerSqm: null, pricingDetail: detail };
}

// ─────────────────────────────────────────────────────────────────────────────
// Confidence breakdown — facteurs réels uniquement
// ─────────────────────────────────────────────────────────────────────────────

function buildConfidenceBreakdown(input: MimmozaValuationInput): ConfidenceBreakdown {
  const pos: string[] = [];
  const neg: string[] = [];

  const dvfCount = input.dvfComparables?.length ?? 0;
  if (dvfCount >= 5)     pos.push(`${dvfCount} comparables DVF disponibles`);
  else if (dvfCount > 0) pos.push(`${dvfCount} comparable(s) DVF disponible(s)`);
  else                   neg.push("Aucun comparable DVF");

  if (input.surface)                    pos.push("Surface renseignée");
  else                                  neg.push("Surface non renseignée");

  if (input.market?.localPricePerSqm)   pos.push("Prix marché local disponible");
  else                                  neg.push("Prix marché local absent");

  if (input.smartScore != null)         pos.push("SmartScore disponible");
  if (input.plu)                        pos.push("Données PLU disponibles");
  if (input.georisques)                 pos.push("Données Géorisques disponibles");
  else                                  neg.push("Données Géorisques absentes");

  if (input.sitadel)                    pos.push("Données Sitadel disponibles");

  if (!input.askingPrice)               neg.push("Prix demandé non renseigné");

  if (input.georisques?.globalRiskLevel === "high") neg.push("Risque élevé sur le secteur");

  return { positiveFactors: pos, negativeFactors: neg };
}

// ─────────────────────────────────────────────────────────────────────────────
// Market position — null si données insuffisantes
// ─────────────────────────────────────────────────────────────────────────────

function buildMarketPosition(
  askingPrice: number | null | undefined,
  marketValue: number | null
): MarketPositionDetail {
  if (!askingPrice || !marketValue) {
    return { askingPrice: askingPrice ?? null, estimatedPrice: marketValue,
      gapPct: null, gapAbsolute: null };
  }
  const gapAbsolute = askingPrice - marketValue;
  const gapPct      = (gapAbsolute / marketValue) * 100;
  return { askingPrice, estimatedPrice: marketValue,
    gapPct: parseFloat(gapPct.toFixed(1)), gapAbsolute: Math.round(gapAbsolute) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Comparable score — calculé depuis données réelles
// ─────────────────────────────────────────────────────────────────────────────

function buildComparableScore(
  comparables: MimmozaValuationInput["dvfComparables"]
): ComparableScore {
  const count = comparables?.length ?? 0;
  if (count === 0) return { score: null, count: 0, hasDistance: false };

  const hasDistance = comparables!.some((c) => c.distanceMeters != null);

  // Score basé sur quantité + récence + présence distance
  let s = 0;
  if (count >= 8) s += 40; else if (count >= 5) s += 30; else if (count >= 2) s += 15; else s += 5;
  if (hasDistance) s += 20;

  const nowMs = Date.now();
  const avgAgeMonths = comparables!.reduce((acc, c) => {
    if (!c.date) return acc + 24;
    return acc + (nowMs - new Date(c.date).getTime()) / (1000 * 60 * 60 * 24 * 30);
  }, 0) / count;

  if (avgAgeMonths <= 6)  s += 40;
  else if (avgAgeMonths <= 12) s += 30;
  else if (avgAgeMonths <= 24) s += 20;
  else s += 5;

  return { score: Math.min(100, s), count, hasDistance };
}

// ─────────────────────────────────────────────────────────────────────────────
// Verticales
// ─────────────────────────────────────────────────────────────────────────────

function computeInvestorData(input: MimmozaValuationInput, marketValue: number | null) {
  const surface = input.surface ?? null;
  let rentEstimate: number | null = null;

  if (input.expectedRent) {
    rentEstimate = input.expectedRent;
  } else if (input.market?.medianRentPerSqm && surface) {
    rentEstimate = Math.round(input.market.medianRentPerSqm * surface);
  }

  const reference = input.askingPrice ?? marketValue;
  let grossYield: number | null = null;
  let netYield:   number | null = null;

  if (rentEstimate && reference) {
    grossYield = parseFloat(((rentEstimate * 12 * 100) / reference).toFixed(2));
    netYield   = parseFloat(((rentEstimate * 12 * 0.77 * 100) / reference).toFixed(2));
  }

  return { rentEstimate, grossYield, netYield, investorValue: marketValue };
}

function computeMerchantData(input: MimmozaValuationInput, marketValue: number | null) {
  const resale = input.resalePriceTarget
    ?? (marketValue ? Math.round(marketValue * 1.12) : null);
  if (!resale) return { merchantValue: null };

  const works  = input.estimatedWorksAmount ?? 0;
  const fees   = Math.round(resale * 0.08);
  const margin = Math.round(resale * 0.15);
  return { merchantValue: resale - works - fees - margin };
}

function computeDeveloperData(input: MimmozaValuationInput): {
  developerValue: number | null;
  developerWarning: string | null;
} {
  if (!input.plu) return {
    developerValue: null,
    developerWarning: "Données PLU insuffisantes pour calculer une valeur promoteur fiable.",
  };
  const sdp      = input.plu.estimatedSdp;
  const prixSortie = input.market?.localPricePerSqm;
  if (!sdp || !prixSortie) return {
    developerValue: null,
    developerWarning: "SDP ou prix de sortie manquants — valeur promoteur non calculable.",
  };
  return { developerValue: Math.round(sdp * prixSortie * 0.15), developerWarning: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fonction principale
// ─────────────────────────────────────────────────────────────────────────────

export function computeMimmozaValuation(
  input: MimmozaValuationInput
): MimmozaValuationResult & {
  pricingDetail:       ValuationPricingDetail;
  confidenceBreakdown: ConfidenceBreakdown;
  marketPositionDetail: MarketPositionDetail;
  comparableScore:     ComparableScore;
} {
  const assetType  = resolveAssetType(input);
  const riskLevel  = resolveRiskLevel(input);
  const sources    = buildSourceStatus(input);

  const { marketValue, estimatedPricePerSqm, pricingDetail } = computeMarketValue(input);

  const confidenceScore  = computeValuationConfidence(input);
  const margin           = getUncertaintyMargin(confidenceScore);
  const lowEstimate      = marketValue ? Math.round(marketValue * (1 - margin)) : null;
  const highEstimate     = marketValue ? Math.round(marketValue * (1 + margin)) : null;

  const { opportunityScore, opportunityValue, opportunityLabel } =
    computeOpportunityScore(input, marketValue);

  const confidenceBreakdown  = buildConfidenceBreakdown(input);
  const marketPositionDetail = buildMarketPosition(input.askingPrice, marketValue);
  const comparableScore      = buildComparableScore(input.dvfComparables);

  let investorValue:  number | null | undefined;
  let merchantValue:  number | null | undefined;
  let developerValue: number | null | undefined;
  let rentEstimate:   number | null | undefined;
  let grossYield:     number | null | undefined;
  let netYield:       number | null | undefined;
  const extraWarnings: string[] = [];

  if (input.vertical === "investisseur") {
    const inv = computeInvestorData(input, marketValue);
    investorValue = inv.investorValue;
    rentEstimate  = inv.rentEstimate;
    grossYield    = inv.grossYield;
    netYield      = inv.netYield;
  }
  if (input.vertical === "rehabilitateur") {
    merchantValue = computeMerchantData(input, marketValue).merchantValue;
  }
  if (input.vertical === "promoteur") {
    const dev = computeDeveloperData(input);
    developerValue = dev.developerValue;
    if (dev.developerWarning) extraWarnings.push(dev.developerWarning);
  }

  const { recommendation, strengths, weaknesses, warnings } =
    buildValuationRecommendation(
      { opportunityScore, confidenceScore, riskLevel,
        grossYield: grossYield ?? null, merchantValue: merchantValue ?? null,
        developerValue: developerValue ?? null, marketValue, vertical: input.vertical },
      input
    );

  return {
    assetType, vertical: input.vertical,
    address: input.address, city: input.city,
    postalCode: input.postalCode, parcelId: input.parcelId,
    surface: input.surface ?? undefined,
    landSurface: input.landSurface ?? undefined,
    marketValue, lowEstimate, highEstimate, confidenceScore,
    opportunityScore, opportunityValue, opportunityLabel,
    investorValue, merchantValue, developerValue,
    rentEstimate, grossYield, netYield,
    estimatedPricePerSqm,
    localPricePerSqm: input.market?.localPricePerSqm ?? null,
    riskLevel, recommendation,
    strengths, weaknesses,
    warnings: [...warnings, ...extraWarnings],
    sources,
    raw: {
      dvf: input.dvfComparables, plu: input.plu,
      georisques: input.georisques, sitadel: input.sitadel,
      market: input.market, smartScore: input.smartScore,
    },
    // Nouveaux champs
    pricingDetail,
    confidenceBreakdown,
    marketPositionDetail,
    comparableScore,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Route analyse approfondie
// ─────────────────────────────────────────────────────────────────────────────

export function getDeepAnalysisRoute(vertical: MimmozaValuationInput["vertical"]): string {
  switch (vertical) {
    case "investisseur":   return "/marchand-de-bien/analyse";
    case "rehabilitateur": return "/rehabilitation/vue-ensemble";
    case "promoteur":      return "/promoteur/foncier";
  }
}