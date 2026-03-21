// FILE: src/spaces/banque/pages/AnalysePage.tsx
// ============================================================================
// AnalysePage.tsx — /banque/analyse/:id
//
// ✅ FIX #8: applyCreditInputsToOperation reads FR field names
// ✅ FIX #9: extractCommittee synthesizes decision from risks.geo
// ✅ FIX #10: Documentation pillar excluded from score. Pillar weights
//    are configurable via settings gear (persisted in localStorage).
// ✅ FIX #11: Documentation tile removed from UI. "0/0 pts" hidden when
//    maxPoints === 0 (bien/calendrier key mapping expanded).
// ✅ FIX #12: CommitteePanel replaces inline RIGHT card content.
// ✅ FIX #13: Documentation pillar stripped at source via
//    normalizeSmartScoreUniversal (calc + render + PDF aligned with ComitePage).
// ✅ REDESIGN: Financeur visual tokens applied (GRAD_FIN / ACCENT_FIN).
// ============================================================================

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
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
import { normalizeSmartScoreUniversal } from "../scoring/normalizeSmartScoreUniversal";
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
import CommitteePanel from "../components/committee/CommitteePanel";

// ── Design tokens Financeur ──
const GRAD_FIN = "linear-gradient(90deg, #26a69a 0%, #80cbc4 100%)";
const ACCENT_FIN = "#1a7a50";

// ══════════════════════════════════════════════════════════════════════
// PILLAR WEIGHTS — configurable scoring weights
// ✅ FIX #10: Documentation excluded, 100 pts redistributed
// ══════════════════════════════════════════════════════════════════════

const PILLAR_KEYS_ORDERED = [
  "garanties",
  "risques",
  "revenus",
  "ratios",
  "marche",
  "budget",
  "bien",
  "calendrier",
] as const;

type PillarKey = (typeof PILLAR_KEYS_ORDERED)[number];

const PILLAR_LABELS: Record<PillarKey, string> = {
  garanties: "Garanties",
  risques: "Risques",
  revenus: "Revenus / Capacité",
  ratios: "Ratios",
  marche: "Marché",
  budget: "Budget",
  bien: "Bien / État",
  calendrier: "Calendrier",
};

/** Default weights (sum = 100). Documentation (was 15) redistributed. */
const DEFAULT_WEIGHTS: Record<PillarKey, number> = {
  garanties: 21,
  risques: 9,
  revenus: 14,
  ratios: 18,
  marche: 12,
  budget: 17,
  bien: 6,
  calendrier: 3,
};

interface PillarWeightsConfig {
  weights: Record<PillarKey, number>;
}

function getDefaultWeightsConfig(): PillarWeightsConfig {
  return { weights: { ...DEFAULT_WEIGHTS } };
}

function sumWeights(w: Record<PillarKey, number>): number {
  return PILLAR_KEYS_ORDERED.reduce((s, k) => s + (w[k] || 0), 0);
}

const WEIGHTS_STORAGE_KEY = "banque_pillar_weights";

function loadWeightsConfig(): PillarWeightsConfig {
  try {
    const raw = localStorage.getItem(WEIGHTS_STORAGE_KEY);
    if (!raw) return getDefaultWeightsConfig();
    const parsed = JSON.parse(raw);
    if (parsed?.weights && typeof parsed.weights === "object") {
      const w: Record<PillarKey, number> = { ...DEFAULT_WEIGHTS };
      for (const k of PILLAR_KEYS_ORDERED) {
        if (typeof parsed.weights[k] === "number" && parsed.weights[k] >= 0) {
          w[k] = parsed.weights[k];
        }
      }
      return { weights: w };
    }
  } catch { /* ignore */ }
  return getDefaultWeightsConfig();
}

function saveWeightsConfig(cfg: PillarWeightsConfig) {
  try {
    localStorage.setItem(WEIGHTS_STORAGE_KEY, JSON.stringify(cfg));
  } catch { /* ignore */ }
}

// ══════════════════════════════════════════════════════════════════════
// REWEIGHT SCORE — apply custom weights
// ✅ FIX #13: Documentation already stripped at source by
// normalizeSmartScoreUniversal, DOCUMENTATION_KEYS filter kept as safety net.
// ══════════════════════════════════════════════════════════════════════

interface ReweightedResult {
  score: number;
  grade: string;
  verdict: string;
  pillars: {
    key: string;
    label: string;
    rawScore: number;
    points: number;
    maxPoints: number;
    hasData: boolean;
  }[];
  computedAt?: string;
}

function computeGrade(score: number): string {
  if (score >= 90) return "A+";
  if (score >= 80) return "A";
  if (score >= 70) return "B";
  if (score >= 60) return "C";
  if (score >= 50) return "D+";
  if (score >= 40) return "D";
  if (score >= 30) return "E";
  return "F";
}

function computeVerdict(score: number): string {
  if (score >= 80) return "favorable";
  if (score >= 60) return "favorable_sous_conditions";
  if (score >= 40) return "réservé";
  return "défavorable";
}

// ✅ FIX #11 + #13: Keys that identify the documentation pillar (safety net)
const DOCUMENTATION_KEYS = new Set(["documentation", "doc", "docs", "documents"]);

/** Map scoring engine pillar key → our config key */
function mapPillarKey(engineKey: string): PillarKey | null {
  const map: Record<string, PillarKey> = {
    garanties: "garanties",
    guarantees: "garanties",
    garantie: "garanties",
    risques: "risques",
    risks: "risques",
    risque: "risques",
    revenus: "revenus",
    revenues: "revenus",
    income: "revenus",
    revenu: "revenus",
    capacite: "revenus",
    capacité: "revenus",
    ratios: "ratios",
    ratio: "ratios",
    marche: "marche",
    marché: "marche",
    market: "marche",
    budget: "budget",
    bien: "bien",
    property: "bien",
    bien_etat: "bien",
    "bien_état": "bien",
    bienetat: "bien",
    "bienétat": "bien",
    property_state: "bien",
    property_condition: "bien",
    etat: "bien",
    état: "bien",
    etat_bien: "bien",
    "état_bien": "bien",
    condition: "bien",
    calendrier: "calendrier",
    calendar: "calendrier",
    timeline: "calendrier",
    calendrier_projet: "calendrier",
    planning: "calendrier",
    schedule: "calendrier",
    delais: "calendrier",
    délais: "calendrier",
  };
  return map[engineKey] ?? null;
}

