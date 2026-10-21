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
  const [incomingMessage, setIncomingMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleGenerate() {
    setError(null);
    if (kind === "reponse_question" && !incomingMessage.trim()) {
      setError("Collez le mail reçu avant de générer une réponse.");
      return;
    }
    setBusy(true);
    try {
      await generateEmail(prospectId, kind, incomingMessage.trim() || undefined);
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
      {kind === "reponse_question" && (
        <div className="mt-4">
          <label htmlFor="incoming-message" className="block text-sm font-medium text-slate-700">
            Mail reçu du prospect
          </label>
          <textarea
            id="incoming-message"
            value={incomingMessage}
            onChange={(event) => setIncomingMessage(event.target.value)}
            rows={8}
            maxLength={12000}
            className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 focus:border-slate-500 focus:outline-none"
            placeholder="Collez ici le message auquel répondre. Retirez les informations sensibles inutiles."
          />
          <p className="mt-1 text-xs text-slate-500">La réponse sera enregistrée comme brouillon à valider.</p>
        </div>
      )}
      <p className="mt-3 text-xs text-slate-400">
        Le message généré apparaîtra dans « Messages à valider » au statut « À valider ».
      </p>
    </Modal>
  );
}
