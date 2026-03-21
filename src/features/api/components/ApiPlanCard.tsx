import { Check, Plus } from 'lucide-react';
import type { ApiPlan, BillingMode, PlanTier } from '../member/apiPlans';
import { getDisplayPrice, getAnnualSavingPercent } from '../member/apiPlans';
import { formatRequests } from '../member/apiMemberMock';
import { ApiStatusBadge } from './ApiStatusBadge';

type PlanCardAction = 'current' | 'upgrade' | 'downgrade' | 'contact' | 'subscribe';

interface ApiPlanCardProps {
  plan: ApiPlan;
  mode: BillingMode;
  currentPlan?: PlanTier;
  onAction: (planId: PlanTier, action: PlanCardAction) => void;
}

const TIER_ORDER: PlanTier[] = ['free', 'starter', 'growth', 'scale'];

function resolveAction(
  plan: ApiPlan,
  currentPlan: PlanTier | undefined,
): PlanCardAction {
  if (!currentPlan || currentPlan === 'free') return 'subscribe';
  if (plan.id === currentPlan) return 'current';
  if (plan.contactSales) return 'contact';
  const ci = TIER_ORDER.indexOf(currentPlan);
  const pi = TIER_ORDER.indexOf(plan.id);
  return pi > ci ? 'upgrade' : 'downgrade';
}

const ACTION_LABELS: Record<PlanCardAction, string> = {
  current:   'Plan actuel',
  upgrade:   'Passer à ce plan →',
  downgrade: 'Rétrograder',
  contact:   "Contacter l'équipe commerciale →",
  subscribe: 'Commencer →',
};

export default function ApiPlanCard({
  plan,
  mode,
  currentPlan,
  onAction,
}: ApiPlanCardProps) {
  const action = resolveAction(plan, currentPlan);
  const price = mode === 'payg' ? plan.monthlyPrice : getDisplayPrice(plan, mode);
  const saving = getAnnualSavingPercent(plan);
  const isCurrent = action === 'current';
  const isHighlighted = plan.highlighted && !isCurrent;

  return (
    <div
      className={`relative flex flex-col rounded-3xl border p-6 shadow-sm transition-all ${
        isCurrent
          ? 'border-indigo-300 bg-indigo-50/50 ring-1 ring-indigo-200'
          : isHighlighted
          ? 'border-indigo-200 bg-white ring-1 ring-indigo-100 shadow-lg'
          : 'border-slate-200 bg-white'
      }`}
    >
      {/* Badges row */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {isCurrent && <ApiStatusBadge variant="current" />}
        {isHighlighted && <ApiStatusBadge variant="recommended" />}
        {mode === 'annual' && !isCurrent && (
          <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
            -{saving}% annuel
          </span>
        )}
      </div>

      {/* Plan name */}
      <h3 className="text-xl font-bold tracking-tight text-slate-900">{plan.name}</h3>
      <p className="mt-1 text-sm text-slate-500">{plan.tagline}</p>

      {/* Price */}
      <div className="my-5 flex items-end gap-1.5">
        <span className="text-4xl font-extrabold tracking-tight text-slate-900">
          {price}€
        </span>
        <span className="mb-1 text-sm text-slate-400">
          HT / mois
          {mode === 'annual' && (
            <span className="ml-1 text-emerald-600">· facturé annuellement</span>
          )}
        </span>
      </div>

      {/* Quota highlight */}
      <div className="mb-5 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-500">Requêtes incluses</span>
          <span className="font-mono text-sm font-semibold text-slate-800">
            {formatRequests(plan.requestsIncluded)} / mois
          </span>
        </div>
      </div>

      {/* Features */}
      <ul className="mb-6 space-y-2.5">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2.5 text-sm text-slate-600">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
            {f}
          </li>
        ))}
        <li className="flex items-start gap-2.5 text-sm text-slate-400">
          <Plus className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
          Dépassement : {plan.overagePerK}€ / 1k req.
        </li>
      </ul>

      {/* CTA */}
      <div className="mt-auto">
        <button
          type="button"
          onClick={() => onAction(plan.id, action)}
          disabled={isCurrent}
          className={`w-full rounded-2xl py-2.5 text-sm font-semibold transition-all ${
            isCurrent
              ? 'cursor-default border border-indigo-200 text-indigo-400'
              : isHighlighted
              ? 'bg-indigo-600 text-white hover:bg-indigo-700'
              : action === 'contact'
              ? 'border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
              : 'border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
          }`}
        >
          {ACTION_LABELS[action]}
        </button>
      </div>
    </div>
  );
}