/**
 * Composant ServiceRow - Affiche un service de proximité avec sa distance
 */

import React from "react";
import type { LucideIcon } from "lucide-react";
import type { ServiceProche } from "../../types/market.types";

// ============================================
// HELPER
// ============================================

/**
 * Retourne la couleur en fonction de la distance
 */
const getDistanceColor = (km: number | null | undefined): string => {
  if (km == null) return "#94a3b8";
  if (km <= 0.5) return "#10b981";
  if (km <= 1) return "#22c55e";
  if (km <= 2) return "#84cc16";
  if (km <= 5) return "#f59e0b";
  return "#64748b";
};

// ============================================
// PROPS
// ============================================

interface ServiceRowProps {
  icon: LucideIcon;
  label: string;
  data?: ServiceProche | null;
  showIfNull?: boolean;
}

// ============================================
// COMPOSANT
// ============================================

const ServiceRow: React.FC<ServiceRowProps> = ({ 
  icon: Icon, 
  label, 
  data, 
  showIfNull = true 
}) => {
  // Si pas de data et showIfNull=false, ne pas afficher
  if (!data && !showIfNull) return null;
  
  // Calcul de la distance (priorité à distance_km, sinon conversion depuis distance_m)
  const distance = data ? (data.distance_km ?? data.distance_m / 1000) : null;
  const distanceColor = getDistanceColor(distance);
  
  return (
    <div style={{ 
      display: "flex", 
      alignItems: "center", 
      justifyContent: "space-between",
      padding: "12px 0", 
      borderBottom: "1px solid #f1f5f9"
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <div style={{
          width: "36px", 
          height: "36px", 
          borderRadius: "8px",
          background: data ? "#eef2ff" : "#f8fafc",
          display: "flex", 
          alignItems: "center", 
          justifyContent: "center",
        }}>
          <Icon size={16} color={data ? "#6366f1" : "#cbd5e1"} />
        </div>
        <div>
          <span style={{ fontSize: "14px", fontWeight: 500, color: "#334155" }}>
            {label}
          </span>
          {data?.nom ? (
            <p style={{ fontSize: "12px", color: "#94a3b8", margin: 0 }}>
              {data.nom}
            </p>
          ) : !data ? (
            <p style={{ fontSize: "12px", color: "#cbd5e1", margin: 0, fontStyle: "italic" }}>
              Aucun trouvé
            </p>
          ) : null}
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <span style={{ fontSize: "14px", fontWeight: 700, color: distanceColor }}>
          {distance != null ? `${distance.toFixed(1)} km` : "—"}
        </span>
        {data?.commune && (
          <p style={{ fontSize: "11px", color: "#94a3b8", margin: 0 }}>
            {data.commune}
          </p>
        )}
      </div>
    </div>
  );
};

export default ServiceRow;