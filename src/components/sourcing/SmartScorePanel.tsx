/**
 * SmartScorePanel.tsx
 * ═══════════════════════════════════════════════════════════════════
 * Composant réutilisable pour afficher le SmartScore.
 * Utilisé dans : Analyse, Decision (Comité), Dashboard, Sourcing.
 *
 * Rétro-compatible :
 *   - prop `result` (SmartScoreResult Banque)  → rendu complet
 *   - prop `score`  (number | objet light)     → rendu complet aussi
 *     grâce au resolver ViewModel unifié
 *
 * Utilise Tailwind (cohérent avec les pages existantes).
 * ═══════════════════════════════════════════════════════════════════
 */

import { useState } from "react";
// Type local : forme "banque" complète telle que consommée par ce panel.
// (duck-typé au runtime via isFullSmartScore ; volontairement permissif)
interface SmartScoreResult {
  score: number;
  globalScore?: number;
  grade?: string;
  verdict?: string;
  subscores: Array<{ name: string; label: string; rawScore: number; weight: number; hasData: boolean }>;
  penalties: Array<{ points: number; label: string; reason: string }>;
  missingData: string[];
  blockers?: string[];
  explanations?: string[];
  scoreHistory?: number[];
  engineVersion?: string;
  computedAt?: string;
  inputHash?: string;
}

// ════════════════════════════════════════════════════════════════════
// ViewModel unifié
// ════════════════════════════════════════════════════════════════════

interface ViewModel {
  score: number;
  grade: "A" | "B" | "C" | "D" | "E";
  verdict: string;
  subscores: Array<{ name: string; label: string; rawScore: number; weight: number; hasData: boolean }>;
  penalties: Array<{ points: number; label: string; reason: string }>;
  missingData: string[];
  blockers: string[];
  explanations: string[];
  engineVersion: string;
  computedAt: string;
  inputHash: string;
  scoreHistory: number[];
}

// ════════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════════

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function computeGrade(score: number): "A" | "B" | "C" | "D" | "E" {
  if (score >= 80) return "A";
  if (score >= 65) return "B";
  if (score >= 50) return "C";
  if (score >= 35) return "D";
  return "E";
}

function computeVerdict(score: number): string {
  if (score >= 65) return "GO";
  if (score >= 40) return "GO SOUS CONDITIONS";
  return "NO GO";
}

// ════════════════════════════════════════════════════════════════════
// Détection full SmartScoreResult (banque)
// ════════════════════════════════════════════════════════════════════

function isFullSmartScore(obj: any): obj is SmartScoreResult {
  return (
    obj &&
    typeof obj === "object" &&
    Array.isArray(obj.subscores) &&
    obj.subscores.length > 0 &&
    Array.isArray(obj.penalties) &&
    Array.isArray(obj.missingData)
  );
}

// ════════════════════════════════════════════════════════════════════
// Resolver : transforme n'importe quel input en ViewModel | null
// ════════════════════════════════════════════════════════════════════

function resolveToViewModel(
  result: SmartScoreResult | null | undefined,
  score: number | LightScore | null | undefined,
): ViewModel | null {
  const input = result ?? (score as any) ?? null;
  if (input == null) return null;

  // ── 1) Nombre pur ──
  if (typeof input === "number") {
    const s = input;
    return buildLightViewModel(s, computeGrade(s), computeVerdict(s), undefined, undefined);
  }

  if (typeof input !== "object") return null;

  // ── 2) Full SmartScoreResult (banque) — subscores non vides ──
  if (isFullSmartScore(input)) {
    const d = input as SmartScoreResult;
    return {
      score: d.score ?? d.globalScore ?? 0,
      grade: (d.grade as ViewModel["grade"]) ?? computeGrade(d.score ?? 0),
      verdict: d.verdict ?? computeVerdict(d.score ?? 0),
      subscores: d.subscores,
      penalties: d.penalties,
      missingData: d.missingData,
      blockers: d.blockers ?? [],
      explanations: d.explanations ?? [],
      engineVersion: d.engineVersion ?? "banque",
      computedAt: d.computedAt ?? new Date().toISOString(),
      inputHash: d.inputHash ?? "",
      scoreHistory: d.scoreHistory ?? [d.score ?? 0],
    };
  }

  // ── 3) Objet light (sourcing / enrichi sans subscores non-vides banque) ──
  const obj = input as any;
  const s = Number(obj.globalScore ?? obj.score) || 0;
  const grade = validGrade(obj.grade) ?? computeGrade(s);
  const verdict = obj.verdict ?? computeVerdict(s);

  return buildLightViewModel(s, grade, verdict, obj, obj.details);
}

function validGrade(g: any): ViewModel["grade"] | null {
  if (typeof g === "string" && ["A", "B", "C", "D", "E"].includes(g)) return g as ViewModel["grade"];
  return null;
}

