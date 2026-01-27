// FILE: src/spaces/promoteur/etudes/marche/components/DataSourcesBadges.tsx

import React from "react";
import { Database, CheckCircle, AlertCircle, XCircle } from "lucide-react";
import { DataSourceStatus, DataSourceType } from "../types";

interface DataSourcesBadgesProps {
  sources: DataSourceStatus[];
}

const SOURCE_LABELS: Record<DataSourceType, string> = {
  insee: "INSEE",
  finess: "FINESS",
  dvf: "DVF",
  bpe: "BPE",
  mesr: "MESR",
  adt: "ADT",
  sirene: "SIRENE",
};

const COVERAGE_CONFIG = {
  complete: { icon: CheckCircle, color: "#10b981", bg: "#dcfce7" },
  partial: { icon: AlertCircle, color: "#f59e0b", bg: "#fef3c7" },
  unavailable: { icon: XCircle, color: "#ef4444", bg: "#fee2e2" },
};

export const DataSourcesBadges: React.FC<DataSourcesBadgesProps> = ({ sources }) => {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
      {sources.map((source) => {
        const config = COVERAGE_CONFIG[source.coverage || "unavailable"];
        const Icon = config.icon;

        return (
          <div
            key={source.source}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 12px",
              background: source.available ? config.bg : "#f1f5f9",
              borderRadius: "8px",
              fontSize: "12px",
              fontWeight: 600,
              color: source.available ? config.color : "#94a3b8",
            }}
          >
            <Icon size={14} />
            <span>{SOURCE_LABELS[source.source]}</span>
            {source.year && <span style={{ fontWeight: 400 }}>({source.year})</span>}
          </div>
        );
      })}
    </div>
  );
};