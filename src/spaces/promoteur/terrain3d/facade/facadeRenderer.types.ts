// src/spaces/promoteur/terrain3d/facade/facadeRenderer.types.ts

export type FacadeRenderStyle =
  | "clean"
  | "watercolor"
  | "brochure"
  | "haussmann-soft";

export interface FacadeRenderPaperOptions {
  enabled?: boolean;
  opacity?: number; // 0..1
  fiberDensity?: number; // 0..1
}

export interface FacadeRenderSceneOptions {
  showSky?: boolean;
  showGround?: boolean;
  showTrees?: boolean;
  treeCount?: number;
  vignette?: boolean;
  shadowOpacity?: number; // 0..1
}

export interface FacadeRenderPalette {
  skyTop: string;
  skyBottom: string;
  ground: string;
  paper: string;
  frame: string;
}

export interface FacadeRenderOptions {
  style?: FacadeRenderStyle;
  width?: number;
  height?: number;
  padding?: number;
  exportScale?: number; // ex: 2 ou 3
  backgroundColor?: string;
  palette?: Partial<FacadeRenderPalette>;
  paper?: FacadeRenderPaperOptions;
  scene?: FacadeRenderSceneOptions;
}

export interface FacadeRenderResolvedOptions {
  style: FacadeRenderStyle;
  width: number;
  height: number;
  padding: number;
  exportScale: number;
  backgroundColor: string;
  palette: FacadeRenderPalette;
  paper: Required<FacadeRenderPaperOptions>;
  scene: Required<FacadeRenderSceneOptions>;
}