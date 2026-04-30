import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { usePredictiveAnalysis } from "../../hooks/usePredictiveAnalysis";
import type { PredictiveEngineInput, PredictiveDataSource } from "../../services/predictive/predictive.types";
import { readMarchandSnapshot } from "../../../marchand/shared/marchandSnapshot.store";
import { getInvestisseurSnapshot } from "../../shared/investisseurSnapshot.store";
import { getEcbRatesAnalysis, type EcbRatesAnalysis } from "../../services/predictive/ecbRate.service";
import PredictiveExecutiveCard from "./PredictiveExecutiveCard";
import PredictiveProjectionChart from "./PredictiveProjectionChart";
import PredictiveDriversCard from "./PredictiveDriversCard";
import PredictiveScenariosTable from "./PredictiveScenariosTable";
import PredictiveOperationImpactCard from "./PredictiveOperationImpactCard";
import PredictiveSummaryCard from "./PredictiveSummaryCard";

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

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ── Props ────────────────────────────────────────────────────────────

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

// ── Extract real data from snapshot ──────────────────────────────────

function extractRealInput(deal: DealInputs, travauxEstime?: number): PredictiveEngineInput {
  const dealId = deal.dealId;
  const snap = readMarchandSnapshot();

  // ── DVF ────────────────────────────────────────────────────────
  const mr = snap.marcheRisquesByDeal[dealId] as Record<string, unknown> | undefined;
  const mrData = (mr?.data ?? null) as Record<string, unknown> | null;
  const mrCore = (mrData?.core ?? mrData ?? null) as Record<string, unknown> | null;

  const dvfRaw =
    (mrCore as { dvf?: unknown } | null)?.dvf ??
    (mrData as { dvf?: unknown } | null)?.dvf ??
    (mr as { dvf?: unknown } | undefined)?.dvf ??
    null;

  const dvfObj = isObj(dvfRaw) ? dvfRaw : null;
  const dvfPrixM2Median = firstNum(
    dvfObj?.prix_m2_median, dvfObj?.prixM2Median,
    dvfObj?.medianPriceM2, dvfObj?.median_price_m2,
  );
  const dvfNbTransactions = firstNum(
    dvfObj?.nb_transactions, dvfObj?.nbTransactions,
    dvfObj?.count, dvfObj?.total,
  );
  const dvfEvolution = firstNum(
    dvfObj?.evolution_pct, dvfObj?.evolutionPct,
    dvfObj?.evolution_annuelle, dvfObj?.evolutionAnnuelle,
    dvfObj?.price_change_pct, dvfObj?.priceChangePct,
    dvfObj?.variation_annuelle, dvfObj?.variationAnnuelle,
    dvfObj?.variation_pct, dvfObj?.variationPct,
    dvfObj?.trend, dvfObj?.tendance,
    // Parfois stocké au niveau mrCore/mrData directement
    (mrCore as { evolution_prix?: unknown } | null)?.evolution_prix,
    (mrCore as { evolutionPrix?: unknown } | null)?.evolutionPrix,
    (mrData as { evolution_prix?: unknown } | null)?.evolution_prix,
    (mrData as { tendance_prix?: unknown } | null)?.tendance_prix,
    (mrData as { priceTrend?: unknown } | null)?.priceTrend,
  );

  const hasDvf = dvfPrixM2Median != null || dvfNbTransactions != null;

  // ── Market scores ──────────────────────────────────────────────
  const mrScores = (mrData?.scores ?? mr?.breakdown ?? null) as Record<string, unknown> | null;
  const scoreGlobal = firstNum(
    mr?.scoreGlobal, mr?.score,
    (mrScores as { global?: unknown } | null)?.global,
    (mrData as { smartScore?: unknown } | null)?.smartScore,
  );
  const hasScores = scoreGlobal != null;

  const marketScores = hasScores ? {
    global: scoreGlobal,
    demande: firstNum(
      (mrScores as { demande?: unknown } | null)?.demande,
      (mrScores as { liquidite?: unknown } | null)?.liquidite,
    ),
    offre: firstNum((mrScores as { offre?: unknown } | null)?.offre),
    accessibilite: firstNum((mrScores as { accessibilite?: unknown } | null)?.accessibilite),
    environnement: firstNum((mrScores as { environnement?: unknown } | null)?.environnement),
    liquidite: firstNum(
      (mrScores as { liquidite?: unknown } | null)?.liquidite,
      (mrScores as { liquidity?: unknown } | null)?.liquidity,
      (mrScores as { liquidityScore?: unknown } | null)?.liquidityScore,
    ),
    opportunity: firstNum(
      (mrScores as { opportunity?: unknown } | null)?.opportunity,
      (mrScores as { opportunite?: unknown } | null)?.opportunite,
    ),
    pressionRisque: firstNum(
      (mrScores as { pressionRisque?: unknown } | null)?.pressionRisque,
      (mrScores as { riskPressure?: unknown } | null)?.riskPressure,
    ),
  } : undefined;

  // ── BPE ────────────────────────────────────────────────────────
  const bpeRaw =
    (mrCore as { bpe?: unknown } | null)?.bpe ??
    (mrData as { bpe?: unknown } | null)?.bpe ??
    (mr as { bpe?: unknown } | undefined)?.bpe ??
    null;
  const bpeObj = isObj(bpeRaw) ? bpeRaw : null;
  const bpeScore = firstNum(bpeObj?.score_v2, bpeObj?.score);
  const hasBpe = bpeScore != null;

  // ── Rentabilité ────────────────────────────────────────────────
  const rentaRaw = snap.rentabiliteByDeal[dealId] as Record<string, unknown> | undefined;
  const rentaInputs = (rentaRaw?.inputs ?? null) as Record<string, unknown> | null;
  const rentaComputed = (
    rentaRaw?.computed ??
    (rentaRaw as { results?: unknown } | undefined)?.results ??
    null
  ) as Record<string, unknown> | null;

  const rendementBrut = firstNum(rentaComputed?.rendementBrut, rentaComputed?.yieldBrut);
  const rendementNet = firstNum(rentaComputed?.rendementNet, rentaComputed?.yieldNet);
  const cashflowMensuel = firstNum(rentaComputed?.cashflowMensuel, rentaComputed?.cashflow);
  const margeBrute = firstNum(
    rentaComputed?.margeBrute,
    (rentaComputed as { grossMargin?: unknown } | null)?.grossMargin,
  );
  const margeBrutePct = firstNum(
    rentaComputed?.margeBrutePct,
    (rentaComputed as { grossMarginPct?: unknown } | null)?.grossMarginPct,
  );
  const tri = firstNum(
    rentaComputed?.tri, rentaComputed?.irr,
    (rentaComputed as { triEquity?: unknown } | null)?.triEquity,
  );
  const van = firstNum(
    rentaComputed?.van, rentaComputed?.npv,
  );
  // hasRenta = true si au moins une métrique financière existe (location OU revente)
  const hasRenta = rendementBrut != null || margeBrute != null || margeBrutePct != null || tri != null || van != null;

  // ── Travaux investisseur ───────────────────────────────────────
  const investSnap = getInvestisseurSnapshot();
  const investPid = investSnap.activeProjectId;
  const investTravaux = investPid
    ? investSnap.projects[investPid]?.execution?.travaux?.computed
    : undefined;
  const travauxFinal = travauxEstime
    ?? firstNum(investTravaux?.totalWithBuffer, investTravaux?.total)
    ?? firstNum(
      rentaInputs?.travauxUtilises, rentaInputs?.travauxEstimes,
      rentaInputs?.travaux, rentaInputs?.montantTravaux,
    )
    ?? 0;

  // ── Frais annexes ──────────────────────────────────────────────
  const fraisAnnexes = Math.round(deal.prixAchat * 0.025); // ~2.5% frais notaire estimés

  // ── Taux BCE réel ──────────────────────────────────────────────
  // Le taux est injecté par le composant via ecbAnalysis.
  // On cherche aussi dans les inputs renta comme fallback supplémentaire.
  const tauxBcePct = firstNum(
    rentaInputs?.tauxSansRisque, rentaInputs?.tauxBce,
    rentaInputs?.tauxEcb, rentaInputs?.riskFreeRate,
    rentaComputed?.tauxSansRisque, rentaComputed?.tauxBce,
  );

  return {
    surfaceM2: deal.surfaceM2 || 50,
    acquisitionPrice: deal.prixAchat || 100_000,
    codePostal: deal.zipCode || "75001",
    typeBien: "appartement",
    travauxEstime: travauxFinal,
    fraisAnnexes,
    ...(hasDvf ? {
      dvf: {
        prixM2Median: dvfPrixM2Median,
        nbTransactions: dvfNbTransactions,
        evolutionPctAnnuelle: dvfEvolution,
      },
    } : {}),
    ...(marketScores ? { marketScores } : {}),
    ...(hasRenta ? {
      rentabilite: {
        rendementBrut, rendementNet, cashflowMensuel,
        margeBrute, margeBrutePct,
        prixReventeCible: deal.prixReventeCible > 0 ? deal.prixReventeCible : undefined,
      },
    } : {}),
    ...(hasBpe ? { bpe: { score: bpeScore } } : {}),
    ...(tauxBcePct != null ? { tauxBcePct } : {}),
  };
}

