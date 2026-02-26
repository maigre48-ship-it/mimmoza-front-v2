/**
 * RentabilitePanel.tsx
 * ─────────────────────────────────────────────────────────────────────
 * Panneau "Rentabilité" de l'onglet Analyse investisseur.
 *
 * v3:
 * - Nouveau bloc "Inputs clés" (loyer, charges, travaux) en haut
 * - Ces valeurs sont persistées dans snapshot (rentabilite.inputs)
 * - Utilisées dans computeScenarioResults via dealForCalc enrichi
 * - Plus de TRI: N/A ni VAN: NaN
 * - persistRentabiliteToSnapshot utilise les states directs
 * ─────────────────────────────────────────────────────────────────────
 */

import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import type {
  Scenario,
  DealInputs,
  StrategyType,
  FiscalRegime,
  MacroRate,
  ScenarioResults,
  StressTestResults,
  NegotiationResult,
  Financement,
} from "../../types/strategy.types";
import {
  generateDefaultScenarios,
  computeScenarioResults,
  computeStressTests,
  computeNegotiation,
  computeRecommendedDiscountRate,
  buildScenarioComparisons,
  formatEuro,
  formatPct,
} from "../../engine/strategyEngine";
import { fetchRiskFreeRate } from "../../services/macroRates.service";
import {
  patchRentabiliteForDeal,
  readMarchandSnapshot,
} from "../../../marchand/shared/marchandSnapshot.store";

// ─── Props ───────────────────────────────────────────────────────────

interface RentabilitePanelProps {
  deal: DealInputs;
  strategy: StrategyType;
  fiscalRegime: FiscalRegime;
  onStrategyChange: (s: StrategyType) => void;
  onRegimeChange: (r: FiscalRegime) => void;
}

// ─── Verdict badge ───────────────────────────────────────────────────

const VERDICT_STYLES: Record<string, string> = {
  excellent: "bg-emerald-100 text-emerald-700",
  bon: "bg-green-100 text-green-700",
  acceptable: "bg-amber-100 text-amber-700",
  insuffisant: "bg-red-100 text-red-700",
};

