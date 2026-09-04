// src/spaces/admin/pages/agentCommercial/ProspectsPage.tsx
// Page « Prospects » : liste (recherche, filtres, tri, pagination), création,
// édition, archivage doux / restauration. Fiche détaillée sur une route dédiée.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Archive, ArchiveRestore, Eye, Pencil, Plus, Search, Upload } from "lucide-react";
import { EmptyState } from "@/components/layouts/EmptyState";
import { LoadingState } from "@/components/layouts/LoadingState";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Field, Select, TextInput } from "@/components/ui/Input";
import { Table, type Column } from "@/components/ui/Table";
import { useToast } from "@/components/ui/toastContext";
import {
  PROSPECT_SOURCE_LABELS,
  PROSPECT_SOURCES,
  PROSPECT_STATUSES,
  PROSPECT_STATUS_LABELS,
  type CommercialProspect,
  type ProspectFormValues,
} from "@/spaces/admin/types/agentCommercial.types";
import {
  archiveProspect,
  createProspectManual,
  listProspects,
  restoreProspect,
  saveProspectEdit,
} from "@/spaces/admin/services/agentCommercial/prospects.service";
import { ProspectFormModal } from "./ProspectFormModal";
import { ProspectStatusBadge } from "./ProspectStatusBadge";
import { emptyProspectForm, formatDate, prospectContactName, prospectToForm } from "./prospectFormat";

type Scope = "active" | "archived";
type ModalState =
  | { mode: "create" }
  | { mode: "edit"; prospect: CommercialProspect }
  | null;

const PROSPECTS_ROUTE = "/admin/agent-commercial/prospects";