// ════════════════════════════════════════════════════════════════════
// Construire un ViewModel à partir d'un input light
// ════════════════════════════════════════════════════════════════════

function buildLightViewModel(
  score: number,
  grade: ViewModel["grade"],
  verdict: string,
  obj: any | undefined,
  details: any | undefined,
): ViewModel {
  // ── subscores ──
  const providedSubscores = obj?.subscores;
  let subscores: ViewModel["subscores"];

  if (Array.isArray(providedSubscores) && providedSubscores.length > 0) {
    subscores = providedSubscores;
  } else {
    subscores = deriveLightSubscores(score, details);
  }

  // ── explanations ──
  let explanations: string[];
  if (Array.isArray(obj?.explanations) && obj.explanations.length > 0) {
    explanations = obj.explanations;
  } else {
    explanations = deriveLightExplanations(score, obj, details);
  }

  // ── penalties / missingData / blockers ──
  const penalties = Array.isArray(obj?.penalties) ? obj.penalties : [];
  const missingData = Array.isArray(obj?.missingData) ? obj.missingData : [];
  const blockers = Array.isArray(obj?.blockers) ? obj.blockers : [];

  // ── meta ──
  const engineVersion = obj?.engineVersion ?? "local";
  const computedAt = obj?.computedAt ?? new Date().toISOString();
  const inputHash = obj?.inputHash ?? "local";
  const scoreHistory = Array.isArray(obj?.scoreHistory) && obj.scoreHistory.length > 0
    ? obj.scoreHistory
    : [score];

  return {
    score,
    grade,
    verdict,
    subscores,
    penalties,
    missingData,
    blockers,
    explanations,
    engineVersion,
    computedAt,
    inputHash,
    scoreHistory,
  };
}

/**
 * Générer 3 axes par défaut depuis details (prixM2, bonusMalus).
 * Si score === 0 et pas de données (prixM2 null, bonusMalus vide)
 * → tous les axes à 0 avec hasData=false.
 */
function deriveLightSubscores(
  score: number,
  details: any | undefined,
): ViewModel["subscores"] {
  const prixM2 = details?.prixM2 ?? null;
  const bonusMalus: Array<{ label: string; value: number }> = Array.isArray(details?.bonusMalus)
    ? details.bonusMalus
    : [];

  const hasPrixData = typeof prixM2 === "number" && prixM2 > 0;
  const hasAnyData = hasPrixData || bonusMalus.length > 0;

  // ── Minimum non atteint : score=0 et aucune donnée exploitable ──
  if (score === 0 && !hasAnyData) {
    return [
      { name: "prix", label: "Prix/m²", rawScore: 0, weight: 0.4, hasData: false },
      { name: "qualite", label: "Qualité", rawScore: 0, weight: 0.3, hasData: false },
      { name: "completude", label: "Complétude", rawScore: 0, weight: 0.3, hasData: false },
    ];
  }

  // 1) Prix/m²
  const prixRawScore = hasPrixData
    ? clamp(Math.round(100 - prixM2 / 200), 0, 100)
    : 0;

  // 2) Qualité : somme des bonus/malus normalisée
  const qualiteSum = bonusMalus.reduce((acc, b) => acc + (b.value ?? 0), 0);
  const qualiteRawScore = clamp(Math.round(((qualiteSum + 18) / 48) * 100), 0, 100);

  // 3) Complétude
  let completudeRawScore = 80;
  if (!hasPrixData) completudeRawScore = 40;
  if (bonusMalus.length === 0 && !hasPrixData) completudeRawScore = 30;

  return [
    { name: "prix", label: "Prix/m²", rawScore: prixRawScore, weight: 0.4, hasData: hasPrixData },
    { name: "qualite", label: "Qualité", rawScore: qualiteRawScore, weight: 0.3, hasData: true },
    { name: "completude", label: "Complétude", rawScore: completudeRawScore, weight: 0.3, hasData: true },
  ];
}

/** Générer des explanations depuis un objet light */
function deriveLightExplanations(
  score: number,
  obj: any | undefined,
  details: any | undefined,
): string[] {
  const lines: string[] = [];

  // Rationale existant ?
  const rationale = obj?.globalRationale ?? obj?.rationale;
  if (typeof rationale === "string" && rationale.trim().length > 0) {
    const parts = rationale.split(/\s*·\s*/).filter((s: string) => s.trim().length > 0);
    if (parts.length > 1) {
      lines.push(...parts);
    } else {
      lines.push(rationale.trim());
    }
  } else if (score === 0) {
    // Minimum non atteint, pas de rationale → message explicite
    lines.push("Renseigner le prix et la surface pour calculer le SmartScore.");
  } else {
    const prixM2 = details?.prixM2;
    if (typeof prixM2 === "number" && prixM2 > 0) {
      lines.push(`Prix/m² estimé : ${Math.round(prixM2).toLocaleString("fr-FR")} €/m²`);
    }
    lines.push(`Score calculé localement : ${score}/100`);
  }

  return lines;
}

