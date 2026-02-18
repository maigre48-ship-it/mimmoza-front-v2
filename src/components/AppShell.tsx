// src/components/AppShell.tsx
// ────────────────────────────────────────────────────────────────────
// ✅ ACTION 2: SPACE_NAVIGATION.banque = [] (empty).
//    BanqueLayout.tsx is the SOLE workflow nav for the banque space.
//    AppShell only renders the global space bar when in banque.
// ────────────────────────────────────────────────────────────────────

import { useState, useMemo } from "react";
import type { ReactNode, ComponentType } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Menu, X, Home, FileText, Building2, Briefcase, ShieldCheck,
  PieChart, BarChart3, Map, Layers, TrendingUp,
  AlertTriangle, Grid3X3, Cuboid, Calculator, ChevronRight,
  Sparkles, Target, CheckCircle, DollarSign, Download, Search,
  Users, FileCheck, Scale, ClipboardList, Eye, Percent, Building,
  UserCircle,
} from "lucide-react";

import { preserveStudyInPath, extractStudyId } from "../utils/preserveStudyParam";

import {
  readBanqueSnapshot,
  selectActiveDossierId,
} from "../spaces/banque/store/banqueSnapshot.store";
import { preserveDossierInPath } from "../spaces/banque/utils/banqueDossierUrl";

type Space =
  | "none" | "promoteur" | "agence"
  | "marchand" | "banque";

type AppShellProps = {
  currentSpace: Space;
  onChangeSpace: (space: Space) => void;
  children: ReactNode;
};

type NavItem = {
  label: string;
  path: string;
  icon: ComponentType<{ className?: string }>;
  end?: boolean;
};

type NavSection = {
  id: string;
  label: string;
  items: NavItem[];
};

const SPACES: {
  id: Space;
  label: string;
  shortLabel: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  path: string;
}[] = [
  { id: "promoteur", label: "Espace Promoteur",        shortLabel: "Promoteur",         description: "Faisabilité, SDP potentielle et bilan promoteur",              icon: Building2,   path: "/promoteur" },
  { id: "agence",    label: "Espace Agence",            shortLabel: "Agence",            description: "Dossiers vendeurs / acquéreurs enrichis",                      icon: Briefcase,   path: "/particulier" },
  { id: "marchand",  label: "Espace Investisseur",      shortLabel: "Investisseur",      description: "Opportunités, scoring, rentabilité, exécution et sortie",      icon: PieChart,    path: "/marchand-de-bien" },
  { id: "banque",    label: "Espace Banque / Assurance", shortLabel: "Banque / Assurance", description: "Analyse de risque, comité crédit, tarification et suivi dossiers", icon: ShieldCheck, path: "/banque" },
];

