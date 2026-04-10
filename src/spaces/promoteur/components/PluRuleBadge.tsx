// src/spaces/promoteur/components/PluRuleBadge.tsx

import React from "react";
import type { PluRuleStatus } from "../plan2d/plan.plu.types";

// ─── DESIGN TOKENS ────────────────────────────────────────────────────

type BadgeToken = {
  bg: string;
  border: string;
  color: string;
  dot: string;
  label: string;
  icon: string;
};

const TOKENS: Record<PluRuleStatus, BadgeToken> = {
  CONFORME: {
    bg:     "#f0fdf4",
    border: "#86efac",
    color:  "#15803d",
    dot:    "#22c55e",
    label:  "Conforme",
    icon:   "✓",
  },
  LIMITE: {
    bg:     "#fffbeb",
    border: "#fcd34d",
    color:  "#b45309",
    dot:    "#f59e0b",
    label:  "Limite",
    icon:   "⚠",
  },
  BLOQUANT: {
    bg:     "#fef2f2",
    border: "#fca5a5",
    color:  "#b91c1c",
    dot:    "#ef4444",
    label:  "Bloquant",
    icon:   "✗",
  },
};

// ─── COMPONENT ────────────────────────────────────────────────────────

export interface PluRuleBadgeProps {
  status: PluRuleStatus;
  /** "sm" = compact pill for inline use; "md" = labelled badge for cards */
  size?: "sm" | "md";
  /** Show the text label alongside the icon (default true for md, false for sm) */
  showLabel?: boolean;
}

export const PluRuleBadge: React.FC<PluRuleBadgeProps> = ({
  status,
  size = "md",
  showLabel,
}) => {
  const t = TOKENS[status];
  const displayLabel = showLabel ?? (size === "md");

  return (
    <span
      style={{
        display:        "inline-flex",
        alignItems:     "center",
        gap:            displayLabel ? 5 : 0,
        padding:        size === "md" ? "3px 9px 3px 7px" : "2px 6px",
        borderRadius:   20,
        background:     t.bg,
        border:         `1px solid ${t.border}`,
        color:          t.color,
        fontSize:       size === "md" ? 11 : 10,
        fontWeight:     700,
        letterSpacing:  "0.04em",
        textTransform:  "uppercase",
        whiteSpace:     "nowrap",
        lineHeight:     1,
        userSelect:     "none",
      }}
      title={t.label}
    >
      {/* Status dot */}
      <span
        style={{
          display:      "inline-block",
          width:        size === "md" ? 6 : 5,
          height:       size === "md" ? 6 : 5,
          borderRadius: "50%",
          background:   t.dot,
          flexShrink:   0,
        }}
      />
      {displayLabel && t.label}
    </span>
  );
};

export default PluRuleBadge;