// src/spaces/particulier/Capacite.tsx
import { useMemo, useState } from "react";

type Inputs = {
  revenusMensuels: number;
  chargesMensuelles: number;
  apport: number;
  tauxAnnuelPct: number;
  dureeAnnees: number;
};

const DEFAULTS: Inputs = {
  revenusMensuels: 4200,
  chargesMensuelles: 900,
  apport: 30000,
  tauxAnnuelPct: 3.6,
  dureeAnnees: 25,
};

function formatEUR(n: number) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function mensualiteMax(revenus: number, charges: number) {
  // règle simple 35% endettement
  const dispo = revenus * 0.35 - charges;
  return Math.round(Math.max(0, dispo));
}

function capaciteEmprunt(mensualite: number, tauxAnnuelPct: number, dureeAnnees: number) {
  const r = (tauxAnnuelPct / 100) / 12;
  const n = dureeAnnees * 12;
  if (r <= 0) return mensualite * n;
  // formule annuité : M = P * r / (1 - (1+r)^-n) => P = M * (1 - (1+r)^-n) / r
  return mensualite * (1 - Math.pow(1 + r, -n)) / r;
}

const Capacite: React.FC = () => {
  const [i, setI] = useState<Inputs>(DEFAULTS);

  const res = useMemo(() => {
    const revenus = Math.max(0, i.revenusMensuels || 0);
    const charges = Math.max(0, i.chargesMensuelles || 0);
    const taux = clamp(i.tauxAnnuelPct || 0, 0, 15);
    const duree = clamp(i.dureeAnnees || 0, 5, 35);
    const apport = Math.max(0, i.apport || 0);

    const mMax = mensualiteMax(revenus, charges);
    const cap = capaciteEmprunt(mMax, taux, duree);
    const budgetTotal = cap + apport;

    return {
      mensualiteMax: mMax,
      capacite: Math.round(cap),
      budgetTotal: Math.round(budgetTotal),
    };
  }, [i]);

  return (
    <div style={pageStyle}>
      <div style={headerStyle}>
        <div>
          <div style={kickerStyle}>FINANCEMENT</div>
          <h1 style={titleStyle}>Capacité</h1>
          <p style={subtitleStyle}>Calcul indicatif (à affiner avec assurance, taux réel, banques).</p>
        </div>
      </div>

      <div style={gridStyle}>
        <div style={cardStyle}>
          <h2 style={cardTitleStyle}>Paramètres</h2>

          <div style={formGridStyle}>
            <Field label="Revenus (mensuel)">
              <NumberInput value={i.revenusMensuels} onChange={(v) => setI((p) => ({ ...p, revenusMensuels: v }))} />
            </Field>
            <Field label="Charges (mensuel)">
              <NumberInput value={i.chargesMensuelles} onChange={(v) => setI((p) => ({ ...p, chargesMensuelles: v }))} />
            </Field>
            <Field label="Apport">
              <NumberInput value={i.apport} onChange={(v) => setI((p) => ({ ...p, apport: v }))} />
            </Field>
            <Field label="Taux annuel (%)">
              <NumberInput value={i.tauxAnnuelPct} onChange={(v) => setI((p) => ({ ...p, tauxAnnuelPct: v }))} step={0.1} />
            </Field>
            <Field label="Durée (années)">
              <NumberInput value={i.dureeAnnees} onChange={(v) => setI((p) => ({ ...p, dureeAnnees: v }))} />
            </Field>
          </div>

          <div style={actionsStyle}>
            <button type="button" style={btnSecondaryStyle} onClick={() => setI(DEFAULTS)}>
              Réinitialiser
            </button>
          </div>
        </div>

        <div style={cardStyle}>
          <h2 style={cardTitleStyle}>Résultat</h2>

          <div style={kpiRowStyle}>
            <Kpi label="Mensualité max (35%)" value={formatEUR(res.mensualiteMax)} />
            <Kpi label="Capacité d’emprunt" value={formatEUR(res.capacite)} />
            <Kpi label="Budget total (capacité + apport)" value={formatEUR(res.budgetTotal)} />
          </div>

          <div style={noteBoxStyle}>
            <div style={noteTitleStyle}>Attention</div>
            <ul style={notesListStyle}>
              <li>Ne comprend pas l’assurance emprunteur</li>
              <li>Ne comprend pas frais de notaire / garantie</li>
              <li>À ajuster selon la banque et le profil</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Capacite;

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label style={fieldStyle}>
    <div style={labelStyle}>{label}</div>
    {children}
  </label>
);

const NumberInput: React.FC<{ value: number; onChange: (v: number) => void; step?: number }> = ({
  value,
  onChange,
  step,
}) => (
  <input
    style={inputStyle}
    type="number"
    value={value}
    min={0}
    step={step ?? 1}
    onChange={(e) => onChange(Number(e.target.value || 0))}
  />
);

const Kpi: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div style={kpiStyle}>
    <div style={kpiLabelStyle}>{label}</div>
    <div style={kpiValueStyle}>{value}</div>
  </div>
);

