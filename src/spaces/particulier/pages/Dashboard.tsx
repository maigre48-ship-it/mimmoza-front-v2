import { useMemo } from "react";
import { Link } from "react-router-dom";

type QuickAction = {
  title: string;
  description: string;
  to: string;
};

type StatCard = {
  label: string;
  value: string;
  hint?: string;
};

type AlertItem = {
  title: string;
  detail: string;
  severity: "info" | "warning";
};

const pageWrap: React.CSSProperties = {
  padding: 8,
};

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
  lineHeight: 1.4,
};

const grid2: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
  gap: 14,
  alignItems: "stretch",
};

const card: React.CSSProperties = {
  border: "1px solid rgba(15, 23, 42, 0.10)",
  borderRadius: 16,
  background: "#ffffff",
  padding: 14,
  boxShadow: "0 6px 18px rgba(15, 23, 42, 0.04)",
};

const cardTitle: React.CSSProperties = {
  margin: 0,
  fontSize: 13,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "#64748b",
  fontWeight: 900,
};

const bigNumber: React.CSSProperties = {
  marginTop: 10,
  fontSize: 28,
  fontWeight: 900,
  color: "#0f172a",
  lineHeight: 1.1,
};

const smallHint: React.CSSProperties = {
  marginTop: 6,
  color: "#64748b",
  fontSize: 13,
};

const sectionTitle: React.CSSProperties = {
  margin: "16px 0 10px",
  fontSize: 14,
  fontWeight: 900,
  color: "#0f172a",
};

const list: React.CSSProperties = {
  display: "grid",
  gap: 8,
};

const actionLink: React.CSSProperties = {
  display: "block",
  padding: "12px 12px",
  borderRadius: 14,
  border: "1px solid rgba(15, 23, 42, 0.10)",
  textDecoration: "none",
  background: "#ffffff",
  transition: "transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease",
  color: "inherit",
};

const actionTitle: React.CSSProperties = {
  fontWeight: 900,
  color: "#0f172a",
  margin: 0,
};

const actionDesc: React.CSSProperties = {
  margin: "6px 0 0",
  color: "#475569",
  fontSize: 13,
  lineHeight: 1.35,
};

const badge: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 10px",
  borderRadius: 999,
  background: "rgba(99, 102, 241, 0.10)",
  border: "1px solid rgba(99, 102, 241, 0.25)",
  color: "#0f172a",
  fontWeight: 800,
  fontSize: 12,
};

const alertRow: React.CSSProperties = {
  display: "flex",
  gap: 10,
  padding: "10px 10px",
  borderRadius: 12,
  border: "1px solid rgba(15, 23, 42, 0.10)",
  background: "#ffffff",
};

const dot = (severity: "info" | "warning"): React.CSSProperties => ({
  width: 10,
  height: 10,
  borderRadius: 999,
  marginTop: 4,
  background: severity === "warning" ? "rgba(245, 158, 11, 0.90)" : "rgba(59, 130, 246, 0.90)",
});

const alertTitle: React.CSSProperties = {
  margin: 0,
  fontWeight: 900,
  color: "#0f172a",
  fontSize: 13,
};

const alertDetail: React.CSSProperties = {
  margin: "4px 0 0",
  color: "#475569",
  fontSize: 13,
  lineHeight: 1.35,
};

