// src/spaces/promoteur/components/ScenarioComparisonGrid.tsx
// Grille comparative 3 colonnes pour les scénarios d'implantation.
//
// Architecture :
//   ScenarioComparisonGrid         ← orchestrateur
//     ScenarioHeaderCard           ← en-tête coloré par scénario
//     MetricGrid                   ← grille label / col1 / col2 / col3
//     ScenarioVisualScores         ← barres de score par scénario
//     ScenarioSummaryCard          ← texte + points forts + vigilances
//
// Règles de mise en page :
//   • CSS grid, zéro position absolute dans la zone comparative
//   • min-width: 0 sur chaque cellule de grille/flex pour éviter l'overflow
//   • min-height à la place des heights fixes
//   • word-break: break-word sur tous les textes

import React, { useState } from 'react';
import type { ImplantationScenarioFull } from '../plan2d/scenarioGenerator.types';

// ─── PALETTE ──────────────────────────────────────────────────────────

const PAL = {
  balanced:     { main:'#4f46e5', light:'#eef2ff', border:'#c7d2fe', dimLight:'rgba(79,70,229,0.08)' },
  max_potential:{ main:'#d97706', light:'#fffbeb', border:'#fde68a', dimLight:'rgba(217,119,6,0.08)'  },
  secured:      { main:'#0d9488', light:'#f0fdfa', border:'#99f6e4', dimLight:'rgba(13,148,136,0.08)' },
} as const;

type PalKey = keyof typeof PAL;

const T = {
  white:'#ffffff', slate50:'#f8fafc', slate100:'#f1f5f9', slate200:'#e2e8f0',
  slate400:'#94a3b8', slate500:'#64748b', slate600:'#475569', slate700:'#334155', slate900:'#0f172a',
  green:'#16a34a', red:'#dc2626', amber:'#d97706',
};

// ─── HELPERS ──────────────────────────────────────────────────────────

const fmt = (n: number, unit = '') => `${Math.round(n).toLocaleString('fr-FR')}${unit}`;
const fmtPct = (n: number) => `${(n * 100).toFixed(1)} %`;
const fmtEur = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `${(n/1_000_000).toFixed(2)} M€`;
  if (Math.abs(n) >= 1_000)     return `${(n/1_000).toFixed(0)} k€`;
  return `${Math.round(n)} €`;
};

// ─── SCORE GAUGE ──────────────────────────────────────────────────────

const ScoreGauge: React.FC<{ score: number; color: string; size?: number }> = ({
  score, color, size = 52,
}) => {
  const r = size * 0.31, cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} aria-label={`Score ${score}/100`}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={T.slate200} strokeWidth={size * 0.08}/>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={size * 0.08}
        strokeDasharray={circ} strokeDashoffset={circ * (1 - score / 100)}
        strokeLinecap="round" transform={`rotate(-90 ${cx} ${cy})`}/>
      <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="middle"
        fontSize={size * 0.24} fontWeight="700" fill={color} fontFamily="Inter,system-ui,sans-serif">
        {score}
      </text>
    </svg>
  );
};

// ─── SCENARIO HEADER CARD ─────────────────────────────────────────────

const ScenarioHeaderCard: React.FC<{
  sc:       ImplantationScenarioFull;
  isActive: boolean;
  onClick:  () => void;
}> = ({ sc, isActive, onClick }) => {
  const pal = PAL[sc.key as PalKey];
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0,
        background: 'none', outline: 'none',
      }}
    >
      <div style={{
        borderRadius: 10,
        border: `2px solid ${isActive ? pal.main : pal.border}`,
        background: isActive ? pal.light : T.white,
        overflow: 'hidden',
        transition: 'border-color 0.15s, background 0.15s',
      }}>
        {/* Bande couleur en haut */}
        <div style={{ height: 5, background: pal.main }}/>
        {/* Corps */}
        <div style={{ padding: '10px 10px 8px' }}>
          {/* Jauge + titre */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <ScoreGauge score={sc.scoreGlobal} color={pal.main} size={48}/>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{
                fontSize: 11, fontWeight: 700, color: pal.main,
                wordBreak: 'break-word', lineHeight: 1.3, marginBottom: 2,
              }}>
                {sc.title}
              </div>
              <div style={{ fontSize: 9.5, color: T.slate500, lineHeight: 1.3 }}>
                {sc.subtitle}
              </div>
            </div>
          </div>
          {/* Badge conformité */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '2px 7px', borderRadius: 10,
            background: sc.isConforme ? '#dcfce7' : '#fee2e2',
            fontSize: 9, fontWeight: 700,
            color: sc.isConforme ? T.green : T.red,
          }}>
            {sc.isConforme ? 'CONFORME PLU' : 'NON CONFORME'}
          </div>
        </div>
      </div>
    </button>
  );
};

