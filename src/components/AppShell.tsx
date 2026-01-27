// FILE: src/components/AppShell.tsx

import { useState, useMemo } from "react";
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import {
  Menu,
  X,
  Home,
  FileText,
  Building2,
  Briefcase,
  ShieldCheck,
  Banknote,
  PieChart,
  BarChart3,
  Map,
  Layers,
  TrendingUp,
  AlertTriangle,
  Grid3X3,
  Cuboid,
  Calculator,
} from "lucide-react";

type Space =
  | "none"
  | "audit"
  | "promoteur"
  | "agence"
  | "marchand"
  | "banque"
  | "assurance";

type AppShellProps = {
  currentSpace: Space;
  onChangeSpace: (space: Space) => void;
  children: ReactNode;
};

const SPACES: {
  id: Space;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  path: string;
}[] = [
  {
    id: "audit",
    label: "Espace Audit",
    description: "Analyse PLU, risques et SmartScore",
    icon: FileText,
    path: "/audit",
  },
  {
    id: "promoteur",
    label: "Espace Promoteur",
    description: "Faisabilité, SDP potentielle et bilan promoteur",
    icon: Building2,
    path: "/promoteur",
  },
  {
    id: "agence",
    label: "Espace Agence",
    description: "Dossiers vendeurs / acquéreurs enrichis",
    icon: Briefcase,
    path: "/agence",
  },
  {
    id: "marchand",
    label: "Marchand de biens",
    description: "Opportunités décotées et montage rapide",
    icon: PieChart,
    path: "/marchand",
  },
  {
    id: "banque",
    label: "Espace Banque",
    description: "Analyse de risque et garantie de prêt",
    icon: ShieldCheck,
    path: "/banque",
  },
  {
    id: "assurance",
    label: "Espace Assurance",
    description: "Souscription et tarification immobilière",
    icon: Banknote,
    path: "/assurance",
  },
];

const PROMOTEUR_NAV = [
  {
    section: "Démarrer",
    items: [
      { label: "Tableau de bord", path: "/promoteur", icon: BarChart3, end: true },
    ],
  },
  {
    section: "Foncier",
    items: [
      { label: "Foncier", path: "/promoteur/foncier", icon: Map },
    ],
  },
  {
    section: "Faisabilité",
    items: [
      // ✅ CORRIGÉ: /promoteur/plu → /promoteur/plu-faisabilite
      { label: "PLU & Faisabilité", path: "/promoteur/plu-faisabilite", icon: Building2 },
    ],
  },
  {
    section: "Évaluation",
    items: [
      { label: "Estimation", path: "/promoteur/estimation", icon: TrendingUp },
    ],
  },
  {
    section: "Études",
    items: [
      // ✅ CORRIGÉ: /promoteur/etudes/marche → /promoteur/marche
      { label: "Marché", path: "/promoteur/marche", icon: Layers },
      // ✅ CORRIGÉ: /promoteur/etudes/risques → /promoteur/risques
      { label: "Risques", path: "/promoteur/risques", icon: AlertTriangle },
    ],
  },
  {
    section: "Conception",
    items: [
      { label: "Implantation 2D", path: "/promoteur/implantation-2d", icon: Grid3X3 },
      { label: "Massing 3D", path: "/promoteur/massing-3d", icon: Cuboid },
    ],
  },
  {
    section: "Bilan",
    items: [
      { label: "Bilan Promoteur", path: "/promoteur/bilan", icon: Calculator },
    ],
  },
];

