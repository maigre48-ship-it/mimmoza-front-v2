// src/spaces/promoteur/components/ScenarioRecommendationCard.tsx

import React from "react";
import type { ImplantationScenario, ScenarioStatus } from "../plan2d/plan.scenarios.types";
import type { ScenarioRecommendationLayer } from "../plan2d/plan.scenarioNotes.types";

// ─── DESIGN TOKENS ────────────────────────────────────────────────────

const T = {
  slate900:  "#0f172a", slate700: "#334155", slate600: "#475569",
  slate500:  "#64748b", slate400: "#94a3b8", slate200: "#e2e8f0",
  slate100:  "#f1f5f9", slate50:  "#f8fafc", white:    "#ffffff",
  green700:  "#15803d", green600: "#16a34a",
  green50:   "#f0fdf4", green100: "#dcfce7",  green200: "#bbf7d0",
  amber700:  "#b45309", amber50:  "#fffbeb", amber200: "#fde68a",
  red700:    "#b91c1c", red50:    "#fef2f2", red200:   "#fecaca",
  indigo600: "#4f46e5", indigo50: "#eef2ff", indigo200: "#c7d2fe",
  violet600: "#7c3aed",
} as const;

type AccentSet = { bar: string; bg: string; border: string; titleColor: string };

const STATUS_ACCENT: Record<ScenarioStatus, AccentSet> = {
  CONFORME: { bar: "#22c55e", bg: T.green50,  border: T.green200,  titleColor: T.green700  },
  LIMITE:   { bar: "#f59e0b", bg: T.amber50,  border: T.amber200,  titleColor: T.amber700  },
  BLOQUANT: { bar: "#ef4444", bg: T.red50,    border: T.red200,    titleColor: T.red700    },
};

// ─── BULLET ITEM ──────────────────────────────────────────────────────

const Bullet: React.FC<{ text: string; variant: "strength" | "vigilance" }> = ({
  text, variant,
}) => (
  <div style={{ display: "flex", alignItems: "flex-start", gap: 7, lineHeight: 1.45 }}>
    <span style={{
      flexShrink: 0, marginTop: "0.1em", fontSize: 10, fontWeight: 700, lineHeight: 1,
      color: variant === "strength" ? "#22c55e" : "#f59e0b",
    }}>
      {variant === "strength" ? "✓" : "—"}
    </span>
    <span style={{
      fontSize: 11.5, lineHeight: 1.45,
      color:    variant === "strength" ? T.slate700 : T.slate600,
      fontWeight: variant === "strength" ? 500 : 400,
    }}>
      {text}
    </span>
  </div>
);

// ─── SECTION LABEL ────────────────────────────────────────────────────

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{
    fontSize: 9.5, fontWeight: 700, color: T.slate400,
    letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 7,
  }}>
    {children}
  </div>
);

// ─── SCORE STRIP ──────────────────────────────────────────────────────

const ScoreStrip: React.FC<{ score: number; rank?: number; recommended?: boolean }> = ({
  score, rank, recommended,
}) => {
  const color = score >= 75 ? "#22c55e" : score >= 50 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "7px 14px", background: T.slate50,
      borderBottom: `1px solid ${T.slate100}`,
    }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 2 }}>
        <span style={{ fontSize: 20, fontWeight: 800, color, fontVariantNumeric: "tabular-nums" }}>
          {score}
        </span>
        <span style={{ fontSize: 10, color: T.slate400, fontWeight: 600 }}>/ 100</span>
      </div>
      {rank !== undefined && (
        <span style={{
          fontSize: 10, fontWeight: 700,
          color: rank === 1 ? T.violet600 : T.slate500,
          background: rank === 1 ? "#f5f3ff" : T.slate100,
          border: `1px solid ${rank === 1 ? "#ddd6fe" : T.slate200}`,
          borderRadius: 20, padding: "2px 7px",
        }}>
          {rank === 1 ? "★ Rang 1" : `Rang ${rank}`}
        </span>
      )}
      {recommended && (
        <span style={{
          fontSize: 10, fontWeight: 700, color: T.green600,
          background: T.green50, border: `1px solid ${T.green200}`,
          borderRadius: 20, padding: "2px 7px",
        }}>
          ★ Recommandé
        </span>
      )}
      <span style={{ flex: 1 }} />
      <span style={{ fontSize: 10, color: T.slate400, fontStyle: "italic" }}>
        Score faisabilité V1
      </span>
    </div>
  );
};

