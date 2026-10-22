// src/pages/ApiPlaygroundPage.tsx
import {
  AlertCircle,
  Check,
  ChevronLeft,
  Code2,
  Copy,
  CreditCard,
  Globe,
  Key,
  PlayCircle,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ApiDeveloperNav from '../features/api/components/ApiDeveloperNav';
import { EnvBadge, PlanBadge } from '../features/api/components/ApiStatusBadge';
import { useApiMember } from '../features/api/member/useApiMember';
import {
  API_BASE_URL,
  API_ENDPOINTS,
  API_GROUPES,
  endpointApi,
  exempleJson,
  formuleApi,
  libelleCredits,
  PHRASE_FACTURATION_API,
} from '../lib/api/catalogueApi';

// Tous les endpoints de l'API publique, avec leur coût et un corps d'exemple
// (source unique : src/lib/api/catalogueApi.ts).
const ENDPOINT_PAR_DEFAUT = API_ENDPOINTS[0];

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
  const [path, setPath] = useState<string>(ENDPOINT_PAR_DEFAUT.chemin);
  const [body, setBody] = useState(exempleJson(ENDPOINT_PAR_DEFAUT));
  const [reqLoading, setReqLoading] = useState(false);
  const [status, setStatus] = useState<number | null>(null);
  const [responseHeaders, setResponseHeaders] = useState<Record<string, string>>({});
  const [responseText, setResponseText] = useState('');

  // Clé API préremplie depuis les données réelles
  const activeKeys = (member?.keys ?? []).filter((k) => k.status === 'active');
  const hasKeys = activeKeys.length > 0;
  const defaultKey = activeKeys[0];

  // La clé complète n'est affichée qu'une fois, à sa création : on ne peut pas
  // la préremplir (seul son début est connu). L'utilisateur la colle ici.
  const [apiKey, setApiKey] = useState('');

  const fullUrl = useMemo(() => `${API_BASE_URL}${path}`, [path]);
  const selectedEndpoint = useMemo(() => endpointApi(path) ?? ENDPOINT_PAR_DEFAUT, [path]);
  const method = selectedEndpoint.methode;

  function choisirEndpoint(chemin: string) {
    setPath(chemin);
    const ep = endpointApi(chemin);
    setBody(ep ? exempleJson(ep) : '');
  }

  // ── Logique fetch ─────────────────────────────────────────────────────────
  async function handleSend() {
    setReqLoading(true);
    setStatus(null);
    setResponseText('');
    setResponseHeaders({});

    try {
      const res =
        method === 'GET'
          ? await fetch(fullUrl, { method, headers: { Authorization: `Bearer ${apiKey.trim()}` } })
          : await fetch(fullUrl, {
              method,
              headers: {
                Authorization: `Bearer ${apiKey.trim()}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(body.trim() ? JSON.parse(body) : {}),
            });
      const text = await res.text();
      setStatus(res.status);
      setResponseText(text);
      setResponseHeaders({
        'x-credits-cout': res.headers.get('x-credits-cout') ?? '',
        'x-credits-restants': res.headers.get('x-credits-restants') ?? '',
        'x-response-time': res.headers.get('x-response-time') ?? '',
        'content-type': res.headers.get('content-type') ?? '',
      });
    } catch (err) {
      setStatus(0);
      setResponseText(
        JSON.stringify(
          {
            erreur:
              err instanceof SyntaxError
                ? 'Le corps de la requête n’est pas un JSON valide.'
                : 'La requête n’a pas pu être envoyée. Vérifiez votre connexion.',
          },
          null,
          2,
        )
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
              onClick={() => navigate('/api#tarifs-api')}
              className="rounded-xl border border-amber-200 bg-white px-4 py-2 text-sm font-medium text-amber-700 transition hover:bg-amber-50"
            >
              <CreditCard className="mr-1.5 inline h-4 w-4" />
              Formules
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
              <p className="text-slate-500">Testez vos appels en direct avec votre clé API. Chaque appel réussi consomme des crédits.</p>
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
            <div className="mt-1 max-w-xs truncate font-mono text-sm text-slate-800">{API_BASE_URL}</div>
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
            <label className="mt-4 block text-sm font-medium text-slate-700">Clé API complète</label>
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
            {hasKeys && (
              <p className="mt-2 text-xs text-slate-500">
                Collez la clé copiée lors de sa création (vos clés :{' '}
                {activeKeys.map((k) => `${k.name} — ${k.prefix}…`).join(', ')}). Une clé perdue se remplace par une
                nouvelle.
              </p>
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
                <select
                  value={path}
                  onChange={(e) => choisirEndpoint(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-mono text-sm text-slate-800 outline-none transition focus:border-indigo-400"
                >
                  {API_GROUPES.map((g) => {
                    const eps = API_ENDPOINTS.filter((ep) => ep.groupe === g.id);
                    if (eps.length === 0) return null;
                    return (
                      <optgroup key={g.id} label={g.libelle}>
                        {eps.map((ep) => (
                          <option key={ep.chemin} value={ep.chemin}>
                            {ep.chemin} — {ep.titre} ({libelleCredits(ep.credits)})
                            {ep.statut === 'beta' ? ' · bêta' : ''}
                          </option>
                        ))}
                      </optgroup>
                    );
                  })}
                </select>
                <p className="mt-1.5 text-xs text-slate-500">{selectedEndpoint.description}</p>
                <p className="mt-1 text-xs text-slate-500">
                  Coût : <span className="font-semibold">{libelleCredits(selectedEndpoint.credits)}</span>
                  {selectedEndpoint.credits > 0 && ' par appel réussi'}
                  {selectedEndpoint.statut === 'beta' && ' · endpoint en bêta, sa réponse peut encore évoluer'}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Corps JSON (exemple modifiable)</label>
                <textarea
                  value={method === 'GET' ? '' : body}
                  onChange={(e) => setBody(e.target.value)}
                  disabled={method === 'GET'}
                  placeholder={method === 'GET' ? 'Pas de corps pour une requête GET' : undefined}
                  rows={12}
                  spellCheck={false}
                  className="mt-2 w-full rounded-xl border border-slate-300 bg-slate-950 px-4 py-3 font-mono text-sm text-emerald-300 outline-none transition focus:border-indigo-400 disabled:opacity-60"
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
                  text={
                    method === 'GET'
                      ? `curl ${fullUrl} \\\n  -H "Authorization: Bearer ${apiKey || 'mk_live_xxx'}"`
                      : `curl -X POST ${fullUrl} \\\n  -H "Authorization: Bearer ${apiKey || 'mk_live_xxx'}" \\\n  -H "Content-Type: application/json" \\\n  -d '${body}'`
                  }
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
                ['X-Credits-Cout',     responseHeaders['x-credits-cout']],
                ['X-Credits-Restants', responseHeaders['x-credits-restants']],
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

          {/* Facturation */}
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              <div>
                <div className="font-medium text-amber-900">Comment les crédits sont décomptés</div>
                <p className="mt-1 text-sm text-amber-800">{PHRASE_FACTURATION_API}</p>
              </div>
            </div>
          </div>

          {/* Billing link – données réelles */}
          <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-medium text-indigo-900">
                  Formule actuelle : {formuleApi(member.subscription.plan).nom}
                </p>
                <p className="mt-1 text-sm text-indigo-700">
                  {(member.usage?.usedRequests ?? 0).toLocaleString('fr-FR')} crédits consommés ce mois
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate('/api#tarifs-api')}
                className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-white px-3 py-2 text-sm font-medium text-indigo-600 transition hover:bg-indigo-50"
              >
                <CreditCard className="h-4 w-4" />
                Formules
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}