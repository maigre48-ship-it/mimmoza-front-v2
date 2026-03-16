import { Link } from "react-router-dom";
import {
  ArrowRight,
  BarChart3,
  Building2,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Layers3,
  CheckCircle2,
} from "lucide-react";

type HomeSpaceCard = {
  id: string;
  title: string;
  description: string;
  route: string;
  icon: React.ComponentType<{ className?: string }>;
  badge: string;
  accentClass: string;
  ringClass: string;
  points: string[];
};

const spaces: HomeSpaceCard[] = [
  {
    id: "investisseur",
    title: "Investisseur particulier et marchand de bien",
    description:
      "Analyse rapide d’opportunités, scoring, rentabilité, exécution des travaux et stratégie de sortie.",
    route: "/marchand-de-bien",
    icon: BarChart3,
    badge: "Investissement",
    accentClass:
      "from-indigo-600 via-blue-600 to-cyan-500",
    ringClass:
      "group-hover:ring-indigo-200 group-hover:border-indigo-200",
    points: ["Sourcing", "Analyse", "Simulation"],
  },
  {
    id: "promoteur",
    title: "Promoteur",
    description:
      "Faisabilité foncière, lecture PLU, analyse des risques, massing et bilan promoteur.",
    route: "/promoteur",
    icon: Building2,
    badge: "Développement",
    accentClass:
      "from-sky-600 via-cyan-500 to-teal-400",
    ringClass:
      "group-hover:ring-cyan-200 group-hover:border-cyan-200",
    points: ["Foncier", "Risques", "Bilan"],
  },
  {
    id: "financeur",
    title: "Financeur",
    description:
      "Étude du risque, comité crédit, lecture des garanties et pilotage des dossiers de financement.",
    route: "/banque",
    icon: ShieldCheck,
    badge: "Décision crédit",
    accentClass:
      "from-slate-700 via-slate-800 to-indigo-700",
    ringClass:
      "group-hover:ring-slate-200 group-hover:border-slate-200",
    points: ["Risque", "Comité", "Suivi"],
  },
];

const trustPoints = [
  "Scoring intelligent",
  "Analyse parcellaire",
  "Études de marché",
  "Aide à la décision",
];

export default function HomePage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-50">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-0 top-0 h-[520px] w-full bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.18),_transparent_42%),radial-gradient(circle_at_top_right,_rgba(6,182,212,0.14),_transparent_30%),linear-gradient(180deg,_#f8fbff_0%,_#eef6ff_38%,_#f8fafc_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.08)_1px,transparent_1px)] bg-[size:32px_32px] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]" />
      </div>

      <section className="relative mx-auto max-w-7xl px-4 pb-12 pt-10 lg:px-6 lg:pb-16 lg:pt-16">
        <div className="mx-auto max-w-4xl text-center">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-sky-200/80 bg-white/80 px-4 py-2 text-sm font-medium text-sky-700 shadow-sm backdrop-blur">
            <Sparkles className="h-4 w-4" />
            Intelligence immobilière décisionnelle
          </div>

          <h1 className="mx-auto max-w-4xl text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl lg:text-6xl">
            Une plateforme unique pour{" "}
            <span className="bg-gradient-to-r from-indigo-600 via-sky-500 to-cyan-500 bg-clip-text text-transparent">
              analyser, décider et piloter
            </span>{" "}
            vos opérations immobilières
          </h1>

          <p className="mx-auto mt-6 max-w-3xl text-base leading-8 text-slate-600 sm:text-lg">
            Mimmoza centralise l’analyse de faisabilité, le scoring, la lecture
            des risques, les études de marché et les outils opérationnels pour
            investisseurs, promoteurs et financeurs.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            {trustPoints.map((point) => (
              <span
                key={point}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 shadow-sm"
              >
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                {point}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-14 grid gap-6 lg:grid-cols-3">
          {spaces.map((space) => {
            const Icon = space.icon;

            return (
              <Link
                key={space.id}
                to={space.route}
                className={`group relative overflow-hidden rounded-3xl border border-white/70 bg-white/90 p-7 shadow-[0_10px_40px_rgba(15,23,42,0.06)] ring-1 ring-transparent backdrop-blur transition-all duration-300 hover:-translate-y-1.5 hover:shadow-[0_18px_60px_rgba(15,23,42,0.12)] ${space.ringClass}`}
              >
                <div
                  className={`absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r ${space.accentClass}`}
                />

                <div className="flex items-start justify-between gap-4">
                  <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                    {space.badge}
                  </div>

                  <div
                    className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${space.accentClass} text-white shadow-lg shadow-slate-200/50 transition-transform duration-300 group-hover:scale-105`}
                  >
                    <Icon className="h-6 w-6" />
                  </div>
                </div>

                <div className="mt-8">
                  <h2 className="text-2xl font-semibold tracking-tight text-slate-950">
                    {space.title}
                  </h2>
                  <p className="mt-4 text-[15px] leading-7 text-slate-600">
                    {space.description}
                  </p>
                </div>

                <div className="mt-7 flex flex-wrap gap-2">
                  {space.points.map((point) => (
                    <span
                      key={point}
                      className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600"
                    >
                      {point}
                    </span>
                  ))}
                </div>

                <div className="mt-8 flex items-center justify-between border-t border-slate-100 pt-5">
                  <span className="text-sm font-medium text-slate-700">
                    Ouvrir l’espace
                  </span>
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 transition-all duration-300 group-hover:border-slate-300 group-hover:text-slate-950">
                    <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        <div className="mt-14 grid gap-4 rounded-3xl border border-slate-200/80 bg-white/80 p-6 shadow-sm backdrop-blur md:grid-cols-3">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-xl bg-indigo-50 p-2 text-indigo-600">
              <TrendingUp className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Décision plus rapide
              </h3>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Des interfaces pensées pour aller de l’opportunité à la décision.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-xl bg-cyan-50 p-2 text-cyan-600">
              <Layers3 className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Vue unifiée des dossiers
              </h3>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Marché, risques, faisabilité et exploitation dans une seule plateforme.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-xl bg-emerald-50 p-2 text-emerald-600">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Restitution professionnelle
              </h3>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Un rendu premium adapté à l’analyse, à la présentation et au comité.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}