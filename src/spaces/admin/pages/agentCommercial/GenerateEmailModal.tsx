// src/spaces/admin/pages/agentCommercial/GenerateEmailModal.tsx
// Choix du type d'email puis appel de agent-commercial-generate. Le résultat est
// écrit côté serveur en 'pending_review' (validation humaine ensuite).

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Select } from "@/components/ui/Input";
import {
  EMAIL_KIND_LABELS,
  EMAIL_KINDS,
  type EmailKind,
} from "@/spaces/admin/types/agentCommercial.types";
import { generateEmail } from "@/spaces/admin/services/agentCommercial/generateEmail";

export function GenerateEmailModal({
  prospectId,
  onClose,
  onGenerated,
}: {
  prospectId: string;
  onClose: () => void;
  onGenerated: () => void;
}) {
  const [kind, setKind] = useState<EmailKind>("premier_contact");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleGenerate() {
    setError(null);
    setBusy(true);
    try {
      await generateEmail(prospectId, kind);
      onGenerated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Génération impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title="Générer un email"
      description="L'IA rédige un brouillon qui devra être validé avant tout envoi."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button onClick={handleGenerate} loading={busy} leftIcon={<Sparkles className="h-4 w-4" />}>
            Générer
          </Button>
        </>
      }
    >
      {error && (
        <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
          {error}
        </div>
      )}
      <Field label="Type d'email" htmlFor="gen-kind">
        <Select id="gen-kind" value={kind} onChange={(e) => setKind(e.target.value as EmailKind)}>
          {EMAIL_KINDS.map((k) => (
            <option key={k} value={k}>
              {EMAIL_KIND_LABELS[k]}
            </option>
          ))}
        </Select>
      </Field>
      <p className="mt-3 text-xs text-slate-400">
        Le message généré apparaîtra dans « Messages à valider » au statut « À valider ».
      </p>
    </Modal>
  );
}
