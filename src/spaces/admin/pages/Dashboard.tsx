// src/spaces/admin/pages/Dashboard.tsx
// ─── changelog ────────────────────────────────────────────────────────────────
// • Métriques réalignées sur le service réel (adminDashboard.ts) : crédits,
//   organisations, analyses, dossiers banque, packs. Les anciennes métriques
//   SaaS (users/MRR/devis/stock) n'existaient pas côté données et ont été
//   remplacées par les vraies sorties du RPC admin_dashboard_metrics.
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
  activeAdmins: 0,
  organisations: 0,
  organisationMembers: 0,
  activeCreditAccounts: 0,
  totalCreditsAvailable: 0,
  consumedCredits: 0,
  lowCreditAccounts: 0,
  analysesCount: 0,
  analysesSuccessCount: 0,
  analysesErrorCount: 0,
  banqueDossiersCount: 0,
  banqueDossiersVigilanceCount: 0,
  activeCreditPacks: 0,
  estimatedPackCatalogValueEur: 0,
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
  if (metrics.lowCreditAccounts >= 5)     return { label: "À surveiller", tone: "amber" as const };
  if (metrics.activeCreditAccounts === 0) return { label: "Initialisation", tone: "slate" as const };
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
              Vue consolidée de la plateforme pour piloter les comptes crédits,
              les organisations, les analyses et les dossiers banque depuis une
              interface fiable, claire et orientée décision.
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
              title="Comptes crédits actifs"
              value={displayMetrics.activeCreditAccounts}
              subtitle={`${displayMetrics.organisations} organisation(s) · ${displayMetrics.organisationMembers} membre(s)`}
              icon={Users}
              muted={isLocalMode}
            />
            <StatCard
              title="Crédits disponibles"
              value={displayMetrics.totalCreditsAvailable}
              subtitle="Solde cumulé des comptes crédits"
              icon={CreditCard}
              muted={isLocalMode}
            />
            <StatCard
              title="Valeur catalogue packs"
              value={formatEur(displayMetrics.estimatedPackCatalogValueEur)}
              subtitle={`${displayMetrics.activeCreditPacks} pack(s) actif(s)`}
              icon={BadgeEuro}
              muted={isLocalMode}
            />
            <StatCard
              title="Analyses"
              value={displayMetrics.analysesCount}
              subtitle={`${displayMetrics.analysesSuccessCount} réussies · ${displayMetrics.analysesErrorCount} en erreur`}
              icon={ClipboardList}
              muted={isLocalMode}
            />
            <StatCard
              title="Crédits consommés"
              value={displayMetrics.consumedCredits}
              subtitle="Total consommé sur l'historique disponible"
              icon={Ticket}
              muted={isLocalMode}
            />
            <StatCard
              title="Comptes crédit faibles"
              value={displayMetrics.lowCreditAccounts}
              subtitle="Comptes avec solde de crédits faible à surveiller"
              icon={AlertTriangle}
              muted={isLocalMode}
            />
            <StatCard
              title="Organisations"
              value={displayMetrics.organisations}
              subtitle="Comptes B2B suivis dans l'espace administrateur"
              icon={Building2}
              muted={isLocalMode}
            />
            <StatCard
              title="Dossiers banque"
              value={displayMetrics.banqueDossiersCount}
              subtitle={`${displayMetrics.banqueDossiersVigilanceCount} en vigilance`}
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
              <div className="text-sm font-medium text-slate-500">Comptes crédits actifs</div>
              <div className="mt-2 text-2xl font-semibold text-slate-950">
                {showContent ? displayMetrics.activeCreditAccounts : "—"}
              </div>
              <p className="mt-2 text-sm text-slate-600">
                Comptes disposant d'un solde de crédits actif.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-medium text-slate-500">Comptes crédit faibles</div>
              <div className="mt-2 text-2xl font-semibold text-slate-950">
                {showContent ? displayMetrics.lowCreditAccounts : "—"}
              </div>
              <p className="mt-2 text-sm text-slate-600">
                Comptes nécessitant une attention rapide.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-medium text-slate-500">Valeur catalogue</div>
              <div className="mt-2 text-2xl font-semibold text-slate-950">
                {showContent ? formatEur(displayMetrics.estimatedPackCatalogValueEur) : "—"}
              </div>
              <p className="mt-2 text-sm text-slate-600">
                Valeur estimée du catalogue de packs de crédits.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Priorités admin</h2>
          <div className="mt-5 space-y-3">
            <div className="rounded-2xl border border-slate-200 p-4">
              <div className="text-sm font-semibold text-slate-900">
                Vérifier les comptes crédit faibles
              </div>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Confirmer les comptes à faible solde avant blocage utilisateur.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 p-4">
              <div className="text-sm font-semibold text-slate-900">
                Contrôler les analyses en erreur
              </div>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Surveiller le taux d'échec des analyses pour détecter un incident.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 p-4">
              <div className="text-sm font-semibold text-slate-900">
                Suivre les dossiers banque en vigilance
              </div>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Prioriser les dossiers signalés en vigilance pour revue.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}