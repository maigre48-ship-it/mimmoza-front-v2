// =============================================================
// Mimmoza · Page Opportunités (V2)
// Moteur de chasse aux opportunités à partir des annonces RÉELLES
// de la veille (v_market_active_listings) + testeur manuel secondaire.
// Aucune donnée mockée. Aucune IA. Style Mimmoza (cartes blanches).
// =============================================================

import React from 'react';

import {
  useOpportunityEngine,
  type OpportunityFormState,
} from '@/services/opportunity/useOpportunityEngine';
import type {
  OpportunityAssetType,
  OpportunityConfidence,
  OpportunityRecommendationAction,
  OpportunityResult,
  OpportunityStrategy,
} from '@/services/opportunity/opportunityEngine.types';
import {
  scanOpportunities,
  type IngestSummary,
  type ScannedOpportunity,
} from '@/services/opportunity/opportunityScanner.service';
import { getCurrentAdminStatus } from '@/lib/admin';
import { createWatch } from '@/services/opportunity/opportunityWatch.service';

// -------------------------------------------------------------
// Constantes UI
// -------------------------------------------------------------

const STRATEGIES: { value: OpportunityStrategy; label: string }[] = [
  { value: 'investisseur', label: 'Investisseur' },
  { value: 'rehabilitateur', label: 'Réhabilitateur' },
  { value: 'promoteur', label: 'Promoteur' },
];

const ASSET_TYPES: { value: OpportunityAssetType; label: string }[] = [
  { value: 'unknown', label: 'Non précisé' },
  { value: 'appartement', label: 'Appartement' },
  { value: 'maison', label: 'Maison' },
  { value: 'terrain', label: 'Terrain' },
  { value: 'immeuble', label: 'Immeuble' },
  { value: 'local', label: 'Local' },
];

const ASSET_LABEL: Record<OpportunityAssetType, string> = {
  unknown: 'Non précisé',
  appartement: 'Appartement',
  maison: 'Maison',
  terrain: 'Terrain',
  immeuble: 'Immeuble',
  local: 'Local',
};

// -------------------------------------------------------------
// Helpers d'affichage
// -------------------------------------------------------------

function scoreTone(score: number): { text: string; bg: string; ring: string } {
  if (score >= 65) return { text: 'text-emerald-700', bg: 'bg-emerald-500', ring: 'ring-emerald-200' };
  if (score >= 50) return { text: 'text-amber-700', bg: 'bg-amber-500', ring: 'ring-amber-200' };
  if (score >= 35) return { text: 'text-orange-700', bg: 'bg-orange-500', ring: 'ring-orange-200' };
  return { text: 'text-rose-700', bg: 'bg-rose-500', ring: 'ring-rose-200' };
}

function confidenceBadge(c: OpportunityConfidence): { label: string; cls: string } {
  if (c === 'high') return { label: 'Confiance élevée', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' };
  if (c === 'medium') return { label: 'Confiance moyenne', cls: 'bg-amber-50 text-amber-700 ring-amber-200' };
  return { label: 'Confiance faible', cls: 'bg-rose-50 text-rose-700 ring-rose-200' };
}

function actionBadge(a: OpportunityRecommendationAction): { label: string; cls: string } {
  switch (a) {
    case 'GO':
      return { label: 'GO', cls: 'bg-emerald-600 text-white' };
    case 'GO_CONDITIONAL':
      return { label: 'GO sous conditions', cls: 'bg-amber-500 text-white' };
    case 'WATCH':
      return { label: 'À surveiller', cls: 'bg-slate-500 text-white' };
    case 'PASS':
    default:
      return { label: 'Passer', cls: 'bg-rose-600 text-white' };
  }
}

function fmtEur(n: number | null | undefined): string {
  if (n == null) return 'donnée indisponible';
  return `${Math.round(n).toLocaleString('fr-FR')} €`;
}

function fmtArea(result: OpportunityResult): string {
  const la = result.input.livingArea;
  const land = result.input.landArea;
  if (la != null) return `${la.toLocaleString('fr-FR')} m² hab.`;
  if (land != null) return `${land.toLocaleString('fr-FR')} m² terrain`;
  return 'donnée indisponible';
}

// -------------------------------------------------------------
// Sous-composants génériques
// -------------------------------------------------------------

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100 ${className}`}>
      {children}
    </div>
  );
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      {children}
      {hint ? <span className="text-[11px] text-slate-400">{hint}</span> : null}
    </label>
  );
}

const inputCls =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 ' +
  'outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100';

function PluChip({ result }: { result: OpportunityResult }) {
  const status = result.pluContext?.pluStatus;
  if (!status) return <span className="text-xs text-slate-400">—</span>;
  const map: Record<string, string> = {
    PLU_READY: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    PLU_PENDING: 'bg-amber-50 text-amber-700 ring-amber-200',
    PLU_OUTDATED: 'bg-orange-50 text-orange-700 ring-orange-200',
    PLU_FAILED: 'bg-rose-50 text-rose-700 ring-rose-200',
  };
  return (
    <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ${map[status] ?? 'bg-slate-50 text-slate-600 ring-slate-200'}`}>
      {status}
    </span>
  );
}

