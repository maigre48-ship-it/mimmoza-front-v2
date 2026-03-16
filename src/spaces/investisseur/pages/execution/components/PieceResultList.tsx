// src/spaces/investisseur/components/travaux/PieceResultList.tsx
import React, { useState } from "react";
import type {
  TravauxRange,
  PricingItemCode,
  ExpertLineItem,
  PieceTravaux,
} from "../../shared/travauxSimulation.types";
import { TRAVAUX_PRICING_V1 } from "../../services/travauxPricing.config";

/* ------------------------------------------------------------------ */
/*  Pricing index (local helper)                                       */
/* ------------------------------------------------------------------ */

interface PricingMeta {
  lotLabel: string;
  label: string;
  unit: string;
  prices: { eco: number; standard: number; premium: number };
}

const PRICING_MAP: Map<PricingItemCode, PricingMeta> = (() => {
  const m = new Map<PricingItemCode, PricingMeta>();
  for (const lot of TRAVAUX_PRICING_V1.lots) {
    for (const item of lot.items) {
      m.set(item.code, {
        lotLabel: lot.label,
        label: item.label,
        unit: item.unit,
        prices: item.prices,
      });
    }
  }
  return m;
})();

/* ------------------------------------------------------------------ */
/*  Compute per-piece breakdown grouped by lot                         */
/* ------------------------------------------------------------------ */

interface LineResult {
  code: PricingItemCode;
  label: string;
  unit: string;
  qty: number;
  unitPrice: number;
  amount: number;
}

interface LotGroup {
  lotLabel: string;
  amount: number;
  lines: LineResult[];
}

function computePieceBreakdown(
  items: ExpertLineItem[],
  range: TravauxRange
): { groups: LotGroup[]; total: number } {
  const groupMap = new Map<string, LotGroup>();
  let total = 0;

  for (const li of items) {
    if (li.qty <= 0) continue;
    const meta = PRICING_MAP.get(li.itemCode);
    if (!meta) continue;

    const unitPrice = meta.prices[range];
    const amount = li.qty * unitPrice;
    total += amount;

    const existing = groupMap.get(meta.lotLabel) ?? {
      lotLabel: meta.lotLabel,
      amount: 0,
      lines: [],
    };
    existing.amount += amount;
    existing.lines.push({
      code: li.itemCode,
      label: meta.label,
      unit: meta.unit,
      qty: li.qty,
      unitPrice,
      amount,
    });
    groupMap.set(meta.lotLabel, existing);
  }

  return {
    groups: Array.from(groupMap.values()).sort((a, b) => b.amount - a.amount),
    total,
  };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const fmt = (n: number) =>
  n.toLocaleString("fr-FR", { maximumFractionDigits: 0 });
const fmtEuro = (n: number) => `${fmt(n)} €`;

const PIECE_ICONS: Record<string, string> = {
  sejour: "🛋️",
  cuisine: "🍳",
  chambre: "🛏️",
  sdb: "🚿",
  wc: "🚽",
  entree: "🚪",
  couloir: "🏠",
  bureau: "💻",
  autre: "📐",
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface PieceResultListProps {
  pieces: PieceTravaux[];
  range: TravauxRange;
}

const PieceResultList: React.FC<PieceResultListProps> = ({
  pieces,
  range,
}) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (pieces.length === 0) {
    return (
      <p className="text-sm text-gray-400 italic py-4 text-center">
        Ajoutez des pièces pour voir le détail.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {pieces.map((piece) => {
        const { groups, total } = computePieceBreakdown(piece.items, range);
        const isOpen = expandedId === piece.id;
        const icon = PIECE_ICONS[piece.type] ?? "📐";

        return (
          <div
            key={piece.id}
            className="bg-white rounded-xl border border-gray-200 overflow-hidden"
          >
            <button
              type="button"
              onClick={() =>
                setExpandedId((prev) => (prev === piece.id ? null : piece.id))
              }
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors text-left"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-base">{icon}</span>
                <span className="text-sm font-medium text-gray-800 truncate">
                  {piece.name}
                </span>
                <span className="text-xs text-gray-400">
                  {piece.surfaceM2} m²
                </span>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <span className="text-sm font-semibold text-gray-900">
                  {fmtEuro(total)}
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

            {isOpen && groups.length > 0 && (
              <div className="border-t border-gray-100 px-4 py-3 bg-gray-50/50 space-y-3">
                {groups.map((g) => (
                  <div key={g.lotLabel}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-violet-700 uppercase tracking-wide">
                        {g.lotLabel}
                      </span>
                      <span className="text-xs font-medium text-gray-600">
                        {fmtEuro(g.amount)}
                      </span>
                    </div>
                    {g.lines.map((line, idx) => (
                      <div
                        key={`${line.code}-${idx}`}
                        className="flex items-center justify-between text-xs text-gray-600 pl-2 py-0.5"
                      >
                        <span className="truncate pr-2">{line.label}</span>
                        <span className="whitespace-nowrap">
                          {line.qty % 1 === 0
                            ? line.qty
                            : line.qty.toFixed(1)}{" "}
                          × {fmtEuro(line.unitPrice)} ={" "}
                          <span className="font-medium text-gray-800">
                            {fmtEuro(line.amount)}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default PieceResultList;