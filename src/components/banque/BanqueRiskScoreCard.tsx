// ============================================
// BanqueRiskScoreCard.tsx
// ============================================
// Composant réutilisable — Scoring Banque Risques
// Usage : <BanqueRiskScoreCard scoring={data} />
// Aucune dépendance store global.
// ============================================

import React, { useState } from "react";
import {
  Landmark,
  TrendingUp,
  ChevronDown,
  ChevronUp,
  Loader2,
} from "lucide-react";

// ============================================
// TYPES (exportés pour réutilisation)
// ============================================

export type BankRiskScoringGrade = "A" | "B" | "C" | "D" | "E";
export type BankRiskScoringItemSeverity = "low" | "moderate" | "high" | "critical" | "unknown";

export interface BankRiskScoringItem {
  key: string;
  label: string;
  severity: BankRiskScoringItemSeverity;
  score_impact: number;
  confidence: number;
}

export interface BankRiskScoring {
  score: number;
  grade: BankRiskScoringGrade;
  level_label: string;
  confidence: number; // 0..1
  rationale: string[];
  items: BankRiskScoringItem[];
}

export interface BanqueRiskScoreCardProps {
  scoring: BankRiskScoring;
  /** Affiche un skeleton/loader au lieu du contenu */
  isLoading?: boolean;
  /** Libellé source affiché dans le badge (défaut: "banque-risques-v1") */
  sourceLabel?: string;
}

// ============================================
// HELPERS (internes, pas d'export)
// ============================================

const gradeColorMap: Record<BankRiskScoringGrade, string> = {
  A: "#047857",
  B: "#059669",
  C: "#d97706",
  D: "#dc2626",
  E: "#991b1b",
};

const gradeBgMap: Record<BankRiskScoringGrade, string> = {
  A: "#ecfdf5",
  B: "#dcfce7",
  C: "#fef3c7",
  D: "#fee2e2",
  E: "#fef2f2",
};

const severityColorMap: Record<BankRiskScoringItemSeverity, string> = {
  low: "#059669",
  moderate: "#d97706",
  high: "#dc2626",
  critical: "#991b1b",
  unknown: "#94a3b8",
};

// ============================================
// LOADING PLACEHOLDER
// ============================================

export const BanqueRiskScoreCardLoading: React.FC<{ sourceLabel?: string }> = ({
  sourceLabel = "banque-risques-v1",
}) => (
  <div
    style={{
      background: "white",
      borderRadius: "16px",
      padding: "20px 28px",
      marginBottom: "24px",
      boxShadow: "0 4px 20px rgba(0,0,0,0.04)",
      border: "1px solid #cbd5e1",
      borderLeft: "5px solid #94a3b8",
      display: "flex",
      alignItems: "center",
      gap: "16px",
    }}
  >
    <Loader2
      size={24}
      color="#64748b"
      style={{ animation: "spin 1s linear infinite" }}
    />
    <div>
      <div style={{ fontSize: "14px", fontWeight: 600, color: "#475569" }}>
        Scoring Banque en cours…
      </div>
      <div style={{ fontSize: "12px", color: "#94a3b8" }}>
        Appel {sourceLabel}
      </div>
    </div>
  </div>
);

// ============================================
// MAIN COMPONENT
// ============================================

