// src/spaces/particulier/Planning.tsx
import { useMemo, useState } from "react";

type StepStatus = "todo" | "doing" | "done";

type PlanningStep = {
  id: string;
  title: string;
  description: string;
  owner: "Acheteur" | "Notaire" | "Banque" | "Vendeur" | "Artisan";
  dueDate?: string; // YYYY-MM-DD
  status: StepStatus;
};

const DEFAULT_STEPS: PlanningStep[] = [
  {
    id: "s1",
    title: "Pré-qualification (budget + capacité)",
    description: "Valider capacité d’emprunt et enveloppe globale (apport, frais, mensualité).",
    owner: "Acheteur",
    status: "doing",
  },
  {
    id: "s2",
    title: "Visites & shortlist",
    description: "Visiter, comparer, sélectionner 1–3 biens candidats.",
    owner: "Acheteur",
    status: "todo",
  },
  {
    id: "s3",
    title: "Offre d’achat",
    description: "Faire une offre, négocier, obtenir accord de principe.",
    owner: "Acheteur",
    status: "todo",
  },
  {
    id: "s4",
    title: "Signature compromis",
    description: "Compromis + conditions suspensives (crédit, urbanisme, diagnostics…).",
    owner: "Notaire",
    status: "todo",
  },
  {
    id: "s5",
    title: "Dossier banque",
    description: "Constituer dossier, obtenir accord, éditer l’offre de prêt.",
    owner: "Banque",
    status: "todo",
  },
  {
    id: "s6",
    title: "Acte authentique",
    description: "Signature chez notaire + remise des clés.",
    owner: "Notaire",
    status: "todo",
  },
  {
    id: "s7",
    title: "Travaux / emménagement",
    description: "Planifier, budgéter, lancer les travaux si nécessaires.",
    owner: "Artisan",
    status: "todo",
  },
];

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

