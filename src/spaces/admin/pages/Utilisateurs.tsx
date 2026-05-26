// src/spaces/admin/pages/Utilisateurs.tsx
// ─── changelog ────────────────────────────────────────────────────────────────
// • addCreditsToUser : si Supabase échoue (RLS), fallback localStorage sur
//   mimmoza.user pour l'utilisateur courant (cas admin se créditant lui-même).
// ─────────────────────────────────────────────────────────────────────────────

import { Search, RefreshCw, Plus, Ban, CheckCircle, Loader2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { StatusBadge } from "../components/StatusBadge";

type LiveAdminUserRow = {
  userId: string;
  email: string;
  createdAt: string | null;
  isAdmin: boolean;
  adminIsActive: boolean;
  organisationNames: string | null;
  organisationSlugs: string | null;
  planCodes: string | null;
  memberRoles: string | null;
  currentCredits: number;
};

type LoadState = "loading" | "ready" | "error";

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function deriveProfile(user: LiveAdminUserRow): string {
  if (user.isAdmin) return "admin";
  const roles = (user.memberRoles ?? "").toLowerCase();
  const plans = (user.planCodes ?? "").toLowerCase();
  if (roles.includes("finance") || plans.includes("financeur")) return "financeur";
  if (roles.includes("promote") || plans.includes("promoteur")) return "promoteur";
  return "investisseur";
}

function deriveStatus(user: LiveAdminUserRow): string {
  if (user.isAdmin) return user.adminIsActive ? "actif" : "inactif";
  return "actif";
}

function profileTone(profile: string): "sky" | "violet" | "amber" | "slate" {
  if (profile === "investisseur") return "sky";
  if (profile === "promoteur") return "violet";
  if (profile === "financeur") return "amber";
  return "slate";
}

function statusTone(status: string): "emerald" | "amber" | "rose" | "slate" {
  if (status === "actif") return "emerald";
  if (status === "essai") return "amber";
  if (status === "suspendu" || status === "inactif") return "rose";
  return "slate";
}

// ── Fallback localStorage ─────────────────────────────────────────────────────
// Utilisé quand Supabase RLS bloque l'écriture sur credit_accounts.
// Écrit directement dans mimmoza.user si l'email cible correspond à l'utilisateur connecté.

function addCreditsLocalStorage(targetEmail: string, amount: number): boolean {
  try {
    const raw = localStorage.getItem("mimmoza.user");
    if (!raw) return false;
    const user = JSON.parse(raw) as {
      email?: string;
      tokens?: number;
      [key: string]: unknown;
    };
    // On ne touche que si l'email correspond
    if ((user.email ?? "").toLowerCase() !== targetEmail.toLowerCase()) return false;
    const current = typeof user.tokens === "number" ? user.tokens : 0;
    localStorage.setItem(
      "mimmoza.user",
      JSON.stringify({ ...user, tokens: current + amount })
    );
    return true;
  } catch {
    return false;
  }
}

function readLocalCredits(targetEmail: string): number {
  try {
    const raw = localStorage.getItem("mimmoza.user");
    if (!raw) return 0;
    const user = JSON.parse(raw) as { email?: string; tokens?: number };
    if ((user.email ?? "").toLowerCase() !== targetEmail.toLowerCase()) return 0;
    return typeof user.tokens === "number" ? user.tokens : 0;
  } catch {
    return 0;
  }
}

// ── Services Supabase ─────────────────────────────────────────────────────────

async function addCreditsToUser(
  userId: string,
  userEmail: string,
  amount: number
): Promise<{ source: "supabase" | "localStorage" }> {
  // ── Tentative Supabase ────────────────────────────────────────────────────
  try {
    const { data: existing, error: fetchError } = await supabase
      .from("credit_accounts")
      .select("id, current_credits")
      .eq("user_id", userId)
      .maybeSingle();

    if (fetchError) throw new Error(fetchError.message);

    if (existing) {
      const { error } = await supabase
        .from("credit_accounts")
        .update({ current_credits: existing.current_credits + amount })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase
        .from("credit_accounts")
        .insert({ user_id: userId, current_credits: amount });
      if (error) throw new Error(error.message);
    }

    // Transaction log (non bloquant — on ignore l'erreur si RLS bloque aussi cette table)
    await supabase.from("credit_transactions").insert({
      user_id:     userId,
      amount:      amount,
      type:        "admin_grant",
      description: "Attribution manuelle admin",
    });

    return { source: "supabase" };

  } catch (supabaseError) {
    // ── Fallback localStorage ─────────────────────────────────────────────
    // Supabase a échoué (typiquement RLS en mode proto local).
    // On écrit dans localStorage si l'email cible correspond à l'utilisateur connecté.
    console.warn(
      "[addCreditsToUser] Supabase échoué, fallback localStorage :",
      (supabaseError as Error).message
    );

    const ok = addCreditsLocalStorage(userEmail, amount);
    if (ok) return { source: "localStorage" };

    // Si même le fallback échoue (email différent, utilisateur non connecté…), on propage
    throw supabaseError;
  }
}

async function toggleUserBlock(userId: string, currentlyActive: boolean): Promise<void> {
  const { error } = await supabase
    .from("admin_users")
    .update({ is_active: !currentlyActive })
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

// ── Modal ajout jetons ────────────────────────────────────────────────────────

interface AddCreditsModalProps {
  user: LiveAdminUserRow;
  onClose: () => void;
  onSuccess: (userId: string, added: number, source: "supabase" | "localStorage") => void;
}

function AddCreditsModal({ user, onClose, onSuccess }: AddCreditsModalProps) {
  const [amount, setAmount] = useState("10");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Affiche le solde localStorage si disponible (proto)
  const localCredits = readLocalCredits(user.email);
  const displayCredits = localCredits > 0 ? localCredits : user.currentCredits;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = parseInt(amount, 10);
    if (!n || n <= 0) { setError("Montant invalide."); return; }
    setLoading(true);
    setError(null);
    try {
      const { source } = await addCreditsToUser(user.userId, user.email, n);
      onSuccess(user.userId, n, source);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-[24px] border border-slate-200 bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-950">
              Ajouter des jetons
            </h2>
            <p className="mt-1 text-sm text-slate-500">{user.email}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="text-xs text-slate-400">Solde actuel</div>
          <div className="mt-1 text-2xl font-semibold text-slate-950">
            {displayCredits}
            <span className="ml-1 text-sm font-normal text-slate-400">jetons</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">
              Nombre de jetons à ajouter
            </label>
            <input
              type="number"
              min="1"
              step="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
              autoFocus
            />
          </div>

          <div className="flex gap-2">
            {[5, 10, 20, 50].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setAmount(String(n))}
                className={`flex-1 rounded-xl border py-1.5 text-xs font-medium transition-colors ${
                  amount === String(n)
                    ? "border-slate-950 bg-slate-950 text-white"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                +{n}
              </button>
            ))}
          </div>

          {parseInt(amount, 10) > 0 && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm">
              <span className="text-emerald-700">
                Nouveau solde :{" "}
                <strong>{displayCredits + (parseInt(amount, 10) || 0)}</strong>
                {" jetons"}
              </span>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-2xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-slate-950 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60 transition-colors"
            >
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Ajouter
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Modal confirmation blocage ────────────────────────────────────────────────

interface ConfirmBlockModalProps {
  user: LiveAdminUserRow;
  isBlocking: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

function ConfirmBlockModal({ user, isBlocking, onClose, onConfirm }: ConfirmBlockModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setLoading(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-[24px] border border-slate-200 bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between">
          <h2 className="text-base font-semibold text-slate-950">
            {isBlocking ? "Bloquer le compte" : "Débloquer le compte"}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-3 text-sm leading-6 text-slate-600">
          {isBlocking
            ? `Voulez-vous bloquer le compte de ${user.email} ?`
            : `Voulez-vous débloquer le compte de ${user.email} ?`}
        </p>

        {error && (
          <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
            {error}
          </div>
        )}

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-2xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={loading}
            className={`flex flex-1 items-center justify-center gap-2 rounded-2xl py-2.5 text-sm font-medium text-white disabled:opacity-60 transition-colors ${
              isBlocking ? "bg-rose-600 hover:bg-rose-700" : "bg-emerald-600 hover:bg-emerald-700"
            }`}
          >
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isBlocking ? "Bloquer" : "Débloquer"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page principale ───────────────────────────────────────────────────────────

export default function AdminUtilisateursPage() {
  const [query, setQuery]             = useState("");
  const [roleFilter, setRoleFilter]   = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [state, setState]             = useState<LoadState>("loading");
  const [users, setUsers]             = useState<LiveAdminUserRow[]>([]);

  const [creditsTarget, setCreditsTarget] = useState<LiveAdminUserRow | null>(null);
  const [blockTarget, setBlockTarget]     = useState<LiveAdminUserRow | null>(null);

  async function loadUsers(): Promise<void> {
    setState("loading");
    try {
      const { data, error } = await supabase.rpc("admin_users_list");
      if (error) throw new Error(error.message);
      const rows = ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        userId:             String(row.user_id ?? ""),
        email:              String(row.email ?? "—"),
        createdAt:          typeof row.created_at === "string" ? row.created_at : null,
        isAdmin:            row.is_admin === true,
        adminIsActive:      row.admin_is_active === true,
        organisationNames:  typeof row.organisation_names === "string" ? row.organisation_names : null,
        organisationSlugs:  typeof row.organisation_slugs === "string" ? row.organisation_slugs : null,
        planCodes:          typeof row.plan_codes === "string" ? row.plan_codes : null,
        memberRoles:        typeof row.member_roles === "string" ? row.member_roles : null,
        currentCredits:     typeof row.current_credits === "number"
          ? row.current_credits
          : Number(row.current_credits ?? 0),
      }));
      setUsers(rows);
      setState("ready");
    } catch (error) {
      console.error("[AdminUtilisateursPage] load failed:", error);
      setUsers([]);
      setState("error");
    }
  }

  useEffect(() => { void loadUsers(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((user) => {
      const profile = deriveProfile(user);
      const status  = deriveStatus(user);
      const haystack = [
        user.email, user.userId,
        user.organisationNames ?? "", user.organisationSlugs ?? "",
        user.planCodes ?? "", user.memberRoles ?? "",
        profile, status,
      ].join(" ").toLowerCase();
      return (
        (!q || haystack.includes(q)) &&
        (roleFilter === "all" || profile === roleFilter) &&
        (statusFilter === "all" || status === statusFilter)
      );
    });
  }, [query, roleFilter, statusFilter, users]);

  const handleCreditsSuccess = (
    userId: string,
    added: number,
    source: "supabase" | "localStorage"
  ) => {
    // Met à jour le state UI dans tous les cas
    setUsers((prev) =>
      prev.map((u) =>
        u.userId === userId ? { ...u, currentCredits: u.currentCredits + added } : u
      )
    );
    if (source === "localStorage") {
      console.info(
        `[Credits] +${added} jetons écrits dans localStorage (Supabase RLS indisponible)`
      );
    }
  };

  const handleBlockConfirm = async (user: LiveAdminUserRow) => {
    await toggleUserBlock(user.userId, user.adminIsActive);
    setUsers((prev) =>
      prev.map((u) =>
        u.userId === user.userId ? { ...u, adminIsActive: !u.adminIsActive } : u
      )
    );
  };

  return (
    <>
      <div className="space-y-6">
        {/* ── Header ── */}
        <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
                Utilisateurs
              </h1>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                Vue live consolidée des utilisateurs Mimmoza : comptes auth,
                organisations, plans, rôles et crédits.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadUsers()}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              <RefreshCw className="h-4 w-4" />
              Actualiser
            </button>
          </div>

          <div className="mt-5 grid gap-3 lg:grid-cols-[1fr_180px_180px]">
            <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Rechercher un utilisateur"
                className="w-full border-0 bg-transparent p-0 text-sm text-slate-900 outline-none placeholder:text-slate-400"
              />
            </div>
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none"
            >
              <option value="all">Tous les profils</option>
              <option value="investisseur">Investisseur</option>
              <option value="promoteur">Promoteur</option>
              <option value="financeur">Financeur</option>
              <option value="admin">Admin</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none"
            >
              <option value="all">Tous les statuts</option>
              <option value="actif">Actif</option>
              <option value="inactif">Inactif</option>
            </select>
          </div>
        </div>

        {state === "error" && (
          <div className="rounded-[28px] border border-amber-200 bg-amber-50 p-6 shadow-sm">
            <div className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-700">
              Supabase indisponible — mode local
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              La RPC <code className="rounded bg-amber-100 px-1">admin_users_list</code> est
              inaccessible. Le tableau est vide mais les actions (jetons) fonctionnent
              via localStorage.
            </p>
          </div>
        )}

        {/* ── Tableau ── */}
        <div className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-5 py-4 font-medium">Utilisateur</th>
                  <th className="px-5 py-4 font-medium">Profil</th>
                  <th className="px-5 py-4 font-medium">Plan</th>
                  <th className="px-5 py-4 font-medium">Jetons</th>
                  <th className="px-5 py-4 font-medium">Statut</th>
                  <th className="px-5 py-4 font-medium">Créé le</th>
                  <th className="px-5 py-4 font-medium">Organisation</th>
                  <th className="px-5 py-4 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {state === "loading" && (
                  <tr>
                    <td colSpan={8} className="px-5 py-10 text-center text-slate-500">
                      Chargement…
                    </td>
                  </tr>
                )}

                {state !== "loading" &&
                  filtered.map((user) => {
                    const profile   = deriveProfile(user);
                    const status    = deriveStatus(user);
                    const isBlocked = user.isAdmin && !user.adminIsActive;
                    // Affiche les crédits localStorage si disponibles
                    const localC    = readLocalCredits(user.email);
                    const credits   = localC > 0 ? localC : user.currentCredits;

                    return (
                      <tr
                        key={user.userId}
                        className={`border-t border-slate-100 align-middle transition-colors hover:bg-slate-50/60 ${
                          isBlocked ? "opacity-60" : ""
                        }`}
                      >
                        <td className="px-5 py-4">
                          <div className="font-medium text-slate-900">{user.email}</div>
                          <div className="mt-0.5 text-xs text-slate-400">{user.userId}</div>
                        </td>
                        <td className="px-5 py-4">
                          <StatusBadge label={profile} tone={profileTone(profile)} />
                        </td>
                        <td className="px-5 py-4">
                          <div className="text-slate-900">{user.planCodes ?? "—"}</div>
                          {user.memberRoles && (
                            <div className="mt-1 text-xs text-slate-400">{user.memberRoles}</div>
                          )}
                        </td>
                        <td className="px-5 py-4">
                          <div className="font-medium text-slate-900">{credits}</div>
                        </td>
                        <td className="px-5 py-4">
                          <StatusBadge label={status} tone={statusTone(status)} />
                        </td>
                        <td className="px-5 py-4 text-slate-500">
                          {formatDate(user.createdAt)}
                        </td>
                        <td className="px-5 py-4">
                          <div className="text-slate-900">{user.organisationNames ?? "—"}</div>
                          {user.organisationSlugs && (
                            <div className="mt-1 text-xs text-slate-400">
                              {user.organisationSlugs}
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setCreditsTarget(user)}
                              title="Ajouter des jetons"
                              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                            >
                              <Plus className="h-3.5 w-3.5 text-slate-500" />
                              Jetons
                            </button>

                            {user.isAdmin && (
                              user.adminIsActive ? (
                                <button
                                  type="button"
                                  onClick={() => setBlockTarget(user)}
                                  className="flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100 transition-colors"
                                >
                                  <Ban className="h-3.5 w-3.5" />
                                  Bloquer
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setBlockTarget(user)}
                                  className="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 transition-colors"
                                >
                                  <CheckCircle className="h-3.5 w-3.5" />
                                  Débloquer
                                </button>
                              )
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                {state !== "loading" && filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-5 py-10 text-center text-slate-500">
                      Aucun utilisateur trouvé.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {creditsTarget && (
        <AddCreditsModal
          user={creditsTarget}
          onClose={() => setCreditsTarget(null)}
          onSuccess={handleCreditsSuccess}
        />
      )}

      {blockTarget && (
        <ConfirmBlockModal
          user={blockTarget}
          isBlocking={blockTarget.adminIsActive}
          onClose={() => setBlockTarget(null)}
          onConfirm={() => handleBlockConfirm(blockTarget)}
        />
      )}
    </>
  );
}