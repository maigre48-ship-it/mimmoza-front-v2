// src/spaces/admin/components/AdminSidebar.tsx

import { NavLink, useNavigate } from "react-router-dom";
import {
  Building2,
  CreditCard,
  LayoutDashboard,
  LogOut,
  ReceiptText,
  ScrollText,
  Settings,
  Ticket,
  Users,
} from "lucide-react";
import { supabase } from "../../../lib/supabase";

const items = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/admin/utilisateurs", label: "Utilisateurs", icon: Users },
  { to: "/admin/abonnements", label: "Abonnements", icon: CreditCard },
  { to: "/admin/jetons", label: "Jetons", icon: Ticket },
  { to: "/admin/devis", label: "Devis", icon: ReceiptText },
  { to: "/admin/factures", label: "Factures", icon: ScrollText },
  { to: "/admin/entreprises", label: "Entreprises", icon: Building2 },
  { to: "/admin/parametres", label: "Paramètres", icon: Settings },
];

export function AdminSidebar() {
  const navigate = useNavigate();

  async function handleLogout(): Promise<void> {
    await supabase.auth.signOut();
    navigate("/login", { replace: true });
  }

  return (
    <aside className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 px-2">
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
          Admin Mimmoza
        </div>
        <div className="mt-2 text-lg font-semibold text-slate-950">
          Pilotage plateforme
        </div>
      </div>

      <nav className="space-y-1">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                [
                  "flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition-all",
                  isActive
                    ? "bg-slate-950 text-white"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                ].join(" ")
              }
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className="mt-6 border-t border-slate-100 pt-4">
        <button
          type="button"
          onClick={() => {
            void handleLogout();
          }}
          className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium text-slate-600 transition-all hover:bg-slate-50 hover:text-slate-900"
        >
          <LogOut className="h-4 w-4" />
          <span>Déconnexion admin</span>
        </button>
      </div>
    </aside>
  );
}