// styles (copiés pour autonomie)
const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  padding: "28px 18px",
  background: "linear-gradient(135deg, #f8fafc 0%, #ffffff 45%, #eef2ff 100%)",
  color: "#0f172a",
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
};
const headerStyle: React.CSSProperties = { maxWidth: 1200, margin: "0 auto 18px auto", display: "flex", gap: 12 };
const kickerStyle: React.CSSProperties = { fontSize: 12, letterSpacing: 1.2, fontWeight: 800, color: "#64748b" };
const titleStyle: React.CSSProperties = { fontSize: 30, lineHeight: 1.1, margin: "6px 0 6px 0" };
const subtitleStyle: React.CSSProperties = { margin: 0, color: "#475569", maxWidth: 760 };
const gridStyle: React.CSSProperties = { maxWidth: 1200, margin: "0 auto", display: "grid", gridTemplateColumns: "1.05fr 0.95fr", gap: 16 };
const cardStyle: React.CSSProperties = { background: "#fff", borderRadius: 14, border: "1px solid rgba(15,23,42,0.08)", boxShadow: "0 12px 35px rgba(2,6,23,0.06)", padding: 18 };
const cardTitleStyle: React.CSSProperties = { fontSize: 16, fontWeight: 800, margin: "0 0 12px 0" };
const formGridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 };
const fieldStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 6 };
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: "#334155" };
const inputStyle: React.CSSProperties = { height: 40, borderRadius: 10, border: "1px solid rgba(15,23,42,0.12)", padding: "0 12px", outline: "none", background: "#fff" };
const actionsStyle: React.CSSProperties = { marginTop: 14, display: "flex", justifyContent: "flex-end" };
const btnSecondaryStyle: React.CSSProperties = { height: 40, padding: "0 14px", borderRadius: 10, border: "1px solid rgba(15,23,42,0.12)", background: "#fff", color: "#0f172a", fontWeight: 800, cursor: "pointer" };
const kpiRowStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr", gap: 10 };
const kpiStyle: React.CSSProperties = { padding: 12, borderRadius: 12, background: "#f8fafc", border: "1px solid rgba(15,23,42,0.06)" };
const kpiLabelStyle: React.CSSProperties = { fontSize: 12, color: "#64748b", fontWeight: 700 };
const kpiValueStyle: React.CSSProperties = { marginTop: 6, fontSize: 18, fontWeight: 900 };
const noteBoxStyle: React.CSSProperties = { marginTop: 12, padding: 12, borderRadius: 12, border: "1px solid rgba(15,23,42,0.08)", background: "#f8fafc" };
const noteTitleStyle: React.CSSProperties = { fontSize: 12, fontWeight: 900, color: "#334155", marginBottom: 6 };
const notesListStyle: React.CSSProperties = { margin: 0, paddingLeft: 18, color: "#475569" };

