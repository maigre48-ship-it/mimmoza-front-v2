// ============================================================================
// Origination.tsx — Banque: saisie initiale du dossier
// Writes to: dossiersById[id].origination
// ============================================================================

import { useState, useEffect } from "react";
import { useBanqueDossierContext } from "../hooks/useBanqueDossierContext";
import { upsertDossier, addEvent } from "../store/banqueSnapshot.store";
import type { DossierOrigination, ProjectType } from "../store/banqueSnapshot.types";
import DossierContextBar from "../components/DossierContextBar";

const PROJECT_TYPES: { value: ProjectType; label: string }[] = [
  { value: "promotion_residentielle", label: "Promotion résidentielle" },
  { value: "promotion_commerciale", label: "Promotion commerciale" },
  { value: "marchand_de_biens", label: "Marchand de biens" },
  { value: "ehpad", label: "EHPAD" },
  { value: "residence_etudiante", label: "Résidence étudiante" },
  { value: "logistique", label: "Logistique" },
  { value: "bureaux", label: "Bureaux" },
  { value: "autre", label: "Autre" },
];

export default function BanqueOrigination() {
  const { dossierId, dossier, refresh } = useBanqueDossierContext();
  const [form, setForm] = useState<DossierOrigination>({});
  const [saved, setSaved] = useState(false);

  // Sync form when dossier changes
  useEffect(() => {
    if (dossier?.origination) {
      setForm(dossier.origination);
    }
  }, [dossier?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (key: keyof DossierOrigination, value: unknown) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleSave = () => {
    if (!dossierId) return;
    upsertDossier({
      id: dossierId,
      origination: form,
      status: "origination",
    });
    addEvent({
      type: "origination_updated",
      dossierId,
      message: "Données d'origination mises à jour",
    });
    refresh();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <DossierContextBar dossier={dossier} dossierId={dossierId} />

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-slate-900">Origination</h1>
        {saved && (
          <span className="text-sm text-green-600 font-medium">✓ Sauvegardé</span>
        )}
      </div>

      {!dossierId ? (
        <p className="text-sm text-slate-500">Sélectionnez un dossier depuis le tableau de bord.</p>
      ) : (
        <div className="space-y-6">
          {/* Emprunteur */}
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-4">Emprunteur</h2>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Raison sociale / Nom" value={form.emprunteur ?? ""} onChange={(v) => update("emprunteur", v)} />
              <Field label="SIRET" value={form.siret ?? ""} onChange={(v) => update("siret", v)} placeholder="123 456 789 00001" />
            </div>
          </section>

          {/* Financement */}
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-4">Financement demandé</h2>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Montant (€)" value={form.montantDemande?.toString() ?? ""} onChange={(v) => update("montantDemande", v ? Number(v) : undefined)} type="number" />
              <Field label="Durée (mois)" value={form.dureeEnMois?.toString() ?? ""} onChange={(v) => update("dureeEnMois", v ? Number(v) : undefined)} type="number" />
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Type de projet</label>
                <select
                  value={form.typeProjet ?? ""}
                  onChange={(e) => update("typeProjet", e.target.value || undefined)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                >
                  <option value="">— Sélectionner —</option>
                  {PROJECT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* Projet */}
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-4">Projet immobilier</h2>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Adresse" value={form.adresseProjet ?? ""} onChange={(v) => update("adresseProjet", v)} className="col-span-2" />
              <Field label="Code postal" value={form.codePostal ?? ""} onChange={(v) => update("codePostal", v)} />
              <Field label="Commune" value={form.commune ?? ""} onChange={(v) => update("commune", v)} />
              <Field label="Surface terrain (m²)" value={form.surfaceTerrain?.toString() ?? ""} onChange={(v) => update("surfaceTerrain", v ? Number(v) : undefined)} type="number" />
              <Field label="Surface SDP (m²)" value={form.surfaceSDP?.toString() ?? ""} onChange={(v) => update("surfaceSDP", v ? Number(v) : undefined)} type="number" />
            </div>
          </section>

          {/* Notes */}
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-4">Notes</h2>
            <textarea
              value={form.notes ?? ""}
              onChange={(e) => update("notes", e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
              placeholder="Notes libres sur le dossier..."
            />
          </section>

          <div className="flex justify-end">
            <button
              onClick={handleSave}
              className="rounded-lg bg-slate-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-slate-800"
            >
              Enregistrer l'origination
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Simple field component (keeps page code DRY)
// ---------------------------------------------------------------------------

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
      />
    </div>
  );
}