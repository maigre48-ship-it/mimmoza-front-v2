// src/spaces/admin/pages/agentCommercial/PipelinePage.tsx
// Board pipeline : une colonne par statut (13 statuts contraints en base).
// Changement de statut via <select> (pas de drag & drop, aucune dépendance).
// Garde-fou : un prospect en opt-out / liste d'exclusion ne peut pas quitter
// le statut « exclu ». Confirmation avant tout passage à un statut terminal.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, ChevronRight, MapPin } from "lucide-react";
import { LoadingState } from "@/components/layouts/LoadingState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Select } from "@/components/ui/Input";
import { useToast } from "@/components/ui/toastContext";
import {
  PROSPECT_STATUSES,
  PROSPECT_STATUS_LABELS,
  PROSPECT_STATUS_TONES,
  type CommercialProspect,
  type ProspectStatus,
} from "@/spaces/admin/types/agentCommercial.types";
import {
  changeProspectStatus,
  listProspects,
} from "@/spaces/admin/services/agentCommercial/prospects.service";
import { isExcluded } from "@/spaces/admin/services/agentCommercial/exclusionCheck";
import { prospectContactName } from "./prospectFormat";

const PROSPECTS_ROUTE = "/admin/agent-commercial/prospects";

// Statuts terminaux (repliables pour alléger le board).
const TERMINAL_STATUSES: ProspectStatus[] = ["client", "non_interesse", "exclu"];
const isTerminal = (s: ProspectStatus) => TERMINAL_STATUSES.includes(s);

// Pastille de couleur par statut (dérivée du ton du StatusBadge).
const DOT_CLASS: Record<string, string> = {
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  slate: "bg-slate-400",
  sky: "bg-sky-500",
  violet: "bg-violet-500",
};

type PendingTransition = { prospect: CommercialProspect; to: ProspectStatus };

export function AgentCommercialPipelinePage() {
  const navigate = useNavigate();
  const toast = useToast();

  const [prospects, setProspects] = useState<CommercialProspect[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showTerminal, setShowTerminal] = useState(false);
  const [pending, setPending] = useState<PendingTransition | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setProspects(await listProspects({ scope: "active" }));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const byStatus = useMemo(() => {
    const map = new Map<ProspectStatus, CommercialProspect[]>();
    for (const s of PROSPECT_STATUSES) map.set(s, []);
    for (const p of prospects) map.get(p.status)?.push(p);
    return map;
  }, [prospects]);

  const visibleStatuses = useMemo(
    () => PROSPECT_STATUSES.filter((s) => showTerminal || !isTerminal(s)),
    [showTerminal],
  );

  /** Applique effectivement la transition (état optimiste local). */
  const applyTransition = useCallback(
    async (prospect: CommercialProspect, to: ProspectStatus) => {
      setBusy(true);
      try {
        const updated = await changeProspectStatus(prospect, to);
        setProspects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
        toast.success(`Statut mis à jour : ${PROSPECT_STATUS_LABELS[to]}.`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Transition impossible.");
      } finally {
        setBusy(false);
        setPending(null);
      }
    },
    [toast],
  );

  /** Point d'entrée d'une demande de transition (garde-fous + confirmation). */
  async function requestTransition(prospect: CommercialProspect, to: ProspectStatus) {
    if (to === prospect.status) return;

    // Garde-fou : interdiction de quitter « exclu » si opt-out ou liste d'exclusion.
    if (prospect.status === "exclu" && to !== "exclu") {
      if (prospect.opt_out) {
        toast.error("Contact en opt-out : il ne peut pas quitter le statut « Exclu ».");
        return;
      }
      try {
        const match = await isExcluded({ email: prospect.email });
        if (match.excluded) {
          toast.error("Contact dans la liste d'exclusion : il ne peut pas quitter le statut « Exclu ».");
          return;
        }
      } catch {
        toast.error("Vérification d'exclusion impossible. Transition annulée.");
        return;
      }
    }

    // Confirmation avant un statut terminal.
    if (isTerminal(to)) {
      setPending({ prospect, to });
      return;
    }

    await applyTransition(prospect, to);
  }

  if (loading) {
    return (
      <div className="rounded-[28px] border border-slate-200 bg-white shadow-sm">
        <LoadingState text="Chargement du pipeline…" />
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          {prospects.length} prospect(s) actif(s). Changez le statut via le menu de chaque carte.
        </p>
        <button
          type="button"
          onClick={() => setShowTerminal((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
        >
          {showTerminal ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          {showTerminal ? "Masquer les statuts terminaux" : "Afficher les statuts terminaux"}
        </button>
      </div>

      {/* Board à défilement horizontal */}
      <div className="overflow-x-auto pb-2">
        <div className="flex gap-4">
          {visibleStatuses.map((status) => {
            const items = byStatus.get(status) ?? [];
            const dot = DOT_CLASS[PROSPECT_STATUS_TONES[status]] ?? "bg-slate-400";
            return (
              <section
                key={status}
                className="flex w-72 shrink-0 flex-col rounded-[24px] border border-slate-200 bg-slate-50/60"
              >
                <header className="flex items-center justify-between gap-2 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className={["h-2 w-2 rounded-full", dot].join(" ")} />
                    <span className="text-sm font-semibold text-slate-800">
                      {PROSPECT_STATUS_LABELS[status]}
                    </span>
                  </div>
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-500">
                    {items.length}
                  </span>
                </header>

                <div className="flex min-h-[80px] flex-col gap-2 px-3 pb-3">
                  {items.length === 0 ? (
                    <p className="px-1 py-4 text-center text-xs text-slate-400">Aucun prospect.</p>
                  ) : (
                    items.map((p) => (
                      <article
                        key={p.id}
                        onClick={() => navigate(`${PROSPECTS_ROUTE}/${p.id}`)}
                        className="cursor-pointer rounded-2xl border border-slate-200 bg-white p-3 shadow-sm transition hover:border-slate-300 hover:shadow"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="truncate text-sm font-semibold text-slate-900">
                            {p.company_name}
                          </h4>
                          {p.score != null && (
                            <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-slate-600">
                              {p.score}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-xs text-slate-500">
                          {prospectContactName(p)}
                        </p>
                        {(p.city || p.department) && (
                          <p className="mt-1 flex items-center gap-1 truncate text-xs text-slate-500">
                            <MapPin className="h-3 w-3 shrink-0 text-slate-400" />
                            {p.city ?? "—"}
                            {p.department ? ` (${p.department})` : ""}
                          </p>
                        )}
                        {p.next_action && (
                          <p className="mt-1 truncate text-xs text-slate-400">→ {p.next_action}</p>
                        )}

                        <div
                          className="mt-2.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Select
                            aria-label="Changer le statut"
                            value={p.status}
                            disabled={busy}
                            onChange={(e) => void requestTransition(p, e.target.value as ProspectStatus)}
                            className="py-1.5 text-xs"
                          >
                            {PROSPECT_STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {PROSPECT_STATUS_LABELS[s]}
                              </option>
                            ))}
                          </Select>
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      <ConfirmDialog
        open={pending !== null}
        title="Confirmer le statut terminal"
        message={
          pending
            ? `Passer « ${pending.prospect.company_name} » au statut « ${PROSPECT_STATUS_LABELS[pending.to]} » ? Ce statut est terminal.`
            : ""
        }
        confirmLabel="Confirmer"
        danger={pending?.to === "exclu" || pending?.to === "non_interesse"}
        loading={busy}
        onConfirm={() => {
          if (pending) void applyTransition(pending.prospect, pending.to);
        }}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
