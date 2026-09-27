import { useEffect, useState } from 'react';
import { ArrowRight, Building2, Loader2, MapPin, Search, ShieldAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { userStorage } from '@/lib/storage/userScopedStorage';
import { programmeBrief } from '@/spaces/copilot/dossier/parcelStrategy';
import { HotelDossierSection } from './HotelDossierSection';
import { DecisionDossierSection } from './DecisionDossierSection';
import { OperatorShortlistSection } from './OperatorShortlistSection';
import type { OperatorCandidate } from './operatorShortlist';
import { ProgrammeProposalSection } from './ProgrammeProposalSection';
import { extractPluEnvelope, type PluEnvelope } from './projectProgramme';
import './StrategieProjetPage.css';
import { fetchHotelEvidence, type HotelEvidence } from './hotelMarket';
import { PromoteurPageHero } from '../shared/components/PromoteurPageHero';
import { readUnifiedSelection } from '../shared/promoteurSelectionBridge';
import { usePromoteurStudy } from '../shared/usePromoteurStudy';
import { usePromoteurStudyId } from '../shared/usePromoteurStudyId';

type MarketResult = {
  success?: boolean;
  error?: string;
  meta?: { commune_nom?: string; commune_insee?: string; departement?: string; generated_at?: string; perimetres?: Record<string, string> };
  core?: { dvf?: { nb_transactions?: number; prix_m2_median?: number; perimetre_label?: string }; insee?: { population?: number; revenu_median?: number } };
  warnings?: string[];
};

type Scenario = {
  id: string;
  programme: string;
  parcelId: string;
  address: string;
  insee: string;
  surfaceM2: string;
  pluZone?: string | null;
  pluSource?: string | null;
  pluEnvelope?: PluEnvelope | null;
  date: string;
  market: MarketResult | null;
  marketError: string | null;
  candidates: OperatorCandidate[];
  operatorError: string | null;
  operatorSearch?: { examined: number; total: number | null };
  codeEpci?: string | null;
  hotelEvidence?: HotelEvidence | null;
  hotelError?: string | null;
};

const IDEAS = ['Logements', 'Hôtel', 'EHPAD', 'Clinique', 'Supermarché', 'Bureaux', 'Résidence étudiante'];
const number = (value: number | undefined) => value == null || !Number.isFinite(value) ? '—' : new Intl.NumberFormat('fr-FR').format(value);
const scenarioKey = (studyId: string | null) => `mimmoza.promoteur.strategie-projet.${studyId ?? 'hors-etude'}`;

function inseeFromParcel(id: string): string | null {
  const match = id.trim().toUpperCase().match(/^([0-9AB]{2}[0-9]{3})[0-9A-Z]{9}$/);
  return match?.[1] ?? null;
}

async function verifyInsee(code: string): Promise<{ code: string; nom: string; codeEpci: string | null } | null> {
  if (!/^(?:\d{5}|2[AB]\d{3})$/.test(code)) return null;
  try {
    const response = await fetch(`https://geo.api.gouv.fr/communes/${encodeURIComponent(code)}?fields=nom,code,codeEpci`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const data = await response.json() as { code?: string; nom?: string; codeEpci?: string };
    return data.code === code && data.nom ? { code, nom: data.nom, codeEpci: data.codeEpci ?? null } : null;
  } catch { return null; }
}

async function findCandidates(naf: string, insee: string, epci: string | null): Promise<{ candidates: OperatorCandidate[]; examined: number; total: number | null }> {
  const department = /^9[78]/.test(insee) ? insee.slice(0, 3) : insee.slice(0, 2);
  const page = async (index: number) => {
    const url = new URL('https://recherche-entreprises.api.gouv.fr/search');
    url.searchParams.set('activite_principale', naf);
    url.searchParams.set('departement', department);
    url.searchParams.set('etat_administratif', 'A');
    url.searchParams.set('per_page', '25');
    url.searchParams.set('page', String(index));
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Le registre des entreprises est momentanément indisponible.');
    return await response.json() as { results?: Array<Record<string, unknown>>; total_results?: number };
  };
  const first = await page(1);
  const total = typeof first.total_results === 'number' ? first.total_results : null;
  const extra = await Promise.allSettled(Array.from({ length: Math.min(3, Math.max(0, Math.ceil((total ?? 25) / 25) - 1)) }, (_, i) => page(i + 2)));
  const results = [...(first.results ?? []), ...extra.flatMap((entry) => entry.status === 'fulfilled' ? entry.value.results ?? [] : [])];
  const candidates = results.filter((item) => item.etat_administratif === 'A' && /^\d{9}$/.test(String(item.siren ?? ''))).flatMap((item) => {
    const locals = (Array.isArray(item.matching_etablissements) ? item.matching_etablissements : [])
      .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null && (entry as Record<string, unknown>).etat_administratif === 'A' && String((entry as Record<string, unknown>).commune ?? '').startsWith(department));
    const local = locals.sort((a, b) =>
      Number(b.commune === insee) - Number(a.commune === insee)
      || Number(b.epci === epci && epci != null) - Number(a.epci === epci && epci != null)
      || Number(b.activite_principale === naf) - Number(a.activite_principale === naf))[0];
    if (!local || (item.activite_principale !== naf && !locals.some((entry) => entry.activite_principale === naf))) return [];
    const siren = String(item.siren);
    return [{
      siren,
      nom: String(item.nom_complet ?? item.nom_raison_sociale ?? siren),
      activite: String(item.activite_principale ?? naf),
      commune: local?.libelle_commune ? String(local.libelle_commune) : null,
      adresse: local?.adresse ? String(local.adresse) : null,
      communeInsee: local?.commune ? String(local.commune) : null,
      localActivite: local?.activite_principale ? String(local.activite_principale) : null,
      localSiret: local?.siret ? String(local.siret) : null,
      epci: local?.epci ? String(local.epci) : null,
      url: `https://annuaire-entreprises.data.gouv.fr/entreprise/${siren}`,
    }];
  });
  return { candidates, examined: results.length, total };
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
    let candidates: OperatorCandidate[] = [];
    let operatorSearch: Scenario['operatorSearch'];
    let hotelEvidence: HotelEvidence | null = null;
    let hotelError: string | null = null;

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
          warnings: data.warnings?.slice(0, 5),
        };
      } catch (error) { marketError = error instanceof Error ? error.message : 'Étude de marché indisponible.'; }
    }

    const verified = await verifyInsee(market?.meta?.commune_insee || cityCode);
    if (brief.marketType === 'hotel') {
      if (!verified) hotelError = 'Code INSEE vérifié requis pour collecter les données hôtelières.';
      else {
        try { hotelEvidence = { ...await fetchHotelEvidence(verified.code), codeEpci: verified.codeEpci }; }
        catch (error) { hotelError = error instanceof Error ? error.message : 'Données hôtelières indisponibles.'; }
      }
    }

    if (brief.operatorNaf) {
      if (!verified) operatorError = 'La commune doit être vérifiée par un code INSEE ou une référence cadastrale avant la recherche d’entreprises.';
      else {
        try { const found = await findCandidates(brief.operatorNaf, verified.code, verified.codeEpci); candidates = found.candidates; operatorSearch = { examined: found.examined, total: found.total }; }
        catch (error) { operatorError = error instanceof Error ? error.message : 'Recherche d’entreprises indisponible.'; }
      }
    }

    const next: Scenario = {
      id: crypto.randomUUID(), programme: brief.label, parcelId: parcel, address: address.trim(), insee: verified?.code ?? cityCode,
      surfaceM2: surfaceM2.trim(), pluZone: study?.plu?.zone_code ?? null, pluSource: study?.plu?.source ?? null, pluEnvelope: study?.plu?.ruleset ? extractPluEnvelope(study.plu.ruleset) : null, date: new Date().toISOString(), market, marketError, candidates, operatorError, operatorSearch, codeEpci: verified?.codeEpci ?? null, hotelEvidence, hotelError,
    };
    save([next, ...scenarios].slice(0, 3));
    setBusy(false);
  };


  return <div className="mx-auto max-w-7xl space-y-6 px-4 pb-14 pt-6 sm:px-6">
    <PromoteurPageHero badge="PROMOTEUR · STRATÉGIE DE PROJET" title="Quel projet pour ce terrain ?" metaLines={[{ icon: <MapPin size={16} />, text: study?.title || 'Étude libre ou parcelle de l’étude active' }]} statCards={[{ label: 'Scénarios', value: String(scenarios.length) }, { label: 'Dossier', value: 'Sourcé', tone: 'emerald' }]} />

    <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-5 text-sm text-indigo-950">
      Ce dossier distingue les faits mesurés, les hypothèses à tester et les décisions à confirmer. Les données de marché générales ne valent pas preuve de demande pour le programme choisi.
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
      {brief && <div className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-950"><strong>Couverture actuelle :</strong> {brief.marketType === 'hotel' ? 'Offre communale et bassin proche INSEE ; fréquentation départementale. Baromètres d’occupation et de prix disponibles pour les communes du Pays basque couvertes par l’ADT64.' : brief.marketCaveat}<br /><strong>À documenter :</strong> {brief.criticalData}.</div>}
      {formError && <p role="alert" className="mt-4 text-sm text-rose-700">{formError}</p>}
      <button type="button" disabled={busy} onClick={() => void analyze()} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-indigo-700 px-5 py-3 font-semibold text-white disabled:opacity-60">{busy ? <Loader2 className="animate-spin" size={18} /> : <Search size={18} />}{busy ? 'Analyse en cours…' : 'Analyser ce programme'}</button>
    </section>

    {latest && <section id="strategy-dossier" aria-labelledby="strategy-result-title" className="space-y-5">
      <div><p className="text-xs font-bold uppercase tracking-widest text-indigo-600">02 · Examiner</p><h2 id="strategy-result-title" className="mt-1 text-2xl font-semibold text-slate-900">{latest.programme}</h2><p className="text-sm text-slate-500">Analyse du {new Date(latest.date).toLocaleDateString('fr-FR')} · {latest.address || latest.parcelId || latest.insee}</p></div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <InfoCard label="Terrain étudié" value={latest.parcelId || latest.insee || 'Adresse'} detail={latest.surfaceM2 ? `${latest.surfaceM2} m² cadastraux déclarés · capacité non déduite` : 'Surface cadastrale non fournie'} />
        <InfoCard label="Données sectorielles" value={latest.hotelEvidence?.capacityYear ? 'INSEE documenté' : latest.market ? 'Partielles' : 'Non collectées'} detail={latest.hotelEvidence?.capacityYear ? `Capacité communale ${latest.hotelEvidence.capacityYear}` : latest.hotelError || latest.marketError || 'Vérifications propres au programme requises'} />
        <InfoCard label="Périmètre de marché" value={latest.market?.meta?.commune_nom || 'À confirmer'} detail="Le périmètre de chaque mesure figure dans le dossier" />
        <InfoCard label="Interlocuteurs proposés" value={String(Math.min(8, latest.candidates.length))} detail="Activité et implantation repérées ; intérêt non confirmé" />
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700"><strong>Cadre foncier :</strong> {latest.pluZone ? `zone PLU ${latest.pluZone} (origine : ${latest.pluSource || 'étude active'})` : 'zone PLU non documentée dans ce dossier'}. Le zonage seul ne prouve pas l’autorisation du programme ; vérifier le règlement opposable, les servitudes et les risques sur la parcelle.</div>
      {programmeBrief(latest.programme)?.marketType === 'hotel' && <>
        {latest.hotelError && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">{latest.hotelError}</p>}
        <HotelDossierSection evidence={latest.hotelEvidence ?? null} scenarioId={latest.id} />
      </>}
      {programmeBrief(latest.programme)?.marketType !== 'hotel' && <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-700">
        <h3 className="font-semibold text-slate-900">Contexte transversal disponible</h3>
        <p className="mt-2">Population communale : {number(latest.market?.core?.insee?.population)} · Transactions DVF : {number(latest.market?.core?.dvf?.nb_transactions)} ({latest.market?.core?.dvf?.perimetre_label || 'périmètre à vérifier'}).</p>
        <p className="mt-2 text-slate-500">Ces indicateurs ne mesurent pas la demande pour {latest.programme.toLowerCase()}. {latest.marketError || programmeBrief(latest.programme)?.marketCaveat}</p>
      </div>}
      <ProgrammeProposalSection programme={latest.programme} hotel={latest.hotelEvidence ?? null} terrainM2={latest.surfaceM2} pluEnvelope={latest.pluEnvelope ?? null} studyQuery={studyQuery} insee={latest.insee || latest.market?.meta?.commune_insee || ''} />
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-7"><h3 className="font-semibold text-slate-900">Ce qu’il reste à prouver</h3><p className="mt-3 text-sm text-slate-700">{programmeBrief(latest.programme)?.criticalData || 'Demande, offre concurrente et règles propres au programme.'}</p><ul className="mt-4 list-inside list-disc space-y-2 text-sm text-slate-700"><li>Règlement écrit, plans PLU et contraintes applicables à chaque parcelle.</li><li>Accès, stationnement, risques, servitudes et obligations propres à l’exploitation.</li><li>Coûts, recettes et seuils de décision documentés par des sources adaptées.</li></ul><div className="mt-5 flex flex-wrap gap-3"><Link to={`/promoteur/foncier${studyQuery}`} className="inline-flex items-center gap-1 text-sm font-semibold text-indigo-700">Vérifier le foncier <ArrowRight size={15} /></Link><Link to={`/promoteur/marche${studyQuery}`} className="inline-flex items-center gap-1 text-sm font-semibold text-indigo-700">Ouvrir l’étude de marché <ArrowRight size={15} /></Link></div></div>
        <OperatorShortlistSection key={latest.id} candidates={latest.candidates} scenarioId={latest.id} insee={latest.insee} epci={latest.codeEpci ?? null} naf={programmeBrief(latest.programme)?.operatorNaf ?? null} error={latest.operatorError} examined={latest.operatorSearch?.examined} total={latest.operatorSearch?.total ?? undefined} />
      </div>
      <DecisionDossierSection scenarios={scenarios} studyId={studyId} onRemoveScenario={(id) => save(scenarios.filter((item) => item.id !== id))} />
      <p className="flex items-start gap-2 rounded-xl bg-slate-100 p-4 text-sm text-slate-700"><ShieldAlert className="mt-0.5 shrink-0" size={18} />L’architecture, les matériaux, les couleurs et les services restent des hypothèses de conception tant que les règles opposables et la demande propre au programme ne sont pas établies.</p>
    </section>}

  </div>;
}
