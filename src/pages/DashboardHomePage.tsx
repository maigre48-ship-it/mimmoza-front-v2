// src/pages/DashboardHomePage.tsx
// Tableau de bord utilisateur connecté (/dashboard)
// v7 — Refonte UI « cockpit » : hero "Reprendre le dernier projet", cartes
//      métiers compactes, timeline d'activité, hiérarchie visuelle et halos.
//      Aucune logique, requête ou route modifiée par rapport à la v6.
//
//      Projets  : promoteur_studies
//      Jetons   : credit_accounts.current_credits
//      Activité : credit_transactions
//      Veille   : opportunity_watches (via listWatches)
//
// Les mappings de colonnes sont défensifs (pick + fallbacks) : si un champ
// n'existe pas côté base, la ligne dégrade proprement au lieu de crasher.

import {
  Activity,
  ArrowRight,
  Bell,
  Building2,
  Eye,
  FileText,
  Hammer,
  Handshake,
  Landmark,
  Loader2,
  Plus,
  ScanSearch,
  Sparkles,
  TrendingUp,
  Zap,
} from "lucide-react";
import type { ComponentType } from "react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { listWatches } from "@/services/opportunity/opportunityWatch.service";
import { userStorage } from "@/lib/storage/userScopedStorage";
import { ACTION_COSTS } from "@/lib/billing/actionCosts";

/* ─────────────── Helpers de lecture tolérante ─────────────── */

type Row = Record<string, unknown>;

function str(row: Row, keys: string[], fallback = ""): string {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) return v;
    if (typeof v === "number") return String(v);
  }
  return fallback;
}

function num(row: Row, keys: string[]): number | null {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  }
  return null;
}

/** Lit une valeur numérique dans un objet imbriqué (ex: foncier.surface_m2). */
function nestedNum(row: Row, parent: string, keys: string[]): number | null {
  const child = row[parent];
  if (child && typeof child === "object") return num(child as Row, keys);
  return null;
}

function relativeDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return "À l'instant";
  if (h < 24) return `Il y a ${h} h`;
  const j = Math.floor(h / 24);
  if (j === 1) return "Hier";
  if (j < 30) return `Il y a ${j} j`;
  return d.toLocaleDateString("fr-FR");
}

function formatSurface(v: number | null): string {
  return v == null ? "—" : `${Math.round(v).toLocaleString("fr-FR")} m²`;
}

/* ─────────────── Cartes métiers ─────────────── */

type VerticalCard = {
  id: "promoteur" | "investisseur" | "apporteur" | "rehabilitation";
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  iconBg: string;
  iconColor: string;
  linkColor: string;
  route: string;
};

const VERTICALS: VerticalCard[] = [
  {
    id: "investisseur",
    title: "Investissement",
    description: "Rentabilité, risques et valeur d'une acquisition.",
    icon: Landmark,
    iconBg: "bg-blue-50",
    iconColor: "text-blue-600",
    linkColor: "text-blue-600 group-hover:text-blue-700",
    route: "/marchand-de-bien",
  },
  {
    id: "promoteur",
    title: "Promotion",
    description: "Faisabilité foncière, PLU, massing 3D et bilan.",
    icon: Building2,
    iconBg: "bg-violet-50",
    iconColor: "text-violet-600",
    linkColor: "text-violet-600 group-hover:text-violet-700",
    route: "/promoteur",
  },
  {
    id: "rehabilitation",
    title: "Réhabilitation",
    description: "Travaux, conformité et valeur après rénovation.",
    icon: Hammer,
    iconBg: "bg-amber-50",
    iconColor: "text-amber-600",
    linkColor: "text-amber-600 group-hover:text-amber-700",
    route: "/rehabilitation",
  },
  {
    id: "apporteur",
    title: "Apport d'affaires",
    description: "Qualifiez une opportunité et transmettez-la.",
    icon: Handshake,
    iconBg: "bg-emerald-50",
    iconColor: "text-emerald-600",
    linkColor: "text-emerald-600 group-hover:text-emerald-700",
    route: "/apporteur",
  },
];

/* ─────────────── Types vue ─────────────── */

type Project = {
  id: string;
  name: string;
  type: string;
  surface: string;
  status: string;
  updatedAt: string;
};

type ActivityItem = {
  id: string;
  icon: ComponentType<{ className?: string }>;
  title: string;
  date: string;
};

