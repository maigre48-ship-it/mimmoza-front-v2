// =============================================================================
// PRIX DU NEUF — coefficient de passage depuis l'ancien
// =============================================================================
//
// Le défaut corrigé
// -----------------
// La page Évaluation lisait un « prix marché neuf » ainsi :
//
//   prix_m2_median_neuf                       // affiché tel quel
//   ?? prix_m2_median × 1,2                   // majoré
//   ?? dvfBest.prixM2 × 1,2                   // majoré
//
// Or `prix_m2_median_neuf` était alimenté par `market.prices.median_eur_m2`,
// c'est-à-dire une médiane DVF de l'ANCIEN — comme les deux autres branches.
// Selon que l'étude de marché avait répondu ou non, le même écran affichait
// donc la médiane brute OU cette même médiane majorée de 20 %, sous le libellé
// « Prix marché neuf » et avec la source « Étude marché (prix neuf) », fausse
// dans le premier cas. Exactement 20 % d'écart sur la même donnée
// sous-jacente, sans que rien ne le signale.
//
// Le coefficient est désormais nommé, appliqué de façon UNIFORME quelle que
// soit la branche, et la fonction dit d'où vient le chiffre.
//
// Limite assumée
// --------------
// 1,2 est un coefficient national et plat. L'écart réel neuf/ancien va d'à
// peine 5 % dans les marchés tendus où l'ancien est rare et cher, à plus de
// 40 % en zone détendue. Ce n'est pas une donnée de marché : c'est un ordre de
// grandeur de dégrossissage, à remplacer par un prix de vente saisi ou par une
// source de prix du neuf dès que l'un des deux est disponible.
// =============================================================================

/** Majoration appliquée à une médiane de l'ancien pour estimer le neuf. */
export const COEF_NEUF_SUR_ANCIEN = 1.2;

export type SourcePrixNeuf = 'saisi' | 'estime_sur_ancien';

export interface PrixNeufEstime {
  /** Prix au m² retenu, en € (arrondi). */
  prixM2: number;
  source: SourcePrixNeuf;
  /** Libellé prêt à afficher, honnête sur la provenance. */
  label: string;
}

/**
 * Prix du neuf au m² à retenir.
 *
 * @param prixNeufSaisi prix de vente du neuf réellement connu (saisie
 *   utilisateur ou source de prix du neuf). Prime toujours.
 * @param medianeAncien médiane DVF de l'ancien, en €/m².
 *
 * Retourne `null` quand aucune des deux entrées n'est exploitable — plutôt
 * qu'un chiffre dont on ne saurait pas dire d'où il vient.
 */
export function estimerPrixNeufM2(
  prixNeufSaisi: number | null | undefined,
  medianeAncien: number | null | undefined,
): PrixNeufEstime | null {
  const saisi = Number(prixNeufSaisi);
  if (Number.isFinite(saisi) && saisi > 0) {
    return { prixM2: Math.round(saisi), source: 'saisi', label: 'Prix de vente retenu' };
  }

  const ancien = Number(medianeAncien);
  if (Number.isFinite(ancien) && ancien > 0) {
    return {
      prixM2: Math.round(ancien * COEF_NEUF_SUR_ANCIEN),
      source: 'estime_sur_ancien',
      label: `Estimé : médiane DVF ancien +${Math.round((COEF_NEUF_SUR_ANCIEN - 1) * 100)} %`,
    };
  }

  return null;
}
