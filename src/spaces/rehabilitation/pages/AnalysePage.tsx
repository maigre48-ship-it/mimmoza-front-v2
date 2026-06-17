import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  HardHat,
  Info,
  Lightbulb,
  MapPin,
  ScanSearch,
  ShieldAlert,
  TrendingUp,
} from "lucide-react";
import { useState } from "react";

type FormData = {
  adresse: string;
  typeBien: string;
  surface: string;
  niveaux: string;
  annee: string;
  etat: string;
  objectif: string;
};

type Synthese = {
  potentiel: { label: string; color: string; score: number };
  niveauTravaux: { label: string; color: string };
  pointsReglementaires: string[];
  opportunites: string[];
};

const initialForm: FormData = {
  adresse: "",
  typeBien: "",
  surface: "",
  niveaux: "",
  annee: "",
  etat: "",
  objectif: "",
};

function computeSynthese(form: FormData): Synthese {
  const surf = parseFloat(form.surface) || 0;
  const ann = parseInt(form.annee) || 0;

  // Potentiel
  let score = 50;
  if (form.etat === "bon") score += 20;
  if (form.etat === "moyen") score += 5;
  if (form.etat === "degrade") score -= 15;
  if (form.objectif === "division") score += 15;
  if (form.objectif === "surelevation") score += 10;
  if (form.objectif === "changement_usage") score += 10;
  if (surf > 200) score += 10;
  score = Math.max(10, Math.min(95, score));

  let potentielLabel = "Faible";
  let potentielColor = "text-red-600 bg-red-50 border-red-200";
  if (score >= 70) { potentielLabel = "Élevé"; potentielColor = "text-emerald-700 bg-emerald-50 border-emerald-200"; }
  else if (score >= 50) { potentielLabel = "Modéré"; potentielColor = "text-amber-700 bg-amber-50 border-amber-200"; }

  // Niveau travaux
  let niveauLabel = "Standard";
  let niveauColor = "text-amber-700 bg-amber-50 border-amber-200";
  if (form.etat === "degrade") { niveauLabel = "Lourd"; niveauColor = "text-red-700 bg-red-50 border-red-200"; }
  if (form.etat === "bon" && form.objectif === "renovation") { niveauLabel = "Léger"; niveauColor = "text-emerald-700 bg-emerald-50 border-emerald-200"; }

  // Points réglementaires
  const points: string[] = [];
  if (ann < 1948) points.push("Diagnostic plomb (antérieur à 1949)");
  if (ann < 1997) points.push("Diagnostic amiante obligatoire (antérieur à 1997)");
  if (form.objectif === "division") points.push("Déclaration de division ou de copropriété");
  if (form.objectif === "changement_usage") points.push("Autorisation de changement de destination (PLU)");
  if (form.objectif === "surelevation") points.push("Permis de construire pour surélévation");
  if (form.typeBien === "immeuble") points.push("Vérification du règlement de copropriété");
  if (points.length === 0) points.push("Déclaration préalable ou permis selon l'ampleur des travaux");

  // Opportunités
  const opps: string[] = [];
  if (form.objectif === "division") opps.push("Création de lots supplémentaires → valorisation multiple");
  if (form.objectif === "surelevation") opps.push("Surface nouvelle sans foncier supplémentaire");
  if (form.objectif === "changement_usage") opps.push("Passage vers usage plus rentable (ex. commerce → habitation)");
  if (form.etat === "degrade") opps.push("Décote à l'achat potentielle si bien sous-évalué");
  if (surf > 150) opps.push("Surface suffisante pour division en plusieurs logements");
  if (opps.length === 0) opps.push("Amélioration du DPE → revalorisation locative");

  return {
    potentiel: { label: potentielLabel, color: potentielColor, score },
    niveauTravaux: { label: niveauLabel, color: niveauColor },
    pointsReglementaires: points,
    opportunites: opps,
  };
}

const inputClass =
  "w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition placeholder:text-slate-400";
const selectClass =
  "w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition";