const Planning: React.FC = () => {
  const [steps, setSteps] = useState<PlanningStep[]>(DEFAULT_STEPS);

  const stats = useMemo(() => {
    const total = steps.length;
    const done = steps.filter((s) => s.status === "done").length;
    const doing = steps.filter((s) => s.status === "doing").length;
    const todo = steps.filter((s) => s.status === "todo").length;
    const completion = total === 0 ? 0 : Math.round(((done) / total) * 100);
    return { total, done, doing, todo, completion };
  }, [steps]);

  const setStatus = (id: string, status: StepStatus) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, status } : s)));
  };

  const setDueDate = (id: string, dueDate: string) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, dueDate } : s)));
  };

  const move = (id: string, direction: -1 | 1) => {
    setSteps((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      if (idx < 0) return prev;
      const nextIdx = clamp(idx + direction, 0, prev.length - 1);
      if (nextIdx === idx) return prev;
      const copy = [...prev];
      const [item] = copy.splice(idx, 1);
      copy.splice(nextIdx, 0, item);
      return copy;
    });
  };

  const nextAction = useMemo(() => {
    const doing = steps.find((s) => s.status === "doing");
    if (doing) return doing;
    const todo = steps.find((s) => s.status === "todo");
    return todo ?? null;
  }, [steps]);

  return (
    <div style={pageStyle}>
      <div style={headerStyle}>
        <div>
          <div style={kickerStyle}>TRAVAUX</div>
          <h1 style={titleStyle}>Planning</h1>
          <p style={subtitleStyle}>
            Feuille de route pour piloter l’achat jusqu’à la remise des clés (et travaux éventuels).
          </p>
        </div>
      </div>

      <div style={gridStyle}>
        <div style={cardStyle}>
          <h2 style={cardTitleStyle}>Synthèse</h2>

          <div style={kpiRowStyle}>
            <Kpi label="Total étapes" value={`${stats.total}`} />
            <Kpi label="Terminées" value={`${stats.done}`} />
            <Kpi label="En cours" value={`${stats.doing}`} />
            <Kpi label="À faire" value={`${stats.todo}`} />
          </div>

          <div style={progressBoxStyle}>
            <div style={progressHeaderStyle}>
              <div style={progressLabelStyle}>Avancement</div>
              <div style={progressValueStyle}>{stats.completion}%</div>
            </div>
            <div style={progressTrackStyle}>
              <div style={{ ...progressFillStyle, width: `${stats.completion}%` }} />
            </div>
            <div style={progressHintStyle}>Basé uniquement sur les étapes “Terminées”.</div>
          </div>

          <div style={nextBoxStyle}>
            <div style={nextTitleStyle}>Prochaine action</div>
            {nextAction ? (
              <div style={nextItemStyle}>
                <div style={nextItemTopStyle}>
                  <div style={nextItemNameStyle}>{nextAction.title}</div>
                  <Badge status={nextAction.status} />
                </div>
                <div style={nextItemDescStyle}>{nextAction.description}</div>
                <div style={nextMetaStyle}>
                  <span style={metaPillStyle}>Responsable: {nextAction.owner}</span>
                  <span style={metaPillStyle}>
                    Échéance: {nextAction.dueDate ? nextAction.dueDate : "non définie"}
                  </span>
                </div>
              </div>
            ) : (
              <div style={emptyHintStyle}>Aucune étape. Ajoute-en pour démarrer.</div>
            )}
          </div>

          <div style={actionsStyle}>
            <button type="button" style={btnSecondaryStyle} onClick={() => setSteps(DEFAULT_STEPS)}>
              Réinitialiser
            </button>
            <button
              type="button"
              style={btnPrimaryStyle}
              onClick={() => {
                const id = `s${Date.now()}`;
                setSteps((prev) => [
                  ...prev,
                  {
                    id,
                    title: "Nouvelle étape",
                    description: "Décris l’objectif de cette étape.",
                    owner: "Acheteur",
                    status: "todo",
                  },
                ]);
              }}
            >
              Ajouter une étape
            </button>
          </div>
        </div>

        <div style={cardStyle}>
          <h2 style={cardTitleStyle}>Étapes</h2>

          <div style={listStyle}>
            {steps.map((s) => (
              <div key={s.id} style={stepCardStyle}>
                <div style={stepTopStyle}>
                  <div style={{ flex: 1, minWidth: 240 }}>
                    <div style={stepTitleStyle}>{s.title}</div>
                    <div style={stepDescStyle}>{s.description}</div>
                    <div style={stepMetaStyle}>
                      <span style={metaPillStyle}>Responsable: {s.owner}</span>
                      <span style={metaPillStyle}>
                        Échéance:{" "}
                        <input
                          type="date"
                          value={s.dueDate ?? ""}
                          onChange={(e) => setDueDate(s.id, e.target.value)}
                          style={dateInputStyle}
                        />
                      </span>
                    </div>
                  </div>

                  <div style={stepRightStyle}>
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                      <StatusPill
                        label="À faire"
                        active={s.status === "todo"}
                        tone="av"
                        onClick={() => setStatus(s.id, "todo")}
                      />
                      <StatusPill
                        label="En cours"
                        active={s.status === "doing"}
                        tone="ok"
                        onClick={() => setStatus(s.id, "doing")}
                      />
                      <StatusPill
                        label="Terminé"
                        active={s.status === "done"}
                        tone="ok2"
                        onClick={() => setStatus(s.id, "done")}
                      />
                    </div>

                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 10 }}>
                      <button type="button" style={tinyBtnStyle} onClick={() => move(s.id, -1)}>
                        Monter
                      </button>
                      <button type="button" style={tinyBtnStyle} onClick={() => move(s.id, 1)}>
                        Descendre
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {steps.length === 0 && <div style={emptyHintStyle}>Aucune étape. Ajoute-en pour démarrer.</div>}
        </div>
      </div>
    </div>
  );
};

export default Planning;

// -----------------------------------------------------------------------------
// UI
// -----------------------------------------------------------------------------

const Kpi: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div style={kpiStyle}>
    <div style={kpiLabelStyle}>{label}</div>
    <div style={kpiValueStyle}>{value}</div>
  </div>
);

