// src/components/AppShell.tsx

import {
  AlertTriangle,
  BarChart3,
  Building,
  Building2,
  Calculator, ChevronRight,
  ClipboardList,
  Code2,
  Cuboid,
  Eye,
  FileSearch,
  FileText,
  FolderKanban,
  Grid3X3,
  Hammer,
  Home,
  Layers,
  LayoutDashboard,
  Map,
  Menu,
  PieChart,
  Plus,
  ScanSearch,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  Wand2,
  X,
  Zap,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";

import mimmozaLogo from "../assets/mimmoza-logo.png";
import { getCurrentAdminStatus } from "../lib/admin";
import { supabase } from "../lib/supabase";
import { countUnseen } from "../services/opportunity/opportunityWatch.service";
import { DealUnlockModal } from "../spaces/marchand/components/DealUnlockModal";
import { unlockDealIfNeeded } from "../spaces/marchand/services/dealUnlock";
import { ensureActiveDeal, type MarchandDeal } from "../spaces/marchand/shared/marchandSnapshot.store";
import { extractStudyId, preserveStudyInPath } from "../utils/preserveStudyParam";
import { setCurrentUserId, syncCurrentUserId } from "@/lib/auth/currentUser";

// ── Paywall generique (promoteur, extensible) ─────────────────────────────────
import { ProjectUnlockModal } from "./billing/ProjectUnlockModal";
import { unlockProject, isProjectUnlocked } from "../lib/billing/projectUnlock";
import { buildPromoteurParcelKey } from "../lib/billing/parcelKey";
import { isRouteProtected, getSpacePaywallConfig } from "../lib/billing/paywallConfig";

type Space = "none" | "promoteur" | "agence" | "marchand" | "banque" | "rehabilitation";

type AppShellProps = {
  currentSpace: Space;
  onChangeSpace: (space: Space) => void;
  children: ReactNode;
};

type NavItem = {
  label: string;
  path: string;
  icon: ComponentType<{ className?: string; style?: React.CSSProperties }>;
  end?: boolean;
  tabParam?: string;
  separatorBefore?: boolean;
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

type PendingProjectUnlock = {
  path: string;
  space: "promoteur";   // extensible plus tard (rehabilitation, ...)
  projectKey: string;
  label: string;
};

const AUTH_STORAGE_KEY = "mimmoza.auth.v1";

function MimmozaLogo(props: { className?: string }) {
  return (
    <img
      src={mimmozaLogo}
      alt="Mimmoza"
      className={props.className ?? "h-12 w-auto object-contain"}
      draggable={false}
    />
  );
}

// ── Badge de non-lus de la Veille active ──────────────────────────────────────
// Auto-suffisant : interroge le compteur d'événements non lus au montage et
// toutes les 60 s. Silencieux si erreur (ex. utilisateur non connecté).
function VeilleNavBadge() {
  const [count, setCount] = useState(0);
  useEffect(function () {
    let mounted = true;
    async function load() {
      try {
        const n = await countUnseen();
        if (mounted) setCount(n);
      } catch {
        /* silencieux */
      }
    }
    void load();
    const id = setInterval(function () { void load(); }, 60000);
    return function () {
      mounted = false;
      clearInterval(id);
    };
  }, []);
  if (count <= 0) return null;
  return (
    <span className="ml-1 inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}

function getSpaceGradient(space: Space): string {
  if (space === "marchand")       return "linear-gradient(135deg, #1d6fe8 0%, #0ea5e9 55%, #22d3ee 100%)";
  if (space === "promoteur")      return "linear-gradient(90deg, #6f5bd6 0%, #8d78df 50%, #b39ddb 100%)";
  if (space === "agence")         return "linear-gradient(135deg, #16a34a 0%, #4ade80 100%)";
  if (space === "banque")         return "linear-gradient(90deg, #26a69a 0%, #80cbc4 100%)";
  if (space === "rehabilitation") return "linear-gradient(90deg, #ea580c 0%, #fb923c 100%)";
  return "linear-gradient(90deg, #2196f3 0%, #21cbf3 100%)";
}

function getSpaceAccentColor(space: Space): string {
  if (space === "marchand")       return "#1a72c4";
  if (space === "promoteur")      return "#5247b8";
  if (space === "agence")         return "#16a34a";
  if (space === "banque")         return "#1a7a50";
  if (space === "rehabilitation") return "#ea580c";
  return "#1a72c4";
}

function buildInitials(fullName: string | undefined, email: string | undefined): string {
  const trimmed = (fullName ?? "").trim();
  if (trimmed) {
    const parts  = trimmed.split(/\s+/).filter(Boolean);
    const first  = parts[0] ? parts[0][0] : "";
    const second = parts[1] ? parts[1][0] : "";
    const initials = (first + second).toUpperCase();
    if (initials) return initials;
  }
  return (email ?? "M").trim().slice(0, 2).toUpperCase();
}

function readStoredAccount(): StoredAccount | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredAccount>;
    if (!parsed || !parsed.email || !parsed.isAuthenticated) return null;
    return {
      email:           parsed.email,
      fullName:        parsed.fullName ?? "",
      initials:        parsed.initials ?? buildInitials(parsed.fullName, parsed.email),
      plan:            parsed.plan ?? "free",
      isAuthenticated: true,
    };
  } catch {
    return null;
  }
}

function isMarchandPremiumPath(path: string): boolean {
  if (path.indexOf("/marchand-de-bien/sourcing")    >= 0) return true;
  if (path.indexOf("/marchand-de-bien/execution")   >= 0) return true;
  if (path.indexOf("/marchand-de-bien/planning")    >= 0) return true;
  if (path.indexOf("/marchand-de-bien/analyse")     >= 0) return true;
  if (path.indexOf("/marchand-de-bien/georisques")  >= 0) return true;
  if (path.indexOf("/marchand-de-bien/deal-center") >= 0) return true;
  return false;
}

function getDealLabel(deal: MarchandDeal): string {
  const t  = deal.title   ? deal.title.trim()   : "";
  if (t) return t;
  const a  = deal.address ? deal.address.trim() : "";
  if (a) return a;
  const zc = [deal.zipCode, deal.city].filter(Boolean).join(" ").trim();
  if (zc) return zc;
  return deal.id;
}

function buildNavItemPath(resolvedBase: string, tabParam: string | undefined): string {
  if (tabParam === undefined) return resolvedBase;
  const idx            = resolvedBase.indexOf("?");
  const pathPart       = idx >= 0 ? resolvedBase.slice(0, idx) : resolvedBase;
  const existingSearch = idx >= 0 ? resolvedBase.slice(idx + 1) : "";
  const sp = new URLSearchParams(existingSearch);
  sp.set("tab", tabParam);
  return pathPart + "?" + sp.toString();
}

function getPromoteurActiveSection(pathname: string): string | null {
  if (pathname === "/promoteur") return "opportunites";

  const prefixMap: Array<[string, string]> = [
    ["/promoteur/veille",                    "opportunites"],
    ["/promoteur/nouvelle-opportunite",      "opportunites"],
    ["/promoteur/recherche-contacts",        "opportunites"],
    ["/promoteur/permis-construire",         "opportunites"],
    ["/promoteur/opportunites-apporteurs",   "opportunites"],
    ["/promoteur/foncier",                   "preanalyse"],
    ["/promoteur/plu-faisabilite",           "preanalyse"],
    ["/promoteur/faisabilite",               "preanalyse"],
    // ── L'étude de risques vit désormais UNIQUEMENT dans l'onglet Marché ──
    ["/promoteur/risques",                   "marche"],
    ["/promoteur/programmation",             "programmation"],
    ["/promoteur/implantation-2d",           "faisabilite"],
    ["/promoteur/plan-2d",                   "faisabilite"],
    ["/promoteur/massing-3d",                "faisabilite"],
    ["/promoteur/generateur-facades",        "faisabilite"],
    ["/promoteur/simulation-travaux",        "faisabilite"],
    ["/promoteur/estimation",                "marche"],
    ["/promoteur/marche",                    "marche"],
    ["/promoteur/logements-sociaux",         "marche"],
    ["/promoteur/bilan-promoteur",           "bilan"],
    ["/promoteur/bilan",                     "bilan"],
    ["/promoteur/synthese",                  "bilan"],
  ];

  for (const [prefix, sectionId] of prefixMap) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) return sectionId;
  }
  return null;
}

