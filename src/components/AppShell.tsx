// src/components/AppShell.tsx
// ────────────────────────────────────────────────────────────────────
// ✅ BanqueLayout.tsx remains the SOLE workflow nav for the banque space.
//    AppShell only renders the global space bar when in banque.
// ✅ V1 compte utilisateur:
//    - avatar cliquable
//    - redirection /connexion si non connecté
//    - redirection /compte si connecté
// ✅ Dégradés par espace sur les onglets actifs
// ✅ Espace Analyse : 4 sous-onglets dans la subnav (tabParam sur ?tab=)
// ✅ Onglets globaux Veille (ambre) et API (indigo) dans la barre principale
// ────────────────────────────────────────────────────────────────────

import { useState, useMemo, useEffect } from "react";
import type { ReactNode, ComponentType } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Menu,
  X,
  Home,
  FileText,
  Building2,
  ShieldCheck,
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
  Search,
  ClipboardList,
  Building,
  UserCircle2,
  LayoutDashboard,
  Eye,
  Code2,
} from "lucide-react";

import { preserveStudyInPath, extractStudyId } from "../utils/preserveStudyParam";

import {
  readBanqueSnapshot,
  selectActiveDossierId,
} from "../spaces/banque/store/banqueSnapshot.store";
import { preserveDossierInPath } from "../spaces/banque/utils/banqueDossierUrl";
import { getCurrentAdminStatus } from "../lib/admin";
import { supabase } from "../lib/supabase";
import { unlockDealIfNeeded } from "../spaces/marchand/services/dealUnlock";
import {
  ensureActiveDeal,
  type MarchandDeal,
} from "../spaces/marchand/shared/marchandSnapshot.store";
import { DealUnlockModal } from "../spaces/marchand/components/DealUnlockModal";

type Space = "none" | "promoteur" | "agence" | "marchand" | "banque";

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
  /** Si défini, cet item est actif uniquement quand ?tab= correspond à cette valeur. */
  tabParam?: string;
};

type NavSection = {
  id: string;
  label: string;
  items: NavItem[];
};

type StoredAccount = {
  email: string;
  fullName?: string;
  initials?: string;
  plan?: "free" | "starter" | "pro";
  isAuthenticated: boolean;
};

type PendingUnlockState = {
  path: string;
  dealId: string;
  dealLabel: string;
};

const AUTH_STORAGE_KEY = "mimmoza.auth.v1";

// ── Per-space gradient helpers ─────────────────────────────────────

function getSpaceGradient(space: Space): string {
  switch (space) {
    case "marchand":
      return "linear-gradient(90deg, #2196f3 0%, #21cbf3 100%)";
    case "promoteur":
      return "linear-gradient(90deg, #7c6fcd 0%, #b39ddb 100%)";
    case "banque":
      return "linear-gradient(90deg, #26a69a 0%, #80cbc4 100%)";
    default:
      return "linear-gradient(90deg, #2196f3 0%, #21cbf3 100%)";
  }
}

function getSpaceAccentColor(space: Space): string {
  switch (space) {
    case "marchand":
      return "#1a72c4";
    case "promoteur":
      return "#5247b8";
    case "banque":
      return "#1a7a50";
    default:
      return "#1a72c4";
  }
}

// ── Auth helpers ───────────────────────────────────────────────────

function readStoredAccount(): StoredAccount | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredAccount>;
    if (!parsed || !parsed.email || !parsed.isAuthenticated) return null;
    return {
      email: parsed.email,
      fullName: parsed.fullName ?? "",
      initials: parsed.initials ?? buildInitials(parsed.fullName, parsed.email),
      plan: parsed.plan ?? "free",
      isAuthenticated: true,
    };
  } catch {
    return null;
  }
}

function buildInitials(fullName?: string, email?: string): string {
  const trimmed = (fullName ?? "").trim();
  if (trimmed) {
    const parts = trimmed.split(/\s+/).filter(Boolean);
    const initials = parts
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("");
    if (initials) return initials;
  }
  const fallback = (email ?? "M").trim();
  return fallback.slice(0, 2).toUpperCase();
}

