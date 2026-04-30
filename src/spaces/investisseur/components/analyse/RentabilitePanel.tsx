/**
 * RentabilitePanel.tsx
 * ─────────────────────────────────────────────────────────────────────
 * Panneau "Rentabilité" de l'onglet Analyse investisseur.
 *
 * v8.1 PATCH (bridge promoteur):
 * - Props optionnelles travauxFromSnapshot + promoteurMarketData
 *   ajoutées pour compatibilité AnalysePage v12.1.
 * - travauxFromSnapshot utilisé comme source fallback dans simTravaux
 *   quand le snapshot marchand n'a pas de données travaux.
 * - promoteurMarketData accepté (non utilisé directement dans ce panel
 *   — les données marché sont consommées par MarcheRisquesPanel).
 *
 * v8 PATCH:
 * - persistRentabiliteToSnapshot : paramètre renommé travauxCanonical
 *   (était travauxEstimes) — persiste la valeur réellement utilisée
 *   dans les calculs (travauxEffective = simulation ou manuelle).
 *   Deux clés persistées : travauxEstimes + travauxUtilises pour
 *   rétro-compatibilité et lisibilité.
 * - Le score local (triEquity * 5) est renommé rentabiliteLocalScore
 *   dans computed — il ne doit pas être lu comme smartScore canonique
 *   par buildCanonicalPayload / export-report-v1 / PDF.
 * - L'appel à persistRentabiliteToSnapshot passe travauxEffective
 *   (et non travauxEstimes) comme travauxCanonical.
 *
 * v8:
 * - Section FINANCEMENT dédiée avec paramètres crédit complets
 *   (montant, durée, taux nominal, assurance, frais dossier/garantie/courtier)
 * - Calcul coût réel du crédit via computeLoanCost()
 * - Persistance des champs financement dans rentabilite.inputs
 * - Prop dealId ajoutée
 *
 * v7:
 * - Ajout champs Apport personnel (€), Montant du prêt (€), LTV (%)
 *   dans la section Inputs clés du deal
 * - Persistance snapshot + chargement depuis snapshot
 *
 * v6:
 * - Tableaux comparatifs pédagogiques en bas de page
 *   · Location: comparaison LMNP Micro / LMNP Réel / Défiscalisation
 *   · Revente: fiscalité plus-value (non modélisée, info seulement)
 * - Masquage du sélecteur régime fiscal en stratégie Revente
 * ─────────────────────────────────────────────────────────────────────
 */

import React, {
  useState,
  useMemo,
  useCallback,
  useEffect,
  useRef,
} from "react";
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
  MARCHAND_SNAPSHOT_EVENT,
} from "../../../marchand/shared/marchandSnapshot.store";
import { computeLoanCost } from "../../../marchand/services/loanCost";

// ─── Props ───────────────────────────────────────────────────────────

interface RentabilitePanelProps {
  deal: DealInputs;
  dealId: string;
  strategy: StrategyType;
  fiscalRegime: FiscalRegime;
  onStrategyChange: (s: StrategyType) => void;
  onRegimeChange: (r: FiscalRegime) => void;
  /** Montant travaux depuis le snapshot investisseur (fallback si marchand absent) */
  travauxFromSnapshot?: number;
  /** Données marché fusionnées investisseur ← promoteur (non utilisé directement ici) */
  promoteurMarketData?: Record<string, unknown> | null;
}

// ─── Fiscal mode type ────────────────────────────────────────────────

type FiscalMode = "tmi" | "pfu";

// ─── Travaux source type ─────────────────────────────────────────────

type TravauxSource = "manual" | "simulation";

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