function VerdictBadge({ verdict }: { verdict: string }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 text-xs font-semibold rounded-full ${
        VERDICT_STYLES[verdict] ?? "bg-gray-100 text-gray-600"
      }`}
    >
      {verdict.charAt(0).toUpperCase() + verdict.slice(1)}
    </span>
  );
}

// ─── Régimes fiscaux ─────────────────────────────────────────────────

const FISCAL_REGIMES: { value: FiscalRegime; label: string }[] = [
  { value: "lmnp_reel", label: "LMNP Réel" },
  { value: "lmnp_micro", label: "LMNP Micro" },
  { value: "lmp", label: "LMP" },
  { value: "sci_is", label: "SCI IS" },
  { value: "sci_ir", label: "SCI IR" },
  { value: "nom_propre", label: "Nom propre" },
  { value: "defiscalisation", label: "Défiscalisation" },
];

// ─── Snapshot persistence helper (debounced) ─────────────────────────

const PERSIST_DEBOUNCE_MS = 600;

/**
 * Persist rentabilité inputs + computed into Marchand snapshot.
 * Called with debounce so we don't write on every keystroke.
 */
function persistRentabiliteToSnapshot(
  dealId: string,
  deal: DealInputs,
  strategy: StrategyType,
  fiscalRegime: FiscalRegime,
  scenarios: Scenario[],
  allResults: ScenarioResults[],
  loyerMensuel: number,
  chargesMensuelles: number,
  travauxEstimes: number
) {
  if (!dealId) return;

  // Find best result (highest TRI equity)
  const bestResult =
    allResults.length > 0
      ? allResults.reduce((best, r) =>
          (r.triEquity ?? -999) > (best.triEquity ?? -999) ? r : best
        )
      : null;

  const bestScenario = bestResult
    ? scenarios.find((s) => s.id === bestResult.scenarioId)
    : scenarios[0] ?? null;

  // Inputs: flat object with key fields the canonical builder expects
  const inputs: Record<string, unknown> = {
    prixAchat: deal.prixAchat,
    surfaceM2: deal.surfaceM2,
    prixReventeCible: deal.prixReventeEstime,
    strategy,
    fiscalRegime,
    // v3: direct values from the "Inputs clés" bloc
    travauxEstimes: travauxEstimes || undefined,
    loyerEstime: loyerMensuel || undefined,
    loyerMensuel: loyerMensuel || undefined,
    chargesEstimees: chargesMensuelles || undefined,
    chargesMensuelles: chargesMensuelles || undefined,
    chargesUnit: "mois",
    // Duration from best scenario
    dureeMois: bestScenario
      ? (bestScenario.dureeAnnees ?? 10) * 12
      : undefined,
    dureeAnnees: bestScenario?.dureeAnnees ?? undefined,
  };

  // Computed: metrics from the best scenario result
  const computed: Record<string, unknown> = bestResult
    ? {
        triEquity: bestResult.triEquity,
        vanEquity: bestResult.vanEquity,
        cashFlowCumule: bestResult.cashFlowCumule,
        multipleCapital: bestResult.multipleCapital,
        mensualite: bestResult.mensualite,
        verdict: bestResult.verdict,
        rendementBrutPct: (bestResult as any).rendementBrutPct ?? undefined,
        rendementBrut: (bestResult as any).rendementBrutPct ?? undefined,
        margeBrutePct: (bestResult as any).margeBrutePct ?? undefined,
        coutProjet: (bestResult as any).coutProjet ?? undefined,
        coutAchat: (bestResult as any).coutAchat ?? undefined,
        margeBrute: (bestResult as any).margeBrute ?? undefined,
        // SmartScore proxy: use TRI equity normalized to 0-100 scale
        smartScore: bestResult.triEquity != null
          ? Math.max(0, Math.min(100, Math.round(bestResult.triEquity * 5)))
          : undefined,
      }
    : {};

  try {
    patchRentabiliteForDeal(dealId, {
      inputs,
      computed,
      taxRegime: fiscalRegime as any,
      taxConfig: undefined as any,
    });
  } catch (e) {
    console.warn("[RentabilitePanel] snapshot persist failed:", e);
  }
}

// ─── Load initial key inputs from snapshot ───────────────────────────

interface KeyInputsFromSnapshot {
  loyerMensuel: number;
  chargesMensuelles: number;
  travauxEstimes: number;
}

function loadKeyInputsFromSnapshot(dealId: string): KeyInputsFromSnapshot {
  try {
    const snap = readMarchandSnapshot();
    const renta = snap.rentabiliteByDeal[dealId] as Record<string, any> | undefined;
    const inputs = renta?.inputs as Record<string, any> | undefined;

    const safeN = (v: unknown): number => {
      if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
      return 0;
    };

    return {
      loyerMensuel: safeN(inputs?.loyerMensuel ?? inputs?.loyerEstime ?? inputs?.loyer),
      chargesMensuelles: safeN(inputs?.chargesMensuelles ?? inputs?.chargesEstimees ?? inputs?.charges),
      travauxEstimes: safeN(inputs?.travauxEstimes ?? inputs?.travaux ?? inputs?.montantTravaux),
    };
  } catch {
    return { loyerMensuel: 0, chargesMensuelles: 0, travauxEstimes: 0 };
  }
}

// ─── Main component ─────────────────────────────────────────────────

export default function RentabilitePanel({
  deal,
  strategy,
  fiscalRegime,
  onStrategyChange,
  onRegimeChange,
}: RentabilitePanelProps) {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [riskFreeRate, setRiskFreeRate] = useState<MacroRate | null>(null);
  const [expandedScenario, setExpandedScenario] = useState<string | null>(null);
  const [showStress, setShowStress] = useState(false);

  // ── v3: Inputs clés (loyer, charges, travaux) ──────────────────────
  const [loyerMensuel, setLoyerMensuel] = useState<number>(0);
  const [chargesMensuelles, setChargesMensuelles] = useState<number>(0);
  const [travauxEstimes, setTravauxEstimes] = useState<number>(0);

  // Guard: skip snapshot persist on initial load
  const initialLoadRef = useRef(true);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load key inputs from snapshot when deal changes ────────────────
  useEffect(() => {
    if (!deal?.dealId) return;
    const saved = loadKeyInputsFromSnapshot(deal.dealId);
    setLoyerMensuel(saved.loyerMensuel);
    setChargesMensuelles(saved.chargesMensuelles);
    setTravauxEstimes(saved.travauxEstimes);
  }, [deal?.dealId]);

  // ── Fetch risk-free rate
  useEffect(() => {
    const maxDuration = Math.max(...(scenarios.length ? scenarios.map((s) => s.dureeAnnees) : [10]));
    fetchRiskFreeRate(maxDuration).then(setRiskFreeRate);
  }, [scenarios.length]);

  // ── Auto-generate scenarios on strategy/regime change
  useEffect(() => {
    setScenarios(generateDefaultScenarios(strategy, fiscalRegime));
  }, [strategy, fiscalRegime]);

  // Expand first scenario by default
  useEffect(() => {
    if (scenarios.length > 0 && !expandedScenario) {
      setExpandedScenario(scenarios[0].id);
    }
  }, [scenarios]);

  const rfRate = riskFreeRate?.valuePct ?? 3.0;

  // ── v3: Enrich deal with key inputs for computation ────────────────
  // CRITICAL: Map user inputs to the EXACT property names that
  // strategyEngine.computeScenarioResults() reads:
  //   - loyerMensuelBrut  (monthly rent)
  //   - chargesAnnuelles  (annual charges = monthly * 12)
  //   - montantTravaux    (works budget)
  //   - prixReventeEstime (fallback to prixAchat if not set)
  // We also keep alternate names for snapshot/other consumers.
  const dealForCalc = useMemo((): DealInputs => {
    const safeLoyerMensuel = Number(loyerMensuel) || 0;
    const safeChargesMensuelles = Number(chargesMensuelles) || 0;
    const safeTravauxEstimes = Number(travauxEstimes) || 0;

    return {
      ...deal,
      // ── Primary fields used by strategyEngine ──
      loyerMensuelBrut: safeLoyerMensuel || deal.loyerMensuelBrut || 0,
      chargesAnnuelles:
        safeChargesMensuelles > 0
          ? safeChargesMensuelles * 12
          : deal.chargesAnnuelles || 0,
      montantTravaux: safeTravauxEstimes || deal.montantTravaux || 0,
      // Ensure prixReventeEstime has a sensible default
      prixReventeEstime:
        deal.prixReventeEstime > 0
          ? deal.prixReventeEstime
          : deal.prixAchat || 0,
    } as DealInputs;
  }, [deal, loyerMensuel, chargesMensuelles, travauxEstimes]);

  // ── Compute all results (memoized) — uses enriched deal ────────────
  const allResults = useMemo<ScenarioResults[]>(() => {
    return scenarios.map((sc) => computeScenarioResults(dealForCalc, sc, rfRate));
  }, [scenarios, dealForCalc, rfRate]);

  // ── v3: Persist to snapshot (debounced, skip initial load) ─────────
  useEffect(() => {
    if (initialLoadRef.current) {
      initialLoadRef.current = false;
      return;
    }
    if (!deal.dealId || allResults.length === 0) return;

    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      persistRentabiliteToSnapshot(
        deal.dealId,
        deal,
        strategy,
        fiscalRegime,
        scenarios,
        allResults,
        loyerMensuel,
        chargesMensuelles,
        travauxEstimes
      );
    }, PERSIST_DEBOUNCE_MS);

    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, [allResults, deal.dealId, strategy, fiscalRegime, loyerMensuel, chargesMensuelles, travauxEstimes]);

  // ── Stress tests for expanded scenario
  const stressResults = useMemo<StressTestResults | null>(() => {
    if (!showStress || !expandedScenario) return null;
    const sc = scenarios.find((s) => s.id === expandedScenario);
    if (!sc) return null;
    return computeStressTests(dealForCalc, sc, rfRate);
  }, [showStress, expandedScenario, scenarios, dealForCalc, rfRate]);

  // ── Best scenario for negotiation
  const bestResult = useMemo(() => {
    if (allResults.length === 0) return null;
    return allResults.reduce((best, r) =>
      (r.triEquity ?? -999) > (best.triEquity ?? -999) ? r : best
    );
  }, [allResults]);

  const negotiation = useMemo<NegotiationResult | null>(() => {
    if (!bestResult) return null;
    const sc = scenarios.find((s) => s.id === bestResult.scenarioId);
    if (!sc) return null;
    return computeNegotiation(dealForCalc, sc, rfRate);
  }, [bestResult, scenarios, dealForCalc, rfRate]);

  // ── Comparisons
  const comparisons = useMemo(
    () => buildScenarioComparisons(allResults, scenarios),
    [allResults, scenarios]
  );

  // ── Scenario CRUD
  const updateScenario = useCallback((id: string, patch: Partial<Scenario>) => {
    setScenarios((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...patch } : s))
    );
  }, []);

  const updateFinancement = useCallback(
    (id: string, patch: Partial<Financement>) => {
      setScenarios((prev) =>
        prev.map((s) =>
          s.id === id
            ? { ...s, financement: { ...s.financement, ...patch } }
            : s
        )
      );
    },
    []
  );

  const duplicateScenario = useCallback((id: string) => {
    setScenarios((prev) => {
      const source = prev.find((s) => s.id === id);
      if (!source) return prev;
      const copy: Scenario = {
        ...source,
        id: `sc-${Date.now()}-dup`,
        name: `${source.name} (copie)`,
      };
      return [...prev, copy];
    });
  }, []);

  const deleteScenario = useCallback((id: string) => {
    setScenarios((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((s) => s.id !== id);
    });
  }, []);

  const addScenario = useCallback(() => {
    const sc: Scenario = {
      id: `sc-${Date.now()}-new`,
      name: `Scénario ${scenarios.length + 1}`,
      strategy,
      fiscalRegime,
      dureeAnnees: 10,
      inflationMarche: 2.0,
      inflationLoyers: 2.0,
      inflationTravaux: 2.5,
      financement: {
        apportPct: 20,
        tauxNominal: 3.5,
        dureeMois: 240,
        assurancePct: 0.34,
        differeMois: 0,
      },
      discountRateMode: "auto",
      discountRateManual: 8,
      primeRisqueScenario: 2.0,
      primeIlliquidite: 1.5,
      primeLevier: 1.0,
    };
    setScenarios((prev) => [...prev, sc]);
  }, [strategy, fiscalRegime, scenarios.length]);

  // ── Format helper
  const fmtEur = (v: number) =>
    v > 0 ? v.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " €" : "—";

  return (
    <div className="space-y-6">
      {/* ── Stratégie + Régime ── */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex flex-wrap items-center gap-6">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              Stratégie
            </label>
            <div className="flex rounded-lg border border-gray-200 overflow-hidden">
              {(["revente", "location"] as StrategyType[]).map((s) => (
                <button
                  key={s}
                  onClick={() => onStrategyChange(s)}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${
                    strategy === s
                      ? "bg-indigo-600 text-white"
                      : "bg-white text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {s === "revente" ? "Revente" : "Location"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              Régime fiscal
            </label>
            <select
              value={fiscalRegime}
              onChange={(e) => onRegimeChange(e.target.value as FiscalRegime)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            >
              {FISCAL_REGIMES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          {riskFreeRate && (
            <div className="ml-auto text-right">
              <p className="text-xs text-gray-400">Taux sans risque (ECB)</p>
              <p className="text-sm font-semibold text-gray-700">
                {formatPct(riskFreeRate.valuePct)}
                <span className="text-xs text-gray-400 ml-1">
                  {riskFreeRate.source === "fallback" ? "(fallback)" : ""}
                </span>
              </p>
              <p className="text-xs text-gray-400">{riskFreeRate.rateDate}</p>
            </div>
          )}
        </div>
      </div>

      {/* ── v3: Inputs clés ── */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-2">
          <span>🔑</span> Inputs clés du deal
        </h3>
        <p className="text-xs text-gray-400 mb-4">
          Renseignez le loyer mensuel estimé, les charges et le budget travaux. Ces données alimentent les scénarios et la Synthèse IA.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              Loyer mensuel estimé (€)
            </label>
            <input
              type="number"
              value={loyerMensuel || ""}
              placeholder="ex: 800"
              min={0}
              step={50}
              onChange={(e) => setLoyerMensuel(parseFloat(e.target.value) || 0)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            {loyerMensuel > 0 && deal.surfaceM2 > 0 && (
              <p className="text-[10px] text-gray-400 mt-1">
                {(loyerMensuel / deal.surfaceM2).toFixed(1)} €/m²/mois
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              Charges mensuelles (€)
            </label>
            <input
              type="number"
              value={chargesMensuelles || ""}
              placeholder="ex: 150"
              min={0}
              step={10}
              onChange={(e) => setChargesMensuelles(parseFloat(e.target.value) || 0)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <p className="text-[10px] text-gray-400 mt-1">
              Copropriété, taxe foncière, assurance PNO…
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              Travaux estimés (€)
            </label>
            <input
              type="number"
              value={travauxEstimes || ""}
              placeholder="ex: 15000"
              min={0}
              step={1000}
              onChange={(e) => setTravauxEstimes(parseFloat(e.target.value) || 0)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            {travauxEstimes > 0 && deal.surfaceM2 > 0 && (
              <p className="text-[10px] text-gray-400 mt-1">
                {Math.round(travauxEstimes / deal.surfaceM2)} €/m²
              </p>
            )}
          </div>
        </div>
        {/* Quick summary */}
        {loyerMensuel > 0 && deal.prixAchat > 0 && (
          <div className="mt-3 flex flex-wrap gap-3 text-xs">
            <span className="px-2.5 py-1 rounded-md bg-indigo-50 text-indigo-700 font-medium">
              Rendement brut indicatif : {((loyerMensuel * 12) / (deal.prixAchat + travauxEstimes) * 100).toFixed(1)} %
            </span>
            {chargesMensuelles > 0 && (
              <span className="px-2.5 py-1 rounded-md bg-gray-50 text-gray-600">
                Cashflow brut : {fmtEur(loyerMensuel - chargesMensuelles)}/mois
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Scénarios ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">
            Scénarios ({scenarios.length})
          </h3>
          <button
            onClick={addScenario}
            className="px-3 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors"
          >
            + Ajouter
          </button>
        </div>

        {scenarios.map((sc) => {
          const result = allResults.find((r) => r.scenarioId === sc.id);
          const isExpanded = expandedScenario === sc.id;

          return (
            <div
              key={sc.id}
              className="bg-white border border-gray-200 rounded-xl overflow-hidden"
            >
              {/* Header */}
              <div
                className="px-5 py-3 flex items-center gap-3 cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() =>
                  setExpandedScenario(isExpanded ? null : sc.id)
                }
              >
                <span className="text-xs text-gray-400">
                  {isExpanded ? "▼" : "▶"}
                </span>
                <input
                  value={sc.name}
                  onChange={(e) =>
                    updateScenario(sc.id, { name: e.target.value })
                  }
                  onClick={(e) => e.stopPropagation()}
                  className="text-sm font-semibold text-gray-800 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-indigo-500 focus:outline-none px-1 py-0.5"
                />
                <span className="text-xs text-gray-400 ml-auto">
                  {sc.dureeAnnees} ans
                </span>
                {result && (
                  <>
                    <span className="text-xs font-medium text-gray-600">
                      TRI: {formatPct(result.triEquity)}
                    </span>
                    <span className="text-xs text-gray-500">
                      VAN: {formatEuro(result.vanEquity)}
                    </span>
                    <VerdictBadge verdict={result.verdict} />
                  </>
                )}
                <div className="flex gap-1 ml-2" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => duplicateScenario(sc.id)}
                    className="p-1 text-gray-400 hover:text-indigo-600 transition-colors"
                    title="Dupliquer"
                  >
                    ⧉
                  </button>
                  <button
                    onClick={() => deleteScenario(sc.id)}
                    className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                    title="Supprimer"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* Expanded content */}
              {isExpanded && (
                <div className="px-5 pb-5 border-t border-gray-100">
                  <ScenarioEditor
                    scenario={sc}
                    rfRate={rfRate}
                    result={result ?? null}
                    onUpdate={(patch) => updateScenario(sc.id, patch)}
                    onUpdateFin={(patch) =>
                      updateFinancement(sc.id, patch)
                    }
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Tableau comparatif ── */}
      {comparisons.length > 1 && (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">
            Comparaison des scénarios
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2 px-3 text-xs font-medium text-gray-500">
                    Scénario
                  </th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-gray-500">
                    TRI equity
                  </th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-gray-500">
                    VAN equity
                  </th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-gray-500">
                    Taux cible
                  </th>
                  <th className="text-center py-2 px-3 text-xs font-medium text-gray-500">
                    Verdict
                  </th>
                </tr>
              </thead>
              <tbody>
                {comparisons.map((c) => (
                  <tr
                    key={c.scenarioId}
                    className="border-b border-gray-50 hover:bg-gray-50"
                  >
                    <td className="py-2 px-3 font-medium text-gray-700">
                      {c.name}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-gray-600">
                      {formatPct(c.triEquity)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-gray-600">
                      {formatEuro(c.vanEquity)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-gray-600">
                      {formatPct(c.discountRate)}
                    </td>
                    <td className="py-2 px-3 text-center">
                      <VerdictBadge verdict={c.verdict} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Stress tests ── */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700">Stress tests</h3>
          <button
            onClick={() => setShowStress(!showStress)}
            className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors"
          >
            {showStress ? "Masquer" : "Afficher"}
          </button>
        </div>
        {showStress && stressResults && (
          <div className="space-y-2">
            <p className="text-xs text-gray-400 mb-2">
              Stress: travaux +15 %, revente −8 %, taux +1.5 pts · Cash: idem + vacance +5 pts, charges +10 %
            </p>
            <div className="grid grid-cols-3 gap-3">
              {(["base", "stress", "cash"] as const).map((key) => {
                const r = stressResults[key];
                return (
                  <div
                    key={key}
                    className={`rounded-lg p-3 border ${
                      key === "base"
                        ? "border-emerald-200 bg-emerald-50"
                        : key === "stress"
                        ? "border-amber-200 bg-amber-50"
                        : "border-red-200 bg-red-50"
                    }`}
                  >
                    <p className="text-xs font-semibold text-gray-600 mb-1 capitalize">
                      {key === "cash" ? "Cash dégradé" : key === "base" ? "Base" : "Stress"}
                    </p>
                    <p className="text-sm font-bold text-gray-800">
                      TRI: {formatPct(r.triEquity)}
                    </p>
                    <p className="text-xs text-gray-500">
                      VAN: {formatEuro(r.vanEquity)}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {showStress && !stressResults && (
          <p className="text-xs text-gray-400">
            Sélectionnez un scénario pour voir ses stress tests.
          </p>
        )}
      </div>

      {/* ── Négociation ── */}
      {negotiation && bestResult && (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">
            Négociation
          </h3>
          <p className="text-xs text-gray-400 mb-4">
            Basé sur le meilleur scénario (TRI le plus élevé). Prix affiché = prix d'achat actuel.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard
              label="Prix max recommandé"
              value={formatEuro(negotiation.prixMaxRecommande)}
              sub={`Marge: ${negotiation.margeNego > 0 ? "+" : ""}${negotiation.margeNego} %`}
              color={negotiation.margeNego > 0 ? "emerald" : "red"}
            />
            <KpiCard
              label="Zone sécurité (−5 %)"
              value={formatEuro(negotiation.zoneSecurity)}
              sub="Prix offre recommandé"
              color="green"
            />
            <KpiCard
              label="Seuil danger"
              value={formatEuro(negotiation.seuilDanger)}
              sub="VAN ≈ 0 à ce prix"
              color="amber"
            />
            <KpiCard
              label="Prix actuel"
              value={formatEuro(deal.prixAchat)}
              sub={`${formatEuro(deal.prixAchat / deal.surfaceM2)}/m²`}
              color="gray"
            />
          </div>
          {/* Visual bar */}
          <div className="mt-4 relative h-8 bg-gray-100 rounded-lg overflow-hidden">
            <NegotiationBar
              prixActuel={deal.prixAchat}
              prixMax={negotiation.prixMaxRecommande}
              zoneSec={negotiation.zoneSecurity}
              seuil={negotiation.seuilDanger}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ScenarioEditor (inline) ────────────────────────────────────────

function ScenarioEditor({
  scenario,
  rfRate,
  result,
  onUpdate,
  onUpdateFin,
}: {
  scenario: Scenario;
  rfRate: number;
  result: ScenarioResults | null;
  onUpdate: (patch: Partial<Scenario>) => void;
  onUpdateFin: (patch: Partial<Financement>) => void;
}) {
  const recRate = computeRecommendedDiscountRate(rfRate, scenario);

  return (
    <div className="pt-4 space-y-5">
      {/* Row 1: Durée + inflation */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <NumField
          label="Durée (années)"
          value={scenario.dureeAnnees}
          onChange={(v) => onUpdate({ dureeAnnees: v })}
          min={1}
          max={30}
          step={1}
        />
        <NumField
          label="Inflation marché (%)"
          value={scenario.inflationMarche}
          onChange={(v) => onUpdate({ inflationMarche: v })}
          step={0.5}
        />
        <NumField
          label="Inflation loyers (%)"
          value={scenario.inflationLoyers}
          onChange={(v) => onUpdate({ inflationLoyers: v })}
          step={0.5}
        />
        <NumField
          label="Inflation travaux (%)"
          value={scenario.inflationTravaux}
          onChange={(v) => onUpdate({ inflationTravaux: v })}
          step={0.5}
        />
      </div>

      {/* Row 2: Financement */}
      <div>
        <p className="text-xs font-medium text-gray-500 mb-2">Financement</p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <NumField
            label="Apport (%)"
            value={scenario.financement.apportPct}
            onChange={(v) => onUpdateFin({ apportPct: v })}
            min={0}
            max={100}
          />
          <NumField
            label="Taux nominal (%)"
            value={scenario.financement.tauxNominal}
            onChange={(v) => onUpdateFin({ tauxNominal: v })}
            step={0.1}
          />
          <NumField
            label="Durée prêt (mois)"
            value={scenario.financement.dureeMois}
            onChange={(v) => onUpdateFin({ dureeMois: v })}
            min={12}
            max={360}
            step={12}
          />
          <NumField
            label="Assurance (%)"
            value={scenario.financement.assurancePct}
            onChange={(v) => onUpdateFin({ assurancePct: v })}
            step={0.01}
          />
          <NumField
            label="Différé (mois)"
            value={scenario.financement.differeMois}
            onChange={(v) => onUpdateFin({ differeMois: v })}
            min={0}
            max={36}
          />
        </div>
      </div>

      {/* Row 3: Rendement cible */}
      <div>
        <p className="text-xs font-medium text-gray-500 mb-2">
          Rendement cible (taux d'actualisation)
        </p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Mode</label>
            <div className="flex rounded-lg border border-gray-200 overflow-hidden">
              {(["auto", "manual"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => onUpdate({ discountRateMode: m })}
                  className={`flex-1 px-3 py-1.5 text-xs font-medium transition-colors ${
                    scenario.discountRateMode === m
                      ? "bg-indigo-600 text-white"
                      : "bg-white text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {m === "auto" ? "Auto" : "Manuel"}
                </button>
              ))}
            </div>
          </div>
          {scenario.discountRateMode === "auto" ? (
            <>
              <NumField
                label="Prime risque (%)"
                value={scenario.primeRisqueScenario}
                onChange={(v) => onUpdate({ primeRisqueScenario: v })}
                step={0.5}
              />
              <NumField
                label="Prime illiquidité (%)"
                value={scenario.primeIlliquidite}
                onChange={(v) => onUpdate({ primeIlliquidite: v })}
                step={0.5}
              />
              <NumField
                label="Prime levier (%)"
                value={scenario.primeLevier}
                onChange={(v) => onUpdate({ primeLevier: v })}
                step={0.5}
              />
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Taux recommandé
                </label>
                <div className="px-3 py-1.5 bg-indigo-50 border border-indigo-200 rounded-lg text-sm font-bold text-indigo-700">
                  {formatPct(recRate)}
                </div>
              </div>
            </>
          ) : (
            <NumField
              label="Taux manuel (%)"
              value={scenario.discountRateManual}
              onChange={(v) => onUpdate({ discountRateManual: v })}
              step={0.5}
            />
          )}
        </div>
      </div>

      {/* Row 4: Résultats */}
      {result && (
        <div className="bg-gray-50 rounded-lg p-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <ResultKpi label="TRI equity" value={formatPct(result.triEquity)} />
            <ResultKpi label="VAN equity" value={formatEuro(result.vanEquity)} />
            <ResultKpi
              label="Cash-flow cumulé"
              value={formatEuro(result.cashFlowCumule)}
            />
            <ResultKpi
              label="Multiple capital"
              value={`${result.multipleCapital.toFixed(2)}x`}
            />
            <ResultKpi
              label="Mensualité"
              value={formatEuro(result.mensualite)}
            />
          </div>

          {/* Mini flux equity chart (text) */}
          <details className="mt-3">
            <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">
              Détail flux equity
            </summary>
            <div className="mt-2 flex flex-wrap gap-2">
              {result.fluxEquity.map((f, i) => (
                <span
                  key={i}
                  className={`text-xs font-mono px-2 py-0.5 rounded ${
                    f >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                  }`}
                >
                  t{i}: {formatEuro(f)}
                </span>
              ))}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

// ─── Reusable micro-components ──────────────────────────────────────

function NumField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
      />
    </div>
  );
}

