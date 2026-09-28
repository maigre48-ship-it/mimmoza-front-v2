import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Copy, ExternalLink, Palette, Plus, Sparkles } from 'lucide-react';
import { userStorage } from '@/lib/storage/userScopedStorage';
import { PromoteurPageHero } from '../shared/components/PromoteurPageHero';
import { usePromoteurStudyId } from '../shared/usePromoteurStudyId';
import { usePromoteurStudy } from '../shared/usePromoteurStudy';
import { buildDesignBrief, designBriefText, EDITORIAL_SOURCES, type DesignBrief, type DesignSource, type StyleFamily } from './designDirections';
import type { DecisionRecord } from './decisionDossier';

type Scenario = { id: string; programme: string; parcelId?: string; address?: string; insee?: string };
type Draft = { selectedScenarioId: string; programme: string; target: string; location: string; priority: string; horizonYears: number;
  selectedSourceIds: string[]; customSources: DesignSource[]; brief: DesignBrief | null };
const key = (studyId: string | null) => `mimmoza.promoteur.style-tendances.${studyId ?? 'hors-etude'}`;
const empty = (): Draft => ({ selectedScenarioId: '', programme: '', target: '', location: '', priority: 'Durabilité et entretien simple', horizonYears: 15,
  selectedSourceIds: EDITORIAL_SOURCES.map((source) => source.id), customSources: [], brief: null });
const familyLabel: Record<StyleFamily, string> = { durable: 'Durable', contemporain: 'Contemporain', expressif: 'Expressif' };
const inputClass = 'mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900';

