// src/spaces/promoteur/components/FeasibilitySummaryCard.tsx

import React from "react";
import type { PluRuleStatus } from "../plan2d/plan.plu.types";
import { PluRuleBadge } from "./PluRuleBadge";

// ─── PROPS ────────────────────────────────────────────────────────────

export interface FeasibilitySummaryCardProps {
  globalStatus:   PluRuleStatus;
  blockingIssues: string[];
  ruleCount:      number;
  limitedCount:   number;
}

// ─── CONTENT DERIVATION ───────────────────────────────────────────────

type SummaryContent = {
  recommendation: string;
  strengths:       string[];
  vigilance:       string[];
  nextAction:      string;
};

function deriveContent(
  status:       PluRuleStatus,
  blockingIssues: string[],
  ruleCount:    number,
  limitedCount: number,
): SummaryContent {
  const conformeCount = ruleCount - blockingIssues.length - limitedCount;

  switch (status) {
    case "CONFORME":
      return {
        recommendation: "Projet réglementairement recevable en l'état.",
        strengths: [
          ruleCount > 0
            ? `${conformeCount} règle${conformeCount > 1 ? "s" : ""} PLU satisfaite${conformeCount > 1 ? "s" : ""} sur ${ruleCount}`
            : "Conformité PLU vérifiée",
          "Volume et implantation compatibles avec le règlement",
          "Aucun point bloquant identifié",
        ],
        vigilance: limitedCount > 0
          ? [
              `${limitedCount} seuil${limitedCount > 1 ? "s" : ""} limite${limitedCount > 1 ? "s" : ""} à surveiller lors des ajustements`,
              "Conserver les marges réglementaires en cas de modification du programme",
            ]
          : [],
        nextAction: "Poursuivre l'étude de faisabilité financière et le bilan promoteur.",
      };

    case "LIMITE":
      return {
        recommendation: "Projet envisageable sous réserve d'ajustements ciblés.",
        strengths: [
          conformeCount > 0
            ? `${conformeCount} règle${conformeCount > 1 ? "s" : ""} satisfaite${conformeCount > 1 ? "s" : ""} — base de programme viable`
            : "Programme de base à retravailler",
          "Aucune non-conformité bloquante à ce stade",
        ],
        vigilance: [
          `${limitedCount} point${limitedCount > 1 ? "s" : ""} limite${limitedCount > 1 ? "s" : ""} nécessitant une révision avant validation`,
          "Anticiper l'impact des ajustements sur le bilan économique",
          "Valider les seuils avec le service instructeur avant dépôt",
        ],
        nextAction: "Affiner l'implantation et les volumes avant validation comité.",
      };

    case "BLOQUANT":
      return {
        recommendation: "Projet à revoir avant toute poursuite de l'étude.",
        strengths: conformeCount > 0
          ? [
              `${conformeCount} règle${conformeCount > 1 ? "s" : ""} déjà satisfaite${conformeCount > 1 ? "s" : ""} — base partielle exploitable`,
            ]
          : [],
        vigilance: [
          `${blockingIssues.length} non-conformité${blockingIssues.length > 1 ? "s" : ""} bloquante${blockingIssues.length > 1 ? "s" : ""} identifiée${blockingIssues.length > 1 ? "s" : ""}`,
          "Réviser le schéma d'implantation et les volumes",
          "Ne pas engager d'étude financière avant résolution des points bloquants",
        ],
        nextAction: "Réviser le massing et corriger les non-conformités avant comité.",
      };
  }
}

// ─── DESIGN TOKENS ────────────────────────────────────────────────────

const STATUS_ACCENT: Record<PluRuleStatus, {
  bar:     string;
  tagBg:   string;
  tagText: string;
}> = {
  CONFORME: { bar: "#22c55e", tagBg: "#f0fdf4", tagText: "#15803d" },
  LIMITE:   { bar: "#f59e0b", tagBg: "#fffbeb", tagText: "#b45309" },
  BLOQUANT: { bar: "#ef4444", tagBg: "#fef2f2", tagText: "#b91c1c" },
};

// ─── BULLET ITEM ──────────────────────────────────────────────────────