export default function Dashboard() {
  // Données mock (à brancher plus tard sur Supabase / API)
  const stats = useMemo<StatCard[]>(
    () => [
      { label: "Biens suivis", value: "3", hint: "Favoris + comparateur" },
      { label: "Alertes actives", value: "2", hint: "Recherche enregistrée" },
      { label: "Capacité estimée", value: "320 k€", hint: "Simulation indicative" },
      { label: "Budget travaux", value: "25 k€", hint: "Estimation macro" },
    ],
    []
  );

  const actions = useMemo<QuickAction[]>(
    () => [
      {
        title: "Lancer une recherche de biens",
        description: "Carte + filtres, enregistrez vos critères et suivez le marché.",
        to: "/particulier/recherche",
      },
      {
        title: "Mettre à jour mon projet",
        description: "Objectif, budget, calendrier et points de décision.",
        to: "/particulier/projet",
      },
      {
        title: "Comparer mes biens",
        description: "Prix, surface, quartier, charges et points forts/faibles.",
        to: "/particulier/comparateur",
      },
      {
        title: "Préparer le dossier banque",
        description: "Checklist des pièces, exports et notes utiles.",
        to: "/particulier/dossier",
      },
    ],
    []
  );

  const alerts = useMemo<AlertItem[]>(
    () => [
      {
        title: "2 nouvelles annonces correspondant à vos critères",
        detail: "Ouvrez Recherche de biens pour les consulter.",
        severity: "info",
      },
      {
        title: "Estimation à compléter",
        detail: "Ajoutez une estimation pour vos biens favoris afin de comparer au marché.",
        severity: "warning",
      },
    ],
    []
  );

  return (
    <div style={pageWrap}>
      <div style={headerRow}>
        <div>
          <h2 style={titleStyle}>TABLEAU DE BORD — TEST LIVE</h2>
          <p style={subtitleStyle}>
            Votre point d’entrée : suivi du projet, actions rapides et documents.
          </p>
        </div>

        <div style={badge}>Espace Particulier</div>
      </div>

      <div style={grid2}>
        <div style={card}>
          <p style={cardTitle}>Indicateurs</p>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
            {stats.map((s) => (
              <div
                key={s.label}
                style={{
                  border: "1px solid rgba(15, 23, 42, 0.08)",
                  borderRadius: 14,
                  padding: 12,
                  background: "rgba(248, 250, 252, 0.75)",
                }}
              >
                <div style={{ color: "#64748b", fontSize: 12, fontWeight: 900 }}>
                  {s.label}
                </div>
                <div style={bigNumber}>{s.value}</div>
                {s.hint ? <div style={smallHint}>{s.hint}</div> : null}
              </div>
            ))}
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link to="/particulier/favoris" style={{ ...actionLink, padding: "10px 12px" }}>
              <div style={{ fontWeight: 900, color: "#0f172a" }}>Voir les favoris</div>
            </Link>
            <Link to="/particulier/documents" style={{ ...actionLink, padding: "10px 12px" }}>
              <div style={{ fontWeight: 900, color: "#0f172a" }}>Mes documents</div>
            </Link>
          </div>
        </div>

        <div style={card}>
          <p style={cardTitle}>Alertes & prochaines étapes</p>

          <div style={{ marginTop: 10, ...list }}>
            {alerts.map((a, idx) => (
              <div key={idx} style={alertRow}>
                <div style={dot(a.severity)} />
                <div>
                  <p style={alertTitle}>{a.title}</p>
                  <p style={alertDetail}>{a.detail}</p>
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link to="/particulier/alertes" style={{ ...actionLink, padding: "10px 12px" }}>
              <div style={{ fontWeight: 900, color: "#0f172a" }}>Gérer les alertes</div>
            </Link>
            <Link to="/particulier/evaluation" style={{ ...actionLink, padding: "10px 12px" }}>
              <div style={{ fontWeight: 900, color: "#0f172a" }}>Faire une estimation</div>
            </Link>
          </div>
        </div>
      </div>

      <h3 style={sectionTitle}>Actions rapides</h3>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
        {actions.map((a) => (
          <Link
            key={a.to}
            to={a.to}
            style={actionLink}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.transform = "translateY(-1px)";
              (e.currentTarget as HTMLAnchorElement).style.boxShadow =
                "0 10px 24px rgba(15, 23, 42, 0.08)";
              (e.currentTarget as HTMLAnchorElement).style.borderColor = "rgba(99, 102, 241, 0.30)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.transform = "translateY(0px)";
              (e.currentTarget as HTMLAnchorElement).style.boxShadow =
                "0 0 0 rgba(15, 23, 42, 0.00)";
              (e.currentTarget as HTMLAnchorElement).style.borderColor = "rgba(15, 23, 42, 0.10)";
            }}
          >
            <p style={actionTitle}>{a.title}</p>
            <p style={actionDesc}>{a.description}</p>
          </Link>
        ))}
      </div>

      <h3 style={sectionTitle}>Documents</h3>

      <div style={grid2}>
        <div style={card}>
          <p style={cardTitle}>Dossier</p>
          <p style={{ margin: "10px 0 0", color: "#475569", lineHeight: 1.5 }}>
            Centralisez vos pièces, exports et notes. Objectif : un dossier clair pour gagner du temps
            lors des visites et du financement.
          </p>

          <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link to="/particulier/documents" style={{ ...actionLink, padding: "10px 12px" }}>
              <div style={{ fontWeight: 900, color: "#0f172a" }}>Mes documents</div>
            </Link>
            <Link to="/particulier/exports" style={{ ...actionLink, padding: "10px 12px" }}>
              <div style={{ fontWeight: 900, color: "#0f172a" }}>Exports</div>
            </Link>
            <Link to="/particulier/historique" style={{ ...actionLink, padding: "10px 12px" }}>
              <div style={{ fontWeight: 900, color: "#0f172a" }}>Historique</div>
            </Link>
          </div>
        </div>

        <div style={card}>
          <p style={cardTitle}>Financement</p>
          <p style={{ margin: "10px 0 0", color: "#475569", lineHeight: 1.5 }}>
            Travaillez en scénarios : apport, durée, taux. Conservez vos hypothèses et préparez votre
            dossier banque.
          </p>

          <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link to="/particulier/financement" style={{ ...actionLink, padding: "10px 12px" }}>
              <div style={{ fontWeight: 900, color: "#0f172a" }}>Capacité</div>
            </Link>
            <Link to="/particulier/scenarios" style={{ ...actionLink, padding: "10px 12px" }}>
              <div style={{ fontWeight: 900, color: "#0f172a" }}>Scénarios</div>
            </Link>
            <Link to="/particulier/dossier" style={{ ...actionLink, padding: "10px 12px" }}>
              <div style={{ fontWeight: 900, color: "#0f172a" }}>Dossier banque</div>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

