// src/spaces/investisseur/pages/RentabilitePage.tsx

import React, { useState, useEffect, useMemo } from 'react';
import type {
  RentabiliteFormStrings,
  RentabiliteResult,
  RentabiliteScenarios,
  RentabiliteStressTests,
  RentabiliteSnapshot,
  RentabiliteDecision,
} from '../types/rentabilite.types';
import { DEFAULT_FORM } from '../types/rentabilite.types';
import {
  formToInput,
  computeAll,
  formatEUR,
  formatPct,
} from '../engine/rentabilite.engine';
import { useInvestisseurRentabiliteTick } from '../hooks/useInvestisseurRentabiliteTick';
import { getDealContextSnapshot } from '../../marchand/shared/marchandDealContext.store';

/* ================================================================== */
/*  Styles                                                             */
/* ================================================================== */

const S = {
  page: {
    display: 'flex',
    gap: 32,
    padding: 24,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: '#1e293b',
    minHeight: '100vh',
    alignItems: 'flex-start',
  } as React.CSSProperties,
  left: {
    flex: '1 1 420px',
    maxWidth: 520,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 20,
  } as React.CSSProperties,
  right: {
    flex: '1 1 480px',
    position: 'sticky' as const,
    top: 24,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 20,
    maxHeight: 'calc(100vh - 48px)',
    overflowY: 'auto' as const,
  } as React.CSSProperties,
  card: {
    background: '#fff',
    borderRadius: 12,
    border: '1px solid #e2e8f0',
    padding: 20,
  } as React.CSSProperties,
  cardTitle: {
    fontSize: 15,
    fontWeight: 700,
    marginBottom: 16,
    color: '#334155',
  } as React.CSSProperties,
  headerBanner: {
    background: 'linear-gradient(135deg, #1e293b 0%, #334155 100%)',
    color: '#fff',
    padding: '16px 20px',
    borderRadius: 12,
    marginBottom: 4,
  } as React.CSSProperties,
  headerTitle: {
    fontSize: 18,
    fontWeight: 700,
    marginBottom: 4,
  } as React.CSSProperties,
  headerSub: {
    fontSize: 13,
    opacity: 0.8,
  } as React.CSSProperties,
  noDeal: {
    background: '#fef3c7',
    border: '1px solid #f59e0b',
    borderRadius: 12,
    padding: 24,
    textAlign: 'center' as const,
    fontSize: 14,
    color: '#92400e',
    marginTop: 40,
  } as React.CSSProperties,
  noSnap: {
    background: '#eff6ff',
    border: '1px solid #93c5fd',
    borderRadius: 8,
    padding: 12,
    fontSize: 13,
    color: '#1e40af',
    textAlign: 'center' as const,
  } as React.CSSProperties,
  label: {
    display: 'block',
    fontSize: 12,
    fontWeight: 600,
    color: '#64748b',
    marginBottom: 4,
  } as React.CSSProperties,
  input: {
    width: '100%',
    padding: '8px 10px',
    borderRadius: 8,
    border: '1px solid #cbd5e1',
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box' as const,
  } as React.CSSProperties,
  row: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 12,
  } as React.CSSProperties,
  toggle: (active: boolean) => ({
    flex: 1,
    padding: '8px 0',
    borderRadius: 8,
    border: active ? '2px solid #3b82f6' : '1px solid #cbd5e1',
    background: active ? '#eff6ff' : '#fff',
    color: active ? '#1d4ed8' : '#64748b',
    fontWeight: active ? 700 : 500,
    fontSize: 13,
    cursor: 'pointer',
    textAlign: 'center' as const,
  } as React.CSSProperties),
  btn: {
    width: '100%',
    padding: '12px 0',
    borderRadius: 10,
    border: 'none',
    background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
    color: '#fff',
    fontWeight: 700,
    fontSize: 14,
    cursor: 'pointer',
    marginTop: 8,
  } as React.CSSProperties,
  btnSecondary: {
    width: '100%',
    padding: '10px 0',
    borderRadius: 10,
    border: '1px solid #e2e8f0',
    background: '#fff',
    color: '#64748b',
    fontWeight: 600,
    fontSize: 13,
    cursor: 'pointer',
    marginTop: 6,
  } as React.CSSProperties,
  kpiGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 10,
  } as React.CSSProperties,
  kpiBox: {
    background: '#f8fafc',
    borderRadius: 10,
    padding: '12px 14px',
    border: '1px solid #e2e8f0',
  } as React.CSSProperties,
  kpiLabel: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  } as React.CSSProperties,
  kpiValue: {
    fontSize: 18,
    fontWeight: 800,
    color: '#1e293b',
    marginTop: 2,
  } as React.CSSProperties,
  badge: (decision: RentabiliteDecision) => {
    const colors: Record<RentabiliteDecision, string> = {
      GO: '#16a34a',
      GO_AVEC_RESERVES: '#f59e0b',
      NO_GO: '#dc2626',
    };
    return {
      display: 'inline-block',
      padding: '6px 14px',
      borderRadius: 20,
      background: colors[decision],
      color: '#fff',
      fontWeight: 700,
      fontSize: 13,
      letterSpacing: 0.5,
    } as React.CSSProperties;
  },
  scenarioTable: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: 13,
  } as React.CSSProperties,
  th: {
    textAlign: 'left' as const,
    padding: '8px 10px',
    borderBottom: '2px solid #e2e8f0',
    fontWeight: 700,
    fontSize: 12,
    color: '#64748b',
    textTransform: 'uppercase' as const,
  } as React.CSSProperties,
  td: {
    padding: '8px 10px',
    borderBottom: '1px solid #f1f5f9',
    fontVariantNumeric: 'tabular-nums',
  } as React.CSSProperties,
  reasonsList: {
    margin: '8px 0 0',
    paddingLeft: 18,
    fontSize: 13,
    color: '#475569',
  } as React.CSSProperties,
};

