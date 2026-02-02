import React from "react";

type SectionCardProps = {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
};

export default function SectionCard({ title, subtitle, right, children }: SectionCardProps) {
  return (
    <div
      style={{
        borderRadius: 18,
        border: "1px solid rgba(15, 23, 42, 0.08)",
        background: "rgba(255,255,255,0.86)",
        boxShadow: "0 10px 30px rgba(2,6,23,0.06)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "14px 16px",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          borderBottom: "1px solid rgba(15, 23, 42, 0.06)",
          background:
            "linear-gradient(180deg, rgba(248,250,252,0.9), rgba(255,255,255,0.85))",
        }}
      >
        <div>
          <div style={{ fontWeight: 800, color: "#0f172a", fontSize: 14 }}>
            {title}
          </div>
          {subtitle && (
            <div style={{ marginTop: 4, color: "#64748b", fontSize: 12 }}>
              {subtitle}
            </div>
          )}
        </div>
        {right && <div style={{ flex: "0 0 auto" }}>{right}</div>}
      </div>

      <div style={{ padding: 16 }}>{children}</div>
    </div>
  );
}