// ─── METRIC GRID ──────────────────────────────────────────────────────
// Grille label / val1 / val2 / val3 avec alignement parfait

interface MetricRow {
  label:    string;
  values:   (string | React.ReactNode)[];
  colors?:  (string | undefined)[];
  bold?:    boolean[];
}

const MetricGrid: React.FC<{ rows: MetricRow[]; scenarios: ImplantationScenarioFull[] }> = ({
  rows, scenarios,
}) => (
  <div style={{
    display: 'grid',
    gridTemplateColumns: 'minmax(0,1.1fr) repeat(3, minmax(0,1fr))',
    gap: 0,
  }}>
    {rows.map((row, ri) => (
      <React.Fragment key={ri}>
        {/* Cellule label */}
        <div style={{
          padding: '6px 8px 6px 4px',
          borderBottom: `1px solid ${T.slate200}`,
          background: ri % 2 === 0 ? T.slate50 : T.white,
          display: 'flex', alignItems: 'center',
        }}>
          <span style={{
            fontSize: 10, color: T.slate500, wordBreak: 'break-word',
            overflowWrap: 'anywhere', lineHeight: 1.3,
          }}>
            {row.label}
          </span>
        </div>
        {/* 3 cellules valeurs */}
        {scenarios.map((sc, si) => {
          const pal = PAL[sc.key as PalKey];
          const color = row.colors?.[si] ?? T.slate900;
          const isBold = row.bold?.[si] ?? false;
          return (
            <div key={sc.id} style={{
              padding: '6px 6px',
              borderBottom: `1px solid ${T.slate200}`,
              borderLeft: `1px solid ${pal.border}`,
              background: ri % 2 === 0 ? pal.dimLight : T.white,
              display: 'flex', alignItems: 'center', minWidth: 0,
            }}>
              <span style={{
                fontSize: 10.5, fontWeight: isBold ? 700 : 500, color,
                wordBreak: 'break-word', overflowWrap: 'anywhere', lineHeight: 1.3,
              }}>
                {row.values[si]}
              </span>
            </div>
          );
        })}
      </React.Fragment>
    ))}
  </div>
);

// ─── SCENARIO VISUAL SCORES ───────────────────────────────────────────

