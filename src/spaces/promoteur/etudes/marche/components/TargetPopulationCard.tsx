// FILE: src/spaces/promoteur/etudes/marche/components/TargetPopulationCard.tsx

import React from "react";
import { Users, TrendingUp, TrendingDown, UserX } from "lucide-react";
import { DemographicsData, DemographicSegment, ProjectType } from "../types";
import { getProjectConfig } from "../config";

interface TargetPopulationCardProps {
  demographics: DemographicsData;
  projectType: ProjectType;
}

export const TargetPopulationCard: React.FC<TargetPopulationCardProps> = ({
  demographics,
  projectType,
}) => {
  const config = getProjectConfig(projectType);
  const target = demographics.targetPopulation;

  if (!target) return null;

  return (
    <div
      style={{
        background: "white",
        borderRadius: "16px",
        padding: "24px",
        boxShadow: "0 4px 20px rgba(0,0,0,0.04)",
        border: "1px solid #e2e8f0",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          marginBottom: "20px",
        }}
      >
        <div
          style={{
            width: "40px",
            height: "40px",
            borderRadius: "10px",
            background: `linear-gradient(135deg, ${config.color}20 0%, ${config.color}40 100%)`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Users size={20} color={config.color} />
        </div>
        <div>
          <h3 style={{ fontSize: "16px", fontWeight: 700, color: "#1e293b", margin: 0 }}>
            Population cible
          </h3>
          <p style={{ fontSize: "13px", color: "#64748b", margin: 0 }}>{target.label}</p>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px" }}>
        {/* Nombre */}
        <div
          style={{
            background: `linear-gradient(135deg, ${config.color}10 0%, ${config.color}20 100%)`,
            borderRadius: "12px",
            padding: "16px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "28px", fontWeight: 800, color: config.color }}>
            {target.count.toLocaleString("fr-FR")}
          </div>
          <div style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>personnes</div>
        </div>

        {/* Pourcentage */}
        <div
          style={{
            background: "#f8fafc",
            borderRadius: "12px",
            padding: "16px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "28px", fontWeight: 800, color: "#1e293b" }}>
            {target.percentage.toFixed(1)}%
          </div>
          <div style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>de la population</div>
        </div>

        {/* Évolution */}
        <div
          style={{
            background: target.evolution5y >= 0 ? "#ecfdf5" : "#fef2f2",
            borderRadius: "12px",
            padding: "16px",
            textAlign: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "4px",
              fontSize: "28px",
              fontWeight: 800,
              color: target.evolution5y >= 0 ? "#059669" : "#dc2626",
            }}
          >
            {target.evolution5y >= 0 ? <TrendingUp size={24} /> : <TrendingDown size={24} />}
            {target.evolution5y > 0 ? "+" : ""}
            {target.evolution5y.toFixed(1)}%
          </div>
          <div style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>sur 5 ans</div>
        </div>
      </div>

      {/* Pyramide des âges pour les segments */}
      {config.demographicSegments.length > 0 && (
        <div style={{ marginTop: "20px" }}>
          <div style={{ fontSize: "13px", fontWeight: 600, color: "#64748b", marginBottom: "12px" }}>
            Répartition par tranche d'âge
          </div>
          {config.demographicSegments.map((segment) => {
            const value = (demographics.ageStructure as Record<string, number>)[segment.inseeField];
            if (value == null) return null;

            return (
              <div
                key={segment.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  marginBottom: "8px",
                }}
              >
                <span style={{ fontSize: "12px", color: "#64748b", width: "80px" }}>{segment.label}</span>
                <div
                  style={{
                    flex: 1,
                    height: "20px",
                    background: "#f1f5f9",
                    borderRadius: "10px",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${Math.min(value * 2.5, 100)}%`,
                      height: "100%",
                      background: segment.color,
                      borderRadius: "10px",
                      transition: "width 0.5s ease-out",
                    }}
                  />
                </div>
                <span
                  style={{
                    fontSize: "13px",
                    fontWeight: 700,
                    color: segment.isPrimary ? segment.color : "#1e293b",
                    width: "50px",
                    textAlign: "right",
                  }}
                >
                  {value.toFixed(1)}%
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};