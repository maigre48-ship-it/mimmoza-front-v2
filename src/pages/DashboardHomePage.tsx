// src/pages/DashboardHomePage.tsx
// Ancienne HomePage déplacée ici — affichée sur /dashboard (utilisateurs connectés)
// v4 — HERO moteur de décision + bloc "Analyse Rapide" mocké
//      Reste de la page inchangé (verticales + section IA + workflow)

import {
  Activity,
  ArrowRight,
  BrainCircuit,
  Building2,
  Bus,
  Gauge,
  GraduationCap,
  Hammer,
  Handshake,
  Landmark,
  Layers3,
  LineChart,
  MapPinned,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Store,
  TrendingUp,
  Wallet,
  Zap,
} from "lucide-react";
import type { ComponentType } from "react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { userStorage } from "@/lib/storage/userScopedStorage";
import { ACTION_COSTS } from "@/lib/billing/actionCosts";

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
    id: "investisseur",
    title: "Investissement",
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
    id: "promoteur",
    title: "Promotion",
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
  {
    id: "apporteur",
    title: "Apport d'affaires",
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
];

// ───────────────── Données mockées (Hero uniquement) ─────────────────
// Aligné sur la vraie sortie du moteur "Analyse rapide" :
// Score opportunité, Sécurité du projet, Valeur estimée + fourchette + €/m²,
// Écart prix/estimation, Fiabilité, sous-scores d'emplacement.
const HERO_BADGES = ["PLU", "Faisabilité", "Marché", "Travaux", "Rentabilité", "Valorisation"];

const MOCK_ANALYSE = {
  adresse: "15 Rue de la République, 69002 Lyon",
  parcelle: "AB123",
  surface: "520 m²",
  scoreOpportunite: 82,
  scoreLabel: "Bonne opportunité",
  positionnement: "Prix cohérent avec le marché",
  securite: 96,
  fiabilite: 67,
  valeurEstimee: "485 000 €",
  fourchetteBasse: "461 000 €",
  fourchetteHaute: "509 000 €",
  prixDemande: "460 000 €",
  marcheM2: "6 730 €/m²",
  ecart: "+25 000 €",
  ecartPct: "+5,4 %",
  scoreLocalisation: 83,
};

// Sous-scores d'emplacement (cf. carte EMPLACEMENT du moteur réel)
const EMPLACEMENT = [
  { label: "Transports", value: 78, icon: Bus },
  { label: "Commerces", value: 85, icon: Store },
  { label: "Écoles", value: 90, icon: GraduationCap },
  { label: "Marché", value: 80, icon: LineChart },
];

