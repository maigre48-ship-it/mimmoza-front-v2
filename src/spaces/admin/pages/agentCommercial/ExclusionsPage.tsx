// src/spaces/admin/pages/agentCommercial/ExclusionsPage.tsx
// Page « Liste d'exclusion » : liste, recherche, ajout (email et/ou domaine,
// motif obligatoire), retrait. La vérification vit dans exclusionCheck.ts.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, Plus, Search, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/layouts/EmptyState";
import { LoadingState } from "@/components/layouts/LoadingState";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Modal } from "@/components/ui/Modal";
import { Field, TextInput } from "@/components/ui/Input";
import { Table, type Column } from "@/components/ui/Table";
import { useToast } from "@/components/ui/toastContext";
import type { CommercialExclusion } from "@/spaces/admin/types/agentCommercial.types";
import {
  createExclusion,
  deleteExclusion,
  listExclusions,
} from "@/spaces/admin/services/agentCommercial/exclusions.service";
import { logActivity } from "@/spaces/admin/services/agentCommercial/activityLog.service";
import { formatDateTime } from "./prospectFormat";

export function AgentCommercialExclusionsPage() {
  const toast = useToast();

  const [rows, setRows] = useState<CommercialExclusion[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState("");
  const [domain, setDomain] = useState("");
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<CommercialExclusion | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setRows(await listExclusions());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.email, r.domain, r.siren, r.reason]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [rows, search]);

  function openAdd() {
    setEmail("");
    setDomain("");
    setReason("");
    setFormError(null);
    setAdding(true);
  }

  async function submitAdd() {
    setFormError(null);
    if (!email.trim() && !domain.trim()) {
      setFormError("Renseigne au moins un email ou un domaine.");
      return;
    }
    if (!reason.trim()) {
      setFormError("Le motif est obligatoire.");
      return;
    }
    setSaving(true);
    try {
      const created = await createExclusion({ email, domain, reason });
      void logActivity({
        event_type: "exclusion_added",
        entity: "exclusion",
        entity_id: created.id,
        metadata: { via: "manual", email: created.email, domain: created.domain },
      });
      setAdding(false);
      toast.success("Exclusion ajoutée.");
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Ajout impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteExclusion(deleteTarget.id);
      void logActivity({
        event_type: "exclusion_removed",
        entity: "exclusion",
        entity_id: deleteTarget.id,
      });
      setDeleteTarget(null);
      toast.success("Exclusion retirée.");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Retrait impossible.");
    } finally {
      setDeleting(false);
    }
  }

  const columns: Column<CommercialExclusion>[] = [
    {
      key: "email",
      header: "Email",
      sortable: true,
      sortValue: (r) => (r.email ?? "").toLowerCase(),
      render: (r) => <span className="text-slate-800">{r.email ?? "—"}</span>,
    },
    {
      key: "domain",
      header: "Domaine",
      sortable: true,
      sortValue: (r) => (r.domain ?? "").toLowerCase(),
      render: (r) => <span className="text-slate-600">{r.domain ?? "—"}</span>,
    },
    {
      key: "siren",
      header: "SIREN",
      render: (r) => <span className="text-slate-600">{r.siren ?? "—"}</span>,
    },
    {
      key: "reason",
      header: "Motif",
      render: (r) => <span className="text-slate-600">{r.reason}</span>,
    },
    {
      key: "created_at",
      header: "Ajouté le",
      sortable: true,
      sortValue: (r) => r.created_at,
      render: (r) => <span className="text-slate-500">{formatDateTime(r.created_at)}</span>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (r) => (
        <button
          type="button"
          title="Retirer"
          onClick={() => setDeleteTarget(r)}
          className="rounded-lg p-1.5 text-slate-500 transition hover:bg-rose-50 hover:text-rose-600"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <TextInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher…"
            className="pl-9"
          />
        </div>
        <Button leftIcon={<Plus className="h-4 w-4" />} onClick={openAdd}>
          Ajouter une exclusion
        </Button>
      </div>

      {loading ? (
        <div className="rounded-[28px] border border-slate-200 bg-white shadow-sm">
          <LoadingState text="Chargement de la liste d'exclusion…" />
        </div>
      ) : loadError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {loadError}
        </div>
      ) : (
        <Table
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          pageSize={12}
          initialSort={{ key: "created_at", dir: "desc" }}
          emptyState={
            <EmptyState
              icon={<Ban className="h-8 w-8 text-slate-400" />}
              title="Aucune exclusion"
              description="Ajoutez un email ou un domaine à ne jamais prospecter. Les contacts en opt-out y sont ajoutés automatiquement."
            />
          }
        />
      )}

      {/* Modale d'ajout */}
      {adding && (
        <Modal
          open
          onClose={() => setAdding(false)}
          title="Ajouter une exclusion"
          description="Email et/ou domaine à ne jamais prospecter."
          footer={
            <>
              <Button variant="secondary" onClick={() => setAdding(false)} disabled={saving}>
                Annuler
              </Button>
              <Button onClick={submitAdd} loading={saving}>
                Ajouter
              </Button>
            </>
          }
        >
          {formError && (
            <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
              {formError}
            </div>
          )}
          <div className="space-y-4">
            <Field label="Email" htmlFor="ex-email" hint="Adresse exacte à exclure.">
              <TextInput id="ex-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Domaine" htmlFor="ex-domain" hint="Ex : exemple.fr — exclut toutes les adresses de ce domaine.">
              <TextInput id="ex-domain" value={domain} onChange={(e) => setDomain(e.target.value)} />
            </Field>
            <Field label="Motif" required htmlFor="ex-reason">
              <TextInput id="ex-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex : Demande de désinscription" />
            </Field>
          </div>
        </Modal>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Retirer cette exclusion ?"
        message="Le contact pourra de nouveau être prospecté et importé."
        confirmLabel="Retirer"
        danger
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
