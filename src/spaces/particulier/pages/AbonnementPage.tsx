// src/spaces/particulier/pages/AbonnementPage.tsx
// ─── changelog ────────────────────────────────────────────────────────────────
// • pricingMap réactif : useState + storage event + visibilitychange
//   → mise à jour immédiate quand /admin/tarifs enregistre, même onglet
// ─────────────────────────────────────────────────────────────────────────────

import type { PricingEntry } from "@/spaces/admin/pages/Tarifs";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  ChevronDown,
  Coins,
  HeartHandshake,
  Lock,
  Sparkles,
  TrendingUp,
  UserCheck,
  Wrench,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

// ── Lecture du pricing depuis localStorage ────────────────────────────────────

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

// ── Types ─────────────────────────────────────────────────────────────────────

type StoredUser = {
  email?: string;
  logged?: boolean;
  fullName?: string;
  plan?: string;
};

interface OfferItem {
  id: string;
  badge: string;
  title: string;
  price: string;
  subtitle: string;
  features: string[];
  ctaLabel: string;
  planKey: string;
  featured?: boolean;
  helper?: string;
}

interface ColorSet {
  icon: string;
  price: string;
  cta: string;
  accent: string;
  featuredBg: string;
}

interface SectionDef {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  color: ColorSet;
  summaryPrice: string;
  summaryUnit: string;
  offers: OfferItem[];
  extras?: React.ReactNode;
}

const C: Record<string, ColorSet> = {
  sky: {
    icon: "bg-sky-100 text-sky-500",
    price: "text-sky-500",
    cta: "bg-sky-500 hover:bg-sky-400 text-white",
    accent: "border-sky-200",
    featuredBg: "bg-sky-50/50",
  },
  indigo: {
    icon: "bg-indigo-100 text-indigo-500",
    price: "text-indigo-500",
    cta: "bg-indigo-600 hover:bg-indigo-500 text-white",
    accent: "border-indigo-200",
    featuredBg: "bg-indigo-50/50",
  },
  teal: {
    icon: "bg-teal-100 text-teal-500",
    price: "text-teal-500",
    cta: "bg-teal-600 hover:bg-teal-500 text-white",
    accent: "border-teal-200",
    featuredBg: "bg-teal-50/50",
  },
  orange: {
    icon: "bg-orange-100 text-orange-500",
    price: "text-orange-500",
    cta: "bg-orange-500 hover:bg-orange-400 text-white",
    accent: "border-orange-200",
    featuredBg: "bg-orange-50/40",
  },
};

// ── Helper : applique le pricing localStorage sur une OfferItem ───────────────

function applyPricing(
  offer: OfferItem,
  pricingMap: Record<string, PricingEntry>
): OfferItem | null {
  const entry = pricingMap[offer.planKey];
  if (!entry) return offer;
  if (entry.active === false) return null;
  return {
    ...offer,
    badge: entry.badge || offer.badge,
    title: entry.title || offer.title,
    price: entry.unit ? `${entry.price}${entry.unit}` : entry.price,
  };
}

// ── SectionAccordion ──────────────────────────────────────────────────────────

