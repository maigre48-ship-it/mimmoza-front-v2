// =============================================================================
// PLAN D'ABONNEMENT — réconciliation du cache front avec le serveur
// =============================================================================
//
// Le problème
// -----------
// Deux sources de vérité coexistaient pour le plan de l'utilisateur :
//
//   • SERVEUR — `billing_profiles.plan_code` + `subscription_status`, lu par
//     `copilot-chat` (`getUserPlan`). C'est lui qui décide réellement du mode
//     et des outils accessibles.
//   • FRONT — `localStorage["mimmoza.user"].plan`, écrit à l'inscription et
//     jamais rafraîchi ensuite. Il pilote le sélecteur de modèle, les gardes
//     de route et les questions rapides.
//
// Le commentaire de `copilot-chat` le reconnaissait déjà : « un utilisateur
// peut voir 'pro' à l'écran et être 'basic' ici ». Concrètement, un abonné qui
// vient de payer restait bridé côté chat, et un abonnement expiré continuait
// d'afficher des fonctions que le serveur refusait.
//
// Ce module ne déplace pas la décision : le serveur reste l'autorité. Il aligne
// le CACHE front sur lui.
//
// Règle de sûreté
// ---------------
// Toute erreur — réseau, session expirée, ligne absente — laisse le cache
// INCHANGÉ. On ne dégrade jamais l'accès d'un utilisateur sur un échec de
// lecture : dans le pire des cas le front reste optimiste, et le serveur, lui,
// refusera de toute façon ce qui n'est pas payé.
// =============================================================================

import { supabase } from '@/lib/supabase';
import type { PlanCode, SubscriptionStatus } from './billing.types';
import type { PlanId } from './planAccess';

const USER_KEY = 'mimmoza.user';
const UPDATED_EVENT = 'mimmoza:user-updated';

/**
 * Statuts d'abonnement donnant droit au plan payé.
 *
 * Même liste que `getUserPlan` côté serveur : tout autre statut — impayé,
 * annulé, suspendu — ramène au plan de base.
 */
const STATUTS_ACTIFS: readonly SubscriptionStatus[] = ['active', 'trialing'];

/**
 * Correspondance entre les codes de plan du serveur et les paliers du front.
 *
 * Les deux nomenclatures ont divergé au fil du temps : le serveur parle de
 * `free / starter / pro / promoteur_pro…`, le front de
 * `basique / avance / pro / proplus`. Cette table est le seul endroit où la
 * traduction existe — sans elle, chaque écran l'improvisait.
 */
const PLAN_SERVEUR_VERS_FRONT: Record<PlanCode, PlanId> = {
  free: 'basique',
  starter: 'avance',
  pro: 'pro',
  promoteur_starter: 'avance',
  promoteur_pro: 'proplus',
  financeur_pro: 'proplus',
  enterprise: 'proplus',
};

export interface PlanSynchronise {
  plan: PlanId;
  planCodeServeur: PlanCode;
  statut: SubscriptionStatus | null;
  /** true si le cache local a effectivement été modifié. */
  cacheMisAJour: boolean;
}

/**
 * Aligne `localStorage["mimmoza.user"].plan` sur `billing_profiles`.
 *
 * À appeler après l'authentification, et au retour d'un paiement. Émet
 * `mimmoza:user-updated` quand la valeur change, pour que `usePlanAccess`
 * recalcule les droits sans rechargement.
 *
 * Retourne `null` si la synchronisation n'a pas pu aboutir — auquel cas le
 * cache est laissé tel quel, volontairement.
 */
export async function syncPlanFromServer(userId: string): Promise<PlanSynchronise | null> {
  if (!userId) return null;

  try {
    const { data, error } = await supabase
      .from('billing_profiles')
      .select('plan_code, subscription_status')
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !data) {
      if (error) console.warn('[billing] plan non synchronisé :', error.message);
      return null;
    }

    const planCodeServeur = (data.plan_code as PlanCode) ?? 'free';
    const statut = (data.subscription_status as SubscriptionStatus | null) ?? null;

    // Même arbitrage que le serveur : sans abonnement actif, on retombe au
    // plan de base quel que soit le `plan_code` enregistré.
    const planFront: PlanId =
      statut && STATUTS_ACTIFS.includes(statut)
        ? PLAN_SERVEUR_VERS_FRONT[planCodeServeur] ?? 'basique'
        : 'basique';

    let cacheMisAJour = false;
    try {
      const brut = localStorage.getItem(USER_KEY);
      const user = brut ? (JSON.parse(brut) as Record<string, unknown>) : {};
      if (user.plan !== planFront) {
        localStorage.setItem(USER_KEY, JSON.stringify({ ...user, plan: planFront }));
        cacheMisAJour = true;
        window.dispatchEvent(new CustomEvent(UPDATED_EVENT));
        console.info(
          `[billing] plan resynchronisé : « ${String(user.plan ?? '—')} » → « ${planFront} » ` +
            `(serveur : ${planCodeServeur}/${statut ?? 'sans abonnement'})`,
        );
      }
    } catch {
      // localStorage indisponible (navigation privée, quota) : on retourne
      // quand même la valeur serveur à l'appelant.
    }

    return { plan: planFront, planCodeServeur, statut, cacheMisAJour };
  } catch (e) {
    console.warn('[billing] synchronisation du plan impossible :', e);
    return null;
  }
}
