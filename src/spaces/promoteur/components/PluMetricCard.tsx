// src/spaces/promoteur/components/PluMetricCard.tsx

import React from "react";
import type { PluRuleStatus } from "../plan2d/plan.plu.types";

// ─── TYPES ────────────────────────────────────────────────────────────

export interface PluMetricCardProps {
  label: string;
  value: string;
  /** Optional small detail shown below the value (e.g. "requis : 4 places") */
  detail?: string;
  /**
   * Optional compliance hint — tints the card border and value color.
   * Omit for neutral metrics (parcel area, footprint).
   */
  status?: PluRuleStatus | null;
  /** Icon character or emoji rendered at top-left (optional) */
  icon?: string;
}

// ─── DESIGN TOKENS ────────────────────────────────────────────────────

type StatusToken = { accent: string; valueTint: string };

const STATUS_TINT: Record<PluRuleStatus, StatusToken> = {
  CONFORME: { accent: "#22c55e", valueTint: "#15803d" },
  LIMITE:   { accent: "#f59e0b", valueTint: "#b45309" },
  BLOQUANT: { accent: "#ef4444", valueTint: "#b91c1c" },
};

// ─── COMPONENT ────────────────────────────────────────────────────────

export const PluMetricCard: React.FC<PluMetricCardProps> = ({
  label,
  value,
  detail,
  status = null,
  icon,
}) => {
  const tint    = status ? STATUS_TINT[status] : null;
  const accent  = tint?.accent ?? "#6366f1"; // indigo default for neutral
  const neutral = !status;

  return (
    <div
      style={{
        background:   "#ffffff",
        border:       `1px solid ${neutral ? "#e2e8f0" : tint!.accent + "44"}`,
        borderRadius: 12,
        padding:      "12px 14px",
        display:      "flex",
        flexDirection: "column",
        gap:          4,
        // Subtle left accent stripe via box-shadow
        boxShadow:    `inset 3px 0 0 ${neutral ? "#e2e8f0" : accent}`,
        minWidth:     0,
      }}
    >
      {/* Label row */}
      <div
        style={{
          display:     "flex",
          alignItems:  "center",
          gap:         5,
          marginBottom: 2,
        }}
      >
        {icon && (
          <span style={{ fontSize: 12, lineHeight: 1 }}>{icon}</span>
        )}
        <span
          style={{
            fontSize:      10,
            fontWeight:    600,
            color:         "#94a3b8",
            letterSpacing: "0.07em",
            textTransform: "uppercase",
            lineHeight:    1,
          }}
        >
          {label}
        </span>
      </div>

      {/* Value */}
      <span
        style={{
          fontSize:   18,
          fontWeight: 700,
          color:      tint?.valueTint ?? "#1e293b",
          lineHeight: 1.1,
          letterSpacing: "-0.01em",
        }}
      >
        {value}
      </span>

      {/* Detail */}
      {detail && (
        <span
          style={{
            fontSize:  11,
            color:     "#94a3b8",
            lineHeight: 1.3,
            marginTop:  1,
          }}
        >
          {detail}
        </span>
      )}
    </div>
  );
};

export default PluMetricCard;