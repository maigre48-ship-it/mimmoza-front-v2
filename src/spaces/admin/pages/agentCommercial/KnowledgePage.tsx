// src/spaces/admin/pages/agentCommercial/KnowledgePage.tsx
// Base de connaissances : CRUD par section, distinction visuelle des statuts,
// réordonnancement (position), journalisation. Aucune donnée pré-remplie.
// La section « Tarifs » n'affiche AUCUN tarif : à saisir à la main.

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, BookOpen, Pencil, Plus, Trash2 } from "lucide-react";
import { LoadingState } from "@/components/layouts/LoadingState";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { StatusBadge } from "@/spaces/admin/components/StatusBadge";
import { useToast } from "@/components/ui/toastContext";
import {
  KNOWLEDGE_SECTION_LABELS,
  KNOWLEDGE_SECTIONS,
  KNOWLEDGE_STATUS_LABELS,
  KNOWLEDGE_STATUS_TONES,
  type CommercialKnowledgeEntry,
  type KnowledgeFormValues,
  type KnowledgeSection,
  type KnowledgeStatus,
} from "@/spaces/admin/types/agentCommercial.types";
import {
  createKnowledge,
  deleteKnowledge,
  listKnowledge,
  swapKnowledgePositions,
  updateKnowledge,
} from "@/spaces/admin/services/agentCommercial/knowledgeBase.service";
import { KnowledgeFormModal } from "./KnowledgeFormModal";

type ModalState =
  | { mode: "create"; section: KnowledgeSection }
  | { mode: "edit"; entry: CommercialKnowledgeEntry }
  | null;

const STATUS_BORDER: Record<KnowledgeStatus, string> = {
  valide: "border-l-emerald-400",
  brouillon: "border-l-amber-400",
  desactive: "border-l-slate-300",
};

function emptyForm(section: KnowledgeSection): KnowledgeFormValues {
  return { section, title: "", content: "", status: "brouillon" };
}

function entryToForm(entry: CommercialKnowledgeEntry): KnowledgeFormValues {
  return {
    section: entry.section,
    title: entry.title,
    content: entry.content,
    status: entry.status,
  };
}

export function AgentCommercialKnowledgePage() {
  const toast = useToast();

  const [entries, setEntries] = useState<CommercialKnowledgeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [deleteTarget, setDeleteTarget] = useState<CommercialKnowledgeEntry | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setEntries(await listKnowledge());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<KnowledgeSection, CommercialKnowledgeEntry[]>();
    for (const s of KNOWLEDGE_SECTIONS) map.set(s, []);
    for (const e of entries) map.get(e.section)?.push(e);
    for (const list of map.values()) list.sort((a, b) => a.position - b.position);
    return map;
  }, [entries]);

  async function handleCreate(values: KnowledgeFormValues) {
    await createKnowledge(values);
    setModal(null);
    toast.success("Entrée créée.");
    await load();
  }

  async function handleEdit(entry: CommercialKnowledgeEntry, values: KnowledgeFormValues) {
    await updateKnowledge(entry.id, values);
    setModal(null);
    toast.success("Entrée mise à jour.");
    await load();
  }

  async function handleMove(entry: CommercialKnowledgeEntry, dir: "up" | "down") {
    const list = grouped.get(entry.section) ?? [];
    const idx = list.findIndex((e) => e.id === entry.id);
    const swapIdx = dir === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= list.length) return;
    const other = list[swapIdx];
    try {
      await swapKnowledgePositions(
        { id: entry.id, position: entry.position },
        { id: other.id, position: other.position },
      );
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Réorganisation impossible.");
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteKnowledge(deleteTarget.id);
      setDeleteTarget(null);
      toast.success("Entrée supprimée.");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Suppression impossible.");
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-[28px] border border-slate-200 bg-white shadow-sm">
        <LoadingState text="Chargement de la base de connaissances…" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
        {loadError}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-slate-500">
          Éléments de contexte utilisés par l'IA pour rédiger les messages. Seules les
          entrées <span className="font-medium text-emerald-700">validées</span> seront
          transmises à l'IA (phase 5B).
        </p>
      </div>

      <div className="space-y-4">
        {KNOWLEDGE_SECTIONS.map((section) => {
          const list = grouped.get(section) ?? [];
          const isTarifs = section === "tarifs";
          const tarifsHasValide = list.some((e) => e.status === "valide");

          return (
            <section key={section} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <header className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">
                    {KNOWLEDGE_SECTION_LABELS[section]}
                  </h3>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                    {list.length}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  leftIcon={<Plus className="h-3.5 w-3.5" />}
                  onClick={() => setModal({ mode: "create", section })}
                >
                  Ajouter
                </Button>
              </header>

              {/* Cas particulier tarifs : aucune valeur pré-remplie, saisie manuelle. */}
              {isTarifs && !tarifsHasValide && (
                <div className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
                  Tarification à renseigner — aucune entrée validée. Saisissez les tarifs à la main.
                </div>
              )}

              {list.length === 0 ? (
                !isTarifs && (
                  <p className="py-3 text-sm text-slate-400">Aucune entrée.</p>
                )
              ) : (
                <ul className="space-y-2">
                  {list.map((entry, idx) => (
                    <li
                      key={entry.id}
                      className={[
                        "rounded-2xl border border-l-4 border-slate-200 bg-white p-3",
                        STATUS_BORDER[entry.status],
                        entry.status === "desactive" ? "opacity-60" : "",
                      ].join(" ")}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="truncate text-sm font-semibold text-slate-900">
                              {entry.title}
                            </h4>
                            <StatusBadge
                              label={KNOWLEDGE_STATUS_LABELS[entry.status]}
                              tone={KNOWLEDGE_STATUS_TONES[entry.status]}
                            />
                          </div>
                          <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-slate-500">
                            {entry.content}
                          </p>
                        </div>

                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            title="Monter"
                            disabled={idx === 0}
                            onClick={() => void handleMove(entry, "up")}
                            className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            <ArrowUp className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            title="Descendre"
                            disabled={idx === list.length - 1}
                            onClick={() => void handleMove(entry, "down")}
                            className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            <ArrowDown className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            title="Modifier"
                            onClick={() => setModal({ mode: "edit", entry })}
                            className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            title="Supprimer"
                            onClick={() => setDeleteTarget(entry)}
                            className="rounded-lg p-1.5 text-slate-500 transition hover:bg-rose-50 hover:text-rose-600"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {entries.length === 0 && (
        <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
          <BookOpen className="h-4 w-4 text-slate-400" />
          Aucune entrée pour le moment. Ajoutez du contexte section par section.
        </div>
      )}

      {modal?.mode === "create" && (
        <KnowledgeFormModal
          mode="create"
          initial={emptyForm(modal.section)}
          onClose={() => setModal(null)}
          onSubmit={handleCreate}
        />
      )}
      {modal?.mode === "edit" && (
        <KnowledgeFormModal
          mode="edit"
          initial={entryToForm(modal.entry)}
          onClose={() => setModal(null)}
          onSubmit={(values) => handleEdit(modal.entry, values)}
        />
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Supprimer cette entrée ?"
        message={`« ${deleteTarget?.title} » sera définitivement supprimée de la base de connaissances.`}
        confirmLabel="Supprimer"
        danger
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
