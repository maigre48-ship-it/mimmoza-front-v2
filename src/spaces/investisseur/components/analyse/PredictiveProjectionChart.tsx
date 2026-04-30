import React, { useState } from "react";
import type { PredictiveAnalysisSnapshot } from "../../services/predictive/predictive.types";

function fmtEur(v: number): string {
  return v.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " €";
}

const HORIZONS = [
  { key: "horizon6m", label: "6 mois" },
  { key: "horizon12m", label: "12 mois" },
  { key: "horizon18m", label: "18 mois" },
  { key: "horizon24m", label: "24 mois" },
] as const;

type HorizonKey = (typeof HORIZONS)[number]["key"];

interface Props {
  snapshot: PredictiveAnalysisSnapshot;
}

export default function PredictiveProjectionChart({ snapshot }: Props) {
  const [selected, setSelected] = useState<HorizonKey>("horizon12m");
  const { forecast, spot } = snapshot;

  const points = HORIZONS.map((h) => ({
    ...h,
    point: forecast[h.key],
  }));

  const allValues = [
    spot.marketValue,
    ...points.map((p) => p.point.marketValue),
  ];
  const min = Math.min(...allValues) * 0.96;
  const max = Math.max(...allValues) * 1.04;
  const range = max - min || 1;

  const chartW = 520;
  const chartH = 200;
  const padL = 0;
  const padR = 0;
  const padT = 20;
  const padB = 30;
  const innerW = chartW - padL - padR;
  const innerH = chartH - padT - padB;

  const xStep = innerW / (points.length);
  const toY = (v: number) => padT + innerH - ((v - min) / range) * innerH;
  const spotY = toY(spot.marketValue);

  const svgPoints = points.map((p, i) => ({
    x: padL + xStep * (i + 1),
    y: toY(p.point.marketValue),
    ...p,
  }));

  const linePath = [
    `M ${padL} ${spotY}`,
    ...svgPoints.map((p) => `L ${p.x} ${p.y}`),
  ].join(" ");

  const areaPath = linePath + ` L ${svgPoints[svgPoints.length - 1].x} ${chartH - padB} L ${padL} ${chartH - padB} Z`;

  const selectedPoint = svgPoints.find((p) => p.key === selected);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">
            Projection de valeur
          </h3>
          <p className="mt-0.5 text-xs text-gray-500">
            Scénario central — valeur de marché projetée
          </p>
        </div>
        <div className="flex gap-1">
          {HORIZONS.map((h) => (
            <button
              key={h.key}
              onClick={() => setSelected(h.key)}
              className={[
                "rounded-lg px-2.5 py-1 text-xs font-medium transition-all",
                selected === h.key
                  ? "bg-sky-100 text-sky-700 ring-1 ring-sky-200"
                  : "text-gray-500 hover:bg-gray-100",
              ].join(" ")}
            >
              {h.label}
            </button>
          ))}
        </div>
      </div>

      <svg
        viewBox={`0 0 ${chartW} ${chartH}`}
        className="w-full"
        style={{ maxHeight: 220 }}
      >
        {/* Area */}
        <path d={areaPath} fill="url(#predGrad)" opacity={0.15} />
        {/* Line */}
        <path d={linePath} fill="none" stroke="#0ea5e9" strokeWidth={2.5} strokeLinejoin="round" />
        {/* Spot dashed line */}
        <line
          x1={padL} y1={spotY}
          x2={chartW} y2={spotY}
          stroke="#94a3b8" strokeWidth={1} strokeDasharray="4 4"
        />
        <text x={chartW - 4} y={spotY - 6} textAnchor="end" className="text-[10px] fill-gray-400">
          Spot
        </text>

        {/* Points */}
        {svgPoints.map((p) => (
          <g key={p.key}>
            <circle
              cx={p.x} cy={p.y} r={p.key === selected ? 6 : 4}
              fill={p.key === selected ? "#0ea5e9" : "#bae6fd"}
              stroke="white" strokeWidth={2}
              className="cursor-pointer"
              onClick={() => setSelected(p.key)}
            />
            <text
              x={p.x} y={chartH - padB + 16}
              textAnchor="middle"
              className="text-[10px] fill-gray-500"
            >
              {p.label}
            </text>
          </g>
        ))}

        {/* Selected tooltip */}
        {selectedPoint && (() => {
            const ttW = 160;
            const ttH = 28;
            const ttX = Math.max(2, Math.min(selectedPoint.x - ttW / 2, chartW - ttW - 2));
            const ttY = selectedPoint.y - 40;
            return (
            <g>
              <line
                x1={selectedPoint.x} y1={selectedPoint.y + 8}
                x2={selectedPoint.x} y2={chartH - padB}
                stroke="#0ea5e9" strokeWidth={1} strokeDasharray="3 3" opacity={0.5}
              />
              <rect
                x={ttX} y={ttY}
                width={ttW} height={ttH} rx={6}
                fill="#0f172a" opacity={0.9}
              />
              <text
                x={ttX + ttW / 2} y={ttY + 18}
                textAnchor="middle"
                className="text-[11px] font-semibold fill-white"
              >
                {fmtEur(selectedPoint.point.marketValue)}
              </text>
            </g>
            );
          })()}

        <defs>
          <linearGradient id="predGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0ea5e9" />
            <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0} />
          </linearGradient>
        </defs>
      </svg>

      {selectedPoint && (
        <div className="mt-3 flex items-center gap-4 text-sm">
          <div className="text-gray-500">
            Δ {selectedPoint.point.deltaPercent >= 0 ? "+" : ""}
            {selectedPoint.point.deltaPercent}%
          </div>
          <div className="text-gray-500">
            {selectedPoint.point.pricePerSqm.toLocaleString("fr-FR")} €/m²
          </div>
          <div className="text-gray-400 text-xs">
            Confiance {selectedPoint.point.confidenceScore}/100
          </div>
        </div>
      )}
    </div>
  );
}