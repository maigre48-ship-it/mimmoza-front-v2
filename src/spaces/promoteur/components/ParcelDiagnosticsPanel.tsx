// src/spaces/promoteur/components/ParcelDiagnosticsPanel.tsx

import React from "react";
import type { ParcelDiagnostics } from "../plan2d/plan.parcelDiagnostics";

// ─── FORMATTERS ───────────────────────────────────────────────────────

const fmtArea = (m2: number) =>
  `${Math.round(m2).toLocaleString("fr-FR")} m²`;

const fmtPct = (ratio: number) =>
  `${(ratio * 100).toFixed(1)} %`;

const fmtM = (m: number) =>
  `${m.toFixed(1)} m`;

const fmtN = (n: number) =>
  String(Math.round(n));

// ─── DESIGN TOKENS ────────────────────────────────────────────────────

const T = {
  slate900:  "#0f172a",
  slate700:  "#334155",
  slate500:  "#64748b",
  slate400:  "#94a3b8",
  slate200:  "#e2e8f0",
  slate100:  "#f1f5f9",
  slate50:   "#f8fafc",
  white:     "#ffffff",
  green700:  "#15803d",
  green50:   "#f0fdf4",
  amber700:  "#b45309",
  amber50:   "#fffbeb",
  red700:    "#b91c1c",
  red50:     "#fef2f2",
  red100:    "#fee2e2",
  red200:    "#fecaca",
  indigo500: "#6366f1",
} as const;

// ─── SIGNAL COLOUR ────────────────────────────────────────────────────

function signalColor(d: ParcelDiagnostics): {
  bar: string; bg: string; textColor: string;
} {
  if (d.buildingCount === 0) {
    return { bar: T.slate400, bg: T.slate50, textColor: T.slate500 };
  }
  if (d.buildingsOutsideEnvelopeCount > 0) {
    return { bar: "#ef4444", bg: T.red50, textColor: T.red700 };
  }
  if (d.vigilancePoints.length > 0) {
    return { bar: "#f59e0b", bg: T.amber50, textColor: T.amber700 };
  }
  return { bar: "#22c55e", bg: T.green50, textColor: T.green700 };
}

// ─── METRIC ROW ───────────────────────────────────────────────────────