// ── SPACES ──────────────────────────────────────────────────────────────────
const SPACES: Array<{
  id: Space;
  label: string;
  shortLabel: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  path: string;
}> = [
  { id: "marchand",       label: "Espace Investisseur",   shortLabel: "Investisseur",   description: "Opportunites, scoring, rentabilite, execution et sortie",   icon: PieChart,  path: "/marchand-de-bien" },
  { id: "promoteur",      label: "Espace Promoteur",      shortLabel: "Promoteur",      description: "Faisabilite, SDP potentielle et bilan promoteur",           icon: Building2, path: "/promoteur" },
  { id: "rehabilitation", label: "Espace Réhabilitation", shortLabel: "Réhabilitation", description: "Audit technique, conformité, chiffrage et valorisation",    icon: Hammer,    path: "/rehabilitation" },
  { id: "agence",         label: "Espace Apporteur",      shortLabel: "Apporteur",      description: "Déposer un bien et générer des opportunités promoteur",     icon: Users,     path: "/apporteur" },
];

// ── SPACE_NAVIGATION ────────────────────────────────────────────────────────
const SPACE_NAVIGATION: Record<Space, NavSection[]> = {
  none: [],
  promoteur: [
    {
      id: "opportunites",
      label: "Opportunités",
      items: [
        { label: "Tableau de bord",      path: "/promoteur",                         icon: BarChart3, end: true },
        { label: "Veille foncière",      path: "/promoteur/veille",                  icon: Eye },
        { label: "Contacts mairie",      path: "/promoteur/recherche-contacts",      icon: Users,     separatorBefore: true },
        { label: "Permis comparables",   path: "/promoteur/permis-construire",       icon: FileSearch },
        { label: "Deals apporteurs",     path: "/promoteur/opportunites-apporteurs", icon: Building2, separatorBefore: true },
      ],
    },
    {
      id: "preanalyse",
      label: "Pré-analyse",
      items: [
        { label: "PLU express",       path: "/promoteur/foncier",  icon: Map },
      ],
    },
    {
      id: "programmation",
      label: "Programmation",
      items: [
        { label: "Programme & viabilité", path: "/promoteur/programmation", icon: Layers },
      ],
    },
    {
      id: "faisabilite",
      label: "Faisabilité",
      items: [
        { label: "Implantation 2D",    path: "/promoteur/implantation-2d",    icon: Grid3X3 },
        { label: "Massing 3D",         path: "/promoteur/massing-3d",         icon: Cuboid },
        { label: "Façades IA",         path: "/promoteur/generateur-facades", icon: Wand2 },
        { label: "Simulation travaux", path: "/promoteur/simulation-travaux", icon: Calculator, separatorBefore: true },
      ],
    },
    {
      id: "marche",
      label: "Marché",
      items: [
        { label: "DVF & comparables", path: "/promoteur/estimation",        icon: TrendingUp },
        { label: "Étude de marché",   path: "/promoteur/marche",            icon: Layers },
        { label: "Étude de risques",  path: "/promoteur/risques",           icon: AlertTriangle },
        { label: "Logements sociaux", path: "/promoteur/logements-sociaux", icon: Users },
      ],
    },
    {
      id: "bilan",
      label: "Bilan",
      items: [
        { label: "Bilan promoteur", path: "/promoteur/bilan-promoteur", icon: Calculator },
        { label: "Synthèse comité", path: "/promoteur/synthese",        icon: Sparkles },
      ],
    },
  ],
  agence: [
    {
      id: "deals",
      label: "Deals",
      items: [
        { label: "Dashboard",       path: "/apporteur",         icon: BarChart3, end: true },
        { label: "Déposer un bien", path: "/apporteur/deposer", icon: Plus },
      ],
    },
  ],
  marchand: [
    {
      id: "acquisition",
      label: "Acquisition",
      items: [
        { label: "Pipeline",   path: "/marchand-de-bien",          icon: BarChart3, end: true },
        { label: "SmartScore", path: "/marchand-de-bien/sourcing", icon: Search },
      ],
    },
    {
      id: "execution",
      label: "Execution",
      items: [
        { label: "Simulation",    path: "/marchand-de-bien/execution/simulation", icon: Calculator },
        { label: "Travaux",       path: "/marchand-de-bien/execution",            icon: Building, end: true },
        { label: "Rendu travaux", path: "/marchand-de-bien/planning",             icon: ClipboardList },
      ],
    },
    {
      id: "analyse",
      label: "Analyse",
      items: [
        { label: "Rentabilite",        path: "/marchand-de-bien/analyse",    icon: PieChart,   end: true, tabParam: "rentabilite"        },
        { label: "Due Diligence",      path: "/marchand-de-bien/analyse",    icon: FileText,              tabParam: "due_diligence"      },
        { label: "Étude de marché",    path: "/marchand-de-bien/analyse",    icon: BarChart3,             tabParam: "marche_risques"     },
        { label: "Étude de risques",   path: "/marchand-de-bien/georisques", icon: ShieldAlert             },
        { label: "Analyse predictive", path: "/marchand-de-bien/analyse",    icon: TrendingUp,            tabParam: "analyse_predictive" },
        { label: "Synthese IA",        path: "/marchand-de-bien/analyse",    icon: Sparkles,              tabParam: "synthese_ia"        },
      ],
    },
    {
      id: "deal-center",
      label: "Deal Center",
      items: [
        { label: "Qualification",     path: "/marchand-de-bien/deal-center", icon: ClipboardList, end: true, tabParam: "qualification"   },
        { label: "Confiance données", path: "/marchand-de-bien/deal-center", icon: ShieldCheck,             tabParam: "data_confidence"  },
        { label: "Pack investisseur", path: "/marchand-de-bien/deal-center", icon: FileText,                tabParam: "investment_pack"  },
        { label: "Revue comité",      path: "/marchand-de-bien/deal-center", icon: Users,                   tabParam: "committee_review" },
        { label: "Moteur financier",  path: "/marchand-de-bien/deal-center", icon: Calculator,              tabParam: "financial_engine" },
        { label: "Exports",           path: "/marchand-de-bien/deal-center", icon: FileSearch,              tabParam: "exports"          },
      ],
    },
  ],
  banque: [],
  rehabilitation: [
    {
      id: "projets",
      label: "Projets",
      items: [
        { label: "Mes projets", path: "/rehabilitation/projets", icon: FolderKanban, end: true },
      ],
    },
    {
      id: "vue-ensemble",
      label: "Vue d'ensemble",
      items: [
        { label: "Vue d'ensemble", path: "/rehabilitation/vue-ensemble", icon: LayoutDashboard, end: true },
      ],
    },
    {
      id: "conformite",
      label: "Conformité",
      items: [
        { label: "Conformité", path: "/rehabilitation/conformite", icon: ShieldCheck, end: true },
      ],
    },
    {
      id: "analyse-plan",
      label: "Analyse du plan",
      items: [
        { label: "Analyse du plan", path: "/rehabilitation/analyse-plan", icon: ScanSearch, end: true },
      ],
    },
    {
      id: "Simulation travaux",
      label: "Simulation travaux",
      items: [
        { label: "Simulation travaux", path: "/rehabilitation/travaux", icon: Calculator, end: true },
      ],
    },
    {
      id: "synthese-audit",
      label: "Synthèse audit",
      items: [
        { label: "Synthèse audit", path: "/rehabilitation/synthese-audit", icon: Sparkles, end: true },
      ],
    },
    {
      id: "valorisation",
      label: "Valorisation",
      items: [
        { label: "Valorisation",  path: "/rehabilitation/valorisation",  icon: TrendingUp, end: true },
        { label: "Rendu travaux", path: "/rehabilitation/rendu-travaux", icon: Wand2 },
      ],
    },
  ],
};

