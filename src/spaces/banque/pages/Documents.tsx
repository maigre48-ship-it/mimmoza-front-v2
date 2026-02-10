// ============================================================================
// Documents.tsx — Banque: checklist documentaire
// Writes to: dossiersById[id].documents
// ============================================================================

import { useState, useEffect } from "react";
import { useBanqueDossierContext } from "../hooks/useBanqueDossierContext";
import { upsertDossier, addEvent } from "../store/banqueSnapshot.store";
import type { DocumentItem, DossierDocuments } from "../store/banqueSnapshot.types";
import DossierContextBar from "../components/DossierContextBar";

type DocStatus = DocumentItem["statut"];

const DOC_TYPES = [
  { value: "kbis", label: "Kbis" },
  { value: "bilan", label: "Bilan comptable" },
  { value: "permis", label: "Permis de construire" },
  { value: "plan", label: "Plan / Masse" },
  { value: "attestation", label: "Attestation" },
  { value: "autre", label: "Autre" },
];

const STATUS_DISPLAY: Record<DocStatus, { label: string; color: string }> = {
  attendu: { label: "Attendu", color: "bg-gray-100 text-gray-700" },
  recu: { label: "Reçu", color: "bg-blue-100 text-blue-700" },
  valide: { label: "Validé", color: "bg-green-100 text-green-700" },
  refuse: { label: "Refusé", color: "bg-red-100 text-red-700" },
};

function emptyDoc(): DocumentItem {
  return {
    id: crypto.randomUUID(),
    nom: "",
    type: "autre",
    statut: "attendu",
  };
}

export default function BanqueDocuments() {
  const { dossierId, dossier, refresh } = useBanqueDossierContext();
  const [items, setItems] = useState<DocumentItem[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (dossier?.documents) setItems(dossier.documents.items ?? []);
  }, [dossier?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const addItem = () => setItems((prev) => [...prev, emptyDoc()]);

  const removeItem = (id: string) =>
    setItems((prev) => prev.filter((d) => d.id !== id));

  const updateItem = (id: string, key: keyof DocumentItem, value: unknown) => {
    setItems((prev) =>
      prev.map((d) => (d.id === id ? { ...d, [key]: value } : d))
    );
    setSaved(false);
  };

  const completude = items.length
    ? Math.round(
        (items.filter((d) => d.statut === "valide" || d.statut === "recu").length /
          items.length) *
          100
      )
    : 0;

  const handleSave = () => {
    if (!dossierId) return;
    const data: DossierDocuments = { items, completude };
    upsertDossier({ id: dossierId, documents: data });
    addEvent({
      type: "documents_updated",
      dossierId,
      message: `${items.length} document(s) — complétude ${completude}%`,
    });
    refresh();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <DossierContextBar dossier={dossier} dossierId={dossierId} />

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Documents</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Complétude : {completude}%
          </p>
        </div>
        <div className="flex items-center gap-3">
          {saved && <span className="text-sm text-green-600 font-medium">✓ Sauvegardé</span>}
          <button
            onClick={addItem}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
          >
            + Document
          </button>
        </div>
      </div>

      {!dossierId ? (
        <p className="text-sm text-slate-500">Sélectionnez un dossier depuis le tableau de bord.</p>
      ) : (
        <div className="space-y-3">
          {/* Progress bar */}
          <div className="w-full rounded-full bg-slate-100 h-2 mb-4">
            <div
              className="rounded-full bg-green-500 h-2 transition-all"
              style={{ width: `${completude}%` }}
            />
          </div>

          {items.length === 0 ? (
            <div className="rounded-lg border-2 border-dashed border-slate-200 p-8 text-center">
              <p className="text-sm text-slate-400">
                Ajoutez les documents requis pour ce dossier.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Nom</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Type</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Statut</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Commentaire</th>
                    <th className="px-2 py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((doc) => {
                    const st = STATUS_DISPLAY[doc.statut];
                    return (
                      <tr key={doc.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                        <td className="px-4 py-2">
                          <input
                            value={doc.nom}
                            onChange={(e) => updateItem(doc.id, "nom", e.target.value)}
                            placeholder="Nom du document"
                            className="w-full border-0 bg-transparent text-sm focus:outline-none"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <select
                            value={doc.type}
                            onChange={(e) => updateItem(doc.id, "type", e.target.value)}
                            className="rounded border border-slate-200 px-2 py-1 text-xs"
                          >
                            {DOC_TYPES.map((t) => (
                              <option key={t.value} value={t.value}>{t.label}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-2">
                          <select
                            value={doc.statut}
                            onChange={(e) => updateItem(doc.id, "statut", e.target.value as DocStatus)}
                            className={`rounded px-2 py-1 text-xs font-semibold ${st.color}`}
                          >
                            {Object.entries(STATUS_DISPLAY).map(([val, { label }]) => (
                              <option key={val} value={val}>{label}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-2">
                          <input
                            value={doc.commentaire ?? ""}
                            onChange={(e) => updateItem(doc.id, "commentaire", e.target.value)}
                            placeholder="—"
                            className="w-full border-0 bg-transparent text-xs text-slate-500 focus:outline-none"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <button
                            onClick={() => removeItem(doc.id)}
                            className="text-xs text-red-400 hover:text-red-600"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex justify-end pt-4">
            <button
              onClick={handleSave}
              className="rounded-lg bg-slate-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-slate-800"
            >
              Enregistrer les documents
            </button>
          </div>
        </div>
      )}
    </div>
  );
}