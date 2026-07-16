// src/spaces/admin/pages/agentCommercial/KnowledgeFormModal.tsx
// Création / édition d'une entrée de base de connaissances (dans une Modal).

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Select, TextInput, Textarea } from "@/components/ui/Input";
import {
  KNOWLEDGE_SECTION_LABELS,
  KNOWLEDGE_SECTIONS,
  KNOWLEDGE_STATUS_LABELS,
  KNOWLEDGE_STATUSES,
  type KnowledgeFormValues,
  type KnowledgeSection,
  type KnowledgeStatus,
} from "@/spaces/admin/types/agentCommercial.types";

export function KnowledgeFormModal({
  mode,
  initial,
  onClose,
  onSubmit,
}: {
  mode: "create" | "edit";
  initial: KnowledgeFormValues;
  onClose: () => void;
  onSubmit: (values: KnowledgeFormValues) => Promise<void>;
}) {
  const [values, setValues] = useState<KnowledgeFormValues>(initial);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function setField<K extends keyof KnowledgeFormValues>(key: K, value: KnowledgeFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit() {
    setError(null);
    if (!values.title.trim()) {
      setError("Le titre est obligatoire.");
      return;
    }
    if (!values.content.trim()) {
      setError("Le contenu est obligatoire.");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({ ...values, title: values.title.trim() });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Une erreur est survenue.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={mode === "create" ? "Nouvelle entrée" : "Modifier l'entrée"}
      description="Contexte fourni à l'IA pour rédiger les messages."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Annuler
          </Button>
          <Button onClick={handleSubmit} loading={submitting}>
            {mode === "create" ? "Créer" : "Enregistrer"}
          </Button>
        </>
      }
    >
      {error && (
        <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Section" htmlFor="kb-section">
            <Select
              id="kb-section"
              value={values.section}
              onChange={(e) => setField("section", e.target.value as KnowledgeSection)}
            >
              {KNOWLEDGE_SECTIONS.map((s) => (
                <option key={s} value={s}>
                  {KNOWLEDGE_SECTION_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Statut" htmlFor="kb-status">
            <Select
              id="kb-status"
              value={values.status}
              onChange={(e) => setField("status", e.target.value as KnowledgeStatus)}
            >
              {KNOWLEDGE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {KNOWLEDGE_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Titre" required htmlFor="kb-title">
          <TextInput
            id="kb-title"
            value={values.title}
            onChange={(e) => setField("title", e.target.value)}
            placeholder="Ex : Argumentaire gain de temps"
          />
        </Field>

        <Field label="Contenu" required htmlFor="kb-content">
          <Textarea
            id="kb-content"
            rows={8}
            value={values.content}
            onChange={(e) => setField("content", e.target.value)}
          />
        </Field>
      </div>
    </Modal>
  );
}
