// src/spaces/admin/pages/Dashboard.tsx

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BadgeEuro,
  Banknote,
  Building2,
  CreditCard,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import {
  getAdminDashboardMetrics,
  getAdminDashboardOrganisations,
  getAdminDashboardUsers,
  getRecentAnalyses,
  type AdminDashboardAnalysisRow,
  type AdminDashboardMetrics,
  type AdminDashboardOrganisationRow,
  type AdminDashboardUserRow,
} from "../services/adminDashboard";

type LoadState = "loading" | "ready" | "error";

function formatNumber(value: number): string {
  return new Intl.NumberFormat("fr-FR").format(value);
}

function formatEur(value: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
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

function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
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

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
      <div className="h-4 w-32 rounded bg-slate-200" />
      <div className="mt-4 h-10 w-24 rounded bg-slate-200" />
      <div className="mt-4 h-4 w-48 rounded bg-slate-200" />
    </div>
  );
}

function computeHealth(metrics: AdminDashboardMetrics | null): {
  label: string;
  tone: "green" | "amber" | "red" | "slate";
} {
  if (!metrics) return { label: "Chargement", tone: "slate" };
  if (metrics.analysesErrorCount >= 5) return { label: "Incidents", tone: "red" };
  if (metrics.lowCreditAccounts >= 3) return { label: "À surveiller", tone: "amber" };
  if (metrics.activeAdmins === 0) return { label: "Sécurité à vérifier", tone: "red" };
  return { label: "Sain", tone: "green" };
}

function analysisTone(
  status: string | null
): "green" | "amber" | "red" | "slate" {
  const normalized = (status ?? "").toLowerCase();
  if (normalized === "done" || normalized === "success" || normalized === "completed")
    return "green";
  if (normalized === "error" || normalized === "failed") return "red";
  if (normalized === "pending" || normalized === "processing" || normalized === "running")
    return "amber";
  return "slate";
}

