import React from "react";

type KpiCardProps = {
  label: string;
  value: string;
  hint?: string;
  icon?: React.ReactNode;
};

export default function KpiCard({ label, value, hint, icon }: KpiCardProps) {
  return (
    <div
      style={{
        borderRadius: 16,
        border: "1px solid rgba(15, 23, 42, 0.08)",
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.92), rgba(248,250,252,0.85))",
        boxShadow: "0 10px 30px rgba(2,6,23,0.06)",
        padding: 16,
        minHeight: 92,
        display: "flex",
        gap: 12,
        alignItems: "center",
      }}
    >
      {icon && (
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            display: "grid",
            placeItems: "center",
            background: "rgba(15, 23, 42, 0.04)",
            border: "1px solid rgba(15, 23, 42, 0.06)",
          }}
        >
          {icon}
        </div>
      )}

      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>
          {label}
        </div>
        <div style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", marginTop: 4 }}>
          {value}
        </div>
        {hint && (
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
            {hint}
          </div>
        )}
      </div>
    </div>
  );
}
