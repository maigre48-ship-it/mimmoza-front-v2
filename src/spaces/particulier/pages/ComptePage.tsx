// src/spaces/particulier/pages/ComptePage.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Hub "Mon compte" à onglets : Profil · Abonnement · Factures · Devis · Jetons · Clés API
//
// Sources (lecture Supabase, sécurisées par RLS) :
//   • auth        : supabase.auth.getUser()
//   • admin       : table admin_users
//   • plan        : organisation_members → organisations(plan_code)
//   • jetons      : credit_accounts / credit_transactions
//   • factures    : invoices  où recipient_user_id = auth.uid()  (RLS)
//   • devis       : quotes    où recipient_user_id = auth.uid() et status<>draft (RLS)
//   • suppression : Edge Function delete-account-v1
//
// Factures/Devis : la sécurité repose sur la RLS de 2025_link_billing_to_account.sql
// (le client ne lit QUE ses propres documents). Sans cette migration appliquée, ces
// onglets resteront vides.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from "@/lib/supabase";
import {
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock,
  Coins,
  CreditCard,
  FileDown,
  FileText,
  Key,
  LayoutDashboard,
  Loader2,
  LogIn,
  LogOut,
  Mail,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  Trash2,
  User,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { exportInvoicePdf, exportQuotePdf } from "@/features/admin/billing/exportBillingPdf";
import {
  formatBillingStatusLabel,
  formatCents,
  formatDate,
  getInvoiceStatusColor,
  getQuoteStatusColor,
} from "@/features/admin/billing/helpers";
import {
  listInvoiceLines,
  listMyInvoices,
} from "@/features/admin/billing/services/invoices.service";
import {
  listMyQuotes,
  listQuoteLines,
} from "@/features/admin/billing/services/quotes.service";
import type { Invoice, Quote } from "@/features/admin/billing/types";

type TabId = "profil" | "abonnement" | "factures" | "devis" | "jetons" | "api";

const TABS: { id: TabId; label: string; icon: typeof User }[] = [
  { id: "profil",     label: "Profil",     icon: User },
  { id: "abonnement", label: "Abonnement", icon: CreditCard },
  { id: "factures",   label: "Factures",   icon: ReceiptText },
  { id: "devis",      label: "Devis",      icon: FileText },
  { id: "jetons",     label: "Jetons",     icon: Coins },
  { id: "api",        label: "Clés API",   icon: Key },
];

// ─── Types ───────────────────────────────────────────────────────────────────

interface AccountData {
  userId: string;
  email: string;
  fullName: string;
  isAdmin: boolean;
  planCode: string;
  tokens: number;
  transactions: TxRow[];
}

type TxRow = {
  id: string;
  type: string;
  amount: number;
  description: string | null;
  created_at: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildInitials(fullName?: string, email?: string): string {
  const trimmed = (fullName ?? "").trim();
  if (trimmed) {
    const parts = trimmed.split(/\s+/).filter(Boolean);
    const initials = ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
    if (initials) return initials;
  }
  return (email ?? "M").trim().slice(0, 2).toUpperCase();
}

const PLAN_LABELS: Record<string, string> = {
  free: "Compte gratuit",
  starter: "Abonnement Starter",
  pro: "Abonnement Pro",
  "promoteur-starter": "Promoteur Starter",
  "promoteur-pro": "Promoteur Pro",
  "promoteur-enterprise": "Promoteur Entreprise",
  "rehabilitation-starter": "Réhabilitation Starter",
  "rehabilitation-pro": "Réhabilitation Pro",
  "rehabilitation-enterprise": "Réhabilitation Entreprise",
};

function getPlanLabel(plan?: string): string {
  if (!plan || plan === "free") return "Compte gratuit";
  return PLAN_LABELS[plan] ?? plan;
}

function isPlanActive(plan?: string): boolean {
  return Boolean(plan) && plan !== "free";
}

function readLocalFullName(): string {
  try {
    const raw = localStorage.getItem("mimmoza.user");
    if (!raw) return "";
    return (JSON.parse(raw) as { fullName?: string })?.fullName ?? "";
  } catch {
    return "";
  }
}

async function clearLocalAccount() {
  localStorage.removeItem("mimmoza.user");
  localStorage.removeItem("mimmoza-auth");
  localStorage.removeItem("mimmoza.auth.v1");
  await supabase.auth.signOut().catch(() => undefined);
}

// ═════════════════════════════════════════════════════════════════════════════
// Page
// ═════════════════════════════════════════════════════════════════════════════

export default function ComptePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const rawTab = searchParams.get("tab") as TabId | null;
  const activeTab: TabId =
    rawTab && TABS.some((t) => t.id === rawTab) ? rawTab : "profil";

  const setTab = (t: TabId) =>
    setSearchParams(t === "profil" ? {} : { tab: t }, { replace: true });

  const [status, setStatus] = useState<"loading" | "ready" | "anon">("loading");
  const [data, setData] = useState<AccountData | null>(null);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const {
          data: { user: authUser },
        } = await supabase.auth.getUser();

        if (!authUser) {
          if (active) setStatus("anon");
          return;
        }

        const userId = authUser.id;
        const email = authUser.email ?? "";
        const metaName =
          (authUser.user_metadata?.full_name as string | undefined) ??
          (authUser.user_metadata?.fullName as string | undefined) ??
          "";
        const fullName = (metaName || readLocalFullName() || "").trim();

        const [adminRes, accountRes, txRes, orgRes] = await Promise.allSettled([
          supabase.from("admin_users").select("user_id").eq("user_id", userId).maybeSingle(),
          supabase.from("credit_accounts").select("current_credits").eq("user_id", userId).maybeSingle(),
          supabase
            .from("credit_transactions")
            .select("id, type, amount, description, created_at")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(10),
          supabase
            .from("organisation_members")
            .select("organisations(plan_code)")
            .eq("user_id", userId)
            .maybeSingle(),
        ]);

        const isAdmin =
          adminRes.status === "fulfilled" &&
          Boolean(adminRes.value.data) &&
          !adminRes.value.error;

        const tokens =
          accountRes.status === "fulfilled"
            ? accountRes.value.data?.current_credits ?? 0
            : 0;

        const transactions =
          txRes.status === "fulfilled" ? (txRes.value.data ?? []) : [];

        const planCode =
          orgRes.status === "fulfilled"
            ? ((orgRes.value.data?.organisations as { plan_code?: string } | null)
                ?.plan_code ?? "")
            : "";

        if (active) {
          setData({ userId, email, fullName, isAdmin, planCode, tokens, transactions });
          setStatus("ready");
        }
      } catch {
        if (active) setStatus("anon");
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  if (status === "loading") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-slate-400">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (status === "anon" || !data) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-6 py-16 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100">
          <User className="h-7 w-7 text-slate-400" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Vous n'êtes pas connecté
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Connectez-vous pour accéder à votre espace personnel.
          </p>
        </div>
        <Link
          to="/connexion"
          className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-600 to-sky-500 px-6 py-3 text-sm font-medium text-white shadow-md shadow-sky-200/60 transition-all hover:from-indigo-500 hover:to-sky-400"
        >
          <LogIn className="h-4 w-4" />
          Se connecter
        </Link>
      </div>
    );
  }

  const initials = buildInitials(data.fullName, data.email);

  const handleLogout = async () => {
    await clearLocalAccount();
    navigate("/", { replace: true });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5 py-4">
      {/* En-tête */}
      <div>
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 shadow-sm">
          <Sparkles className="h-3.5 w-3.5 text-sky-500" />
          Espace personnel
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
          Mon compte
        </h1>
        <p className="mt-1.5 text-sm text-slate-500">
          Profil, abonnement, factures, devis, jetons et clés API.
        </p>
      </div>

      {/* Carte identité */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-4 px-6 py-5">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-100 to-sky-100 text-lg font-bold text-indigo-700">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold text-slate-900">
              {data.fullName || "Utilisateur Mimmoza"}
            </p>
            <p className="mt-0.5 flex items-center gap-1.5 truncate text-sm text-slate-500">
              <Mail className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              {data.email || "—"}
            </p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            title="Se déconnecter"
            className="shrink-0 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-800"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Déconnexion</span>
          </button>
        </div>
      </div>

      {/* Onglets */}
      <div className="flex flex-wrap gap-1.5 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={[
                "inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition sm:text-sm",
                isActive
                  ? "bg-gradient-to-r from-indigo-600 to-sky-500 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
              ].join(" ")}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* Contenu */}
      {activeTab === "profil" && <ProfilPanel data={data} navigate={navigate} />}
      {activeTab === "abonnement" && <AbonnementPanel planCode={data.planCode} navigate={navigate} />}
      {activeTab === "factures" && <FacturesPanel />}
      {activeTab === "devis" && <DevisPanel />}
      {activeTab === "jetons" && (
        <JetonsPanel tokens={data.tokens} transactions={data.transactions} navigate={navigate} />
      )}
      {activeTab === "api" && <ApiPanel navigate={navigate} />}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Onglet : Profil (+ admin + zone RGPD)
