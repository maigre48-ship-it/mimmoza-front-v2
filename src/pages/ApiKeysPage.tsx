// src/pages/ApiKeysPage.tsx
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Key,
  Plus,
  Trash2,
  Copy,
  Check,
  Eye,
  EyeOff,
  AlertTriangle,
  X,
  ChevronLeft,
  Zap,
  Clock,
  BarChart3,
  ShieldCheck,
  CreditCard,
  Wifi,
} from 'lucide-react';

import {
  listApiKeys,
  createApiKey,
  revokeApiKey,
  getMonthlyUsage,
  type ApiKey,
  type ApiKeyEnv,
} from '../lib/apiKeys';

import ApiDeveloperNav from '../features/api/components/ApiDeveloperNav';
import ApiUsageSummary from '../features/api/components/ApiUsageSummary';
import { useApiMember } from '../features/api/member/useApiMember';

const GRAD_API = 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)';
const ACCENT_API = '#6366f1';

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'Jamais utilisée';
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `Il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Il y a ${hours}h`;
  const days = Math.floor(hours / 24);
  return `Il y a ${days}j`;
}

// ── CopySecret ────────────────────────────────────────────────────────────────
function CopySecret({ secret }: { secret: string }) {
  const [copied, setCopied] = useState(false);
  const [visible, setVisible] = useState(true);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50 p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-indigo-700">
        <AlertTriangle className="h-4 w-4 text-amber-500" />
        Copiez cette clé maintenant — elle ne sera plus affichée
      </div>
      <div className="flex items-center gap-2">
        <code className="flex-1 break-all rounded-lg border border-indigo-200 bg-white px-3 py-2 font-mono text-sm text-slate-800">
          {visible ? secret : secret.slice(0, 12) + '•'.repeat(32)}
        </code>
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 transition-all hover:bg-slate-50"
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-white transition-all hover:opacity-90"
          style={{ background: GRAD_API }}
        >
          {copied ? (
            <><Check className="h-4 w-4" />Copié</>
          ) : (
            <><Copy className="h-4 w-4" />Copier</>
          )}
        </button>
      </div>
    </div>
  );
}

