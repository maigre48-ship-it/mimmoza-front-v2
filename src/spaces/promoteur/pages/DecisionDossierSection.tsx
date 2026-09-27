import { useEffect, useMemo, useState } from 'react';
import { userStorage } from '@/lib/storage/userScopedStorage';
import { assessScenario, compareScenarios, emptyDecisionRecord, GATE_KEYS, type DecisionRecord, type GateKey, type GateVerdict } from './decisionDossier';
import { programmeKind } from './projectProgramme';
import type { PromoteurBilanData } from '../shared/promoteurStudy.types';
import { OperatingModelSection } from './OperatingModelSection';
import { summarizeOperatorFollowups, type OperatorFollowUp } from './operatorFollowup';
import { readSector, type MarketResult, type SectorKey } from './sectorScreening';
import type { MarketSupply } from './marketSupply';
import type { HotelEvidence } from './hotelMarket';

type Item = { id: string; parcelId: string; programme: string; market?: MarketResult | null; supply?: MarketSupply | null; hotelEvidence?: HotelEvidence | null; pluZone?: string | null };
const fmtPct = (n: number | null) => n == null ? '—' : `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(n)} %`;
const fmtMoney = (raw: string | undefined) => { const value = Number(raw?.replace(',', '.')); return raw?.trim() && Number.isFinite(value) && value > 0 ? `${new Intl.NumberFormat('fr-FR').format(value)} €` : '—'; };
const GATE_LABELS: Record<GateKey, string> = {
  foncier: 'Foncier et droit de construire', demande: 'Demande et cible locale', concurrence: 'Offre concurrente',
  economie: 'Coûts et valeur de sortie', operateur: 'Exploitant ou acquéreur',
};
const SECTOR_HINTS: Record<string, [string, string]> = {
  hotel: ['Occupation, ADR, motifs de séjour et origine des clients du bassin, par saison.', 'Hôtels comparables : classement, capacité, prix publics et services.'],
  housing: ['Ménages, solvabilité, loyers et ventes par typologie.', 'Programmes neufs et anciens comparables, prix, vacance et rythme de vente.'],
  ehpad: ['Personnes dépendantes, listes d’attente, solvabilité et autorisations.', 'Places FINESS autorisées, taux d’occupation, tarifs et projets en cours.'],
  clinic: ['Besoin de soins par spécialité et stratégie de l’ARS.', 'FINESS, capacités, spécialités et temps d’accès.'],
  retail: ['Zone de chalandise, dépenses captables et flux mesurés.', 'Enseignes, surfaces, prix et autorisations commerciales.'],
  office: ['Demande placée, utilisateurs et loyers du bassin.', 'Vacance, surfaces disponibles et transactions utilisateurs.'],
  student: ['Effectifs, mobilité et loyers accessibles près des campus.', 'Lits concurrents, loyers et occupation annuelle.'],
  other: ['Demande propre à l’usage, avec périmètre et période.', 'Offre comparable et projets concurrents du bassin.'],
};

