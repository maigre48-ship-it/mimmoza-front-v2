import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { logParticulierEvent } from "../../../lib/particulierHistory";

type ProjectState = {
  budgetTotal: number | null;
  budgetNotaire: number | null;
  budgetTravaux: number | null;
  apport: number | null;
  loanDurationYears: number | null;
  loanRatePct: number | null;
};

type Scenario = {
  id: string;
  name: string;

  purchaseTarget: number | null;
  apport: number | null;
  durationYears: number | null;
  ratePct: number | null;

  insurancePct: number | null;
  notes: string;

  createdAt: string;
};

const PROJECT_KEY = "mimmoza.particulier.mon_projet.v1";
const SCENARIOS_KEY = "mimmoza.particulier.scenarios.v1";

const wrap: React.CSSProperties = { padding: 8 };

const headerRow: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 16,
  marginBottom: 14,
};

const titleStyle: React.CSSProperties = {
  margin: "4px 0 6px",
  fontSize: 22,
  fontWeight: 900,
  color: "#0f172a",
};

const subtitleStyle: React.CSSProperties = {
  margin: 0,
  color: "#475569",
  fontSize: 14,
  lineHeight: 1.45,
};

const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(420px, 1.1fr) minmax(360px, 0.9fr)",
  gap: 14,
  alignItems: "start",
};

const card: React.CSSProperties = {
  border: "1px solid rgba(15, 23, 42, 0.10)",
  borderRadius: 16,
  background: "#ffffff",
  padding: 14,
  boxShadow: "0 6px 18px rgba(15, 23, 42, 0.04)",
};

const sectionTitle: React.CSSProperties = {
  margin: "6px 0 10px",
  fontSize: 14,
  fontWeight: 900,
  color: "#0f172a",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 900,
  color: "#334155",
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(15, 23, 42, 0.12)",
  outline: "none",
  fontSize: 14,
  color: "#0f172a",
  background: "#ffffff",
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  minHeight: 90,
  resize: "vertical",
  lineHeight: 1.4,
};

const row: React.CSSProperties = {
  display: "flex",
  gap: 10,
  flexWrap: "wrap",
  alignItems: "center",
};

const btnPrimary: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(99, 102, 241, 0.35)",
  background: "rgba(99, 102, 241, 0.12)",
  fontWeight: 900,
  cursor: "pointer",
  color: "#0f172a",
};

const btnGhost: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(15, 23, 42, 0.12)",
  background: "#ffffff",
  fontWeight: 900,
  cursor: "pointer",
  color: "#0f172a",
};

const badge: React.CSSProperties = {
  padding: "6px 8px",
  borderRadius: 999,
  border: "1px solid rgba(15, 23, 42, 0.10)",
  background: "rgba(248, 250, 252, 0.85)",
  fontSize: 12,
  fontWeight: 900,
  color: "#0f172a",
};

const itemCard: React.CSSProperties = {
  border: "1px solid rgba(15, 23, 42, 0.10)",
  borderRadius: 16,
  background: "#ffffff",
  padding: 14,
  display: "grid",
  gap: 10,
};

