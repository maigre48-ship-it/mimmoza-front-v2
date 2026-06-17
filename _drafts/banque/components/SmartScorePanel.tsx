/**
 * SmartScorePanel.tsx
 * ═══════════════════════════════════════════════════════════════════
 * Composant réutilisable pour afficher le SmartScore.
 * Utilisé dans : Analyse, Decision (Comité), Dashboard.
 *
 * Utilise Tailwind (cohérent avec les pages existantes).
 * ═══════════════════════════════════════════════════════════════════
 */

import { useState } from "react";
import type { SmartScoreResult, SubscoreDetail } from "../shared/services/banqueSmartscore";

// ════════════════════════════════════════════════════════════════════
// Props
// ════════════════════════════════════════════════════════════════════

interface SmartScorePanelProps {
  result: SmartScoreResult | null;
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
  onRecalculate,
  isComputing = false,
  error,
  compact = false,
}: SmartScorePanelProps) {
  const [showDetails, setShowDetails] = useState(!compact);

  // ── État vide ──
  if (!result) {
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

  const gradeStyles = GRADE_COLORS[result.grade] ?? GRADE_COLORS.C;
  const verdictStyles = VERDICT_COLORS[result.verdict] ?? VERDICT_COLORS["GO SOUS CONDITIONS"];

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
      {/* ── Header : Score + Grade + Verdict + Recalculer ── */}
      <div className="flex items-center gap-4 flex-wrap">
        {/* Cercle score */}
        <div className="w-[72px] h-[72px] rounded-full border-[3px] border-slate-200 flex flex-col items-center justify-center shrink-0">
          <span className={`text-2xl font-bold leading-none ${gradeStyles.text}`}>{result.score}</span>
          <span className="text-[11px] text-slate-400">/100</span>
        </div>

        {/* Badges */}
        <div className="flex items-center gap-2 flex-wrap flex-1">
          <span className={`px-3 py-1 rounded-md text-xs font-semibold border ${gradeStyles.bg} ${gradeStyles.text} ${gradeStyles.border}`}>
            Grade {result.grade}
          </span>
          <span className={`px-3 py-1 rounded-md text-xs font-semibold ${verdictStyles.bg} ${verdictStyles.text}`}>
            {result.verdict}
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

      {/* ── Barres 6 axes ── */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-slate-600">Axes de scoring</h3>
        {result.subscores.map((sub) => (
          <AxisBar key={sub.name} sub={sub} />
        ))}
      </div>

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
          {result.penalties.length > 0 && (
            <div className="rounded-md bg-amber-50 border border-amber-200 p-3 space-y-1">
              <h4 className="text-xs font-semibold text-amber-800">⚠️ Pénalités ({result.penalties.length})</h4>
              {result.penalties.map((p, i) => (
                <div key={i} className="flex gap-2 text-xs text-amber-700">
                  <span className="font-bold text-red-600 shrink-0 w-12">-{p.points}pts</span>
                  <span>{p.label} — {p.reason}</span>
                </div>
              ))}
            </div>
          )}

          {/* Données manquantes */}
          {result.missingData.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-slate-600 mb-1">📋 Données manquantes</h4>
              <div className="flex gap-1.5 flex-wrap">
                {result.missingData.map((k) => (
                  <span key={k} className="px-2 py-0.5 rounded bg-slate-100 text-slate-500 text-[11px] font-medium">
                    {k}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Blockers */}
          {result.blockers.length > 0 && (
            <div className="rounded-md bg-red-50 border border-red-200 p-3 space-y-1">
              <h4 className="text-xs font-semibold text-red-800">⛔ Blockers</h4>
              {result.blockers.map((b, i) => (
                <p key={i} className="text-xs text-red-700 font-medium">{b}</p>
              ))}
            </div>
          )}

          {/* Explications */}
          <div className="space-y-1">
            <h4 className="text-xs font-semibold text-slate-600">📝 Explications</h4>
            {result.explanations.map((exp, i) => (
              <p key={i} className="text-xs text-slate-500 pl-2 border-l-2 border-slate-200 leading-relaxed">
                {exp}
              </p>
            ))}
          </div>

          {/* Meta */}
          <div className="flex gap-2 flex-wrap text-[10px] text-slate-400 pt-2 border-t border-slate-100">
            <span>Engine v{result.engineVersion}</span>
            <span>·</span>
            <span>{new Date(result.computedAt).toLocaleString("fr-FR")}</span>
            <span>·</span>
            <span>Hash {result.inputHash}</span>
            {result.scoreHistory.length > 1 && (
              <>
                <span>·</span>
                <span>{result.scoreHistory.length} calculs</span>
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

function AxisBar({ sub }: { sub: SubscoreDetail }) {
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
  "NO GO":               { bg: "bg-red-50",    text: "text-red-700" },
};