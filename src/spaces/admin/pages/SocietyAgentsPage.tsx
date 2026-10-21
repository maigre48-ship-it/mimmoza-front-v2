import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BarChart3, Headphones, HeartHandshake, RefreshCw, Wallet } from "lucide-react";
import {
  createSupportTicket, generateSocietyDraft, generateWeeklyBrief, getSocietySnapshot,
  updateSupportTicket, type AgentDraft, type SocietyClient, type SocietyInvoice,
  type SocietySnapshot, type SocietyTicket, type WeeklyBrief,
} from "@/spaces/admin/services/societyAgents.service";

type Tab = "finance" | "support" | "clients" | "pilotage";
const tabs: Array<{ id: Tab; label: string; icon: typeof Wallet }> = [
  { id: "finance", label: "Compta et trésorerie", icon: Wallet },
  { id: "support", label: "Support client", icon: Headphones },
  { id: "clients", label: "Suivi client", icon: HeartHandshake },
  { id: "pilotage", label: "Pilotage", icon: BarChart3 },
];
const inputClass = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none";
const primaryClass = "rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50";
const secondaryClass = "rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 disabled:opacity-50";
const money = (cents: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100);
const date = (value: string | null) => value ? new Intl.DateTimeFormat("fr-FR").format(new Date(value)) : "Aucune activité récente connue";

