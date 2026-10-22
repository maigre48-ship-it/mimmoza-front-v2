// src/spaces/copilot/store/repriseFlux.ts
// =============================================================================
// Décision de reprise d'une réponse de Mimmo dont le flux ne s'est pas terminé
// normalement. Logique PURE (testée par node --test) ; l'exécution vit dans
// useCopilotStreaming.
//
// Trois situations, trois réponses — et JAMAIS un texte tronqué présenté comme
// complet :
//
//   1. Le flux s'est coupé côté navigateur (réseau, veille, proxy) sans `done`
//      ni `error`. Le serveur, lui, continue : il termine la génération, la
//      persiste et la facture une seule fois. On va donc RELIRE la réponse en
//      base — zéro appel modèle, zéro jeton de plus.
//   2. Le serveur a lui-même interrompu la réponse (échéance, erreur modèle) et
//      a persisté le texte partiel (événement `error` avec `message_id`, ou
//      `finish_reason = 'interrupted'` relu en base). Ce partiel a été facturé
//      au réel ; on demande UNE fois la suite, facturée pour la seule suite.
//   3. Rien n'est récupérable : message clair + réponse marquée incomplète,
//      reprenable à la main.
// =============================================================================

import { porteMarqueurInterruption } from '../../../../supabase/functions/_shared/copilot-stream/reprise.ts';

export {
  MARQUEUR_SUITE,
  estDemandeDeSuite,
  fusionnerSuites,
  messageDeSuite,
  porteMarqueurInterruption,
  raccorderSuite,
  retirerMarqueursInterruption,
} from '../../../../supabase/functions/_shared/copilot-stream/reprise.ts';

export type FinDeFlux = {
  /** Dernier événement terminal reçu : `done`, `error`, ou aucun (coupure). */
  terminal: 'done' | 'error' | null;
  /** L'événement `error` portait un `message_id` : un partiel a été persisté. */
  partielPersiste: boolean;
  /** Le texte de l'erreur serveur (pour écarter les cas non reprenables). */
  erreur?: string | null;
  /** L'utilisateur a cliqué « Arrêter ». */
  annuleParUtilisateur: boolean;
  /** Conversation connue (événement `conversation` reçu, ou conversation existante). */
  conversationId: string | null;
  /** Une suite a déjà été demandée pour cette réponse. */
  dejaRepris: boolean;
};

export type DecisionReprise =
  | 'rien'               // terminé normalement, ou déjà affiché comme erreur définitive
  | 'relire_serveur'     // coupure côté client : la réponse finale est en base
  | 'demander_suite'     // partiel persisté par le serveur : on demande la suite
  | 'echec';             // rien de récupérable automatiquement

/** Erreurs pour lesquelles redemander la suite n'a aucun sens. */
export function erreurNonReprenable(erreur?: string | null): boolean {
  const e = (erreur ?? '').toLowerCase();
  return e.includes('credit') || e.includes('jeton') || e.includes('401')
    || e.includes('unauthorized') || e.includes('jwt') || e.includes('forbidden');
}

export function deciderReprise(f: FinDeFlux): DecisionReprise {
  if (f.annuleParUtilisateur) return 'rien';
  if (f.terminal === 'done') return 'rien';
  if (f.terminal === 'error') {
    if (f.partielPersiste && !f.dejaRepris && f.conversationId && !erreurNonReprenable(f.erreur)) {
      return 'demander_suite';
    }
    return 'rien'; // l'erreur est déjà affichée par le store
  }
  // Flux terminé sans événement terminal : coupure.
  return f.conversationId ? 'relire_serveur' : 'echec';
}

/** Ligne de `copilot_messages` relue pendant la reprise. */
export type ReponseServeur = {
  id: string;
  text: string;
  finishReason: string | null;
  createdAt: string;
};

/**
 * Choisit, parmi les réponses assistant relues en base, celle qui correspond à
 * la requête coupée : la plus ancienne qui n'est pas déjà affichée et qui est
 * postérieure au départ de la requête (tolérance d'horloge incluse).
 */
export function choisirReponseServeur(
  lignes: ReponseServeur[],
  idsConnus: ReadonlySet<string>,
  departMs: number,
  toleranceMs = 120_000,
): ReponseServeur | null {
  const candidates = lignes
    .filter((l) => !idsConnus.has(l.id))
    .filter((l) => {
      const t = Date.parse(l.createdAt);
      return Number.isFinite(t) ? t >= departMs - toleranceMs : true;
    })
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  return candidates[0] ?? null;
}

/** Après relecture : la réponse trouvée est-elle complète ? */
export function reponseComplete(r: Pick<ReponseServeur, 'finishReason' | 'text'>): boolean {
  if (r.finishReason === 'interrupted' || r.finishReason === 'max_tokens') return false;
  return !porteMarqueurInterruption(r.text);
}

/** Délais de relecture : rapide au début, puis espacé, ~170 s au total. */
export const DELAIS_RELECTURE_MS: readonly number[] = [
  1500, 2500, 4000, 5000, 5000, 7000, 10000, 10000, 15000, 15000, 15000, 20000, 20000, 20000, 20000,
];

export const MESSAGES_REPRISE = {
  arreteParUtilisateur:
    'Réponse arrêtée avant la fin : elle est incomplète. « Reprendre » affiche la suite.',
  coupureIrrecuperable:
    "La connexion a été coupée avant la fin de la réponse : elle est incomplète. Réessayez avec « Reprendre ».",
  suiteEchouee:
    "La réponse a été interrompue et sa suite n'a pas pu être générée. Elle est incomplète : réessayez avec « Reprendre ».",
  interrompueEnBase:
    'Cette réponse a été interrompue avant la fin : elle est incomplète.',
} as const;
