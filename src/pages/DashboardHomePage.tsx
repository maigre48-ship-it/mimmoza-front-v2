// src/pages/DashboardHomePage.tsx
// Ancienne HomePage déplacée ici — affichée sur /dashboard (utilisateurs connectés)
// v3 — Homepage orientée verticales métiers + section basse premium

import { useNavigate } from "react-router-dom";
import {
  Building2,
  Landmark,
  Handshake,
  Hammer,
  ArrowRight,
  Sparkles,
  MapPinned,
  ScanSearch,
  Layers3,
  Wallet,
  ShieldCheck,
  BrainCircuit,
} from "lucide-react";
import type { ComponentType } from "react";

type VerticalCard = {
  id: "promoteur" | "investisseur" | "apporteur" | "rehabilitation";
  title: string;
  badge: string;
  description: string;
  features: string[];
  icon: ComponentType<{ className?: string }>;
  gradient: string;
  border: string;
  button: string;
  route: string;
};

const VERTICALS: VerticalCard[] = [
  {
    id: "promoteur",
    title: "Promoteur",
    badge: "Cœur produit",
    description: "Analyse foncière, PLU, massing 3D et bilan promoteur complet.",
    features: ["Faisabilité foncière", "Lecture PLU", "Massing 3D", "Bilan promoteur"],
    icon: Building2,
    gradient: "from-violet-500/10 via-violet-500/5 to-transparent",
    border: "border-violet-200",
    button: "bg-violet-600 hover:bg-violet-700",
    route: "/promoteur",
  },
  {
    id: "investisseur",
    title: "Investisseur",
    badge: "Investissement",
    description: "Rentabilité, sourcing, stratégie patrimoniale et arbitrage.",
    features: ["Rentabilité", "Scoring", "Travaux", "Stratégie de sortie"],
    icon: Landmark,
    gradient: "from-blue-500/10 via-blue-500/5 to-transparent",
    border: "border-blue-200",
    button: "bg-blue-600 hover:bg-blue-700",
    route: "/marchand-de-bien",
  },
  {
    id: "apporteur",
    title: "Apporteur d'affaire",
    badge: "Mise en relation",
    description:
      "Qualifiez rapidement une opportunité et transmettez-la à un promoteur.",
    features: ["Qualification", "Pré-analyse", "Partage promoteur", "Synthèse PDF"],
    icon: Handshake,
    gradient: "from-emerald-500/10 via-emerald-500/5 to-transparent",
    border: "border-emerald-200",
    button: "bg-emerald-600 hover:bg-emerald-700",
    route: "/apporteur",
  },
  {
    id: "rehabilitation",
    title: "Réhabilitation",
    badge: "Bâti existant",
    description:
      "Transformez et valorisez un bien existant avec analyse travaux et conformité.",
    features: ["Estimation travaux", "Rendu IA", "Conformité", "Valorisation après travaux"],
    icon: Hammer,
    gradient: "from-amber-500/10 via-amber-500/5 to-transparent",
    border: "border-amber-200",
    button: "bg-amber-500 hover:bg-amber-600",
    route: "/rehabilitation",
  },
];

