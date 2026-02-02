import React from "react";
import { NavLink, useLocation } from "react-router-dom";
import { MARCHAND_SIDEBAR } from "./nav";

const linkBase: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "10px 12px",
  borderRadius: 12,
  textDecoration: "none",
  border: "1px solid transparent",
};

export default function MarchandSidebar() {
  const location = useLocation();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Header bloc */}
      <div
        style={{
          borderRadius: 16,
          padding: 14,
          border: "1px solid rgba(15, 23, 42, 0.08)",
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.92), rgba(248,250,252,0.85))",
          boxShadow: "0 10px 30px rgba(2,6,23,0.06)",
          marginBottom: 6,
        }}
      >
        <div style={{ fontWeight: 900, color: "#0f172a", letterSpacing: -0.2 }}>
          Marchand de biens
        </div>
        <div style={{ marginTop: 6, fontSize: 12, color: "#64748b" }}>
          Pipeline, marges, travaux, revente — prêt à automatiser.
        </div>
      </div>

      {/* Links */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {MARCHAND_SIDEBAR.map((item) => {
          const isActive =
  item.path === "/marchand-de-bien"
    ? location.pathname === "/marchand-de-bien"
    : location.pathname.startsWith(item.path);


          const Icon = item.icon;

          return (
            <NavLink
              key={item.path}
              to={item.path}
              style={{
                ...linkBase,
                background: isActive ? "rgba(15, 23, 42, 0.06)" : "transparent",
                borderColor: isActive ? "rgba(15, 23, 42, 0.12)" : "transparent",
              }}
            >
              <Icon size={18} color={isActive ? "#0f172a" : "#334155"} />
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <div style={{ fontWeight: 800, fontSize: 13, color: "#0f172a" }}>
                  {item.label}
                </div>
                {item.desc && (
                  <div style={{ fontSize: 11, color: "#64748b" }}>{item.desc}</div>
                )}
              </div>
            </NavLink>
          );
        })}
      </div>
    </div>
  );
}
