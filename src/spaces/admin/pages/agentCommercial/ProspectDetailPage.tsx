// src/spaces/admin/pages/agentCommercial/ProspectDetailPage.tsx
// Fiche détaillée d'un prospect : informations, notes, statut, prochaine action,
// historique des transitions et journal d'activité. Édition + archivage.

import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Archive, ArchiveRestore, ArrowLeft, Ban, Mail, Pencil, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { LoadingState } from "@/components/layouts/LoadingState";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { StatusBadge } from "@/spaces/admin/components/StatusBadge";
import { useToast } from "@/components/ui/toastContext";
import {
  EMAIL_KIND_LABELS,
  PROSPECT_LEGAL_BASIS_LABELS,
  PROSPECT_SOURCE_LABELS,
  PROSPECT_STATUS_LABELS,
  type CommercialActivityLog,
  type CommercialEmail,
  type CommercialPipelineEvent,
  type CommercialProspect,
  type ProspectFormValues,
} from "@/spaces/admin/types/agentCommercial.types";
import {
  archiveProspect,
  getProspect,
  restoreProspect,
  saveProspectEdit,
} from "@/spaces/admin/services/agentCommercial/prospects.service";
import { listPipelineEvents } from "@/spaces/admin/services/agentCommercial/pipeline.service";
import { listActivityForEntity } from "@/spaces/admin/services/agentCommercial/activityLog.service";
import { listEmailsForProspect } from "@/spaces/admin/services/agentCommercial/emails.service";
import { ProspectFormModal } from "./ProspectFormModal";
import { ProspectStatusBadge } from "./ProspectStatusBadge";
import { EmailStatusBadge } from "./EmailStatusBadge";
import { GenerateEmailModal } from "./GenerateEmailModal";
import { activityLabel } from "./activityLabels";
import { formatDate, formatDateTime, prospectContactName, prospectToForm } from "./prospectFormat";

const PROSPECTS_ROUTE = "/admin/agent-commercial/prospects";

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="text-sm text-slate-800">{value}</dd>
    </div>
  );
}