export function AgentCommercialProspectsPage() {
  const navigate = useNavigate();
  const toast = useToast();

  const [prospects, setProspects] = useState<CommercialProspect[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [scope, setScope] = useState<Scope>("active");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [deptFilter, setDeptFilter] = useState("");
  const [zoneFilter, setZoneFilter] = useState("");

  const [modal, setModal] = useState<ModalState>(null);
  const [archiveTarget, setArchiveTarget] = useState<CommercialProspect | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setProspects(await listProspects({ scope }));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const departments = useMemo(
    () =>
      Array.from(new Set(prospects.map((p) => p.department).filter((d): d is string => !!d))).sort(
        (a, b) => a.localeCompare(b, "fr"),
      ),
    [prospects],
  );
  const zones = useMemo(
    () =>
      Array.from(new Set(prospects.map((p) => p.zone).filter((z): z is string => !!z))).sort((a, b) =>
        a.localeCompare(b, "fr"),
      ),
    [prospects],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return prospects.filter((p) => {
      if (statusFilter && p.status !== statusFilter) return false;
      if (sourceFilter && p.source !== sourceFilter) return false;
      if (deptFilter && p.department !== deptFilter) return false;
      if (zoneFilter && p.zone !== zoneFilter) return false;
      if (!q) return true;
      const haystack = [
        p.company_name,
        p.first_name,
        p.last_name,
        p.email,
        p.city,
        p.job_title,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [prospects, search, statusFilter, sourceFilter, deptFilter, zoneFilter]);

  const isArchived = scope === "archived";

  async function handleCreate(values: ProspectFormValues) {
    await createProspectManual(values);
    setModal(null);
    toast.success("Prospect créé.");
    await loadData();
  }

  async function handleEdit(prospect: CommercialProspect, values: ProspectFormValues) {
    await saveProspectEdit(prospect, values);
    setModal(null);
    toast.success("Prospect mis à jour.");
    await loadData();
  }

  async function confirmArchiveOrRestore() {
    if (!archiveTarget) return;
    setActionBusy(true);
    try {
      if (isArchived) {
        await restoreProspect(archiveTarget.id);
        toast.success("Prospect restauré.");
      } else {
        await archiveProspect(archiveTarget.id);
        toast.success("Prospect archivé.");
      }
      setArchiveTarget(null);
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action impossible.");
    } finally {
      setActionBusy(false);
    }
  }

  const columns: Column<CommercialProspect>[] = [
    {
      key: "company_name",
      header: "Raison sociale",
      sortable: true,
      sortValue: (p) => p.company_name.toLowerCase(),
      render: (p) => (
        <div>
          <div className="font-medium text-slate-900">{p.company_name}</div>
          <div className="text-xs text-slate-500">{prospectContactName(p)}</div>
        </div>
      ),
    },
    {
      key: "contact",
      header: "Contact",
      render: (p) => (
        <div className="text-xs">
          <div className="text-slate-700">{p.email ?? "—"}</div>
          <div className="text-slate-400">{p.phone ?? ""}</div>
        </div>
      ),
    },
    {
      key: "city",
      header: "Ville / Dép.",
      sortable: true,
      sortValue: (p) => (p.city ?? "").toLowerCase(),
      render: (p) => (
        <span className="text-slate-600">
          {p.city ?? "—"}
          {p.department ? ` (${p.department})` : ""}
        </span>
      ),
    },
    {
      key: "status",
      header: "Statut",
      sortable: true,
      sortValue: (p) => PROSPECT_STATUS_LABELS[p.status],
      render: (p) => <ProspectStatusBadge status={p.status} />,
    },
    {
      key: "score",
      header: "Score",
      align: "right",
      sortable: true,
      sortValue: (p) => p.score,
      render: (p) => <span className="tabular-nums text-slate-600">{p.score ?? "—"}</span>,
    },
    {
      key: "next_action_at",
      header: "Prochaine action",
      sortable: true,
      sortValue: (p) => p.next_action_at,
      render: (p) => <span className="text-slate-600">{formatDate(p.next_action_at)}</span>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (p) => (
        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            title="Ouvrir la fiche"
            onClick={() => navigate(`${PROSPECTS_ROUTE}/${p.id}`)}
            className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
          >
            <Eye className="h-4 w-4" />
          </button>
          {!isArchived && (
            <button
              type="button"
              title="Modifier"
              onClick={() => setModal({ mode: "edit", prospect: p })}
              className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
            >
              <Pencil className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            title={isArchived ? "Restaurer" : "Archiver"}
            onClick={() => setArchiveTarget(p)}
            className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
          >
            {isArchived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      {/* Barre d'actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-2xl border border-slate-200 bg-white p-1">
          <button
            type="button"
            onClick={() => setScope("active")}
            className={[
              "rounded-xl px-3 py-1.5 text-sm font-medium transition",
              scope === "active" ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-50",
            ].join(" ")}
          >
            Actifs
          </button>
          <button
            type="button"
            onClick={() => setScope("archived")}
            className={[
              "rounded-xl px-3 py-1.5 text-sm font-medium transition",
              scope === "archived" ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-50",
            ].join(" ")}
          >
            Archivés
          </button>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="secondary" leftIcon={<Upload className="h-4 w-4" />} onClick={() => navigate(`${PROSPECTS_ROUTE}/import`)}>
            Importer CSV
          </Button>
          <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setModal({ mode: "create" })}>
            Nouveau prospect
          </Button>
        </div>
      </div>

      {/* Filtres */}
      <div className="grid grid-cols-1 gap-3 rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-5">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <TextInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher…"
            className="pl-9"
          />
        </div>
        <Field htmlFor="f-status">
          <Select id="f-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">Tous les statuts</option>
            {PROSPECT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PROSPECT_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field htmlFor="f-source">
          <Select id="f-source" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
            <option value="">Toutes les sources</option>
            {PROSPECT_SOURCES.map((s) => (
              <option key={s} value={s}>
                {PROSPECT_SOURCE_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field htmlFor="f-dept">
          <Select id="f-dept" value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
            <option value="">Tous les départements</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </Field>
        <Field htmlFor="f-zone">
          <Select id="f-zone" value={zoneFilter} onChange={(e) => setZoneFilter(e.target.value)}>
            <option value="">Toutes les zones</option>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {/* Contenu */}
      {loading ? (
        <div className="rounded-[28px] border border-slate-200 bg-white shadow-sm">
          <LoadingState text="Chargement des prospects…" />
        </div>
      ) : loadError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {loadError}
        </div>
      ) : (
        <Table
          columns={columns}
          rows={filtered}
          rowKey={(p) => p.id}
          pageSize={12}
          initialSort={{ key: "company_name", dir: "asc" }}
          onRowClick={(p) => navigate(`${PROSPECTS_ROUTE}/${p.id}`)}
          emptyState={
            prospects.length === 0 ? (
              <EmptyState
                icon={<Plus className="h-8 w-8 text-slate-400" />}
                title={isArchived ? "Aucun prospect archivé" : "Aucun prospect pour le moment"}
                description={
                  isArchived
                    ? "Les prospects archivés apparaîtront ici."
                    : "Ajoutez votre premier marchand de biens ou importez un fichier CSV."
                }
              />
            ) : (
              <EmptyState
                icon={<Search className="h-8 w-8 text-slate-400" />}
                title="Aucun résultat"
                description="Aucun prospect ne correspond à ces filtres."
              />
            )
          }
        />
      )}

      {/* Modale création / édition */}
      {modal?.mode === "create" && (
        <ProspectFormModal
          mode="create"
          initial={emptyProspectForm()}
          onClose={() => setModal(null)}
          onSubmit={handleCreate}
        />
      )}
      {modal?.mode === "edit" && (
        <ProspectFormModal
          mode="edit"
          initial={prospectToForm(modal.prospect)}
          onClose={() => setModal(null)}
          onSubmit={(values) => handleEdit(modal.prospect, values)}
        />
      )}

      {/* Confirmation archivage / restauration */}
      <ConfirmDialog
        open={archiveTarget !== null}
        title={isArchived ? "Restaurer ce prospect ?" : "Archiver ce prospect ?"}
        message={
          isArchived
            ? `« ${archiveTarget?.company_name} » redeviendra actif et réapparaîtra dans la liste.`
            : `« ${archiveTarget?.company_name} » sera masqué des listes. Aucune donnée n'est supprimée — l'action est réversible.`
        }
        confirmLabel={isArchived ? "Restaurer" : "Archiver"}
        danger={!isArchived}
        loading={actionBusy}
        onConfirm={confirmArchiveOrRestore}
        onCancel={() => setArchiveTarget(null)}
      />
    </div>
  );
}
