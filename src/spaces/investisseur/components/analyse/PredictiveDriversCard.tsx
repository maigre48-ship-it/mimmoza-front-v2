import React from "react";
import type { PredictiveDriver } from "../../services/predictive/predictive.types";

const DIR_STYLE: Record<string, { icon: string; color: string; bg: string }> = {
  positive: { icon: "↑", color: "#16a34a", bg: "#f0fdf4" },
  negative: { icon: "↓", color: "#dc2626", bg: "#fef2f2" },
  neutral:  { icon: "→", color: "#6b7280", bg: "#f9fafb" },
};

interface Props {
  drivers: PredictiveDriver[];
}

export default function PredictiveDriversCard({ drivers }: Props) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-6">
      <h3 className="text-sm font-semibold text-gray-900 mb-1">
        Facteurs de marché
      </h3>
      <p className="text-xs text-gray-500 mb-4">
        Principaux drivers influençant la projection
      </p>

      <div className="space-y-2.5">
        {drivers.map((d) => {
          const style = DIR_STYLE[d.direction] ?? DIR_STYLE.neutral;
          return (
            <div
              key={d.key}
              className="flex items-start gap-3 rounded-xl ring-1 ring-gray-200 px-3.5 py-3"
            >
              <span
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                style={{ background: style.bg, color: style.color }}
              >
                {style.icon}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-gray-800">
                    {d.label}
                  </span>
                  <span className="shrink-0 text-xs text-gray-400">
                    Impact {d.impact}/100
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-gray-500 leading-relaxed">
                  {d.description}
                </p>
                {/* Impact bar */}
                <div className="mt-2 h-1 w-full rounded-full bg-gray-100 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(d.impact, 100)}%`,
                      background: style.color,
                      opacity: 0.6,
                    }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}