function persistRentabiliteToSnapshot(
  dealId: string,
  deal: DealInputs,
  strategy: StrategyType,
  fiscalRegime: FiscalRegime,
  scenarios: Scenario[],
  allResults: ScenarioResults[],
  loyerMensuel: number,
  chargesMensuelles: number,
  travauxCanonical: number,
  prixReventeEstime: number,
  fiscalMode: FiscalMode,
  tmiPct: number,
  pfuPct: number,
  travauxSource: TravauxSource,
  apportPersonnel: number,
  montantPret: number,
  loanDureeAnnees: number,
  tauxNominalAnnuelPct: number,
  tauxAssuranceAnnuelPct: number,
  fraisDossierEur: number,
  fraisGarantieEur: number,
  fraisCourtierEur: number,
) {
  if (!dealId) return;

  const bestResult =
    allResults.length > 0
      ? allResults.reduce((best, r) =>
          (r.triEquity ?? -999) > (best.triEquity ?? -999) ? r : best,
        )
      : null;

  const bestScenario = bestResult
    ? scenarios.find((s) => s.id === bestResult.scenarioId)
    : scenarios[0] ?? null;

  const coutTotal = deal.prixAchat + travauxCanonical;
  const ltvPct =
    montantPret > 0 && coutTotal > 0
      ? Math.round((montantPret / coutTotal) * 1000) / 10
      : undefined;

  const inputs: Record<string, unknown> = {
    prixAchat: deal.prixAchat,
    surfaceM2: deal.surfaceM2,
    prixReventeCible:
      prixReventeEstime || deal.prixReventeEstime || deal.prixAchat,
    prixReventeEstime:
      prixReventeEstime || deal.prixReventeEstime || deal.prixAchat,
    strategy,
    fiscalRegime,
    travauxEstimes: travauxCanonical || undefined,
    travauxUtilises: travauxCanonical || undefined,
    travauxSource,
    loyerEstime: loyerMensuel || undefined,
    loyerMensuel: loyerMensuel || undefined,
    chargesEstimees: chargesMensuelles || undefined,
    chargesMensuelles: chargesMensuelles || undefined,
    chargesUnit: "mois",
    dureeMois: bestScenario
      ? (bestScenario.dureeAnnees ?? 10) * 12
      : undefined,
    dureeAnnees: bestScenario?.dureeAnnees ?? undefined,
    fiscalMode,
    tmiPct,
    pfuPct,
    apportPersonnel: apportPersonnel || undefined,
    montantPret: montantPret || undefined,
    ltvPct,
    loanDureeAnnees: loanDureeAnnees || undefined,
    tauxNominalAnnuelPct: tauxNominalAnnuelPct || undefined,
    tauxAssuranceAnnuelPct: tauxAssuranceAnnuelPct || undefined,
    fraisDossierEur: fraisDossierEur || undefined,
    fraisGarantieEur: fraisGarantieEur || undefined,
    fraisCourtierEur: fraisCourtierEur || undefined,
  };

  const computed: Record<string, unknown> = bestResult
    ? {
        triEquity: bestResult.triEquity,
        vanEquity: bestResult.vanEquity,
        cashFlowCumule: bestResult.cashFlowCumule,
        multipleCapital: bestResult.multipleCapital,
        mensualite: bestResult.mensualite,
        verdict: bestResult.verdict,
        rendementBrutPct:
          (bestResult as Record<string, unknown>).rendementBrutPct ??
          undefined,
        rendementBrut:
          (bestResult as Record<string, unknown>).rendementBrutPct ??
          undefined,
        margeBrutePct:
          (bestResult as Record<string, unknown>).margeBrutePct ?? undefined,
        coutProjet:
          (bestResult as Record<string, unknown>).coutProjet ?? undefined,
        coutAchat:
          (bestResult as Record<string, unknown>).coutAchat ?? undefined,
        margeBrute:
          (bestResult as Record<string, unknown>).margeBrute ?? undefined,
        rentabiliteLocalScore:
          bestResult.triEquity != null
            ? Math.max(0, Math.min(100, Math.round(bestResult.triEquity * 5)))
            : undefined,
      }
    : {};

  try {
    patchRentabiliteForDeal(dealId, {
      inputs,
      computed,
      taxRegime: fiscalRegime as string,
      taxConfig: undefined as unknown as Record<string, unknown>,
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
  prixReventeEstime: number;
  fiscalMode: FiscalMode;
  tmiPct: number;
  pfuPct: number;
  travauxSource: TravauxSource;
  apportPersonnel: number;
  montantPret: number;
  loanDureeAnnees: number;
  tauxNominalAnnuelPct: number;
  tauxAssuranceAnnuelPct: number;
  fraisDossierEur: number;
  fraisGarantieEur: number;
  fraisCourtierEur: number;
}

function loadKeyInputsFromSnapshot(
  dealId: string,
  deal: DealInputs,
): KeyInputsFromSnapshot {
  const defaults: KeyInputsFromSnapshot = {
    loyerMensuel: 0,
    chargesMensuelles: 0,
    travauxEstimes: 0,
    prixReventeEstime:
      (deal.prixReventeEstime > 0 ? deal.prixReventeEstime : deal.prixAchat) ||
      0,
    fiscalMode: "tmi",
    tmiPct: 30,
    pfuPct: 30,
    travauxSource: "manual",
    apportPersonnel: 0,
    montantPret: 0,
    loanDureeAnnees: 20,
    tauxNominalAnnuelPct: 3.5,
    tauxAssuranceAnnuelPct: 0.34,
    fraisDossierEur: 0,
    fraisGarantieEur: 0,
    fraisCourtierEur: 0,
  };

  try {
    const snap = readMarchandSnapshot();
    const renta = snap.rentabiliteByDeal[dealId] as
      | Record<string, unknown>
      | undefined;
    const inputs = renta?.inputs as Record<string, unknown> | undefined;

    const safeN = (v: unknown): number => {
      if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
      return 0;
    };

    const snapshotRevente = safeN(
      inputs?.prixReventeEstime ??
        inputs?.prixReventeCible ??
        inputs?.resaleTarget,
    );

    const rawMode = inputs?.fiscalMode;
    const fiscalMode: FiscalMode =
      rawMode === "tmi" || rawMode === "pfu" ? rawMode : "tmi";

    const rawTravauxSource = inputs?.travauxSource;
    const travauxSource: TravauxSource =
      rawTravauxSource === "manual" || rawTravauxSource === "simulation"
        ? rawTravauxSource
        : "manual";

    return {
      loyerMensuel: safeN(
        inputs?.loyerMensuel ?? inputs?.loyerEstime ?? inputs?.loyer,
      ),
      chargesMensuelles: safeN(
        inputs?.chargesMensuelles ?? inputs?.chargesEstimees ?? inputs?.charges,
      ),
      travauxEstimes: safeN(
        inputs?.travauxUtilises ??
          inputs?.travauxEstimes ??
          inputs?.travaux ??
          inputs?.montantTravaux,
      ),
      prixReventeEstime: snapshotRevente || defaults.prixReventeEstime,
      fiscalMode,
      tmiPct: safeN(inputs?.tmiPct) || 30,
      pfuPct: safeN(inputs?.pfuPct) || 30,
      travauxSource,
      apportPersonnel: safeN(
        inputs?.apportPersonnel ?? inputs?.apport ?? inputs?.downPayment,
      ),
      montantPret: safeN(
        inputs?.montantPret ?? inputs?.pret ?? inputs?.loanAmount,
      ),
      loanDureeAnnees: safeN(inputs?.loanDureeAnnees) || 20,
      tauxNominalAnnuelPct: safeN(inputs?.tauxNominalAnnuelPct) || 3.5,
      tauxAssuranceAnnuelPct: safeN(inputs?.tauxAssuranceAnnuelPct) || 0.34,
      fraisDossierEur: safeN(inputs?.fraisDossierEur),
      fraisGarantieEur: safeN(inputs?.fraisGarantieEur),
      fraisCourtierEur: safeN(inputs?.fraisCourtierEur),
    };
  } catch {
    return defaults;
  }
}

// ─── Fiscal computation helper ───────────────────────────────────────

interface FiscalKpis {
  baseImposable: number;
  impotAnnuel: number;
  cashflowNetMensuel: number;
  regime: string;
}

function computeFiscalKpis(
  fiscalRegime: FiscalRegime,
  fiscalMode: FiscalMode,
  tmiPct: number,
  pfuPct: number,
  loyerMensuel: number,
  chargesMensuelles: number,
  bestResult: ScenarioResults | null,
): FiscalKpis {
  const loyerAnnuel = loyerMensuel * 12;
  const chargesAnnuelles = chargesMensuelles * 12;
  const mensualite = bestResult?.mensualite ?? 0;
  const interetsAssuranceAnnuels = mensualite > 0 ? mensualite * 12 * 0.65 : 0;

  let baseImposable = 0;
  let regimeLabel = "";

  switch (fiscalRegime) {
    case "lmnp_micro":
      baseImposable = loyerAnnuel * 0.5;
      regimeLabel = "LMNP Micro (abattement 50 %)";
      break;
    case "lmnp_reel":
    case "defiscalisation":
      baseImposable = Math.max(
        0,
        loyerAnnuel - chargesAnnuelles - interetsAssuranceAnnuels,
      );
      regimeLabel =
        fiscalRegime === "defiscalisation"
          ? "Défiscalisation (traité réel v1)"
          : "LMNP Réel (charges déduites)";
      break;
    case "lmp":
      baseImposable = Math.max(
        0,
        loyerAnnuel - chargesAnnuelles - interetsAssuranceAnnuels,
      );
      regimeLabel = "LMP (charges déduites)";
      break;
    case "sci_is":
      baseImposable = Math.max(
        0,
        loyerAnnuel - chargesAnnuelles - interetsAssuranceAnnuels,
      );
      regimeLabel = "SCI IS (charges déduites)";
      break;
    case "sci_ir":
    case "nom_propre":
      if (loyerAnnuel <= 15000) {
        baseImposable = loyerAnnuel * 0.7;
        regimeLabel =
          fiscalRegime === "sci_ir"
            ? "SCI IR micro-foncier (abattement 30 %)"
            : "Nom propre micro-foncier (abattement 30 %)";
      } else {
        baseImposable = Math.max(
          0,
          loyerAnnuel - chargesAnnuelles - interetsAssuranceAnnuels,
        );
        regimeLabel =
          fiscalRegime === "sci_ir"
            ? "SCI IR réel (charges déduites)"
            : "Nom propre réel (charges déduites)";
      }
      break;
    default:
      baseImposable = loyerAnnuel * 0.5;
      regimeLabel = "Régime par défaut (50 %)";
  }

  const tauxEffectif = fiscalMode === "pfu" ? pfuPct : tmiPct;
  const impotAnnuel = baseImposable * (tauxEffectif / 100);
  const cashflowNetMensuel =
    loyerMensuel - chargesMensuelles - mensualite - impotAnnuel / 12;

  return {
    baseImposable: Math.round(baseImposable),
    impotAnnuel: Math.round(impotAnnuel),
    cashflowNetMensuel: Math.round(cashflowNetMensuel),
    regime: regimeLabel,
  };
}

// ─── Main component ─────────────────────────────────────────────────

export default function RentabilitePanel({
  deal,
  dealId,
  strategy,
  fiscalRegime,
  onStrategyChange,
  onRegimeChange,
  travauxFromSnapshot,
  // promoteurMarketData accepté mais non utilisé directement dans ce panel
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  promoteurMarketData: _promoteurMarketData,
}: RentabilitePanelProps) {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [riskFreeRate, setRiskFreeRate] = useState<MacroRate | null>(null);
  const [expandedScenario, setExpandedScenario] = useState<string | null>(null);
  const [showStress, setShowStress] = useState(false);
  const [snapshotTick, setSnapshotTick] = useState(0);

  // ── Inputs clés ────────────────────────────────────────────────────
  const [loyerMensuel, setLoyerMensuel] = useState<number>(0);
  const [chargesMensuelles, setChargesMensuelles] = useState<number>(0);
  const [travauxEstimes, setTravauxEstimes] = useState<number>(0);
  const [prixReventeEstime, setPrixReventeEstime] = useState<number>(0);

  // ── Financement inputs (v7) ────────────────────────────────────────
  const [apportPersonnel, setApportPersonnel] = useState<number>(0);
  const [montantPret, setMontantPret] = useState<number>(0);

  // ── Financement crédit détaillé (v8) ──────────────────────────────
  const [loanDureeAnnees, setLoanDureeAnnees] = useState<number>(20);
  const [tauxNominalAnnuelPct, setTauxNominalAnnuelPct] =
    useState<number>(3.5);
  const [tauxAssuranceAnnuelPct, setTauxAssuranceAnnuelPct] =
    useState<number>(0.34);
  const [fraisDossierEur, setFraisDossierEur] = useState<number>(0);
  const [fraisGarantieEur, setFraisGarantieEur] = useState<number>(0);
  const [fraisCourtierEur, setFraisCourtierEur] = useState<number>(0);

  // ── Fiscal params ──────────────────────────────────────────────────
  const [fiscalMode, setFiscalMode] = useState<FiscalMode>("tmi");
  const [tmiPct, setTmiPct] = useState<number>(30);
  const [pfuPct, setPfuPct] = useState<number>(30);

  // ── Travaux source toggle ──────────────────────────────────────────
  const [travauxSource, setTravauxSource] = useState<TravauxSource>("manual");

  const initialLoadRef = useRef(true);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loanPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(() => {
    const onSnap = () => setSnapshotTick((x) => x + 1);
    window.addEventListener(MARCHAND_SNAPSHOT_EVENT, onSnap as EventListener);
    return () =>
      window.removeEventListener(
        MARCHAND_SNAPSHOT_EVENT,
        onSnap as EventListener,
      );
  }, []);

  // ── Load key inputs from snapshot when deal changes ────────────────
  useEffect(() => {
    const id = dealId || deal?.dealId;
    if (!id) return;
    const saved = loadKeyInputsFromSnapshot(id, deal);
    setLoyerMensuel(saved.loyerMensuel);
    setChargesMensuelles(saved.chargesMensuelles);
    setTravauxEstimes(saved.travauxEstimes);
    setPrixReventeEstime(saved.prixReventeEstime);
    setFiscalMode(saved.fiscalMode);
    setTmiPct(saved.tmiPct);
    setPfuPct(saved.pfuPct);
    setTravauxSource(saved.travauxSource);
    setApportPersonnel(saved.apportPersonnel);
    setMontantPret(saved.montantPret);
    setLoanDureeAnnees(saved.loanDureeAnnees);
    setTauxNominalAnnuelPct(saved.tauxNominalAnnuelPct);
    setTauxAssuranceAnnuelPct(saved.tauxAssuranceAnnuelPct);
    setFraisDossierEur(saved.fraisDossierEur);
    setFraisGarantieEur(saved.fraisGarantieEur);
    setFraisCourtierEur(saved.fraisCourtierEur);
  }, [dealId, deal?.dealId, snapshotTick]);

  useEffect(() => {
    const maxDuration = Math.max(
      ...(scenarios.length ? scenarios.map((s) => s.dureeAnnees) : [10]),
    );
    fetchRiskFreeRate(maxDuration).then(setRiskFreeRate);
  }, [scenarios.length]);

  useEffect(() => {
    setScenarios(generateDefaultScenarios(strategy, fiscalRegime));
  }, [strategy, fiscalRegime]);

  useEffect(() => {
    if (scenarios.length > 0 && !expandedScenario) {
      setExpandedScenario(scenarios[0].id);
    }
  }, [scenarios, expandedScenario]);

  const rfRate = riskFreeRate?.valuePct ?? 3.0;

  // ── Travaux from simulation snapshot ───────────────────────────────
  // v8.1: fallback sur travauxFromSnapshot (investisseur) si marchand absent
  const simTravaux = useMemo<number>(() => {
    try {
      const snap = readMarchandSnapshot();
      const execution = snap.execution as
        | { travaux?: { computed?: { totalWithBuffer?: number; total?: number } } }
        | undefined;
      const computed = execution?.travaux?.computed;
      const val = computed?.totalWithBuffer ?? computed?.total ?? 0;
      if (typeof val === "number" && Number.isFinite(val) && val > 0) {
        return val;
      }
    } catch {
      // fallthrough
    }
    // Fallback : travauxFromSnapshot (prop investisseur)
    if (
      typeof travauxFromSnapshot === "number" &&
      Number.isFinite(travauxFromSnapshot) &&
      travauxFromSnapshot > 0
    ) {
      return travauxFromSnapshot;
    }
    return 0;
  }, [deal?.dealId, snapshotTick, travauxFromSnapshot]);

  const travauxEffective = useMemo<number>(() => {
    return travauxSource === "simulation" && simTravaux > 0
      ? simTravaux
      : travauxEstimes;
  }, [travauxSource, simTravaux, travauxEstimes]);

  // ── LTV calculé (v7) ──────────────────────────────────────────────
  const ltvPct = useMemo<number | null>(() => {
    const coutTotal = deal.prixAchat + travauxEffective;
    if (montantPret <= 0 || coutTotal <= 0) return null;
    return Math.round((montantPret / coutTotal) * 1000) / 10;
  }, [montantPret, deal.prixAchat, travauxEffective]);

  const dealForCalc = useMemo((): DealInputs => {
    const safeLoyerMensuel = Number(loyerMensuel) || 0;
    const safeChargesMensuelles = Number(chargesMensuelles) || 0;
    const safeTravauxEffective = Number(travauxEffective) || 0;
    const safePrixRevente = Number(prixReventeEstime) || 0;

    return {
      ...deal,
      loyerMensuelBrut: safeLoyerMensuel || deal.loyerMensuelBrut || 0,
      chargesAnnuelles:
        safeChargesMensuelles > 0
          ? safeChargesMensuelles * 12
          : deal.chargesAnnuelles || 0,
      montantTravaux: safeTravauxEffective || deal.montantTravaux || 0,
      prixReventeEstime:
        safePrixRevente > 0
          ? safePrixRevente
          : deal.prixReventeEstime > 0
            ? deal.prixReventeEstime
            : deal.prixAchat || 0,
    } as DealInputs;
  }, [deal, loyerMensuel, chargesMensuelles, travauxEffective, prixReventeEstime]);

  const allResults = useMemo<ScenarioResults[]>(() => {
    return scenarios.map((sc) => computeScenarioResults(dealForCalc, sc, rfRate));
  }, [scenarios, dealForCalc, rfRate]);

  const bestResult = useMemo(() => {
    if (allResults.length === 0) return null;
    return allResults.reduce((best, r) =>
      (r.triEquity ?? -999) > (best.triEquity ?? -999) ? r : best,
    );
  }, [allResults]);

  const fiscalKpis = useMemo<FiscalKpis | null>(() => {
    if (strategy !== "location" || loyerMensuel <= 0) return null;
    return computeFiscalKpis(
      fiscalRegime,
      fiscalMode,
      tmiPct,
      pfuPct,
      loyerMensuel,
      chargesMensuelles,
      bestResult,
    );
  }, [
    strategy,
    fiscalRegime,
    fiscalMode,
    tmiPct,
    pfuPct,
    loyerMensuel,
    chargesMensuelles,
    bestResult,
  ]);

  // ── Coût réel du crédit (v8) ──────────────────────────────────────
  const loanCost = useMemo(() => {
    if (
      montantPret <= 0 ||
      tauxNominalAnnuelPct <= 0 ||
      loanDureeAnnees <= 0
    ) {
      return null;
    }
    try {
      return computeLoanCost({
        principal: montantPret,
        annualRateNominalPct: tauxNominalAnnuelPct,
        years: loanDureeAnnees,
        annualInsuranceRatePct: tauxAssuranceAnnuelPct,
        upfrontFeesEur:
          fraisDossierEur + fraisGarantieEur + fraisCourtierEur,
      });
    } catch {
      return null;
    }
  }, [
    montantPret,
    tauxNominalAnnuelPct,
    loanDureeAnnees,
    tauxAssuranceAnnuelPct,
    fraisDossierEur,
    fraisGarantieEur,
    fraisCourtierEur,
  ]);

  // ── Persist rentabilité (debounced) ────────────────────────────────
  useEffect(() => {
    if (initialLoadRef.current) {
      initialLoadRef.current = false;
      return;
    }
    const id = dealId || deal.dealId;
    if (!id || allResults.length === 0) return;

    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      persistRentabiliteToSnapshot(
        id,
        deal,
        strategy,
        fiscalRegime,
        scenarios,
        allResults,
        loyerMensuel,
        chargesMensuelles,
        travauxEffective,
        prixReventeEstime,
        fiscalMode,
        tmiPct,
        pfuPct,
        travauxSource,
        apportPersonnel,
        montantPret,
        loanDureeAnnees,
        tauxNominalAnnuelPct,
        tauxAssuranceAnnuelPct,
        fraisDossierEur,
        fraisGarantieEur,
        fraisCourtierEur,
      );
    }, PERSIST_DEBOUNCE_MS);

    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, [
    allResults,
    deal,
    dealId,
    deal.dealId,
    strategy,
    fiscalRegime,
    scenarios,
    loyerMensuel,
    chargesMensuelles,
    travauxEffective,
    prixReventeEstime,
    fiscalMode,
    tmiPct,
    pfuPct,
    travauxSource,
    apportPersonnel,
    montantPret,
    loanDureeAnnees,
    tauxNominalAnnuelPct,
    tauxAssuranceAnnuelPct,
    fraisDossierEur,
    fraisGarantieEur,
    fraisCourtierEur,
  ]);

  // ── Patch loan fields individuellement (debounced) ─────────────────
  const patchLoanField = useCallback(
    (field: string, value: number) => {
      const id = dealId || deal.dealId;
      if (!id) return;
      if (loanPersistTimerRef.current) clearTimeout(loanPersistTimerRef.current);
      loanPersistTimerRef.current = setTimeout(() => {
        try {
          patchRentabiliteForDeal(id, {
            inputs: { [field]: value || undefined },
          });
        } catch (e) {
          console.warn("[RentabilitePanel] loan field patch failed:", e);
        }
      }, PERSIST_DEBOUNCE_MS);
    },
    [dealId, deal.dealId],
  );

  const stressResults = useMemo<StressTestResults | null>(() => {
    if (!showStress || !expandedScenario) return null;
    const sc = scenarios.find((s) => s.id === expandedScenario);
    if (!sc) return null;
    return computeStressTests(dealForCalc, sc, rfRate);
  }, [showStress, expandedScenario, scenarios, dealForCalc, rfRate]);

  const negotiation = useMemo<NegotiationResult | null>(() => {
    if (!bestResult) return null;
    const sc = scenarios.find((s) => s.id === bestResult.scenarioId);
    if (!sc) return null;
    return computeNegotiation(dealForCalc, sc, rfRate);
  }, [bestResult, scenarios, dealForCalc, rfRate]);

  const comparisons = useMemo(
    () => buildScenarioComparisons(allResults, scenarios),
    [allResults, scenarios],
  );

  // ── Scenario CRUD ──────────────────────────────────────────────────

  const updateScenario = useCallback((id: string, patch: Partial<Scenario>) => {
    setScenarios((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    );
  }, []);

  const updateFinancement = useCallback(
    (id: string, patch: Partial<Financement>) => {
      setScenarios((prev) =>
        prev.map((s) =>
          s.id === id
            ? { ...s, financement: { ...s.financement, ...patch } }
            : s,
        ),
      );
    },
    [],
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

  // ── Format helpers ─────────────────────────────────────────────────

  const fmtEur = (v: number | undefined | null) =>
    typeof v === "number" && Number.isFinite(v) && v > 0
      ? `${v.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €`
      : "—";

  const fmtEurSigned = (v: number) => {
    const abs = Math.abs(v);
    const str = `${abs.toLocaleString("fr-FR", {
      maximumFractionDigits: 0,
    })} €`;
    return v >= 0 ? str : `−${str}`;
  };

  const margeBruteRevente =
    prixReventeEstime > 0 && deal.prixAchat > 0
      ? prixReventeEstime - deal.prixAchat - travauxEffective
      : null;

  // ── Render ─────────────────────────────────────────────────────────

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

          {strategy === "location" && (
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
          )}

          {strategy === "revente" && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">
                Régime fiscal
              </label>
              <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-400">
                Plus-value immobilière (voir tableau en bas)
              </div>
            </div>
          )}

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

      {/* ── Inputs clés ── */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-2">
          <span>🔑</span> Inputs clés du deal
        </h3>
        <p className="text-xs text-gray-400 mb-4">
          Renseignez le loyer mensuel estimé, les charges, le budget travaux et
          le prix de revente souhaité. Ces données alimentent les scénarios et
          la Synthèse IA.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
              onChange={(e) =>
                setChargesMensuelles(parseFloat(e.target.value) || 0)
              }
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <p className="text-[10px] text-gray-400 mt-1">
              Copropriété, taxe foncière, assurance PNO…
            </p>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-medium text-gray-500">
                Travaux estimés (€)
              </label>
              <div className="flex rounded border border-gray-200 overflow-hidden">
                {(["manual", "simulation"] as TravauxSource[]).map((src) => (
                  <button
                    key={src}
                    onClick={() => setTravauxSource(src)}
                    className={`px-2 py-0.5 text-[10px] font-medium transition-colors ${
                      travauxSource === src
                        ? "bg-indigo-600 text-white"
                        : "bg-white text-gray-500 hover:bg-gray-50"
                    }`}
                  >
                    {src === "manual" ? "Saisie" : "Simulation"}
                  </button>
                ))}
              </div>
            </div>
            <input
              type="number"
              value={travauxEffective || ""}
              placeholder="ex: 15000"
              min={0}
              step={1000}
              readOnly={travauxSource === "simulation"}
              onChange={(e) => {
                if (travauxSource === "manual") {
                  setTravauxEstimes(parseFloat(e.target.value) || 0);
                }
              }}
              className={`w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 ${
                travauxSource === "simulation"
                  ? "bg-gray-50 cursor-not-allowed"
                  : ""
              }`}
            />
            {travauxSource === "simulation" && simTravaux > 0 && (
              <p className="text-[10px] text-indigo-500 mt-1">
                Depuis simulation travaux
              </p>
            )}
            {travauxSource === "simulation" && simTravaux <= 0 && (
              <p className="text-[10px] text-amber-500 mt-1">
                Aucune simulation disponible — saisie manuelle utilisée
              </p>
            )}
            {travauxEffective > 0 && deal.surfaceM2 > 0 && (
              <p className="text-[10px] text-gray-400 mt-1">
                {Math.round(travauxEffective / deal.surfaceM2)} €/m²
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              Prix de revente souhaité (€)
            </label>
            <input
              type="number"
              value={prixReventeEstime || ""}
              placeholder="ex: 250000"
              min={0}
              step={5000}
              onChange={(e) =>
                setPrixReventeEstime(parseFloat(e.target.value) || 0)
              }
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <p className="text-[10px] text-gray-400 mt-1">
              Utilisé pour calculer marge, VAN et TRI.
            </p>
          </div>
        </div>

        {/* ── Financement résumé (v7) ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-4 pt-4 border-t border-gray-100">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              Apport personnel (€)
            </label>
            <input
              type="number"
              value={apportPersonnel || ""}
              placeholder="ex: 50000"
              min={0}
              step={1000}
              onChange={(e) =>
                setApportPersonnel(parseFloat(e.target.value) || 0)
              }
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            {apportPersonnel > 0 && deal.prixAchat > 0 && (
              <p className="text-[10px] text-gray-400 mt-1">
                {(
                  (apportPersonnel / (deal.prixAchat + travauxEffective)) *
                  100
                ).toFixed(1)}{" "}
                % du coût total
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              Montant du prêt (€)
            </label>
            <input
              type="number"
              value={montantPret || ""}
              placeholder="ex: 200000"
              min={0}
              step={1000}
              onChange={(e) => {
                const v = parseFloat(e.target.value) || 0;
                setMontantPret(v);
                patchLoanField("montantPret", v);
              }}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            {montantPret > 0 && apportPersonnel > 0 && (
              <p className="text-[10px] text-gray-400 mt-1">
                Total financement : {fmtEur(apportPersonnel + montantPret)}
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              LTV (%)
            </label>
            <div
              className={`px-3 py-2 border rounded-lg text-sm font-semibold ${
                ltvPct !== null
                  ? ltvPct > 90
                    ? "border-red-200 bg-red-50 text-red-700"
                    : ltvPct > 80
                      ? "border-amber-200 bg-amber-50 text-amber-700"
                      : "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-gray-200 bg-gray-50 text-gray-400"
              }`}
            >
              {ltvPct !== null ? `${ltvPct.toFixed(1)} %` : "—"}
            </div>
            <p className="text-[10px] text-gray-400 mt-1">
              Prêt / (prix achat + travaux)
            </p>
          </div>
        </div>

        {/* Quick summary */}
        <div className="mt-3 flex flex-wrap gap-3 text-xs">
          {loyerMensuel > 0 && deal.prixAchat > 0 && (
            <span className="px-2.5 py-1 rounded-md bg-indigo-50 text-indigo-700 font-medium">
              Rendement brut indicatif :{" "}
              {(
                ((loyerMensuel * 12) / (deal.prixAchat + travauxEffective)) *
                100
              ).toFixed(1)}{" "}
              %
            </span>
          )}
          {loyerMensuel > 0 && chargesMensuelles > 0 && (
            <span className="px-2.5 py-1 rounded-md bg-gray-50 text-gray-600">
              Cashflow brut : {fmtEur(loyerMensuel - chargesMensuelles)}/mois
            </span>
          )}
          {margeBruteRevente !== null && (
            <span
              className={`px-2.5 py-1 rounded-md font-medium ${
                margeBruteRevente >= 0
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-red-50 text-red-700"
              }`}
            >
              Marge brute revente : {fmtEurSigned(margeBruteRevente)}
            </span>
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          v8: SECTION FINANCEMENT — Coût réel du crédit
          ══════════════════════════════════════════════════════════════ */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-2">
          <span>🏦</span> Financement — Coût réel du crédit
        </h3>
        <p className="text-xs text-gray-400 mb-4">
          Paramétrez votre crédit immobilier pour visualiser le coût total sur
          la durée.
        </p>

        {/* Champs de saisie */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              Montant emprunté (€)
            </label>
            <input
              type="number"
              value={montantPret || ""}
              placeholder="ex: 200000"
              min={0}
              step={1000}
              onChange={(e) => {
                const v = parseFloat(e.target.value) || 0;
                setMontantPret(v);
                patchLoanField("montantPret", v);
              }}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              Durée (années)
            </label>
            <input
              type="number"
              value={loanDureeAnnees || ""}
              placeholder="ex: 20"
              min={1}
              max={30}
              step={1}
              onChange={(e) => {
                const v = parseFloat(e.target.value) || 0;
                setLoanDureeAnnees(v);
                patchLoanField("loanDureeAnnees", v);
              }}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              Taux nominal (%)
            </label>
            <input
              type="number"
              value={tauxNominalAnnuelPct || ""}
              placeholder="ex: 3.5"
              min={0}
              max={20}
              step={0.05}
              onChange={(e) => {
                const v = parseFloat(e.target.value) || 0;
                setTauxNominalAnnuelPct(v);
                patchLoanField("tauxNominalAnnuelPct", v);
              }}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              Assurance (% annuel)
            </label>
            <input
              type="number"
              value={tauxAssuranceAnnuelPct || ""}
              placeholder="ex: 0.34"
              min={0}
              max={5}
              step={0.01}
              onChange={(e) => {
                const v = parseFloat(e.target.value) || 0;
                setTauxAssuranceAnnuelPct(v);
                patchLoanField("tauxAssuranceAnnuelPct", v);
              }}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <p className="text-[10px] text-gray-400 mt-1">
              Sur le capital initial
            </p>
          </div>
        </div>

        {/* Frais */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4 pt-4 border-t border-gray-100">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              Frais de dossier (€)
            </label>
            <input
              type="number"
              value={fraisDossierEur || ""}
              placeholder="ex: 1000"
              min={0}
              step={100}
              onChange={(e) => {
                const v = parseFloat(e.target.value) || 0;
                setFraisDossierEur(v);
                patchLoanField("fraisDossierEur", v);
              }}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              Frais de garantie (€)
            </label>
            <input
              type="number"
              value={fraisGarantieEur || ""}
              placeholder="ex: 2000"
              min={0}
              step={100}
              onChange={(e) => {
                const v = parseFloat(e.target.value) || 0;
                setFraisGarantieEur(v);
                patchLoanField("fraisGarantieEur", v);
              }}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <p className="text-[10px] text-gray-400 mt-1">
              Caution, hypothèque…
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              Frais de courtier (€)
            </label>
            <input
              type="number"
              value={fraisCourtierEur || ""}
              placeholder="ex: 1500"
              min={0}
              step={100}
              onChange={(e) => {
                const v = parseFloat(e.target.value) || 0;
                setFraisCourtierEur(v);
                patchLoanField("fraisCourtierEur", v);
              }}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
        </div>

        {/* Résultats coût du crédit */}
        {loanCost ? (
          <div className="mt-5 pt-4 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-600 mb-3 uppercase tracking-wide">
              Coût réel du crédit
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <KpiCard
                label="Mensualité"
                value={fmtEur(loanCost.monthlyPaymentExclInsurance)}
                sub="Hors assurance"
                color="gray"
              />
              <KpiCard
                label="Assurance mensuelle"
                value={fmtEur(loanCost.monthlyInsurance ?? 0)}
                sub={`${tauxAssuranceAnnuelPct} %/an`}
                color="gray"
              />
              <KpiCard
                label="Intérêts totaux"
                value={fmtEur(loanCost.totalInterest)}
                sub={`Sur ${loanDureeAnnees} ans`}
                color={
                  loanCost.totalInterest > montantPret * 0.5 ? "amber" : "gray"
                }
              />
              <KpiCard
                label="Frais initiaux"
                value={fmtEur(
                  fraisDossierEur + fraisGarantieEur + fraisCourtierEur,
                )}
                sub="Dossier + garantie + courtier"
                color="gray"
              />
              <KpiCard
                label="Coût total du crédit"
                value={fmtEur(loanCost.totalCostOfCredit)}
                sub="Intérêts + assurance + frais"
                color="amber"
              />
              <KpiCard
                label="Total remboursé"
                value={fmtEur(loanCost.totalRepaidAllIn)}
                sub="Capital + tout inclus"
                color="red"
              />
            </div>
            <p className="mt-3 text-xs text-gray-500 bg-indigo-50 border border-indigo-100 rounded-lg px-4 py-2.5">
              Sur la durée, vous payez{" "}
              <span className="font-semibold text-indigo-700">
                {fmtEur(loanCost.totalCostOfCredit)}
              </span>{" "}
              à la banque en plus du capital emprunté.
            </p>
          </div>
        ) : (
          montantPret > 0 && (
            <p className="mt-4 text-xs text-gray-400">
              Renseignez le taux nominal et la durée pour calculer le coût du
              crédit.
            </p>
          )
        )}

        {montantPret <= 0 && (
          <p className="mt-4 text-xs text-gray-400">
            Renseignez le montant emprunté pour activer le simulateur.
          </p>
        )}
      </div>

      {/* ── Fiscalité (location only) ── */}
      {strategy === "location" && (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-2">
            <span>🧾</span> Fiscalité (v1)
          </h3>
          <p className="text-xs text-gray-400 mb-4">
            Paramétrez votre imposition pour estimer le cashflow net après
            impôt.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">
                Mode d'imposition
              </label>
              <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                {(["tmi", "pfu"] as FiscalMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setFiscalMode(m)}
                    className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                      fiscalMode === m
                        ? "bg-indigo-600 text-white"
                        : "bg-white text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    {m === "tmi" ? "TMI (barème)" : "PFU (flat tax)"}
                  </button>
                ))}
              </div>
            </div>
            {fiscalMode === "tmi" ? (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">
                  Tranche marginale d'imposition (%)
                </label>
                <input
                  type="number"
                  value={tmiPct}
                  min={0}
                  max={100}
                  step={0.5}
                  onChange={(e) => setTmiPct(parseFloat(e.target.value) || 0)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
                <p className="text-[10px] text-gray-400 mt-1">
                  0 % · 11 % · 30 % · 41 % · 45 % (+ PS 17,2 % non inclus ici)
                </p>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">
                  Taux PFU / flat tax (%)
                </label>
                <input
                  type="number"
                  value={pfuPct}
                  min={0}
                  max={100}
                  step={0.5}
                  onChange={(e) => setPfuPct(parseFloat(e.target.value) || 0)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
                <p className="text-[10px] text-gray-400 mt-1">
                  30 % par défaut (12,8 % IR + 17,2 % PS)
                </p>
              </div>
            )}
            <div className="flex items-end">
              {fiscalKpis && (
                <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2 w-full">
                  Régime appliqué :{" "}
                  <span className="font-medium text-gray-700">
                    {fiscalKpis.regime}
                  </span>
                </p>
              )}
            </div>
          </div>

          {fiscalKpis ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <KpiCard
                label="Base imposable annuelle"
                value={fmtEur(fiscalKpis.baseImposable)}
                sub={`Sur ${fmtEur(loyerMensuel * 12)} de loyers bruts`}
                color="gray"
              />
              <KpiCard
                label="Impôt annuel estimé"
                value={fmtEur(fiscalKpis.impotAnnuel)}
                sub={`Taux effectif : ${
                  fiscalMode === "pfu" ? pfuPct : tmiPct
                } %`}
                color={
                  fiscalKpis.impotAnnuel > loyerMensuel * 3 ? "amber" : "gray"
                }
              />
              <KpiCard
                label="Cashflow net après impôt"
                value={`${fmtEurSigned(fiscalKpis.cashflowNetMensuel)}/mois`}
                sub={`${fmtEurSigned(fiscalKpis.cashflowNetMensuel * 12)}/an`}
                color={
                  fiscalKpis.cashflowNetMensuel >= 0 ? "emerald" : "red"
                }
              />
            </div>
          ) : (
            <p className="text-xs text-gray-400">
              Renseignez un loyer mensuel dans les Inputs clés pour voir les KPI
              fiscaux.
            </p>
          )}
        </div>
      )}

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
              <div
                className="px-5 py-3 flex items-center gap-3 cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => setExpandedScenario(isExpanded ? null : sc.id)}
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
                <div
                  className="flex gap-1 ml-2"
                  onClick={(e) => e.stopPropagation()}
                >
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

              {isExpanded && (
                <div className="px-5 pb-5 border-t border-gray-100">
                  <ScenarioEditor
                    scenario={sc}
                    rfRate={rfRate}
                    result={result ?? null}
                    onUpdate={(patch) => updateScenario(sc.id, patch)}
                    onUpdateFin={(patch) => updateFinancement(sc.id, patch)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Tableau comparatif scénarios ── */}
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
              Stress: travaux +15 %, revente −8 %, taux +1.5 pts · Cash: idem +
              vacance +5 pts, charges +10 %
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
                      {key === "cash"
                        ? "Cash dégradé"
                        : key === "base"
                          ? "Base"
                          : "Stress"}
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
            Basé sur le meilleur scénario (TRI le plus élevé). Prix affiché =
            prix d'achat actuel.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard
              label="Prix max recommandé"
              value={formatEuro(negotiation.prixMaxRecommande)}
              sub={`Marge: ${
                negotiation.margeNego > 0 ? "+" : ""
              }${negotiation.margeNego} %`}
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

      {/* ══════════════════════════════════════════════════════════════
          v6: TABLEAUX COMPARATIFS PÉDAGOGIQUES EN BAS DE PAGE
          ══════════════════════════════════════════════════════════════ */}

      {strategy === "location" && (
        <LocationFiscalComparisonTable fiscalRegime={fiscalRegime} />
      )}
      {strategy === "revente" && <ReventeFiscalComparisonTable />}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// v6: Tableau comparatif – Régimes fiscaux (Location)
// ═════════════════════════════════════════════════════════════════════

function LocationFiscalComparisonTable({
  fiscalRegime,
}: {
  fiscalRegime: FiscalRegime;
}) {
  const rows: {
    regime: string;
    key: FiscalRegime;
    base: string;
    charges: string;
    amortissements: string;
    quand: string;
    limites: string;
  }[] = [
    {
      regime: "LMNP Micro",
      key: "lmnp_micro",
      base: "Loyers × 50 % (abattement forfaitaire)",
      charges: "Non déductibles (incluses dans l'abattement)",
      amortissements: "Non",
      quand: "Peu de charges, pas de crédit, simplicité souhaitée",
      limites:
        "Plafond 77 700 €/an de recettes. Pas d'optimisation possible.",
    },
    {
      regime: "LMNP Réel",
      key: "lmnp_reel",
      base: "Loyers − charges − intérêts − assurance emprunteur",
      charges:
        "Oui : copropriété, taxe foncière, assurance PNO, intérêts, frais de gestion, travaux d'entretien",
      amortissements:
        "Oui (non inclus Mimmoza v1) : immeuble, meubles, travaux",
      quand:
        "Charges élevées, crédit en cours, gros travaux, optimisation fiscale",
      limites:
        "Comptabilité obligatoire (CGA recommandé). Amortissements non encore modélisés dans Mimmoza.",
    },
    {
      regime: "LMP",
      key: "lmp",
      base: "Loyers − charges − intérêts (régime réel)",
      charges:
        "Oui, identique au LMNP Réel + imputation déficit sur revenu global",
      amortissements: "Oui (non inclus Mimmoza v1)",
      quand: "Recettes > 23 000 €/an ET > 50 % des revenus du foyer",
      limites:
        "Cotisations sociales SSI (~35-45 %). Plus-value professionnelle à la revente.",
    },
    {
      regime: "SCI IS",
      key: "sci_is",
      base: "Loyers − charges − intérêts (déduction réelle)",
      charges: "Oui : toutes charges d'exploitation déductibles",
      amortissements: "Oui (non inclus v1) : amortissement comptable du bien",
      quand:
        "Patrimonial long terme, capitalisation des bénéfices dans la SCI",
      limites: "IS 15 % jusqu'à 42 500 €, puis 25 %. PV taxée sur prix amorti à la revente.",
    },
    {
      regime: "SCI IR",
      key: "sci_ir",
      base: "Revenus fonciers : micro-foncier (abattement 30 %) si < 15 k€, sinon réel",
      charges: "Réel : oui. Micro-foncier : non (abattement 30 %)",
      amortissements: "Non (revenus fonciers = pas d'amortissement)",
      quand: "Transmission patrimoniale, gestion en couple/famille",
      limites:
        "Transparence fiscale : chaque associé est imposé à son TMI.",
    },
    {
      regime: "Nom propre",
      key: "nom_propre",
      base: "Revenus fonciers : micro-foncier (30 %) si < 15 k€, sinon réel",
      charges: "Réel : oui. Micro-foncier : non",
      amortissements: "Non",
      quand: "Location nue simple, pas de structure juridique souhaitée",
      limites: "TMI + PS 17,2 %. Déficit foncier plafonné à 10 700 €/an.",
    },
    {
      regime: "Défiscalisation",
      key: "defiscalisation",
      base: "Dépend du dispositif (Pinel, Denormandie, Malraux…)",
      charges: "Variable selon dispositif",
      amortissements:
        "Variable (Pinel = réduction d'impôt, pas d'amortissement)",
      quand: "TMI élevée, objectif de réduction d'impôt directe",
      limites:
        "Engagement de durée (6/9/12 ans). Non modélisé dans Mimmoza v1.",
    },
  ];

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-2">
        <span>📊</span> Régimes fiscaux (location) — Comparatif
      </h3>
      <p className="text-xs text-gray-400 mb-4">
        Ce tableau compare les régimes fiscaux applicables à la location
        meublée et nue. Le régime actuellement sélectionné est surligné.
      </p>
      <div className="overflow-x-auto -mx-2">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2.5 px-3 text-xs font-semibold text-gray-600 whitespace-nowrap">
                Régime
              </th>
              <th className="text-left py-2.5 px-3 text-xs font-semibold text-gray-600">
                Base imposable (Mimmoza v1)
              </th>
              <th className="text-left py-2.5 px-3 text-xs font-semibold text-gray-600">
                Charges déductibles
              </th>
              <th className="text-left py-2.5 px-3 text-xs font-semibold text-gray-600 whitespace-nowrap">
                Amortissements
              </th>
              <th className="text-left py-2.5 px-3 text-xs font-semibold text-gray-600">
                Quand c'est intéressant
              </th>
              <th className="text-left py-2.5 px-3 text-xs font-semibold text-gray-600">
                Limites
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isActive = r.key === fiscalRegime;
              return (
                <tr
                  key={r.key}
                  className={`border-b border-gray-50 ${
                    isActive ? "bg-indigo-50/60" : "hover:bg-gray-50"
                  }`}
                >
                  <td className="py-2.5 px-3 align-top whitespace-nowrap">
                    <span
                      className={`text-xs font-semibold ${
                        isActive ? "text-indigo-700" : "text-gray-700"
                      }`}
                    >
                      {r.regime}
                    </span>
                    {isActive && (
                      <span className="ml-1.5 inline-block px-1.5 py-0.5 text-[10px] font-bold bg-indigo-600 text-white rounded">
                        actif
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-xs text-gray-600 align-top">
                    {r.base}
                  </td>
                  <td className="py-2.5 px-3 text-xs text-gray-600 align-top">
                    {r.charges}
                  </td>
                  <td className="py-2.5 px-3 text-xs text-gray-600 align-top whitespace-nowrap">
                    {r.amortissements}
                  </td>
                  <td className="py-2.5 px-3 text-xs text-gray-500 align-top">
                    {r.quand}
                  </td>
                  <td className="py-2.5 px-3 text-xs text-gray-400 align-top">
                    {r.limites}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-gray-400">
        Les amortissements (LMNP Réel, LMP, SCI IS) ne sont pas encore pris en
        compte dans le calcul Mimmoza v1. Ils seront ajoutés dans une prochaine
        version pour un calcul fiscal plus précis.
      </p>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// v6: Tableau comparatif – Fiscalité plus-value (Revente)
// ═════════════════════════════════════════════════════════════════════

function ReventeFiscalComparisonTable() {
  const rows = [
    {
      cas: "Plus-value immobilière (hors RP)",
      imposition: "IR 19 % + PS 17,2 % = 36,2 % au total",
      abattements:
        "IR : abattement progressif de 6 %/an dès la 6ᵉ année, exonération totale au bout de 22 ans. PS : abattement progressif, exonération totale au bout de 30 ans.",
      conditions:
        "Toute cession d'immeuble non occupé en résidence principale",
      modele: "Non modélisé (vNext)",
    },
    {
      cas: "Résidence principale",
      imposition: "Exonération totale (IR + PS)",
      abattements: "—",
      conditions:
        "Le bien doit être la résidence principale du vendeur au jour de la cession",
      modele: "Non modélisé (vNext)",
    },
    {
      cas: "Cession < 15 000 €",
      imposition: "Exonération totale",
      abattements: "—",
      conditions:
        "Prix de cession (pas la plus-value) inférieur à 15 000 €. Appréciation par co-vendeur en indivision.",
      modele: "Non modélisé (vNext)",
    },
    {
      cas: "Détention > 22 ans (IR) / > 30 ans (PS)",
      imposition: "Exonération partielle puis totale",
      abattements:
        "IR : exonération totale après 22 ans. PS : exonération totale après 30 ans de détention.",
      conditions: "Durée de détention calculée depuis l'acte d'achat",
      modele: "Non modélisé (vNext)",
    },
    {
      cas: "Première cession (non RP)",
      imposition: "Exonération sous conditions",
      abattements:
        "Exonération si remploi du prix dans l'achat de la résidence principale dans les 24 mois",
      conditions:
        "Ne pas avoir été propriétaire de sa RP dans les 4 années précédentes",
      modele: "Non modélisé (vNext)",
    },
    {
      cas: "Plus-value professionnelle (LMP, SCI IS)",
      imposition:
        "Régime PV professionnelles : court terme (TMI) / long terme (IR 12,8 % + PS 17,2 %)",
      abattements:
        "Exonération possible si CA < seuils (art. 151 septies) ou départ en retraite",
      conditions:
        "Bien inscrit à l'actif professionnel ou détenu en SCI IS",
      modele: "Non modélisé (vNext)",
    },
  ];

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-2">
        <span>📊</span> Fiscalité de la plus-value (revente) — Comparatif
      </h3>

      <div className="mt-2 mb-4 flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
        <span className="text-amber-500 text-base leading-none mt-0.5">⚠️</span>
        <div>
          <p className="text-xs font-semibold text-amber-800">
            Le régime LMNP/LMP s'applique à la location. En stratégie Revente,
            c'est la fiscalité de plus-value immobilière qui s'applique.
          </p>
          <p className="text-xs text-amber-700 mt-1">
            Ces cas ne sont pas encore modélisés dans les calculs Mimmoza
            (TRI/VAN actuellement calculés avant impôts de plus-value). Une
            prochaine version intégrera ces paramètres.
          </p>
        </div>
      </div>

      <div className="overflow-x-auto -mx-2">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2.5 px-3 text-xs font-semibold text-gray-600">
                Cas
              </th>
              <th className="text-left py-2.5 px-3 text-xs font-semibold text-gray-600">
                Imposition
              </th>
              <th className="text-left py-2.5 px-3 text-xs font-semibold text-gray-600">
                Abattements / exonérations
              </th>
              <th className="text-left py-2.5 px-3 text-xs font-semibold text-gray-600">
                Conditions
              </th>
              <th className="text-center py-2.5 px-3 text-xs font-semibold text-gray-600 whitespace-nowrap">
                Mimmoza
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="py-2.5 px-3 text-xs font-semibold text-gray-700 align-top whitespace-nowrap">
                  {r.cas}
                </td>
                <td className="py-2.5 px-3 text-xs text-gray-600 align-top">
                  {r.imposition}
                </td>
                <td className="py-2.5 px-3 text-xs text-gray-600 align-top">
                  {r.abattements}
                </td>
                <td className="py-2.5 px-3 text-xs text-gray-500 align-top">
                  {r.conditions}
                </td>
                <td className="py-2.5 px-3 text-center align-top">
                  <span className="inline-block px-2 py-0.5 text-[10px] font-semibold rounded-full bg-gray-100 text-gray-500">
                    {r.modele}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-gray-400">
        Source : CGI art. 150 U à 150 VH. Les abattements pour durée de
        détention s'appliquent automatiquement. Consultez votre notaire ou
        fiscaliste pour une simulation personnalisée.
      </p>
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

      {result && (
        <div className="bg-gray-50 rounded-lg p-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <ResultKpi
              label="TRI equity"
              value={formatPct(result.triEquity)}
            />
            <ResultKpi
              label="VAN equity"
              value={formatEuro(result.vanEquity)}
            />
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

          <details className="mt-3">
            <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">
              Détail flux equity
            </summary>
            <div className="mt-2 flex flex-wrap gap-2">
              {result.fluxEquity.map((f, i) => (
                <span
                  key={i}
                  className={`text-xs font-mono px-2 py-0.5 rounded ${
                    f >= 0
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-red-50 text-red-700"
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
  const toPos = (v: number) =>
    `${Math.max(0, Math.min(100, (v / maxVal) * 100))}%`;

  return (
    <>
      <div
        className="absolute top-0 bottom-0 bg-emerald-200 opacity-40"
        style={{ left: "0%", width: toPos(zoneSec) }}
      />
      <div
        className="absolute top-0 bottom-0 bg-amber-200 opacity-40"
        style={{
          left: toPos(zoneSec),
          width: `calc(${toPos(prixMax)} - ${toPos(zoneSec)})`,
        }}
      />
      <div
        className="absolute top-0 bottom-0 bg-red-200 opacity-40"
        style={{ left: toPos(seuil), right: "0%" }}
      />
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