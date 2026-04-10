// src/spaces/promoteur/terrain3d/facade/buildFacadeSceneInput.ts
// ─────────────────────────────────────────────────────────────────────────────
// Construction de l'entrée de scène façade.
//
// Historique :
//   V1  — Configuration façade pure (style, matériaux, niveaux…)
//   V2  — Branchement footprint 2D réel via extractFootprintFrom2D
//         • Non destructif : tout l'existant est conservé
//         • Footprint injecté si valide (>= 3 points), ignoré sinon
//         • hasRealFootprint indique au pipeline si l'emprise est réelle
//         • Logging préfixé [MMZ][FacadeSceneInput]
// ─────────────────────────────────────────────────────────────────────────────

import {
  extractFootprintFrom2D,
  type FootprintPoint,
} from "./extractFootprintFrom2D";

// ─────────────────────────────────────────────────────────────────────────────
// Types — Configuration façade (inchangée depuis V1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Style architectural du bâtiment.
 * Doit rester en sync avec les valeurs utilisées dans FacadeGeneratorPage.tsx.
 */
export type FacadeStyle =
  | "contemporain"
  | "standard"
  | "premium"
  | "haussmannien"
  | "mediterraneen";

export type FacadeAmbiance = "matin" | "golden" | "couvert" | "crepuscule";

export type FacadeVegetation = "aucune" | "legere" | "residentielle" | "premium";

/**
 * Configuration complète d'une façade.
 * Correspond au type `FacadeConfig` utilisé dans FacadeGeneratorPage.tsx.
 * NE PAS modifier les noms de propriétés sans auditer les consommateurs.
 */
export type FacadeConfig = {
  // ── Style ──────────────────────────────────────────────────────────────────
  style: FacadeStyle;

  // ── Matériaux ──────────────────────────────────────────────────────────────
  materiauFacade: string;
  materiauMenuiseries: string;
  materiauToiture: string;

  // ── Composition verticale ─────────────────────────────────────────────────
  rdcType: string;
  nbEtages: number;
  attique: boolean;

  // ── Détails architecturaux ────────────────────────────────────────────────
  balcons: boolean;
  loggias: boolean;
  corniche: boolean;
  socle: boolean;
  rythme: string;

  // ── Ambiance & végétation ─────────────────────────────────────────────────
  ambiance: FacadeAmbiance;
  vegetation: FacadeVegetation;
};

// ─────────────────────────────────────────────────────────────────────────────
// Types — Entrée de scène enrichie (V2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Entrée complète transmise au pipeline de rendu façade.
 *
 * Rétrocompatibilité :
 *   • Toutes les propriétés de FacadeConfig sont spread au niveau racine —
 *     les consommateurs existants qui accèdent à style, nbEtages, etc.
 *     directement sur l'objet retourné continuent de fonctionner sans
 *     modification.
 *   • Les 3 propriétés ajoutées en V2 (buildingId, footprint,
 *     hasRealFootprint) sont optionnelles côté consommateur.
 */
export type FacadeSceneInput = FacadeConfig & {
  // ── V2 — Emprise réelle ────────────────────────────────────────────────────

  /**
   * Identifiant du bâtiment dans editor2d.store.
   * Présent uniquement si buildFacadeSceneInput a été appelé avec un buildingId.
   */
  buildingId: string | null;

  /**
   * Polygone d'emprise extrait depuis le plan 2D.
   * Tableau vide ([]) si aucune emprise valide n'a pu être extraite.
   * Contient toujours au moins 3 points si hasRealFootprint === true.
   */
  footprint: FootprintPoint[];

  /**
   * Vrai si le footprint est issu du plan 2D réel (>= 3 points valides).
   * Faux si on fonctionne en mode fallback géométrique.
   *
   * Le pipeline peut utiliser ce flag pour décider d'utiliser les vraies
   * dimensions de la parcelle ou les constantes W/D par défaut.
   */
  hasRealFootprint: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers internes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Détermine si un tableau de points constitue un footprint valide.
 * Critère minimal : au moins 3 points (polygone fermable).
 */
function hasValidFootprint(pts: FootprintPoint[]): boolean {
  return Array.isArray(pts) && pts.length >= 3;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fonction principale
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Construit l'entrée de scène façade complète.
 *
 * Comportement :
 *   1. Spread de `config` (inchangé depuis V1).
 *   2. Si `buildingId` est fourni, appelle extractFootprintFrom2D.
 *   3. Si le footprint est valide (>= 3 pts), l'injecte et pose
 *      hasRealFootprint = true.
 *   4. Sinon, footprint = [] et hasRealFootprint = false —
 *      le pipeline utilise les dimensions géométriques par défaut.
 *
 * @param config     - Configuration façade complète (obligatoire)
 * @param buildingId - Id du bâtiment dans editor2d.store (optionnel)
 * @returns FacadeSceneInput — jamais throw
 */
export function buildFacadeSceneInput(
  config: FacadeConfig,
  buildingId?: string | null,
): FacadeSceneInput {
  // ── Valeurs par défaut V2 (mode fallback) ─────────────────────────────────
  let footprint: FootprintPoint[] = [];
  let hasRealFootprint = false;
  const resolvedBuildingId: string | null = buildingId ?? null;

  // ── Extraction footprint si buildingId disponible ─────────────────────────
  if (typeof buildingId === "string" && buildingId.trim().length > 0) {
    try {
      const extracted = extractFootprintFrom2D(buildingId);

      if (hasValidFootprint(extracted)) {
        footprint = extracted;
        hasRealFootprint = true;
        console.log(
          `[MMZ][FacadeSceneInput] Footprint réel branché — ` +
          `buildingId:"${buildingId}" · ${footprint.length} points`,
        );
      } else {
        // extractFootprintFrom2D a déjà loggé le motif — on l'indique ici
        // seulement au niveau FacadeSceneInput pour traçabilité du fallback.
        console.warn(
          `[MMZ][FacadeSceneInput] Footprint invalide ou vide pour ` +
          `buildingId:"${buildingId}" — fallback géométrique activé`,
        );
      }
    } catch (err) {
      // Filet de sécurité : extractFootprintFrom2D ne doit pas throw,
      // mais on protège quand même buildFacadeSceneInput.
      console.error(
        `[MMZ][FacadeSceneInput] Erreur inattendue lors de l'extraction ` +
        `du footprint pour buildingId:"${buildingId}" :`,
        err,
      );
      // footprint et hasRealFootprint restent sur leurs valeurs par défaut
    }
  } else {
    // Pas de buildingId — mode legacy, aucun log superflu
    if (buildingId !== undefined && buildingId !== null) {
      console.warn(
        `[MMZ][FacadeSceneInput] buildingId fourni mais vide ou non-string :`,
        buildingId,
      );
    }
  }

  // ── Assemblage final ──────────────────────────────────────────────────────
  // Le spread de config en premier garantit que toutes les propriétés
  // FacadeConfig sont accessibles directement sur le résultat (rétrocompat V1).
  // Les propriétés V2 viennent après et ne peuvent pas entrer en collision
  // car leurs noms (buildingId, footprint, hasRealFootprint) n'existaient pas
  // dans FacadeConfig.
  const result: FacadeSceneInput = {
    ...config,
    buildingId: resolvedBuildingId,
    footprint,
    hasRealFootprint,
  };

  if (!hasRealFootprint) {
    console.log(
      `[MMZ][FacadeSceneInput] Mode fallback géométrique — ` +
      `style:"${config.style}" · ${config.nbEtages}N` +
      (resolvedBuildingId ? ` · buildingId:"${resolvedBuildingId}"` : ""),
    );
  }

  return result;
}