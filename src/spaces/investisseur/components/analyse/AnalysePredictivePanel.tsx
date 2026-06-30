import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../../../lib/supabaseClient";
import { useCopilotStore } from "../../../copilot/store/copilotStore";
import { buildPredictiveSnapshotForCopilot } from "../../../copilot/utils/buildPredictiveSnapshotForCopilot";
import { readMarchandSnapshot } from "../../../marchand/shared/marchandSnapshot.store";
import { usePredictiveAnalysis } from "../../hooks/usePredictiveAnalysis";
import { getEcbRatesAnalysis, type EcbRatesAnalysis } from "../../services/predictive/ecbRate.service";
import type {
  PredictiveDataSource,
  PredictiveEngineInput,
  PredictiveFiscalite,
  PredictiveGeorisques,
  PredictivePlu,
} from "../../services/predictive/predictive.types";
import {
  getPredictiveSitadelScore,
  type PredictiveSitadelResult,
} from "../../services/predictive/sitadelPredictive.service";
import { getInvestisseurSnapshot } from "../../shared/investisseurSnapshot.store";
import PredictiveDriversCard from "./PredictiveDriversCard";
import PredictiveExecutiveCard from "./PredictiveExecutiveCard";
import PredictiveOperationImpactCard from "./PredictiveOperationImpactCard";
import PredictiveProjectionChart from "./PredictiveProjectionChart";
import PredictiveScenariosTable from "./PredictiveScenariosTable";
import PredictiveSummaryCard from "./PredictiveSummaryCard";
import { userStorage } from "@/lib/storage/userScopedStorage";

// ── Helpers ──────────────────────────────────────────────────────────

function safeNum(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const p = parseFloat(v);
    if (Number.isFinite(p)) return p;
  }
  return undefined;
}

function firstNum(...args: unknown[]): number | undefined {
  for (const a of args) {
    const n = safeNum(a);
    if (n != null) return n;
  }
  return undefined;
}