export function DecisionDossierSection({ scenarios, studyId, linkedParcelId, linkedBilan, onRemoveScenario }: { scenarios: Item[]; studyId: string | null; linkedParcelId?: string | null; linkedBilan?: PromoteurBilanData | null; onRemoveScenario: (id: string) => void }) {
  const key = `mimmoza.promoteur.decision.${studyId ?? 'hors-etude'}`;
  const [records, setRecords] = useState<Record<string, DecisionRecord>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    try {
      const parsed = JSON.parse(userStorage.getItem(key) ?? '{}');
      setRecords(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {});
    } catch { setRecords({}); }
  }, [key]);
  const latest = scenarios.find((item) => item.id === selectedId) ?? scenarios[0];
  const [operatorFollowUps, setOperatorFollowUps] = useState<Record<string, OperatorFollowUp>>({});
  useEffect(() => {
    const load = () => {
      try { const parsed = JSON.parse(userStorage.getItem(`mimmoza.promoteur.operator-followup.${latest.id}`) ?? '{}');
        setOperatorFollowUps(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {});
      } catch { setOperatorFollowUps({}); }
    };
    load();
    const onChange = (event: Event) => { if ((event as CustomEvent<{ scenarioId: string }>).detail?.scenarioId === latest.id) load(); };
    window.addEventListener('mimmoza:operator-followup', onChange);
    return () => window.removeEventListener('mimmoza:operator-followup', onChange);
  }, [latest.id]);
  const operatorSummary = summarizeOperatorFollowups(operatorFollowUps, Object.keys(operatorFollowUps));
  const record = records[latest.id] ?? emptyDecisionRecord();
  const assessment = assessScenario(record);
  const comparison = useMemo(() => compareScenarios(scenarios.map((s) => ({ ...s, record: records[s.id] ?? emptyDecisionRecord() }))), [scenarios, records]);
  const hints = SECTOR_HINTS[programmeKind(latest.programme)] ?? SECTOR_HINTS.other;
  const sectorKey = (value: Item): SectorKey | null => {
    const kind = programmeKind(value.programme);
    return ({ housing: 'logement', hotel: 'hotel', ehpad: 'ehpad', clinic: 'clinique', retail: 'commerce', office: 'bureaux', student: 'residence_etudiante' } as Record<string, SectorKey>)[kind] ?? null;
  };
  const marketLine = (value: Item) => { const key = sectorKey(value); if (!key) return 'Usage hors périmètre';
    const fact = readSector({ key, market: value.market ?? null, error: null, supply: value.supply, hotel: value.hotelEvidence }).facts.find((item) => item.direct);
    return fact ? `${fact.label} : ${fact.value} · ${fact.scope}` : 'Demande propre au programme non mesurée'; };
  const canImportBilan = programmeKind(latest.programme) === 'housing' && !!latest.parcelId && latest.parcelId === linkedParcelId
    && linkedBilan?.done === true && (linkedBilan.prix_revient_total ?? 0) > 0 && (linkedBilan.ca_previsionnel ?? 0) > 0;
  const update = (next: DecisionRecord) => {
    const all = { ...records, [latest.id]: next };
    setRecords(all);
    userStorage.setItem(key, JSON.stringify(all));
  };
  const field = (name: keyof Omit<DecisionRecord, 'gates' | 'operating'>, label: string, unit?: string) => <label className="text-sm font-medium text-slate-700">{label}<div className="mt-1 flex items-center rounded-xl border border-slate-300"><input type={unit ? 'number' : 'text'} min={unit ? '0' : undefined} step={unit ? 'any' : undefined} value={record[name] ?? ''} onChange={(event) => update({ ...record, [name]: event.target.value })} className="w-full min-w-0 rounded-xl px-3 py-2.5 font-normal" />{unit && <span className="pr-3 text-xs text-slate-500">{unit}</span>}</div></label>;
  const patchGate = (gate: GateKey, patch: Partial<DecisionRecord['gates'][GateKey]>) => update({ ...record, gates: { ...record.gates,
    [gate]: { ...emptyDecisionRecord().gates[gate], ...record.gates?.[gate], ...patch } } });
  return <section className="space-y-5" aria-labelledby="final-decision-title">
    <div className="rounded-3xl border border-indigo-200 bg-white p-5 sm:p-7"><p className="text-xs font-bold uppercase tracking-widest text-indigo-600">06 · Décider</p><h2 id="final-decision-title" className="mt-1 text-2xl font-semibold">Décision de programme et de cession</h2><p className="mt-2 text-sm text-slate-600">Renseignez les pièces locales pour chaque scénario. Mimmoza calcule la marge de cession et compare les rendements annuels du cas prudent sur le même terrain. Chaque pièce déclarée doit rester consultable et validée par le porteur du projet.</p><button type="button" onClick={() => window.print()} className="mt-4 rounded-xl border border-indigo-300 px-4 py-2 text-sm font-semibold text-indigo-800">Imprimer le dossier / PDF</button></div>

    <div className="flex flex-wrap gap-2">{scenarios.map((item) => <div key={item.id} className="flex items-center gap-1"><button type="button" onClick={() => setSelectedId(item.id)} className={`rounded-xl border px-4 py-2 text-sm font-semibold ${latest.id === item.id ? 'border-indigo-600 bg-indigo-700 text-white' : 'border-slate-300 bg-white text-slate-700'}`}>{item.programme} · {records[item.id]?.target || 'cible à définir'}</button><button type="button" onClick={() => onRemoveScenario(item.id)} className="rounded-lg border border-slate-200 px-2 py-2 text-xs text-slate-500">Retirer</button></div>)}</div>
    <div className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-7"><h3 className="text-lg font-semibold">Cible et programme retenu pour {latest.programme}</h3><div className="mt-4 grid gap-4 sm:grid-cols-2">{field('target', 'Clientèle ou utilisateur précis')}{field('programme', 'Programme : typologies, services, espaces communs')}{field('units', 'Nombre de chambres, logements ou unités', 'unités')}{field('grossAreaM2', 'Surface brute programmée', 'm²')}</div><p className="mt-3 text-xs text-slate-500">Le nombre d’unités doit être cohérent avec un plan de masse, les règles PLU opposables et une programmation de surfaces. La capacité théorique de la section précédente n’est pas automatiquement retenue.</p>{record.target && record.programme && <p className="mt-3 rounded-xl bg-indigo-50 p-3 text-sm text-indigo-950">Cible saisie : {record.target}. Programme : {record.programme}. {record.units || '—'} unités pour {record.grossAreaM2 || '—'} m² bruts.</p>}</div>

    <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm"><strong>Validation par le marché :</strong> {operatorSummary.interests.length} intérêt documenté, {operatorSummary.refusals} refus enregistrés pour ce scénario. {operatorSummary.interests[0] && <button type="button" onClick={() => { const entry = operatorSummary.interests[0]; const evidence = entry.value; patchGate('operateur', { source: evidence.source, date: evidence.responseDate, finding: `${evidence.note} (${entry.siren.startsWith('manual:') ? evidence.name : `SIREN ${entry.siren}`})` }); }} className="mt-2 block rounded-lg border border-indigo-300 px-3 py-2 font-semibold text-indigo-700">Reprendre une réponse dans la vérification opérateur</button>}<p className="mt-2 text-xs text-slate-500">La réponse remplit la pièce et le constat ; sa conclusion favorable ou défavorable reste à valider dans le dossier.</p></div>

    <div className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-7"><h3 className="text-lg font-semibold">Cinq vérifications décisives</h3><p className="mt-2 text-sm text-slate-600">Pour chaque point : conclusion, référence de la pièce, date et constat mesurable. « Favorable » est une validation déclarée, non une vérification automatique par Mimmoza.</p><div className="mt-5 space-y-5">{GATE_KEYS.map((gate) => { const item = record.gates?.[gate] ?? emptyDecisionRecord().gates[gate]; const hint = gate === 'demande' ? hints[0] : gate === 'concurrence' ? hints[1] : gate === 'foncier' ? 'Règlement écrit, plan de zonage, OAP, servitudes, risques, accès et destination autorisée.' : gate === 'economie' ? 'Devis, foncier, frais, financement et valeur de sortie étayée par comparables ou offre.' : 'Échange documenté, critères d’implantation ou lettre d’intérêt ; une fiche Sirene ne suffit pas.'; return <div key={gate} className="rounded-2xl border border-slate-200 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold text-slate-900">{GATE_LABELS[gate]}</h4><span className="text-xs text-slate-500">{hint}</span></div><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-sm">Conclusion<select value={item.verdict} onChange={(event) => patchGate(gate, { verdict: event.target.value as GateVerdict })} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"><option value="inconnu">À établir</option><option value="favorable">Favorable selon la pièce</option><option value="defavorable">Défavorable selon la pièce</option></select></label><label className="text-sm">Date de la pièce<input type="date" value={item.date} onChange={(event) => patchGate(gate, { date: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" /></label><label className="text-sm sm:col-span-2">Source : lien ou référence du document<input type="text" value={item.source} onChange={(event) => patchGate(gate, { source: event.target.value })} placeholder="URL, numéro de rapport ou pièce jointe du dossier" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" /></label><label className="text-sm sm:col-span-2">Constat chiffré ou règle applicable<textarea value={item.finding} onChange={(event) => patchGate(gate, { finding: event.target.value })} rows={2} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" /></label></div>{item.verdict !== 'inconnu' && <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-700"><strong>{item.verdict === 'favorable' ? 'Favorable' : 'Défavorable'} :</strong> {item.finding || 'Constat à renseigner'} · {item.source || 'source manquante'} · {item.date || 'date manquante'}</p>}</div>; })}</div></div>

    <OperatingModelSection programme={latest.programme} units={record.units} totalCost={record.totalCost} value={record.operating} onChange={(operating) => update({ ...record, operating })} />

    <div className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-7"><h3 className="text-lg font-semibold">Bilan de cession, scénario central et prudent</h3><p className="mt-2 text-sm text-slate-600">Tous les montants doivent porter sur le même périmètre, avec taxes et frais intégrés de façon cohérente. La valeur prudente est un prix de cession étayé, pas une décote automatique.</p>{canImportBilan && <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-950"><p>Un bilan résidentiel existe pour la même étude et la même parcelle : coût {new Intl.NumberFormat('fr-FR').format(linkedBilan!.prix_revient_total!)} € · CA prévisionnel {new Intl.NumberFormat('fr-FR').format(linkedBilan!.ca_previsionnel!)} €. Vérifiez qu’il correspond à cette variante ; la valeur prudente reste à établir.</p><button type="button" onClick={() => update({ ...record, totalCost: String(linkedBilan!.prix_revient_total), baseExitValue: String(linkedBilan!.ca_previsionnel) })} className="mt-2 rounded-lg border border-indigo-300 px-3 py-2 font-semibold">Reprendre ces deux montants</button></div>}<div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{field('totalCost', 'Coût complet du projet', '€')}{field('baseExitValue', 'Valeur de cession centrale', '€')}{field('downsideExitValue', 'Valeur de cession prudente', '€')}{field('durationMonths', 'Durée totale du projet', 'mois')}{field('requiredAnnualReturnPct', 'Rentabilité annuelle minimale exigée', '%')}</div><div className="mt-4 grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-slate-50 p-3 text-sm">Marge centrale / coût : <strong>{fmtPct(assessment.baseMarginPct)}</strong></div><div className="rounded-xl bg-slate-50 p-3 text-sm">Marge prudente / coût : <strong>{fmtPct(assessment.downsideMarginPct)}</strong></div><div className="rounded-xl bg-slate-50 p-3 text-sm">Rentabilité annualisée prudente : <strong>{fmtPct(assessment.downsideAnnualReturnPct)}</strong></div></div><p className="mt-3 text-xs text-slate-500">Rentabilité annualisée = (valeur prudente / coût complet)^(12 / durée en mois) − 1. Ce ratio simplifié ignore l’échéancier des flux : un bilan de promotion détaillé reste nécessaire.</p></div>

    <div className={`rounded-3xl border p-5 sm:p-7 ${assessment.status === 'qualifie' ? 'border-emerald-300 bg-emerald-50' : assessment.status === 'a_ecarter' ? 'border-rose-300 bg-rose-50' : 'border-amber-300 bg-amber-50'}`}><h3 className="text-lg font-semibold">{assessment.status === 'qualifie' ? 'Scénario qualifié sur pièces déclarées' : assessment.status === 'a_ecarter' ? 'Scénario à écarter ou revoir' : 'Décision suspendue : pièces manquantes'}</h3>{assessment.adverse.length > 0 && <ul className="mt-3 list-inside list-disc space-y-1 text-sm">{assessment.adverse.map((line) => <li key={line}>{line}</li>)}</ul>}{assessment.missing.length > 0 && <p className="mt-3 text-sm">À compléter : {assessment.missing.join(' · ')}.</p>}</div>

    <div className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-7"><h3 className="text-xl font-semibold">Conclusion comparative</h3><p className="mt-2 text-sm text-slate-700">{comparison.reason}</p>{comparison.status === 'priorite_conditionnelle' && <p className="mt-2 text-sm font-semibold text-indigo-800">Priorité sur les scénarios instruits : {scenarios.find((s) => s.id === comparison.winnerId)?.programme}.</p>}<div className="mt-4 overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead><tr className="border-b text-slate-500"><th className="pb-2">Programme et cible</th><th>Marché observé</th><th>Unités</th><th>Coût complet</th><th>Valeur prudente</th><th>État</th><th>Rentabilité annuelle prudente</th></tr></thead><tbody>{scenarios.map((s) => { const a = comparison.assessments[s.id], r = records[s.id]; return <tr key={s.id} className="border-b border-slate-100 align-top"><td className="py-2 font-medium">{s.programme}<span className="block text-xs font-normal text-slate-500">{r?.target || 'Cible non définie'} · PLU {s.pluZone || 'à vérifier'}</span></td><td className="max-w-52 py-2 text-xs text-slate-600">{marketLine(s)}</td><td>{r?.units || '—'}</td><td>{fmtMoney(r?.totalCost)}</td><td>{fmtMoney(r?.downsideExitValue)}</td><td>{a.status === 'qualifie' ? 'Qualifié' : a.status === 'a_ecarter' ? 'À écarter' : 'À documenter'}</td><td>{fmtPct(a.downsideAnnualReturnPct)}</td></tr>; })}</tbody></table></div><p className="mt-3 text-xs text-slate-500">La comparaison exige au moins deux scénarios sur la même parcelle et leurs pièces documentées. Elle ne valide pas juridiquement le permis, le prix de vente ou l’intérêt d’un acheteur.</p></div>
  </section>;
}
