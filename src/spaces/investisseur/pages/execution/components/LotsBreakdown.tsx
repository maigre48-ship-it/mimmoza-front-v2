// src/spaces/investisseur/components/travaux/LotsBreakdown.tsx
import React, { useState } from "react";
import type { ComputedLot } from "../../shared/travauxSimulation.types";

interface LotsBreakdownProps {
  lots: ComputedLot[];
  total: number;
  bufferPct: number;
  bufferAmount: number;
  totalWithBuffer: number;
  costPerM2: number | null;
  complexityCoef: number;
}

const fmt = (n: number) =>
  n.toLocaleString("fr-FR", { maximumFractionDigits: 0 });

const fmtEuro = (n: number) => `${fmt(n)} €`;

const LotsBreakdown: React.FC<LotsBreakdownProps> = ({
  lots,
  total,
  bufferPct,
  bufferAmount,
  totalWithBuffer,
  costPerM2,
  complexityCoef,
}) => {
  const [expandedLot, setExpandedLot] = useState<string | null>(null);

  const toggleLot = (code: string) =>
    setExpandedLot((prev) => (prev === code ? null : code));

  const nonEmptyLots = lots.filter((l) => l.amount > 0);

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-xs text-gray-500 uppercase tracking-wide">
            Total HT
          </p>
          <p className="text-xl font-bold text-gray-900 mt-1">
            {fmtEuro(total)}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-xs text-gray-500 uppercase tracking-wide">
            Buffer ({(bufferPct * 100).toFixed(0)}%)
          </p>
          <p className="text-xl font-bold text-amber-600 mt-1">
            {fmtEuro(bufferAmount)}
          </p>
        </div>
        <div className="bg-gradient-to-br from-violet-600 to-indigo-700 rounded-xl p-4 text-center text-white">
          <p className="text-xs uppercase tracking-wide opacity-80">
            Total + Buffer
          </p>
          <p className="text-xl font-bold mt-1">{fmtEuro(totalWithBuffer)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-xs text-gray-500 uppercase tracking-wide">
            €/m²
          </p>
          <p className="text-xl font-bold text-gray-900 mt-1">
            {costPerM2 !== null ? fmtEuro(costPerM2) : "—"}
          </p>
        </div>
      </div>

      {complexityCoef > 1 && (
        <p className="text-xs text-gray-500 text-right">
          Coef. complexité appliqué : ×{complexityCoef.toFixed(2)}
        </p>
      )}

      {/* Lots detail */}
      <div className="space-y-2">
        {nonEmptyLots.map((lot) => {
          const pct = total > 0 ? (lot.amount / total) * 100 : 0;
          const isOpen = expandedLot === lot.code;

          return (
            <div
              key={lot.code}
              className="bg-white rounded-xl border border-gray-200 overflow-hidden"
            >
              <button
                type="button"
                onClick={() => toggleLot(lot.code)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors text-left"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="h-2 rounded-full bg-violet-500 flex-shrink-0"
                    style={{ width: `${Math.max(4, pct * 0.8)}px` }}
                  />
                  <span className="text-sm font-medium text-gray-800 truncate">
                    {lot.label}
                  </span>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="text-xs text-gray-400">
                    {pct.toFixed(1)}%
                  </span>
                  <span className="text-sm font-semibold text-gray-900">
                    {fmtEuro(lot.amount)}
                  </span>
                  <svg
                    className={`w-4 h-4 text-gray-400 transition-transform ${
                      isOpen ? "rotate-180" : ""
                    }`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </div>
              </button>

              {isOpen && lot.lines.length > 0 && (
                <div className="border-t border-gray-100 px-4 py-2 bg-gray-50/50">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-400 uppercase tracking-wider">
                        <th className="text-left py-1 font-medium">Poste</th>
                        <th className="text-right py-1 font-medium">Qté</th>
                        <th className="text-right py-1 font-medium">P.U.</th>
                        <th className="text-right py-1 font-medium">
                          Montant
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {lot.lines.map((line, idx) => (
                        <tr
                          key={`${line.code}-${idx}`}
                          className="border-t border-gray-100"
                        >
                          <td className="py-1.5 text-gray-700 pr-2">
                            {line.label}
                          </td>
                          <td className="py-1.5 text-right text-gray-600 whitespace-nowrap">
                            {line.qty % 1 === 0
                              ? line.qty
                              : line.qty.toFixed(1)}{" "}
                            {line.unit !== "forfait" && line.unit !== "pct"
                              ? line.unit
                              : ""}
                          </td>
                          <td className="py-1.5 text-right text-gray-600 whitespace-nowrap">
                            {line.unit === "pct"
                              ? `${(line.qty * 100).toFixed(0)}%`
                              : fmtEuro(line.unitPrice)}
                          </td>
                          <td className="py-1.5 text-right font-medium text-gray-900 whitespace-nowrap">
                            {fmtEuro(line.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default LotsBreakdown;