export function AppShell({ currentSpace, onChangeSpace, children }: AppShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const currentSpaceMeta = useMemo(
    () => SPACES.find((s) => s.id === currentSpace) ?? null,
    [currentSpace]
  );

  const handleSelectSpace = (space: Space) => {
    onChangeSpace(space);
    setMobileNavOpen(false);
  };

  const navLinkClasses = (isActive: boolean) =>
    [
      "w-full rounded-lg px-3 py-2 text-left text-sm flex items-center gap-2 border transition-all",
      isActive
        ? "border-indigo-500/80 bg-indigo-50/80 text-indigo-900 shadow-sm"
        : "border-transparent hover:border-slate-200 hover:bg-slate-50 text-slate-700",
    ].join(" ");

  const navLinkIconClasses = (isActive: boolean) =>
    `h-4 w-4 ${isActive ? "text-indigo-500" : "text-slate-400"}`;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* HEADER */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="flex h-14 items-center justify-between px-3 sm:px-4 lg:px-6">
          {/* Gauche : logo + retour accueil */}
          <NavLink
            to="/"
            onClick={() => onChangeSpace("none")}
            className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-slate-100 transition-colors"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-emerald-400 text-xs font-semibold text-white">
              MZ
            </div>
            <div className="hidden sm:flex flex-col items-start leading-tight">
              <span className="text-sm font-semibold tracking-tight">
                Mimmoza
              </span>
              <span className="text-[11px] text-slate-500">
                L'intelligence des parcelles
              </span>
            </div>
          </NavLink>

          {/* Centre : titre de l'espace courant */}
          {currentSpaceMeta && (
            <div className="hidden md:flex flex-col items-center pointer-events-none">
              <span className="text-xs uppercase tracking-[0.12em] text-slate-400">
                Espace
              </span>
              <span className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <currentSpaceMeta.icon className="h-4 w-4" />
                {currentSpaceMeta.label}
              </span>
            </div>
          )}

          {/* Droite : actions + toggler mobile */}
          <div className="flex items-center gap-2">
            {/* Placeholder pour futur avatar / profil */}
            <div className="hidden sm:flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2 py-1">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-700">
                AM
              </div>
              <div className="hidden md:block leading-tight">
                <div className="text-xs font-medium text-slate-700">
                  Tableau de bord
                </div>
                <div className="text-[10px] text-slate-400">
                  Prototype local Mimmoza
                </div>
              </div>
            </div>

            {/* Bouton mobile menu */}
            <button
              type="button"
              onClick={() => setMobileNavOpen((o) => !o)}
              className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white p-1.5 text-slate-700 hover:bg-slate-100 md:hidden"
            >
              {mobileNavOpen ? (
                <X className="h-4 w-4" />
              ) : (
                <Menu className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      </header>

      {/* CONTENU GLOBAL : sidebar + contenu */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar desktop */}
        <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-slate-200 bg-white/90">
          {currentSpace === "promoteur" ? (
            /* SIDEBAR PROMOTEUR */
            <>
              <div className="px-4 pb-4 pt-3 border-b border-slate-100">
                <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                  <Building2 className="h-3.5 w-3.5" />
                  <span>Espace Promoteur</span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Faisabilité, SDP potentielle et bilan promoteur.
                </p>
              </div>

              <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-1">
                {PROMOTEUR_NAV.map((section) => (
                  <div key={section.section}>
                    <p className="px-2 mb-1 mt-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                      {section.section}
                    </p>
                    {section.items.map((item) => {
                      const Icon = item.icon;
                      return (
                        <NavLink
                          key={item.path}
                          to={item.path}
                          end={item.end}
                          className={({ isActive }) => navLinkClasses(isActive)}
                        >
                          {({ isActive }) => (
                            <>
                              <Icon className={navLinkIconClasses(isActive)} />
                              <span className="font-medium">{item.label}</span>
                            </>
                          )}
                        </NavLink>
                      );
                    })}
                  </div>
                ))}
              </nav>

              <div className="border-t border-slate-100 px-2 py-2">
                <NavLink
                  to="/"
                  onClick={() => onChangeSpace("none")}
                  className="w-full rounded-lg px-3 py-2 text-left text-sm flex items-center gap-2 border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700"
                >
                  <Home className="h-4 w-4 text-slate-500" />
                  <span>Retour à la sélection d'espace</span>
                </NavLink>
              </div>
            </>
          ) : (
            /* SIDEBAR GLOBALE (sélection d'espace) */
            <>
              <div className="px-4 pb-4 pt-3 border-b border-slate-100">
                <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                  <Home className="h-3.5 w-3.5" />
                  <span>Navigation Mimmoza</span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Choisis un espace métier pour tester le workflow.
                </p>
              </div>

              <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
                <div>
                  <p className="px-2 mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                    Espaces
                  </p>
                  <div className="space-y-1">
                    {SPACES.map((space) => {
                      const Icon = space.icon;
                      return (
                        <NavLink
                          key={space.id}
                          to={space.path}
                          onClick={() => handleSelectSpace(space.id)}
                          className={({ isActive }) =>
                            [
                              "w-full rounded-lg px-3 py-2 text-left text-sm flex flex-col border transition-all",
                              isActive
                                ? "border-indigo-500/80 bg-indigo-50/80 text-indigo-900 shadow-sm"
                                : "border-transparent hover:border-slate-200 hover:bg-slate-50 text-slate-700",
                            ].join(" ")
                          }
                        >
                          {({ isActive }) => (
                            <>
                              <span className="flex items-center gap-2">
                                <Icon
                                  className={`h-4 w-4 ${
                                    isActive ? "text-indigo-500" : "text-slate-400"
                                  }`}
                                />
                                <span className="font-medium">{space.label}</span>
                              </span>
                              <span className="mt-0.5 text-[11px] text-slate-400">
                                {space.description}
                              </span>
                            </>
                          )}
                        </NavLink>
                      );
                    })}
                  </div>
                </div>

                <div className="pt-1 border-t border-slate-100">
                  <p className="px-2 mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                    Global
                  </p>
                  <NavLink
                    to="/"
                    onClick={() => onChangeSpace("none")}
                    className="w-full rounded-lg px-3 py-2 text-left text-sm flex items-center gap-2 border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700"
                  >
                    <Home className="h-4 w-4 text-slate-500" />
                    <span>Retour à la sélection d'espace</span>
                  </NavLink>
                </div>
              </nav>

              <div className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-400">
                Prototype Mimmoza · Layout local
              </div>
            </>
          )}
        </aside>

        {/* Sidebar mobile (slide-in) */}
        {mobileNavOpen && (
          <div className="fixed inset-0 z-30 flex md:hidden">
            <div className="w-64 max-w-[70%] bg-white shadow-xl border-r border-slate-200 flex flex-col">
              <div className="px-4 pb-3 pt-3 border-b border-slate-100 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  {currentSpace === "promoteur" ? "Espace Promoteur" : "Espaces Mimmoza"}
                </span>
                <button
                  type="button"
                  onClick={() => setMobileNavOpen(false)}
                  className="rounded-md p-1 hover:bg-slate-100"
                >
                  <X className="h-4 w-4 text-slate-600" />
                </button>
              </div>

              <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-1">
                {currentSpace === "promoteur" ? (
                  /* NAV PROMOTEUR MOBILE */
                  <>
                    {PROMOTEUR_NAV.map((section) => (
                      <div key={section.section}>
                        <p className="px-2 mb-1 mt-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                          {section.section}
                        </p>
                        {section.items.map((item) => {
                          const Icon = item.icon;
                          return (
                            <NavLink
                              key={item.path}
                              to={item.path}
                              end={item.end}
                              onClick={() => setMobileNavOpen(false)}
                              className={({ isActive }) => navLinkClasses(isActive)}
                            >
                              {({ isActive }) => (
                                <>
                                  <Icon className={navLinkIconClasses(isActive)} />
                                  <span className="font-medium">{item.label}</span>
                                </>
                              )}
                            </NavLink>
                          );
                        })}
                      </div>
                    ))}
                  </>
                ) : (
                  /* NAV GLOBALE MOBILE */
                  <>
                    {SPACES.map((space) => {
                      const Icon = space.icon;
                      return (
                        <NavLink
                          key={space.id}
                          to={space.path}
                          onClick={() => handleSelectSpace(space.id)}
                          className={({ isActive }) =>
                            [
                              "w-full rounded-lg px-3 py-2 text-left text-sm flex flex-col border transition-all",
                              isActive
                                ? "border-indigo-500/80 bg-indigo-50/80 text-indigo-900 shadow-sm"
                                : "border-transparent hover:border-slate-200 hover:bg-slate-50 text-slate-700",
                            ].join(" ")
                          }
                        >
                          {({ isActive }) => (
                            <>
                              <span className="flex items-center gap-2">
                                <Icon
                                  className={`h-4 w-4 ${
                                    isActive ? "text-indigo-500" : "text-slate-400"
                                  }`}
                                />
                                <span className="font-medium">{space.label}</span>
                              </span>
                              <span className="mt-0.5 text-[11px] text-slate-400">
                                {space.description}
                              </span>
                            </>
                          )}
                        </NavLink>
                      );
                    })}
                  </>
                )}

                <NavLink
                  to="/"
                  onClick={() => handleSelectSpace("none")}
                  className="mt-2 w-full rounded-lg px-3 py-2 text-left text-sm flex items-center gap-2 border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700"
                >
                  <Home className="h-4 w-4 text-slate-500" />
                  <span>Retour à l'accueil Mimmoza</span>
                </NavLink>
              </nav>
            </div>
            <div
              className="flex-1 bg-black/30"
              onClick={() => setMobileNavOpen(false)}
            />
          </div>
        )}

        {/* ZONE CONTENU */}
        <main className="flex-1 overflow-auto">
          <div className="mx-auto max-w-7xl px-3 sm:px-4 lg:px-6 py-4">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}