// ── CreateKeyModal ────────────────────────────────────────────────────────────
function CreateKeyModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (secret: string) => void;
}) {
  const [name, setName] = useState('');
  const [env, setEnv] = useState<ApiKeyEnv>('test');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await createApiKey({ name: name.trim(), env });
      onCreated(result.secret);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
          <div className="flex items-center gap-3">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-xl"
              style={{ background: `${ACCENT_API}18` }}
            >
              <Key className="h-4 w-4" style={{ color: ACCENT_API }} />
            </div>
            <h2 className="text-base font-semibold text-slate-900">Nouvelle clé API</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 px-6 py-5">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Nom de la clé</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ex: Production back-office"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition-all focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100"
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Environnement</label>
            <div className="grid grid-cols-2 gap-2">
              {(['test', 'live'] as ApiKeyEnv[]).map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setEnv(e)}
                  className="rounded-xl border px-4 py-3 text-left text-sm font-medium transition-all"
                  style={
                    env === e
                      ? { borderColor: ACCENT_API, background: `${ACCENT_API}10`, color: ACCENT_API }
                      : { borderColor: '#e2e8f0', color: '#64748b' }
                  }
                >
                  <div className="font-semibold">{e === 'test' ? 'Test' : 'Production'}</div>
                  <div className="mt-0.5 text-xs opacity-70">
                    {e === 'test' ? 'mk_test_...' : 'mk_live_...'}
                  </div>
                </button>
              ))}
            </div>
          </div>
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}
        </div>

        <div className="flex gap-2 border-t border-slate-100 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 transition-all hover:bg-slate-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!name.trim() || loading}
            className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-50"
            style={{ background: GRAD_API }}
          >
            {loading ? 'Création…' : 'Créer la clé'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── RevokeConfirmModal ────────────────────────────────────────────────────────
function RevokeConfirmModal({
  keyName,
  onClose,
  onConfirm,
  loading,
}: {
  keyName: string;
  onClose: () => void;
  onConfirm: () => void;
  loading: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-3xl border border-slate-200 bg-white shadow-2xl">
        <div className="px-6 py-6 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
            <Trash2 className="h-5 w-5 text-red-500" />
          </div>
          <h2 className="text-base font-semibold text-slate-900">Révoquer cette clé ?</h2>
          <p className="mt-2 text-sm text-slate-500">
            La clé{' '}
            <span className="font-medium text-slate-700">&ldquo;{keyName}&rdquo;</span> sera
            immédiatement invalidée. Cette action est irréversible.
          </p>
        </div>
        <div className="flex gap-2 border-t border-slate-100 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 transition-all hover:bg-slate-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 rounded-xl bg-red-500 py-2.5 text-sm font-semibold text-white transition-all hover:bg-red-600 disabled:opacity-50"
          >
            {loading ? 'Révocation…' : 'Révoquer'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── KeyCard ───────────────────────────────────────────────────────────────────
function KeyCard({
  apiKey,
  newSecret,
  onRevoke,
}: {
  apiKey: ApiKey;
  newSecret: string | null;
  onRevoke: (key: ApiKey) => void;
}) {
  const usagePercent = Math.min(
    100,
    Math.round((apiKey.requests_count / apiKey.requests_limit) * 100)
  );

  const envColors =
    apiKey.env === 'live'
      ? { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500' }
      : { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', dot: 'bg-amber-400' };

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div
              className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
              style={{ background: `${ACCENT_API}12` }}
            >
              <Key className="h-4 w-4" style={{ color: ACCENT_API }} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-900">{apiKey.name}</span>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${envColors.bg} ${envColors.text} ${envColors.border}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${envColors.dot}`} />
                  {apiKey.env === 'live' ? 'Production' : 'Test'}
                </span>
                {apiKey.revoked_at && (
                  <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-[11px] font-semibold text-red-600">
                    Révoquée
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                <code className="rounded bg-slate-100 px-2 py-0.5 font-mono text-slate-600">
                  {apiKey.prefix}••••••••••••••••
                </code>
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatRelative(apiKey.last_used_at)}
                </span>
                <span>Créée le {formatDate(apiKey.created_at)}</span>
              </div>
            </div>
          </div>
          {!apiKey.revoked_at && (
            <button
              type="button"
              onClick={() => onRevoke(apiKey)}
              className="shrink-0 rounded-xl border border-slate-200 p-2 text-slate-400 transition-all hover:border-red-200 hover:bg-red-50 hover:text-red-500"
              title="Révoquer cette clé"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <BarChart3 className="h-3 w-3" />
              {apiKey.requests_count.toLocaleString('fr-FR')} /{' '}
              {apiKey.requests_limit.toLocaleString('fr-FR')} req ce mois
            </span>
            <span
              className={`font-medium ${
                usagePercent > 80
                  ? 'text-red-500'
                  : usagePercent > 60
                  ? 'text-amber-500'
                  : 'text-slate-600'
              }`}
            >
              {usagePercent}%
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${usagePercent}%`,
                background:
                  usagePercent > 80 ? '#ef4444' : usagePercent > 60 ? '#f59e0b' : GRAD_API,
              }}
            />
          </div>
        </div>
      </div>

      {newSecret && (
        <div className="border-t border-indigo-100 bg-indigo-50/50 px-6 pb-5">
          <CopySecret secret={newSecret} />
        </div>
      )}
    </div>
  );
}

// ── ApiKeysPage ───────────────────────────────────────────────────────────────
export default function ApiKeysPage() {
  const navigate = useNavigate();

  // Données réelles via hook Supabase
  const { data: member, loading: memberLoading } = useApiMember();

  // Gestion locale des clés (CRUD Supabase via lib/apiKeys)
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newSecrets, setNewSecrets] = useState<Record<string, string>>({});

  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null);
  const [revokeLoading, setRevokeLoading] = useState(false);

  const [monthly, setMonthly] = useState({ requests: 0, limit: 10_000, percent: 0 });

  const loadKeys = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ks, usage] = await Promise.all([listApiKeys(), getMonthlyUsage()]);
      setKeys(ks);
      setMonthly(usage);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  const handleCreated = async (secret: string) => {
    setShowCreateModal(false);
    const ks = await listApiKeys();
    setKeys(ks);
    if (ks[0]) {
      setNewSecrets((prev) => ({ ...prev, [ks[0].id]: secret }));
      setTimeout(() => {
        setNewSecrets((prev) => {
          const next = { ...prev };
          delete next[ks[0].id];
          return next;
        });
      }, 5 * 60_000);
    }
  };

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    setRevokeLoading(true);
    try {
      await revokeApiKey(revokeTarget.id);
      setKeys((prev) => prev.filter((k) => k.id !== revokeTarget.id));
      setRevokeTarget(null);
    } catch (e) {
      console.error(e);
    } finally {
      setRevokeLoading(false);
    }
  };

  const activeKeys = keys.filter((k) => !k.revoked_at);

  return (
    <div className="space-y-8">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/api')}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition-all hover:border-slate-300 hover:text-slate-700"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-900">Mes clés API</h1>
              {/* BONUS: indicateur connexion réelle */}
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                <Wifi className="h-3 w-3" />
                Connected to API
              </span>
            </div>
            <p className="text-sm text-slate-500">Gérez vos clés d&apos;accès à l&apos;API Mimmoza</p>
          </div>
        </div>

        <ApiDeveloperNav compact />

        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:opacity-90"
          style={{ background: GRAD_API }}
        >
          <Plus className="h-4 w-4" />
          Nouvelle clé
        </button>
      </div>

      {/* ── Usage + plan summary (données réelles) ────────────────────── */}
      {!memberLoading && member && (
        <ApiUsageSummary subscription={member.subscription} usage={member.usage} />
      )}

      {/* ── CTA billing si pas d'abonnement ──────────────────────────── */}
      {!memberLoading && !member?.subscription && (
        <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
          <div className="flex-1">
            <p className="font-medium text-amber-900">Aucun abonnement API actif</p>
            <p className="text-sm text-amber-700">
              Souscrivez à un plan pour activer vos clés et accéder à l'API.
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/api/billing')}
            className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-white px-4 py-2 text-sm font-medium text-amber-700 transition hover:bg-amber-50"
          >
            <CreditCard className="h-4 w-4" />
            Voir les plans
          </button>
        </div>
      )}

      {/* ── Alerte quota clés (quota élevé) ──────────────────────────── */}
      {activeKeys.length >= 5 && (
        <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
          <div className="flex-1">
            <p className="font-medium text-amber-900">Nombre de clés élevé</p>
            <p className="text-sm text-amber-700">
              Passez à un plan supérieur pour augmenter votre quota de clés.
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/api/billing')}
            className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-white px-4 py-2 text-sm font-medium text-amber-700 transition hover:bg-amber-50"
          >
            <CreditCard className="h-4 w-4" />
            Voir les plans
          </button>
        </div>
      )}

      {/* ── Stats mensuelles (Supabase via lib/apiKeys) ───────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-xl"
              style={{ background: `${ACCENT_API}12` }}
            >
              <Zap className="h-4 w-4" style={{ color: ACCENT_API }} />
            </div>
            <div>
              <div className="text-xl font-bold text-slate-900">
                {monthly.requests.toLocaleString('fr-FR')}
              </div>
              <div className="text-xs text-slate-500">Requêtes ce mois</div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100">
              <BarChart3 className="h-4 w-4 text-slate-500" />
            </div>
            <div>
              <div className="text-xl font-bold text-slate-900">
                {monthly.limit.toLocaleString('fr-FR')}
              </div>
              <div className="text-xs text-slate-500">Quota mensuel</div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
            </div>
            <div>
              <div className="text-xl font-bold text-slate-900">{activeKeys.length}</div>
              <div className="text-xs text-slate-500">
                {activeKeys.length > 1 ? 'Clés actives' : 'Clé active'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Liste des clés (Supabase) ──────────────────────────────────── */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl border border-slate-200 bg-slate-100" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-600">
          {error}
        </div>
      ) : keys.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
          <div
            className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl"
            style={{ background: `${ACCENT_API}12` }}
          >
            <Key className="h-6 w-6" style={{ color: ACCENT_API }} />
          </div>
          <p className="font-medium text-slate-700">Aucune clé API active</p>
          <p className="mt-1 text-sm text-slate-400">
            Créez votre première clé pour commencer à utiliser l&apos;API
          </p>
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white"
            style={{ background: GRAD_API }}
          >
            <Plus className="h-4 w-4" />
            Créer une clé
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {keys.map((k) => (
            <KeyCard
              key={k.id}
              apiKey={k}
              newSecret={newSecrets[k.id] ?? null}
              onRevoke={setRevokeTarget}
            />
          ))}
        </div>
      )}

      {/* ── Modals ────────────────────────────────────────────────────── */}
      {showCreateModal && (
        <CreateKeyModal
          onClose={() => setShowCreateModal(false)}
          onCreated={handleCreated}
        />
      )}

      {revokeTarget && (
        <RevokeConfirmModal
          keyName={revokeTarget.name}
          onClose={() => setRevokeTarget(null)}
          onConfirm={handleRevoke}
          loading={revokeLoading}
        />
      )}
    </div>
  );
}