function isMarchandPremiumPath(path: string): boolean {
  return (
    path.includes("/marchand-de-bien/sourcing") ||
    path.includes("/marchand-de-bien/execution") ||
    path.includes("/marchand-de-bien/planning") ||
    path.includes("/marchand-de-bien/analyse")
  );
}

function getDealLabel(deal: MarchandDeal): string {
  return (
    deal.title?.trim() ||
    deal.address?.trim() ||
    [deal.zipCode, deal.city].filter(Boolean).join(" ").trim() ||
    deal.id
  );
}

// ── buildNavItemPath — ajoute ?tab= si tabParam défini ────────────

function buildNavItemPath(resolvedBase: string, tabParam?: string): string {
  if (tabParam === undefined) return resolvedBase;
  const [pathPart, existingSearch] = resolvedBase.split("?");
  const sp = new URLSearchParams(existingSearch ?? "");
  sp.set("tab", tabParam);
  return `${pathPart}?${sp.toString()}`;
}

const SPACES: {
  id: Space;
  label: string;
  shortLabel: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  path: string;
}[] = [
  {
    id: "marchand",
    label: "Espace Investisseur particulier et marchand de bien",
    shortLabel: "Investisseur",
    description: "Opportunités, scoring, rentabilité, exécution et sortie",
    icon: PieChart,
    path: "/marchand-de-bien",
  },
  {
    id: "promoteur",
    label: "Espace Promoteur",
    shortLabel: "Promoteur",
    description: "Faisabilité, SDP potentielle et bilan promoteur",
    icon: Building2,
    path: "/promoteur",
  },
  {
    id: "banque",
    label: "Espace Financeur",
    shortLabel: "Financeur",
    description: "Analyse de risque, comité crédit, tarification et suivi dossiers",
    icon: ShieldCheck,
    path: "/banque",
  },
];

const SPACE_NAVIGATION: Record<Space, NavSection[]> = {
  none: [],

  promoteur: [
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
  ],

  agence: [
    {
      id: "gestion",
      label: "Compte",
      items: [{ label: "Compte", path: "/compte", icon: UserCircle2, end: true }],
    },
  ],

  marchand: [
    {
      id: "acquisition",
      label: "Acquisition",
      items: [
        { label: "Pipeline", path: "/marchand-de-bien", icon: BarChart3, end: true },
        { label: "Sourcing", path: "/marchand-de-bien/sourcing", icon: Search },
      ],
    },
    {
      id: "execution",
      label: "Exécution",
      items: [
        {
          label: "Simulation",
          path: "/marchand-de-bien/execution/simulation",
          icon: Calculator,
        },
        { label: "Travaux", path: "/marchand-de-bien/execution", icon: Building, end: true },
        { label: "Planning", path: "/marchand-de-bien/planning", icon: ClipboardList },
      ],
    },
    {
      id: "analyse",
      label: "Analyse",
      items: [
        {
          label: "Rentabilité",
          path: "/marchand-de-bien/analyse",
          icon: PieChart,
          end: true,
          tabParam: "rentabilite",
        },
        {
          label: "Due Diligence",
          path: "/marchand-de-bien/analyse",
          icon: FileText,
          tabParam: "due_diligence",
        },
        {
          label: "Marché / Risques",
          path: "/marchand-de-bien/analyse",
          icon: BarChart3,
          tabParam: "marche_risques",
        },
        {
          label: "Synthèse IA",
          path: "/marchand-de-bien/analyse",
          icon: Sparkles,
          tabParam: "synthese_ia",
        },
      ],
    },
  ],

  banque: [],
};

// ── Banque path helpers ────────────────────────────────────────────