// ─── EMPTY STATE ──────────────────────────────────────────────────────

const EmptyState: React.FC = () => (
  <div style={{
    padding: "16px 14px", background: T.slate50,
    border: `1.5px dashed ${T.slate200}`, borderRadius: 12,
    textAlign: "center",
  }}>
    <div style={{ fontSize: 18, marginBottom: 6 }}>📋</div>
    <div style={{ fontSize: 12, fontWeight: 600, color: T.slate600, marginBottom: 4 }}>
      Aucun scénario actif
    </div>
    <div style={{ fontSize: 11, color: T.slate400, lineHeight: 1.5 }}>
      Sélectionnez un scénario pour afficher son analyse détaillée.
    </div>
  </div>
);

// ─── MAIN COMPONENT ───────────────────────────────────────────────────

export interface ScenarioRecommendationCardProps {
  scenario: ImplantationScenario | null;
}

export const ScenarioRecommendationCard: React.FC<ScenarioRecommendationCardProps> = ({
  scenario,
}) => {
  return (
    <div style={{ padding: "10px 14px 16px", background: T.slate50 }}>
      {/* Section header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        paddingBottom: 8, marginBottom: 10, borderBottom: `1px solid ${T.slate200}`,
      }}>
        <div>
          <span style={{
            fontSize: 11, fontWeight: 700, color: T.slate500,
            letterSpacing: "0.06em", textTransform: "uppercase",
          }}>
            Analyse scénario actif
          </span>
          <div style={{ fontSize: 10, color: T.slate400, marginTop: 2 }}>
            {scenario ? scenario.label : "—"}
          </div>
        </div>
      </div>

      {!scenario ? (
        <EmptyState />
      ) : (
        <RecommendationContent scenario={scenario} />
      )}
    </div>
  );
};

// ─── CONTENT ─────────────────────────────────────────────────────────

const RecommendationContent: React.FC<{ scenario: ImplantationScenario }> = ({
  scenario: s,
}) => {
  const layer: ScenarioRecommendationLayer | undefined = s.recommendationLayer;
  const accent = STATUS_ACCENT[s.globalStatus];

  if (!layer) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Score strip */}
      {s.score && (
        <div style={{
          background: T.white, border: `1px solid ${T.slate200}`,
          borderRadius: 12, overflow: "hidden",
        }}>
          <ScoreStrip
            score={s.score.breakdown.overall}
            rank={s.score.rank}
            recommended={s.recommended}
          />
        </div>
      )}

      {/* Main recommendation card */}
      <div style={{
        background: T.white, border: `1px solid ${accent.border}`,
        borderRadius: 12, overflow: "hidden",
      }}>
        {/* Accent bar */}
        <div style={{ height: 3, background: accent.bar }} />

        {/* Header */}
        <div style={{
          padding: "12px 14px 10px",
          borderBottom: `1px solid ${T.slate100}`,
          background: accent.bg,
        }}>
          <div style={{
            fontSize: 9.5, fontWeight: 700, color: T.slate400,
            letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4,
          }}>
            Synthèse de faisabilité
          </div>
          <div style={{
            fontSize: 14, fontWeight: 700, color: accent.titleColor,
            lineHeight: 1.25, marginBottom: 6,
          }}>
            {layer.title}
          </div>
          <p style={{ fontSize: 12, color: T.slate700, margin: 0, lineHeight: 1.55 }}>
            {layer.summary}
          </p>
        </div>

        {/* Body */}
        <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Strengths */}
          {layer.strengths.length > 0 && (
            <div>
              <SectionLabel>Points favorables</SectionLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {layer.strengths.map((s, i) => (
                  <Bullet key={i} text={s} variant="strength" />
                ))}
              </div>
            </div>
          )}

          {/* Divider only if both sections present */}
          {layer.strengths.length > 0 && layer.vigilancePoints.length > 0 && (
            <div style={{ height: 1, background: T.slate100 }} />
          )}

          {/* Vigilance */}
          {layer.vigilancePoints.length > 0 && (
            <div>
              <SectionLabel>Points de vigilance</SectionLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {layer.vigilancePoints.map((v, i) => (
                  <Bullet key={i} text={v} variant="vigilance" />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Next action footer */}
        <div style={{
          display: "flex", alignItems: "flex-start", gap: 8,
          padding: "9px 14px 11px", borderTop: `1px solid ${T.slate100}`,
          background: T.slate50,
        }}>
          <span style={{
            fontSize: 9.5, fontWeight: 700, color: T.slate400,
            letterSpacing: "0.08em", textTransform: "uppercase", flexShrink: 0,
            marginTop: "0.15em",
          }}>
            Prochaine étape
          </span>
          <span style={{ width: 1, height: 12, background: T.slate200, flexShrink: 0, marginTop: 2 }} />
          <span style={{ fontSize: 11.5, color: T.slate700, fontWeight: 500, lineHeight: 1.45 }}>
            {layer.nextAction}
          </span>
        </div>
      </div>

      {/* Score breakdown (compact) */}
      {s.score && (
        <div style={{
          background: T.white, border: `1px solid ${T.slate200}`,
          borderRadius: 10, padding: "8px 12px",
        }}>
          <div style={{
            fontSize: 9.5, fontWeight: 700, color: T.slate400,
            letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8,
          }}>
            Détail du score
          </div>
          <div style={{ display: "flex", gap: 0 }}>
            {[
              { label: "Réglementaire",  value: s.score.breakdown.regulatory,          pct: "50 %" },
              { label: "Efficience",      value: s.score.breakdown.footprintEfficiency,  pct: "30 %" },
              { label: "Simplicité",      value: s.score.breakdown.simplicity,           pct: "20 %" },
            ].map((d, i) => {
              const c = d.value >= 75 ? T.green700 : d.value >= 50 ? T.amber700 : T.red700;
              return (
                <div key={d.label} style={{
                  flex: 1, textAlign: "center",
                  borderLeft: i > 0 ? `1px solid ${T.slate100}` : "none",
                  padding: "0 4px",
                }}>
                  <div style={{ fontSize: 9, color: T.slate400, fontWeight: 600,
                                letterSpacing: "0.05em", textTransform: "uppercase",
                                marginBottom: 3 }}>
                    {d.label}
                    <span style={{ fontWeight: 400, color: T.slate300, marginLeft: 3 }}>({d.pct})</span>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: c, fontVariantNumeric: "tabular-nums" }}>
                    {d.value}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Rationale */}
          {s.score.rationale.length > 0 && (
            <div style={{
              marginTop: 8, paddingTop: 8, borderTop: `1px solid ${T.slate100}`,
              display: "flex", flexDirection: "column", gap: 4,
            }}>
              {s.score.rationale.map((line, i) => (
                <div key={i} style={{
                  fontSize: 10.5, color: T.slate500, lineHeight: 1.45,
                  paddingLeft: 8, borderLeft: `2px solid ${T.slate200}`,
                }}>
                  {line}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Disclaimer */}
      <p style={{
        fontSize: 10, color: T.slate400, lineHeight: 1.5,
        margin: "2px 0 0", fontStyle: "italic",
      }}>
        Analyse automatisée de faisabilité V1 — à confirmer par une lecture
        réglementaire détaillée et l'avis d'un professionnel qualifié.
      </p>
    </div>
  );
};

export default ScenarioRecommendationCard;