export default function StyleTendancesPage() {
  const studyId = usePromoteurStudyId();
  const { study } = usePromoteurStudy(studyId);
  const [draft, setDraft] = useState<Draft>(empty);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [sourceTitle, setSourceTitle] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceNote, setSourceNote] = useState('');
  const [sourceFamily, setSourceFamily] = useState<StyleFamily>('contemporain');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const sources = useMemo(() => [...EDITORIAL_SOURCES, ...draft.customSources], [draft.customSources]);
  const suffix = studyId ? `?study=${encodeURIComponent(studyId)}` : '';

  useEffect(() => {
    let restored: Draft | null = null;
    try {
      const saved = JSON.parse(userStorage.getItem(key(studyId)) ?? 'null') as Partial<Draft> | null;
      restored = saved && typeof saved === 'object' ? { ...empty(), ...saved,
        customSources: Array.isArray(saved.customSources) ? saved.customSources : [],
        selectedSourceIds: Array.isArray(saved.selectedSourceIds) ? saved.selectedSourceIds : empty().selectedSourceIds } : null;
    } catch { restored = null; }
    try {
      const found = JSON.parse(userStorage.getItem(`mimmoza.promoteur.strategie-projet.${studyId ?? 'hors-etude'}`) ?? '[]') as Scenario[];
      const available = Array.isArray(found) ? found.slice(0, 3) : [];
      setScenarios(available);
      if (!restored && available[0]) {
        let target = '';
        try {
          const decisions = JSON.parse(userStorage.getItem(`mimmoza.promoteur.decision.${studyId ?? 'hors-etude'}`) ?? '{}') as Record<string, DecisionRecord>;
          target = decisions[available[0].id]?.target ?? '';
        } catch { /* cible à préciser */ }
        restored = { ...empty(), selectedScenarioId: available[0].id, programme: available[0].programme,
          target, location: available[0].address || available[0].parcelId || available[0].insee || '' };
      }
    } catch { setScenarios([]); }
    setDraft(restored ?? empty());
  }, [studyId]);

  const patch = (change: Partial<Draft>) => {
    const next = { ...draft, ...change };
    setDraft(next); userStorage.setItem(key(studyId), JSON.stringify(next)); setCopied(false);
  };
  const chooseScenario = (id: string) => {
    const scenario = scenarios.find((item) => item.id === id);
    if (!scenario) { patch({ selectedScenarioId: '' }); return; }
    let target = '';
    try {
      const records = JSON.parse(userStorage.getItem(`mimmoza.promoteur.decision.${studyId ?? 'hors-etude'}`) ?? '{}') as Record<string, DecisionRecord>;
      target = records?.[id]?.target ?? '';
    } catch { /* la cible reste à préciser */ }
    patch({ selectedScenarioId: id, programme: scenario.programme, target: target || draft.target,
      location: scenario.address || scenario.parcelId || scenario.insee || draft.location, brief: null });
  };
  const addSource = () => {
    let url: URL;
    try { url = new URL(sourceUrl.trim()); } catch { setError('Indiquez un lien HTTPS valide.'); return; }
    if (url.protocol !== 'https:' || sourceTitle.trim().length < 3 || sourceNote.trim().length < 15) {
      setError('Renseignez un titre, un lien HTTPS et une observation d’au moins 15 caractères.'); return;
    }
    const source: DesignSource = { id: `user-${crypto.randomUUID()}`, title: sourceTitle.trim().slice(0, 150), url: url.toString().slice(0, 400),
      observation: sourceNote.trim().slice(0, 650), scope: 'Référence ajoutée par le porteur · contenu non vérifié par Mimmoza',
      year: String(new Date().getFullYear()), family: sourceFamily };
    patch({ customSources: [...draft.customSources, source].slice(0, 12), selectedSourceIds: [...draft.selectedSourceIds, source.id], brief: null });
    setSourceTitle(''); setSourceUrl(''); setSourceNote(''); setError('');
  };
  const createBrief = () => {
    if (draft.programme.trim().length < 3 || draft.target.trim().length < 3 || draft.location.trim().length < 2) {
      setError('Précisez le programme, la cible et le lieu avant de créer les pistes.'); return;
    }
    const selected = sources.filter((source) => draft.selectedSourceIds.includes(source.id));
    if (!selected.length) { setError('Choisissez au moins une référence commentée.'); return; }
    patch({ brief: buildDesignBrief({ programme: draft.programme.trim(), target: draft.target.trim(), location: draft.location.trim(),
      priority: draft.priority, horizonYears: draft.horizonYears, sources: selected }) });
    setError('');
  };
  const copyBrief = async () => {
    if (!draft.brief?.selectedFamily) return;
    try { await navigator.clipboard.writeText(designBriefText(draft.brief, sources)); setCopied(true); }
    catch { setError('La copie a échoué. Vérifiez les autorisations du navigateur.'); }
  };

  return <div className="mx-auto max-w-7xl space-y-6 px-4 pb-14 pt-6 sm:px-6">
    <PromoteurPageHero badge="PROMOTEUR · POSITIONNEMENT ESTHÉTIQUE" title="Quel style résistera au temps ?"
      metaLines={[{ icon: <Palette size={16} />, text: study?.title || 'Étude libre ou projet actif' }]}
      statCards={[{ label: 'Directions', value: draft.brief ? '3' : 'À créer' }, { label: 'Horizon', value: `${draft.horizonYears} ans` }]} />

    <section className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-7">
      <p className="text-xs font-bold uppercase tracking-widest text-indigo-600">01 · Cadrer le projet</p>
      <h2 className="mt-1 text-xl font-semibold">Une ambiance pour une cible précise</h2>
      <p className="mt-2 text-sm text-slate-600">Les directions ci-dessous sont des hypothèses de conception. Elles complètent l’étude de marché et devront être testées auprès des utilisateurs et de l’exploitant.</p>
      {scenarios.length > 0 && <label className="mt-5 block text-sm font-medium">Reprendre un scénario de Stratégie de projet
        <select value={draft.selectedScenarioId} onChange={(event) => chooseScenario(event.target.value)} className={inputClass}><option value="">Saisie libre</option>
          {scenarios.map((scenario) => <option value={scenario.id} key={scenario.id}>{scenario.programme} · {scenario.address || scenario.parcelId || scenario.insee || 'terrain à préciser'}</option>)}</select></label>}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="text-sm font-medium">Programme<input value={draft.programme} onChange={(event) => patch({ programme: event.target.value, selectedScenarioId: '', brief: null })} placeholder="Hôtel, EHPAD, logements…" className={inputClass} /></label>
        <label className="text-sm font-medium">Cible à tester<input value={draft.target} onChange={(event) => patch({ target: event.target.value, brief: null })} placeholder="Clientèle, résidents, utilisateurs…" className={inputClass} /></label>
        <label className="text-sm font-medium">Lieu ou parcelle<input value={draft.location} onChange={(event) => patch({ location: event.target.value, brief: null })} placeholder="Commune, adresse ou référence cadastrale" className={inputClass} /></label>
        <label className="text-sm font-medium">Horizon de conception<select value={draft.horizonYears} onChange={(event) => patch({ horizonYears: Number(event.target.value), brief: null })} className={inputClass}><option value={10}>10 ans</option><option value={15}>15 ans</option><option value={20}>20 ans</option><option value={30}>30 ans</option></select></label>
        <label className="text-sm font-medium md:col-span-2">Priorité du projet<select value={draft.priority} onChange={(event) => patch({ priority: event.target.value, brief: null })} className={inputClass}><option>Durabilité et entretien simple</option><option>Confort et accessibilité</option><option>Identité forte et différenciation</option><option>Souplesse d’usage et évolution future</option></select></label>
      </div>
      {study?.plu?.zone_code && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">Zone PLU relevée : {study.plu.zone_code}. Les couleurs, matériaux, façades, enseignes et destinations restent à vérifier dans les règles opposables.</p>}
      <Link to={`/promoteur/strategie-projet${suffix}`} className="mt-4 inline-block text-sm font-semibold text-indigo-700 underline">Revoir la cible et le marché dans Stratégie de projet</Link>
    </section>

    <section className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-7">
      <p className="text-xs font-bold uppercase tracking-widest text-indigo-600">02 · Références</p>
      <h2 className="mt-1 text-xl font-semibold">Signaux et inspirations à examiner</h2>
      <p className="mt-2 text-sm text-slate-600">Chaque signal indique son périmètre. Les liens de magazines ou d’Instagram ajoutés ci-dessous ne sont pas lus automatiquement : décrivez précisément ce que vous souhaitez en retenir. Aucun média n’est copié ni stocké.</p>
      <div className="mt-5 grid gap-3 md:grid-cols-2">{sources.map((source) => <article key={source.id} className="rounded-2xl border border-slate-200 p-4">
        <div className="flex items-start gap-3"><input type="checkbox" checked={draft.selectedSourceIds.includes(source.id)} onChange={(event) => patch({ selectedSourceIds: event.target.checked ? [...draft.selectedSourceIds, source.id] : draft.selectedSourceIds.filter((id) => id !== source.id), brief: null })} className="mt-1 h-4 w-4" aria-label={`Inclure ${source.title}`} />
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong className="text-sm">{source.title}</strong><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{familyLabel[source.family]}</span></div>
            <p className="mt-1 text-xs text-slate-500">{source.scope} · {source.year}</p><p className="mt-2 text-sm text-slate-700">{source.observation}</p>
            <a href={source.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-indigo-700 underline">Voir la source <ExternalLink size={12} /></a>
            {source.id.startsWith('user-') && <button type="button" onClick={() => patch({ customSources: draft.customSources.filter((item) => item.id !== source.id), selectedSourceIds: draft.selectedSourceIds.filter((id) => id !== source.id), brief: null })} className="ml-4 text-xs text-rose-700 underline">Retirer</button>}
          </div></div></article>)}</div>
      <div className="mt-6 rounded-2xl border border-indigo-200 bg-indigo-50 p-4"><h3 className="font-semibold text-indigo-950">Ajouter une référence de magazine, portfolio ou réseau social</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-2"><label className="text-xs font-medium">Titre<input value={sourceTitle} onChange={(event) => setSourceTitle(event.target.value)} maxLength={150} className={inputClass} /></label>
          <label className="text-xs font-medium">Lien HTTPS<input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://…" className={inputClass} /></label>
          <label className="text-xs font-medium">Direction concernée<select value={sourceFamily} onChange={(event) => setSourceFamily(event.target.value as StyleFamily)} className={inputClass}><option value="durable">Durable</option><option value="contemporain">Contemporain</option><option value="expressif">Expressif</option></select></label>
          <label className="text-xs font-medium md:col-span-2">Ce que montre cette référence<textarea value={sourceNote} onChange={(event) => setSourceNote(event.target.value)} rows={2} maxLength={650} placeholder="Ex. matériaux, ambiance, lumière, détails que l’on souhaite tester…" className={inputClass} /></label></div>
        <button type="button" onClick={addSource} className="mt-3 inline-flex items-center gap-2 rounded-xl border border-indigo-300 px-4 py-2 text-sm font-semibold text-indigo-800"><Plus size={16} /> Ajouter cette observation</button></div>
      {error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      <button type="button" onClick={createBrief} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-indigo-700 px-5 py-3 font-semibold text-white"><Sparkles size={18} /> Comparer trois directions</button>
    </section>

    {draft.brief && <section className="space-y-5" aria-label="Directions de conception">
      <div><p className="text-xs font-bold uppercase tracking-widest text-indigo-600">03 · Comparer et choisir</p><h2 className="mt-1 text-2xl font-semibold">Trois directions pour {draft.brief.programme}</h2>
        <p className="mt-2 text-sm text-slate-600">Propositions structurées à partir du type de bâtiment et des observations sélectionnées. Les palettes sont des hypothèses, pas une prédiction des goûts à {draft.brief.horizonYears} ans.</p></div>
      <div className="grid gap-4 xl:grid-cols-3">{draft.brief.directions.map((direction) => <article key={direction.family} className={`rounded-3xl border bg-white p-5 ${draft.brief?.selectedFamily === direction.family ? 'border-indigo-500 ring-2 ring-indigo-100' : 'border-slate-200'}`}>
        <div className="flex gap-2">{direction.palette.map((color) => <div key={color.hex} title={`${color.name} · ${color.use}`} style={{ backgroundColor: color.hex }} className="h-12 flex-1 rounded-lg border border-black/10" />)}</div>
        <p className="mt-4 text-xs font-bold uppercase tracking-wide text-indigo-600">{familyLabel[direction.family]}</p><h3 className="mt-1 text-lg font-semibold">{direction.title}</h3><p className="mt-2 text-sm text-slate-700">{direction.intent}</p>
        <div className="mt-4 space-y-3 text-sm"><div><strong>Architecture</strong><ul className="mt-1 list-disc space-y-1 pl-5 text-slate-700">{direction.architecture.map((item) => <li key={item}>{item}</li>)}</ul></div>
          <div><strong>Intérieurs</strong><ul className="mt-1 list-disc space-y-1 pl-5 text-slate-700">{direction.interiors.map((item) => <li key={item}>{item}</li>)}</ul></div>
          <p><strong>Matériaux :</strong> {direction.materials.join(' · ')}</p><p><strong>Ce qui dure :</strong> {direction.lasting.join(' ')}</p><p><strong>Ce qui évolue :</strong> {direction.adaptable.join(' ')}</p>
          <p className="rounded-xl bg-amber-50 p-3 text-amber-950"><strong>À vérifier :</strong> {direction.vigilance}</p></div>
        <div className="mt-4 text-xs text-slate-600"><strong>Sources d’inspiration :</strong> {direction.sourceIds.length ? direction.sourceIds.map((id) => sources.find((source) => source.id === id)?.title).filter(Boolean).join(' · ') : 'aucune source propre à cette direction ; hypothèse à documenter'}</div>
        <button type="button" onClick={() => patch({ brief: { ...draft.brief!, selectedFamily: direction.family } })} className={`mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold ${draft.brief?.selectedFamily === direction.family ? 'bg-indigo-700 text-white' : 'border border-indigo-300 text-indigo-700'}`}>
          {draft.brief?.selectedFamily === direction.family ? <><Check size={16} /> Direction choisie</> : 'Choisir cette direction'}</button>
      </article>)}</div>
      {draft.brief.selectedFamily && <div className="rounded-3xl border border-indigo-200 bg-indigo-50 p-5 sm:p-7"><h3 className="text-lg font-semibold text-indigo-950">Brief prêt pour l’architecte et les visuels</h3>
        <p className="mt-2 text-sm text-indigo-900">Ajoutez vos ajustements avant de copier le brief. La proposition doit ensuite être confrontée au PLU, à un budget, à l’exploitant et aux futurs utilisateurs.</p>
        <label className="mt-4 block text-sm font-medium">Ajustements du porteur<textarea value={draft.brief.adjustments} onChange={(event) => patch({ brief: { ...draft.brief!, adjustments: event.target.value.slice(0, 1000) } })} rows={3} className={inputClass} placeholder="Matériaux locaux, contraintes d’entretien, ambiance recherchée…" /></label>
        <button type="button" onClick={() => void copyBrief()} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-indigo-700 px-4 py-2.5 text-sm font-semibold text-white"><Copy size={16} /> {copied ? 'Brief copié' : 'Copier le brief'}</button>
        {studyId && <Link to={`/promoteur/generateur-facades${suffix}`} className="ml-4 inline-block text-sm font-semibold text-indigo-800 underline">Ouvrir Façades IA</Link>}
      </div>}
    </section>}
    <p className="text-xs text-slate-500">Les références et le brief sont enregistrés uniquement dans ce navigateur pour ce compte. Cette page ne collecte aucune image depuis Instagram ou les magazines et n’ajoute aucune donnée DVF.</p>
  </div>;
}
