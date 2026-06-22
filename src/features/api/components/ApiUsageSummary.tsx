import { Calendar, Settings, TrendingUp } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { ApiSubscriptionData, ApiUsageData } from '../member/useApiMember';
import { formatRequests } from '../member/apiMemberMock';
import { PlanBadge } from './ApiStatusBadge';

interface ApiUsageSummaryProps {
  subscription: ApiSubscriptionData;
  usage: ApiUsageData;
  showActions?: boolean;
}

const MODE_LABEL: Record<string, string> = {
  payg: 'Pay as you go',
  monthly: 'Mensuel',
  annual: 'Annuel',
};

export default function ApiUsageSummary({
  subscription,
  usage,
  showActions = true,
}: ApiUsageSummaryProps) {
  const navigate = useNavigate();
  const pct =
    usage.totalRequests > 0
      ? Math.min(100, Math.round((usage.usedRequests / usage.totalRequests) * 100))
      : 0;
  const renewalDate = subscription.currentPeriodEnd
    ? new Date(subscription.currentPeriodEnd).toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null;

  const barColor =
    pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-400' : 'bg-indigo-600';

  return (
    <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
        {/* Plan */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
            Plan API
          </span>
          <div className="flex items-center gap-2">
            <PlanBadge plan={subscription.plan} />
            <span className="text-xs text-slate-500">
              {MODE_LABEL[subscription.billingMode]}
            </span>
          </div>
        </div>

        <div className="h-8 w-px shrink-0 bg-slate-200" />

        {/* Quota bar */}
        <div className="flex min-w-[180px] flex-1 flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
              <TrendingUp className="h-3 w-3" />
              Quota
            </span>
            <span className="font-mono text-xs text-slate-600">
              {formatRequests(usage.usedRequests)}
              <span className="text-slate-400"> / {formatRequests(usage.totalRequests)}</span>
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
            <div
              className={`h-full rounded-full transition-all ${barColor}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {renewalDate && (
          <>
            <div className="h-8 w-px shrink-0 bg-slate-200" />
            <div className="flex flex-col gap-1">
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                <Calendar className="h-3 w-3" />
                Prochain renouvellement
              </span>
              <span className="font-mono text-sm font-semibold text-slate-700">
                {renewalDate}
              </span>
            </div>
          </>
        )}

        {showActions && (
          <div className="ml-auto">
            <button
              type="button"
              onClick={() => navigate('/api/billing')}
              className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-white px-3 py-2 text-sm font-medium text-indigo-600 transition-all hover:bg-indigo-50"
            >
              <Settings className="h-3.5 w-3.5" />
              Gérer l&apos;abonnement
            </button>
          </div>
        )}
      </div>
    </div>
  );
}