const ScenarioVisualScores: React.FC<{ scenarios: ImplantationScenarioFull[] }> = ({ scenarios }) => {
  const scoreRows: { label: string; key: keyof ImplantationScenarioFull }[] = [
    { label: 'Réglementaire', key: 'scoreReglementaire' },
    { label: 'Foncier',       key: 'scoreFoncier' },
    { label: 'Simplicité',    key: 'scoreSimplicite' },
  ];
  return (
    <div style={{ padding: '8px 0 2px' }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0,1.1fr) repeat(3, minmax(0,1fr))',
        gap: 0,
        alignItems: 'center',
      }}>
        {/* En-tête vide + noms scénarios */}
        <div style={{ padding: '0 0 6px 4px' }}>
          <span style={{ fontSize: 9, color: T.slate400, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Scores
          </span>
        </div>
        {scenarios.map(sc => (
          <div key={sc.id} style={{ padding: '0 6px 6px', minWidth: 0 }}>
            <span style={{ fontSize: 9, color: PAL[sc.key as PalKey].main, fontWeight: 700 }}>
              {sc.key === 'balanced' ? 'Équil.' : sc.key === 'max_potential' ? 'Max' : 'Sécu.'}
            </span>
          </div>
        ))}

        {/* Lignes de score */}
        {scoreRows.map(({ label, key }, ri) => (
          <React.Fragment key={key as string}>
            <div style={{
              padding: '5px 8px 5px 4px',
              borderTop: ri > 0 ? `1px solid ${T.slate200}` : undefined,
            }}>
              <span style={{ fontSize: 10, color: T.slate500 }}>{label}</span>
            </div>
            {scenarios.map((sc) => {
              const pal = PAL[sc.key as PalKey];
              const val = sc[key] as number;
              return (
                <div key={sc.id} style={{
                  padding: '5px 6px',
                  borderTop: ri > 0 ? `1px solid ${T.slate200}` : undefined,
                  borderLeft: `1px solid ${pal.border}`,
                  minWidth: 0,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                    <div style={{
                      flex: 1, height: 6, background: T.slate200, borderRadius: 3, minWidth: 0,
                    }}>
                      <div style={{
                        width: `${val}%`, height: '100%', background: pal.main, borderRadius: 3,
                        transition: 'width 0.4s ease',
                      }}/>
                    </div>
                    <span style={{ fontSize: 9.5, fontWeight: 700, color: T.slate700, flexShrink: 0 }}>
                      {val}
                    </span>
                  </div>
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

// ─── SCENARIO SUMMARY CARD ────────────────────────────────────────────

const ScenarioSummaryCard: React.FC<{ sc: ImplantationScenarioFull }> = ({ sc }) => {
  const pal = PAL[sc.key as PalKey];
  const [open, setOpen] = useState(false);
  return (
    <div style={{
      border: `1px solid ${pal.border}`,
      borderRadius: 10, overflow: 'hidden',
      background: T.white,
    }}>
      {/* Header cliquable */}
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%', background: pal.light, border: 'none', cursor: 'pointer',
          padding: '8px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          fontFamily: 'Inter,system-ui,sans-serif',
        }}
      >
        <span style={{ fontSize: 10, fontWeight: 700, color: pal.main, textAlign: 'left', minWidth: 0, flex: 1, wordBreak: 'break-word' }}>
          {sc.title}
        </span>
        <span style={{ fontSize: 11, color: T.slate400, marginLeft: 6, flexShrink: 0 }}>{open ? '▲' : '▼'}</span>
      </button>
      {/* Description toujours visible */}
      <div style={{ padding: '8px 10px 4px' }}>
        <p style={{
          fontSize: 10, color: T.slate600, lineHeight: 1.5, margin: 0,
          wordBreak: 'break-word', overflowWrap: 'anywhere',
        }}>
          {sc.description}
        </p>
      </div>
      {/* Détail dépliable */}
      {open && (
        <div style={{ padding: '4px 10px 10px' }}>
          {sc.strengths.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: T.green, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>
                Points forts
              </div>
              {sc.strengths.map((s, i) => (
                <div key={i} style={{ fontSize: 9.5, color: T.slate700, marginBottom: 2, paddingLeft: 8, wordBreak: 'break-word' }}>
                  — {s}
                </div>
              ))}
            </div>
          )}
          {sc.vigilance.length > 0 && (
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: T.amber, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>
                Vigilances
              </div>
              {sc.vigilance.map((v, i) => (
                <div key={i} style={{ fontSize: 9.5, color: T.slate700, marginBottom: 2, paddingLeft: 8, wordBreak: 'break-word' }}>
                  — {v}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ─── MAIN : SCENARIO COMPARISON GRID ─────────────────────────────────

export interface ScenarioComparisonGridProps {
  scenarios:          ImplantationScenarioFull[];
  activeScenarioKey:  string | null;
  onSelectScenario:   (key: string) => void;
  onPreviewScenario?: (key: string | null) => void;
  previewScenarioKey?: string | null;
}

export const ScenarioComparisonGrid: React.FC<ScenarioComparisonGridProps> = ({
  scenarios, activeScenarioKey, onSelectScenario, onPreviewScenario, previewScenarioKey,
}) => {
  if (!scenarios.length) return null;

  // ── Ligne métriques ──────────────────────────────────────────────
  const metricRows: MetricRow[] = [
    {
      label:  'Emprise bâtiments',
      values: scenarios.map(sc => fmt(sc.empriseM2, ' m²')),
      bold:   scenarios.map(() => true),
    },
    {
      label:  'CES utilisé',
      values: scenarios.map(sc => fmtPct(sc.cesPct)),
    },
    {
      label:  'SHON estimée',
      values: scenarios.map(sc => fmt(sc.totalFloorsAreaM2, ' m²')),
    },
    {
      label:  'Nb bâtiments',
      values: scenarios.map(sc => `${sc.buildingCount}`),
    },
    {
      label:  'Places requises',
      values: scenarios.map(sc => `${sc.parkingRequired}`),
    },
    {
      label:  'Places fournies',
      values: scenarios.map(sc => `${sc.parkingProvided}`),
      colors: scenarios.map(sc =>
        sc.parkingProvided >= sc.parkingRequired ? T.green : T.red
      ),
      bold:   scenarios.map(() => true),
    },
    ...(scenarios[0]?.financial ? [{
      label:  'CA brut estimé',
      values: scenarios.map(sc => fmtEur(sc.financial!.revenueEur)),
    }, {
      label:  'Marge brute',
      values: scenarios.map(sc => fmtEur(sc.financial!.grossMarginEur)),
      colors: scenarios.map(sc =>
        (sc.financial!.grossMarginEur > 0) ? T.green : T.red
      ),
      bold:   scenarios.map(() => true),
    }] : []),
  ];

  return (
    <div style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* ── 1. EN-TÊTES : 3 colonnes ─────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gap: 8,
        padding: '10px 12px 8px',
      }}>
        {scenarios.map(sc => (
          <ScenarioHeaderCard
            key={sc.id}
            sc={sc}
            isActive={activeScenarioKey === sc.key}
            onClick={() => onSelectScenario(sc.key)}
          />
        ))}
      </div>

      {/* ── 2. GRILLE MÉTRIQUES ──────────────────────────────────── */}
      <div style={{ padding: '0 12px 0' }}>
        <div style={{
          border: `1px solid ${T.slate200}`,
          borderRadius: 10, overflow: 'hidden',
        }}>
          {/* En-tête de colonne */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0,1.1fr) repeat(3, minmax(0,1fr))',
            background: T.slate100,
            borderBottom: `1px solid ${T.slate200}`,
          }}>
            <div style={{ padding: '6px 4px' }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: T.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Indicateur
              </span>
            </div>
            {scenarios.map(sc => (
              <div key={sc.id} style={{ padding: '6px 6px', borderLeft: `2px solid ${PAL[sc.key as PalKey].main}`, minWidth: 0 }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: PAL[sc.key as PalKey].main, wordBreak: 'break-word' }}>
                  {sc.key === 'balanced' ? 'Équilibré' : sc.key === 'max_potential' ? 'Max' : 'Sécurisé'}
                </span>
              </div>
            ))}
          </div>
          {/* Lignes de données */}
          <MetricGrid rows={metricRows} scenarios={scenarios}/>
        </div>
      </div>

      {/* ── 3. SCORES VISUELS ────────────────────────────────────── */}
      <div style={{ padding: '8px 12px 0' }}>
        <div style={{
          border: `1px solid ${T.slate200}`,
          borderRadius: 10, overflow: 'hidden', padding: '4px 4px',
        }}>
          <ScenarioVisualScores scenarios={scenarios}/>
        </div>
      </div>

      {/* ── 4. CARTES SYNTHÈSE : 3 colonnes ─────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gap: 8,
        padding: '8px 12px 12px',
      }}>
        {scenarios.map(sc => (
          <ScenarioSummaryCard key={sc.id} sc={sc}/>
        ))}
      </div>

      {/* ── 5. ACTIONS ───────────────────────────────────────────── */}
      {onPreviewScenario && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0,1fr))',
          gap: 8,
          padding: '0 12px 12px',
        }}>
          {scenarios.map(sc => {
            const pal = PAL[sc.key as PalKey];
            const isPrev = previewScenarioKey === sc.key;
            return (
              <button key={sc.id}
                onClick={() => onPreviewScenario(isPrev ? null : sc.key)}
                style={{
                  padding: '6px 4px', borderRadius: 7, cursor: 'pointer', fontSize: 10,
                  fontWeight: 700, border: `1.5px solid ${pal.main}`,
                  background: isPrev ? pal.main : pal.light,
                  color: isPrev ? T.white : pal.main,
                  wordBreak: 'break-word', fontFamily: 'inherit',
                  transition: 'all 0.15s',
                }}
              >
                {isPrev ? 'Quitter apercu' : 'Voir sur le plan'}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ScenarioComparisonGrid;