import React from "react";
import type { PredictiveAnalysisSnapshot } from "../../services/predictive/predictive.types";

const REGIME_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  correction: { label: "Correction", color: "#dc2626", bg: "#fef2f2" },
  plateau:    { label: "Plateau",    color: "#d97706", bg: "#fffbeb" },
  reprise:    { label: "Reprise",    color: "#2563eb", bg: "#eff6ff" },
  hausse:     { label: "Hausse",     color: "#16a34a", bg: "#f0fdf4" },
};

function fmtEur(v: number): string {
  return v.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " €";
}

interface Props {
  snapshot: PredictiveAnalysisSnapshot;
}

export default function PredictiveExecutiveCard({ snapshot }: Props) {
  const { spot, market } = snapshot;
  const regime = REGIME_LABELS[market.regime] ?? REGIME_LABELS.plateau;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-gray-500">
            Prix spot estimé
          </div>
          <div className="mt-1 text-3xl font-semibold text-gray-900">
            {fmtEur(spot.marketValue)}
          </div>
          <div className="mt-1 text-sm text-gray-500">
            {spot.pricePerSqm.toLocaleString("fr-FR")} €/m²
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
            style={{ background: regime.bg, color: regime.color }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: regime.color }}
            />
            {regime.label}
          </span>
          <div className="text-right text-xs text-gray-400">
            Confiance {spot.confidenceScore}/100
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-4">
        <div className="rounded-xl bg-gray-50 ring-1 ring-gray-200 p-3">
          <div className="text-[10px] uppercase tracking-wide text-gray-500">
            Fourchette basse
          </div>
          <div className="mt-1 text-sm font-semibold text-gray-800">
            {fmtEur(spot.rangeLow)}
          </div>
        </div>
        <div className="rounded-xl bg-gray-50 ring-1 ring-gray-200 p-3">
          <div className="text-[10px] uppercase tracking-wide text-gray-500">
            Fourchette haute
          </div>
          <div className="mt-1 text-sm font-semibold text-gray-800">
            {fmtEur(spot.rangeHigh)}
          </div>
        </div>
        <div className="rounded-xl bg-gray-50 ring-1 ring-gray-200 p-3">
          <div className="text-[10px] uppercase tracking-wide text-gray-500">
            Pression marché
          </div>
          <div className="mt-1 text-sm font-semibold text-gray-800">
            {market.pressureScore}/100
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span className="h-2 w-2 rounded-full bg-sky-500" />
          Liquidité : {market.liquidityScore}/100
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span className="h-2 w-2 rounded-full bg-amber-500" />
          Risque : {market.riskScore}/100
        </div>
      </div>
    </div>
  );
}