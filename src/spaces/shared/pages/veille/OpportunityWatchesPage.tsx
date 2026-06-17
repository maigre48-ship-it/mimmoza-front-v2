// =============================================================
// Mimmoza · Veille active — page "Mes veilles" (fusion Opportunités)
// Liste des veilles enregistrées + fil d'événements (nouveau / baisse de prix /
// opportunité forte). Root sans background (AppShell fournit bg-slate-50).
// =============================================================

import React from 'react';
import { Link } from 'react-router-dom';
import {
  Eye,
  Bell,
  TrendingDown,
  Sparkles,
  Plus,
  Play,
  Trash2,
  RefreshCw,
} from 'lucide-react';
import {
  listWatches,
  listEvents,
  createWatch,
  deleteWatch,
  toggleWatchActive,
  runWatchNow,
  markAllEventsSeen,
  markEventSeen,
  type OpportunityWatch,
  type WatchEvent,
  type WatchEventType,
} from '@/services/opportunity/opportunityWatch.service';
import type { OpportunityStrategy, OpportunityAssetType } from '@/services/opportunity/opportunityEngine.types';

const STRATEGIES: { value: OpportunityStrategy; label: string }[] = [
  { value: 'investisseur', label: 'Investisseur' },
  { value: 'rehabilitateur', label: 'Réhabilitateur' },
  { value: 'promoteur', label: 'Promoteur' },
];

const ASSETS: { value: OpportunityAssetType | 'all'; label: string }[] = [
  { value: 'all', label: 'Tous types' },
  { value: 'appartement', label: 'Appartement' },
  { value: 'maison', label: 'Maison' },
  { value: 'terrain', label: 'Terrain' },
];

const inputCls =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100';

