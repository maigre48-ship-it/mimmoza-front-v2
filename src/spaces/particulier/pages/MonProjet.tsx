import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

type ProjectGoal = "residence_principale" | "investissement" | "residence_secondaire";

type ProjectState = {
  goal: ProjectGoal | "";
  city: string;
  postcode: string;
  radiusKm: number | null;

  budgetTotal: number | null; // enveloppe globale
  budgetNotaire: number | null;
  budgetTravaux: number | null;
  apport: number | null;

  loanDurationYears: number | null;
  loanRatePct: number | null;

  targetMoveIn: string; // YYYY-MM-DD
  urgency: "flexible" | "moyen" | "urgent";
  notes: string;
};

const STORAGE_KEY = "mimmoza.particulier.mon_projet.v1";

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
  gridTemplateColumns: "minmax(420px, 1.2fr) minmax(320px, 0.8fr)",
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

const fieldGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 12,
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

const hintStyle: React.CSSProperties = {
  marginTop: 6,
  fontSize: 12,
  color: "#64748b",
  lineHeight: 1.35,
};

const row: React.CSSProperties = { display: "flex", gap: 10, flexWrap: "wrap" };

const pill: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 999,
  border: "1px solid rgba(15, 23, 42, 0.10)",
  background: "rgba(248, 250, 252, 0.75)",
  fontSize: 12,
  fontWeight: 800,
  color: "#0f172a",
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

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  minHeight: 120,
  resize: "vertical",
  lineHeight: 1.4,
};

function clampNumber(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
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

function loadInitial(): ProjectState {
  const fallback: ProjectState = {
    goal: "",
    city: "",
    postcode: "",
    radiusKm: 10,

    budgetTotal: null,
    budgetNotaire: null,
    budgetTravaux: null,
    apport: null,

    loanDurationYears: 20,
    loanRatePct: 3.5,

    targetMoveIn: "",
    urgency: "moyen",
    notes: "",
  };

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<ProjectState>;
    return { ...fallback, ...parsed };
  } catch {
    return fallback;
  }
}

