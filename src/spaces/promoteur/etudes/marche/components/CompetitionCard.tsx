// FILE: src/spaces/promoteur/etudes/marche/components/CompetitionCard.tsx

import React, { useState } from "react";
import { Building, ChevronDown, ChevronUp, Users, Percent, Euro, MapPin, Star } from "lucide-react";
import { CompetitionData, ProjectType } from "../types";
import { getProjectConfig } from "../config";

interface CompetitionCardProps {
  competition: CompetitionData;
  projectType: ProjectType;
}

// Helper pour extraire les données d'un établissement avec fallbacks robustes
const getFacilityDisplayData = (facility: any) => {
  const name = facility.name || facility.nom || facility.label || "EHPAD";
  
  const address = facility.address || facility.adresse || facility.address_label || facility.addressLabel || "";
  const displayAddress = address.trim() || "Adresse non renseignée";
  
  const beds = facility.beds_total || facility.capacity || facility.lits || facility.beds || null;
  
  const distance = facility.distance_km ?? facility.distanceKm ?? facility.distance ?? null;
  
  return {
    name,
    displayAddress,
    beds,
    distance,
    // Conserver les autres propriétés existantes
    commune: facility.commune,
    stars: facility.stars,
    occupancyRate: facility.occupancyRate,
    dailyRate: facility.dailyRate,
  };
};

