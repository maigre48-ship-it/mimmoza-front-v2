// src/spaces/particulier/pages/AbonnementPage.tsx
// ─── changelog ────────────────────────────────────────────────────────────────
// • MODELE 2 : section "Jetons" (packs) remplace "Investisseur".
//   Abonnements d'acces Promoteur/Rehab affichent "N jetons IA/mois inclus".
// • formatPrice : lit priceHT (number) + kind ("dès" pour access_plan, "Sur devis"
//   pour custom a 0). applyPricing masque tout planKey absent du pricing.
// • pricingMap reactif : useState + storage event + visibilitychange
//   → mise a jour immediate quand /admin/tarifs enregistre, meme onglet
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
  violet: {
    icon: "bg-violet-100 text-violet-500",
    price: "text-violet-500",
    cta: "bg-violet-600 hover:bg-violet-500 text-white",
    accent: "border-violet-200",
    featuredBg: "bg-violet-50/50",
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

// ── Helpers pricing ───────────────────────────────────────────────────────────

function formatPrice(entry: PricingEntry): string {
  if (entry.kind === "custom" || entry.priceHT <= 0) {
    return entry.priceHT > 0 ? `${entry.priceHT} €` : "Sur devis";
  }
  const base = `${entry.priceHT.toLocaleString("fr-FR")} €`;
  const prefix = entry.kind === "access_plan" ? "dès " : "";
  return entry.unit ? `${prefix}${base}${entry.unit}` : base;
}

function applyPricing(
  offer: OfferItem,
  pricingMap: Record<string, PricingEntry>
): OfferItem | null {
  const entry = pricingMap[offer.planKey];
  if (!entry) return null;            // plan absent du pricing → masque
  if (entry.active === false) return null;

  // Injecte "N jetons IA/mois inclus" pour les abonnements d'acces
  const tokenFeature =
    entry.kind === "access_plan" && entry.tokens > 0
      ? [`${entry.tokens.toLocaleString("fr-FR")} jetons IA/mois inclus`]
      : [];

  return {
    ...offer,
    badge: entry.badge || offer.badge,
    title: entry.title || offer.title,
    price: formatPrice(entry),
    features: [...tokenFeature, ...offer.features],
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
          isOpen ? "max-h-[1200px] opacity-100" : "max-h-0 opacity-0",
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

  // ── Jetons (remplace l'ancienne section Investisseur) ─────────────────────
  const rawJetons: OfferItem[] = [
    {
      id: "jet-100", badge: "Jetons", title: "Pack 100 jetons",
      price: "", subtitle: "Pour decouvrir.",
      features: ["Utilisables dans tous les espaces", "Sans engagement", "Ideal premier essai"],
      ctaLabel: "Acheter", planKey: "jetons-100",
    },
    {
      id: "jet-500", badge: "Jetons", title: "Pack 500 jetons",
      price: "", subtitle: "Usage regulier.",
      features: ["Utilisables partout", "Meilleur prix unitaire", "Sans engagement"],
      ctaLabel: "Acheter", planKey: "jetons-500",
    },
    {
      id: "jet-1000", badge: "Jetons", title: "Pack 1 000 jetons",
      price: "", subtitle: "Le meilleur rapport volume / prix.",
      features: ["Utilisables partout", "Tarif degressif", "Usage soutenu"],
      helper: "Le pack le plus equilibre pour un usage regulier de Mimmoza.",
      ctaLabel: "Acheter", planKey: "jetons-1000", featured: true,
    },
    {
      id: "jet-5000", badge: "Jetons", title: "Pack 5 000 jetons",
      price: "", subtitle: "Gros volume.",
      features: ["Utilisables partout", "Tarif degressif", "Equipes actives"],
      ctaLabel: "Acheter", planKey: "jetons-5000",
    },
    {
      id: "jet-10000", badge: "Jetons", title: "Pack 10 000 jetons",
      price: "", subtitle: "Volume maximal.",
      features: ["Utilisables partout", "Meilleur tarif jeton", "Usage intensif"],
      ctaLabel: "Acheter", planKey: "jetons-10000",
    },
  ];

  return [
    {
      id: "jetons",
      label: "Jetons IA",
      description: "Une seule monnaie pour toutes les actions IA : Copilot, analyses, facades.",
      icon: <Coins className="h-5 w-5" />,
      color: C.violet,
      summaryPrice: "4€",
      summaryUnit: "le pack",
      offers: applyOffers(rawJetons),
      extras: (
        <div className="rounded-xl border border-violet-100 bg-violet-50/60 p-4">
          <p className="text-[11px] leading-4 text-violet-600">
            <strong className="font-semibold text-violet-800">Bon a savoir.</strong>{" "}
            Les jetons sont utilisables dans tous les espaces Mimmoza. Les jetons inclus dans un
            abonnement expirent au bout de 30 jours ; les packs achetes restent acquis.
          </p>
        </div>
      ),
    },
    {
      id: "promoteur",
      label: "Promoteur",
      description: "De l'identification fonciere a la commercialisation de vos projets.",
      icon: <Building2 className="h-5 w-5" />,
      color: C.indigo,
      summaryPrice: "149€",
      summaryUnit: "/mois",
      offers: applyOffers([
        {
          id: "pro-starter", badge: "Promoteur", title: "Starter",
          price: "", subtitle: "Pour demarrer les premieres etudes foncieres.",
          features: ["Faisabilite fonciere", "Lecture PLU", "Etudes de marche", "Syntheses de base"],
          ctaLabel: "Demander une demo", planKey: "promoteur-starter",
        },
        {
          id: "pro-pro", badge: "Promoteur", title: "Pro",
          price: "", subtitle: "Pour un usage regulier et des dossiers complets.",
          features: ["Faisabilite + risques + bilan", "Exports avances", "Equipe legere", "Montee en charge"],
          ctaLabel: "Etre recontacte", planKey: "promoteur-pro", featured: true,
        },
        {
          id: "pro-enterprise", badge: "Entreprise", title: "Sur devis",
          price: "", subtitle: "Multi-utilisateurs ou besoins specifiques.",
          features: ["Comptes equipe", "Parametrage metier", "Accompagnement", "Integrations"],
          ctaLabel: "Contacter Mimmoza", planKey: "promoteur-enterprise",
        },
      ]),
    },
    {
      id: "rehabilitation",
      label: "Rehabilitation",
      description: "Pilotez vos operations de rehabilitation et ameliorez la performance.",
      icon: <Wrench className="h-5 w-5" />,
      color: C.teal,
      summaryPrice: "149€",
      summaryUnit: "/mois",
      offers: applyOffers([
        {
          id: "reh-starter", badge: "Rehabilitation", title: "Starter",
          price: "", subtitle: "Pour demarrer les premiers audits.",
          features: ["Audit conformite ERP/PMR", "Analyse de plans", "Etudes de marche", "Syntheses de base"],
          ctaLabel: "Demander une demo", planKey: "rehabilitation-starter",
        },
        {
          id: "reh-pro", badge: "Rehabilitation", title: "Pro",
          price: "", subtitle: "Pour des dossiers d'audit complets.",
          features: ["Audit complet + valorisation", "Exports avances", "Equipe legere", "Montee en charge"],
          ctaLabel: "Etre recontacte", planKey: "rehabilitation-pro", featured: true,
        },
        {
          id: "reh-enterprise", badge: "Entreprise", title: "Sur devis",
          price: "", subtitle: "Multi-utilisateurs ou besoins specifiques.",
          features: ["Comptes equipe", "Parametrage", "Accompagnement", "Integrations"],
          ctaLabel: "Contacter Mimmoza", planKey: "rehabilitation-enterprise",
        },
      ]),
    },
    {
      id: "apporteur",
      label: "Apporteur d'affaires",
      description: "Deposez des opportunites et percevez des commissions.",
      icon: <UserCheck className="h-5 w-5" />,
      color: C.orange,
      summaryPrice: "0€",
      summaryUnit: "/mois",
      offers: applyOffers([
        {
          id: "app-free", badge: "Apporteur", title: "Acces gratuit",
          price: "", subtitle: "Depot sans abonnement requis.",
          features: ["Acces espace apporteur", "Depot illimite", "Suivi des leads", "Sans engagement"],
          ctaLabel: "Acceder", planKey: "apporteur-free", featured: true,
        },
        {
          id: "app-commission", badge: "Commission", title: "Remuneration",
          price: "", subtitle: "Remunere sur chaque opportunite transformee.",
          features: ["Commission par contrat", "Versement a transformation", "Dashboard de suivi", "0 frais d'entree"],
          ctaLabel: "En savoir plus", planKey: "apporteur-commission",
        },
        {
          id: "app-partenariat", badge: "Reseau", title: "Partenariat",
          price: "", subtitle: "Pour apporteurs a volume regulier.",
          features: ["Conditions preferentielles", "Accompagnement dedie", "Rapports perf.", "Accord cadre"],
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

  // ── Pricing reactif ────────────────────────────────────────────────────────
  const [pricingMap, setPricingMap] = useState<Record<string, PricingEntry>>(
    () => readPricingMap()
  );

  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === "visible") {
        setPricingMap(readPricingMap());
      }
    }
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
              <Sparkles className="h-3.5 w-3.5 text-violet-500" />
              Offres Mimmoza
            </div>

            <h1 className="text-4xl font-semibold tracking-tight text-slate-950 sm:text-[2.6rem]">
              Choisissez votre{" "}
              <span className="agx bg-gradient-to-r from-indigo-600 via-violet-500 to-cyan-400 bg-clip-text text-transparent">
                formule
              </span>
            </h1>

            <p className="mt-3 text-base leading-7 text-slate-500">
              Des jetons IA pour les actions, des abonnements pour l'acces aux espaces metier.
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
                icon: <Zap className="h-4 w-4 text-violet-500" />,
                label: "Sans engagement",
                sub: "Resiliez a tout moment",
              },
              {
                icon: <Lock className="h-4 w-4 text-emerald-500" />,
                label: "Paiement securise",
                sub: "100% securise",
              },
              {
                icon: <HeartHandshake className="h-4 w-4 text-indigo-500" />,
                label: "Support dedie",
                sub: "Une equipe a votre ecoute",
              },
              {
                icon: <TrendingUp className="h-4 w-4 text-orange-500" />,
                label: "Evolutif",
                sub: "Changez de formule a tout moment",
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