function reweightScoreResult(
  raw: ReturnType<typeof computeSmartScoreFromOperation> | null,
  weights: Record<PillarKey, number>
): ReweightedResult | null {
  if (!raw || !raw.pillars) return null;

  const total = sumWeights(weights);
  if (total === 0) return null;

  const reweightedPillars: ReweightedResult["pillars"] = [];
  let totalPoints = 0;
  let totalMax = 0;

  for (const p of raw.pillars) {
    // ✅ FIX #10 + #11 + #13: Skip documentation pillar (safety net — already stripped at source)
    if (DOCUMENTATION_KEYS.has(p.key)) {
      continue;
    }

    let wKey = mapPillarKey(p.key);

    if (!wKey && p.label) {
      const normalizedLabel = p.label.trim().toLowerCase();
      for (const [k, lbl] of Object.entries(PILLAR_LABELS)) {
        if (lbl.toLowerCase() === normalizedLabel) {
          wKey = k as PillarKey;
          break;
        }
      }
      if (!wKey) {
        for (const k of PILLAR_KEYS_ORDERED) {
          if (normalizedLabel.includes(k)) {
            wKey = k;
            break;
          }
        }
      }
    }

    if (!wKey) {
      reweightedPillars.push({
        key: p.key,
        label: p.label,
        rawScore: p.rawScore,
        points: 0,
        maxPoints: 0,
        hasData: p.hasData !== false,
      });
      continue;
    }

    const maxPts = weights[wKey] ?? 0;
    const hasData = p.hasData !== false;
    const pts = hasData ? Math.round((p.rawScore / 100) * maxPts) : 0;

    reweightedPillars.push({
      key: p.key,
      label: PILLAR_LABELS[wKey] ?? p.label,
      rawScore: p.rawScore,
      points: pts,
      maxPoints: maxPts,
      hasData,
    });

    totalMax += maxPts;
    if (hasData) totalPoints += pts;
  }

  const score = totalMax > 0 ? Math.round((totalPoints / totalMax) * 100) : 0;

  return {
    score,
    grade: computeGrade(score),
    verdict: computeVerdict(score),
    pillars: reweightedPillars,
    computedAt: raw.computedAt,
  };
}

// ══════════════════════════════════════════════════════════════════════
// SETTINGS MODAL — pillar weight editor
// ══════════════════════════════════════════════════════════════════════

