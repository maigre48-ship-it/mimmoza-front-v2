// ============================================================================
// RatiosPanel.tsx — Affichage des ratios crédit avec tooltips explicatifs
// Props : montantPret, duree, garanties, budget, revenus, bien
// ============================================================================

import { useMemo, useState } from "react";
import { computeRatios, type RatiosResult } from "../../utils/banqueRatios";

interface Props {
  montantPret: number;
  duree: number;
  garanties: Record<string, unknown>;
  budget: Record<string, unknown>;
  revenus: Record<string, unknown>;
  bien?: Record<string, unknown>;
}

// ── Ratio metadata ──

interface RatioMeta {
  key: keyof Pick<RatiosResult, "ltv" | "ltc" | "dsti" | "dscr">;
  label: string;
  tooltip: string;
  format: (v: number | null) => string;
  thresholds: { good: number; warn: number; invert?: boolean };
}

const RATIOS: RatioMeta[] = [
  {
    key: "ltv",
    label: "LTV",
    tooltip:
      "Loan-to-Value — Rapport entre le montant du prêt et la valeur estimée du bien. Un LTV < 80 % est généralement considéré comme prudent.",
    format: (v) => (v != null ? `${(v * 100).toFixed(1)} %` : "—"),
    thresholds: { good: 0.7, warn: 0.85 },
  },
  {
    key: "ltc",
    label: "LTC",
    tooltip:
      "Loan-to-Cost — Rapport entre le montant du prêt et le coût total du projet (acquisition + travaux + frais). Un LTC < 80 % indique un apport suffisant.",
    format: (v) => (v != null ? `${(v * 100).toFixed(1)} %` : "—"),
    thresholds: { good: 0.7, warn: 0.85 },
  },
  {
    key: "dsti",
    label: "DSTI",
    tooltip:
      "Debt Service to Income — Part des charges de dette (existantes + mensualité du prêt) rapportées aux revenus mensuels. Le HCSF recommande un maximum de 35 %.",
    format: (v) => (v != null ? `${(v * 100).toFixed(1)} %` : "—"),
    thresholds: { good: 0.3, warn: 0.35 },
  },
  {
    key: "dscr",
    label: "DSCR",
    tooltip:
      "Debt Service Coverage Ratio — Revenus locatifs mensuels divisés par la mensualité du prêt. Un DSCR > 1,2 signifie que les loyers couvrent largement le remboursement.",
    format: (v) => (v != null ? v.toFixed(2) : "—"),
    thresholds: { good: 1.2, warn: 1.0, invert: true },
  },
];

function ratioColor(value: number | null, meta: RatioMeta): string {
  if (value == null) return "text-slate-400";
  const { good, warn, invert } = meta.thresholds;
  if (invert) {
    if (value >= good) return "text-green-600";
    if (value >= warn) return "text-amber-600";
    return "text-red-600";
  }
  if (value <= good) return "text-green-600";
  if (value <= warn) return "text-amber-600";
  return "text-red-600";
}

export default function RatiosPanel({
  montantPret,
  duree,
  garanties,
  budget,
  revenus,
  bien,
}: Props) {
  const result = useMemo(
    () =>
      computeRatios({
        montantPret,
        duree,
        garanties: garanties as any,
        budget: budget as any,
        revenus: revenus as any,
        bien: bien as any,
      }),
    [montantPret, duree, garanties, budget, revenus, bien]
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
      <h3 className="text-sm font-semibold text-slate-700">Ratios &amp; Mensualité</h3>

      {/* Mensualité + taux */}
      <div className="flex items-baseline gap-4">
        <div>
          <span className="text-xs text-slate-500">Mensualité estimée</span>
          <p className="text-xl font-bold text-slate-900">
            {result.mensualite > 0
              ? `${Math.round(result.mensualite).toLocaleString("fr-FR")} €`
              : "—"}
          </p>
        </div>
        <span className="text-xs text-slate-400">
          @ {result.annualRatePct.toFixed(2)} % / an
        </span>
      </div>

      {/* Ratio cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {RATIOS.map((meta) => (
          <RatioCard
            key={meta.key}
            meta={meta}
            value={result[meta.key]}
          />
        ))}
      </div>
    </div>
  );
}

// ── RatioCard with tooltip ──

function RatioCard({
  meta,
  value,
}: {
  meta: RatioMeta;
  value: number | null;
}) {
  const [showTip, setShowTip] = useState(false);

  return (
    <div className="relative rounded-lg border border-slate-100 bg-slate-50 p-3 text-center">
      {/* Label + info icon */}
      <div className="flex items-center justify-center gap-1 mb-1">
        <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
          {meta.label}
        </span>
        <button
          type="button"
          onMouseEnter={() => setShowTip(true)}
          onMouseLeave={() => setShowTip(false)}
          onFocus={() => setShowTip(true)}
          onBlur={() => setShowTip(false)}
          className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors"
          aria-label={`Info ${meta.label}`}
        >
          i
        </button>
      </div>

      {/* Value */}
      <p className={`text-lg font-bold ${ratioColor(value, meta)}`}>
        {meta.format(value)}
      </p>

      {/* Tooltip */}
      {showTip && (
        <div className="absolute z-10 bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 rounded-lg bg-slate-800 text-white text-xs p-3 shadow-lg leading-relaxed pointer-events-none">
          {meta.tooltip}
          <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-slate-800" />
        </div>
      )}
    </div>
  );
}