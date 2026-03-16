import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  CheckCircle2,
  CreditCard,
  LogOut,
  ShieldCheck,
  Sparkles,
  Ticket,
  UserCircle2,
} from "lucide-react";
import { VeilleSummaryCard } from "@/spaces/investisseur/components/veille/VeilleSummaryCard";

type StoredUser = {
  email?: string;
  logged?: boolean;
  fullName?: string;
  plan?: string;
  tokens?: number;
};

function getPlanLabel(plan?: string): string {
  switch (plan) {
    case "pro":
      return "Pro";
    case "starter":
      return "Starter";
    default:
      return "Gratuit";
  }
}

function getPlanPrice(plan?: string): string {
  switch (plan) {
    case "pro":
      return "99€ / mois";
    case "starter":
      return "29€ / mois";
    default:
      return "0€ / mois";
  }
}

function getInitials(fullName?: string, email?: string): string {
  const name = (fullName ?? "").trim();

  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    const initials = parts
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("");

    if (initials) return initials;
  }

  return (email ?? "AM").slice(0, 2).toUpperCase();
}

export default function ComptePage() {
  const navigate = useNavigate();

  const user = useMemo<StoredUser>(() => {
    try {
      const raw = localStorage.getItem("mimmoza.user");
      return raw ? (JSON.parse(raw) as StoredUser) : {};
    } catch {
      return {};
    }
  }, []);

  const isLogged = Boolean(user.logged && user.email);

  const logout = () => {
    localStorage.removeItem("mimmoza.user");
    navigate("/connexion");
  };

  if (!isLogged) {
    navigate("/connexion");
    return null;
  }

  const initials = getInitials(user.fullName, user.email);
  const planLabel = getPlanLabel(user.plan);
  const planPrice = getPlanPrice(user.plan);
  const tokens = typeof user.tokens === "number" ? user.tokens : 0;

  return (
    <div className="relative overflow-hidden rounded-[32px] border border-slate-200/80 bg-white shadow-sm">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.12),_transparent_35%),radial-gradient(circle_at_top_right,_rgba(6,182,212,0.10),_transparent_28%),linear-gradient(180deg,_#f8fbff_0%,_#ffffff_38%,_#f8fafc_100%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.06)_1px,transparent_1px)] bg-[size:28px_28px] [mask-image:linear-gradient(to_bottom,black,transparent_90%)]" />

      <div className="relative mx-auto grid min-h-[calc(100vh-10rem)] max-w-6xl gap-8 px-6 py-10 lg:grid-cols-[1.08fr_0.92fr] lg:px-10 lg:py-14">
        <div className="flex flex-col justify-center">
          <div className="mb-5 inline-flex w-fit items-center gap-2 rounded-full border border-sky-200 bg-white/85 px-4 py-2 text-sm font-medium text-sky-700 shadow-sm">
            <Sparkles className="h-4 w-4" />
            Mon espace Mimmoza
          </div>

          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
            Gérez votre{" "}
            <span className="bg-gradient-to-r from-indigo-600 via-sky-500 to-cyan-500 bg-clip-text text-transparent">
              compte, abonnement et jetons
            </span>
          </h1>

          <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">
            Retrouvez ici vos informations personnelles, votre formule actuelle
            et vos accès à la gestion d’abonnement ainsi qu’aux jetons Mimmoza.
          </p>

          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white/85 p-4 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <ShieldCheck className="h-4 w-4 text-emerald-500" />
                Compte actif
              </div>
              <div className="mt-1 text-sm leading-6 text-slate-600">
                Votre accès utilisateur est bien enregistré dans cette V1 locale.
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white/85 p-4 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <CreditCard className="h-4 w-4 text-sky-500" />
                Facturation prête
              </div>
              <div className="mt-1 text-sm leading-6 text-slate-600">
                La structure est prête pour brancher l’abonnement, les jetons et
                le portail client.
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-start">
          <div className="w-full space-y-5">
            <div className="rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-[0_10px_40px_rgba(15,23,42,0.06)] backdrop-blur sm:p-8">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 via-sky-500 to-cyan-500 text-lg font-semibold text-white shadow-lg shadow-sky-100">
                    {initials}
                  </div>

                  <div>
                    <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                      <UserCircle2 className="h-3.5 w-3.5" />
                      Compte
                    </div>

                    <h2 className="mt-3 text-2xl font-semibold text-slate-950">
                      {user.fullName?.trim() || "Utilisateur Mimmoza"}
                    </h2>

                    <p className="mt-1 break-all text-sm text-slate-500">
                      {user.email}
                    </p>
                  </div>
                </div>

                <div className="hidden sm:flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                  <CheckCircle2 className="mr-1.5 h-4 w-4" />
                  Actif
                </div>
              </div>

              <div className="mt-8 grid gap-4 sm:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-medium text-slate-500">
                    Adresse email
                  </div>
                  <div className="mt-1 break-all text-base font-semibold text-slate-950">
                    {user.email}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-medium text-slate-500">
                    Formule actuelle
                  </div>
                  <div className="mt-1 text-base font-semibold text-slate-950">
                    {planLabel}
                  </div>
                  <div className="mt-1 text-sm text-slate-500">{planPrice}</div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
                    <Ticket className="h-4 w-4 text-amber-500" />
                    Jetons disponibles
                  </div>
                  <div className="mt-1 text-base font-semibold text-slate-950">
                    {tokens}
                  </div>
                  <div className="mt-1 text-sm text-slate-500">
                    Solde actuel de votre compte
                  </div>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => navigate("/abonnement")}
                  className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3.5 text-sm font-medium text-white transition-all hover:bg-slate-800"
                >
                  <CreditCard className="h-4 w-4" />
                  Gérer mon abonnement
                </button>

                <button
                  type="button"
                  onClick={() => navigate("/jetons")}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3.5 text-sm font-medium text-slate-700 transition-all hover:bg-slate-50 hover:text-slate-900"
                >
                  <Ticket className="h-4 w-4" />
                  Gérer mes jetons
                </button>

                <button
                  type="button"
                  onClick={logout}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3.5 text-sm font-medium text-slate-700 transition-all hover:bg-slate-50 hover:text-slate-900"
                >
                  <LogOut className="h-4 w-4" />
                  Déconnexion
                </button>
              </div>
            </div>

            <VeilleSummaryCard />

            <div className="grid gap-5 md:grid-cols-2">
              <div className="rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
                <div className="flex h-full flex-col">
                  <h3 className="text-lg font-semibold text-slate-950">
                    Abonnement Mimmoza
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    Consultez les offres disponibles et gérez votre formule
                    actuelle.
                  </p>

                  <div className="mt-5">
                    <Link
                      to="/abonnement"
                      className="inline-flex items-center gap-2 text-sm font-medium text-sky-700 transition hover:text-sky-800"
                    >
                      Voir les offres
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
                <div className="flex h-full flex-col">
                  <h3 className="text-lg font-semibold text-slate-950">
                    Jetons Mimmoza
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    Achetez ou consultez vos jetons pour lancer vos analyses et
                    exports.
                  </p>

                  <div className="mt-5">
                    <Link
                      to="/jetons"
                      className="inline-flex items-center gap-2 text-sm font-medium text-sky-700 transition hover:text-sky-800"
                    >
                      Ouvrir les jetons
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
                <div className="flex h-full flex-col">
                  <h3 className="text-lg font-semibold text-slate-950">
                    Paramètres de veille
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    Gérez les zones et critères que Mimmoza doit surveiller pour
                    vous signaler les nouveaux biens, baisses de prix et
                    opportunités.
                  </p>

                  <div className="mt-5">
                    <button
                      type="button"
                      onClick={() => navigate("/parametres/veille")}
                      className="inline-flex items-center gap-2 text-sm font-medium text-sky-700 transition hover:text-sky-800"
                    >
                      Configurer ma veille
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
                <div className="flex h-full flex-col">
                  <h3 className="text-lg font-semibold text-slate-950">
                    Retour à la plateforme
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    Reprenez votre navigation dans Mimmoza et accédez directement
                    à l’espace investisseur.
                  </p>

                  <div className="mt-5">
                    <button
                      type="button"
                      onClick={() => navigate("/marchand-de-bien")}
                      className="inline-flex items-center gap-2 text-sm font-medium text-sky-700 transition hover:text-sky-800"
                    >
                      Ouvrir la plateforme
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}