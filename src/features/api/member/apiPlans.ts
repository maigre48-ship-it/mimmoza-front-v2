// src/features/api/member/apiPlans.ts
// ─────────────────────────────────────────────────────────────────────────────
// Mimmoza – formules API (couche de compatibilité).
//
// La source unique est src/lib/api/catalogueApi.ts (contrat docs/api/CONTRAT_API.md).
// Ce fichier n'invente aucun chiffre : il ré-expose le catalogue sous les noms
// historiques utilisés par les composants de l'espace API.
//
// Plus de « pay as you go » postpayé : au-delà des crédits du mois, seuls des
// crédits de recharge PRÉPAYÉS (réservés aux abonnés) peuvent être consommés.
// ─────────────────────────────────────────────────────────────────────────────

import {
  API_FORMULES,
  API_FORMULES_PAYANTES,
  formuleApi,
  prixMensuelApi,
  remiseAnnuelleApi,
  RECHARGE_VALIDITE_MOIS,
  type ApiFormule,
  type ApiFormuleId,
} from '../../../lib/api/catalogueApi';

export type BillingMode = 'monthly' | 'annual';
export type PlanTier = ApiFormuleId;
export type PlanEnvironment = 'test' | 'live';
export type ApiPlan = ApiFormule;

export const API_PLANS: readonly ApiPlan[] = API_FORMULES;

/** Recharge prépayée : prix de 1 000 crédits par formule payante (remplace PAY_AS_YOU_GO). */
export const RECHARGE_PREPAYEE: readonly { id: PlanTier; nom: string; prixParMilleHT: number }[] =
  API_FORMULES_PAYANTES.map((f) => ({ id: f.id, nom: f.nom, prixParMilleHT: f.rechargeParMilleHT ?? 0 }));

export const RECHARGE_PREPAYEE_VALIDITE_MOIS = RECHARGE_VALIDITE_MOIS;

export function getPlanById(id: PlanTier): ApiPlan {
  return formuleApi(id);
}

export function getDisplayPrice(plan: ApiPlan, mode: BillingMode): number {
  return prixMensuelApi(plan, mode === 'annual' ? 'annuel' : 'mensuel');
}

export function getAnnualSavingPercent(plan: ApiPlan): number {
  return remiseAnnuelleApi(plan);
}