function ResultKpi({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-sm font-bold text-gray-800">{value}</p>
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub: string;
  color: string;
}) {
  const colors: Record<string, string> = {
    emerald: "border-emerald-200 bg-emerald-50",
    green: "border-green-200 bg-green-50",
    amber: "border-amber-200 bg-amber-50",
    red: "border-red-200 bg-red-50",
    gray: "border-gray-200 bg-gray-50",
  };

  return (
    <div className={`border rounded-lg p-3 ${colors[color] ?? colors.gray}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-lg font-bold text-gray-800 mt-0.5">{value}</p>
      <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
    </div>
  );
}

function NegotiationBar({
  prixActuel,
  prixMax,
  zoneSec,
  seuil,
}: {
  prixActuel: number;
  prixMax: number;
  zoneSec: number;
  seuil: number;
}) {
  const maxVal = Math.max(prixActuel, prixMax, seuil) * 1.1;
  const toPos = (v: number) => `${Math.max(0, Math.min(100, (v / maxVal) * 100))}%`;

  return (
    <>
      {/* Green zone: 0 to zoneSec */}
      <div
        className="absolute top-0 bottom-0 bg-emerald-200 opacity-40"
        style={{ left: "0%", width: toPos(zoneSec) }}
      />
      {/* Yellow zone: zoneSec to prixMax */}
      <div
        className="absolute top-0 bottom-0 bg-amber-200 opacity-40"
        style={{ left: toPos(zoneSec), width: `calc(${toPos(prixMax)} - ${toPos(zoneSec)})` }}
      />
      {/* Red zone: beyond seuil */}
      <div
        className="absolute top-0 bottom-0 bg-red-200 opacity-40"
        style={{ left: toPos(seuil), right: "0%" }}
      />
      {/* Current price marker */}
      <div
        className="absolute top-0 bottom-0 w-0.5 bg-gray-800"
        style={{ left: toPos(prixActuel) }}
      >
        <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] font-bold text-gray-700 whitespace-nowrap">
          Actuel
        </span>
      </div>
    </>
  );
}