export default function DashboardHomePage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  // Lance l'analyse rapide en transmettant l'adresse saisie (evite la double saisie).
  function launchQuickAnalysis() {
    navigate("/analyse-rapide", { state: { prefillAddress: query.trim() } });
  }

  function enterVertical(vertical: VerticalCard) {
    try {
      userStorage.setItem("mimmoza.activeVertical", vertical.id);
    } catch {
      // noop
    }
    navigate(vertical.route);
  }

  return (
    <div className="min-h-screen bg-[#f7f8fc]">
      {/* ───────────────── HERO ───────────────── */}
      <section className="relative overflow-hidden border-b border-slate-200 bg-gradient-to-br from-[#0b0820] via-[#140a36] to-[#1d0f4d]">
        {/* halos lumineux */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(139,92,246,0.30),transparent_40%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_right,rgba(56,189,248,0.16),transparent_38%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.10),transparent_55%)]" />

        <div className="relative mx-auto max-w-7xl px-6 pt-20 pb-14">
          <div className="max-w-4xl">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-violet-100 backdrop-blur">
              <Sparkles className="h-4 w-4" />
              Intelligence immobilière décisionnelle
            </div>

            <h1 className="max-w-4xl text-4xl font-black uppercase leading-[1.05] tracking-tight text-white sm:text-6xl">
              L'intelligence immobilière
              <span className="block bg-gradient-to-r from-violet-300 via-blue-300 to-cyan-300 bg-clip-text text-transparent">
                décisionnelle
              </span>
            </h1>

            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
              Analysez un bien, une parcelle ou un projet en moins de 2 minutes.
            </p>

            {/* Barre de recherche */}
            <div className="mt-10 flex max-w-2xl flex-col gap-3 sm:flex-row">
              <div className="flex flex-1 items-center gap-3 rounded-2xl border border-white/10 bg-white/10 px-5 py-4 shadow-lg shadow-violet-950/30 backdrop-blur transition-colors focus-within:border-violet-400/40">
                <MapPinned className="h-5 w-5 shrink-0 text-violet-300" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") launchQuickAnalysis(); }}
                  placeholder="Entrez une adresse, une parcelle ou une ville..."
                  className="w-full bg-transparent text-white placeholder:text-slate-400 focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={launchQuickAnalysis}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 px-6 py-4 font-semibold text-white shadow-lg shadow-violet-900/40 transition-all hover:from-violet-500 hover:to-indigo-500"
              >
                <Zap className="h-5 w-5" />
                Analyse rapide
              </button>
            </div>

            {/* Mention cout */}
            <p className="mt-3 flex items-center gap-1.5 text-sm text-slate-400">
              <Zap className="h-3.5 w-3.5 text-violet-300" />
              Une analyse rapide coûte <span className="font-semibold text-violet-200">{ACTION_COSTS.analyse_rapide} jetons</span>.
            </p>

            {/* Badges */}
            <div className="mt-6 flex flex-wrap gap-2">
              {HERO_BADGES.map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-300"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>

          {/* ───────────────── BLOC ANALYSE RAPIDE (mock) ───────────────── */}
          <div className="mt-14 overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.04] shadow-2xl shadow-violet-950/40 backdrop-blur">
            {/* En-tête du dossier */}
            <div className="flex flex-col gap-4 border-b border-white/10 bg-white/[0.03] px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/20 text-violet-200">
                  <ScanSearch className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold uppercase tracking-[0.2em] text-white">
                      Analyse rapide
                    </p>
                    <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-300">
                      Exemple
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-300">{MOCK_ANALYSE.adresse}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 font-medium text-slate-300">
                  Parcelle <span className="text-white">{MOCK_ANALYSE.parcelle}</span>
                </span>
                <span className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 font-medium text-slate-300">
                  Surface <span className="text-white">{MOCK_ANALYSE.surface}</span>
                </span>
              </div>
            </div>

            {/* Grille des cartes */}
            <div className="grid gap-4 p-6 md:grid-cols-2 lg:grid-cols-3">
              {/* CARTE 1 — Score opportunité + Sécurité du projet */}
              <div className="flex flex-col rounded-2xl border border-white/10 bg-gradient-to-br from-violet-500/10 to-transparent p-5">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  <Gauge className="h-4 w-4 text-violet-300" />
                  Score opportunité
                </div>
                <div className="mt-4 flex items-end gap-1">
                  <span className="text-5xl font-black text-white">{MOCK_ANALYSE.scoreOpportunite}</span>
                  <span className="mb-1 text-lg font-semibold text-slate-400">/ 100</span>
                </div>
                <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-violet-400 to-cyan-400"
                    style={{ width: `${MOCK_ANALYSE.scoreOpportunite}%` }}
                  />
                </div>
                <div className="mt-3">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-300">
                    <Sparkles className="h-3.5 w-3.5" />
                    {MOCK_ANALYSE.scoreLabel}
                  </span>
                  <p className="mt-2 text-xs text-slate-400">{MOCK_ANALYSE.positionnement}</p>
                </div>
                <div className="mt-auto flex items-center justify-between border-t border-white/10 pt-3 text-sm">
                  <span className="flex items-center gap-2 text-slate-400">
                    <ShieldCheck className="h-4 w-4 text-emerald-400" />
                    Sécurité du projet
                  </span>
                  <span className="font-semibold text-emerald-300">{MOCK_ANALYSE.securite}/100</span>
                </div>
              </div>

              {/* CARTE 2 — Valeur estimée (moteur Mimmoza) */}
              <div className="flex flex-col rounded-2xl border border-white/10 bg-gradient-to-br from-blue-500/10 to-transparent p-5">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  <Wallet className="h-4 w-4 text-blue-300" />
                  Valeur estimée — moteur Mimmoza
                </div>
                <div className="mt-4">
                  <span className="text-3xl font-black text-white">{MOCK_ANALYSE.valeurEstimee}</span>
                  <p className="mt-1 text-xs text-slate-400">
                    {MOCK_ANALYSE.fourchetteBasse} → {MOCK_ANALYSE.fourchetteHaute}
                  </p>
                  <p className="text-xs text-slate-400">Marché : {MOCK_ANALYSE.marcheM2}</p>
                </div>
                <div className="mt-4 space-y-2 border-t border-white/10 pt-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Prix demandé</span>
                    <span className="font-semibold text-slate-200">{MOCK_ANALYSE.prixDemande}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Écart prix / estimation</span>
                    <span className="inline-flex items-center gap-1 font-semibold text-emerald-300">
                      <TrendingUp className="h-3.5 w-3.5" />
                      {MOCK_ANALYSE.ecart} ({MOCK_ANALYSE.ecartPct})
                    </span>
                  </div>
                </div>
                <div className="mt-auto pt-3">
                  <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
                    <span>Fiabilité de l'estimation</span>
                    <span className="font-semibold text-slate-200">{MOCK_ANALYSE.fiabilite}/100</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400"
                      style={{ width: `${MOCK_ANALYSE.fiabilite}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* CARTE 3 — Emplacement (sous-scores) */}
              <div className="flex flex-col rounded-2xl border border-white/10 bg-gradient-to-br from-cyan-500/10 to-transparent p-5">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  <Activity className="h-4 w-4 text-cyan-300" />
                  Emplacement
                </div>
                <div className="mt-4 space-y-3">
                  {EMPLACEMENT.map((item) => {
                    const Icon = item.icon;
                    return (
                      <div key={item.label}>
                        <div className="flex items-center justify-between text-sm">
                          <span className="flex items-center gap-2 text-slate-400">
                            <Icon className="h-4 w-4 text-slate-500" />
                            {item.label}
                          </span>
                          <span className="font-semibold text-slate-200">{item.value}</span>
                        </div>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-blue-400"
                            style={{ width: `${item.value}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-auto flex items-center justify-between border-t border-white/10 pt-3 text-sm">
                  <span className="text-slate-400">Score localisation global</span>
                  <span className="font-semibold text-cyan-300">{MOCK_ANALYSE.scoreLocalisation}/100</span>
                </div>
              </div>
            </div>

            {/* CTA bas du bloc */}
            <div className="flex justify-center border-t border-white/10 bg-white/[0.02] px-6 py-4">
              <button
                type="button"
                onClick={() => navigate("/analyse-rapide")}
                className="inline-flex items-center gap-2 text-sm font-semibold text-violet-200 transition-colors hover:text-white"
              >
                Voir l'analyse complète
                <ArrowRight className="h-4 w-4" />
              </button>
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