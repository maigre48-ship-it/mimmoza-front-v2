// pages/GarantiesPage.tsx

import React, { useState } from 'react';
import { useDossierCommittee } from '../context/DossierCommitteeContext';
import { GUARANTEE_TYPES, GUARANTEE_RANKS } from '../config/required-documents';
import type { GuaranteeType, GuaranteeRank } from '../types/committee-workflow';

// ─── Form State ──────────────────────────────

interface GarantieForm {
  type: GuaranteeType;
  valeur: string;
  rang: GuaranteeRank;
  commentaire: string;
}

const EMPTY_FORM: GarantieForm = {
  type: GUARANTEE_TYPES[0] as GuaranteeType,
  valeur: '',
  rang: GUARANTEE_RANKS[0] as GuaranteeRank,
  commentaire: '',
};

// ─── Main Page ───────────────────────────────

export default function GarantiesPage() {
  const { dossier, ltv, totalGaranteeValue, patchGuarantee } = useDossierCommittee();
  const [form, setForm] = useState<GarantieForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);

  const ltvColor =
    ltv === null ? '#6b7280' : ltv > 90 ? '#dc2626' : ltv > 70 ? '#d97706' : '#059669';

  const handleSubmit = () => {
    const valeur = Number(form.valeur);
    if (!valeur || valeur <= 0) return;

    if (editingId) {
      patchGuarantee({
        action: 'update',
        guarantee: {
          id: editingId,
          type: form.type,
          valeur,
          rang: form.rang,
          commentaire: form.commentaire,
        },
      });
      setEditingId(null);
    } else {
      patchGuarantee({
        action: 'add',
        guarantee: {
          type: form.type,
          valeur,
          rang: form.rang,
          commentaire: form.commentaire,
        },
      });
    }
    setForm(EMPTY_FORM);
  };

  const startEdit = (g: (typeof dossier.guarantees)[number]) => {
    setForm({
      type: g.type,
      valeur: String(g.valeur),
      rang: g.rang,
      commentaire: g.commentaire || '',
    });
    setEditingId(g.id);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  return (
    <div className="space-y-6">
      {/* Header + KPIs */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Garanties</h2>
          <p className="text-sm text-gray-500 mt-1">
            Montant prêt :{' '}
            <span className="font-semibold">
              {(dossier.montantPret || 0).toLocaleString('fr-FR')} €
            </span>
          </p>
        </div>
        <div className="flex gap-6 text-center">
          <div>
            <div className="text-xs text-gray-500 mb-1">Total garanties</div>
            <div className="text-xl font-extrabold text-gray-900">
              {totalGaranteeValue.toLocaleString('fr-FR')} €
            </div>
          </div>
          <div className="w-px bg-gray-200" />
          <div>
            <div className="text-xs text-gray-500 mb-1">LTV</div>
            <div className="text-xl font-extrabold" style={{ color: ltvColor }}>
              {ltv !== null ? `${ltv}%` : 'N/A'}
            </div>
          </div>
        </div>
      </div>

      {/* LTV Alert */}
      {ltv !== null && ltv > 70 && (
        <div
          className={`px-4 py-3 rounded-lg border text-sm font-medium ${
            ltv > 90
              ? 'bg-red-50 border-red-200 text-red-800'
              : 'bg-amber-50 border-amber-200 text-amber-800'
          }`}
        >
          {ltv > 90
            ? `⚠ LTV critique (${ltv}%) — Le montant du prêt dépasse largement la valeur des garanties. Renforcement nécessaire.`
            : `⚠ LTV élevée (${ltv}%) — Envisager des garanties complémentaires pour sécuriser le dossier.`}
        </div>
      )}

      {/* Guarantee list */}
      <div className="space-y-3">
        {dossier.guarantees.length === 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400">
            Aucune garantie enregistrée
          </div>
        )}
        {dossier.guarantees.map((g) => (
          <div
            key={g.id}
            className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center text-lg">
                🛡
              </div>
              <div>
                <div className="text-sm font-bold text-gray-900">{g.type}</div>
                <div className="text-xs text-gray-500">
                  {g.rang} • {(g.valeur || 0).toLocaleString('fr-FR')} €
                </div>
                {g.commentaire && (
                  <div className="text-xs text-gray-400 italic mt-0.5">{g.commentaire}</div>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => startEdit(g)}
                className="px-3 py-1.5 rounded-md border border-gray-300 text-gray-600 text-xs font-semibold 
                           bg-white hover:bg-gray-50 transition-colors"
              >
                Modifier
              </button>
              <button
                onClick={() => patchGuarantee({ action: 'remove', guarantee: { id: g.id } })}
                className="px-3 py-1.5 rounded-md border border-red-300 text-red-600 text-xs font-semibold 
                           bg-white hover:bg-red-50 transition-colors"
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Add/Edit form */}
      <div className="bg-gray-50 rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-bold text-gray-700 mb-4">
          {editingId ? 'Modifier la garantie' : 'Ajouter une garantie'}
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Type</label>
            <select
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as GuaranteeType }))}
              className="w-full px-3 py-2 rounded-md border border-gray-300 text-sm bg-white"
            >
              {GUARANTEE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Valeur (€)</label>
            <input
              type="number"
              value={form.valeur}
              onChange={(e) => setForm((f) => ({ ...f, valeur: e.target.value }))}
              placeholder="0"
              className="w-full px-3 py-2 rounded-md border border-gray-300 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Rang</label>
            <select
              value={form.rang}
              onChange={(e) => setForm((f) => ({ ...f, rang: e.target.value as GuaranteeRank }))}
              className="w-full px-3 py-2 rounded-md border border-gray-300 text-sm bg-white"
            >
              {GUARANTEE_RANKS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Commentaire</label>
            <input
              type="text"
              value={form.commentaire}
              onChange={(e) => setForm((f) => ({ ...f, commentaire: e.target.value }))}
              placeholder="Optionnel"
              className="w-full px-3 py-2 rounded-md border border-gray-300 text-sm"
            />
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button
            onClick={handleSubmit}
            className="px-5 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold 
                       hover:bg-indigo-700 transition-colors"
          >
            {editingId ? 'Mettre à jour' : 'Ajouter'}
          </button>
          {editingId && (
            <button
              onClick={cancelEdit}
              className="px-5 py-2 rounded-lg border border-gray-300 text-gray-600 text-sm 
                         bg-white hover:bg-gray-50 transition-colors"
            >
              Annuler
            </button>
          )}
        </div>
      </div>
    </div>
  );
}