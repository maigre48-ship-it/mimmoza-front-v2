// src/spaces/particulier/Charges.tsx
import { useMemo, useState } from "react";

type ChargesInputs = {
  chargesCoproMensuelles: number;
  taxeFonciereAnnuelle: number;
  assuranceMensuelle: number;
  entretienMensuel: number;
  energieMensuelle: number;
};

const DEFAULT_INPUTS: ChargesInputs = {
  chargesCoproMensuelles: 160,
  taxeFonciereAnnuelle: 1100,
  assuranceMensuelle: 25,
  entretienMensuel: 40,
  energieMensuelle: 120,
};

function formatEUR(n: number) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
}

const Charges: React.FC = () => {
  const [inputs, setInputs] = useState<ChargesInputs>(DEFAULT_INPUTS);

  const totals = useMemo(() => {
    const mensuel =
      (inputs.chargesCoproMensuelles || 0) +
      (inputs.assuranceMensuelle || 0) +
      (inputs.entretienMensuel || 0) +
      (inputs.energieMensuelle || 0) +
      (inputs.taxeFonciereAnnuelle || 0) / 12;

    const annuel = mensuel * 12;

    return {
      mensuel: Math.round(mensuel),
      annuel: Math.round(annuel),
    };
  }, [inputs]);

  return (
    <div style={pageStyle}>
      <div style={headerStyle}>
        <div>
          <div style={kickerStyle}>ÉVALUATION</div>
          <h1 style={titleStyle}>Charges</h1>
          <p style={subtitleStyle}>
            Estimation simple des charges récurrentes liées au bien.
          </p>
        </div>
      </div>

      <div style={gridStyle}>
        <div style={cardStyle}>
          <h2 style={cardTitleStyle}>Postes de charges</h2>

          <div style={formGridStyle}>
            <Field label="Charges copro (mensuel)">
              <NumberInput
                value={inputs.chargesCoproMensuelles}
                onChange={(v) => setInputs((p) => ({ ...p, chargesCoproMensuelles: v }))}
              />
            </Field>

            <Field label="Taxe foncière (annuel)">
              <NumberInput
                value={inputs.taxeFonciereAnnuelle}
                onChange={(v) => setInputs((p) => ({ ...p, taxeFonciereAnnuelle: v }))}
              />
            </Field>

            <Field label="Assurance (mensuel)">
              <NumberInput
                value={inputs.assuranceMensuelle}
                onChange={(v) => setInputs((p) => ({ ...p, assuranceMensuelle: v }))}
              />
            </Field>

            <Field label="Entretien (mensuel)">
              <NumberInput
                value={inputs.entretienMensuel}
                onChange={(v) => setInputs((p) => ({ ...p, entretienMensuel: v }))}
              />
            </Field>

            <Field label="Énergie (mensuel)">
              <NumberInput
                value={inputs.energieMensuelle}
                onChange={(v) => setInputs((p) => ({ ...p, energieMensuelle: v }))}
              />
            </Field>
          </div>

          <div style={actionsStyle}>
            <button type="button" style={btnSecondaryStyle} onClick={() => setInputs(DEFAULT_INPUTS)}>
              Réinitialiser
            </button>
          </div>
        </div>

        <div style={cardStyle}>
          <h2 style={cardTitleStyle}>Synthèse</h2>

          <div style={kpiRowStyle}>
            <Kpi label="Charges mensuelles estimées" value={formatEUR(totals.mensuel)} />
            <Kpi label="Charges annuelles estimées" value={formatEUR(totals.annuel)} />
          </div>

          <div style={noteBoxStyle}>
            <div style={noteTitleStyle}>À brancher ensuite</div>
            <ul style={notesListStyle}>
              <li>Historique charges copro (PV AG, relevés)</li>
              <li>Taxe foncière réelle (avis)</li>
              <li>Prise en compte DPE / surface / usage</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Charges;

// -----------------------------------------------------------------------------
// Small components
// -----------------------------------------------------------------------------

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label style={fieldStyle}>
    <div style={labelStyle}>{label}</div>
    {children}
  </label>
);

const NumberInput: React.FC<{ value: number; onChange: (v: number) => void }> = ({ value, onChange }) => (
  <input
    style={inputStyle}
    type="number"
    value={value}
    min={0}
    onChange={(e) => onChange(Number(e.target.value || 0))}
  />
);

const Kpi: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div style={kpiStyle}>
    <div style={kpiLabelStyle}>{label}</div>
    <div style={kpiValueStyle}>{value}</div>
  </div>
);

// -----------------------------------------------------------------------------
// Styles (identiques à Estimation pour cohérence)
// -----------------------------------------------------------------------------

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  padding: "28px 18px",
  background: "linear-gradient(135deg, #f8fafc 0%, #ffffff 45%, #eef2ff 100%)",
  color: "#0f172a",
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
};

const headerStyle: React.CSSProperties = {
  maxWidth: 1200,
  margin: "0 auto 18px auto",
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "space-between",
  gap: 12,
};

const kickerStyle: React.CSSProperties = {
  fontSize: 12,
  letterSpacing: 1.2,
  fontWeight: 800,
  color: "#64748b",
};

const titleStyle: React.CSSProperties = {
  fontSize: 30,
  lineHeight: 1.1,
  margin: "6px 0 6px 0",
};

const subtitleStyle: React.CSSProperties = {
  margin: 0,
  color: "#475569",
  maxWidth: 760,
};

const gridStyle: React.CSSProperties = {
  maxWidth: 1200,
  margin: "0 auto",
  display: "grid",
  gridTemplateColumns: "1.05fr 0.95fr",
  gap: 16,
};

const cardStyle: React.CSSProperties = {
  background: "#ffffff",
  borderRadius: 14,
  border: "1px solid rgba(15, 23, 42, 0.08)",
  boxShadow: "0 12px 35px rgba(2, 6, 23, 0.06)",
  padding: 18,
};

const cardTitleStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 800,
  margin: "0 0 12px 0",
};

const formGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 12,
};

const fieldStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: "#334155",
};

const inputStyle: React.CSSProperties = {
  height: 40,
  borderRadius: 10,
  border: "1px solid rgba(15, 23, 42, 0.12)",
  padding: "0 12px",
  outline: "none",
  background: "#ffffff",
};

const actionsStyle: React.CSSProperties = {
  marginTop: 14,
  display: "flex",
  justifyContent: "flex-end",
  gap: 10,
};

const btnSecondaryStyle: React.CSSProperties = {
  height: 40,
  padding: "0 14px",
  borderRadius: 10,
  border: "1px solid rgba(15, 23, 42, 0.12)",
  background: "#ffffff",
  color: "#0f172a",
  fontWeight: 800,
  cursor: "pointer",
};

const kpiRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr",
  gap: 10,
};

const kpiStyle: React.CSSProperties = {
  padding: 12,
  borderRadius: 12,
  background: "#f8fafc",
  border: "1px solid rgba(15, 23, 42, 0.06)",
};

const kpiLabelStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#64748b",
  fontWeight: 700,
};

const kpiValueStyle: React.CSSProperties = {
  marginTop: 6,
  fontSize: 18,
  fontWeight: 900,
};

const noteBoxStyle: React.CSSProperties = {
  marginTop: 12,
  padding: 12,
  borderRadius: 12,
  border: "1px solid rgba(15, 23, 42, 0.08)",
  background: "#f8fafc",
};

const noteTitleStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 900,
  color: "#334155",
  marginBottom: 6,
};

const notesListStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: 18,
  color: "#475569",
};

