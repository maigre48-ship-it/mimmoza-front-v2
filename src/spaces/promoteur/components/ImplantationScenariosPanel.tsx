// src/spaces/promoteur/components/ImplantationScenariosPanel.tsx

import React from "react";
import type { ImplantationScenario, ScenarioStatus } from "../plan2d/plan.scenarios.types";

// ─── DESIGN TOKENS ────────────────────────────────────────────────────

const T = {
  slate900:  "#0f172a", slate700: "#334155", slate600: "#475569",
  slate500:  "#64748b", slate400: "#94a3b8", slate300: "#cbd5e1",
  slate200:  "#e2e8f0", slate100: "#f1f5f9", slate50:  "#f8fafc",
  white:     "#ffffff",
  green700:  "#15803d", green600: "#16a34a", green50: "#f0fdf4",  green100: "#dcfce7", green200: "#bbf7d0",
  amber700:  "#b45309", amber50: "#fffbeb",  amber100: "#fef3c7", amber200: "#fde68a",
  red700:    "#b91c1c", red50:   "#fef2f2",  red100:   "#fee2e2",
  indigo600: "#4f46e5", indigo50: "#eef2ff", indigo200: "#c7d2fe",
  violet600: "#7c3aed", violet50: "#f5f3ff",
} as const;

const STATUS_TOKEN: Record<ScenarioStatus, { dot: string; label: string; color: string; bg: string; border: string; bar: string }> = {
  CONFORME: { dot: "#22c55e", label: "Conforme",  color: T.green700, bg: T.green50,  border: T.green200,  bar: "#22c55e" },
  LIMITE:   { dot: "#f59e0b", label: "Limite",    color: T.amber700, bg: T.amber50,  border: T.amber200,  bar: "#f59e0b" },
  BLOQUANT: { dot: "#ef4444", label: "Bloquant",  color: T.red700,   bg: T.red50,    border: T.red100,    bar: "#ef4444" },
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

// ─── SCORE GAUGE ──────────────────────────────────────────────────────

const ScoreGauge: React.FC<{ score: number; size?: "sm" | "md" }> = ({ score, size = "md" }) => {
  const r         = score >= 75 ? "#22c55e" : score >= 50 ? "#f59e0b" : "#ef4444";
  const diameter  = size === "md" ? 44 : 32;
  const fontSize  = size === "md" ? 13 : 10;
  const thickness = size === "md" ? 4 : 3;
  const radius    = (diameter - thickness * 2) / 2;
  const circ      = 2 * Math.PI * radius;
  const dash      = (score / 100) * circ;

  return (
    <div style={{ position: "relative", width: diameter, height: diameter, flexShrink: 0 }}>
      <svg width={diameter} height={diameter} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={diameter / 2} cy={diameter / 2} r={radius}
          fill="none" stroke={T.slate100} strokeWidth={thickness} />
        <circle cx={diameter / 2} cy={diameter / 2} r={radius}
          fill="none" stroke={r} strokeWidth={thickness}
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeLinecap="round" />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center",
                    justifyContent: "center" }}>
        <span style={{ fontSize, fontWeight: 800, color: r, lineHeight: 1 }}>{score}</span>
      </div>
    </div>
  );
};

// ─── SCENARIO CARD ────────────────────────────────────────────────────

