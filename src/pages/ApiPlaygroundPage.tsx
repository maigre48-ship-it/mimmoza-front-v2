// src/pages/ApiPlaygroundPage.tsx
import { useMemo, useState } from 'react';
import {
  PlayCircle,
  Copy,
  Check,
  Key,
  Globe,
  Code2,
  AlertCircle,
  ChevronLeft,
  CreditCard,
  Wifi,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import ApiDeveloperNav from '../features/api/components/ApiDeveloperNav';
import { PlanBadge, EnvBadge } from '../features/api/components/ApiStatusBadge';
import { useApiMember } from '../features/api/member/useApiMember';

const API_BASE_URL = 'https://api.mimmoza.io';
const DEFAULT_BODY = `{
  "lat": 48.8686,
  "lon": 2.3306
}`;

// ── CopyButton ─────────────────────────────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button
      type="button"
      onClick={onCopy}
      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
    >
      {copied ? (
        <><Check className="h-3.5 w-3.5 text-emerald-500" />Copié</>
      ) : (
        <><Copy className="h-3.5 w-3.5" />Copier</>
      )}
    </button>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function ApiPlaygroundPage() {
  const navigate = useNavigate();

  // Données réelles Supabase
  const { data: member, loading, error } = useApiMember();

  // État local du playground
  const [method] = useState('POST');
  const [path] = useState('/v1/scoring/smart');
  const [body, setBody] = useState(DEFAULT_BODY);
  const [reqLoading, setReqLoading] = useState(false);
  const [status, setStatus] = useState<number | null>(null);
  const [responseHeaders, setResponseHeaders] = useState<Record<string, string>>({});
  const [responseText, setResponseText] = useState('');

  // Clé API préremplie depuis les données réelles
  const activeKeys = (member?.keys ?? []).filter((k) => k.status === 'active');
  const hasKeys = activeKeys.length > 0;
  const defaultKey = activeKeys[0];

  const [apiKey, setApiKey] = useState('');

  // Préremplir la clé dès que le membre est chargé
  useMemo(() => {
    if (defaultKey?.prefix && !apiKey) {
      setApiKey(defaultKey.prefix);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultKey?.prefix]);

  const fullUrl = useMemo(() => `${API_BASE_URL}${path}`, [path]);

  // ── Logique fetch ─────────────────────────────────────────────────────────
  async function handleSend() {
    setReqLoading(true);
    setStatus(null);
    setResponseText('');
    setResponseHeaders({});

    try {
      const parsed = body ? JSON.parse(body) : {};
      const res = await fetch(fullUrl, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(parsed),
      });
      const text = await res.text();
      setStatus(res.status);
      setResponseText(text);
      setResponseHeaders({
        'x-ratelimit-limit': res.headers.get('x-ratelimit-limit') ?? '',
        'x-ratelimit-remaining': res.headers.get('x-ratelimit-remaining') ?? '',
        'x-response-time': res.headers.get('x-response-time') ?? '',
        'content-type': res.headers.get('content-type') ?? '',
      });
    } catch (err) {
      setStatus(0);
      setResponseText(
        JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }, null, 2)
      );
    } finally {
      setReqLoading(false);
    }
  }

  // ── États de chargement / erreur ──────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-sm text-slate-500">Chargement du playground…</div>
      </div>
    );
  }

  if (error || !member) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-600">
        {error ?? 'Impossible de charger les données API.'}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Header with nav ──────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => navigate('/api')}
          className="flex items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-slate-800"
        >
          <ChevronLeft className="h-4 w-4" />
          API Mimmoza
        </button>
        <ApiDeveloperNav compact />
        <div className="flex items-center gap-2">
          {defaultKey && <EnvBadge env={defaultKey.environment ?? defaultKey.env} size="sm" />}
          <PlanBadge plan={member.subscription.plan} size="sm" />
          {/* BONUS: indicateur connexion réelle */}
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
            <Wifi className="h-3 w-3" />
            Connected to API
          </span>
        </div>
      </div>

      {/* ── Warning : aucune clé API ──────────────────────────────────── */}
      {!hasKeys && (
        <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
          <AlertCircle className="h-5 w-5 shrink-0 text-amber-600" />
          <div className="flex-1">
            <p className="font-medium text-amber-900">Aucune clé API disponible</p>
            <p className="text-sm text-amber-700">
              Créez une clé pour envoyer de vraies requêtes vers l&apos;API.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => navigate('/api/keys')}
              className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-700"
            >
              <Key className="mr-1.5 inline h-4 w-4" />
              Créer une clé
            </button>
            <button
              type="button"
              onClick={() => navigate('/api/billing')}
              className="rounded-xl border border-amber-200 bg-white px-4 py-2 text-sm font-medium text-amber-700 transition hover:bg-amber-50"
            >
              <CreditCard className="mr-1.5 inline h-4 w-4" />
              Abonnement
            </button>
          </div>
        </div>
      )}

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Playground API</h1>
            <div className="mt-2 flex items-center gap-3">
              <p className="text-slate-500">Teste tes appels Mimmoza en direct avec ta clé API.</p>
              {hasKeys && (
                <span className="text-sm text-slate-400">
                  ·{' '}
                  <button
                    type="button"
                    onClick={() => navigate('/api/keys')}
                    className="text-indigo-600 underline-offset-2 hover:underline"
                  >
                    {activeKeys.length} clé{activeKeys.length > 1 ? 's' : ''} active{activeKeys.length > 1 ? 's' : ''}
                  </button>
                </span>
              )}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Base URL</div>
            <div className="mt-1 font-mono text-sm text-slate-800">{API_BASE_URL}</div>
          </div>
        </div>
      </div>

      {/* ── Request / Response grid ───────────────────────────────────── */}
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-6">
          {/* Auth */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2">
              <Key className="h-5 w-5 text-indigo-500" />
              <h2 className="font-semibold text-slate-900">Authentification</h2>
            </div>
            <label className="mt-4 block text-sm font-medium text-slate-700">API key</label>
            <input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="mk_live_... ou mk_test_..."
              className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-mono text-sm text-slate-800 outline-none transition focus:border-indigo-400"
            />
            {!hasKeys && (
              <button
                type="button"
                onClick={() => navigate('/api/keys')}
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-800"
              >
                <Key className="h-3.5 w-3.5" />
                Créer une clé API →
              </button>
            )}
            {hasKeys && activeKeys.length > 1 && (
              <div className="mt-3">
                <label className="mb-1 block text-xs text-slate-500">Changer de clé</label>
                <select
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none focus:border-indigo-300"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                >
                  {activeKeys.map((k) => (
                    <option key={k.id} value={k.prefix}>
                      {k.name} ({k.env === 'live' ? 'Production' : 'Test'})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Request */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2">
              <Globe className="h-5 w-5 text-indigo-500" />
              <h2 className="font-semibold text-slate-900">Requête</h2>
            </div>
            <div className="mt-4 grid gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">Méthode</label>
                <input
                  value={method}
                  disabled
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Endpoint</label>
                <input
                  value={path}
                  disabled
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-sm text-slate-600"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Body JSON</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={14}
                  spellCheck={false}
                  className="mt-2 w-full rounded-xl border border-slate-300 bg-slate-950 px-4 py-3 font-mono text-sm text-emerald-300 outline-none transition focus:border-indigo-400"
                />
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={reqLoading || !apiKey.trim()}
                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <PlayCircle className="h-4 w-4" />
                  {reqLoading ? 'Exécution...' : 'Envoyer la requête'}
                </button>
                <CopyButton
                  text={`curl -X POST ${fullUrl} \\\n  -H "Authorization: Bearer ${apiKey || 'mk_live_xxx'}" \\\n  -H "Content-Type: application/json" \\\n  -d '${body}'`}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          {/* Response */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Code2 className="h-5 w-5 text-indigo-500" />
                <h2 className="font-semibold text-slate-900">Réponse</h2>
              </div>
              {status !== null && (
                <span
                  className={`rounded-md px-2 py-1 text-xs font-semibold ${
                    status >= 200 && status < 300
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-rose-50 text-rose-700'
                  }`}
                >
                  {status === 0 ? 'Erreur locale' : `${status}`}
                </span>
              )}
            </div>
            <div className="mt-4 rounded-xl bg-slate-950 p-4">
              <pre className="overflow-x-auto text-sm leading-relaxed text-slate-300">
                {responseText || `{\n  "message": "Aucune réponse pour le moment"\n}`}
              </pre>
            </div>
          </div>

          {/* Response headers */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="font-semibold text-slate-900">Headers de réponse</h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {[
                ['X-RateLimit-Limit',     responseHeaders['x-ratelimit-limit']],
                ['X-RateLimit-Remaining', responseHeaders['x-ratelimit-remaining']],
                ['X-Response-Time',       responseHeaders['x-response-time']],
                ['Content-Type',          responseHeaders['content-type']],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
                  <div className="mt-2 font-mono text-sm text-slate-800">{value || '—'}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Payload tip */}
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              <div>
                <div className="font-medium text-amber-900">Payload minimal recommandé</div>
                <p className="mt-1 text-sm text-amber-800">
                  Pour le endpoint actuel, utilise au minimum{' '}
                  <code className="rounded bg-amber-100 px-1 font-mono text-xs">lat</code> et{' '}
                  <code className="rounded bg-amber-100 px-1 font-mono text-xs">lon</code>.
                </p>
              </div>
            </div>
          </div>

          {/* Billing link – données réelles */}
          <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-medium text-indigo-900">
                  Plan actuel : {member.subscription?.plan ?? '—'}
                </p>
                <p className="mt-1 text-sm text-indigo-700">
                  {(member.usage?.usedRequests ?? 0).toLocaleString('fr-FR')} requêtes ce mois
                </p>
              </div>
              {member.subscription ? (
                <button
                  type="button"
                  onClick={() => navigate('/api/billing')}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-white px-3 py-2 text-sm font-medium text-indigo-600 transition hover:bg-indigo-50"
                >
                  <CreditCard className="h-4 w-4" />
                  Abonnement
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => navigate('/api/billing')}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
                >
                  <CreditCard className="h-4 w-4" />
                  Souscrire
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}