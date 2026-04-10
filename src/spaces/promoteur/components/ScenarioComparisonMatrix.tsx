// src/spaces/promoteur/components/ScenarioComparisonMatrix.tsx

import React from "react";
import type { ImplantationScenario, ScenarioStatus } from "../plan2d/plan.scenarios.types";

// ─── DESIGN TOKENS ────────────────────────────────────────────────────

const T = {
  slate900: "#0f172a", slate700: "#334155", slate600: "#475569",
  slate500: "#64748b", slate400: "#94a3b8", slate200: "#e2e8f0",
  slate100: "#f1f5f9", slate50:  "#f8fafc", white:    "#ffffff",
  green700: "#15803d", green600: "#16a34a", green50: "#f0fdf4", green100: "#dcfce7",
  amber700: "#b45309", amber50: "#fffbeb",  amber100: "#fef3c7",
  red700:   "#b91c1c", red50:   "#fef2f2",  red100:   "#fee2e2",
  indigo600: "#4f46e5", indigo50: "#eef2ff", indigo200: "#c7d2fe",
  violet600: "#7c3aed", violet50: "#f5f3ff",
} as const;

type StatusToken = { dot: string; label: string; color: string; bg: string; border: string };

const STATUS_TOKEN: Record<ScenarioStatus, StatusToken> = {
  CONFORME: { dot: "#22c55e", label: "Conforme",  color: T.green700, bg: T.green50,  border: T.green100  },
  LIMITE:   { dot: "#f59e0b", label: "Limite",    color: T.amber700, bg: T.amber50,  border: T.amber100  },
  BLOQUANT: { dot: "#ef4444", label: "Bloquant",  color: T.red700,   bg: T.red50,    border: T.red100    },
};

const fmtArea = (m2: number) => `${Math.round(m2).toLocaleString("fr-FR")} m²`;
const fmtPct  = (r: number)  => `${(r * 100).toFixed(1)} %`;
const fmtN    = (n: number)  => String(Math.round(n));

const StatusBadge: React.FC<{ status: ScenarioStatus }> = ({ status }) => {
  const t = STATUS_TOKEN[status];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 7px",
                   borderRadius: 20, background: t.bg, border: `1px solid ${t.border}`,
                   color: t.color, fontSize: 10, fontWeight: 700, letterSpacing: "0.04em",
                   textTransform: "uppercase", whiteSpace: "nowrap", userSelect: "none" }}>
      <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: "50%",
                     background: t.dot, flexShrink: 0 }} />
      {t.label}
    </span>
  );
};

// ─── MINI SCORE CHIP ──────────────────────────────────────────────────

const ScoreChip: React.FC<{ score: number; rank?: number }> = ({ score, rank }) => {
  const color = score >= 75 ? T.green700 : score >= 50 ? T.amber700 : T.red700;
  const bg    = score >= 75 ? T.green50  : score >= 50 ? T.amber50  : T.red50;
  const bdr   = score >= 75 ? T.green100 : score >= 50 ? T.amber100 : T.red100;
  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
      <span style={{ display: "inline-flex", alignItems: "baseline", gap: 2, padding: "2px 7px",
                     borderRadius: 20, background: bg, border: `1px solid ${bdr}`,
                     color, fontVariantNumeric: "tabular-nums" }}>
        <span style={{ fontSize: 13, fontWeight: 800 }}>{score}</span>
        <span style={{ fontSize: 9, fontWeight: 600, color }}>/ 100</span>
      </span>
      {rank !== undefined && (
        <span style={{ fontSize: 9, fontWeight: 700, color: rank === 1 ? T.violet600 : T.slate400 }}>
          {rank === 1 ? "★ #1" : `#${rank}`}
        </span>
      )}
    </div>
  );
};

// ─── COLUMN DEFINITIONS ───────────────────────────────────────────────

type ColDef = {
  key:    string;
  header: string;
  width?: number | string;
  align?: "left" | "center" | "right";
  render: (s: ImplantationScenario, isActive: boolean) => React.ReactNode;
};

