// FILE: src/spaces/promoteur/etudes/marche/components/InsightsPanel.tsx

import React from "react";
import { CheckCircle, AlertTriangle, Lightbulb, XCircle } from "lucide-react";
import { Insight } from "../types";

interface InsightsPanelProps {
  insights: Insight[];
  maxItems?: number;
}

const TYPE_CONFIG = {
  positive: {
    icon: CheckCircle,
    bg: "#ecfdf5",
    border: "#a7f3d0",
    color: "#065f46",
    dot: "#10b981",
    title: "Points forts",
  },
  warning: {
    icon: AlertTriangle,
    bg: "#fef3c7",
    border: "#fcd34d",
    color: "#92400e",
    dot: "#f59e0b",
    title: "Points de vigilance",
  },
  opportunity: {
    icon: Lightbulb,
    bg: "#dbeafe",
    border: "#93c5fd",
    color: "#1e40af",
    dot: "#3b82f6",
    title: "Opportunités",
  },
  negative: {
    icon: XCircle,
    bg: "#fee2e2",
    border: "#fca5a5",
    color: "#991b1b",
    dot: "#ef4444",
    title: "Alertes",
  },
};

// Fonction pour nettoyer/reformuler certains messages techniques
const sanitizeInsightText = (text: string | undefined): string => {
  if (!text) return "";
  
  // Remplacer les formulations techniques par des versions plus neutres
  return text
    // Capacité non disponible via FINESS/OSM -> Capacité non publiée
    .replace(/Capacité \(lits\) non disponible via FINESS\/OSM\.?/gi, "Capacité non publiée.")
    .replace(/Capacité non disponible via FINESS\/OSM\.?/gi, "Capacité non publiée.")
    .replace(/Capacité \(lits\) non disponible\.?/gi, "Capacité non publiée.")
    // Autres variantes possibles
    .replace(/données FINESS\/OSM non disponibles?\.?/gi, "données non publiées.")
    .replace(/via FINESS\/OSM/gi, "")
    // Nettoyage des espaces doubles
    .replace(/\s{2,}/g, " ")
    .trim();
};

export const InsightsPanel: React.FC<InsightsPanelProps> = ({ insights, maxItems = 5 }) => {
  const grouped = insights.reduce((acc, insight) => {
    const type = insight.type;
    if (!acc[type]) acc[type] = [];
    acc[type].push(insight);
    return acc;
  }, {} as Record<string, Insight[]>);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {(["positive", "opportunity", "warning", "negative"] as const).map((type) => {
        const items = grouped[type] || [];
        if (items.length === 0) return null;

        const config = TYPE_CONFIG[type];
        const Icon = config.icon;

        return (
          <div
            key={type}
            style={{
              background: "white",
              borderRadius: "16px",
              padding: "20px",
              boxShadow: "0 4px 20px rgba(0,0,0,0.04)",
              border: "1px solid #e2e8f0",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                marginBottom: "16px",
              }}
            >
              <Icon size={20} color={config.dot} />
              <h3 style={{ fontSize: "16px", fontWeight: 700, color: "#1e293b", margin: 0 }}>
                {config.title}
              </h3>
              <span
                style={{
                  marginLeft: "auto",
                  padding: "4px 10px",
                  background: config.bg,
                  borderRadius: "6px",
                  fontSize: "12px",
                  fontWeight: 600,
                  color: config.color,
                }}
              >
                {items.length}
              </span>
            </div>

            {items.slice(0, maxItems).map((insight) => (
              <div
                key={insight.id}
                style={{
                  padding: "12px 14px",
                  background: config.bg,
                  border: `1px solid ${config.border}`,
                  borderRadius: "10px",
                  marginBottom: "8px",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
                  <span
                    style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      background: config.dot,
                      marginTop: "6px",
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <p style={{ fontSize: "14px", fontWeight: 600, color: "#1e293b", margin: 0 }}>
                        {sanitizeInsightText(insight.title)}
                      </p>
                      {insight.value && (
                        <span style={{ fontSize: "14px", fontWeight: 700, color: config.color }}>
                          {insight.value}
                        </span>
                      )}
                    </div>
                    <p style={{ fontSize: "13px", color: "#475569", margin: "4px 0 0 0" }}>
                      {sanitizeInsightText(insight.description)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
};