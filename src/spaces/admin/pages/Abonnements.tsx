import { RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { StatusBadge } from "../components/StatusBadge";

type LiveSubscriptionRow = {
  organisationId: string;
  organisationName: string;
  slug: string | null;
  planCode: string | null;
  membersCount: number;
  createdAt: string | null;
  estimatedMrrHt: number;
};

type LoadState = "loading" | "ready" | "error";

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatEur(value: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function deriveInterval(planCode: string | null): string {
  if (!planCode) return "—";
  if (planCode.includes("enterprise")) return "custom";
  return "month";
}

function deriveQuota(planCode: string | null): string {
  switch (planCode) {
    case "starter": return "50";
    case "pro":     return "200";
    default:        return "—";
  }
}

function deriveStatus(planCode: string | null): string {
  if (!planCode || planCode === "none") return "inactif";
  return "active";
}

function statusTone(status: string): "emerald" | "amber" | "rose" | "slate" {
  if (status === "active") return "emerald";
  if (status === "pending") return "amber";
  if (status === "canceled" || status === "inactif") return "rose";
  return "slate";
}

export default function AdminAbonnementsPage() {
  const [state, setState] = useState<LoadState>("loading");
  const [rows, setRows] = useState<LiveSubscriptionRow[]>([]);

  async function loadRows(): Promise<void> {
    setState("loading");
    try {
      const { data, error } = await supabase.rpc("admin_subscriptions_list");
      if (error) throw new Error(error.message);
      const mapped = ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        organisationId: String(row.organisation_id ?? ""),
        organisationName: String(row.organisation_name ?? "Organisation"),
        slug: typeof row.slug === "string" ? row.slug : null,
        planCode: typeof row.plan_code === "string" ? row.plan_code : null,
        membersCount:
          typeof row.members_count === "number"
            ? row.members_count
            : Number(row.members_count ?? 0),
        createdAt: typeof row.created_at === "string" ? row.created_at : null,
        estimatedMrrHt:
          typeof row.estimated_mrr_ht === "number"
            ? row.estimated_mrr_ht
            : Number(row.estimated_mrr_ht ?? 0),
      }));
      setRows(mapped);
      setState("ready");
    } catch (error) {
      console.error("[AdminAbonnementsPage] load failed:", error);
      setRows([]);
      setState("error");
    }
  }

  useEffect(() => {
    void loadRows();
  }, []);

  const totalMrr = useMemo(
    () => rows.reduce((sum, row) => sum + row.estimatedMrrHt, 0),
    [rows]
  );

  return (
    <div className="space-y-6">
      <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
              Abonnements
            </h1>
            <p className="mt-3 text-sm leading-7 text-slate-600">
              {"Vue live des plans d'organisation basée sur les données Supabase. Le plan courant est déduit de "}
              <code>organisations.plan_code</code>.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadRows()}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            <RefreshCw className="h-4 w-4" />
            Actualiser
          </button>
        </div>
        <div className="mt-5 inline-flex rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-700">
          {"Revenu mensuel estimé :"}
          <span className="ml-2 font-semibold text-slate-950">
            {formatEur(totalMrr)} HT
          </span>
        </div>
      </div>

      {state === "error" && (
        <div className="rounded-[28px] border border-rose-200 bg-white p-6 shadow-sm">
          <div className="text-sm font-semibold uppercase tracking-[0.18em] text-rose-600">
            Erreur de chargement
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {"Impossible de charger la vue live des abonnements. Vérifie la RPC "}
            <code>admin_subscriptions_list</code>.
          </p>
        </div>
      )}

      <div className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-5 py-4 font-medium">Organisation</th>
                <th className="px-5 py-4 font-medium">Plan</th>
                <th className="px-5 py-4 font-medium">Montant HT</th>
                <th className="px-5 py-4 font-medium">Intervalle</th>
                <th className="px-5 py-4 font-medium">Quota</th>
                <th className="px-5 py-4 font-medium">Statut</th>
                <th className="px-5 py-4 font-medium">{"Créée le"}</th>
              </tr>
            </thead>
            <tbody>
              {state === "loading" && (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-slate-500">
                    {"Chargement…"}
                  </td>
                </tr>
              )}
              {state !== "loading" &&
                rows.map((row) => {
                  const status = deriveStatus(row.planCode);
                  return (
                    <tr key={row.organisationId} className="border-t border-slate-100 align-top">
                      <td className="px-5 py-4">
                        <div className="font-medium text-slate-900">
                          {row.organisationName}
                        </div>
                        <div className="text-slate-500">
                          {row.slug ?? "slug indisponible"}
                        </div>
                        <div className="mt-1 text-xs text-slate-400">
                          {row.membersCount}{" membre(s)"}
                        </div>
                      </td>
                      <td className="px-5 py-4 text-slate-900">
                        {row.planCode ?? "—"}
                      </td>
                      <td className="px-5 py-4 text-slate-900">
                        {formatEur(row.estimatedMrrHt)}
                      </td>
                      <td className="px-5 py-4 text-slate-900">
                        {deriveInterval(row.planCode)}
                      </td>
                      <td className="px-5 py-4 text-slate-900">
                        {deriveQuota(row.planCode)}
                      </td>
                      <td className="px-5 py-4">
                        <StatusBadge label={status} tone={statusTone(status)} />
                      </td>
                      <td className="px-5 py-4 text-slate-500">
                        {formatDate(row.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              {state !== "loading" && rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-slate-500">
                    {"Aucun abonnement trouvé."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}