const COLUMNS: ColDef[] = [
  {
    key: "scenario", header: "Scénario", width: "21%", align: "left",
    render: (s, isActive) => (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3, flexWrap: "wrap" }}>
          {isActive && (
            <span style={{ fontSize: 9, fontWeight: 700, color: T.indigo600, background: T.indigo50,
                           border: `1px solid ${T.indigo200}`, borderRadius: 20, padding: "1px 5px",
                           letterSpacing: "0.06em", textTransform: "uppercase", userSelect: "none" }}>
              ● Actif
            </span>
          )}
          {s.recommended && (
            <span style={{ fontSize: 9, fontWeight: 700, color: T.green600, background: T.green50,
                           border: `1px solid ${T.green100}`, borderRadius: 20, padding: "1px 5px",
                           letterSpacing: "0.06em", textTransform: "uppercase", userSelect: "none" }}>
              ★ Rec.
            </span>
          )}
        </div>
        <div style={{ fontWeight: isActive ? 700 : 600, color: T.slate900, fontSize: 12, lineHeight: 1.2 }}>
          {s.label}
        </div>
        {s.description && (
          <div style={{ fontSize: 10, color: T.slate400, marginTop: 2, lineHeight: 1.35 }}>
            {s.description.length > 50 ? s.description.slice(0, 47) + "…" : s.description}
          </div>
        )}
      </div>
    ),
  },
  {
    key: "status", header: "Statut", width: "10%", align: "center",
    render: (s) => <StatusBadge status={s.globalStatus} />,
  },
  {
    key: "score", header: "Score", width: "10%", align: "center",
    render: (s) => s.score
      ? <ScoreChip score={s.score.breakdown.overall} rank={s.score.rank} />
      : <span style={{ color: T.slate300, fontSize: 10 }}>—</span>,
  },
  {
    key: "regulatory", header: "Régl.", width: "7%", align: "center",
    render: (s) => {
      const v = s.score?.breakdown.regulatory;
      if (v === undefined) return <span style={{ color: T.slate300, fontSize: 10 }}>—</span>;
      const c = v >= 75 ? T.green700 : v >= 50 ? T.amber700 : T.red700;
      return <span style={{ fontWeight: 700, color: c, fontSize: 12, fontVariantNumeric: "tabular-nums" }}>{v}</span>;
    },
  },
  {
    key: "footprint", header: "Emprise", width: "10%", align: "right",
    render: (s) => (
      <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, fontSize: 11.5 }}>
        {fmtArea(s.metrics.totalFootprintM2)}
      </span>
    ),
  },
  {
    key: "ces", header: "CES", width: "8%", align: "right",
    render: (s) => {
      const pct    = s.metrics.coverageRatio;
      const accent = pct > 0.70 ? T.red700 : pct > 0.55 ? T.amber700 : T.slate700;
      return <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, color: accent, fontSize: 11.5 }}>{fmtPct(pct)}</span>;
    },
  },
  {
    key: "buildings", header: "Bât.", width: "5%", align: "center",
    render: (s) => <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, fontSize: 11.5 }}>{fmtN(s.metrics.buildingCount)}</span>,
  },
  {
    key: "blocking", header: "Bloc.", width: "5%", align: "center",
    render: (s) => {
      const n = s.metrics.blockingCount;
      return <span style={{ fontWeight: 700, color: n > 0 ? T.red700 : T.slate400, fontVariantNumeric: "tabular-nums", fontSize: 11.5 }}>{fmtN(n)}</span>;
    },
  },
  {
    key: "limited", header: "Lim.", width: "5%", align: "center",
    render: (s) => {
      const n = s.metrics.limitedCount;
      return <span style={{ fontWeight: 700, color: n > 0 ? T.amber700 : T.slate400, fontVariantNumeric: "tabular-nums", fontSize: 11.5 }}>{fmtN(n)}</span>;
    },
  },
  {
    key: "recommendation", header: "Recommandation", width: "19%", align: "left",
    render: (s) => (
      <span style={{ fontSize: 10.5, color: T.slate600, lineHeight: 1.4, display: "block" }}>
        {s.recommendation}
      </span>
    ),
  },
];

