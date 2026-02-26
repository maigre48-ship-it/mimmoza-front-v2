/**
 * DueDiligencePanel.tsx
 * ─────────────────────────────────────────────────────────────────────
 * Panneau "Due Diligence" de l'onglet Analyse investisseur.
 *
 * Points clés:
 * - Checklist persistée dans le snapshot (localStorage) par deal
 * - Catégories: Juridique, Technique, Financement, Copro/Urbanisme, Marché locatif, Risques
 * - Documents attendus avec statut manquant/reçu + note
 * - Risques non financiers: lecture existante ou placeholder
 * - UX simple, professionnelle
 * ─────────────────────────────────────────────────────────────────────
 */

import React, { useState, useMemo, useCallback } from "react";
import type {
  ChecklistItem,
  ChecklistCategory,
  ChecklistStatus,
  DocumentItem,
  DocumentStatus,
  DueDiligenceState,
} from "../../types/strategy.types";
import { CHECKLIST_CATEGORY_LABELS } from "../../types/strategy.types";

// ─── Props ───────────────────────────────────────────────────────────

interface DueDiligencePanelProps {
  state: DueDiligenceState;
  onUpdate: (state: DueDiligenceState) => void;
  risquesExistants?: string[];
}

// ─── Default checklist items ─────────────────────────────────────────

export function createDefaultChecklist(): ChecklistItem[] {
  const items: Omit<ChecklistItem, "status" | "note">[] = [
    // Juridique
    { id: "jur-1", category: "juridique", label: "Titre de propriété vérifié" },
    { id: "jur-2", category: "juridique", label: "Servitudes et hypothèques" },
    { id: "jur-3", category: "juridique", label: "Vérification cadastrale" },
    { id: "jur-4", category: "juridique", label: "Situation locative actuelle" },
    { id: "jur-5", category: "juridique", label: "Contentieux en cours" },
    // Technique
    { id: "tech-1", category: "technique", label: "DPE / audit énergétique" },
    { id: "tech-2", category: "technique", label: "Diagnostics obligatoires" },
    { id: "tech-3", category: "technique", label: "État de la toiture / façade" },
    { id: "tech-4", category: "technique", label: "Réseaux (eau, élec, assainissement)" },
    { id: "tech-5", category: "technique", label: "Estimation travaux détaillée" },
    // Financement
    { id: "fin-1", category: "financement", label: "Offre de prêt obtenue" },
    { id: "fin-2", category: "financement", label: "Simulation assurance emprunteur" },
    { id: "fin-3", category: "financement", label: "Frais de notaire estimés" },
    { id: "fin-4", category: "financement", label: "Plan de financement validé" },
    // Copro / Urbanisme
    { id: "copro-1", category: "copro_urbanisme", label: "Règlement de copropriété" },
    { id: "copro-2", category: "copro_urbanisme", label: "PV des 3 dernières AG" },
    { id: "copro-3", category: "copro_urbanisme", label: "Carnet d'entretien" },
    { id: "copro-4", category: "copro_urbanisme", label: "Travaux votés / à venir" },
    { id: "copro-5", category: "copro_urbanisme", label: "Conformité urbanistique" },
    // Marché locatif
    { id: "loc-1", category: "marche_locatif", label: "Loyers marché comparables" },
    { id: "loc-2", category: "marche_locatif", label: "Taux de vacance local" },
    { id: "loc-3", category: "marche_locatif", label: "Encadrement des loyers" },
    { id: "loc-4", category: "marche_locatif", label: "Demande locative (tendance)" },
    // Risques
    { id: "risk-1", category: "risques", label: "Risques naturels (Géorisques)" },
    { id: "risk-2", category: "risques", label: "Risques technologiques" },
    { id: "risk-3", category: "risques", label: "Pollution des sols" },
    { id: "risk-4", category: "risques", label: "Zone inondable" },
  ];

  return items.map((item) => ({ ...item, status: "todo" as const, note: "" }));
}

// ─── Default documents ───────────────────────────────────────────────

export function createDefaultDocuments(): DocumentItem[] {
  const docs: Omit<DocumentItem, "status" | "note">[] = [
    { id: "doc-1", label: "Compromis / Promesse de vente" },
    { id: "doc-2", label: "DPE" },
    { id: "doc-3", label: "Diagnostics (amiante, plomb, termites…)" },
    { id: "doc-4", label: "PV AG des 3 dernières années" },
    { id: "doc-5", label: "Carnet d'entretien de l'immeuble" },
    { id: "doc-6", label: "Règlement de copropriété" },
    { id: "doc-7", label: "Appels de fonds (12 derniers mois)" },
    { id: "doc-8", label: "Taxe foncière (dernier avis)" },
    { id: "doc-9", label: "Plans du bien" },
    { id: "doc-10", label: "Offre de prêt / accord de principe" },
    { id: "doc-11", label: "Devis travaux" },
    { id: "doc-12", label: "État hypothécaire" },
  ];

  return docs.map((d) => ({ ...d, status: "manquant" as const, note: "" }));
}

