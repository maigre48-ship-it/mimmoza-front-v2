import React from "react";
import type { PredictiveAnalysisSnapshot } from "../../services/predictive/predictive.types";

interface Props {
  snapshot: PredictiveAnalysisSnapshot;
}

export default function PredictiveSummaryCard({ snapshot }: Props) {
  const { summary, operationImpact } = snapshot;
  const isPositive = operationImpact.projectedMargin >= 5;
  const isNeutral =
    operationImpact.projectedMargin >= 0 &&
    operationImpact.projectedMargin < 5;

  const tone = isPositive
    ? { bg: "#f0fdf4", border: "#bbf7d0", color: "#16a34a", icon: "✅" }
    : isNeutral
    ? { bg: "#fffbeb", border: "#fde68a", color: "#d97706", icon: "⚠️" }
    : { bg: "#fef2f2", border: "#fecaca", color: "#dc2626", icon: "🚨" };

  return (
    <div
      className="rounded-2xl border p-6"
      style={{ background: tone.bg, borderColor: tone.border }}
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl">{tone.icon}</span>
        <div>
          <h3
            className="text-base font-semibold"
            style={{ color: tone.color }}
          >
            {summary.verdict}
          </h3>
          <p className="mt-2 text-sm text-gray-700 leading-relaxed">
            {summary.explanation}
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-1.5 text-[11px] text-gray-400">
        <span>Généré le {new Date(snapshot.generatedAt).toLocaleDateString("fr-FR", {
          day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
        })}</span>
        <span>·</span>
        <span>Moteur prédictif Mimmoza V1</span>
      </div>
    </div>
  );
}