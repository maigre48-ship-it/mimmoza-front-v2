import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Building2, ExternalLink, Loader2, MapPin, Search, ShieldAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { userStorage } from '@/lib/storage/userScopedStorage';
import { programmeBrief } from '@/spaces/copilot/dossier/parcelStrategy';
import { PromoteurPageHero } from '../shared/components/PromoteurPageHero';
import { readUnifiedSelection } from '../shared/promoteurSelectionBridge';
import { usePromoteurStudy } from '../shared/usePromoteurStudy';
import { usePromoteurStudyId } from '../shared/usePromoteurStudyId';

type MarketResult = {
  success?: boolean;
  error?: string;
  meta?: { commune_nom?: string; commune_insee?: string; departement?: string; generated_at?: string; perimetres?: Record<string, string> };
  core?: { dvf?: { nb_transactions?: number; prix_m2_median?: number; perimetre_label?: string }; insee?: { population?: number; revenu_median?: number } };
  scores?: { global?: number; demande?: number; offre?: number; demande_confiance?: string; demande_champs_mesures?: number; demande_champs_attendus?: number };
  warnings?: string[];
};

type Candidate = {
  siren: string;
  nom: string;
  activite: string;
  commune: string | null;
  adresse: string | null;
  url: string;
};

type Scenario = {
  id: string;
  programme: string;
  parcelId: string;
  address: string;
  insee: string;
  surfaceM2: string;
  date: string;
  market: MarketResult | null;
  marketError: string | null;
  candidates: Candidate[];
  operatorError: string | null;
};

const IDEAS = ['Logements', 'Hôtel', 'EHPAD', 'Clinique', 'Supermarché', 'Bureaux', 'Résidence étudiante'];
const number = (value: number | undefined) => value == null || !Number.isFinite(value) ? '—' : new Intl.NumberFormat('fr-FR').format(value);
const scenarioKey = (studyId: string | null) => `mimmoza.promoteur.strategie-projet.${studyId ?? 'hors-etude'}`;

function inseeFromParcel(id: string): string | null {
  const match = id.trim().toUpperCase().match(/^([0-9AB]{2}[0-9]{3})[0-9A-Z]{9}$/);
  return match?.[1] ?? null;
}

async function verifyInsee(code: string): Promise<{ code: string; nom: string } | null> {
  if (!/^(?:\d{5}|2[AB]\d{3})$/.test(code)) return null;
  try {
    const response = await fetch(`https://geo.api.gouv.fr/communes/${encodeURIComponent(code)}?fields=nom,code`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const data = await response.json() as { code?: string; nom?: string };
    return data.code === code && data.nom ? { code, nom: data.nom } : null;
  } catch { return null; }
}

async function findCandidates(naf: string, insee: string): Promise<Candidate[]> {
  const department = /^9[78]/.test(insee) ? insee.slice(0, 3) : insee.slice(0, 2);
  const url = new URL('https://recherche-entreprises.api.gouv.fr/search');
  url.searchParams.set('activite_principale', naf);
  url.searchParams.set('departement', department);
  url.searchParams.set('etat_administratif', 'A');
  url.searchParams.set('per_page', '8');
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('Le registre des entreprises est momentanément indisponible.');
  const data = await response.json() as { results?: Array<Record<string, unknown>> };
  return (data.results ?? []).filter((item) => item.etat_administratif === 'A' && /^\d{9}$/.test(String(item.siren ?? ''))).map((item) => {
    const local = (Array.isArray(item.matching_etablissements) ? item.matching_etablissements : [])
      .find((entry) => typeof entry === 'object' && entry !== null && (entry as Record<string, unknown>).etat_administratif === 'A' && String((entry as Record<string, unknown>).commune ?? '').startsWith(department)) as Record<string, unknown> | undefined;
    const siren = String(item.siren);
    return {
      siren,
      nom: String(item.nom_complet ?? item.nom_raison_sociale ?? siren),
      activite: String(item.activite_principale ?? naf),
      commune: local?.libelle_commune ? String(local.libelle_commune) : null,
      adresse: local?.adresse ? String(local.adresse) : null,
      url: `https://annuaire-entreprises.data.gouv.fr/entreprise/${siren}`,
    };
  }).filter((item) => item.commune);
}

function InfoCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-2 text-xl font-semibold text-slate-900">{value}</p><p className="mt-1 text-xs text-slate-500">{detail}</p></div>;
}

