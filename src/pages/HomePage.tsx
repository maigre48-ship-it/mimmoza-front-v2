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
  Play,
} from "lucide-react";

type HomeSpaceCard = {
  id: string;
  title: string;
  description: string;
  route: string;
  icon: React.ComponentType<{ className?: string }>;
  badge: string;
  featureText: string;
  featureColor: string;
  featureBg: string;
  barClass: string;
  badgeBg: string;
  badgeText: string;
  iconBg: string;
  iconStroke: string;
  points: string[];
};

const spaces: HomeSpaceCard[] = [
  {
    id: "investisseur",
    title: "Investisseur particulier et marchand de bien",
    description:
      "Analyse rapide d'opportunités, scoring, rentabilité, exécution des travaux et stratégie de sortie.",
    route: "/marchand-de-bien",
    icon: BarChart3,
    badge: "Investissement",
    featureText: "Rendu IA avant/après travaux — visualisez votre bien rénové",
    featureColor: "#6d28d9",
    featureBg: "#faf5ff",
    barClass: "bar-investisseur",
    badgeBg: "#eef2ff",
    badgeText: "#3730a3",
    iconBg: "#eef2ff",
    iconStroke: "#4338ca",
    points: ["Sourcing", "Analyse", "Simulation"],
  },
  {
    id: "promoteur",
    title: "Promoteur",
    description:
      "Faisabilité foncière, lecture PLU, analyse des risques, massing 3D et bilan promoteur complet.",
    route: "/promoteur",
    icon: Building2,
    badge: "Développement",
    featureText: "Rendu façade IA — visualisez le bâtiment projeté",
    featureColor: "#0e7490",
    featureBg: "#ecfeff",
    barClass: "bar-promoteur",
    badgeBg: "#ecfdf5",
    badgeText: "#065f46",
    iconBg: "#ecfdf5",
    iconStroke: "#047857",
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
    featureText: "Synthèse IA des dossiers — rapport comité généré automatiquement",
    featureColor: "#475569",
    featureBg: "#f8fafc",
    barClass: "bar-financeur",
    badgeBg: "#f8fafc",
    badgeText: "#334155",
    iconBg: "#f1f5f9",
    iconStroke: "#475569",
    points: ["Risque", "Comité", "Suivi"],
  },
];

const pills = [
  { label: "Scoring intelligent",          dot: "#6ee7b7" },
  { label: "Analyse parcellaire",           dot: "#93c5fd" },
  { label: "Études de marché",             dot: "#c4b5fd" },
  { label: "Rendu IA avant/après travaux", dot: "#fbbf24" },
  { label: "Aide à la décision",           dot: "#6ee7b7" },
];

const features = [
  {
    icon: TrendingUp,
    iconBg: "#eef2ff",
    iconColor: "#4338ca",
    title: "Décision plus rapide",
    desc: "Des interfaces pensées pour aller de l'opportunité à la décision.",
  },
  {
    icon: Layers3,
    iconBg: "#ecfdf5",
    iconColor: "#047857",
    title: "Vue unifiée des dossiers",
    desc: "Marché, risques, faisabilité et exploitation dans une seule plateforme.",
  },
  {
    icon: CheckCircle2,
    iconBg: "#f5f3ff",
    iconColor: "#7c3aed",
    title: "Restitution professionnelle",
    desc: "Un rendu premium adapté à l'analyse, à la présentation et au comité.",
  },
];

