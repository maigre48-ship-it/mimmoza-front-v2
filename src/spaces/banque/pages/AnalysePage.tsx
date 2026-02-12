// FILE: src/spaces/banque/pages/AnalysePage.tsx
// ============================================================================
// AnalysePage.tsx — /banque/analyse/:id
//
// ✅ FIX #8: applyCreditInputsToOperation reads FR field names
//    (coutAcquisition, revenusMensuels…), passes bien+calendrier,
//    reads rateAnnualPct from budget. Fixes NaN KPIs + N/A pillars.
// ============================================================================

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useBanqueDossierContext } from "../hooks/useBanqueDossierContext";
import { useBanqueSnapshotTick } from "../hooks/useBanqueSnapshotTick";
import { buildOperationSummaryFromDossier } from "../adapters/manualOperationAdapter";
import { normalizeEnrichedOperation, hasEnrichedData } from "../adapters/normalizeEnrichedOperation";
import { enrichOperationForDossier } from "../services/banqueEnrichOperation.service";
import {
  computeSmartScoreFromOperation,
  computeAlertsFromOperation,
} from "../scoring/banqueSmartScoreUniversal";
import { upsertDossier, addEvent, readBanqueSnapshot } from "../store/banqueSnapshot.store";
import { computeRatios } from "../utils/banqueRatios";
import type { OperationSummary, OperationProfile } from "../types/operationSummary.types";
import type {
  OperationUrbanism,
  UrbanismStatus,
  UrbanismEvidence,
} from "../types/urbanismTypes";
import {
  defaultUrbanism,
  URBANISM_STATUS_LABELS,
  URBANISM_STATUS_COLORS,
  EVIDENCE_TYPE_LABELS,
} from "../types/urbanismTypes";

// ══════════════════════════════════════════════════════════════════════
// UTILITY: extractCommittee — tolerant reader for committee data
// ══════════════════════════════════════════════════════════════════════

interface CommitteeData {
  decision: "GO" | "GO_AVEC_RESERVES" | "NO_GO" | null;
  confidence: number | null;
  totalScore: number | null;
  riskScore: number | null;
  riskDetails: { label: string; impact: number; detail?: string }[];
  markdown?: string | null;
}

function extractCommittee(operation: OperationSummary | null): CommitteeData {
  const fallback: CommitteeData = {
    decision: null,
    confidence: null,
    totalScore: null,
    riskScore: null,
    riskDetails: [],
    markdown: null,
  };
  if (!operation) return fallback;

  const c = (operation as any).committee;
  if (!c) return fallback;

  const inner = c.smartscore ?? c;

  const decision =
    inner.decision === "GO" || inner.decision === "GO_AVEC_RESERVES" || inner.decision === "NO_GO"
      ? inner.decision
      : null;

  const confidence = typeof inner.confidence === "number" ? inner.confidence : null;
  const totalScore = typeof (inner.totalScore ?? inner.score) === "number" ? (inner.totalScore ?? inner.score) : null;
  const riskScore = typeof inner.riskScore === "number" ? inner.riskScore : null;

  let riskDetails: CommitteeData["riskDetails"] = [];
  const rawDetails = inner.riskDetails ?? inner.risks ?? c.riskDetails ?? [];
  if (Array.isArray(rawDetails)) {
    riskDetails = rawDetails
      .filter((r: any) => r && (r.label || r.name))
      .map((r: any) => ({
        label: r.label ?? r.name ?? "Risque",
        impact: typeof r.impact === "number" ? r.impact : typeof r.score === "number" ? r.score : 0,
        detail: r.detail ?? r.description ?? undefined,
      }));
  }

  const markdown = typeof (inner.markdown ?? c.markdown) === "string" ? (inner.markdown ?? c.markdown) : null;

  return { decision, confidence, totalScore, riskScore, riskDetails, markdown };
}

// ══════════════════════════════════════════════════════════════════════
// UTILITY: applyCreditInputsToOperation — reads dossier.analyse for scoring
// ✅ FIX #8: Reads FR field names, passes bien+calendrier, reads rate
// ══════════════════════════════════════════════════════════════════════

