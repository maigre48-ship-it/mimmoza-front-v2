import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  CheckCircle2,
  CreditCard,
  History,
  Sparkles,
  Ticket,
} from "lucide-react";

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

export default function JetonsPage() {
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

  if (!isLogged) {
    navigate("/connexion");
    return null;
  }

  const tokens = typeof user.tokens === "number" ? user.tokens : 0;
  const planLabel = getPlanLabel(user.plan);

  return (
    <div className="relative overflow-hidden rounded-[32px] border border-slate-200/80 bg-white shadow-sm">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.12),_transparent_35%),radial-gradient(circle_at_top_right,_rgba(6,182,212,0.10),_transparent_28%),linear-gradient(180deg,_#f8fbff_0%,_#ffffff_38%,_#f8fafc_100%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.06)_1px,transparent_1px)] bg-[size:28px_28px] [mask-image:linear-gradient(to_bottom,black,transparent_90%)]" />

      <div className="relative mx-auto max-w-6xl px-6 py-10 lg:px-10 lg:py-14">
        <div className="mb-8">
          <div className="mb-5 inline-flex w-fit items-center gap-2 rounded-full border border-sky-200 bg-white/85 px-4 py-2 text-sm font-medium text-sky-700 shadow-sm">
            <Sparkles className="h-4 w-4" />
            Jetons Mimmoza
          </div>

          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
            Gérez vos{" "}
            <span className="bg-gradient-to-r from-indigo-600 via-sky-500 to-cyan-500 bg-clip-text text-transparent">
              jetons d’analyse
            </span>
          </h1>

          <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">
            Consultez votre solde actuel, préparez vos prochains achats et
            accédez à la gestion de votre abonnement.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-6">
            <div className="rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-[0_10px_40px_rgba(15,23,42,0.06)] backdrop-blur sm:p-8">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-amber-700">
                    <Ticket className="h-3.5 w-3.5" />
                    Solde disponible
                  </div>

                  <div className="mt-4 flex items-end gap-3">
                    <div className="text-5xl font-semibold tracking-tight text-slate-950">
                      {tokens}
                    </div>
                    <div className="pb-1 text-sm text-slate-500">jetons</div>
                  </div>

                  <p className="mt-4 max-w-xl text-sm leading-6 text-slate-600">
                    Chaque jeton pourra être utilisé pour lancer certaines
                    analyses, exports ou fonctionnalités premium selon votre
                    formule.
                  </p>
                </div>

                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700">
                  <span className="inline-flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" />
                    Plan {planLabel}
                  </span>
                </div>
              </div>

              <div className="mt-8 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => navigate("/abonnement")}
                  className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3.5 text-sm font-medium text-white transition-all hover:bg-slate-800"
                >
                  <CreditCard className="h-4 w-4" />
                  Acheter des jetons
                </button>

                <button
                  type="button"
                  onClick={() => navigate("/compte")}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3.5 text-sm font-medium text-slate-700 transition-all hover:bg-slate-50 hover:text-slate-900"
                >
                  Retour au compte
                </button>
              </div>
            </div>

            <div className="grid gap-5 md:grid-cols-3">
              <div className="rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Ticket className="h-4 w-4 text-amber-500" />
                  Pack découverte
                </div>
                <div className="mt-4 text-3xl font-semibold text-slate-950">
                  10
                </div>
                <div className="mt-1 text-sm text-slate-500">jetons</div>
                <p className="mt-4 text-sm leading-6 text-slate-600">
                  Idéal pour tester quelques analyses et exports sans engagement
                  important.
                </p>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Sparkles className="h-4 w-4 text-sky-500" />
                  Pack standard
                </div>
                <div className="mt-4 text-3xl font-semibold text-slate-950">
                  25
                </div>
                <div className="mt-1 text-sm text-slate-500">jetons</div>
                <p className="mt-4 text-sm leading-6 text-slate-600">
                  Un format équilibré pour un usage plus régulier de la
                  plateforme.
                </p>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <History className="h-4 w-4 text-indigo-500" />
                  Pack intensif
                </div>
                <div className="mt-4 text-3xl font-semibold text-slate-950">
                  50
                </div>
                <div className="mt-1 text-sm text-slate-500">jetons</div>
                <p className="mt-4 text-sm leading-6 text-slate-600">
                  Adapté aux usages fréquents, aux simulations répétées et aux
                  exports réguliers.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-5">
            <div className="rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
              <h2 className="text-xl font-semibold text-slate-950">
                Comment fonctionnent les jetons ?
              </h2>

              <div className="mt-5 space-y-4 text-sm leading-6 text-slate-600">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  Les jetons servent de réserve d’usage pour certaines actions
                  premium de Mimmoza.
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  Votre abonnement peut inclure un certain niveau d’accès, puis
                  les jetons viennent compléter vos besoins ponctuels ou
                  intensifs.
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  Cette V1 prépare la future connexion au paiement en ligne et à
                  l’historique détaillé de consommation.
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
              <h3 className="text-lg font-semibold text-slate-950">
                Aller plus loin
              </h3>

              <div className="mt-5 space-y-4">
                <Link
                  to="/abonnement"
                  className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm font-medium text-slate-700 transition hover:bg-white"
                >
                  <span>Voir les offres d’abonnement</span>
                  <ArrowRight className="h-4 w-4" />
                </Link>

                <Link
                  to="/compte"
                  className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm font-medium text-slate-700 transition hover:bg-white"
                >
                  <span>Retourner à mon compte</span>
                  <ArrowRight className="h-4 w-4" />
                </Link>

                <button
                  type="button"
                  onClick={() => navigate("/marchand-de-bien")}
                  className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm font-medium text-slate-700 transition hover:bg-white"
                >
                  <span>Revenir à la plateforme</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}