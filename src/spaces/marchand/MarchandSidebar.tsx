import React from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  INVESTISSEURS_SIDEBAR,
  INVESTISSEURS_BASE_PATH,
  MARCHAND_LEGACY_BASE_PATH,
} from "./nav";

const linkBase: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "10px 12px",
  borderRadius: 12,
  textDecoration: "none",
  border: "1px solid transparent",
};

function normalizePath(pathname: string) {
  // Map legacy base to new base for consistent active detection
  if (pathname.startsWith(MARCHAND_LEGACY_BASE_PATH)) {
    return pathname.replace(MARCHAND_LEGACY_BASE_PATH, INVESTISSEURS_BASE_PATH);
  }
  return pathname;
}

export default function MarchandSidebar() {
  const location = useLocation();
  const normalizedPath = normalizePath(location.pathname);

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
          Investisseurs
        </div>
        <div style={{ marginTop: 6, fontSize: 12, color: "#64748b" }}>
          Opportunités, scoring, rentabilité, exécution, sortie — prêt à automatiser.
        </div>
      </div>

      {/* Links */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {INVESTISSEURS_SIDEBAR.map((item) => {
          const itemPath = item.path;

          // Exact match for base route, prefix match for subroutes
          const isActive =
            itemPath === INVESTISSEURS_BASE_PATH
              ? normalizedPath === INVESTISSEURS_BASE_PATH
              : normalizedPath.startsWith(itemPath);

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