export const CompetitionCard: React.FC<CompetitionCardProps> = ({ competition, projectType }) => {
  const [expanded, setExpanded] = useState(false);
  const config = getProjectConfig(projectType);

  const getProjectLabel = () => {
    switch (projectType) {
      case "ehpad":
        return { singular: "EHPAD", plural: "EHPAD", unit: "lits" };
      case "residence_senior":
        return { singular: "Résidence", plural: "Résidences seniors", unit: "logements" };
      case "residence_etudiante":
        return { singular: "Résidence", plural: "Résidences étudiantes", unit: "places" };
      case "hotel":
        return { singular: "Hôtel", plural: "Hôtels", unit: "chambres" };
      default:
        return { singular: "Établissement", plural: "Établissements", unit: "unités" };
    }
  };

  const labels = getProjectLabel();

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
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "20px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
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
            <Building size={20} color={config.color} />
          </div>
          <div>
            <h3 style={{ fontSize: "16px", fontWeight: 700, color: "#1e293b", margin: 0 }}>
              Concurrence & Offre existante
            </h3>
            <p style={{ fontSize: "13px", color: "#64748b", margin: 0 }}>
              {competition.totalCount} {labels.plural.toLowerCase()} dans la zone
            </p>
          </div>
        </div>

        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            padding: "6px 12px",
            background: "#f1f5f9",
            borderRadius: "8px",
            fontSize: "13px",
            fontWeight: 600,
            color: "#475569",
          }}
        >
          {competition.totalCapacity.toLocaleString("fr-FR")} {labels.unit}
        </div>
      </div>

      {/* Métriques */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", marginBottom: "20px" }}>
        <div style={{ padding: "14px", background: "#f8fafc", borderRadius: "10px", textAlign: "center" }}>
          <div style={{ fontSize: "24px", fontWeight: 800, color: config.color }}>
            {competition.totalCount}
          </div>
          <div style={{ fontSize: "11px", color: "#64748b", fontWeight: 500 }}>{labels.plural}</div>
        </div>

        {competition.avgOccupancyRate != null && (
          <div style={{ padding: "14px", background: "#ecfdf5", borderRadius: "10px", textAlign: "center" }}>
            <div
              style={{
                fontSize: "24px",
                fontWeight: 800,
                color: competition.avgOccupancyRate >= 90 ? "#dc2626" : "#059669",
              }}
            >
              {competition.avgOccupancyRate}%
            </div>
            <div style={{ fontSize: "11px", color: "#64748b", fontWeight: 500 }}>Taux occupation</div>
          </div>
        )}

        {competition.analysis?.estimatedDeficit != null && (
          <div style={{ padding: "14px", background: "#dbeafe", borderRadius: "10px", textAlign: "center" }}>
            <div style={{ fontSize: "24px", fontWeight: 800, color: "#1e40af" }}>
              {competition.analysis.estimatedDeficit}
            </div>
            <div style={{ fontSize: "11px", color: "#64748b", fontWeight: 500 }}>Déficit {labels.unit}</div>
          </div>
        )}
      </div>

      {/* Verdict */}
      {competition.analysis?.verdict && (
        <div
          style={{
            padding: "14px 18px",
            background: "#f8fafc",
            borderRadius: "10px",
            borderLeft: `4px solid ${config.color}`,
            marginBottom: "16px",
          }}
        >
          <p style={{ fontSize: "13px", color: "#475569", margin: 0, lineHeight: 1.5 }}>
            {competition.analysis.verdict}
          </p>
        </div>
      )}

      {/* Liste établissements */}
      {competition.facilities.length > 0 && (
        <div>
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              width: "100%",
              padding: "12px 0",
              background: "none",
              border: "none",
              cursor: "pointer",
              borderTop: "1px solid #e2e8f0",
            }}
          >
            <span style={{ fontSize: "13px", fontWeight: 600, color: "#64748b" }}>
              Voir les {competition.facilities.length} établissements
            </span>
            {expanded ? <ChevronUp size={18} color="#64748b" /> : <ChevronDown size={18} color="#64748b" />}
          </button>

          {expanded && (
            <div style={{ maxHeight: "300px", overflowY: "auto" }}>
              {competition.facilities.map((facility, i) => {
                const displayData = getFacilityDisplayData(facility);
                
                return (
                  <div
                    key={facility.id || i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "12px",
                      background: i % 2 === 0 ? "#f8fafc" : "white",
                      borderRadius: "8px",
                      marginBottom: "4px",
                    }}
                  >
                    {/* Partie gauche: Nom + Adresse + Distance */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {/* Ligne 1: Nom (gras) */}
                      <div
                        style={{
                          fontSize: "14px",
                          fontWeight: 600,
                          color: "#1e293b",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {displayData.name}
                      </div>
                      
                      {/* Ligne 2: Adresse (petit/gris) */}
                      <div
                        style={{
                          fontSize: "12px",
                          color: displayData.displayAddress === "Adresse non renseignée" ? "#94a3b8" : "#64748b",
                          marginTop: "4px",
                          fontStyle: displayData.displayAddress === "Adresse non renseignée" ? "italic" : "normal",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        <MapPin size={12} style={{ marginRight: "4px", verticalAlign: "middle" }} />
                        {displayData.displayAddress}
                      </div>
                      
                      {/* Ligne 3 optionnelle: Distance + Étoiles */}
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "4px" }}>
                        {displayData.distance != null && (
                          <span style={{ fontSize: "11px", color: "#94a3b8" }}>
                            {typeof displayData.distance === "number"
                              ? `${displayData.distance.toFixed(1)} km`
                              : displayData.distance}
                          </span>
                        )}
                        {displayData.stars && (
                          <span style={{ display: "flex", alignItems: "center", gap: "2px" }}>
                            {Array(displayData.stars)
                              .fill(0)
                              .map((_, j) => (
                                <Star key={j} size={10} fill="#f59e0b" color="#f59e0b" />
                              ))}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Partie droite: Capacité + autres infos */}
                    <div style={{ display: "flex", gap: "16px", alignItems: "center", flexShrink: 0 }}>
                      {/* Capacité (lits) - toujours affichée */}
                      <div style={{ textAlign: "center", minWidth: "70px" }}>
                        {displayData.beds != null ? (
                          <>
                            <div style={{ fontSize: "16px", fontWeight: 700, color: config.color }}>
                              {displayData.beds}
                            </div>
                            <div style={{ fontSize: "10px", color: "#94a3b8" }}>{labels.unit}</div>
                          </>
                        ) : (
                          <div
                            style={{
                              fontSize: "10px",
                              color: "#94a3b8",
                              fontStyle: "italic",
                              lineHeight: 1.3,
                            }}
                          >
                            Capacité
                            <br />
                            non publiée
                          </div>
                        )}
                      </div>

                      {/* Taux d'occupation si disponible */}
                      {displayData.occupancyRate != null && (
                        <div style={{ textAlign: "center" }}>
                          <div
                            style={{
                              fontSize: "16px",
                              fontWeight: 700,
                              color:
                                displayData.occupancyRate >= 95
                                  ? "#dc2626"
                                  : displayData.occupancyRate >= 85
                                  ? "#f59e0b"
                                  : "#10b981",
                            }}
                          >
                            {displayData.occupancyRate}%
                          </div>
                          <div style={{ fontSize: "10px", color: "#94a3b8" }}>occup.</div>
                        </div>
                      )}

                      {/* Tarif journalier si disponible */}
                      {displayData.dailyRate && (
                        <div style={{ textAlign: "center" }}>
                          <div style={{ fontSize: "16px", fontWeight: 700, color: "#64748b" }}>
                            {displayData.dailyRate}€
                          </div>
                          <div style={{ fontSize: "10px", color: "#94a3b8" }}>
                            {projectType === "ehpad" ? "/jour" : "/mois"}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};