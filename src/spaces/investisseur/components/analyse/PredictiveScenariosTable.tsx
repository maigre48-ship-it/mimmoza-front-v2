import React from "react";
import type { PredictiveAnalysisSnapshot } from "../../services/predictive/predictive.types";

function fmtEur(v: number): string {
  return v.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " €";
}

const SCENARIO_META = [
  { key: "prudent" as const, label: "Prudent", color: "#dc2626", bg: "#fef2f2", icon: "🛡️" },
  { key: "central" as const, label: "Central", color: "#2563eb", bg: "#eff6ff", icon: "📊" },
  { key: "optimistic" as const, label: "Optimiste", color: "#16a34a", bg: "#f0fdf4", icon: "🚀" },
];

const HORIZONS = [
  { key: "horizon6m" as const, label: "6 mois" },
  { key: "horizon12m" as const, label: "12 mois" },
  { key: "horizon18m" as const, label: "18 mois" },
  { key: "horizon24m" as const, label: "24 mois" },
];

interface Props {
  snapshot: PredictiveAnalysisSnapshot;
}

export default function PredictiveScenariosTable({ snapshot }: Props) {
  const { scenarios, spot } = snapshot;

  const delta = (val: number) => {
    const pct = ((val - spot.marketValue) / spot.marketValue) * 100;
    const sign = pct >= 0 ? "+" : "";
    return `${sign}${pct.toFixed(1)}%`;
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-6">
      <h3 className="text-sm font-semibold text-gray-900 mb-1">
        Scénarios de valorisation
      </h3>
      <p className="text-xs text-gray-500 mb-4">
        Projection par horizon — valeur de marché estimée
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="py-2 pr-4 text-left text-[11px] uppercase tracking-wide text-gray-500 font-medium">
                Scénario
              </th>
              {HORIZONS.map((h) => (
                <th
                  key={h.key}
                  className="py-2 px-3 text-right text-[11px] uppercase tracking-wide text-gray-500 font-medium"
                >
                  {h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SCENARIO_META.map((sc) => {
              const data = scenarios[sc.key];
              return (
                <tr key={sc.key} className="border-b border-gray-50 last:border-0">
                  <td className="py-3 pr-4">
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
                      style={{ background: sc.bg, color: sc.color }}
                    >
                      <span>{sc.icon}</span>
                      {sc.label}
                    </span>
                  </td>
                  {HORIZONS.map((h) => {
                    const val = data[h.key];
                    return (
                      <td key={h.key} className="py-3 px-3 text-right">
                        <div className="font-medium text-gray-800">
                          {fmtEur(val)}
                        </div>
                        <div
                          className="text-[11px]"
                          style={{
                            color:
                              val >= spot.marketValue ? "#16a34a" : "#dc2626",
                          }}
                        >
                          {delta(val)}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 rounded-xl bg-gray-50 ring-1 ring-gray-200 px-4 py-3 text-xs text-gray-500">
        Base spot : {fmtEur(spot.marketValue)} ({spot.pricePerSqm.toLocaleString("fr-FR")} €/m²).
        Projections basées sur les tendances de marché locales et les drivers macro.
      </div>
    </div>
  );
}