function exportFinanceCsv(snapshot: SocietySnapshot) {
  const cell = (value: string | number | null) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const rows: Array<Array<string | number | null>> = [["Source", "Référence", "Client", "Statut", "Date", "Échéance", "Total centimes", "Devise"]];
  snapshot.invoices.forEach((item) => rows.push(["Facture manuelle", item.invoice_number, item.company_name, item.status, item.issue_date, item.due_date, item.amount_ttc_cents, item.currency]));
  snapshot.platform_invoices.forEach((item) => rows.push(["Facture plateforme", item.id, "", item.status, item.created_at.slice(0, 10), "", item.total_cents, item.currency]));
  const blob = new Blob(["\uFEFF", rows.map((row) => row.map(cell).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = `mimmoza-suivi-factures-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click(); URL.revokeObjectURL(url);
}

function DraftEditor({ draft, onChange, onCopy }: {
  draft: AgentDraft; onChange: (draft: AgentDraft) => void; onCopy: () => void;
}) {
  return <div className="mt-5 space-y-3 rounded-2xl border border-indigo-200 bg-indigo-50/40 p-4">
    <p className="text-sm font-semibold text-slate-900">Brouillon à relire</p>
    <label className="block text-sm text-slate-700">Objet
      <input className={`${inputClass} mt-1`} value={draft.subject} onChange={(event) => onChange({ ...draft, subject: event.target.value })} />
    </label>
    <label className="block text-sm text-slate-700">Message
      <textarea className={`${inputClass} mt-1`} rows={9} value={draft.body} onChange={(event) => onChange({ ...draft, body: event.target.value })} />
    </label>
    <label className="block text-sm text-slate-700">Note interne
      <textarea className={`${inputClass} mt-1`} rows={3} value={draft.internal_note} onChange={(event) => onChange({ ...draft, internal_note: event.target.value })} />
    </label>
    <button type="button" className={secondaryClass} onClick={onCopy}>Copier le message</button>
    <p className="text-xs text-slate-500">Aucun message n’est envoyé automatiquement.</p>
  </div>;
}

export default function SocietyAgentsPage() {
  const [tab, setTab] = useState<Tab>("finance");
  const [snapshot, setSnapshot] = useState<SocietySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AgentDraft | null>(null);
  const [draftKey, setDraftKey] = useState<string | null>(null);
  const [brief, setBrief] = useState<WeeklyBrief | null>(null);
  const [requesterName, setRequesterName] = useState("");
  const [requesterEmail, setRequesterEmail] = useState("");
  const [ticketSubject, setTicketSubject] = useState("");
  const [ticketMessage, setTicketMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try { setSnapshot(await getSocietySnapshot()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Chargement impossible."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const today = new Date().toISOString().slice(0, 10);
  const invoices = snapshot?.invoices ?? [];
  const openInvoices = useMemo(() => invoices.filter((item) => !["paid", "cancelled", "draft"].includes(item.status)), [invoices]);
  const overdue = openInvoices.filter((item) => item.due_date < today);
  const dueSoon = openInvoices.filter((item) => item.due_date >= today && item.due_date <= new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
  const outstandingCents = openInvoices.reduce((sum, item) => sum + item.amount_ttc_cents, 0);
  const platformPaidCents = (snapshot?.platform_invoices ?? []).filter((item) => item.status === "paid")
    .reduce((sum, item) => sum + item.total_cents, 0);
  const clients = snapshot?.clients ?? [];
  const clientSignals = clients.filter((client) => {
    const age = Date.now() - new Date(client.created_at).getTime();
    const recentActivity = client.last_activity_at && Date.now() - new Date(client.last_activity_at).getTime() < 14 * 86400000;
    return !recentActivity && age >= 3 * 86400000;
  });
  const tickets = snapshot?.tickets ?? [];
  const selectedInvoice = invoices.find((item) => item.id === invoiceId) ?? null;
  const selectedClient = clients.find((item) => item.id === clientId) ?? null;
  const selectedTicket = tickets.find((item) => item.id === ticketId) ?? null;

  async function run(action: () => Promise<void>, refresh = false) {
    setBusy(true); setError(null); setMessage(null);
    try { await action(); if (refresh) await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Opération impossible."); }
    finally { setBusy(false); }
  }
  function chooseTab(value: Tab) { setTab(value); setDraft(null); setDraftKey(null); setError(null); setMessage(null); }
  function chooseInvoice(item: SocietyInvoice) { setInvoiceId(item.id); setDraft(null); setDraftKey(null); }
  function chooseClient(item: SocietyClient) { setClientId(item.id); setDraft(null); setDraftKey(null); }
  function chooseTicket(item: SocietyTicket) {
    setTicketId(item.id);
    setDraft(item.draft_subject || item.draft_body ? { subject: item.draft_subject, body: item.draft_body, internal_note: item.internal_note } : null);
    setDraftKey(`support:${item.id}`);
  }
  async function copyDraft() {
    if (!draft) return;
    try { await navigator.clipboard.writeText(`Objet : ${draft.subject}\n\n${draft.body}`); setMessage("Message copié."); }
    catch { setError("Copie impossible. Sélectionnez le texte du brouillon."); }
  }

  return <div className="space-y-5">
    <header className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-600">Admin Mimmoza</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-950">Agents de gestion</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">Quatre assistants pour suivre l’activité, préparer les réponses et décider des prochaines actions. Toutes les communications restent à votre validation.</p>
        </div>
        <button type="button" className={`${secondaryClass} inline-flex items-center gap-2`} onClick={() => void load()} disabled={loading || busy}>
          <RefreshCw className="h-4 w-4" />Actualiser
        </button>
      </div>
    </header>

    <nav className="flex flex-wrap gap-2" aria-label="Agents de gestion">
      {tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => chooseTab(id)}
        className={`inline-flex items-center gap-2 rounded-2xl border px-4 py-2.5 text-sm font-medium ${tab === id ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>
        <Icon className="h-4 w-4" />{label}
      </button>)}
    </nav>
    {error && <p role="alert" className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-700">{error}</p>}
    {message && <p role="status" className="rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-700">{message}</p>}
    {loading && !snapshot ? <p className="rounded-2xl bg-white p-6 text-sm text-slate-500">Chargement des données…</p> : null}

    {snapshot && tab === "finance" && <section className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Factures échues" value={String(overdue.length)} detail="Factures manuelles non réglées" />
        <Metric label="À échéance sous 7 jours" value={String(dueSoon.length)} detail="À vérifier avant relance" />
        <Metric label="Montant facturé en attente" value={money(outstandingCents)} detail="Montant des factures manuelles non soldées" />
      </div>
      <p className="text-sm text-slate-600">Paiements plateforme marqués payés sur les 30 derniers jours : <strong>{money(platformPaidCents)}</strong>. Ce chiffre est suivi séparément des factures manuelles pour éviter un double comptage.</p>
      <button type="button" className={secondaryClass} onClick={() => exportFinanceCsv(snapshot)}>Exporter le suivi des factures en CSV</button>
      <div className="grid gap-5 xl:grid-cols-[minmax(260px,360px)_1fr]">
        <Panel title="Factures à suivre">
          {openInvoices.length === 0 ? <Empty text="Aucune facture manuelle à relancer." /> : <div className="space-y-2">
            {[...openInvoices].sort((a, b) => a.due_date.localeCompare(b.due_date)).map((item) =>
              <button key={item.id} type="button" onClick={() => chooseInvoice(item)} className={`w-full rounded-xl border p-3 text-left text-sm ${invoiceId === item.id ? "border-indigo-400 bg-indigo-50" : "border-slate-200 hover:bg-slate-50"}`}>
                <span className="block font-medium text-slate-900">{item.invoice_number} · {item.company_name}</span>
                <span className="mt-1 block text-xs text-slate-500">{money(item.amount_ttc_cents)} · échéance {date(item.due_date)} {item.due_date < today ? "· échue" : ""}</span>
              </button>)}
          </div>}
        </Panel>
        <Panel title="Agent compta et trésorerie">
          {selectedInvoice ? <>
            <p className="text-sm text-slate-700">{selectedInvoice.company_name} · {selectedInvoice.invoice_number} · {money(selectedInvoice.amount_ttc_cents)}</p>
            <p className="mt-1 text-xs text-slate-500">Statut enregistré : {selectedInvoice.status}. L’agent ne vérifie pas le compte bancaire.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className={primaryClass} disabled={busy} onClick={() => void run(async () => {
                const result = await generateSocietyDraft("finance", selectedInvoice.id);
                setDraft(result.draft); setDraftKey(`finance:${selectedInvoice.id}`); setMessage("Relance préparée. Vérifiez le règlement avant utilisation.");
              })}>{busy ? "Préparation…" : "Préparer une relance"}</button>
              <Link to={`/admin/factures?highlight=${selectedInvoice.id}`} className={secondaryClass}>Voir la facture</Link>
            </div>
            {draft && draftKey === `finance:${selectedInvoice.id}` && <DraftEditor draft={draft} onChange={setDraft} onCopy={() => void copyDraft()} />}
          </> : <Empty text="Choisissez une facture pour préparer une relance." />}
        </Panel>
      </div>
    </section>}

    {snapshot && tab === "support" && <section className="grid gap-5 xl:grid-cols-[minmax(280px,380px)_1fr]">
      <Panel title="Demandes support">
        <p className="mb-4 text-xs text-slate-500">Ajoutez ici un mail ou un message reçu. La boîte de réception n’est pas synchronisée.</p>
        <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void run(async () => {
          const created = await createSupportTicket({ requester_name: requesterName, requester_email: requesterEmail, subject: ticketSubject, message: ticketMessage });
          setRequesterName(""); setRequesterEmail(""); setTicketSubject(""); setTicketMessage(""); setTicketId(created.id);
          setMessage("Demande enregistrée. L’agent peut maintenant la traiter.");
        }, true); }}>
          <input className={inputClass} value={requesterName} onChange={(event) => setRequesterName(event.target.value)} placeholder="Nom du demandeur" maxLength={200} />
          <input className={inputClass} type="email" value={requesterEmail} onChange={(event) => setRequesterEmail(event.target.value)} placeholder="Adresse email" maxLength={320} />
          <input className={inputClass} required value={ticketSubject} onChange={(event) => setTicketSubject(event.target.value)} placeholder="Objet de la demande" maxLength={200} />
          <textarea className={inputClass} required rows={4} value={ticketMessage} onChange={(event) => setTicketMessage(event.target.value)} placeholder="Message reçu" maxLength={10000} />
          <button type="submit" className={primaryClass} disabled={busy || !ticketSubject.trim() || !ticketMessage.trim()}>Ajouter la demande</button>
        </form>
        <div className="mt-6 space-y-2 border-t border-slate-100 pt-4">
          {tickets.length === 0 ? <Empty text="Aucune demande support." /> : tickets.map((item) =>
            <button key={item.id} type="button" onClick={() => chooseTicket(item)} className={`w-full rounded-xl border p-3 text-left text-sm ${ticketId === item.id ? "border-indigo-400 bg-indigo-50" : "border-slate-200 hover:bg-slate-50"}`}>
              <span className="block font-medium text-slate-900">{item.subject}</span>
              <span className="mt-1 block text-xs text-slate-500">{item.status === "open" ? "Ouverte" : "Clôturée"} · {item.priority === "urgent" ? "Urgente" : "Normale"} · {date(item.created_at)}</span>
            </button>)}
        </div>
      </Panel>
      <Panel title="Agent support client">
        {selectedTicket ? <>
          <p className="text-sm font-medium text-slate-900">{selectedTicket.subject}</p>
          <p className="mt-1 text-xs text-slate-500">{selectedTicket.requester_name || "Demandeur"} {selectedTicket.requester_email ? `· ${selectedTicket.requester_email}` : ""} · {selectedTicket.category}</p>
          <p className="mt-4 whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-sm text-slate-700">{selectedTicket.message}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className={primaryClass} disabled={busy} onClick={() => void run(async () => {
              const result = await generateSocietyDraft("support", selectedTicket.id);
              setDraft(result.draft); setDraftKey(`support:${selectedTicket.id}`);
              setMessage("Demande analysée et réponse proposée. Relisez-la avant utilisation.");
            }, true)}>{busy ? "Analyse…" : "Analyser et proposer une réponse"}</button>
            <button type="button" className={secondaryClass} disabled={busy} onClick={() => void run(async () => {
              await updateSupportTicket(selectedTicket.id, { status: selectedTicket.status === "open" ? "closed" : "open" });
              setMessage(selectedTicket.status === "open" ? "Demande clôturée." : "Demande rouverte.");
            }, true)}>{selectedTicket.status === "open" ? "Clôturer" : "Rouvrir"}</button>
          </div>
          {draft && draftKey === `support:${selectedTicket.id}` && <>
            <DraftEditor draft={draft} onChange={setDraft} onCopy={() => void copyDraft()} />
            <button type="button" className={`${secondaryClass} mt-3`} disabled={busy} onClick={() => void run(async () => {
              await updateSupportTicket(selectedTicket.id, { draft_subject: draft.subject, draft_body: draft.body, internal_note: draft.internal_note });
              setMessage("Brouillon enregistré.");
            }, true)}>Enregistrer les corrections</button>
          </>}
        </> : <Empty text="Choisissez ou ajoutez une demande pour la traiter." />}
      </Panel>
    </section>}

    {snapshot && tab === "clients" && <section className="grid gap-5 xl:grid-cols-[minmax(280px,380px)_1fr]">
      <Panel title="Clients à suivre">
        <p className="mb-4 text-xs text-slate-500">Signal : aucune activité connue depuis 14 jours, pour les comptes ouverts depuis au moins 3 jours. Les événements connus couvrent les 30 derniers jours.</p>
        {clientSignals.length === 0 ? <Empty text="Aucun client ne correspond à ce signal pour le moment." /> : <div className="space-y-2">
          {clientSignals.map((item) => <button key={item.id} type="button" onClick={() => chooseClient(item)} className={`w-full rounded-xl border p-3 text-left text-sm ${clientId === item.id ? "border-indigo-400 bg-indigo-50" : "border-slate-200 hover:bg-slate-50"}`}>
            <span className="block font-medium text-slate-900">{item.name}</span>
            <span className="mt-1 block text-xs text-slate-500">{item.plan || "Plan non indiqué"} · dernière activité : {date(item.last_activity_at)}</span>
          </button>)}
        </div>}
      </Panel>
      <Panel title="Agent de suivi client">
        {selectedClient ? <>
          <p className="text-sm font-medium text-slate-900">{selectedClient.name}</p>
          <p className="mt-1 text-xs text-slate-500">{selectedClient.email || "Adresse email indisponible"} · compte créé le {date(selectedClient.created_at)}</p>
          <p className="mt-2 text-xs text-slate-500">L’absence d’événement ne prouve pas une absence d’utilisation. Vérifiez la situation avant d’utiliser le message.</p>
          <button type="button" className={`${primaryClass} mt-4`} disabled={busy} onClick={() => void run(async () => {
            const result = await generateSocietyDraft("followup", selectedClient.id);
            setDraft(result.draft); setDraftKey(`followup:${selectedClient.id}`);
            setMessage("Message de suivi préparé. Vérifiez son contexte avant utilisation.");
          })}>{busy ? "Préparation…" : "Préparer un message de suivi"}</button>
          {draft && draftKey === `followup:${selectedClient.id}` && <DraftEditor draft={draft} onChange={setDraft} onCopy={() => void copyDraft()} />}
        </> : <Empty text="Choisissez un client pour préparer un message de suivi." />}
      </Panel>
    </section>}

    {snapshot && tab === "pilotage" && <section className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-4">
        <Metric label="Factures échues" value={String(overdue.length)} detail="Factures manuelles" />
        <Metric label="Demandes ouvertes" value={String(tickets.filter((item) => item.status === "open").length)} detail="File support" />
        <Metric label="Comptes suivis" value={String(clients.length)} detail="Hors votre compte admin" />
        <Metric label="Clients à vérifier" value={String(clientSignals.length)} detail="Selon l’activité connue" />
      </div>
      <Panel title="Agent de pilotage">
        <p className="text-sm text-slate-600">Il synthétise les indicateurs disponibles et propose trois priorités. Les montants facturés et les paiements plateforme restent distincts.</p>
        <button type="button" className={`${primaryClass} mt-4`} disabled={busy} onClick={() => void run(async () => {
          setBrief(await generateWeeklyBrief()); setMessage("Bilan préparé à partir des données disponibles.");
        })}>{busy ? "Analyse…" : "Préparer mon bilan"}</button>
        {brief && <div className="mt-5 rounded-2xl bg-slate-50 p-5">
          <p className="text-xs font-medium text-slate-500">Bilan du {date(brief.metrics.date)}</p>
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">{brief.summary}</p>
          <h3 className="mt-5 text-sm font-semibold text-slate-900">Trois actions prioritaires</h3>
          <ol className="mt-2 list-inside list-decimal space-y-2 text-sm text-slate-700">{brief.actions.map((action, index) => <li key={index}>{action}</li>)}</ol>
        </div>}
      </Panel>
      <p className="text-xs text-slate-500">Les listes sont limitées aux {snapshot.limits.invoices} dernières factures, {snapshot.limits.clients} derniers comptes et {snapshot.limits.tickets} dernières demandes. Les événements d’usage couvrent 30 jours.</p>
    </section>}
  </div>;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm"><h2 className="mb-4 text-base font-semibold text-slate-950">{title}</h2>{children}</div>;
}
function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-medium text-slate-500">{label}</p><p className="mt-2 text-xl font-semibold text-slate-950">{value}</p><p className="mt-1 text-xs text-slate-500">{detail}</p></div>;
}
function Empty({ text }: { text: string }) { return <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">{text}</p>; }
