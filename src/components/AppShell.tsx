// src/components/AppShell.tsx

import { useState, useMemo, useEffect } from "react";
import type { ReactNode, ComponentType } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Menu, X, Home, FileText, Building2, ShieldCheck, PieChart, BarChart3, Map, Layers,
  TrendingUp, AlertTriangle, Grid3X3, Cuboid, Calculator, ChevronRight, Sparkles,
  Search, ClipboardList, Building, UserCircle2, LayoutDashboard, Eye, Code2, Wand2,
  FileSearch, Users,
} from "lucide-react";

import { preserveStudyInPath, extractStudyId } from "../utils/preserveStudyParam";
import { readBanqueSnapshot, selectActiveDossierId } from "../spaces/banque/store/banqueSnapshot.store";
import { preserveDossierInPath } from "../spaces/banque/utils/banqueDossierUrl";
import { getCurrentAdminStatus } from "../lib/admin";
import { supabase } from "../lib/supabase";
import { unlockDealIfNeeded } from "../spaces/marchand/services/dealUnlock";
import { ensureActiveDeal, type MarchandDeal } from "../spaces/marchand/shared/marchandSnapshot.store";
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

const AUTH_STORAGE_KEY = "mimmoza.auth.v1";

function MimmozaLogo(props: { variant?: "dark" | "white"; iconOnly?: boolean; width?: number }) {
  const variant = props.variant ?? "dark";
  const iconOnly = props.iconOnly ?? false;
  const width = props.width;

  const w = variant === "white";
  const uid = w ? "w" : "d";
  const topA = w ? "#c4b5fd" : "#7c3aed";
  const topB = w ? "#a78bfa" : "#6d28d9";
  const lefA = w ? "#818cf8" : "#4f46e5";
  const lefB = w ? "#6366f1" : "#3730a3";
  const rigA = w ? "#67e8f9" : "#38bdf8";
  const rigB = w ? "#38bdf8" : "#0ea5e9";
  const wColor = w ? "#ffffff" : "#0f172a";
  const tColor = w ? "rgba(255,255,255,0.6)" : "#6d28d9";

  if (iconOnly) {
    const pw = width ?? 32;
    const ph = Math.round((pw * 48) / 42);
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 42 48" width={pw} height={ph} role="img" aria-label="Mimmoza">
        <defs>
          <linearGradient id={"iT-" + uid} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={topA} />
            <stop offset="100%" stopColor={topB} />
          </linearGradient>
          <linearGradient id={"iL-" + uid} x1="100%" y1="0%" x2="0%" y2="0%">
            <stop offset="0%" stopColor={lefA} />
            <stop offset="100%" stopColor={lefB} />
          </linearGradient>
          <linearGradient id={"iR-" + uid} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={rigA} />
            <stop offset="100%" stopColor={rigB} />
          </linearGradient>
        </defs>
        <polygon points="21,2 39,12 21,22 3,12" fill={"url(#iT-" + uid + ")"} />
        <polygon points="3,12 21,22 21,46 3,36" fill={"url(#iL-" + uid + ")"} />
        <polygon points="39,12 21,22 21,46 39,36" fill={"url(#iR-" + uid + ")"} />
      </svg>
    );
  }

  const pw = width ?? 180;
  const ph = Math.round((pw * 60) / 240);
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 60" width={pw} height={ph} role="img" aria-label="Mimmoza">
      <defs>
        <linearGradient id={"T-" + uid} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={topA} />
          <stop offset="100%" stopColor={topB} />
        </linearGradient>
        <linearGradient id={"L-" + uid} x1="100%" y1="0%" x2="0%" y2="0%">
          <stop offset="0%" stopColor={lefA} />
          <stop offset="100%" stopColor={lefB} />
        </linearGradient>
        <linearGradient id={"R-" + uid} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={rigA} />
          <stop offset="100%" stopColor={rigB} />
        </linearGradient>
      </defs>
      <polygon points="28,5 46,15 28,25 10,15" fill={"url(#T-" + uid + ")"} />
      <polygon points="10,15 28,25 28,47 10,37" fill={"url(#L-" + uid + ")"} />
      <polygon points="46,15 28,25 28,47 46,37" fill={"url(#R-" + uid + ")"} />
      <text x="60" y="26" fontFamily="-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif" fontWeight="700" fontSize="22" fill={wColor} letterSpacing="-0.7">Mimmoza</text>
      <text x="61" y="42" fontFamily="-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif" fontWeight="400" fontSize="10.5" fill={tColor} letterSpacing="1.3">Intelligence immobiliere</text>
    </svg>
  );
}

