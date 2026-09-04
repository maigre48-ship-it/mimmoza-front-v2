// src/spaces/admin/pages/agentCommercial/EmailReviewModal.tsx
// Relecture / édition d'un email généré, puis Valider (approved) ou Rejeter
// (rejected). AUCUN envoi : le bouton d'envoi est présent mais DÉSACTIVÉ tant
// que Gmail n'est pas connecté (phase 6). On ne simule jamais un envoi réussi.

import { useState } from "react";
import { Ban, Check, Send, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, TextInput, Textarea } from "@/components/ui/Input";
import { useToast } from "@/components/ui/toastContext";
import {
  EMAIL_KIND_LABELS,
  PROSPECT_STATUS_LABELS,
} from "@/spaces/admin/types/agentCommercial.types";
import {
  approveEmail,
  rejectEmail,
  updateEmailContent,
  type EmailWithProspect,
} from "@/spaces/admin/services/agentCommercial/emails.service";
import { EmailStatusBadge } from "./EmailStatusBadge";
import { prospectContactName } from "./prospectFormat";

function recommendedStatusLabel(value: string | null): string {
  if (!value) return "—";
  return (PROSPECT_STATUS_LABELS as Record<string, string>)[value] ?? value;
}

export function EmailReviewModal({
  email,
  onClose,
  onChanged,
}: {
  email: EmailWithProspect;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [subject, setSubject] = useState(email.subject ?? "");
  const [body, setBody] = useState(email.body ?? "");
  const [busy, setBusy] = useState(false);

  const isPending = email.status === "pending_review";
  const dirty = subject !== (email.subject ?? "") || body !== (email.body ?? "");

  const companyName = email.prospect?.company_name ?? "Prospect";
  const contact = email.prospect
    ? prospectContactName(email.prospect)
    : "—";

  async function run(action: () => Promise<void>, successMsg: string, close: boolean) {
    setBusy(true);
    try {
      await action();
      toast.success(successMsg);
      onChanged();
      if (close) onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={`${EMAIL_KIND_LABELS[email.kind]} — ${companyName}`}
      description={contact}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          {/* Envoi non disponible : présent mais désactivé (Gmail = phase 6). */}
          <Button
            variant="secondary"
            disabled
            title="L'envoi Gmail sera disponible en phase 6."
            leftIcon={<Send className="h-4 w-4" />}
          >
            Envoyer — Gmail non connecté
          </Button>

          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Fermer
            </Button>
            {isPending && (
              <>
                {dirty && (
                  <Button
                    variant="secondary"
                    loading={busy}
                    onClick={() =>
                      void run(
                        async () => {
                          await updateEmailContent(email.id, { subject, body });
                        },
                        "Modifications enregistrées.",
                        false,
                      )
                    }
                  >
                    Enregistrer
                  </Button>
                )}
                <Button
                  variant="danger"
                  loading={busy}
                  leftIcon={<X className="h-4 w-4" />}
                  onClick={() => void run(() => rejectEmail(email.id), "Email rejeté.", true)}
                >
                  Rejeter
                </Button>
                <Button
                  loading={busy}
                  leftIcon={<Check className="h-4 w-4" />}
                  onClick={() => void run(() => approveEmail(email.id), "Email validé.", true)}
                >
                  Valider
                </Button>
              </>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <EmailStatusBadge status={email.status} />
          {email.ai_model && (
            <span className="text-xs text-slate-400">
              Modèle : {email.ai_model}
              {email.tokens_in != null && email.tokens_out != null
                ? ` · ${email.tokens_in}+${email.tokens_out} tokens`
                : ""}
            </span>
          )}
        </div>

        <Field label="Objet" htmlFor="rev-subject">
          <TextInput
            id="rev-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={!isPending || busy}
          />
        </Field>

        <Field label="Corps" htmlFor="rev-body">
          <Textarea
            id="rev-body"
            rows={12}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={!isPending || busy}
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs uppercase tracking-wide text-slate-400">Statut recommandé</div>
            <div className="mt-1 text-sm text-slate-700">
              {recommendedStatusLabel(email.recommended_status)}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs uppercase tracking-wide text-slate-400">Prochaine action recommandée</div>
            <div className="mt-1 text-sm text-slate-700">
              {email.recommended_next_action ?? "—"}
            </div>
          </div>
        </div>

        {email.internal_rationale && (
          <div className="rounded-2xl border border-sky-200 bg-sky-50 p-3">
            <div className="text-xs uppercase tracking-wide text-sky-600">Note interne (IA)</div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
              {email.internal_rationale}
            </p>
          </div>
        )}

        <p className="flex items-center gap-1.5 text-xs text-slate-400">
          <Ban className="h-3.5 w-3.5" />
          « Valider » ne déclenche aucun envoi. L'envoi via Gmail arrivera en phase 6.
        </p>
      </div>
    </Modal>
  );
}
