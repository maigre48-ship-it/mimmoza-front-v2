import type { BillingMode } from '../member/apiPlans';

interface ApiBillingToggleProps {
  mode: BillingMode;
  onChange: (mode: BillingMode) => void;
  annualSaving?: number;
}

export default function ApiBillingToggle({
  mode,
  onChange,
  annualSaving,
}: ApiBillingToggleProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Pay as you go pill */}
      <button
        type="button"
        onClick={() => onChange('payg')}
        className={`rounded-xl border px-4 py-2 text-sm font-medium transition-all ${
          mode === 'payg'
            ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
            : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700'
        }`}
      >
        Pay as you go
      </button>

      {/* Monthly / Annual toggle */}
      <div className="flex items-center rounded-xl border border-slate-200 bg-slate-50 p-1">
        <button
          type="button"
          onClick={() => onChange('monthly')}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${
            mode === 'monthly'
              ? 'bg-white text-indigo-600 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Mensuel
        </button>
        <button
          type="button"
          onClick={() => onChange('annual')}
          className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${
            mode === 'annual'
              ? 'bg-white text-indigo-600 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Annuel
          {annualSaving !== undefined && (
            <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
              -{annualSaving}%
            </span>
          )}
        </button>
      </div>
    </div>
  );
}