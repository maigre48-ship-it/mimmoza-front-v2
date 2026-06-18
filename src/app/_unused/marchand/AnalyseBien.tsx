// src/spaces/marchand/pages/AnalyseBien.tsx

import { useCallback, useEffect, useState } from "react";
import QuestionnaireEngine from "../questionnaire/QuestionnaireEngine";
import { setNestedValue } from "../questionnaire/questionnaireSchema";
import { computeSmartScoreInvestisseur } from "../scoring/smartScoreInvestisseur";
import { enrichSnapshot, extractFromAdText } from "../services/investisseurEnrich.service";
import {
  isMinimumViable,
  loadSnapshot,
  resetSnapshot,
  saveSnapshot,
  updateEnriched,
  type InvestisseurSnapshot,
} from "../store/investisseurSnapshot.store";

// ─── Verdict colors ──────────────────────────────────────────────────

const VERDICT_CONFIG = {
  GO: { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", label: "GO", icon: "✅" },
  GO_AVEC_RESERVES: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", label: "GO avec réserves", icon: "⚠️" },
  NO_GO: { bg: "bg-red-50", border: "border-red-200", text: "text-red-700", label: "NO GO", icon: "🛑" },
} as const;

const GRADE_COLORS: Record<string, string> = {
  A: "text-emerald-600",
  B: "text-green-600",
  C: "text-amber-600",
  D: "text-orange-600",
  E: "text-red-600",
};

const SEVERITY_STYLES = {
  blocker: { dot: "bg-red-500", text: "text-red-700", bg: "bg-red-50" },
  warn: { dot: "bg-amber-500", text: "text-amber-700", bg: "bg-amber-50" },
  info: { dot: "bg-blue-400", text: "text-blue-600", bg: "bg-blue-50" },
} as const;

// ─── Component ───────────────────────────────────────────────────────

export default function AnalyseBien() {
  const [snapshot, setSnapshot] = useState<InvestisseurSnapshot>(loadSnapshot);
  const [currentStep, setCurrentStep] = useState(0);
  const [enriching, setEnriching] = useState(false);
  const [enrichErrors, setEnrichErrors] = useState<string[]>([]);

  // Persist on every change
  useEffect(() => {
    saveSnapshot(snapshot);
  }, [snapshot]);

  // ── Handlers ──

  const handleUpdateSnapshot = useCallback((updated: InvestisseurSnapshot) => {
    setSnapshot(updated);
  }, []);

  const handleExtractAd = useCallback(() => {
    if (!snapshot.propertyDraft.rawAdText) return;
    const extracted = extractFromAdText(snapshot.propertyDraft.rawAdText);
    let updated = { ...snapshot };
    for (const [key, value] of Object.entries(extracted)) {
      if (value !== undefined) {
        updated = setNestedValue(updated, `propertyDraft.${key}`, value) as InvestisseurSnapshot;
      }
    }
    updated.smartscore = undefined;
    setSnapshot(updated);
  }, [snapshot]);

  const handleEnrich = useCallback(async () => {
    setEnriching(true);
    setEnrichErrors([]);
    try {
      const result = await enrichSnapshot(snapshot);
      const updated = updateEnriched(snapshot, {
        market: result.market,
        insee: result.insee,
        risques: result.risques,
      });
      setSnapshot(updated);
      if (result.errors.length > 0) {
        setEnrichErrors(result.errors);
      }
    } catch (e: any) {
      setEnrichErrors([e?.message ?? "Erreur lors de l'enrichissement"]);
    } finally {
      setEnriching(false);
    }
  }, [snapshot]);

  const handleComputeScore = useCallback(() => {
    const { smartscore, missingData } = computeSmartScoreInvestisseur(snapshot);
    setSnapshot((prev) => ({ ...prev, smartscore, missingData }));
    setCurrentStep(3); // go to results
  }, [snapshot]);

  const handleReset = useCallback(() => {
    if (window.confirm("Réinitialiser toute l'analyse ? Cette action est irréversible.")) {
      setSnapshot(resetSnapshot());
      setCurrentStep(0);
      setEnrichErrors([]);
    }
  }, []);

  const canCompute = isMinimumViable(snapshot);
  const hasEnriched = !!(snapshot.enriched.market || snapshot.enriched.risques || snapshot.enriched.insee);

  return (
    <div className="min-h-screen bg-gray-50/50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <span className="text-2xl">🔍</span>
              Analyser un bien
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Intake → Questionnaire → Enrichissement → SmartScore → Décision
            </p>
          </div>
          <div className="flex items-center gap-2">
            {snapshot.updatedAt && (
              <span className="text-xs text-gray-400">
                Mis à jour : {new Date(snapshot.updatedAt).toLocaleString("fr-FR")}
              </span>
            )}
            <button
              onClick={handleReset}
              className="px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 rounded-lg transition-colors border border-red-200"
            >
              Réinitialiser
            </button>
          </div>
        </div>
      </div>

      {/* Main content: two columns */}
      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* ── Left column: Intake + Questionnaire (3/5) ── */}
          <div className="lg:col-span-3 space-y-4">
            {/* Ad text extract button */}
            {snapshot.propertyDraft.rawAdText && (
              <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-indigo-800">Texte d'annonce détecté</p>
                  <p className="text-xs text-indigo-600 mt-0.5">
                    Extraire automatiquement les données (surface, prix, DPE…)
                  </p>
                </div>
                <button
                  onClick={handleExtractAd}
                  className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
                >
                  📋 Extraire depuis annonce
                </button>
              </div>
            )}

            {/* Questionnaire */}
            <QuestionnaireEngine
              snapshot={snapshot}
              currentStep={Math.min(currentStep, 2)}
              onChangeStep={setCurrentStep}
              onUpdateSnapshot={handleUpdateSnapshot}
            />

            {/* Action buttons */}
            <div className="flex flex-wrap gap-3 pt-2">
              <button
                onClick={handleEnrich}
                disabled={enriching || !snapshot.propertyDraft.address && !(snapshot.propertyDraft.lat && snapshot.propertyDraft.lng)}
                className={`
                  flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all
                  ${enriching
                    ? "bg-gray-100 text-gray-400 cursor-wait"
                    : "bg-white border border-gray-200 text-gray-700 hover:border-indigo-300 hover:text-indigo-600"
                  }
                `}
              >
                {enriching ? (
                  <>
                    <Spinner /> Enrichissement…
                  </>
                ) : (
                  <>🔄 {hasEnriched ? "Relancer enrichissement" : "Enrichir"}</>
                )}
              </button>

              <button
                onClick={handleComputeScore}
                disabled={!canCompute}
                className={`
                  flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold transition-all
                  ${canCompute
                    ? "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm"
                    : "bg-gray-100 text-gray-400 cursor-not-allowed"
                  }
                `}
              >
                ⚡ Calculer SmartScore
              </button>
            </div>

            {/* Enrich errors */}
            {enrichErrors.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
                {enrichErrors.map((err, i) => (
                  <p key={i} className="text-xs text-amber-700">⚠ {err}</p>
                ))}
              </div>
            )}
          </div>

          {/* ── Right column: SmartScore + Checklist (2/5) ── */}
          <div className="lg:col-span-2 space-y-4">
            {/* SmartScore card */}
            <SmartScoreCard snapshot={snapshot} />

            {/* Missing data checklist */}
            <MissingDataCard snapshot={snapshot} />

            {/* Enrichment summary */}
            <EnrichmentSummaryCard snapshot={snapshot} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── SmartScore Card ─────────────────────────────────────────────────

function SmartScoreCard({ snapshot }: { snapshot: InvestisseurSnapshot }) {
  const ss = snapshot.smartscore;

  if (!ss) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-6 text-center">
        <div className="text-4xl mb-3 opacity-30">📊</div>
        <p className="text-sm text-gray-400">
          Renseignez les données du bien puis cliquez sur <strong>Calculer SmartScore</strong>
        </p>
      </div>
    );
  }

  const vc = VERDICT_CONFIG[ss.verdict];

  return (
    <div className={`border rounded-xl overflow-hidden ${vc.border}`}>
      {/* Score header */}
      <div className={`${vc.bg} px-6 py-5`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">SmartScore</p>
            <div className="flex items-baseline gap-2 mt-1">
              <span className={`text-4xl font-black ${GRADE_COLORS[ss.grade] ?? "text-gray-700"}`}>
                {ss.score}
              </span>
              <span className="text-lg text-gray-400">/100</span>
              <span className={`ml-2 text-lg font-bold ${GRADE_COLORS[ss.grade]}`}>
                {ss.grade}
              </span>
            </div>
          </div>
          <div className={`px-4 py-2 rounded-lg ${vc.bg} border ${vc.border}`}>
            <span className={`text-lg font-bold ${vc.text}`}>
              {vc.icon} {vc.label}
            </span>
          </div>
        </div>
      </div>

      {/* Pillars */}
      <div className="bg-white px-6 py-4 space-y-3">
        {ss.pillars.map((pillar) => {
          const pct = pillar.max > 0 ? (pillar.score / pillar.max) * 100 : 0;
          const barColor =
            pct >= 75 ? "bg-emerald-500" :
            pct >= 50 ? "bg-amber-500" :
            "bg-red-500";

          return (
            <div key={pillar.key}>
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="font-medium text-gray-700">{pillar.label}</span>
                <span className="text-gray-500 text-xs">{pillar.score}/{pillar.max}</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {pillar.details && pillar.details.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {pillar.details.map((d, i) => (
                    <p key={i} className="text-xs text-gray-400 pl-1">• {d}</p>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Missing Data Card ───────────────────────────────────────────────

function MissingDataCard({ snapshot }: { snapshot: InvestisseurSnapshot }) {
  const items = snapshot.missingData;
  if (!items || items.length === 0) {
    if (!snapshot.smartscore) return null;
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
        <p className="text-sm text-emerald-700 font-medium">✓ Toutes les données clés sont renseignées</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
        📝 Données manquantes
        <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
          {items.length}
        </span>
      </h3>
      <div className="space-y-2">
        {items.map((item) => {
          const style = SEVERITY_STYLES[item.severity];
          return (
            <div
              key={item.key}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg ${style.bg}`}
            >
              <span className={`w-2 h-2 rounded-full ${style.dot}`} />
              <span className={`text-xs font-medium ${style.text}`}>{item.label}</span>
              <span className="text-xs text-gray-400 ml-auto capitalize">{item.severity}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Enrichment Summary Card ─────────────────────────────────────────

function EnrichmentSummaryCard({ snapshot }: { snapshot: InvestisseurSnapshot }) {
  const { market, insee, risques } = snapshot.enriched;
  const hasAny = market || insee || risques;

  if (!hasAny) return null;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">📡 Données enrichies</h3>
      <div className="space-y-3 text-xs">
        {market && (
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="font-medium text-gray-600 mb-1">Marché</p>
            <p className="text-gray-500">
              Prix/m² médian : <strong>{market.prixM2Median?.toLocaleString("fr-FR")} €</strong>
              {" · "}Transactions 12m : <strong>{market.nbTransactions12m}</strong>
              {" · "}Tendance : <strong>{market.tendance}</strong>
            </p>
            {market.source === "mock" && (
              <p className="text-amber-500 mt-1 italic">⚠ Données simulées (mock)</p>
            )}
          </div>
        )}
        {insee && (
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="font-medium text-gray-600 mb-1">INSEE</p>
            <p className="text-gray-500">
              Population : <strong>{insee.population?.toLocaleString("fr-FR")}</strong>
              {" · "}Revenu médian : <strong>{insee.revenuMedian?.toLocaleString("fr-FR")} €</strong>
              {" · "}Chômage : <strong>{insee.tauxChomage}%</strong>
            </p>
            {insee.source === "mock" && (
              <p className="text-amber-500 mt-1 italic">⚠ Données simulées (mock)</p>
            )}
          </div>
        )}
        {risques && (
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="font-medium text-gray-600 mb-1">Risques</p>
            <p className="text-gray-500">
              Risques identifiés : <strong>{risques.nbRisques ?? 0}</strong>
              {risques.nbRisques === 0 && " (aucun)"}
            </p>
            {risques.source === "mock" && (
              <p className="text-amber-500 mt-1 italic">⚠ Données simulées (mock)</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Spinner ─────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4 text-gray-400" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}