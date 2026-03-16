// src/spaces/particulier/pages/AbonnementPage.tsx
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Coins,
  CreditCard,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";

type OfferTab = "investisseur" | "promoteur" | "financeur";

type StoredUser = {
  email?: string;
  logged?: boolean;
  fullName?: string;
  plan?: string;
};

function PillButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-medium transition-all",
        active
          ? "bg-slate-950 text-white shadow-sm"
          : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900",
      ].join(" ")}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function FeatureList({ items }: { items: string[] }) {
  return (
    <ul className="mt-5 space-y-3 text-sm text-slate-600">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function OfferCard({
  badge,
  title,
  price,
  subtitle,
  features,
  ctaLabel,
  onClick,
  featured = false,
  helper,
}: {
  badge: string;
  title: string;
  price: string;
  subtitle: string;
  features: string[];
  ctaLabel: string;
  onClick: () => void;
  featured?: boolean;
  helper?: string;
}) {
  return (
    <div
      className={[
        "rounded-3xl border p-6 shadow-sm transition-all",
        featured
          ? "border-sky-200 bg-gradient-to-b from-sky-50 to-white"
          : "border-slate-200 bg-white",
      ].join(" ")}
    >
      <div className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
        {badge}
      </div>

      <h3 className="mt-4 text-2xl font-semibold bg-gradient-to-r from-indigo-600 via-sky-500 to-cyan-500 bg-clip-text text-transparent animate-gradient-x drop-shadow-[0_0_8px_rgba(59,130,246,0.25)]">{title}</h3>
      <div className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
        {price}
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-500">{subtitle}</p>

      <FeatureList items={features} />

      {helper && (
        <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
          {helper}
        </div>
      )}

      <button
        type="button"
        onClick={onClick}
        className={[
          "mt-7 inline-flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-medium transition-all",
          featured
            ? "bg-slate-950 text-white hover:bg-slate-800"
            : "border border-slate-200 bg-white text-slate-900 hover:bg-slate-50",
        ].join(" ")}
      >
        <span>{ctaLabel}</span>
        <ArrowRight className="h-4 w-4" />
      </button>
    </div>
  );
}

function RechargeCard({
  title,
  price,
  onClick,
}: {
  title: string;
  price: string;
  onClick: () => void;
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
        <Coins className="h-3.5 w-3.5" />
        Recharge
      </div>

      <h3 className="mt-4 text-xl font-semibold bg-gradient-to-r from-indigo-600 via-sky-500 to-cyan-500 bg-clip-text text-transparent animate-gradient-x drop-shadow-[0_0_8px_rgba(59,130,246,0.25)]">{title}</h3>
      <p className="mt-2 text-lg font-medium text-slate-900">{price}</p>
      <p className="mt-2 text-sm text-slate-500">
        Idéal en complément d'un abonnement ou pour un besoin ponctuel.
      </p>

      <button
        type="button"
        onClick={onClick}
        className="mt-5 inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-900 transition-all hover:bg-slate-50"
      >
        Acheter
      </button>
    </div>
  );
}

export default function AbonnementPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<OfferTab>("investisseur");

  const user = useMemo<StoredUser>(() => {
    try {
      const raw = localStorage.getItem("mimmoza.user");
      return raw ? (JSON.parse(raw) as StoredUser) : {};
    } catch {
      return {};
    }
  }, []);

  const savePlan = (plan: string) => {
    localStorage.setItem(
      "mimmoza.user",
      JSON.stringify({
        ...user,
        plan,
      })
    );
    navigate("/compte");
  };

  const renderInvestisseur = () => {
    return (
      <>
        <section className="mt-14">
          <div className="mb-6">
            <h2 className="text-2xl font-semibold text-slate-950">
              Investisseur particulier & marchand de biens
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-600">
              Un modèle simple et flexible : achat ponctuel de jetons pour tester
              Mimmoza, puis abonnements mensuels pour les utilisateurs récurrents.
            </p>
          </div>

          <div className="grid gap-6 xl:grid-cols-4">
            <OfferCard
              badge="Jetons"
              title="10 analyses"
              price="9,90€ HT"
              subtitle="1 analyse = 1 jeton"
              features={[
                "Parfait pour découvrir la plateforme",
                "Sans engagement",
                "Usage ponctuel",
              ]}
              ctaLabel="Acheter"
              onClick={() => savePlan("tokens-10")}
            />

            <OfferCard
              badge="Jetons"
              title="20 analyses"
              price="16,90€ HT"
              subtitle="Meilleur prix unitaire"
              features={[
                "Volume intermédiaire",
                "Sans engagement",
                "Adapté aux besoins occasionnels",
              ]}
              ctaLabel="Acheter"
              onClick={() => savePlan("tokens-20")}
            />

            <OfferCard
              badge="Abonnement"
              title="Starter"
              price="39,90€ HT / mois"
              subtitle="50 analyses incluses"
              features={[
                "50 analyses par mois",
                "Recharge de jetons possible",
                "Très bon plan pour les utilisateurs réguliers",
              ]}
              helper="C'est la formule à pousser commercialement pour convertir les utilisateurs récurrents."
              ctaLabel="Choisir Starter"
              onClick={() => savePlan("starter")}
              featured
            />

            <OfferCard
              badge="Abonnement"
              title="Pro"
              price="74,99€ HT / mois"
              subtitle="200 analyses incluses"
              features={[
                "200 analyses par mois",
                "Recharge jetons disponible",
                "Pensé pour marchands de biens actifs",
              ]}
              helper="Plus lisible et plus sûr qu'un illimité, tout en laissant une porte de sortie via recharge."
              ctaLabel="Choisir Pro"
              onClick={() => savePlan("pro")}
            />
          </div>
        </section>

        <section className="mt-12">
          <div className="mb-6">
            <h3 className="text-xl font-semibold text-slate-950">
              Recharges complémentaires
            </h3>
            <p className="mt-2 text-sm leading-7 text-slate-600">
              Pour les abonnés qui dépassent leur quota ou pour les utilisateurs
              qui préfèrent acheter à la demande.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <RechargeCard
              title="25 analyses"
              price="19,90€ HT"
              onClick={() => savePlan("recharge-25")}
            />
            <RechargeCard
              title="50 analyses"
              price="34,90€ HT"
              onClick={() => savePlan("recharge-50")}
            />
          </div>
        </section>
      </>
    );
  };

  const renderPromoteur = () => {
    return (
      <section className="mt-14">
        <div className="mb-6">
          <h2 className="text-2xl font-semibold text-slate-950">Promoteur</h2>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-600">
            Une offre pensée comme un outil métier B2B, plus proche d'un poste de
            travail complet que d'une simple analyse à l'unité.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <OfferCard
            badge="Promoteur"
            title="Starter Promoteur"
            price="À partir de 149€ HT / mois"
            subtitle="Pour démarrer sur les premières études"
            features={[
              "Faisabilité foncière",
              "Lecture PLU",
              "Études de marché",
              "Synthèses de base",
            ]}
            ctaLabel="Demander une démo"
            onClick={() => savePlan("promoteur-starter")}
          />

          <OfferCard
            badge="Promoteur"
            title="Pro Promoteur"
            price="À partir de 299€ HT / mois"
            subtitle="Pour un usage régulier et des dossiers plus complets"
            features={[
              "Faisabilité + risques + bilan",
              "Exports avancés",
              "Usage équipe légère",
              "Montée en charge progressive",
            ]}
            ctaLabel="Être recontacté"
            onClick={() => savePlan("promoteur-pro")}
            featured
          />

          <OfferCard
            badge="Entreprise"
            title="Sur devis"
            price="Tarification personnalisée"
            subtitle="Pour structures multi-utilisateurs ou besoins spécifiques"
            features={[
              "Comptes équipe",
              "Paramétrage spécifique",
              "Accompagnement au déploiement",
              "Possibilités d'intégrations futures",
            ]}
            ctaLabel="Contacter Mimmoza"
            onClick={() => savePlan("promoteur-enterprise")}
          />
        </div>
      </section>
    );
  };

  const renderFinanceur = () => {
    return (
      <section className="mt-14">
        <div className="mb-6">
          <h2 className="text-2xl font-semibold text-slate-950">Financeur</h2>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-600">
            Une offre institutionnelle pour l'analyse de risque, la lecture des
            dossiers, les garanties et la préparation comité.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <OfferCard
            badge="Financeur"
            title="Professional"
            price="À partir de 299€ HT / mois"
            subtitle="Pour structurer les premiers usages en analyse dossier"
            features={[
              "Analyse de risque",
              "Lecture synthétique des dossiers",
              "Scoring opérationnel",
              "Usage mono-utilisateur ou restreint",
            ]}
            ctaLabel="Demander une démo"
            onClick={() => savePlan("financeur-pro")}
          />

          <OfferCard
            badge="Financeur"
            title="Équipe"
            price="À partir de 699€ HT / mois"
            subtitle="Pour usage collaboratif et suivi plus structuré"
            features={[
              "Comité crédit",
              "Lecture garanties",
              "Suivi portefeuille / dossiers",
              "Accès multi-utilisateurs",
            ]}
            ctaLabel="Être recontacté"
            onClick={() => savePlan("financeur-equipe")}
            featured
          />

          <OfferCard
            badge="Enterprise"
            title="Sur devis"
            price="Tarification personnalisée"
            subtitle="Pour établissements, réseaux ou besoins spécifiques"
            features={[
              "Déploiement plus large",
              "Paramétrage métier",
              "Flux et gouvernance",
              "Accompagnement projet",
            ]}
            ctaLabel="Contacter Mimmoza"
            onClick={() => savePlan("financeur-enterprise")}
          />
        </div>
      </section>
    );
  };

  return (
    <div className="relative overflow-hidden rounded-[32px] border border-slate-200/80 bg-white shadow-sm">
      <style>{`
@keyframes gradient-x {
  0%   { background-position: 0%   50% }
  50%  { background-position: 100% 50% }
  100% { background-position: 0%   50% }
}
.animate-gradient-x {
  background-size: 200% 200%;
  animation: gradient-x 8s ease infinite;
}
      `}</style>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.12),_transparent_35%),radial-gradient(circle_at_top_right,_rgba(6,182,212,0.10),_transparent_28%),linear-gradient(180deg,_#f8fbff_0%,_#ffffff_38%,_#f8fafc_100%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.06)_1px,transparent_1px)] bg-[size:28px_28px] [mask-image:linear-gradient(to_bottom,black,transparent_90%)]" />

      <div className="relative mx-auto max-w-7xl px-6 py-10 lg:px-10 lg:py-14">
        <div className="mx-auto max-w-4xl text-center">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white/85 px-4 py-2 text-sm font-medium text-sky-700 shadow-sm">
            <Sparkles className="h-4 w-4" />
            Offres Mimmoza
          </div>

          <h1 className="text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl lg:text-6xl">
            Choisissez votre{" "}
            <span className="bg-gradient-to-r from-indigo-600 via-sky-500 to-cyan-500 bg-clip-text text-transparent">
              formule
            </span>
          </h1>

          <p className="mx-auto mt-5 max-w-3xl text-lg leading-8 text-slate-600">
            Une tarification adaptée à chaque profil : investisseur, promoteur
            ou financeur.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <PillButton
              active={activeTab === "investisseur"}
              onClick={() => setActiveTab("investisseur")}
              icon={<Coins className="h-4 w-4" />}
              label="Investisseur"
            />
            <PillButton
              active={activeTab === "promoteur"}
              onClick={() => setActiveTab("promoteur")}
              icon={<Building2 className="h-4 w-4" />}
              label="Promoteur"
            />
            <PillButton
              active={activeTab === "financeur"}
              onClick={() => setActiveTab("financeur")}
              icon={<ShieldCheck className="h-4 w-4" />}
              label="Financeur"
            />
          </div>
        </div>

        {activeTab === "investisseur" && renderInvestisseur()}
        {activeTab === "promoteur" && renderPromoteur()}
        {activeTab === "financeur" && renderFinanceur()}

        <section className="mt-14 grid gap-6 lg:grid-cols-3">
          <div className="rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Users className="h-4 w-4 text-sky-500" />
              Offres entreprise
            </div>
            <p className="mt-3 text-sm leading-7 text-slate-600">
              Pour les équipes, comptes multi-utilisateurs ou demandes spécifiques,
              une offre sur mesure pourra être gérée côté administrateur.
            </p>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <CreditCard className="h-4 w-4 text-indigo-500" />
              Modèle hybride
            </div>
            <p className="mt-3 text-sm leading-7 text-slate-600">
              Le couple abonnement + recharge est le plus sain pour Mimmoza :
              revenu récurrent, souplesse pour le client et meilleure conversion.
            </p>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Sparkles className="h-4 w-4 text-emerald-500" />
              Prochaine étape
            </div>
            <p className="mt-3 text-sm leading-7 text-slate-600">
              Cette page prépare le branchement Stripe et le futur espace
              administrateur pour piloter abonnements, recharges et devis.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}