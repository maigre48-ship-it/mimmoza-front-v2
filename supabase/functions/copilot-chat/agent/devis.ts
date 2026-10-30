// supabase/functions/copilot-chat/agent/devis.ts
// =============================================================
// Devis d'une mission — DÉTERMINISTE (aucun appel au modèle).
//
// Principe (décision du fondateur) : on annonce une fourchette, on RÉSERVE le
// maximum, on débite le réel au fil de l'eau, on rembourse le reste.
//
// Pire cas PROPRE AUX MISSIONS (revue B4, « coller au coût réel ») :
//   · l'entrée d'une étape est PLAFONNÉE à ENTREE_MAX_TOKENS (estimée à
//     caractères/3 sur prompt système + définitions d'outils + messages) ; au-delà,
//     le moteur compacte AVANT l'appel et ne dépasse jamais ce plafond ;
//   · la sortie est plafonnée à SORTIE_ETAPE_MAX_TOKENS ; aucun outil web.
//   pire cas d'une étape = debitJetons(tier, ENTREE_MAX_TOKENS, SORTIE_ETAPE_MAX_TOKENS, 0)
//   jetons_max = etapes_max × ce pire cas ; jetons_min ≈ 40 % du max.
// (L'ancien calcul reprenait worstCaseJetons(tier,'report') : 160 k tokens
//  d'entrée + recherches web, sans rapport avec une étape de mission.)
//
// Avant chaque étape, le moteur vérifie avec l'entrée RÉELLEMENT envoyée que le
// reste couvre l'étape ET le rapport final : on ne perd jamais d'argent et
// l'utilisateur reçoit toujours un rapport, même partiel.
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

/** Plafond d'entrée d'une étape de mission (tokens estimés à caractères/3). */
export const ENTREE_MAX_TOKENS = 60_000;
/** Sortie max d'une étape de travail / de plan. */
export const SORTIE_ETAPE_MAX_TOKENS = 4096;
/** Sortie max du rapport final (revue I1). */
export const SORTIE_RAPPORT_MAX_TOKENS = 4000;
/** Durée de validité d'un devis. */
export const DEVIS_VALIDITE_MS = 24 * 3600 * 1000;

type DebitJetons = (tier: Tier, inputTokens: number, outputTokens: number, webSearches?: number) => number;

/** Estimation de tokens : caractères / 3, arrondi au-dessus (volontairement haute pour le français). */
export function estimerTokens(caracteres: number): number {
  return Math.ceil(Math.max(0, caracteres) / 3);
}

/** Pire cas d'une étape de mission AU PLAFOND d'entrée — base du devis. */
export function pireCasEtapeMission(debit: DebitJetons, tier: Tier): number {
  return Math.max(1, debit(tier, ENTREE_MAX_TOKENS, SORTIE_ETAPE_MAX_TOKENS, 0));
}

/** Pire cas du rapport final au plafond d'entrée — toujours gardé en réserve. */
export function pireCasRapportMission(debit: DebitJetons, tier: Tier): number {
  return Math.max(1, debit(tier, ENTREE_MAX_TOKENS, SORTIE_RAPPORT_MAX_TOKENS, 0));
}

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
  /** pireCasEtapeMission(debitJetons, tier). */
  pireCasEtape: number;
  /** Nombre d'étapes souhaité (sinon celui du type). */
  etapes?: number;
  /** Plafond de jetons (budget proactif restant, par exemple). */
  plafondJetons?: number;
  /** Horloge (tests) : date d'émission du devis. */
  maintenant?: Date;
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
  const emis = e.maintenant ?? new Date();
  return {
    jetons_min, jetons_max, etapes_max: etapes, duree_estimee_min, tier: e.tier, explication,
    pire_cas_etape: pire, entree_max_tokens: ENTREE_MAX_TOKENS,
    emis_le: emis.toISOString(), expire_le: new Date(emis.getTime() + DEVIS_VALIDITE_MS).toISOString(),
  };
}

/** Une mission dont le devis ne permet pas plan + une étape + rapport est refusée. */
export function devisViable(d: Devis, pireCasEtape: number): boolean {
  return d.etapes_max >= ETAPES_MIN && d.jetons_max >= ETAPES_MIN * Math.max(1, Math.ceil(pireCasEtape));
}

/** Devis expiré (24 h) ? Un devis sans date (ancien format) n'expire pas ici. */
export function devisExpire(d: Partial<Devis> | null | undefined, maintenant: number): boolean {
  const t = d?.expire_le ? Date.parse(d.expire_le) : NaN;
  return Number.isFinite(t) && maintenant > t;
}