// ═════════════════════════════════════════════════════════════════════════════

function ProfilPanel({
  data,
  navigate,
}: {
  data: AccountData;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteSuccess, setDeleteSuccess] = useState(false);
  const [rgpdOpen, setRgpdOpen] = useState(false);

  const handleDeleteAccount = async () => {
    if (deleteConfirm.trim().toUpperCase() !== "SUPPRIMER") {
      setDeleteError("Tapez SUPPRIMER pour confirmer la suppression du compte.");
      return;
    }
    setDeleteLoading(true);
    setDeleteError(null);

    try {
      let accessToken: string | null = null;
      const { data: sessionData } = await supabase.auth.getSession();
      accessToken = sessionData.session?.access_token ?? null;

      if (!accessToken) {
        try {
          const storageKey = Object.keys(localStorage).find(
            (k) => k.startsWith("sb-") && k.endsWith("-auth-token")
          );
          if (storageKey) {
            const raw = localStorage.getItem(storageKey);
            if (raw) {
              accessToken =
                (JSON.parse(raw) as { access_token?: string }).access_token ?? null;
            }
          }
        } catch {
          /* lecture localStorage echouee */
        }
      }

      if (!accessToken) {
        setDeleteError(
          "Session expiree. Deconnectez-vous, reconnectez-vous puis reessayez."
        );
        return;
      }

      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
      const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
      const fnUrl = `${SUPABASE_URL}/functions/v1/delete-account-v1`;

      const resp = await fetch(fnUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON,
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ confirm: true }),
      });

      let body: { success?: boolean; error?: string } = {};
      try {
        body = JSON.parse(await resp.text());
      } catch {
        /* reponse non-JSON */
      }

      if (!resp.ok || body.success === false) {
        setDeleteError(
          "Impossible de supprimer le compte pour le moment. Si le probleme persiste, contactez support@mimmoza.fr."
        );
        return;
      }

      await clearLocalAccount();
      setDeleteSuccess(true);
      setTimeout(() => navigate("/", { replace: true }), 1800);
    } catch {
      setDeleteError(
        "Impossible de supprimer le compte pour le moment. Si le probleme persiste, contactez support@mimmoza.fr."
      );
    } finally {
      setDeleteLoading(false);
    }
  };

  if (deleteSuccess) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-white/95 px-6 text-center backdrop-blur-sm">
        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-emerald-50 ring-8 ring-emerald-100/60">
          <CheckCircle2 className="h-14 w-14 text-emerald-500" strokeWidth={2.5} />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            VOTRE COMPTE EST BIEN SUPPRIME
          </h1>
          <p className="mt-3 text-sm text-slate-500">
            Vos donnees personnelles ont ete supprimees. Redirection vers l'accueil...
          </p>
        </div>
      </div>
    );
  }

  const planActive = isPlanActive(data.planCode);
  const planLabel = getPlanLabel(data.planCode);

  return (
    <div className="space-y-5">
      {data.isAdmin && (
        <div className="overflow-hidden rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-indigo-50 shadow-sm">
          <div className="flex items-center justify-between gap-4 px-6 py-5">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm">
                <ShieldCheck className="h-5 w-5 text-violet-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  Espace administration
                </p>
                <p className="mt-0.5 text-xs font-medium text-violet-600">
                  Acces administrateur actif
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => navigate("/admin")}
              className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-medium text-white shadow-sm transition hover:bg-violet-500"
            >
              <LayoutDashboard className="h-3.5 w-3.5" />
              Dashboard admin
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <User className="h-4 w-4 text-slate-400" />
            Informations du compte
          </div>
        </div>
        <div className="divide-y divide-slate-100">
          <div className="flex items-center justify-between gap-4 px-6 py-4">
            <span className="text-xs font-medium text-slate-500">Nom</span>
            <span className="text-sm font-medium text-slate-900">
              {data.fullName || "-"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4 px-6 py-4">
            <span className="text-xs font-medium text-slate-500">Email</span>
            <span className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
              <Mail className="h-3.5 w-3.5 text-slate-400" />
              {data.email || "-"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4 px-6 py-4">
            <span className="text-xs font-medium text-slate-500">Formule</span>
            <span
              className={[
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                planActive
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-slate-100 text-slate-600",
              ].join(" ")}
            >
              {planActive ? <BadgeCheck className="h-3.5 w-3.5" /> : null}
              {planLabel}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4 px-6 py-4">
            <span className="text-xs font-medium text-slate-500">Jetons</span>
            <button
              type="button"
              onClick={() => navigate("/compte?tab=jetons")}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900 transition hover:text-indigo-600"
            >
              <Coins className="h-3.5 w-3.5 text-sky-500" />
              {data.tokens}
              <ArrowRight className="h-3 w-3 text-slate-400" />
            </button>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <button
          type="button"
          onClick={() => setRgpdOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-4 px-6 py-4 text-left transition hover:bg-slate-50"
        >
          <span className="flex items-center gap-2 text-sm font-medium text-slate-600">
            <Trash2 className="h-4 w-4 text-slate-400" />
            Parametres avances du compte
          </span>
          <ChevronDown
            className={[
              "h-4 w-4 text-slate-400 transition-transform",
              rgpdOpen ? "rotate-180" : "",
            ].join(" ")}
          />
        </button>

        {rgpdOpen && (
          <div className="border-t border-red-100 bg-red-50/40">
            <div className="space-y-4 px-6 py-5">
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold text-red-700">
                  <Trash2 className="h-4 w-4" />
                  Supprimer definitivement mon compte
                </p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Cette action demande la suppression de votre compte et des donnees
                  personnelles associees. Elle est irreversible. Les donnees devant etre
                  conservees pour des obligations legales, notamment les factures, peuvent
                  etre conservees pendant la duree legale applicable.
                </p>
              </div>
              <label className="block">
                <span className="mb-2 block text-xs font-medium text-slate-600">
                  Pour confirmer, tapez SUPPRIMER
                </span>
                <input
                  value={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.value)}
                  placeholder="SUPPRIMER"
                  className="w-full rounded-xl border border-red-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-red-300 focus:ring-4 focus:ring-red-100"
                />
              </label>
              {deleteError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {deleteError}
                </div>
              )}
              <button
                type="button"
                onClick={handleDeleteAccount}
                disabled={deleteLoading || deleteConfirm.trim().toUpperCase() !== "SUPPRIMER"}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-red-300"
              >
                <Trash2 className="h-4 w-4" />
                {deleteLoading ? "Suppression en cours..." : "Supprimer mon compte"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Onglet : Abonnement
// ═════════════════════════════════════════════════════════════════════════════

function AbonnementPanel({
  planCode,
  navigate,
}: {
  planCode: string;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const planActive = isPlanActive(planCode);
  const planLabel = getPlanLabel(planCode);

  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <CreditCard className="h-4 w-4 text-slate-400" />
            Formule active
          </div>
        </div>
        <div className="px-6 py-5">
          {planActive ? (
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50">
                  <BadgeCheck className="h-5 w-5 text-emerald-500" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">{planLabel}</p>
                  <p className="mt-0.5 text-xs text-emerald-600">Formule active</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => navigate("/abonnement")}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-800"
              >
                Changer
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50">
                  <CircleAlert className="h-5 w-5 text-amber-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    Aucune formule active
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Accédez aux espaces Mimmoza en choisissant une offre.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => navigate("/abonnement")}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-sky-500 px-4 py-2.5 text-xs font-medium text-white shadow-sm shadow-sky-200/60 transition hover:from-indigo-500 hover:to-sky-400"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Voir les abonnements
              </button>
            </div>
          )}
        </div>
      </div>

      {!planActive && (
        <div className="overflow-hidden rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-sky-50 px-6 py-5 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm">
              <Sparkles className="h-5 w-5 text-indigo-500" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900">
                Débloquez tout Mimmoza
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Investisseur, Promoteur, Réhabilitation — choisissez la formule
                adaptée à votre usage.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => navigate("/abonnement")}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-sky-500 px-4 py-3 text-sm font-medium text-white shadow-sm shadow-sky-200/50 transition hover:from-indigo-500 hover:to-sky-400"
          >
            Voir les abonnements
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Briques communes documents
// ═════════════════════════════════════════════════════════════════════════════

function DocPanelShell({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof ReceiptText;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-6 py-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Icon className="h-4 w-4 text-slate-400" />
          {title}
        </div>
      </div>
      {children}
    </div>
  );
}

function EmptyDocs({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
        <Clock className="h-6 w-6 text-slate-400" />
      </div>
      <p className="text-sm font-semibold text-slate-700">{label}</p>
      <p className="max-w-sm text-xs leading-5 text-slate-500">
        Vous serez notifié ici dès qu'un document vous est adressé. Pour toute demande,
        contactez{" "}
        <a href="mailto:support@mimmoza.fr" className="font-medium text-indigo-600 hover:underline">
          support@mimmoza.fr
        </a>
        .
      </p>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Onglet : Factures
// ═════════════════════════════════════════════════════════════════════════════

function FacturesPanel() {
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listMyInvoices()
      .then((d) => { if (active) setInvoices(d); })
      .catch((e) => { if (active) { setError((e as Error).message); setInvoices([]); } });
    return () => { active = false; };
  }, []);

  const handleDownload = async (inv: Invoice) => {
    setDownloadingId(inv.id);
    setError(null);
    try {
      const lines = await listInvoiceLines(inv.id);
      await exportInvoicePdf(inv, lines);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <DocPanelShell icon={ReceiptText} title="Mes factures">
      {invoices === null ? (
        <div className="flex items-center justify-center py-12 text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : error && invoices.length === 0 ? (
        <div className="px-6 py-5 text-sm text-rose-600">{error}</div>
      ) : invoices.length === 0 ? (
        <EmptyDocs label="Aucune facture pour le moment" />
      ) : (
        <div className="divide-y divide-slate-100">
          {invoices.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between gap-3 px-6 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-indigo-700">
                    {inv.invoice_number}
                  </span>
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${getInvoiceStatusColor(inv.status)}`}>
                    {formatBillingStatusLabel(inv.status)}
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-slate-400">
                  Émise le {formatDate(inv.issue_date)} · échéance {formatDate(inv.due_date)}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-sm font-semibold tabular-nums text-slate-900">
                  {formatCents(inv.amount_ttc_cents)}
                </span>
                <button
                  type="button"
                  onClick={() => handleDownload(inv)}
                  disabled={downloadingId === inv.id}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  {downloadingId === inv.id
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <FileDown className="h-3.5 w-3.5" />}
                  PDF
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </DocPanelShell>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Onglet : Devis
// ═════════════════════════════════════════════════════════════════════════════

function DevisPanel() {
  const [quotes, setQuotes] = useState<Quote[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listMyQuotes()
      .then((d) => { if (active) setQuotes(d); })
      .catch((e) => { if (active) { setError((e as Error).message); setQuotes([]); } });
    return () => { active = false; };
  }, []);

  const handleDownload = async (q: Quote) => {
    setDownloadingId(q.id);
    setError(null);
    try {
      const lines = await listQuoteLines(q.id);
      await exportQuotePdf(q, lines);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <DocPanelShell icon={FileText} title="Mes devis">
      {quotes === null ? (
        <div className="flex items-center justify-center py-12 text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : error && quotes.length === 0 ? (
        <div className="px-6 py-5 text-sm text-rose-600">{error}</div>
      ) : quotes.length === 0 ? (
        <EmptyDocs label="Aucun devis pour le moment" />
      ) : (
        <div className="divide-y divide-slate-100">
          {quotes.map((q) => (
            <div key={q.id} className="flex items-center justify-between gap-3 px-6 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-indigo-700">
                    {q.quote_number}
                  </span>
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${getQuoteStatusColor(q.status)}`}>
                    {formatBillingStatusLabel(q.status)}
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-slate-400">
                  Émis le {formatDate(q.created_at)}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-sm font-semibold tabular-nums text-slate-900">
                  {formatCents(q.amount_ttc_cents)}
                </span>
                <button
                  type="button"
                  onClick={() => handleDownload(q)}
                  disabled={downloadingId === q.id}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  {downloadingId === q.id
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <FileDown className="h-3.5 w-3.5" />}
                  PDF
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </DocPanelShell>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Onglet : Jetons
// ═════════════════════════════════════════════════════════════════════════════

function JetonsPanel({
  tokens,
  transactions,
  navigate,
}: {
  tokens: number;
  transactions: TxRow[];
  navigate: ReturnType<typeof useNavigate>;
}) {
  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <Coins className="h-4 w-4 text-slate-400" />
            Jetons d'analyse
          </div>
        </div>
        <div className="flex items-center justify-between gap-4 px-6 py-5">
          <div className="flex items-center gap-3">
            <div
              className={[
                "flex h-10 w-10 items-center justify-center rounded-xl",
                tokens > 0 ? "bg-sky-50" : "bg-slate-100",
              ].join(" ")}
            >
              <Zap className={["h-5 w-5", tokens > 0 ? "text-sky-500" : "text-slate-400"].join(" ")} />
            </div>
            <div>
              <p className="text-2xl font-bold leading-none text-slate-900">{tokens}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {tokens === 1 ? "jeton disponible" : "jetons disponibles"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => navigate("/abonnement")}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-800"
          >
            Recharger
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <Clock className="h-4 w-4 text-slate-400" />
            Historique récent
          </div>
        </div>
        <div className="px-6 py-5">
          {transactions.length === 0 ? (
            <p className="text-sm text-slate-400">Aucune transaction pour le moment.</p>
          ) : (
            <div className="space-y-2">
              {transactions.map((tx) => {
                const isCredit = tx.amount > 0;
                const date = new Intl.DateTimeFormat("fr-FR", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                }).format(new Date(tx.created_at));
                return (
                  <div
                    key={tx.id}
                    className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium text-slate-800">
                        {tx.description ?? tx.type}
                      </div>
                      <div className="text-xs text-slate-400">{date}</div>
                    </div>
                    <span
                      className={[
                        "shrink-0 font-semibold tabular-nums",
                        isCredit ? "text-emerald-600" : "text-rose-500",
                      ].join(" ")}
                    >
                      {isCredit ? "+" : ""}
                      {tx.amount}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Onglet : Clés API
// ═════════════════════════════════════════════════════════════════════════════

function ApiPanel({ navigate }: { navigate: ReturnType<typeof useNavigate> }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-6 py-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Key className="h-4 w-4 text-slate-400" />
          Clés API
        </div>
      </div>
      <div className="flex flex-col items-start gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50">
            <Key className="h-5 w-5 text-indigo-500" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">
              Gérez vos clés d'accès à l'API
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              Création, révocation et suivi de consommation.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigate("/api/keys")}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-500 px-4 py-2.5 text-xs font-medium text-white shadow-sm transition hover:from-indigo-500 hover:to-violet-400"
        >
          Ouvrir mes clés API
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}