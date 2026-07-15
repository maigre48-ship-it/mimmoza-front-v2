// src/spaces/admin/pages/agentCommercial/AgentCommercialLayout.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Layout du module « Agent commercial ». Rendu à l'intérieur de l'<Outlet/> de
// AdminLayout (route /admin/agent-commercial). Fournit l'en-tête + une barre de
// sous-onglets + son propre <Outlet/> pour les 8 sous-sections.
// Thème admin clair, Tailwind standard. Phase 2 — squelette.
// ─────────────────────────────────────────────────────────────────────────────

import {
  Ban,
  BookOpen,
  Clock,
  GitBranch,
  LayoutDashboard,
  MailCheck,
  MessageSquare,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import { ToastProvider } from "@/components/ui/ToastProvider";

type Tab = {
  label: string;
  to: string;
  icon: LucideIcon;
  end?: boolean;
};

const TABS: Tab[] = [
  { label: "Vue d'ensemble", to: ".", icon: LayoutDashboard, end: true },
  { label: "Prospects", to: "prospects", icon: Users },
  { label: "Liste d'exclusion", to: "exclusions", icon: Ban },
  { label: "Messages à valider", to: "messages", icon: MailCheck },
  { label: "Conversations", to: "conversations", icon: MessageSquare },
  { label: "Relances", to: "relances", icon: Clock },
  { label: "Pipeline", to: "pipeline", icon: GitBranch },
  { label: "Base de connaissances", to: "connaissances", icon: BookOpen },
  { label: "Paramètres", to: "parametres", icon: Settings },
];

export function AgentCommercialLayout() {
  return (
    <ToastProvider>
      <div className="space-y-6">
      {/* En-tête */}
      <header className="rounded-[28px] border border-slate-200 bg-white px-6 py-5 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            Admin Mimmoza
          </span>
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">
          Agent commercial
        </h1>
        <p className="mt-1 text-sm leading-6 text-slate-600">
          Prospection des marchands de biens : prospects, liste d'exclusion et pipeline.
        </p>
      </header>

      {/* Sous-onglets */}
      <nav className="flex flex-wrap gap-2">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                [
                  "inline-flex items-center gap-2 rounded-2xl border px-3.5 py-2 text-sm font-medium transition-all",
                  isActive
                    ? "border-slate-950 bg-slate-950 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                ].join(" ")
              }
            >
              <Icon className="h-4 w-4" />
              <span>{tab.label}</span>
            </NavLink>
          );
        })}
      </nav>

      {/* Contenu de la sous-section */}
      <Outlet />
      </div>
    </ToastProvider>
  );
}
