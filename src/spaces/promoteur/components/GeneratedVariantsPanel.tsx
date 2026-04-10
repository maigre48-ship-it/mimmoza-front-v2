// src/spaces/promoteur/components/GeneratedVariantsPanel.tsx

import React from "react";
import type { ImplantationScenario, ScenarioStatus } from "../plan2d/plan.scenarios.types";

// ─── DESIGN TOKENS ────────────────────────────────────────────────────

const T = {
  slate900: "#0f172a", slate700: "#334155", slate600: "#475569",
  slate500: "#64748b", slate400: "#94a3b8", slate200: "#e2e8f0",
  slate100: "#f1f5f9", slate50:  "#f8fafc", white:    "#ffffff",
  green700: "#15803d", green50: "#f0fdf4",  green100: "#dcfce7", green200: "#bbf7d0",
  amber700: "#b45309", amber50: "#fffbeb",  amber200: "#fde68a",
  red700:   "#b91c1c", red50:   "#fef2f2",  red200:   "#fecaca",
  indigo600: "#4f46e5", indigo50: "#eef2ff", indigo200: "#c7d2fe",
  teal600:   "#0d9488", teal50:   "#f0fdfa", teal200:  "#99f6e4",
} as const;

// ─── STATUS TOKEN ────────────────────────────────────────────────────

type StatusToken = { dot: string; label: string; color: string; bg: string; border: string; bar: string };
const STATUS_TOKEN: Record<ScenarioStatus, StatusToken> = {
  CONFORME: { dot: "#22c55e", label: "Conforme",  color: T.green700, bg: T.green50,  border: T.green200,  bar: "#22c55e" },
  LIMITE:   { dot: "#f59e0b", label: "Limite",    color: T.amber700, bg: T.amber50,  border: T.amber200,  bar: "#f59e0b" },
  BLOQUANT: { dot: "#ef4444", label: "Bloquant",  color: T.red700,   bg: T.red50,    border: T.red200,    bar: "#ef4444" },
};

// ─── FORMATTERS ───────────────────────────────────────────────────────

const fmtArea = (m2: number) => `${Math.round(m2).toLocaleString("fr-FR")} m²`;
const fmtPct  = (r: number)  => `${(r * 100).toFixed(1)} %`;
const fmtN    = (n: number)  => String(Math.round(n));

// ─── MINI BADGE ───────────────────────────────────────────────────────

const StatusBadge: React.FC<{ status: ScenarioStatus }> = ({ status }) => {
  const t = STATUS_TOKEN[status];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4,
                   padding: "2px 7px", borderRadius: 20, background: t.bg,
                   border: `1px solid ${t.border}`, color: t.color,
                   fontSize: 10, fontWeight: 700, letterSpacing: "0.04em",
                   textTransform: "uppercase", whiteSpace: "nowrap", userSelect: "none" }}>
      <span style={{ display: "inline-block", width: 5, height: 5,
                     borderRadius: "50%", background: t.dot, flexShrink: 0 }} />
      {t.label}
    </span>
  );
};

// ─── SCORE CHIP ───────────────────────────────────────────────────────

const ScoreChip: React.FC<{ score: number }> = ({ score }) => {
  const c = score >= 75 ? T.green700 : score >= 50 ? T.amber700 : T.red700;
  const bg = score >= 75 ? T.green50 : score >= 50 ? T.amber50 : T.red50;
  const bd = score >= 75 ? T.green200 : score >= 50 ? T.amber200 : T.red200;
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 1,
                   padding: "2px 7px", borderRadius: 20, background: bg,
                   border: `1px solid ${bd}`, fontVariantNumeric: "tabular-nums" }}>
      <span style={{ fontSize: 12, fontWeight: 800, color: c }}>{score}</span>
      <span style={{ fontSize: 9, color: c, fontWeight: 600 }}>/100</span>
    </span>
  );
};

