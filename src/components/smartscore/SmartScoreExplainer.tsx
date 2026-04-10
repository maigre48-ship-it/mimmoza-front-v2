// ============================================================================
// SmartScoreExplainer.tsx
// Carte d'explication du SmartScore pour la page Pipeline
// Design : Mimmoza Investisseur (sky blue accent)
// ============================================================================

import { useState } from "react";

// ─── Types ──────────────────────────────────────────────────────────────────

type PillarInfo = {
  key: string;
  label: string;
  icon: string;
  description: string;
  weight: number;       // Poids par défaut (%)
  color: string;
  implemented: boolean;
};

const PILLARS: PillarInfo[] = [
  {
    key: "marche",
    label: "Marché",
    icon: "📈",
    description: "Tendance des prix, liquidité, rendement locatif et volume de transactions DVF autour du bien.",
    weight: 25,
    color: "#10b981",
    implemented: true,
  },
  {
    key: "transport",
    label: "Transports / Accessibilité",
    icon: "🚆",
    description: "Score TC en zone métro, ou proximité des services quotidiens (pharmacie, commerce, médecin) en zone rurale.",
    weight: 20,
    color: "#3b82f6",
    implemented: true,
  },
  {
    key: "essential_services",
    label: "Services essentiels",
    icon: "📍",
    description: "Distance à la pharmacie, au commerce alimentaire, au médecin, à la poste et à la banque les plus proches.",
    weight: 15,
    color: "#06b6d4",
    implemented: true,
  },
  {
    key: "ecoles",
    label: "Écoles",
    icon: "🎓",
    description: "Nombre et proximité d'établissements scolaires dans un rayon de 1 km.",
    weight: 15,
    color: "#f59e0b",
    implemented: true,
  },
  {
    key: "sante",
    label: "Santé",
    icon: "❤️",
    description: "Densité de professionnels de santé sur la commune, hôpital le plus proche.",
    weight: 10,
    color: "#ef4444",
    implemented: true,
  },
  {
    key: "environnement",
    label: "Environnement",
    icon: "🌿",
    description: "Risques naturels (Géorisques), DPE moyen du quartier, qualité de l'air, nuisances sonores.",
    weight: 5,
    color: "#22c55e",
    implemented: true,
  },
  {
    key: "concurrence",
    label: "Concurrence",
    icon: "🏗️",
    description: "Permis de construire concurrents dans le périmètre (Sitadel). Détecte les risques de sur-offre.",
    weight: 5,
    color: "#f97316",
    implemented: true,
  },
  {
    key: "demographie",
    label: "Démographie",
    icon: "👥",
    description: "Tendance population sur 5-10 ans, vieillissement, projections INSEE Omphale.",
    weight: 5,
    color: "#a855f7",
    implemented: true,
  },
];

// ─── Composant principal ────────────────────────────────────────────────────

export default function SmartScoreExplainer() {
  const [expanded, setExpanded] = useState(false);
  const [hoveredPillar, setHoveredPillar] = useState<string | null>(null);

  return (
    <div
      style={{
        background: "linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 40%, #f0fdf4 100%)",
        borderRadius: 16,
        border: "1px solid #bae6fd",
        padding: expanded ? 28 : 20,
        marginBottom: 24,
        transition: "all 0.3s ease",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Accent line */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          background: "linear-gradient(90deg, #0ea5e9, #06b6d4, #10b981)",
        }}
      />

      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: "linear-gradient(135deg, #0ea5e9, #06b6d4)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 20,
              color: "#fff",
              fontWeight: 700,
              boxShadow: "0 2px 8px rgba(14, 165, 233, 0.3)",
            }}
          >
            S
          </div>
          <div>
            <h3
              style={{
                margin: 0,
                fontSize: 16,
                fontWeight: 700,
                color: "#0c4a6e",
                letterSpacing: "-0.02em",
              }}
            >
              SmartScore — Qu'est-ce que c'est ?
            </h3>
            <p
              style={{
                margin: 0,
                fontSize: 13,
                color: "#64748b",
                marginTop: 2,
              }}
            >
              Un score intelligent sur 100 qui évalue chaque deal sur 8 critères clés
            </p>
          </div>
        </div>

        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "1px solid #e2e8f0",
            transition: "transform 0.2s",
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
            fontSize: 14,
            color: "#64748b",
          }}
        >
          ▼
        </div>
      </div>

      {/* Contenu déplié */}
      {expanded && (
        <div
          style={{
            marginTop: 20,
            animation: "fadeIn 0.3s ease",
          }}
        >
          {/* Explication courte */}
          <div
            style={{
              background: "#fff",
              borderRadius: 12,
              padding: 16,
              marginBottom: 16,
              border: "1px solid #e2e8f0",
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: 14,
                lineHeight: 1.6,
                color: "#334155",
              }}
            >
              Le <strong>SmartScore</strong> analyse automatiquement chaque bien
              sur <strong>8 piliers</strong> en croisant des données publiques
              (DVF, INSEE, BPE, FINESS, Géorisques, Sitadel…).
              Les poids s'adaptent au <strong>type de projet</strong> :
              un EHPAD surpondère la santé, une résidence étudiante les transports.
              <br />
              <span style={{ color: "#64748b", fontSize: 13 }}>
                Vous pouvez ajuster les poids via les sliders dans l'onglet SmartScore.
              </span>
            </p>
          </div>

          {/* Grille des piliers */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: 10,
            }}
          >
            {PILLARS.map((p) => (
              <div
                key={p.key}
                onMouseEnter={() => setHoveredPillar(p.key)}
                onMouseLeave={() => setHoveredPillar(null)}
                style={{
                  background: hoveredPillar === p.key ? "#fff" : "#fafbfc",
                  borderRadius: 10,
                  padding: 12,
                  border: `1px solid ${hoveredPillar === p.key ? p.color + "60" : "#e2e8f0"}`,
                  transition: "all 0.2s ease",
                  cursor: "default",
                  transform: hoveredPillar === p.key ? "translateY(-1px)" : "none",
                  boxShadow: hoveredPillar === p.key
                    ? `0 4px 12px ${p.color}15`
                    : "none",
                }}
              >
                {/* Header pilier */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 6,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 16 }}>{p.icon}</span>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "#1e293b",
                      }}
                    >
                      {p.label}
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: p.color,
                      background: p.color + "15",
                      padding: "2px 6px",
                      borderRadius: 4,
                    }}
                  >
                    {p.weight}%
                  </span>
                </div>

                {/* Barre de poids */}
                <div
                  style={{
                    height: 3,
                    borderRadius: 2,
                    background: "#e2e8f0",
                    marginBottom: 6,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${p.weight * 3}%`,
                      background: p.color,
                      borderRadius: 2,
                      transition: "width 0.4s ease",
                    }}
                  />
                </div>

                {/* Description */}
                <p
                  style={{
                    margin: 0,
                    fontSize: 11.5,
                    lineHeight: 1.5,
                    color: "#64748b",
                  }}
                >
                  {p.description}
                </p>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div
            style={{
              marginTop: 14,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span style={{ fontSize: 11, color: "#94a3b8" }}>
              Sources : DVF · INSEE · BPE · FINESS · Géorisques · Sitadel · ADEME · Overpass
            </span>
            <span
              style={{
                fontSize: 11,
                color: "#0ea5e9",
                cursor: "pointer",
                fontWeight: 500,
              }}
            >
              En savoir plus →
            </span>
          </div>
        </div>
      )}
    </div>
  );
}