// src/spaces/apporteur/pages/DeposerPage.tsx

import { AlertCircle, ArrowLeft, MapPin, Sparkles } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createApporteurDeal } from "../shared/apporteurDeals.store";

type TypeBien = "terrain" | "maison" | "immeuble" | "autre";

type FormState = {
  adresse: string;
  codePostal: string;
  commune: string;
  typeBien: TypeBien | "";
  apporteurName: string;
  apporteurEmail: string;
  apporteurPhone: string;
  surface: string;
  prix: string;
  commentaire: string;
};

const INITIAL: FormState = {
  adresse: "",
  codePostal: "",
  commune: "",
  typeBien: "",
  apporteurName: "",
  apporteurEmail: "",
  apporteurPhone: "",
  surface: "",
  prix: "",
  commentaire: "",
};

const TYPE_OPTIONS: Array<{ value: TypeBien; label: string }> = [
  { value: "terrain",  label: "Terrain nu" },
  { value: "maison",   label: "Maison / pavillon" },
  { value: "immeuble", label: "Immeuble" },
  { value: "autre",    label: "Autre" },
];

const INPUT_CLASS =
  "w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition-all focus:border-violet-400 focus:bg-white focus:ring-2 focus:ring-violet-100";

/** Parse un nombre saisi, tolère la virgule décimale. Retourne undefined si vide/invalide. */
function parseNumber(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export function ApporteurDeposerPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(INITIAL);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    if (!isValid) return;
    if (submitting) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      await createApporteurDeal({
        adresse: form.adresse.trim(),
        codePostal: form.codePostal.trim(),
        commune: form.commune.trim() || undefined,
        typeBien: form.typeBien as TypeBien,
        apporteurName: form.apporteurName.trim() || undefined,
        apporteurEmail: form.apporteurEmail.trim() || undefined,
        apporteurPhone: form.apporteurPhone.trim() || undefined,
        surfaceTerrainM2: parseNumber(form.surface),
        prixVendeur: parseNumber(form.prix),
        commentaire: form.commentaire.trim() || undefined,
      });
      setSubmitted(true);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Le dépôt a échoué. Veuillez réessayer."
      );
    } finally {
      setSubmitting(false);
    }
  }

  function handleReset() {
    setForm(INITIAL);
    setSubmitted(false);
    setSubmitError(null);
  }

  const isValid =
    form.adresse.trim() !== "" &&
    form.typeBien !== "" &&
    /^\d{5}$/.test(form.codePostal.trim());

  /* ── Confirmation ── */
  if (submitted) {
    return (
      <div className="mx-auto max-w-xl space-y-8">
        <button
          type="button"
          onClick={() => navigate("/apporteur")}
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-slate-800"
        >
          <ArrowLeft className="h-4 w-4" />
          Retour au dashboard
        </button>

        <div className="flex flex-col items-center gap-5 rounded-2xl border border-emerald-200 bg-emerald-50 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100">
            <Sparkles className="h-7 w-7 text-emerald-500" />
          </div>
          <div>
            <p className="text-lg font-semibold text-emerald-800">Bien déposé avec succès</p>
            <p className="mt-1 text-sm text-emerald-600">
              L'opportunité est enregistrée et visible dans votre dashboard.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleReset}
              className="rounded-xl border border-emerald-300 bg-white px-4 py-2 text-sm font-medium text-emerald-700 transition-all hover:bg-emerald-50"
            >
              Nouveau dépôt
            </button>
            <button
              type="button"
              onClick={() => navigate("/apporteur")}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-emerald-700"
            >
              Voir le dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Formulaire ── */
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <button
        type="button"
        onClick={() => navigate("/apporteur")}
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-slate-800"
      >
        <ArrowLeft className="h-4 w-4" />
        Retour au dashboard
      </button>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-slate-100 px-6 py-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100">
            <MapPin className="h-5 w-5 text-violet-600" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-slate-900">Déposer un bien</h1>
            <p className="text-xs text-slate-500">
              Renseignez les informations de l'opportunité foncière
            </p>
          </div>
        </div>

        {/* Champs */}
        <div className="space-y-5 px-6 py-6">

          {/* Identité apporteur */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700">Votre nom</label>
              <input
                name="apporteurName"
                type="text"
                value={form.apporteurName}
                onChange={handleChange}
                placeholder="Jean Dupont"
                className={INPUT_CLASS}
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700">Email</label>
              <input
                name="apporteurEmail"
                type="email"
                value={form.apporteurEmail}
                onChange={handleChange}
                placeholder="jean@exemple.fr"
                className={INPUT_CLASS}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700">Téléphone</label>
            <input
              name="apporteurPhone"
              type="tel"
              value={form.apporteurPhone}
              onChange={handleChange}
              placeholder="06 00 00 00 00"
              className={INPUT_CLASS}
            />
          </div>

          <div className="border-t border-slate-100" />

          {/* Adresse */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700">
              Adresse <span className="text-violet-500">*</span>
            </label>
            <input
              name="adresse"
              type="text"
              value={form.adresse}
              onChange={handleChange}
              placeholder="12 rue de la Paix"
              className={INPUT_CLASS}
            />
          </div>

          {/* Code postal + Commune */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700">
                Code postal <span className="text-violet-500">*</span>
              </label>
              <input
                name="codePostal"
                type="text"
                inputMode="numeric"
                maxLength={5}
                value={form.codePostal}
                onChange={handleChange}
                placeholder="92210"
                className={INPUT_CLASS}
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <label className="block text-sm font-medium text-slate-700">Commune</label>
              <input
                name="commune"
                type="text"
                value={form.commune}
                onChange={handleChange}
                placeholder="Saint-Cloud"
                className={INPUT_CLASS}
              />
            </div>
          </div>

          {/* Type */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700">
              Type de bien <span className="text-violet-500">*</span>
            </label>
            <select
              name="typeBien"
              value={form.typeBien}
              onChange={handleChange}
              className={`${INPUT_CLASS} appearance-none`}
            >
              <option value="">Sélectionner…</option>
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Surface + Prix */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700">Surface terrain (m²)</label>
              <input
                name="surface"
                type="number"
                min={0}
                value={form.surface}
                onChange={handleChange}
                placeholder="500"
                className={INPUT_CLASS}
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700">Prix vendeur (€)</label>
              <input
                name="prix"
                type="number"
                min={0}
                value={form.prix}
                onChange={handleChange}
                placeholder="350000"
                className={INPUT_CLASS}
              />
            </div>
          </div>

          {/* Commentaire */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700">Commentaire</label>
            <textarea
              name="commentaire"
              rows={4}
              value={form.commentaire}
              onChange={handleChange}
              placeholder="Contraintes particulières, contexte PLU, motivation vendeur…"
              className={`${INPUT_CLASS} resize-none`}
            />
          </div>

          {/* Erreur de soumission */}
          {submitError && (
            <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
              <div>
                <p className="text-sm font-semibold text-red-800">Le dépôt n'a pas abouti</p>
                <p className="mt-0.5 text-xs text-red-600">{submitError}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-100 px-6 py-4">
          <p className="text-xs text-slate-400">
            <span className="text-violet-500">*</span> Champs obligatoires
          </p>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!isValid || submitting}
            className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40 active:scale-[0.98]"
          >
            {submitting ? (
              <>
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                Enregistrement…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Enregistrer l'opportunité
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}