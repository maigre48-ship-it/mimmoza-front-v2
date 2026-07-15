// src/spaces/admin/components/AdminLayout.tsx

import {
  BadgeEuro,
  BarChart3,
  Bot,
  Building2,
  ClipboardList,
  CreditCard,
  FileText,
  LogOut,
  Megaphone,
  Settings,
  Users
} from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";

// ── Items de navigation ───────────────────────────────────────────────────────

const NAV_ITEMS = [
  { label: "Dashboard",    path: "/admin",               icon: BarChart3,     end: true },
  { label: "Utilisateurs", path: "/admin/utilisateurs",  icon: Users },
  { label: "Abonnements",  path: "/admin/abonnements",   icon: CreditCard },
  { label: "Copilot",      path: "/admin/copilot",       icon: Bot },
  { label: "Devis",        path: "/admin/devis",         icon: ClipboardList },
  { label: "Factures",     path: "/admin/factures",      icon: FileText },
  { label: "Entreprises",  path: "/admin/entreprises",   icon: Building2 },
  { label: "Agent commercial", path: "/admin/agent-commercial", icon: Megaphone },
  { label: "Tarifs",       path: "/admin/tarifs",        icon: BadgeEuro },
  { label: "Paramètres",   path: "/admin/parametres",    icon: Settings },
] as const;

// ── Sidebar ───────────────────────────────────────────────────────────────────

function AdminSidebar() {
  const navigate = useNavigate();

  function handleLogout() {
    localStorage.removeItem("mimmoza-admin-auth");
    navigate("/");
  }

  return (
    <div className="flex h-full flex-col rounded-[28px] border border-slate-200 bg-white shadow-sm">
      {/* Logo / titre */}
      <div className="border-b border-slate-100 px-5 py-5">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
          Mimmoza
        </div>
        <div className="mt-0.5 text-base font-semibold text-slate-900">
          Pilotage plateforme
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isCopilot = item.path === "/admin/copilot";
          return (
            <NavLink
              key={item.path}
              to={item.path}
              end={"end" in item ? item.end : false}
              className={({ isActive }) =>
                [
                  "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
                  isActive
                    ? isCopilot
                      ? "bg-violet-600 text-white"
                      : "bg-slate-950 text-white"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                ].join(" ")
              }
            >
              {({ isActive }) => (
                <>
                  <Icon
                    className={[
                      "h-4 w-4 shrink-0",
                      isActive
                        ? "text-white"
                        : isCopilot
                          ? "text-violet-400"
                          : "text-slate-400",
                    ].join(" ")}
                  />
                  {item.label}
                  {isCopilot && !isActive && (
                    <span className="ml-auto rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-600">
                      V1
                    </span>
                  )}
                </>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* Déconnexion */}
      <div className="border-t border-slate-100 px-3 py-3">
        <button
          type="button"
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
        >
          <LogOut className="h-4 w-4 shrink-0 text-slate-400" />
          Déconnexion admin
        </button>
      </div>
    </div>
  );
}

// ── Layout ────────────────────────────────────────────────────────────────────

export function AdminLayout() {
  return (
    <div className="flex min-h-screen gap-6 bg-slate-50 p-6">
      <div className="w-64 shrink-0">
        <AdminSidebar />
      </div>
      <div className="flex-1 min-w-0">
        <Outlet />
      </div>
    </div>
  );
}