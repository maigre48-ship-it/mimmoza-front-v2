// src/spaces/particulier/pages/ComptePage.tsx
// ─── Espace personnel ─────────────────────────────────────────────────────────
// • Infos utilisateur (nom, email, initiales)
// • Plan actif + jetons restants
// • Bloc admin conditionnel (emails ADMIN_EMAILS) → /admin
// • Message "Aucune formule active" si plan free
// • Bouton "Voir les abonnements" → /abonnement
// • Si non connecté → invite à se connecter
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  ArrowRight,
  BadgeCheck,
  CircleAlert,
  Coins,
  CreditCard,
  LayoutDashboard,
  LogIn,
  LogOut,
  Mail,
  ShieldCheck,
  Sparkles,
  User,
  Zap,
} from "lucide-react";

// ── Emails administrateurs ────────────────────────────────────────────────────
const ADMIN_EMAILS: string[] = ["maigre48@gmail.com"];

// ── Types ─────────────────────────────────────────────────────────────────────

type StoredUser = {
  email?: string;
  logged?: boolean;
  fullName?: string;
  plan?: string;
  tokens?: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildInitials(fullName?: string, email?: string): string {
  const trimmed = (fullName ?? "").trim();
  if (trimmed) {
    const parts = trimmed.split(/\s+/).filter(Boolean);
    const first = parts[0]?.[0] ?? "";
    const second = parts[1]?.[0] ?? "";
    const initials = (first + second).toUpperCase();
    if (initials) return initials;
  }
  return (email ?? "M").trim().slice(0, 2).toUpperCase();
}

function readUser(): StoredUser | null {
  try {
    const raw = localStorage.getItem("mimmoza.user");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredUser;
    return parsed?.logged ? parsed : null;
  } catch {
    return null;
  }
}

const PLAN_LABELS: Record<string, string> = {
  free: "Compte gratuit",
  "tokens-10": "Pack 10 analyses",
  "tokens-20": "Pack 20 analyses",
  starter: "Abonnement Starter",
  pro: "Abonnement Pro",
  "promoteur-starter": "Promoteur Starter",
  "promoteur-pro": "Promoteur Pro",
  "promoteur-enterprise": "Promoteur Entreprise",
  "rehabilitation-starter": "Réhabilitation Starter",
  "rehabilitation-pro": "Réhabilitation Pro",
  "rehabilitation-enterprise": "Réhabilitation Entreprise",
  "apporteur-free": "Apporteur – Accès gratuit",
  "apporteur-commission": "Apporteur – Commission",
  "apporteur-partenariat": "Apporteur – Partenariat",
  "recharge-25": "Recharge 25 analyses",
  "recharge-50": "Recharge 50 analyses",
};

function getPlanLabel(plan?: string): string {
  if (!plan || plan === "free") return "Compte gratuit";
  return PLAN_LABELS[plan] ?? plan;
}

function isPlanActive(plan?: string): boolean {
  return Boolean(plan) && plan !== "free";
}

// ── Composant principal ───────────────────────────────────────────────────────

export default function ComptePage() {
  const navigate = useNavigate();

  const user = useMemo(() => readUser(), []);

  // ── Non connecté ─────────────────────────────────────────────────────────
  if (!user) {
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

  // ── Données ───────────────────────────────────────────────────────────────
  const initials = buildInitials(user.fullName, user.email);
  const planActive = isPlanActive(user.plan);
  const planLabel = getPlanLabel(user.plan);
  const tokens = user.tokens ?? 0;
  const isAdmin = ADMIN_EMAILS.includes((user.email ?? "").trim().toLowerCase());

  const handleLogout = () => {
    localStorage.removeItem("mimmoza.user");
    localStorage.removeItem("mimmoza-auth");
    navigate("/", { replace: true });
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4 py-4">

      {/* ── En-tête ─────────────────────────────────────────────────────── */}
      <div className="mb-6">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 shadow-sm">
          <Sparkles className="h-3.5 w-3.5 text-sky-500" />
          Espace personnel
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
          Mon compte
        </h1>
        <p className="mt-1.5 text-sm text-slate-500">
          Gérez votre profil, votre formule et vos jetons.
        </p>
      </div>

      {/* ── Carte profil ─────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-4 px-6 py-5">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-100 to-sky-100 text-lg font-bold text-indigo-700">
            {initials}
          </div>

          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold text-slate-900">
              {user.fullName?.trim() || "Utilisateur Mimmoza"}
            </p>
            <p className="mt-0.5 flex items-center gap-1.5 truncate text-sm text-slate-500">
              <Mail className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              {user.email ?? "—"}
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

      {/* ── Bloc administration (réservé aux admins) ──────────────────────── */}
      {isAdmin && (
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
                <p className="mt-0.5 text-xs text-violet-600 font-medium">
                  Accès administrateur actif
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

      {/* ── Formule active ────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <CreditCard className="h-4 w-4 text-slate-400" />
            Formule
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
                  <p className="text-sm font-semibold text-slate-900">
                    {planLabel}
                  </p>
                  <p className="mt-0.5 text-xs text-emerald-600">
                    Formule active
                  </p>
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

      {/* ── Jetons ───────────────────────────────────────────────────────── */}
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
              <Zap
                className={[
                  "h-5 w-5",
                  tokens > 0 ? "text-sky-500" : "text-slate-400",
                ].join(" ")}
              />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900 leading-none">
                {tokens}
              </p>
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

      {/* ── CTA abonnement (si pas de plan actif) ────────────────────────── */}
      {!planActive && (
        <div className="overflow-hidden rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-sky-50 px-6 py-5 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm">
              <Sparkles className="h-5 w-5 text-indigo-500" />
            </div>
            <div className="flex-1 min-w-0">
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