// ════════════════════════════════════════════════════════════════════
// Types pour la prop score (light)
// ════════════════════════════════════════════════════════════════════

interface LightScore {
  score?: number;
  globalScore?: number;
  grade?: string;
  verdict?: string;
  rationale?: string;
  globalRationale?: string;
  details?: any;
  subscores?: any[];
  explanations?: string[];
  penalties?: any[];
  missingData?: string[];
  blockers?: string[];
  engineVersion?: string;
  computedAt?: string;
  inputHash?: string;
  scoreHistory?: number[];
  minimumMet?: boolean;
  [key: string]: unknown;
}

// ════════════════════════════════════════════════════════════════════
// Props
// ════════════════════════════════════════════════════════════════════

interface SmartScorePanelProps {
  /** SmartScoreResult complet (usage Banque) */
  result?: SmartScoreResult | null;
  /** Score number ou objet light (usage Sourcing) */
  score?: number | LightScore | null;
  /** Hints optionnels */
  hints?: any;
  onRecalculate?: () => void;
  isComputing?: boolean;
  error?: string | null;
  /** Mode compact (Dashboard / Comité) vs détaillé (Analyse) */
  compact?: boolean;
}

// ════════════════════════════════════════════════════════════════════
// Composant principal
// ════════════════════════════════════════════════════════════════════

export default function SmartScorePanel({
  result,
  score,
  hints,
  onRecalculate,
  isComputing = false,
  error,
  compact = false,
}: SmartScorePanelProps) {
  const [showDetails, setShowDetails] = useState(!compact);

  const vm = resolveToViewModel(result, score);

  // ── État vide ──
  if (!vm) {
    return (
      <section className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
        <div className="text-3xl mb-2">📊</div>
        <p className="text-sm text-slate-500 mb-4">Aucun SmartScore calculé pour ce dossier</p>
        {onRecalculate && (
          <button
            onClick={onRecalculate}
            disabled={isComputing}
            className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {isComputing ? "Calcul en cours…" : "Calculer le SmartScore"}
          </button>
        )}
        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      </section>
    );
  }

  // ── Rendu unifié via ViewModel ──
  return (
    <UnifiedScorePanel
      vm={vm}
      onRecalculate={onRecalculate}
      isComputing={isComputing}
      error={error}
      compact={compact}
      showDetails={showDetails}
      setShowDetails={setShowDetails}
    />
  );
}

// ════════════════════════════════════════════════════════════════════
// Rendu unifié
// ════════════════════════════════════════════════════════════════════

