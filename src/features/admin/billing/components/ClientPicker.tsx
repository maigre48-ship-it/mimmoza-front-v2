// src/features/admin/billing/components/ClientPicker.tsx
// Recherche et sélection d'un compte client (auth.users) via la RPC admin_users_list.
// Émet l'utilisateur choisi { userId, email, ... } pour renseigner recipient_user_id.

import { Loader2, Search, User, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../../lib/supabase";

export interface ClientOption {
  userId: string;
  email: string;
  planCodes: string | null;
  currentCredits: number;
}

async function fetchClients(): Promise<ClientOption[]> {
  const { data, error } = await supabase.rpc("admin_users_list");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<Record<string, unknown>>)
    .map((r) => ({
      userId: String(r.user_id ?? ""),
      email: String(r.email ?? ""),
      planCodes: typeof r.plan_codes === "string" ? r.plan_codes : null,
      currentCredits:
        typeof r.current_credits === "number"
          ? r.current_credits
          : Number(r.current_credits ?? 0),
    }))
    .filter((c) => c.userId && c.email);
}

export function ClientPicker({
  value,
  onSelect,
  placeholder = "Rechercher un client par email…",
}: {
  value: ClientOption | null;
  onSelect: (c: ClientOption | null) => void;
  placeholder?: string;
}) {
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchClients()
      .then((cs) => { if (active) setClients(cs); })
      .catch((e) => { if (active) setError((e as Error).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients.slice(0, 8);
    return clients.filter((c) => c.email.toLowerCase().includes(q)).slice(0, 8);
  }, [clients, query]);

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <User size={14} className="shrink-0 text-indigo-500" />
          <span className="truncate text-sm font-medium text-indigo-800">{value.email}</span>
          <span className="shrink-0 text-xs text-indigo-400">· {value.currentCredits} jetons</span>
        </div>
        <button
          type="button"
          onClick={() => onSelect(null)}
          className="rounded p-1 text-indigo-400 transition-colors hover:bg-indigo-100"
          title="Retirer"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2">
        <Search size={14} className="text-gray-400" />
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="w-full border-0 bg-transparent p-0 text-sm outline-none placeholder:text-gray-400"
        />
        {loading && <Loader2 size={14} className="animate-spin text-gray-400" />}
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      {open && filtered.length > 0 && (
        <div className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg">
          {filtered.map((c) => (
            <button
              key={c.userId}
              type="button"
              onClick={() => { onSelect(c); setOpen(false); setQuery(""); }}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-indigo-50"
            >
              <span className="truncate text-sm text-gray-800">{c.email}</span>
              <span className="shrink-0 text-xs text-gray-400">{c.currentCredits} jetons</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}