export const BanqueRiskScoreCard: React.FC<BanqueRiskScoreCardProps> = ({
  scoring,
  isLoading = false,
  sourceLabel = "banque-risques-v1",
}) => {
  const [showItems, setShowItems] = useState(false);

  // ── Loading state ──
  if (isLoading) {
    return <BanqueRiskScoreCardLoading sourceLabel={sourceLabel} />;
  }

  const gradeColor = gradeColorMap[scoring.grade];
  const gradeBg = gradeBgMap[scoring.grade];
  const confidencePct = Math.round(scoring.confidence * 100);

  return (
    <div
      style={{
        background: "white",
        borderRadius: "16px",
        padding: "24px 28px",
        marginBottom: "24px",
        boxShadow: "0 4px 20px rgba(0,0,0,0.04)",
        border: "1px solid #cbd5e1",
        borderLeft: `5px solid ${gradeColor}`,
      }}
    >
      {/* ── Row: icon + title + score + grade + confidence ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "20px",
          flexWrap: "wrap",
        }}
      >
        {/* Icon */}
        <div
          style={{
            width: "48px",
            height: "48px",
            borderRadius: "12px",
            background: gradeBg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Landmark size={24} color={gradeColor} />
        </div>

        {/* Title + level_label */}
        <div style={{ flex: 1, minWidth: "180px" }}>
          <div
            style={{
              fontSize: "16px",
              fontWeight: 700,
              color: "#1e293b",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            Scoring Banque
            <span
              style={{
                fontSize: "10px",
                fontWeight: 600,
                padding: "2px 8px",
                background: "#e0e7ff",
                color: "#3730a3",
                borderRadius: "4px",
              }}
            >
              {sourceLabel}
            </span>
          </div>
          <div style={{ fontSize: "13px", color: "#64748b", marginTop: "2px" }}>
            {scoring.level_label}
          </div>
        </div>

        {/* Score */}
        <div style={{ textAlign: "center", minWidth: "80px" }}>
          <div
            style={{
              fontSize: "32px",
              fontWeight: 800,
              color: gradeColor,
              lineHeight: 1,
            }}
          >
            {scoring.score}
          </div>
          <div style={{ fontSize: "11px", color: "#94a3b8" }}>/ 100</div>
        </div>

        {/* Grade badge */}
        <div
          style={{
            width: "52px",
            height: "52px",
            borderRadius: "12px",
            background: gradeBg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: "26px", fontWeight: 800, color: gradeColor }}>
            {scoring.grade}
          </span>
        </div>

        {/* Confidence */}
        <div style={{ textAlign: "center", minWidth: "90px" }}>
          <div
            style={{ fontSize: "11px", color: "#64748b", marginBottom: "4px" }}
          >
            Confiance
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <div
              style={{
                height: "6px",
                width: "60px",
                background: "#e2e8f0",
                borderRadius: "3px",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${confidencePct}%`,
                  background:
                    confidencePct >= 70
                      ? "#059669"
                      : confidencePct >= 40
                        ? "#d97706"
                        : "#dc2626",
                  borderRadius: "3px",
                  transition: "width 0.6s ease-out",
                }}
              />
            </div>
            <span
              style={{ fontSize: "13px", fontWeight: 700, color: "#1e293b" }}
            >
              {confidencePct}%
            </span>
          </div>
        </div>
      </div>

      {/* ── Rationale (top 3) ── */}
      {scoring.rationale.length > 0 && (
        <div
          style={{
            marginTop: "16px",
            paddingTop: "14px",
            borderTop: "1px solid #f1f5f9",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
          }}
        >
          {scoring.rationale.slice(0, 3).map((reason, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "8px",
              }}
            >
              <TrendingUp
                size={14}
                color={gradeColor}
                style={{ flexShrink: 0, marginTop: "3px" }}
              />
              <span
                style={{ fontSize: "13px", color: "#334155", lineHeight: 1.5 }}
              >
                {reason}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── Expandable items detail ── */}
      {scoring.items.length > 0 && (
        <div style={{ marginTop: "12px" }}>
          <button
            onClick={() => setShowItems(!showItems)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: "12px",
              fontWeight: 600,
              color: "#64748b",
              padding: "4px 0",
            }}
          >
            {showItems ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {showItems ? "Masquer" : "Voir"} les {scoring.items.length} critères
          </button>
          {showItems && (
            <div
              style={{
                marginTop: "8px",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
              }}
            >
              {scoring.items.map((item, i) => {
                const sevColor = severityColorMap[item.severity] ?? "#94a3b8";
                return (
                  <div
                    key={item.key || i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "10px 14px",
                      background: "#f8fafc",
                      borderRadius: "8px",
                      borderLeft: `3px solid ${sevColor}`,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        flex: 1,
                      }}
                    >
                      <span
                        style={{
                          fontSize: "13px",
                          color: "#1e293b",
                          fontWeight: 500,
                        }}
                      >
                        {item.label}
                      </span>
                      <span
                        style={{
                          fontSize: "10px",
                          fontWeight: 600,
                          padding: "2px 8px",
                          borderRadius: "4px",
                          background: sevColor + "18",
                          color: sevColor,
                          textTransform: "uppercase",
                        }}
                      >
                        {item.severity}
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                      }}
                    >
                      <span style={{ fontSize: "12px", color: "#64748b" }}>
                        impact:{" "}
                        <strong style={{ color: sevColor }}>
                          {item.score_impact > 0 ? "+" : ""}
                          {item.score_impact}
                        </strong>
                      </span>
                      <span style={{ fontSize: "11px", color: "#94a3b8" }}>
                        ({Math.round(item.confidence * 100)}%)
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default BanqueRiskScoreCard;