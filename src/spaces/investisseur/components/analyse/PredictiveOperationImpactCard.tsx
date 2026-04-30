import React from "react";
import type { PredictiveAnalysisSnapshot } from "../../services/predictive/predictive.types";

function fmtEur(v: number): string {
  return v.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " €";
}

interface Props {
  snapshot: PredictiveAnalysisSnapshot;
}

export default function PredictiveOperationImpactCard({ snapshot }: Props) {
  const op = snapshot.operationImpact;
  const marginPositive = op.projectedMargin >= 0;
  const stressOk = op.stressDownsidePercent > -5;

  const resaleTimeline = [
    { label: "6 mois", value: op.targetResale6m },
    { label: "12 mois", value: op.targetResale12m },
    { label: "18 mois", value: op.targetResale18m },
    { label: "24 mois", value: op.targetResale24m },
  ];

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-6">
      <h3 className="text-sm font-semibold text-gray-900 mb-1">
        Impact opérationnel
      </h3>
      <p className="text-xs text-gray-500 mb-5">
        Projection sur le deal — revente cible, marge et stress test
      </p>

      {/* Resale timeline */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {resaleTimeline.map((r) => (
          <div
            key={r.label}
            className="rounded-xl bg-gray-50 ring-1 ring-gray-200 p-3 text-center"
          >
            <div className="text-[10px] uppercase tracking-wide text-gray-500">
              Revente {r.label}
            </div>
            <div className="mt-1 text-sm font-semibold text-gray-800">
              {fmtEur(r.value)}
            </div>
          </div>
        ))}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-gray-200 p-4">
          <div className="text-[10px] uppercase tracking-wide text-gray-500">
            Marge projetée (12m)
          </div>
          <div
            className="mt-1 text-2xl font-semibold"
            style={{ color: marginPositive ? "#16a34a" : "#dc2626" }}
          >
            {op.projectedMargin >= 0 ? "+" : ""}
            {op.projectedMargin.toFixed(1)}%
          </div>
        </div>
        <div className="rounded-xl border border-gray-200 p-4">
          <div className="text-[10px] uppercase tracking-wide text-gray-500">
            Profit net projeté
          </div>
          <div
            className="mt-1 text-2xl font-semibold"
            style={{ color: op.projectedNetProfit >= 0 ? "#16a34a" : "#dc2626" }}
          >
            {fmtEur(op.projectedNetProfit)}
          </div>
        </div>
        <div className="rounded-xl border border-gray-200 p-4">
          <div className="text-[10px] uppercase tracking-wide text-gray-500">
            Break-even
          </div>
          <div className="mt-1 text-lg font-semibold text-gray-800">
            {fmtEur(op.breakEvenPrice)}
          </div>
          <div className="mt-0.5 text-xs text-gray-400">
            Prix plancher pour ne pas perdre
          </div>
        </div>
        <div className="rounded-xl border border-gray-200 p-4">
          <div className="text-[10px] uppercase tracking-wide text-gray-500">
            Stress downside
          </div>
          <div
            className="mt-1 text-lg font-semibold"
            style={{ color: stressOk ? "#d97706" : "#dc2626" }}
          >
            {op.stressDownsidePercent >= 0 ? "+" : ""}
            {op.stressDownsidePercent.toFixed(1)}%
          </div>
          <div className="mt-0.5 text-xs text-gray-400">
            Marge en scénario prudent
          </div>
        </div>
      </div>
    </div>
  );
}