// ─── COMPONENT ────────────────────────────────────────────────────────

export interface ScenarioComparisonMatrixProps {
  scenarios:         ImplantationScenario[];
  activeScenarioId?: string | null;
  onSelectScenario?: (scenarioId: string) => void;
}

export const ScenarioComparisonMatrix: React.FC<ScenarioComparisonMatrixProps> = ({
  scenarios, activeScenarioId = null, onSelectScenario,
}) => {
  if (!scenarios.length) return null;

  const hCell = (align: "left" | "center" | "right" = "left"): React.CSSProperties => ({
    padding: "8px 12px", textAlign: align, fontSize: 9.5, fontWeight: 700, color: T.slate400,
    letterSpacing: "0.1em", textTransform: "uppercase", borderBottom: `1px solid ${T.slate200}`,
    whiteSpace: "nowrap", background: T.slate50,
  });

  const dCell = (align: "left" | "center" | "right" = "left", isActive = false): React.CSSProperties => ({
    padding: "10px 12px", textAlign: align, verticalAlign: "middle",
    fontSize: 11.5, color: isActive ? T.slate900 : T.slate700, lineHeight: 1.35,
  });

  return (
    <div style={{ padding: "10px 14px 18px", background: T.slate50 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                    paddingBottom: 8, marginBottom: 12, borderBottom: `1px solid ${T.slate200}` }}>
        <div>
          <span style={{ fontSize: 11, fontWeight: 700, color: T.slate500,
                         letterSpacing: "0.06em", textTransform: "uppercase" }}>
            Matrice de comparaison
          </span>
          <div style={{ fontSize: 10, color: T.slate400, marginTop: 2 }}>
            {scenarios.length} variante{scenarios.length > 1 ? "s" : ""} · cliquer pour activer
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 10, color: T.slate500 }}>
            <span style={{ color: T.indigo600, fontWeight: 700 }}>●</span> Actif
          </span>
          <span style={{ fontSize: 10, color: T.slate500 }}>
            <span style={{ color: T.green600, fontWeight: 700 }}>★</span> Recommandé
          </span>
        </div>
      </div>

      {/* Matrix */}
      <div style={{ background: T.white, border: `1px solid ${T.slate200}`, borderRadius: 12, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", minWidth: 680 }}>
            <colgroup>
              {COLUMNS.map(c => <col key={c.key} style={{ width: c.width }} />)}
            </colgroup>
            <thead>
              <tr>{COLUMNS.map(c => <th key={c.key} style={hCell(c.align ?? "left")}>{c.header}</th>)}</tr>
            </thead>
            <tbody>
              {scenarios.map((s, rowIdx) => {
                const isActive = s.id === activeScenarioId;
                const isLast   = rowIdx === scenarios.length - 1;
                return (
                  <tr key={s.id} onClick={() => onSelectScenario?.(s.id)}
                    style={{ background: isActive ? T.indigo50 : T.white,
                             cursor: onSelectScenario ? "pointer" : "default",
                             borderLeft: isActive ? `3px solid ${T.indigo600}` : "3px solid transparent",
                             transition: "background 0.1s" }}
                    onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLTableRowElement).style.background = T.slate50; }}
                    onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLTableRowElement).style.background = T.white; }}
                  >
                    {COLUMNS.map(c => (
                      <td key={c.key} style={{ ...dCell(c.align ?? "left", isActive),
                        borderBottom: isLast ? "none" : `1px solid ${T.slate100}` }}>
                        {c.render(s, isActive)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div style={{ padding: "7px 14px", borderTop: `1px solid ${T.slate100}`, background: T.slate50 }}>
          <span style={{ fontSize: 10, color: T.slate400, fontStyle: "italic" }}>
            Score 0–100 : réglementaire (50 %) + efficience foncière (30 %) + simplicité (20 %).
            Aide à la priorisation — ne constitue pas un avis réglementaire.
          </span>
        </div>
      </div>
    </div>
  );
};

export default ScenarioComparisonMatrix;