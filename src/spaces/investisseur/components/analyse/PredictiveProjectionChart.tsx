import { useMemo, useState } from "react";
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

// ── Scénarios ─────────────────────────────────────────────────────────
type ScenarioKey = "prudent" | "central" | "optimistic";

const SCENARIOS: { key: ScenarioKey; label: string; color: string }[] = [
  { key: "prudent",    label: "Prudent",   color: "#f43f5e" }, // rose
  { key: "central",    label: "Central",   color: "#0ea5e9" }, // sky
  { key: "optimistic", label: "Optimiste", color: "#10b981" }, // emerald
];

// Point normalisé utilisé par le graphe, quel que soit le scénario.
interface ChartPoint {
  marketValue: number;
  deltaPercent: number;
  pricePerSqm: number;
  confidenceScore?: number;
}

interface Props {
  snapshot: PredictiveAnalysisSnapshot;
}

export default function PredictiveProjectionChart({ snapshot }: Props) {
  const [selected, setSelected] = useState<HorizonKey>("horizon12m");
  const [scenario, setScenario] = useState<ScenarioKey>("central");

  const { forecast, spot, scenarios } = snapshot;

  const scenarioMeta = SCENARIOS.find((s) => s.key === scenario) ?? SCENARIOS[1];
  const lineColor = scenarioMeta.color;

  // Ratio prix/valeur du spot (constant à surface fixe) → sert à dériver le €/m²
  // des scénarios prudent/optimiste, qui ne portent que la valeur de marché.
  const ratio = spot.marketValue > 0 ? spot.pricePerSqm / spot.marketValue : 0;

  // Points du scénario sélectionné, par horizon.
  const points = useMemo(() => {
    return HORIZONS.map((h) => {
      let pt: ChartPoint;
      if (scenario === "central") {
        // Central : détail complet disponible dans forecast.
        const p = forecast[h.key];
        pt = {
          marketValue: p.marketValue,
          deltaPercent: p.deltaPercent,
          pricePerSqm: p.pricePerSqm,
          confidenceScore: p.confidenceScore,
        };
      } else {
        // Prudent / Optimiste : seule la valeur de marché est fournie.
        const mv = scenarios?.[scenario]?.[h.key];
        const marketValue =
          typeof mv === "number" ? mv : forecast[h.key].marketValue;
        const deltaPercent =
          spot.marketValue > 0
            ? Math.round((marketValue / spot.marketValue - 1) * 1000) / 10
            : 0;
        pt = {
          marketValue,
          deltaPercent,
          pricePerSqm: Math.round(marketValue * ratio),
          // pas de confiance par point pour ces scénarios
        };
      }
      return { ...h, point: pt };
    });
  }, [scenario, forecast, scenarios, spot.marketValue, ratio]);

  const allValues = [spot.marketValue, ...points.map((p) => p.point.marketValue)];
  const min = Math.min(...allValues) * 0.96;
  const max = Math.max(...allValues) * 1.04;
  const range = max - min || 1;

  // ── Géométrie ────────────────────────────────────────────────────────
  // padR élargi : sans marge droite, le dernier point (24 mois) tombait sur
  // le bord droit et son libellé était coupé. On réserve de l'espace à droite.
  const chartW = 560;
  const chartH = 200;
  const padL = 4;
  const padR = 52;
  const padT = 20;
  const padB = 30;
  const innerW = chartW - padL - padR;
  const innerH = chartH - padT - padB;

  const xStep = innerW / points.length;
  const toY = (v: number) => padT + innerH - ((v - min) / range) * innerH;
  const spotY = toY(spot.marketValue);

  const svgPoints = points.map((p, i) => ({
    x: padL + xStep * (i + 1),
    y: toY(p.point.marketValue),
    ...p,
  }));

  const lastX = svgPoints[svgPoints.length - 1].x;

  const linePath = [
    `M ${padL} ${spotY}`,
    ...svgPoints.map((p) => `L ${p.x} ${p.y}`),
  ].join(" ");

  const areaPath =
    linePath + ` L ${lastX} ${chartH - padB} L ${padL} ${chartH - padB} Z`;

  const selectedPoint = svgPoints.find((p) => p.key === selected);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-6">
      <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">
            Projection de valeur
          </h3>
          <p className="mt-0.5 text-xs text-gray-500">
            Scénario {scenarioMeta.label.toLowerCase()} — valeur de marché projetée
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Sélecteur de scénario */}
          <div className="relative">
            <select
              value={scenario}
              onChange={(e) => setScenario(e.target.value as ScenarioKey)}
              className="appearance-none rounded-lg border border-gray-200 bg-white pl-3 pr-8 py-1.5 text-xs font-medium text-gray-700 shadow-sm cursor-pointer hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-sky-500"
              style={{ color: lineColor }}
            >
              {SCENARIOS.map((s) => (
                <option key={s.key} value={s.key} style={{ color: "#374151" }}>
                  Scénario {s.label}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">
              ▼
            </span>
          </div>

          {/* Sélecteur d'horizon (met en évidence un point) */}
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
      </div>

      <svg
        viewBox={`0 0 ${chartW} ${chartH}`}
        className="w-full"
        style={{ maxHeight: 220 }}
      >
        {/* Area */}
        <path d={areaPath} fill="url(#predGrad)" opacity={0.15} />
        {/* Line */}
        <path
          d={linePath}
          fill="none"
          stroke={lineColor}
          strokeWidth={2.5}
          strokeLinejoin="round"
        />
        {/* Spot dashed line */}
        <line
          x1={padL}
          y1={spotY}
          x2={chartW - padR}
          y2={spotY}
          stroke="#94a3b8"
          strokeWidth={1}
          strokeDasharray="4 4"
        />
        <text
          x={chartW - padR + 4}
          y={spotY + 3}
          textAnchor="start"
          className="text-[10px] fill-gray-400"
        >
          Spot
        </text>

        {/* Points */}
        {svgPoints.map((p) => (
          <g key={p.key}>
            <circle
              cx={p.x}
              cy={p.y}
              r={p.key === selected ? 6 : 4}
              fill={p.key === selected ? lineColor : "#e2e8f0"}
              stroke="white"
              strokeWidth={2}
              className="cursor-pointer"
              onClick={() => setSelected(p.key)}
            />
            <text
              x={p.x}
              y={chartH - padB + 16}
              textAnchor="middle"
              className="text-[10px] fill-gray-500"
            >
              {p.label}
            </text>
          </g>
        ))}

        {/* Selected tooltip */}
        {selectedPoint &&
          (() => {
            const ttW = 160;
            const ttH = 28;
            const ttX = Math.max(
              2,
              Math.min(selectedPoint.x - ttW / 2, chartW - ttW - 2),
            );
            const ttY = selectedPoint.y - 40;
            return (
              <g>
                <line
                  x1={selectedPoint.x}
                  y1={selectedPoint.y + 8}
                  x2={selectedPoint.x}
                  y2={chartH - padB}
                  stroke={lineColor}
                  strokeWidth={1}
                  strokeDasharray="3 3"
                  opacity={0.5}
                />
                <rect
                  x={ttX}
                  y={ttY}
                  width={ttW}
                  height={ttH}
                  rx={6}
                  fill="#0f172a"
                  opacity={0.9}
                />
                <text
                  x={ttX + ttW / 2}
                  y={ttY + 18}
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
            <stop offset="0%" stopColor={lineColor} />
            <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
          </linearGradient>
        </defs>
      </svg>

      {selectedPoint && (
        <div className="mt-3 flex items-center gap-4 text-sm flex-wrap">
          <div className="text-gray-500">
            Δ {selectedPoint.point.deltaPercent >= 0 ? "+" : ""}
            {selectedPoint.point.deltaPercent}%
          </div>
          <div className="text-gray-500">
            {selectedPoint.point.pricePerSqm.toLocaleString("fr-FR")} €/m²
          </div>
          {selectedPoint.point.confidenceScore != null && (
            <div className="text-gray-400 text-xs">
              Confiance {selectedPoint.point.confidenceScore}/100
            </div>
          )}
        </div>
      )}
    </div>
  );
}