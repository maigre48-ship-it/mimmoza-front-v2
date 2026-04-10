// src/spaces/promoteur/components/FinancialBridgePanel.tsx

import React from "react";
import type {
  FinancialBridgeResult,
  FinancialBridgeAssumptions,
} from "../plan2d/plan.financialBridge.types";

// ─── TOKENS ───────────────────────────────────────────────────────────

const T = {
  slate900: "#0f172a", slate700: "#334155", slate600: "#475569",
  slate500: "#64748b", slate400: "#94a3b8", slate200: "#e2e8f0",
  slate100: "#f1f5f9", slate50:  "#f8fafc", white:    "#ffffff",
  green700: "#15803d", green50:  "#f0fdf4", green100: "#dcfce7", green200: "#bbf7d0",
  amber700: "#b45309", amber50:  "#fffbeb", amber200: "#fde68a",
  red700:   "#b91c1c", red50:    "#fef2f2", red200:   "#fecaca",
  indigo600: "#4f46e5", indigo50: "#eef2ff", indigo200: "#c7d2fe",
} as const;

// ─── FORMATTERS ───────────────────────────────────────────────────────

const fmtArea = (m2: number) =>
  `${Math.round(m2).toLocaleString("fr-FR")} m²`;

const fmtEuro = (v: number) => {
  const abs = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)} M€`;
  if (abs >= 1_000)     return `${sign}${Math.round(abs / 1000)} k€`;
  return `${sign}${Math.round(abs).toLocaleString("fr-FR")} €`;
};

const fmtPct = (r: number) => `${(r * 100).toFixed(1)} %`;
const fmtN   = (n: number) => String(Math.round(n));
const fmtK   = (v: number) => `${Math.round(v / 1000)} €/m²`;

// ─── MARGIN SIGNAL ────────────────────────────────────────────────────

function marginSignal(pct: number): {
  color: string; bg: string; border: string; bar: string;
} {
  if (pct >= 0.12) return { color: T.green700, bg: T.green50,  border: T.green200,  bar: "#22c55e" };
  if (pct >= 0.06) return { color: T.amber700, bg: T.amber50,  border: T.amber200,  bar: "#f59e0b" };
  return               { color: T.red700,   bg: T.red50,    border: T.red200,    bar: "#ef4444" };
}

// ─── SHARED COMPONENTS ────────────────────────────────────────────────

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{
    fontSize: 9.5, fontWeight: 700, color: T.slate400,
    letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8,
  }}>
    {children}
  </div>
);

const MetricRow: React.FC<{
  label:    string;
  value:    string;
  accent?:  string;
  isLast?:  boolean;
}> = ({ label, value, accent, isLast }) => (
  <div style={{
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "5px 0",
    borderBottom: isLast ? "none" : `1px solid ${T.slate100}`,
  }}>
    <span style={{ fontSize: 11.5, color: T.slate500, fontWeight: 500 }}>{label}</span>
    <span style={{
      fontSize: 12, fontWeight: 700,
      color: accent ?? T.slate900,
      fontVariantNumeric: "tabular-nums",
    }}>
      {value}
    </span>
  </div>
);

const AssumptionRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div style={{
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "3px 0",
  }}>
    <span style={{ fontSize: 10.5, color: T.slate500 }}>{label}</span>
    <span style={{ fontSize: 10.5, color: T.slate700, fontWeight: 600,
                   fontVariantNumeric: "tabular-nums" }}>{value}</span>
  </div>
);

// ─── EMPTY STATE ──────────────────────────────────────────────────────

const EmptyState: React.FC = () => (
  <div style={{
    background: T.slate50, border: `1.5px dashed ${T.slate200}`,
    borderRadius: 12, padding: "20px 16px", textAlign: "center",
  }}>
    <div style={{ fontSize: 20, marginBottom: 8 }}>💰</div>
    <div style={{ fontSize: 12, fontWeight: 600, color: T.slate700, marginBottom: 4 }}>
      Aucune donnée financière
    </div>
    <div style={{ fontSize: 11, color: T.slate400, lineHeight: 1.5 }}>
      Sélectionnez un scénario avec des bâtiments pour afficher l'estimation financière.
    </div>
  </div>
);

// ─── MAIN COMPONENT ───────────────────────────────────────────────────

export interface FinancialBridgePanelProps {
  result:      FinancialBridgeResult | null;
  assumptions: FinancialBridgeAssumptions;
}

export const FinancialBridgePanel: React.FC<FinancialBridgePanelProps> = ({
  result, assumptions,
}) => (
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
          Passerelle financière
        </span>
        <div style={{ fontSize: 10, color: T.slate400, marginTop: 2 }}>
          Estimation préliminaire V1 · hypothèses à confirmer
        </div>
      </div>
    </div>

    {!result ? <EmptyState /> : <BridgeContent result={result} assumptions={assumptions} />}
  </div>
);

// ─── CONTENT ─────────────────────────────────────────────────────────

const BridgeContent: React.FC<{
  result:      FinancialBridgeResult;
  assumptions: FinancialBridgeAssumptions;
}> = ({ result: r, assumptions: a }) => {
  const signal = marginSignal(r.estimatedGrossMarginPct);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

      {/* ── Summary card ── */}
      <div style={{
        background: signal.bg, border: `1px solid ${signal.border}`,
        borderRadius: 12, overflow: "hidden",
      }}>
        <div style={{ height: 3, background: signal.bar }} />
        <div style={{ padding: "10px 14px 12px" }}>
          <div style={{
            fontSize: 9.5, fontWeight: 700, color: T.slate400,
            letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4,
          }}>
            Estimation sommaire
          </div>
          <p style={{
            fontSize: 12, fontWeight: 600, color: signal.color,
            margin: 0, lineHeight: 1.4,
          }}>
            {r.summary}
          </p>
        </div>
      </div>

      {/* ── Assumptions (compact) ── */}
      <div style={{
        background: T.white, border: `1px solid ${T.slate200}`,
        borderRadius: 12, padding: "10px 14px",
      }}>
        <SectionLabel>Hypothèses de calcul</SectionLabel>
        <AssumptionRow label="Prix de vente" value={`${Math.round(a.salePricePerM2).toLocaleString("fr-FR")} €/m²`} />
        <AssumptionRow label="Coût construction" value={fmtK(a.constructionCostPerM2)} />
        <AssumptionRow label="Efficience plancher" value={fmtPct(a.floorEfficiencyRatio)} />
        <AssumptionRow label="Surface moy. lot" value={`${a.averageUnitSizeM2 ?? 60} m²`} />
        <AssumptionRow label="Niveaux estimés" value={`${r.weightedAverageLevels} niveaux`} />
        {a.landCost && a.landCost > 0 && (
          <AssumptionRow label="Coût foncier" value={fmtEuro(a.landCost)} />
        )}
      </div>

      {/* ── Surface metrics ── */}
      <div style={{
        background: T.white, border: `1px solid ${T.slate200}`,
        borderRadius: 12, padding: "4px 14px 6px",
      }}>
        <div style={{ padding: "8px 0 4px" }}>
          <SectionLabel>Surfaces estimées</SectionLabel>
        </div>
        <MetricRow label="Emprise au sol"       value={fmtArea(r.footprintM2)} />
        <MetricRow label="SDP estimée"          value={fmtArea(r.estimatedFloorAreaM2)} />
        <MetricRow label="Surface vendable"     value={fmtArea(r.estimatedSaleableAreaM2)} />
        <MetricRow label="Lots estimés"         value={`${fmtN(r.estimatedUnitCount)} unités`} isLast />
      </div>

      {/* ── Financial metrics ── */}
      <div style={{
        background: T.white, border: `1px solid ${T.slate200}`,
        borderRadius: 12, padding: "4px 14px 6px",
      }}>
        <div style={{ padding: "8px 0 4px" }}>
          <SectionLabel>Indicateurs financiers</SectionLabel>
        </div>
        <MetricRow label="CA potentiel"         value={fmtEuro(r.estimatedRevenue)} />
        <MetricRow label="Coût travaux"         value={fmtEuro(r.estimatedConstructionCost)} accent={T.slate600} />
        <MetricRow label="Coût foncier"         value={r.estimatedLandCost > 0 ? fmtEuro(r.estimatedLandCost) : "—"} accent={T.slate600} />
        <MetricRow
          label="Marge brute"
          value={fmtEuro(r.estimatedGrossMargin)}
          accent={r.estimatedGrossMargin >= 0 ? T.green700 : T.red700}
        />
        <MetricRow
          label="Marge brute %"
          value={r.estimatedRevenue > 0 ? fmtPct(r.estimatedGrossMarginPct) : "—"}
          accent={r.estimatedGrossMarginPct >= 0.12 ? T.green700 : r.estimatedGrossMarginPct >= 0.06 ? T.amber700 : T.red700}
          isLast
        />
      </div>

      {/* ── Warnings ── */}
      {r.warnings.length > 0 && (
        <div style={{
          background: T.amber50, border: `1px solid ${T.amber200}`,
          borderRadius: 12, overflow: "hidden",
        }}>
          <div style={{
            padding: "8px 14px 7px", borderBottom: `1px solid #fef3c7`,
            display: "flex", alignItems: "center", gap: 7,
          }}>
            <span style={{ fontSize: 13 }}>⚠</span>
            <span style={{
              fontSize: 10, fontWeight: 700, color: T.amber700,
              textTransform: "uppercase", letterSpacing: "0.07em",
            }}>
              Points d'attention
            </span>
          </div>
          <ul style={{ margin: 0, padding: "8px 14px 10px 28px", listStyle: "disc" }}>
            {r.warnings.map((w, i) => (
              <li key={i} style={{
                fontSize: 11, color: "#78350f", lineHeight: 1.5,
                marginBottom: i < r.warnings.length - 1 ? 4 : 0,
              }}>
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Disclaimer */}
      <p style={{
        fontSize: 10, color: T.slate400, lineHeight: 1.5,
        margin: 0, fontStyle: "italic",
      }}>
        Estimation préliminaire basée sur des hypothèses simplifiées.
        Ne constitue pas un bilan promoteur ou un engagement financier.
      </p>
    </div>
  );
};

export default FinancialBridgePanel;