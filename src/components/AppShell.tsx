// FILE: src/components/AppShell.tsx

import { useState, useMemo } from "react";
import type { ReactNode, ComponentType } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
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
  ChevronRight,
  Sparkles,
} from "lucide-react";

// ✅ Import de l'utilitaire pour préserver le param study
import { preserveStudyInPath, extractStudyId } from "../utils/preserveStudyParam";

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

/**
 * SPACES - Configuration des espaces métier
 */
const SPACES: {
  id: Space;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
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
    path: "/particulier",
  },
  {
    id: "marchand",
    label: "Marchand de biens",
    description: "Opportunités décotées et montage rapide",
    icon: PieChart,
    path: "/marchand-de-bien",
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

/**
 * Navigation Promoteur - Structure en sections
 */
const PROMOTEUR_SECTIONS = [
  {
    id: "demarrer",
    label: "Démarrer",
    items: [{ label: "Tableau de bord", path: "/promoteur", icon: BarChart3, end: true }],
  },
  {
    id: "foncier",
    label: "Foncier",
    items: [{ label: "Foncier", path: "/promoteur/foncier", icon: Map }],
  },
  {
    id: "faisabilite",
    label: "Faisabilité",
    items: [{ label: "PLU & Règles", path: "/promoteur/plu-faisabilite", icon: Building2 }],
  },
  {
    id: "conception",
    label: "Conception",
    items: [
      { label: "Implantation 2D", path: "/promoteur/implantation-2d", icon: Grid3X3 },
      { label: "Massing 3D", path: "/promoteur/massing-3d", icon: Cuboid },
    ],
  },
  {
    id: "evaluation",
    label: "Évaluation",
    items: [{ label: "Estimation", path: "/promoteur/estimation", icon: TrendingUp }],
  },
  {
    id: "etudes",
    label: "Études",
    items: [
      { label: "Marché", path: "/promoteur/marche", icon: Layers },
      { label: "Risques", path: "/promoteur/risques", icon: AlertTriangle },
    ],
  },
  {
    id: "bilan",
    label: "Bilan",
    items: [
      { label: "Bilan Promoteur", path: "/promoteur/bilan-promoteur", icon: Calculator },
      { label: "Synthèse", path: "/promoteur/synthese", icon: FileText },
    ],
  },
];

// ============================================================
// PROMOTEUR TOP NAV - Premium segmented navigation
// ============================================================
function PromoteurTopNav({ onExit }: { onExit: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();

  // ✅ Extraire le studyId pour l'afficher dans le breadcrumb
  const studyId = useMemo(() => extractStudyId(location.search), [location.search]);

  // ✅ Helper pour construire les liens avec préservation du param study
  const buildPath = (targetPath: string): string => {
    return preserveStudyInPath(targetPath, location.search);
  };

  // Détermine la section active
  const activeSection = useMemo(() => {
    const pathname = location.pathname;
    
    for (const section of PROMOTEUR_SECTIONS) {
      for (const item of section.items) {
        if (item.end) {
          if (pathname === item.path) return section.id;
        } else {
          if (pathname === item.path || pathname.startsWith(`${item.path}/`)) {
            return section.id;
          }
        }
      }
    }
    return "demarrer";
  }, [location.pathname]);

  const isActivePath = (targetPath: string, end?: boolean) => {
    const p = location.pathname;
    if (end) return p === targetPath;
    return p === targetPath || p.startsWith(`${targetPath}/`);
  };

  // Récupère les items de la section active
  const activeItems = PROMOTEUR_SECTIONS.find((s) => s.id === activeSection)?.items ?? [];

  // ✅ Handler pour la navigation avec préservation du studyId
  const handleNavClick = (targetPath: string, end?: boolean) => (e: React.MouseEvent) => {
    e.preventDefault();
    const fullPath = buildPath(targetPath);
    navigate(fullPath);
  };

  // ✅ Handler pour retour aux espaces (perd le studyId volontairement)
  const handleExitClick = () => {
    onExit();
  };

  return (
    <nav className="sticky top-14 z-30 w-full bg-white border-b border-slate-200/80">
      {/* Ligne 1 : Breadcrumb + Sections tabs */}
      <div className="mx-auto max-w-7xl px-4 lg:px-6">
        {/* Breadcrumb row */}
        <div className="flex items-center justify-between py-2.5 border-b border-slate-100">
          {/* Breadcrumb gauche */}
          <div className="flex items-center gap-2 text-sm">
            <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-600 shadow-sm">
              <Building2 className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="font-semibold text-slate-800">Promoteur</span>
            <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
            <span className="text-slate-500">
              {PROMOTEUR_SECTIONS.find((s) => s.id === activeSection)?.label}
            </span>
            {/* ✅ Afficher l'ID de l'étude si présent */}
            {studyId && (
              <>
                <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
                <span 
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-600 text-xs font-medium"
                  title={studyId}
                >
                  <Sparkles className="h-3 w-3" />
                  {studyId.length > 10 ? `${studyId.slice(0, 10)}…` : studyId}
                </span>
              </>
            )}
          </div>

          {/* Bouton retour espaces */}
          <button
            type="button"
            onClick={handleExitClick}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:border-slate-300 hover:text-slate-800 transition-all duration-150"
          >
            <Home className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Espaces</span>
          </button>
        </div>

        {/* Tabs sections - Premium segmented style */}
        <div className="flex items-center gap-1 py-2 overflow-x-auto scrollbar-hide">
          {PROMOTEUR_SECTIONS.map((section) => {
            const isActive = section.id === activeSection;
            const firstPath = section.items[0]?.path ?? "/promoteur";
            const isEnd = section.items[0]?.end;
            
            return (
              <a
                key={section.id}
                href={buildPath(firstPath)}
                onClick={handleNavClick(firstPath, isEnd)}
                className={[
                  "relative px-4 py-2 text-sm font-medium whitespace-nowrap rounded-lg transition-all duration-150",
                  isActive
                    ? "bg-slate-900 text-white shadow-sm"
                    : "text-slate-500 hover:text-slate-800 hover:bg-slate-100",
                ].join(" ")}
              >
                {section.label}
              </a>
            );
          })}
        </div>
      </div>

      {/* Ligne 2 : Sous-navigation de la section active */}
      {activeItems.length > 0 && (
        <div className="border-t border-slate-100 bg-slate-50/50">
          <div className="mx-auto max-w-7xl px-4 lg:px-6 py-2">
            <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
              {activeItems.map((item) => {
                const Icon = item.icon;
                const active = isActivePath(item.path, item.end);
                
                return (
                  <a
                    key={item.path}
                    href={buildPath(item.path)}
                    onClick={handleNavClick(item.path, item.end)}
                    className={[
                      "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-all duration-150",
                      active
                        ? "bg-white border border-slate-200 text-slate-900 shadow-sm"
                        : "text-slate-500 hover:text-slate-700 hover:bg-white/60",
                    ].join(" ")}
                  >
                    <Icon className={`h-4 w-4 ${active ? "text-indigo-500" : "text-slate-400"}`} />
                    <span>{item.label}</span>
                  </a>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <style>{`
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </nav>
  );
}

// ============================================================
// MAIN APP SHELL
// ============================================================
export function AppShell({ currentSpace, onChangeSpace, children }: AppShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  // ✅ Helper pour construire les liens avec préservation du param study
  const buildPath = (targetPath: string): string => {
    return preserveStudyInPath(targetPath, location.search);
  };

  const currentSpaceMeta = useMemo(
    () => SPACES.find((s) => s.id === currentSpace) ?? null,
    [currentSpace]
  );

  const handleSelectSpace = (space: Space) => {
    onChangeSpace(space);
    setMobileNavOpen(false);
  };

  // ✅ Handler pour navigation mobile avec préservation du studyId
  const handleMobileNavClick = (targetPath: string, end?: boolean) => (e: React.MouseEvent) => {
    e.preventDefault();
    const fullPath = buildPath(targetPath);
    navigate(fullPath);
    setMobileNavOpen(false);
  };

  // ✅ Vérifier si un chemin est actif (pour le style)
  const isPathActive = (targetPath: string, end?: boolean): boolean => {
    const p = location.pathname;
    if (end) return p === targetPath;
    return p === targetPath || p.startsWith(`${targetPath}/`);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* ============================================================ */}
      {/* HEADER - Premium glassmorphism style */}
      {/* ============================================================ */}
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 backdrop-blur-md supports-[backdrop-filter]:bg-white/80">
        <div className="flex h-14 items-center justify-between px-4 lg:px-6">
          {/* Gauche : logo + retour accueil */}
          <NavLink
            to="/"
            onClick={() => onChangeSpace("none")}
            className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 -ml-2 hover:bg-slate-100/80 transition-colors duration-150"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 via-indigo-600 to-emerald-500 text-xs font-bold text-white shadow-md shadow-indigo-500/20">
              MZ
            </div>
            <div className="hidden sm:flex flex-col items-start leading-none">
              <span className="text-sm font-semibold tracking-tight text-slate-900">Mimmoza</span>
              <span className="text-[10px] text-slate-400 mt-0.5">Intelligence parcellaire</span>
            </div>
          </NavLink>

          {/* Centre : titre espace courant (hors promoteur) */}
          {currentSpaceMeta && currentSpace !== "promoteur" && (
            <div className="hidden md:flex items-center gap-2 pointer-events-none">
              <div className="flex items-center justify-center h-6 w-6 rounded-md bg-slate-100">
                <currentSpaceMeta.icon className="h-3.5 w-3.5 text-slate-500" />
              </div>
              <span className="text-sm font-medium text-slate-600">
                {currentSpaceMeta.label}
              </span>
            </div>
          )}

          {/* Droite : profil + toggler mobile */}
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2.5 rounded-full border border-slate-200/80 bg-white px-2.5 py-1.5 shadow-sm">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-slate-100 to-slate-200 text-[11px] font-semibold text-slate-600">
                AM
              </div>
              <div className="hidden md:block leading-none pr-1">
                <div className="text-xs font-medium text-slate-700">Albé M.</div>
                <div className="text-[10px] text-slate-400 mt-0.5">Prototype</div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setMobileNavOpen((o) => !o)}
              className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 hover:text-slate-800 hover:border-slate-300 transition-all duration-150 md:hidden"
            >
              {mobileNavOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </header>

      {/* TOP NAV PROMOTEUR */}
      {currentSpace === "promoteur" && <PromoteurTopNav onExit={() => handleSelectSpace("none")} />}

      {/* ============================================================ */}
      {/* CONTENU GLOBAL */}
      {/* ============================================================ */}
      <div className="flex flex-1 overflow-hidden">
        {/* ------------------------------------------------------------ */}
        {/* Sidebar desktop (hors promoteur) - Premium clean style */}
        {/* ------------------------------------------------------------ */}
        {currentSpace !== "promoteur" && (
          <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-slate-200/80 bg-white">
            {/* Header sidebar */}
            <div className="px-4 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                <Home className="h-3.5 w-3.5" />
                <span className="font-medium">Navigation</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Sélectionnez un espace métier
              </p>
            </div>

            {/* Navigation */}
            <nav className="flex-1 overflow-y-auto px-3 py-4">
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
                          "group flex flex-col w-full rounded-xl px-3 py-2.5 transition-all duration-150",
                          isActive
                            ? "bg-slate-900 shadow-md"
                            : "hover:bg-slate-50",
                        ].join(" ")
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <span className="flex items-center gap-2.5">
                            <div
                              className={[
                                "flex items-center justify-center h-7 w-7 rounded-lg transition-colors",
                                isActive
                                  ? "bg-white/15"
                                  : "bg-slate-100 group-hover:bg-slate-200/80",
                              ].join(" ")}
                            >
                              <Icon
                                className={[
                                  "h-4 w-4",
                                  isActive ? "text-white" : "text-slate-500",
                                ].join(" ")}
                              />
                            </div>
                            <span
                              className={[
                                "text-sm font-medium",
                                isActive ? "text-white" : "text-slate-700",
                              ].join(" ")}
                            >
                              {space.label}
                            </span>
                          </span>
                          <span
                            className={[
                              "mt-1 ml-9 text-[11px] leading-snug",
                              isActive ? "text-white/70" : "text-slate-400",
                            ].join(" ")}
                          >
                            {space.description}
                          </span>
                        </>
                      )}
                    </NavLink>
                  );
                })}
              </div>

              {/* Retour accueil */}
              <div className="mt-6 pt-4 border-t border-slate-100">
                <NavLink
                  to="/"
                  onClick={() => onChangeSpace("none")}
                  className="flex items-center gap-2.5 w-full rounded-xl px-3 py-2.5 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-slate-100">
                    <Home className="h-4 w-4 text-slate-500" />
                  </div>
                  <span>Sélection d&apos;espace</span>
                </NavLink>
              </div>
            </nav>

            {/* Footer sidebar */}
            <div className="border-t border-slate-100 px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] text-slate-400">Mimmoza · Prototype local</span>
              </div>
            </div>
          </aside>
        )}

        {/* ------------------------------------------------------------ */}
        {/* Sidebar mobile (slide-in drawer) */}
        {/* ------------------------------------------------------------ */}
        {mobileNavOpen && (
          <div className="fixed inset-0 z-50 flex md:hidden">
            {/* Drawer */}
            <div className="w-80 max-w-[85%] bg-white shadow-2xl flex flex-col animate-slide-in">
              {/* Header */}
              <div className="px-4 py-4 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-emerald-500 text-xs font-bold text-white">
                    MZ
                  </div>
                  <span className="text-sm font-semibold text-slate-800">
                    {currentSpace === "promoteur" ? "Espace Promoteur" : "Mimmoza"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileNavOpen(false)}
                  className="rounded-lg p-2 hover:bg-slate-100 transition-colors"
                >
                  <X className="h-4 w-4 text-slate-500" />
                </button>
              </div>

              {/* Navigation */}
              <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
                {currentSpace === "promoteur" ? (
                  // Promoteur nav items
                  <>
                    {PROMOTEUR_SECTIONS.flatMap((s) => s.items).map((item) => {
                      const Icon = item.icon;
                      const isActive = isPathActive(item.path, item.end);
                      return (
                        <a
                          key={item.path}
                          href={buildPath(item.path)}
                          onClick={handleMobileNavClick(item.path, item.end)}
                          className={[
                            "flex items-center gap-3 w-full rounded-xl px-3 py-2.5 transition-all",
                            isActive
                              ? "bg-slate-900 text-white"
                              : "text-slate-700 hover:bg-slate-50",
                          ].join(" ")}
                        >
                          <Icon className={`h-4 w-4 ${isActive ? "text-white" : "text-slate-400"}`} />
                          <span className="text-sm font-medium">{item.label}</span>
                        </a>
                      );
                    })}
                  </>
                ) : (
                  // Spaces nav
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
                              "flex flex-col w-full rounded-xl px-3 py-2.5 transition-all",
                              isActive
                                ? "bg-slate-900 text-white"
                                : "text-slate-700 hover:bg-slate-50",
                            ].join(" ")
                          }
                        >
                          {({ isActive }) => (
                            <>
                              <span className="flex items-center gap-3">
                                <Icon className={`h-4 w-4 ${isActive ? "text-white" : "text-slate-400"}`} />
                                <span className="text-sm font-medium">{space.label}</span>
                              </span>
                              <span className={`mt-0.5 ml-7 text-[11px] ${isActive ? "text-white/70" : "text-slate-400"}`}>
                                {space.description}
                              </span>
                            </>
                          )}
                        </NavLink>
                      );
                    })}
                  </>
                )}

                {/* Retour accueil */}
                <div className="pt-4 mt-4 border-t border-slate-100">
                  <NavLink
                    to="/"
                    onClick={() => handleSelectSpace("none")}
                    className="flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-sm text-slate-600 hover:bg-slate-50"
                  >
                    <Home className="h-4 w-4 text-slate-500" />
                    <span>Retour à l&apos;accueil</span>
                  </NavLink>
                </div>
              </nav>
            </div>

            {/* Overlay */}
            <div
              className="flex-1 bg-black/40 backdrop-blur-sm"
              onClick={() => setMobileNavOpen(false)}
            />

            <style>{`
              @keyframes slide-in {
                from { transform: translateX(-100%); }
                to { transform: translateX(0); }
              }
              .animate-slide-in {
                animation: slide-in 0.2s ease-out;
              }
            `}</style>
          </div>
        )}

        {/* ============================================================ */}
        {/* ZONE CONTENU - Premium container */}
        {/* ============================================================ */}
        <main className="flex-1 overflow-auto">
          <div className="mx-auto max-w-7xl px-4 lg:px-6 py-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}