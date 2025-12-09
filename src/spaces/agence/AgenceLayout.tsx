// src/spaces/agence/AgenceLayout.tsx
import React from "react";
import {
  FileText,
  FolderPlus,
  FolderOpen,
  MessageCircle,
  Home,
} from "lucide-react";

export function AgenceLayout() {
  return (
    <div className="grid gap-6 lg:grid-cols-[250px,1fr]">
      {/* Sidebar */}
      <aside className="space-y-6 border-r border-slate-200 pr-6">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">
            Agence Immobilière
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Dossiers, mandats, argumentaires et analyses.
          </p>
        </div>

        <nav className="space-y-1 text-sm">
          <SidebarItem icon={Home} label="Dashboard" active />
          <SidebarItem icon={FolderPlus} label="Nouveau dossier" />
          <SidebarItem icon={FolderOpen} label="Mes dossiers" />
          <SidebarItem icon={MessageCircle} label="Outils argumentaires" />
          <SidebarItem icon={FileText} label="Rapports" />
        </nav>

        <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 text-xs text-slate-600">
          <p className="font-semibold text-slate-800">
            Version Beta Mimmoza
          </p>
          <p className="mt-1">
            Cette section sera connectée au PLU Engine et au SmartScore pour les
            dossiers vendeurs.
          </p>
        </div>
      </aside>

      {/* Main */}
      <section className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">
            Dashboard Agence
          </h1>
          <p className="mt-1 text-slate-600 max-w-2xl">
            Créez des dossiers, structurez vos arguments et rassurez vos
            acheteurs grâce à des analyses factuelles.
          </p>
        </div>

        {/* Formulaire */}
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 space-y-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Créer un dossier de vente
            </h2>
            <p className="text-sm text-slate-600">
              Entrez l’adresse du bien et le prix affiché.
            </p>
          </div>

          <form className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="text-sm font-medium text-slate-700">
                Adresse du bien
              </label>
              <input
                type="text"
                placeholder="Ex : 7 Rue Victor Hugo, Lyon"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700">
                Prix affiché (€)
              </label>
              <input
                type="number"
                placeholder="Ex : 420000"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div className="flex md:items-end">
              <button className="w-full md:w-auto rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
                Créer le dossier
              </button>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}

function SidebarItem({
  icon: Icon,
  label,
  active = false,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active?: boolean;
}) {
  return (
    <button
      className={[
        "flex items-center gap-2 w-full px-3 py-2 rounded-lg transition-all text-sm",
        active
          ? "bg-slate-900 text-white font-medium"
          : "text-slate-700 hover:bg-slate-200/60",
      ].join(" ")}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}
