import { Calendar, Settings, TrendingUp, Zap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { ApiCompte } from '../../../lib/api/apiCompte';
import type { ApiSubscriptionData, ApiUsageData } from '../member/useApiMember';
import { formatRequests } from '../member/apiMemberMock';
import { PlanBadge } from './ApiStatusBadge';

interface ApiUsageSummaryProps {
  subscription: ApiSubscriptionData;
  usage: ApiUsageData;
  /** Solde du compte (RPC api_mon_compte), s'il est disponible. */
  compte?: ApiCompte | null;
  showActions?: boolean;
}

const MODE_LABEL: Record<string, string> = {
  monthly: 'Mensuel',
  annual: 'Annuel',
};

function dateLongue(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function ApiUsageSummary({
  subscription,
  usage,
  compte,
  showActions = true,
}: ApiUsageSummaryProps) {
  const navigate = useNavigate();
  const utilises = compte ? compte.creditsUtilises : usage.usedRequests;
  const total = compte ? compte.creditsMois : usage.totalRequests;
  const pct = total > 0 ? Math.min(100, Math.round((utilises / total) * 100)) : 0;
  const essai = (compte?.plan ?? subscription.plan) === 'essai';
  const echeance = essai ? dateLongue(compte?.essaiExpireLe) : dateLongue(subscription.currentPeriodEnd);

  const barColor = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-400' : 'bg-indigo-600';

  return (
    <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Formule API</span>
          <div className="flex items-center gap-2">
            <PlanBadge plan={compte?.plan ?? subscription.plan} />
            {!essai && <span className="text-xs text-slate-500">{MODE_LABEL[subscription.billingMode]}</span>}
          </div>
        </div>

        <div className="h-8 w-px shrink-0 bg-slate-200" />

        <div className="flex min-w-[180px] flex-1 flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
              <TrendingUp className="h-3 w-3" />
              {essai ? "Crédits de l'essai" : 'Crédits du mois'}
            </span>
            <span className="font-mono text-xs text-slate-600">
              {formatRequests(utilises)}
              <span className="text-slate-400"> / {formatRequests(total)}</span>
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
            <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
          </div>
        </div>

        {compte && compte.creditsRecharge > 0 && (
          <>
            <div className="h-8 w-px shrink-0 bg-slate-200" />
            <div className="flex flex-col gap-1">
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                <Zap className="h-3 w-3" />
                Recharge
              </span>
              <span className="font-mono text-sm font-semibold text-slate-700">
                {compte.creditsRecharge.toLocaleString('fr-FR')} crédits
              </span>
            </div>
          </>
        )}

        {echeance && (
          <>
            <div className="h-8 w-px shrink-0 bg-slate-200" />
            <div className="flex flex-col gap-1">
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                <Calendar className="h-3 w-3" />
                {essai ? "Fin de l'essai" : 'Prochain renouvellement'}
              </span>
              <span className="font-mono text-sm font-semibold text-slate-700">{echeance}</span>
            </div>
          </>
        )}

        {showActions && (
          <div className="ml-auto">
            <button
              type="button"
              onClick={() => navigate('/api#tarifs-api')}
              className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-white px-3 py-2 text-sm font-medium text-indigo-600 transition-all hover:bg-indigo-50"
            >
              <Settings className="h-3.5 w-3.5" />
              Voir les formules
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
