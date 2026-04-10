// src/spaces/promoteur/plan2d/pluEnvelope.types.ts
// Types pour l'enveloppe constructible PLU et les reculs de façade

/**
 * Règles de recul par rapport aux limites de la parcelle.
 * Valeurs en mètres.
 */
export interface SetbackRules {
  /** Recul depuis la façade sur rue (avant). */
  frontM: number;
  /** Recul depuis les limites latérales. */
  sideM:  number;
  /** Recul depuis le fond de parcelle (arrière). */
  rearM:  number;
}

/** Valeurs par défaut des reculs (PLU standard simplifié). */
export const DEFAULT_SETBACKS: SetbackRules = {
  frontM: 5,
  sideM:  3,
  rearM:  3,
};

/** Rôle d'une arête de parcelle par rapport à la façade avant. */
export type EdgeRole = 'front' | 'side' | 'rear';