// src/spaces/admin/pages/Dashboard.tsx
// ─── changelog ────────────────────────────────────────────────────────────────
// • Mode local : si Supabase échoue, affiche le dashboard avec métriques vides
//   (zéros) plutôt qu'un état bloquant.
// • Bannière d'info amber dismissible au lieu d'une erreur rouge bloquante.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BadgeEuro,
  Building2,
  ClipboardList,
  CreditCard,
  RefreshCw,
  Sparkles,
  Ticket,
  Users,
  WifiOff,
  X,
} from "lucide-react";
import {
  getAdminDashboardMetrics,
  type AdminDashboardMetrics,
} from "../services/adminDashboard";

type LoadState = "loading" | "ready" | "error";

// ── Métriques vides — affichées quand Supabase est inaccessible ──────────────
const EMPTY_METRICS: AdminDashboardMetrics = {
  activeUsers: 0,
  trialUsers: 0,
  suspendedUsers: 0,
  activeSubscriptions: 0,
  estimatedMrrEur: 0,
  openQuotes: 0,
  wonQuotes: 0,
  lostQuotes: 0,
  tokensConsumed: 0,
  lowStockAlerts: 0,
  companies: 0,
  estimatedAiCostEur: 0,
};

// ── Formatters ────────────────────────────────────────────────────────────────

function formatEur(value: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(value);
}

// ── Composants ────────────────────────────────────────────────────────────────

