// src/spaces/particulier/Conformite.tsx
import { useMemo, useState } from "react";

type ConformiteItem = {
  id: string;
  label: string;
  description: string;
  status: "ok" | "a_verifier" | "ko";
  notes?: string;
};

const DEFAULT_ITEMS: ConformiteItem[] = [
  {
    id: "diag",
    label: "Diagnostics (DPE, amiante, plomb, électricité, gaz…)",
    description: "Présence, validité, cohérence des diagnostics obligatoires.",
    status: "a_verifier",
  },
  {
    id: "copro",
    label: "Copropriété (règlement, AG, charges, fonds travaux)",
    description: "Vérifier règlement, PV d’AG, impayés, travaux votés, fonds ALUR.",
    status: "a_verifier",
  },
  {
    id: "urbanisme",
    label: "Urbanisme (PLU / servitudes / conformité)",
    description: "Vérifier conformité des surfaces, autorisations, extensions, servitudes.",
    status: "a_verifier",
  },
  {
    id: "travaux",
    label: "Travaux (devis, conformité, garanties)",
    description: "Devis, assurances, décennale, conformité si travaux récents.",
    status: "a_verifier",
  },
  {
    id: "assainissement",
    label: "Assainissement",
    description: "Collectif / non collectif : contrôle, conformité, obligations.",
    status: "a_verifier",
  },
  {
    id: "risques",
    label: "Risques (ERP / PPR / inondation / termites…)",
    description: "Vérifier état des risques et obligations associées.",
    status: "a_verifier",
  },
];

function formatPct(n: number) {
  return `${Math.round(n)}%`;
}

const Conformite: React.FC = () => {
  const [items, setItems] = useState<ConformiteItem[]>(DEFAULT_ITEMS);

  const stats = useMemo(() => {
    const total = items.length;
    const ok = items.filter((i) => i.status === "ok").length;
    const ko = items.filter((i) => i.status === "ko").length;
    const av = items.filter((i) => i.status === "a_verifier").length;
    const completion = total === 0 ? 0 : ((ok + ko) / total) * 100;

    return { total, ok, ko, av, completion };
  }, [items]);

  const setStatus = (id: string, status: ConformiteItem["status"]) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, status } : it)));
  };

  const setNotes = (id: string, notes: string) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, notes } : it)));
  };

  return (
    <div style={pageStyle}>
      <div style={headerStyle}>
        <div>
          <div style={kickerStyle}>TRAVAUX</div>
          <h1 style={titleStyle}>Conformité</h1>
          <p style={subtitleStyle}>
            Checklist de conformité (diagnostics, copro, urbanisme, risques…). Objectif :
            éviter les surprises avant engagement.
          </p>
        </div>
      </div>

      <div style={gridStyle}>
        <div style={cardStyle}>
          <h2 style={cardTitleStyle}>Synthèse</h2>

          <div style={kpiRowStyle}>
            <Kpi label="Total items" value={`${stats.total}`} />
            <Kpi label="OK" value={`${stats.ok}`} />
            <Kpi label="À vérifier" value={`${stats.av}`} />
            <Kpi label="KO" value={`${stats.ko}`} />
          </div>

          <div style={progressBoxStyle}>
            <div style={progressHeaderStyle}>
              <div style={progressLabelStyle}>Avancement</div>
              <div style={progressValueStyle}>{formatPct(stats.completion)}</div>
            </div>
            <div style={progressTrackStyle}>
              <div style={{ ...progressFillStyle, width: `${stats.completion}%` }} />
            </div>
            <div style={progressHintStyle}>
              Terminé = items marqués OK ou KO. “À vérifier” = en attente.
            </div>
          </div>

          <div style={actionsStyle}>
            <button type="button" style={btnSecondaryStyle} onClick={() => setItems(DEFAULT_ITEMS)}>
              Réinitialiser
            </button>
            <button
              type="button"
              style={btnPrimaryStyle}
              onClick={() => {
                // pas d'appel réseau ici : action UI safe
                const firstAV = items.find((i) => i.status === "a_verifier");
                if (firstAV) {
                  // simple focus logique : aucun DOM query forcé
                  alert(`Prochain item à vérifier : ${firstAV.label}`);
                } else {
                  alert("Tout est traité (OK / KO).");
                }
              }}
            >
              Prochaine vérification
            </button>
          </div>
        </div>

        <div style={cardStyle}>
          <h2 style={cardTitleStyle}>Checklist</h2>

          <div style={listStyle}>
            {items.map((it) => (
              <div key={it.id} style={itemCardStyle}>
                <div style={itemTopStyle}>
                  <div>
                    <div style={itemTitleStyle}>{it.label}</div>
                    <div style={itemDescStyle}>{it.description}</div>
                  </div>

                  <div style={statusPillsStyle}>
                    <StatusPill
                      label="OK"
                      active={it.status === "ok"}
                      tone="ok"
                      onClick={() => setStatus(it.id, "ok")}
                    />
                    <StatusPill
                      label="À vérifier"
                      active={it.status === "a_verifier"}
                      tone="av"
                      onClick={() => setStatus(it.id, "a_verifier")}
                    />
                    <StatusPill
                      label="KO"
                      active={it.status === "ko"}
                      tone="ko"
                      onClick={() => setStatus(it.id, "ko")}
                    />
                  </div>
                </div>

                <div style={notesBlockStyle}>
                  <div style={notesLabelStyle}>Notes</div>
                  <textarea
                    style={textareaStyle}
                    value={it.notes ?? ""}
                    onChange={(e) => setNotes(it.id, e.target.value)}
                    placeholder="Ex: DPE à récupérer / PV AG 2024 montre travaux toiture / extension non déclarée…"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Conformite;

// -----------------------------------------------------------------------------
// Small components
// -----------------------------------------------------------------------------

const Kpi: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div style={kpiStyle}>
    <div style={kpiLabelStyle}>{label}</div>
    <div style={kpiValueStyle}>{value}</div>
  </div>
);

const StatusPill: React.FC<{
  label: string;
  active: boolean;
  tone: "ok" | "av" | "ko";
  onClick: () => void;
}> = ({ label, active, tone, onClick }) => {
  const toneStyle =
    tone === "ok"
      ? { background: active ? "#16a34a" : "#dcfce7", borderColor: "rgba(22,163,74,0.35)", color: active ? "#ffffff" : "#14532d" }
      : tone === "ko"
      ? { background: active ? "#ef4444" : "#fee2e2", borderColor: "rgba(239,68,68,0.35)", color: active ? "#ffffff" : "#7f1d1d" }
      : { background: active ? "#0ea5e9" : "#e0f2fe", borderColor: "rgba(14,165,233,0.35)", color: active ? "#ffffff" : "#0c4a6e" };

  return (
    <button type="button" onClick={onClick} style={{ ...pillBaseStyle, ...toneStyle }}>
      {label}
    </button>
  );
};

// -----------------------------------------------------------------------------
// Styles (autonomes, cohérents avec Estimation)
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
  maxWidth: 820,
};

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

const cardTitleStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 800,
  margin: "0 0 12px 0",
};

const kpiRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
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
  fontWeight: 800,
};

