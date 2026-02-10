// ============================================================================
// Decision.tsx — Banque: comité de crédit / décision
// Writes to: dossiersById[id].decision
// ============================================================================

import { useState, useEffect } from "react";
import { useBanqueDossierContext } from "../hooks/useBanqueDossierContext";
import { upsertDossier, addEvent } from "../store/banqueSnapshot.store";
import type { DossierDecision } from "../store/banqueSnapshot.types";
import DossierContextBar from "../components/DossierContextBar";

type AvisType = DossierDecision["avisComite"];

const AVIS_OPTIONS: { value: NonNullable<AvisType>; label: string; color: string }[] = [
  { value: "favorable", label: "Favorable", color: "bg-green-100 text-green-800 border-green-300" },
  { value: "favorable_sous_conditions", label: "Favorable sous conditions", color: "bg-amber-100 text-amber-800 border-amber-300" },
  { value: "defavorable", label: "Défavorable", color: "bg-red-100 text-red-800 border-red-300" },
  { value: "ajourne", label: "Ajourné", color: "bg-gray-100 text-gray-700 border-gray-300" },
];

export default function BanqueDecision() {
  const { dossierId, dossier, refresh } = useBanqueDossierContext();
  const [form, setForm] = useState<DossierDecision>({});
  const [newCondition, setNewCondition] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (dossier?.decision) setForm(dossier.decision);
  }, [dossier?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (key: keyof DossierDecision, value: unknown) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const addCondition = () => {
    if (!newCondition.trim()) return;
    const conditions = [...(form.conditionsSuspensives ?? []), newCondition.trim()];
    update("conditionsSuspensives", conditions);
    setNewCondition("");
  };

  const removeCondition = (idx: number) => {
    const conditions = (form.conditionsSuspensives ?? []).filter((_, i) => i !== idx);
    update("conditionsSuspensives", conditions);
  };

  const handleSave = () => {
    if (!dossierId) return;
    upsertDossier({
      id: dossierId,
      decision: { ...form, dateComite: form.dateComite || new Date().toISOString().slice(0, 10) },
      status: "decision",
    });
    addEvent({
      type: "decision_updated",
      dossierId,
      message: `Décision comité: ${form.avisComite ?? "en attente"}`,
    });
    refresh();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <DossierContextBar dossier={dossier} dossierId={dossierId} />

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-slate-900">Comité & Décision</h1>
        {saved && <span className="text-sm text-green-600 font-medium">✓ Sauvegardé</span>}
      </div>

      {!dossierId ? (
        <p className="text-sm text-slate-500">Sélectionnez un dossier depuis le tableau de bord.</p>
      ) : (
        <div className="space-y-6">
          {/* Summary from other tabs */}
          {dossier && (
            <section className="rounded-lg border border-blue-100 bg-blue-50 p-5">
              <h2 className="text-sm font-semibold text-blue-800 mb-3">Synthèse du dossier</h2>
              <div className="grid grid-cols-4 gap-4 text-xs">
                <div>
                  <p className="text-blue-600 font-medium">Emprunteur</p>
                  <p className="text-blue-900 font-semibold">{dossier.origination.emprunteur ?? "—"}</p>
                </div>
                <div>
                  <p className="text-blue-600 font-medium">Montant</p>
                  <p className="text-blue-900 font-semibold">
                    {dossier.origination.montantDemande
                      ? `${(dossier.origination.montantDemande / 1e6).toFixed(2)} M€`
                      : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-blue-600 font-medium">Score crédit</p>
                  <p className="text-blue-900 font-semibold">{dossier.analyse.scoreCreditGlobal ?? "—"}/100</p>
                </div>
                <div>
                  <p className="text-blue-600 font-medium">Garanties</p>
                  <p className="text-blue-900 font-semibold">
                    {dossier.garanties.couvertureTotale
                      ? `${(dossier.garanties.couvertureTotale / 1e6).toFixed(2)} M€`
                      : "—"}
                  </p>
                </div>
              </div>
            </section>
          )}

          {/* Avis */}
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-4">Avis du comité</h2>
            <div className="grid grid-cols-4 gap-3">
              {AVIS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => update("avisComite", opt.value)}
                  className={`rounded-lg border-2 px-3 py-3 text-sm font-semibold transition-all ${
                    form.avisComite === opt.value
                      ? opt.color + " ring-2 ring-offset-1"
                      : "border-slate-200 text-slate-500 hover:border-slate-300"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </section>

          {/* Conditions suspensives */}
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-4">Conditions suspensives</h2>
            {(form.conditionsSuspensives ?? []).map((cond, idx) => (
              <div key={idx} className="flex items-center gap-2 mb-2">
                <span className="flex-1 rounded bg-slate-50 px-3 py-1.5 text-sm text-slate-700">
                  {idx + 1}. {cond}
                </span>
                <button
                  onClick={() => removeCondition(idx)}
                  className="text-xs text-red-500 hover:text-red-700"
                >
                  ✕
                </button>
              </div>
            ))}
            <div className="flex gap-2 mt-2">
              <input
                value={newCondition}
                onChange={(e) => setNewCondition(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addCondition()}
                placeholder="Ajouter une condition suspensive..."
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <button
                onClick={addCondition}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
              >
                Ajouter
              </button>
            </div>
          </section>

          {/* Montant & conditions financières */}
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-4">Conditions financières accordées</h2>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Montant accordé (€)</label>
                <input
                  type="number"
                  value={form.montantAccorde?.toString() ?? ""}
                  onChange={(e) => update("montantAccorde", e.target.value ? Number(e.target.value) : undefined)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Taux accordé (%)</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.tauxAccorde?.toString() ?? ""}
                  onChange={(e) => update("tauxAccorde", e.target.value ? Number(e.target.value) : undefined)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Durée accordée (mois)</label>
                <input
                  type="number"
                  value={form.dureeAccordee?.toString() ?? ""}
                  onChange={(e) => update("dureeAccordee", e.target.value ? Number(e.target.value) : undefined)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>
          </section>

          {/* Commentaire */}
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-4">Commentaire du comité</h2>
            <textarea
              value={form.commentaireComite ?? ""}
              onChange={(e) => update("commentaireComite", e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Compte-rendu du comité de crédit..."
            />
          </section>

          <div className="flex justify-end">
            <button
              onClick={handleSave}
              className="rounded-lg bg-slate-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-slate-800"
            >
              Enregistrer la décision
            </button>
          </div>
        </div>
      )}
    </div>
  );
}