// ═══════════════════════════════════════════════════════════════════
// SPACE_NAVIGATION
// ✅ banque = [] — NO sub-nav items here.
//    BanqueLayout.tsx provides the sole workflow bar.
// ═══════════════════════════════════════════════════════════════════
const SPACE_NAVIGATION: Record<Space, NavSection[]> = {
  none: [],

  promoteur: [
    {
      id: "demarrer", label: "Démarrer",
      items: [{ label: "Tableau de bord", path: "/promoteur", icon: BarChart3, end: true }],
    },
    {
      id: "foncier", label: "Foncier",
      items: [{ label: "Foncier", path: "/promoteur/foncier", icon: Map }],
    },
    {
      id: "conception", label: "Conception",
      items: [
        { label: "Implantation 2D", path: "/promoteur/implantation-2d", icon: Grid3X3 },
        { label: "Massing 3D", path: "/promoteur/massing-3d", icon: Cuboid },
      ],
    },
    {
      id: "evaluation", label: "Évaluation",
      items: [{ label: "Estimation", path: "/promoteur/estimation", icon: TrendingUp }],
    },
    {
      id: "etudes", label: "Études",
      items: [
        { label: "Marché", path: "/promoteur/marche", icon: Layers },
        { label: "Risques", path: "/promoteur/risques", icon: AlertTriangle },
      ],
    },
    {
      id: "bilan", label: "Bilan",
      items: [
        { label: "Bilan Promoteur", path: "/promoteur/bilan-promoteur", icon: Calculator },
        { label: "Synthèse", path: "/promoteur/synthese", icon: FileText },
      ],
    },
  ],

  agence: [
    {
      id: "gestion", label: "Gestion",
      items: [
        { label: "Tableau de bord", path: "/particulier", icon: BarChart3, end: true },
        { label: "Dossiers Vendeurs", path: "/particulier/vendeurs", icon: Users },
        { label: "Dossiers Acquéreurs", path: "/particulier/acquereurs", icon: UserCircle },
        { label: "Mandats", path: "/particulier/mandats", icon: FileCheck },
      ],
    },
  ],

  marchand: [
    {
      id: "acquisition", label: "Acquisition",
      items: [
        { label: "Pipeline", path: "/marchand-de-bien", icon: BarChart3, end: true },
        { label: "Sourcing", path: "/marchand-de-bien/sourcing", icon: Search },
        { label: "Qualification", path: "/marchand-de-bien/qualification", icon: CheckCircle },
      ],
    },
    {
      id: "analyse", label: "Analyse",
      items: [
        { label: "Rentabilité", path: "/marchand-de-bien/rentabilite", icon: Percent },
        { label: "Due Diligence", path: "/marchand-de-bien/due-diligence", icon: Eye },
      ],
    },
    {
      id: "execution", label: "Exécution",
      items: [
        { label: "Travaux", path: "/marchand-de-bien/execution", icon: Building },
        { label: "Planning", path: "/marchand-de-bien/planning", icon: ClipboardList },
      ],
    },
    {
      id: "sortie", label: "Sortie",
      items: [
        { label: "Commercialisation", path: "/marchand-de-bien/sortie", icon: DollarSign },
        { label: "Exports", path: "/marchand-de-bien/exports", icon: Download },
      ],
    },
  ],

  // ✅ EMPTY — BanqueLayout handles all workflow navigation inside /banque/*
  banque: [],
};

// ── Banque path helpers ──

function getBanqueActiveId(location: { pathname: string; search: string }): string | null {
  const { pathname, search } = location;
  const m = pathname.match(/^\/banque\/(?:dossier|analyse|comite|outil-risques)\/([^/]+)/i);
  if (m?.[1]) return m[1];
  try {
    const sp = new URLSearchParams(search);
    return sp.get("id") ?? sp.get("dossierId") ?? sp.get("dossier") ?? sp.get("d") ?? null;
  } catch { /* ignore */ }
  try {
    return selectActiveDossierId(readBanqueSnapshot()) ?? localStorage.getItem("mimmoza.banque.active_dossier_id");
  } catch { return null; }
}

// ══════════════════════════════════════════════════════════════════
// TopNavigation
// ══════════════════════════════════════════════════════════════════