// ── Data sources indicator ───────────────────────────────────────────

function DataSourcesBar({ sources }: { sources: PredictiveDataSource[] }) {
  const available = sources.filter((s) => s.available);
  const missing = sources.filter((s) => !s.available);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-5">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Sources de données</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {available.length}/{sources.length} sources actives — {available.length >= 5 ? "analyse fiable" : available.length >= 3 ? "analyse partielle" : "données limitées"}
          </p>
        </div>
        <span
          className={[
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
            available.length >= 5
              ? "bg-emerald-50 text-emerald-700"
              : available.length >= 3
              ? "bg-amber-50 text-amber-700"
              : "bg-rose-50 text-rose-700",
          ].join(" ")}
        >
          <span
            className={[
              "h-1.5 w-1.5 rounded-full",
              available.length >= 5 ? "bg-emerald-500" : available.length >= 3 ? "bg-amber-500" : "bg-rose-500",
            ].join(" ")}
          />
          {available.length >= 5 ? "Données réelles" : available.length >= 3 ? "Partiel" : "Limité"}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {sources.map((s) => (
          <div
            key={s.key}
            className={[
              "flex items-center gap-2 rounded-lg px-3 py-2 text-xs",
              s.available
                ? "bg-emerald-50/50 ring-1 ring-emerald-200/50 text-emerald-800"
                : "bg-gray-50 ring-1 ring-gray-200/50 text-gray-400",
            ].join(" ")}
          >
            <span className={["h-1.5 w-1.5 rounded-full shrink-0", s.available ? "bg-emerald-500" : "bg-gray-300"].join(" ")} />
            <span className="font-medium">{s.label}</span>
            {s.detail && s.available && (
              <span className="ml-auto text-[10px] text-emerald-600">{s.detail}</span>
            )}
          </div>
        ))}
      </div>

      {missing.length > 0 && available.length < 4 && (
        <div className="mt-3 rounded-lg bg-amber-50 ring-1 ring-amber-200/50 px-3 py-2 text-xs text-amber-700">
          💡 Lance l'étude <strong>Marché / Risques</strong> pour enrichir l'analyse avec les données DVF et les scores marché réels.
        </div>
      )}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────

export default function AnalysePredictivePanel({ deal, travauxEstime }: Props) {
  const { snapshot, status, error, compute } = usePredictiveAnalysis();
  const [ecbAnalysis, setEcbAnalysis] = useState<EcbRatesAnalysis | null>(null);

  // Fetch ECB rates analysis on mount
  useEffect(() => {
    getEcbRatesAnalysis().then((result) => {
      setEcbAnalysis(result);
    });
  }, []);

  // Build real input from snapshot store + ECB analysis
  const engineInput = useMemo(
    () => {
      const base = extractRealInput(deal, travauxEstime);
      if (ecbAnalysis) {
        base.tauxBcePct = ecbAnalysis.refinancingRate;
        base.ecbAnalysis = {
          pressureScore: ecbAnalysis.pressureScore,
          pressureLabel: ecbAnalysis.pressureLabel,
          trend: ecbAnalysis.trend,
          interpretation: ecbAnalysis.interpretation,
          refinancingRate: ecbAnalysis.refinancingRate,
          source: ecbAnalysis.source,
        };
      }
      return base;
    },
    [deal.dealId, deal.prixAchat, deal.surfaceM2, deal.zipCode, deal.prixReventeCible, travauxEstime, ecbAnalysis]
  );

  useEffect(() => {
    compute(engineInput);
  }, [engineInput, compute]);

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

  const hasDvf = !!engineInput.dvf?.prixM2Median;
  const hasScores = !!engineInput.marketScores?.global;
  const hasRealData = hasDvf || hasScores;

  return (
    <div className="space-y-5">
      {/* ── Bannière données manquantes ── */}
      {!hasRealData && (
        <div className="rounded-2xl border border-amber-300 bg-gradient-to-r from-amber-50 to-orange-50 p-5">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-xl">
              📊
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-amber-900">
                Données marché non disponibles
              </h3>
              <p className="mt-1 text-sm text-amber-700 leading-relaxed">
                L'analyse prédictive est actuellement basée sur des <strong>heuristiques locales</strong> (département, bassin d'emploi).
                Pour obtenir des projections fiables basées sur les <strong>transactions DVF réelles</strong> et les <strong>scores marché</strong>,
                lance d'abord l'étude dans l'onglet <strong>Marché / Risques</strong>.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Link
                  to="/marchand-de-bien/analyse?tab=marche_risques"
                  className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-amber-700"
                >
                  <span>📈</span>
                  Lancer Marché / Risques
                </Link>
                <span className="text-xs text-amber-500">
                  Puis reviens ici — les données seront automatiquement intégrées.
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Summary verdict */}
      <PredictiveSummaryCard snapshot={snapshot} />

      {/* Data sources transparency */}
      <DataSourcesBar sources={snapshot.dataSources} />

      {/* Executive spot + market */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <PredictiveExecutiveCard snapshot={snapshot} />
        <PredictiveProjectionChart snapshot={snapshot} />
      </div>

      {/* Scenarios table */}
      <PredictiveScenariosTable snapshot={snapshot} />

      {/* Drivers + Operation impact */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <PredictiveDriversCard drivers={snapshot.drivers} />
        <PredictiveOperationImpactCard snapshot={snapshot} />
      </div>

      {/* Footer */}
      <div className="rounded-xl bg-gray-50 ring-1 ring-gray-200 px-5 py-3 text-xs text-gray-400">
        <strong className="text-gray-500">Note :</strong> Les projections sont alimentées par les données réelles disponibles
        (DVF, scores marché, BPE, taux directeur BCE) et complétées par des heuristiques locales lorsque nécessaire.
        Le budget travaux est issu de la Simulation (Exécution › Simulation) ou de la saisie manuelle en Rentabilité.
        Elles ne constituent pas un conseil en investissement.
      </div>
    </div>
  );
}