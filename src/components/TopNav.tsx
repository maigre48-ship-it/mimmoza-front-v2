import React, { useMemo } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Home, Building2, Briefcase, ShieldCheck, Banknote, Shield, User, Wrench } from "lucide-react";

type SpaceId =
  | "audit"
  | "promoteur"
  | "agence"
  | "marchand"
  | "banque"
  | "assurance"
  | "particulier";

type SpaceItem = {
  id: SpaceId;
  label: string;
  path: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
};

type PageItem = {
  label: string;
  path: string;
};

const SPACES: SpaceItem[] = [
  { id: "audit", label: "Audit", path: "/audit", icon: ShieldCheck },
  { id: "promoteur", label: "Promoteur", path: "/promoteur", icon: Building2 },
  { id: "agence", label: "Agence", path: "/agence", icon: Briefcase },
  { id: "marchand", label: "Marchand", path: "/marchand-de-bien", icon: Banknote },
  { id: "banque", label: "Banque", path: "/banque", icon: Shield },
  { id: "assurance", label: "Assurance", path: "/assurance", icon: Wrench },
  { id: "particulier", label: "Particulier", path: "/particulier", icon: User },
];

function pill(isActive: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 10px",
    borderRadius: 999,
    fontWeight: 900,
    fontSize: 13,
    border: isActive ? "1px solid rgba(59,130,246,0.28)" : "1px solid rgba(15,23,42,0.10)",
    background: isActive ? "rgba(59,130,246,0.10)" : "rgba(255,255,255,0.85)",
    color: isActive ? "#1d4ed8" : "#0f172a",
    whiteSpace: "nowrap",
  };
}

export default function TopNav({
  currentSpace,
  pages,
  rightSlot,
}: {
  currentSpace: SpaceId;
  pages: PageItem[];
  rightSlot?: React.ReactNode;
}) {
  const location = useLocation();

  const activeSpace = useMemo(() => {
    return SPACES.find((s) => s.id === currentSpace) ?? SPACES[0];
  }, [currentSpace]);

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: "rgba(255,255,255,0.92)",
        backdropFilter: "blur(10px)",
        borderBottom: "1px solid rgba(15,23,42,0.08)",
      }}
    >
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "10px 14px" }}>
        {/* Row 1: brand + spaces + profile */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 12,
                background: "linear-gradient(135deg,#4f46e5,#10b981)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "white",
                fontWeight: 950,
                fontSize: 12,
              }}
            >
              MZ
            </div>
            <div style={{ lineHeight: 1.1 }}>
              <div style={{ fontWeight: 950, color: "#0f172a" }}>Mimmoza</div>
              <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700 }}>Intelligence parcellaire</div>
            </div>

            <div style={{ width: 1, height: 28, background: "rgba(15,23,42,0.10)", marginLeft: 6 }} />

            <nav style={{ display: "flex", alignItems: "center", gap: 8, overflowX: "auto" }}>
              {SPACES.map((s) => {
                const Icon = s.icon;
                const isActive = s.id === currentSpace;
                return (
                  <NavLink key={s.id} to={s.path} style={pill(isActive)}>
                    <Icon size={16} />
                    {s.label}
                  </NavLink>
                );
              })}
            </nav>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {rightSlot}
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
                padding: "6px 8px",
                borderRadius: 999,
                border: "1px solid rgba(15,23,42,0.10)",
                background: "rgba(255,255,255,0.85)",
              }}
            >
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 999,
                  background: "rgba(15,23,42,0.06)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 900,
                  fontSize: 12,
                  color: "#0f172a",
                }}
              >
                AM
              </div>
              <div style={{ lineHeight: 1.1 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Albéric</div>
                <div style={{ fontSize: 11, fontWeight: 800, color: "#94a3b8" }}>Prototype</div>
              </div>
            </div>
          </div>
        </div>

        {/* Row 2: pages (current space) */}
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ fontSize: 12, color: "#64748b", fontWeight: 900 }}>
            {activeSpace.label}
          </div>

          <nav style={{ display: "flex", gap: 8, overflowX: "auto" }}>
            {pages.map((p) => {
              const isActive = location.pathname === p.path;
              return (
                <NavLink key={p.path} to={p.path} style={pill(isActive)}>
                  {p.label}
                </NavLink>
              );
            })}
          </nav>
        </div>
      </div>
    </header>
  );
}
