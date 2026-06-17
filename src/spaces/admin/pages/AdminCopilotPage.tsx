// src/spaces/admin/pages/AdminCopilotPage.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Page de pilotage des crédits Copilot V1.
// Stats globales · liste utilisateurs · ajustement manuel de crédits.
// ─────────────────────────────────────────────────────────────────────────────

import {
  AlertTriangle,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  CreditCard,
  Loader2,
  MessageSquare,
  Minus,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Users,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  adminAdjustCopilotCredits,
  getAdminCopilotDailyUsage,
  getAdminCopilotStats,
  getAdminCopilotUsers,
  type AdminCopilotDailyRow,
  type AdminCopilotStats,
  type AdminCopilotUserRow,
} from "../services/adminCopilot";

// ─── Types locaux ─────────────────────────────────────────────────────────────

type LoadState = "loading" | "ready" | "error";
type SortKey = "balance" | "consumed30d" | "consumed7d" | "lastActivity";
type SortDir = "asc" | "desc";

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtNum(n: number): string {
  return new Intl.NumberFormat("fr-FR").format(Math.round(n));
}

function fmtEur(n: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency", currency: "EUR", maximumFractionDigits: 2,
  }).format(n);
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit", month: "short", year: "numeric",
  }).format(new Date(iso));
}

function fmtDateShort(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short" }).format(new Date(iso));
}