const MetricRow: React.FC<{
  label:     string;
  value:     string;
  isLast?:   boolean;
  accent?:   string;
}> = ({ label, value, isLast, accent }) => (
  <div
    style={{
      display:        "flex",
      justifyContent: "space-between",
      alignItems:     "center",
      padding:        "6px 0",
      borderBottom:   isLast ? "none" : `1px solid ${T.slate100}`,
    }}
  >
    <span style={{ fontSize: 11.5, color: T.slate500, fontWeight: 500 }}>
      {label}
    </span>
    <span
      style={{
        fontSize:           12,
        fontWeight:         700,
        color:              accent ?? T.slate900,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {value}
    </span>
  </div>
);

// ─── EMPTY STATE ──────────────────────────────────────────────────────

const EmptyState: React.FC = () => (
  <div
    style={{
      background:   T.slate50,
      border:       `1.5px dashed ${T.slate200}`,
      borderRadius: 12,
      padding:      "20px 16px",
      textAlign:    "center",
    }}
  >
    <div style={{ fontSize: 20, marginBottom: 8 }}>🗺</div>
    <div style={{ fontSize: 12, fontWeight: 600, color: T.slate700, marginBottom: 4 }}>
      Aucune donnée parcellaire
    </div>
    <div style={{ fontSize: 11, color: T.slate400, lineHeight: 1.5 }}>
      Définissez une parcelle pour afficher le diagnostic spatial.
    </div>
  </div>
);

// ─── MAIN COMPONENT ───────────────────────────────────────────────────

export interface ParcelDiagnosticsPanelProps {
  diagnostics: ParcelDiagnostics | null;
}

export const ParcelDiagnosticsPanel: React.FC<ParcelDiagnosticsPanelProps> = ({
  diagnostics,
}) => {
  return (
    <div style={{ padding: "10px 14px 16px", background: T.slate50 }}>

      {/* ── Section header ── */}
      <div
        style={{
          display:        "flex",
          alignItems:     "center",
          justifyContent: "space-between",
          paddingBottom:  8,
          marginBottom:   10,
          borderBottom:   `1px solid ${T.slate200}`,
        }}
      >
        <span
          style={{
            fontSize:      11,
            fontWeight:    700,
            color:         T.slate500,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          Diagnostic parcellaire
        </span>
      </div>

      {!diagnostics ? (
        <EmptyState />
      ) : (
        <DiagnosticsContent diagnostics={diagnostics} />
      )}
    </div>
  );
};

// ─── CONTENT ─────────────────────────────────────────────────────────

const DiagnosticsContent: React.FC<{ diagnostics: ParcelDiagnostics }> = ({
  diagnostics: d,
}) => {
  const signal = signalColor(d);

  // Build envelope compliance label
  const envelopeLabel = (() => {
    if (d.buildingCount === 0) return "—";
    const total = d.buildingsInsideEnvelopeCount + d.buildingsOutsideEnvelopeCount;
    if (total === 0) return "—";
    return `${fmtN(d.buildingsInsideEnvelopeCount)} / ${fmtN(total)}`;
  })();
  const envelopeAccent = d.buildingsOutsideEnvelopeCount > 0 ? T.red700
    : d.buildingCount > 0 ? T.green700
    : undefined;

  const coverageAccent = d.coverageRatio > 0.70 ? T.red700
    : d.coverageRatio > 0.55 ? T.amber700
    : undefined;

  const setbackAccent = d.minObservedSetbackM !== undefined && d.minObservedSetbackM < 3.5
    ? T.amber700
    : undefined;

  return (
    <>
      {/* ── Status card ── */}
      <div
        style={{
          background:   signal.bg,
          border:       `1px solid ${signal.bar}33`,
          borderRadius: 12,
          overflow:     "hidden",
          marginBottom: 10,
        }}
      >
        <div style={{ height: 3, background: signal.bar }} />
        <div style={{ padding: "10px 14px 12px" }}>
          <div
            style={{
              fontSize:      9.5,
              fontWeight:    700,
              color:         T.slate400,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              marginBottom:  4,
            }}
          >
            Synthèse implantation
          </div>
          <p
            style={{
              fontSize:   12.5,
              fontWeight: 600,
              color:      signal.textColor,
              lineHeight: 1.4,
              margin:     0,
            }}
          >
            {d.diagnosticSummary}
          </p>
        </div>
      </div>

      {/* ── Metrics card ── */}
      <div
        style={{
          background:   T.white,
          border:       `1px solid ${T.slate200}`,
          borderRadius: 12,
          padding:      "4px 14px 6px",
          marginBottom: 10,
        }}
      >
        <MetricRow
          label="Surface parcelle"
          value={fmtArea(d.parcelAreaM2)}
        />
        <MetricRow
          label="Sommets parcelle"
          value={fmtN(d.parcelVertexCount)}
        />
        <MetricRow
          label="Nombre de bâtiments"
          value={fmtN(d.buildingCount)}
        />
        <MetricRow
          label="Emprise bâtie totale"
          value={d.buildingCount > 0 ? fmtArea(d.totalFootprintM2) : "—"}
        />
        <MetricRow
          label="Taux d'emprise"
          value={d.buildingCount > 0 ? fmtPct(d.coverageRatio) : "—"}
          accent={coverageAccent}
        />
        {d.buildableEnvelopeAreaM2 !== undefined && (
          <MetricRow
            label="Enveloppe constructible"
            value={fmtArea(d.buildableEnvelopeAreaM2)}
          />
        )}
        {d.envelopeUsageRatio !== undefined && (
          <MetricRow
            label="Usage enveloppe"
            value={d.buildingCount > 0 ? fmtPct(d.envelopeUsageRatio) : "—"}
            accent={d.envelopeUsageRatio > 0.85 ? T.amber700 : undefined}
          />
        )}
        <MetricRow
          label="Bâtiments conformes / total"
          value={envelopeLabel}
          accent={envelopeAccent}
        />
        <MetricRow
          label="Recul min. observé"
          value={d.minObservedSetbackM !== undefined ? fmtM(d.minObservedSetbackM) : "—"}
          accent={setbackAccent}
          isLast
        />
      </div>

      {/* ── Vigilance section ── */}
      {d.vigilancePoints.length > 0 && (
        <div
          style={{
            background:   "#fffbeb",
            border:       "1px solid #fde68a",
            borderRadius: 12,
            overflow:     "hidden",
          }}
        >
          <div
            style={{
              padding:     "9px 14px 8px",
              borderBottom: "1px solid #fef3c7",
              display:     "flex",
              alignItems:  "center",
              gap:         7,
            }}
          >
            <span style={{ fontSize: 13 }}>⚠</span>
            <span
              style={{
                fontSize:      10,
                fontWeight:    700,
                color:         T.amber700,
                textTransform: "uppercase",
                letterSpacing: "0.07em",
              }}
            >
              Points de vigilance
            </span>
          </div>
          <ul
            style={{
              margin:     0,
              padding:    "8px 14px 10px 24px",
              listStyle:  "disc",
            }}
          >
            {d.vigilancePoints.map((pt, i) => (
              <li
                key={i}
                style={{
                  fontSize:    11.5,
                  color:       "#78350f",
                  lineHeight:  1.5,
                  marginBottom: i < d.vigilancePoints.length - 1 ? 4 : 0,
                }}
              >
                {pt}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Reassurance when no vigilance */}
      {d.vigilancePoints.length === 0 && d.buildingCount > 0 && (
        <div
          style={{
            display:    "flex",
            alignItems: "center",
            gap:        8,
            padding:    "8px 12px",
            background: T.green50,
            border:     `1px solid #bbf7d0`,
            borderRadius: 10,
          }}
        >
          <span style={{ fontSize: 13, flexShrink: 0 }}>✓</span>
          <span style={{ fontSize: 11.5, color: T.green700, fontWeight: 500 }}>
            Aucun point de vigilance identifié.
          </span>
        </div>
      )}
    </>
  );
};

export default ParcelDiagnosticsPanel;