function SectionAccordion({
  section,
  isOpen,
  onToggle,
  onSelect,
}: {
  section: SectionDef;
  isOpen: boolean;
  onToggle: () => void;
  onSelect: (key: string) => void;
}) {
  const c = section.color;

  return (
    <div
      className={[
        "overflow-hidden rounded-2xl border bg-white transition-shadow duration-200",
        isOpen
          ? "border-slate-300 shadow-md"
          : "border-slate-200 hover:border-slate-300 hover:shadow-sm",
      ].join(" ")}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-4 px-5 py-5 text-left"
      >
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${c.icon}`}
        >
          {section.icon}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-slate-900">
            {section.label}
          </p>
          <p className="mt-0.5 text-sm leading-5 text-slate-500">
            {section.description}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-xs font-medium text-slate-400">À partir de</p>
          <p className="mt-0.5">
            <span className={`text-[26px] font-bold leading-none ${c.price}`}>
              {section.summaryPrice}
            </span>
            <span className="ml-1 text-sm text-slate-400">
              {section.summaryUnit}
            </span>
          </p>
        </div>

        <ChevronDown
          className={[
            "h-5 w-5 shrink-0 text-slate-400 transition-transform duration-300",
            isOpen ? "rotate-180" : "",
          ].join(" ")}
        />
      </button>

      <div
        className={[
          "overflow-hidden transition-all duration-300 ease-in-out",
          isOpen ? "max-h-[900px] opacity-100" : "max-h-0 opacity-0",
        ].join(" ")}
      >
        <div className="border-t border-slate-100 px-5 pb-6 pt-5">
          <div
            className={`grid gap-3 ${
              section.offers.length <= 2
                ? "sm:grid-cols-2"
                : "sm:grid-cols-2 lg:grid-cols-3"
            }`}
          >
            {section.offers.map((offer) => (
              <div
                key={offer.id}
                className={[
                  "flex flex-col rounded-xl border p-4",
                  offer.featured
                    ? `${c.accent} ${c.featuredBg}`
                    : "border-slate-200 bg-white",
                ].join(" ")}
              >
                <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                  {offer.badge}
                </span>

                <p className="mt-1.5 text-sm font-semibold text-slate-900">
                  {offer.title}
                </p>

                <p className={`mt-1 text-lg font-bold ${c.price}`}>
                  {offer.price}
                </p>

                <ul className="mt-3 flex-1 space-y-1.5">
                  {offer.features.map((f) => (
                    <li
                      key={f}
                      className="flex items-start gap-1.5 text-xs text-slate-600"
                    >
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                      {f}
                    </li>
                  ))}
                </ul>

                {offer.helper && (
                  <p className="mt-3 rounded-lg bg-white/70 px-3 py-2 text-[11px] leading-4 text-slate-500">
                    {offer.helper}
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => onSelect(offer.planKey)}
                  className={[
                    "mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-all",
                    offer.featured
                      ? c.cta
                      : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                  ].join(" ")}
                >
                  {offer.ctaLabel}
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>

          {section.extras && <div className="mt-4">{section.extras}</div>}
        </div>
      </div>
    </div>
  );
}

// ── buildSections ─────────────────────────────────────────────────────────────

function buildSections(
  savePlan: (p: string) => void,
  pricingMap: Record<string, PricingEntry>
): SectionDef[] {
  function applyOffers(offers: OfferItem[]): OfferItem[] {
    return offers
      .map((o) => applyPricing(o, pricingMap))
      .filter((o): o is OfferItem => o !== null);
  }

  const rawInvestisseur: OfferItem[] = [
    {
      id: "inv-10", badge: "Jetons", title: "10 analyses",
      price: "9,90€ HT", subtitle: "1 analyse = 1 jeton.",
      features: ["Découverte plateforme", "Sans engagement", "Usage ponctuel"],
      ctaLabel: "Acheter", planKey: "tokens-10",
    },
    {
      id: "inv-20", badge: "Jetons", title: "20 analyses",
      price: "16,90€ HT", subtitle: "Meilleur prix unitaire.",
      features: ["Volume intermédiaire", "Sans engagement", "Meilleur tarif/analyse"],
      ctaLabel: "Acheter", planKey: "tokens-20",
    },
    {
      id: "inv-starter", badge: "Abonnement", title: "Starter",
      price: "39,90€ HT/mois", subtitle: "50 analyses incluses par mois.",
      features: ["50 analyses/mois", "Recharge possible", "Meilleure conversion"],
      helper: "La formule à pousser pour convertir les utilisateurs récurrents.",
      ctaLabel: "Choisir Starter", planKey: "starter", featured: true,
    },
    {
      id: "inv-pro", badge: "Abonnement", title: "Pro",
      price: "74,99€ HT/mois", subtitle: "200 analyses incluses.",
      features: ["200 analyses/mois", "Recharge disponible", "Usage intensif"],
      ctaLabel: "Choisir Pro", planKey: "pro",
    },
  ];

  const rawRecharges = [
    { label: "25 analyses", price: "19,90€ HT", key: "recharge-25" },
    { label: "50 analyses", price: "34,90€ HT", key: "recharge-50" },
  ]
    .filter((r) => {
      const entry = pricingMap[r.key];
      return !entry || entry.active !== false;
    })
    .map((r) => {
      const entry = pricingMap[r.key];
      return entry
        ? {
            ...r,
            price: entry.unit ? `${entry.price}${entry.unit}` : entry.price,
            label: entry.title || r.label,
          }
        : r;
    });

  return [
    {
      id: "investisseur",
      label: "Investisseur",
      description: "Accédez aux meilleures opportunités et pilotez vos investissements.",
      icon: <Coins className="h-5 w-5" />,
      color: C.sky,
      summaryPrice: "149€",
      summaryUnit: "/mois",
      offers: applyOffers(rawInvestisseur),
      extras:
        rawRecharges.length > 0 ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Recharges complémentaires
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {rawRecharges.map((r) => (
                <div
                  key={r.key}
                  className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{r.label}</p>
                    <p className="text-xs text-slate-500">{r.price}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => savePlan(r.key)}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    Acheter
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : undefined,
    },
    {
      id: "promoteur",
      label: "Promoteur",
      description: "De l'identification foncière à la commercialisation de vos projets.",
      icon: <Building2 className="h-5 w-5" />,
      color: C.indigo,
      summaryPrice: "199€",
      summaryUnit: "/mois",
      offers: applyOffers([
        {
          id: "pro-starter", badge: "Promoteur", title: "Starter",
          price: "dès 149€/mois", subtitle: "Pour démarrer les premières études foncières.",
          features: ["Faisabilité foncière", "Lecture PLU", "Études de marché", "Synthèses de base"],
          ctaLabel: "Demander une démo", planKey: "promoteur-starter",
        },
        {
          id: "pro-pro", badge: "Promoteur", title: "Pro",
          price: "dès 299€/mois", subtitle: "Pour un usage régulier et des dossiers complets.",
          features: ["Faisabilité + risques + bilan", "Exports avancés", "Équipe légère", "Montée en charge"],
          ctaLabel: "Être recontacté", planKey: "promoteur-pro", featured: true,
        },
        {
          id: "pro-enterprise", badge: "Entreprise", title: "Sur devis",
          price: "Personnalisé", subtitle: "Multi-utilisateurs ou besoins spécifiques.",
          features: ["Comptes équipe", "Paramétrage métier", "Accompagnement", "Intégrations"],
          ctaLabel: "Contacter Mimmoza", planKey: "promoteur-enterprise",
        },
      ]),
    },
    {
      id: "rehabilitation",
      label: "Réhabilitation",
      description: "Pilotez vos opérations de réhabilitation et améliorez la performance.",
      icon: <Wrench className="h-5 w-5" />,
      color: C.teal,
      summaryPrice: "129€",
      summaryUnit: "/mois",
      offers: applyOffers([
        {
          id: "reh-starter", badge: "Réhabilitation", title: "Starter",
          price: "dès 149€/mois", subtitle: "Pour démarrer les premiers audits.",
          features: ["Audit conformité ERP/PMR", "Analyse de plans", "Études de marché", "Synthèses de base"],
          ctaLabel: "Demander une démo", planKey: "rehabilitation-starter",
        },
        {
          id: "reh-pro", badge: "Réhabilitation", title: "Pro",
          price: "dès 299€/mois", subtitle: "Pour des dossiers d'audit complets.",
          features: ["Audit complet + valorisation", "Exports avancés", "Équipe légère", "Montée en charge"],
          ctaLabel: "Être recontacté", planKey: "rehabilitation-pro", featured: true,
        },
        {
          id: "reh-enterprise", badge: "Entreprise", title: "Sur devis",
          price: "Personnalisé", subtitle: "Multi-utilisateurs ou besoins spécifiques.",
          features: ["Comptes équipe", "Paramétrage", "Accompagnement", "Intégrations"],
          ctaLabel: "Contacter Mimmoza", planKey: "rehabilitation-enterprise",
        },
      ]),
    },
    {
      id: "apporteur",
      label: "Apporteur d'affaires",
      description: "Déposez des opportunités et percevez des commissions.",
      icon: <UserCheck className="h-5 w-5" />,
      color: C.orange,
      summaryPrice: "0€",
      summaryUnit: "/mois",
      offers: applyOffers([
        {
          id: "app-free", badge: "Apporteur", title: "Accès gratuit",
          price: "0€", subtitle: "Dépôt sans abonnement requis.",
          features: ["Accès espace apporteur", "Dépôt illimité", "Suivi des leads", "Sans engagement"],
          ctaLabel: "Accéder", planKey: "apporteur-free", featured: true,
        },
        {
          id: "app-commission", badge: "Commission", title: "Rémunération",
          price: "À la commission", subtitle: "Rémunéré sur chaque opportunité transformée.",
          features: ["Commission par contrat", "Versement à transformation", "Dashboard de suivi", "0 frais d'entrée"],
          ctaLabel: "En savoir plus", planKey: "apporteur-commission",
        },
        {
          id: "app-partenariat", badge: "Réseau", title: "Partenariat",
          price: "Sur devis", subtitle: "Pour apporteurs à volume régulier.",
          features: ["Conditions préférentielles", "Accompagnement dédié", "Rapports perf.", "Accord cadre"],
          ctaLabel: "Contacter Mimmoza", planKey: "apporteur-partenariat",
        },
      ]),
    },
  ];
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AbonnementPage() {
  const navigate = useNavigate();
  const [openSectionId, setOpenSectionId] = useState<string | null>(null);

  const user = useMemo<StoredUser>(() => {
    try {
      const raw = localStorage.getItem("mimmoza.user");
      return raw ? (JSON.parse(raw) as StoredUser) : {};
    } catch {
      return {};
    }
  }, []);

  // ── Pricing réactif ────────────────────────────────────────────────────────
  // Initialisé depuis localStorage, puis mis à jour :
  //   • visibilitychange → retour sur l'onglet après avoir édité dans /admin/tarifs
  //   • storage         → changement depuis un autre onglet
  const [pricingMap, setPricingMap] = useState<Record<string, PricingEntry>>(
    () => readPricingMap()
  );

  useEffect(() => {
    // Retour sur l'onglet (même fenêtre, navigation entre pages)
    function handleVisibility() {
      if (document.visibilityState === "visible") {
        setPricingMap(readPricingMap());
      }
    }
    // Changement localStorage depuis un autre onglet
    function handleStorage(e: StorageEvent) {
      if (e.key === "mimmoza.pricing") {
        setPricingMap(readPricingMap());
      }
    }

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("storage", handleStorage);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const savePlan = (plan: string) => {
    localStorage.setItem("mimmoza.user", JSON.stringify({ ...user, plan }));
    navigate("/compte");
  };

  const sections = buildSections(savePlan, pricingMap);

  return (
    <div className="relative overflow-hidden rounded-[32px] border border-slate-200/80 bg-white shadow-sm">
      <style>{`
        @keyframes gx {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        .agx {
          background-size: 200% 200%;
          animation: gx 7s ease infinite;
        }
      `}</style>

      <div className="flex min-h-[calc(100vh-6rem)]">
        <aside
          className="hidden shrink-0 flex-col overflow-hidden lg:flex"
          style={{
            width: "320px",
            background:
              "linear-gradient(180deg, #eef4ff 0%, #f0f7ff 40%, #e8f3ff 100%)",
          }}
        >
          <img
            src="/illustrations/colone_abonnement.png"
            alt=""
            aria-hidden="true"
            draggable={false}
            className="h-full w-full object-contain object-center"
          />
        </aside>

        <div className="flex flex-1 flex-col px-8 py-10 lg:px-10 lg:py-12">
          <div className="mb-10">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 shadow-sm">
              <Sparkles className="h-3.5 w-3.5 text-sky-500" />
              Offres Mimmoza
            </div>

            <h1 className="text-4xl font-semibold tracking-tight text-slate-950 sm:text-[2.6rem]">
              Choisissez votre{" "}
              <span className="agx bg-gradient-to-r from-indigo-600 via-sky-500 to-cyan-400 bg-clip-text text-transparent">
                formule
              </span>
            </h1>

            <p className="mt-3 text-base leading-7 text-slate-500">
              Une tarification adaptée à chaque espace.
            </p>
          </div>

          <div className="flex-1 space-y-3">
            {sections.map((section) => (
              <SectionAccordion
                key={section.id}
                section={section}
                isOpen={openSectionId === section.id}
                onToggle={() =>
                  setOpenSectionId(
                    openSectionId === section.id ? null : section.id
                  )
                }
                onSelect={savePlan}
              />
            ))}
          </div>

          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              {
                icon: <Zap className="h-4 w-4 text-sky-500" />,
                label: "Sans engagement",
                sub: "Résiliez à tout moment",
              },
              {
                icon: <Lock className="h-4 w-4 text-emerald-500" />,
                label: "Paiement sécurisé",
                sub: "100% sécurisé",
              },
              {
                icon: <HeartHandshake className="h-4 w-4 text-indigo-500" />,
                label: "Support dédié",
                sub: "Une équipe à votre écoute",
              },
              {
                icon: <TrendingUp className="h-4 w-4 text-orange-500" />,
                label: "Évolutif",
                sub: "Changez de formule à tout moment",
              },
            ].map((item) => (
              <div
                key={item.label}
                className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
              >
                <div className="shrink-0">{item.icon}</div>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-slate-800">
                    {item.label}
                  </p>
                  <p className="truncate text-[11px] text-slate-400">
                    {item.sub}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}