// -------------------------------------------------------------
// Panneau de détail (réutilisé par scan + testeur manuel)
// -------------------------------------------------------------

function ResultPanel({ result }: { result: OpportunityResult }) {
  const tone = scoreTone(result.scoreTotal);
  const conf = confidenceBadge(result.confidence);
  const act = actionBadge(result.recommendation.action);
  const isPromoteur = result.input.strategy === 'promoteur';
  const pluReady = result.pluContext?.pluStatus === 'PLU_READY';

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <div className={`flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl ring-4 ${tone.ring}`}>
            <div className="text-center">
              <div className={`text-3xl font-bold leading-none ${tone.text}`}>{result.scoreTotal}</div>
              <div className="text-[10px] uppercase tracking-wide text-slate-400">/ 100</div>
            </div>
          </div>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-md px-2 py-1 text-xs font-semibold ${act.cls}`}>{act.label}</span>
              <span className={`rounded-md px-2 py-1 text-xs font-medium ring-1 ${conf.cls}`}>{conf.label}</span>
            </div>
            <h3 className="mt-2 text-base font-semibold text-slate-800">{result.scoreLabel}</h3>
            <p className="text-sm text-slate-500">{result.recommendation.headline}</p>
          </div>
        </div>
        {result.recommendation.rationale.length > 0 && (
          <ul className="mt-4 space-y-1 border-t border-slate-100 pt-4 text-sm text-slate-600">
            {result.recommendation.rationale.map((r, i) => (
              <li key={i}>· {r}</li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h4 className="mb-3 text-sm font-semibold text-slate-700">Détail par pilier</h4>
        <div className="space-y-3">
          {result.breakdown.map((p) => (
            <div key={p.key}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-medium text-slate-600">{p.label}</span>
                {p.available && p.score != null ? (
                  <span className="text-slate-500">{p.score}/100 · poids {Math.round(p.weight * 100)}%</span>
                ) : (
                  <span className="italic text-slate-400">en attente</span>
                )}
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                {p.available && p.score != null ? (
                  <div className={`h-full rounded-full ${scoreTone(p.score).bg}`} style={{ width: `${p.score}%` }} />
                ) : (
                  <div className="h-full w-full bg-[repeating-linear-gradient(45deg,#f1f5f9,#f1f5f9_6px,#e2e8f0_6px,#e2e8f0_12px)]" />
                )}
              </div>
              <p className="mt-1 text-[11px] text-slate-400">{p.rationale}</p>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <h4 className="mb-3 text-sm font-semibold text-slate-700">Signaux</h4>
          {result.signals.length === 0 ? (
            <p className="text-sm text-slate-400">Aucun signal détecté.</p>
          ) : (
            <ul className="space-y-2">
              {result.signals.map((s) => (
                <li key={s.code} className="flex items-start gap-2 text-sm">
                  <span
                    className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                      s.severity === 'positive' ? 'bg-emerald-500' : s.severity === 'warning' ? 'bg-amber-500' : 'bg-slate-300'
                    }`}
                  />
                  <span className="text-slate-600">
                    <span className="font-medium text-slate-700">{s.label}</span>
                    {s.detail ? <span className="text-slate-400"> — {s.detail}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h4 className="mb-3 text-sm font-semibold text-slate-700">Points de vigilance</h4>
          {result.riskFlags.length === 0 ? (
            <p className="text-sm text-slate-400">Aucun point de vigilance.</p>
          ) : (
            <ul className="space-y-2">
              {result.riskFlags.map((r) => (
                <li key={r.code} className="flex items-start gap-2 text-sm">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-rose-500" />
                  <span className="text-slate-600">
                    <span className="font-medium text-slate-700">{r.label}</span>
                    {r.detail ? <span className="text-slate-400"> — {r.detail}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Contexte PLU */}
      {result.pluContext && (
        <Card>
          <h4 className="mb-2 text-sm font-semibold text-slate-700">Contexte PLU</h4>
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <PluChip result={result} />
            {result.pluContext.communeName ? <span>{result.pluContext.communeName}</span> : null}
            {result.pluContext.zoneLabel ? <span>· Zone {result.pluContext.zoneLabel}</span> : null}
            {result.pluContext.reason ? <span className="text-slate-400">· {result.pluContext.reason}</span> : null}
          </div>
        </Card>
      )}

      {/* Faisabilité promoteur (V1 prudente) */}
      {isPromoteur && (
        <Card>
          <h4 className="mb-2 text-sm font-semibold text-slate-700">Faisabilité promoteur (V1)</h4>
          <div className="space-y-1 text-sm text-slate-600">
            <div>
              Surface terrain :{' '}
              <span className="font-medium text-slate-700">
                {result.input.landArea != null ? `${result.input.landArea.toLocaleString('fr-FR')} m²` : 'donnée indisponible'}
              </span>
            </div>
            <div>
              Type de bien : <span className="font-medium text-slate-700">{ASSET_LABEL[result.input.assetType]}</span>
            </div>
            {pluReady ? (
              <p className="text-emerald-700">PLU disponible — faisabilité indicative basée sur surface terrain + type de bien.</p>
            ) : (
              <p className="text-amber-700">Faisabilité PLU à compléter — commune non encore indexée.</p>
            )}
          </div>
        </Card>
      )}

      {/* Raison de confiance faible */}
      {result.confidence === 'low' && (
        <Card className="ring-rose-100">
          <h4 className="mb-1 text-sm font-semibold text-rose-700">Confiance faible</h4>
          <p className="text-sm text-slate-600">
            Données insuffisantes pour fiabiliser le score (prix, surfaces ou couverture des piliers).
            Complétez l'annonce ou branchez les sources marché.
          </p>
        </Card>
      )}

      {result.recommendation.nextSteps.length > 0 && (
        <Card>
          <h4 className="mb-2 text-sm font-semibold text-slate-700">Prochaines étapes</h4>
          <ul className="space-y-1 text-sm text-slate-600">
            {result.recommendation.nextSteps.map((s, i) => (
              <li key={i}>· {s}</li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

// -------------------------------------------------------------
// Testeur manuel (bloc secondaire)
// -------------------------------------------------------------

function ManualTester() {
  const { form, setField, loading, error, result, submit, reset } = useOpportunityEngine();

  const onText =
    (key: keyof OpportunityFormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setField(key, e.target.value as OpportunityFormState[typeof key]);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <div className="mb-5">
          <span className="mb-2 block text-xs font-medium text-slate-500">Stratégie</span>
          <div className="grid grid-cols-3 gap-2">
            {STRATEGIES.map((s) => {
              const active = form.strategy === s.value;
              return (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setField('strategy', s.value)}
                  className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                    active ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Adresse">
              <input className={inputCls} value={form.address} onChange={onText('address')} placeholder="12 rue ..." />
            </Field>
          </div>
          <Field label="Ville">
            <input className={inputCls} value={form.city} onChange={onText('city')} placeholder="Ascain" />
          </Field>
          <Field label="Code postal">
            <input className={inputCls} value={form.postalCode} onChange={onText('postalCode')} placeholder="64310" />
          </Field>
          <Field label="Code INSEE" hint="Active le contexte PLU si renseigné">
            <input className={inputCls} value={form.codeInsee} onChange={onText('codeInsee')} placeholder="64065" />
          </Field>
          <Field label="Type de bien">
            <select className={inputCls} value={form.assetType} onChange={onText('assetType')}>
              {ASSET_TYPES.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Prix demandé (€)">
            <input className={inputCls} inputMode="numeric" value={form.askingPrice} onChange={onText('askingPrice')} placeholder="350000" />
          </Field>
          <Field label="Surface habitable (m²)">
            <input className={inputCls} inputMode="numeric" value={form.livingArea} onChange={onText('livingArea')} placeholder="90" />
          </Field>
          <Field label="Surface terrain (m²)">
            <input className={inputCls} inputMode="numeric" value={form.landArea} onChange={onText('landArea')} placeholder="600" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Description" hint="Mots-clés : travaux, à rénover, division, plateau...">
              <textarea
                className={`${inputCls} min-h-[88px] resize-y`}
                value={form.description}
                onChange={onText('description')}
                placeholder="Maison à rénover, fort potentiel de division..."
              />
            </Field>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-100">{error}</div>
        )}

        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={loading}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Analyse...' : "Analyser l'opportunité"}
          </button>
          <button type="button" onClick={reset} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-500 transition hover:text-slate-700">
            Réinitialiser
          </button>
        </div>
      </Card>

      <div>
        {result ? (
          <ResultPanel result={result} />
        ) : (
          <Card className="flex h-full min-h-[280px] items-center justify-center">
            <p className="max-w-xs text-center text-sm text-slate-400">
              Renseigne une opportunité puis lance l'analyse pour obtenir un score, une recommandation et les signaux détectés.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// KPI
// -------------------------------------------------------------

function Kpi({ label, value, tone = 'slate' }: { label: string; value: string | number; tone?: string }) {
  const toneCls: Record<string, string> = {
    slate: 'text-slate-800',
    emerald: 'text-emerald-700',
    amber: 'text-amber-700',
    indigo: 'text-indigo-700',
  };
  return (
    <Card className="p-4">
      <div className={`text-2xl font-bold ${toneCls[tone] ?? toneCls.slate}`}>{value}</div>
      <div className="mt-1 text-xs text-slate-500">{label}</div>
    </Card>
  );
}

// -------------------------------------------------------------
// Page
// -------------------------------------------------------------

export default function OpportunitiesPage({ embedded = false }: { embedded?: boolean } = {}) {
  const [scanStrategy, setScanStrategy] = React.useState<OpportunityStrategy>('investisseur');
  const [scanCity, setScanCity] = React.useState('');
  const [scanZip, setScanZip] = React.useState('');
  const [withIngest, setWithIngest] = React.useState(true);
  const [scanning, setScanning] = React.useState(false);
  const [scanError, setScanError] = React.useState<string | null>(null);
  const [ingestInfo, setIngestInfo] = React.useState<IngestSummary | null>(null);
  const [scanned, setScanned] = React.useState<ScannedOpportunity[]>([]);
  const [scannedCount, setScannedCount] = React.useState(0);
  const [hasScanned, setHasScanned] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  // Filtres d'affichage
  const [minScore, setMinScore] = React.useState(0);
  const [filterCity, setFilterCity] = React.useState('');
  const [filterAsset, setFilterAsset] = React.useState<'all' | OpportunityAssetType>('all');
  const [priceMin, setPriceMin] = React.useState('');
  const [priceMax, setPriceMax] = React.useState('');
  const [surfaceMin, setSurfaceMin] = React.useState('');
  const [surfaceMax, setSurfaceMax] = React.useState('');

  const [showManual, setShowManual] = React.useState(false);
  const [followBusy, setFollowBusy] = React.useState(false);
  const [followMsg, setFollowMsg] = React.useState<string | null>(null);

  async function handleFollowZone() {
    setFollowMsg(null);
    const city = scanCity.trim() || undefined;
    const zipCode = scanZip.trim() || undefined;
    if (!city && !zipCode) return;

    const numF = (v: string): number | null => {
      const t = v.trim().replace(/\s/g, '').replace(',', '.');
      if (!t) return null;
      const n = Number(t);
      return Number.isFinite(n) ? n : null;
    };

    setFollowBusy(true);
    try {
      const label = `${city ?? zipCode} · ${scanStrategy}`;
      await createWatch({
        label,
        city,
        zipCode,
        strategy: scanStrategy,
        criteria: {
          assetType: filterAsset,
          priceMin: numF(priceMin),
          priceMax: numF(priceMax),
          surfaceMin: numF(surfaceMin),
          surfaceMax: numF(surfaceMax),
        },
        maxListings: 100,
      });
      setFollowMsg('Veille créée. Retrouve-la dans l’onglet « Mes veilles ».');
    } catch (e) {
      setFollowMsg(e instanceof Error ? e.message : 'Création de la veille impossible.');
    } finally {
      setFollowBusy(false);
    }
  }

  async function handleScan() {
    setScanning(true);
    setScanError(null);
    setIngestInfo(null);
    setSelectedId(null);

    const city = scanCity.trim() || undefined;
    const zipCode = scanZip.trim() || undefined;

    if (withIngest && !city && !zipCode) {
      setScanError("Renseigne une ville ou un code postal pour lancer l'ingestion de la veille.");
      setScanning(false);
      return;
    }

    // Statut admin (bypass des quotas veille) — défensif.
    let isAdmin = false;
    try {
      const status = await getCurrentAdminStatus();
      isAdmin = Boolean(status?.isAdmin);
    } catch {
      isAdmin = false;
    }

    const num = (v: string): number | null => {
      const t = v.trim().replace(/\s/g, '').replace(',', '.');
      if (!t) return null;
      const n = Number(t);
      return Number.isFinite(n) ? n : null;
    };

    try {
      const outcome = await scanOpportunities(scanStrategy, {
        city,
        zipCode,
        limit: 100,
        withIngest,
        isAdmin,
        bypassLimits: isAdmin,
        criteria: {
          assetType: filterAsset,
          priceMin: num(priceMin),
          priceMax: num(priceMax),
          surfaceMin: num(surfaceMin),
          surfaceMax: num(surfaceMax),
        },
      });
      setScanned(outcome.opportunities);
      setScannedCount(outcome.scannedCount);
      setIngestInfo(outcome.ingest ?? null);
      setHasScanned(true);
    } catch (e) {
      setScanError(
        "Impossible de récupérer les annonces de veille. Vérifie que la source (v_market_active_listings / fetchMarketActiveListings / refreshMarketZone) est bien branchée.",
      );
      setScanned([]);
      setScannedCount(0);
      setHasScanned(true);
    } finally {
      setScanning(false);
    }
  }

  const filtered = React.useMemo(() => {
    return scanned.filter((o) => {
      const { input } = o.result;
      if (o.result.scoreTotal < minScore) return false;
      if (filterCity.trim()) {
        const c = (input.city ?? '').toLowerCase();
        if (!c.includes(filterCity.trim().toLowerCase())) return false;
      }
      return true;
    });
  }, [scanned, minScore, filterCity]);

  const kpis = React.useMemo(() => {
    const strong = scanned.filter((o) => o.result.scoreTotal >= 65).length;
    const best = scanned.reduce((m, o) => Math.max(m, o.result.scoreTotal), 0);
    const lowConf = scanned.filter((o) => o.result.confidence === 'low').length;
    return { scanned: scannedCount, strong, best, lowConf };
  }, [scanned, scannedCount]);

  const selected = scanned.find((o) => o.listingId === selectedId) ?? null;

  return (
    <div className={embedded ? 'w-full' : 'mx-auto w-full max-w-6xl px-4 py-6'}>
      {!embedded && (
        <header className="mb-6">
          <h1 className="text-xl font-semibold text-slate-800">Opportunités</h1>
          <p className="mt-1 text-sm text-slate-500">
            Détection d'opportunités à partir des annonces réelles de la veille marché.
          </p>
        </header>
      )}
      {/* Barre de scan */}
      <Card className="mb-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
          <div className="lg:w-72">
            <span className="mb-2 block text-xs font-medium text-slate-500">Stratégie de scan</span>
            <div className="grid grid-cols-3 gap-2">
              {STRATEGIES.map((s) => {
                const active = scanStrategy === s.value;
                return (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => setScanStrategy(s.value)}
                    className={`rounded-lg px-2 py-2 text-xs font-medium transition ${
                      active ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="lg:w-44">
            <Field label="Ville à scanner">
              <input className={inputCls} value={scanCity} onChange={(e) => setScanCity(e.target.value)} placeholder="Ascain" />
            </Field>
          </div>
          <div className="lg:w-36">
            <Field label="Code postal">
              <input className={inputCls} value={scanZip} onChange={(e) => setScanZip(e.target.value)} placeholder="64310" />
            </Field>
          </div>
          <button
            type="button"
            onClick={() => void handleScan()}
            disabled={scanning}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {scanning ? 'Scan en cours...' : 'Scanner les annonces de veille'}
          </button>
          <button
            type="button"
            onClick={() => void handleFollowZone()}
            disabled={followBusy || (!scanCity.trim() && !scanZip.trim())}
            title="Créer une veille active sur cette zone et ces critères"
            className="rounded-lg border border-indigo-200 bg-white px-4 py-2 text-sm font-medium text-indigo-700 shadow-sm transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {followBusy ? 'Ajout…' : '+ Suivre cette zone'}
          </button>
        </div>
        {followMsg && <p className="mt-2 text-xs text-emerald-600">{followMsg}</p>}

        <div className="mt-4 border-t border-slate-100 pt-4">
          <span className="mb-2 block text-xs font-medium text-slate-500">
            Critères de recherche (pré-filtre — réduit le nombre d'annonces scorées)
          </span>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Field label="Type de bien">
              <select
                className={inputCls}
                value={filterAsset}
                onChange={(e) => setFilterAsset(e.target.value as 'all' | OpportunityAssetType)}
              >
                <option value="all">Tous</option>
                {ASSET_TYPES.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Prix min (€)">
              <input className={inputCls} inputMode="numeric" value={priceMin} onChange={(e) => setPriceMin(e.target.value)} placeholder="0" />
            </Field>
            <Field label="Prix max (€)">
              <input className={inputCls} inputMode="numeric" value={priceMax} onChange={(e) => setPriceMax(e.target.value)} placeholder="500000" />
            </Field>
            <Field label="Surface min (m²)">
              <input className={inputCls} inputMode="numeric" value={surfaceMin} onChange={(e) => setSurfaceMin(e.target.value)} placeholder="0" />
            </Field>
            <Field label="Surface max (m²)">
              <input className={inputCls} inputMode="numeric" value={surfaceMax} onChange={(e) => setSurfaceMax(e.target.value)} placeholder="200" />
            </Field>
          </div>
        </div>

        <label className="mt-4 flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={withIngest}
            onChange={(e) => setWithIngest(e.target.checked)}
            className="h-4 w-4 accent-indigo-600"
          />
          Rafraîchir la veille (ingestion Stream Estate) avant le scan — consomme un rafraîchissement
        </label>

        {scanError && (
          <div className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-100">{scanError}</div>
        )}

        {ingestInfo && ingestInfo.attempted && !scanError && (
          <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600 ring-1 ring-slate-100">
            {ingestInfo.skipped ? (
              <>Ingestion ignorée{ingestInfo.skipReason ? ` (${ingestInfo.skipReason})` : ''} — lecture des annonces déjà en base.</>
            ) : ingestInfo.error ? (
              <>Ingestion en erreur ({ingestInfo.error}) — lecture des annonces déjà en base.</>
            ) : (
              <>
                Ingestion terminée — {ingestInfo.fetched ?? '?'} annonce(s) récupérée(s),{' '}
                {ingestInfo.retained ?? '?'} retenue(s) pour cette zone.
              </>
            )}
          </div>
        )}
      </Card>

      {/* KPIs */}
      {hasScanned && !scanError && (
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Kpi label="Annonces scannées" value={kpis.scanned} />
          <Kpi label="Opportunités fortes (≥65)" value={kpis.strong} tone="emerald" />
          <Kpi label="Meilleur score" value={kpis.best} tone="indigo" />
          <Kpi label="Confiance faible" value={kpis.lowConf} tone="amber" />
        </div>
      )}

      {/* Filtres d'affichage */}
      {hasScanned && scanned.length > 0 && (
        <Card className="mb-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={`Score minimum : ${minScore}`}>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={minScore}
                onChange={(e) => setMinScore(Number(e.target.value))}
                className="w-full accent-indigo-600"
              />
            </Field>
            <Field label="Ville">
              <input className={inputCls} value={filterCity} onChange={(e) => setFilterCity(e.target.value)} placeholder="Filtrer par ville" />
            </Field>
          </div>
        </Card>
      )}

      {/* Liste + détail */}
      {hasScanned && !scanError && (
        <div className="grid gap-6 lg:grid-cols-5">
          {/* Liste */}
          <div className="lg:col-span-3">
            <Card className="p-0">
              {scanned.length === 0 ? (
                <div className="px-5 py-12 text-center text-sm text-slate-400">
                  Aucune annonce remontée par la veille pour ces critères. Lance un scan sur une autre zone, ou vérifie le pipeline de veille.
                </div>
              ) : filtered.length === 0 ? (
                <div className="px-5 py-12 text-center text-sm text-slate-400">Aucune opportunité ne correspond aux filtres.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 text-xs text-slate-400">
                        <th className="px-4 py-3 font-medium">Score</th>
                        <th className="px-4 py-3 font-medium">Annonce</th>
                        <th className="px-4 py-3 font-medium">Prix</th>
                        <th className="px-4 py-3 font-medium">Type</th>
                        <th className="px-4 py-3 font-medium">PLU</th>
                        <th className="px-4 py-3 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((o) => {
                        const tone = scoreTone(o.result.scoreTotal);
                        const active = o.listingId === selectedId;
                        return (
                          <tr
                            key={o.listingId}
                            className={`border-b border-slate-50 transition ${active ? 'bg-indigo-50/50' : 'hover:bg-slate-50'}`}
                          >
                            <td className="px-4 py-3">
                              <span className={`text-base font-bold ${tone.text}`}>{o.result.scoreTotal}</span>
                            </td>
                            <td className="px-4 py-3">
                              <div className="font-medium text-slate-700 line-clamp-1">{o.title ?? 'Annonce sans titre'}</div>
                              <div className="text-xs text-slate-400">
                                {o.result.input.city ?? 'ville inconnue'} · {fmtArea(o.result)}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-slate-600">{fmtEur(o.result.input.askingPrice)}</td>
                            <td className="px-4 py-3 text-slate-600">{ASSET_LABEL[o.result.input.assetType]}</td>
                            <td className="px-4 py-3"><PluChip result={o.result} /></td>
                            <td className="px-4 py-3 text-right">
                              <button
                                type="button"
                                onClick={() => setSelectedId(o.listingId)}
                                className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-200"
                              >
                                Voir détail
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>

          {/* Détail */}
          <div className="lg:col-span-2">
            {selected ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-700 line-clamp-1">{selected.title ?? 'Détail'}</h2>
                  {selected.url ? (
                    <a href={selected.url} target="_blank" rel="noreferrer" className="text-xs font-medium text-indigo-600 hover:underline">
                      Voir l'annonce ↗
                    </a>
                  ) : null}
                </div>
                <ResultPanel result={selected.result} />
              </div>
            ) : (
              <Card className="flex h-full min-h-[240px] items-center justify-center">
                <p className="max-w-xs text-center text-sm text-slate-400">
                  Sélectionne une opportunité dans la liste pour voir le détail du score, les piliers, signaux et le contexte PLU.
                </p>
              </Card>
            )}
          </div>
        </div>
      )}

      {!hasScanned && (
        <Card className="flex min-h-[160px] items-center justify-center">
          <p className="max-w-md text-center text-sm text-slate-400">
            Lance un scan des annonces de veille pour détecter et classer les opportunités selon la stratégie choisie.
          </p>
        </Card>
      )}

      {/* Bloc secondaire : testeur manuel */}
      <div className="mt-10">
        <button
          type="button"
          onClick={() => setShowManual((v) => !v)}
          className="mb-4 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 shadow-sm transition hover:bg-slate-50"
        >
          {showManual ? '▾' : '▸'} Tester une opportunité manuellement
        </button>
        {showManual && <ManualTester />}
      </div>
    </div>
  );
}