function TopNavigation({
  currentSpace,
  onChangeSpace,
}: {
  currentSpace: Space;
  onChangeSpace: (space: Space) => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const studyId = useMemo(() => extractStudyId(location.search), [location.search]);

  const buildPath = (targetPath: string): string =>
    preserveStudyInPath(targetPath, location.search);

  const resolvePath = (targetPath: string): string => {
    if (currentSpace !== "banque") return buildPath(targetPath);
    const activeId = getBanqueActiveId(location);
    const needsId = new Set(["/banque/dossier", "/banque/analyse", "/banque/comite", "/banque/outil-risques"]);
    if (targetPath === "/banque") {
      return activeId ? buildPath(`/banque/dossier/${activeId}`) : buildPath("/banque/dossiers");
    }
    if (needsId.has(targetPath)) {
      return !activeId ? buildPath("/banque/dossiers") : buildPath(`${targetPath}/${activeId}`);
    }
    if (activeId) return preserveDossierInPath(buildPath(targetPath), activeId);
    return buildPath(targetPath);
  };

  const spaceSections = SPACE_NAVIGATION[currentSpace] || [];

  const activeSection = useMemo(() => {
    const p = location.pathname;
    for (const section of spaceSections) {
      for (const item of section.items) {
        if (item.end ? p === item.path : (p === item.path || p.startsWith(`${item.path}/`)))
          return section.id;
      }
    }
    return spaceSections[0]?.id ?? "";
  }, [location.pathname, spaceSections]);

  const isActivePath = (targetPath: string, end?: boolean) => {
    const p = location.pathname;
    return end ? p === targetPath : (p === targetPath || p.startsWith(`${targetPath}/`));
  };

  const activeItems = spaceSections.find((s) => s.id === activeSection)?.items ?? [];

  const handleSpaceClick = (space: Space, path: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    onChangeSpace(space);
    navigate(path);
  };

  const currentSpaceMeta = SPACES.find((s) => s.id === currentSpace);

  return (
    <>
      {/* Global space bar */}
      <div className="border-b border-slate-200/80 bg-white">
        <div className="mx-auto max-w-7xl px-4 lg:px-6">
          <div className="flex h-14 items-center justify-between gap-4">
            <NavLink
              to="/"
              onClick={() => onChangeSpace("none")}
              className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 -ml-2 hover:bg-slate-100/80 transition-colors shrink-0"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 via-indigo-600 to-emerald-500 text-xs font-bold text-white shadow-md shadow-indigo-500/20">
                MZ
              </div>
              <div className="hidden lg:flex flex-col items-start leading-none">
                <span className="text-sm font-semibold tracking-tight text-slate-900">Mimmoza</span>
                <span className="text-[10px] text-slate-400 mt-0.5">Intelligence parcellaire</span>
              </div>
            </NavLink>

            <div className="flex-1 flex items-center justify-center">
              <nav className="flex items-center gap-1 overflow-x-auto scrollbar-hide">
                {SPACES.map((space) => {
                  const Icon = space.icon;
                  const isActive = currentSpace === space.id;
                  return (
                    <a
                      key={space.id}
                      href={space.path}
                      onClick={handleSpaceClick(space.id, space.path)}
                      className={[
                        "group relative flex items-center gap-2 px-3 py-2 text-sm font-medium whitespace-nowrap rounded-lg transition-all",
                        isActive
                          ? "bg-slate-900 text-white shadow-sm"
                          : "text-slate-600 hover:text-slate-900 hover:bg-slate-100",
                      ].join(" ")}
                    >
                      <Icon className={`h-4 w-4 transition-colors ${isActive ? "text-white" : "text-slate-400 group-hover:text-slate-600"}`} />
                      <span className="hidden sm:inline">{space.shortLabel}</span>
                    </a>
                  );
                })}
              </nav>
            </div>

            <div className="flex items-center gap-2.5 rounded-full border border-slate-200/80 bg-white px-2.5 py-1.5 shadow-sm shrink-0">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-slate-100 to-slate-200 text-[11px] font-semibold text-slate-600">
                AM
              </div>
              <div className="hidden md:block leading-none pr-1">
                <div className="text-xs font-medium text-slate-700">Albé M.</div>
                <div className="text-[10px] text-slate-400 mt-0.5">Prototype</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Sub-navigation — only if spaceSections exist (NOT for banque since banque = []) */}
      {currentSpace !== "none" && spaceSections.length > 0 && (
        <div className="border-b border-slate-200/80 bg-white/95 backdrop-blur-sm">
          <div className="mx-auto max-w-7xl px-4 lg:px-6">
            <div className="flex items-center justify-between py-2.5 border-b border-slate-100">
              <div className="flex items-center gap-2 text-sm">
                {currentSpaceMeta && (
                  <>
                    <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-600 shadow-sm">
                      <currentSpaceMeta.icon className="h-3.5 w-3.5 text-white" />
                    </div>
                    <span className="font-semibold text-slate-800">{currentSpaceMeta.shortLabel}</span>
                    <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
                  </>
                )}
                <span className="text-slate-500">
                  {spaceSections.find((s) => s.id === activeSection)?.label}
                </span>
                {studyId && (
                  <>
                    <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-600 text-xs font-medium" title={studyId}>
                      <Sparkles className="h-3 w-3" />
                      {studyId.length > 10 ? `${studyId.slice(0, 10)}…` : studyId}
                    </span>
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={() => { onChangeSpace("none"); navigate("/"); }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:border-slate-300 hover:text-slate-800 transition-all"
              >
                <Home className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Accueil</span>
              </button>
            </div>

            {spaceSections.length > 1 && (
              <div className="flex items-center gap-1 py-2 overflow-x-auto scrollbar-hide">
                {spaceSections.map((section) => {
                  const active = section.id === activeSection;
                  const firstPath = section.items[0]?.path ?? "";
                  return (
                    <a
                      key={section.id}
                      href={resolvePath(firstPath)}
                      onClick={(e) => { e.preventDefault(); navigate(resolvePath(firstPath)); }}
                      className={[
                        "relative px-4 py-2 text-sm font-medium whitespace-nowrap rounded-lg transition-all",
                        active ? "bg-slate-900 text-white shadow-sm" : "text-slate-500 hover:text-slate-800 hover:bg-slate-100",
                      ].join(" ")}
                    >
                      {section.label}
                    </a>
                  );
                })}
              </div>
            )}

            {activeItems.length > 0 && (
              <div className={spaceSections.length > 1 ? "border-t border-slate-100 py-2" : "py-2"}>
                <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
                  {activeItems.map((item) => {
                    const Icon = item.icon;
                    const active = isActivePath(item.path, item.end);
                    return (
                      <a
                        key={item.path}
                        href={resolvePath(item.path)}
                        onClick={(e) => { e.preventDefault(); navigate(resolvePath(item.path)); }}
                        className={[
                          "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-all",
                          active ? "bg-white border border-slate-200 text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700 hover:bg-white/60",
                        ].join(" ")}
                      >
                        <Icon className={`h-4 w-4 ${active ? "text-indigo-500" : "text-slate-400"}`} />
                        <span>{item.label}</span>
                      </a>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </>
  );
}

// ══════════════════════════════════════════════════════════════════
// MobileDrawer
// ══════════════════════════════════════════════════════════════════

function MobileDrawer({
  isOpen, onClose, currentSpace, onChangeSpace,
}: {
  isOpen: boolean; onClose: () => void;
  currentSpace: Space; onChangeSpace: (space: Space) => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const buildPath = (tp: string) => preserveStudyInPath(tp, location.search);

  const resolvePath = (tp: string): string => {
    if (currentSpace !== "banque") return buildPath(tp);
    const activeId = getBanqueActiveId(location);
    const needsId = new Set(["/banque/dossier", "/banque/analyse", "/banque/comite", "/banque/outil-risques"]);
    if (tp === "/banque") return activeId ? buildPath(`/banque/dossier/${activeId}`) : buildPath("/banque/dossiers");
    if (needsId.has(tp)) return !activeId ? buildPath("/banque/dossiers") : buildPath(`${tp}/${activeId}`);
    if (activeId) return preserveDossierInPath(buildPath(tp), activeId);
    return buildPath(tp);
  };

  const isPathActive = (tp: string, end?: boolean) => {
    const p = location.pathname;
    return end ? p === tp : (p === tp || p.startsWith(`${tp}/`));
  };

  const spaceSections = SPACE_NAVIGATION[currentSpace] || [];
  const allNavItems = spaceSections.flatMap((s) => s.items);

  const handleSelectSpace = (space: Space) => {
    const meta = SPACES.find((s) => s.id === space);
    onChangeSpace(space);
    if (meta) navigate(meta.path);
    onClose();
  };

  const handleNavClick = (tp: string) => (e: React.MouseEvent) => {
    e.preventDefault(); navigate(resolvePath(tp)); onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex md:hidden">
      <div className="w-80 max-w-[85%] bg-white shadow-2xl flex flex-col animate-slide-in">
        <div className="px-4 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-emerald-500 text-xs font-bold text-white">MZ</div>
            <span className="text-sm font-semibold text-slate-800">
              {currentSpace !== "none" ? SPACES.find((s) => s.id === currentSpace)?.label : "Mimmoza"}
            </span>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 hover:bg-slate-100 transition-colors">
            <X className="h-4 w-4 text-slate-500" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {currentSpace !== "none" && allNavItems.length > 0 && (
            <>
              <div className="px-3 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                {SPACES.find((s) => s.id === currentSpace)?.label}
              </div>
              {allNavItems.map((item) => {
                const Icon = item.icon;
                const isActive = isPathActive(item.path, item.end);
                return (
                  <a key={item.path} href={resolvePath(item.path)} onClick={handleNavClick(item.path)}
                    className={["flex items-center gap-3 w-full rounded-xl px-3 py-2.5 transition-all",
                      isActive ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-50"].join(" ")}>
                    <Icon className={`h-4 w-4 ${isActive ? "text-white" : "text-slate-400"}`} />
                    <span className="text-sm font-medium">{item.label}</span>
                  </a>
                );
              })}
              <div className="pt-4 mt-4 border-t border-slate-100">
                <div className="px-3 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">Autres espaces</div>
              </div>
            </>
          )}

          {SPACES.filter((s) => s.id !== currentSpace).map((space) => {
            const Icon = space.icon;
            return (
              <button key={space.id} type="button" onClick={() => handleSelectSpace(space.id)}
                className="flex flex-col w-full rounded-xl px-3 py-2.5 text-left text-slate-700 hover:bg-slate-50 transition-all">
                <span className="flex items-center gap-3">
                  <Icon className="h-4 w-4 text-slate-400" />
                  <span className="text-sm font-medium">{space.label}</span>
                </span>
                <span className="mt-0.5 ml-7 text-[11px] text-slate-400">{space.description}</span>
              </button>
            );
          })}

          <div className="pt-4 mt-4 border-t border-slate-100">
            <NavLink to="/" onClick={() => { onChangeSpace("none"); onClose(); }}
              className="flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-sm text-slate-600 hover:bg-slate-50">
              <Home className="h-4 w-4 text-slate-500" />
              <span>Retour à l&apos;accueil</span>
            </NavLink>
          </div>
        </nav>
      </div>

      <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <style>{`
        @keyframes slide-in { from { transform: translateX(-100%); } to { transform: translateX(0); } }
        .animate-slide-in { animation: slide-in 0.2s ease-out; }
      `}</style>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// AppShell (exported)
// ══════════════════════════════════════════════════════════════════

export function AppShell({ currentSpace, onChangeSpace, children }: AppShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 backdrop-blur-md supports-[backdrop-filter]:bg-white/80 md:hidden">
        <div className="flex h-14 items-center justify-between px-4">
          <NavLink to="/" onClick={() => onChangeSpace("none")} className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 via-indigo-600 to-emerald-500 text-xs font-bold text-white shadow-md shadow-indigo-500/20">MZ</div>
            <span className="text-sm font-semibold tracking-tight text-slate-900">Mimmoza</span>
          </NavLink>
          <button type="button" onClick={() => setMobileNavOpen((o) => !o)}
            className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 hover:text-slate-800 hover:border-slate-300 transition-all">
            {mobileNavOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </header>

      <header className="sticky top-0 z-40 hidden md:block">
        <TopNavigation currentSpace={currentSpace} onChangeSpace={onChangeSpace} />
      </header>

      <MobileDrawer isOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)}
        currentSpace={currentSpace} onChangeSpace={onChangeSpace} />

      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-7xl px-4 lg:px-6 py-6">{children}</div>
      </main>

      <footer className="border-t border-slate-200/80 bg-white py-3 px-4">
        <div className="mx-auto max-w-7xl flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] text-slate-400">Mimmoza · Prototype local</span>
          </div>
          <span className="text-[10px] text-slate-400">Intelligence parcellaire</span>
        </div>
      </footer>
    </div>
  );
}