function UnifiedScorePanel({
  vm,
  onRecalculate,
  isComputing,
  error,
  compact,
  showDetails,
  setShowDetails,
}: {
  vm: ViewModel;
  onRecalculate?: () => void;
  isComputing?: boolean;
  error?: string | null;
  compact: boolean;
  showDetails: boolean;
  setShowDetails: (v: boolean) => void;
}) {
  const gradeStyles = GRADE_COLORS[vm.grade] ?? GRADE_COLORS.C;
  const verdictStyles = VERDICT_COLORS[vm.verdict] ?? VERDICT_COLORS["GO SOUS CONDITIONS"];

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
      {/* ── Header : Score + Grade + Verdict + Recalculer ── */}
      <div className="flex items-center gap-4 flex-wrap">
        {/* Cercle score */}
        <div className="w-[72px] h-[72px] rounded-full border-[3px] border-slate-200 flex flex-col items-center justify-center shrink-0">
          <span className={`text-2xl font-bold leading-none ${gradeStyles.text}`}>
            {Math.round(vm.score)}
          </span>
          <span className="text-[11px] text-slate-400">/100</span>
        </div>

        {/* Badges */}
        <div className="flex items-center gap-2 flex-wrap flex-1">
          <span className={`px-3 py-1 rounded-md text-xs font-semibold border ${gradeStyles.bg} ${gradeStyles.text} ${gradeStyles.border}`}>
            Grade {vm.grade}
          </span>
          <span className={`px-3 py-1 rounded-md text-xs font-semibold ${verdictStyles.bg} ${verdictStyles.text}`}>
            {vm.verdict}
          </span>

          {onRecalculate && (
            <button
              onClick={onRecalculate}
              disabled={isComputing}
              className="ml-auto rounded-md border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              {isComputing ? "⏳ Calcul…" : "🔄 Recalculer"}
            </button>
          )}
        </div>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      {/* ── Barres axes (si subscores présents) ── */}
      {vm.subscores.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-slate-600">Axes de scoring</h3>
          {vm.subscores.map((sub) => (
            <AxisBar key={sub.name} sub={sub} />
          ))}
        </div>
      )}

      {/* ── Toggle ── */}
      {compact && (
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="w-full text-center text-xs text-slate-400 hover:text-slate-600 py-1"
        >
          {showDetails ? "Masquer les détails ▲" : "Voir les détails ▼"}
        </button>
      )}

      {showDetails && (
        <>
          {/* Pénalités */}
          {vm.penalties.length > 0 && (
            <div className="rounded-md bg-amber-50 border border-amber-200 p-3 space-y-1">
              <h4 className="text-xs font-semibold text-amber-800">⚠️ Pénalités ({vm.penalties.length})</h4>
              {vm.penalties.map((p, i) => (
                <div key={i} className="flex gap-2 text-xs text-amber-700">
                  <span className="font-bold text-red-600 shrink-0 w-12">-{p.points}pts</span>
                  <span>{p.label} — {p.reason}</span>
                </div>
              ))}
            </div>
          )}

          {/* Données manquantes */}
          {vm.missingData.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-slate-600 mb-1">📋 Données manquantes</h4>
              <div className="flex gap-1.5 flex-wrap">
                {vm.missingData.map((k) => (
                  <span key={k} className="px-2 py-0.5 rounded bg-slate-100 text-slate-500 text-[11px] font-medium">
                    {k}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Blockers */}
          {vm.blockers.length > 0 && (
            <div className="rounded-md bg-red-50 border border-red-200 p-3 space-y-1">
              <h4 className="text-xs font-semibold text-red-800">⛔ Blockers</h4>
              {vm.blockers.map((b, i) => (
                <p key={i} className="text-xs text-red-700 font-medium">{b}</p>
              ))}
            </div>
          )}

          {/* Explications */}
          {vm.explanations.length > 0 && (
            <div className="space-y-1">
              <h4 className="text-xs font-semibold text-slate-600">📝 Explications</h4>
              {vm.explanations.map((exp, i) => (
                <p key={i} className="text-xs text-slate-500 pl-2 border-l-2 border-slate-200 leading-relaxed">
                  {exp}
                </p>
              ))}
            </div>
          )}

          {/* Meta */}
          <div className="flex gap-2 flex-wrap text-[10px] text-slate-400 pt-2 border-t border-slate-100">
            <span>Engine v{vm.engineVersion}</span>
            <span>·</span>
            <span>{new Date(vm.computedAt).toLocaleString("fr-FR")}</span>
            <span>·</span>
            <span>Hash {vm.inputHash}</span>
            {vm.scoreHistory.length > 1 && (
              <>
                <span>·</span>
                <span>{vm.scoreHistory.length} calculs</span>
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════
// Sous-composant : Barre axe
// ════════════════════════════════════════════════════════════════════

function AxisBar({ sub }: { sub: ViewModel["subscores"][number] }) {
  const barColor =
    sub.rawScore >= 70 ? "bg-green-500" :
    sub.rawScore >= 45 ? "bg-yellow-500" :
    "bg-red-500";

  return (
    <div>
      <div className="flex justify-between text-[11px] text-slate-500 mb-0.5">
        <span>{sub.label}</span>
        <span className="opacity-60">
          {!sub.hasData ? "⚠️ défaut" : `${sub.rawScore}/100`}
          {" · ×"}{(sub.weight * 100).toFixed(0)}%
        </span>
      </div>
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${barColor}`}
          style={{ width: `${sub.rawScore}%`, opacity: sub.hasData ? 1 : 0.35 }}
        />
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Couleurs
// ════════════════════════════════════════════════════════════════════

const GRADE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  A: { bg: "bg-green-50",  text: "text-green-700",  border: "border-green-300" },
  B: { bg: "bg-blue-50",   text: "text-blue-700",   border: "border-blue-300" },
  C: { bg: "bg-yellow-50", text: "text-yellow-700",  border: "border-yellow-300" },
  D: { bg: "bg-orange-50", text: "text-orange-700",  border: "border-orange-300" },
  E: { bg: "bg-red-50",    text: "text-red-700",     border: "border-red-300" },
};

const VERDICT_COLORS: Record<string, { bg: string; text: string }> = {
  GO:                    { bg: "bg-green-50",  text: "text-green-700" },
  "GO SOUS CONDITIONS":  { bg: "bg-yellow-50", text: "text-yellow-700" },
  "GO_AVEC_RESERVES":    { bg: "bg-yellow-50", text: "text-yellow-700" },
  "NO GO":               { bg: "bg-red-50",    text: "text-red-700" },
  "NO_GO":               { bg: "bg-red-50",    text: "text-red-700" },
};