// ─── Status icons and styles ─────────────────────────────────────────

const STATUS_CONFIG: Record<ChecklistStatus, { icon: string; label: string; style: string }> = {
  todo: { icon: "○", label: "À faire", style: "text-gray-400 bg-gray-50 border-gray-200" },
  ok: { icon: "✓", label: "OK", style: "text-emerald-600 bg-emerald-50 border-emerald-200" },
  blocked: { icon: "✕", label: "Bloqué", style: "text-red-600 bg-red-50 border-red-200" },
};

const DOC_STATUS_CONFIG: Record<DocumentStatus, { icon: string; label: string; style: string }> = {
  manquant: { icon: "◻", label: "Manquant", style: "text-amber-600 bg-amber-50 border-amber-200" },
  recu: { icon: "✓", label: "Reçu", style: "text-emerald-600 bg-emerald-50 border-emerald-200" },
};

const CATEGORY_ICONS: Record<ChecklistCategory, string> = {
  juridique: "⚖️",
  technique: "🔧",
  financement: "🏦",
  copro_urbanisme: "🏢",
  marche_locatif: "📊",
  risques: "⚠️",
};

// ─── Main component ─────────────────────────────────────────────────

export default function DueDiligencePanel({
  state,
  onUpdate,
  risquesExistants,
}: DueDiligencePanelProps) {
  const [activeTab, setActiveTab] = useState<"checklist" | "documents" | "risques">("checklist");
  const [expandedCat, setExpandedCat] = useState<ChecklistCategory | null>("juridique");
  const [editingNote, setEditingNote] = useState<string | null>(null);

  // ── Grouped checklist
  const grouped = useMemo(() => {
    const map = new Map<ChecklistCategory, ChecklistItem[]>();
    for (const item of state.checklist) {
      const arr = map.get(item.category) || [];
      arr.push(item);
      map.set(item.category, arr);
    }
    return map;
  }, [state.checklist]);

  // ── Stats
  const stats = useMemo(() => {
    const total = state.checklist.length;
    const done = state.checklist.filter((i) => i.status === "ok").length;
    const blocked = state.checklist.filter((i) => i.status === "blocked").length;
    const docTotal = state.documents.length;
    const docRecu = state.documents.filter((d) => d.status === "recu").length;
    return { total, done, blocked, pct: total > 0 ? Math.round((done / total) * 100) : 0, docTotal, docRecu };
  }, [state.checklist, state.documents]);

  // ── Handlers
  const updateChecklistItem = useCallback(
    (id: string, patch: Partial<ChecklistItem>) => {
      onUpdate({
        ...state,
        checklist: state.checklist.map((item) =>
          item.id === id ? { ...item, ...patch } : item
        ),
      });
    },
    [state, onUpdate]
  );

  const cycleStatus = useCallback(
    (id: string) => {
      const item = state.checklist.find((i) => i.id === id);
      if (!item) return;
      const next: ChecklistStatus =
        item.status === "todo" ? "ok" : item.status === "ok" ? "blocked" : "todo";
      updateChecklistItem(id, { status: next });
    },
    [state.checklist, updateChecklistItem]
  );

  const updateDocument = useCallback(
    (id: string, patch: Partial<DocumentItem>) => {
      onUpdate({
        ...state,
        documents: state.documents.map((doc) =>
          doc.id === id ? { ...doc, ...patch } : doc
        ),
      });
    },
    [state, onUpdate]
  );

  const toggleDocStatus = useCallback(
    (id: string) => {
      const doc = state.documents.find((d) => d.id === id);
      if (!doc) return;
      updateDocument(id, {
        status: doc.status === "manquant" ? "recu" : "manquant",
      });
    },
    [state.documents, updateDocument]
  );

  const risques = risquesExistants ?? state.risquesNonFinanciers;

  return (
    <div className="space-y-5">
      {/* ── Progress bar ── */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-700">
            Progression Due Diligence
          </h3>
          <span className="text-sm font-bold text-indigo-600">{stats.pct} %</span>
        </div>
        <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-indigo-500 rounded-full transition-all duration-300"
            style={{ width: `${stats.pct}%` }}
          />
        </div>
        <div className="flex gap-4 mt-2 text-xs text-gray-500">
          <span>✓ {stats.done}/{stats.total} checklist</span>
          <span>✕ {stats.blocked} bloqué(s)</span>
          <span>📄 {stats.docRecu}/{stats.docTotal} documents</span>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
        {([
          { key: "checklist", label: "Checklist" },
          { key: "documents", label: "Documents" },
          { key: "risques", label: "Risques" },
        ] as const).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              activeTab === key
                ? "bg-white text-gray-800 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Checklist tab ── */}
      {activeTab === "checklist" && (
        <div className="space-y-3">
          {(Object.keys(CHECKLIST_CATEGORY_LABELS) as ChecklistCategory[]).map((cat) => {
            const items = grouped.get(cat) ?? [];
            const isExpanded = expandedCat === cat;
            const catDone = items.filter((i) => i.status === "ok").length;

            return (
              <div
                key={cat}
                className="bg-white border border-gray-200 rounded-xl overflow-hidden"
              >
                <button
                  onClick={() => setExpandedCat(isExpanded ? null : cat)}
                  className="w-full px-5 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors"
                >
                  <span>{CATEGORY_ICONS[cat]}</span>
                  <span className="text-sm font-semibold text-gray-700">
                    {CHECKLIST_CATEGORY_LABELS[cat]}
                  </span>
                  <span className="text-xs text-gray-400 ml-auto">
                    {catDone}/{items.length}
                  </span>
                  <span className="text-xs text-gray-400">
                    {isExpanded ? "▼" : "▶"}
                  </span>
                </button>

                {isExpanded && (
                  <div className="px-5 pb-4 space-y-1.5 border-t border-gray-100">
                    {items.map((item) => {
                      const cfg = STATUS_CONFIG[item.status];
                      const isEditing = editingNote === item.id;

                      return (
                        <div
                          key={item.id}
                          className="flex items-start gap-2 py-1.5"
                        >
                          <button
                            onClick={() => cycleStatus(item.id)}
                            className={`mt-0.5 w-6 h-6 flex items-center justify-center rounded border text-xs font-bold transition-colors ${cfg.style}`}
                            title={`Statut: ${cfg.label} (clic pour changer)`}
                          >
                            {cfg.icon}
                          </button>
                          <div className="flex-1 min-w-0">
                            <p
                              className={`text-sm ${
                                item.status === "ok"
                                  ? "text-gray-400 line-through"
                                  : "text-gray-700"
                              }`}
                            >
                              {item.label}
                            </p>
                            {isEditing ? (
                              <input
                                autoFocus
                                value={item.note}
                                onChange={(e) =>
                                  updateChecklistItem(item.id, {
                                    note: e.target.value,
                                  })
                                }
                                onBlur={() => setEditingNote(null)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") setEditingNote(null);
                                }}
                                placeholder="Note..."
                                className="mt-1 w-full text-xs border border-gray-200 rounded px-2 py-1 text-gray-600 focus:ring-1 focus:ring-indigo-500"
                              />
                            ) : (
                              <p
                                onClick={() => setEditingNote(item.id)}
                                className="mt-0.5 text-xs text-gray-400 cursor-pointer hover:text-gray-600"
                              >
                                {item.note || "Ajouter une note…"}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Documents tab ── */}
      {activeTab === "documents" && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="divide-y divide-gray-100">
            {state.documents.map((doc) => {
              const cfg = DOC_STATUS_CONFIG[doc.status];
              const isEditing = editingNote === doc.id;

              return (
                <div
                  key={doc.id}
                  className="px-5 py-3 flex items-start gap-3"
                >
                  <button
                    onClick={() => toggleDocStatus(doc.id)}
                    className={`mt-0.5 w-6 h-6 flex items-center justify-center rounded border text-xs font-bold transition-colors ${cfg.style}`}
                    title={`${cfg.label} (clic pour changer)`}
                  >
                    {cfg.icon}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-sm ${
                        doc.status === "recu"
                          ? "text-gray-400 line-through"
                          : "text-gray-700 font-medium"
                      }`}
                    >
                      {doc.label}
                    </p>
                    {isEditing ? (
                      <input
                        autoFocus
                        value={doc.note}
                        onChange={(e) =>
                          updateDocument(doc.id, { note: e.target.value })
                        }
                        onBlur={() => setEditingNote(null)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") setEditingNote(null);
                        }}
                        placeholder="Note..."
                        className="mt-1 w-full text-xs border border-gray-200 rounded px-2 py-1 text-gray-600 focus:ring-1 focus:ring-indigo-500"
                      />
                    ) : (
                      <p
                        onClick={() => setEditingNote(doc.id)}
                        className="mt-0.5 text-xs text-gray-400 cursor-pointer hover:text-gray-600"
                      >
                        {doc.note || "Ajouter une note…"}
                      </p>
                    )}
                  </div>
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded ${cfg.style}`}
                  >
                    {cfg.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Risques tab ── */}
      {activeTab === "risques" && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700">
            Risques non financiers
          </h3>
          {risques.length > 0 ? (
            <div className="space-y-2">
              {risques.map((r, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg"
                >
                  <span className="text-amber-500 mt-0.5">⚠</span>
                  <p className="text-sm text-amber-800">{r}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-3xl mb-2 opacity-30">🛡️</p>
              <p className="text-sm text-gray-400">
                Aucun risque non financier identifié pour le moment.
              </p>
              <p className="text-xs text-gray-400 mt-1">
                Les risques seront alimentés par l'enrichissement Géorisques et les données du bien.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