const Badge: React.FC<{ status: StepStatus }> = ({ status }) => {
  const conf =
    status === "done"
      ? { bg: "#dcfce7", bd: "rgba(22,163,74,0.35)", fg: "#14532d", text: "Terminé" }
      : status === "doing"
      ? { bg: "#e0f2fe", bd: "rgba(14,165,233,0.35)", fg: "#0c4a6e", text: "En cours" }
      : { bg: "#f1f5f9", bd: "rgba(15,23,42,0.12)", fg: "#334155", text: "À faire" };

  return (
    <span
      style={{
        background: conf.bg,
        border: `1px solid ${conf.bd}`,
        color: conf.fg,
        borderRadius: 999,
        padding: "2px 10px",
        fontSize: 12,
        fontWeight: 900,
        whiteSpace: "nowrap",
      }}
    >
      {conf.text}
    </span>
  );
};

const StatusPill: React.FC<{
  label: string;
  active: boolean;
  tone: "ok" | "ok2" | "av";
  onClick: () => void;
}> = ({ label, active, tone, onClick }) => {
  const toneStyle =
    tone === "ok2"
      ? { background: active ? "#16a34a" : "#dcfce7", borderColor: "rgba(22,163,74,0.35)", color: active ? "#ffffff" : "#14532d" }
      : tone === "ok"
      ? { background: active ? "#0ea5e9" : "#e0f2fe", borderColor: "rgba(14,165,233,0.35)", color: active ? "#ffffff" : "#0c4a6e" }
      : { background: active ? "#0f172a" : "#f1f5f9", borderColor: "rgba(15,23,42,0.12)", color: active ? "#ffffff" : "#334155" };

  return (
    <button type="button" onClick={onClick} style={{ ...pillBaseStyle, ...toneStyle }}>
      {label}
    </button>
  );
};

// -----------------------------------------------------------------------------
// Styles
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

const kickerStyle: React.CSSProperties = { fontSize: 12, letterSpacing: 1.2, fontWeight: 800, color: "#64748b" };
const titleStyle: React.CSSProperties = { fontSize: 30, lineHeight: 1.1, margin: "6px 0 6px 0" };
const subtitleStyle: React.CSSProperties = { margin: 0, color: "#475569", maxWidth: 820 };

const gridStyle: React.CSSProperties = {
  maxWidth: 1200,
  margin: "0 auto",
  display: "grid",
  gridTemplateColumns: "0.85fr 1.15fr",
  gap: 16,
};

const cardStyle: React.CSSProperties = {
  background: "#ffffff",
  borderRadius: 14,
  border: "1px solid rgba(15, 23, 42, 0.08)",
  boxShadow: "0 12px 35px rgba(2, 6, 23, 0.06)",
  padding: 18,
};

const cardTitleStyle: React.CSSProperties = { fontSize: 16, fontWeight: 800, margin: "0 0 12px 0" };

const kpiRowStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 };

const kpiStyle: React.CSSProperties = {
  padding: 12,
  borderRadius: 12,
  background: "#f8fafc",
  border: "1px solid rgba(15, 23, 42, 0.06)",
};

const kpiLabelStyle: React.CSSProperties = { fontSize: 12, color: "#64748b", fontWeight: 800 };
const kpiValueStyle: React.CSSProperties = { marginTop: 6, fontSize: 18, fontWeight: 950 };

const progressBoxStyle: React.CSSProperties = {
  marginTop: 12,
  padding: 12,
  borderRadius: 12,
  border: "1px solid rgba(15, 23, 42, 0.08)",
  background: "linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)",
};

const progressHeaderStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: 12 };
const progressLabelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 900, color: "#64748b" };
const progressValueStyle: React.CSSProperties = { fontSize: 12, fontWeight: 950, color: "#0f172a" };

const progressTrackStyle: React.CSSProperties = {
  marginTop: 10,
  height: 10,
  borderRadius: 999,
  background: "#e2e8f0",
  overflow: "hidden",
  border: "1px solid rgba(15, 23, 42, 0.06)",
};

