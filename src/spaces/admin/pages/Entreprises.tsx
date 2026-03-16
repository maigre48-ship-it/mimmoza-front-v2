import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { StatusBadge } from "../components/StatusBadge";
import type { AdminCompany, CompanyStatus } from "../types/admin.types";
import {
  getAdminCompanies,
  initAdminStorage,
  updateAdminCompanyStatus,
} from "../services/adminStorage";

export default function AdminEntreprisesPage() {
  const [companies, setCompanies] = useState<AdminCompany[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      try {
        setLoading(true);
        setError(null);
        await initAdminStorage();
        const data = await getAdminCompanies();
        setCompanies(data);
      } catch (err) {
        console.error("Erreur chargement entreprises admin:", err);
        setError("Impossible de charger les entreprises.");
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, []);

  const refresh = async () => {
    try {
      setError(null);
      const data = await getAdminCompanies();
      setCompanies(data);
    } catch (err) {
      console.error("Erreur refresh entreprises admin:", err);
      setError("Impossible d'actualiser les entreprises.");
    }
  };

  const handleStatusUpdate = async (companyId: string, status: CompanyStatus) => {
    try {
      setActionLoadingId(companyId);
      setError(null);
      await updateAdminCompanyStatus(companyId, status);
      await refresh();
    } catch (err) {
      console.error("Erreur mise à jour statut entreprise:", err);
      setError("Impossible de mettre à jour le statut de l'entreprise.");
    } finally {
      setActionLoadingId(null);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return companies.filter((company) => {
      const matchesQuery =
        !q ||
        [company.name, company.ownerName, company.segment, company.activePlan]
          .join(" ")
          .toLowerCase()
          .includes(q);
      const matchesStatus = statusFilter === "all" || company.status === statusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [companies, query, statusFilter]);

  return (
    <div className="space-y-6">
      <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
          Entreprises
        </h1>
        <p className="mt-3 text-sm leading-7 text-slate-600">
          {"Gestion des comptes B2B, des propriétaires de compte et du MRR HT."}
        </p>

        <div className="mt-5 grid gap-3 lg:grid-cols-[1fr_220px]">
          <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher une entreprise"
              className="w-full border-0 bg-transparent p-0 text-sm text-slate-900 outline-none placeholder:text-slate-400"
              disabled={loading}
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none"
            disabled={loading}
          >
            <option value="all">Tous les statuts</option>
            <option value="prospect">Prospect</option>
            <option value="client">Client</option>
            <option value="inactif">Inactif</option>
          </select>
        </div>

        {error && (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>

      <div className="grid gap-5">
        {loading ? (
          <div className="rounded-[28px] border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
            {"Chargement des entreprises..."}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-[28px] border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
            {"Aucune entreprise trouvée."}
          </div>
        ) : (
          filtered.map((company) => {
            const isBusy = actionLoadingId === company.id;
            return (
              <div
                key={company.id}
                className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="text-xl font-semibold text-slate-950">
                      {company.name}
                    </div>
                    <div className="mt-1 text-sm text-slate-500">
                      {"Responsable : "}{company.ownerName}
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <StatusBadge
                        label={company.segment}
                        tone={
                          company.segment === "promoteur"
                            ? "violet"
                            : company.segment === "financeur"
                              ? "amber"
                              : "sky"
                        }
                      />
                      <StatusBadge
                        label={company.status}
                        tone={
                          company.status === "client"
                            ? "emerald"
                            : company.status === "prospect"
                              ? "amber"
                              : "rose"
                        }
                      />
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="text-xs uppercase tracking-[0.14em] text-slate-400">
                        Utilisateurs
                      </div>
                      <div className="mt-1 text-lg font-semibold text-slate-950">
                        {company.usersCount}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="text-xs uppercase tracking-[0.14em] text-slate-400">
                        Plan
                      </div>
                      <div className="mt-1 text-lg font-semibold text-slate-950">
                        {company.activePlan}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="text-xs uppercase tracking-[0.14em] text-slate-400">
                        MRR HT
                      </div>
                      <div className="mt-1 text-lg font-semibold text-slate-950">
                        {company.mrrHt.toFixed(2)}€
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => {
                      void handleStatusUpdate(company.id, "prospect" as CompanyStatus);
                    }}
                    disabled={isBusy}
                  >
                    Prospect
                  </button>
                  <button
                    type="button"
                    className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => {
                      void handleStatusUpdate(company.id, "client" as CompanyStatus);
                    }}
                    disabled={isBusy}
                  >
                    Client
                  </button>
                  <button
                    type="button"
                    className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => {
                      void handleStatusUpdate(company.id, "inactif" as CompanyStatus);
                    }}
                    disabled={isBusy}
                  >
                    Inactif
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}