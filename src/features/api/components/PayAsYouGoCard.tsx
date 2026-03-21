import { Zap, Check } from 'lucide-react';
import { PAY_AS_YOU_GO } from '../member/apiPlans';
import type { PlanTier } from '../member/apiPlans';

interface PayAsYouGoCardProps {
  currentPlan: PlanTier;
  currentMode: string;
  onActivate: () => void;
}

export default function PayAsYouGoCard({
  currentMode,
  onActivate,
}: PayAsYouGoCardProps) {
  const isActive = currentMode === 'payg';

  return (
    <div
      className={`rounded-3xl border p-6 shadow-sm ${
        isActive
          ? 'border-cyan-200 bg-cyan-50/50 ring-1 ring-cyan-100'
          : 'border-slate-200 bg-white'
      }`}
    >
      {/* Header */}
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-cyan-100">
            <Zap className="h-5 w-5 text-cyan-600" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900">Pay as you go</h3>
            <p className="text-sm text-slate-500">Payez uniquement ce que vous consommez</p>
          </div>
        </div>
        {isActive && (
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            Actif
          </span>
        )}
      </div>

      {/* Price */}
      <div className="mb-5 rounded-2xl border border-cyan-100 bg-cyan-50 px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <span className="text-3xl font-extrabold tracking-tight text-cyan-700">
              {PAY_AS_YOU_GO.pricePerK}€
            </span>
            <span className="ml-2 text-sm text-slate-500">/ 1 000 requêtes</span>
          </div>
          <div className="flex gap-5">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Rate limit
              </p>
              <p className="font-mono text-sm font-semibold text-slate-700">
                {PAY_AS_YOU_GO.rateLimit} req/min
              </p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Clés max
              </p>
              <p className="font-mono text-sm font-semibold text-slate-700">
                {PAY_AS_YOU_GO.maxKeys}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Features */}
      <ul className="mb-6 space-y-2">
        {[
          'Aucun engagement, aucun abonnement',
          'Idéal pour prototypes et petits volumes',
          'Facturation en fin de mois',
          'Accès immédiat sans configuration',
        ].map((f) => (
          <li key={f} className="flex items-center gap-2.5 text-sm text-slate-600">
            <Check className="h-4 w-4 shrink-0 text-cyan-500" />
            {f}
          </li>
        ))}
      </ul>

      {/* CTA */}
      <button
        type="button"
        onClick={onActivate}
        disabled={isActive}
        className={`w-full rounded-2xl py-2.5 text-sm font-semibold transition-all ${
          isActive
            ? 'cursor-default border border-cyan-200 text-cyan-500'
            : 'border border-cyan-300 bg-cyan-50 text-cyan-700 hover:bg-cyan-100'
        }`}
      >
        {isActive ? 'Mode actuel' : 'Passer en Pay as you go →'}
      </button>
    </div>
  );
}