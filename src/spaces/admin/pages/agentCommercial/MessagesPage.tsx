// src/spaces/admin/pages/agentCommercial/MessagesPage.tsx
// File de validation des emails générés par l'IA. Relecture / édition, puis
// Valider (approved) ou Rejeter (rejected). Aucun envoi ici (Gmail = phase 6).

import { useCallback, useEffect, useState } from "react";
import { MailCheck } from "lucide-react";
import { EmptyState } from "@/components/layouts/EmptyState";
import { LoadingState } from "@/components/layouts/LoadingState";
import {
  EMAIL_KIND_LABELS,
  type EmailStatus,
} from "@/spaces/admin/types/agentCommercial.types";
import {
  listEmailsByStatus,
  type EmailWithProspect,
} from "@/spaces/admin/services/agentCommercial/emails.service";
import { EmailReviewModal } from "./EmailReviewModal";
import { EmailStatusBadge } from "./EmailStatusBadge";
import { formatDateTime, prospectContactName } from "./prospectFormat";

const TABS: { key: EmailStatus; label: string }[] = [
  { key: "pending_review", label: "À valider" },
  { key: "approved", label: "Approuvés" },
  { key: "rejected", label: "Rejetés" },
];

export function AgentCommercialMessagesPage() {
  const [tab, setTab] = useState<EmailStatus>("pending_review");
  const [emails, setEmails] = useState<EmailWithProspect[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<EmailWithProspect | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setEmails(await listEmailsByStatus(tab));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    void load();
  }, [load]);

  function preview(text: string | null): string {
    if (!text) return "";
    return text.length > 160 ? `${text.slice(0, 160)}…` : text;
  }

  return (
    <div className="space-y-5">
      <div className="inline-flex rounded-2xl border border-slate-200 bg-white p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={[
              "rounded-xl px-3 py-1.5 text-sm font-medium transition",
              tab === t.key ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-50",
            ].join(" ")}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="rounded-[28px] border border-slate-200 bg-white shadow-sm">
          <LoadingState text="Chargement des messages…" />
        </div>
      ) : loadError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {loadError}
        </div>
      ) : emails.length === 0 ? (
        <div className="rounded-[28px] border border-slate-200 bg-white shadow-sm">
          <EmptyState
            icon={<MailCheck className="h-8 w-8 text-slate-400" />}
            title={tab === "pending_review" ? "Aucun message à valider" : "Aucun message"}
            description={
              tab === "pending_review"
                ? "Générez un email depuis la fiche d'un prospect : il apparaîtra ici pour validation."
                : "Rien à afficher pour ce filtre."
            }
          />
        </div>
      ) : (
        <ul className="space-y-2">
          {emails.map((email) => (
            <li key={email.id}>
              <button
                type="button"
                onClick={() => setSelected(email)}
                className="flex w-full flex-col gap-1 rounded-[24px] border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-slate-300 hover:shadow"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-900">
                      {email.prospect?.company_name ?? "Prospect"}
                    </span>
                    <span className="text-xs text-slate-400">
                      {email.prospect ? prospectContactName(email.prospect) : ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                      {EMAIL_KIND_LABELS[email.kind]}
                    </span>
                    <EmailStatusBadge status={email.status} />
                  </div>
                </div>
                <div className="text-sm font-medium text-slate-800">{email.subject ?? "(sans objet)"}</div>
                <p className="line-clamp-2 text-xs text-slate-500">{preview(email.body)}</p>
                <div className="text-xs text-slate-400">{formatDateTime(email.created_at)}</div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <EmailReviewModal
          email={selected}
          onClose={() => setSelected(null)}
          onChanged={() => {
            void load();
          }}
        />
      )}
    </div>
  );
}
