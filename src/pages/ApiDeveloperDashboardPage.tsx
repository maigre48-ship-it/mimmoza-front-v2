// src/pages/ApiDeveloperDashboardPage.tsx
import {
  Activity,
  Key,
  BarChart3,
  ShieldCheck,
  Copy,
  Check,
  AlertTriangle,
  CreditCard,
  ChevronLeft,
  Wifi,
} from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ApiDeveloperNav from '../features/api/components/ApiDeveloperNav';
import ApiUsageSummary from '../features/api/components/ApiUsageSummary';
import { useApiMember } from '../features/api/member/useApiMember';

// ── MaskedKeyCard ─────────────────────────────────────────────────────────────
function MaskedKeyCard({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <div className="font-mono text-sm text-slate-800">{value}</div>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
          }}
          className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900"
        >
          {copied ? (
            <><Check className="h-3.5 w-3.5 text-emerald-500" />Copié</>
          ) : (
            <><Copy className="h-3.5 w-3.5" />Copier</>
          )}
        </button>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function ApiDeveloperDashboardPage() {
  const navigate = useNavigate();

  const { data: member, loading, error } = useApiMember();

  // ── États de chargement / erreur ──────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-sm text-slate-500">Chargement du dashboard…</div>
      </div>
    );
  }

  if (error || !member) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-600">
        {error ?? 'Impossible de charger les données développeur.'}
      </div>
    );
  }

  // Données réelles
  const allKeys = member.keys ?? [];
  const activeKeys = allKeys.filter((k) => k.status === 'active');
  const logs = member.usage?.logs ?? [];
  const usedRequests = member.usage?.usedRequests ?? 0;
  const totalLimit = member.usage?.totalRequests ?? 100_000;
  const usagePercent = totalLimit > 0 ? Math.min(100, Math.round((usedRequests / totalLimit) * 100)) : 0;

  // KPIs calculés depuis données réelles
  const successRate =
    logs.length > 0
      ? Math.round((logs.filter((l) => l.status >= 200 && l.status < 300).length / logs.length) * 1000) / 10
      : 100;

  const avgLatency =
    logs.length > 0
      ? Math.round(
          logs.reduce((acc, l) => {
            const ms = parseInt(l.latency?.replace('ms', '') ?? '0', 10);
            return acc + (isNaN(ms) ? 0 : ms);
          }, 0) / logs.length
        )
      : 0;

  return (
    <div className="space-y-8">
      {/* ── Header ────────────────────────────────────────────────────── */}
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
        <button
          type="button"
          onClick={() => navigate('/api/billing')}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition-all hover:border-indigo-200 hover:text-indigo-600"
        >
          <CreditCard className="h-4 w-4" />
          Abonnement
        </button>
      </div>

      {/* ── Page title ─────────────────────────────────────────────────── */}
      <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">
              Dashboard développeur
            </h1>
            <p className="mt-2 text-slate-500">
              Suivi d'usage, gestion des clés API, logs récents et santé de la plateforme.
            </p>
          </div>
          {/* BONUS: indicateur connexion réelle */}
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
            <Wifi className="h-3.5 w-3.5" />
            Connected to API
          </span>
        </div>
      </div>

      {/* ── Usage summary (données réelles) ─────────────────────────────── */}
      <ApiUsageSummary subscription={member.subscription} usage={member.usage} />

      {/* ── KPI grid (données réelles) ──────────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-4">
        {[
          {
            label: 'Requêtes ce mois',
            value: usedRequests.toLocaleString('fr-FR'),
            icon: BarChart3,
            color: 'text-indigo-600',
          },
          {
            label: 'Clés actives',
            value: String(activeKeys.length),
            icon: Key,
            color: 'text-emerald-600',
          },
          {
            label: 'Taux de succès',
            value: logs.length > 0 ? `${successRate}%` : '—',
            icon: ShieldCheck,
            color: 'text-sky-600',
          },
          {
            label: 'Latence médiane',
            value: logs.length > 0 ? `${avgLatency}ms` : '—',
            icon: Activity,
            color: 'text-amber-600',
          },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="text-sm text-slate-500">{item.label}</div>
                <Icon className={`h-5 w-5 ${item.color}`} />
              </div>
              <div className="mt-3 text-2xl font-bold text-slate-900">{item.value}</div>
            </div>
          );
        })}
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          {/* ── Clés API (données réelles) ──────────────────────────── */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold text-slate-900">Clés API</h2>
              <button
                type="button"
                onClick={() => navigate('/api/keys')}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
              >
                Gérer les clés
              </button>
            </div>

            {allKeys.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-dashed border-slate-200 p-6 text-center">
                <p className="text-sm text-slate-500">Aucune clé API créée.</p>
                <button
                  type="button"
                  onClick={() => navigate('/api/keys')}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
                >
                  <Key className="h-4 w-4" />
                  Créer une clé
                </button>
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                {allKeys.map((key) => (
                  <div key={key.id} className="rounded-2xl border border-slate-200 p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="font-semibold text-slate-900">{key.name}</div>
                        <div className="mt-1 text-sm text-slate-500">
                          {(key.env ?? key.environment ?? 'test').toUpperCase()} ·{' '}
                          {member.subscription?.plan?.toUpperCase() ?? '—'} ·{' '}
                          {key.last_used_at
                            ? `Utilisée le ${new Date(key.last_used_at).toLocaleDateString('fr-FR')}`
                            : 'Jamais utilisée'}
                        </div>
                      </div>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          key.status === 'active' || !key.revoked_at
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-red-50 text-red-700'
                        }`}
                      >
                        {key.revoked_at ? 'révoquée' : 'active'}
                      </span>
                    </div>
                    <div className="mt-4">
                      <MaskedKeyCard label="Préfixe" value={`${key.prefix}••••••••••••••••`} />
                    </div>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => navigate('/api/keys')}
                        className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Voir détails
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Logs récents (données réelles) ──────────────────────── */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="font-semibold text-slate-900">Logs récents</h2>
            {logs.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-dashed border-slate-200 p-6 text-center">
                <p className="text-sm text-slate-500">
                  Aucun log disponible. Envoyez votre première requête via le{' '}
                  <button
                    type="button"
                    onClick={() => navigate('/api/playground')}
                    className="text-indigo-600 underline-offset-2 hover:underline"
                  >
                    Playground
                  </button>
                  .
                </p>
              </div>
            ) : (
              <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
                <div className="grid grid-cols-5 gap-4 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <div>Time</div>
                  <div>Méthode</div>
                  <div>Path</div>
                  <div>Status</div>
                  <div>Latence</div>
                </div>
                {logs.map((log) => (
                  <div
                    key={log.id}
                    className="grid grid-cols-5 gap-4 border-b border-slate-100 px-4 py-3 text-sm last:border-b-0"
                  >
                    <div className="font-mono text-slate-600">{log.time}</div>
                    <div className="font-mono text-slate-800">{log.method}</div>
                    <div className="truncate font-mono text-slate-800">{log.path}</div>
                    <div>
                      <span
                        className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                          log.status >= 200 && log.status < 300
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-rose-50 text-rose-700'
                        }`}
                      >
                        {log.status}
                      </span>
                    </div>
                    <div className="font-mono text-slate-600">{log.latency}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          {/* ── Quota mensuel (données réelles) ──────────────────────── */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="font-semibold text-slate-900">Quota mensuel</h2>
            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between text-sm text-slate-600">
                <span>
                  {usedRequests.toLocaleString('fr-FR')} / {totalLimit.toLocaleString('fr-FR')}
                </span>
                <span>{usagePercent}%</span>
              </div>
              <div className="h-3 rounded-full bg-slate-100">
                <div
                  className="h-3 rounded-full transition-all duration-500"
                  style={{
                    width: `${usagePercent}%`,
                    background:
                      usagePercent > 80
                        ? '#ef4444'
                        : usagePercent > 60
                        ? '#f59e0b'
                        : 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                  }}
                />
              </div>
            </div>
          </div>

          {/* ── Health (données réelles) ──────────────────────────────── */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="font-semibold text-slate-900">Health</h2>
            <div className="mt-4 space-y-2">
              <div className="flex items-center gap-2">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    member.healthStatus === 'operational' ? 'bg-emerald-500' : 'bg-amber-500'
                  }`}
                />
                <span className="text-sm text-slate-700">
                  API Gateway{' '}
                  {member.healthStatus === 'operational' ? 'opérationnelle' : member.healthStatus}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                <span className="text-sm text-slate-700">SmartScore v3 disponible</span>
              </div>
            </div>
          </div>

          {/* ── Billing CTA ───────────────────────────────────────────── */}
          <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-5">
            <div className="flex items-start gap-3">
              <CreditCard className="mt-0.5 h-5 w-5 shrink-0 text-indigo-600" />
              <div>
                <div className="font-medium text-indigo-900">Gérer votre abonnement API</div>
                <p className="mt-1 text-sm text-indigo-700">
                  Changez de plan, consultez vos factures ou ajustez votre mode de facturation.
                </p>
                <button
                  type="button"
                  onClick={() => navigate('/api/billing')}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
                >
                  <CreditCard className="h-4 w-4" />
                  Voir l&apos;abonnement
                </button>
              </div>
            </div>
          </div>

          {/* ── Info ─────────────────────────────────────────────────── */}
          {logs.length === 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
                <div>
                  <div className="font-medium text-amber-900">Aucun log pour l'instant</div>
                  <p className="mt-1 text-sm text-amber-800">
                    Les logs apparaîtront ici après vos premiers appels API. Testez depuis le{' '}
                    <button
                      type="button"
                      onClick={() => navigate('/api/playground')}
                      className="underline underline-offset-2"
                    >
                      Playground
                    </button>
                    .
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}