type AlertItem = { id: string; label: string; date: string };

type Tokens = { used: number; total: number | null };

const STATUS_STYLES: Record<string, string> = {
  "en cours": "bg-violet-50 text-violet-700 border-violet-200",
  active: "bg-violet-50 text-violet-700 border-violet-200",
  terminé: "bg-emerald-50 text-emerald-700 border-emerald-200",
  completed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  archived: "bg-slate-100 text-slate-600 border-slate-200",
  brouillon: "bg-slate-100 text-slate-600 border-slate-200",
  draft: "bg-slate-100 text-slate-600 border-slate-200",
};

function statusClass(status: string): string {
  return STATUS_STYLES[status.toLowerCase()] ?? "bg-slate-100 text-slate-600 border-slate-200";
}

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  archived: "Archivée",
  draft: "Brouillon",
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status.toLowerCase()] ?? status;
}

/** Choisit une icône d'activité à partir du libellé de l'action. */
function activityIcon(action: string): ComponentType<{ className?: string }> {
  const a = action.toLowerCase();
  if (a.includes("refund") || a.includes("rembours")) return TrendingUp;
  if (a.includes("unlock") || a.includes("apporteur")) return Handshake;
  if (a.includes("copilot")) return Sparkles;
  if (a.includes("analyse")) return ScanSearch;
  if (a.includes("facade") || a.includes("façade") || a.includes("rendu")) return Sparkles;
  if (a.includes("export") || a.includes("bilan") || a.includes("pdf")) return FileText;
  if (a.includes("score") || a.includes("veille") || a.includes("scan")) return TrendingUp;
  return Zap;
}

/* ─────────────── Composant ─────────────── */

