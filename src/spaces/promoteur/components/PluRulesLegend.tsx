// src/spaces/promoteur/components/PluRulesLegend.tsx

import React from "react";
import type { PluRuleStatus } from "../plan2d/plan.plu.types";
import { PluRuleBadge } from "./PluRuleBadge";

// ─── LEGEND DATA ──────────────────────────────────────────────────────

type LegendItem = {
  status: PluRuleStatus;
  description: string;
};

const LEGEND_ITEMS: LegendItem[] = [
  {
    status:      "CONFORME",
    description: "Le projet respecte clairement la règle analysée.",
  },
  {
    status:      "LIMITE",
    description: "Conforme mais proche du seuil — vigilance recommandée.",
  },
  {
    status:      "BLOQUANT",
    description: "Non conforme sur ce point — correction ou révision requise.",
  },
];

// ─── COMPONENT ────────────────────────────────────────────────────────

export interface PluRulesLegendProps {
  /** Optionally hide the section label for compact embedding */
  showLabel?: boolean;
}

export const PluRulesLegend: React.FC<PluRulesLegendProps> = ({
  showLabel = true,
}) => {
  return (
    <div
      style={{
        background:   "#f8fafc",
        border:       "1px solid #e2e8f0",
        borderRadius: 10,
        padding:      "10px 14px",
        display:      "flex",
        flexDirection: "column",
        gap:          0,
      }}
    >
      {showLabel && (
        <div
          style={{
            fontSize:      9.5,
            fontWeight:    700,
            color:         "#94a3b8",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            marginBottom:  8,
          }}
        >
          Lecture des statuts
        </div>
      )}

      {LEGEND_ITEMS.map((item, i) => (
        <div
          key={item.status}
          style={{
            display:    "flex",
            alignItems: "center",
            gap:        10,
            padding:    "6px 0",
            borderTop:  i > 0 ? "1px solid #f1f5f9" : "none",
          }}
        >
          <div style={{ flexShrink: 0 }}>
            <PluRuleBadge status={item.status} size="sm" showLabel />
          </div>
          <span
            style={{
              fontSize:   11,
              color:      "#64748b",
              lineHeight: 1.4,
            }}
          >
            {item.description}
          </span>
        </div>
      ))}
    </div>
  );
};

export default PluRulesLegend;