export default function RehabilitationAnalysePage() {
  const [form, setForm] = useState<FormData>(initialForm);
  const [synthese, setSynthese] = useState<Synthese | null>(null);

  const isValid =
    form.adresse.trim() !== "" &&
    form.typeBien !== "" &&
    form.surface !== "" &&
    form.niveaux !== "" &&
    form.annee !== "" &&
    form.etat !== "" &&
    form.objectif !== "";

  function handleSubmit() {
    if (!isValid) return;
    setSynthese(computeSynthese(form));
    setTimeout(() => {
      document.getElementById("synthese-block")?.scrollIntoView({ behavior: "smooth" });
    }, 100);
  }

  function set(field: keyof FormData, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
    setSynthese(null);
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-sm">
          <ScanSearch size={20} className="text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-800">Analyse du bâti</h1>
          <p className="text-sm text-slate-500">Évaluez le potentiel de votre bien existant</p>
        </div>
      </div>

      {/* Form */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 space-y-5">
        {/* Adresse */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide flex items-center gap-1.5">
            <MapPin size={12} /> Adresse du bien
          </label>
          <input
            type="text"
            placeholder="Ex : 12 rue de la Paix, Paris 75002"
            value={form.adresse}
            onChange={(e) => set("adresse", e.target.value)}
            className={inputClass}
          />
        </div>

        {/* Type bien + surface */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
              Type de bien
            </label>
            <select value={form.typeBien} onChange={(e) => set("typeBien", e.target.value)} className={selectClass}>
              <option value="">-- Sélectionner --</option>
              <option value="maison">Maison individuelle</option>
              <option value="immeuble">Immeuble collectif</option>
              <option value="appartement">Appartement</option>
              <option value="local_commercial">Local commercial</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
              Surface existante (m²)
            </label>
            <input
              type="number"
              min={1}
              placeholder="Ex : 180"
              value={form.surface}
              onChange={(e) => set("surface", e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        {/* Niveaux + année */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
              Nombre de niveaux
            </label>
            <select value={form.niveaux} onChange={(e) => set("niveaux", e.target.value)} className={selectClass}>
              <option value="">-- Sélectionner --</option>
              {["1", "2", "3", "4", "5", "6+"].map((n) => (
                <option key={n} value={n}>{n} niveau{parseInt(n) > 1 ? "x" : ""}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
              Année approximative de construction
            </label>
            <input
              type="number"
              min={1800}
              max={2024}
              placeholder="Ex : 1965"
              value={form.annee}
              onChange={(e) => set("annee", e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        {/* État + objectif */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
              État général du bien
            </label>
            <select value={form.etat} onChange={(e) => set("etat", e.target.value)} className={selectClass}>
              <option value="">-- Sélectionner --</option>
              <option value="bon">Bon état</option>
              <option value="moyen">État moyen</option>
              <option value="degrade">État dégradé</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
              Objectif principal
            </label>
            <select value={form.objectif} onChange={(e) => set("objectif", e.target.value)} className={selectClass}>
              <option value="">-- Sélectionner --</option>
              <option value="renovation">Rénovation</option>
              <option value="division">Division</option>
              <option value="surelevation">Surélévation</option>
              <option value="changement_usage">Changement d'usage</option>
              <option value="revente">Revente</option>
            </select>
          </div>
        </div>

        <button
          onClick={handleSubmit}
          disabled={!isValid}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 disabled:opacity-40 disabled:cursor-not-allowed transition shadow-sm"
        >
          Analyser le potentiel
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Synthèse */}
      {synthese && (
        <div id="synthese-block" className="space-y-4">
          {/* Disclaimer */}
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl p-4">
            <Info size={15} className="text-amber-600 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-700 font-medium leading-relaxed">
              Pré-analyse indicative — données à confirmer avec un professionnel (architecte, géomètre,
              bureau de contrôle). Cette synthèse est générée localement sans consultation de base
              de données externe.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Potentiel */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
              <div className="flex items-center gap-2">
                <TrendingUp size={16} className="text-amber-600" />
                <span className="text-sm font-bold text-slate-700">Potentiel de valorisation</span>
              </div>
              <div className={`inline-flex items-center gap-1.5 text-sm font-bold px-3 py-1 rounded-lg border ${synthese.potentiel.color}`}>
                <CheckCircle2 size={14} />
                {synthese.potentiel.label}
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2">
                <div
                  className="h-2 rounded-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all"
                  style={{ width: `${synthese.potentiel.score}%` }}
                />
              </div>
              <p className="text-xs text-slate-400">Score estimé : {synthese.potentiel.score}/100</p>
            </div>

            {/* Niveau travaux */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
              <div className="flex items-center gap-2">
                <HardHat size={16} className="text-amber-600" />
                <span className="text-sm font-bold text-slate-700">Niveau de travaux estimé</span>
              </div>
              <div className={`inline-flex items-center gap-1.5 text-sm font-bold px-3 py-1 rounded-lg border ${synthese.niveauTravaux.color}`}>
                {synthese.niveauTravaux.label}
              </div>
              <p className="text-xs text-slate-400">
                Basé sur l'état général et l'objectif déclarés. Confirmez avec un maître d'œuvre.
              </p>
            </div>
          </div>

          {/* Points réglementaires */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
            <div className="flex items-center gap-2">
              <ShieldAlert size={16} className="text-amber-600" />
              <span className="text-sm font-bold text-slate-700">Points réglementaires à vérifier</span>
            </div>
            <ul className="space-y-2">
              {synthese.pointsReglementaires.map((p, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-slate-600">
                  <AlertCircle size={13} className="text-amber-500 mt-0.5 shrink-0" />
                  {p}
                </li>
              ))}
            </ul>
          </div>

          {/* Opportunités */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
            <div className="flex items-center gap-2">
              <Lightbulb size={16} className="text-amber-600" />
              <span className="text-sm font-bold text-slate-700">Opportunités détectées</span>
            </div>
            <ul className="space-y-2">
              {synthese.opportunites.map((o, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-slate-600">
                  <CheckCircle2 size={13} className="text-emerald-500 mt-0.5 shrink-0" />
                  {o}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}