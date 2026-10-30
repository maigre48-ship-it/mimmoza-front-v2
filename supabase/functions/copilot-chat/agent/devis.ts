// supabase/functions/copilot-chat/agent/devis.ts
// =============================================================
// Devis d'une mission — DÉTERMINISTE (aucun appel au modèle).
//
// Principe (décision du fondateur) : on annonce une fourchette, on RÉSERVE le
// maximum, on débite le réel au fil de l'eau, on rembourse le reste.
//
//   jetons_max = etapes_max × pire cas d'une étape (worstCaseJetons(tier,'report'))
//   jetons_min ≈ 40 % du max (une mission bien menée n'utilise pas toutes ses étapes,
//                et une étape réelle coûte bien moins que son pire cas).
//
// Le moteur ne lance une étape que s'il reste de quoi payer son pire cas ET le
// pire cas du rapport final (cf. pireCasAvantEtape) : la dernière étape de la
// réserve est donc toujours disponible pour rédiger le rapport. On ne perd
// jamais d'argent et l'utilisateur reçoit toujours un rapport, même partiel.
// =============================================================

import type { Devis, Tier, TypeMission } from './types.ts';

/** Étapes allouées par type de mission (rapport final compris). */
export const ETAPES_PAR_TYPE: Record<TypeMission, number> = {
  prospection_fonciere: 30,
  faisabilite: 20,
  etude_marche: 15,
  veille: 10,
  libre: 15,
};

/** Bornes dures : jamais plus de 40 étapes (défaut colonne etapes_max), jamais moins de 3. */
export const ETAPES_MIN = 3;
export const ETAPES_MAX_ABSOLU = 40;

/** Part du maximum annoncée comme bas de fourchette. */
export const PART_MIN = 0.4;

/** Durée moyenne observable d'une étape (tour LLM + outils), en secondes. */
const SECONDES_PAR_ETAPE = 45;

const LIBELLES: Record<TypeMission, string> = {
  prospection_fonciere: 'prospection foncière',
  faisabilite: 'étude de faisabilité',
  etude_marche: 'étude de marché',
  veille: 'qualification de veille',
  libre: 'mission',
};

export interface EntreeDevis {
  type: TypeMission;
  tier: Tier;
  /** worstCaseJetons(tier, 'report') — injecté, pour rester aligné sur la facturation du chat. */
  pireCasEtape: number;
  /** Nombre d'étapes souhaité (sinon celui du type). */
  etapes?: number;
  /** Plafond de jetons (budget proactif restant, par exemple). */
  plafondJetons?: number;
}

export function bornerEtapes(n: number | undefined, type: TypeMission): number {
  const v = Number.isFinite(n) && (n as number) > 0 ? Math.floor(n as number) : ETAPES_PAR_TYPE[type];
  return Math.max(ETAPES_MIN, Math.min(ETAPES_MAX_ABSOLU, v));
}

export function calculerDevis(e: EntreeDevis): Devis {
  const pire = Math.max(1, Math.ceil(e.pireCasEtape));
  let etapes = bornerEtapes(e.etapes, e.type);
  if (e.plafondJetons != null && Number.isFinite(e.plafondJetons)) {
    // Plafond : on réduit le nombre d'étapes, jamais le pire cas par étape
    // (sinon la garde « une étape ne démarre que si son pire cas tient » mentirait).
    etapes = Math.min(etapes, Math.floor(Math.max(0, e.plafondJetons) / pire));
  }
  const jetons_max = etapes * pire;
  const jetons_min = Math.min(jetons_max, Math.max(pire, Math.ceil(jetons_max * PART_MIN)));
  const duree_estimee_min = Math.max(2, Math.round((etapes * SECONDES_PAR_ETAPE * 0.6) / 60));
  const explication =
    `${LIBELLES[e.type]} en ${etapes} étapes au plus (plan, recherches, analyses, rapport). ` +
    `Chaque étape coûte au maximum ${pire} jetons ; ${jetons_max} jetons sont réservés au lancement, ` +
    `seul le réellement consommé est débité et le reste est rendu à la clôture. ` +
    `Si la réserve s'épuise, la mission s'arrête proprement avec un rapport partiel.`;
  return { jetons_min, jetons_max, etapes_max: etapes, duree_estimee_min, tier: e.tier, explication };
}

/**
 * Pire cas à couvrir AVANT de lancer une étape de travail : l'étape elle-même
 * plus le rapport final (un tour sans outils). C'est la valeur passée à
 * `agent_mission_debiter(p_pire_cas_suivant)`.
 */
export function pireCasAvantEtape(pireCasEtape: number): number {
  return 2 * Math.max(1, Math.ceil(pireCasEtape));
}

/** Équivalent minimal : une mission dont le devis ne permet pas plan + rapport est refusée. */
export function devisViable(d: Devis, pireCasEtape: number): boolean {
  return d.etapes_max >= ETAPES_MIN && d.jetons_max >= pireCasAvantEtape(pireCasEtape);
}
