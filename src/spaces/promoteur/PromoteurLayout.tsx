```typescript
// src/spaces/promoteur/PromoteurLayout.tsx
import React from "react";
import {
  BarChart3,
  PlusCircle,
  Files,
  Zap,
  Target,
  Euro,
  TrendingUp,
  Building2,
  Map,
  Calculator,
  Sparkles,
  Box,
  Clock,
} from "lucide-react";

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "linear-gradient(135deg, #f9fafb 0%, #ffffff 40%, #eef2ff 100%)",
  padding: "32px 16px",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  color: "#0f172a",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
};

const containerStyle: React.CSSProperties = {
  maxWidth: "1120px",
  width: "100%",
  margin: "0 auto",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  padding: "24px 0",
  gap: "32px",
  borderBottom: "2px solid #e5e7eb",
};

const headerLogo: React.CSSProperties = {
  fontSize: "26px",
  fontWeight: 700,
  color: "#1d4ed8",
};

const headerButton: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  borderRadius: "999px",
  border: "none",
  background: "#1d4ed8",
  padding: "10px 18px",
  fontSize: "13px",
  fontWeight: 700,
  color: "white",
  cursor: "pointer",
};

const heroStyle: React.CSSProperties = {
  position: "relative",
  overflow: "hidden",
  borderRadius: "24px",
  padding: "32px 32px 32px 32px",
  background:
    "linear-gradient(135deg, #2563eb 0%, #4f46e5 40%, #7c3aed 75%, #22c55e 100%)",
  boxShadow: "0 25px 50px rgba(15,23,42,0.35)",
  marginBottom: "24px",
  color: "white",
};

const heroDecor1: React.CSSProperties = {
  position: "absolute",
  top: "-120px",
  right: "-120px",
  width: "260px",
  height: "260px",
  borderRadius: "999px",
  background: "rgba(255,255,255,0.18)",
  filter: "blur(18px)",
};

const heroDecor2: React.CSSProperties = {
  position: "absolute",
  bottom: "-120px",
  left: "-120px",
  width: "220px",
  height: "220px",
  borderRadius: "999px",
  background: "rgba(56,189,248,0.2)",
  filter: "blur(22px)",
};

const heroInner: React.CSSProperties = {
  position: "relative",
  zIndex: 1,
  display: "flex",
  flexDirection: "column",
  gap: "24px",
};

const heroTopRow: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "16px",
};

const heroBadge: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  borderRadius: "999px",
  border: "1px solid rgba(255,255,255,0.4)",
  background: "rgba(15,23,42,0.18)",
  padding: "6px 14px",
  fontSize: "10px",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  fontWeight: 600,
  backdropFilter: "blur(10px)",
};

const heroMainRow: React.CSSProperties = {
  display: "flex",
  flexDirection: "row",
  alignItems: "flex-end",
  justifyContent: "space-between",
  gap: "24px",
  flexWrap: "wrap",
};

const heroTitleBlock: React.CSSProperties = {
  maxWidth: "560px",
};

const heroTitle: React.CSSProperties = {
  fontSize: "32px",
  lineHeight: 1.1,
  fontWeight: 700,
  marginBottom: "8px",
};

const heroSubtitle: React.CSSProperties = {
  fontSize: "14px",
  lineHeight: 1.5,
  opacity: 0.92,
};

const heroActions: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "10px",
};

const ghostButton: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  borderRadius: "999px",
  border: "1px solid rgba(255,255,255,0.6)",
  background: "rgba(15,23,42,0.18)",
  padding: "9px 16px",
  fontSize: "12px",
  fontWeight: 600,
  color: "white",
  cursor: "pointer",
};

const primaryButton: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  borderRadius: "999px",
  border: "none",
  background: "white",
  padding: "10px 18px",
  fontSize: "13px",
  fontWeight: 700,
  color: "#1d4ed8",
  cursor: "pointer",
  boxShadow: "0 18px 30px rgba(15,23,42,0.35)",
};

const cardsRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: "16px",
  marginBottom: "24px",
};

const card: React.CSSProperties = {
  position: "relative",
  overflow: "hidden",
  borderRadius: "18px",
  background: "white",
  border: "1px solid #e5e7eb",
  padding: "18px 18px 16px 18px",
  boxShadow: "0 12px 24px rgba(15,23,42,0.08)",
};

const cardTitle: React.CSSProperties = {
  fontSize: "11px",
  textTransform: "uppercase",
  letterSpacing: "0.16em",
  color: "#6b7280",
  fontWeight: 700,
  marginBottom: "6px",
};

const cardValue: React.CSSProperties = {
  fontSize: "26px",
  fontWeight: 700,
  color: "#0f172a",
  marginBottom: "4px",
};

const cardSubtitle: React.CSSProperties = {
  fontSize: "11px",
  color: "#4b5563",
};

const cardIconCircle = (bg: string): React.CSSProperties => ({
  position: "absolute",
  top: "14px",
  right: "14px",
  width: "32px",
  height: "32px",
  borderRadius: "999px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: bg,
  boxShadow: "0 12px 20px rgba(15,23,42,0.15)",
});

const twoCols: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
  gap: "16px",
};

const panel: React.CSSProperties = {
  borderRadius: "18px",
  background: "white",
  border: "1px solid #e5e7eb",
  padding: "18px 18px 16px 18px",
  boxShadow: "0 10px 22px rgba(15,23,42,0.08)",
};

const panelTitleRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  marginBottom: "8px",
};

const panelTitle: React.CSSProperties = {
  fontSize: "15px",
  fontWeight: 600,
  color: "#0f172a",
};

const panelText: React.CSSProperties = {
  fontSize: "12px",
  color: "#4b5563",
  lineHeight: 1.5,
};

const stepsRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: "10px",
  marginTop: "14px",
};

const stepCard = (
  borderColor: string,
  bg: string,
  _labelColor: string
): React.CSSProperties => ({
  position: "relative",
  borderRadius: "14px",
  border: `1px dashed ${borderColor}`,
  background: bg,
  padding: "14px 12px 10px 12px",
});

const stepLabel = (color: string): React.CSSProperties => ({
  position: "absolute",
  top: "-10px",
  left: "12px",
  background: "white",
  padding: "2px 8px",
  borderRadius: "999px",
  fontSize: "9px",
  fontWeight: 700,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color,
  border: "1px solid #e5e7eb",
});

const stepTitleRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  marginBottom: "6px",
};

const stepIconCircle = (bg: string): React.CSSProperties => ({
  width: "26px",
  height: "26px",
  borderRadius: "10px",
  background: bg,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxShadow: "0 6px 12px rgba(15,23,42,0.18)",
});

const stepTitle: React.CSSProperties = {
  fontSize: "13px",
  fontWeight: 600,
  color: "#0f172a",
};

const stepText: React.CSSProperties = {
  fontSize: "11px",
  color: "#4b5563",
  lineHeight: 1.45,
};

const chipList: React.CSSProperties = {
  marginTop: "10px",
  display: "flex",
  flexDirection: "column",
  gap: "4px",
  fontSize: "11px",
  color: "#4b5563",
};

const chipItem: React.CSSProperties = {
  display: "flex",
  gap: "6px",
  alignItems: "flex-start",
};

const chipDot = (color: string): React.CSSProperties => ({
  marginTop: "4px",
  width: "6px",
  height: "6px",
  borderRadius: "999px",
  background: color,
});

interface PromoteurLayoutProps {
  onGoHome: () => void;
}

export function PromoteurLayout({ onGoHome }: PromoteurLayoutProps) {
  return (
    <div style={pageStyle}>
      <div style={containerStyle}>
        {/* HEADER */}
        <header style={headerStyle}>
          <div style={headerLogo}>Mimmoza</div>
          <button style={headerButton} onClick={onGoHome}>
            Accueil
          </button>
        </header>

        {/* HERO */}
        <section style={heroStyle}>
          <div style={heroDecor1} />
          <div style={heroDecor2} />

          <div style={heroInner}>
            <div style={heroTopRow}>
              <div style={heroBadge}>
                <Zap size={14} />
                <span>Beta Privée · PLU Engine · Promoteur V1</span>
              </div>
            </div>

            <div style={heroMainRow}>
              <div style={heroTitleBlock}>
                <h1 style={heroTitle}>Mimmoza Promoteur</h1>
                <p style={heroSubtitle}>
                  Studio complet de faisabilité foncière : cadastre, PLU, DVF et bilan
                  promoteur réunis dans un seul espace.
                </p>
              </div>

              <div style={heroActions}>
                <button style={ghostButton}>
                  <Files size={16} />
                  Voir les opérations
                </button>
                <button style={primaryButton}>
                  <PlusCircle size={16} />
                  Nouvelle étude foncière
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* KPI CARDS */}
        <section style={cardsRow}>
          {/* Opérations */}
          <div style={card}>
            <div
              style={cardIconCircle(
                "linear-gradient(135deg,#3b82f6,#6366f1)"
              )}
            >
              <BarChart3 size={18} color="#ffffff" />
            </div>
            <p style={cardTitle}>Opérations analysées</p>
            <p style={cardValue}>0</p>
            <p style={cardSubtitle}>
              En attente de premières analyses. Les opérations réalisées
              s&apos;afficheront ici avec leur marge et leur volume.
            </p>
          </div>

          {/* Marge cible */}
          <div style={card}>
            <div
              style={cardIconCircle(
                "linear-gradient(135deg,#22c55e,#16a34a)"
              )}
            >
              <Target size={18} color="#ffffff" />
            </div>
            <p style={cardTitle}>Marge cible</p>
            <p style={cardValue}>18–22%</p>
            <p
              style={{
                ...cardSubtitle,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <TrendingUp size={14} color="#16a34a" />
              <span>Valeur par défaut pour les études. Personnalisable.</span>
            </p>
          </div>

          {/* Volume étudié */}
          <div style={card}>
            <div
              style={cardIconCircle(
                "linear-gradient(135deg,#f59e0b,#ea580c)"
              )}
            >
              <Euro size={18} color="#ffffff" />
            </div>
            <p style={cardTitle}>Volume étudié</p>
            <p style={cardValue}>– €</p>
            <p style={cardSubtitle}>
              S&apos;affichera après les premières simulations (foncier, SDP, valeur de
              sortie).
            </p>
          </div>
        </section>

        {/* 2 COLS */}
        <section style={twoCols}>
          {/* Colonne gauche */}
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {/* Démarrer une étude */}
            <div style={panel}>
              <div style={panelTitleRow}>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 12,
                    background: "#eff6ff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Sparkles size={18} color="#2563eb" />
                </div>
                <h2 style={panelTitle}>Démarrer une nouvelle étude</h2>
              </div>
              <p style={panelText}>
                Choisis un terrain, applique les règles du PLU et calcule instantanément
                la SDP potentielle.
              </p>

              <div style={stepsRow}>
                {/* Étape 1 */}
                <div
                  style={stepCard(
                    "#bfdbfe",
                    "linear-gradient(135deg,#eff6ff,#dbeafe)",
                    "#2563eb"
                  )}
                >
                  <div style={stepLabel("#2563eb")}>ÉTAPE 1</div>
                  <div style={stepTitleRow}>
                    <div style={stepIconCircle("#2563eb")}>
                      <Map size={14} color="#ffffff" />
                    </div>
                    <span style={stepTitle}>Parcelle</span>
                  </div>
                  <p style={stepText}>
                    Sélection depuis le cadastre Mimmoza ou saisie d&apos;un identifiant
                    parcellaire.
                  </p>
                </div>

                {/* Étape 2 */}
                <div
                  style={stepCard(
                    "#c7d2fe",
                    "linear-gradient(135deg,#eef2ff,#e0e7ff)",
                    "#4f46e5"
                  )}
                >
                  <div style={stepLabel("#4f46e5")}>ÉTAPE 2</div>
                  <div style={stepTitleRow}>
                    <div style={stepIconCircle("#4f46e5")}>
                      <Building2 size={14} color="#ffffff" />
                    </div>
                    <span style={stepTitle}>Règles PLU</span>
                  </div>
                  <p style={stepText}>
                    Hauteur, emprise, stationnement, SDP max générées automatiquement par
                    le PLU Engine.
                  </p>
                </div>

                {/* Étape 3 */}
                <div
                  style={stepCard(
                    "#ddd6fe",
                    "linear-gradient(135deg,#f5f3ff,#ede9fe)",
                    "#7c3aed"
                  )}
                >
                  <div style={stepLabel("#7c3aed")}>ÉTAPE 3</div>
                  <div style={stepTitleRow}>
                    <div style={stepIconCircle("#7c3aed")}>
                      <Calculator size={14} color="#ffffff" />
                    </div>
                    <span style={stepTitle}>Bilan promoteur</span>
                  </div>
                  <p style={stepText}>
                    Coûts, prix de vente, marge et TRI calculés automatiquement selon tes
                    hypothèses.
                  </p>
                </div>
              </div>
            </div>

            {/* Historique */}
            <div
              style={{
                ...panel,
                background:
                  "linear-gradient(135deg, #fffbeb 0%, #fef3c7 40%, #ffedd5 100%)",
                borderColor: "#facc15",
              }}
            >
              <div style={panelTitleRow}>
                <div
                 