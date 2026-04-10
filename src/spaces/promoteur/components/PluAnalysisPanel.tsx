// src/spaces/promoteur/components/PluAnalysisPanel.tsx

import React from "react";
import type {
  PluEngineResult,
  PluRuleStatus,
  PluRuleResult,
  PluMetricSet,
} from "../plan2d/plan.plu.types";
import { PluRuleBadge } from "./PluRuleBadge";
import { PluMetricCard } from "./PluMetricCard";
import { PluRulesLegend } from "./PluRulesLegend";
import { FeasibilitySummaryCard } from "./FeasibilitySummaryCard";
import { PluRuleExplanationDrawer } from "./PluRuleExplanationDrawer";

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
  green200:  "#bbf7d0",
  amber700:  "#b45309",
  red700:    "#b91c1c",
  red50:     "#fef2f2",
  red100:    "#fee2e2",
  red200:    "#fecaca",
  indigo600: "#4f46e5",
} as const;

const CARD: React.CSSProperties = {
  background:   T.white,
  border:       `1px solid ${T.slate200}`,
  borderRadius: 14,
  overflow:     "hidden",
};

const SECTION_LABEL: React.CSSProperties = {
  fontSize:      10,
  fontWeight:    700,
  color:         T.slate400,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
};

// ─── STATUS METADATA ──────────────────────────────────────────────────

type StatusMeta = {
  headline:  string;
  summary:   (blocking: number, limite: number, total: number) => string;
  headerBg:  string;
  accentBar: string;
  labelColor: string;
};

const STATUS_META: Record<PluRuleStatus, StatusMeta> = {
  CONFORME: {
    headline:   "Projet conforme",
    summary:    (_, _l, t) =>
      `Le projet respecte l'ensemble des ${t} règles PLU analysées.`,
    headerBg:   T.green50,
    accentBar:  "#22c55e",
    labelColor: T.green700,
  },
  LIMITE: {
    headline:   "Conformité marginale",
    summary:    (_, l, t) =>
      `Le projet est conforme, mais ${l} règle${l > 1 ? "s" : ""} sur ${t} atteignent leur seuil limite.`,
    headerBg:   "#fffbeb",
    accentBar:  "#f59e0b",
    labelColor: T.amber700,
  },
  BLOQUANT: {
    headline:   "Non conforme",
    summary:    (b, _, t) =>
      `${b} point${b > 1 ? "s" : ""} bloquant${b > 1 ? "s" : ""} identifié${b > 1 ? "s" : ""} sur ${t} règles — ajustements requis.`,
    headerBg:   T.red50,
    accentBar:  "#ef4444",
    labelColor: T.red700,
  },
};

// ─── FORMATTERS ───────────────────────────────────────────────────────

const fmtArea = (m2: number) =>
  `${Math.round(m2).toLocaleString("fr-FR")} m²`;

const fmtPct = (ratio: number) =>
  `${(ratio * 100).toFixed(1)} %`;

const fmtM = (m: number) =>
  m === Infinity || isNaN(m) ? "—" : `${m.toFixed(1)} m`;

const fmtN = (n: number) => String(Math.round(n));

// ─── GLOBAL STATUS HEADER ─────────────────────────────────────────────

