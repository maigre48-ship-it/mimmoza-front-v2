import { useCallback, useEffect, useState } from "react";
import { ImageIcon, Megaphone, Sparkles } from "lucide-react";
import {
  approveCampaign, archiveCampaign, generateCampaign, generateCampaignVisual,
  getCampaignVisualUrl, listCampaigns, saveCampaignDraft,
  type CampaignAudience, type CommunicationCampaign,
} from "@/spaces/admin/services/agentCommercial/campaigns.service";

const AUDIENCES: Record<CampaignAudience, string> = {
  clients: "Clients", prospects: "Prospects", tous: "Clients et prospects",
};

const fieldClass = "w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 focus:border-slate-500 focus:outline-none";
const buttonClass = "rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50";

export function AgentCommercialCampaignsPage() {
  const [campaigns, setCampaigns] = useState<CommunicationCampaign[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [audience, setAudience] = useState<CampaignAudience>("clients");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [visualUrl, setVisualUrl] = useState<string | null>(null);
  const [visualLoading, setVisualLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setCampaigns(await listCampaigns()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Chargement impossible."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selected = campaigns.find((campaign) => campaign.id === selectedId) ?? null;

  useEffect(() => {
    let active = true;
    setVisualUrl(null);
    if (!selected?.visual_path) { setVisualLoading(false); return; }
    setVisualLoading(true);
    void getCampaignVisualUrl(selected.visual_path).then((url) => {
      if (active) setVisualUrl(url);
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : "Visuel indisponible.");
    }).finally(() => { if (active) setVisualLoading(false); });
    return () => { active = false; };
  }, [selected?.id, selected?.visual_path]);

  function select(campaign: CommunicationCampaign) {
    setSelectedId(campaign.id);
    setTitle(campaign.title);
    setBrief(campaign.brief);
    setAudience(campaign.audience);
    setSubject(campaign.subject);
    setBody(campaign.body);
    setNotes(campaign.internal_notes);
    setError(null);
    setMessage(null);
  }

  function createNew() {
    setSelectedId(null);
    setTitle(""); setBrief(""); setAudience("clients");
    setSubject(""); setBody(""); setNotes("");
    setError(null); setMessage(null);
  }

  async function run(action: () => Promise<void>) {
    setBusy(true); setError(null); setMessage(null);
    try { await action(); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Opération impossible."); }
    finally { setBusy(false); }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(240px,320px)_1fr]">
      <aside className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-950">Campagnes</h2>
          <button type="button" onClick={createNew} className="text-sm font-medium text-indigo-700 hover:underline">Nouvelle</button>
        </div>
        <p className="mt-2 text-xs leading-5 text-slate-500">Préparez et validez le contenu avant de choisir les destinataires. Aucun envoi automatique.</p>
        {loading ? <p className="mt-5 text-sm text-slate-500">Chargement…</p> : campaigns.length === 0 ? (
          <p className="mt-5 text-sm text-slate-500">Aucune campagne pour le moment.</p>
        ) : (
          <ul className="mt-5 space-y-2">
            {campaigns.map((campaign) => (
              <li key={campaign.id}>
                <button type="button" onClick={() => select(campaign)}
                  className={`w-full rounded-2xl border p-3 text-left ${selectedId === campaign.id ? "border-indigo-400 bg-indigo-50" : "border-slate-200 hover:bg-slate-50"}`}>
                  <span className="block text-sm font-medium text-slate-900">{campaign.title}</span>
                  <span className="mt-1 block text-xs text-slate-500">{AUDIENCES[campaign.audience]} · {campaign.status === "draft" ? "Brouillon" : campaign.status === "approved" ? "Validée" : "Archivée"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <Megaphone className="h-5 w-5 text-indigo-600" />
          <h2 className="text-lg font-semibold text-slate-950">{selected ? "Contenu de la campagne" : "Préparer une campagne"}</h2>
        </div>
        {error && <p role="alert" className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
        {message && <p role="status" className="mt-4 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</p>}
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium text-slate-700">Nom de la campagne
            <input className={`${fieldClass} mt-1`} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} disabled={selected?.status !== "draft" && !!selected} />
          </label>
          <label className="block text-sm font-medium text-slate-700">Public visé
            <select className={`${fieldClass} mt-1`} value={audience} onChange={(event) => setAudience(event.target.value as CampaignAudience)} disabled={!!selected}>
              {Object.entries(AUDIENCES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>
        <label className="mt-4 block text-sm font-medium text-slate-700">Objectif et points à communiquer
          <textarea className={`${fieldClass} mt-1`} rows={5} value={brief} onChange={(event) => setBrief(event.target.value)} maxLength={6000} disabled={!!selected} placeholder="Ex. : présenter une nouvelle fonction aux clients, ton sobre, appel à une démonstration." />
        </label>
        {!selected && (
          <button type="button" disabled={busy || !title.trim() || !brief.trim()} className={`${buttonClass} mt-4 inline-flex items-center gap-2`}
            onClick={() => void run(async () => {
              const created = await generateCampaign({ title: title.trim(), brief: brief.trim(), audience });
              select(created);
              try {
                const withVisual = await generateCampaignVisual(created.id);
                select(withVisual);
                setMessage("Texte et visuel générés. Relisez-les avant validation.");
              } catch (cause) {
                setError(`Brouillon créé, mais le visuel n'a pas pu être généré : ${cause instanceof Error ? cause.message : "réessayez."}`);
              }
            })}>
            <Sparkles className="h-4 w-4" />{busy ? "Génération du texte et du visuel…" : "Générer le brouillon et le visuel"}
          </button>
        )}
        {selected && (
          <div className="mt-6 border-t border-slate-100 pt-6">
            <p className="mb-4 text-xs text-slate-500">Ce brouillon ne sélectionne ni ne contacte automatiquement les destinataires.</p>
            <label className="block text-sm font-medium text-slate-700">Objet du mail
              <input className={`${fieldClass} mt-1`} value={subject} onChange={(event) => setSubject(event.target.value)} disabled={selected.status !== "draft"} />
            </label>
            <label className="mt-4 block text-sm font-medium text-slate-700">Corps du mail
              <textarea className={`${fieldClass} mt-1`} rows={12} value={body} onChange={(event) => setBody(event.target.value)} disabled={selected.status !== "draft"} />
            </label>
            <label className="mt-4 block text-sm font-medium text-slate-700">Notes de vérification internes
              <textarea className={`${fieldClass} mt-1`} rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} disabled={selected.status !== "draft"} />
            </label>
            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <ImageIcon className="h-4 w-4 text-indigo-600" />
                  <h3 className="text-sm font-semibold text-slate-900">Visuel de campagne</h3>
                </div>
                <div className="flex items-center gap-3">
                  {visualUrl && <a href={visualUrl} target="_blank" rel="noreferrer" className="text-sm font-medium text-indigo-700 hover:underline">Ouvrir le visuel</a>}
                  {selected.status === "draft" && <button type="button" disabled={busy} className="text-sm font-medium text-indigo-700 hover:underline disabled:opacity-50"
                    onClick={() => void run(async () => { const updated = await generateCampaignVisual(selected.id); select(updated); setMessage("Visuel régénéré. Vérifiez-le avant validation."); })}>
                    {busy ? "Génération…" : selected.visual_path ? "Régénérer" : "Générer"}
                  </button>}
                </div>
              </div>
              {visualLoading ? <p className="mt-4 text-sm text-slate-500">Chargement du visuel…</p> : visualUrl ? (
                <img src={visualUrl} alt={`Visuel de la campagne ${selected.title}`} className="mt-4 w-full rounded-xl object-cover" />
              ) : <p className="mt-4 text-sm text-slate-500">Aucun visuel disponible pour cette campagne.</p>}
              <p className="mt-3 text-xs text-slate-500">Image créée automatiquement à partir du brief. Vérifiez qu'elle représente bien votre message.</p>
            </div>
            {selected.status === "draft" && (
              <div className="mt-5 flex flex-wrap gap-2">
                <button type="button" className={buttonClass} disabled={busy || !subject.trim() || !body.trim()}
                  onClick={() => void run(async () => { const saved = await saveCampaignDraft(selected.id, { title: title.trim(), subject: subject.trim(), body: body.trim(), internal_notes: notes.trim() }); select(saved); setMessage("Brouillon enregistré."); })}>Enregistrer</button>
                <button type="button" className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-800 disabled:opacity-50" disabled={busy || !subject.trim() || !body.trim()}
                  onClick={() => void run(async () => { await saveCampaignDraft(selected.id, { title: title.trim(), subject: subject.trim(), body: body.trim(), internal_notes: notes.trim() }); const approved = await approveCampaign(selected.id); select(approved); setMessage("Campagne validée. Aucun mail n'a été envoyé."); })}>Valider le contenu</button>
              </div>
            )}
            {selected.status !== "archived" && <button type="button" disabled={busy} className="mt-5 text-xs text-slate-500 underline hover:text-slate-800" onClick={() => void run(async () => { await archiveCampaign(selected.id); createNew(); setMessage("Campagne archivée."); })}>Archiver</button>}
          </div>
        )}
      </section>
    </div>
  );
}
