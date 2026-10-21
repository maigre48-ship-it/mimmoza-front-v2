import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Mail } from "lucide-react";
import { listProspects } from "@/spaces/admin/services/agentCommercial/prospects.service";
import { generateEmail } from "@/spaces/admin/services/agentCommercial/generateEmail";
import type { CommercialProspect } from "@/spaces/admin/types/agentCommercial.types";

export function AgentCommercialRepliesPage() {
  const [prospects, setProspects] = useState<CommercialProspect[]>([]);
  const [prospectId, setProspectId] = useState("");
  const [search, setSearch] = useState("");
  const [incoming, setIncoming] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void listProspects().then(setProspects).catch((cause) => {
      setError(cause instanceof Error ? cause.message : "Chargement des contacts impossible.");
    });
  }, []);
  const visible = useMemo(() => prospects.filter((prospect) =>
    prospect.email && !prospect.opt_out && prospect.status !== "exclu" &&
    `${prospect.company_name} ${prospect.first_name ?? ""} ${prospect.last_name ?? ""} ${prospect.email}`
      .toLowerCase().includes(search.toLowerCase())), [prospects, search]);

  async function handleGenerate() {
    if (!prospectId || !incoming.trim()) return;
    setBusy(true); setError(null); setReady(false);
    try {
      await generateEmail(prospectId, "reponse_question", incoming.trim());
      setReady(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Génération impossible.");
    } finally { setBusy(false); }
  }

  return (
    <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-3"><Mail className="h-5 w-5 text-indigo-600" /><h2 className="text-lg font-semibold text-slate-950">Agent de réponse aux mails</h2></div>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
        Choisissez le contact, collez son mail et générez une réponse personnalisée. La base de connaissances validée et l'historique des messages envoyés sont utilisés. Le brouillon passe ensuite en relecture.
      </p>
      <p className="mt-2 text-xs text-slate-500">La boîte Gmail n'est pas encore synchronisée : le mail reçu doit être collé ici.</p>
      {error && <p role="alert" className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
      {ready && <p role="status" className="mt-4 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Réponse créée. <Link className="font-medium underline" to="../messages">Ouvrir les messages à valider</Link></p>}
      <div className="mt-6 max-w-3xl space-y-4">
        <label className="block text-sm font-medium text-slate-700">Rechercher un contact
          <input value={search} onChange={(event) => setSearch(event.target.value)} className="mt-1 w-full rounded-2xl border border-slate-200 px-4 py-2.5 text-sm" placeholder="Société, nom ou email" />
        </label>
        <label className="block text-sm font-medium text-slate-700">Contact concerné
          <select value={prospectId} onChange={(event) => setProspectId(event.target.value)} className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm">
            <option value="">Sélectionner un contact</option>
            {visible.map((prospect) => <option key={prospect.id} value={prospect.id}>{prospect.company_name} — {prospect.email}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium text-slate-700">Mail reçu
          <textarea value={incoming} onChange={(event) => setIncoming(event.target.value)} maxLength={12000} rows={10} className="mt-1 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm" placeholder="Collez le message reçu, objet et corps compris." />
        </label>
        <button type="button" disabled={busy || !prospectId || !incoming.trim()} onClick={() => void handleGenerate()}
          className="rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? "Rédaction…" : "Rédiger une réponse"}
        </button>
      </div>
    </section>
  );
}
