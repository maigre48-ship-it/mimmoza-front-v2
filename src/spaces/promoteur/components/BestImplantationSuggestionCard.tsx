// src/spaces/promoteur/components/BestImplantationSuggestionCard.tsx

import React from "react";
import type { BestImplantationSuggestion, SuggestionConfidence } from "../plan2d/plan.bestSuggestion.types";
import type { ImplantationScenario } from "../plan2d/plan.scenarios.types";

// ─── DESIGN TOKENS ────────────────────────────────────────────────────

const T = {
  slate900:  "#0f172a", slate700: "#334155", slate600: "#475569",
  slate500:  "#64748b", slate400: "#94a3b8", slate200: "#e2e8f0",
  slate100:  "#f1f5f9", slate50:  "#f8fafc", white:    "#ffffff",
  green700:  "#15803d", green50:  "#f0fdf4", green100: "#dcfce7", green200: "#bbf7d0",
  amber700:  "#b45309", amber50:  "#fffbeb", amber200: "#fde68a",
  red700:    "#b91c1c",
  indigo600: "#4f46e5", indigo50: "#eef2ff", indigo200: "#c7d2fe",
  violet700: "#6d28d9", violet50: "#f5f3ff", violet200: "#ddd6fe",
} as const;

// ─── CONFIDENCE TOKEN ─────────────────────────────────────────────────

type ConfToken = { bar: string; bg: string; border: string; chipBg: string; chipBorder: string; chipColor: string; titleColor: string; label: string; icon: string };

const CONF_TOKEN: Record<SuggestionConfidence, ConfToken> = {
  SOLIDE: {
    bar: "#22c55e", bg: T.green50, border: T.green200,
    chipBg: T.green50, chipBorder: T.green200, chipColor: T.green700,
    titleColor: T.green700, label: "Solide", icon: "●",
  },
  MODERE: {
    bar: "#f59e0b", bg: T.amber50, border: T.amber200,
    chipBg: T.amber50, chipBorder: T.amber200, chipColor: T.amber700,
    titleColor: T.amber700, label: "Modéré", icon: "◐",
  },
  PRUDENT: {
    bar: "#94a3b8", bg: T.slate50, border: T.slate200,
    chipBg: T.slate100, chipBorder: T.slate200, chipColor: T.slate600,
    titleColor: T.slate700, label: "Prudent", icon: "○",
  },
};

// ─── SUB-COMPONENTS ───────────────────────────────────────────────────

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{
    fontSize: 9.5, fontWeight: 700, color: T.slate400,
    letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 7,
  }}>
    {children}
  </div>
);

const Bullet: React.FC<{ text: string; variant: "reason" | "vigilance" }> = ({ text, variant }) => (
  <div style={{ display: "flex", alignItems: "flex-start", gap: 7, lineHeight: 1.45, marginBottom: 4 }}>
    <span style={{
      flexShrink: 0, marginTop: "0.1em", fontSize: 10,
      color: variant === "reason" ? "#22c55e" : "#f59e0b",
      fontWeight: 700, lineHeight: 1,
    }}>
      {variant === "reason" ? "✓" : "—"}
    </span>
    <span style={{ fontSize: 11.5, color: variant === "reason" ? T.slate700 : T.slate600, lineHeight: 1.45 }}>
      {text}
    </span>
  </div>
);

// ─── EMPTY STATE ──────────────────────────────────────────────────────

const EmptyState: React.FC = () => (
  <div style={{
    background: T.slate50, border: `1.5px dashed ${T.slate200}`,
    borderRadius: 12, padding: "20px 16px", textAlign: "center",
  }}>
    <div style={{ fontSize: 20, marginBottom: 8 }}>🎯</div>
    <div style={{ fontSize: 12, fontWeight: 600, color: T.slate700, marginBottom: 4 }}>
      Aucune suggestion disponible
    </div>
    <div style={{ fontSize: 11, color: T.slate400, lineHeight: 1.5 }}>
      Définissez des scénarios pour générer une suggestion d'implantation.
    </div>
  </div>
);

// ─── MAIN COMPONENT ───────────────────────────────────────────────────

export interface BestImplantationSuggestionCardProps {
  suggestion:         BestImplantationSuggestion | null;
  scenarios?:         ImplantationScenario[];
  onSelectScenario?:  (scenarioId: string) => void;
}

export const BestImplantationSuggestionCard: React.FC<BestImplantationSuggestionCardProps> = ({
  suggestion, scenarios = [], onSelectScenario,
}) => {
  return (
    <div style={{ padding: "10px 14px 18px", background: T.slate50 }}>
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
            Meilleure implantation suggérée
          </span>
          <div style={{ fontSize: 10, color: T.slate400, marginTop: 2 }}>
            Analyse comparative transparente · V1
          </div>
        </div>
      </div>

      {!suggestion ? (
        <EmptyState />
      ) : (
        <SuggestionContent
          suggestion={suggestion}
          scenarios={scenarios}
          onSelectScenario={onSelectScenario}
        />
      )}
    </div>
  );
};

// ─── CONTENT ─────────────────────────────────────────────────────────

