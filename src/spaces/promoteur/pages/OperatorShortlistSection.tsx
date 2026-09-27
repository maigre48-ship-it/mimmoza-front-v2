import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { userStorage } from '@/lib/storage/userScopedStorage';
import { shortlistOperators, type OperatorCandidate } from './operatorShortlist';

type FollowUp = { status: string; note: string; source: string };
const EMPTY: FollowUp = { status: 'non_contacte', note: '', source: '' };

export function OperatorShortlistSection({ candidates, scenarioId, insee, epci, naf, error, examined, total }: {
  candidates: OperatorCandidate[]; scenarioId: string; insee: string; epci: string | null; naf: string | null;
  error: string | null; examined?: number; total?: number;
}) {
  const key = `mimmoza.promoteur.operator-followup.${scenarioId}`;
  const [followUps, setFollowUps] = useState<Record<string, FollowUp>>(() => {
    try {
      const value = JSON.parse(userStorage.getItem(key) ?? '{}');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch { return {}; }
  });
  const patch = (siren: string, field: keyof FollowUp, value: string) => {
    const next = { ...followUps, [siren]: { ...EMPTY, ...followUps[siren], [field]: value } };
    setFollowUps(next);
    userStorage.setItem(key, JSON.stringify(next));
  };
  const leads = naf ? shortlistOperators(candidates, insee, epci, naf) : [];
  return <div className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-7">
    <h3 className="text-lg font-semibold text-slate-900">Exploitants potentiels à qualifier</h3>
    <p className="mt-2 text-sm text-slate-600">Présélection dans le registre officiel des entreprises selon l’activité déclarée et l’implantation. L’ordre reflète ces seuls indices. Il ne mesure ni l’adéquation du format, ni la capacité financière, ni l’intérêt pour le projet. La cible et le programme du dossier devront leur être soumis pour vérifier l’adéquation réelle.</p>
    {examined != null && <p className="mt-2 text-xs text-slate-500">{examined} entreprises examinées{total != null ? ` sur ${total} résultats du registre` : ''} ; la liste n’est pas exhaustive.</p>}
    {error && <p className="mt-3 text-sm text-amber-800">{error}</p>}
    {!leads.length && <p className="mt-4 text-sm text-slate-600">{naf ? 'Aucun interlocuteur présentable avec les données disponibles.' : 'Définir une activité d’exploitation pour rechercher des entreprises.'}</p>}
    {leads.length > 0 && <div className="mt-4 space-y-4">{leads.map(({ candidate, reason, checks }) => {
      const followUp = { ...EMPTY, ...followUps[candidate.siren] };
      return <div key={candidate.siren} className="rounded-2xl border border-slate-200 p-4">
        <a href={candidate.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-indigo-700 underline">{candidate.nom}<ExternalLink size={14} /></a>
        <p className="mt-1 text-xs text-slate-600">SIREN {candidate.siren}{candidate.localSiret ? ` · SIRET local ${candidate.localSiret}` : ''} · {candidate.commune || 'commune inconnue'}</p>
        {candidate.openEstablishments != null && <p className="mt-1 text-xs text-slate-600">{candidate.openEstablishments} établissement{candidate.openEstablishments === 1 ? '' : 's'} ouvert{candidate.openEstablishments === 1 ? '' : 's'} déclaré{candidate.openEstablishments === 1 ? '' : 's'} pour l’entreprise, toutes activités et communes confondues. Ce nombre ne mesure pas sa capacité financière.</p>}
        <p className="mt-2 text-sm text-slate-700">{reason}</p>
        <details className="mt-2 text-xs text-slate-600"><summary className="cursor-pointer font-medium text-indigo-700">Vérifications avant proposition</summary><ul className="mt-2 list-inside list-disc space-y-1">{checks.map((check) => <li key={check}>{check}</li>)}</ul></details>
        <div className="mt-3 grid gap-2 sm:grid-cols-2"><label className="text-xs font-medium text-slate-700">Suivi<select value={followUp.status} onChange={(event) => patch(candidate.siren, 'status', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2 font-normal"><option value="non_contacte">Non contacté</option><option value="contacte">Contacté</option><option value="interet_declare">Intérêt déclaré sur pièce</option><option value="refus">Refus ou format incompatible</option></select></label><label className="text-xs font-medium text-slate-700">Source de la réponse<input value={followUp.source} onChange={(event) => patch(candidate.siren, 'source', event.target.value)} placeholder="Courriel, compte rendu daté…" className="mt-1 w-full rounded-lg border border-slate-300 p-2 font-normal" /></label><label className="text-xs font-medium text-slate-700 sm:col-span-2">Critères et réponse de l’exploitant<textarea value={followUp.note} onChange={(event) => patch(candidate.siren, 'note', event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-slate-300 p-2 font-normal" /></label></div>
        {followUp.status === 'interet_declare' && (!followUp.source.trim() || !followUp.note.trim()) && <p className="mt-2 text-xs text-amber-800">Joindre la source et les conditions écrites avant de retenir cet intérêt dans une décision.</p>}
      </div>;
    })}</div>}
    <p className="mt-4 text-xs text-slate-500">Aucun contact n’est envoyé automatiquement. Les notes de suivi sont conservées dans ce navigateur pour ce scénario et ne constituent pas une lettre d’intention.</p>
  </div>;
}