const GlobalStatusHeader: React.FC<{ result: PluEngineResult }> = ({
  result,
}) => {
  const { globalStatus, rules } = result;
  const meta     = STATUS_META[globalStatus];
  const blocking = rules.filter(r => r.status === "BLOQUANT").length;
  const limite   = rules.filter(r => r.status === "LIMITE").length;
  const total    = rules.length;

  return (
    <div
      style={{
        ...CARD,
        background: meta.headerBg,
        border:     `1px solid ${meta.accentBar}33`,
      }}
    >
      {/* Accent top bar */}
      <div style={{ height: 3, background: meta.accentBar }} />

      <div style={{ padding: "16px 18px 18px" }}>
        {/* Top row: label + badge */}
        <div
          style={{
            display:        "flex",
            alignItems:     "flex-start",
            justifyContent: "space-between",
            gap:            12,
            marginBottom:   10,
          }}
        >
          <div>
            <div
              style={{
                fontSize:      10,
                fontWeight:    700,
                color:         T.slate400,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                marginBottom:  4,
              }}
            >
              PLU · Faisabilité réglementaire
            </div>
            <div
              style={{
                fontSize:      17,
                fontWeight:    700,
                color:         meta.labelColor,
                lineHeight:    1.2,
                letterSpacing: "-0.01em",
              }}
            >
              {meta.headline}
            </div>
          </div>
          <PluRuleBadge status={globalStatus} size="md" />
        </div>

        {/* Summary sentence */}
        <p
          style={{
            fontSize:    12.5,
            color:       T.slate700,
            lineHeight:  1.55,
            margin:      "0 0 14px",
          }}
        >
          {meta.summary(blocking, limite, total)}
        </p>

        {/* Stats row */}
        <div
          style={{
            display:       "flex",
            gap:           0,
            borderTop:     `1px solid ${meta.accentBar}22`,
            paddingTop:    12,
          }}
        >
          {[
            { value: fmtN(total),    label: "Règles analysées" },
            { value: fmtN(blocking), label: "Points bloquants", highlight: blocking > 0 },
            { value: fmtN(limite),   label: "Points limites",   highlight: limite > 0 && blocking === 0 },
          ].map((stat, i) => (
            <div
              key={stat.label}
              style={{
                flex:        1,
                textAlign:   "center",
                borderLeft:  i > 0 ? `1px solid ${meta.accentBar}22` : "none",
              }}
            >
              <div
                style={{
                  fontSize:   20,
                  fontWeight: 800,
                  color:      stat.highlight ? meta.labelColor : T.slate900,
                  lineHeight: 1,
                  marginBottom: 3,
                }}
              >
                {stat.value}
              </div>
              <div
                style={{
                  fontSize:  10,
                  color:     T.slate400,
                  fontWeight: 500,
                  letterSpacing: "0.04em",
                }}
              >
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ─── KPI GRID ─────────────────────────────────────────────────────────

/**
 * Determines the compliance status to pass to a metric card.
 * Returns null for purely informational metrics that have no direct rule.
 */
function metricStatus(
  rules: PluRuleResult[],
  ruleKey: string,
): PluRuleStatus | null {
  return rules.find(r => r.key === ruleKey)?.status ?? null;
}

const KpiGrid: React.FC<{ metrics: PluMetricSet; rules: PluRuleResult[] }> = ({
  metrics,
  rules,
}) => {
  const parkingDetail =
    metrics.requiredParkingSpaces > 0
      ? `requis : ${fmtN(metrics.requiredParkingSpaces)} places`
      : "aucune obligation";

  const cards: React.ComponentProps<typeof PluMetricCard>[] = [
    {
      label:  "Surface parcelle",
      value:  fmtArea(metrics.parcelAreaM2),
      icon:   "▭",
    },
    {
      label:  "Emprise bâtie",
      value:  fmtArea(metrics.footprintAreaM2),
      icon:   "⬛",
    },
    {
      label:  "CES",
      value:  fmtPct(metrics.coverageRatio),
      detail: `limite : ${fmtPct(rules.find(r => r.key === "coverage")?.limit ?? 0)}`,
      status: metricStatus(rules, "coverage"),
      icon:   "%",
    },
    {
      label:  "Hauteur max.",
      value:  fmtM(metrics.estimatedHeightM),
      detail: `plafond : ${fmtM(rules.find(r => r.key === "height")?.limit ?? 0)}`,
      status: metricStatus(rules, "height"),
      icon:   "↑",
    },
    {
      label:  "Recul min.",
      value:  fmtM(metrics.minDistanceToParcelEdgeM),
      detail: `seuil : ${fmtM(rules.find(r => r.key === "setback")?.limit ?? 0)}`,
      status: metricStatus(rules, "setback"),
      icon:   "↔",
    },
    {
      label:  "Stationnement",
      value:  `${fmtN(metrics.providedParkingSpaces)} places`,
      detail: parkingDetail,
      status: metricStatus(rules, "parking"),
      icon:   "P",
    },
  ];

  return (
    <div>
      <div style={{ ...SECTION_LABEL, marginBottom: 10, paddingLeft: 2 }}>
        Indicateurs clés
      </div>
      <div
        style={{
          display:             "grid",
          gridTemplateColumns: "1fr 1fr",
          gap:                 8,
        }}
      >
        {cards.map(card => (
          <PluMetricCard key={card.label} {...card} />
        ))}
      </div>
    </div>
  );
};

// ─── RULE ROW ─────────────────────────────────────────────────────────

const RULE_BORDER: Record<PluRuleStatus, string> = {
  CONFORME: "#22c55e",
  LIMITE:   "#f59e0b",
  BLOQUANT: "#ef4444",
};

const RuleRow: React.FC<{
  rule:      PluRuleResult;
  isLast:    boolean;
  onClick:   () => void;
  isActive:  boolean;
}> = ({ rule, isLast, onClick, isActive }) => {
  const accentColor = RULE_BORDER[rule.status];

  const hasValues = rule.value != null && rule.limit != null;
  let comparisonLine: string | null = null;
  if (hasValues) {
    const fmt = (v: number) =>
      rule.unit === "%" ? `${(v * 100).toFixed(1)} %`
      : rule.unit === "places" ? `${Math.round(v)} places`
      : `${v.toFixed(1)} ${rule.unit ?? ""}`;
    comparisonLine = `Valeur : ${fmt(rule.value!)} · Seuil : ${fmt(rule.limit!)}`;
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") onClick(); }}
      style={{
        display:      "flex",
        alignItems:   "center",
        gap:          12,
        padding:      "13px 14px 13px 16px",
        borderBottom: isLast ? "none" : `1px solid ${T.slate100}`,
        boxShadow:    `inset 3px 0 0 ${accentColor}`,
        background:   isActive ? `${accentColor}08` : T.white,
        cursor:       "pointer",
        outline:      "none",
        transition:   "background 0.12s",
      }}
    >
      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display:     "flex",
            alignItems:  "center",
            gap:         8,
            marginBottom: comparisonLine || rule.message ? 4 : 0,
          }}
        >
          <span
            style={{
              fontSize:   12.5,
              fontWeight: 600,
              color:      T.slate900,
              flex:       1,
              lineHeight: 1.2,
            }}
          >
            {rule.label}
          </span>
          <PluRuleBadge status={rule.status} size="sm" showLabel />
        </div>

        <p
          style={{
            fontSize:   11.5,
            color:      T.slate500,
            margin:     0,
            lineHeight: 1.45,
          }}
        >
          {rule.message}
        </p>

        {comparisonLine && (
          <div
            style={{
              marginTop:  5,
              fontSize:   10.5,
              color:      T.slate400,
              fontWeight: 500,
              letterSpacing: "0.02em",
            }}
          >
            {comparisonLine}
          </div>
        )}
      </div>

      {/* Chevron affordance */}
      <span
        style={{
          fontSize:   14,
          color:      isActive ? accentColor : T.slate400,
          flexShrink: 0,
          fontWeight: isActive ? 700 : 400,
          lineHeight: 1,
        }}
      >
        ›
      </span>
    </div>
  );
};

// ─── RULES SECTION ────────────────────────────────────────────────────

const RULE_SORT_ORDER: Record<PluRuleStatus, number> = {
  BLOQUANT: 0,
  LIMITE:   1,
  CONFORME: 2,
};

const RulesSection: React.FC<{ rules: PluRuleResult[] }> = ({ rules }) => {
  const [selectedRule, setSelectedRule] = React.useState<PluRuleResult | null>(null);

  if (!rules.length) return null;

  const sorted = [...rules].sort(
    (a, b) => RULE_SORT_ORDER[a.status] - RULE_SORT_ORDER[b.status],
  );

  return (
    <>
      <div>
        <div style={{ ...SECTION_LABEL, marginBottom: 10, paddingLeft: 2 }}>
          Analyse des règles PLU
          <span
            style={{
              fontWeight:    500,
              textTransform: "none",
              letterSpacing: 0,
              color:         "#94a3b8",
              fontSize:      9,
              marginLeft:    6,
            }}
          >
            — cliquer pour le détail
          </span>
        </div>
        <div style={{ ...CARD }}>
          {sorted.map((rule, i) => (
            <RuleRow
              key={rule.key}
              rule={rule}
              isLast={i === sorted.length - 1}
              isActive={selectedRule?.key === rule.key}
              onClick={() =>
                setSelectedRule(prev => (prev?.key === rule.key ? null : rule))
              }
            />
          ))}
        </div>
      </div>

      <PluRuleExplanationDrawer
        open={selectedRule !== null}
        onClose={() => setSelectedRule(null)}
        rule={selectedRule}
      />
    </>
  );
};

// ─── ALERTS SECTION ───────────────────────────────────────────────────

const AlertsSection: React.FC<{
  blockingIssues: string[];
  globalStatus: PluRuleStatus;
}> = ({ blockingIssues, globalStatus }) => {
  if (globalStatus === "CONFORME") {
    return (
      <div
        style={{
          ...CARD,
          background: T.green50,
          border:     `1px solid ${T.green200}`,
        }}
      >
        <div
          style={{
            padding:    "13px 16px",
            display:    "flex",
            alignItems: "center",
            gap:        10,
          }}
        >
          <div
            style={{
              width:        28,
              height:       28,
              borderRadius: "50%",
              background:   "#22c55e",
              display:      "flex",
              alignItems:   "center",
              justifyContent: "center",
              fontSize:     13,
              color:        T.white,
              fontWeight:   700,
              flexShrink:   0,
            }}
          >
            ✓
          </div>
          <div>
            <div
              style={{
                fontSize:   12.5,
                fontWeight: 600,
                color:      T.green700,
                marginBottom: 2,
              }}
            >
              Aucun point bloquant
            </div>
            <div style={{ fontSize: 11.5, color: "#166534" }}>
              Le projet est éligible à l'instruction PLU en l'état.
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!blockingIssues.length) return null;

  return (
    <div
      style={{
        ...CARD,
        background: T.red50,
        border:     `1px solid ${T.red200}`,
      }}
    >
      {/* Header */}
      <div
        style={{
          padding:       "12px 16px 10px",
          borderBottom:  `1px solid ${T.red100}`,
          display:       "flex",
          alignItems:    "center",
          gap:           8,
        }}
      >
        <div
          style={{
            width:        22,
            height:       22,
            borderRadius: "50%",
            background:   "#ef4444",
            display:      "flex",
            alignItems:   "center",
            justifyContent: "center",
            fontSize:     11,
            color:        T.white,
            fontWeight:   700,
            flexShrink:   0,
          }}
        >
          {blockingIssues.length}
        </div>
        <span
          style={{
            fontSize:      11,
            fontWeight:    700,
            color:         T.red700,
            textTransform: "uppercase",
            letterSpacing: "0.07em",
          }}
        >
          Point{blockingIssues.length > 1 ? "s" : ""} bloquant{blockingIssues.length > 1 ? "s" : ""}
        </span>
      </div>

      {/* Issue list */}
      <ul
        style={{
          margin:     0,
          padding:    "10px 16px 12px 28px",
          listStyle:  "disc",
        }}
      >
        {blockingIssues.map((issue, i) => (
          <li
            key={i}
            style={{
              fontSize:    12,
              color:       "#7f1d1d",
              lineHeight:  1.55,
              marginBottom: i < blockingIssues.length - 1 ? 5 : 0,
            }}
          >
            {issue}
          </li>
        ))}
      </ul>
    </div>
  );
};

// ─── EMPTY STATE ──────────────────────────────────────────────────────

const EmptyState: React.FC = () => (
  <div
    style={{
      ...CARD,
      textAlign:  "center",
      padding:    "32px 20px",
      background: T.slate50,
      border:     `1.5px dashed ${T.slate200}`,
    }}
  >
    <div
      style={{
        width:          44,
        height:         44,
        borderRadius:   12,
        background:     T.slate100,
        display:        "flex",
        alignItems:     "center",
        justifyContent: "center",
        margin:         "0 auto 12px",
        fontSize:       20,
      }}
    >
      📐
    </div>
    <div
      style={{
        fontSize:    13,
        fontWeight:  600,
        color:       T.slate700,
        marginBottom: 6,
      }}
    >
      Aucune analyse disponible
    </div>
    <div
      style={{
        fontSize:   12,
        color:      T.slate400,
        lineHeight: 1.55,
        maxWidth:   240,
        margin:     "0 auto",
      }}
    >
      Définissez une parcelle et placez des bâtiments pour démarrer l'évaluation PLU.
    </div>
  </div>
);

// ─── MAIN PANEL ───────────────────────────────────────────────────────

export interface PluAnalysisPanelProps {
  result: PluEngineResult | null;
}

export const PluAnalysisPanel: React.FC<PluAnalysisPanelProps> = ({
  result,
}) => {
  return (
    <div
      style={{
        padding:    "12px 14px 20px",
        background: T.slate50,
        display:    "flex",
        flexDirection: "column",
        gap:        14,
        minHeight:  "100%",
      }}
    >
      {/* Section label */}
      <div
        style={{
          display:        "flex",
          alignItems:     "center",
          justifyContent: "space-between",
          paddingBottom:  2,
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
          Analyse PLU
        </span>
        {result && (
          <span style={{ fontSize: 10.5, color: T.slate400 }}>
            {result.rules.length} règle{result.rules.length > 1 ? "s" : ""}
          </span>
        )}
      </div>

      {!result ? (
        <EmptyState />
      ) : (
        <>
          <FeasibilitySummaryCard
            globalStatus={result.globalStatus}
            blockingIssues={result.blockingIssues}
            ruleCount={result.rules.length}
            limitedCount={result.rules.filter(r => r.status === "LIMITE").length}
          />
          <GlobalStatusHeader result={result} />
          <PluRulesLegend />
          <KpiGrid metrics={result.metrics} rules={result.rules} />
          <RulesSection rules={result.rules} />
          <AlertsSection
            blockingIssues={result.blockingIssues}
            globalStatus={result.globalStatus}
          />
        </>
      )}
    </div>
  );
};

export default PluAnalysisPanel;