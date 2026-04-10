// src/spaces/promoteur/plan2d/floorElements.types.ts
// Types canoniques des éléments architecturaux par étage.
// Utilisés par floorElements.geometry.ts et floorElements.render.ts.

/**
 * Orientation d'une façade dans le référentiel LOCAL du bâtiment.
 * north = haut du rect à rotation 0°
 * east  = droite à rotation 0°
 * etc.
 */
export type FloorEdge = 'north' | 'east' | 'south' | 'west';

// ─── BALCON ───────────────────────────────────────────────────────────
/**
 * Balcon — saillie vers l'extérieur d'une façade.
 * Rendu : petit rectangle projeté vers l'extérieur.
 */
export interface FloorBalcony2D {
  id:         string;
  edge:       FloorEdge;
  /** Décalage latéral en mètres depuis le milieu de la façade. */
  offsetM:    number;
  /** Largeur le long de la façade (m). */
  widthM:     number;
  /** Profondeur de saillie perpendiculaire à la façade (m). */
  depthM:     number;
  /** Étage auquel ce balcon appartient (= FloorPlan2D.levelIndex). */
  levelIndex: number;
}

// ─── LOGGIA ───────────────────────────────────────────────────────────
/**
 * Loggia — enfoncement vers l'intérieur d'une façade.
 * Rendu : rectangle pointillé "creusé" dans l'emprise.
 */
export interface FloorLoggia2D {
  id:         string;
  edge:       FloorEdge;
  offsetM:    number;
  widthM:     number;
  /** Profondeur de creusement vers l'intérieur (m). */
  depthM:     number;
  levelIndex: number;
}

// ─── TERRASSE ─────────────────────────────────────────────────────────
/**
 * Terrasse — surface accessible horizontale.
 *   roof    → terrasse centrale en toiture
 *   setback → terrasse en retrait sur une façade
 */
export interface FloorTerrace2D {
  id:         string;
  kind:       'roof' | 'setback';
  /** Façade de référence (setback seulement). */
  edge?:      FloorEdge;
  /** Décalage latéral depuis le milieu de la façade (setback). */
  offsetM?:   number;
  widthM:     number;
  depthM:     number;
  levelIndex: number;
}

// ─── GROUPÉ ───────────────────────────────────────────────────────────
/** Ensemble des éléments architecturaux d'un étage. */
export interface FloorPlanElements {
  balconies: FloorBalcony2D[];
  loggias:   FloorLoggia2D[];
  terraces:  FloorTerrace2D[];
}