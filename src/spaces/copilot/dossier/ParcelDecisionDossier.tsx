import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import type { DossierParcel, ParcelDossier } from './parcelDossier';
import { evidenceScopeLabel, evidenceStatusLabel, formatEvidenceValue } from './parcelDossier';
import { decisionStatus, selectedArea, taxScenarios } from './dossierCalculations';
import { buildParcelStrategyPrompt } from './parcelStrategy';
import { loadDossierEvents, loadParcelDossier, saveParcelDossier, type DossierEvent } from './dossierRepository';
import { printParcelDossier } from './exportParcelDossier';
import { supabase } from '@/lib/supabaseClient';
import type { CadastreFeature } from './DossierParcelMap';
import './ParcelDecisionDossier.css';

const DossierParcelMap = lazy(() => import('./DossierParcelMap').then((m) => ({ default: m.DossierParcelMap })));
const euro = (value: number) => `${Math.round(value).toLocaleString('fr-FR')} €`;

interface Props {
  dossier: ParcelDossier;
  conversationId: string;
  messageId: string;
  onAnalyze?: (message: string) => void;
}

interface LocalState {
  selected: DossierParcel[];
  builtSurfaceM2: number | null;
  cadastralRentPerM2: number;
}

function localKey(conversationId: string, messageId: string) {
  return `mimmoza.parcel-dossier.v1.${conversationId}.${messageId}`;
}

function readLocal(key: string): LocalState | null {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (!raw || typeof raw !== 'object') return null;
    return {
      selected: Array.isArray(raw.selected) ? raw.selected.filter((p: DossierParcel) => typeof p?.id === 'string') : [],
      builtSurfaceM2: typeof raw.builtSurfaceM2 === 'number' && raw.builtSurfaceM2 > 0 ? raw.builtSurfaceM2 : null,
      cadastralRentPerM2: typeof raw.cadastralRentPerM2 === 'number' && raw.cadastralRentPerM2 > 0 ? raw.cadastralRentPerM2 : 100,
    };
  } catch { return null; }
}