function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  muted,
}: {
  title: string;
  value: string | number;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  muted?: boolean;
}) {
  return (
    <div
      className={[
        "rounded-[28px] border bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md",
        muted ? "border-slate-100 opacity-60" : "border-slate-200",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-medium text-slate-500">{title}</div>
          <div className="mt-3 text-4xl font-semibold tracking-tight text-slate-950">
            {value}
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-600">{subtitle}</p>
        </div>
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-100">
          <Icon className="h-6 w-6 text-slate-600" />
        </div>
      </div>
    </div>
  );
}

function StatCardSkeleton() {
  return (
    <div className="animate-pulse rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="h-4 w-32 rounded bg-slate-200" />
          <div className="mt-4 h-10 w-24 rounded bg-slate-200" />
          <div className="mt-4 h-4 w-48 rounded bg-slate-200" />
          <div className="mt-2 h-4 w-36 rounded bg-slate-200" />
        </div>
        <div className="h-12 w-12 rounded-2xl bg-slate-200" />
      </div>
    </div>
  );
}

function HealthBadge({
  label,
  tone,
}: {
  label: string;
  tone: "green" | "amber" | "red" | "slate";
}) {
  const classes =
    tone === "green"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : tone === "red"
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : "border-slate-200 bg-slate-50 text-slate-700";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${classes}`}
    >
      {label}
    </span>
  );
}

function computeHealth(metrics: AdminDashboardMetrics) {
  if (metrics.lowStockAlerts >= 5) return { label: "À surveiller", tone: "amber" as const };
  if (metrics.activeUsers === 0)   return { label: "Initialisation", tone: "slate" as const };
  return { label: "Sain", tone: "green" as const };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminDashboardPage() {
  const [state, setState]           = useState<LoadState>("loading");
  const [metrics, setMetrics]       = useState<AdminDashboardMetrics | null>(null);
  const [errorDismissed, setError]  = useState(false);

  async function load() {
    setState("loading");
    setError(false);
    try {
      const result = await getAdminDashboardMetrics();
      setMetrics(result);
      setState("ready");
    } catch (error) {
      console.error("[AdminDashboardPage] load failed:", error);
      // Mode local : on affiche quand même le dashboard avec des métriques vides
      setMetrics(EMPTY_METRICS);
      setState("error");
    }
  }

  useEffect(() => { void load(); }, []);

  // Pour le health badge, on utilise les métriques réelles si dispo, sinon vides
  const displayMetrics = metrics ?? EMPTY_METRICS;
  const health = useMemo(() => computeHealth(displayMetrics), [displayMetrics]);

  // Le dashboard est visible dès que loading est terminé (ready OU error)
  const showContent = state !== "loading";
  const isLocalMode = state === "error";

  return (
    <div className="space-y-8">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <section className="rounded-[32px] border border-slate-200 bg-white px-8 py-8 shadow-sm">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">
              Espace administrateur
            </div>
            <h1 className="mt-3 text-5xl font-semibold tracking-tight text-slate-950">
              Dashboard Mimmoza
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
              Vue consolidée de la plateforme pour piloter les utilisateurs,
              abonnements, jetons, devis et entreprises depuis une interface
              fiable, claire et orientée décision.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <HealthBadge
                label={`Santé plateforme : ${isLocalMode ? "Mode local" : health.label}`}
                tone={isLocalMode ? "amber" : health.tone}
              />
              <HealthBadge label="Admin sécurisé" tone="green" />
              <HealthBadge
                label={isLocalMode ? "Supabase non connecté" : "Données live"}
                tone={isLocalMode ? "amber" : "slate"}
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            <RefreshCw className="h-4 w-4" />
            Actualiser
          </button>
        </div>
      </section>

      {/* ── Bannière mode local (dismissible, non bloquante) ────────────────── */}
      {isLocalMode && !errorDismissed && (
        <div className="flex items-start justify-between gap-4 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
          <div className="flex items-start gap-3">
            <WifiOff className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
            <div>
              <p className="text-sm font-semibold text-amber-900">
                Données Supabase indisponibles — mode local actif
              </p>
              <p className="mt-0.5 text-xs text-amber-700">
                Les métriques affichent des zéros. Vérifie les policies RLS dans{" "}
                <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[11px]">
                  adminDashboard.ts
                </code>{" "}
                ou lance le serveur Supabase local.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setError(true)}
            className="shrink-0 rounded-lg p-1 text-amber-500 transition hover:bg-amber-100"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ── Stat cards ─────────────────────────────────────────────────────── */}
      <section className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
        {!showContent ? (
          <>
            <StatCardSkeleton /><StatCardSkeleton />
            <StatCardSkeleton /><StatCardSkeleton />
            <StatCardSkeleton /><StatCardSkeleton />
            <StatCardSkeleton /><StatCardSkeleton />
          </>
        ) : (
          <>
            <StatCard
              title="Utilisateurs actifs"
              value={displayMetrics.activeUsers}
              subtitle={`${displayMetrics.trialUsers} en essai · ${displayMetrics.suspendedUsers} suspendus`}
              icon={Users}
              muted={isLocalMode}
            />
            <StatCard
              title="Abonnements actifs"
              value={displayMetrics.activeSubscriptions}
              subtitle="Plans mensuels ou annuels actifs"
              icon={CreditCard}
              muted={isLocalMode}
            />
            <StatCard
              title="MRR HT"
              value={formatEur(displayMetrics.estimatedMrrEur)}
              subtitle="Revenu mensuel récurrent estimé"
              icon={BadgeEuro}
              muted={isLocalMode}
            />
            <StatCard
              title="Devis ouverts"
              value={displayMetrics.openQuotes}
              subtitle={`${displayMetrics.wonQuotes} gagnés · ${displayMetrics.lostQuotes} perdus`}
              icon={ClipboardList}
              muted={isLocalMode}
            />
            <StatCard
              title="Consommation"
              value={displayMetrics.tokensConsumed}
              subtitle="Jetons consommés sur l'historique disponible"
              icon={Ticket}
              muted={isLocalMode}
            />
            <StatCard
              title="Alertes jetons"
              value={displayMetrics.lowStockAlerts}
              subtitle="Comptes avec stock faible ou quota à surveiller"
              icon={AlertTriangle}
              muted={isLocalMode}
            />
            <StatCard
              title="Entreprises"
              value={displayMetrics.companies}
              subtitle="Comptes B2B suivis dans l'espace administrateur"
              icon={Building2}
              muted={isLocalMode}
            />
            <StatCard
              title="Coût IA estimé"
              value={formatEur(displayMetrics.estimatedAiCostEur)}
              subtitle="Basé sur la consommation de jetons connue"
              icon={Sparkles}
              muted={isLocalMode}
            />
          </>
        )}
      </section>

      {/* ── Santé + priorités ──────────────────────────────────────────────── */}
      <section className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm xl:col-span-2">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100">
              <Activity className="h-5 w-5 text-slate-700" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-950">
                Santé de la plateforme
              </h2>
              <p className="text-sm text-slate-500">
                Lecture rapide des signaux opérationnels les plus utiles.
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-medium text-slate-500">Base active</div>
              <div className="mt-2 text-2xl font-semibold text-slate-950">
                {showContent ? displayMetrics.activeUsers : "—"}
              </div>
              <p className="mt-2 text-sm text-slate-600">
                Utilisateurs actuellement actifs sur la plateforme.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-medium text-slate-500">Pression jetons</div>
              <div className="mt-2 text-2xl font-semibold text-slate-950">
                {showContent ? displayMetrics.lowStockAlerts : "—"}
              </div>
              <p className="mt-2 text-sm text-slate-600">
                Comptes nécessitant une attention rapide.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-medium text-slate-500">Run-rate estimé</div>
              <div className="mt-2 text-2xl font-semibold text-slate-950">
                {showContent ? formatEur(displayMetrics.estimatedMrrEur) : "—"}
              </div>
              <p className="mt-2 text-sm text-slate-600">
                Vision mensuelle simplifiée du revenu récurrent.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Priorités admin</h2>
          <div className="mt-5 space-y-3">
            <div className="rounded-2xl border border-slate-200 p-4">
              <div className="text-sm font-semibold text-slate-900">
                Vérifier les alertes jetons
              </div>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Confirmer les comptes avec faible stock avant blocage utilisateur.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 p-4">
              <div className="text-sm font-semibold text-slate-900">
                Contrôler le run-rate
              </div>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Vérifier la cohérence entre abonnements actifs et MRR estimé.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 p-4">
              <div className="text-sm font-semibold text-slate-900">
                Suivre le pipe devis
              </div>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Prioriser les devis ouverts et les comptes entreprise à convertir.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}