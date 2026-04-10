// src/spaces/promoteur/components/ScenarioFullPanel.tsx
// V2 — Panneau du scénario maître dessiné.
//
// Consomme exclusivement MasterScenario — source de vérité unique.
// Remplace l'ancienne version multi-scénarios (balanced / max_potential / secured).

import React, { useState } from 'react';
import type {
  MasterScenario,
  MasterEconomicAssumptions,
  MasterConformityStatus,
} from '../plan2d/plan.master.types';

// ─── TOKENS ───────────────────────────────────────────────────────────

const T = {
  white:   '#ffffff',
  slate50: '#f8fafc',
  slate100:'#f1f5f9',
  slate200:'#e2e8f0',
  slate300:'#cbd5e1',
  slate400:'#94a3b8',
  slate500:'#64748b',
  slate600:'#475569',
  slate700:'#334155',
  slate900:'#0f172a',
  violet:  { main: '#4f46e5', light: '#eef2ff', border: '#c7d2fe' },
  orange:  { main: '#d97706', light: '#fffbeb', border: '#fde68a' },
  green:   { main: '#16a34a', light: '#f0fdf4', border: '#bbf7d0' },
  red:     { main: '#dc2626', light: '#fef2f2', border: '#fecaca' },
  amber:   { main: '#d97706', light: '#fffbeb', border: '#fde68a' },
} as const;

// ─── HELPERS STATUT ───────────────────────────────────────────────────

function statusColor(s: MasterConformityStatus): string {
  return s === 'CONFORME' ? T.green.main : s === 'LIMITE' ? T.amber.main : T.red.main;
}
function statusBg(s: MasterConformityStatus): string {
  return s === 'CONFORME' ? T.green.light : s === 'LIMITE' ? T.amber.light : T.red.light;
}
function statusBorder(s: MasterConformityStatus): string {
  return s === 'CONFORME' ? T.green.border : s === 'LIMITE' ? T.amber.border : T.red.border;
}
function statusLabel(s: MasterConformityStatus): string {
  return s === 'CONFORME' ? 'Conforme' : s === 'LIMITE' ? 'Limite' : 'Bloquant';
}
function scoreColor(n: number): string {
  return n >= 75 ? T.green.main : n >= 50 ? T.amber.main : T.red.main;
}

// ─── FORMATTERS ───────────────────────────────────────────────────────

