// FILE: src/spaces/promoteur/etudes/marche/components/KpiGrid.tsx

import React from "react";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Euro,
  Users,
  Home,
  Percent,
  BedDouble,
  AlertTriangle,
  Heart,
  GraduationCap,
  Building,
} from "lucide-react";
import { Kpi, KpiStatus, ProjectType } from "../types";
import { getProjectConfig } from "../config";

interface KpiGridProps {
  kpis: Kpi[];
  projectType: ProjectType;
  variant?: "primary" | "secondary";
}

const STATUS_COLORS: Record<KpiStatus, { bg: string; text: string; border: string }> = {
  positive: { bg: "#dcfce7", text: "#166534", border: "#86efac" },
  warning: { bg: "#fef3c7", text: "#92400e", border: "#fcd34d" },
  negative: { bg: "#fee2e2", text: "#991b1b", border: "#fca5a5" },
  neutral: { bg: "#f1f5f9", text: "#475569", border: "#cbd5e1" },
  opportunity: { bg: "#dbeafe", text: "#1e40af", border: "#93c5fd" },
};

const ICON_MAP: Record<string, React.ElementType> = {
  Euro: Euro,
  Users: Users,
  Home: Home,
  Percent: Percent,
  BedDouble: BedDouble,
  AlertTriangle: AlertTriangle,
  Heart: Heart,
  GraduationCap: GraduationCap,
  Building: Building,
  TrendingUp: TrendingUp,
};

export const KpiGrid: React.FC<KpiGridProps> = ({ kpis, projectType, variant = "primary" }) => {
  const config = getProjectConfig(projectType);
  const isPrimary = variant === "primary";

  if (!kpis.length) return null;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: isPrimary ? "repeat(4, 1fr)" : "repeat(2, 1fr)",
        gap: isPrimary ? "16px" : "12px",
      }}
    >
      {kpis.map((kpi) => {
        const colors = STATUS_COLORS[kpi.status];
        const IconComponent = ICON_MAP[kpi.id] || Euro;

        return (
          <div
            key={kpi.id}
            style={{
              background: isPrimary ? colors.bg : "#f8fafc",
              border: `1px solid ${isPrimary ? colors.border : "#e2e8f0"}`,
              borderRadius: "12px",
              padding: isPrimary ? "20px" : "14px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "8px",
              }}
            >
              <span
                style={{
                  fontSize: isPrimary ? "12px" : "11px",
                  color: isPrimary ? colors.text : "#64748b",
                  fontWeight: 600,
                  textTransform: "uppercase",
                }}
              >
                {kpi.label}
              </span>
              {kpi.trend && (
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "2px",
                    fontSize: "11px",
                    color: kpi.trend === "up" ? "#16a34a" : kpi.trend === "down" ? "#dc2626" : "#64748b",
                  }}
                >
                  {kpi.trend === "up" ? (
                    <TrendingUp size={12} />
                  ) : kpi.trend === "down" ? (
                    <TrendingDown size={12} />
                  ) : (
                    <Minus size={12} />
                  )}
                  {kpi.trendValue != null && `${kpi.trendValue > 0 ? "+" : ""}${kpi.trendValue}%`}
                </span>
              )}
            </div>

            <div
              style={{
                fontSize: isPrimary ? "28px" : "20px",
                fontWeight: 800,
                color: isPrimary ? colors.text : "#1e293b",
              }}
            >
              {kpi.value}
              {kpi.unit && (
                <span style={{ fontSize: isPrimary ? "14px" : "12px", fontWeight: 500, marginLeft: "4px" }}>
                  {kpi.unit}
                </span>
              )}
            </div>

            {kpi.benchmark != null && (
              <div
                style={{
                  fontSize: "11px",
                  color: "#94a3b8",
                  marginTop: "4px",
                }}
              >
                Benchmark: {kpi.benchmark}
                {kpi.unit}
              </div>
            )}

            {kpi.description && (
              <div
                style={{
                  fontSize: "12px",
                  color: "#64748b",
                  marginTop: "6px",
                  lineHeight: 1.4,
                }}
              >
                {kpi.description}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};