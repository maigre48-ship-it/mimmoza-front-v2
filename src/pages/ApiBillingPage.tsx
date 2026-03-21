// src/pages/ApiBillingPage.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, HelpCircle, ChevronDown, ChevronUp, ArrowRight } from 'lucide-react';
import { BillingMode, API_PLANS, getAnnualSavingPercent, PlanTier } from '../features/api/member/apiPlans';
import ApiBillingToggle from '../features/api/components/ApiBillingToggle';
import ApiPlanCard from '../features/api/components/ApiPlanCard';
import PayAsYouGoCard from '../features/api/components/PayAsYouGoCard';
import ApiDeveloperNav from '../features/api/components/ApiDeveloperNav';
import ApiUsageSummary from '../features/api/components/ApiUsageSummary';
import { useApiMember } from '../features/api/member/useApiMember';

const FAQ_ITEMS = [
  {
    q: "Puis-je changer de plan à tout moment ?",
    a: "Oui. Les upgrades prennent effet immédiatement. Les downgrades sont effectifs au prochain cycle de facturation.",
  },
  {
    q: "Comment fonctionne la facturation annuelle ?",
    a: "Vous êtes facturé pour 12 mois en avance, avec une réduction appliquée automatiquement. Aucun remboursement partiel en cas de résiliation anticipée.",
  },
  {
    q: "Que se passe-t-il si je dépasse mon quota ?",
    a: "L'API continue de fonctionner. Les requêtes supplémentaires sont facturées en fin de mois selon le tarif de dépassement de votre plan.",
  },
  {
    q: "Puis-je avoir plusieurs clés API ?",
    a: "Oui, dans la limite de votre plan. Vous pouvez créer des clés dédiées par environnement (test / live) ou par service.",
  },
];

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={`overflow-hidden rounded-2xl border transition-colors ${
        open ? 'border-indigo-200' : 'border-slate-200'
      } bg-white`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <span className="font-medium text-slate-900">{q}</span>
        {open ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-slate-400" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
        )}
      </button>
      {open && (
        <div className="border-t border-slate-100 px-5 py-4 text-sm leading-relaxed text-slate-600">
          {a}
        </div>
      )}
    </div>
  );
}