const ScenarioCard: React.FC<{
  scenario: ImplantationScenario; isActive: boolean; onClick: () => void;
}> = ({ scenario: s, isActive, onClick }) => {
  const st = STATUS_TOKEN[s.globalStatus];

  return (
    <button onClick={onClick} style={{ display: "block", width: "100%", textAlign: "left",
      background: T.white, border: isActive ? `1.5px solid ${T.indigo600}` : `1px solid ${T.slate200}`,
      borderRadius: 12, overflow: "hidden", cursor: "pointer", padding: 0,
      boxShadow: isActive ? `0 0 0 3px ${T.indigo200}` : "none", transition: "box-shadow 0.12s" }}>
      <div style={{ height: 3, background: st.bar }} />
      <div style={{ padding: "10px 12px 12px" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between",
                      gap: 8, marginBottom: 7 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4, flexWrap: "wrap" }}>
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
                  ★ Recommandé
                </span>
              )}
              {s.score?.rank === 1 && (
                <span style={{ fontSize: 9, fontWeight: 700, color: T.violet600, background: T.violet50,
                               border: `1px solid #ddd6fe`, borderRadius: 20, padding: "1px 5px",
                               letterSpacing: "0.06em", textTransform: "uppercase", userSelect: "none" }}>
                  #1 Score
                </span>
              )}
            </div>
            <div style={{ fontWeight: isActive ? 700 : 600, color: T.slate900, fontSize: 12, lineHeight: 1.2 }}>
              {s.label}
            </div>
            {s.description && (
              <div style={{ fontSize: 10, color: T.slate400, marginTop: 2, lineHeight: 1.4 }}>
                {s.description.length > 60 ? s.description.slice(0, 57) + "…" : s.description}
              </div>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <StatusBadge status={s.globalStatus} />
            {s.score && <ScoreGauge score={s.score.breakdown.overall} size="sm" />}
          </div>
        </div>

        {/* Metrics */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, marginBottom: 9 }}>
          {[
            { label: "Emprise",   value: fmtArea(s.metrics.totalFootprintM2) },
            { label: "CES",       value: fmtPct(s.metrics.coverageRatio) },
            { label: "Bâtiments", value: fmtN(s.metrics.buildingCount) },
          ].map(item => (
            <div key={item.label} style={{ background: T.slate50, border: `1px solid ${T.slate100}`,
                                          borderRadius: 7, padding: "5px 7px", textAlign: "center" }}>
              <div style={{ fontSize: 9, color: T.slate400, fontWeight: 600, letterSpacing: "0.07em",
                            textTransform: "uppercase", marginBottom: 2 }}>{item.label}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: T.slate900, fontVariantNumeric: "tabular-nums" }}>
                {item.value}
              </div>
            </div>
          ))}
        </div>

        {/* Score breakdown (if available) */}
        {s.score && (
          <div style={{ marginBottom: 9, background: T.slate50, borderRadius: 8,
                        padding: "7px 10px", display: "flex", gap: 10 }}>
            {[
              { label: "Régl.", value: s.score.breakdown.regulatory },
              { label: "Foncier", value: s.score.breakdown.footprintEfficiency },
              { label: "Simplicité", value: s.score.breakdown.simplicity },
            ].map(d => {
              const c = d.value >= 75 ? T.green700 : d.value >= 50 ? T.amber700 : T.red700;
              return (
                <div key={d.label} style={{ flex: 1, textAlign: "center" }}>
                  <div style={{ fontSize: 9, color: T.slate400, fontWeight: 600,
                                letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 2 }}>
                    {d.label}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: c, fontVariantNumeric: "tabular-nums" }}>
                    {d.value}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* First rationale bullet (if available) */}
        {s.score?.rationale[0] && (
          <div style={{ fontSize: 10.5, color: T.slate500, lineHeight: 1.45, marginBottom: 8,
                        borderLeft: `2px solid ${T.slate200}`, paddingLeft: 8 }}>
            {s.score.rationale[0]}
          </div>
        )}

        {/* Recommendation */}
        <div style={{ padding: "7px 10px", background: st.bg, borderRadius: 7,
                      borderLeft: `3px solid ${st.bar}` }}>
          <p style={{ fontSize: 11, color: st.color, margin: 0, lineHeight: 1.45, fontWeight: 500 }}>
            {s.recommendation}
          </p>
        </div>
      </div>
    </button>
  );
};

const EmptyState: React.FC = () => (
  <div style={{ background: T.slate50, border: `1.5px dashed ${T.slate200}`, borderRadius: 12,
                padding: "20px 16px", textAlign: "center" }}>
    <div style={{ fontSize: 20, marginBottom: 8 }}>🏗</div>
    <div style={{ fontSize: 12, fontWeight: 600, color: T.slate700, marginBottom: 4 }}>
      Aucun scénario disponible
    </div>
    <div style={{ fontSize: 11, color: T.slate400, lineHeight: 1.5 }}>
      Positionnez des bâtiments sur le plan masse pour générer une comparaison.
    </div>
  </div>
);

// ─── PANEL ────────────────────────────────────────────────────────────

export interface ImplantationScenariosPanelProps {
  scenarios:         ImplantationScenario[];
  activeScenarioId?: string | null;
  onSelectScenario?: (scenarioId: string) => void;
}

export const ImplantationScenariosPanel: React.FC<ImplantationScenariosPanelProps> = ({
  scenarios, activeScenarioId = null, onSelectScenario,
}) => (
  <div style={{ padding: "10px 14px 18px", background: T.slate50 }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                  paddingBottom: 8, marginBottom: 12, borderBottom: `1px solid ${T.slate200}` }}>
      <div>
        <span style={{ fontSize: 11, fontWeight: 700, color: T.slate500,
                       letterSpacing: "0.06em", textTransform: "uppercase" }}>
          Scénarios d'implantation
        </span>
        <div style={{ fontSize: 10, color: T.slate400, marginTop: 2 }}>
          Comparaison de variantes · scores 0–100
        </div>
      </div>
      {scenarios.length > 0 && (
        <span style={{ fontSize: 10, color: T.slate400, fontWeight: 500 }}>
          {scenarios.length} variante{scenarios.length > 1 ? "s" : ""}
        </span>
      )}
    </div>
    {scenarios.length === 0 ? (
      <EmptyState />
    ) : (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {scenarios.map(s => (
          <ScenarioCard key={s.id} scenario={s}
            isActive={s.id === activeScenarioId}
            onClick={() => onSelectScenario?.(s.id)} />
        ))}
      </div>
    )}
  </div>
);

export default ImplantationScenariosPanel;