export default function DashboardHomePage() {
  const navigate = useNavigate();

  const [firstName, setFirstName] = useState<string>("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [tokens, setTokens] = useState<Tokens | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user) {
        if (!cancelled) setLoading(false);
        return;
      }

      // Prénom : metadata > profiles > email
      const meta = (user.user_metadata ?? {}) as Row;
      let name = str(meta, ["first_name", "prenom", "full_name", "name"]);
      if (!name) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", user.id)
          .maybeSingle();
        if (profile) name = str(profile as Row, ["first_name", "prenom", "full_name", "nom"]);
      }
      if (!name && user.email) name = user.email.split("@")[0];
      if (!cancelled) setFirstName(name.split(" ")[0]);

      // ── Projets récents ──
      const { data: studies } = await supabase
        .from("promoteur_studies")
        .select("*")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(3);

      if (!cancelled && studies) {
        setProjects(
          (studies as Row[]).map((row, i) => ({
            id: str(row, ["id"], `study-${i}`),
            name: str(row, ["address", "adresse", "label", "name", "title"], "Projet sans adresse"),
            type: str(row, ["vertical", "type", "space"], "Promotion"),
            surface: formatSurface(
              num(row, ["surface", "surface_terrain", "area", "surface_m2"]) ??
                nestedNum(row, "foncier", ["surface_m2", "surface"]),
            ),
            status: str(row, ["status", "statut", "state"], "En cours"),
            updatedAt: relativeDate(str(row, ["updated_at", "created_at"]) || null),
          }))
        );
      }

      // ── Solde de jetons ──
      const { data: account } = await supabase
        .from("credit_accounts")
        .select("current_credits")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!cancelled && account) {
        setTokens({ used: (account as Row).current_credits as number, total: null });
      }

      // ── Activité récente (mouvements de jetons) ──
      const { data: tx } = await supabase
        .from("credit_transactions")
        .select("id, type, amount, description, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(4);

      if (!cancelled && tx) {
        setActivity(
          (tx as Row[]).map((row, i) => {
            const label = str(row, ["description"]) || str(row, ["type"], "Opération");
            const amount = num(row, ["amount"]);
            return {
              id: str(row, ["id"], `tx-${i}`),
              icon: activityIcon(`${str(row, ["type"])} ${label}`),
              title: amount != null ? `${label} (${amount > 0 ? "+" : ""}${amount} j)` : label,
              date: relativeDate(str(row, ["created_at"]) || null),
            };
          }),
        );
      }

      // ── Veille de marché ──
      try {
        const watches = await listWatches();
        if (!cancelled) {
          setAlerts(
            watches.slice(0, 4).map((w, i) => {
              const row = w as unknown as Row;
              const label = str(row, ["label", "name", "title"], "Veille sans nom");
              const city = str(row, ["city", "commune"]);
              const zip = str(row, ["zip_code", "zipCode", "postal_code"]);
              const place = [city, zip].filter(Boolean).join(" ");
              return {
                id: str(row, ["id"], `watch-${i}`),
                label: place ? `${label} — ${place}` : label,
                date: row.active === false ? "En pause" : "Active",
              };
            }),
          );
        }
      } catch (e) {
        console.warn("[Dashboard] veilles indisponibles :", e);
      }

      if (!cancelled) setLoading(false);
    }

    load().catch((e) => {
      console.warn("[Dashboard] chargement partiel :", e);
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  function enterVertical(vertical: VerticalCard) {
    try {
      userStorage.setItem("mimmoza.activeVertical", vertical.id);
    } catch {
      // noop
    }
    navigate(vertical.route);
  }

  const tokenPct =
    tokens && tokens.total ? Math.min(100, Math.round((tokens.used / tokens.total) * 100)) : 0;

  const lastProject = projects[0] ?? null;
  const activeWatches = alerts.filter((a) => a.date === "Active").length;

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#f7f8fc]">
      {/* Halos d'ambiance très discrets */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -left-32 h-[420px] w-[420px] rounded-full bg-violet-300/20 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 right-0 h-[380px] w-[380px] rounded-full bg-blue-300/15 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-[55%] left-1/3 h-[360px] w-[360px] rounded-full bg-slate-400/10 blur-3xl"
      />

      <div className="relative mx-auto max-w-7xl px-6 py-10 lg:py-12">
        {/* ───────────── HEADER ───────────── */}
        <header className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em] text-slate-900">
              Bonjour{firstName ? ` ${firstName}` : ""}
            </h1>
            <p className="mt-1.5 text-sm text-slate-500">Voici l'état de vos opérations aujourd'hui.</p>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-200/70 bg-violet-50/70 px-3 py-1 text-xs font-medium text-violet-700">
                <Building2 className="h-3.5 w-3.5" />
                {projects.length} projet{projects.length > 1 ? "s" : ""} actif
                {projects.length > 1 ? "s" : ""}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200/70 bg-blue-50/70 px-3 py-1 text-xs font-medium text-blue-700">
                <Eye className="h-3.5 w-3.5" />
                {activeWatches} veille{activeWatches > 1 ? "s" : ""} en cours
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/70 px-3 py-1 text-xs font-medium text-slate-700">
                <Zap className="h-3.5 w-3.5 text-violet-500" />
                {tokens ? tokens.used.toLocaleString("fr-FR") : "—"} jetons disponibles
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => navigate("/analyse-rapide")}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800"
          >
            <Plus className="h-4 w-4" />
            Analyse rapide
          </button>
        </header>

        {/* ───────────── HERO : DERNIER PROJET ───────────── */}
        <section className="mt-8">
          <div className="group relative overflow-hidden rounded-[28px] border border-slate-200/80 bg-white p-2 shadow-[0_18px_50px_-24px_rgba(15,23,42,0.35)] ring-1 ring-slate-900/[0.02]">
            <div
              aria-hidden
              className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-violet-500/[0.07] blur-2xl"
            />

            {loading ? (
              <div className="flex items-center justify-center py-16 text-slate-400">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : !lastProject ? (
              <div className="relative flex flex-col items-start gap-4 px-6 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                    Premier pas
                  </p>
                  <h2 className="mt-2 text-xl font-semibold tracking-[-0.01em] text-slate-900">
                    Créez votre première opération
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Analysez une parcelle et Mimmoza construit le dossier autour.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => navigate("/promoteur/nouvelle-opportunite")}
                  className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-violet-700"
                >
                  <Plus className="h-4 w-4" />
                  Créer un projet
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => navigate("/promoteur")}
                className="relative flex w-full flex-col items-stretch gap-6 rounded-[22px] p-5 text-left transition-colors hover:bg-slate-50/60 sm:flex-row sm:items-center sm:gap-8 sm:p-6"
              >
                {/* Miniature */}
                <div className="relative flex h-28 w-full shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-violet-500/20 via-indigo-500/10 to-slate-100 sm:h-28 sm:w-44">
                  <div
                    aria-hidden
                    className="absolute inset-0 opacity-[0.35] [background-image:linear-gradient(to_right,rgba(100,116,139,.25)_1px,transparent_1px),linear-gradient(to_bottom,rgba(100,116,139,.25)_1px,transparent_1px)] [background-size:16px_16px]"
                  />
                  <Building2 className="relative h-9 w-9 text-violet-600/70" />
                </div>

                {/* Contenu */}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-violet-600">
                    Reprendre votre dernier projet
                  </p>
                  <h2 className="mt-2 truncate text-2xl font-semibold tracking-[-0.015em] text-slate-900">
                    {lastProject.name}
                  </h2>
                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-slate-500">
                    <span className="font-medium text-slate-600">{lastProject.type}</span>
                    <span className="text-slate-300">·</span>
                    <span>{lastProject.surface}</span>
                    <span className="text-slate-300">·</span>
                    <span
                      className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${statusClass(lastProject.status)}`}
                    >
                      {statusLabel(lastProject.status)}
                    </span>
                    {lastProject.updatedAt ? (
                      <>
                        <span className="text-slate-300">·</span>
                        <span>Modifié {lastProject.updatedAt.toLowerCase()}</span>
                      </>
                    ) : null}
                  </div>
                </div>

                {/* Action */}
                <span className="inline-flex shrink-0 items-center gap-2 self-start rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition-transform group-hover:translate-x-0.5 sm:self-auto">
                  Continuer
                  <ArrowRight className="h-4 w-4" />
                </span>
              </button>
            )}
          </div>
        </section>

        {/* ───────────── CARTES MÉTIERS ───────────── */}
        <section className="mt-10">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
            Espaces de travail
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {VERTICALS.map((vertical) => {
              const Icon = vertical.icon;
              return (
                <button
                  key={vertical.id}
                  type="button"
                  onClick={() => enterVertical(vertical)}
                  className="group flex flex-col rounded-2xl border border-slate-200/80 bg-white/80 px-5 py-4 text-left shadow-[0_2px_10px_-6px_rgba(15,23,42,0.2)] backdrop-blur transition-all hover:border-slate-300 hover:bg-white hover:shadow-md"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${vertical.iconBg}`}
                    >
                      <Icon className={`h-6 w-6 ${vertical.iconColor}`} />
                    </div>
                    <h3 className="text-[15px] font-semibold text-slate-900">{vertical.title}</h3>
                  </div>
                  <p className="mt-3 text-[13px] leading-5 text-slate-500">{vertical.description}</p>
                  <span
                    className={`mt-3 inline-flex items-center gap-1 text-[13px] font-semibold ${vertical.linkColor}`}
                  >
                    Entrer
                    <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* ───────────── PROJETS + ACTIVITÉ ───────────── */}
        <section className="mt-10 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          {/* Projets récents — 3ᵉ niveau, ombre plus marquée */}
          <div className="rounded-2xl border border-slate-200/80 bg-white shadow-[0_12px_32px_-20px_rgba(15,23,42,0.35)]">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h2 className="text-sm font-semibold text-slate-900">Vos projets récents</h2>
              <button
                type="button"
                onClick={() => navigate("/promoteur")}
                className="inline-flex items-center gap-1 text-xs font-semibold text-violet-600 hover:text-violet-700"
              >
                Tout voir
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-12 text-slate-400">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : projects.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <p className="text-sm text-slate-500">Aucun projet pour le moment.</p>
                <button
                  type="button"
                  onClick={() => navigate("/promoteur/nouvelle-opportunite")}
                  className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-violet-600 hover:text-violet-700"
                >
                  <Plus className="h-4 w-4" />
                  Créer un projet
                </button>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100 py-1">
                {projects.map((project) => (
                  <li key={project.id}>
                    <button
                      type="button"
                      onClick={() => navigate("/promoteur")}
                      className="group flex w-full items-center gap-4 px-6 py-3 text-left transition-colors hover:bg-slate-50"
                    >
                      <div className="relative flex h-10 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-gradient-to-br from-violet-500/15 to-slate-100">
                        <div
                          aria-hidden
                          className="absolute inset-0 opacity-30 [background-image:linear-gradient(to_right,rgba(100,116,139,.25)_1px,transparent_1px),linear-gradient(to_bottom,rgba(100,116,139,.25)_1px,transparent_1px)] [background-size:10px_10px]"
                        />
                        <Building2 className="relative h-4 w-4 text-slate-500" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900">{project.name}</p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {project.type} · {project.surface}
                          {project.updatedAt ? ` · ${project.updatedAt}` : ""}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusClass(project.status)}`}
                      >
                        {statusLabel(project.status)}
                      </span>
                      <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-400" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Activité récente — carte légère, timeline */}
          <div className="rounded-2xl border border-slate-200/70 bg-white/70 shadow-sm backdrop-blur">
            <div className="flex items-center gap-2 border-b border-slate-100 px-6 py-4">
              <Activity className="h-4 w-4 text-slate-400" />
              <h2 className="text-sm font-semibold text-slate-900">Activité récente</h2>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-12 text-slate-400">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : activity.length === 0 ? (
              <p className="px-6 py-12 text-center text-sm text-slate-500">Aucune activité récente.</p>
            ) : (
              <ol className="relative px-6 py-5">
                <div
                  aria-hidden
                  className="absolute bottom-8 left-[31px] top-8 w-px bg-slate-200"
                />
                {activity.map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.id} className="relative flex gap-4 pb-5 last:pb-0">
                      <div className="relative z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white">
                        <Icon className="h-3 w-3 text-slate-500" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-800">{item.title}</p>
                        <p className="mt-0.5 text-xs text-slate-400">{item.date}</p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </section>

        {/* ───────────── VEILLE + JETONS ───────────── */}
        <section className="mt-8 grid gap-6 lg:grid-cols-2">
          {/* Veille de marché — fond bleu très clair */}
          <div className="rounded-2xl border border-blue-100 bg-blue-50/40 shadow-sm">
            <div className="flex items-center justify-between border-b border-blue-100/70 px-6 py-4">
              <div className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-blue-500" />
                <h2 className="text-sm font-semibold text-slate-900">Veille de marché</h2>
              </div>
              <button
                type="button"
                onClick={() => navigate("/opportunites")}
                className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700"
              >
                Tout voir
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-12 text-slate-400">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : alerts.length === 0 ? (
              <p className="px-6 py-12 text-center text-sm text-slate-500">Aucune veille active.</p>
            ) : (
              <ul className="divide-y divide-blue-100/70">
                {alerts.map((alert) => (
                  <li key={alert.id} className="flex items-center gap-3 px-6 py-3.5">
                    <Eye className="h-4 w-4 shrink-0 text-blue-500" />
                    <p className="min-w-0 flex-1 truncate text-sm text-slate-700">{alert.label}</p>
                    <span
                      className={`shrink-0 text-xs font-medium ${
                        alert.date === "Active" ? "text-emerald-600" : "text-slate-400"
                      }`}
                    >
                      {alert.date}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Solde de jetons — fond violet très clair */}
          <div className="rounded-2xl border border-violet-100 bg-violet-50/50 shadow-sm">
            <div className="flex items-center gap-2 border-b border-violet-100/70 px-6 py-4">
              <Zap className="h-4 w-4 text-violet-500" />
              <h2 className="text-sm font-semibold text-slate-900">Solde de jetons</h2>
            </div>
            <div className="px-6 py-6">
              {loading || !tokens ? (
                <div className="flex items-center justify-center py-6 text-slate-400">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : (
                <>
                  <div className="flex items-end gap-1.5">
                    <span className="text-4xl font-semibold tracking-[-0.02em] text-slate-900">
                      {tokens.used.toLocaleString("fr-FR")}
                    </span>
                    <span className="mb-1.5 text-sm font-medium text-slate-400">
                      {tokens.total ? `/ ${tokens.total.toLocaleString("fr-FR")} jetons` : "jetons disponibles"}
                    </span>
                  </div>
                  {tokens.total ? (
                    <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-white">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-500"
                        style={{ width: `${tokenPct}%` }}
                      />
                    </div>
                  ) : null}
                </>
              )}

              <div className="mt-6 flex items-center justify-between text-xs text-slate-500">
                <span>
                  Analyse rapide :{" "}
                  <span className="font-semibold text-slate-700">
                    {ACTION_COSTS.analyse_rapide} jetons
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => navigate("/jetons")}
                  className="inline-flex items-center gap-1 font-semibold text-violet-600 hover:text-violet-700"
                >
                  Gérer
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}