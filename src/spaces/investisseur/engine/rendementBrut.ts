// =============================================================================
// RENDEMENT BRUT — une seule convention pour l'espace investisseur
// =============================================================================
//
// L'audit a relevé trois dénominateurs concurrents dans le code pour un
// indicateur portant le même nom :
//   • prix d'achat seul          (rentabilite.engine.ts, opportunityEngine)
//   • prix d'achat + travaux     (RentabilitePanel, affichage utilisateur)
//   • prix demandé OU valeur     (valuationEngine.service.ts)
// Sur 200 000 € + 40 000 € de travaux à 900 €/mois, cela donne 5,4 % ou 4,5 %
// selon l'écran ouvert.
//
// Ce module ne tranche PAS le débat de fond : il fige la convention déjà
// affichée à l'utilisateur dans le panneau Rentabilité — « Rendement brut
// indicatif = loyer annuel / (prix d'achat + travaux) » — et sert de source
// unique aux écrans qui en dépendent (panneau, snapshot persisté, Deal Center).
// Aligner les deux autres moteurs suppose de toucher au calcul financier :
// c'est le travail d'unification des moteurs métier, pas celui-ci.
// =============================================================================

/**
 * Rendement brut en pourcentage, convention Mimmoza.
 *
 * Dénominateur = prix d'achat + travaux, c'est-à-dire ce que l'opération
 * immobilise réellement hors frais d'acquisition et hors frais financiers.
 *
 * Retourne `null` — jamais 0 — quand le calcul n'a pas de sens : un rendement
 * de 0 % s'affiche comme une performance nulle, alors qu'il s'agit d'une
 * absence de donnée. C'est exactement l'écart que le Deal Center produisait
 * en écrivant `rendementBrutPct: 0` en dur.
 */
export function rendementBrutPct(
  loyerMensuel: number,
  prixAchat: number,
  travaux = 0,
): number | null {
  const loyer = Number(loyerMensuel) || 0;
  const base = (Number(prixAchat) || 0) + (Number(travaux) || 0);
  if (loyer <= 0 || base <= 0) return null;
  return ((loyer * 12) / base) * 100;
}
