// ── PlanBadge ──────────────────────────────────────────────────────────────
import type { PlanTier, BillingMode } from '../member/apiPlans';
import type { PlanEnvironment } from '../member/apiMemberMock';

const PLAN_STYLES: Record<PlanTier, string> = {
  free:    'bg-slate-100 text-slate-600 border-slate-200',
  starter: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  growth:  'bg-indigo-50 text-indigo-700 border-indigo-200',
  scale:   'bg-amber-50 text-amber-700 border-amber-200',
};

const PLAN_LABELS: Record<PlanTier, string> = {
  free: 'Free', starter: 'Starter', growth: 'Growth', scale: 'Scale',
};

interface PlanBadgeProps {
  plan: PlanTier;
  mode?: BillingMode;
  size?: 'sm' | 'md';
}

export function PlanBadge({ plan, mode, size = 'md' }: PlanBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-mono font-semibold ${
        size === 'sm' ? 'text-[10px]' : 'text-xs'
      } ${PLAN_STYLES[plan]}`}
    >
      {PLAN_LABELS[plan]}
      {mode && mode !== 'payg' && (
        <span className="font-normal opacity-60">
          {mode === 'annual' ? '/ an' : '/ mois'}
        </span>
      )}
    </span>
  );
}

// ── EnvBadge ──────────────────────────────────────────────────────────────
interface EnvBadgeProps {
  env: PlanEnvironment;
  size?: 'sm' | 'md';
}

export function EnvBadge({ env, size = 'md' }: EnvBadgeProps) {
  const isLive = env === 'live';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono font-semibold uppercase ${
        size === 'sm' ? 'text-[10px]' : 'text-[11px]'
      } ${
        isLive
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : 'border-slate-200 bg-slate-100 text-slate-600'
      }`}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          isLive ? 'bg-emerald-500' : 'bg-slate-400'
        }`}
      />
      {env}
    </span>
  );
}

// ── ApiStatusBadge ─────────────────────────────────────────────────────────
type StatusVariant =
  | 'active' | 'revoked'
  | 'operational' | 'degraded' | 'incident'
  | 'current' | 'recommended';

const STATUS_STYLES: Record<StatusVariant, string> = {
  active:      'border-emerald-200 bg-emerald-50 text-emerald-700',
  revoked:     'border-red-200 bg-red-50 text-red-600',
  operational: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  degraded:    'border-amber-200 bg-amber-50 text-amber-700',
  incident:    'border-red-200 bg-red-50 text-red-600',
  current:     'border-indigo-200 bg-indigo-50 text-indigo-700',
  recommended: 'border-cyan-200 bg-cyan-50 text-cyan-700',
};

const STATUS_DOT: Record<StatusVariant, string | null> = {
  active: 'bg-emerald-500', revoked: 'bg-red-400',
  operational: 'bg-emerald-500', degraded: 'bg-amber-400', incident: 'bg-red-400',
  current: null, recommended: null,
};

const STATUS_LABELS: Record<StatusVariant, string> = {
  active: 'Active', revoked: 'Révoquée',
  operational: 'Opérationnel', degraded: 'Dégradé', incident: 'Incident',
  current: 'Plan actuel', recommended: 'Recommandé',
};

interface ApiStatusBadgeProps {
  variant: StatusVariant;
  label?: string;
  size?: 'sm' | 'md';
}

export function ApiStatusBadge({ variant, label, size = 'md' }: ApiStatusBadgeProps) {
  const dot = STATUS_DOT[variant];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-semibold ${
        size === 'sm' ? 'text-[10px]' : 'text-xs'
      } ${STATUS_STYLES[variant]}`}
    >
      {dot && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />}
      {label ?? STATUS_LABELS[variant]}
    </span>
  );
}

// ── StatusCodeChip ─────────────────────────────────────────────────────────
export function StatusCodeChip({ code }: { code: number }) {
  const is2xx = code >= 200 && code < 300;
  const is4xx = code >= 400 && code < 500;
  return (
    <span
      className={`rounded-md px-2 py-0.5 font-mono text-xs font-semibold ${
        is2xx
          ? 'bg-emerald-50 text-emerald-700'
          : is4xx
          ? 'bg-amber-50 text-amber-700'
          : 'bg-red-50 text-red-600'
      }`}
    >
      {code}
    </span>
  );
}