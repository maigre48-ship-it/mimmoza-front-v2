// src/spaces/promoteur/terrain3d/facade/facadeAi.types.ts

import type { FacadeConfig } from "./buildFacadeSceneInput";

// ─────────────────────────────────────────────────────────────────────────────
// Types UI (valeurs actuelles de l'UX)
// ─────────────────────────────────────────────────────────────────────────────

export type FacadeAiView =
  | "frontale"
  | "3_quarts_legers"
  | "perspective_entree"
  | "angle_rue";

export type FacadeAiBuildingStandard =
  | "economique"
  | "standard"
  | "qualitatif"
  | "premium"
  | "luxe";

export type FacadeAiDrawingStyle =
  | "aquarelle"
  | "brochure_archi";

// ─────────────────────────────────────────────────────────────────────────────
// Types backend normalisés (valeurs envoyées à l'edge function)
// ─────────────────────────────────────────────────────────────────────────────

export type FacadeAiNormalizedView =
  | "frontale"
  | "three-quarter-light"
  | "entree"
  | "street-angle";

export type FacadeAiNormalizedDrawingStyle =
  | "aquarelle"
  | "brochure-archi";

// ─────────────────────────────────────────────────────────────────────────────
// Prompt input
// ─────────────────────────────────────────────────────────────────────────────

export interface FacadeAiPromptInput {
  config: FacadeConfig;
  widthM: number;
  heightM: number;
  levelsCount: number;
  sourceLabel?: string;

  view?: FacadeAiView;
  buildingStandard?: FacadeAiBuildingStandard;
  drawingStyle?: FacadeAiDrawingStyle;

  // ── Mise en scène UX ──────────────────────────────────────────────────────
  includePeople?: boolean;
  includeGroundFloorShops?: boolean;
  includeWindowFlowerPots?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Request vers edge function
// ─────────────────────────────────────────────────────────────────────────────

export interface FacadeAiRenderRequest {
  prompt: string;

  // V1 compat
  referenceImageDataUrl?: string | null;

  // V2 principal : PNG issu de la preview 2D
  baseImageDataUrl?: string | null;
  maskImageDataUrl?: string | null;

  // Paramètres métier / rendu
  view?: FacadeAiView | FacadeAiNormalizedView;
  buildingStandard?: FacadeAiBuildingStandard;
  drawingStyle?: FacadeAiDrawingStyle | FacadeAiNormalizedDrawingStyle;

  floors?: number;

  // Métadonnées utiles de cadrage
  facadeStyleLabel?: string;
  widthM?: number;
  heightM?: number;
  levelsCount?: number;
  sourceLabel?: string;

  // ── Mise en scène UX ──────────────────────────────────────────────────────
  includePeople?: boolean;
  includeGroundFloorShops?: boolean;
  includeWindowFlowerPots?: boolean;

  // Contexte PLU optionnel
  pluContext?: {
    zone?: string;
    maxHeightM?: number | null;
    maxFloorsIndicative?: number | null;
    notes?: string[];
  } | null;

  // Paramètres image
  size?: "1024x1024" | "1024x1536" | "1536x1024" | "1792x1024" | "auto";
  quality?: "low" | "medium" | "high" | "auto";
  outputFormat?: "png" | "jpeg" | "webp";
  background?: "opaque" | "transparent" | "auto";

  // Compat ancienne version
  style?:
    | "promoteur-watercolor"
    | "architect-sketch"
    | "brochure-premium";
}

// ─────────────────────────────────────────────────────────────────────────────
// Réponse edge function
// ─────────────────────────────────────────────────────────────────────────────

export interface FacadeAiRenderResult {
  imageUrl: string;
  promptUsed: string;
}