const SuggestionContent: React.FC<{
  suggestion:        BestImplantationSuggestion;
  scenarios:         ImplantationScenario[];
  onSelectScenario?: (id: string) => void;
}> = ({ suggestion: sg, scenarios, onSelectScenario }) => {
  const token = CONF_TOKEN[sg.confidenceLabel];
  const suggestedScenario = sg.scenarioId
    ? scenarios.find(s => s.id === sg.scenarioId)
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

      {/* ── Main card ── */}
      <div style={{
        background: T.white,
        border: `1px solid ${token.border}`,
        borderRadius: 14, overflow: "hidden",
      }}>
        {/* Accent bar */}
        <div style={{ height: 3, background: token.bar }} />

        {/* Header */}
        <div style={{
          padding: "12px 14px 10px",
          background: token.bg,
          borderBottom: `1px solid ${token.border}`,
        }}>
          <div style={{ display: "flex", alignItems: "flex-start",
                        justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
            <div style={{ flex: 1 }}>
              <div style={{
                fontSize: 9.5, fontWeight: 700, color: T.slate400,
                letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4,
              }}>
                Suggestion d'implantation
              </div>
              <div style={{
                fontSize: 13, fontWeight: 700, color: token.titleColor, lineHeight: 1.25,
              }}>
                {sg.title}
              </div>
            </div>

            {/* Confidence chip */}
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              padding: "3px 9px", borderRadius: 20, flexShrink: 0,
              background: token.chipBg, border: `1px solid ${token.chipBorder}`,
              color: token.chipColor, fontSize: 10, fontWeight: 700,
              letterSpacing: "0.05em", textTransform: "uppercase", userSelect: "none",
            }}>
              <span style={{ fontSize: 10 }}>{token.icon}</span>
              Confiance {token.label}
            </span>
          </div>

          <p style={{ fontSize: 12, color: T.slate700, margin: 0, lineHeight: 1.55 }}>
            {sg.summary}
          </p>
        </div>

        {/* Suggested scenario strip */}
        {suggestedScenario && (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "8px 14px", borderBottom: `1px solid ${T.slate100}`,
            background: T.slate50, gap: 10,
          }}>
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: T.slate400,
                            letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 2 }}>
                Variante suggérée
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: T.slate900 }}>
                {suggestedScenario.label}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              {suggestedScenario.score && (
                <span style={{
                  fontSize: 13, fontWeight: 800, fontVariantNumeric: "tabular-nums",
                  color: suggestedScenario.score.breakdown.overall >= 72 ? T.green700
                        : suggestedScenario.score.breakdown.overall >= 45 ? T.amber700 : T.red700,
                }}>
                  {suggestedScenario.score.breakdown.overall}
                  <span style={{ fontSize: 9, fontWeight: 600, marginLeft: 1 }}>/100</span>
                </span>
              )}
              {onSelectScenario && (
                <button
                  onClick={() => onSelectScenario(suggestedScenario.id)}
                  style={{
                    padding: "5px 12px", borderRadius: 7, border: `1px solid ${T.indigo600}`,
                    background: T.indigo50, color: T.indigo600, fontSize: 11,
                    fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
                  }}>
                  Activer →
                </button>
              )}
            </div>
          </div>
        )}

        {/* Body */}
        <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Key reasons */}
          {sg.keyReasons.length > 0 && (
            <div>
              <SectionLabel>Facteurs déterminants</SectionLabel>
              {sg.keyReasons.map((r, i) => <Bullet key={i} text={r} variant="reason" />)}
            </div>
          )}

          {/* Divider */}
          {sg.keyReasons.length > 0 && sg.vigilancePoints.length > 0 && (
            <div style={{ height: 1, background: T.slate100 }} />
          )}

          {/* Vigilance */}
          {sg.vigilancePoints.length > 0 && (
            <div>
              <SectionLabel>Points de vigilance</SectionLabel>
              {sg.vigilancePoints.map((v, i) => <Bullet key={i} text={v} variant="vigilance" />)}
            </div>
          )}
        </div>

        {/* Next action footer */}
        <div style={{
          display: "flex", alignItems: "flex-start", gap: 8,
          padding: "9px 14px 11px",
          borderTop: `1px solid ${T.slate100}`, background: T.slate50,
        }}>
          <span style={{
            fontSize: 9, fontWeight: 700, color: T.slate400,
            letterSpacing: "0.08em", textTransform: "uppercase",
            flexShrink: 0, marginTop: "0.2em",
          }}>
            Prochaine étape
          </span>
          <span style={{ width: 1, height: 11, background: T.slate200, flexShrink: 0, marginTop: 2 }} />
          <span style={{ fontSize: 11.5, color: T.slate700, fontWeight: 500, lineHeight: 1.45 }}>
            {sg.nextAction}
          </span>
        </div>
      </div>

      {/* Disclaimer */}
      <p style={{ fontSize: 10, color: T.slate400, lineHeight: 1.5, margin: 0, fontStyle: "italic" }}>
        Suggestion algorithmique à visée indicative — lecture à confirmer dans le bilan promoteur détaillé
        et par une instruction réglementaire appropriée.
      </p>
    </div>
  );
};

export default BestImplantationSuggestionCard;