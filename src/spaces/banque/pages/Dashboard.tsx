// ============================================================================
// Dashboard.tsx — Banque: liste des dossiers, création, sélection
// Source de vérité: BanqueSnapshot
// ============================================================================

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useBanqueDossierContext } from "../hooks/useBanqueDossierContext";
import { upsertDossier, removeDossier, addEvent } from "../store/banqueSnapshot.store";
import { createEmptyDossier } from "../store/banqueSnapshot.types";
import { preserveDossierInPath } from "../utils/banqueDossierUrl";
import DossierContextBar from "../components/DossierContextBar";

const STATUS_COLORS: Record<string, string> = {
  brouillon: "bg-gray-100 text-gray-700",
  origination: "bg-blue-100 text-blue-700",
  analyse: "bg-amber-100 text-amber-700",
  comite: "bg-purple-100 text-purple-700",
  decision: "bg-green-100 text-green-700",
  monitoring: "bg-teal-100 text-teal-700",
  cloture: "bg-slate-100 text-slate-500",
};

const uuid = () => {
  // Fallback safe si randomUUID n'existe pas
  const c = crypto as any;
  return typeof c?.randomUUID === "function"
    ? c.randomUUID()
    : `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

export default function BanqueDashboard() {
  const navigate = useNavigate();

  // ⚠️ ce hook peut évoluer: on sécurise les valeurs
  const ctx = useBanqueDossierContext() as any;

  const dossierId: string | null = ctx?.dossierId ?? ctx?.selectedDossierId ?? null;
  const dossier = ctx?.dossier ?? null;
  const dossiers = ctx?.dossiers;

  const refresh: (() => void) | undefined = ctx?.refresh;

  const dossiersSafe = useMemo(() => (Array.isArray(dossiers) ? dossiers : []), [dossiers]);

  const [newLabel, setNewLabel] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const handleCreate = () => {
    if (!newLabel.trim()) return;

    const id = uuid();
    const d = createEmptyDossier(id, newLabel.trim());

    upsertDossier(d);

    // ✅ IMPORTANT: addEvent attend (dossierId, alert)
    addEvent(id, {
      id: uuid(),
      type: "dossier_created",
      label: "Dossier créé",
      message: `Dossier "${newLabel.trim()}" créé`,
      createdAt: new Date().toISOString(),
      severity: "info",
    } as any);

    setNewLabel("");
    setShowCreate(false);

    // refresh si le hook l’expose
    refresh?.();

    // Navigate to the new dossier
    navigate(preserveDossierInPath("/banque/origination", id));
  };

  const handleSelect = (id: string) => {
    navigate(preserveDossierInPath("/banque/origination", id));
  };

  const handleDelete = (id: string, label: string) => {
    if (!window.confirm(`Supprimer le dossier "${label}" ?`)) return;
    removeDossier(id);
    refresh?.();
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <DossierContextBar dossier={dossier} dossierId={dossierId} />

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Espace Banque</h1>
          <p className="text-sm text-slate-500 mt-1">
            {dossiersSafe.length} dossier{dossiersSafe.length !== 1 ? "s" : ""} en cours
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* ✅ Bouton visible pour accéder au debug sans taper l'URL */}
          <button
            onClick={() => navigate("/banque/smartscore-debug")}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            title="Ouvrir la page debug SmartScore"
          >
            SmartScore Debug
          </button>

          <button
            onClick={() => setShowCreate(true)}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            + Nouveau dossier
          </button>
        </div>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="mb-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">
            Créer un nouveau dossier
          </h3>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder='Nom du dossier (ex: SCI Lumière - Lyon 3e)'
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
              autoFocus
            />
            <button
              onClick={handleCreate}
              disabled={!newLabel.trim()}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40"
            >
              Créer
            </button>
            <button
              onClick={() => {
                setShowCreate(false);
                setNewLabel("");
              }}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* Dossier list */}
      {dossiersSafe.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-slate-200 p-12 text-center">
          <p className="text-slate-400 text-sm">
            Aucun dossier. Créez votre premier dossier pour démarrer.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {dossiersSafe.map((d: any) => {
            const id = d?.id ?? d?.dossierId ?? d?.uuid;
            if (!id) return null;

            const isSelected = id === dossierId;

            // ✅ Compat: certains modèles utilisent "statut" au lieu de "status"
            const status = (d?.status ?? d?.statut ?? "brouillon") as string;
            const statusCls = STATUS_COLORS[status] ?? "bg-gray-100 text-gray-700";

            const label = d?.label ?? "Dossier";
            const reference = d?.reference ?? "";
            const emprunteur = d?.origination?.emprunteur ?? d?.origination?.borrower ?? "";

            const updatedAt = d?.updatedAt ?? d?.dates?.derniereMaj ?? d?.dates?.createdAt ?? null;
            const updatedAtLabel = updatedAt
              ? new Date(updatedAt).toLocaleDateString("fr-FR")
              : "-";

            return (
              <div
                key={id}
                className={`rounded-lg border bg-white p-4 flex items-center justify-between hover:shadow-sm transition-shadow cursor-pointer ${
                  isSelected ? "border-slate-900 ring-1 ring-slate-900" : "border-slate-200"
                }`}
                onClick={() => handleSelect(id)}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-lg shrink-0">
                    📂
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900 text-sm truncate">
                        {label}
                      </span>
                      {reference && (
                        <span className="text-xs text-slate-400 font-mono shrink-0">
                          {reference}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusCls}`}
                      >
                        {status}
                      </span>

                      {emprunteur && (
                        <span className="text-xs text-slate-500 truncate">
                          {emprunteur}
                        </span>
                      )}

                      <span className="text-[10px] text-slate-400">
                        Mis à jour le {updatedAtLabel}
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(id, label);
                  }}
                  className="ml-4 rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500"
                  title="Supprimer"
                >
                  🗑️
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