export default function DashboardHomePage() {
  const navigate = useNavigate();

  function enterVertical(vertical: VerticalCard) {
    try {
      localStorage.setItem("mimmoza.activeVertical", vertical.id);
    } catch {
      // noop
    }
    navigate(vertical.route);
  }

  return (
    <div className="min-h-screen bg-[#f7f8fc]">
      {/* ───────────────── HERO ───────────────── */}
      <section className="relative overflow-hidden border-b border-slate-200 bg-[#0f0b2e]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(124,111,205,0.35),transparent_35%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.18),transparent_30%)]" />

        <div className="relative mx-auto max-w-7xl px-6 py-20">
          <div className="max-w-4xl">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-violet-100 backdrop-blur">
              <Sparkles className="h-4 w-4" />
              Intelligence immobilière décisionnelle
            </div>

            <h1 className="max-w-4xl text-5xl font-black tracking-tight text-white sm:text-6xl">
              La plateforme IA des
              <span className="bg-gradient-to-r from-violet-300 via-blue-300 to-cyan-300 bg-clip-text text-transparent">
                {" "}professionnels de l'immobilier
              </span>
            </h1>

            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
              De l'analyse foncière à la réhabilitation complète, Mimmoza centralise
              faisabilité, travaux, marché, réglementation et valorisation dans un seul outil.
            </p>

            <div className="mt-10 flex max-w-2xl flex-col gap-3 sm:flex-row">
              <div className="flex flex-1 items-center gap-3 rounded-2xl border border-white/10 bg-white/10 px-4 py-4 backdrop-blur">
                <MapPinned className="h-5 w-5 text-violet-300" />
                <input
                  type="text"
                  placeholder="Entrez une adresse ou une ville..."
                  className="w-full bg-transparent text-white placeholder:text-slate-400 focus:outline-none"
                />
              </div>
              <button
                type="button"
                className="rounded-2xl bg-violet-600 px-6 py-4 font-semibold text-white transition-all hover:bg-violet-700"
              >
                Lancer l'analyse
              </button>
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              {["PLU", "Massing 3D", "Bilan promoteur", "Étude de marché", "Travaux", "Rendu façade IA"].map(
                (item) => (
                  <span
                    key={item}
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-300"
                  >
                    {item}
                  </span>
                )
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ───────────────── VERTICALES ───────────────── */}
      <section className="mx-auto max-w-7xl px-6 py-16">
        <div className="mb-10">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-slate-400">
            Choisissez votre profil
          </p>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-900">
            Une expérience spécialisée par métier
          </h2>
          <p className="mt-3 max-w-2xl text-base leading-7 text-slate-500">
            Chaque verticale dispose de ses propres outils, analyses, workflows et tableaux de bord.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-4">
          {VERTICALS.map((vertical) => {
            const Icon = vertical.icon;
            return (
              <div
                key={vertical.id}
                className={`group relative overflow-hidden rounded-3xl border bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl ${vertical.border}`}
              >
                <div className={`absolute inset-0 bg-gradient-to-br ${vertical.gradient}`} />

                <div className="relative flex h-full min-h-[500px] flex-col p-7">
                  <div className="flex items-start justify-between">
                    <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-slate-600">
                      {vertical.badge}
                    </div>
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
                      <Icon className="h-6 w-6 text-slate-700" />
                    </div>
                  </div>

                  <div className="mt-8">
                    <h3 className="text-2xl font-bold tracking-tight text-slate-900">
                      {vertical.title}
                    </h3>
                    <p className="mt-4 text-sm leading-7 text-slate-500">{vertical.description}</p>
                  </div>

                  <div className="mt-6 flex flex-wrap gap-2">
                    {vertical.features.map((feature) => (
                      <span
                        key={feature}
                        className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600"
                      >
                        {feature}
                      </span>
                    ))}
                  </div>

                  <div className="mt-auto pt-10">
                    <button
                      type="button"
                      onClick={() => enterVertical(vertical)}
                      className={`inline-flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold text-white transition-all ${vertical.button}`}
                    >
                      Entrer dans l'espace
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ───────────────── PREMIUM SECTION ───────────────── */}
      <section className="relative overflow-hidden border-y border-slate-200 bg-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(124,111,205,0.08),transparent_30%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.06),transparent_35%)]" />

        <div className="relative mx-auto max-w-7xl px-6 py-24">
          <div className="mx-auto max-w-3xl text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-700">
              <BrainCircuit className="h-4 w-4" />
              Plateforme immobilière augmentée par IA
            </div>
            <h2 className="mt-6 text-4xl font-black tracking-tight text-slate-900 sm:text-5xl">
              Une seule plateforme.
              <br />
              <span className="bg-gradient-to-r from-violet-600 via-blue-500 to-cyan-500 bg-clip-text text-transparent">
                Tous vos workflows immobiliers.
              </span>
            </h2>
            <p className="mt-6 text-lg leading-8 text-slate-500">
              Mimmoza centralise analyse foncière, réglementation, travaux, conformité, marché et
              valorisation dans une expérience unifiée pensée pour les professionnels.
            </p>
          </div>

          <div className="mt-20 grid gap-6 lg:grid-cols-4">
            <div className="group flex min-h-[310px] flex-col rounded-3xl border border-slate-200 bg-gradient-to-br from-violet-50 to-white p-7 shadow-sm transition-all hover:-translate-y-1 hover:shadow-xl">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-100">
                <ScanSearch className="h-7 w-7 text-violet-700" />
              </div>
              <h3 className="mt-6 text-xl font-bold text-slate-900">Décision en 2 minutes</h3>
              <p className="mt-4 text-sm leading-7 text-slate-500">
                Passez d'une adresse à une pré-analyse complète : PLU, risques, marché, potentiel et valorisation.
              </p>
              <div className="mt-auto flex flex-wrap gap-2 pt-6">
                <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-violet-700 shadow-sm">PLU</span>
                <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-violet-700 shadow-sm">Faisabilité</span>
              </div>
            </div>

            <div className="group flex min-h-[310px] flex-col rounded-3xl border border-slate-200 bg-gradient-to-br from-blue-50 to-white p-7 shadow-sm transition-all hover:-translate-y-1 hover:shadow-xl">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-100">
                <Layers3 className="h-7 w-7 text-blue-700" />
              </div>
              <h3 className="mt-6 text-xl font-bold text-slate-900">Vue 360° du projet</h3>
              <p className="mt-4 text-sm leading-7 text-slate-500">
                Marché, risques, travaux, réglementation et rentabilité réunis dans un cockpit décisionnel unique.
              </p>
              <div className="mt-auto flex flex-wrap gap-2 pt-6">
                <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-blue-700 shadow-sm">Marché</span>
                <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-blue-700 shadow-sm">Bilan</span>
              </div>
            </div>

            <div className="group flex min-h-[310px] flex-col rounded-3xl border border-slate-200 bg-gradient-to-br from-emerald-50 to-white p-7 shadow-sm transition-all hover:-translate-y-1 hover:shadow-xl">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100">
                <ShieldCheck className="h-7 w-7 text-emerald-700" />
              </div>
              <h3 className="mt-6 text-xl font-bold text-slate-900">Réglementation intégrée</h3>
              <p className="mt-4 text-sm leading-7 text-slate-500">
                PLU, OAP, PMR, sécurité incendie et contraintes réglementaires centralisées dans vos analyses.
              </p>
              <div className="mt-auto flex flex-wrap gap-2 pt-6">
                <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-emerald-700 shadow-sm">PMR</span>
                <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-emerald-700 shadow-sm">Sécurité</span>
              </div>
            </div>

            <div className="group flex min-h-[310px] flex-col rounded-3xl border border-slate-200 bg-gradient-to-br from-amber-50 to-white p-7 shadow-sm transition-all hover:-translate-y-1 hover:shadow-xl">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100">
                <Wallet className="h-7 w-7 text-amber-700" />
              </div>
              <h3 className="mt-6 text-xl font-bold text-slate-900">Valorisation d'actifs</h3>
              <p className="mt-4 text-sm leading-7 text-slate-500">
                Simulez coûts, potentiel de sortie, rentabilité et création de valeur avant acquisition.
              </p>
              <div className="mt-auto flex flex-wrap gap-2 pt-6">
                <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-amber-700 shadow-sm">Travaux</span>
                <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-amber-700 shadow-sm">ROI</span>
              </div>
            </div>
          </div>

          <div className="mt-16 overflow-hidden rounded-[2rem] border border-slate-200 bg-slate-950 shadow-2xl">
            <div className="grid lg:grid-cols-[1.1fr_0.9fr]">
              <div className="p-8 sm:p-10">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-300">
                  Workflow unifié
                </div>
                <h3 className="mt-6 text-3xl font-black tracking-tight text-white">
                  Du premier signal au dossier prêt à présenter.
                </h3>
                <p className="mt-5 max-w-xl text-sm leading-7 text-slate-400">
                  Mimmoza structure les données, qualifie les risques, produit les hypothèses économiques
                  et prépare les restitutions professionnelles pour vos comités, partenaires ou clients.
                </p>
                <button
                  type="button"
                  onClick={() => navigate("/promoteur")}
                  className="mt-8 inline-flex items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition-all hover:bg-slate-100"
                >
                  Explorer le cockpit promoteur
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>

              <div className="border-t border-white/10 bg-white/[0.03] p-8 sm:p-10 lg:border-l lg:border-t-0">
                <div className="space-y-4">
                  {[
                    "Analyse adresse & parcelle",
                    "Contraintes PLU / OAP / risques",
                    "Scénario travaux ou massing",
                    "Marché, prix de sortie et rentabilité",
                    "Synthèse PDF prête à partager",
                  ].map((step, index) => (
                    <div
                      key={step}
                      className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-sm font-bold text-slate-950">
                        {index + 1}
                      </div>
                      <span className="text-sm font-medium text-slate-200">{step}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}