export default function ApiBillingPage() {
  const navigate = useNavigate();

  // Données réelles Supabase
  const { data: member, loading, error } = useApiMember();

  // Initialiser le mode de facturation depuis le plan réel (fallback 'monthly')
  const [billingMode, setBillingMode] = useState<BillingMode>(
    member?.subscription?.billingMode ?? 'monthly'
  );

  const maxSaving = Math.max(...API_PLANS.map(getAnnualSavingPercent));

  const handlePlanAction = (planId: PlanTier, action: string) => {
    if (action === 'contact') {
      window.open('mailto:api@mimmoza.fr?subject=Offre Scale API', '_blank');
      return;
    }
    // TODO: brancher Stripe checkout
    console.log('[Billing] action:', action, 'plan:', planId, 'mode:', billingMode);
  };

  // ── États de chargement / erreur ──────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-sm text-slate-500">Chargement de l'abonnement…</div>
      </div>
    );
  }

  if (error || !member) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-600">
        {error ?? 'Impossible de charger les données d'abonnement.'}
      </div>
    );
  }

  // Plan actuel réel
  const currentPlan = member.subscription?.plan ?? 'free';
  const currentMode = member.subscription?.billingMode ?? 'monthly';

  return (
    <div className="space-y-8">
      {/* ── Header ──────────────────────────────────────────────────── */}
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
        <div />
      </div>

      {/* ── Page hero ───────────────────────────────────────────────── */}
      <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">
              Abonnement API
            </h1>
            <p className="mt-2 max-w-lg text-slate-500">
              Accédez à l&apos;intelligence immobilière Mimmoza via API. Tarification transparente,
              sans engagement caché.
            </p>
          </div>
          {/* Plan actuel badge */}
          {member.subscription && (
            <div className="rounded-2xl border border-indigo-100 bg-indigo-50 px-5 py-3">
              <div className="text-xs uppercase tracking-wide text-indigo-400">Plan actuel</div>
              <div className="mt-1 text-lg font-bold text-indigo-700 capitalize">
                {currentPlan}
              </div>
              <div className="text-xs text-indigo-500 capitalize">{currentMode}</div>
            </div>
          )}
        </div>
      </div>

      {/* ── Usage summary (données réelles) ──────────────────────────── */}
      <ApiUsageSummary subscription={member.subscription} usage={member.usage} showActions={false} />

      {/* ── CTA si aucun abonnement ───────────────────────────────────── */}
      {!member.subscription && (
        <div className="flex items-center gap-4 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
          <HelpCircle className="h-5 w-5 shrink-0 text-amber-600" />
          <div className="flex-1">
            <p className="font-medium text-amber-900">Aucun abonnement actif</p>
            <p className="text-sm text-amber-700">
              Choisissez un plan ci-dessous pour activer l&apos;accès à l&apos;API.
            </p>
          </div>
        </div>
      )}

      {/* ── Billing mode toggle ──────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900">Formules disponibles</h2>
          <p className="mt-1 text-sm text-slate-500">
            Économisez jusqu&apos;à{' '}
            <span className="font-semibold text-emerald-600">{maxSaving}%</span> avec la facturation
            annuelle.
          </p>
        </div>
        <ApiBillingToggle mode={billingMode} onChange={setBillingMode} annualSaving={maxSaving} />
      </div>

      {/* ── Plans ────────────────────────────────────────────────────── */}
      {billingMode === 'payg' ? (
        <div className="grid gap-6 md:grid-cols-2">
          <PayAsYouGoCard
            currentPlan={currentPlan}
            currentMode={currentMode}
            onActivate={() => handlePlanAction('free', 'payg')}
          />
          {/* Upsell teaser */}
          <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-100 text-2xl">
              📈
            </div>
            <h3 className="text-lg font-bold text-slate-900">Volumes croissants ?</h3>
            <p className="mt-2 max-w-xs text-sm text-slate-500">
              Passez à un abonnement et économisez dès 10 000 requêtes / mois.
            </p>
            <button
              type="button"
              onClick={() => setBillingMode('monthly')}
              className="mt-4 inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-white px-4 py-2.5 text-sm font-semibold text-indigo-600 transition hover:bg-indigo-50"
            >
              Voir les abonnements <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          {API_PLANS.map((plan) => (
            <ApiPlanCard
              key={plan.id}
              plan={plan}
              mode={billingMode}
              currentPlan={currentPlan}
              onAction={handlePlanAction}
            />
          ))}
        </div>
      )}

      {/* ── Overage info ────────────────────────────────────────────── */}
      {billingMode !== 'payg' && (
        <div className="flex items-start gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <HelpCircle className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />
          <div>
            <p className="font-medium text-slate-900">Requêtes supplémentaires</p>
            <p className="mt-1 text-sm text-slate-500">
              Au-delà du quota inclus, chaque plan facture les requêtes supplémentaires par tranche
              de 1 000. Le dépassement est calculé en fin de mois et facturé séparément. Aucun
              blocage automatique — vous gardez le contrôle.
            </p>
          </div>
        </div>
      )}

      {/* ── FAQ ─────────────────────────────────────────────────────── */}
      <div className="space-y-4">
        <h2 className="text-xl font-bold tracking-tight text-slate-900">Questions fréquentes</h2>
        <div className="space-y-2">
          {FAQ_ITEMS.map((item) => (
            <FaqItem key={item.q} q={item.q} a={item.a} />
          ))}
        </div>
      </div>

      {/* ── Bottom CTA ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-6 rounded-3xl border border-indigo-100 bg-indigo-50 p-8">
        <div>
          <h3 className="text-xl font-bold tracking-tight text-slate-900">
            Prêt à intégrer l&apos;API Mimmoza ?
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            Gérez vos clés, testez dans le playground, suivez votre usage.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => navigate('/api/keys')}
            className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
          >
            Mes clés API <ArrowRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => navigate('/api/playground')}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Ouvrir le Playground
          </button>
        </div>
      </div>
    </div>
  );
}