export default function AdminDashboardPage() {
  const [state, setState] = useState<LoadState>("loading");
  const [metrics, setMetrics] = useState<AdminDashboardMetrics | null>(null);
  const [users, setUsers] = useState<AdminDashboardUserRow[]>([]);
  const [organisations, setOrganisations] = useState<AdminDashboardOrganisationRow[]>([]);
  const [analyses, setAnalyses] = useState<AdminDashboardAnalysisRow[]>([]);

  async function load(): Promise<void> {
    setState("loading");
    try {
      const [metricsData, usersData, organisationsData, analysesData] =
        await Promise.all([
          getAdminDashboardMetrics(),
          getAdminDashboardUsers(),
          getAdminDashboardOrganisations(),
          getRecentAnalyses(),
        ]);
      setMetrics(metricsData);
      setUsers(usersData);
      setOrganisations(organisationsData);
      setAnalyses(analysesData);
      setState("ready");
    } catch (error) {
      console.error("[AdminDashboardPage] load failed:", error);
      setState("error");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const health = useMemo(() => computeHealth(metrics), [metrics]);

  return (
    <div className="space-y-8">
      <section className="rounded-[32px] border border-slate-200 bg-white px-8 py-8 shadow-sm">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">
              Espace administrateur
            </div>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-950 xl:text-5xl">
              Dashboard Mimmoza
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
              {"Vue live de la plateforme basée sur les données réelles : sécurité admin, organisations, crédits, analyses et dossiers banque."}
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <HealthBadge
                label={`Santé plateforme : ${health.label}`}
                tone={health.tone}
              />
              <HealthBadge label="Admin sécurisé" tone="green" />
              <HealthBadge label="Données live Supabase" tone="slate" />
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

      {state === "error" && (
        <section className="rounded-[28px] border border-rose-200 bg-white p-6 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50">
              <AlertTriangle className="h-6 w-6 text-rose-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-950">
                Impossible de charger le dashboard live
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {"Vérifie les droits RLS de lecture admin sur les tables utilisées par le dashboard."}
              </p>
            </div>
          </div>
        </section>
      )}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {state === "loading" || !metrics ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : (
          <>
            <StatCard
              title="Admins actifs"
              value={formatNumber(metrics.activeAdmins)}
              subtitle="Comptes administrateurs actifs"
              icon={ShieldCheck}
            />
            <StatCard
              title="Entreprises"
              value={formatNumber(metrics.organisations)}
              subtitle={`${formatNumber(metrics.organisationMembers)} membres rattachés`}
              icon={Building2}
            />
            <StatCard
              title="Crédits disponibles"
              value={formatNumber(metrics.totalCreditsAvailable)}
              subtitle={`${formatNumber(metrics.lowCreditAccounts)} comptes à stock faible`}
              icon={CreditCard}
            />
            <StatCard
              title="Analyses"
              value={formatNumber(metrics.analysesCount)}
              subtitle={`${formatNumber(metrics.analysesSuccessCount)} réussies · ${formatNumber(metrics.analysesErrorCount)} en erreur`}
              icon={Sparkles}
            />
          </>
        )}
      </section>

      <section className="grid gap-5 xl:grid-cols-4">
        {state === "loading" || !metrics ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : (
          <>
            <StatCard
              title="Crédits consommés"
              value={formatNumber(metrics.consumedCredits)}
              subtitle="Total détecté dans les transactions"
              icon={Banknote}
            />
            <StatCard
              title="Comptes crédit"
              value={formatNumber(metrics.activeCreditAccounts)}
              subtitle="Comptes disposant d'un solde crédit"
              icon={Users}
            />
            <StatCard
              title="Dossiers banque"
              value={formatNumber(metrics.banqueDossiersCount)}
              subtitle={`${formatNumber(metrics.banqueDossiersVigilanceCount)} en vigilance`}
              icon={Activity}
            />
            <StatCard
              title="Catalogue packs"
              value={formatEur(metrics.estimatedPackCatalogValueEur)}
              subtitle={`${formatNumber(metrics.activeCreditPacks)} packs crédits actifs`}
              icon={BadgeEuro}
            />
          </>
        )}
      </section>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm xl:col-span-2">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100">
              <Activity className="h-5 w-5 text-slate-700" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-950">
                {"Santé de la plateforme"}
              </h2>
              <p className="text-sm text-slate-500">
                {"Lecture rapide des signaux les plus utiles."}
              </p>
            </div>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-medium text-slate-500">
                {"Sécurité admin"}
              </div>
              <div className="mt-2 text-2xl font-semibold text-slate-950">
                {metrics ? formatNumber(metrics.activeAdmins) : "—"}
              </div>
              <p className="mt-2 text-sm text-slate-600">
                {"Administrateurs actifs autorisés à accéder à l'espace."}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-medium text-slate-500">
                {"Pression crédits"}
              </div>
              <div className="mt-2 text-2xl font-semibold text-slate-950">
                {metrics ? formatNumber(metrics.lowCreditAccounts) : "—"}
              </div>
              <p className="mt-2 text-sm text-slate-600">
                {"Comptes à faible stock de crédits."}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-medium text-slate-500">
                {"Pipeline analyses"}
              </div>
              <div className="mt-2 text-2xl font-semibold text-slate-950">
                {metrics ? formatNumber(metrics.analysesCount) : "—"}
              </div>
              <p className="mt-2 text-sm text-slate-600">
                {"Volume total des analyses enregistrées."}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">
            {"Priorités admin"}
          </h2>
          <div className="mt-5 space-y-3">
            <div className="rounded-2xl border border-slate-200 p-4">
              <div className="text-sm font-semibold text-slate-900">
                {"Vérifier les comptes à faible crédit"}
              </div>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                {"Évite les blocages utilisateurs sur les analyses et parcours critiques."}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 p-4">
              <div className="text-sm font-semibold text-slate-900">
                {"Suivre les erreurs d'analyses"}
              </div>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                {"Contrôle le volume d'échecs pour repérer les régressions produit."}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 p-4">
              <div className="text-sm font-semibold text-slate-900">
                {"Contrôler les organisations"}
              </div>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                {"Vérifie la cohérence entre plans, membres et activité réelle."}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-slate-950">
            {"Derniers admins"}
          </h2>
          <div className="mt-5 space-y-4">
            {users.map((user) => (
              <div
                key={user.id}
                className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4"
              >
                <div>
                  <div className="font-medium text-slate-900">{user.email}</div>
                  <div className="text-sm text-slate-500">
                    {"Créé le "}{formatDate(user.createdAt)}
                  </div>
                </div>
                <HealthBadge
                  label={user.isActive ? "actif" : "inactif"}
                  tone={user.isActive ? "green" : "red"}
                />
              </div>
            ))}
            {state === "ready" && users.length === 0 && (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                {"Aucun administrateur trouvé."}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-slate-950">
            {"Dernières organisations"}
          </h2>
          <div className="mt-5 space-y-4">
            {organisations.map((organisation) => (
              <div
                key={organisation.id}
                className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="font-medium text-slate-900">
                      {organisation.name}
                    </div>
                    <div className="text-sm text-slate-500">
                      {"Créée le "}{formatDate(organisation.createdAt)}
                    </div>
                  </div>
                  <HealthBadge
                    label={organisation.planCode ?? "plan inconnu"}
                    tone="slate"
                  />
                </div>
                <div className="mt-3 flex items-center justify-between text-sm">
                  <div className="text-slate-500">
                    {organisation.slug ?? "slug indisponible"}
                  </div>
                  <div className="font-medium text-slate-900">
                    {formatNumber(organisation.membersCount)}{" membre(s)"}
                  </div>
                </div>
              </div>
            ))}
            {state === "ready" && organisations.length === 0 && (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                {"Aucune organisation trouvée."}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-slate-950">
          {"Analyses récentes"}
        </h2>
        <div className="mt-5 space-y-4">
          {analyses.map((analysis) => (
            <div
              key={analysis.id}
              className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 lg:flex-row lg:items-center lg:justify-between"
            >
              <div>
                <div className="font-medium text-slate-900">
                  {analysis.city ?? "Ville non renseignée"}{" · "}{analysis.propertyType ?? "Bien"}
                </div>
                <div className="text-sm text-slate-500">
                  {analysis.planAtAnalysis ?? "plan inconnu"}{" · "}{formatDate(analysis.createdAt)}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <HealthBadge
                  label={`${formatNumber(analysis.creditsUsed)} crédit(s)`}
                  tone="slate"
                />
                <HealthBadge
                  label={analysis.status ?? "statut inconnu"}
                  tone={analysisTone(analysis.status)}
                />
              </div>
            </div>
          ))}
          {state === "ready" && analyses.length === 0 && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
              {"Aucune analyse récente trouvée."}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}