const progressFillStyle: React.CSSProperties = { height: "100%", borderRadius: 999, background: "#0ea5e9" };
const progressHintStyle: React.CSSProperties = { marginTop: 8, color: "#475569", fontSize: 12 };

const nextBoxStyle: React.CSSProperties = {
  marginTop: 12,
  padding: 12,
  borderRadius: 12,
  border: "1px solid rgba(15, 23, 42, 0.08)",
  background: "#f8fafc",
};

const nextTitleStyle: React.CSSProperties = { fontSize: 12, fontWeight: 900, color: "#334155", marginBottom: 8 };

const nextItemStyle: React.CSSProperties = {
  borderRadius: 12,
  border: "1px solid rgba(15,23,42,0.08)",
  background: "#ffffff",
  padding: 12,
};

const nextItemTopStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" };
const nextItemNameStyle: React.CSSProperties = { fontSize: 14, fontWeight: 950 };
const nextItemDescStyle: React.CSSProperties = { marginTop: 4, fontSize: 12, color: "#475569" };
const nextMetaStyle: React.CSSProperties = { marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" };

const metaPillStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
  color: "#334155",
  background: "#ffffff",
  border: "1px solid rgba(15,23,42,0.10)",
  borderRadius: 999,
  padding: "2px 10px",
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
};

const dateInputStyle: React.CSSProperties = {
  border: "none",
  outline: "none",
  background: "transparent",
  color: "#0f172a",
  fontWeight: 800,
  fontSize: 12,
};

const actionsStyle: React.CSSProperties = { marginTop: 12, display: "flex", justifyContent: "flex-end", gap: 10 };

const btnPrimaryStyle: React.CSSProperties = {
  height: 40,
  padding: "0 14px",
  borderRadius: 10,
  border: "1px solid rgba(2, 132, 199, 0.35)",
  background: "#0ea5e9",
  color: "#ffffff",
  fontWeight: 900,
  cursor: "pointer",
};

const btnSecondaryStyle: React.CSSProperties = {
  height: 40,
  padding: "0 14px",
  borderRadius: 10,
  border: "1px solid rgba(15, 23, 42, 0.12)",
  background: "#ffffff",
  color: "#0f172a",
  fontWeight: 900,
  cursor: "pointer",
};

const listStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 12 };

const stepCardStyle: React.CSSProperties = {
  borderRadius: 14,
  border: "1px solid rgba(15, 23, 42, 0.08)",
  background: "#ffffff",
  padding: 14,
  boxShadow: "0 10px 26px rgba(2, 6, 23, 0.04)",
};

const stepTopStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" };
const stepTitleStyle: React.CSSProperties = { fontSize: 14, fontWeight: 950 };
const stepDescStyle: React.CSSProperties = { marginTop: 4, fontSize: 12, color: "#475569", maxWidth: 720 };
const stepMetaStyle: React.CSSProperties = { marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" };

const stepRightStyle: React.CSSProperties = { minWidth: 260, display: "flex", flexDirection: "column", alignItems: "flex-end" };

const pillBaseStyle: React.CSSProperties = {
  height: 30,
  padding: "0 10px",
  borderRadius: 999,
  border: "1px solid rgba(15, 23, 42, 0.10)",
  fontWeight: 900,
  fontSize: 12,
  cursor: "pointer",
};

const tinyBtnStyle: React.CSSProperties = {
  height: 34,
  padding: "0 12px",
  borderRadius: 10,
  border: "1px solid rgba(15, 23, 42, 0.12)",
  background: "#ffffff",
  color: "#0f172a",
  fontWeight: 900,
  cursor: "pointer",
};

const emptyHintStyle: React.CSSProperties = {
  marginTop: 12,
  padding: 12,
  borderRadius: 12,
  border: "1px dashed rgba(15,23,42,0.18)",
  color: "#475569",
  background: "#f8fafc",
};