function getSpaceGradient(space: Space): string {
  if (space === "marchand") return "linear-gradient(90deg, #2196f3 0%, #21cbf3 100%)";
  if (space === "promoteur") return "linear-gradient(90deg, #7c6fcd 0%, #b39ddb 100%)";
  if (space === "banque") return "linear-gradient(90deg, #26a69a 0%, #80cbc4 100%)";
  return "linear-gradient(90deg, #2196f3 0%, #21cbf3 100%)";
}

function getSpaceAccentColor(space: Space): string {
  if (space === "marchand") return "#1a72c4";
  if (space === "promoteur") return "#5247b8";
  if (space === "banque") return "#1a7a50";
  return "#1a72c4";
}

function buildInitials(fullName: string | undefined, email: string | undefined): string {
  const trimmed = (fullName ?? "").trim();
  if (trimmed) {
    const parts = trimmed.split(/\s+/).filter(Boolean);
    const first = parts[0] ? parts[0][0] : "";
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

function isMarchandPremiumPath(path: string): boolean {
  if (path.indexOf("/marchand-de-bien/sourcing") >= 0) return true;
  if (path.indexOf("/marchand-de-bien/execution") >= 0) return true;
  if (path.indexOf("/marchand-de-bien/planning") >= 0) return true;
  if (path.indexOf("/marchand-de-bien/analyse") >= 0) return true;
  return false;
}

function getDealLabel(deal: MarchandDeal): string {
  const t = deal.title ? deal.title.trim() : "";
  if (t) return t;
  const a = deal.address ? deal.address.trim() : "";
  if (a) return a;
  const zc = [deal.zipCode, deal.city].filter(Boolean).join(" ").trim();
  if (zc) return zc;
  return deal.id;
}

function buildNavItemPath(resolvedBase: string, tabParam: string | undefined): string {
  if (tabParam === undefined) return resolvedBase;
  const idx = resolvedBase.indexOf("?");
  const pathPart = idx >= 0 ? resolvedBase.slice(0, idx) : resolvedBase;
  const existingSearch = idx >= 0 ? resolvedBase.slice(idx + 1) : "";
  const sp = new URLSearchParams(existingSearch);
  sp.set("tab", tabParam);
  return pathPart + "?" + sp.toString();
}

function getPromoteurActiveSection(pathname: string): string | null {
  if (pathname === "/promoteur") return "demarrer";
  const prefixMap: Array<[string, string]> = [
    ["/promoteur/foncier", "foncier"],
    ["/promoteur/plu-faisabilite", "foncier"],
    ["/promoteur/faisabilite", "foncier"],
    ["/promoteur/implantation-2d", "conception"],
    ["/promoteur/plan-2d", "conception"],
    ["/promoteur/massing-3d", "conception"],
    ["/promoteur/generateur-facades", "conception"],
    ["/promoteur/rendu-travaux", "conception"],
    ["/promoteur/estimation", "evaluation"],
    ["/promoteur/marche", "etudes"],
    ["/promoteur/risques", "etudes"],
    ["/promoteur/permis-construire", "etudes"],
    ["/promoteur/recherche-contacts", "etudes"],
    ["/promoteur/bilan-promoteur", "bilan"],
    ["/promoteur/bilan", "bilan"],
    // ── MODIFIÉ : Synthèse est maintenant sa propre section ──
    ["/promoteur/synthese", "synthese"],
    ["/promoteur/exports", "bilan"],
  ];
  for (let i = 0; i < prefixMap.length; i++) {
    const prefix = prefixMap[i][0];
    const sectionId = prefixMap[i][1];
    if (pathname === prefix) return sectionId;
    if (pathname.startsWith(prefix + "/")) return sectionId;
  }
  return null;
}

const SPACES: Array<{
  id: Space;
  label: string;
  shortLabel: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  path: string;
}> = [
  { id: "marchand", label: "Espace Investisseur", shortLabel: "Investisseur", description: "Opportunites, scoring, rentabilite, execution et sortie", icon: PieChart, path: "/marchand-de-bien" },
  { id: "promoteur", label: "Espace Promoteur", shortLabel: "Promoteur", description: "Faisabilite, SDP potentielle et bilan promoteur", icon: Building2, path: "/promoteur" },
  { id: "banque", label: "Espace Financeur", shortLabel: "Financeur", description: "Analyse de risque, comite credit, tarification et suivi dossiers", icon: ShieldCheck, path: "/banque" },
];

const SPACE_NAVIGATION: Record<Space, NavSection[]> = {
  none: [],
  promoteur: [
    { id: "demarrer", label: "Demarrer", items: [{ label: "Tableau de bord", path: "/promoteur", icon: BarChart3, end: true }] },
    { id: "foncier", label: "Foncier", items: [{ label: "Foncier", path: "/promoteur/foncier", icon: Map }] },
    { id: "conception", label: "Conception", items: [
      { label: "Implantation 2D", path: "/promoteur/implantation-2d", icon: Grid3X3 },
      { label: "Massing 3D", path: "/promoteur/massing-3d", icon: Cuboid },
      { label: "Generateur de facades", path: "/promoteur/generateur-facades", icon: Wand2 },
      { label: "Rendu travaux", path: "/promoteur/rendu-travaux", icon: ClipboardList },
    ] },
    { id: "evaluation", label: "Evaluation", items: [{ label: "Evaluation", path: "/promoteur/estimation", icon: TrendingUp }] },
    { id: "etudes", label: "Etudes", items: [
      { label: "Marche", path: "/promoteur/marche", icon: Layers },
      { label: "Risques", path: "/promoteur/risques", icon: AlertTriangle },
      { label: "Permis de construire", path: "/promoteur/permis-construire", icon: FileSearch },
      { label: "Recherche contacts", path: "/promoteur/recherche-contacts", icon: Users, separatorBefore: true },
    ] },
    // ── MODIFIÉ : Bilan ne contient plus Synthèse ──
    { id: "bilan", label: "Bilan", items: [
      { label: "Bilan Promoteur", path: "/promoteur/bilan-promoteur", icon: Calculator },
    ] },
    // ── NOUVEAU : Synthèse est une section de premier niveau ──
    { id: "synthese", label: "Synthese", items: [
      { label: "Synthese", path: "/promoteur/synthese", icon: FileText },
    ] },
  ],
  agence: [
    { id: "gestion", label: "Compte", items: [{ label: "Compte", path: "/compte", icon: UserCircle2, end: true }] },
  ],
  marchand: [
    { id: "acquisition", label: "Acquisition", items: [
      { label: "Pipeline", path: "/marchand-de-bien", icon: BarChart3, end: true },
      { label: "SmartScore", path: "/marchand-de-bien/sourcing", icon: Search },
    ] },
    { id: "execution", label: "Execution", items: [
      { label: "Simulation", path: "/marchand-de-bien/execution/simulation", icon: Calculator },
      { label: "Travaux", path: "/marchand-de-bien/execution", icon: Building, end: true },
      { label: "Rendu travaux", path: "/marchand-de-bien/planning", icon: ClipboardList },
    ] },
    { id: "analyse", label: "Analyse", items: [
      { label: "Rentabilite", path: "/marchand-de-bien/analyse", icon: PieChart, end: true, tabParam: "rentabilite" },
      { label: "Due Diligence", path: "/marchand-de-bien/analyse", icon: FileText, tabParam: "due_diligence" },
      { label: "Marche / Risques", path: "/marchand-de-bien/analyse", icon: BarChart3, tabParam: "marche_risques" },
      { label: "Analyse predictive", path: "/marchand-de-bien/analyse", icon: TrendingUp, tabParam: "analyse_predictive" },
      { label: "Synthese IA", path: "/marchand-de-bien/analyse", icon: Sparkles, tabParam: "synthese_ia" },
    ] },
  ],
  banque: [],
};

function getBanqueActiveId(loc: { pathname: string; search: string }): string | null {
  const m = loc.pathname.match(/^\/banque\/(?:dossier|analyse|comite|outil-risques)\/([^/]+)/i);
  if (m && m[1]) return m[1];
  try {
    const sp = new URLSearchParams(loc.search);
    return sp.get("id") ?? sp.get("dossierId") ?? sp.get("dossier") ?? sp.get("d") ?? null;
  } catch {
    /* noop */
  }
  try {
    return selectActiveDossierId(readBanqueSnapshot()) ?? localStorage.getItem("mimmoza.banque.active_dossier_id");
  } catch {
    return null;
  }
}

function TopNavigation(props: {
  currentSpace: Space;
  onChangeSpace: (space: Space) => void;
  isAdmin: boolean;
  onProtectedNavigate: (targetPath: string) => Promise<void>;
}) {
  const currentSpace = props.currentSpace;
  const onChangeSpace = props.onChangeSpace;
  const isAdmin = props.isAdmin;
  const onProtectedNavigate = props.onProtectedNavigate;

  const location = useLocation();
  const navigate = useNavigate();
  const studyId = useMemo(() => extractStudyId(location.search), [location.search]);
  const account = useMemo(() => readStoredAccount(), [location.pathname, location.search]);

  function buildPath(targetPath: string): string {
    return preserveStudyInPath(targetPath, location.search);
  }

  function resolvePath(targetPath: string): string {
    if (currentSpace !== "banque") return buildPath(targetPath);
    const activeId = getBanqueActiveId(location);
    const needsId = new Set(["/banque/dossier", "/banque/analyse", "/banque/comite", "/banque/outil-risques"]);
    if (targetPath === "/banque") {
      if (activeId) return buildPath("/banque/dossier/" + activeId);
      return buildPath("/banque/dossiers");
    }
    if (needsId.has(targetPath)) {
      if (!activeId) return buildPath("/banque/dossiers");
      return buildPath(targetPath + "/" + activeId);
    }
    if (activeId) return preserveDossierInPath(buildPath(targetPath), activeId);
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
      const sp = new URLSearchParams(location.search);
      const currentTab = sp.get("tab") ?? "rentabilite";
      return currentTab === tabParam;
    }
    return true;
  }

  const currentSection = spaceSections.find((s) => s.id === activeSection);
  const activeItems = currentSection ? currentSection.items : [];

  function handleSpaceClickFactory(space: Space, path: string) {
    return function (e: React.MouseEvent<HTMLAnchorElement>) {
      e.preventDefault();
      onChangeSpace(space);
      navigate(path);
    };
  }

  function handleAccountClick() {
    if (account && account.isAuthenticated) {
      navigate("/compte");
    } else {
      navigate("/connexion");
    }
  }

  const currentSpaceMeta = SPACES.find((s) => s.id === currentSpace);
  const spaceGradient = getSpaceGradient(currentSpace);
  const spaceAccent = getSpaceAccentColor(currentSpace);

  const subTabBaseCls = "inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium whitespace-nowrap transition-all";
  const subTabActiveCls = "border border-slate-200 bg-white text-slate-950 shadow-sm";
  const subTabInactiveCls = "text-slate-500 hover:bg-white/70 hover:text-slate-700";

  return (
    <>
      <div className="border-b border-slate-200/70 bg-white/90 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-4 lg:px-6">
          <div className="flex h-16 items-center justify-between gap-4">
            <NavLink to="/" onClick={() => onChangeSpace("none")} className="flex shrink-0 items-center rounded-xl px-2 py-1.5 transition-colors hover:bg-slate-100/80">
              <MimmozaLogo variant="dark" width={160} />
            </NavLink>

            <div className="flex flex-1 items-center justify-center">
              <nav className="flex items-center gap-1.5 overflow-x-auto rounded-2xl border border-slate-200/80 bg-slate-50/80 p-1.5 scrollbar-hide">
                {SPACES.map(function (space) {
                  const Icon = space.icon;
                  const isActive = currentSpace === space.id;
                  const grad = getSpaceGradient(space.id);
                  const iconCls = "h-4 w-4 transition-colors " + (isActive ? "text-white" : "text-slate-400 group-hover:text-slate-700");
                  const anchorStyle = isActive ? { background: grad, color: "white" } : { color: "#64748b" };
                  return (
                    <a key={space.id} href={space.path} onClick={handleSpaceClickFactory(space.id, space.path)}
                      className="group relative flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-all"
                      style={anchorStyle}>
                      <Icon className={iconCls} />
                      <span>{space.shortLabel}</span>
                    </a>
                  );
                })}

                <div className="mx-1 h-5 w-px shrink-0 bg-slate-200/80" />

                <NavLink to="/veille" onClick={() => onChangeSpace("none")}
                  className="group relative flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-all"
                  style={function (navArgs) {
                    if (navArgs.isActive) return { background: "linear-gradient(90deg, #1e3a5f 0%, #1a3060 100%)", color: "white" };
                    return { color: "#64748b" };
                  }}>
                  {function (navArgs) {
                    const cls = "h-4 w-4 transition-colors " + (navArgs.isActive ? "text-white" : "text-slate-400 group-hover:text-slate-700");
                    return (<><Eye className={cls} /><span>Veille</span></>);
                  }}
                </NavLink>

                <NavLink to="/api" onClick={() => onChangeSpace("none")}
                  className="group relative flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-all"
                  style={function (navArgs) {
                    if (navArgs.isActive) return { background: "linear-gradient(90deg, #6366f1 0%, #8b5cf6 100%)", color: "white" };
                    return { color: "#64748b" };
                  }}>
                  {function (navArgs) {
                    const cls = "h-4 w-4 transition-colors " + (navArgs.isActive ? "text-white" : "text-slate-400 group-hover:text-slate-700");
                    return (<><Code2 className={cls} /><span>API</span></>);
                  }}
                </NavLink>
              </nav>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {isAdmin && (
                <button type="button" onClick={() => navigate("/admin")}
                  className="hidden md:inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-white px-3 py-2 text-sm font-medium text-slate-600 shadow-sm transition-all hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
                  title="Admin">
                  <LayoutDashboard className="h-4 w-4" />
                  <span>Admin</span>
                </button>
              )}
              <button type="button" onClick={handleAccountClick}
                className="flex shrink-0 items-center gap-2.5 rounded-full border border-slate-200/80 bg-white px-2.5 py-1.5 shadow-sm transition-all hover:border-slate-300 hover:shadow-md">
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
                    <div className="flex h-8 w-8 items-center justify-center rounded-xl shadow-sm" style={{ background: spaceGradient }}>
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
                    <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium" style={{ background: spaceAccent + "18", color: spaceAccent }} title={studyId}>
                      <Sparkles className="h-3 w-3" />
                      {studyId.length > 10 ? studyId.slice(0, 10) + "..." : studyId}
                    </span>
                  </>
                )}
              </div>
              <button type="button" onClick={() => { onChangeSpace("none"); navigate("/"); }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800">
                <Home className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Accueil</span>
              </button>
            </div>

            {spaceSections.length > 1 && (
              <div className="flex items-center gap-1 py-2 overflow-x-auto scrollbar-hide">
                {spaceSections.map(function (section) {
                  const active = section.id === activeSection;
                  const firstItem = section.items[0];
                  const firstPath = firstItem ? firstItem.path : "";
                  const firstTab = firstItem ? firstItem.tabParam : undefined;
                  const resolvedBase = resolvePath(firstPath);
                  const resolvedPath = buildNavItemPath(resolvedBase, firstTab);
                  const sectStyle = active ? { background: spaceGradient, color: "white" } : { color: "#64748b" };
                  return (
                    <a key={section.id} href={resolvedPath}
                      onClick={function (e) { e.preventDefault(); void onProtectedNavigate(resolvedPath); }}
                      className="relative rounded-xl px-4 py-2 text-sm font-medium whitespace-nowrap transition-all"
                      style={sectStyle}>
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
                    const Icon = item.icon;
                    const active = isActivePath(item.path, item.end, item.tabParam);
                    const resolvedBase = resolvePath(item.path);
                    const resolvedPath = buildNavItemPath(resolvedBase, item.tabParam);
                    const itemKey = item.path + "-" + (item.tabParam ? item.tabParam : "default") + "-" + idx;
                    const linkCls = subTabBaseCls + " " + (active ? subTabActiveCls : subTabInactiveCls);
                    const iconColor = active ? spaceAccent : "#94a3b8";
                    return (
                      <span key={itemKey} className="flex items-center gap-2">
                        {item.separatorBefore && (
                          <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 self-center bg-slate-300/80" />
                        )}
                        <a href={resolvedPath}
                          onClick={function (e) { e.preventDefault(); void onProtectedNavigate(resolvedPath); }}
                          className={linkCls}>
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

function MobileDrawer(props: {
  isOpen: boolean;
  onClose: () => void;
  currentSpace: Space;
  onChangeSpace: (space: Space) => void;
  isAdmin: boolean;
  onProtectedNavigate: (targetPath: string, closeAfter?: boolean) => Promise<void>;
}) {
  const isOpen = props.isOpen;
  const onClose = props.onClose;
  const currentSpace = props.currentSpace;
  const onChangeSpace = props.onChangeSpace;
  const isAdmin = props.isAdmin;
  const onProtectedNavigate = props.onProtectedNavigate;

  const location = useLocation();
  const navigate = useNavigate();
  const account = useMemo(() => readStoredAccount(), [location.pathname, location.search]);

  function buildPath(tp: string): string {
    return preserveStudyInPath(tp, location.search);
  }

  function resolvePath(tp: string): string {
    if (currentSpace !== "banque") return buildPath(tp);
    const activeId = getBanqueActiveId(location);
    const needsId = new Set(["/banque/dossier", "/banque/analyse", "/banque/comite", "/banque/outil-risques"]);
    if (tp === "/banque") {
      if (activeId) return buildPath("/banque/dossier/" + activeId);
      return buildPath("/banque/dossiers");
    }
    if (needsId.has(tp)) {
      if (!activeId) return buildPath("/banque/dossiers");
      return buildPath(tp + "/" + activeId);
    }
    if (activeId) return preserveDossierInPath(buildPath(tp), activeId);
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
      const sp = new URLSearchParams(location.search);
      const currentTab = sp.get("tab") ?? "rentabilite";
      return currentTab === tabParam;
    }
    return true;
  }

  const spaceSections = SPACE_NAVIGATION[currentSpace] || [];
  const allNavItems: NavItem[] = [];
  for (const s of spaceSections) {
    for (const it of s.items) {
      allNavItems.push(it);
    }
  }
  const spaceGradient = getSpaceGradient(currentSpace);
  const currentSpaceMeta = SPACES.find((s) => s.id === currentSpace);

  function handleSelectSpace(space: Space) {
    const meta = SPACES.find((s) => s.id === space);
    onChangeSpace(space);
    if (meta) navigate(meta.path);
    onClose();
  }

  function handleAccountClick() {
    if (account && account.isAuthenticated) navigate("/compte");
    else navigate("/connexion");
    onClose();
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex md:hidden">
      <div className="flex w-80 max-w-[85%] flex-col bg-white shadow-2xl animate-slide-in">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-4">
          <MimmozaLogo variant="dark" width={140} />
          <button type="button" onClick={onClose} className="rounded-lg p-2 transition-colors hover:bg-slate-100">
            <X className="h-4 w-4 text-slate-500" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          <button type="button" onClick={handleAccountClick} className="mb-3 flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-left transition-all hover:bg-slate-100">
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
            <button type="button" onClick={() => { navigate("/admin"); onClose(); }} className="mb-3 flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3 text-left transition-all hover:bg-slate-50">
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
                const Icon = item.icon;
                const isActive = isPathActive(item.path, item.end, item.tabParam);
                const itemKey = item.path + "-" + (item.tabParam ? item.tabParam : "default") + "-" + idx;
                const href = buildNavItemPath(resolvePath(item.path), item.tabParam);
                const iconCls = "h-4 w-4 " + (isActive ? "text-white" : "text-slate-400");
                const anchorStyle = isActive ? { background: spaceGradient, color: "white" } : { color: "#374151" };
                return (
                  <div key={itemKey}>
                    {item.separatorBefore && (
                      <div aria-hidden="true" className="mx-3 my-1 h-px bg-slate-200" />
                    )}
                    <a href={href}
                      onClick={function (e) { e.preventDefault(); void onProtectedNavigate(href, true); }}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 transition-all"
                      style={anchorStyle}>
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
              <button key={space.id} type="button" onClick={() => handleSelectSpace(space.id)} className="flex w-full flex-col rounded-xl px-3 py-2.5 text-left text-slate-700 transition-all hover:bg-slate-50">
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
            <NavLink to="/veille" onClick={onClose} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 transition-all"
              style={function (navArgs) {
                if (navArgs.isActive) return { background: "linear-gradient(90deg, #1e3a5f 0%, #1a3060 100%)", color: "white" };
                return { color: "#374151" };
              }}>
              {function (navArgs) {
                const cls = "h-4 w-4 " + (navArgs.isActive ? "text-white" : "text-blue-400");
                return (<><Eye className={cls} /><span className="text-sm font-medium">Veille marche</span></>);
              }}
            </NavLink>
            <NavLink to="/api" onClick={onClose} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 transition-all"
              style={function (navArgs) {
                if (navArgs.isActive) return { background: "linear-gradient(90deg, #6366f1 0%, #8b5cf6 100%)", color: "white" };
                return { color: "#374151" };
              }}>
              {function (navArgs) {
                const cls = "h-4 w-4 " + (navArgs.isActive ? "text-white" : "text-indigo-400");
                return (<><Code2 className={cls} /><span className="text-sm font-medium">API</span></>);
              }}
            </NavLink>
          </div>

          <div className="mt-4 border-t border-slate-100 pt-4">
            <NavLink to="/" onClick={() => { onChangeSpace("none"); onClose(); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-600 hover:bg-slate-50">
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

export function AppShell(props: AppShellProps) {
  const currentSpace = props.currentSpace;
  const onChangeSpace = props.onChangeSpace;
  const children = props.children;

  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [pendingUnlock, setPendingUnlock] = useState<PendingUnlockState | null>(null);
  const [unlockLoading, setUnlockLoading] = useState(false);
  const [unlockNoTokens, setUnlockNoTokens] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
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
    void refreshAdminStatus();
    const sub = supabase.auth.onAuthStateChange(function () { void refreshAdminStatus(); });
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
    setPendingUnlock({ path: targetPath, dealId: deal.id, dealLabel: getDealLabel(deal) });
  }

  async function confirmUnlock() {
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
      console.error("Erreur deverrouillage deal:", error);
      setUnlockError("Impossible de deverrouiller ce projet pour le moment.");
    } finally {
      setUnlockLoading(false);
    }
  }

  function openBilling() { closeUnlockModal(); navigate("/compte"); }
  function openSubscriptions() { closeUnlockModal(); navigate("/compte?section=abonnements"); }
  function openTokens() { closeUnlockModal(); navigate("/compte?section=jetons"); }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 backdrop-blur-md supports-[backdrop-filter]:bg-white/80 md:hidden">
        <div className="flex h-14 items-center justify-between px-4">
          <NavLink to="/" onClick={() => onChangeSpace("none")} className="flex items-center">
            <MimmozaLogo variant="dark" iconOnly width={28} />
            <span className="ml-2 text-sm font-semibold tracking-tight text-slate-900">Mimmoza</span>
          </NavLink>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <button type="button" onClick={() => navigate("/admin")} className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white p-2 text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50" title="Admin">
                <LayoutDashboard className="h-4 w-4" />
              </button>
            )}
            <button type="button" onClick={() => setMobileNavOpen((o) => !o)} className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white p-2 text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50">
              {mobileNavOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </header>

      <header className="sticky top-0 z-40 hidden md:block">
        <TopNavigation currentSpace={currentSpace} onChangeSpace={onChangeSpace} isAdmin={isAdmin} onProtectedNavigate={handleProtectedNavigate} />
      </header>

      <MobileDrawer isOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} currentSpace={currentSpace} onChangeSpace={onChangeSpace} isAdmin={isAdmin} onProtectedNavigate={handleProtectedNavigate} />

      <main className="flex-1 overflow-auto">
        {isPublicPage ? (children) : (<div className="mx-auto max-w-7xl px-4 py-6 lg:px-6">{children}</div>)}
      </main>

      <footer className="border-t border-slate-200/80 bg-white py-3 px-4">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-2">
            <MimmozaLogo variant="dark" iconOnly width={16} />
            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
            <span className="text-[10px] text-slate-400">Prototype local</span>
          </div>
          <span className="text-[10px] text-slate-400">Intelligence immobiliere</span>
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
    </div>
  );
}