/* ================================================================== */
/*  Sub-components                                                     */
/* ================================================================== */

function Field({
  label,
  value,
  onChange,
  placeholder,
  suffix,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  suffix?: string;
}) {
  return (
    <div>
      <label style={S.label}>{label}</label>
      <div style={{ position: 'relative' }}>
        <input
          style={S.input}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
        {suffix && (
          <span
            style={{
              position: 'absolute',
              right: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              fontSize: 12,
              color: '#94a3b8',
              pointerEvents: 'none',
            }}
          >
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

function KpiCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={S.kpiBox}>
      <div style={S.kpiLabel}>{label}</div>
      <div style={{ ...S.kpiValue, ...(color ? { color } : {}) }}>{value}</div>
    </div>
  );
}

function DecisionBadge({ result }: { result: RentabiliteResult }) {
  const labels: Record<RentabiliteDecision, string> = {
    GO: '✅ GO',
    GO_AVEC_RESERVES: '⚠️ GO avec réserves',
    NO_GO: '❌ NO GO',
  };
  return (
    <div style={{ marginBottom: 12 }}>
      <span style={S.badge(result.decision)}>{labels[result.decision]}</span>
      {result.reasons.length > 0 && (
        <ul style={S.reasonsList}>
          {result.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ScenarioTable({
  scenarios,
  strategy,
}: {
  scenarios: RentabiliteScenarios;
  strategy: string;
}) {
  const rows = [
    { label: 'Scénario', base: 'Base', opti: 'Optimiste', pessi: 'Pessimiste' },
    { label: 'Coût total', base: formatEUR(scenarios.base.coutTotal), opti: formatEUR(scenarios.optimiste.coutTotal), pessi: formatEUR(scenarios.pessimiste.coutTotal) },
    ...(strategy === 'revente'
      ? [
          { label: 'Marge brute', base: formatEUR(scenarios.base.margeBrute), opti: formatEUR(scenarios.optimiste.margeBrute), pessi: formatEUR(scenarios.pessimiste.margeBrute) },
          { label: 'Marge %', base: formatPct(scenarios.base.margePct), opti: formatPct(scenarios.optimiste.margePct), pessi: formatPct(scenarios.pessimiste.margePct) },
          { label: 'TRI %', base: formatPct(scenarios.base.triPct), opti: formatPct(scenarios.optimiste.triPct), pessi: formatPct(scenarios.pessimiste.triPct) },
        ]
      : [
          { label: 'Cashflow /mois', base: formatEUR(scenarios.base.cashflowMensuel), opti: formatEUR(scenarios.optimiste.cashflowMensuel), pessi: formatEUR(scenarios.pessimiste.cashflowMensuel) },
          { label: 'Rdt brut %', base: formatPct(scenarios.base.rendementBrutPct), opti: formatPct(scenarios.optimiste.rendementBrutPct), pessi: formatPct(scenarios.pessimiste.rendementBrutPct) },
        ]),
    { label: 'Décision', base: scenarios.base.decision, opti: scenarios.optimiste.decision, pessi: scenarios.pessimiste.decision },
  ];

  return (
    <table style={S.scenarioTable}>
      <thead>
        <tr>
          <th style={S.th} />
          <th style={S.th}>Base</th>
          <th style={S.th}>Optimiste</th>
          <th style={S.th}>Pessimiste</th>
        </tr>
      </thead>
      <tbody>
        {rows.slice(1).map((r, i) => (
          <tr key={i}>
            <td style={{ ...S.td, fontWeight: 600, color: '#475569' }}>{r.label}</td>
            <td style={S.td}>{r.base}</td>
            <td style={S.td}>{r.opti}</td>
            <td style={S.td}>{r.pessi}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StressTable({
  stressTests,
  strategy,
}: {
  stressTests: RentabiliteStressTests;
  strategy: string;
}) {
  const rows = strategy === 'revente'
    ? [
        { label: 'Marge brute', a: formatEUR(stressTests.reventeMoins5.margeBrute), b: formatEUR(stressTests.travauxPlus10.margeBrute) },
        { label: 'Marge %', a: formatPct(stressTests.reventeMoins5.margePct), b: formatPct(stressTests.travauxPlus10.margePct) },
        { label: 'Décision', a: stressTests.reventeMoins5.decision, b: stressTests.travauxPlus10.decision },
      ]
    : [
        { label: 'Cashflow /mois', a: formatEUR(stressTests.reventeMoins5.cashflowMensuel), b: formatEUR(stressTests.travauxPlus10.cashflowMensuel) },
        { label: 'Décision', a: stressTests.reventeMoins5.decision, b: stressTests.travauxPlus10.decision },
      ];

  return (
    <table style={S.scenarioTable}>
      <thead>
        <tr>
          <th style={S.th} />
          <th style={S.th}>Revente −5 %</th>
          <th style={S.th}>Travaux +10 %</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td style={{ ...S.td, fontWeight: 600, color: '#475569' }}>{r.label}</td>
            <td style={S.td}>{r.a}</td>
            <td style={S.td}>{r.b}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ================================================================== */
/*  Main Page                                                          */
/* ================================================================== */

export default function RentabilitePage() {
  // Deal context
  const dealCtx = useMemo(() => getDealContextSnapshot(), []);
  const dealId = dealCtx?.activeDealId ?? null;
  const meta = dealCtx?.meta ?? null;

  // Store
  const { snapshot, save, clear } = useInvestisseurRentabiliteTick(dealId);

  // Form state
  const [form, setForm] = useState<RentabiliteFormStrings>({ ...DEFAULT_FORM });
  const [computed, setComputed] = useState<{
    scenarios: RentabiliteScenarios;
    stressTests: RentabiliteStressTests;
  } | null>(null);

  // On mount / deal change: load snapshot OR prefill from deal context
  useEffect(() => {
    if (!dealId) return;

    if (snapshot) {
      // Restore form from snapshot input
      const inp = snapshot.input;
      setForm({
        strategy: inp.strategy,
        prixAchat: inp.prixAchat ? String(inp.prixAchat) : '',
        fraisNotairePct: String(inp.fraisNotairePct),
        budgetTravaux: inp.budgetTravaux ? String(inp.budgetTravaux) : '',
        fraisDivers: inp.fraisDivers ? String(inp.fraisDivers) : '',
        dureeMois: String(inp.dureeMois),
        surface: inp.surface ? String(inp.surface) : '',
        prixReventeCible: inp.prixReventeCible ? String(inp.prixReventeCible) : '',
        loyerMensuel: inp.loyerMensuel ? String(inp.loyerMensuel) : '',
        chargesMensuelles: inp.chargesMensuelles ? String(inp.chargesMensuelles) : '',
        taxeFoncieresAnnuelle: inp.taxeFoncieresAnnuelle ? String(inp.taxeFoncieresAnnuelle) : '',
        tmiPct: String(inp.tmiPct),
        taxFlatPct: String(inp.taxFlatPct),
        useFlatTax: inp.useFlatTax,
        apport: inp.apport ? String(inp.apport) : '',
      });
      setComputed({ scenarios: snapshot.scenarios, stressTests: snapshot.stressTests });
    } else if (meta) {
      // Prefill from deal context
      setForm((prev) => ({
        ...prev,
        prixAchat: meta.purchasePrice ? String(meta.purchasePrice) : prev.prixAchat,
        surface: meta.surface ? String(meta.surface) : prev.surface,
        prixReventeCible: meta.resaleTarget ? String(meta.resaleTarget) : prev.prixReventeCible,
      }));
      setComputed(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  // No deal guard
  if (!dealId) {
    return (
      <div style={{ padding: 40 }}>
        <div style={S.noDeal}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>📋</div>
          <strong>Aucun deal actif</strong>
          <p style={{ margin: '8px 0 0', fontSize: 13 }}>
            Sélectionnez un deal dans Pipeline pour accéder à l'analyse de rentabilité.
          </p>
        </div>
      </div>
    );
  }

  // Handlers
  const updateField = (key: keyof RentabiliteFormStrings) => (value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleCompute = () => {
    const input = formToInput(form);
    const { scenarios, stressTests } = computeAll(input);
    setComputed({ scenarios, stressTests });

    const snap: RentabiliteSnapshot = {
      input,
      scenarios,
      stressTests,
      updatedAt: new Date().toISOString(),
    };
    save(snap);
  };

  const handleClear = () => {
    clear();
    setForm({ ...DEFAULT_FORM });
    setComputed(null);
  };

  const isLocation = form.strategy === 'location';

  return (
    <div style={S.page}>
      {/* ==================== LEFT: FORM ==================== */}
      <div style={S.left}>
        {/* Header */}
        <div style={S.headerBanner}>
          <div style={S.headerTitle}>Analyse de rentabilité</div>
          <div style={S.headerSub}>
            {meta?.address ? `${meta.address}, ` : ''}
            {meta?.zipCode ?? ''} {meta?.city ?? ''}
            {meta?.title ? ` — ${meta.title}` : ''}
          </div>
        </div>

        {/* Strategy toggle */}
        <div style={S.card}>
          <div style={S.cardTitle}>Stratégie</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              style={S.toggle(form.strategy === 'revente')}
              onClick={() => setForm((p) => ({ ...p, strategy: 'revente' }))}
            >
              Revente
            </button>
            <button
              style={S.toggle(form.strategy === 'location')}
              onClick={() => setForm((p) => ({ ...p, strategy: 'location' }))}
            >
              Location
            </button>
          </div>
        </div>

        {/* Main params */}
        <div style={S.card}>
          <div style={S.cardTitle}>Paramètres</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={S.row}>
              <Field label="Prix d'achat" value={form.prixAchat} onChange={updateField('prixAchat')} suffix="€" placeholder="200 000" />
              <Field label="Frais notaire" value={form.fraisNotairePct} onChange={updateField('fraisNotairePct')} suffix="%" />
            </div>
            <div style={S.row}>
              <Field label="Budget travaux" value={form.budgetTravaux} onChange={updateField('budgetTravaux')} suffix="€" placeholder="30 000" />
              <Field label="Frais divers" value={form.fraisDivers} onChange={updateField('fraisDivers')} suffix="€" placeholder="5 000" />
            </div>
            <div style={S.row}>
              <Field label="Durée projet" value={form.dureeMois} onChange={updateField('dureeMois')} suffix="mois" />
              <Field label="Surface" value={form.surface} onChange={updateField('surface')} suffix="m²" />
            </div>
            <Field label="Prix de revente cible" value={form.prixReventeCible} onChange={updateField('prixReventeCible')} suffix="€" placeholder="300 000" />
            <Field label="Apport personnel" value={form.apport} onChange={updateField('apport')} suffix="€" placeholder="50 000" />

            {isLocation && (
              <>
                <div style={{ borderTop: '1px solid #e2e8f0', margin: '4px 0' }} />
                <div style={S.row}>
                  <Field label="Loyer mensuel" value={form.loyerMensuel} onChange={updateField('loyerMensuel')} suffix="€" placeholder="900" />
                  <Field label="Charges mensuelles" value={form.chargesMensuelles} onChange={updateField('chargesMensuelles')} suffix="€" placeholder="150" />
                </div>
                <Field label="Taxe foncière annuelle" value={form.taxeFoncieresAnnuelle} onChange={updateField('taxeFoncieresAnnuelle')} suffix="€" placeholder="800" />
              </>
            )}
          </div>
        </div>

        {/* Fiscalité */}
        <div style={S.card}>
          <div style={S.cardTitle}>Fiscalité</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button
              style={S.toggle(form.useFlatTax)}
              onClick={() => setForm((p) => ({ ...p, useFlatTax: true }))}
            >
              Flat Tax (PFU)
            </button>
            <button
              style={S.toggle(!form.useFlatTax)}
              onClick={() => setForm((p) => ({ ...p, useFlatTax: false }))}
            >
              TMI (barème)
            </button>
          </div>
          <div style={S.row}>
            <Field label="Flat Tax" value={form.taxFlatPct} onChange={updateField('taxFlatPct')} suffix="%" />
            <Field label="TMI" value={form.tmiPct} onChange={updateField('tmiPct')} suffix="%" />
          </div>
        </div>

        {/* Actions */}
        <button style={S.btn} onClick={handleCompute}>
          Calculer &amp; enregistrer
        </button>
        <button style={S.btnSecondary} onClick={handleClear}>
          Réinitialiser
        </button>
      </div>

      {/* ==================== RIGHT: RESULTS ==================== */}
      <div style={S.right}>
        {!computed && !snapshot && (
          <div style={S.noSnap}>Aucune donnée enregistrée pour ce deal. Remplissez le formulaire et cliquez sur « Calculer ».</div>
        )}

        {computed && (
          <>
            {/* Decision */}
            <div style={S.card}>
              <div style={S.cardTitle}>Décision</div>
              <DecisionBadge result={computed.scenarios.base} />
            </div>

            {/* KPIs */}
            <div style={S.card}>
              <div style={S.cardTitle}>KPIs — Scénario de base</div>
              <div style={S.kpiGrid}>
                <KpiCard label="Coût total" value={formatEUR(computed.scenarios.base.coutTotal)} />
                {!isLocation && (
                  <>
                    <KpiCard label="Marge brute" value={formatEUR(computed.scenarios.base.margeBrute)} color={computed.scenarios.base.margeBrute >= 0 ? '#16a34a' : '#dc2626'} />
                    <KpiCard label="Marge %" value={formatPct(computed.scenarios.base.margePct)} />
                    <KpiCard label="TRI annualisé" value={formatPct(computed.scenarios.base.triPct)} />
                    {computed.scenarios.base.roiPct > 0 && (
                      <KpiCard label="ROI / apport" value={formatPct(computed.scenarios.base.roiPct)} />
                    )}
                  </>
                )}
                {isLocation && (
                  <>
                    <KpiCard label="Cashflow /mois" value={formatEUR(computed.scenarios.base.cashflowMensuel)} color={computed.scenarios.base.cashflowMensuel >= 0 ? '#16a34a' : '#dc2626'} />
                    <KpiCard label="Rendement brut" value={formatPct(computed.scenarios.base.rendementBrutPct)} />
                    <KpiCard label="Frais notaire" value={formatEUR(computed.scenarios.base.fraisNotaire)} />
                  </>
                )}
              </div>
            </div>

            {/* Scenarios */}
            <div style={S.card}>
              <div style={S.cardTitle}>Scénarios</div>
              <ScenarioTable scenarios={computed.scenarios} strategy={form.strategy} />
            </div>

            {/* Stress tests */}
            <div style={S.card}>
              <div style={S.cardTitle}>Stress Tests</div>
              <StressTable stressTests={computed.stressTests} strategy={form.strategy} />
            </div>

            {/* Timestamp */}
            {snapshot?.updatedAt && (
              <div style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center' }}>
                Dernière sauvegarde : {new Date(snapshot.updatedAt).toLocaleString('fr-FR')}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}