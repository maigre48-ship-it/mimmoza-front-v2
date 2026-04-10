// src/spaces/promoteur/components/ZoningLegend.tsx

import React from "react";
import type { ZoningOverlayKind } from "../plan2d/plan.zoning.types";
import { getDefaultZoningStyle } from "../plan2d/plan.zoning";

// ─── LEGEND METADATA ──────────────────────────────────────────────────

type LegendEntry = {
  kind:        ZoningOverlayKind;
  label:       string;
  description: string;
};

const ALL_ENTRIES: LegendEntry[] = [
  {
    kind:        "buildable",
    label:       "Zone constructible",
    description: "Emprise bâtissable selon le PLU",
  },
  {
    kind:        "non_buildable",
    label:       "Zone non constructible",
    description: "Interdite à toute construction",
  },
  {
    kind:        "street_setback",
    label:       "Recul sur rue",
    description: "Marge de reculement par rapport à la voie",
  },
  {
    kind:        "green_space",
    label:       "Espace vert / pleine terre",
    description: "Espace planté ou non imperméabilisé",
  },
  {
    kind:        "servitude",
    label:       "Servitude",
    description: "Contrainte d'utilité publique (SUP)",
  },
  {
    kind:        "attention_zone",
    label:       "Zone d'attention",
    description: "Vigilance particulière requise",
  },
];

// ─── SWATCH ───────────────────────────────────────────────────────────

/**
 * A small SVG swatch that visually matches the canvas overlay polygon —
 * same fill colour, stroke colour, and dash pattern.
 *
 * Fill opacity is amplified relative to the canvas value (where fills
 * are intentionally faint) so the swatch reads clearly at 24×14 px.
 */
const Swatch: React.FC<{ kind: ZoningOverlayKind }> = ({ kind }) => {
  const s = getDefaultZoningStyle(kind);
  const swatchOpacity = Math.min(s.fillOpacity * 4.5, 0.65);
  const dashArray     = s.dashArray === "none" ? undefined : s.dashArray;

  return (
    <svg
      width={24}
      height={14}
      viewBox="0 0 24 14"
      style={{ flexShrink: 0, display: "block" }}
    >
      <rect
        x={0.75}
        y={0.75}
        width={22.5}
        height={12.5}
        rx={2.5}
        fill={s.fill}
        fillOpacity={swatchOpacity}
        stroke={s.stroke}
        strokeWidth={Math.min(s.strokeWidth, 1.25)}
        strokeDasharray={dashArray}
      />
    </svg>
  );
};

// ─── COMPONENT ────────────────────────────────────────────────────────

export interface ZoningLegendProps {
  /**
   * Which overlay kinds to display.
   * Pass the kinds actually present in the current canvas for a filtered view.
   * Omit (or pass undefined) to show all defined kinds.
   */
  kinds?: ZoningOverlayKind[];
  /**
   * When true, the per-item description is hidden.
   * Useful for very compact embedding.
   */
  compact?: boolean;
}

export const ZoningLegend: React.FC<ZoningLegendProps> = ({
  kinds,
  compact = false,
}) => {
  const entries =
    kinds && kinds.length > 0
      ? ALL_ENTRIES.filter(e => kinds.includes(e.kind))
      : ALL_ENTRIES;

  if (!entries.length) return null;

  return (
    <div
      style={{
        background:   "rgba(255,255,255,0.93)",
        border:       "1px solid #e2e8f0",
        borderRadius: 10,
        boxShadow:    "0 2px 12px rgba(15,23,42,0.08)",
        padding:      "9px 12px 10px",
        minWidth:     172,
        maxWidth:     220,
        backdropFilter: "blur(6px)",
      }}
    >
      {/* Header */}
      <div
        style={{
          fontSize:      9,
          fontWeight:    700,
          color:         "#94a3b8",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          marginBottom:  8,
          paddingBottom: 6,
          borderBottom:  "1px solid #f1f5f9",
        }}
      >
        Légende zonage
      </div>

      {/* Entries */}
      <div style={{ display: "flex", flexDirection: "column", gap: compact ? 5 : 6 }}>
        {entries.map(entry => (
          <div
            key={entry.kind}
            style={{
              display:    "flex",
              alignItems: compact ? "center" : "flex-start",
              gap:        8,
            }}
          >
            {/* Swatch */}
            <div style={{ paddingTop: compact ? 0 : 1, flexShrink: 0 }}>
              <Swatch kind={entry.kind} />
            </div>

            {/* Text */}
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize:   11,
                  fontWeight: 600,
                  color:      "#334155",
                  lineHeight: 1.2,
                  whiteSpace: "nowrap",
                }}
              >
                {entry.label}
              </div>
              {!compact && (
                <div
                  style={{
                    fontSize:   9.5,
                    color:      "#94a3b8",
                    lineHeight: 1.35,
                    marginTop:  2,
                  }}
                >
                  {entry.description}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ZoningLegend;