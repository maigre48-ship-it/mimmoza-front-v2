// src/spaces/promoteur/PromoteurLayout.tsx

import React from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  BarChart3,
  Map,
  Building2,
  TrendingUp,
  Layers,
  FileText,
  AlertTriangle,
  Grid3X3,
  Cuboid,
  Calculator,
  Home,
} from "lucide-react";

// ============================================
// STYLES
// ============================================
const colors = {
  primary: "#2563eb",
  primaryDark: "#1d4ed8",
  secondary: "#4f46e5",
  accent: "#7c3aed",
  success: "#22c55e",
  warning: "#f59e0b",
  text: "#0f172a",
  textMuted: "#64748b",
  border: "#e2e8f0",
  bgLight: "#f8fafc",
  bgCard: "#ffffff",
};

const pageContainer: React.CSSProperties = {
  minHeight: "100vh",
  background: `linear-gradient(135deg, ${colors.bgLight} 0%, #ffffff 50%, #eef2ff 100%)`,
  display: "flex",
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
};

const sidebarStyle: React.CSSProperties = {
  width: "280px",
  minHeight: "100vh",
  background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
  borderRight: `1px solid ${colors.border}`,
  display: "flex",
  flexDirection: "column",
  position: "sticky",
  top: 0,
};

const sidebarHeader: React.CSSProperties = {
  padding: "24px 20px",
  borderBottom: `1px solid ${colors.border}`,
};

const logoStyle: React.CSSProperties = {
  fontSize: "22px",
  fontWeight: 700,
  background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.accent} 100%)`,
  WebkitBackgroundClip: "text",
  WebkitTextFillColor: "transparent",
  letterSpacing: "-0.02em",
};

const navContainer: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "16px 12px",
};

const navSectionTitle: React.CSSProperties = {
  fontSize: "10px",
  fontWeight: 700,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: colors.textMuted,
  padding: "16px 12px 8px",
  marginTop: "8px",
};

const navItemBase: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  padding: "12px 14px",
  borderRadius: "12px",
  cursor: "pointer",
  transition: "all 0.2s ease",
  fontSize: "14px",
  textDecoration: "none",
};

const navItemActive: React.CSSProperties = {
  ...navItemBase,
  fontWeight: 600,
  color: colors.primary,
  background: "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)",
  border: `1px solid ${colors.primary}20`,
  boxShadow: "0 4px 12px rgba(37, 99, 235, 0.1)",
};

const navItemInactive: React.CSSProperties = {
  ...navItemBase,
  fontWeight: 500,
  color: colors.text,
  background: "transparent",
  border: "1px solid transparent",
  boxShadow: "none",
};

const navIconBoxActive: React.CSSProperties = {
  width: "32px",
  height: "32px",
  borderRadius: "10px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.secondary} 100%)`,
  boxShadow: "0 4px 8px rgba(37, 99, 235, 0.25)",
};

const navIconBoxInactive: React.CSSProperties = {
  width: "32px",
  height: "32px",
  borderRadius: "10px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: colors.bgLight,
  boxShadow: "none",
};

const sidebarFooter: React.CSSProperties = {
  padding: "16px",
  borderTop: `1px solid ${colors.border}`,
};

const homeButton: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "10px",
  width: "100%",
  padding: "12px 16px",
  borderRadius: "12px",
  border: "none",
  background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.secondary} 100%)`,
  color: "#ffffff",
  fontSize: "14px",
  fontWeight: 600,
  cursor: "pointer",
  boxShadow: "0 8px 20px rgba(37, 99, 235, 0.3)",
  transition: "all 0.2s ease",
  textDecoration: "none",
};

const mainContent: React.CSSProperties = {
  flex: 1,
  padding: "32px",
  overflowY: "auto",
};

// ============================================
// NAV DATA avec React Router paths
// ============================================
const navSections = [
  {
    title: "Démarrer",
    items: [
      { label: "Tableau de bord", path: "/promoteur", icon: BarChart3, end: true },
    ],
  },
  {
    title: "Foncier",
    items: [
      { label: "Foncier", path: "/promoteur/foncier", icon: Map },
    ],
  },
  {
    title: "Faisabilité",
    items: [
      { label: "PLU & Faisabilité", path: "/promoteur/plu-faisabilite", icon: Building2 },
    ],
  },
  {
    title: "Évaluation",
    items: [
      { label: "Estimation", path: "/promoteur/estimation", icon: TrendingUp },
    ],
  },
  {
    title: "Études",
    items: [
      { label: "Marché", path: "/promoteur/marche", icon: Layers },
      { label: "Risques", path: "/promoteur/risques", icon: AlertTriangle },
    ],
  },
  {
    title: "Conception",
    items: [
      { label: "Implantation 2D", path: "/promoteur/implantation-2d", icon: Grid3X3 },
      { label: "Massing 3D", path: "/promoteur/massing-3d", icon: Cuboid },
    ],
  },
  {
    title: "Bilan",
    items: [
      { label: "Bilan Promoteur", path: "/promoteur/bilan", icon: Calculator },
      { label: "Export", path: "/promoteur/exports", icon: FileText },
    ],
  },
];

// ============================================
// COMPONENT
// ============================================
export default function PromoteurLayout() {
  const navigate = useNavigate();

  const handleGoHome = () => {
    navigate("/");
  };

  return (
    <div style={pageContainer}>
      {/* SIDEBAR */}
      <aside style={sidebarStyle}>
        <div style={sidebarHeader}>
          <div style={logoStyle}>Mimmoza</div>
          <div style={{ fontSize: "11px", color: colors.textMuted, marginTop: "4px", fontWeight: 500 }}>
            Espace Promoteur
          </div>
        </div>

        <nav style={navContainer}>
          {navSections.map((section, idx) => (
            <div key={idx}>
              <div style={navSectionTitle}>{section.title}</div>
              {section.items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end={item.end}
                    style={({ isActive }) => (isActive ? navItemActive : navItemInactive)}
                  >
                    {({ isActive }) => (
                      <>
                        <div style={isActive ? navIconBoxActive : navIconBoxInactive}>
                          <Icon size={16} color={isActive ? "#ffffff" : colors.textMuted} />
                        </div>
                        <span>{item.label}</span>
                      </>
                    )}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>

        <div style={sidebarFooter}>
          <button style={homeButton} onClick={handleGoHome}>
            <Home size={18} />
            Accueil
          </button>
        </div>
      </aside>

      {/* MAIN CONTENT - Outlet pour les pages enfants */}
      <main style={mainContent}>
        <Outlet />
      </main>
    </div>
  );
}