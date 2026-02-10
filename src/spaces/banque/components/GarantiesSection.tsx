// ============================================================================
// GarantiesSection.tsx — Section embarquable Garanties & Sûretés
// Aucune navigation interne. Props: dossierId, dossier, refresh.
// ============================================================================

import { useState, useEffect } from "react";
import { upsertDossier, addEvent } from "../store/banqueSnapshot.store";
import type { GarantieItem, DossierGaranties } from "../store/banqueSnapshot.types";

const GARANTIE_TYPES = [
  { value: "hypotheque",     label: "Hypothèque" },
  { value: "nantissement",   label: "Nantissement" },
  { value: "caution",        label: "Caution" },
  { value: "gage",           label: "Gage" },
  { value: "autre",          label: "Autre" },
];

function emptyGarantie(): GarantieItem {
  return {
    id: crypto.randomUUID(),
    type: "hypotheque",
    description: "",
    valeurEstimee: undefined,
    rang: 1,
  };
}

type Props = {
  dossierId: string | null;
  dossier: any;
  refresh: () => void;
};

export default function GarantiesSection({ dossierId, dossier, refresh }: Props) {
  const [items, setItems] = useState<GarantieItem[]>([]);
  const [commentaire, setCommentaire] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (dossier?.garanties) {
      setItems(dossier.garanties.items ?? []);
      setCommentaire(dossier.garanties.commentaire ?? "");
    }
  }, [dossier?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const addItem = () => setItems((prev) => [...prev, emptyGarantie()]);
  const removeItem = (id: string) => setItems((prev) => prev.filter((g) => g.id !== id));

  const updateItem = (id: string, key: keyof GarantieItem, value: unknown) => {
    setItems((prev) => prev.map((g) => (g.id === id ? { ...g, [key]: value } : g)));
    setSaved(false);
  };

  const totalCouverture = items.reduce((sum, g) => sum + (g.valeurEstimee ?? 0), 0);

  const handleSave = () => {
    if (!dossierId) return;
    const data: DossierGaranties = {
      items,
      couvertureTotale: totalCouverture,
      ratioGarantieSurPret:
        dossier?.origination?.montantDemande && totalCouverture
          ? Math.round((totalCouverture / dossier.origination.montantDemande) * 100)
          : undefined,
      commentaire,
    };
    upsertDossier({ id: dossierId, garanties: data });
    addEvent({
      type: "garanties_updated",
      dossierId,
      message: `${items.length} garantie(s) — couverture ${(totalCouverture / 1e6).toFixed(2)} M€`,
    });
    refresh();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (!dossierId) {
    return <p className="text-sm text-slate-500">Sélectionnez un dossier depuis le pipeline.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-900">Garanties &amp; Sûretés</h2>
        {saved && <span className="text-sm text-green-600 font-medium">✓ Sauvegardé</span>}
      </div>

      {/* KPI */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-center">
          <p className="text-xs text-slate-500">Nombre</p>
          <p className="text-2xl font-bold text-slate-900">{items.length}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-center">
          <p className="text-xs text-slate-500">Couverture totale</p>
          <p className="text-2xl font-bold text-slate-900">{(totalCouverture / 1e6).toFixed(2)} M€</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-center">
          <p className="text-xs text-slate-500">Ratio garantie/prêt</p>
          <p className="text-2xl font-bold text-slate-900">
            {dossier?.origination?.montantDemande && totalCouverture
              ? `${Math.round((totalCouverture / dossier.origination.montantDemande) * 100)}%`
              : "—"}
          </p>
        </div>
      </div>

      {/* Items */}
      {items.map((g, idx) => (
        <div key={g.id} className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-slate-700">Garantie #{idx + 1}</span>
            <button onClick={() => removeItem(g.id)} className="text-xs text-red-500 hover:text-red-700">Supprimer</button>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Type</label>
              <select value={g.type} onChange={(e) => updateItem(g.id, "type", e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
                {GARANTIE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
              <input value={g.description} onChange={(e) => updateItem(g.id, "description", e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Valeur (€)</label>
              <input type="number" value={g.valeurEstimee?.toString() ?? ""}
                onChange={(e) => updateItem(g.id, "valeurEstimee", e.target.value ? Number(e.target.value) : undefined)}
                className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
            </div>
          </div>
        </div>
      ))}

      <button onClick={addItem}
        className="w-full rounded-xl border-2 border-dashed border-slate-300 py-3 text-sm text-slate-500 hover:border-slate-400 hover:text-slate-700">
        + Ajouter une garantie
      </button>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <label className="block text-xs font-medium text-slate-600 mb-1">Commentaire</label>
        <textarea value={commentaire} onChange={(e) => { setCommentaire(e.target.value); setSaved(false); }}
          rows={3} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </div>

      <div className="flex justify-end">
        <button onClick={handleSave}
          className="rounded-lg bg-slate-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-slate-800">
          Enregistrer les garanties
        </button>
      </div>
    </div>
  );
}