// src/spaces/admin/pages/agentCommercial/ProspectFormModal.tsx
// Formulaire de création / édition d'un prospect (dans une Modal).
// Monté uniquement quand nécessaire (état frais à chaque ouverture).

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Select, TextInput, Textarea } from "@/components/ui/Input";
import {
  PROSPECT_LEGAL_BASES,
  PROSPECT_LEGAL_BASIS_LABELS,
  PROSPECT_STATUSES,
  PROSPECT_STATUS_LABELS,
  type ProspectFormValues,
  type ProspectLegalBasis,
  type ProspectStatus,
} from "@/spaces/admin/types/agentCommercial.types";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function clean(value: string | null): string | null {
  if (value == null) return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

export function ProspectFormModal({
  mode,
  initial,
  onClose,
  onSubmit,
}: {
  mode: "create" | "edit";
  initial: ProspectFormValues;
  onClose: () => void;
  onSubmit: (values: ProspectFormValues) => Promise<void>;
}) {
  const [values, setValues] = useState<ProspectFormValues>(initial);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function setField<K extends keyof ProspectFormValues>(key: K, value: ProspectFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function text(key: keyof ProspectFormValues): string {
    const v = values[key];
    return typeof v === "string" ? v : "";
  }

  async function handleSubmit() {
    setError(null);

    const company = values.company_name.trim();
    if (!company) {
      setError("La raison sociale est obligatoire.");
      return;
    }
    const email = clean(values.email);
    if (email && !EMAIL_RE.test(email)) {
      setError("L'adresse email n'est pas valide.");
      return;
    }

    const payload: ProspectFormValues = {
      company_name: company,
      first_name: clean(values.first_name),
      last_name: clean(values.last_name),
      job_title: clean(values.job_title),
      email,
      phone: clean(values.phone),
      website: clean(values.website),
      city: clean(values.city),
      department: clean(values.department),
      zone: clean(values.zone),
      company_type: clean(values.company_type),
      company_size: clean(values.company_size),
      notes: clean(values.notes),
      status: values.status,
      score: values.score,
      next_action: clean(values.next_action),
      next_action_at: clean(values.next_action_at),
      last_interaction_at: clean(values.last_interaction_at),
      legal_basis: values.legal_basis,
      opt_out: values.opt_out,
    };

    setSubmitting(true);
    try {
      await onSubmit(payload);
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
      size="xl"
      title={mode === "create" ? "Nouveau prospect" : "Modifier le prospect"}
      description="Marchand de biens à prospecter."
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Raison sociale" required htmlFor="pf-company">
            <TextInput
              id="pf-company"
              value={values.company_name}
              onChange={(e) => setField("company_name", e.target.value)}
              placeholder="Ex : Foncière Dupont SAS"
            />
          </Field>
        </div>

        <Field label="Prénom" htmlFor="pf-first">
          <TextInput id="pf-first" value={text("first_name")} onChange={(e) => setField("first_name", e.target.value)} />
        </Field>
        <Field label="Nom" htmlFor="pf-last">
          <TextInput id="pf-last" value={text("last_name")} onChange={(e) => setField("last_name", e.target.value)} />
        </Field>

        <Field label="Fonction" htmlFor="pf-job">
          <TextInput id="pf-job" value={text("job_title")} onChange={(e) => setField("job_title", e.target.value)} placeholder="Ex : Gérant" />
        </Field>
        <Field label="Email" htmlFor="pf-email">
          <TextInput id="pf-email" type="email" value={text("email")} onChange={(e) => setField("email", e.target.value)} />
        </Field>

        <Field label="Téléphone" htmlFor="pf-phone">
          <TextInput id="pf-phone" value={text("phone")} onChange={(e) => setField("phone", e.target.value)} />
        </Field>
        <Field label="Site web" htmlFor="pf-web">
          <TextInput id="pf-web" value={text("website")} onChange={(e) => setField("website", e.target.value)} />
        </Field>

        <Field label="Ville" htmlFor="pf-city">
          <TextInput id="pf-city" value={text("city")} onChange={(e) => setField("city", e.target.value)} />
        </Field>
        <Field label="Département" htmlFor="pf-dep">
          <TextInput id="pf-dep" value={text("department")} onChange={(e) => setField("department", e.target.value)} placeholder="Ex : 33" />
        </Field>

        <Field label="Zone" htmlFor="pf-zone">
          <TextInput id="pf-zone" value={text("zone")} onChange={(e) => setField("zone", e.target.value)} placeholder="Ex : Nouvelle-Aquitaine" />
        </Field>
        <Field label="Type d'entreprise" htmlFor="pf-ctype">
          <TextInput id="pf-ctype" value={text("company_type")} onChange={(e) => setField("company_type", e.target.value)} />
        </Field>

        <Field label="Taille" htmlFor="pf-size">
          <TextInput id="pf-size" value={text("company_size")} onChange={(e) => setField("company_size", e.target.value)} placeholder="Ex : 1-10" />
        </Field>
        <Field label="Score (0-100)" htmlFor="pf-score">
          <TextInput
            id="pf-score"
            type="number"
            min={0}
            max={100}
            value={values.score ?? ""}
            onChange={(e) => setField("score", e.target.value === "" ? null : Number(e.target.value))}
          />
        </Field>

        <Field label="Statut" htmlFor="pf-status">
          <Select
            id="pf-status"
            value={values.status}
            onChange={(e) => setField("status", e.target.value as ProspectStatus)}
          >
            {PROSPECT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PROSPECT_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Base légale (RGPD)" htmlFor="pf-legal">
          <Select
            id="pf-legal"
            value={values.legal_basis}
            onChange={(e) => setField("legal_basis", e.target.value as ProspectLegalBasis)}
          >
            {PROSPECT_LEGAL_BASES.map((b) => (
              <option key={b} value={b}>
                {PROSPECT_LEGAL_BASIS_LABELS[b]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Dernière interaction" htmlFor="pf-last-int">
          <TextInput
            id="pf-last-int"
            type="date"
            value={text("last_interaction_at")}
            onChange={(e) => setField("last_interaction_at", e.target.value)}
          />
        </Field>
        <Field label="Prochaine action — échéance" htmlFor="pf-next-at">
          <TextInput
            id="pf-next-at"
            type="date"
            value={text("next_action_at")}
            onChange={(e) => setField("next_action_at", e.target.value)}
          />
        </Field>

        <div className="sm:col-span-2">
          <Field label="Prochaine action" htmlFor="pf-next">
            <TextInput
              id="pf-next"
              value={text("next_action")}
              onChange={(e) => setField("next_action", e.target.value)}
              placeholder="Ex : Rappeler après la visite"
            />
          </Field>
        </div>

        <div className="sm:col-span-2">
          <Field label="Notes internes" htmlFor="pf-notes">
            <Textarea
              id="pf-notes"
              rows={3}
              value={text("notes")}
              onChange={(e) => setField("notes", e.target.value)}
            />
          </Field>
        </div>

        <div className="sm:col-span-2">
          <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <input
              type="checkbox"
              checked={values.opt_out}
              onChange={(e) => setField("opt_out", e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300"
            />
            <span className="text-sm text-slate-700">
              <span className="font-medium">Opposition à la prospection (opt-out)</span>
              {values.opt_out && (
                <span className="mt-1 flex items-center gap-1.5 text-xs text-amber-700">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Ce contact sera ajouté à la liste d'exclusion.
                </span>
              )}
            </span>
          </label>
        </div>
      </div>
    </Modal>
  );
}