const Bullet: React.FC<{
  text:    string;
  variant: "strength" | "vigilance";
}> = ({ text, variant }) => {
  const isStrength = variant === "strength";
  return (
    <div
      style={{
        display:    "flex",
        alignItems: "flex-start",
        gap:        7,
        lineHeight: 1.45,
      }}
    >
      <span
        style={{
          flexShrink:  0,
          marginTop:   "0.15em",
          fontSize:    10,
          color:       isStrength ? "#22c55e" : "#f59e0b",
          fontWeight:  700,
          lineHeight:  1,
        }}
      >
        {isStrength ? "✓" : "—"}
      </span>
      <span
        style={{
          fontSize:  11.5,
          color:     isStrength ? "#334155" : "#64748b",
          fontWeight: isStrength ? 500 : 400,
        }}
      >
        {text}
      </span>
    </div>
  );
};

// ─── DIVIDER ──────────────────────────────────────────────────────────

const Divider: React.FC = () => (
  <div style={{ height: 1, background: "#f1f5f9", margin: "2px 0" }} />
);

// ─── COMPONENT ────────────────────────────────────────────────────────

export const FeasibilitySummaryCard: React.FC<FeasibilitySummaryCardProps> = ({
  globalStatus,
  blockingIssues,
  ruleCount,
  limitedCount,
}) => {
  const content = deriveContent(globalStatus, blockingIssues, ruleCount, limitedCount);
  const accent  = STATUS_ACCENT[globalStatus];

  return (
    <div
      style={{
        background:    "#ffffff",
        border:        "1px solid #e2e8f0",
        borderRadius:  16,
        overflow:      "hidden",
      }}
    >
      {/* Accent bar */}
      <div style={{ height: 3, background: accent.bar }} />

      {/* Header */}
      <div
        style={{
          display:        "flex",
          alignItems:     "center",
          justifyContent: "space-between",
          padding:        "12px 16px 10px",
          borderBottom:   "1px solid #f1f5f9",
        }}
      >
        <div>
          <div
            style={{
              fontSize:      9.5,
              fontWeight:    700,
              color:         "#94a3b8",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              marginBottom:  3,
            }}
          >
            Synthèse de faisabilité
          </div>
          <div
            style={{
              fontSize:      12.5,
              fontWeight:    600,
              color:         "#0f172a",
              lineHeight:    1.25,
            }}
          >
            {content.recommendation}
          </div>
        </div>
        <div style={{ flexShrink: 0, marginLeft: 12 }}>
          <PluRuleBadge status={globalStatus} size="md" />
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>

        {/* Strengths */}
        {content.strengths.length > 0 && (
          <div>
            <div
              style={{
                fontSize:      9.5,
                fontWeight:    700,
                color:         "#94a3b8",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                marginBottom:  6,
              }}
            >
              Points favorables
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {content.strengths.map((s, i) => (
                <Bullet key={i} text={s} variant="strength" />
              ))}
            </div>
          </div>
        )}

        {/* Vigilance */}
        {content.vigilance.length > 0 && (
          <>
            {content.strengths.length > 0 && <Divider />}
            <div>
              <div
                style={{
                  fontSize:      9.5,
                  fontWeight:    700,
                  color:         "#94a3b8",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  marginBottom:  6,
                }}
              >
                Points de vigilance
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {content.vigilance.map((v, i) => (
                  <Bullet key={i} text={v} variant="vigilance" />
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Next action footer */}
      <div
        style={{
          display:       "flex",
          alignItems:    "center",
          gap:           8,
          padding:       "9px 16px 11px",
          borderTop:     "1px solid #f1f5f9",
          background:    "#f8fafc",
        }}
      >
        <span
          style={{
            fontSize:   10,
            fontWeight: 700,
            color:      "#94a3b8",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            flexShrink: 0,
          }}
        >
          Prochaine étape
        </span>
        <span
          style={{
            width:      1,
            height:     10,
            background: "#e2e8f0",
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontSize:   11.5,
            color:      "#334155",
            fontWeight: 500,
            lineHeight: 1.35,
          }}
        >
          {content.nextAction}
        </span>
      </div>
    </div>
  );
};

export default FeasibilitySummaryCard;