// ─── Composants utilitaires ───────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  sub?: string;
  accent?: "violet" | "amber" | "emerald" | "sky";
}) {
  const accentClasses = {
    violet:  "bg-violet-50 text-violet-600 border-violet-100",
    amber:   "bg-amber-50 text-amber-600 border-amber-100",
    emerald: "bg-emerald-50 text-emerald-600 border-emerald-100",
    sky:     "bg-sky-50 text-sky-600 border-sky-100",
  };
  const iconClass = accentClasses[accent ?? "sky"];

  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">{label}</p>
          <p className="mt-2 truncate text-3xl font-bold tracking-tight text-slate-900">{value}</p>
          {sub && <p className="mt-1.5 text-xs text-slate-500">{sub}</p>}
        </div>
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${iconClass}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-slate-100 ${className ?? ""}`} />;
}

// ─── Mini bar chart ───────────────────────────────────────────────────────────

function MiniBarChart({ data }: { data: AdminCopilotDailyRow[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-slate-400">
        Aucune donnée de consommation
      </div>
    );
  }
  const max = Math.max(...data.map((d) => d.totalCredits), 1);
  const last14 = data.slice(-14);

  return (
    <div className="flex h-28 items-end gap-1">
      {last14.map((d) => {
        const pct = (d.totalCredits / max) * 100;
        const quick    = (d.quickCalls    / Math.max(d.quickCalls + d.advancedCalls + d.reportCalls, 1)) * pct;
        const advanced = (d.advancedCalls / Math.max(d.quickCalls + d.advancedCalls + d.reportCalls, 1)) * pct;
        const report   = pct - quick - advanced;
        return (
          <div key={d.date} className="group relative flex flex-1 flex-col items-center gap-0.5">
            {/* Tooltip */}
            <div className="pointer-events-none absolute bottom-full mb-2 hidden whitespace-nowrap rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg group-hover:block z-10">
              <div className="font-semibold text-slate-900">{fmtDateShort(d.date)}</div>
              <div className="mt-1 text-slate-500">{fmtNum(d.totalCredits)} crédits</div>
              <div className="text-violet-600">{d.quickCalls}× quick · {d.advancedCalls}× adv</div>
            </div>
            {/* Barres empilées */}
            <div className="flex w-full flex-col-reverse rounded-t-sm overflow-hidden" style={{ height: `${Math.max(pct, 2)}%` }}>
              {report > 0 && (
                <div className="bg-violet-600" style={{ height: `${(report / pct) * 100}%` }} />
              )}
              {advanced > 0 && (
                <div className="bg-violet-400" style={{ height: `${(advanced / pct) * 100}%` }} />
              )}
              {quick > 0 && (
                <div className="bg-violet-200" style={{ height: `${(quick / pct) * 100}%` }} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Modal ajustement crédits ─────────────────────────────────────────────────

function CreditAdjustModal({
  user,
  onClose,
  onSuccess,
}: {
  user: AdminCopilotUserRow;
  onClose: () => void;
  onSuccess: (userId: string, newBalance: number) => void;
}) {
  const [mode,    setMode]    = useState<"add" | "remove">("add");
  const [amount,  setAmount]  = useState("");
  const [reason,  setReason]  = useState("Ajout manuel admin");
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const delta = mode === "add" ? Number(amount) : -Number(amount);
  const preview = Math.max(0, user.balance + delta);
  const valid = Number(amount) > 0 && reason.trim().length > 0;

  async function submit() {
    if (!valid) return;
    setLoading(true);
    setError(null);
    try {
      const newBalance = await adminAdjustCopilotCredits(user.userId, delta, reason.trim());
      onSuccess(user.userId, newBalance);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  }

  // Fermeture sur Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-[28px] border border-slate-200 bg-white p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-100">
                <Sparkles className="h-4 w-4 text-violet-600" />
              </div>
              <h2 className="text-lg font-semibold text-slate-900">Ajuster les crédits</h2>
            </div>
            <p className="mt-1 text-sm text-slate-500 truncate max-w-xs">{user.email}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Solde actuel */}
        <div className="mt-5 flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
          <span className="text-sm text-slate-500">Solde actuel</span>
          <span className="text-2xl font-bold tracking-tight text-slate-900">
            {fmtNum(user.balance)} <span className="text-sm font-normal text-slate-400">crédits</span>
          </span>
        </div>

        {/* Mode add / remove */}
        <div className="mt-4 flex gap-2">
          {(["add", "remove"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={[
                "flex flex-1 items-center justify-center gap-2 rounded-xl border py-2.5 text-sm font-medium transition",
                mode === m
                  ? m === "add"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-rose-200 bg-rose-50 text-rose-700"
                  : "border-slate-200 text-slate-600 hover:bg-slate-50",
              ].join(" ")}
            >
              {m === "add" ? <Plus className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
              {m === "add" ? "Ajouter" : "Retirer"}
            </button>
          ))}
        </div>

        {/* Montant */}
        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">
              Montant
            </label>
            <input
              type="number"
              min="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="ex : 500"
              className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
            {/* Raccourcis rapides */}
            <div className="mt-2 flex gap-1.5">
              {[100, 500, 1000, 5000].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setAmount(String(v))}
                  className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 transition hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700"
                >
                  {fmtNum(v)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">
              Raison
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
          </div>
        </div>

        {/* Aperçu nouveau solde */}
        {amount && Number(amount) > 0 && (
          <div className="mt-4 flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-2.5">
            <span className="text-xs text-slate-500">Nouveau solde</span>
            <span className={`text-lg font-bold ${preview > user.balance ? "text-emerald-600" : "text-rose-600"}`}>
              {fmtNum(preview)} crédits
              {preview > user.balance
                ? <TrendingUp className="ml-1.5 inline h-4 w-4" />
                : <TrendingDown className="ml-1.5 inline h-4 w-4" />
              }
            </span>
          </div>
        )}

        {error && (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!valid || loading}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-violet-600 py-2.5 text-sm font-medium text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Check className="h-4 w-4" />
            }
            Confirmer
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Ligne utilisateur ────────────────────────────────────────────────────────

function UserRow({
  user,
  onAdjust,
}: {
  user: AdminCopilotUserRow;
  onAdjust: (user: AdminCopilotUserRow) => void;
}) {
  const LOW_THRESHOLD = 50;
  const isLow = user.balance < LOW_THRESHOLD;
  const isInactive = !user.lastActivityAt;

  return (
    <tr className="border-b border-slate-100 transition hover:bg-slate-50/70">
      {/* Email */}
      <td className="py-3.5 pl-4 pr-3 text-sm">
        <div className="font-medium text-slate-900 truncate max-w-[200px]">{user.email}</div>
        <div className="mt-0.5 text-xs text-slate-400 font-mono">{user.userId.slice(0, 8)}…</div>
      </td>

      {/* Solde */}
      <td className="px-3 py-3.5 text-right">
        <span className={[
          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-bold",
          isLow
            ? "bg-amber-50 text-amber-700"
            : "bg-violet-50 text-violet-700",
        ].join(" ")}>
          {isLow && <AlertTriangle className="h-3 w-3" />}
          {fmtNum(user.balance)}
        </span>
      </td>

      {/* Conso 7j */}
      <td className="px-3 py-3.5 text-right text-sm text-slate-600">
        {user.consumed7d > 0 ? fmtNum(user.consumed7d) : <span className="text-slate-300">—</span>}
      </td>

      {/* Conso 30j */}
      <td className="px-3 py-3.5 text-right text-sm text-slate-600">
        {user.consumed30d > 0 ? fmtNum(user.consumed30d) : <span className="text-slate-300">—</span>}
      </td>

      {/* Calls 30j */}
      <td className="px-3 py-3.5 text-center">
        <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
          {user.quickCalls30d > 0 && (
            <span className="flex items-center gap-0.5 rounded-md bg-slate-100 px-1.5 py-0.5">
              <Zap className="h-3 w-3 text-violet-400" />{user.quickCalls30d}
            </span>
          )}
          {user.advancedCalls30d > 0 && (
            <span className="flex items-center gap-0.5 rounded-md bg-slate-100 px-1.5 py-0.5">
              <Sparkles className="h-3 w-3 text-violet-600" />{user.advancedCalls30d}
            </span>
          )}
          {user.quickCalls30d === 0 && user.advancedCalls30d === 0 && (
            <span className="text-slate-300">—</span>
          )}
        </div>
      </td>

      {/* Conversations */}
      <td className="px-3 py-3.5 text-center text-sm text-slate-600">
        {user.conversationsCount > 0
          ? <span className="flex items-center justify-center gap-1"><MessageSquare className="h-3.5 w-3.5 text-slate-400" />{user.conversationsCount}</span>
          : <span className="text-slate-300">—</span>
        }
      </td>

      {/* Dernière activité */}
      <td className="px-3 py-3.5 text-right text-xs text-slate-500">
        {isInactive
          ? <span className="text-slate-300">Jamais</span>
          : <span className="flex items-center justify-end gap-1"><Clock className="h-3 w-3" />{fmtDate(user.lastActivityAt)}</span>
        }
      </td>

      {/* Action */}
      <td className="py-3.5 pl-3 pr-4 text-right">
        <button
          type="button"
          onClick={() => onAdjust(user)}
          className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700"
        >
          Ajuster
        </button>
      </td>
    </tr>
  );
}

// ─── Page principale ──────────────────────────────────────────────────────────

export default function AdminCopilotPage() {
  const [state,       setState]       = useState<LoadState>("loading");
  const [stats,       setStats]       = useState<AdminCopilotStats | null>(null);
  const [users,       setUsers]       = useState<AdminCopilotUserRow[]>([]);
  const [daily,       setDaily]       = useState<AdminCopilotDailyRow[]>([]);
  const [search,      setSearch]      = useState("");
  const [sortKey,     setSortKey]     = useState<SortKey>("balance");
  const [sortDir,     setSortDir]     = useState<SortDir>("desc");
  const [adjustUser,  setAdjustUser]  = useState<AdminCopilotUserRow | null>(null);
  const [error,       setError]       = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const [s, u, d] = await Promise.all([
        getAdminCopilotStats(),
        getAdminCopilotUsers(),
        getAdminCopilotDailyUsage(30),
      ]);
      setStats(s);
      setUsers(u);
      setDaily(d);
      setState("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
      setState("error");
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  // Tri + filtre
  const displayedUsers = users
    .filter((u) => u.email.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      let va: number | string = 0, vb: number | string = 0;
      if (sortKey === "balance")       { va = a.balance;       vb = b.balance; }
      if (sortKey === "consumed30d")   { va = a.consumed30d;   vb = b.consumed30d; }
      if (sortKey === "consumed7d")    { va = a.consumed7d;    vb = b.consumed7d; }
      if (sortKey === "lastActivity")  { va = a.lastActivityAt ?? ""; vb = b.lastActivityAt ?? ""; }
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return null;
    return sortDir === "desc"
      ? <ChevronDown className="ml-1 inline h-3 w-3" />
      : <ChevronUp   className="ml-1 inline h-3 w-3" />;
  }

  function handleAdjustSuccess(userId: string, newBalance: number) {
    setUsers((prev) =>
      prev.map((u) => u.userId === userId ? { ...u, balance: newBalance } : u)
    );
  }

  const lowCreditCount = users.filter((u) => u.balance < 50).length;

  return (
    <div className="space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <section className="rounded-[32px] border border-slate-200 bg-white px-8 py-7 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-violet-100">
                <Bot className="h-5 w-5 text-violet-600" />
              </div>
              <div className="text-xs font-bold uppercase tracking-widest text-violet-600">
                Copilot
              </div>
            </div>
            <h1 className="mt-3 text-4xl font-bold tracking-tight text-slate-900">
              Crédits Copilot
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Soldes, consommation et ajustements manuels des crédits Copilot par utilisateur.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadData()}
            disabled={state === "loading"}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${state === "loading" ? "animate-spin" : ""}`} />
            Actualiser
          </button>
        </div>
      </section>

      {/* ── Erreur ─────────────────────────────────────────────────────────── */}
      {state === "error" && error && (
        <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <strong>Erreur de chargement :</strong> {error}
            <br />
            <span className="text-xs text-rose-500">
              Vérifie que les RPCs admin_copilot_stats, admin_copilot_users et
              admin_adjust_copilot_credits existent dans Supabase.
            </span>
          </div>
        </div>
      )}

      {/* ── Stat cards ─────────────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {state === "loading" || !stats ? (
          <>
            <Skeleton className="h-28 rounded-[24px]" />
            <Skeleton className="h-28 rounded-[24px]" />
            <Skeleton className="h-28 rounded-[24px]" />
            <Skeleton className="h-28 rounded-[24px]" />
          </>
        ) : (
          <>
            <StatCard
              icon={CreditCard}
              label="Crédits disponibles"
              value={fmtNum(stats.totalCreditsAvailable)}
              sub={`${users.length} compte${users.length > 1 ? "s" : ""}`}
              accent="violet"
            />
            <StatCard
              icon={TrendingDown}
              label="Consommés (30j)"
              value={fmtNum(stats.creditsConsumed30d)}
              sub={`Quick: ${fmtNum(stats.quickCalls30d)} · Adv: ${fmtNum(stats.advancedCalls30d)}`}
              accent="sky"
            />
            <StatCard
              icon={Users}
              label="Users actifs (7j)"
              value={stats.activeUsers7d}
              sub={lowCreditCount > 0 ? `${lowCreditCount} solde(s) faible` : "Tous les comptes OK"}
              accent={lowCreditCount > 0 ? "amber" : "emerald"}
            />
            <StatCard
              icon={Sparkles}
              label="Coût IA estimé (30j)"
              value={fmtEur(stats.estimatedCostEur30d)}
              sub={`${fmtNum(Math.round(stats.tokensIn30d / 1000))}k in · ${fmtNum(Math.round(stats.tokensOut30d / 1000))}k out`}
              accent="sky"
            />
          </>
        )}
      </section>

      {/* ── Graphique conso quotidienne ─────────────────────────────────────── */}
      <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Consommation quotidienne</h2>
            <p className="text-xs text-slate-400">14 derniers jours — crédits par mode</p>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-violet-200 inline-block" />Quick</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-violet-400 inline-block" />Avancé</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-violet-600 inline-block" />Report</span>
          </div>
        </div>
        <div className="mt-5">
          {state === "loading"
            ? <Skeleton className="h-28 w-full rounded-xl" />
            : <MiniBarChart data={daily} />
          }
        </div>
      </section>

      {/* ── Tableau utilisateurs ───────────────────────────────────────────── */}
      <section className="rounded-[28px] border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-100 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Utilisateurs</h2>
            <p className="text-xs text-slate-400">
              {displayedUsers.length} utilisateur{displayedUsers.length > 1 ? "s" : ""}
              {lowCreditCount > 0 && (
                <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-600 border border-amber-200">
                  <AlertTriangle className="h-3 w-3" />{lowCreditCount} solde{lowCreditCount > 1 ? "s" : ""} faible
                </span>
              )}
            </p>
          </div>
          <div className="relative max-w-xs">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Rechercher un email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-4 text-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/70">
                {[
                  { label: "Utilisateur",   key: null            },
                  { label: "Solde",         key: "balance"       },
                  { label: "Conso 7j",      key: "consumed7d"    },
                  { label: "Conso 30j",     key: "consumed30d"   },
                  { label: "Calls 30j",     key: null            },
                  { label: "Conv.",         key: null            },
                  { label: "Dernière act.", key: "lastActivity"  },
                  { label: "",              key: null            },
                ].map(({ label, key }, i) => (
                  <th
                    key={i}
                    onClick={key ? () => toggleSort(key as SortKey) : undefined}
                    className={[
                      "py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-400",
                      i === 0 ? "pl-4 pr-3 text-left" : i === 7 ? "pl-3 pr-4 text-right" : "px-3",
                      i >= 1 && i <= 3 ? "text-right" : "",
                      i === 4 || i === 5 ? "text-center" : "",
                      i === 6 ? "text-right" : "",
                      key ? "cursor-pointer select-none hover:text-slate-600" : "",
                    ].join(" ")}
                  >
                    {label}
                    {key && <SortIcon k={key as SortKey} />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {state === "loading" ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    {Array.from({ length: 8 }).map((_, j) => (
                      <td key={j} className="px-3 py-3.5">
                        <Skeleton className="h-4 w-full rounded" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : displayedUsers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-sm text-slate-400">
                    {search ? "Aucun utilisateur ne correspond à la recherche" : "Aucun utilisateur Copilot trouvé"}
                  </td>
                </tr>
              ) : (
                displayedUsers.map((user) => (
                  <UserRow
                    key={user.userId}
                    user={user}
                    onAdjust={setAdjustUser}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Légende bas de tableau */}
        {state === "ready" && displayedUsers.length > 0 && (
          <div className="flex items-center gap-4 border-t border-slate-100 px-6 py-3 text-xs text-slate-400">
            <span className="flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-violet-400" /> Quick = 1 crédit
            </span>
            <span className="flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-violet-600" /> Avancé = 15 crédits
            </span>
            <span className="flex items-center gap-1.5 text-amber-500">
              <AlertTriangle className="h-3.5 w-3.5" /> Solde &lt; 50 = alerte
            </span>
          </div>
        )}
      </section>

      {/* ── Modal ajustement ───────────────────────────────────────────────── */}
      {adjustUser && (
        <CreditAdjustModal
          user={adjustUser}
          onClose={() => setAdjustUser(null)}
          onSuccess={handleAdjustSuccess}
        />
      )}
    </div>
  );
}