const kpiValueStyle: React.CSSProperties = {
  marginTop: 6,
  fontSize: 18,
  fontWeight: 950,
};

const progressBoxStyle: React.CSSProperties = {
  marginTop: 12,
  padding: 12,
  borderRadius: 12,
  border: "1px solid rgba(15, 23, 42, 0.08)",
  background: "linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)",
};

const progressHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  gap: 12,
};

const progressLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 900,
  color: "#64748b",
};

const progressValueStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 950,
  color: "#0f172a",
};

const progressTrackStyle: React.CSSProperties = {
  marginTop: 10,
  height: 10,
  borderRadius: 999,
  background: "#e2e8f0",
  overflow: "hidden",
  border: "1px solid rgba(15, 23, 42, 0.06)",
};

const progressFillStyle: React.CSSProperties = {
  height: "100%",
  borderRadius: 999,
  background: "#0ea5e9",
};

const progressHintStyle: React.CSSProperties = {
  marginTop: 8,
  color: "#475569",
  fontSize: 12,
};

const actionsStyle: React.CSSProperties = {
  marginTop: 12,
  display: "flex",
  justifyContent: "flex-end",
  gap: 10,
};

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

const listStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const itemCardStyle: React.CSSProperties = {
  borderRadius: 14,
  border: "1px solid rgba(15, 23, 42, 0.08)",
  background: "#ffffff",
  padding: 14,
  boxShadow: "0 10px 26px rgba(2, 6, 23, 0.04)",
};

const itemTopStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "flex-start",
};

const itemTitleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 950,
  color: "#0f172a",
};

const itemDescStyle: React.CSSProperties = {
  marginTop: 4,
  fontSize: 12,
  color: "#475569",
  maxWidth: 700,
};

const statusPillsStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
  justifyContent: "flex-end",
};

const pillBaseStyle: React.CSSProperties = {
  height: 30,
  padding: "0 10px",
  borderRadius: 999,
  border: "1px solid rgba(15, 23, 42, 0.10)",
  fontWeight: 900,
  fontSize: 12,
  cursor: "pointer",
};

const notesBlockStyle: React.CSSProperties = {
  marginTop: 12,
  paddingTop: 10,
  borderTop: "1px solid rgba(15, 23, 42, 0.08)",
};

const notesLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 900,
  color: "#334155",
  marginBottom: 6,
};

const textareaStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 80,
  resize: "vertical",
  borderRadius: 12,
  border: "1px solid rgba(15, 23, 42, 0.12)",
  padding: "10px 12px",
  outline: "none",
  background: "#ffffff",
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  color: "#0f172a",
};

