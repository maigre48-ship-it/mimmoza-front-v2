// src/spaces/particulier/pages/AbonnementPage.tsx
// ─── Modèle MimmozIA (remplace jetons-packs + accès par espace) ───────────────
// 4 formules : basique / avance / pro / proplus.
//  • Apport d'affaires + Analyse rapide + Veille marché : inclus partout.
//  • Modules métier (Investissement / Promotion / Réhabilitation) :
//      basique, avance → 0 ; pro → 1 au choix ; proplus → les 3.
//  • Le choix du module Pro est PERSISTÉ via setPlan('pro', module).
//  • Les prix + jetons/mois restent lus depuis mimmoza.pricing (admin /admin/tarifs),
//    sous les planKeys : mimmozia-basique / -avance / -pro / -proplus.

import {
  ArrowRight, Building2, CheckCircle2, Coins, HeartHandshake, Lock,
  Sparkles, TrendingUp, Wrench, Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { type PricingEntry } from "@/spaces/admin/pages/Tarifs";
import { setPlan, getCurrentPlanState } from "@/lib/billing/usePlanAccess";
import type { PlanId, ModuleSpace } from "@/lib/billing/planAccess";

// ── Pricing (admin) ───────────────────────────────────────────────────────────
function readPricingMap(): Record<string, PricingEntry> {
  try {
    const raw = localStorage.getItem("mimmoza.pricing");
    if (!raw) return {};
    const arr = JSON.parse(raw) as PricingEntry[];
    return Object.fromEntries(arr.map((e) => [e.planKey, e]));
  } catch {
    return {};
  }
}

function formatPrice(entry: PricingEntry | undefined): string {
  if (!entry) return "Sur devis";
  if (entry.kind === "custom" || entry.priceHT <= 0) {
    return entry.priceHT > 0 ? `${entry.priceHT} €` : "Sur devis";
  }
  const base = `${entry.priceHT.toLocaleString("fr-FR")} €`;
  const prefix = entry.kind === "access_plan" ? "dès " : "";
  return entry.unit ? `${prefix}${base}${entry.unit}` : `${base}/mois`;
}

// ── Formules ──────────────────────────────────────────────────────────────────
type Modules = "none" | "one" | "all";
interface Tier {
  id: PlanId;
  name: string;
  model: string;
  tagline: string;
  modules: Modules;
  features: string[];
  featured?: boolean;
}

const TIERS: Tier[] = [
  {
    id: "basique", name: "Basique", model: "MimmozIA · Haiku", tagline: "Pour démarrer",
    modules: "none",
    features: ["Assistant MimmozIA (Haiku)", "PLU, DVF, risques, DPE", "Rapports essentiels"],
  },
  {
    id: "avance", name: "Avancé", model: "MimmozIA · Sonnet", tagline: "Analyses approfondies",
    modules: "none",
    features: ["Assistant MimmozIA (Sonnet)", "Analyses avancées et sourcées", "Rapports détaillés"],
  },
  {
    id: "pro", name: "Pro", model: "MimmozIA · Sonnet / Opus", tagline: "1 métier au choix",
    modules: "one", featured: true,
    features: ["Assistant MimmozIA (Sonnet / Opus)", "1 module métier au choix", "Exports avancés"],
  },
  {
    id: "proplus", name: "Pro +", model: "MimmozIA · Sonnet / Opus", tagline: "Tous les métiers",
    modules: "all",
    features: ["Assistant MimmozIA (Sonnet / Opus)", "Les 3 modules métier inclus", "Exports avancés"],
  },
];

const COMMON_FEATURES = ["Apport d'affaires", "Analyse rapide", "Veille marché"];

const MODULE_OPTIONS: { id: ModuleSpace; label: string; icon: typeof TrendingUp }[] = [
  { id: "marchand", label: "Investissement", icon: TrendingUp },
  { id: "promoteur", label: "Promotion", icon: Building2 },
  { id: "rehabilitation", label: "Réhabilitation", icon: Wrench },
];

const PLAN_KEY: Record<PlanId, string> = {
  basique: "mimmozia-basique",
  avance: "mimmozia-avance",
  pro: "mimmozia-pro",
  proplus: "mimmozia-proplus",
};

// ── Page ──────────────────────────────────────────────────────────────────────
export default function AbonnementPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const current = useMemo(() => getCurrentPlanState(), []);
  const highlighted = (params.get("plan") as PlanId) || undefined;
  const from = params.get("from") || null;

  // module choisi pour le Pro (pré-rempli si déjà stocké)
  const [proModule, setProModule] = useState<ModuleSpace | null>(current.selectedModules[0] ?? null);

  const [pricingMap, setPricingMap] = useState<Record<string, PricingEntry>>(() => readPricingMap());
  useEffect(() => {
    const refresh = () => setPricingMap(readPricingMap());
    const onVis = () => { if (document.visibilityState === "visible") refresh(); };
    const onStorage = (e: StorageEvent) => { if (e.key === "mimmoza.pricing") refresh(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("storage", onStorage);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  function choose(tier: Tier) {
    const selected = tier.id === "pro" ? proModule ?? undefined : undefined;
    setPlan(tier.id, selected);
    navigate(from || "/compte");
  }

  return (
    <div className="relative overflow-hidden rounded-[32px] border border-slate-200/80 bg-white shadow-sm">
      <style>{`
        @keyframes gx { 0%,100%{background-position:0% 50%} 50%{background-position:100% 50%} }
        .agx { background-size:200% 200%; animation:gx 7s ease infinite; }
      `}</style>

      <div className="flex min-h-[calc(100vh-6rem)]">
        <aside
          className="hidden shrink-0 flex-col overflow-hidden lg:flex"
          style={{ width: "320px", background: "linear-gradient(180deg,#eef4ff 0%,#f0f7ff 40%,#e8f3ff 100%)" }}
        >
          <img
            src="/illustrations/colone_abonnement.png"
            alt="" aria-hidden="true" draggable={false}
            className="h-full w-full object-contain object-center"
          />
        </aside>

        <div className="flex flex-1 flex-col px-8 py-10 lg:px-10 lg:py-12">
          <div className="mb-8">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 shadow-sm">
              <Sparkles className="h-3.5 w-3.5 text-violet-500" />
              Abonnements MimmozIA
            </div>
            <h1 className="text-4xl font-semibold tracking-tight text-slate-950 sm:text-[2.6rem]">
              Choisissez votre{" "}
              <span className="agx bg-gradient-to-r from-indigo-600 via-violet-500 to-cyan-400 bg-clip-text text-transparent">
                formule
              </span>
            </h1>
            <p className="mt-3 text-base leading-7 text-slate-500">
              MimmozIA pour tous, avec les modules métier selon votre formule. Apport d'affaires, Analyse rapide et Veille marché inclus partout.
            </p>
          </div>

          <div className="grid flex-1 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {TIERS.map((tier) => {
              const entry = pricingMap[PLAN_KEY[tier.id]];
              const price = formatPrice(entry);
              const tokens = entry && entry.kind === "access_plan" && entry.tokens > 0
                ? `${entry.tokens.toLocaleString("fr-FR")} jetons IA/mois inclus`
                : null;
              const isCurrent = current.plan === tier.id;
              const isFeatured = tier.featured || highlighted === tier.id;
              const needsModule = tier.id === "pro" && !proModule;

              return (
                <div
                  key={tier.id}
                  className={[
                    "flex flex-col rounded-2xl border p-5 transition-shadow",
                    isFeatured ? "border-violet-300 bg-violet-50/40 shadow-md" : "border-slate-200 bg-white hover:shadow-sm",
                  ].join(" ")}
                >
                  {isFeatured && (
                    <span className="mb-2 inline-flex w-fit items-center rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-500 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                      {tier.id === "proplus" ? "Complet" : "Populaire"}
                    </span>
                  )}

                  <p className="text-lg font-bold text-slate-900">{tier.name}</p>
                  <p className="text-xs text-slate-400">{tier.tagline}</p>

                  <p className="mt-3 text-2xl font-bold text-violet-600">{price}</p>
                  {tokens && <p className="mt-1 text-[11px] text-slate-500">{tokens}</p>}

                  <ul className="mt-4 flex-1 space-y-1.5">
                    {tier.features.map((f) => (
                      <li key={f} className="flex items-start gap-1.5 text-xs text-slate-600">
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                        {f}
                      </li>
                    ))}
                    {COMMON_FEATURES.map((f) => (
                      <li key={f} className="flex items-start gap-1.5 text-xs text-slate-500">
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-300" />
                        {f}
                      </li>
                    ))}
                  </ul>

                  {/* Sélecteur de module — Pro uniquement */}
                  {tier.id === "pro" && (
                    <div className="mt-4">
                      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                        Votre module
                      </p>
                      <div className="flex flex-col gap-1.5">
                        {MODULE_OPTIONS.map(({ id, label, icon: Icon }) => {
                          const active = proModule === id;
                          return (
                            <button
                              key={id}
                              type="button"
                              onClick={() => setProModule(id)}
                              className={[
                                "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all",
                                active
                                  ? "border-violet-400 bg-violet-100 text-violet-700"
                                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
                              ].join(" ")}
                            >
                              <Icon className="h-3.5 w-3.5" />
                              {label}
                              {active && <CheckCircle2 className="ml-auto h-3.5 w-3.5 text-violet-600" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => choose(tier)}
                    disabled={isCurrent || needsModule}
                    className={[
                      "mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all",
                      isCurrent
                        ? "cursor-default bg-slate-100 text-slate-400"
                        : needsModule
                          ? "cursor-not-allowed bg-slate-100 text-slate-400"
                          : "bg-violet-600 text-white hover:bg-violet-500",
                    ].join(" ")}
                  >
                    {isCurrent ? "Formule actuelle" : needsModule ? "Choisissez un module" : "Choisir"}
                    {!isCurrent && !needsModule && <ArrowRight className="h-3.5 w-3.5" />}
                  </button>
                </div>
              );
            })}
          </div>

          <p className="mt-6 text-[11px] leading-4 text-slate-400">
            Les actions IA consomment des jetons ; chaque formule inclut une réserve mensuelle. L'API est disponible séparément.
          </p>

          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { icon: <Zap className="h-4 w-4 text-violet-500" />, label: "Sans engagement", sub: "Résiliez à tout moment" },
              { icon: <Lock className="h-4 w-4 text-emerald-500" />, label: "Paiement sécurisé", sub: "100% sécurisé" },
              { icon: <HeartHandshake className="h-4 w-4 text-indigo-500" />, label: "Support dédié", sub: "Une équipe à votre écoute" },
              { icon: <TrendingUp className="h-4 w-4 text-orange-500" />, label: "Évolutif", sub: "Changez de formule à tout moment" },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <div className="shrink-0">{item.icon}</div>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-slate-800">{item.label}</p>
                  <p className="truncate text-[11px] text-slate-400">{item.sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}