function safeId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function parseNumberOrNull(v: string): number | null {
  const s = v.trim();
  if (!s) return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function formatMoney(n: number | null): string {
  if (n === null) return "—";
  try {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${n} €`;
  }
}

function formatPct(n: number | null): string {
  if (n === null) return "—";
  return `${n.toFixed(2)} %`;
}

function computeMonthlyPayment(principal: number, years: number, ratePct: number): number {
  const n = years * 12;
  const r = ratePct / 100 / 12;
  if (n <= 0) return 0;
  if (r <= 0) return principal / n;
  const denom = 1 - Math.pow(1 + r, -n);
  return denom === 0 ? 0 : (principal * r) / denom;
}

function loadProject(): ProjectState {
  const fallback: ProjectState = {
    budgetTotal: null,
    budgetNotaire: null,
    budgetTravaux: null,
    apport: null,
    loanDurationYears: null,
    loanRatePct: null,
  };
  try {
    const raw = localStorage.getItem(PROJECT_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as any;
    return {
      budgetTotal: parsed.budgetTotal ?? null,
      budgetNotaire: parsed.budgetNotaire ?? null,
      budgetTravaux: parsed.budgetTravaux ?? null,
      apport: parsed.apport ?? null,
      loanDurationYears: parsed.loanDurationYears ?? null,
      loanRatePct: parsed.loanRatePct ?? null,
    };
  } catch {
    return fallback;
  }
}

function loadScenarios(): Scenario[] {
  try {
    const raw = localStorage.getItem(SCENARIOS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Scenario[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveScenarios(items: Scenario[]) {
  try {
    localStorage.setItem(SCENARIOS_KEY, JSON.stringify(items));
  } catch {
    // ignore
  }
}

export default function Scenarios() {
  const project = useMemo(() => loadProject(), []);
  const [items, setItems] = useState<Scenario[]>(() => loadScenarios());

  // Form
  const [name, setName] = useState("Scénario");
  const [purchaseTarget, setPurchaseTarget] = useState<string>("");
  const [apport, setApport] = useState<string>("");
  const [duration, setDuration] = useState<string>("");
  const [rate, setRate] = useState<string>("");
  const [insurancePct, setInsurancePct] = useState<string>("0.30");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    saveScenarios(items);
  }, [items]);

  // Préremplissage depuis Mon projet (une fois)
  useEffect(() => {
    if (items.length > 0) return;

    const budgetTotal = project.budgetTotal ?? null;
    const notaire = project.budgetNotaire ?? 0;
    const travaux = project.budgetTravaux ?? 0;
    const purchase = budgetTotal === null ? null : Math.max(0, budgetTotal - notaire - travaux);

    const seed: Scenario = {
      id: safeId(),
      name: "Scénario de base (Mon projet)",
      purchaseTarget: purchase,
      apport: project.apport ?? null,
      durationYears: project.loanDurationYears ?? 20,
      ratePct: project.loanRatePct ?? 3.5,
      insurancePct: 0.3,
      notes: "",
      createdAt: new Date().toISOString(),
    };

    setItems([seed]);

    logParticulierEvent({
      type: "scenario_add",
      title: "Scénario initial créé",
      details: seed.name,
    });

    // Préremplir aussi le form
    setName("Scénario 2");
    setPurchaseTarget(purchase === null ? "" : String(Math.round(purchase)));
    setApport(project.apport === null ? "" : String(Math.round(project.apport)));
    setDuration(String(project.loanDurationYears ?? 20));
    setRate(String(project.loanRatePct ?? 3.5));
  }, [items.length, project]);

  function resetForm() {
    setName("Scénario");
    setPurchaseTarget("");
    setApport("");
    setDuration("");
    setRate("");
    setInsurancePct("0.30");
    setNotes("");
  }

  function addScenario() {
    const n = name.trim() || "Scénario";
    const sc: Scenario = {
      id: safeId(),
      name: n,
      purchaseTarget: parseNumberOrNull(purchaseTarget),
      apport: parseNumberOrNull(apport),
      durationYears: parseNumberOrNull(duration),
      ratePct: parseNumberOrNull(rate),
      insurancePct: parseNumberOrNull(insurancePct),
      notes: notes.trim(),
      createdAt: new Date().toISOString(),
    };

    setItems((prev) => [sc, ...prev]);
    logParticulierEvent({ type: "scenario_add", title: "Scénario ajouté", details: sc.name });
    resetForm();
  }

  function removeScenario(id: string) {
    const target = items.find((x) => x.id === id);
    const ok = window.confirm("Supprimer ce scénario ?");
    if (!ok) return;
    setItems((prev) => prev.filter((x) => x.id !== id));
    logParticulierEvent({
      type: "scenario_remove",
      title: "Scénario supprimé",
      details: target ? target.name : `ID=${id}`,
    });
  }

  function clearAll() {
    const ok = window.confirm("Supprimer tous les scénarios ? Cette action est irréversible.");
    if (!ok) return;
    setItems([]);
    logParticulierEvent({ type: "scenario_remove", title: "Scénarios supprimés", details: "Purge" });
  }

  const computed = useMemo(() => {
    return items.map((s) => {
      const purchase = s.purchaseTarget ?? null;
      const ap = s.apport ?? 0;
      const loan = purchase === null ? null : Math.max(0, purchase - ap);

      const years = s.durationYears ?? null;
      const ratePct = s.ratePct ?? null;

      const monthly =
        loan !== null && years !== null && ratePct !== null
          ? computeMonthlyPayment(loan, years, ratePct)
          : null;

      const totalPaid = monthly !== null && years !== null ? monthly * years * 12 : null;
      const interestCost = totalPaid !== null && loan !== null ? Math.max(0, totalPaid - loan) : null;

      const insuranceMonthly =
        loan !== null && s.insurancePct !== null ? (loan * (s.insurancePct / 100)) / 12 : null;

      const monthlyAll = monthly !== null ? Math.round(monthly + (insuranceMonthly ?? 0)) : null;

      return { scenario: s, loan, monthly, insuranceMonthly, monthlyAll, totalPaid, interestCost };
    });
  }, [items]);

  const summary = useMemo(() => {
    if (computed.length === 0) return null;
    const withMonthly = computed.filter((x) => x.monthlyAll !== null) as Array<
      typeof computed[number] & { monthlyAll: number }
    >;
    const best = withMonthly.length > 0 ? withMonthly.reduce((a, b) => (a.monthlyAll < b.monthlyAll ? a : b)) : null;
    return { best };
  }, [computed]);

  return (
    <div style={wrap}>
      <div style={headerRow}>
        <div>
          <h2 style={titleStyle}>Scénarios</h2>
          <p style={subtitleStyle}>
            Comparez plusieurs hypothèses de financement (apport, durée, taux). Les calculs sont indicatifs.
          </p>
        </div>

        <div style={row}>
          <Link to="/particulier/financement" style={{ ...btnGhost, textDecoration: "none", display: "inline-block" }}>
            Capacité
          </Link>
          <Link to="/particulier/dossier" style={{ ...btnGhost, textDecoration: "none", display: "inline-block" }}>
            Dossier banque
          </Link>
          <button type="button" style={btnGhost} onClick={clearAll} disabled={items.length === 0}>
            Tout supprimer
          </button>
        </div>
      </div>

      <div style={grid}>
        <div style={card}>
          <div style={sectionTitle}>Vos scénarios</div>

          {summary?.best ? (
            <div style={{ ...row, marginBottom: 12 }}>
              <span style={badge}>Recommandé (mensualité min)</span>
              <span style={badge}>{summary.best.scenario.name}</span>
              <span style={badge}>Mensualité: {formatMoney(summary.best.monthlyAll)}</span>
            </div>
          ) : null}

          <div style={{ display: "grid", gap: 10 }}>
            {computed.length === 0 ? (
              <div style={{ color: "#475569", lineHeight: 1.5 }}>
                Aucun scénario. Crée-en un à droite.
              </div>
            ) : (
              computed.map((x) => (
                <div key={x.scenario.id} style={itemCard}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <div>
                      <div style={{ fontWeight: 900, color: "#0f172a" }}>{x.scenario.name}</div>
                      <div style={{ color: "#64748b", fontSize: 12, marginTop: 4 }}>
                        {new Date(x.scenario.createdAt).toLocaleString("fr-FR")}
                      </div>
                    </div>

                    <button type="button" style={btnGhost} onClick={() => removeScenario(x.scenario.id)}>
                      Supprimer
                    </button>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div>
                      <div style={{ color: "#64748b", fontSize: 12, fontWeight: 900 }}>Achat cible</div>
                      <div style={{ fontWeight: 900, color: "#0f172a" }}>{formatMoney(x.scenario.purchaseTarget)}</div>
                    </div>
                    <div>
                      <div style={{ color: "#64748b", fontSize: 12, fontWeight: 900 }}>Apport</div>
                      <div style={{ fontWeight: 900, color: "#0f172a" }}>{formatMoney(x.scenario.apport)}</div>
                    </div>
                    <div>
                      <div style={{ color: "#64748b", fontSize: 12, fontWeight: 900 }}>Emprunt</div>
                      <div style={{ fontWeight: 900, color: "#0f172a" }}>{formatMoney(x.loan)}</div>
                    </div>
                    <div>
                      <div style={{ color: "#64748b", fontSize: 12, fontWeight: 900 }}>Durée / Taux</div>
                      <div style={{ fontWeight: 900, color: "#0f172a" }}>
                        {(x.scenario.durationYears ?? "—")} ans · {formatPct(x.scenario.ratePct)}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: "#64748b", fontSize: 12, fontWeight: 900 }}>Mensualité (hors ass.)</div>
                      <div style={{ fontWeight: 900, color: "#0f172a" }}>
                        {x.monthly === null ? "—" : formatMoney(Math.round(x.monthly))}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: "#64748b", fontSize: 12, fontWeight: 900 }}>Assurance (approx)</div>
                      <div style={{ fontWeight: 900, color: "#0f172a" }}>
                        {x.insuranceMonthly === null ? "—" : formatMoney(Math.round(x.insuranceMonthly))}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: "#64748b", fontSize: 12, fontWeight: 900 }}>Mensualité totale</div>
                      <div style={{ fontWeight: 900, color: "#0f172a" }}>
                        {x.monthlyAll === null ? "—" : formatMoney(x.monthlyAll)}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: "#64748b", fontSize: 12, fontWeight: 900 }}>Coût intérêts (approx)</div>
                      <div style={{ fontWeight: 900, color: "#0f172a" }}>
                        {formatMoney(x.interestCost === null ? null : Math.round(x.interestCost))}
                      </div>
                    </div>
                  </div>

                  {x.scenario.notes ? <div style={{ color: "#475569", fontSize: 13 }}>{x.scenario.notes}</div> : null}
                </div>
              ))
            )}
          </div>
        </div>

        <div style={card}>
          <div style={sectionTitle}>Créer un scénario</div>

          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <label style={labelStyle}>Nom</label>
              <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: 25 ans - 3.2%" />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={labelStyle}>Achat cible</label>
                <input style={inputStyle} inputMode="numeric" value={purchaseTarget} onChange={(e) => setPurchaseTarget(e.target.value)} placeholder="Ex: 300000" />
              </div>
              <div>
                <label style={labelStyle}>Apport</label>
                <input style={inputStyle} inputMode="numeric" value={apport} onChange={(e) => setApport(e.target.value)} placeholder="Ex: 40000" />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={labelStyle}>Durée (années)</label>
                <input style={inputStyle} inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="Ex: 20" />
              </div>
              <div>
                <label style={labelStyle}>Taux annuel (%)</label>
                <input style={inputStyle} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="Ex: 3.50" />
              </div>
            </div>

            <div>
              <label style={labelStyle}>Assurance (% annuel) — approx</label>
              <input style={inputStyle} inputMode="decimal" value={insurancePct} onChange={(e) => setInsurancePct(e.target.value)} placeholder="Ex: 0.30" />
            </div>

            <div>
              <label style={labelStyle}>Notes</label>
              <textarea style={textareaStyle} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex: banque A, négociation..." />
            </div>

            <div style={row}>
              <button type="button" style={btnPrimary} onClick={addScenario}>
                Ajouter
              </button>
              <button type="button" style={btnGhost} onClick={resetForm}>
                Réinitialiser
              </button>
              <Link to="/particulier/projet" style={{ ...btnGhost, textDecoration: "none", display: "inline-block" }}>
                Mon projet
              </Link>
            </div>
          </div>
        </div>
      </div>

      <style>
        {`
          @media (max-width: 980px) {
            .__sc_grid { grid-template-columns: 1fr !important; }
          }
        `}
      </style>
      <div className="__sc_grid" style={{ display: "none" }} />
    </div>
  );
}