function save(state: ProjectState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

function computeMonthlyPayment(principal: number, years: number, ratePct: number): number {
  // Mensualité (approx) : P * r / (1 - (1+r)^-n)
  const n = years * 12;
  const r = ratePct / 100 / 12;
  if (n <= 0) return 0;
  if (r <= 0) return principal / n;
  const denom = 1 - Math.pow(1 + r, -n);
  return denom === 0 ? 0 : (principal * r) / denom;
}

export default function MonProjet() {
  const [state, setState] = useState<ProjectState>(() => loadInitial());
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    save(state);
    setJustSaved(true);
    const t = window.setTimeout(() => setJustSaved(false), 900);
    return () => window.clearTimeout(t);
  }, [state]);

  const completion = useMemo(() => {
    const checks: Array<boolean> = [
      !!state.goal,
      state.city.trim().length > 1 || state.postcode.trim().length > 1,
      state.budgetTotal !== null,
      state.apport !== null,
      state.loanDurationYears !== null,
      state.loanRatePct !== null,
      state.urgency !== null,
    ];
    const filled = checks.filter(Boolean).length;
    return Math.round((filled / checks.length) * 100);
  }, [state]);

  const budgetResteAchat = useMemo(() => {
    // Prix achat "cible" = budget total - notaire - travaux (si renseignés)
    const total = state.budgetTotal ?? null;
    if (total === null) return null;
    const notaire = state.budgetNotaire ?? 0;
    const travaux = state.budgetTravaux ?? 0;
    const cible = total - notaire - travaux;
    return cible > 0 ? cible : 0;
  }, [state.budgetTotal, state.budgetNotaire, state.budgetTravaux]);

  const loanAmount = useMemo(() => {
    // Montant emprunt = prix achat cible - apport (min 0)
    if (budgetResteAchat === null) return null;
    const apport = state.apport ?? 0;
    const amount = budgetResteAchat - apport;
    return amount > 0 ? amount : 0;
  }, [budgetResteAchat, state.apport]);

  const monthly = useMemo(() => {
    if (loanAmount === null) return null;
    const years = state.loanDurationYears ?? null;
    const rate = state.loanRatePct ?? null;
    if (years === null || rate === null) return null;
    return computeMonthlyPayment(loanAmount, years, rate);
  }, [loanAmount, state.loanDurationYears, state.loanRatePct]);

  const issues = useMemo(() => {
    const items: string[] = [];
    if (!state.goal) items.push("Définir l’objectif (résidence principale / investissement / secondaire).");
    if (!state.city.trim() && !state.postcode.trim())
      items.push("Renseigner au moins une localisation (ville ou code postal).");
    if (state.budgetTotal === null) items.push("Renseigner une enveloppe budget total.");
    if (state.apport === null) items.push("Renseigner l’apport (même approximatif).");
    if (state.loanDurationYears === null || state.loanRatePct === null)
      items.push("Renseigner la durée et le taux du prêt (même estimés).");
    return items;
  }, [state]);

  const goalLabel = useMemo(() => {
    switch (state.goal) {
      case "residence_principale":
        return "Résidence principale";
      case "investissement":
        return "Investissement";
      case "residence_secondaire":
        return "Résidence secondaire";
      default:
        return "—";
    }
  }, [state.goal]);

  return (
    <div style={wrap}>
      <div style={headerRow}>
        <div>
          <h2 style={titleStyle}>Mon projet</h2>
          <p style={subtitleStyle}>
            Définissez votre objectif, votre budget et vos paramètres de financement. Ces informations alimenteront
            la recherche, l’évaluation et le dossier banque.
          </p>
        </div>

        <div style={row}>
          <span style={pill}>Complétude : {completion}%</span>
          <span style={pill}>{justSaved ? "Sauvegardé" : "Local"}</span>
        </div>
      </div>

      <div style={grid}>
        {/* COLONNE GAUCHE: FORM */}
        <div style={card}>
          <div style={sectionTitle}>1) Cadre du projet</div>

          <div style={fieldGrid}>
            <div>
              <label style={labelStyle}>Objectif</label>
              <select
                style={inputStyle}
                value={state.goal}
                onChange={(e) => setState((s) => ({ ...s, goal: e.target.value as ProjectGoal | "" }))}
              >
                <option value="">— Choisir —</option>
                <option value="residence_principale">Résidence principale</option>
                <option value="investissement">Investissement</option>
                <option value="residence_secondaire">Résidence secondaire</option>
              </select>
              <div style={hintStyle}>Permet d’adapter les critères, l’analyse et les recommandations.</div>
            </div>

            <div>
              <label style={labelStyle}>Urgence</label>
              <select
                style={inputStyle}
                value={state.urgency}
                onChange={(e) => setState((s) => ({ ...s, urgency: e.target.value as ProjectState["urgency"] }))}
              >
                <option value="flexible">Flexible</option>
                <option value="moyen">Délai moyen</option>
                <option value="urgent">Urgent</option>
              </select>
              <div style={hintStyle}>Influence le rythme des alertes et le niveau de détails conseillé.</div>
            </div>
          </div>

          <div style={{ height: 10 }} />

          <div style={fieldGrid}>
            <div>
              <label style={labelStyle}>Ville (optionnel)</label>
              <input
                style={inputStyle}
                value={state.city}
                onChange={(e) => setState((s) => ({ ...s, city: e.target.value }))}
                placeholder="Ex: Nantes"
              />
            </div>

            <div>
              <label style={labelStyle}>Code postal (optionnel)</label>
              <input
                style={inputStyle}
                value={state.postcode}
                onChange={(e) => setState((s) => ({ ...s, postcode: e.target.value }))}
                placeholder="Ex: 44000"
              />
            </div>
          </div>

          <div style={{ height: 10 }} />

          <div style={fieldGrid}>
            <div>
              <label style={labelStyle}>Rayon de recherche (km)</label>
              <input
                style={inputStyle}
                inputMode="numeric"
                value={state.radiusKm ?? ""}
                onChange={(e) =>
                  setState((s) => ({
                    ...s,
                    radiusKm: (() => {
                      const n = parseNumberOrNull(e.target.value);
                      if (n === null) return null;
                      return clampNumber(n, 1, 100);
                    })(),
                  }))
                }
                placeholder="Ex: 10"
              />
              <div style={hintStyle}>Entre 1 et 100 km.</div>
            </div>

            <div>
              <label style={labelStyle}>Date cible (emménagement)</label>
              <input
                style={inputStyle}
                type="date"
                value={state.targetMoveIn}
                onChange={(e) => setState((s) => ({ ...s, targetMoveIn: e.target.value }))}
              />
              <div style={hintStyle}>Optionnel, utile pour prioriser la recherche et le planning.</div>
            </div>
          </div>

          <div style={{ height: 16 }} />

          <div style={sectionTitle}>2) Budget</div>

          <div style={fieldGrid}>
            <div>
              <label style={labelStyle}>Budget total (enveloppe)</label>
              <input
                style={inputStyle}
                inputMode="numeric"
                value={state.budgetTotal ?? ""}
                onChange={(e) => setState((s) => ({ ...s, budgetTotal: parseNumberOrNull(e.target.value) }))}
                placeholder="Ex: 350000"
              />
              <div style={hintStyle}>Prix + frais + travaux (si applicable).</div>
            </div>

            <div>
              <label style={labelStyle}>Apport</label>
              <input
                style={inputStyle}
                inputMode="numeric"
                value={state.apport ?? ""}
                onChange={(e) => setState((s) => ({ ...s, apport: parseNumberOrNull(e.target.value) }))}
                placeholder="Ex: 40000"
              />
            </div>
          </div>

          <div style={{ height: 10 }} />

          <div style={fieldGrid}>
            <div>
              <label style={labelStyle}>Frais de notaire (estimation)</label>
              <input
                style={inputStyle}
                inputMode="numeric"
                value={state.budgetNotaire ?? ""}
                onChange={(e) => setState((s) => ({ ...s, budgetNotaire: parseNumberOrNull(e.target.value) }))}
                placeholder="Ex: 25000"
              />
              <div style={hintStyle}>Optionnel, sinon on considère 0 dans le calcul.</div>
            </div>

            <div>
              <label style={labelStyle}>Budget travaux (estimation)</label>
              <input
                style={inputStyle}
                inputMode="numeric"
                value={state.budgetTravaux ?? ""}
                onChange={(e) => setState((s) => ({ ...s, budgetTravaux: parseNumberOrNull(e.target.value) }))}
                placeholder="Ex: 20000"
              />
              <div style={hintStyle}>Optionnel. Pour détailler, aller dans “Budget travaux”.</div>
            </div>
          </div>

          <div style={{ height: 16 }} />

          <div style={sectionTitle}>3) Financement</div>

          <div style={fieldGrid}>
            <div>
              <label style={labelStyle}>Durée (années)</label>
              <input
                style={inputStyle}
                inputMode="numeric"
                value={state.loanDurationYears ?? ""}
                onChange={(e) => setState((s) => ({ ...s, loanDurationYears: parseNumberOrNull(e.target.value) }))}
                placeholder="Ex: 20"
              />
            </div>

            <div>
              <label style={labelStyle}>Taux (annuel, %)</label>
              <input
                style={inputStyle}
                inputMode="decimal"
                value={state.loanRatePct ?? ""}
                onChange={(e) => setState((s) => ({ ...s, loanRatePct: parseNumberOrNull(e.target.value) }))}
                placeholder="Ex: 3.50"
              />
            </div>
          </div>

          <div style={{ height: 16 }} />

          <div style={sectionTitle}>4) Notes</div>
          <label style={labelStyle}>Notes (contraintes, préférences, points à vérifier)</label>
          <textarea
            style={textareaStyle}
            value={state.notes}
            onChange={(e) => setState((s) => ({ ...s, notes: e.target.value }))}
            placeholder="Ex: proximité école, RDC obligatoire, éviter travaux lourds, balcon, parking..."
          />

          <div style={{ height: 12 }} />

          <div style={row}>
            <button
              style={btnPrimary}
              onClick={() => {
                // Simple "nudge" vers les prochaines étapes
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              Enregistrer (auto)
            </button>

            <button
              style={btnGhost}
              onClick={() => {
                const ok = window.confirm("Réinitialiser le projet (local) ? Cette action ne peut pas être annulée.");
                if (!ok) return;
                try {
                  localStorage.removeItem(STORAGE_KEY);
                } catch {
                  // ignore
                }
                setState(loadInitial());
              }}
            >
              Réinitialiser
            </button>

            <Link to="/particulier/recherche" style={{ ...btnGhost, textDecoration: "none", display: "inline-block" }}>
              Aller à la recherche
            </Link>
          </div>
        </div>

        {/* COLONNE DROITE: SYNTHÈSE */}
        <div style={card}>
          <div style={sectionTitle}>Résumé</div>

          <div style={{ display: "grid", gap: 10 }}>
            <div
              style={{
                border: "1px solid rgba(15, 23, 42, 0.08)",
                borderRadius: 14,
                padding: 12,
                background: "rgba(248, 250, 252, 0.75)",
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}>Objectif</div>
              <div style={{ marginTop: 6, fontWeight: 900, color: "#0f172a" }}>{goalLabel}</div>
            </div>

            <div
              style={{
                border: "1px solid rgba(15, 23, 42, 0.08)",
                borderRadius: 14,
                padding: 12,
                background: "rgba(248, 250, 252, 0.75)",
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}>Budget</div>
              <div style={{ marginTop: 6, fontWeight: 900, color: "#0f172a" }}>
                {formatMoney(state.budgetTotal)}
              </div>
              <div style={{ marginTop: 6, color: "#64748b", fontSize: 13 }}>
                Notaire: {formatMoney(state.budgetNotaire)} · Travaux: {formatMoney(state.budgetTravaux)}
              </div>
            </div>

            <div
              style={{
                border: "1px solid rgba(15, 23, 42, 0.08)",
                borderRadius: 14,
                padding: 12,
                background: "rgba(248, 250, 252, 0.75)",
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}>Achat cible</div>
              <div style={{ marginTop: 6, fontWeight: 900, color: "#0f172a" }}>
                {formatMoney(budgetResteAchat)}
              </div>
              <div style={{ marginTop: 6, color: "#64748b", fontSize: 13 }}>
                Montant emprunt: {formatMoney(loanAmount)}
              </div>
              <div style={{ marginTop: 6, color: "#64748b", fontSize: 13 }}>
                Durée: {state.loanDurationYears ?? "—"} ans · Taux: {formatPct(state.loanRatePct)}
              </div>
              <div style={{ marginTop: 6, color: "#0f172a", fontSize: 13, fontWeight: 900 }}>
                Mensualité estimée: {monthly === null ? "—" : formatMoney(Math.round(monthly))}
              </div>
              <div style={hintStyle}>
                Estimation indicative (hors assurance, frais annexes). À affiner en scénarios.
              </div>
            </div>

            <div
              style={{
                border: "1px solid rgba(15, 23, 42, 0.10)",
                borderRadius: 14,
                padding: 12,
                background: issues.length ? "rgba(245, 158, 11, 0.08)" : "rgba(34, 197, 94, 0.08)",
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}>À compléter</div>
              {issues.length ? (
                <ul style={{ margin: "10px 0 0", paddingLeft: 18, color: "#0f172a" }}>
                  {issues.slice(0, 4).map((it, idx) => (
                    <li key={idx} style={{ marginBottom: 6, lineHeight: 1.35 }}>
                      {it}
                    </li>
                  ))}
                </ul>
              ) : (
                <div style={{ marginTop: 10, fontWeight: 900, color: "#0f172a" }}>
                  Projet suffisamment renseigné pour démarrer la recherche.
                </div>
              )}
            </div>
          </div>

          <div style={{ height: 12 }} />

          <div style={sectionTitle}>Raccourcis</div>
          <div style={{ display: "grid", gap: 10 }}>
            <Link to="/particulier/recherche" style={{ ...btnGhost, textDecoration: "none" }}>
              Recherche de biens
            </Link>
            <Link to="/particulier/financement" style={{ ...btnGhost, textDecoration: "none" }}>
              Capacité
            </Link>
            <Link to="/particulier/scenarios" style={{ ...btnGhost, textDecoration: "none" }}>
              Scénarios
            </Link>
            <Link to="/particulier/dossier" style={{ ...btnGhost, textDecoration: "none" }}>
              Dossier banque
            </Link>
            <Link to="/particulier/travaux" style={{ ...btnGhost, textDecoration: "none" }}>
              Budget travaux
            </Link>
          </div>
        </div>
      </div>

      {/* Responsive fallback */}
      <style>
        {`
          @media (max-width: 980px) {
            .__mp_grid { grid-template-columns: 1fr !important; }
          }
        `}
      </style>
      <div className="__mp_grid" style={{ display: "none" }} />
    </div>
  );
}