function applyCreditInputsToOperation(op: OperationSummary, dossier: any): OperationSummary {
  const analyse = dossier?.analyse ?? {};
  const budget = analyse?.budget ?? {};
  const revenus = analyse?.revenus ?? {};
  const bien = analyse?.bien ?? {};
  const calendrier = analyse?.calendrier ?? {};
  const garanties = dossier?.garanties ?? {};

  const loanAmount = Number(dossier?.origination?.montantDemande ?? dossier?.montant ?? 0) || 0;
  const durationMonths = Number(dossier?.origination?.dureeEnMois ?? dossier?.origination?.duree ?? 240) || 240;

  // ✅ FIX #8: Read rate from budget input, fallback 3.5
  const annualRatePct = Number(budget.rateAnnualPct) || 3.5;

  const r = computeRatios({
    loanAmount,
    durationMonths,
    annualRatePct,
    budget,
    revenus,
    garanties,
    bien,
  });

  const next: any = { ...op };

  // ── 1) KPIs ──
  if (!next.kpis || typeof next.kpis !== "object") next.kpis = {};

  if (r.ltv != null) next.kpis.ltv = Math.round(r.ltv * 100);
  if (r.dscr != null) next.kpis.dscr = Number(r.dscr.toFixed(2));
  if (r.dsti != null) next.kpis.dsti = Math.round(r.dsti * 100);
  next.kpis.monthlyPayment = Math.round(r.mensualite);
  next.kpis.projectCost = Math.round(r.cost);

  // ── 2) Budget (pour scoreBudget) ──
  // ✅ FIX #8: Read FR fields first, EN fallback
  if (!next.budget || typeof next.budget !== "object") next.budget = {};

  const purchasePrice = Number(budget.coutAcquisition) || Number(budget.purchasePrice) || 0;
  if (purchasePrice > 0) next.budget.purchasePrice = purchasePrice;

  const fees = Number(budget.frais) || Number(budget.fees) || 0;
  if (fees > 0) next.budget.notaryFees = fees;

  const works = Number(budget.coutTravaux) || Number(budget.works) || 0;
  if (works > 0) next.budget.worksBudget = works;

  const equity = Number(budget.apportPersonnel) || Number(budget.equity) || 0;
  if (equity > 0) next.budget.equity = equity;

  if (r.cost > 0) next.budget.totalCost = Math.round(r.cost);

  const surfaceM2 = Number(op.project?.surfaceM2) || 0;
  if (r.cost > 0 && surfaceM2 > 0) {
    next.budget.costPerSqm = Math.round(r.cost / surfaceM2);
  }

  // ── 3) Financing (pour scoreGaranties) ──
  if (!next.financing || typeof next.financing !== "object") next.financing = {};

  if (loanAmount > 0) next.financing.loanAmount = loanAmount;
  if (durationMonths > 0) next.financing.loanDurationMonths = durationMonths;
  if (r.mensualite > 0) next.financing.monthlyPayment = Math.round(r.mensualite);
  if (equity > 0) next.financing.equity = equity;

  // ── 4) Revenues (pour scoreRevenus) ──
  // ✅ FIX #8: Read FR fields first, auto-detect mode
  if (!next.revenues || typeof next.revenues !== "object") next.revenues = {};

  const revenusMensuels = Number(revenus.revenusMensuels) || Number(revenus.incomeMonthlyNet) || 0;
  const loyersMensuels = Number(revenus.loyersMensuels) || Number(revenus.rentMonthly) || 0;

  const mode = revenus.mode || (loyersMensuels > 0 ? "locatif" : revenusMensuels > 0 ? "residence" : undefined);

  if (mode === "residence" || (!mode && revenusMensuels > 0 && loyersMensuels === 0)) {
    if (revenusMensuels > 0) {
      next.revenues.revenueTotal = Math.round(revenusMensuels * 12);
    }
    next.revenues.strategy = "residence";
  } else if (mode === "locatif" || loyersMensuels > 0) {
    if (loyersMensuels > 0) {
      next.revenues.rentAnnual = Math.round(loyersMensuels * 12);
    }
    next.revenues.strategy = "locatif";

    const vacancyRatePct = Number(revenus.vacancyRatePct) || 0;
    if (vacancyRatePct > 0) {
      next.revenues.occupancyRate = Math.round(100 - vacancyRatePct);
    }
  }

  // Always set revenueTotal if we have monthly income (for DSTI scoring)
  if (revenusMensuels > 0) {
    next.revenues.revenueTotal = Math.round(revenusMensuels * 12);
  }

  // ── 5) Bien / État (pour scoreBien) ──
  // ✅ FIX #8: Pass bien data to operation
  if (bien.ageCategory || bien.condition || bien.valeurEstimee) {
    if (!next.property || typeof next.property !== "object") next.property = {};
    if (bien.ageCategory) next.property.ageCategory = bien.ageCategory;
    if (bien.condition) next.property.condition = bien.condition;
    if (bien.valeurEstimee) next.property.estimatedValue = bien.valeurEstimee;
  }

  // ── 6) Calendrier (pour scoreCalendrier) ──
  // ✅ FIX #8: Pass calendrier data to operation
  if (calendrier.acquisitionDate || calendrier.worksMonths) {
    if (!next.calendar || typeof next.calendar !== "object") next.calendar = {};
    if (calendrier.acquisitionDate) next.calendar.acquisitionDate = calendrier.acquisitionDate;
    if (calendrier.worksMonths) next.calendar.durationMonths = calendrier.worksMonths;
    if (calendrier.startWorksDate) next.calendar.startWorksDate = calendrier.startWorksDate;
  }

  return next as OperationSummary;
}

// ── Formatting helpers ──

const fmtNum = (v: number | undefined | null, suffix = "") =>
  v !== undefined && v !== null
    ? `${v.toLocaleString("fr-FR")}${suffix}`
    : "—";

const fmtK = (v: number | undefined | null) =>
  v !== undefined && v !== null ? `${(v / 1000).toFixed(0)}k€` : "—";

const fmtPct = (v: number | undefined | null) =>
  v !== undefined && v !== null ? `${v}%` : "—";

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
};

// ── Tooltip helper ──

function Tip({ text }: { text: string }) {
  return (
    <span
      className="inline-flex items-center justify-center w-4 h-4 ml-1 text-[10px] text-gray-400 border border-gray-300 rounded-full cursor-help align-middle"
      title={text}
    >
      i
    </span>
  );
}

// ── Score badge ──

function ScoreBadge({ score, grade, size = "lg" }: { score: number; grade: string; size?: "lg" | "sm" }) {
  const color =
    score >= 80
      ? "bg-green-100 text-green-800 border-green-300"
      : score >= 60
        ? "bg-blue-100 text-blue-800 border-blue-300"
        : score >= 40
          ? "bg-yellow-100 text-yellow-800 border-yellow-300"
          : "bg-red-100 text-red-800 border-red-300";

  if (size === "sm") {
    return (
      <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm ${color}`}>
        <span className="text-lg font-bold">{score}</span>
        <span className="text-xs">/100</span>
        <span className="text-xs font-medium">({grade})</span>
      </div>
    );
  }

  return (
    <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl border ${color}`}>
      <span className="text-2xl font-bold">{score}</span>
      <span className="text-sm">/100</span>
      <span className="text-sm font-medium ml-1">({grade})</span>
    </div>
  );
}

// ── Decision badge for Committee ──

const DECISION_CONFIG: Record<string, { label: string; class: string; icon: string }> = {
  GO: { label: "GO", class: "bg-green-100 text-green-800 border-green-400", icon: "✅" },
  GO_AVEC_RESERVES: { label: "GO avec réserves", class: "bg-amber-100 text-amber-800 border-amber-400", icon: "⚠️" },
  NO_GO: { label: "NO GO", class: "bg-red-100 text-red-800 border-red-400", icon: "🛑" },
};

