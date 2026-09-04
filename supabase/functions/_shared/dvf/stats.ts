// =============================================================================
// DVF — statistiques de prix, conventions communes
// =============================================================================
//
// Rectification du constat d'audit
// --------------------------------
// L'audit signalait « −29 % mesuré à Ascain » comme un défaut actif de
// `market-study-investisseur-v1`. C'est inexact : en relisant le fichier, ce
// chiffre est l'HISTORIQUE d'un bug DÉJÀ CORRIGÉ (en-tête du fichier, points 1
// et 2). Cette fonction filtre aujourd'hui par commune, déclare explicitement
// son repli départemental sous 10 ventes, borne les prix à 500–25 000 €/m² et
// calcule une vraie médiane interpolée. Elle est la référence, pas le problème.
//
// Ce qui diverge RÉELLEMENT, et que ce module unifie
// --------------------------------------------------
// Deux fonctions lisent les fichiers CSV geo-dvf plutôt que la table `dvf` :
// `dvf-comparables-v1` et `smartscore-enriched-v3`. Elles s'écartent de la
// référence sur trois points, et l'une des trois est une erreur statistique :
//
//   1. MÉDIANE FAUSSE SUR ÉCHANTILLON PAIR. Les deux calculent
//      `prices[Math.floor(n/2)]`, ce qui retourne toujours la valeur HAUTE du
//      couple central au lieu de la moyenne des deux. Sur 4 ventes à 3 000,
//      3 200, 3 800 et 4 000 €/m², elles annoncent 3 800 là où la médiane vaut
//      3 500 : +8,6 %. Même défaut sur Q1 et Q3, qui ne sont pas interpolés.
//
//   2. AUCUNE BORNE DE PLAUSIBILITÉ. Une mutation à 80 €/m² (parking vendu
//      avec sa surface bâtie) ou à 90 000 €/m² (coquille de saisie) entre
//      telle quelle dans la médiane. La référence borne à 500–25 000.
//
//   3. FILTRE `nature_mutation` INCOHÉRENT. `dvf-comparables-v1` ne retient
//      que les ventes ; `smartscore-enriched-v3` accepte tout, y compris les
//      VEFA et les adjudications. En secteur de promotion neuve, l'écart
//      atteint 5 à 15 % — et les deux fonctions répondent sur le même bien.
//
// Ce module ne touche PAS au choix de la source (fichiers CSV contre table
// `dvf`) : c'est une décision d'architecture, pas une constante à égaliser.
// =============================================================================

/**
 * Bornes de plausibilité du prix au m² habitable, en France.
 *
 * Reprises de `market-study-investisseur-v1`, qui les applique déjà en base.
 * Hors de cette plage, la valeur est presque sûrement une erreur de source :
 * dépendance vendue avec sa surface bâtie, prix partiel, coquille de saisie.
 */
export const DVF_PRIX_M2_MIN = 500;
export const DVF_PRIX_M2_MAX = 25000;

/** Le prix au m² est-il dans la plage exploitable ? */
export function prixM2Plausible(prixM2: number): boolean {
  return Number.isFinite(prixM2) && prixM2 >= DVF_PRIX_M2_MIN && prixM2 <= DVF_PRIX_M2_MAX;
}

/**
 * La mutation est-elle une VENTE au sens DVF ?
 *
 * Écarte les VEFA, adjudications, expropriations et échanges : ce sont des
 * transferts de propriété, pas des prix de marché comparables. `dvf-comparables-v1`
 * le faisait déjà, `smartscore-enriched-v3` non — d'où deux prix différents
 * pour le même bien selon l'écran ouvert.
 */
export function estVente(natureMutation: string | null | undefined): boolean {
  return (natureMutation ?? '').trim() === 'Vente';
}

/**
 * Quantile interpolé d'une série TRIÉE par ordre croissant.
 *
 * Interpolation linéaire entre les deux valeurs encadrantes — la convention
 * usuelle, et celle qu'appliquent déjà `etude-parcelle-v1` et
 * `market-study-investisseur-v1`.
 */
export function quantileTrie(triees: readonly number[], p: number): number | null {
  const n = triees.length;
  if (n === 0) return null;
  if (n === 1) return triees[0];

  const position = (n - 1) * Math.min(1, Math.max(0, p));
  const bas = Math.floor(position);
  const haut = Math.ceil(position);
  if (bas === haut) return triees[bas];
  return triees[bas] + (triees[haut] - triees[bas]) * (position - bas);
}

export interface StatsPrixM2 {
  n: number;
  median: number | null;
  mean: number | null;
  q1: number | null;
  q3: number | null;
}

/**
 * Statistiques de prix au m² à partir d'une liste brute.
 *
 * Trie, écarte les valeurs implausibles, puis calcule médiane et quartiles par
 * interpolation. Les valeurs sont arrondies à l'euro : on ne publie pas des
 * centimes sur une médiane de marché.
 *
 * @param prixM2 valeurs brutes, dans n'importe quel ordre.
 * @param bornes appliquer les bornes de plausibilité (défaut : oui).
 */
export function statsPrixM2(
  prixM2: readonly number[],
  bornes = true,
): StatsPrixM2 {
  const retenues = (bornes ? prixM2.filter(prixM2Plausible) : prixM2.filter(Number.isFinite))
    .slice()
    .sort((a, b) => a - b);

  const n = retenues.length;
  if (n === 0) return { n: 0, median: null, mean: null, q1: null, q3: null };

  const arrondi = (v: number | null) => (v == null ? null : Math.round(v));
  return {
    n,
    median: arrondi(quantileTrie(retenues, 0.5)),
    mean: Math.round(retenues.reduce((a, b) => a + b, 0) / n),
    q1: arrondi(quantileTrie(retenues, 0.25)),
    q3: arrondi(quantileTrie(retenues, 0.75)),
  };
}
