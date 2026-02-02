import React from "react";

type PageShellProps = {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
};

export default function PageShell({ title, subtitle, right, children }: PageShellProps) {
  return (
    <div style={{ padding: "22px 22px 40px" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 18,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 800,
              letterSpacing: -0.2,
              color: "#0f172a",
            }}
          >
            {title}
          </div>
          {subtitle && (
            <div style={{ marginTop: 6, color: "#475569", fontSize: 13 }}>
              {subtitle}
            </div>
          )}
        </div>

        {right && <div style={{ flex: "0 0 auto" }}>{right}</div>}
      </div>

      {/* Body */}
      <div>{children}</div>
    </div>
  );
}