export default function StrategieProjetPage() {
  const studyId = usePromoteurStudyId();
  const { study } = usePromoteurStudy(studyId);
  const [parcelId, setParcelId] = useState('');
  const [address, setAddress] = useState('');
  const [insee, setInsee] = useState('');
  const [surfaceM2, setSurfaceM2] = useState('');
  const [programme, setProgramme] = useState('');
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [hydratedStudy, setHydratedStudy] = useState<string | null>(null);
  const brief = programmeBrief(programme);
  const latest = scenarios[0] ?? null;
  const studyQuery = studyId ? `?study=${encodeURIComponent(studyId)}` : '';

  useEffect(() => {
    try {
      const parsed = JSON.parse(userStorage.getItem(scenarioKey(studyId)) ?? '[]');
      setScenarios(Array.isArray(parsed) ? parsed.slice(0, 3) : []);
    } catch { setScenarios([]); }
    setHydratedStudy(null);
  }, [studyId]);

  useEffect(() => {
    if (!studyId || hydratedStudy === studyId) return;
    const selection = readUnifiedSelection(studyId);
    const foncier = study?.foncier;
    const id = foncier?.focus_id || selection?.primaryParcelId || '';
    if (!id && !foncier?.commune_insee) return;
    setParcelId(id);
    setInsee(foncier?.commune_insee || selection?.communeInsee || inseeFromParcel(id) || '');
    setAddress(selection?.address || '');
    setSurfaceM2(foncier?.surface_m2 ? String(foncier.surface_m2) : selection?.surfaceM2 ? String(selection.surfaceM2) : '');
    setHydratedStudy(studyId);
  }, [studyId, study, hydratedStudy]);

  const save = (items: Scenario[]) => {
    setScenarios(items);
    userStorage.setItem(scenarioKey(studyId), JSON.stringify(items));
  };

  const analyze = async () => {
    if (!brief) { setFormError('Indiquez un programme à étudier.'); return; }
    const parcel = parcelId.trim().toUpperCase();
    const cityCode = insee.trim().toUpperCase() || inseeFromParcel(parcel) || '';
    if (!parcel && !address.trim() && !cityCode) { setFormError('Indiquez une parcelle, une adresse ou un code INSEE.'); return; }
    setBusy(true); setFormError(null);
    let market: MarketResult | null = null;
    let marketError: string | null = null;
    let operatorError: string | null = null;
    let candidates: Candidate[] = [];

    if (brief.marketType) {
      try {
        const { data, error } = await supabase.functions.invoke<MarketResult>('market-study-investisseur-v1', {
          body: { ...(parcel ? { parcel_id: parcel } : {}), ...(address.trim() ? { address: address.trim() } : {}), ...(cityCode ? { commune_insee: cityCode } : {}), project_type: brief.marketType, radius_km: 5 },
        });
        if (error || !data?.success) throw new Error(data?.error || error?.message || 'Étude de marché indisponible.');
        market = {
          success: true,
          meta: {
            commune_nom: data.meta?.commune_nom, commune_insee: data.meta?.commune_insee,
            departement: data.meta?.departement, generated_at: data.meta?.generated_at,
            perimetres: data.meta?.perimetres,
          },
          core: {
            dvf: data.core?.dvf ? {
              nb_transactions: data.core.dvf.nb_transactions,
              prix_m2_median: data.core.dvf.prix_m2_median,
              perimetre_label: data.core.dvf.perimetre_label,
            } : undefined,
            insee: data.core?.insee ? {
              population: data.core.insee.population, revenu_median: data.core.insee.revenu_median,
            } : undefined,
          },
          scores: data.scores ? {
            global: data.scores.global, demande: data.scores.demande, offre: data.scores.offre,
            demande_confiance: data.scores.demande_confiance,
            demande_champs_mesures: data.scores.demande_champs_mesures,
            demande_champs_attendus: data.scores.demande_champs_attendus,
          } : undefined,
          warnings: data.warnings?.slice(0, 5),
        };
      } catch (error) { marketError = error instanceof Error ? error.message : 'Étude de marché indisponible.'; }
    }

    if (brief.operatorNaf) {
      const verified = await verifyInsee(cityCode || market?.meta?.commune_insee || '');
      if (!verified) operatorError = 'La commune doit être vérifiée par un code INSEE ou une référence cadastrale avant la recherche d’entreprises.';
      else {
        try { candidates = await findCandidates(brief.operatorNaf, verified.code); }
        catch (error) { operatorError = error instanceof Error ? error.message : 'Recherche d’entreprises indisponible.'; }
      }
    }

    const next: Scenario = {
      id: crypto.randomUUID(), programme: brief.label, parcelId: parcel, address: address.trim(), insee: cityCode,
      surfaceM2: surfaceM2.trim(), date: new Date().toISOString(), market, marketError, candidates, operatorError,
    };
    save([next, ...scenarios].slice(0, 3));
    setBusy(false);
  };

  const comparison = useMemo(() => scenarios.map((item) => ({
    ...item,
    brief: programmeBrief(item.programme),
    score: item.market?.scores?.global,
  })), [scenarios]);

  return <div className="mx-auto max-w-7xl space-y-6 px-4 pb-14 pt-6 sm:px-6">
    <PromoteurPageHero badge="PROMOTEUR · STRATÉGIE DE PROJET" title="Quel projet pour ce terrain ?" metaLines={[{ icon: <MapPin size={16} />, text: study?.title || 'Étude libre ou parcelle de l’étude active' }]} statCards={[{ label: 'Scénarios', value: String(scenarios.length) }, { label: 'Méthode', value: '3 étapes', tone: 'emerald' }]} />

    <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-5 text-sm text-indigo-950">
      Cette page rassemble les premiers éléments de marché et des entreprises à qualifier. Une capacité à bâtir, un chiffre d’affaires ou l’intérêt d’un exploitant exigent encore des preuves propres au projet.
    </div>

    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7" aria-labelledby="strategy-input-title">
      <div className="mb-5 flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-widest text-indigo-600">01 · Cadrer</p><h2 id="strategy-input-title" className="mt-1 text-2xl font-semibold text-slate-900">Terrain et programme</h2></div><Building2 className="text-indigo-500" /></div>
      {studyId && <p className="mb-4 text-sm text-slate-600">Les données de l’étude active sont reprises automatiquement. Vous pouvez les corriger avant l’analyse.{study?.plu?.zone_code ? ` Zone PLU relevée : ${study.plu.zone_code} (règlement et périmètre à vérifier).` : ""}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        <label className="text-sm font-medium text-slate-700">Référence cadastrale<input value={parcelId} onChange={(event) => setParcelId(event.target.value)} placeholder="Ex. 64065000AI0002" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 font-normal" /></label>
        <label className="text-sm font-medium text-slate-700">Adresse ou commune<input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Ex. Ascain" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 font-normal" /></label>
        <label className="text-sm font-medium text-slate-700">Code INSEE de la commune<input value={insee} onChange={(event) => setInsee(event.target.value)} placeholder="Ex. 64065" maxLength={5} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 font-normal" /></label>
        <label className="text-sm font-medium text-slate-700">Surface du terrain (m²)<input value={surfaceM2} onChange={(event) => setSurfaceM2(event.target.value)} inputMode="decimal" placeholder="Facultatif — surface cadastrale" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 font-normal" /></label>
      </div>
      <label className="mt-5 block text-sm font-medium text-slate-700">Programme à étudier<input value={programme} onChange={(event) => setProgramme(event.target.value)} list="strategy-programmes" maxLength={120} placeholder="Hôtel, clinique, supermarché… ou votre propre idée" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 font-normal" /></label>
      <datalist id="strategy-programmes">{IDEAS.map((idea) => <option key={idea} value={idea} />)}</datalist>
      {brief && <div className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-950"><strong>Couverture actuelle :</strong> {brief.marketCaveat}<br /><strong>À documenter :</strong> {brief.criticalData}.</div>}
      {formError && <p role="alert" className="mt-4 text-sm text-rose-700">{formError}</p>}
      <button type="button" disabled={busy} onClick={() => void analyze()} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-indigo-700 px-5 py-3 font-semibold text-white disabled:opacity-60">{busy ? <Loader2 className="animate-spin" size={18} /> : <Search size={18} />}{busy ? 'Analyse en cours…' : 'Analyser ce programme'}</button>
    </section>

    {latest && <section aria-labelledby="strategy-result-title" className="space-y-5">
      <div><p className="text-xs font-bold uppercase tracking-widest text-indigo-600">02 · Examiner</p><h2 id="strategy-result-title" className="mt-1 text-2xl font-semibold text-slate-900">{latest.programme}</h2><p className="text-sm text-slate-500">Analyse du {new Date(latest.date).toLocaleDateString('fr-FR')} · {latest.address || latest.parcelId || latest.insee}</p></div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <InfoCard label="Marché spécifique" value={latest.market ? 'Pré-diagnostic' : 'Non mesuré'} detail={latest.market ? `Source : étude Mimmoza · ${latest.market.meta?.commune_nom || 'commune à vérifier'}` : latest.marketError || 'Aucun modèle fiable pour cet usage.'} />
        <InfoCard label="Population" value={number(latest.market?.core?.insee?.population)} detail="Commune · INSEE selon la disponibilité de l’étude" />
        <InfoCard label="Transactions DVF" value={number(latest.market?.core?.dvf?.nb_transactions)} detail={latest.market?.core?.dvf?.perimetre_label || 'Périmètre non documenté'} />
        <InfoCard label="Entreprises repérées" value={String(latest.candidates.length)} detail="Activité déclarée et présence départementale, intérêt non confirmé" />
      </div>
      {latest.market?.scores && <div className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-7"><h3 className="font-semibold text-slate-900">Indices de contexte</h3><p className="mt-1 text-sm text-slate-500">Scores du modèle, sur 100. Ils ne prédisent ni la demande pour un bâtiment précis ni sa rentabilité.</p><div className="mt-4 grid gap-4 sm:grid-cols-3">{([['Demande', latest.market.scores.demande], ['Offre / liquidité', latest.market.scores.offre], ['Synthèse indicative', latest.market.scores.global]] as const).map(([label, value]) => <div key={label}><div className="flex justify-between text-sm"><span>{label}</span><strong>{number(value)}/100</strong></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.min(100, Math.max(0, value ?? 0))}%` }} /></div></div>)}</div><p className="mt-4 text-xs text-slate-500">Confiance de la demande : {latest.market.scores.demande_confiance || 'non indiquée'} · Champs mesurés : {number(latest.market.scores.demande_champs_mesures)} / {number(latest.market.scores.demande_champs_attendus)}</p></div>}
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-7"><h3 className="font-semibold text-slate-900">Ce qu’il reste à prouver</h3><p className="mt-3 text-sm text-slate-700">{programmeBrief(latest.programme)?.criticalData || 'Demande, offre concurrente et règles propres au programme.'}</p><ul className="mt-4 list-inside list-disc space-y-2 text-sm text-slate-700"><li>Règlement écrit, plans PLU et contraintes applicables à chaque parcelle.</li><li>Accès, stationnement, risques, servitudes et obligations propres à l’exploitation.</li><li>Coûts, recettes et seuils de décision documentés par des sources adaptées.</li></ul><div className="mt-5 flex flex-wrap gap-3"><Link to={`/promoteur/foncier${studyQuery}`} className="inline-flex items-center gap-1 text-sm font-semibold text-indigo-700">Vérifier le foncier <ArrowRight size={15} /></Link><Link to={`/promoteur/marche${studyQuery}`} className="inline-flex items-center gap-1 text-sm font-semibold text-indigo-700">Ouvrir l’étude de marché <ArrowRight size={15} /></Link></div></div>
        <div className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-7"><h3 className="font-semibold text-slate-900">Exploitants à qualifier</h3><p className="mt-2 text-sm text-slate-500">Registre Sirene via l’API Recherche d’entreprises. Une présence dans le département ne prouve ni intérêt, ni capacité à reprendre le projet.</p>{latest.operatorError && <p className="mt-3 text-sm text-amber-800">{latest.operatorError}</p>}{latest.candidates.length ? <ul className="mt-4 max-h-80 space-y-3 overflow-auto">{latest.candidates.map((candidate) => <li key={candidate.siren} className="rounded-xl border border-slate-200 p-3"><a href={candidate.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-indigo-700">{candidate.nom}<ExternalLink size={14} /></a><p className="mt-1 text-xs text-slate-600">SIREN {candidate.siren} · NAF {candidate.activite}{candidate.commune ? ` · ${candidate.commune}` : ''}</p></li>)}</ul> : <p className="mt-4 text-sm text-slate-600">{programmeBrief(latest.programme)?.operatorNaf ? 'Aucune entreprise présentable avec les données disponibles.' : 'Définir d’abord la catégorie d’exploitant et son activité pour rechercher des sociétés précises.'}</p>}</div>
      </div>
      <p className="flex items-start gap-2 rounded-xl bg-slate-100 p-4 text-sm text-slate-700"><ShieldAlert className="mt-0.5 shrink-0" size={18} />L’architecture, les matériaux, les couleurs et les services restent des hypothèses de conception tant que les règles opposables et la demande propre au programme ne sont pas établies.</p>
    </section>}

    {comparison.length > 1 && <section className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-7"><div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-widest text-indigo-600">03 · Comparer</p><h2 className="mt-1 text-xl font-semibold">Scénarios étudiés</h2></div><button type="button" onClick={() => save([])} className="text-xs text-slate-500 underline">Effacer</button></div><div className="mt-5 overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead><tr className="border-b text-slate-500"><th className="pb-2">Terrain</th><th className="pb-2">Programme</th><th className="pb-2">Étude spécialisée</th><th className="pb-2">Indice indicatif</th><th className="pb-2">Entreprises repérées</th></tr></thead><tbody>{comparison.map((item) => <tr key={item.id} className="border-b border-slate-100"><td className="py-3 text-slate-600">{item.address || item.parcelId || item.insee}</td><td className="py-3 font-medium">{item.programme}</td><td>{item.market ? 'Pré-diagnostic' : 'Non mesurée'}</td><td>{item.score == null ? '—' : `${number(item.score)}/100`}</td><td>{item.brief?.operatorNaf ? number(item.candidates.length) : 'Activité à définir'}</td></tr>)}</tbody></table></div><p className="mt-3 text-xs text-slate-500">Les scores de modèles différents ne permettent pas, à eux seuls, de classer les programmes.</p></section>}
  </div>;
}
