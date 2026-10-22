// src/features/api/components/ApiPlanCard.tsx
// Carte d'une formule API (catalogue : src/lib/api/catalogueApi.ts).
// Paiement en ligne non branché : une formule payante se DEMANDE par e-mail
// (mailtoDemandeAcces) ; l'essai démarre en créant une clé.
import { Check, Mail, Plus } from 'lucide-react';
import {
  prixMensuelApi,
  remiseAnnuelleApi,
  RECHARGE_VALIDITE_MOIS,
  type ApiFormule,
} from '../../../lib/api/catalogueApi';
import { formatEurHT, mailtoDemandeAcces } from '../../../lib/billing/grille';
import { ApiStatusBadge } from './ApiStatusBadge';

interface ApiPlanCardProps {
  plan: ApiFormule;
  periodicite: 'mensuel' | 'annuel';
  /** Formule actuelle du compte. */
  actuelle?: boolean;
  /** Action du bouton de l'essai (ex. ouvrir la page des clés). */
  onEssai?: () => void;
}

export default function ApiPlanCard({ plan, periodicite, actuelle = false, onEssai }: ApiPlanCardProps) {
  const gratuit = plan.prixMensuelHT === 0;
  const prix = prixMensuelApi(plan, periodicite);
  const remise = remiseAnnuelleApi(plan);
  const enAvant = plan.miseEnAvant && !actuelle;

  const classeBouton = `inline-flex w-full items-center justify-center gap-2 rounded-2xl py-2.5 text-sm font-semibold transition-all ${
    enAvant
      ? 'bg-indigo-600 text-white hover:bg-indigo-700'
      : 'border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
  }`;

  return (
    <div
      className={`relative flex flex-col rounded-3xl border p-6 shadow-sm transition-all ${
        actuelle
          ? 'border-indigo-300 bg-indigo-50/50 ring-1 ring-indigo-200'
          : enAvant
          ? 'border-indigo-200 bg-white shadow-lg ring-1 ring-indigo-100'
          : 'border-slate-200 bg-white'
      }`}
    >
      <div className="mb-4 flex min-h-[22px] flex-wrap items-center gap-2">
        {actuelle && <ApiStatusBadge variant="current" />}
        {enAvant && <ApiStatusBadge variant="recommended" />}
        {periodicite === 'annuel' && !gratuit && remise > 0 && (
          <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
            −{remise} % en annuel
          </span>
        )}
      </div>

      <h3 className="text-xl font-bold tracking-tight text-slate-900">{plan.nom}</h3>
      <p className="mt-1 text-sm text-slate-500">{plan.accroche}</p>

      <div className="my-5">
        {gratuit ? (
          <span className="text-4xl font-extrabold tracking-tight text-slate-900">Gratuit</span>
        ) : (
          <div className="flex items-end gap-1.5">
            <span className="text-4xl font-extrabold tracking-tight text-slate-900">{prix} €</span>
            <span className="mb-1 text-sm text-slate-400">
              HT / mois
              {periodicite === 'annuel' && <span className="ml-1 text-emerald-600">· facturé à l'année</span>}
            </span>
          </div>
        )}
      </div>

      <ul className="mb-6 space-y-2.5">
        {plan.avantages.map((a) => (
          <li key={a} className="flex items-start gap-2.5 text-sm text-slate-600">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
            {a}
          </li>
        ))}
        {plan.rechargeParMilleHT != null && (
          <li className="flex items-start gap-2.5 text-sm text-slate-500">
            <Plus className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
            Recharge prépayée : {formatEurHT(plan.rechargeParMilleHT, true)} les 1 000 crédits, valables{' '}
            {RECHARGE_VALIDITE_MOIS} mois
          </li>
        )}
      </ul>

      <div className="mt-auto">
        {actuelle ? (
          <div className="w-full rounded-2xl border border-indigo-200 py-2.5 text-center text-sm font-semibold text-indigo-400">
            Votre formule
          </div>
        ) : gratuit ? (
          <button type="button" onClick={onEssai} className={classeBouton}>
            Commencer l'essai
          </button>
        ) : (
          <a href={mailtoDemandeAcces(`API ${plan.nom}`, periodicite)} className={classeBouton}>
            <Mail className="h-4 w-4" />
            Demander cette formule
          </a>
        )}
      </div>
    </div>
  );
}