function deepFirstNum(raw: unknown, keys: string[]): number | undefined {
  if (!isObj(raw)) return safeNum(raw);
  for (const key of keys) {
    const direct = safeNum((raw as Record<string, unknown>)[key]);
    if (direct != null) return direct;
    const nested = (raw as Record<string, unknown>)[key];
    if (isObj(nested)) {
      const n = firstNum(nested.score, nested.value, nested.valeur, nested.note, nested.indice, nested.percentile, nested.global);
      if (n != null) return n;
    }
  }
  return firstNum(
    (raw as Record<string, unknown>).score,
    (raw as Record<string, unknown>).value,
    (raw as Record<string, unknown>).valeur,
    (raw as Record<string, unknown>).global,
  );
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function extractDpeClass(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const m = /\b([A-G])\b/i.exec(String(raw));
  return m ? m[1].toUpperCase() : undefined;
}

function extractGeorisques(raw: unknown): PredictiveGeorisques | undefined {
  if (!isObj(raw)) return undefined;
  const g = raw as Record<string, unknown>;
  const result: PredictiveGeorisques = {};

  const inondObj   = isObj(g.inondation)        ? g.inondation        as Record<string, unknown> : null;
  const seismeObj  = isObj(g.seisme)             ? g.seisme            as Record<string, unknown> : null;
  const argilesObj = isObj(g.argiles)            ? g.argiles           as Record<string, unknown> : null;
  const cavitesObj = isObj(g.cavites)            ? g.cavites           as Record<string, unknown> : null;
  const radonObj   = isObj(g.radon)              ? g.radon             as Record<string, unknown> : null;
  const mvtObj     = isObj(g.mouvements_terrain) ? g.mouvements_terrain as Record<string, unknown> : null;

  const inondation =
    g.inondation ?? g.risqueInondation ?? g.flood ?? g.pprn ?? g.ppri ?? g.zone_inondable ??
    inondObj?.zone_inondable ?? inondObj?.ppri ??
    (inondObj?.risk_level != null && inondObj.risk_level !== "nul" ? true : undefined);
  if (inondation != null) result.inondation = Boolean(inondation);

  const sismique = firstNum(g.sismique, g.zoneSismique, g.zone_sismique, g.seismic, g.seismicZone, g.risqueSismique, seismeObj?.zone);
  if (sismique != null) result.sismique = Math.round(sismique);

  const retrait =
    g.retraitGonflement ?? g.retrait_gonflement ?? g.argile ?? g.argileux ?? g.clay_shrinkage ?? g.alea_retrait ??
    (argilesObj?.niveau_alea != null && argilesObj.niveau_alea !== "" && argilesObj.niveau_alea !== "Absence" ? true : undefined) ??
    (argilesObj?.risk_level != null && argilesObj.risk_level !== "nul" ? true : undefined);
  if (retrait != null) result.retraitGonflement = Boolean(retrait);

  const mvt =
    g.mouvementTerrain ?? g.mouvement_terrain ?? g.landslide ?? g.glissement ?? g.eboulement ??
    (mvtObj?.count != null && Number(mvtObj.count) > 0 ? true : undefined) ??
    (mvtObj?.risk_level != null && mvtObj.risk_level !== "nul" ? true : undefined);
  if (mvt != null) result.mouvementTerrain = Boolean(mvt);

  const cav =
    g.cavites ?? g.cavitesSouterraines ?? g.cavites_souterraines ?? g.sinkholes ?? g.karst ??
    (cavitesObj?.count != null && Number(cavitesObj.count) > 0 ? true : undefined) ??
    (cavitesObj?.risk_level != null && cavitesObj.risk_level !== "nul" ? true : undefined);
  if (cav != null) result.cavites = Boolean(cav);

  const radon = firstNum(g.radon, g.potentielRadon, g.potentiel_radon, g.radon_potential, radonObj?.classe_potentiel);
  if (radon != null) result.radon = Math.round(radon);

  return Object.keys(result).length > 0 ? result : undefined;
}

function extractPlu(raw: unknown): PredictivePlu | undefined {
  if (!isObj(raw)) return undefined;
  const p = raw as Record<string, unknown>;
  const zone =
    (typeof p.zone === "string" ? p.zone : undefined) ??
    (typeof p.zonePlu === "string" ? p.zonePlu : undefined) ??
    (typeof p.zone_plu === "string" ? p.zone_plu : undefined) ??
    (typeof p.zoneCode === "string" ? p.zoneCode : undefined) ??
    (typeof p.typeZone === "string" ? p.typeZone : undefined);
  if (!zone) return undefined;
  return {
    zone,
    libelle: (typeof p.libelle === "string" ? p.libelle : undefined) ?? (typeof p.libelleZone === "string" ? p.libelleZone : undefined),
    hauteurMax: firstNum(p.hauteurMax, p.hmax, p.hauteur_max),
    empriseSol: firstNum(p.empriseSol, p.ces, p.emprise_sol),
    cos: firstNum(p.cos, p.coefficient_occupation_sol),
  };
}

function computeDemographieScoreFromRaw(raw: unknown): number | undefined {
  if (!isObj(raw)) return undefined;
  const d = raw as Record<string, unknown>;
  const pctFamilles = safeNum(d.pct_familles);
  const pctMoins15  = safeNum(d.pct_moins_15);
  const pctVacants  = safeNum(d.pct_logements_vacants);
  if (pctFamilles == null && pctMoins15 == null && pctVacants == null) return undefined;
  let score = 50;
  if (pctFamilles != null) score += (pctFamilles - 30) * 0.6;
  if (pctMoins15  != null) score += (pctMoins15  - 15) * 1.0;
  if (pctVacants  != null) score -= (pctVacants  -  5) * 2.0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function mapFiscalRegime(regime: string | undefined): PredictiveFiscalite["regime"] | undefined {
  switch (regime) {
    case "lmnp_reel":  return "lmnp_reel";
    case "lmnp_micro": return "lmnp_micro";
    case "sci_is":     return "sci_is";
    case "sci_ir":     return "sci_ir";
    case "pinel":      return "pinel";
    case "nu_micro":
    case "nu_reel":    return "nu";
    default:           return undefined;
  }
}

// ── DPE ADEME state ───────────────────────────────────────────────────

interface DpeAdemeState {
  status: "idle" | "loading" | "found" | "not_found" | "error";
  dpe: string | null;
  fiabilite?: "haute" | "moyenne" | "faible";
  consoEpM2?: number;
  emissionsGesM2?: number;
  dateReception?: string;
}

// ── V2 Manual config ──────────────────────────────────────────────────

interface V2ManualConfig {
  dpe?: string;
  loyerMedianM2?: number;
}

const V2_CONFIG_PREFIX = "mimmoza_predictive_v2_";

function loadV2Config(dealId: string): V2ManualConfig {
  try { const raw = userStorage.getItem(V2_CONFIG_PREFIX + dealId); return raw ? JSON.parse(raw) : {}; }
  catch { return {}; }
}

function saveV2Config(dealId: string, cfg: V2ManualConfig) {
  try { userStorage.setItem(V2_CONFIG_PREFIX + dealId, JSON.stringify(cfg)); } catch { /* noop */ }
}

// ── Constants ─────────────────────────────────────────────────────────

const HORIZONS: { value: number; label: string }[] = [
  { value: 6,  label: "6 mois"  },
  { value: 12, label: "12 mois" },
  { value: 18, label: "18 mois" },
  { value: 24, label: "24 mois" },
  { value: 36, label: "36 mois" },
  { value: 60, label: "5 ans"   },
];

const DPE_OPTIONS = ["A", "B", "C", "D", "E", "F", "G"] as const;
const DPE_COLORS: Record<string, string> = {
  A: "bg-emerald-100 text-emerald-800", B: "bg-green-100 text-green-800",
  C: "bg-lime-100 text-lime-800",       D: "bg-yellow-100 text-yellow-800",
  E: "bg-orange-100 text-orange-800",   F: "bg-red-100 text-red-800",
  G: "bg-rose-100 text-rose-900",
};
const DPE_FIABILITE_LABEL: Record<string, string> = {
  haute: "Fiabilité haute", moyenne: "Fiabilité moyenne", faible: "Fiabilité faible",
};

// ── Props ─────────────────────────────────────────────────────────────

interface DealInputs {
  dealId: string;
  label: string;
  address: string;
  zipCode: string;
  city: string;
  prixAchat: number;
  surfaceM2: number;
  prixReventeCible: number;
  dpeNote: string;
}

interface Props {
  deal: DealInputs;
  travauxEstime?: number;
}

// ── extractRealInput ──────────────────────────────────────────────────

function extractRealInput(
  deal: DealInputs,
  travauxEstime: number | undefined,
  horizonDetention: number,
  v2Manual: V2ManualConfig,
  dpeFromAdeme: string | null,
): PredictiveEngineInput {
  const dealId  = deal.dealId;
  const snap    = readMarchandSnapshot();
   
  const snapAny = snap as any;

  const mr         = (snap.marcheRisquesByDeal[dealId] ?? null) as Record<string, unknown> | null;
  const mrData     = isObj(mr?.data) ? (mr!.data as Record<string, unknown>) : (isObj(mr) ? mr : null);
  const mrCore     = isObj((mrData as { core?: unknown } | null)?.core) ? (mrData as { core: Record<string, unknown> }).core : null;
  const mrSpecific = isObj((mrData as { specific?: unknown } | null)?.specific) ? (mrData as { specific: Record<string, unknown> }).specific : null;
  const mrScores   = (isObj((mrData as { scores?: unknown } | null)?.scores) ? (mrData as { scores: Record<string, unknown> }).scores : isObj((mr as { breakdown?: unknown } | null)?.breakdown) ? (mr as { breakdown: Record<string, unknown> }).breakdown : null) as Record<string, unknown> | null;
  const scoringDetails = isObj((mrData as { scoring_details?: unknown } | null)?.scoring_details) ? (mrData as { scoring_details: Record<string, unknown> }).scoring_details : null;

  const dvfRaw = (mrCore as { dvf?: unknown } | null)?.dvf ?? (mrData as { dvf?: unknown } | null)?.dvf ?? (mr as { dvf?: unknown } | null)?.dvf ?? null;
  const dvfObj = isObj(dvfRaw) ? dvfRaw : null;
  const dvfPrixM2Median   = firstNum(dvfObj?.prix_m2_median, dvfObj?.prixM2Median, dvfObj?.medianPriceM2, dvfObj?.median_price_m2);
  const dvfNbTransactions = firstNum(dvfObj?.nb_transactions, dvfObj?.nbTransactions, dvfObj?.count, dvfObj?.total);

  // DVF évolution — v1.3.8/v1.3.21 : priorité à evolution_prix_pct
  const dvfEvolution = firstNum(
    dvfObj?.evolution_prix_pct,
    (mrData as { dvf?: Record<string, unknown> } | null)?.dvf?.evolution_prix_pct,
    (mr    as { dvf?: Record<string, unknown> } | null)?.dvf?.evolution_prix_pct,
    dvfObj?.evolution_pct,
    dvfObj?.evolutionPct,
    dvfObj?.evolution_annuelle,
    dvfObj?.evolutionAnnuelle,
    dvfObj?.variation_pct,
    (mrCore as { evolution_prix?: unknown }     | null)?.evolution_prix,
    (mrCore as { evolution_prix_pct?: unknown } | null)?.evolution_prix_pct,
    firstNum(
      (mrSpecific as { marche_immobilier?: { evolution_prix_pct?: unknown } } | null)?.marche_immobilier?.evolution_prix_pct,
      (mrSpecific as { indicateurs_marche?: { evolution_prix_pct?: unknown } } | null)?.indicateurs_marche?.evolution_prix_pct,
    ),
    (mrData as { evolution_prix_pct?: unknown } | null)?.evolution_prix_pct,
  );

  const hasDvf = dvfPrixM2Median != null || dvfNbTransactions != null;

  const scoreGlobal = firstNum(mr?.scoreGlobal, mr?.score, (mrScores as { global?: unknown } | null)?.global);
  const hasScores   = scoreGlobal != null;
  const marketScores = hasScores ? {
    global:         scoreGlobal,
    demande:        firstNum((mrScores as { demande?: unknown } | null)?.demande),
    offre:          firstNum((mrScores as { offre?: unknown } | null)?.offre),
    accessibilite:  firstNum((mrScores as { accessibilite?: unknown } | null)?.accessibilite),
    environnement:  firstNum((mrScores as { environnement?: unknown } | null)?.environnement),
    liquidite:      firstNum((mrScores as { liquidite?: unknown } | null)?.liquidite),
    opportunity:    firstNum((mrScores as { opportunity?: unknown } | null)?.opportunity),
    pressionRisque: firstNum((mrScores as { pressionRisque?: unknown } | null)?.pressionRisque),
  } : undefined;

  const bpeRaw   = (mrCore as { bpe?: unknown } | null)?.bpe ?? (mrData as { bpe?: unknown } | null)?.bpe ?? null;
  const bpeObj   = isObj(bpeRaw) ? bpeRaw : null;
  const bpeScore = firstNum(bpeObj?.score_v2, bpeObj?.score);
  const hasBpe   = bpeScore != null;

  const rentaRaw      = (snap.rentabiliteByDeal[dealId] ?? null) as Record<string, unknown> | null;
  const rentaInputs   = isObj((rentaRaw as { inputs?: unknown } | null)?.inputs) ? ((rentaRaw as { inputs: Record<string, unknown> }).inputs) : null;
  const rentaComputed = isObj((rentaRaw as { computed?: unknown } | null)?.computed) ? ((rentaRaw as { computed: Record<string, unknown> }).computed) : isObj((rentaRaw as { results?: unknown } | null)?.results) ? ((rentaRaw as { results: Record<string, unknown> }).results) : null;

  const rendementBrut   = firstNum(rentaComputed?.rendementBrut, rentaComputed?.yieldBrut);
  const rendementNet    = firstNum(rentaComputed?.rendementNet, rentaComputed?.yieldNet);
  const cashflowMensuel = firstNum(rentaComputed?.cashflowMensuel, rentaComputed?.cashflow);
  const margeBrute      = firstNum(rentaComputed?.margeBrute, (rentaComputed as { grossMargin?: unknown } | null)?.grossMargin);
  const margeBrutePct   = firstNum(rentaComputed?.margeBrutePct, (rentaComputed as { grossMarginPct?: unknown } | null)?.grossMarginPct);
  const hasRenta = rendementBrut != null || margeBrute != null || margeBrutePct != null;

  const investSnap    = getInvestisseurSnapshot();
  const investPid     = investSnap.activeProjectId;
  const investTravaux = investPid ? investSnap.projects[investPid]?.execution?.travaux?.computed : undefined;
  const travauxFinal  = travauxEstime
    ?? firstNum(investTravaux?.totalWithBuffer, investTravaux?.total)
    ?? firstNum(rentaInputs?.travauxUtilises, rentaInputs?.travauxEstimes, rentaInputs?.travaux)
    ?? 0;

  const fraisAnnexes       = Math.round(deal.prixAchat * 0.025);
  const tauxBcePctFallback = firstNum(rentaInputs?.tauxSansRisque, rentaInputs?.tauxBce, rentaComputed?.tauxBce);

  const rawDealSnap = isObj(snapAny?.dealsByDeal?.[dealId]) ? (snapAny.dealsByDeal[dealId] as Record<string, unknown>) : isObj(snapAny?.deals?.[dealId]) ? (snapAny.deals[dealId] as Record<string, unknown>) : null;
  const dpeFromSnap = extractDpeClass(
    (typeof rawDealSnap?.dpe === "string" ? rawDealSnap.dpe : undefined) ??
    (typeof rawDealSnap?.dpeNote === "string" ? rawDealSnap.dpeNote : undefined) ??
    (typeof rawDealSnap?.classeEnergetique === "string" ? rawDealSnap.classeEnergetique : undefined) ??
    deal.dpeNote,
  );
  const dpeFromData = extractDpeClass(
    (typeof (mrSpecific as { dpe?: unknown } | null)?.dpe === "string" ? String((mrSpecific as { dpe: string }).dpe) : undefined) ??
    (typeof (scoringDetails as { dpe?: { label?: unknown } } | null)?.dpe?.label === "string" ? String((scoringDetails as { dpe: { label: string } }).dpe.label) : undefined),
  );
  const dpe = v2Manual.dpe ?? dpeFromAdeme ?? dpeFromSnap ?? dpeFromData;

  const marchandActiveDealId = snap.activeDealId;

  const georisquesFromDedicatedKey = (() => {
    try {
      const tryKeys = [
        `mimmoza.georisques.${dealId}`,
        marchandActiveDealId ? `mimmoza.georisques.${marchandActiveDealId}` : null,
      ].filter(Boolean) as string[];
      for (const k of tryKeys) {
        const raw = userStorage.getItem(k);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (typeof parsed === "object" && parsed !== null) return parsed as Record<string, unknown>;
      }
    } catch { /* noop */ }
    return null;
  })();

  const dueDiligenceGeorisques =
    (isObj(snapAny?.dueDiligenceByDeal?.[dealId]?.state?.georisques) ? snapAny.dueDiligenceByDeal[dealId].state.georisques as Record<string, unknown> : null) ??
    (marchandActiveDealId && isObj(snapAny?.dueDiligenceByDeal?.[marchandActiveDealId]?.state?.georisques) ? snapAny.dueDiligenceByDeal[marchandActiveDealId].state.georisques as Record<string, unknown> : null);

  const georisquesRaw =
    georisquesFromDedicatedKey ??
    (mrSpecific as { georisques?: unknown } | null)?.georisques ??
    (mrSpecific as { risques?: unknown } | null)?.risques ??
    (mrSpecific as { risques_naturels?: unknown } | null)?.risques_naturels ??
    (mrCore as { georisques?: unknown } | null)?.georisques ??
    (mrData as { georisques?: unknown } | null)?.georisques ??
    dueDiligenceGeorisques ??
    (isObj(snapAny?.risquesByDeal?.[dealId]) ? (snapAny.risquesByDeal[dealId] as Record<string, unknown>) : null) ??
    null;

  const georisques = extractGeorisques(georisquesRaw);

  const pluRaw =
    (mrSpecific as { plu?: unknown } | null)?.plu ??
    (mrSpecific as { zonage?: unknown } | null)?.zonage ??
    (mrCore as { plu?: unknown } | null)?.plu ??
    (mrData as { plu?: unknown } | null)?.plu ??
    (isObj(snapAny?.pluByDeal?.[dealId]) ? (snapAny.pluByDeal[dealId] as Record<string, unknown>) : null) ??
    (isObj(rawDealSnap?.plu) ? rawDealSnap.plu : null) ??
    null;
  const plu = extractPlu(pluRaw);

  const loyerFromSnap = firstNum(
    (mrSpecific as { loyer_median?: unknown } | null)?.loyer_median,
    (mrSpecific as { loyerMedian?: unknown } | null)?.loyerMedian,
    rentaInputs?.loyerMarcheM2, rentaInputs?.loyerMedian,
    rentaInputs?.loyerM2Reference, rentaInputs?.loyerM2Marche, rentaInputs?.loyerM2,
    (mrCore as { loyerMedian?: unknown } | null)?.loyerMedian,
  );
  const loyerMedianZoneRaw = v2Manual.loyerMedianM2 ?? loyerFromSnap;
  const loyerMedianZone = loyerMedianZoneRaw != null && deal.surfaceM2 > 0 && loyerMedianZoneRaw > 500
    ? Math.round((loyerMedianZoneRaw / deal.surfaceM2) * 10) / 10
    : loyerMedianZoneRaw;

  const demographieRaw = (mrSpecific as { demographie?: unknown } | null)?.demographie;
  const demographieScoreRaw =
    firstNum(
      deepFirstNum(demographieRaw, ["score", "global", "indice", "note"]),
      deepFirstNum((mrCore as { insee?: unknown } | null)?.insee, ["score", "global"]),
      (mrScores as { demographie?: unknown } | null)?.demographie,
      (scoringDetails as { demographie?: unknown } | null)?.demographie,
      (mrData as { demographieScore?: unknown } | null)?.demographieScore,
    ) ?? computeDemographieScoreFromRaw(demographieRaw);
  const demographieScore = demographieScoreRaw != null && demographieScoreRaw >= 0 && demographieScoreRaw <= 100 ? demographieScoreRaw : undefined;

  const regimeStr = (rentaInputs?.regime ?? rentaInputs?.fiscalRegime ?? rentaInputs?.strategy) as string | undefined;
  const fiscalRegimeMapped = mapFiscalRegime(regimeStr);
  const fiscalite: PredictiveFiscalite | undefined = fiscalRegimeMapped
    ? {
        regime: fiscalRegimeMapped,
        tauxMarginalImposition: firstNum(rentaInputs?.tmi, rentaInputs?.tauxMarginalImposition, rentaInputs?.tauxImposition),
        deficitFoncierEstime: firstNum(rentaInputs?.deficitFoncier, rentaInputs?.deficitFoncierEstime),
        amortissementAnnuel: firstNum(rentaInputs?.amortissementAnnuel, rentaInputs?.amortissement),
      }
    : undefined;

  if (import.meta.env.DEV) {
    console.log("[DVF DEBUG] dvfObj:", dvfObj);
    console.log("[DVF DEBUG] evolution_prix_pct →", dvfObj?.evolution_prix_pct, "/ dvfEvolution →", dvfEvolution);
    console.log("[SITADEL DEBUG] mrSpecific", mrSpecific);
    console.log("[GEORISQUES DEBUG] georisquesRaw →", georisquesRaw);
    console.log("[GEORISQUES DEBUG] georisques extracted →", georisques);
  }

  return {
    surfaceM2:        deal.surfaceM2 || 50,
    acquisitionPrice: deal.prixAchat || 100_000,
    codePostal:       deal.zipCode || "75001",
    typeBien:         "appartement",
    travauxEstime:    travauxFinal,
    fraisAnnexes,
    ...(hasDvf ? { dvf: { prixM2Median: dvfPrixM2Median, nbTransactions: dvfNbTransactions, evolutionPctAnnuelle: dvfEvolution } } : {}),
    ...(marketScores ? { marketScores } : {}),
    ...(hasRenta ? { rentabilite: { rendementBrut, rendementNet, cashflowMensuel, margeBrute, margeBrutePct, prixReventeCible: deal.prixReventeCible > 0 ? deal.prixReventeCible : undefined } } : {}),
    ...(hasBpe ? { bpe: { score: bpeScore } } : {}),
    ...(tauxBcePctFallback != null ? { tauxBcePct: tauxBcePctFallback } : {}),
    ...(dpe ? { dpe } : {}),
    ...(georisques ? { georisques } : {}),
    ...(plu ? { plu } : {}),
    ...(loyerMedianZone != null ? { loyerMedianZone } : {}),
    ...(demographieScore != null ? { demographieScore } : {}),
    ...(fiscalite ? { fiscalite } : {}),
    horizonDetention,
  };
}

// ── V2 Debug Badge ────────────────────────────────────────────────────

function V2DebugBadge({ sourcesCount }: { sourcesCount: number }) {
  if (!import.meta.env.DEV) return null;
  const isV2 = sourcesCount >= 15;
  return (
    <div className={["rounded-xl px-4 py-2.5 text-xs font-mono flex items-center gap-3 flex-wrap",
      isV2 ? "bg-emerald-950 text-emerald-300 ring-1 ring-emerald-700" : "bg-rose-950 text-rose-300 ring-1 ring-rose-700"].join(" ")}>
      <span className="font-bold text-sm">{isV2 ? "✅ ENGINE V2" : "❌ ENGINE V1"}</span>
      <span className="opacity-70">dataSources: {sourcesCount}/17</span>
      <span className="opacity-50">{isV2 ? "→ predictive.engine.ts V2 chargé" : "→ Remplacer predictive.engine.ts"}</span>
    </div>
  );
}

// ── V2 Manual Inputs Panel ────────────────────────────────────────────

function V2ManualInputsPanel({
  deal, config, dpeAdeme, onChange,
}: {
  deal: DealInputs;
  config: V2ManualConfig;
  dpeAdeme: DpeAdemeState;
  onChange: (cfg: V2ManualConfig) => void;
}) {
  const [open, setOpen]         = useState(false);
  const [loyerStr, setLoyerStr] = useState(config.loyerMedianM2 != null ? String(config.loyerMedianM2) : "");

  useEffect(() => {
    setLoyerStr(config.loyerMedianM2 != null ? String(config.loyerMedianM2) : "");
  }, [deal.dealId, config.loyerMedianM2]);

  const handleDpe = (d: string) => {
    const next = { ...config, dpe: d === config.dpe ? undefined : d };
    onChange(next); saveV2Config(deal.dealId, next);
  };
  const handleLoyerBlur = () => {
    const val = parseFloat(loyerStr);
    const next = { ...config, loyerMedianM2: Number.isFinite(val) && val > 0 ? val : undefined };
    onChange(next); saveV2Config(deal.dealId, next);
  };

  return (
    <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50/50">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
        <span className="flex items-center gap-2 flex-wrap">
          <span>✏️</span>
          <span>Enrichissements manuels V2</span>
          {dpeAdeme.status === "loading" && (
            <span className="inline-flex items-center gap-1 text-[10px] text-sky-600 bg-sky-50 ring-1 ring-sky-200 px-2 py-0.5 rounded-full">
              <span className="h-2 w-2 rounded-full border border-sky-400 border-t-transparent animate-spin" />DPE ADEME…
            </span>
          )}
          {dpeAdeme.status === "found" && dpeAdeme.dpe && !config.dpe && (
            <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ring-1 ${DPE_COLORS[dpeAdeme.dpe]} ring-current/20`}>
              DPE {dpeAdeme.dpe} — ADEME ✓
            </span>
          )}
        </span>
        <span className="text-gray-400 flex-shrink-0">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="border-t border-gray-200 px-5 pb-5 pt-4 space-y-5">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Classe DPE</div>
              {dpeAdeme.status === "error" && <span className="text-[10px] text-rose-500">ADEME indisponible</span>}
            </div>
            {dpeAdeme.status === "found" && dpeAdeme.dpe && !config.dpe && (
              <div className={`mb-3 rounded-xl px-4 py-3 ring-1 ring-current/10 ${DPE_COLORS[dpeAdeme.dpe]}`}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-bold">Classe {dpeAdeme.dpe} — détecté via ADEME</div>
                    <div className="text-xs mt-0.5 opacity-80 flex items-center gap-3 flex-wrap">
                      {dpeAdeme.fiabilite && <span>{DPE_FIABILITE_LABEL[dpeAdeme.fiabilite]}</span>}
                      {dpeAdeme.consoEpM2 != null && <span>{Math.round(dpeAdeme.consoEpM2)} kWh EP/m²/an</span>}
                      {dpeAdeme.emissionsGesM2 != null && <span>{Math.round(dpeAdeme.emissionsGesM2)} kgCO₂/m²/an</span>}
                    </div>
                  </div>
                  <span className="text-xl font-black opacity-60">{dpeAdeme.dpe}</span>
                </div>
              </div>
            )}
            <div className="flex gap-2 flex-wrap">
              {DPE_OPTIONS.map(d => (
                <button key={d} onClick={() => handleDpe(d)}
                  className={["w-10 h-10 rounded-lg text-sm font-bold transition-all",
                    config.dpe === d ? `ring-2 ring-offset-1 ring-gray-700 ${DPE_COLORS[d]}`
                    : dpeAdeme.dpe === d && !config.dpe ? `ring-2 ring-offset-1 ring-sky-400 ${DPE_COLORS[d]} opacity-80`
                    : "bg-white ring-1 ring-gray-200 text-gray-600 hover:ring-gray-400"].join(" ")}
                >{d}</button>
              ))}
              {(config.dpe || dpeAdeme.status === "found") && (
                <button onClick={() => { const next = { ...config, dpe: undefined }; onChange(next); saveV2Config(deal.dealId, next); }}
                  className="px-3 h-10 rounded-lg text-xs text-gray-400 ring-1 ring-gray-200 hover:ring-rose-300 hover:text-rose-500 transition-colors">
                  {config.dpe ? "✕ Effacer override" : "✕ Ignorer ADEME"}
                </button>
              )}
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">
              Loyer médian de zone
              <span className="ml-2 text-[10px] font-normal text-gray-400 normal-case">API CLAMEUR/ANIL à venir</span>
            </div>
            <div className="flex items-center gap-3">
              <input type="number" min="0" step="0.5" placeholder="ex: 14"
                value={loyerStr} onChange={e => setLoyerStr(e.target.value)} onBlur={handleLoyerBlur}
                className="w-36 rounded-lg border border-gray-300 px-3 py-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <span className="text-xs text-gray-500">€/m²/mois</span>
              {deal.surfaceM2 > 0 && parseFloat(loyerStr) > 0 && (
                <span className="text-xs text-gray-400">
                  ≈ {Math.round(parseFloat(loyerStr) * deal.surfaceM2).toLocaleString("fr-FR")} €/mois
                </span>
              )}
            </div>
          </div>
          <p className="text-[10px] text-gray-400 border-t border-gray-200 pt-3">
            Valeurs stockées localement par deal · Priorité sur la détection automatique.
          </p>
        </div>
      )}
    </div>
  );
}

// ── DataSourcesBar ────────────────────────────────────────────────────

const SOURCE_HINTS: Record<string, { label: string; type: "manual" | "study" | "dev" }> = {
  rentabilite:   { label: "Remplir l'onglet Rentabilité",          type: "manual" },
  travaux:       { label: "Remplir Exécution → Travaux",           type: "manual" },
  loyer_median:  { label: "Saisie manuelle ci-dessous",            type: "manual" },
  plu:           { label: "Lancer l'étude Foncier / PLU",          type: "study"  },
  dvf_evolution: { label: "Relancer l'étude Marché / Risques",     type: "study"  },
};

const HINT_STYLES: Record<string, string> = {
  manual: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  study:  "bg-sky-50 text-sky-700 ring-sky-200",
  dev:    "bg-gray-100 text-gray-500 ring-gray-200",
};

function DataSourcesBar({ sources }: { sources: PredictiveDataSource[] }) {
  const available = sources.filter(s => s.available);
  const missing   = sources.filter(s => !s.available);
  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-5">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Sources de données</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {available.length}/{sources.length} sources actives —{" "}
            {available.length >= 10 ? "analyse enrichie V2" : available.length >= 6 ? "analyse fiable" : available.length >= 3 ? "analyse partielle" : "données limitées"}
          </p>
        </div>
        <span className={["inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
          available.length >= 6 ? "bg-emerald-50 text-emerald-700" : available.length >= 3 ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700"].join(" ")}>
          <span className={["h-1.5 w-1.5 rounded-full",
            available.length >= 6 ? "bg-emerald-500" : available.length >= 3 ? "bg-amber-500" : "bg-rose-500"].join(" ")} />
          {available.length >= 10 ? "Données réelles V2" : available.length >= 6 ? "Données réelles" : available.length >= 3 ? "Partiel" : "Limité"}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {sources.map(s => {
          const hint = !s.available ? SOURCE_HINTS[s.key] : undefined;
          return (
            <div key={s.key} className={["flex items-center gap-2 rounded-lg px-3 py-2 text-xs",
              s.available ? "bg-emerald-50/50 ring-1 ring-emerald-200/50 text-emerald-800" : "bg-gray-50 ring-1 ring-gray-200/50 text-gray-400"].join(" ")}>
              <span className={["h-1.5 w-1.5 rounded-full shrink-0", s.available ? "bg-emerald-500" : "bg-gray-300"].join(" ")} />
              <span className="font-medium truncate">{s.label}</span>
              {s.detail && s.available && (
                <span className="ml-auto text-[10px] text-emerald-600 shrink-0">{s.detail}</span>
              )}
              {hint && (
                <span className={["ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded ring-1 shrink-0 whitespace-nowrap", HINT_STYLES[hint.type]].join(" ")}>
                  {hint.label}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {missing.some(s => SOURCE_HINTS[s.key]?.type === "manual") && (
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <span className="text-[10px] text-gray-400">Légende :</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded ring-1 bg-emerald-50 text-emerald-700 ring-emerald-200">Saisie manuelle</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded ring-1 bg-sky-50 text-sky-700 ring-sky-200">Étude à lancer</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded ring-1 bg-gray-100 text-gray-500 ring-gray-200">À développer</span>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────

export default function AnalysePredictivePanel({ deal, travauxEstime }: Props) {
  const { snapshot, status, error, compute } = usePredictiveAnalysis();
  const setContextHints = useCopilotStore((s) => s.setContextHints);

  const [ecbAnalysis, setEcbAnalysis]           = useState<EcbRatesAnalysis | null>(null);
  const [horizonDetention, setHorizonDetention] = useState<number>(12);
  const [v2Manual, setV2Manual]                 = useState<V2ManualConfig>(() => loadV2Config(deal.dealId));
  const [dpeAdeme, setDpeAdeme]                 = useState<DpeAdemeState>({ status: "idle", dpe: null });
  const ademeAbortRef = useRef<(() => void) | null>(null);
  const [sitadelResult, setSitadelResult]       = useState<PredictiveSitadelResult | null>(null);

  useEffect(() => { setV2Manual(loadV2Config(deal.dealId)); }, [deal.dealId]);
  useEffect(() => { getEcbRatesAnalysis().then(setEcbAnalysis); }, []);

  useEffect(() => {
    let cancelled = false;
    setSitadelResult(null);
     
    const snapAny = readMarchandSnapshot() as any;
    const mr      = snapAny?.marcheRisquesByDeal?.[deal.dealId] ?? null;
    const mrData  = isObj(mr?.data) ? mr.data : (isObj(mr) ? mr : null);
    const mrSpecificForSitadel: Record<string, unknown> | null =
      isObj(mrData?.specific) ? (mrData.specific as Record<string, unknown>) : null;
    getPredictiveSitadelScore({ city: deal.city || undefined, zipCode: deal.zipCode || undefined, mrSpecific: mrSpecificForSitadel })
      .then(result => { if (!cancelled) setSitadelResult(result); })
      .catch(err => { console.error("[PREDICTIVE SITADEL] fetch error", err); if (!cancelled) setSitadelResult({ available: false }); });
    return () => { cancelled = true; };
  }, [deal.city, deal.zipCode, deal.dealId]);

  useEffect(() => {
    ademeAbortRef.current?.();
    let cancelled = false;
    ademeAbortRef.current = () => { cancelled = true; };
    const dpeFromSnap = extractDpeClass(deal.dpeNote);
    if (dpeFromSnap) { setDpeAdeme({ status: "idle", dpe: null }); return; }
    if (!deal.address || !deal.zipCode) { setDpeAdeme({ status: "idle", dpe: null }); return; }
    setDpeAdeme({ status: "loading", dpe: null });
    supabase.functions.invoke("dpe-ademe-v1", {
      body: { address: deal.address, codePostal: deal.zipCode, city: deal.city || undefined, surfaceM2: deal.surfaceM2 > 0 ? deal.surfaceM2 : undefined },
    }).then(({ data, error: fnErr }) => {
      if (cancelled) return;
      if (fnErr || !data?.ok) { setDpeAdeme({ status: "error", dpe: null }); return; }
      if (!data.dpe) { setDpeAdeme({ status: "not_found", dpe: null }); return; }
      setDpeAdeme({ status: "found", dpe: data.dpe, fiabilite: data.fiabilite, consoEpM2: data.data?.consoEpM2, emissionsGesM2: data.data?.emissionsGesM2, dateReception: data.data?.dateReception });
    }).catch(() => { if (!cancelled) setDpeAdeme({ status: "error", dpe: null }); });
    return () => { cancelled = true; };
  }, [deal.dealId, deal.address, deal.zipCode, deal.city, deal.surfaceM2, deal.dpeNote]);

  const handleV2Change = useCallback((cfg: V2ManualConfig) => setV2Manual(cfg), []);

  const engineInput = useMemo(() => {
    const dpeFromAdeme = dpeAdeme.status === "found" ? dpeAdeme.dpe : null;
    const base = extractRealInput(deal, travauxEstime, horizonDetention, v2Manual, dpeFromAdeme);
    if (ecbAnalysis) {
      base.tauxBcePct  = ecbAnalysis.refinancingRate;
      base.ecbAnalysis = { pressureScore: ecbAnalysis.pressureScore, pressureLabel: ecbAnalysis.pressureLabel, trend: ecbAnalysis.trend, interpretation: ecbAnalysis.interpretation, refinancingRate: ecbAnalysis.refinancingRate, source: ecbAnalysis.source };
    }
    if (sitadelResult?.available && sitadelResult.score != null) {
      base.sitadelConcurrence = Math.max(0, Math.min(100, sitadelResult.score));
    }
    return base;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal.dealId, deal.prixAchat, deal.surfaceM2, deal.zipCode, deal.prixReventeCible, deal.dpeNote,
      travauxEstime, ecbAnalysis, horizonDetention, v2Manual, dpeAdeme.dpe, dpeAdeme.status, sitadelResult]);

  useEffect(() => { compute(engineInput); }, [engineInput, compute]);

  // ── LOT 6 : synchronisation du snapshot prédictif dans le store Copilot ──
  // Dès que le moteur prédictif a calculé son snapshot (sources, DPE, Sitadel…),
  // on le pousse dans contextHints pour que buildContext() l'injecte automatiquement.
  useEffect(() => {
    if (!snapshot) return;
    const activeDpe    = v2Manual.dpe ?? (dpeAdeme.status === "found" ? dpeAdeme.dpe ?? undefined : undefined) ?? engineInput.dpe;
    const activeDpeSrc = v2Manual.dpe ? "manual" : dpeAdeme.status === "found" ? "ademe" : engineInput.dpe ? "snap" : undefined;

    const ps = buildPredictiveSnapshotForCopilot({
      dealId:            deal.dealId,
      horizonMois:       horizonDetention,
      bceRate:           ecbAnalysis?.refinancingRate,
      bcePressureLabel:  ecbAnalysis?.pressureLabel,
      sitadelScore:      sitadelResult?.available && sitadelResult.score != null ? sitadelResult.score : undefined,
      demographieScore:  engineInput.demographieScore,
      loyerMedianZone:   v2Manual.loyerMedianM2 ?? engineInput.loyerMedianZone,
      dpe:               activeDpe,
      dpeSource:         activeDpeSrc,
      fiscalRegime:      engineInput.fiscalite?.regime,
      sourcesCount:      snapshot.dataSources.filter(s => s.available).length,
    });

    if (ps) {
      setContextHints({ predictive_snapshot: ps });
    }
  }, [
    snapshot,
    deal.dealId,
    horizonDetention,
    ecbAnalysis,
    sitadelResult,
    engineInput.demographieScore,
    engineInput.loyerMedianZone,
    engineInput.dpe,
    engineInput.fiscalite?.regime,
    v2Manual.dpe,
    v2Manual.loyerMedianM2,
    dpeAdeme.status,
    dpeAdeme.dpe,
    setContextHints,
  ]);

  if (status === "computing" || status === "idle") {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-sky-200 border-t-sky-600" />
          <div className="text-sm text-gray-500">Calcul des projections en cours…</div>
        </div>
      </div>
    );
  }

  if (status === "error" || !snapshot) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center">
        <div className="text-3xl mb-3">⚠️</div>
        <h3 className="text-sm font-semibold text-red-800 mb-1">Erreur d'analyse prédictive</h3>
        <p className="text-xs text-red-600">{error || "Impossible de calculer les projections."}</p>
      </div>
    );
  }

  const hasDvf      = !!engineInput.dvf?.prixM2Median;
  const hasScores   = !!engineInput.marketScores?.global;
  const hasRealData = hasDvf || hasScores;

  const v2Badges = [
    engineInput.dpe                && { label: `DPE ${engineInput.dpe}${dpeAdeme.status === "found" && !v2Manual.dpe ? " (ADEME)" : ""}`, color: "bg-indigo-50 text-indigo-600 ring-indigo-200" },
    engineInput.georisques         && { label: "Géorisques",                        color: "bg-rose-50 text-rose-600 ring-rose-200" },
    engineInput.plu?.zone          && { label: `PLU ${engineInput.plu.zone}`,       color: "bg-emerald-50 text-emerald-600 ring-emerald-200" },
    engineInput.loyerMedianZone    && { label: `Loyer ${engineInput.loyerMedianZone} €/m²`, color: "bg-sky-50 text-sky-600 ring-sky-200" },
    engineInput.demographieScore   && { label: `Démo ${Math.round(engineInput.demographieScore)}/100`, color: "bg-violet-50 text-violet-600 ring-violet-200" },
    engineInput.sitadelConcurrence && { label: `Sitadel ${Math.round(engineInput.sitadelConcurrence)}/100`, color: "bg-orange-50 text-orange-600 ring-orange-200" },
    engineInput.fiscalite?.regime  && { label: engineInput.fiscalite.regime.replace("_", " "), color: "bg-amber-50 text-amber-600 ring-amber-200" },
    engineInput.dvf?.evolutionPctAnnuelle != null && { label: `DVF évol. ${engineInput.dvf.evolutionPctAnnuelle > 0 ? "+" : ""}${engineInput.dvf.evolutionPctAnnuelle}%`, color: "bg-teal-50 text-teal-600 ring-teal-200" },
  ].filter(Boolean) as { label: string; color: string }[];

  return (
    <div className="space-y-5">
      <V2DebugBadge sourcesCount={snapshot.dataSources.length} />

      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm px-5 py-3 flex items-center gap-4 flex-wrap">
        <span className="text-sm font-medium text-gray-700 flex-shrink-0">Horizon de détention</span>
        <div className="flex gap-1.5 flex-wrap">
          {HORIZONS.map(h => (
            <button key={h.value} onClick={() => setHorizonDetention(h.value)}
              className={["px-3 py-1.5 rounded-full text-xs font-semibold transition-colors",
                horizonDetention === h.value ? "bg-sky-600 text-white shadow-sm" : "bg-gray-100 text-gray-600 hover:bg-gray-200"].join(" ")}
            >{h.label}</button>
          ))}
        </div>
        {v2Badges.length > 0 && (
          <div className="ml-auto flex items-center gap-1.5 flex-wrap justify-end">
            {v2Badges.map(b => (
              <span key={b.label} className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${b.color}`}>{b.label}</span>
            ))}
          </div>
        )}
        {sitadelResult === null && (
          <span className="text-[10px] text-gray-400 flex items-center gap-1 flex-shrink-0">
            <span className="h-2 w-2 rounded-full border border-gray-400 border-t-transparent animate-spin" />
            Sitadel…
          </span>
        )}
      </div>

      {!hasRealData && (
        <div className="rounded-2xl border border-amber-300 bg-gradient-to-r from-amber-50 to-orange-50 p-5">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-xl">📊</div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-amber-900">Données marché non disponibles</h3>
              <p className="mt-1 text-sm text-amber-700 leading-relaxed">
                Projections basées sur des <strong>heuristiques locales</strong>. Lance l'étude <strong>Marché / Risques</strong> pour intégrer les données DVF réelles.
              </p>
              <div className="mt-3">
                <Link to="/marchand-de-bien/analyse?tab=marche_risques" className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-amber-700 transition-colors">
                  <span>📈</span> Lancer Marché / Risques
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      <PredictiveSummaryCard snapshot={snapshot} />
      <DataSourcesBar sources={snapshot.dataSources} />
      <V2ManualInputsPanel deal={deal} config={v2Manual} dpeAdeme={dpeAdeme} onChange={handleV2Change} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <PredictiveExecutiveCard snapshot={snapshot} />
        <PredictiveProjectionChart snapshot={snapshot} />
      </div>

      <PredictiveScenariosTable snapshot={snapshot} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <PredictiveDriversCard drivers={snapshot.drivers} />
        <PredictiveOperationImpactCard snapshot={snapshot} />
      </div>

      <div className="rounded-xl bg-gray-50 ring-1 ring-gray-200 px-5 py-3 text-xs text-gray-400">
        <strong className="text-gray-500">Sources V2 :</strong> DPE → <code>dpe-ademe-v1</code> ·
        Démo → <code>mrSpecific.demographie</code> ·
        Sitadel → <code>getPredictiveSitadelScore()</code>
        {sitadelResult?.source ? <span className="ml-1 text-gray-500">via {sitadelResult.source}</span> : null} ·
        Géorisques/PLU → études dédiées ·
        DVF évolution → <code>evolution_prix_pct</code> (Edge Function v1.3.8+) ·
        Snapshot Copilot → <code>buildPredictiveSnapshotForCopilot</code> (LOT 6).
      </div>
    </div>
  );
}