// ─── VARIANT CARD ─────────────────────────────────────────────────────

const VariantCard: React.FC<{
  variant:       ImplantationScenario;
  isActive:      boolean;
  onAdopt?:      () => void;
  onPreview?:    () => void;
}> = ({ variant: v, isActive, onAdopt, onPreview }) => {
  const st  = STATUS_TOKEN[v.globalStatus];

  return (
    <div style={{ background: T.white,
                  border: isActive ? `1.5px solid ${T.teal600}` : `1px solid ${T.slate200}`,
                  borderRadius: 12, overflow: "hidden",
                  boxShadow: isActive ? `0 0 0 3px ${T.teal200}` : "none" }}>
      {/* Top accent */}
      <div style={{ height: 2, background: isActive ? T.teal600 : st.bar }} />

      <div style={{ padding: "10px 12px 11px" }}>
        {/* Header row */}
        <div style={{ display: "flex", alignItems: "flex-start",
                      justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Auto-generated chip */}
            <div style={{ marginBottom: 4 }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: T.teal600,
                             background: T.teal50, border: `1px solid ${T.teal200}`,
                             borderRadius: 20, padding: "1px 6px",
                             letterSpacing: "0.06em", textTransform: "uppercase",
                             userSelect: "none" }}>
                ⚙ Variante générée
              </span>
            </div>
            <div style={{ fontWeight: 700, color: T.slate900, fontSize: 12, lineHeight: 1.2 }}>
              {v.label}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            <StatusBadge status={v.globalStatus} />
            {v.score && <ScoreChip score={v.score.breakdown.overall} />}
          </div>
        </div>

        {/* Description */}
        {v.description && (
          <p style={{ fontSize: 11, color: T.slate500, margin: "0 0 8px", lineHeight: 1.45 }}>
            {v.description}
          </p>
        )}

        {/* Metrics strip */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, marginBottom: 9 }}>
          {[
            { label: "Emprise",   value: fmtArea(v.metrics.totalFootprintM2) },
            { label: "CES",       value: fmtPct(v.metrics.coverageRatio) },
            { label: "Bâtiments", value: fmtN(v.metrics.buildingCount) },
          ].map(m => (
            <div key={m.label} style={{ background: T.slate50, border: `1px solid ${T.slate100}`,
                                        borderRadius: 7, padding: "5px 7px", textAlign: "center" }}>
              <div style={{ fontSize: 9, color: T.slate400, fontWeight: 600,
                            letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 2 }}>
                {m.label}
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: T.slate900,
                            fontVariantNumeric: "tabular-nums" }}>
                {m.value}
              </div>
            </div>
          ))}
        </div>

        {/* Score breakdown */}
        {v.score && (
          <div style={{ display: "flex", gap: 8, marginBottom: 9,
                        background: T.slate50, borderRadius: 8, padding: "6px 10px" }}>
            {([
              { label: "Régl.",     val: v.score.breakdown.regulatory },
              { label: "Foncier",   val: v.score.breakdown.footprintEfficiency },
              { label: "Simplicité", val: v.score.breakdown.simplicity },
            ] as const).map(d => {
              const c = d.val >= 75 ? T.green700 : d.val >= 50 ? T.amber700 : T.red700;
              return (
                <div key={d.label} style={{ flex: 1, textAlign: "center" }}>
                  <div style={{ fontSize: 9, color: T.slate400, fontWeight: 600,
                                textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>
                    {d.label}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: c,
                                fontVariantNumeric: "tabular-nums" }}>
                    {d.val}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Recommendation */}
        <div style={{ padding: "6px 10px", background: st.bg, borderRadius: 7,
                      borderLeft: `3px solid ${st.bar}`, marginBottom: 9 }}>
          <p style={{ fontSize: 10.5, color: st.color, margin: 0,
                      lineHeight: 1.45, fontWeight: 500 }}>
            {v.recommendation}
          </p>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 6 }}>
          {onPreview && !isActive && (
            <button
              onClick={onPreview}
              style={{ flex: 1, padding: "6px 10px", borderRadius: 7, border: `1px solid ${T.slate200}`,
                       background: T.white, color: T.slate700, fontSize: 11, fontWeight: 600,
                       cursor: "pointer", textAlign: "center" as const }}>
              Prévisualiser
            </button>
          )}
          {onAdopt && (
            <button
              onClick={onAdopt}
              style={{ flex: 1, padding: "6px 10px", borderRadius: 7,
                       border: isActive ? `1px solid ${T.teal600}` : `1px solid ${T.indigo600}`,
                       background: isActive ? T.teal50 : T.indigo50,
                       color: isActive ? T.teal600 : T.indigo600,
                       fontSize: 11, fontWeight: 700, cursor: "pointer",
                       textAlign: "center" as const }}>
              {isActive ? "✓ Actif" : "Adopter"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── EMPTY STATE ──────────────────────────────────────────────────────

const EmptyState: React.FC = () => (
  <div style={{ background: T.slate50, border: `1.5px dashed ${T.slate200}`,
                borderRadius: 12, padding: "20px 16px", textAlign: "center" }}>
    <div style={{ fontSize: 20, marginBottom: 8 }}>⚙</div>
    <div style={{ fontSize: 12, fontWeight: 600, color: T.slate700, marginBottom: 4 }}>
      Aucune variante disponible
    </div>
    <div style={{ fontSize: 11, color: T.slate400, lineHeight: 1.5 }}>
      Sélectionnez un scénario avec des bâtiments pour générer des variantes automatiques.
    </div>
  </div>
);

// ─── PANEL ────────────────────────────────────────────────────────────

export interface GeneratedVariantsPanelProps {
  variants:           ImplantationScenario[];
  activeScenarioId?:  string | null;
  onAdoptVariant?:    (scenarioId: string) => void;
  onPreviewVariant?:  (scenarioId: string) => void;
}

export const GeneratedVariantsPanel: React.FC<GeneratedVariantsPanelProps> = ({
  variants, activeScenarioId = null, onAdoptVariant, onPreviewVariant,
}) => (
  <div style={{ padding: "10px 14px 18px", background: T.slate50 }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                  paddingBottom: 8, marginBottom: 12, borderBottom: `1px solid ${T.slate200}` }}>
      <div>
        <span style={{ fontSize: 11, fontWeight: 700, color: T.slate500,
                       letterSpacing: "0.06em", textTransform: "uppercase" }}>
          Variantes générées
        </span>
        <div style={{ fontSize: 10, color: T.slate400, marginTop: 2 }}>
          Alternatives déterministes · V1 géométrique
        </div>
      </div>
      {variants.length > 0 && (
        <span style={{ fontSize: 9.5, color: T.teal600, background: T.teal50,
                       border: `1px solid ${T.teal200}`, borderRadius: 20,
                       padding: "2px 8px", fontWeight: 700 }}>
          {variants.length} variante{variants.length > 1 ? "s" : ""}
        </span>
      )}
    </div>

    {variants.length === 0 ? (
      <EmptyState />
    ) : (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {variants.map(v => (
          <VariantCard
            key={v.id}
            variant={v}
            isActive={v.id === activeScenarioId}
            onAdopt={onAdoptVariant ? () => onAdoptVariant(v.id) : undefined}
            onPreview={onPreviewVariant ? () => onPreviewVariant(v.id) : undefined}
          />
        ))}
      </div>
    )}

    <p style={{ fontSize: 10, color: T.slate400, lineHeight: 1.5, margin: "12px 0 0",
                fontStyle: "italic" }}>
      Variantes générées algorithmiquement à partir du scénario actif.
      Vérifier la conformité PLU avant adoption.
    </p>
  </div>
);

export default GeneratedVariantsPanel;