export function AgentCommercialProspectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const [prospect, setProspect] = useState<CommercialProspect | null>(null);
  const [events, setEvents] = useState<CommercialPipelineEvent[]>([]);
  const [activity, setActivity] = useState<CommercialActivityLog[]>([]);
  const [emails, setEmails] = useState<CommercialEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [editing, setEditing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setNotFound(false);
    try {
      const p = await getProspect(id);
      if (!p) {
        setNotFound(true);
        return;
      }
      setProspect(p);
      const [ev, act, em] = await Promise.all([
        listPipelineEvents(id),
        listActivityForEntity("prospect", id),
        listEmailsForProspect(id),
      ]);
      setEvents(ev);
      setActivity(act);
      setEmails(em);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleEdit(values: ProspectFormValues) {
    if (!prospect) return;
    await saveProspectEdit(prospect, values);
    setEditing(false);
    toast.success("Prospect mis à jour.");
    await load();
  }

  async function handleArchiveToggle() {
    if (!prospect) return;
    setActionBusy(true);
    try {
      if (prospect.archived_at) {
        await restoreProspect(prospect.id);
        toast.success("Prospect restauré.");
      } else {
        await archiveProspect(prospect.id);
        toast.success("Prospect archivé.");
      }
      setConfirmArchive(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action impossible.");
    } finally {
      setActionBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-[28px] border border-slate-200 bg-white shadow-sm">
        <LoadingState text="Chargement de la fiche…" />
      </div>
    );
  }

  if (notFound || !prospect) {
    return (
      <div className="rounded-[28px] border border-slate-200 bg-white p-8 text-center shadow-sm">
        <p className="text-sm text-slate-600">Ce prospect est introuvable.</p>
        <div className="mt-4">
          <Button variant="secondary" leftIcon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate(PROSPECTS_ROUTE)}>
            Retour à la liste
          </Button>
        </div>
      </div>
    );
  }

  const isArchived = prospect.archived_at !== null;

  return (
    <div className="space-y-5">
      {/* En-tête fiche */}
      <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <button
              type="button"
              onClick={() => navigate(PROSPECTS_ROUTE)}
              className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-slate-800"
            >
              <ArrowLeft className="h-4 w-4" />
              Prospects
            </button>
            <h2 className="text-2xl font-semibold tracking-tight text-slate-950">
              {prospect.company_name}
            </h2>
            <p className="mt-1 text-sm text-slate-600">{prospectContactName(prospect)}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <ProspectStatusBadge status={prospect.status} />
              <StatusBadge label={PROSPECT_SOURCE_LABELS[prospect.source]} tone="slate" />
              <StatusBadge label={PROSPECT_LEGAL_BASIS_LABELS[prospect.legal_basis]} tone="sky" />
              {prospect.opt_out && <StatusBadge label="Opt-out" tone="rose" />}
              {isArchived && <StatusBadge label="Archivé" tone="amber" />}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isArchived && (
              <Button
                leftIcon={<Sparkles className="h-4 w-4" />}
                onClick={() => setGenerating(true)}
                disabled={prospect.opt_out || prospect.status === "exclu"}
                title={
                  prospect.opt_out || prospect.status === "exclu"
                    ? "Prospect exclu : génération impossible."
                    : undefined
                }
              >
                Générer un email
              </Button>
            )}
            {!isArchived && (
              <Button variant="secondary" leftIcon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>
                Modifier
              </Button>
            )}
            <Button
              variant={isArchived ? "secondary" : "danger"}
              leftIcon={isArchived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
              onClick={() => setConfirmArchive(true)}
            >
              {isArchived ? "Restaurer" : "Archiver"}
            </Button>
          </div>
        </div>

        {prospect.opt_out && (
          <div className="mt-4 flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
            <Ban className="h-4 w-4 shrink-0" />
            Contact en opposition à la prospection (opt-out) — présent dans la liste d'exclusion.
          </div>
        )}
      </div>

      {/* Informations */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">Informations</h3>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <InfoRow label="Email" value={prospect.email ?? "—"} />
            <InfoRow label="Téléphone" value={prospect.phone ?? "—"} />
            <InfoRow label="Site web" value={prospect.website ?? "—"} />
            <InfoRow label="Fonction" value={prospect.job_title ?? "—"} />
            <InfoRow label="Ville" value={prospect.city ?? "—"} />
            <InfoRow label="Département" value={prospect.department ?? "—"} />
            <InfoRow label="Zone" value={prospect.zone ?? "—"} />
            <InfoRow label="Type d'entreprise" value={prospect.company_type ?? "—"} />
            <InfoRow label="Taille" value={prospect.company_size ?? "—"} />
            <InfoRow label="Score" value={prospect.score ?? "—"} />
            <InfoRow label="Prochaine action" value={prospect.next_action ?? "—"} />
            <InfoRow label="Échéance" value={formatDate(prospect.next_action_at)} />
            <InfoRow label="Dernière interaction" value={formatDate(prospect.last_interaction_at)} />
            <InfoRow label="Créé le" value={formatDateTime(prospect.created_at)} />
          </dl>

          <div className="mt-5 border-t border-slate-100 pt-4">
            <h4 className="mb-1.5 text-xs uppercase tracking-wide text-slate-400">Notes internes</h4>
            <p className="whitespace-pre-wrap text-sm text-slate-700">
              {prospect.notes ?? <span className="text-slate-400">Aucune note.</span>}
            </p>
          </div>
        </div>

        {/* Historique */}
        <div className="space-y-5">
          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
              Historique des statuts
            </h3>
            {events.length === 0 ? (
              <p className="text-sm text-slate-400">Aucune transition.</p>
            ) : (
              <ul className="space-y-3">
                {events.map((e) => (
                  <li key={e.id} className="text-sm">
                    <div className="text-slate-700">
                      {e.from_status ? PROSPECT_STATUS_LABELS[e.from_status] : "Création"}
                      {" → "}
                      <span className="font-medium">{PROSPECT_STATUS_LABELS[e.to_status]}</span>
                    </div>
                    <div className="text-xs text-slate-400">{formatDateTime(e.created_at)}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
              Journal d'activité
            </h3>
            {activity.length === 0 ? (
              <p className="text-sm text-slate-400">Aucune activité.</p>
            ) : (
              <ul className="space-y-3">
                {activity.map((a) => (
                  <li key={a.id} className="text-sm">
                    <div className="text-slate-700">{activityLabel(a.event_type)}</div>
                    <div className="text-xs text-slate-400">{formatDateTime(a.created_at)}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Emails générés */}
      <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Emails générés
        </h3>
        {emails.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-slate-400">
            <Mail className="h-4 w-4" />
            Aucun email généré. Utilisez « Générer un email ».
          </p>
        ) : (
          <ul className="space-y-2">
            {emails.map((email) => (
              <li
                key={email.id}
                className="rounded-2xl border border-slate-200 bg-white p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                      {EMAIL_KIND_LABELS[email.kind]}
                    </span>
                    <EmailStatusBadge status={email.status} />
                  </div>
                  <span className="text-xs text-slate-400">{formatDateTime(email.created_at)}</span>
                </div>
                <div className="mt-1 text-sm font-medium text-slate-800">
                  {email.subject ?? "(sans objet)"}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-slate-400">
          La relecture et la validation se font dans l'onglet « Messages à valider ».
        </p>
      </div>

      {generating && (
        <GenerateEmailModal
          prospectId={prospect.id}
          onClose={() => setGenerating(false)}
          onGenerated={() => {
            setGenerating(false);
            toast.success("Email généré. À valider dans « Messages à valider ».");
            void load();
          }}
        />
      )}

      {editing && (
        <ProspectFormModal
          mode="edit"
          initial={prospectToForm(prospect)}
          onClose={() => setEditing(false)}
          onSubmit={handleEdit}
        />
      )}

      <ConfirmDialog
        open={confirmArchive}
        title={isArchived ? "Restaurer ce prospect ?" : "Archiver ce prospect ?"}
        message={
          isArchived
            ? `« ${prospect.company_name} » redeviendra actif.`
            : `« ${prospect.company_name} » sera masqué des listes. Aucune donnée n'est supprimée — l'action est réversible.`
        }
        confirmLabel={isArchived ? "Restaurer" : "Archiver"}
        danger={!isArchived}
        loading={actionBusy}
        onConfirm={handleArchiveToggle}
        onCancel={() => setConfirmArchive(false)}
      />
    </div>
  );
}