const fmtArea = (m2: number) => `${Math.round(m2).toLocaleString('fr-FR')} m²`;
const fmtPct  = (r: number)  => `${(r * 100).toFixed(1)} %`;
const fmtEur  = (n: number)  => {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} M€`;
  if (Math.abs(n) >= 1_000)     return `${(n / 1_000).toFixed(0)} k€`;
  return `${Math.round(n)} €`;
};

// ─── FIELD PRIMITIVES ─────────────────────────────────────────────────

const NumField: React.FC<{
  label: string; value: number; unit: string;
  step?: number; min?: number; onChange: (v: number) => void;
}> = ({ label, value, unit, step = 100, min = 0, onChange }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
    <span style={{ fontSize: 11, color: T.slate600 }}>{label}</span>
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <input
        type="number" value={value} step={step} min={min}
        onChange={e => onChange(Number(e.target.value))}
        style={{
          width: 80, padding: '4px 7px', borderRadius: 7,
          border: `1px solid ${T.slate200}`, fontSize: 12,
          fontWeight: 600, textAlign: 'right', background: T.white,
        }}
      />
      <span style={{ fontSize: 10, color: T.slate400, minWidth: 30 }}>{unit}</span>
    </div>
  </div>
);

const OptionalIntField: React.FC<{
  label: string; value: number | undefined; unit: string;
  step?: number; min?: number; placeholder?: string;
  onChange: (v: number | undefined) => void;
}> = ({ label, value, unit, step = 1, min = 0, placeholder = '—', onChange }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
    <span style={{ fontSize: 11, color: T.slate600 }}>{label}</span>
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <input
        type="number" value={value ?? ''} step={step} min={min} placeholder={placeholder}
        onChange={e => { const r = e.target.value; onChange(r === '' ? undefined : Number(r)); }}
        style={{
          width: 80, padding: '4px 7px', borderRadius: 7,
          border: `1.5px solid ${value === undefined ? T.orange.border : T.violet.border}`,
          fontSize: 12, fontWeight: 600, textAlign: 'right',
          background: value === undefined ? T.orange.light : T.white,
        }}
      />
      <span style={{ fontSize: 10, color: T.slate400, minWidth: 30 }}>{unit}</span>
    </div>
  </div>
);

// ─── PROGRAMME & VALORISATION ─────────────────────────────────────────

const ProgrammeSection: React.FC<{
  nbLogements?:          number;
  surfaceMoyLogementM2?: number;
  salePricePerM2:        number;
  landCostTotal:         number;
  onChangeProgramme:     (nb: number | undefined, surf: number | undefined) => void;
  onChangeAssumptions:   (patch: Partial<MasterEconomicAssumptions>) => void;
}> = ({ nbLogements, surfaceMoyLogementM2, salePricePerM2, landCostTotal, onChangeProgramme, onChangeAssumptions }) => (
  <div style={{ margin: '0 12px 8px', border: `1px solid ${T.violet.border}`, borderRadius: 10, overflow: 'hidden' }}>
    <div style={{ padding: '8px 12px', background: T.violet.light, borderBottom: `1px solid ${T.violet.border}` }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: T.violet.main, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        📋 Programme & Valorisation
      </span>
    </div>
    <div style={{ padding: '10px 12px', background: T.white }}>

      <div style={{ fontSize: 9.5, fontWeight: 700, color: T.slate500, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
        Programme
      </div>

      <OptionalIntField
        label="Nb logements" value={nbLogements} unit="log."
        step={1} min={1} placeholder="non défini"
        onChange={nb => onChangeProgramme(nb, surfaceMoyLogementM2)}
      />
      <OptionalIntField
        label="Surface moy. logement" value={surfaceMoyLogementM2} unit="m²"
        step={1} min={10} placeholder="65"
        onChange={surf => onChangeProgramme(nbLogements, surf)}
      />

      {nbLogements === undefined ? (
        <div style={{ padding: '5px 8px', borderRadius: 6, background: T.orange.light, border: `1px solid ${T.orange.border}`, fontSize: 9, color: '#78350f', lineHeight: 1.5, marginBottom: 10 }}>
          ⚠ Sans nombre de logements, la conformité stationnement n'est pas évaluée.
        </div>
      ) : (
        <div style={{ padding: '5px 8px', borderRadius: 6, background: T.green.light, border: `1px solid ${T.green.border}`, fontSize: 9, color: '#166534', lineHeight: 1.5, marginBottom: 10 }}>
          ✓ Parking requis : {Math.ceil(nbLogements)} place{nbLogements > 1 ? 's' : ''} (1 / logement)
        </div>
      )}

      <div style={{ height: 1, background: T.slate200, margin: '2px 0 10px' }} />

      <div style={{ fontSize: 9.5, fontWeight: 700, color: T.slate500, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
        Valorisation
      </div>

      <NumField
        label="Prix commercialisation" value={salePricePerM2} unit="€/m²"
        step={100} min={0} onChange={v => onChangeAssumptions({ salePricePerM2: v })}
      />
      <NumField
        label="Coût foncier total" value={landCostTotal} unit="€"
        step={10_000} min={0} onChange={v => onChangeAssumptions({ landCostTotal: v })}
      />
    </div>
  </div>
);

// ─── HYPOTHÈSES TECHNIQUES ────────────────────────────────────────────

const TechnicalAssumptionsPanel: React.FC<{
  assumptions: MasterEconomicAssumptions;
  onChange:    (a: MasterEconomicAssumptions) => void;
}> = ({ assumptions, onChange }) => {
  const [open, setOpen] = useState(false);
  const up = (patch: Partial<MasterEconomicAssumptions>) => onChange({ ...assumptions, ...patch });

  return (
    <div style={{ margin: '0 12px 8px', border: `1px solid ${T.slate200}`, borderRadius: 10, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%', padding: '8px 12px', background: T.slate50, border: 'none',
          cursor: 'pointer', display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', fontFamily: 'Inter,system-ui,sans-serif',
        }}
      >
        <span style={{ fontSize: 10, fontWeight: 700, color: T.slate600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          ⚙ Hypothèses techniques
        </span>
        <span style={{ fontSize: 11, color: T.slate400 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{ padding: '10px 12px', background: T.white }}>
          <NumField label="Coût construction"   value={assumptions.constructionCostPerM2} unit="€/m²" step={100} onChange={v => up({ constructionCostPerM2: v })} />
          <NumField label="Efficience plancher" value={assumptions.floorEfficiencyPct}    unit="%"    step={1} min={50} onChange={v => up({ floorEfficiencyPct: v })} />
          <NumField label="Surface moy. lot"    value={assumptions.averageLotSizeM2}      unit="m²"   step={1} min={20} onChange={v => up({ averageLotSizeM2: v })} />
          <div style={{ fontSize: 9, color: T.slate400, marginTop: 6, fontStyle: 'italic' }}>
            Calcul estimatif, hors frais annexes et taxes.
          </div>
        </div>
      )}
    </div>
  );
};

// ─── SCORE GAUGE ──────────────────────────────────────────────────────

const ScoreGauge: React.FC<{ score: number; color: string; size?: number }> = ({
  score, color, size = 46,
}) => {
  const r = 14, cx = size / 2, cy = size / 2, circ = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} style={{ flexShrink: 0 }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={T.slate200} strokeWidth={3.5} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={3.5}
        strokeDasharray={circ} strokeDashoffset={circ * (1 - score / 100)}
        strokeLinecap="round" transform={`rotate(-90 ${cx} ${cy})`} />
      <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="middle"
        fontSize={11} fontWeight="700" fill={color} fontFamily="Inter,sans-serif">
        {score}
      </text>
    </svg>
  );
};

// ─── METRIC CELL ──────────────────────────────────────────────────────

const MetricCell: React.FC<{
  label: string; value: string; color?: string;
}> = ({ label, value, color = T.slate900 }) => (
  <div style={{
    flex: 1, padding: '7px 9px',
    background: T.white, border: `1px solid ${T.slate200}`, borderRadius: 8,
  }}>
    <div style={{ fontSize: 8, fontWeight: 700, color: T.slate500, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>
      {label}
    </div>
    <div style={{ fontSize: 12, fontWeight: 700, color }}>{value}</div>
  </div>
);

// ─── AFFICHAGE DU SCÉNARIO MAÎTRE ────────────────────────────────────

const ScenarioDisplay: React.FC<{ scenario: MasterScenario }> = ({ scenario }) => {
  const { metrics, conformity, economics, scores, narrative, program } = scenario;
  const sc           = conformity.status;
  const accent       = statusColor(sc);
  const parkingStr   = program.nbLogements === undefined
    ? `${metrics.parkingProvided} (—)`
    : `${metrics.parkingProvided}/${metrics.parkingRequired}`;
  const parkingColor = program.nbLogements !== undefined && metrics.parkingProvided < metrics.parkingRequired
    ? T.red.main : T.slate900;
  const cesColor     = metrics.coverageRatio > 0.50 ? T.red.main : metrics.coverageRatio > 0.46 ? T.amber.main : T.slate900;
  const marginColor  = economics.grossMarginPct >= 0.18 ? T.green.main : economics.grossMarginPct >= 0.10 ? T.amber.main : T.red.main;

  return (
    <div style={{ padding: '0 12px 12px' }}>

      {/* ── Statut + Score ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 12px',
        background: statusBg(sc), border: `1px solid ${statusBorder(sc)}`,
        borderRadius: 10, marginBottom: 10,
      }}>
        <ScoreGauge score={scores.overall} color={accent} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: accent, marginBottom: 3 }}>
            {statusLabel(sc)}
            <span style={{ marginLeft: 8, fontSize: 9, fontWeight: 600, color: T.slate500 }}>
              Régl. {scores.regulatory} · Foncier {scores.landEfficiency} · Simpl. {scores.simplicity}
            </span>
          </div>
          <div style={{ fontSize: 10.5, color: T.slate700, lineHeight: 1.45 }}>
            {narrative.summary}
          </div>
        </div>
      </div>

      {/* ── Métriques — ligne 1 ── */}
      <div style={{ fontSize: 9, fontWeight: 700, color: T.slate500, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5 }}>
        Métriques
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
        <MetricCell label="Emprise bâtie"  value={fmtArea(metrics.buildingsFootprintM2)} />
        <MetricCell label="CES"            value={fmtPct(metrics.coverageRatio)}          color={cesColor} />
        <MetricCell label="Bâtiments"      value={String(metrics.buildingCount)} />
      </div>

      {/* ── Métriques — ligne 2 ── */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
        <MetricCell label="Parking"        value={parkingStr}                              color={parkingColor} />
        <MetricCell label="SDP estimée"    value={fmtArea(metrics.totalFloorsAreaM2)} />
        <MetricCell label="Hauteur max"    value={metrics.maxHeightM > 0 ? `${metrics.maxHeightM.toFixed(1)} m` : '—'}
          color={metrics.maxHeightM > 15 ? T.red.main : T.slate900} />
      </div>

      {/* ── Conformité PLU ── */}
      {conformity.messages.length > 0 && (
        <div style={{
          marginBottom: 10, padding: '8px 10px',
          background: statusBg(sc), border: `1px solid ${statusBorder(sc)}`,
          borderRadius: 8, borderLeft: `3px solid ${accent}`,
        }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: T.slate500, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>
            Conformité PLU
          </div>
          {conformity.messages.map((msg, i) => (
            <div key={i} style={{ fontSize: 10.5, color: T.slate700, lineHeight: 1.5, marginBottom: i < conformity.messages.length - 1 ? 3 : 0 }}>
              {msg}
            </div>
          ))}
        </div>
      )}

      {/* ── Approche économique ── */}
      <div style={{ marginBottom: 10, border: `1px solid ${T.slate200}`, borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ padding: '7px 10px', background: T.slate100, borderBottom: `1px solid ${T.slate200}` }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: T.slate500, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            Approche économique
          </span>
        </div>
        <div style={{ padding: '8px 10px 4px', background: T.white }}>
          <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
            <MetricCell label="Surface vendable" value={fmtArea(economics.saleableAreaM2)} />
            <MetricCell label="Logements"        value={`${economics.estimatedLots} log.`} />
          </div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
            <MetricCell label="CA brut"    value={fmtEur(economics.revenueEur)} />
            <MetricCell label="Marge brute" value={fmtEur(economics.grossMarginEur)} color={marginColor} />
          </div>
          <div style={{ fontSize: 9, color: T.slate400, textAlign: 'right', paddingBottom: 6 }}>
            Marge {(economics.grossMarginPct * 100).toFixed(1)} % · Constr. {fmtEur(economics.constructionCostEur)}
            {economics.landCostEur > 0 ? ` · Foncier ${fmtEur(economics.landCostEur)}` : ''}
          </div>
        </div>
      </div>

      {/* ── Points favorables ── */}
      {narrative.strengths.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: T.green.main, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>
            Points favorables
          </div>
          {narrative.strengths.map((pt, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
              <span style={{ color: T.green.main, fontSize: 10, flexShrink: 0, marginTop: 1 }}>✓</span>
              <span style={{ fontSize: 10.5, color: T.slate700, lineHeight: 1.45 }}>{pt}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Points de vigilance ── */}
      {narrative.vigilancePoints.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: T.amber.main, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>
            Points de vigilance
          </div>
          {narrative.vigilancePoints.map((pt, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
              <span style={{ color: T.amber.main, fontSize: 10, flexShrink: 0, marginTop: 1 }}>—</span>
              <span style={{ fontSize: 10.5, color: T.slate700, lineHeight: 1.45 }}>{pt}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Prochaine étape ── */}
      {narrative.nextAction && (
        <div style={{
          padding: '8px 10px',
          background: T.slate50, border: `1px solid ${T.slate200}`,
          borderRadius: 8, borderLeft: `3px solid ${accent}`,
        }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: T.slate500, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
            Prochaine étape
          </div>
          <div style={{ fontSize: 10.5, color: T.slate700, lineHeight: 1.45 }}>
            {narrative.nextAction}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── PROPS ────────────────────────────────────────────────────────────

export interface ScenarioFullPanelProps {
  scenario:              MasterScenario | null;
  assumptions:           MasterEconomicAssumptions;
  nbLogements?:          number;
  surfaceMoyLogementM2?: number;
  onChangeProgramme:     (nb: number | undefined, surf: number | undefined) => void;
  onChangeAssumptions:   (a: MasterEconomicAssumptions) => void;
  onExportPdf?:          () => void;
  isEmpty?:              boolean;
}

// ─── COMPOSANT PRINCIPAL ──────────────────────────────────────────────

export const ScenarioFullPanel: React.FC<ScenarioFullPanelProps> = ({
  scenario, assumptions, nbLogements, surfaceMoyLogementM2,
  onChangeProgramme, onChangeAssumptions, onExportPdf, isEmpty,
}) => {
  return (
    <div style={{ fontFamily: 'Inter,system-ui,sans-serif' }}>

      {/* ── Barre d'actions (sticky) ── */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 5,
        display: 'flex', gap: 8, alignItems: 'center',
        padding: '8px 12px',
        background: 'rgba(255,255,255,0.97)',
        backdropFilter: 'blur(6px)',
        borderBottom: `1px solid ${T.slate200}`,
      }}>
        <span style={{ flex: 1, fontSize: 10, color: T.slate500 }}>
          {scenario ? (
            <>
              Statut :{' '}
              <strong style={{ color: statusColor(scenario.conformity.status) }}>
                {statusLabel(scenario.conformity.status)}
              </strong>
              <span style={{ color: T.slate400, marginLeft: 6 }}>
                · Score {scenario.scores.overall}/100
              </span>
            </>
          ) : (
            'Dessinez un bâtiment pour évaluer l\'implantation.'
          )}
        </span>
        {onExportPdf && scenario && (
          <button
            onClick={onExportPdf}
            style={{
              padding: '5px 12px', borderRadius: 7, border: 'none', cursor: 'pointer',
              background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', color: T.white,
              fontSize: 10.5, fontWeight: 700,
              boxShadow: '0 2px 6px rgba(79,70,229,0.35)',
            }}
          >
            ⬇ PDF
          </button>
        )}
      </div>

      {/* ── Programme & Valorisation ── */}
      <div style={{ padding: '8px 0 0' }}>
        <ProgrammeSection
          nbLogements={nbLogements}
          surfaceMoyLogementM2={surfaceMoyLogementM2}
          salePricePerM2={assumptions.salePricePerM2}
          landCostTotal={assumptions.landCostTotal}
          onChangeProgramme={onChangeProgramme}
          onChangeAssumptions={patch => onChangeAssumptions({ ...assumptions, ...patch })}
        />
      </div>

      {/* ── Hypothèses techniques ── */}
      <TechnicalAssumptionsPanel assumptions={assumptions} onChange={onChangeAssumptions} />

      {/* ── Scénario maître ── */}
      {isEmpty && !scenario ? (
        <div style={{ padding: '28px 16px', textAlign: 'center', color: T.slate400, fontSize: 11.5 }}>
          Dessinez au moins un bâtiment pour évaluer l'implantation.
        </div>
      ) : scenario ? (
        <ScenarioDisplay scenario={scenario} />
      ) : null}
    </div>
  );
};

export default ScenarioFullPanel;