// ─── TopNavigation ────────────────────────────────────────────────────────────

function TopNavigation(props: {
  currentSpace: Space;
  onChangeSpace: (space: Space) => void;
  isAdmin: boolean;
  onProtectedNavigate: (targetPath: string) => Promise<void>;
}) {
  const { currentSpace, onChangeSpace, isAdmin, onProtectedNavigate } = props;

  const location = useLocation();
  const navigate  = useNavigate();
  const studyId   = useMemo(() => extractStudyId(location.search), [location.search]);
  const account   = useMemo(() => readStoredAccount(), [location.pathname, location.search]);

  function buildPath(targetPath: string): string {
    return preserveStudyInPath(targetPath, location.search);
  }

  function resolvePath(targetPath: string): string {
    return buildPath(targetPath);
  }

  const spaceSections = SPACE_NAVIGATION[currentSpace] || [];

  const activeSection = useMemo(() => {
    const p = location.pathname;
    if (currentSpace === "promoteur") {
      const explicit = getPromoteurActiveSection(p);
      if (explicit) return explicit;
    }
    for (const section of spaceSections) {
      for (const item of section.items) {
        let match = false;
        if (item.end) {
          match = p === item.path;
        } else {
          match = p === item.path || p.startsWith(item.path + "/");
        }
        if (match) return section.id;
      }
    }
    if (spaceSections.length > 0) return spaceSections[0].id;
    return "";
  }, [location.pathname, currentSpace, spaceSections]);

  function isActivePath(targetPath: string, end: boolean | undefined, tabParam: string | undefined): boolean {
    const p = location.pathname;
    let pathMatch = false;
    if (end) {
      pathMatch = p === targetPath;
    } else {
      pathMatch = p === targetPath || p.startsWith(targetPath + "/");
    }
    if (!pathMatch) return false;
    if (tabParam !== undefined) {
      const sp         = new URLSearchParams(location.search);
      const currentTab = sp.get("tab") ?? "rentabilite";
      return currentTab === tabParam;
    }
    return true;
  }

  const currentSection = spaceSections.find((s) => s.id === activeSection);
  const activeItems    = currentSection ? currentSection.items : [];

  function handleSpaceClickFactory(space: Space, path: string) {
    return function (e: React.MouseEvent<HTMLAnchorElement>) {
      e.preventDefault();
      onChangeSpace(space);
      navigate(path);
    };
  }

  const currentSpaceMeta = SPACES.find((s) => s.id === currentSpace);
  const spaceGradient    = getSpaceGradient(currentSpace);
  const spaceAccent      = getSpaceAccentColor(currentSpace);

  function handleAccountClick() {
    navigate("/compte");
  }

  const subTabBaseCls = "inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium whitespace-nowrap transition-all";

  return (
    <>
      <div className="border-b border-slate-200/70 bg-white/90 backdrop-blur-md overflow-x-hidden">
        <div className="mx-auto max-w-7xl px-4 lg:px-6">
          <div className="flex h-16 items-center justify-between gap-4 min-w-0">
            <NavLink
              to="/"
              onClick={() => onChangeSpace("none")}
              className="flex shrink-0 items-center px-2 py-1.5"
            >
              <MimmozaLogo className="h-12 w-auto object-contain" />
            </NavLink>

            <div className="flex min-w-0 flex-1 items-center justify-center">
              <nav className="flex items-center gap-1.5 overflow-x-auto rounded-2xl border border-slate-200/80 bg-slate-50/80 p-1.5 scrollbar-hide">
                {SPACES.map(function (space) {
                  const Icon     = space.icon;
                  const isActive = currentSpace === space.id;
                  const grad     = getSpaceGradient(space.id);
                  const iconCls  = "h-4 w-4 transition-colors " + (isActive ? "text-white" : "text-slate-400 group-hover:text-slate-700");
                  const anchorStyle = isActive ? { background: grad, color: "white" } : { color: "#64748b" };
                  return (
                    <a
                      key={space.id}
                      href={space.path}
                      onClick={handleSpaceClickFactory(space.id, space.path)}
                      className="group relative flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-all"
                      style={anchorStyle}
                    >
                      <Icon className={iconCls} />
                      <span>{space.shortLabel}</span>
                    </a>
                  );
                })}

                <div className="mx-1 h-5 w-px shrink-0 bg-slate-200/80" />

                <NavLink
                  to="/analyse-rapide"
                  onClick={() => onChangeSpace("none")}
                  className="group relative flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-all"
                  style={function (navArgs) {
                    if (navArgs.isActive) return { background: "linear-gradient(135deg, #6366f1 0%, #818cf8 100%)", color: "white" };
                    return { color: "#64748b" };
                  }}
                >
                  {function (navArgs) {
                    const cls = "h-4 w-4 transition-colors " + (navArgs.isActive ? "text-white" : "text-slate-400 group-hover:text-slate-700");
                    return (<><Zap className={cls} /><span>Analyse rapide</span></>);
                  }}
                </NavLink>

                <NavLink
                  to="/opportunites"
                  onClick={() => onChangeSpace("none")}
                  className="group relative flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-all"
                  style={function (navArgs) {
                    if (navArgs.isActive) return { background: "linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)", color: "white" };
                    return { color: "#64748b" };
                  }}
                >
                  {function (navArgs) {
                    const cls = "h-4 w-4 transition-colors " + (navArgs.isActive ? "text-white" : "text-slate-400 group-hover:text-slate-700");
                    return (<><Target className={cls} /><span>Opportunités</span><VeilleNavBadge /></>);
                  }}
                </NavLink>

                <NavLink
                  to="/api"
                  onClick={() => onChangeSpace("none")}
                  className="group relative flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-all"
                  style={function (navArgs) {
                    if (navArgs.isActive) return { background: "linear-gradient(90deg, #6366f1 0%, #8b5cf6 100%)", color: "white" };
                    return { color: "#64748b" };
                  }}
                >
                  {function (navArgs) {
                    const cls = "h-4 w-4 transition-colors " + (navArgs.isActive ? "text-white" : "text-slate-400 group-hover:text-slate-700");
                    return (<><Code2 className={cls} /><span>API</span></>);
                  }}
                </NavLink>
              </nav>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => navigate("/admin")}
                  className="hidden md:inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-white px-3 py-2 text-sm font-medium text-slate-600 shadow-sm transition-all hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
                  title="Admin"
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
                  {account && account.initials ? account.initials : "AM"}
                </div>
                <div className="hidden md:block leading-none pr-1 text-left">
                  <div className="text-xs font-medium text-slate-700">
                    {account && account.fullName && account.fullName.trim()
                      ? account.fullName
                      : account && account.isAuthenticated
                        ? account.email
                        : "Mon compte"}
                  </div>
                  <div className="mt-0.5 text-[10px] text-slate-400">
                    {account && account.isAuthenticated
                      ? (account.plan === "pro" ? "Abonnement Pro" : account.plan === "starter" ? "Abonnement Starter" : "Compte gratuit")
                      : "Connexion / inscription"}
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>

      {currentSpace !== "none" && spaceSections.length > 0 && (
        <div className="border-b border-slate-200/70 bg-white/90 backdrop-blur-sm">
          <div className="mx-auto max-w-7xl px-4 lg:px-6">
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
                    <span className="font-semibold text-slate-900">{currentSpaceMeta.shortLabel}</span>
                    <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
                  </>
                )}
                <span className="text-slate-500">{currentSection ? currentSection.label : ""}</span>
                {studyId && (
                  <>
                    <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
                    <span
                      className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium"
                      style={{ background: spaceAccent + "18", color: spaceAccent }}
                      title={studyId}
                    >
                      <Sparkles className="h-3 w-3" />
                      {studyId.length > 10 ? studyId.slice(0, 10) + "..." : studyId}
                    </span>
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={() => { onChangeSpace("none"); navigate("/"); }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800"
              >
                <Home className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Accueil</span>
              </button>
            </div>

            {spaceSections.length > 1 && (
              <div className="flex items-center gap-1 py-2 overflow-x-auto scrollbar-hide">
                {spaceSections.map(function (section) {
                  const active       = section.id === activeSection;
                  const firstItem    = section.items[0];
                  const firstPath    = firstItem ? firstItem.path : "";
                  const firstTab     = firstItem ? firstItem.tabParam : undefined;
                  const resolvedBase = resolvePath(firstPath);
                  const resolvedPath = buildNavItemPath(resolvedBase, firstTab);
                  const sectStyle    = active ? { background: spaceGradient, color: "white" } : { color: "#64748b" };
                  return (
                    <a
                      key={section.id}
                      href={resolvedPath}
                      onClick={function (e) { e.preventDefault(); void onProtectedNavigate(resolvedPath); }}
                      className="relative rounded-xl px-4 py-2 text-sm font-medium whitespace-nowrap transition-all"
                      style={sectStyle}
                    >
                      {section.label}
                    </a>
                  );
                })}
              </div>
            )}

            {activeItems.length > 1 && (
              <div className={spaceSections.length > 1 ? "border-t border-slate-100 py-2" : "py-2"}>
                <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
                  {activeItems.map(function (item, idx) {
                    const Icon         = item.icon;
                    const active       = isActivePath(item.path, item.end, item.tabParam);
                    const resolvedBase = resolvePath(item.path);
                    const resolvedPath = buildNavItemPath(resolvedBase, item.tabParam);
                    const itemKey      = item.path + "-" + (item.tabParam ? item.tabParam : "default") + "-" + idx;
                    const linkStyle    = active ? { background: spaceGradient, color: "white" } : { color: "#64748b" };
                    const iconColor    = active ? "white" : "#94a3b8";
                    return (
                      <span key={itemKey} className="flex items-center gap-2">
                        {item.separatorBefore && (
                          <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 self-center bg-slate-300/80" />
                        )}
                        <a
                          href={resolvedPath}
                          onClick={function (e) { e.preventDefault(); void onProtectedNavigate(resolvedPath); }}
                          className={subTabBaseCls}
                          style={linkStyle}
                        >
                          <Icon className="h-4 w-4" style={{ color: iconColor }} />
                          <span>{item.label}</span>
                        </a>
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <style>{".scrollbar-hide::-webkit-scrollbar{display:none}.scrollbar-hide{-ms-overflow-style:none;scrollbar-width:none}"}</style>
    </>
  );
}

// ─── MobileDrawer ─────────────────────────────────────────────────────────────

function MobileDrawer(props: {
  isOpen: boolean;
  onClose: () => void;
  currentSpace: Space;
  onChangeSpace: (space: Space) => void;
  isAdmin: boolean;
  onProtectedNavigate: (targetPath: string, closeAfter?: boolean) => Promise<void>;
}) {
  const { isOpen, onClose, currentSpace, onChangeSpace, isAdmin, onProtectedNavigate } = props;

  const location = useLocation();
  const navigate  = useNavigate();
  const account   = useMemo(() => readStoredAccount(), [location.pathname, location.search]);

  function buildPath(tp: string): string {
    return preserveStudyInPath(tp, location.search);
  }

  function resolvePath(tp: string): string {
    return buildPath(tp);
  }

  function isPathActive(tp: string, end: boolean | undefined, tabParam: string | undefined): boolean {
    const p = location.pathname;
    let pathMatch = false;
    if (end) {
      pathMatch = p === tp;
    } else {
      pathMatch = p === tp || p.startsWith(tp + "/");
    }
    if (!pathMatch) return false;
    if (tabParam !== undefined) {
      const sp         = new URLSearchParams(location.search);
      const currentTab = sp.get("tab") ?? "rentabilite";
      return currentTab === tabParam;
    }
    return true;
  }

  const spaceSections    = SPACE_NAVIGATION[currentSpace] || [];
  const allNavItems: NavItem[] = [];
  for (const s of spaceSections) {
    for (const it of s.items) allNavItems.push(it);
  }
  const spaceGradient    = getSpaceGradient(currentSpace);
  const currentSpaceMeta = SPACES.find((s) => s.id === currentSpace);

  function handleSelectSpace(space: Space) {
    const meta = SPACES.find((s) => s.id === space);
    onChangeSpace(space);
    if (meta) navigate(meta.path);
    onClose();
  }

  function handleAccountClick() {
    navigate("/compte");
    onClose();
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex md:hidden">
      <div className="flex w-80 max-w-[85%] flex-col bg-white shadow-2xl animate-slide-in">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-4">
          <MimmozaLogo className="h-10 w-auto object-contain" />
          <button type="button" onClick={onClose} className="rounded-lg p-2 transition-colors hover:bg-slate-100">
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
              {account && account.initials ? account.initials : "AM"}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-800">
                {account && account.fullName && account.fullName.trim()
                  ? account.fullName
                  : account && account.isAuthenticated
                    ? account.email
                    : "Mon compte"}
              </div>
              <div className="mt-0.5 text-xs text-slate-500">
                {account && account.isAuthenticated ? "Acceder a votre compte" : "Connexion / inscription"}
              </div>
            </div>
          </button>

          {isAdmin && (
            <button
              type="button"
              onClick={() => { navigate("/admin"); onClose(); }}
              className="mb-3 flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3 text-left transition-all hover:bg-slate-50"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                <LayoutDashboard className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-800">Espace administrateur</div>
                <div className="mt-0.5 text-xs text-slate-500">Utilisateurs, abonnements, jetons, devis</div>
              </div>
            </button>
          )}

          {currentSpace !== "none" && allNavItems.length > 0 && (
            <>
              <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                {currentSpaceMeta ? currentSpaceMeta.label : ""}
              </div>
              {allNavItems.map(function (item, idx) {
                const Icon        = item.icon;
                const isActive    = isPathActive(item.path, item.end, item.tabParam);
                const itemKey     = item.path + "-" + (item.tabParam ? item.tabParam : "default") + "-" + idx;
                const href        = buildNavItemPath(resolvePath(item.path), item.tabParam);
                const iconCls     = "h-4 w-4 " + (isActive ? "text-white" : "text-slate-400");
                const anchorStyle = isActive ? { background: spaceGradient, color: "white" } : { color: "#374151" };
                return (
                  <div key={itemKey}>
                    {item.separatorBefore && (
                      <div aria-hidden="true" className="mx-3 my-1 h-px bg-slate-200" />
                    )}
                    <a
                      href={href}
                      onClick={function (e) { e.preventDefault(); void onProtectedNavigate(href, true); }}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 transition-all"
                      style={anchorStyle}
                    >
                      <Icon className={iconCls} />
                      <span className="text-sm font-medium">{item.label}</span>
                    </a>
                  </div>
                );
              })}
              <div className="mt-4 border-t border-slate-100 pt-4">
                <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Autres espaces</div>
              </div>
            </>
          )}

          {SPACES.filter((s) => s.id !== currentSpace).map(function (space) {
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
                <span className="ml-7 mt-0.5 text-[11px] text-slate-400">{space.description}</span>
              </button>
            );
          })}

          <div className="mt-4 border-t border-slate-100 pt-4">
            <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Outils</div>

            <NavLink
              to="/analyse-rapide"
              onClick={onClose}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 transition-all"
              style={function (navArgs) {
                if (navArgs.isActive) return { background: "linear-gradient(135deg, #6366f1 0%, #818cf8 100%)", color: "white" };
                return { color: "#374151" };
              }}
            >
              {function (navArgs) {
                const cls = "h-4 w-4 " + (navArgs.isActive ? "text-white" : "text-indigo-400");
                return (<><Zap className={cls} /><span className="text-sm font-medium">Analyse rapide</span></>);
              }}
            </NavLink>

            <NavLink
              to="/opportunites"
              onClick={onClose}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 transition-all"
              style={function (navArgs) {
                if (navArgs.isActive) return { background: "linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)", color: "white" };
                return { color: "#374151" };
              }}
            >
              {function (navArgs) {
                const cls = "h-4 w-4 " + (navArgs.isActive ? "text-white" : "text-indigo-400");
                return (<><Target className={cls} /><span className="text-sm font-medium">Opportunités</span><VeilleNavBadge /></>);
              }}
            </NavLink>

            <NavLink
              to="/api"
              onClick={onClose}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 transition-all"
              style={function (navArgs) {
                if (navArgs.isActive) return { background: "linear-gradient(90deg, #6366f1 0%, #8b5cf6 100%)", color: "white" };
                return { color: "#374151" };
              }}
            >
              {function (navArgs) {
                const cls = "h-4 w-4 " + (navArgs.isActive ? "text-white" : "text-indigo-400");
                return (<><Code2 className={cls} /><span className="text-sm font-medium">API</span></>);
              }}
            </NavLink>
          </div>

          <div className="mt-4 border-t border-slate-100 pt-4">
            <NavLink
              to="/"
              onClick={() => { onChangeSpace("none"); onClose(); }}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              <Home className="h-4 w-4 text-slate-500" />
              <span>Retour a l'accueil</span>
            </NavLink>
          </div>
        </nav>
      </div>
      <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <style>{"@keyframes slide-in{from{transform:translateX(-100%)}to{transform:translateX(0)}}.animate-slide-in{animation:slide-in 0.2s ease-out}"}</style>
    </div>
  );
}

// ─── AppShell ─────────────────────────────────────────────────────────────────

export function AppShell(props: AppShellProps) {
  const { currentSpace, onChangeSpace, children } = props;

  const [mobileNavOpen,  setMobileNavOpen]  = useState(false);
  const [isAdmin,        setIsAdmin]        = useState(false);
  const [pendingUnlock,  setPendingUnlock]  = useState<PendingUnlockState | null>(null);
  const [unlockLoading,  setUnlockLoading]  = useState(false);
  const [unlockNoTokens, setUnlockNoTokens] = useState(false);
  const [unlockError,    setUnlockError]    = useState<string | null>(null);

  // ── Paywall projet generique (promoteur) ───────────────────────────────────
  const [projectUnlock,        setProjectUnlock]        = useState<PendingProjectUnlock | null>(null);
  const [projectUnlockLoading, setProjectUnlockLoading] = useState(false);
  const [projectUnlockNoTokens,setProjectUnlockNoTokens]= useState(false);
  const [projectUnlockError,   setProjectUnlockError]   = useState<string | null>(null);

  const navigate = useNavigate();
  const location = useLocation();

  const isPublicPage =
    location.pathname === "/" ||
    location.pathname.startsWith("/cgv") ||
    location.pathname.startsWith("/cgu") ||
    location.pathname.startsWith("/politique-confidentialite") ||
    location.pathname.startsWith("/mentions-legales");

  useEffect(function () {
    let mounted = true;
    async function refreshAdminStatus() {
      const result = await getCurrentAdminStatus();
      if (!mounted) return;
      setIsAdmin(result.isAdmin);
    }
    // Synchro initiale du user_id (alimente userScopedStorage).
    void syncCurrentUserId();
    void refreshAdminStatus();
    const sub = supabase.auth.onAuthStateChange(function (_event, session) {
      // Maintient le store synchrone du user_id a jour (login / logout / refresh).
      setCurrentUserId(session?.user?.id ?? null);
      void refreshAdminStatus();
    });
    const subscription = sub.data.subscription;
    return function () {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  function closeUnlockModal() {
    setPendingUnlock(null);
    setUnlockLoading(false);
    setUnlockNoTokens(false);
    setUnlockError(null);
  }

  async function handleProtectedNavigate(targetPath: string, closeAfterMobile?: boolean): Promise<void> {
    if (closeAfterMobile) setMobileNavOpen(false);

    // ── Chemin marchand (inchange) ────────────────────────────────────────────
    if (currentSpace === "marchand" && isMarchandPremiumPath(targetPath)) {
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
      setPendingUnlock({ path: targetPath, dealId: deal.id, dealLabel: getDealLabel(deal) });
      return;
    }

    // ── Chemin promoteur (1 jeton = 1 parcelle) ───────────────────────────────
    if (currentSpace === "promoteur" && isRouteProtected("promoteur", targetPath)) {
      const parcel = buildPromoteurParcelKey();
      // Pas de parcelle selectionnee -> navigation libre
      if (!parcel.key) {
        navigate(targetPath);
        return;
      }

      // Deja deverrouille (dans la fenetre de validite) ? -> navigation directe,
      // SANS re-afficher la modale ni re-debiter. C'est le coeur du fix :
      // 1 jeton = parcelle debloquee pour TOUTES les pages du vertical, 30 jours.
      const cfg = getSpacePaywallConfig("promoteur");
      try {
        const already = await isProjectUnlocked("promoteur", parcel.key, cfg.validityDays);
        if (already) {
          navigate(targetPath);
          return;
        }
      } catch {
        // En cas d'erreur reseau, on retombe sur la modale (fail-closed cote acces).
      }

      setProjectUnlockError(null);
      setProjectUnlockNoTokens(false);
      setProjectUnlock({
        path: targetPath,
        space: "promoteur",
        projectKey: parcel.key,
        label: parcel.label,
      });
      return;
    }

    // ── Defaut : navigation libre ─────────────────────────────────────────────
    navigate(targetPath);
  }

  async function confirmUnlock() {
    if (!pendingUnlock) return;
    try {
      setUnlockLoading(true);
      setUnlockError(null);
      setUnlockNoTokens(false);
      const result = await unlockDealIfNeeded(pendingUnlock.dealId);
      if (!result.ok) {
        if (result.reason === "NO_TOKENS") { setUnlockNoTokens(true); return; }
        setUnlockError(result.message);
        return;
      }
      const nextPath = pendingUnlock.path;
      closeUnlockModal();
      navigate(nextPath);
    } catch (error) {
      console.error("Erreur deverrouillage deal:", error);
      setUnlockError("Impossible de deverrouiller ce projet pour le moment.");
    } finally {
      setUnlockLoading(false);
    }
  }

  function openBilling()       { closeUnlockModal(); navigate("/compte"); }
  function openSubscriptions() { closeUnlockModal(); navigate("/compte?section=abonnements"); }
  function openTokens()        { closeUnlockModal(); navigate("/compte?section=jetons"); }

  // ── Handlers paywall projet generique ───────────────────────────────────────
  function closeProjectUnlock() {
    setProjectUnlock(null);
    setProjectUnlockLoading(false);
    setProjectUnlockNoTokens(false);
    setProjectUnlockError(null);
  }

  async function confirmProjectUnlock() {
    if (!projectUnlock) return;
    try {
      setProjectUnlockLoading(true);
      setProjectUnlockError(null);
      setProjectUnlockNoTokens(false);
      const cfg = getSpacePaywallConfig(projectUnlock.space);
      const result = await unlockProject(
        projectUnlock.space,
        projectUnlock.projectKey,
        projectUnlock.label,
        cfg.validityDays
      );
      if (!result.ok) {
        if (result.reason === "NO_TOKENS") { setProjectUnlockNoTokens(true); return; }
        setProjectUnlockError(result.message);
        return;
      }
      const nextPath = projectUnlock.path;
      closeProjectUnlock();
      navigate(nextPath);
    } catch (error) {
      console.error("Erreur deverrouillage projet:", error);
      setProjectUnlockError("Impossible de deverrouiller ce projet pour le moment.");
    } finally {
      setProjectUnlockLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 backdrop-blur-md supports-[backdrop-filter]:bg-white/80 md:hidden">
        <div className="flex h-14 items-center justify-between px-4">
          <NavLink to="/" onClick={() => onChangeSpace("none")} className="flex items-center">
            <MimmozaLogo className="h-8 w-auto object-contain" />
          </NavLink>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <button
                type="button"
                onClick={() => navigate("/admin")}
                className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white p-2 text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50"
                title="Admin"
              >
                <LayoutDashboard className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setMobileNavOpen((o) => !o)}
              className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white p-2 text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50"
            >
              {mobileNavOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </header>

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
  {isPublicPage
    ? children
    : <div className="mx-auto max-w-7xl px-4 lg:px-6">{children}</div>
  }
</main>

      <footer className="border-t border-slate-200/80 bg-white py-4 px-4">
  <div className="mx-auto max-w-7xl">
    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">

      <div className="flex items-center gap-2">
        <MimmozaLogo className="h-5 w-auto object-contain" />
        <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
        <span className="text-[10px] text-slate-400">
          Intelligence immobilière
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
        <NavLink
          to="/mentions-legales"
          className="hover:text-slate-900 transition-colors"
        >
          Mentions légales
        </NavLink>

        <NavLink
          to="/cgu"
          className="hover:text-slate-900 transition-colors"
        >
          CGU
        </NavLink>

        <NavLink
          to="/cgv"
          className="hover:text-slate-900 transition-colors"
        >
          CGV
        </NavLink>

        <NavLink
          to="/politique-confidentialite"
          className="hover:text-slate-900 transition-colors"
        >
          Politique de confidentialité
        </NavLink>
      </div>
    </div>
  </div>
</footer>

      <DealUnlockModal
        open={Boolean(pendingUnlock)}
        dealLabel={pendingUnlock ? pendingUnlock.dealLabel : "Projet"}
        loading={unlockLoading}
        noTokens={unlockNoTokens}
        errorMessage={unlockError}
        onClose={closeUnlockModal}
        onConfirmUnlock={confirmUnlock}
        onOpenBilling={openBilling}
        onOpenSubscriptions={openSubscriptions}
        onOpenTokens={openTokens}
      />

      <ProjectUnlockModal
        open={Boolean(projectUnlock)}
        projectLabel={projectUnlock ? projectUnlock.label : "Projet"}
        features={projectUnlock ? getSpacePaywallConfig(projectUnlock.space).features : undefined}
        loading={projectUnlockLoading}
        noTokens={projectUnlockNoTokens}
        errorMessage={projectUnlockError}
        onClose={closeProjectUnlock}
        onConfirmUnlock={confirmProjectUnlock}
        onOpenBilling={() => { closeProjectUnlock(); navigate("/compte"); }}
        onOpenSubscriptions={() => { closeProjectUnlock(); navigate("/compte?section=abonnements"); }}
        onOpenTokens={() => { closeProjectUnlock(); navigate("/compte?section=jetons"); }}
      />
    </div>
  );
}