// =============================================================================
// GABARITS DE BÂTIMENT — hauteurs et nombre de logements, source unique
// =============================================================================
//
// Ce que l'audit a réellement trouvé
// ----------------------------------
// Quatre « formules de hauteur » différentes avaient été relevées. En les
// mettant côte à côte, elles sont ALGÉBRIQUEMENT IDENTIQUES : les deux modèles
// de données comptent simplement les niveaux différemment, et
//
//     ground + (levels - 1) × typical   ≡   ground + floorsAboveGround × typical
//
// dès lors que `levels = 1 + floorsAboveGround`. La divergence réelle est
// ailleurs, et elle est plus sournoise : ce sont les VALEURS DE REPLI qui ne
// concordent pas, et le repli le plus haut se trouvait précisément dans le
// contrôle de conformité PLU.
//
//   plan.plu.metrics.ts        3,5 / 3,0   ← contrôle de conformité
//   store/usePlanEditor.ts     2,8 / 2,7   ← création d'un bâtiment
//   plan.defaults.ts           3,0 / 2,7   ← projet vierge
//
// Les trois portent sur le MÊME modèle (`PlanBuilding`). Un bâtiment dont les
// hauteurs n'étaient pas renseignées — donnée ancienne, import, projet migré —
// était donc créé implicitement à 2,8 / 2,7 puis mesuré à 3,5 / 3,0 par le
// contrôle PLU. Sur un R+3, cela fait 12,50 m mesurés contre 10,90 m réels :
// un projet conforme à une limite de 12 m était déclaré non conforme.
//
// Ce que ce module fige
// ---------------------
// Les hauteurs de repli du modèle `PlanBuilding` sont alignées sur celles de
// la CRÉATION (2,8 / 2,7), qui est la valeur que l'utilisateur obtient
// réellement. Le modèle `Building2D` de l'éditeur d'implantation, lui, était
// déjà cohérent avec lui-même (3,0 / 2,8 à la création comme au calcul) : ses
// valeurs sont reprises telles quelles, simplement rapatriées ici pour qu'elles
// ne puissent plus diverger.
//
// Aucune valeur n'est inventée : chacune existait déjà dans le code.
// =============================================================================

// ─── Hauteurs de repli ───────────────────────────────────────────────────────

/**
 * Modèle `PlanBuilding` (éditeur de plan masse, contrôle de conformité PLU).
 * Aligné sur `usePlanEditor.addBuilding`, qui est ce que l'utilisateur obtient
 * en dessinant un bâtiment.
 */
export const PLAN_GROUND_FLOOR_HEIGHT_M = 2.8;
export const PLAN_TYPICAL_FLOOR_HEIGHT_M = 2.7;

/**
 * Modèle `Building2D` (éditeur d'implantation 2D, scénario maître).
 * Ces deux valeurs étaient déjà cohérentes entre création et calcul ; elles
 * sont rapatriées ici pour les empêcher de dériver.
 */
export const IMPLANTATION_GROUND_FLOOR_HEIGHT_M = 3.0;
export const IMPLANTATION_TYPICAL_FLOOR_HEIGHT_M = 2.8;

/**
 * Hauteur totale d'un bâtiment, en mètres.
 *
 * @param floorsAboveGround niveaux AU-DESSUS du rez-de-chaussée. Pour un modèle
 *   qui compte les niveaux RDC inclus (`levels`), passer `levels - 1`.
 * @param groundFloorHeightM hauteur du RDC ; le repli s'applique si absente.
 * @param typicalFloorHeightM hauteur d'un étage courant ; idem.
 * @param fallback jeu de replis à utiliser selon le modèle de données.
 *
 * Retourne 0 pour un bâtiment sans niveau : c'est la convention déjà en place
 * dans le contrôle PLU, qui saute alors la règle de hauteur plutôt que de
 * comparer une hauteur inventée à la limite du règlement.
 */
export function totalBuildingHeightM(
  floorsAboveGround: number,
  groundFloorHeightM: number | null | undefined,
  typicalFloorHeightM: number | null | undefined,
  fallback: { ground: number; typical: number } = {
    ground: PLAN_GROUND_FLOOR_HEIGHT_M,
    typical: PLAN_TYPICAL_FLOOR_HEIGHT_M,
  },
): number {
  const etages = Math.max(0, Math.floor(Number(floorsAboveGround) || 0));
  const ground = Number(groundFloorHeightM) || fallback.ground;
  const typical = Number(typicalFloorHeightM) || fallback.typical;

  // Arrondi au centimètre. Ce n'est pas cosmétique : 2,8 + 3 × 2,7 vaut
  // 10.900000000000002 en virgule flottante, et cette fonction alimente une
  // comparaison à la hauteur maximale du PLU. Sans arrondi, un projet
  // exactement à la limite peut être déclaré non conforme pour 2 × 10⁻¹⁵ m.
  return Math.round((ground + etages * typical) * 100) / 100;
}

/** Replis du modèle `Building2D` (éditeur d'implantation 2D). */
export const IMPLANTATION_HEIGHT_FALLBACK = {
  ground: IMPLANTATION_GROUND_FLOOR_HEIGHT_M,
  typical: IMPLANTATION_TYPICAL_FLOOR_HEIGHT_M,
} as const;

/** Replis du modèle `PlanBuilding` (éditeur de plan masse). */
export const PLAN_HEIGHT_FALLBACK = {
  ground: PLAN_GROUND_FLOOR_HEIGHT_M,
  typical: PLAN_TYPICAL_FLOOR_HEIGHT_M,
} as const;

// ─── Nombre de logements ─────────────────────────────────────────────────────
//
// Quatre diviseurs coexistaient pour la même estimation, avec deux arrondis :
//
//   massingToBilan.ts            SHAB / 55   puis Math.round   → SDP / 62,5
//   massingEngine.service.ts     vendable / 62 puis Math.floor → SDP / 75,6
//   plan.financialBridge.ts      vendable / 60 puis Math.floor → SDP / 72,3
//   masterScenario.service.ts    vendable / 62 puis Math.floor → SDP / 74,7
//
// Sur 3 000 m² de SDP : 48, 39, 41 ou 40 logements selon l'écran ouvert.
//
// Deux écarts se cumulaient : la surface de référence (SHAB dans un cas,
// surface vendable dans les autres) et la taille moyenne du logement. La
// taille retenue ici est 62 m², la plus représentée (deux moteurs sur quatre),
// et l'arrondi est `Math.floor` — également majoritaire, et le seul honnête :
// on ne vend pas 0,7 logement, et arrondir au supérieur gonfle le chiffre
// d'affaires prévisionnel.

/**
 * Surface moyenne d'un logement, en m² de surface vendable.
 * Valeur d'usage promoteur collectif, la plus représentée dans le code.
 */
export const SURFACE_MOYENNE_LOGEMENT_M2 = 62;

/**
 * Nombre de logements estimé à partir d'une surface vendable.
 *
 * @param surfaceVendableM2 surface vendable (SHAB × coefficient de vente).
 * @param surfaceMoyenneM2 taille moyenne visée, si le projet en impose une.
 *
 * Tronque volontairement : un logement partiel ne se vend pas.
 */
export function nombreLogements(
  surfaceVendableM2: number,
  surfaceMoyenneM2: number = SURFACE_MOYENNE_LOGEMENT_M2,
): number {
  const surface = Number(surfaceVendableM2) || 0;
  const moyenne = Number(surfaceMoyenneM2) || SURFACE_MOYENNE_LOGEMENT_M2;
  if (surface <= 0 || moyenne <= 0) return 0;
  return Math.floor(surface / moyenne);
}