function WeightsSettingsModal({
  weights,
  onSave,
  onClose,
}: {
  weights: Record<PillarKey, number>;
  onSave: (w: Record<PillarKey, number>) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Record<PillarKey, number>>({ ...weights });
  const total = sumWeights(draft);
  const isValid = total === 100;

  const handleChange = (key: PillarKey, val: number) => {
    setDraft((prev) => ({ ...prev, [key]: Math.max(0, Math.min(100, val)) }));
  };

  const handleReset = () => {
    setDraft({ ...DEFAULT_WEIGHTS });
  };

  const handleAutoBalance = () => {
    if (total === 100) return;
    const diff = 100 - total;
    const nonZero = PILLAR_KEYS_ORDERED.filter((k) => draft[k] > 0);
    if (nonZero.length === 0) return;

    const updated = { ...draft };
    const perPillar = Math.floor(diff / nonZero.length);
    let remainder = diff - perPillar * nonZero.length;

    for (const k of nonZero) {
      updated[k] = Math.max(0, updated[k] + perPillar);
    }
    for (let i = 0; i < Math.abs(remainder); i++) {
      const k = nonZero[i % nonZero.length];
      updated[k] += remainder > 0 ? 1 : -1;
    }

    setDraft(updated);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div
          className="px-6 py-4 flex items-center justify-between"
          style={{ borderBottom: "1px solid #c0e8d4" }}
        >
          <div>
            <h3 className="text-lg font-bold text-gray-900">⚙️ Pondération des piliers</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Ajustez les poids selon vos critères bancaires. Le total doit être 100.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none p-1"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-3 max-h-[60vh] overflow-y-auto">
          {PILLAR_KEYS_ORDERED.map((key) => (
            <div key={key} className="flex items-center gap-3">
              <label className="text-sm text-gray-700 w-36 shrink-0">
                {PILLAR_LABELS[key]}
              </label>
              <input
                type="range"
                min={0}
                max={40}
                value={draft[key]}
                onChange={(e) => handleChange(key, parseInt(e.target.value, 10))}
                className="flex-1"
                style={{ accentColor: ACCENT_FIN }}
              />
              <input
                type="number"
                min={0}
                max={100}
                value={draft[key]}
                onChange={(e) => handleChange(key, parseInt(e.target.value, 10) || 0)}
                className="w-14 text-center text-sm border border-gray-200 rounded-lg py-1 focus:outline-none focus:ring-2 focus:ring-teal-400/30"
              />
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 space-y-3" style={{ borderTop: "1px solid #c0e8d4" }}>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">Total des poids :</span>
            <span className={`text-sm font-bold ${isValid ? "text-green-600" : "text-red-600"}`}>
              {total}/100
              {!isValid && (
                <button
                  onClick={handleAutoBalance}
                  className="ml-2 text-xs font-normal underline"
                  style={{ color: ACCENT_FIN }}
                >
                  Équilibrer
                </button>
              )}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleReset}
              className="px-3 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Réinitialiser
            </button>
            <div className="flex-1" />
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Annuler
            </button>
            <button
              onClick={() => { onSave(draft); onClose(); }}
              disabled={!isValid}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                border: "none",
                background: isValid ? GRAD_FIN : "#e2e8f0",
                color: isValid ? "white" : "#94a3b8",
                fontWeight: 600,
                fontSize: 14,
                cursor: isValid ? "pointer" : "not-allowed",
                transition: "opacity 0.15s",
              }}
            >
              Appliquer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// UTILITY: extractCommittee
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
  if (c) {
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

    if (decision) {
      return { decision, confidence, totalScore, riskScore, riskDetails, markdown };
    }
  }

  // FALLBACK: synthesize from operation.risks.geo
  const geo = operation.risks?.geo;
  if (!geo || typeof geo.score !== "number") return fallback;

  const geoScore = geo.score;

  let decision: "GO" | "GO_AVEC_RESERVES" | "NO_GO";
  if (geoScore >= 70) decision = "GO";
  else if (geoScore >= 40) decision = "GO_AVEC_RESERVES";
  else decision = "NO_GO";

  const riskDetails: CommitteeData["riskDetails"] = [];
  if (geo.hasInondation) {
    riskDetails.push({ label: "Zone inondable", impact: -20, detail: "Risque inondation identifié par Géorisques" });
  }
  if (geo.hasSismique) {
    riskDetails.push({ label: "Zone sismique", impact: -10, detail: "Risque sismique identifié par Géorisques" });
  }
  if (typeof geo.nbRisques === "number" && geo.nbRisques > 0) {
    const otherRisks = geo.nbRisques - (geo.hasInondation ? 1 : 0) - (geo.hasSismique ? 1 : 0);
    if (otherRisks > 0) {
      riskDetails.push({
        label: `${otherRisks} autre${otherRisks > 1 ? "s" : ""} risque${otherRisks > 1 ? "s" : ""}`,
        impact: -5 * otherRisks,
        detail: "Risques identifiés par Géorisques",
      });
    }
  }

  return {
    decision,
    confidence: 65,
    totalScore: geoScore,
    riskScore: geoScore,
    riskDetails,
    markdown: null,
  };
}

// ══════════════════════════════════════════════════════════════════════
// UTILITY: applyCreditInputsToOperation
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

  if (!next.kpis || typeof next.kpis !== "object") next.kpis = {};
  if (r.ltv != null) next.kpis.ltv = Math.round(r.ltv * 100);
  if (r.dscr != null) next.kpis.dscr = Number(r.dscr.toFixed(2));
  if (r.dsti != null) next.kpis.dsti = Math.round(r.dsti * 100);
  next.kpis.monthlyPayment = Math.round(r.mensualite);
  next.kpis.projectCost = Math.round(r.cost);

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

  if (!next.financing || typeof next.financing !== "object") next.financing = {};
  if (loanAmount > 0) next.financing.loanAmount = loanAmount;
  if (durationMonths > 0) next.financing.loanDurationMonths = durationMonths;
  if (r.mensualite > 0) next.financing.monthlyPayment = Math.round(r.mensualite);
  if (equity > 0) next.financing.equity = equity;

  if (!next.revenues || typeof next.revenues !== "object") next.revenues = {};
  const revenusMensuels = Number(revenus.revenusMensuels) || Number(revenus.incomeMonthlyNet) || 0;
  const loyersMensuels = Number(revenus.loyersMensuels) || Number(revenus.rentMonthly) || 0;
  const mode = revenus.mode || (loyersMensuels > 0 ? "locatif" : revenusMensuels > 0 ? "residence" : undefined);

  if (mode === "residence" || (!mode && revenusMensuels > 0 && loyersMensuels === 0)) {
    if (revenusMensuels > 0) next.revenues.revenueTotal = Math.round(revenusMensuels * 12);
    next.revenues.strategy = "residence";
  } else if (mode === "locatif" || loyersMensuels > 0) {
    if (loyersMensuels > 0) next.revenues.rentAnnual = Math.round(loyersMensuels * 12);
    next.revenues.strategy = "locatif";
    const vacancyRatePct = Number(revenus.vacancyRatePct) || 0;
    if (vacancyRatePct > 0) next.revenues.occupancyRate = Math.round(100 - vacancyRatePct);
  }
  if (revenusMensuels > 0) next.revenues.revenueTotal = Math.round(revenusMensuels * 12);

  if (bien.ageCategory || bien.condition || bien.valeurEstimee) {
    if (!next.property || typeof next.property !== "object") next.property = {};
    if (bien.ageCategory) next.property.ageCategory = bien.ageCategory;
    if (bien.condition) next.property.condition = bien.condition;
    if (bien.valeurEstimee) next.property.estimatedValue = bien.valeurEstimee;
  }

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
  v !== undefined && v !== null ? `${v.toLocaleString("fr-FR")}${suffix}` : "—";

const fmtK = (v: number | undefined | null) =>
  v !== undefined && v !== null ? `${(v / 1000).toFixed(0)}k€` : "—";

const fmtPct = (v: number | undefined | null) =>
  v !== undefined && v !== null ? `${v}%` : "—";

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("fr-FR", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
};

function Tip({ text }: { text: string }) {
  return (
    <span
      className="inline-flex items-center justify-center w-4 h-4 ml-1 text-[10px] border rounded-full cursor-help align-middle"
      style={{ color: "#9ed4bc", borderColor: "#9ed4bc" }}
      title={text}
    >
      i
    </span>
  );
}

function ScoreBadge({ score, grade, size = "lg" }: { score: number; grade: string; size?: "lg" | "sm" }) {
  const color =
    score >= 80 ? "bg-green-100 text-green-800 border-green-300"
    : score >= 60 ? "bg-blue-100 text-blue-800 border-blue-300"
    : score >= 40 ? "bg-yellow-100 text-yellow-800 border-yellow-300"
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
// URBANISME SECTION
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

  const addEvidence = (type: UrbanismEvidence["type"], label: string) => {
    const newEvidence: UrbanismEvidence = {
      id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type, label, addedAt: new Date().toISOString(),
    };
    onChange({ ...urbanism, evidence: [...urbanism.evidence, newEvidence] });
  };

  const removeEvidence = (id: string) => {
    onChange({ ...urbanism, evidence: urbanism.evidence.filter((e) => e.id !== id) });
  };

  return (
    <div
      className="bg-white p-5 space-y-4"
      style={{ borderRadius: 14, border: "1px solid #c0e8d4" }}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold" style={{ color: "#0a3d28" }}>
          🏛️ Urbanisme &amp; conformité
        </h3>
        <span className="text-xs text-gray-400 italic">Preuve / complétude — pas de lecture PLU automatique</span>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-700">Statut de conformité</label>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(URBANISM_STATUS_LABELS) as UrbanismStatus[]).map((status) => (
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
          ))}
        </div>
        {urbanism.lastCheckedAt && (
          <p className="text-xs text-gray-400">Dernière vérification : {fmtDate(urbanism.lastCheckedAt)}</p>
        )}
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium text-gray-700">Source de vérification</label>
        <input
          type="text"
          value={urbanism.source}
          onChange={(e) => onChange({ ...urbanism, source: e.target.value })}
          placeholder="Ex: Mairie de Bordeaux, notaire, urbaniste…"
          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-400/30"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-gray-700">Pièces justificatives ({urbanism.evidence.length})</label>
          <div className="relative group">
            <button className="text-xs font-medium" style={{ color: ACCENT_FIN }}>+ Ajouter une pièce</button>
            <div className="absolute right-0 top-6 z-10 hidden group-hover:block bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[200px]">
              {(Object.entries(EVIDENCE_TYPE_LABELS) as [UrbanismEvidence["type"], string][]).map(([type, label]) => (
                <button
                  key={type}
                  onClick={() => addEvidence(type, label)}
                  className="w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-teal-50"
                  style={{ ["--tw-bg-opacity" as any]: 1 }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {urbanism.evidence.length === 0 ? (
          <p className="text-sm text-gray-400 italic">Aucune pièce jointe. Ajoutez les documents de conformité urbanistique.</p>
        ) : (
          <div className="space-y-1">
            {urbanism.evidence.map((ev) => (
              <div key={ev.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-gray-400">📄</span>
                  <span className="text-sm font-medium text-gray-800">{ev.label}</span>
                  <span className="text-xs text-gray-400">{fmtDate(ev.addedAt)}</span>
                  {ev.fileName && <span className="text-xs" style={{ color: ACCENT_FIN }}>{ev.fileName}</span>}
                </div>
                <button onClick={() => removeEvidence(ev.id)} className="text-xs text-red-400 hover:text-red-600" title="Supprimer">✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium text-gray-700">Notes urbanisme</label>
        <textarea
          value={urbanism.notes}
          onChange={(e) => onChange({ ...urbanism, notes: e.target.value })}
          rows={3}
          placeholder="Observations du chargé de crédit, prescriptions, réserves…"
          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-400/30"
        />
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// HELPER: compute + normalize score in one step
// ══════════════════════════════════════════════════════════════════════

/** Compute SmartScore then strip documentation pillar at source */
function computeNormalizedScore(
  op: OperationSummary,
  dossier: any
): ReturnType<typeof computeSmartScoreFromOperation> {
  const raw = computeSmartScoreFromOperation(op, dossier);
  return normalizeSmartScoreUniversal(raw);
}

// ════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ════════════════════════════════════════════════════════════════════

export default function AnalysePage() {
  const { dossierId, dossier, refresh } = useBanqueDossierContext();
  const navigate = useNavigate();

  useBanqueSnapshotTick();

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
  const [scoreResult, setScoreResult] = useState<ReturnType<typeof computeSmartScoreFromOperation> | null>(null);
  const [alerts, setAlerts] = useState<ReturnType<typeof computeAlertsFromOperation>>([]);
  const [isEnriching, setIsEnriching] = useState(false);
  const [enrichWarnings, setEnrichWarnings] = useState<string[]>([]);
  const [enrichError, setEnrichError] = useState<string | null>(null);
  const [enrichSources, setEnrichSources] = useState<string[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [urbanism, setUrbanism] = useState<OperationUrbanism>(defaultUrbanism());

  // ✅ FIX #10: Pillar weights
  const [weightsConfig, setWeightsConfig] = useState<PillarWeightsConfig>(loadWeightsConfig);
  const [showWeightsModal, setShowWeightsModal] = useState(false);

  const lastProcessedDossierIdRef = useRef<string | null>(null);
  const enrichedInSessionRef = useRef(false);

  // Reweighted score (memoized)
  const displayScore = useMemo(
    () => reweightScoreResult(scoreResult, weightsConfig.weights),
    [scoreResult, weightsConfig.weights]
  );

  // ── Build operation on mount / dossier change ──
  useEffect(() => {
    if (!dossier || !dossierId) return;
    if (lastProcessedDossierIdRef.current === dossierId) return;
    lastProcessedDossierIdRef.current = dossierId;

    if (enrichedInSessionRef.current) {
      console.log("[AnalysePage] Skipping useEffect — enriched data already in state");
      return;
    }

    let op: OperationSummary = (dossier as any).operation ?? buildOperationSummaryFromDossier(dossier);

    if ((op as any)._raw || (op as any).risksRefresh || (op as any).marketStudy) {
      console.log("[AnalysePage] Normalizing persisted operation");
      op = normalizeEnrichedOperation(op);
    }

    op = applyCreditInputsToOperation(op, dossier);
    setOperation(op);

    const savedUrbanism: OperationUrbanism | undefined = op.urbanism ?? (dossier as any).urbanism;
    if (savedUrbanism) setUrbanism(savedUrbanism);

    const savedSources: string[] = (dossier as any).operationSources ?? [];
    setEnrichSources(savedSources);

    // ✅ FIX #13: normalize at source — no documentation pillar in scoreResult
    const sr = computeNormalizedScore(op, dossier);
    setScoreResult(sr);
    setAlerts(computeAlertsFromOperation(op, sr));
  }, [dossierId, dossier]);

  // ── Derived data ──
  const profile: OperationProfile = operation?.meta?.profile ?? "particulier";
  const enrichedAt: string | null = (dossier as any)?.operationEnrichedAt ?? null;
  const missing = operation?.missing ?? [];
  const committee = extractCommittee(operation);

  const drivers: { label: string; value: string; positive: boolean }[] = (() => {
    if (!displayScore || !displayScore.pillars || displayScore.pillars.length === 0) return [];
    const sorted = [...displayScore.pillars]
      .filter((p) => p.hasData !== false)
      .sort((a, b) => b.rawScore - a.rawScore);
    const best = sorted.slice(0, 2).map((p) => ({ label: p.label, value: `${p.rawScore}/100`, positive: true }));
    const worst = sorted.length > 2
      ? [sorted[sorted.length - 1]].map((p) => ({ label: p.label, value: `${p.rawScore}/100`, positive: p.rawScore >= 50 }))
      : [];
    return [...best, ...worst];
  })();

  const blockers = [
    ...missing.filter((m: any) => m.severity === "blocker"),
    ...((scoreResult as any)?.blockers ?? []),
  ];
  const incompleteItems = missing.filter((m: any) => m.severity === "blocker" || m.severity === "warn").slice(0, 6);
  const hasBlockers = blockers.length > 0;

  const topRisks = [...committee.riskDetails].sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact)).slice(0, 3);
  const isNoGo = committee.decision === "NO_GO";

  const handleSaveWeights = useCallback((newWeights: Record<PillarKey, number>) => {
    const cfg: PillarWeightsConfig = { weights: newWeights };
    setWeightsConfig(cfg);
    saveWeightsConfig(cfg);
  }, []);

  // ════════════════════════════════════════════════════════════════
  // ACTION : Analyze
  // ════════════════════════════════════════════════════════════════

  const handleAnalyze = useCallback(() => {
    if (!operation || !dossier || !dossierId) return;
    setIsAnalyzing(true);

    try {
      const op2 = applyCreditInputsToOperation(operation, dossier);

      if (!(op2 as any).committee && op2.risks?.geo) {
        const synthesized = extractCommittee(op2);
        if (synthesized.decision) {
          (op2 as any).committee = {
            decision: synthesized.decision,
            confidence: synthesized.confidence,
            riskScore: synthesized.riskScore,
            totalScore: synthesized.totalScore,
            riskDetails: synthesized.riskDetails,
            source: "geo-auto",
          };
        }
      }

      setOperation(op2);

      // ✅ FIX #13: normalize at source
      const sr = computeNormalizedScore(op2, dossier);
      setScoreResult(sr);
      const newAlerts = computeAlertsFromOperation(op2, sr);
      setAlerts(newAlerts);

      const rw = reweightScoreResult(sr, weightsConfig.weights);

      upsertDossier({
        id: dossierId,
        operation: op2,
        analysis: {
          score: rw?.score ?? sr.score,
          grade: rw?.grade ?? sr.grade,
          verdict: rw?.verdict ?? sr.verdict,
          niveau: (rw?.score ?? sr.score) >= 80 ? "Faible" : (rw?.score ?? sr.score) >= 60 ? "Modéré" : (rw?.score ?? sr.score) >= 40 ? "Élevé" : "Critique",
          label: rw?.grade ?? sr.grade,
          alertes: newAlerts.map((a: any) => a.message),
          calculatedAt: sr.computedAt,
          smartscoreUniversal: sr,
          pillarWeights: weightsConfig.weights,
        },
      } as any);

      addEvent({
        type: "analyse_updated",
        dossierId,
        message: `Analyse mise à jour — Score: ${rw?.score ?? sr.score}/100 (${rw?.grade ?? sr.grade})`,
      });
    } finally {
      setIsAnalyzing(false);
    }
  }, [operation, dossier, dossierId, weightsConfig.weights]);

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

    try {
      const { data, error } = await enrichOperationForDossier(dossierId, profile, operation);

      if (error || !data) {
        const msg = error?.message ?? "Erreur inconnue";
        setEnrichError(`${msg}${error?.details ? ` — ${error.details}` : ""}${error?.httpStatus ? ` (HTTP ${error.httpStatus})` : ""}`);
        return;
      }

      const enrichedOp = normalizeEnrichedOperation(data.operation, operation);
      const enrichedOpWithCredit = applyCreditInputsToOperation(enrichedOp, dossier!);

      setOperation(enrichedOpWithCredit);
      setEnrichWarnings(data.warnings);
      setEnrichSources(data.sources);
      enrichedInSessionRef.current = true;

      // ✅ FIX #13: normalize at source
      const sr = computeNormalizedScore(enrichedOpWithCredit, dossier!);
      setScoreResult(sr);
      const newAlerts = computeAlertsFromOperation(enrichedOpWithCredit, sr);
      setAlerts(newAlerts);

      const rw = reweightScoreResult(sr, weightsConfig.weights);
      const now = new Date().toISOString();

      upsertDossier({
        id: dossierId,
        operation: enrichedOpWithCredit,
        operationEnrichedAt: now,
        operationSources: data.sources,
        analysis: {
          score: rw?.score ?? sr.score,
          grade: rw?.grade ?? sr.grade,
          verdict: rw?.verdict ?? sr.verdict,
          niveau: (rw?.score ?? sr.score) >= 80 ? "Faible" : (rw?.score ?? sr.score) >= 60 ? "Modéré" : (rw?.score ?? sr.score) >= 40 ? "Élevé" : "Critique",
          label: rw?.grade ?? sr.grade,
          alertes: newAlerts.map((a: any) => a.message),
          calculatedAt: sr.computedAt,
          smartscoreUniversal: sr,
          pillarWeights: weightsConfig.weights,
        },
      } as any);

      addEvent({
        type: "enrichissement",
        dossierId,
        message: `Enrichissement réussi — Score: ${rw?.score ?? sr.score}/100 (${rw?.grade ?? sr.grade}) — Sources: [${data.sources.join(", ")}]`,
      });
    } catch (err) {
      setEnrichError(`Exception: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsEnriching(false);
    }
  }, [operation, dossierId, profile, dossier, weightsConfig.weights]);

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
          upsertDossier({ id: dossierId, operation: updatedOp, urbanism: u } as any);
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
            className="underline"
            style={{ color: ACCENT_FIN }}
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
      {/* ══════════════ WEIGHTS SETTINGS MODAL ══════════════ */}
      {showWeightsModal && (
        <WeightsSettingsModal
          weights={weightsConfig.weights}
          onSave={handleSaveWeights}
          onClose={() => setShowWeightsModal(false)}
        />
      )}

      {/* ══════════════ HEADER BANNER ══════════════ */}
      <div style={{
        background: GRAD_FIN,
        borderRadius: 14,
        padding: "20px 24px",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 16,
      }}>
        <div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", marginBottom: 6 }}>
            Financeur › Analyse
          </div>
          <div style={{ fontSize: 22, fontWeight: 600, color: "white", marginBottom: 4 }}>
            Analyse du dossier
          </div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.75)", display: "flex", alignItems: "center", gap: 10 }}>
            <span>{dossier.label ?? dossier.reference}</span>
            <span style={{ opacity: 0.6 }}>·</span>
            <span>Profil : <span style={{ fontWeight: 600 }}>{profile}</span></span>
            {hasEnrichedData(operation) && (
              <span style={{
                fontSize: 10,
                padding: "2px 8px",
                borderRadius: 5,
                background: "rgba(255,255,255,0.20)",
                color: "white",
                fontWeight: 600,
              }}>
                ✓ Données enrichies
              </span>
            )}
          </div>
        </div>

        {/* CTA buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, marginTop: 4 }}>
          <button
            onClick={handleEnrich}
            disabled={isEnriching}
            style={{
              padding: "9px 16px",
              borderRadius: 10,
              border: "none",
              background: "white",
              color: ACCENT_FIN,
              fontWeight: 600,
              fontSize: 13,
              cursor: isEnriching ? "not-allowed" : "pointer",
              opacity: isEnriching ? 0.6 : 1,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {isEnriching ? <><span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>⟳</span> Enrichissement…</> : <>🔍 Lancer l'analyse</>}
          </button>
          <button
            onClick={handleAnalyze}
            disabled={isAnalyzing}
            style={{
              padding: "9px 16px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.4)",
              background: "rgba(255,255,255,0.15)",
              color: "white",
              fontWeight: 600,
              fontSize: 13,
              cursor: isAnalyzing ? "not-allowed" : "pointer",
              opacity: isAnalyzing ? 0.6 : 1,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {isAnalyzing ? <><span>⟳</span> Calcul…</> : <>📊 {displayScore ? "Recalculer" : "Calculer le score"}</>}
          </button>
        </div>
      </div>

      {/* ══════════════ ENRICHMENT FEEDBACK ══════════════ */}
      {enrichError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-start gap-2">
            <span className="text-red-500 text-lg">⚠️</span>
            <div>
              <p className="text-sm font-medium text-red-800">Erreur d'enrichissement</p>
              <p className="text-sm text-red-600 mt-1">{enrichError}</p>
              <p className="text-xs text-red-400 mt-2">
                💡 Vérifiez la console (F12 → Console) et l'onglet Network. Assurez-vous que l'Edge Function{" "}
                <code className="bg-red-100 px-1 rounded">banque-operation-enrich-v1</code> est déployée.
              </p>
            </div>
          </div>
        </div>
      )}

      {enrichWarnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <p className="text-sm font-medium text-amber-800 mb-2">⚠️ Warnings d'enrichissement ({enrichWarnings.length})</p>
          <ul className="text-sm text-amber-700 space-y-1">
            {enrichWarnings.map((w, i) => (
              <li key={i} className="flex items-start gap-1"><span className="text-amber-400">·</span>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {enrichSources.length > 0 && !enrichError && (
        <div
          className="rounded-lg p-3 flex items-center gap-3"
          style={{ background: "rgba(38,166,154,0.07)", border: "1px solid #c0e8d4" }}
        >
          <span style={{ color: ACCENT_FIN }}>✓</span>
          <div>
            <span className="text-sm font-medium" style={{ color: "#0a3d28" }}>Données enrichies</span>
            <span className="text-sm ml-2" style={{ color: "#5a9a7a" }}>Sources : {enrichSources.join(", ")}</span>
            {enrichedAt && <span className="text-xs ml-2" style={{ color: "#9ed4bc" }}>({fmtDate(enrichedAt)})</span>}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════
          A) ABOVE THE FOLD — 2 Score Cards
          ══════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ──── LEFT: Score Dossier (Universal) ──── */}
        <div
          className="bg-white p-5 space-y-4"
          style={{ borderRadius: 14, border: "1px solid #c0e8d4" }}
        >
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold" style={{ color: "#0a3d28" }}>
                Score Dossier
                <Tip text="Score universel : complétude du dossier, montage financier, qualité de l'opération. Pilote la décision si le pré-filtre risques est passé." />
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">Universal — complétude &amp; montage</p>
            </div>
            <div className="flex items-center gap-2">
              {/* Settings gear */}
              <button
                onClick={() => setShowWeightsModal(true)}
                className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
                style={{ color: "#9ed4bc" }}
                title="Paramètres de pondération"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                </svg>
              </button>
              {displayScore && <ScoreBadge score={displayScore.score} grade={displayScore.grade} />}
            </div>
          </div>

          {displayScore ? (
            <>
              <p className="text-sm text-gray-600">{displayScore.verdict}</p>

              {drivers.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {drivers.map((d, i) => (
                    <span
                      key={i}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
                        d.positive ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"
                      }`}
                    >
                      {d.positive ? "↑" : "↓"} {d.label}: {d.value}
                    </span>
                  ))}
                </div>
              )}

              {/* ✅ FIX #11 + #13: Documentation already stripped at source, safety filter kept */}
              {displayScore.pillars && displayScore.pillars.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {displayScore.pillars
                    .filter((p) => !DOCUMENTATION_KEYS.has(p.key))
                    .map((p) => (
                    <div
                      key={p.key}
                      className="rounded-lg p-2.5 text-center"
                      style={{ background: "rgba(38,166,154,0.05)", border: "1px solid #e8f5f0" }}
                    >
                      <p className="text-[11px] text-gray-500 mb-0.5 truncate">{p.label}</p>
                      {p.hasData === false ? (
                        <p className="text-base font-bold text-gray-300">N/A</p>
                      ) : (
                        <>
                          <p className="text-base font-bold" style={{ color: "#0a3d28" }}>
                            {p.rawScore}<span className="text-[10px] text-gray-400 font-normal">/100</span>
                          </p>
                          {p.maxPoints > 0 && (
                            <p className="text-[10px]" style={{ color: "#9ed4bc" }}>{p.points}/{p.maxPoints} pts</p>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {hasBlockers && (
                <div
                  className="rounded-lg px-4 py-3 flex items-center justify-between gap-3"
                  style={{ background: "#fffbeb", border: "1px solid #fbbf24" }}
                >
                  <div>
                    <p className="text-sm font-medium text-amber-800">⚠ Score provisoire : dossier incomplet</p>
                    <p className="text-xs text-amber-600 mt-0.5">{blockers.length} élément{blockers.length > 1 ? "s" : ""} bloquant{blockers.length > 1 ? "s" : ""}</p>
                  </div>
                  <button
                    onClick={() => scrollTo(refComplete)}
                    className="shrink-0 px-3 py-1.5 text-white rounded-lg text-xs font-medium transition-colors"
                    style={{ background: GRAD_FIN }}
                  >
                    Compléter maintenant
                  </button>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-400 italic py-4">Lancez l'analyse ou calculez le score pour voir le résultat.</p>
          )}
        </div>

        {/* ──── RIGHT: Score Risques & Localisation ──── */}
        <div
          className="bg-white p-5 space-y-4"
          style={{ borderRadius: 14, border: "1px solid #c0e8d4" }}
        >
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold" style={{ color: "#0a3d28" }}>
                Risques &amp; Localisation
                <Tip text="Pré-filtre comité : risques exogènes (Géorisques, environnement, réglementaire). Un NO GO ici bloque la décision indépendamment du score dossier." />
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">Committee — pré-filtre risques</p>
            </div>
            <DecisionBadge decision={committee.decision} />
          </div>

          <CommitteePanel
            operation={operation}
            committee={committee}
            enrichSources={enrichSources}
            enrichedAt={enrichedAt}
          />
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          B) DECISION RULE BANNER
          ══════════════════════════════════════════════════════════════ */}
      <div className={`rounded-xl border px-5 py-3 flex items-center gap-3 text-sm ${
        isNoGo ? "bg-red-50 border-red-300 text-red-800"
        : committee.decision === "GO_AVEC_RESERVES" ? "bg-amber-50 border-amber-300 text-amber-800"
        : committee.decision === "GO" ? "bg-green-50 border-green-300 text-green-800"
        : "bg-gray-50 border-gray-200 text-gray-600"
      }`}>
        <span className="text-base">
          {isNoGo ? "🛑" : committee.decision === "GO" ? "✅" : committee.decision === "GO_AVEC_RESERVES" ? "⚠️" : "ℹ️"}
        </span>
        <div>
          <span className="font-semibold">Règle de décision : </span>
          {isNoGo ? (
            <span><strong>NO GO immédiat</strong> — risque site rédhibitoire. La décision comité bloque ce dossier indépendamment du score Universal.</span>
          ) : committee.decision ? (
            <span>Pré-filtre risques passé ({committee.decision}). La décision finale est pilotée par le <strong>Score Dossier Universal</strong>.</span>
          ) : (
            <span>En attente du pré-filtre risques. La décision sera pilotée par le Score Universal une fois les risques évalués.</span>
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

          {incompleteItems.length > 0 && (
            <div
              className="bg-white p-5"
              style={{ borderRadius: 14, border: "1px solid #c0e8d4" }}
            >
              <h3 className="text-lg font-semibold mb-3" style={{ color: "#0a3d28" }}>
                📋 À compléter ({incompleteItems.length})
              </h3>
              <div className="space-y-2">
                {incompleteItems.map((m: any, i: number) => (
                  <div key={i} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${m.severity === "blocker" ? "bg-red-50 text-red-700" : m.severity === "warn" ? "bg-amber-50 text-amber-700" : "bg-gray-50 text-gray-600"}`}>
                    <span>{m.severity === "blocker" ? "🔴" : m.severity === "warn" ? "🟡" : "ℹ️"}</span>
                    <span className="font-medium">{m.label}</span>
                    <span className="text-xs opacity-60">({m.field})</span>
                  </div>
                ))}
              </div>
              {missing.length > 6 && <p className="text-xs text-gray-400 mt-2">… et {missing.length - 6} autre{missing.length - 6 > 1 ? "s" : ""}</p>}
              <button
                onClick={() => navigate(`/banque/dossier/${dossierId}`)}
                className="mt-3 text-sm font-medium"
                style={{ color: ACCENT_FIN }}
              >
                Compléter dans le dossier →
              </button>
            </div>
          )}

          <div ref={refFinances} />

          {operation.kpis && Object.keys(operation.kpis).length > 0 && (
            <div
              className="bg-white p-5"
              style={{ borderRadius: 14, border: "1px solid #c0e8d4" }}
            >
              <h3 className="text-lg font-semibold mb-3" style={{ color: "#0a3d28" }}>📈 KPIs financiers</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {operation.kpis.ltv !== undefined && (
                  <div className="rounded-lg p-3 text-center" style={{ background: "rgba(38,166,154,0.05)" }}>
                    <p className="text-xs text-gray-500">LTV</p>
                    <p className="text-xl font-bold" style={{ color: "#0a3d28" }}>{fmtPct(operation.kpis.ltv)}</p>
                  </div>
                )}
                {operation.kpis.dsti !== undefined && (
                  <div className="rounded-lg p-3 text-center" style={{ background: "rgba(38,166,154,0.05)" }}>
                    <p className="text-xs text-gray-500">DSTI</p>
                    <p className="text-xl font-bold" style={{ color: "#0a3d28" }}>{fmtPct(operation.kpis.dsti)}</p>
                  </div>
                )}
                {operation.kpis.monthlyPayment !== undefined && (
                  <div className="rounded-lg p-3 text-center" style={{ background: "rgba(38,166,154,0.05)" }}>
                    <p className="text-xs text-gray-500">Mensualité</p>
                    <p className="text-xl font-bold" style={{ color: "#0a3d28" }}>{fmtNum(operation.kpis.monthlyPayment, " €")}</p>
                  </div>
                )}
                {operation.kpis.projectCost !== undefined && (
                  <div className="rounded-lg p-3 text-center" style={{ background: "rgba(38,166,154,0.05)" }}>
                    <p className="text-xs text-gray-500">Coût projet</p>
                    <p className="text-xl font-bold" style={{ color: "#0a3d28" }}>{fmtK(operation.kpis.projectCost)}</p>
                  </div>
                )}
                {operation.kpis.dscr !== undefined && (
                  <div className="rounded-lg p-3 text-center" style={{ background: "rgba(38,166,154,0.05)" }}>
                    <p className="text-xs text-gray-500">DSCR</p>
                    <p className="text-xl font-bold" style={{ color: "#0a3d28" }}>{operation.kpis.dscr}x</p>
                  </div>
                )}
                {operation.kpis.yieldGross !== undefined && (
                  <div className="rounded-lg p-3 text-center" style={{ background: "rgba(38,166,154,0.05)" }}>
                    <p className="text-xs text-gray-500">Rendement brut</p>
                    <p className="text-xl font-bold" style={{ color: "#0a3d28" }}>{fmtPct(operation.kpis.yieldGross)}</p>
                  </div>
                )}
                {operation.kpis.pricePerSqmMarket !== undefined && (
                  <div className="rounded-lg p-3 text-center" style={{ background: "rgba(38,166,154,0.05)" }}>
                    <p className="text-xs text-gray-500">Prix marché</p>
                    <p className="text-xl font-bold" style={{ color: "#0a3d28" }}>{fmtNum(operation.kpis.pricePerSqmMarket, " €/m²")}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {(operation.dvf?.stats || operation.market?.commune) && (
            <div
              className="bg-white p-5 space-y-5"
              style={{ borderRadius: 14, border: "1px solid #c0e8d4" }}
            >
              <h3 className="text-lg font-semibold" style={{ color: "#0a3d28" }}>🏘️ Marché &amp; transactions</h3>

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
                      <p className="text-sm font-medium text-gray-700">{fmtNum(operation.dvf.stats.price_q1_eur_m2)} — {fmtNum(operation.dvf.stats.price_q3_eur_m2, " €/m²")}</p>
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
                                <td className="py-1 text-right font-medium" style={{ color: ACCENT_FIN }}>{fmtNum(c.pricePerSqm, " €")}</td>
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
                        <p className="text-xs text-gray-400 mt-1">{operation.market.commune.departement}, {operation.market.commune.region}</p>
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
                            <p className="text-lg font-bold text-gray-800">{operation.market.demandIndex}<span className="text-xs text-gray-400 font-normal">/100</span></p>
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

          <UrbanismSection urbanism={urbanism} onChange={handleUrbanismChange} />
        </div>

        {/* ──── COLONNE DROITE (2/5) ──── */}
        <div className="lg:col-span-2 space-y-5">
          <div ref={refRisks} />

          {operation.risks?.geo && (
            <div
              className="bg-white p-5"
              style={{ borderRadius: 14, border: "1px solid #c0e8d4" }}
            >
              <h3 className="text-lg font-semibold mb-3" style={{ color: "#0a3d28" }}>🌍 Risques géographiques</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg p-3 text-center" style={{ background: "rgba(38,166,154,0.05)" }}>
                  <p className="text-xs text-gray-500">Score risque</p>
                  <p className={`text-2xl font-bold ${operation.risks.geo.score >= 70 ? "text-green-600" : operation.risks.geo.score >= 40 ? "text-amber-600" : "text-red-600"}`}>
                    {operation.risks.geo.score}/100
                  </p>
                  <p className="text-xs text-gray-500">{operation.risks.geo.label}</p>
                </div>
                <div className="rounded-lg p-3 text-center" style={{ background: "rgba(38,166,154,0.05)" }}>
                  <p className="text-xs text-gray-500">Risques identifiés</p>
                  <p className="text-xl font-bold text-gray-800">{operation.risks.geo.nbRisques}</p>
                </div>
                <div className="rounded-lg p-3 text-center" style={{ background: "rgba(38,166,154,0.05)" }}>
                  <p className="text-xs text-gray-500">Inondation</p>
                  <p className="text-lg font-bold">
                    {operation.risks.geo.hasInondation ? <span className="text-red-600">Oui</span> : <span className="text-green-600">Non</span>}
                  </p>
                </div>
                <div className="rounded-lg p-3 text-center" style={{ background: "rgba(38,166,154,0.05)" }}>
                  <p className="text-xs text-gray-500">Sismique</p>
                  <p className="text-lg font-bold">
                    {operation.risks.geo.hasSismique ? <span className="text-amber-600">Oui</span> : <span className="text-green-600">Non</span>}
                  </p>
                </div>
              </div>
            </div>
          )}

          {alerts.length > 0 && (
            <div
              className="bg-white p-5"
              style={{ borderRadius: 14, border: "1px solid #c0e8d4" }}
            >
              <h3 className="text-lg font-semibold mb-3" style={{ color: "#0a3d28" }}>🚨 Alertes ({alerts.length})</h3>
              <div className="space-y-2">
                {alerts.map((a: any, i: number) => (
                  <div key={i} className={`px-3 py-2 rounded-lg text-sm ${a.level === "critical" ? "bg-red-50 text-red-700 border border-red-200" : a.level === "warning" ? "bg-amber-50 text-amber-700 border border-amber-200" : "bg-blue-50 text-blue-700 border border-blue-200"}`}>
                    {a.message}
                  </div>
                ))}
              </div>
            </div>
          )}

          {(enrichSources.length > 0 || enrichedAt) && (
            <div
              className="bg-white p-5"
              style={{ borderRadius: 14, border: "1px solid #c0e8d4" }}
            >
              <h3 className="text-sm font-semibold mb-2" style={{ color: "#0a3d28" }}>🔗 Sources d'enrichissement</h3>
              {enrichSources.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {enrichSources.map((s, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 rounded text-xs font-medium"
                      style={{ background: "rgba(38,166,154,0.10)", color: ACCENT_FIN }}
                    >
                      {s}
                    </span>
                  ))}
                </div>
              )}
              {enrichedAt && <p className="text-xs text-gray-400">Dernière mise à jour : {fmtDate(enrichedAt)}</p>}
            </div>
          )}

          {(() => {
            const snap = readBanqueSnapshot();
            const events = snap?.events?.slice(-5)?.reverse() ?? [];
            if (events.length === 0) return null;
            return (
              <div
                className="bg-white p-5"
                style={{ borderRadius: 14, border: "1px solid #c0e8d4" }}
              >
                <h3 className="text-sm font-semibold mb-2" style={{ color: "#0a3d28" }}>📝 Journal rapide</h3>
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
              <p className="text-xs font-bold text-indigo-700 mb-1">Operation enrichment status:</p>
              <pre className="text-xs text-gray-600 bg-white rounded p-2 overflow-x-auto max-h-[200px]">
                {JSON.stringify({
                  hasRisksGeo: !!operation?.risks?.geo,
                  risksGeoScore: operation?.risks?.geo?.score,
                  hasEnriched: hasEnrichedData(operation),
                  enrichedInSession: enrichedInSessionRef.current,
                  sources: enrichSources,
                  committeeSource: (operation as any)?.committee?.source,
                  pillarWeights: weightsConfig.weights,
                  rawScore: scoreResult?.score,
                  reweightedScore: displayScore?.score,
                  docPillarStripped: "✅ at source via normalizeSmartScoreUniversal",
                }, null, 2)}
              </pre>
            </div>
            <div>
              <p className="text-xs font-bold text-indigo-700 mb-1">Reweighted scoreResult:</p>
              <pre className="text-xs text-gray-600 bg-white rounded p-2 overflow-x-auto max-h-[200px]">
                {JSON.stringify(displayScore ? {
                  score: displayScore.score,
                  grade: displayScore.grade,
                  verdict: displayScore.verdict,
                  pillars: displayScore.pillars?.map((p) => ({ key: p.key, label: p.label, rawScore: p.rawScore, points: p.points, maxPoints: p.maxPoints, hasData: p.hasData })),
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
          <summary className="text-sm font-medium text-gray-500 cursor-pointer">🔧 Debug — Operation brute (dev only)</summary>
          <pre className="mt-3 text-xs text-gray-600 overflow-x-auto max-h-[400px]">{JSON.stringify(operation, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}