function getBanqueActiveId(location: { pathname: string; search: string }): string | null {
  const { pathname, search } = location;
  const m = pathname.match(/^\/banque\/(?:dossier|analyse|comite|outil-risques)\/([^/]+)/i);
  if (m?.[1]) return m[1];

  try {
    const sp = new URLSearchParams(search);
    return sp.get("id") ?? sp.get("dossierId") ?? sp.get("dossier") ?? sp.get("d") ?? null;
  } catch {
    // ignore
  }

  try {
    return (
      selectActiveDossierId(readBanqueSnapshot()) ??
      localStorage.getItem("mimmoza.banque.active_dossier_id")
    );
  } catch {
    return null;
  }
}

// ── TopNavigation ──────────────────────────────────────────────────

function TopNavigation({
  currentSpace,
  onChangeSpace,
  isAdmin,
  onProtectedNavigate,
}: {
  currentSpace: Space;
  onChangeSpace: (space: Space) => void;
  isAdmin: boolean;
  onProtectedNavigate: (targetPath: string) => Promise<void>;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const studyId = useMemo(() => extractStudyId(location.search), [location.search]);
  const account = useMemo(() => readStoredAccount(), [location.pathname, location.search]);

  const buildPath = (targetPath: string): string =>
    preserveStudyInPath(targetPath, location.search);

  const resolvePath = (targetPath: string): string => {
    if (currentSpace !== "banque") return buildPath(targetPath);

    const activeId = getBanqueActiveId(location);
    const needsId = new Set([
      "/banque/dossier",
      "/banque/analyse",
      "/banque/comite",
      "/banque/outil-risques",
    ]);

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

  // activeSection — pathname suffit (les items analyse partagent le même path)
  const activeSection = useMemo(() => {
    const p = location.pathname;
    for (const section of spaceSections) {
      for (const item of section.items) {
        if (item.end ? p === item.path : p === item.path || p.startsWith(`${item.path}/`)) {
          return section.id;
        }
      }
    }
    return spaceSections[0]?.id ?? "";
  }, [location.pathname, spaceSections]);

  // isActivePath — vérifie aussi ?tab= si tabParam est défini
  const isActivePath = (targetPath: string, end?: boolean, tabParam?: string) => {
    const p = location.pathname;
    const pathMatch = end ? p === targetPath : p === targetPath || p.startsWith(`${targetPath}/`);
    if (!pathMatch) return false;
    if (tabParam !== undefined) {
      const sp = new URLSearchParams(location.search);
      const currentTab = sp.get("tab") ?? "rentabilite";
      return currentTab === tabParam;
    }
    return true;
  };

  const activeItems = spaceSections.find((s) => s.id === activeSection)?.items ?? [];

  const handleSpaceClick =
    (space: Space, path: string) => (e: React.MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();
      onChangeSpace(space);
      navigate(path);
    };

  const handleAccountClick = () => {
    navigate(account?.isAuthenticated ? "/compte" : "/connexion");
  };

  const currentSpaceMeta = SPACES.find((s) => s.id === currentSpace);
  const spaceGradient = getSpaceGradient(currentSpace);
  const spaceAccent = getSpaceAccentColor(currentSpace);

  return (
    <>
      {/* ── Barre principale ── */}
      <div className="border-b border-slate-200/70 bg-white/90 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-4 lg:px-6">
          <div className="flex h-16 items-center justify-between gap-4">
            {/* Logo */}
            <NavLink
              to="/"
              onClick={() => onChangeSpace("none")}
              className="flex shrink-0 items-center gap-3 rounded-xl px-2 py-1.5 transition-colors hover:bg-slate-100/80"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 via-blue-600 to-cyan-500 text-sm font-bold text-white shadow-lg shadow-indigo-500/20">
                MZ
              </div>
              <div className="hidden lg:flex flex-col items-start leading-none">
                <span className="text-base font-semibold tracking-tight text-slate-950">
                  Mimmoza
                </span>
                <span className="mt-1 text-[11px] text-slate-400">
                  Intelligence immobilière
                </span>
              </div>
            </NavLink>

            {/* Onglets espaces + Veille + API */}
            <div className="flex flex-1 items-center justify-center">
              <nav className="flex items-center gap-1.5 overflow-x-auto rounded-2xl border border-slate-200/80 bg-slate-50/80 p-1.5 scrollbar-hide">
                {/* ── Espaces métier ── */}
                {SPACES.map((space) => {
                  const Icon = space.icon;
                  const isActive = currentSpace === space.id;
                  const grad = getSpaceGradient(space.id);

                  return (
                    <a
                      key={space.id}
                      href={space.path}
                      onClick={handleSpaceClick(space.id, space.path)}
                      className="group relative flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-all"
                      style={
                        isActive
                          ? { background: grad, color: "white" }
                          : { color: "#64748b" }
                      }
                    >
                      <Icon
                        className={`h-4 w-4 transition-colors ${
                          isActive
                            ? "text-white"
                            : "text-slate-400 group-hover:text-slate-700"
                        }`}
                      />
                      <span>{space.shortLabel}</span>
                    </a>
                  );
                })}

                {/* ── Séparateur ── */}
                <div className="mx-1 h-5 w-px shrink-0 bg-slate-200/80" />

                {/* ── Veille ── */}
                <NavLink
                  to="/veille"
                  onClick={() => onChangeSpace("none")}
                  className="group relative flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-all"
                  style={({ isActive }) =>
                    isActive
                      ? { background: "linear-gradient(90deg, #f59e0b 0%, #fbbf24 100%)", color: "white" }
                      : { color: "#64748b" }
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Eye
                        className={`h-4 w-4 transition-colors ${
                          isActive ? "text-white" : "text-slate-400 group-hover:text-slate-700"
                        }`}
                      />
                      <span>Veille</span>
                    </>
                  )}
                </NavLink>

                {/* ── API ── */}
                <NavLink
                  to="/api"
                  onClick={() => onChangeSpace("none")}
                  className="group relative flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-all"
                  style={({ isActive }) =>
                    isActive
                      ? { background: "linear-gradient(90deg, #6366f1 0%, #8b5cf6 100%)", color: "white" }
                      : { color: "#64748b" }
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Code2
                        className={`h-4 w-4 transition-colors ${
                          isActive ? "text-white" : "text-slate-400 group-hover:text-slate-700"
                        }`}
                      />
                      <span>API</span>
                    </>
                  )}
                </NavLink>
              </nav>
            </div>

            {/* Compte + Admin */}
            <div className="flex shrink-0 items-center gap-2">
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => navigate("/admin")}
                  className="hidden md:inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-white px-3 py-2 text-sm font-medium text-slate-600 shadow-sm transition-all hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
                  title="Ouvrir l'espace administrateur"
                >
                  <LayoutDashboard className="h-4 w-4" />
                  <span>Admin</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleAccountClick}
                className="flex shrink-0 items-center gap-2.5 rounded-full border border-slate-200/80 bg-white px-2.5 py-1.5 shadow-sm transition-all hover:border-slate-300 hover:shadow-md"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-slate-100 to-slate-200 text-[11px] font-semibold text-slate-600">
                  {account?.initials ?? "AM"}
                </div>
                <div className="hidden md:block leading-none pr-1 text-left">
                  <div className="text-xs font-medium text-slate-700">
                    {account?.fullName?.trim() ||
                      (account?.isAuthenticated ? account.email : "Mon compte")}
                  </div>
                  <div className="mt-0.5 text-[10px] text-slate-400">
                    {account?.isAuthenticated
                      ? account.plan === "pro"
                        ? "Abonnement Pro"
                        : account.plan === "starter"
                          ? "Abonnement Starter"
                          : "Compte gratuit"
                      : "Connexion / inscription"}
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Subnav espace ── */}
      {currentSpace !== "none" && spaceSections.length > 0 && (
        <div className="border-b border-slate-200/70 bg-white/90 backdrop-blur-sm">
          <div className="mx-auto max-w-7xl px-4 lg:px-6">

            {/* Breadcrumb + Accueil */}
            <div className="flex items-center justify-between border-b border-slate-100 py-3">
              <div className="flex items-center gap-2 text-sm">
                {currentSpaceMeta && (
                  <>
                    <div
                      className="flex h-8 w-8 items-center justify-center rounded-xl shadow-sm"
                      style={{ background: spaceGradient }}
                    >
                      <currentSpaceMeta.icon className="h-4 w-4 text-white" />
                    </div>
                    <span className="font-semibold text-slate-900">
                      {currentSpaceMeta.shortLabel}
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
                  </>
                )}

                <span className="text-slate-500">
                  {spaceSections.find((s) => s.id === activeSection)?.label}
                </span>

                {studyId && (
                  <>
                    <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
                    <span
                      className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium"
                      style={{
                        background: `${spaceAccent}18`,
                        color: spaceAccent,
                      }}
                      title={studyId}
                    >
                      <Sparkles className="h-3 w-3" />
                      {studyId.length > 10 ? `${studyId.slice(0, 10)}…` : studyId}
                    </span>
                  </>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  onChangeSpace("none");
                  navigate("/");
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800"
              >
                <Home className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Accueil</span>
              </button>
            </div>

            {/* Section tabs (Acquisition / Exécution / Analyse…) */}
            {spaceSections.length > 1 && (
              <div className="flex items-center gap-1 py-2 overflow-x-auto scrollbar-hide">
                {spaceSections.map((section) => {
                  const active = section.id === activeSection;
                  const firstItem = section.items[0];
                  const firstPath = firstItem?.path ?? "";
                  const resolvedBase = resolvePath(firstPath);
                  const resolvedPath = buildNavItemPath(resolvedBase, firstItem?.tabParam);

                  return (
                    <a
                      key={section.id}
                      href={resolvedPath}
                      onClick={(e) => {
                        e.preventDefault();
                        void onProtectedNavigate(resolvedPath);
                      }}
                      className="relative rounded-xl px-4 py-2 text-sm font-medium whitespace-nowrap transition-all"
                      style={
                        active
                          ? { background: spaceGradient, color: "white" }
                          : { color: "#64748b" }
                      }
                    >
                      {section.label}
                    </a>
                  );
                })}
              </div>
            )}

            {/* Sub-items (Pipeline / Sourcing… ou Rentabilité / Due Diligence…) */}
            {activeItems.length > 1 && (
              <div className={spaceSections.length > 1 ? "border-t border-slate-100 py-2" : "py-2"}>
                <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
                  {activeItems.map((item) => {
                    const Icon = item.icon;
                    const active = isActivePath(item.path, item.end, item.tabParam);
                    const resolvedBase = resolvePath(item.path);
                    const resolvedPath = buildNavItemPath(resolvedBase, item.tabParam);

                    return (
                      <a
                        key={`${item.path}-${item.tabParam ?? "default"}`}
                        href={resolvedPath}
                        onClick={(e) => {
                          e.preventDefault();
                          void onProtectedNavigate(resolvedPath);
                        }}
                        className={[
                          "inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium whitespace-nowrap transition-all",
                          active
                            ? "border border-slate-200 bg-white text-slate-950 shadow-sm"
                            : "text-slate-500 hover:bg-white/70 hover:text-slate-700",
                        ].join(" ")}
                      >
                        <Icon
                          className="h-4 w-4"
                          style={{ color: active ? spaceAccent : "#94a3b8" }}
                        />
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

// ── MobileDrawer ───────────────────────────────────────────────────

function MobileDrawer({
  isOpen,
  onClose,
  currentSpace,
  onChangeSpace,
  isAdmin,
  onProtectedNavigate,
}: {
  isOpen: boolean;
  onClose: () => void;
  currentSpace: Space;
  onChangeSpace: (space: Space) => void;
  isAdmin: boolean;
  onProtectedNavigate: (targetPath: string, closeAfter?: boolean) => Promise<void>;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const account = useMemo(() => readStoredAccount(), [location.pathname, location.search]);

  const buildPath = (tp: string) => preserveStudyInPath(tp, location.search);

  const resolvePath = (tp: string): string => {
    if (currentSpace !== "banque") return buildPath(tp);

    const activeId = getBanqueActiveId(location);
    const needsId = new Set([
      "/banque/dossier",
      "/banque/analyse",
      "/banque/comite",
      "/banque/outil-risques",
    ]);

    if (tp === "/banque") {
      return activeId ? buildPath(`/banque/dossier/${activeId}`) : buildPath("/banque/dossiers");
    }

    if (needsId.has(tp)) {
      return !activeId ? buildPath("/banque/dossiers") : buildPath(`${tp}/${activeId}`);
    }

    if (activeId) return preserveDossierInPath(buildPath(tp), activeId);
    return buildPath(tp);
  };

  // isPathActive — vérifie aussi ?tab= si tabParam défini
  const isPathActive = (tp: string, end?: boolean, tabParam?: string) => {
    const p = location.pathname;
    const pathMatch = end ? p === tp : p === tp || p.startsWith(`${tp}/`);
    if (!pathMatch) return false;
    if (tabParam !== undefined) {
      const sp = new URLSearchParams(location.search);
      const currentTab = sp.get("tab") ?? "rentabilite";
      return currentTab === tabParam;
    }
    return true;
  };

  const spaceSections = SPACE_NAVIGATION[currentSpace] || [];
  const allNavItems = spaceSections.flatMap((s) => s.items);
  const spaceGradient = getSpaceGradient(currentSpace);

  const handleSelectSpace = (space: Space) => {
    const meta = SPACES.find((s) => s.id === space);
    onChangeSpace(space);
    if (meta) navigate(meta.path);
    onClose();
  };

  const handleNavClick =
    (item: NavItem) => (e: React.MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();
      const resolvedBase = resolvePath(item.path);
      const fullPath = buildNavItemPath(resolvedBase, item.tabParam);
      void onProtectedNavigate(fullPath, true);
    };

  const handleAccountClick = () => {
    navigate(account?.isAuthenticated ? "/compte" : "/connexion");
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex md:hidden">
      <div className="flex w-80 max-w-[85%] flex-col bg-white shadow-2xl animate-slide-in">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 via-blue-600 to-cyan-500 text-xs font-bold text-white">
              MZ
            </div>
            <span className="text-sm font-semibold text-slate-800">
              {currentSpace !== "none"
                ? SPACES.find((s) => s.id === currentSpace)?.label ?? "Mimmoza"
                : "Mimmoza"}
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 transition-colors hover:bg-slate-100"
          >
            <X className="h-4 w-4 text-slate-500" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          <button
            type="button"
            onClick={handleAccountClick}
            className="mb-3 flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-left transition-all hover:bg-slate-100"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-slate-100 to-slate-200 text-xs font-semibold text-slate-600">
              {account?.initials ?? "AM"}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-800">
                {account?.fullName?.trim() ||
                  (account?.isAuthenticated ? account.email : "Mon compte")}
              </div>
              <div className="mt-0.5 text-xs text-slate-500">
                {account?.isAuthenticated ? "Accéder à votre compte" : "Connexion / inscription"}
              </div>
            </div>
          </button>

          {isAdmin && (
            <button
              type="button"
              onClick={() => {
                navigate("/admin");
                onClose();
              }}
              className="mb-3 flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3 text-left transition-all hover:bg-slate-50"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                <LayoutDashboard className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-800">
                  Espace administrateur
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  Utilisateurs, abonnements, jetons, devis
                </div>
              </div>
            </button>
          )}

          {currentSpace !== "none" && allNavItems.length > 0 && (
            <>
              <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                {SPACES.find((s) => s.id === currentSpace)?.label}
              </div>

              {allNavItems.map((item) => {
                const Icon = item.icon;
                const isActive = isPathActive(item.path, item.end, item.tabParam);

                return (
                  <a
                    key={`${item.path}-${item.tabParam ?? "default"}`}
                    href={buildNavItemPath(resolvePath(item.path), item.tabParam)}
                    onClick={handleNavClick(item)}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 transition-all"
                    style={
                      isActive
                        ? { background: spaceGradient, color: "white" }
                        : { color: "#374151" }
                    }
                  >
                    <Icon className={`h-4 w-4 ${isActive ? "text-white" : "text-slate-400"}`} />
                    <span className="text-sm font-medium">{item.label}</span>
                  </a>
                );
              })}

              <div className="mt-4 border-t border-slate-100 pt-4">
                <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Autres espaces
                </div>
              </div>
            </>
          )}

          {SPACES.filter((s) => s.id !== currentSpace).map((space) => {
            const Icon = space.icon;

            return (
              <button
                key={space.id}
                type="button"
                onClick={() => handleSelectSpace(space.id)}
                className="flex w-full flex-col rounded-xl px-3 py-2.5 text-left text-slate-700 transition-all hover:bg-slate-50"
              >
                <span className="flex items-center gap-3">
                  <Icon className="h-4 w-4 text-slate-400" />
                  <span className="text-sm font-medium">{space.label}</span>
                </span>
                <span className="ml-7 mt-0.5 text-[11px] text-slate-400">
                  {space.description}
                </span>
              </button>
            );
          })}

          {/* ── Outils globaux : Veille + API ── */}
          <div className="mt-4 border-t border-slate-100 pt-4">
            <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Outils
            </div>

            <NavLink
              to="/veille"
              onClick={onClose}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 transition-all"
              style={({ isActive }) =>
                isActive
                  ? { background: "linear-gradient(90deg, #f59e0b 0%, #fbbf24 100%)", color: "white" }
                  : { color: "#374151" }
              }
            >
              {({ isActive }) => (
                <>
                  <Eye className={`h-4 w-4 ${isActive ? "text-white" : "text-amber-400"}`} />
                  <span className="text-sm font-medium">Veille marché</span>
                </>
              )}
            </NavLink>

            <NavLink
              to="/api"
              onClick={onClose}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 transition-all"
              style={({ isActive }) =>
                isActive
                  ? { background: "linear-gradient(90deg, #6366f1 0%, #8b5cf6 100%)", color: "white" }
                  : { color: "#374151" }
              }
            >
              {({ isActive }) => (
                <>
                  <Code2 className={`h-4 w-4 ${isActive ? "text-white" : "text-indigo-400"}`} />
                  <span className="text-sm font-medium">API</span>
                </>
              )}
            </NavLink>
          </div>

          <div className="mt-4 border-t border-slate-100 pt-4">
            <NavLink
              to="/"
              onClick={() => {
                onChangeSpace("none");
                onClose();
              }}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              <Home className="h-4 w-4 text-slate-500" />
              <span>Retour à l&apos;accueil</span>
            </NavLink>
          </div>
        </nav>
      </div>

      <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <style>{`
        @keyframes slide-in {
          from { transform: translateX(-100%); }
          to { transform: translateX(0); }
        }
        .animate-slide-in { animation: slide-in 0.2s ease-out; }
      `}</style>
    </div>
  );
}

// ── AppShell ───────────────────────────────────────────────────────

export function AppShell({ currentSpace, onChangeSpace, children }: AppShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [pendingUnlock, setPendingUnlock] = useState<PendingUnlockState | null>(null);
  const [unlockLoading, setUnlockLoading] = useState(false);
  const [unlockNoTokens, setUnlockNoTokens] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);

  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;

    async function refreshAdminStatus(): Promise<void> {
      const result = await getCurrentAdminStatus();
      if (!mounted) return;
      setIsAdmin(result.isAdmin);
    }

    void refreshAdminStatus();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void refreshAdminStatus();
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const closeUnlockModal = () => {
    setPendingUnlock(null);
    setUnlockLoading(false);
    setUnlockNoTokens(false);
    setUnlockError(null);
  };

  const handleProtectedNavigate = async (
    targetPath: string,
    closeAfterMobile = false
  ): Promise<void> => {
    if (closeAfterMobile) {
      setMobileNavOpen(false);
    }

    if (currentSpace !== "marchand" || !isMarchandPremiumPath(targetPath)) {
      navigate(targetPath);
      return;
    }

    const deal = ensureActiveDeal();

    if (!deal) {
      navigate("/marchand-de-bien");
      return;
    }

    if (deal.premiumUnlocked) {
      navigate(targetPath);
      return;
    }

    setUnlockError(null);
    setUnlockNoTokens(false);
    setPendingUnlock({
      path: targetPath,
      dealId: deal.id,
      dealLabel: getDealLabel(deal),
    });
  };

  const confirmUnlock = async () => {
    if (!pendingUnlock) return;

    try {
      setUnlockLoading(true);
      setUnlockError(null);
      setUnlockNoTokens(false);

      const result = await unlockDealIfNeeded(pendingUnlock.dealId);

      if (!result.ok) {
        if (result.reason === "NO_TOKENS") {
          setUnlockNoTokens(true);
          return;
        }

        setUnlockError(result.message);
        return;
      }

      const nextPath = pendingUnlock.path;
      closeUnlockModal();
      navigate(nextPath);
    } catch (error) {
      console.error("Erreur déverrouillage deal:", error);
      setUnlockError("Impossible de déverrouiller ce projet pour le moment.");
    } finally {
      setUnlockLoading(false);
    }
  };

  const openBilling = () => {
    closeUnlockModal();
    navigate("/compte");
  };

  const openSubscriptions = () => {
    closeUnlockModal();
    navigate("/compte?section=abonnements");
  };

  const openTokens = () => {
    closeUnlockModal();
    navigate("/compte?section=jetons");
  };

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      {/* Mobile header */}
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 backdrop-blur-md supports-[backdrop-filter]:bg-white/80 md:hidden">
        <div className="flex h-14 items-center justify-between px-4">
          <NavLink to="/" onClick={() => onChangeSpace("none")} className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 via-blue-600 to-cyan-500 text-xs font-bold text-white shadow-md shadow-indigo-500/20">
              MZ
            </div>
            <span className="text-sm font-semibold tracking-tight text-slate-900">Mimmoza</span>
          </NavLink>

          <div className="flex items-center gap-2">
            {isAdmin && (
              <button
                type="button"
                onClick={() => navigate("/admin")}
                className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white p-2 text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800"
                title="Admin"
              >
                <LayoutDashboard className="h-4 w-4" />
              </button>
            )}

            <button
              type="button"
              onClick={() => setMobileNavOpen((o) => !o)}
              className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white p-2 text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800"
            >
              {mobileNavOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </header>

      {/* Desktop header */}
      <header className="sticky top-0 z-40 hidden md:block">
        <TopNavigation
          currentSpace={currentSpace}
          onChangeSpace={onChangeSpace}
          isAdmin={isAdmin}
          onProtectedNavigate={handleProtectedNavigate}
        />
      </header>

      <MobileDrawer
        isOpen={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        currentSpace={currentSpace}
        onChangeSpace={onChangeSpace}
        isAdmin={isAdmin}
        onProtectedNavigate={handleProtectedNavigate}
      />

      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-7xl px-4 py-6 lg:px-6">{children}</div>
      </main>

      <footer className="border-t border-slate-200/80 bg-white py-3 px-4">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
            <span className="text-[10px] text-slate-400">Mimmoza · Prototype local</span>
          </div>
          <span className="text-[10px] text-slate-400">Intelligence immobilière</span>
        </div>
      </footer>

      <DealUnlockModal
        open={Boolean(pendingUnlock)}
        dealLabel={pendingUnlock?.dealLabel ?? "Projet"}
        loading={unlockLoading}
        noTokens={unlockNoTokens}
        errorMessage={unlockError}
        onClose={closeUnlockModal}
        onConfirmUnlock={confirmUnlock}
        onOpenBilling={openBilling}
        onOpenSubscriptions={openSubscriptions}
        onOpenTokens={openTokens}
      />
    </div>
  );
}