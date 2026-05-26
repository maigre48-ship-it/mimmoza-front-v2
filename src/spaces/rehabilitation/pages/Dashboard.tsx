import { useNavigate } from "react-router-dom";
import {
  ScanSearch,
  HardHat,
  ShieldCheck,
  Layers,
  Sparkles,
  TrendingUp,
  ArrowRight,
  Upload,
  Building2,
} from "lucide-react";

const cards = [
  {
    icon: ScanSearch,
    title: "Analyse du bâti",
    description:
      "Évaluez le potentiel d'un immeuble ou d'une maison existante : structure, époque, état général.",
    to: "/rehabilitation/analyse",
    color: "from-amber-400 to-orange-500",
    bg: "bg-amber-50",
    border: "border-amber-200",
    text: "text-amber-700",
  },
  {
    icon: HardHat,
    title: "Estimation travaux",
    description:
      "Calculez une fourchette de coûts par poste : démolition, second œuvre, façade, fluides, finitions.",
    to: "/rehabilitation/travaux",
    color: "from-orange-400 to-red-500",
    bg: "bg-orange-50",
    border: "border-orange-200",
    text: "text-orange-700",
  },
  {
    icon: ShieldCheck,
    title: "Conformité réglementaire",
    description:
      "Vérifiez accessibilité PMR, sécurité incendie, ventilation, changement d'usage selon la destination.",
    to: "/rehabilitation/conformite",
    color: "from-yellow-400 to-amber-500",
    bg: "bg-yellow-50",
    border: "border-yellow-200",
    text: "text-yellow-700",
  },
  {
    icon: Layers,
    title: "Division / Changement d'usage",
    description:
      "Analysez la faisabilité d'une division parcellaire, d'une surélévation ou d'un changement de destination.",
    to: "/rehabilitation/analyse",
    color: "from-amber-500 to-orange-600",
    bg: "bg-amber-50",
    border: "border-amber-200",
    text: "text-amber-700",
  },
  {
    icon: Sparkles,
    title: "Rendu IA avant/après",
    description:
      "Visualisez le potentiel de votre bien rénové grâce à une simulation visuelle par intelligence artificielle.",
    to: "/rehabilitation/analyse",
    color: "from-rose-400 to-orange-500",
    bg: "bg-rose-50",
    border: "border-rose-200",
    text: "text-rose-700",
    badge: "Bientôt disponible",
  },
  {
    icon: TrendingUp,
    title: "Valorisation après travaux",
    description:
      "Calculez marge brute, taux de rentabilité et valeur de sortie selon votre stratégie de revente ou location.",
    to: "/rehabilitation/valorisation",
    color: "from-amber-400 to-yellow-500",
    bg: "bg-amber-50",
    border: "border-amber-200",
    text: "text-amber-700",
  },
];

const stats = [
  { label: "Modules disponibles", value: "5", sub: "Analyse · Travaux · Conformité · Valorisation" },
  { label: "Données indicatives", value: "100%", sub: "À confirmer avec un professionnel" },
  { label: "Export PDF", value: "À venir", sub: "Synthèse complète" },
];

export default function RehabilitationDashboard() {
  const navigate = useNavigate();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-10">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-500 via-orange-500 to-red-500 p-8 md:p-12 text-white shadow-xl">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-0 right-0 w-64 h-64 bg-white rounded-full -translate-y-32 translate-x-32" />
          <div className="absolute bottom-0 left-0 w-48 h-48 bg-white rounded-full translate-y-24 -translate-x-24" />
        </div>
        <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div className="space-y-3 max-w-xl">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
                <Building2 size={20} className="text-white" />
              </div>
              <span className="text-sm font-semibold text-white/80 uppercase tracking-widest">
                Espace Réhabilitation
              </span>
            </div>
            <h1 className="text-3xl md:text-4xl font-bold leading-tight">
              Transformez et valorisez<br className="hidden md:block" /> un bien existant.
            </h1>
            <p className="text-white/75 text-base leading-relaxed">
              Analyse du bâti, estimation de travaux, conformité réglementaire et calcul de valorisation
              — un outil complet pour vos projets de réhabilitation immobilière.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 shrink-0">
            <button
              onClick={() => navigate("/rehabilitation/analyse")}
              className="flex items-center justify-center gap-2 px-6 py-3 bg-white text-amber-600 font-semibold rounded-xl hover:bg-amber-50 transition-colors shadow-sm text-sm"
            >
              Lancer une analyse
              <ArrowRight size={16} />
            </button>
            <button
              onClick={() => {}}
              className="flex items-center justify-center gap-2 px-6 py-3 bg-white/15 border border-white/30 text-white font-semibold rounded-xl hover:bg-white/25 transition-colors text-sm"
            >
              <Upload size={16} />
              Importer un plan
            </button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm text-center"
          >
            <div className="text-2xl font-bold text-amber-600">{s.value}</div>
            <div className="text-sm font-semibold text-slate-700 mt-1">{s.label}</div>
            <div className="text-xs text-slate-400 mt-0.5">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Cards grid */}
      <div>
        <h2 className="text-lg font-bold text-slate-800 mb-4">Modules disponibles</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {cards.map((card) => (
            <div
              key={card.title}
              onClick={() => !card.badge && navigate(card.to)}
              className={`group relative bg-white border border-slate-200 rounded-2xl p-6 shadow-sm transition-all hover:shadow-md ${
                card.badge ? "opacity-75 cursor-not-allowed" : "cursor-pointer hover:border-amber-200"
              }`}
            >
              {card.badge && (
                <span className="absolute top-4 right-4 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
                  {card.badge}
                </span>
              )}
              <div
                className={`w-11 h-11 rounded-xl bg-gradient-to-br ${card.color} flex items-center justify-center mb-4 shadow-sm`}
              >
                <card.icon size={22} className="text-white" />
              </div>
              <h3 className="text-sm font-bold text-slate-800 mb-1.5">{card.title}</h3>
              <p className="text-xs text-slate-500 leading-relaxed">{card.description}</p>
              {!card.badge && (
                <div
                  className={`mt-4 flex items-center gap-1 text-xs font-semibold ${card.text} group-hover:gap-2 transition-all`}
                >
                  Accéder <ArrowRight size={12} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Disclaimer */}
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 flex gap-3">
        <div className="shrink-0 mt-0.5">
          <ShieldCheck size={18} className="text-amber-600" />
        </div>
        <div>
          <p className="text-sm font-semibold text-amber-800">Données indicatives</p>
          <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">
            Toutes les analyses produites par cet espace sont des pré-analyses à caractère indicatif.
            Elles ne remplacent pas l'avis d'un architecte, d'un bureau de contrôle, d'un géomètre ou
            de toute autorité compétente. Confirmez chaque point avant toute décision d'investissement.
          </p>
        </div>
      </div>
    </div>
  );
}