function DecisionBadge({ decision }: { decision: string | null }) {
  if (!decision) {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 bg-gray-50 text-gray-500 text-sm font-medium">
        ⏳ Non disponible
      </span>
    );
  }
  const cfg = DECISION_CONFIG[decision] ?? DECISION_CONFIG.GO;
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-bold ${cfg.class}`}>
      {cfg.icon} {cfg.label}
    </span>
  );
}

// ════════════════════════════════════════════════════════════════════
// URBANISME SECTION (preuve/complétude uniquement)
// ════════════════════════════════════════════════════════════════════

function UrbanismSection({
  urbanism,
  onChange,
}: {
  urbanism: OperationUrbanism;
  onChange: (u: OperationUrbanism) => void;
}) {
  const handleStatusChange = (status: UrbanismStatus) => {
    onChange({ ...urbanism, status, lastCheckedAt: new Date().toISOString() });
  };

  const handleNotesChange = (notes: string) => {
    onChange({ ...urbanism, notes });
  };

  const handleSourceChange = (source: string) => {
    onChange({ ...urbanism, source });
  };

  const addEvidence = (type: UrbanismEvidence["type"], label: string) => {
    const newEvidence: UrbanismEvidence = {
      id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type,
      label,
      addedAt: new Date().toISOString(),
    };
    onChange({ ...urbanism, evidence: [...urbanism.evidence, newEvidence] });
  };

  const removeEvidence = (id: string) => {
    onChange({
      ...urbanism,
      evidence: urbanism.evidence.filter((e) => e.id !== id),
    });
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">
          🏛️ Urbanisme & conformité
        </h3>
        <span className="text-xs text-gray-400 italic">
          Preuve / complétude — pas de lecture PLU automatique
        </span>
      </div>

      {/* Status selector */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-700">
          Statut de conformité
        </label>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(URBANISM_STATUS_LABELS) as UrbanismStatus[]).map(
            (status) => (
              <button
                key={status}
                onClick={() => handleStatusChange(status)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                  urbanism.status === status
                    ? `${URBANISM_STATUS_COLORS[status]} border-current ring-2 ring-offset-1 ring-current`
                    : "bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100"
                }`}
              >
                {URBANISM_STATUS_LABELS[status]}
              </button>
            )
          )}
        </div>
        {urbanism.lastCheckedAt && (
          <p className="text-xs text-gray-400">
            Dernière vérification : {fmtDate(urbanism.lastCheckedAt)}
          </p>
        )}
      </div>

      {/* Source */}
      <div className="space-y-1">
        <label className="text-sm font-medium text-gray-700">
          Source de vérification
        </label>
        <input
          type="text"
          value={urbanism.source}
          onChange={(e) => handleSourceChange(e.target.value)}
          placeholder="Ex: Mairie de Bordeaux, notaire, urbaniste…"
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
        />
      </div>

      {/* Evidence list */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-gray-700">
            Pièces justificatives ({urbanism.evidence.length})
          </label>
          <div className="relative group">
            <button className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">
              + Ajouter une pièce
            </button>
            <div className="absolute right-0 top-6 z-10 hidden group-hover:block bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[200px]">
              {(
                Object.entries(EVIDENCE_TYPE_LABELS) as [
                  UrbanismEvidence["type"],
                  string,
                ][]
              ).map(([type, label]) => (
                <button
                  key={type}
                  onClick={() => addEvidence(type, label)}
                  className="w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-indigo-50 hover:text-indigo-700"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {urbanism.evidence.length === 0 ? (
          <p className="text-sm text-gray-400 italic">
            Aucune pièce jointe. Ajoutez les documents de conformité urbanistique.
          </p>
        ) : (
          <div className="space-y-1">
            {urbanism.evidence.map((ev) => (
              <div
                key={ev.id}
                className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <span className="text-gray-400">📄</span>
                  <span className="text-sm font-medium text-gray-800">
                    {ev.label}
                  </span>
                  <span className="text-xs text-gray-400">
                    {fmtDate(ev.addedAt)}
                  </span>
                  {ev.fileName && (
                    <span className="text-xs text-indigo-500">{ev.fileName}</span>
                  )}
                </div>
                <button
                  onClick={() => removeEvidence(ev.id)}
                  className="text-xs text-red-400 hover:text-red-600"
                  title="Supprimer"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Notes */}
      <div className="space-y-1">
        <label className="text-sm font-medium text-gray-700">
          Notes urbanisme
        </label>
        <textarea
          value={urbanism.notes}
          onChange={(e) => handleNotesChange(e.target.value)}
          rows={3}
          placeholder="Observations du chargé de crédit, prescriptions, réserves…"
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
        />
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ════════════════════════════════════════════════════════════════════

export default function AnalysePage() {
  const { dossierId, dossier, refresh } = useBanqueDossierContext();
  const navigate = useNavigate();

  useBanqueSnapshotTick();

  // ── Scroll anchors ──
  const refComplete = useRef<HTMLDivElement | null>(null);
  const refRisks = useRef<HTMLDivElement | null>(null);
  const refFinances = useRef<HTMLDivElement | null>(null);

  const scrollTo = (ref: React.RefObject<HTMLDivElement | null>, offset = 96) => {
    const el = ref.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top, behavior: "smooth" });
  };

  // ── State ──
  const [operation, setOperation] = useState<OperationSummary | null>(null);
  const [scoreResult, setScoreResult] = useState<ReturnType<
    typeof computeSmartScoreFromOperation
  > | null>(null);
  const [alerts, setAlerts] = useState<ReturnType<typeof computeAlertsFromOperation>>([]);

  const [isEnriching, setIsEnriching] = useState(false);
  const [enrichWarnings, setEnrichWarnings] = useState<string[]>([]);
  const [enrichError, setEnrichError] = useState<string | null>(null);
  const [enrichSources, setEnrichSources] = useState<string[]>([]);

  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const [urbanism, setUrbanism] = useState<OperationUrbanism>(defaultUrbanism());

  const lastProcessedDossierIdRef = useRef<string | null>(null);
  const enrichedInSessionRef = useRef(false);

  // ── Build operation on mount / dossier change ──
  useEffect(() => {
    if (!dossier || !dossierId) return;

    if (lastProcessedDossierIdRef.current === dossierId) return;
    lastProcessedDossierIdRef.current = dossierId;

    if (enrichedInSessionRef.current) {
      console.log("[AnalysePage] Skipping useEffect — enriched data already in state");
      return;
    }

    let op: OperationSummary =
      (dossier as any).operation ?? buildOperationSummaryFromDossier(dossier);

    if ((op as any)._raw || (op as any).risksRefresh || (op as any).marketStudy) {
      console.log("[AnalysePage] Normalizing persisted operation");
      op = normalizeEnrichedOperation(op);
    }

    op = applyCreditInputsToOperation(op, dossier);

    setOperation(op);

    const savedUrbanism: OperationUrbanism | undefined =
      op.urbanism ?? (dossier as any).urbanism;
    if (savedUrbanism) {
      setUrbanism(savedUrbanism);
    }

    const savedSources: string[] = (dossier as any).operationSources ?? [];
    setEnrichSources(savedSources);

    const sr = computeSmartScoreFromOperation(op, dossier);
    setScoreResult(sr);
    setAlerts(computeAlertsFromOperation(op, sr));
  }, [dossierId, dossier]);

  // ── Derived data ──
  const profile: OperationProfile = operation?.meta?.profile ?? "particulier";
  const enrichedAt: string | null = (dossier as any)?.operationEnrichedAt ?? null;
  const missing = operation?.missing ?? [];
  const committee = extractCommittee(operation);

  const drivers: { label: string; value: string; positive: boolean }[] = (() => {
    if (!scoreResult) return [];
    if ((scoreResult as any).drivers && Array.isArray((scoreResult as any).drivers)) {
      return (scoreResult as any).drivers.slice(0, 3);
    }
    if (!scoreResult.pillars || scoreResult.pillars.length === 0) return [];
    const sorted = [...scoreResult.pillars]
      .filter((p) => p.hasData !== false)
      .sort((a, b) => b.rawScore - a.rawScore);
    const best = sorted.slice(0, 2).map((p) => ({
      label: p.label,
      value: `${p.rawScore}/100`,
      positive: true,
    }));
    const worst = sorted.length > 2
      ? [sorted[sorted.length - 1]].map((p) => ({
          label: p.label,
          value: `${p.rawScore}/100`,
          positive: p.rawScore >= 50,
        }))
      : [];
    return [...best, ...worst];
  })();

  const blockers = [
    ...missing.filter((m: any) => m.severity === "blocker"),
    ...((scoreResult as any)?.blockers ?? []),
  ];
  const incompleteItems = [
    ...missing.filter((m: any) => m.severity === "blocker" || m.severity === "warn"),
  ].slice(0, 6);
  const hasBlockers = blockers.length > 0;

  const topRisks = [...committee.riskDetails]
    .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
    .slice(0, 3);

  const isNoGo = committee.decision === "NO_GO";

  // ════════════════════════════════════════════════════════════════
  // ACTION : Analyze
  // ════════════════════════════════════════════════════════════════

  const handleAnalyze = useCallback(() => {
    if (!operation || !dossier || !dossierId) return;
    setIsAnalyzing(true);

    try {
      const op2 = applyCreditInputsToOperation(operation, dossier);
      setOperation(op2);

      const sr = computeSmartScoreFromOperation(op2, dossier);
      setScoreResult(sr);
      const newAlerts = computeAlertsFromOperation(op2, sr);
      setAlerts(newAlerts);

      upsertDossier({
        id: dossierId,
        operation: op2,
        analysis: {
          score: sr.score,
          grade: sr.grade,
          verdict: sr.verdict,
          niveau:
            sr.score >= 80 ? "Faible" : sr.score >= 60 ? "Modéré" : sr.score >= 40 ? "Élevé" : "Critique",
          label: sr.grade,
          alertes: newAlerts.map((a: any) => a.message),
          calculatedAt: sr.computedAt,
          smartscoreUniversal: sr,
        },
      } as any);

      addEvent({
        type: "analyse_updated",
        dossierId,
        message: `Analyse mise à jour — Score: ${sr.score}/100 (${sr.grade})`,
      });
    } finally {
      setIsAnalyzing(false);
    }
  }, [operation, dossier, dossierId]);

  // ════════════════════════════════════════════════════════════════
  // ACTION : Enrich
  // ════════════════════════════════════════════════════════════════

  const alertsRef = useRef(alerts);
  alertsRef.current = alerts;

  const handleEnrich = useCallback(async () => {
    if (!operation || !dossierId) return;
    setIsEnriching(true);
    setEnrichError(null);
    setEnrichWarnings([]);

    console.log("[AnalysePage] 🔍 Starting enrichment...");

    try {
      const { data, error } = await enrichOperationForDossier(
        dossierId,
        profile,
        operation
      );

      if (error || !data) {
        const msg = error?.message ?? "Erreur inconnue";
        console.error("[AnalysePage] ✗ Enrich failed:", msg, error?.details);
        setEnrichError(
          `${msg}${error?.details ? ` — ${error.details}` : ""}${error?.httpStatus ? ` (HTTP ${error.httpStatus})` : ""}`
        );
        return;
      }

      console.log("[AnalysePage] ✓ Enrich success:", data.sources);

      const rawEnrichedOp = data.operation;
      const enrichedOp = normalizeEnrichedOperation(rawEnrichedOp, operation);

      // ✅ FIX #8: Apply credit inputs after normalization
      const enrichedOpWithCredit = applyCreditInputsToOperation(enrichedOp, dossier!);

      setOperation(enrichedOpWithCredit);
      setEnrichWarnings(data.warnings);
      setEnrichSources(data.sources);

      enrichedInSessionRef.current = true;

      const sr = computeSmartScoreFromOperation(enrichedOpWithCredit, dossier!);
      setScoreResult(sr);
      const newAlerts = computeAlertsFromOperation(enrichedOpWithCredit, sr);
      setAlerts(newAlerts);

      console.log("[AnalysePage] 📊 Post-enrich score:", {
        score: sr.score,
        grade: sr.grade,
        pillars: sr.pillars?.map((p) => `${p.key}=${p.rawScore}(${p.points}/${p.maxPoints})`),
      });

      const now = new Date().toISOString();

      upsertDossier({
        id: dossierId,
        operation: enrichedOpWithCredit,
        operationEnrichedAt: now,
        operationSources: data.sources,
        analysis: {
          score: sr.score,
          grade: sr.grade,
          verdict: sr.verdict,
          niveau:
            sr.score >= 80 ? "Faible" : sr.score >= 60 ? "Modéré" : sr.score >= 40 ? "Élevé" : "Critique",
          label: sr.grade,
          alertes: newAlerts.map((a: any) => a.message),
          calculatedAt: sr.computedAt,
          smartscoreUniversal: sr,
        },
      } as any);

      addEvent({
        type: "enrichissement",
        dossierId,
        message: `Enrichissement réussi — Score: ${sr.score}/100 (${sr.grade}) — Sources: [${data.sources.join(", ")}]`,
      });
    } catch (err) {
      console.error("[AnalysePage] ✗ Enrich exception:", err);
      setEnrichError(
        `Exception: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setIsEnriching(false);
    }
  }, [operation, dossierId, profile, dossier]);

  // ════════════════════════════════════════════════════════════════
  // ACTION : Save urbanism
  // ════════════════════════════════════════════════════════════════

  const handleUrbanismChange = useCallback(
    (u: OperationUrbanism) => {
      setUrbanism(u);

      if (operation) {
        const updatedOp = { ...operation, urbanism: u };
        setOperation(updatedOp);

        if (dossierId) {
          upsertDossier({
            id: dossierId,
            operation: updatedOp,
            urbanism: u,
          } as any);
        }
      }
    },
    [operation, dossierId]
  );

  // ════════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════════

  if (!dossier || !operation) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        <p>
          Chargement du dossier…{" "}
          <button
            className="text-blue-600 underline"
            onClick={() => navigate("/banque/dossiers")}
          >
            Retour aux dossiers
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-4 space-y-6">
      {/* ══════════════ HEADER ══════════════ */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Analyse du dossier
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {dossier.label ?? dossier.reference} — Profil:{" "}
            <span className="font-medium capitalize">{profile}</span>
            {hasEnrichedData(operation) && (
              <span className="ml-2 text-green-600 text-xs font-medium">
                ✓ Données enrichies
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleEnrich}
            disabled={isEnriching}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2 text-sm font-medium transition-colors"
          >
            {isEnriching ? (
              <>
                <span className="animate-spin">⟳</span> Enrichissement…
              </>
            ) : (
              <>🔍 Lancer l'analyse</>
            )}
          </button>
          <button
            onClick={handleAnalyze}
            disabled={isAnalyzing}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 text-sm font-medium transition-colors"
          >
            {isAnalyzing ? (
              <>
                <span className="animate-spin">⟳</span> Calcul…
              </>
            ) : (
              <>📊 {scoreResult ? "Recalculer" : "Calculer le score"}</>
            )}
          </button>
        </div>
      </div>

      {/* ══════════════ ENRICHMENT FEEDBACK ══════════════ */}
      {enrichError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-start gap-2">
            <span className="text-red-500 text-lg">⚠️</span>
            <div>
              <p className="text-sm font-medium text-red-800">
                Erreur d'enrichissement
              </p>
              <p className="text-sm text-red-600 mt-1">{enrichError}</p>
              <p className="text-xs text-red-400 mt-2">
                💡 Vérifiez la console (F12 → Console) et l'onglet Network pour
                plus de détails. Assurez-vous que l'Edge Function{" "}
                <code className="bg-red-100 px-1 rounded">
                  banque-operation-enrich-v1
                </code>{" "}
                est déployée.
              </p>
            </div>
          </div>
        </div>
      )}

      {enrichWarnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <p className="text-sm font-medium text-amber-800 mb-2">
            ⚠️ Warnings d'enrichissement ({enrichWarnings.length})
          </p>
          <ul className="text-sm text-amber-700 space-y-1">
            {enrichWarnings.map((w, i) => (
              <li key={i} className="flex items-start gap-1">
                <span className="text-amber-400">·</span>
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}

      {enrichSources.length > 0 && !enrichError && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-3">
          <span className="text-green-500">✓</span>
          <div>
            <span className="text-sm font-medium text-green-800">
              Données enrichies
            </span>
            <span className="text-sm text-green-600 ml-2">
              Sources : {enrichSources.join(", ")}
            </span>
            {enrichedAt && (
              <span className="text-xs text-green-500 ml-2">
                ({fmtDate(enrichedAt)})
              </span>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════
          A) ABOVE THE FOLD — 2 Score Cards side by side
          ══════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ──── LEFT: Score Dossier (Universal) ──── */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                Score Dossier
                <Tip text="Score universel : complétude du dossier, montage financier, qualité de l'opération. Pilote la décision si le pré-filtre risques est passé." />
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">Universal — complétude & montage</p>
            </div>
            {scoreResult && (
              <ScoreBadge score={scoreResult.score} grade={scoreResult.grade} />
            )}
          </div>

          {scoreResult ? (
            <>
              <p className="text-sm text-gray-600">{scoreResult.verdict}</p>

              {drivers.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {drivers.map((d, i) => (
                    <span
                      key={i}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
                        d.positive
                          ? "bg-green-50 text-green-700 border border-green-200"
                          : "bg-red-50 text-red-700 border border-red-200"
                      }`}
                    >
                      {d.positive ? "↑" : "↓"} {d.label}: {d.value}
                    </span>
                  ))}
                </div>
              )}

              {scoreResult.pillars && scoreResult.pillars.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {scoreResult.pillars.map((p) => (
                    <div
                      key={p.key}
                      className="bg-gray-50 rounded-lg p-2.5 text-center"
                    >
                      <p className="text-[11px] text-gray-500 mb-0.5 truncate">{p.label}</p>
                      {p.hasData === false ? (
                        <p className="text-base font-bold text-gray-300">N/A</p>
                      ) : (
                        <>
                          <p className="text-base font-bold text-gray-800">
                            {p.rawScore}
                            <span className="text-[10px] text-gray-400 font-normal">/100</span>
                          </p>
                          <p className="text-[10px] text-gray-400">
                            {p.points}/{p.maxPoints} pts
                          </p>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {hasBlockers && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-amber-800">
                      ⚠ Score provisoire : dossier incomplet
                    </p>
                    <p className="text-xs text-amber-600 mt-0.5">
                      {blockers.length} élément{blockers.length > 1 ? "s" : ""} bloquant{blockers.length > 1 ? "s" : ""}
                    </p>
                  </div>
                  <button
                    onClick={() => scrollTo(refComplete)}
                    className="shrink-0 px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-medium hover:bg-amber-700 transition-colors"
                  >
                    Compléter maintenant
                  </button>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-400 italic py-4">
              Lancez l'analyse ou calculez le score pour voir le résultat.
            </p>
          )}
        </div>

        {/* ──── RIGHT: Score Risques & Localisation (Committee) ──── */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                Risques & Localisation
                <Tip text="Pré-filtre comité : risques exogènes (Géorisques, environnement, réglementaire). Un NO GO ici bloque la décision indépendamment du score dossier." />
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">Committee — pré-filtre risques</p>
            </div>
            <DecisionBadge decision={committee.decision} />
          </div>

          {committee.decision ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {committee.riskScore !== null && (
                  <div className="bg-gray-50 rounded-lg p-3 text-center">
                    <p className="text-xs text-gray-500">Score risque</p>
                    <p className={`text-xl font-bold ${
                      committee.riskScore >= 70 ? "text-green-600"
                      : committee.riskScore >= 40 ? "text-amber-600"
                      : "text-red-600"
                    }`}>
                      {committee.riskScore}/100
                    </p>
                  </div>
                )}
                {committee.confidence !== null && (
                  <div className="bg-gray-50 rounded-lg p-3 text-center">
                    <p className="text-xs text-gray-500">Confiance</p>
                    <p className="text-xl font-bold text-gray-800">
                      {committee.confidence}%
                    </p>
                  </div>
                )}
                {committee.totalScore !== null && (
                  <div className="bg-gray-50 rounded-lg p-3 text-center">
                    <p className="text-xs text-gray-500">Score total comité</p>
                    <p className="text-xl font-bold text-gray-800">
                      {committee.totalScore}/100
                    </p>
                  </div>
                )}
              </div>

              {topRisks.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Top risques par impact
                  </p>
                  {topRisks.map((r, i) => (
                    <div
                      key={i}
                      className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm ${
                        Math.abs(r.impact) >= 20
                          ? "bg-red-50 text-red-700"
                          : Math.abs(r.impact) >= 10
                            ? "bg-amber-50 text-amber-700"
                            : "bg-gray-50 text-gray-600"
                      }`}
                    >
                      <span className="font-medium">{r.label}</span>
                      <span className="text-xs font-bold">
                        {r.impact > 0 ? "+" : ""}{r.impact}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={() => scrollTo(refRisks)}
                className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
              >
                Voir détails risques ↓
              </button>
            </div>
          ) : (
            <div className="py-4 space-y-2">
              <p className="text-sm text-gray-400 italic">
                Données comité non disponibles.
              </p>
              <p className="text-xs text-gray-400">
                💡 Lancez l'enrichissement pour obtenir les risques géographiques,
                ou renseignez manuellement la décision comité dans le module dédié.
              </p>
              {operation.risks?.geo && (
                <div className="mt-2 bg-gray-50 rounded-lg p-3 inline-flex items-center gap-3">
                  <span className="text-xs text-gray-500">Géorisques disponible :</span>
                  <span className={`text-lg font-bold ${
                    operation.risks.geo.score >= 70 ? "text-green-600"
                    : operation.risks.geo.score >= 40 ? "text-amber-600"
                    : "text-red-600"
                  }`}>
                    {operation.risks.geo.score}/100
                  </span>
                  <span className="text-xs text-gray-400">({operation.risks.geo.label})</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          B) DECISION RULE BANNER
          ══════════════════════════════════════════════════════════════ */}
      <div
        className={`rounded-xl border px-5 py-3 flex items-center gap-3 text-sm ${
          isNoGo
            ? "bg-red-50 border-red-300 text-red-800"
            : committee.decision === "GO_AVEC_RESERVES"
              ? "bg-amber-50 border-amber-300 text-amber-800"
              : committee.decision === "GO"
                ? "bg-green-50 border-green-300 text-green-800"
                : "bg-gray-50 border-gray-200 text-gray-600"
        }`}
      >
        <span className="text-base">
          {isNoGo ? "🛑" : committee.decision === "GO" ? "✅" : committee.decision === "GO_AVEC_RESERVES" ? "⚠️" : "ℹ️"}
        </span>
        <div>
          <span className="font-semibold">Règle de décision : </span>
          {isNoGo ? (
            <span>
              <strong>NO GO immédiat</strong> — risque site rédhibitoire. La décision comité bloque ce dossier indépendamment du score Universal.
            </span>
          ) : committee.decision ? (
            <span>
              Pré-filtre risques passé ({committee.decision}). La décision finale est pilotée par le <strong>Score Dossier Universal</strong>.
            </span>
          ) : (
            <span>
              En attente du pré-filtre risques. La décision sera pilotée par le Score Universal une fois les risques évalués.
            </span>
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          MAIN CONTENT — 2 COLUMNS
          ══════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* ──── COLONNE GAUCHE (3/5) ──── */}
        <div className="lg:col-span-3 space-y-5">

          <div ref={refComplete} />

          {/* ── À compléter ── */}
          {incompleteItems.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">
                📋 À compléter ({incompleteItems.length})
              </h3>
              <div className="space-y-2">
                {incompleteItems.map((m: any, i: number) => (
                  <div
                    key={i}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
                      m.severity === "blocker"
                        ? "bg-red-50 text-red-700"
                        : m.severity === "warn"
                          ? "bg-amber-50 text-amber-700"
                          : "bg-gray-50 text-gray-600"
                    }`}
                  >
                    <span>
                      {m.severity === "blocker" ? "🔴" : m.severity === "warn" ? "🟡" : "ℹ️"}
                    </span>
                    <span className="font-medium">{m.label}</span>
                    <span className="text-xs opacity-60">({m.field})</span>
                  </div>
                ))}
              </div>
              {missing.length > 6 && (
                <p className="text-xs text-gray-400 mt-2">
                  … et {missing.length - 6} autre{missing.length - 6 > 1 ? "s" : ""}
                </p>
              )}
              <button
                onClick={() => navigate(`/banque/dossier/${dossierId}`)}
                className="mt-3 text-sm text-indigo-600 hover:text-indigo-800 font-medium"
              >
                Compléter dans le dossier →
              </button>
            </div>
          )}

          <div ref={refFinances} />

          {/* ── KPIs / Finances ── */}
          <div>
            {operation.kpis && Object.keys(operation.kpis).length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h3 className="text-lg font-semibold text-gray-900 mb-3">
                  📈 KPIs financiers
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {operation.kpis.ltv !== undefined && (
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <p className="text-xs text-gray-500">LTV</p>
                      <p className="text-xl font-bold text-gray-800">{fmtPct(operation.kpis.ltv)}</p>
                    </div>
                  )}
                  {operation.kpis.dsti !== undefined && (
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <p className="text-xs text-gray-500">DSTI</p>
                      <p className="text-xl font-bold text-gray-800">{fmtPct(operation.kpis.dsti)}</p>
                    </div>
                  )}
                  {operation.kpis.monthlyPayment !== undefined && (
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <p className="text-xs text-gray-500">Mensualité</p>
                      <p className="text-xl font-bold text-gray-800">{fmtNum(operation.kpis.monthlyPayment, " €")}</p>
                    </div>
                  )}
                  {operation.kpis.projectCost !== undefined && (
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <p className="text-xs text-gray-500">Coût projet</p>
                      <p className="text-xl font-bold text-gray-800">{fmtK(operation.kpis.projectCost)}</p>
                    </div>
                  )}
                  {operation.kpis.dscr !== undefined && (
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <p className="text-xs text-gray-500">DSCR</p>
                      <p className="text-xl font-bold text-gray-800">{operation.kpis.dscr}x</p>
                    </div>
                  )}
                  {operation.kpis.yieldGross !== undefined && (
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <p className="text-xs text-gray-500">Rendement brut</p>
                      <p className="text-xl font-bold text-gray-800">{fmtPct(operation.kpis.yieldGross)}</p>
                    </div>
                  )}
                  {operation.kpis.pricePerSqmMarket !== undefined && (
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <p className="text-xs text-gray-500">Prix marché</p>
                      <p className="text-xl font-bold text-gray-800">{fmtNum(operation.kpis.pricePerSqmMarket, " €/m²")}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── DVF + Marché ── */}
          {(operation.dvf?.stats || operation.market?.commune) && (
            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-5">
              <h3 className="text-lg font-semibold text-gray-900">
                🏘️ Marché & transactions
              </h3>

              {operation.dvf?.stats && (
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-2">📊 DVF — Transactions comparables</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-gray-50 rounded-lg p-3">
                      <p className="text-xs text-gray-500">Transactions</p>
                      <p className="text-xl font-bold text-gray-800">{operation.dvf.stats.transactions_count}</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3">
                      <p className="text-xs text-gray-500">Prix médian</p>
                      <p className="text-xl font-bold text-gray-800">{fmtNum(operation.dvf.stats.price_median_eur_m2, " €/m²")}</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3">
                      <p className="text-xs text-gray-500">Prix moyen</p>
                      <p className="text-lg font-semibold text-gray-700">{fmtNum(operation.dvf.stats.price_mean_eur_m2, " €/m²")}</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3">
                      <p className="text-xs text-gray-500">Q1 — Q3</p>
                      <p className="text-sm font-medium text-gray-700">
                        {fmtNum(operation.dvf.stats.price_q1_eur_m2)} — {fmtNum(operation.dvf.stats.price_q3_eur_m2, " €/m²")}
                      </p>
                    </div>
                  </div>

                  {operation.dvf.comparables && operation.dvf.comparables.length > 0 && (
                    <div className="mt-4">
                      <p className="text-sm font-medium text-gray-600 mb-2">Dernières transactions</p>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-gray-500 border-b">
                              <th className="text-left py-1 pr-2">Date</th>
                              <th className="text-right py-1 pr-2">Prix</th>
                              <th className="text-right py-1 pr-2">Surface</th>
                              <th className="text-right py-1">€/m²</th>
                            </tr>
                          </thead>
                          <tbody>
                            {operation.dvf.comparables.slice(0, 5).map((c: any, i: number) => (
                              <tr key={i} className="border-b border-gray-100">
                                <td className="py-1 pr-2 text-gray-600">{c.date?.slice(0, 10) ?? "—"}</td>
                                <td className="py-1 pr-2 text-right font-medium">{fmtK(c.price)}</td>
                                <td className="py-1 pr-2 text-right">{c.surface ? `${c.surface} m²` : "—"}</td>
                                <td className="py-1 text-right font-medium text-indigo-600">{fmtNum(c.pricePerSqm, " €")}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {operation.market?.commune && (
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-2">📍 Contexte communal</p>
                  <div className="space-y-3">
                    <div className="bg-gray-50 rounded-lg p-3">
                      <p className="text-xs text-gray-500">Commune</p>
                      <p className="text-lg font-bold text-gray-800">{operation.market.commune.nom}</p>
                      <p className="text-sm text-gray-600">
                        {fmtNum(operation.market.commune.population)} hab.
                        {operation.market.commune.densiteHabKm2 && ` — ${fmtNum(operation.market.commune.densiteHabKm2)} hab/km²`}
                      </p>
                      {operation.market.commune.departement && (
                        <p className="text-xs text-gray-400 mt-1">
                          {operation.market.commune.departement}, {operation.market.commune.region}
                        </p>
                      )}
                    </div>

                    {(operation.market.pricePerSqm || operation.market.demandIndex) && (
                      <div className="grid grid-cols-2 gap-2">
                        {operation.market.pricePerSqm && (
                          <div className="bg-gray-50 rounded-lg p-3">
                            <p className="text-xs text-gray-500">Prix médian DVF</p>
                            <p className="text-lg font-bold text-gray-800">{fmtNum(operation.market.pricePerSqm, " €/m²")}</p>
                          </div>
                        )}
                        {operation.market.demandIndex && (
                          <div className="bg-gray-50 rounded-lg p-3">
                            <p className="text-xs text-gray-500">Indice demande</p>
                            <p className="text-lg font-bold text-gray-800">
                              {operation.market.demandIndex}<span className="text-xs text-gray-400 font-normal">/100</span>
                            </p>
                          </div>
                        )}
                        {operation.market.compsCount && (
                          <div className="bg-gray-50 rounded-lg p-3">
                            <p className="text-xs text-gray-500">Comparables DVF</p>
                            <p className="text-lg font-bold text-gray-800">{operation.market.compsCount}</p>
                          </div>
                        )}
                        {operation.market.evolutionPct !== undefined && operation.market.evolutionPct !== null && (
                          <div className="bg-gray-50 rounded-lg p-3">
                            <p className="text-xs text-gray-500">Évolution prix</p>
                            <p className={`text-lg font-bold ${operation.market.evolutionPct >= 0 ? "text-green-700" : "text-red-700"}`}>
                              {operation.market.evolutionPct > 0 ? "+" : ""}{operation.market.evolutionPct}%
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                    {operation.market.osmServices && (
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-xs text-gray-500">Services à proximité (1 km)</p>
                        <p className="text-lg font-bold text-gray-800">{operation.market.osmServices.count1km} équipements</p>
                        <p className="text-xs text-gray-400">Pharmacies, écoles, commerces, banques… (OSM)</p>
                      </div>
                    )}

                    {operation.market.finess && (
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-xs text-gray-500">Établissements sanitaires (FINESS)</p>
                        <p className="text-lg font-bold text-gray-800">{operation.market.finess.count}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Urbanisme ── */}
          <UrbanismSection urbanism={urbanism} onChange={handleUrbanismChange} />
        </div>

        {/* ──── COLONNE DROITE (2/5) ──── */}
        <div className="lg:col-span-2 space-y-5">

          <div ref={refRisks} />

          {/* ── Risques géographiques ── */}
          {operation.risks?.geo && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">🌍 Risques géographiques</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-gray-500">Score risque</p>
                  <p className={`text-2xl font-bold ${
                    operation.risks.geo.score >= 70 ? "text-green-600"
                    : operation.risks.geo.score >= 40 ? "text-amber-600"
                    : "text-red-600"
                  }`}>
                    {operation.risks.geo.score}/100
                  </p>
                  <p className="text-xs text-gray-500">{operation.risks.geo.label}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-gray-500">Risques identifiés</p>
                  <p className="text-xl font-bold text-gray-800">{operation.risks.geo.nbRisques}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-gray-500">Inondation</p>
                  <p className="text-lg font-bold">
                    {operation.risks.geo.hasInondation
                      ? <span className="text-red-600">Oui</span>
                      : <span className="text-green-600">Non</span>}
                  </p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-gray-500">Sismique</p>
                  <p className="text-lg font-bold">
                    {operation.risks.geo.hasSismique
                      ? <span className="text-amber-600">Oui</span>
                      : <span className="text-green-600">Non</span>}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ── Alertes ── */}
          {alerts.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">🚨 Alertes ({alerts.length})</h3>
              <div className="space-y-2">
                {alerts.map((a: any, i: number) => (
                  <div
                    key={i}
                    className={`px-3 py-2 rounded-lg text-sm ${
                      a.level === "critical"
                        ? "bg-red-50 text-red-700 border border-red-200"
                        : a.level === "warning"
                          ? "bg-amber-50 text-amber-700 border border-amber-200"
                          : "bg-blue-50 text-blue-700 border border-blue-200"
                    }`}
                  >
                    {a.message}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Sources ── */}
          {(enrichSources.length > 0 || enrichedAt) && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-2">🔗 Sources d'enrichissement</h3>
              {enrichSources.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {enrichSources.map((s, i) => (
                    <span key={i} className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded text-xs font-medium">{s}</span>
                  ))}
                </div>
              )}
              {enrichedAt && (
                <p className="text-xs text-gray-400">Dernière mise à jour : {fmtDate(enrichedAt)}</p>
              )}
            </div>
          )}

          {/* ── Journal ── */}
          {(() => {
            const snap = readBanqueSnapshot();
            const events = snap?.events?.slice(-5)?.reverse() ?? [];
            if (events.length === 0) return null;
            return (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h3 className="text-sm font-semibold text-gray-900 mb-2">📝 Journal rapide</h3>
                <div className="space-y-1.5">
                  {events.map((ev: any, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <span className="text-gray-400 shrink-0 mt-0.5">{fmtDate(ev.timestamp ?? ev.createdAt)}</span>
                      <span className="text-gray-600">{ev.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* ══════════════ DEBUG (dev only) ══════════════ */}
      {import.meta.env.DEV && (
        <details className="bg-indigo-50 rounded-xl border border-indigo-200 p-4">
          <summary className="text-sm font-medium text-indigo-600 cursor-pointer">
            🔍 Debug — Store Snapshot (SmartScore + enrichment check)
          </summary>
          <div className="mt-3 space-y-3">
            <div>
              <p className="text-xs font-bold text-indigo-700 mb-1">
                Operation enrichment status:
              </p>
              <pre className="text-xs text-gray-600 bg-white rounded p-2 overflow-x-auto max-h-[200px]">
                {JSON.stringify({
                  hasRisksGeo: !!operation?.risks?.geo,
                  risksGeoScore: operation?.risks?.geo?.score,
                  hasDvfStats: !!operation?.dvf?.stats,
                  hasMarketCommune: !!operation?.market?.commune,
                  hasEnriched: hasEnrichedData(operation),
                  enrichedInSession: enrichedInSessionRef.current,
                  sources: enrichSources,
                  creditKpis: {
                    ltv: operation?.kpis?.ltv,
                    dscr: operation?.kpis?.dscr,
                    dsti: operation?.kpis?.dsti,
                    monthlyPayment: operation?.kpis?.monthlyPayment,
                    projectCost: operation?.kpis?.projectCost,
                  },
                  budgetHydrated: {
                    purchasePrice: operation?.budget?.purchasePrice,
                    totalCost: operation?.budget?.totalCost,
                    worksBudget: operation?.budget?.worksBudget,
                  },
                  revenuesHydrated: {
                    strategy: operation?.revenues?.strategy,
                    rentAnnual: operation?.revenues?.rentAnnual,
                    revenueTotal: operation?.revenues?.revenueTotal,
                  },
                  financingHydrated: {
                    loanAmount: operation?.financing?.loanAmount,
                  },
                  propertyHydrated: {
                    ageCategory: (operation as any)?.property?.ageCategory,
                    condition: (operation as any)?.property?.condition,
                    estimatedValue: (operation as any)?.property?.estimatedValue,
                  },
                  calendarHydrated: {
                    acquisitionDate: (operation as any)?.calendar?.acquisitionDate,
                    durationMonths: (operation as any)?.calendar?.durationMonths,
                  },
                }, null, 2)}
              </pre>
            </div>

            <div>
              <p className="text-xs font-bold text-indigo-700 mb-1">Current scoreResult:</p>
              <pre className="text-xs text-gray-600 bg-white rounded p-2 overflow-x-auto max-h-[200px]">
                {JSON.stringify(scoreResult ? {
                  score: scoreResult.score,
                  grade: scoreResult.grade,
                  verdict: scoreResult.verdict,
                  pillars: scoreResult.pillars?.map((p) => ({
                    key: p.key,
                    label: p.label,
                    rawScore: p.rawScore,
                    points: p.points,
                    maxPoints: p.maxPoints,
                    hasData: p.hasData,
                  })),
                } : null, null, 2)}
              </pre>
            </div>

            <div>
              <p className="text-xs font-bold text-indigo-700 mb-1">Committee (extracted):</p>
              <pre className="text-xs text-gray-600 bg-white rounded p-2 overflow-x-auto max-h-[200px]">
                {JSON.stringify(committee, null, 2)}
              </pre>
            </div>
          </div>
        </details>
      )}

      {import.meta.env.DEV && (
        <details className="bg-gray-50 rounded-xl border border-gray-200 p-4">
          <summary className="text-sm font-medium text-gray-500 cursor-pointer">
            🔧 Debug — Operation brute (dev only)
          </summary>
          <pre className="mt-3 text-xs text-gray-600 overflow-x-auto max-h-[400px]">
            {JSON.stringify(operation, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}