function fmtEur(v: number | null): string {
  if (v == null) return '—';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function num(s: string): number | null {
  const t = s.trim().replace(/\s/g, '').replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function eventMeta(type: WatchEventType): { icon: React.ReactNode; label: string; color: string } {
  if (type === 'price_drop') {
    return { icon: <TrendingDown className="h-4 w-4" />, label: 'Baisse de prix', color: 'text-emerald-600 bg-emerald-50' };
  }
  if (type === 'strong_opportunity') {
    return { icon: <Sparkles className="h-4 w-4" />, label: 'Opportunité forte', color: 'text-indigo-600 bg-indigo-50' };
  }
  return { icon: <Plus className="h-4 w-4" />, label: 'Nouvelle annonce', color: 'text-sky-600 bg-sky-50' };
}

function criteriaSummary(w: OpportunityWatch): string {
  const c = w.criteria ?? {};
  const parts: string[] = [];
  if (c.assetType && c.assetType !== 'all') parts.push(c.assetType);
  if (c.priceMin != null || c.priceMax != null) {
    parts.push(`${c.priceMin != null ? fmtEur(c.priceMin) : '0'}–${c.priceMax != null ? fmtEur(c.priceMax) : '∞'}`);
  }
  if (c.surfaceMin != null || c.surfaceMax != null) {
    parts.push(`${c.surfaceMin ?? 0}–${c.surfaceMax ?? '∞'} m²`);
  }
  return parts.length ? parts.join(' · ') : 'tous critères';
}

export default function OpportunityWatchesPage({
  embedded = false,
  onGoScan,
}: {
  embedded?: boolean;
  onGoScan?: () => void;
} = {}) {
  const [watches, setWatches] = React.useState<OpportunityWatch[]>([]);
  const [events, setEvents] = React.useState<WatchEvent[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [showForm, setShowForm] = React.useState(false);

  // Formulaire création
  const [fLabel, setFLabel] = React.useState('');
  const [fCity, setFCity] = React.useState('');
  const [fZip, setFZip] = React.useState('');
  const [fStrategy, setFStrategy] = React.useState<OpportunityStrategy>('investisseur');
  const [fAsset, setFAsset] = React.useState<OpportunityAssetType | 'all'>('all');
  const [fPriceMax, setFPriceMax] = React.useState('');
  const [fSurfaceMax, setFSurfaceMax] = React.useState('');
  const [fFrequency, setFFrequency] = React.useState<'daily' | 'weekly'>('daily');
  const [fMaxListings, setFMaxListings] = React.useState('100');
  const [fEmail, setFEmail] = React.useState(false);

  const reload = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [w, e] = await Promise.all([listWatches(), listEvents({ limit: 100 })]);
      setWatches(w);
      setEvents(e);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de chargement.');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const onCreate = async () => {
    setBusy('create');
    setError(null);
    try {
      await createWatch({
        label: fLabel,
        city: fCity,
        zipCode: fZip,
        strategy: fStrategy,
        criteria: {
          assetType: fAsset,
          priceMax: num(fPriceMax),
          surfaceMax: num(fSurfaceMax),
        },
        frequency: fFrequency,
        maxListings: num(fMaxListings) ?? 100,
        notifyEmail: fEmail,
      });
      setShowForm(false);
      setFLabel(''); setFCity(''); setFZip(''); setFPriceMax(''); setFSurfaceMax('');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Création impossible.');
    } finally {
      setBusy(null);
    }
  };

  const onRun = async (id: string) => {
    setBusy(`run-${id}`);
    try {
      await runWatchNow(id);
      // Laisse le temps au run d'écrire, puis recharge.
      await new Promise((r) => setTimeout(r, 1500));
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Run impossible.');
    } finally {
      setBusy(null);
    }
  };

  const onToggle = async (w: OpportunityWatch) => {
    setBusy(`toggle-${w.id}`);
    try {
      await toggleWatchActive(w.id, !w.active);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action impossible.');
    } finally {
      setBusy(null);
    }
  };

  const onDelete = async (id: string) => {
    if (!window.confirm('Supprimer cette veille et son historique ?')) return;
    setBusy(`del-${id}`);
    try {
      await deleteWatch(id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Suppression impossible.');
    } finally {
      setBusy(null);
    }
  };

  const onSeen = async (id: string) => {
    setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, seen: true } : e)));
    try { await markEventSeen(id); } catch { /* silencieux */ }
  };

  const onAllSeen = async () => {
    setEvents((prev) => prev.map((e) => ({ ...e, seen: true })));
    try { await markAllEventsSeen(); } catch { /* silencieux */ }
  };

  const unseenCount = events.filter((e) => !e.seen).length;

  return (
    <>
      <div className={embedded ? 'w-full' : 'mx-auto max-w-6xl px-4 py-6'}>
        {/* En-tête */}
        {!embedded && (
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-semibold text-slate-900">
                <Eye className="h-6 w-6 text-indigo-600" /> Veille active
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Suivi automatique de tes zones : nouvelles annonces, baisses de prix et opportunités fortes.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void reload()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-50"
              >
                <RefreshCw className="h-4 w-4" /> Rafraîchir
              </button>
              <button
                onClick={() => setShowForm((s) => !s)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700"
              >
                <Plus className="h-4 w-4" /> Nouvelle veille
              </button>
            </div>
          </div>
        )}

        {embedded && (
          <div className="mb-4 flex items-center justify-end gap-2">
            <button
              onClick={() => void reload()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-50"
            >
              <RefreshCw className="h-4 w-4" /> Rafraîchir
            </button>
            <button
              onClick={() => setShowForm((s) => !s)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700"
            >
              <Plus className="h-4 w-4" /> Nouvelle veille
            </button>
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {/* Formulaire création */}
        {showForm && (
          <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-slate-700">Créer une veille</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Nom</label>
                <input className={inputCls} value={fLabel} onChange={(e) => setFLabel(e.target.value)} placeholder="Paris 14e investissement" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Ville</label>
                <input className={inputCls} value={fCity} onChange={(e) => setFCity(e.target.value)} placeholder="Paris" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Code postal</label>
                <input className={inputCls} value={fZip} onChange={(e) => setFZip(e.target.value)} placeholder="75014" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Stratégie</label>
                <select className={inputCls} value={fStrategy} onChange={(e) => setFStrategy(e.target.value as OpportunityStrategy)}>
                  {STRATEGIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Type de bien</label>
                <select className={inputCls} value={fAsset} onChange={(e) => setFAsset(e.target.value as OpportunityAssetType | 'all')}>
                  {ASSETS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Prix max (€)</label>
                <input className={inputCls} inputMode="numeric" value={fPriceMax} onChange={(e) => setFPriceMax(e.target.value)} placeholder="500000" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Surface max (m²)</label>
                <input className={inputCls} inputMode="numeric" value={fSurfaceMax} onChange={(e) => setFSurfaceMax(e.target.value)} placeholder="100" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Fréquence</label>
                <select className={inputCls} value={fFrequency} onChange={(e) => setFFrequency(e.target.value as 'daily' | 'weekly')}>
                  <option value="daily">Quotidienne</option>
                  <option value="weekly">Hebdomadaire</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Volume / scan</label>
                <input className={inputCls} inputMode="numeric" value={fMaxListings} onChange={(e) => setFMaxListings(e.target.value)} placeholder="100" />
              </div>
              <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-600">
                <input type="checkbox" checked={fEmail} onChange={(e) => setFEmail(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
                Alerte e-mail
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowForm(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">Annuler</button>
              <button
                onClick={() => void onCreate()}
                disabled={busy === 'create'}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-60"
              >
                {busy === 'create' ? 'Création…' : 'Créer la veille'}
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          {/* Colonne veilles */}
          <div className="lg:col-span-2">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Mes veilles ({watches.length})</h2>
            {loading ? (
              <p className="text-sm text-slate-400">Chargement…</p>
            ) : watches.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-400">
                Aucune veille. Crée-en une, ou lance un scan dans Opportunités puis « Suivre cette zone ».
              </div>
            ) : (
              <div className="space-y-3">
                {watches.map((w) => (
                  <div key={w.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-800">{w.label}</p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {[w.city, w.zip_code].filter(Boolean).join(' ')} · {STRATEGIES.find((s) => s.value === w.strategy)?.label}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-400">{criteriaSummary(w)}</p>
                        <p className="mt-1 text-[11px] text-slate-400">
                          {w.frequency === 'daily' ? 'Quotidienne' : 'Hebdo'} · {w.max_listings} annonces · {w.last_run_at ? `dernier run ${fmtDate(w.last_run_at)}` : 'jamais exécutée'}
                        </p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${w.active ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                        {w.active ? 'active' : 'en pause'}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => void onRun(w.id)}
                        disabled={busy === `run-${w.id}`}
                        className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-slate-700 disabled:opacity-60"
                      >
                        <Play className="h-3.5 w-3.5" /> {busy === `run-${w.id}` ? '…' : 'Lancer'}
                      </button>
                      <button
                        onClick={() => void onToggle(w)}
                        disabled={busy === `toggle-${w.id}`}
                        className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 transition hover:bg-slate-50"
                      >
                        {w.active ? 'Mettre en pause' : 'Réactiver'}
                      </button>
                      <button
                        onClick={() => void onDelete(w.id)}
                        disabled={busy === `del-${w.id}`}
                        className="ml-auto inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs text-red-600 transition hover:bg-red-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Supprimer
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Colonne fil d'événements */}
          <div className="lg:col-span-3">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <Bell className="h-4 w-4 text-indigo-600" /> Nouveautés
                {unseenCount > 0 && (
                  <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[11px] font-medium text-white">{unseenCount}</span>
                )}
              </h2>
              {unseenCount > 0 && (
                <button onClick={() => void onAllSeen()} className="text-xs text-slate-500 hover:text-slate-700">Tout marquer comme lu</button>
              )}
            </div>

            {loading ? (
              <p className="text-sm text-slate-400">Chargement…</p>
            ) : events.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-400">
                Aucune nouveauté pour l'instant. Le premier run d'une veille pose une référence ; les changements
                (nouvelles annonces, baisses de prix) apparaîtront aux runs suivants.
              </div>
            ) : (
              <div className="space-y-2">
                {events.map((ev) => {
                  const meta = eventMeta(ev.event_type);
                  return (
                    <div
                      key={ev.id}
                      className={`flex items-start gap-3 rounded-xl border bg-white p-3 shadow-sm transition ${ev.seen ? 'border-slate-100' : 'border-indigo-200'}`}
                    >
                      <span className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${meta.color}`}>
                        {meta.icon}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-slate-700">{meta.label}</span>
                          {!ev.seen && <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />}
                          <span className="ml-auto text-[11px] text-slate-400">{fmtDate(ev.created_at)}</span>
                        </div>
                        <p className="mt-0.5 truncate text-sm text-slate-800">{ev.title ?? 'Annonce'}</p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {ev.event_type === 'price_drop' && ev.previous_price != null ? (
                            <>
                              {fmtEur(ev.previous_price)} → <span className="font-medium text-emerald-600">{fmtEur(ev.price)}</span>
                              {ev.price_delta_pct != null && ` (${ev.price_delta_pct}%)`}
                            </>
                          ) : ev.event_type === 'strong_opportunity' && ev.score != null ? (
                            <>Score {ev.score}/100 · {fmtEur(ev.price)}</>
                          ) : (
                            fmtEur(ev.price)
                          )}
                        </p>
                        <div className="mt-1.5 flex items-center gap-3">
                          {ev.url && (
                            <a href={ev.url} target="_blank" rel="noreferrer" className="text-xs font-medium text-indigo-600 hover:underline">
                              Voir l'annonce ↗
                            </a>
                          )}
                          {!ev.seen && (
                            <button onClick={() => void onSeen(ev.id)} className="text-xs text-slate-400 hover:text-slate-600">
                              Marquer comme lu
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <p className="mt-4 text-center text-xs text-slate-400">
              Besoin d'une analyse fine d'une zone ?{' '}
              {embedded ? (
                <button onClick={onGoScan} className="font-medium text-indigo-600 hover:underline">
                  Lancer un scan
                </button>
              ) : (
                <Link to="/opportunites" className="font-medium text-indigo-600 hover:underline">Lancer un scan Opportunités</Link>
              )}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}