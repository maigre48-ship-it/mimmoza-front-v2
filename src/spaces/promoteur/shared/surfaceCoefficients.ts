// =============================================================================
// COEFFICIENTS DE SURFACE — source unique pour l'espace promoteur
// =============================================================================
//
// Pourquoi ce fichier existe
// --------------------------
// Le Bilan promoteur affichait un KPI « SHAB est. » calculé avec 0,88 × SDP
// (terrain3d/massingToBilan.ts) et facturait le chiffre d'affaires sur
// 0,82 × SDP (BilanPromoteurPage.tsx). Même SDP en entrée, deux surfaces en
// sortie, sur le même écran : sur 3 000 m² SDP à 5 200 €/m², 936 000 € de CA
// disparaissaient entre le KPI et le calcul.
//
// Les valeurs ci-dessous ne sont PAS de nouvelles hypothèses : ce sont celles
// déjà retenues par le calcul financier du Bilan (0,82 en collectif, 0,90 en
// individuel), qui étaient aussi les plus répandues dans le code
// (services/massing/massingEngine.service.ts retient également 0,82).
//
// Règle : tout nouveau calcul de SHAB, de surface vendable ou de nombre de
// logements passe par ces constantes. N'en redéfinissez pas localement.
// =============================================================================

/** Nature du bâti retenue pour l'opération. */
export type BuildingKind = 'COLLECTIF' | 'INDIVIDUEL';

/**
 * SHAB / SDP en logement COLLECTIF — la part de surface de plancher qui reste
 * habitable une fois déduits circulations communes, murs, gaines et locaux
 * techniques.
 */
export const SHAB_SDP_COLLECTIF = 0.82;

/**
 * SHAB / SDP en logement INDIVIDUEL — pas de circulation commune, donc un
 * rendement supérieur.
 */
export const SHAB_SDP_INDIVIDUEL = 0.9;

/** Coefficient SHAB/SDP applicable à une nature de bâti. */
export function shabSdpCoef(kind: BuildingKind): number {
  return kind === 'INDIVIDUEL' ? SHAB_SDP_INDIVIDUEL : SHAB_SDP_COLLECTIF;
}

// La taille moyenne d'un logement vit désormais dans buildingMetrics.ts, aux
// côtés de la fonction `nombreLogements()` qui l'applique — les quatre
// diviseurs concurrents y ont été unifiés.