export function ParcelDecisionDossier({ dossier, conversationId, messageId, onAnalyze }: Props) {
  const key = localKey(conversationId, messageId);
  const initial = useMemo(() => readLocal(key), [key]);
  const [selected, setSelected] = useState<DossierParcel[]>(initial?.selected ?? []);
  const [builtSurfaceM2, setBuiltSurfaceM2] = useState<number | null>(initial?.builtSurfaceM2 ?? null);
  const [cadastralRentPerM2, setCadastralRentPerM2] = useState(initial?.cadastralRentPerM2 ?? 100);
  const [mapFeatures, setMapFeatures] = useState<CadastreFeature[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [watchEnabled, setWatchEnabled] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [events, setEvents] = useState<DossierEvent[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const status = decisionStatus(dossier, selected);
  const area = selectedArea(selected);
  const scenarios = taxScenarios(builtSurfaceM2, cadastralRentPerM2, dossier.taxRate);
  const maxTax = Math.max(1, ...scenarios.map((scenario) => scenario.builtTax));
  const evidenceCounts = dossier.evidences.reduce((counts, evidence) => {
    if (evidence.status === 'confirmed') counts.confirmed++;
    else if (evidence.status === 'estimated') counts.estimated++;
    else counts.unavailable++;
    return counts;
  }, { confirmed: 0, estimated: 0, unavailable: 0 });
  const evidenceTotal = Math.max(1, dossier.evidences.length);
  const floodSignal = dossier.prescriptions.some((value) => /inond|ppri/i.test(value)) || dossier.servitudes.some((value) => /ppri/i.test(value));
  const pluMissing = dossier.evidences.some((evidence) => evidence.id === 'reglement_plu' && evidence.status === 'unavailable');
  const handleFeaturesLoaded = useCallback((features: CadastreFeature[]) => setMapFeatures(features), []);

  useEffect(() => {
    let alive = true;
    void loadParcelDossier(conversationId, messageId).then(async (saved) => {
      if (!alive || !saved) return;
      setSelected(saved.selectedParcels);
      setBuiltSurfaceM2(saved.builtSurfaceM2);
      setCadastralRentPerM2(saved.cadastralRentPerM2 ?? 100);
      setSavedId(saved.id);
      setWatchEnabled(saved.watchEnabled);
      setCheckedAt(saved.checkedAt);
      setEvents(await loadDossierEvents(saved.id).catch(() => []));
    }).catch(() => { /* migration non appliquée : les choix locaux restent utilisables */ });
    return () => { alive = false; };
  }, [conversationId, messageId]);

  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify({ selected, builtSurfaceM2, cadastralRentPerM2 })); }
    catch { /* navigation privée */ }
  }, [key, selected, builtSurfaceM2, cadastralRentPerM2]);

  const snapshot = () => ({
    zone: dossier.zone, prescriptions: dossier.prescriptions, servitudes: dossier.servitudes,
    taxRate: dossier.taxRate, taxYear: dossier.taxYear,
    point: dossier.point, insee: dossier.insee,
    parcelIds: selected.map((parcel) => parcel.id).sort(),
  });

  const save = async (watch = watchEnabled) => {
    setSaving(true); setNotice(null);
    try {
      const saved = await saveParcelDossier({
        conversationId, messageId, selectedParcels: selected,
        builtSurfaceM2, cadastralRentPerM2, watchEnabled: watch,
        watchSnapshot: !watch ? null : !watchEnabled ? snapshot() : undefined,
      });
      setSavedId(saved.id); setWatchEnabled(saved.watchEnabled); setCheckedAt(saved.checkedAt);
      setNotice(watch ? 'Dossier enregistré avec suivi activé.' : 'Dossier enregistré dans votre compte.');
    } catch {
      setNotice('Enregistrement sur le compte indisponible. Vos choix restent conservés sur cet appareil.');
    } finally { setSaving(false); }
  };

  const refreshWatch = async () => {
    if (!savedId) return;
    setSaving(true); setNotice(null);
    try {
      const { data, error } = await supabase.functions.invoke('parcel-dossier-watch-v1', { body: { dossier_id: savedId } });
      if (error || data?.status === 'error') throw error ?? new Error(data?.message ?? 'Vérification impossible');
      setCheckedAt(new Date().toISOString());
      setEvents(await loadDossierEvents(savedId));
      setNotice(data?.changes_count ? 'Un changement a été détecté dans les sources suivies.' : 'Aucun changement détecté dans les sources suivies.');
    } catch {
      setNotice('Vérification indisponible pour le moment.');
    } finally { setSaving(false); }
  };

  const analyzeStrategy = () => {
    const prompt = buildParcelStrategyPrompt(dossier, selected);
    if (prompt) onAnalyze?.(prompt);
  };

  const analyzeConfirmed = () => {
    if (!selected.length || !onAnalyze) return;
    onAnalyze(`J’ai sélectionné comme périmètre de travail les parcelles cadastrales ${selected.map((p) => p.id).join(', ')}. Reprends l’analyse parcelle par parcelle : vérifie pour chacune le zonage, les prescriptions, les servitudes et le risque d’inondation ; distingue les constats au point d’adresse des conclusions sur les parcelles sélectionnées. La sélection ne prouve pas l’unité foncière ni la propriété. La surface cadastrale cumulée est ${area == null ? 'inconnue' : `${area} m²`}. Signale les règles écrites ou documents manquants avant tout verdict de constructibilité.`);
  };

  return <section className="mzia-dossier" aria-label="Dossier parcellaire Mimmoza">
    <div className="mzia-dossier-head">
      <div><span className="mzia-dossier-eyebrow">Dossier de décision</span><h3>{dossier.address ?? 'Parcelle étudiée'}</h3></div>
      <span className={`mzia-dossier-badge mzia-dossier-badge--${status.level}`}>{status.label}</span>
    </div>
    <p className="mzia-dossier-status">{status.detail}</p>
    <div className="mzia-dossier-highlights">
      <div className="mzia-dossier-highlight--detected"><span>Parcelle sous le point</span><strong>{dossier.detectedParcel?.id ?? 'Non résolue'}</strong><small>{dossier.detectedParcel?.areaM2 == null ? 'Surface inconnue' : `${dossier.detectedParcel.areaM2} m² · périmètre incomplet`}</small></div>
      <div className="mzia-dossier-highlight--selected"><span>Périmètre choisi</span><strong>{selected.length ? `${selected.length} parcelle${selected.length > 1 ? 's' : ''}` : 'À sélectionner'}</strong><small>{area == null ? 'Surface à confirmer' : `${area.toLocaleString('fr-FR')} m² cadastraux cumulés`}</small></div>
      <div className="mzia-dossier-highlight--zone"><span>Zone au point</span><strong>{dossier.zone ?? 'Non disponible'}</strong><small>Règlement écrit à vérifier</small></div>
    </div>
    <div className="mzia-dossier-signals" aria-label="Points de vigilance">
      {floodSignal && <div className="mzia-dossier-signal mzia-dossier-signal--warning"><strong>Inondation · signal au point</strong><span>Prescription GPU relevée ; plan et règlement PPRI à consulter.</span></div>}
      {pluMissing && <div className="mzia-dossier-signal mzia-dossier-signal--missing"><strong>Règlement PLU manquant</strong><span>Constructibilité non déterminable à ce stade.</span></div>}
    </div>

    {dossier.point ? <Suspense fallback={<p className="mzia-dossier-map-loading">Chargement de la carte cadastrale…</p>}><DossierParcelMap point={dossier.point} detectedId={dossier.detectedParcel?.id ?? null} selected={selected} onChange={setSelected} onFeaturesLoaded={handleFeaturesLoaded} /></Suspense> : <p className="mzia-dossier-error">Coordonnées absentes : carte indisponible.</p>}
    <div className="mzia-dossier-actions">
      <button type="button" onClick={() => void save()} disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer le dossier'}</button>
      <button type="button" onClick={() => { if (!printParcelDossier({ dossier, selected, builtSurfaceM2, cadastralRentPerM2, mapFeatures })) setNotice('Autorisez les fenêtres contextuelles pour exporter le dossier PDF.'); }}>Exporter le dossier PDF</button>
    </div>
    {selected.length > 0 && onAnalyze && <button type="button" className="mzia-dossier-analyze" onClick={analyzeConfirmed}>Relancer l’analyse sur les parcelles choisies</button>}

    <details className="mzia-dossier-block"><summary>Contraintes et contradictions relevées</summary>
      <div className="mzia-dossier-block-content">
        <p><strong>Prescriptions au point :</strong> {dossier.prescriptions.length ? dossier.prescriptions.join(' ; ') : 'aucune donnée relevée'}</p>
        <p><strong>Servitudes au point :</strong> {dossier.servitudes.length ? dossier.servitudes.join(' ; ') : 'aucune donnée relevée'}</p>
        {dossier.warnings.map((warning, index) => <p className="mzia-dossier-warning" key={index}>{warning}</p>)}
      </div>
    </details>

    <section className="mzia-dossier-block mzia-dossier-simulation" aria-labelledby="mzia-dossier-simulation-heading">
      <div className="mzia-dossier-section-heading"><div><span className="mzia-dossier-eyebrow">2 · Tester une hypothèse</span><h4 id="mzia-dossier-simulation-heading">Taxe foncière bâtie illustrative</h4></div></div>
      <div className="mzia-dossier-block-content">
        <div className="mzia-dossier-inputs">
          <label>Surface de référence (m²)<input type="number" min="1" max="100000" value={builtSurfaceM2 ?? ''} placeholder="Ex. 100" onChange={(e) => setBuiltSurfaceM2(e.target.value ? Number(e.target.value) : null)} /></label>
          <label>Valeur locative fiscale supposée (€/m²/an)<input type="number" min="1" max="10000" value={cadastralRentPerM2} onChange={(e) => setCadastralRentPerM2(Number(e.target.value))} /></label>
        </div>
        {scenarios.length ? <>
          <div className="mzia-dossier-tax-chart" role="img" aria-label={`Scénarios illustratifs de taxe foncière : ${scenarios.map((scenario) => `${scenario.surfaceM2} mètres carrés, ${euro(scenario.builtTax)} par an`).join(' ; ')}`}>
            {scenarios.map((scenario, index) => <div className="mzia-dossier-tax-row" key={scenario.surfaceM2}>
              <span className="mzia-dossier-tax-label">{scenario.surfaceM2} m²{index === 1 && builtSurfaceM2 ? <small> référence</small> : null}</span>
              <span className="mzia-dossier-tax-track"><span className={`mzia-dossier-tax-fill${index === 1 ? ' mzia-dossier-tax-fill--reference' : ''}`} style={{ width: `${scenario.builtTax / maxTax * 100}%` }} /></span>
              <strong>{euro(scenario.builtTax)}<small>/an</small></strong>
            </div>)}
          </div>
          <details className="mzia-dossier-calculation"><summary>Voir les bases du calcul</summary><table><thead><tr><th>Surface supposée</th><th>Base fiscale supposée</th><th>Taxe illustrative</th></tr></thead><tbody>{scenarios.map((scenario) => <tr key={scenario.surfaceM2}><td>{scenario.surfaceM2} m²</td><td>{euro(scenario.taxableBase)}</td><td>{euro(scenario.builtTax)}/an</td></tr>)}</tbody></table></details>
        </> : <p>Taux de taxe foncière indisponible : aucun montant calculé.</p>}
        <p className="mzia-dossier-help">Hypothèses : surface pondérée fiscale égale à la surface indiquée, valeur locative choisie ci-dessus, abattement bâti de 50 %, taux communal {dossier.taxRate == null ? 'indisponible' : `${dossier.taxRate} %${dossier.taxYear ? ` (${dossier.taxYear})` : ''}`}. La TEOM est exclue. Ces montants ne sont pas une estimation de l’avis fiscal. Aucun droit à construire n’est déduit de ces surfaces.</p>
      </div>
    </section>

    <section className="mzia-dossier-strategy" aria-labelledby="mzia-dossier-strategy-heading">
      <div className="mzia-dossier-section-heading"><div><span className="mzia-dossier-eyebrow">3 · Préparer la sortie</span><h4 id="mzia-dossier-strategy-heading">Du terrain au projet vendable</h4></div></div>
      <p>Une stratégie de cession commence par la demande locale, puis confronte plusieurs produits aux droits à bâtir et aux risques du terrain.</p>
      <div className="mzia-dossier-strategy-steps">
        <div><strong>Marché</strong><span>Transactions, profondeur de la demande et limites des données.</span></div>
        <div><strong>Produit</strong><span>Deux ou trois options à tester, avec les conditions qui peuvent les écarter.</span></div>
        <div><strong>Contrepartie</strong><span>Profil d’acquéreur, stade de cession et pièces à lui présenter.</span></div>
      </div>
      <button type="button" onClick={analyzeStrategy} disabled={!selected.length || !onAnalyze}>Étudier le marché et préparer la cession</button>
      <small>{selected.length ? `Analyse demandée sur ${selected.length} parcelle${selected.length > 1 ? 's' : ''} sélectionnée${selected.length > 1 ? 's' : ''}. Les droits à construire restent à vérifier.` : 'Sélectionnez d’abord le périmètre du projet sur la carte.'}</small>
    </section>

    <section className="mzia-dossier-evidence-overview" aria-label="Disponibilité des données du dossier">
      <div className="mzia-dossier-section-heading"><div><span className="mzia-dossier-eyebrow">4 · Mesurer les limites</span><h4>Disponibilité des {dossier.evidences.length} données</h4></div></div>
      <div className="mzia-dossier-evidence-bar" role="img" aria-label={`${evidenceCounts.confirmed} données confirmées, ${evidenceCounts.estimated} estimées et ${evidenceCounts.unavailable} indisponibles`}>
        {evidenceCounts.confirmed > 0 && <span className="mzia-dossier-evidence-bar--confirmed" style={{ width: `${evidenceCounts.confirmed / evidenceTotal * 100}%` }} />}
        {evidenceCounts.estimated > 0 && <span className="mzia-dossier-evidence-bar--estimated" style={{ width: `${evidenceCounts.estimated / evidenceTotal * 100}%` }} />}
        {evidenceCounts.unavailable > 0 && <span className="mzia-dossier-evidence-bar--unavailable" style={{ width: `${evidenceCounts.unavailable / evidenceTotal * 100}%` }} />}
      </div>
      <div className="mzia-dossier-evidence-legend"><span><i className="mzia-evidence-dot--confirmed" /> {evidenceCounts.confirmed} confirmées</span><span><i className="mzia-evidence-dot--estimated" /> {evidenceCounts.estimated} estimées</span><span><i className="mzia-evidence-dot--unavailable" /> {evidenceCounts.unavailable} indisponibles</span></div>
      <p className="mzia-dossier-help">Ce décompte mesure la disponibilité des sources, pas la faisabilité juridique du projet. Une donnée communale ne prouve pas une contrainte à la parcelle.</p>
    </section>

    <details className="mzia-dossier-block"><summary>Voir les {dossier.evidences.length} données et leurs sources</summary>
      <div className="mzia-dossier-block-content mzia-dossier-evidence-scroll"><table><thead><tr><th>Donnée</th><th>Valeur</th><th>Portée</th><th>Source</th></tr></thead><tbody>
        {dossier.evidences.map((ev) => <tr key={ev.id}><td><strong>{ev.label}</strong><small>{evidenceStatusLabel(ev.status)}{ev.confidence != null ? ` · confiance ${ev.confidence}/100` : ''}</small></td><td>{formatEvidenceValue(ev.value)}{ev.warning && <small>{ev.warning}</small>}</td><td>{evidenceScopeLabel(ev.scope)}</td><td>{ev.url ? <a href={ev.url} target="_blank" rel="noreferrer">{ev.source}</a> : ev.source}{ev.sourceDate && <small>{ev.sourceDate}</small>}</td></tr>)}
      </tbody></table></div>
    </details>

    <div className="mzia-dossier-follow">
      <strong>Suivre les changements</strong><p>Compare le zonage, les prescriptions, les servitudes au point et le taux fiscal. Le plan détaillé du PPRI et le règlement écrit restent à consulter.</p>
      <button type="button" disabled={saving || !selected.length} onClick={() => void save(!watchEnabled)}>{watchEnabled ? 'Désactiver le suivi' : 'Activer le suivi'}</button>
      {watchEnabled && <button type="button" disabled={saving} onClick={() => void refreshWatch()}>Vérifier maintenant</button>}
      {checkedAt && <small>Dernière vérification : {new Date(checkedAt).toLocaleString('fr-FR')}</small>}
      {events.length > 0 && <ul>{events.map((event) => <li key={event.id}>{new Date(event.createdAt).toLocaleDateString('fr-FR')} · {event.changes.map((change) => change.field).join(', ')}</li>)}</ul>}
    </div>
    {notice && <p role="status" className="mzia-dossier-notice">{notice}</p>}
    <p className="mzia-dossier-source">Données relevées le {new Date(dossier.sourceDate).toLocaleDateString('fr-FR')}. Les liens ouvrent les portails ou rapports des sources ; vérifiez les documents en vigueur avant toute décision.</p>
  </section>;
}