export default function HomePage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#f8fafc]">

      {/* ══════════════════════════════════════════════════════════════
          HERO — violet → blanc, la transition démarre au niveau vidéo
      ══════════════════════════════════════════════════════════════ */}
      <div
        className="relative overflow-hidden"
        style={{
          background:
            "linear-gradient(180deg, #2d1f5e 0%, #231950 28%, #1a3060 48%, #c8cfe8 72%, #f0f4f8 84%, #f8fafc 100%)",
          paddingBottom: 0,
        }}
      >
        {/* Grille de points — s'estompe avec le dégradé */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(circle, rgba(255,255,255,0.04) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
            WebkitMaskImage:
              "linear-gradient(180deg, black 0%, black 45%, transparent 70%)",
            maskImage:
              "linear-gradient(180deg, black 0%, black 45%, transparent 70%)",
          }}
        />

        {/* Halos lumineux */}
        <div
          className="pointer-events-none absolute"
          style={{
            top: -100, left: -80,
            width: 480, height: 480,
            background:
              "radial-gradient(circle, rgba(167,139,250,0.30) 0%, transparent 65%)",
          }}
        />
        <div
          className="pointer-events-none absolute"
          style={{
            top: -60, right: -60,
            width: 340, height: 340,
            background:
              "radial-gradient(circle, rgba(56,189,248,0.18) 0%, transparent 65%)",
          }}
        />

        {/* Contenu du hero */}
        <div className="relative mx-auto max-w-5xl px-6 pt-12 lg:px-10 lg:pt-16">

          {/* Badge */}
          <div
            className="mb-6 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm"
            style={{
              background: "rgba(196,181,253,0.16)",
              border: "0.5px solid rgba(196,181,253,0.38)",
              color: "#ddd6fe",
            }}
          >
            <Sparkles className="h-4 w-4" />
            Intelligence immobilière décisionnelle
          </div>

          {/* Titre */}
          <h1
            className="max-w-[600px] text-4xl font-medium leading-[1.15] lg:text-5xl"
            style={{ color: "#f0ebff" }}
          >
            Une plateforme unique pour{" "}
            <span
              style={{
                background:
                  "linear-gradient(90deg, #c4b5fd 0%, #93c5fd 50%, #6ee7b7 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              analyser, décider et piloter
            </span>{" "}
            vos opérations immobilières
          </h1>

          {/* Sous-titre */}
          <p
            className="mt-5 max-w-[540px] text-base leading-7 lg:text-[15px]"
            style={{ color: "#9badc8" }}
          >
            Mimmoza centralise l'analyse de faisabilité, le scoring, la lecture
            des risques, les études de marché et les outils opérationnels pour
            investisseurs, promoteurs et financeurs.
          </p>

          {/* Pills */}
          <div className="mt-6 flex flex-wrap gap-2">
            {pills.map((p) => (
              <span
                key={p.label}
                className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px]"
                style={{
                  background: "rgba(255,255,255,0.09)",
                  border: "0.5px solid rgba(255,255,255,0.16)",
                  color: "#b0c0d8",
                }}
              >
                <span
                  className="h-[5px] w-[5px] flex-shrink-0 rounded-full"
                  style={{ background: p.dot }}
                />
                {p.label}
              </span>
            ))}
          </div>

          {/* ── Vidéo — posée sur la zone de transition ── */}
          <div className="mt-12 pb-0">
            <div
              className="group relative mx-auto aspect-video w-full cursor-pointer overflow-hidden rounded-2xl"
              style={{
                background: "rgba(255,255,255,0.78)",
                border: "0.5px solid rgba(180,180,220,0.35)",
                boxShadow:
                  "0 8px 40px rgba(30,20,80,0.12), 0 2px 8px rgba(30,20,80,0.06)",
                backdropFilter: "blur(4px)",
              }}
            >
              {/* Badge durée */}
              <div
                className="absolute right-4 top-4 rounded-full px-3 py-1 text-xs"
                style={{
                  background: "rgba(255,255,255,0.9)",
                  border: "0.5px solid #e2e8f0",
                  color: "#94a3b8",
                }}
              >
                ~3 min
              </div>

              {/* Bouton play */}
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                <div
                  className="flex h-[56px] w-[56px] items-center justify-center rounded-full transition-transform duration-200 group-hover:scale-110"
                  style={{
                    background: "rgba(109,40,217,0.15)",
                    border: "0.5px solid rgba(109,40,217,0.30)",
                  }}
                >
                  <Play
                    className="ml-0.5 h-5 w-5"
                    style={{ fill: "#6d28d9", color: "#6d28d9" }}
                  />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium" style={{ color: "#475569" }}>
                    Découvrir Mimmoza en vidéo
                  </p>
                  <p className="mt-1 text-xs" style={{ color: "#94a3b8" }}>
                    Vidéo de présentation à venir
                  </p>
                </div>
              </div>
            </div>
          </div>
          {/* ── Fin vidéo ── */}

        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          SECTION BLANCHE — cartes espaces + features
      ══════════════════════════════════════════════════════════════ */}
      <div className="bg-[#f8fafc] px-6 pb-16 pt-12 lg:px-10">
        <div className="mx-auto max-w-5xl">

          {/* Label section */}
          <p
            className="mb-6 text-[10px] font-medium uppercase tracking-[0.14em]"
            style={{ color: "#94a3b8" }}
          >
            Choisissez votre espace
          </p>

          {/* ── Cartes espaces ── */}
          <div className="mb-8 grid gap-4 lg:grid-cols-3">
            {spaces.map((space) => {
              const Icon = space.icon;
              return (
                <Link
                  key={space.id}
                  to={space.route}
                  className="group relative overflow-hidden rounded-2xl bg-white transition-all duration-200 hover:-translate-y-1 hover:shadow-[0_12px_40px_rgba(15,23,42,0.1)]"
                  style={{ border: "0.5px solid #e2e8f0" }}
                >
                  {/* Barre colorée top */}
                  <div
                    className="absolute left-0 right-0 top-0 h-[3px]"
                    style={{
                      background:
                        space.id === "investisseur"
                          ? "linear-gradient(90deg, #6366f1, #38bdf8)"
                          : space.id === "promoteur"
                          ? "linear-gradient(90deg, #0891b2, #34d399)"
                          : "linear-gradient(90deg, #475569, #6366f1)",
                    }}
                  />

                  <div className="p-6">
                    {/* Header : badge + icône */}
                    <div className="mb-4 mt-1 flex items-start justify-between">
                      <span
                        className="inline-block rounded-full px-2.5 py-1 text-[9px] font-medium uppercase tracking-[0.1em]"
                        style={{
                          background: space.badgeBg,
                          color: space.badgeText,
                        }}
                      >
                        {space.badge}
                      </span>
                      <div
                        className="flex h-9 w-9 items-center justify-center rounded-[10px] transition-transform duration-200 group-hover:scale-105"
                        style={{ background: space.iconBg }}
                      >
                        <Icon
                          className="h-[17px] w-[17px]"
                          style={{ color: space.iconStroke }}
                        />
                      </div>
                    </div>

                    {/* Titre */}
                    <h2 className="mb-2 text-sm font-medium leading-snug text-slate-900">
                      {space.title}
                    </h2>

                    {/* Description */}
                    <p className="mb-3 text-[11px] leading-relaxed text-slate-500">
                      {space.description}
                    </p>

                    {/* Feature IA */}
                    <div
                      className="mb-4 flex items-start gap-2 rounded-lg px-2.5 py-2"
                      style={{
                        background: space.featureBg,
                        border: "0.5px solid #e9d5ff",
                      }}
                    >
                      <span
                        className="mt-[3px] h-[6px] w-[6px] flex-shrink-0 rounded-full"
                        style={{ background: space.featureColor }}
                      />
                      <span
                        className="text-[10px] leading-[1.45]"
                        style={{ color: space.featureColor }}
                      >
                        {space.featureText}
                      </span>
                    </div>

                    {/* Tags */}
                    <div className="flex flex-wrap gap-1.5">
                      {space.points.map((pt) => (
                        <span
                          key={pt}
                          className="rounded-full px-2 py-0.5 text-[9px]"
                          style={{ background: "#f1f5f9", color: "#64748b" }}
                        >
                          {pt}
                        </span>
                      ))}
                    </div>

                    {/* Footer */}
                    <div
                      className="mt-4 flex items-center justify-between pt-4"
                      style={{ borderTop: "0.5px solid #f1f5f9" }}
                    >
                      <span className="text-[11px]" style={{ color: "#94a3b8" }}>
                        Ouvrir l'espace
                      </span>
                      <div
                        className="flex h-7 w-7 items-center justify-center rounded-full transition-all duration-200 group-hover:border-slate-300"
                        style={{ border: "0.5px solid #e2e8f0" }}
                      >
                        <ArrowRight
                          className="h-3 w-3 transition-transform duration-200 group-hover:translate-x-0.5"
                          style={{ color: "#64748b" }}
                        />
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>

          {/* ── Bande features ── */}
          <div
            className="grid overflow-hidden rounded-2xl bg-white lg:grid-cols-3"
            style={{ border: "0.5px solid #e2e8f0" }}
          >
            {features.map((f, i) => {
              const Icon = f.icon;
              return (
                <div
                  key={f.title}
                  className="flex gap-3 p-5"
                  style={{
                    borderRight:
                      i < features.length - 1 ? "0.5px solid #f1f5f9" : "none",
                  }}
                >
                  <div
                    className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[9px]"
                    style={{ background: f.iconBg }}
                  >
                    <Icon className="h-4 w-4" style={{ color: f.iconColor }} />
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-medium text-slate-900">
                      {f.title}
                    </p>
                    <p className="text-[11px] leading-[1.55] text-slate-500">
                      {f.desc}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ═══ Footer légal ═══ */}
          <div className="mt-10 pt-6 text-center">
            <div
              className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-4 text-[11px]"
              style={{ color: "#94a3b8" }}
            >
              <Link to="/cgv" className="transition-colors hover:text-slate-700">
                CGV
              </Link>

              <span className="opacity-40">•</span>

              <Link to="/cgu" className="transition-colors hover:text-slate-700">
                CGU
              </Link>

              <span className="opacity-40">•</span>

              <Link
                to="/politique-confidentialite"
                className="transition-colors hover:text-slate-700"
              >
                Politique de confidentialité
              </Link>

              <span className="opacity-40">•</span>

              <Link
                to="/mentions-legales"
                className="transition-colors hover:text-slate-700"
              >
                Mentions légales
              </Link>
            </div>

            <p className="mt-4 text-[10px]" style={{ color: "#94a3b8" }}>
              Mimmoza est un outil d'aide à la décision. Les analyses ne constituent pas un conseil en investissement.
            </p>

            <p className="mt-2 text-[10px]" style={{ color: "#cbd5f5" }}>
              © {new Date().getFullYear()} Mimmoza — Intelligence immobilière
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}