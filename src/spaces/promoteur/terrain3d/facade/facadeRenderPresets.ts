// src/spaces/promoteur/terrain3d/facade/facadeRenderPresets.ts

import type {
  FacadeRenderResolvedOptions,
  FacadeRenderStyle,
  FacadeRenderOptions,
  FacadeRenderPalette,
} from "./facadeRenderer.types";

const DEFAULT_PALETTE: FacadeRenderPalette = {
  skyTop: "#eaf3fb",
  skyBottom: "#f8fbfe",
  ground: "#d9d1c3",
  paper: "#fbf8f2",
  frame: "#e7dfd2",
};

function getStyleDefaults(style: FacadeRenderStyle): Partial<FacadeRenderResolvedOptions> {
  switch (style) {
    case "clean":
      return {
        backgroundColor: "#f7f7f5",
        palette: {
          skyTop: "#eef5fb",
          skyBottom: "#f9fbfd",
          ground: "#d6d0c5",
          paper: "#fbfbfa",
          frame: "#e9e6df",
        },
        paper: {
          enabled: false,
          opacity: 0,
          fiberDensity: 0.12,
        },
        scene: {
          showSky: true,
          showGround: true,
          showTrees: true,
          treeCount: 2,
          vignette: false,
          shadowOpacity: 0.10,
        },
      };

    case "watercolor":
      return {
        backgroundColor: "#f8f4ed",
        palette: {
          skyTop: "#ddebf7",
          skyBottom: "#f7fbff",
          ground: "#d8cfbe",
          paper: "#faf5eb",
          frame: "#e8decd",
        },
        paper: {
          enabled: true,
          opacity: 0.16,
          fiberDensity: 0.34,
        },
        scene: {
          showSky: true,
          showGround: true,
          showTrees: true,
          treeCount: 3,
          vignette: true,
          shadowOpacity: 0.08,
        },
      };

    case "brochure":
      return {
        backgroundColor: "#f7f4ee",
        palette: {
          skyTop: "#e7f0f8",
          skyBottom: "#fdfefe",
          ground: "#d8d1c7",
          paper: "#faf7f0",
          frame: "#e5ddd0",
        },
        paper: {
          enabled: true,
          opacity: 0.10,
          fiberDensity: 0.20,
        },
        scene: {
          showSky: true,
          showGround: true,
          showTrees: true,
          treeCount: 2,
          vignette: true,
          shadowOpacity: 0.09,
        },
      };

    case "haussmann-soft":
      return {
        backgroundColor: "#f8f4ec",
        palette: {
          skyTop: "#e5eef6",
          skyBottom: "#fbfdff",
          ground: "#d7cfbf",
          paper: "#faf4e8",
          frame: "#e3d6c2",
        },
        paper: {
          enabled: true,
          opacity: 0.14,
          fiberDensity: 0.26,
        },
        scene: {
          showSky: true,
          showGround: true,
          showTrees: true,
          treeCount: 2,
          vignette: true,
          shadowOpacity: 0.07,
        },
      };

    default:
      return {};
  }
}

export function resolveFacadeRenderOptions(
  options: FacadeRenderOptions = {}
): FacadeRenderResolvedOptions {
  const style = options.style ?? "watercolor";
  const styleDefaults = getStyleDefaults(style);

  return {
    style,
    width: options.width ?? 1800,
    height: options.height ?? 1200,
    padding: options.padding ?? 72,
    exportScale: options.exportScale ?? 2,
    backgroundColor:
      options.backgroundColor ??
      styleDefaults.backgroundColor ??
      "#f8f4ed",
    palette: {
      ...DEFAULT_PALETTE,
      ...(styleDefaults.palette ?? {}),
      ...(options.palette ?? {}),
    },
    paper: {
      enabled: options.paper?.enabled ?? styleDefaults.paper?.enabled ?? true,
      opacity: options.paper?.opacity ?? styleDefaults.paper?.opacity ?? 0.12,
      fiberDensity:
        options.paper?.fiberDensity ??
        styleDefaults.paper?.fiberDensity ??
        0.2,
    },
    scene: {
      showSky: options.scene?.showSky ?? styleDefaults.scene?.showSky ?? true,
      showGround:
        options.scene?.showGround ?? styleDefaults.scene?.showGround ?? true,
      showTrees:
        options.scene?.showTrees ?? styleDefaults.scene?.showTrees ?? true,
      treeCount:
        options.scene?.treeCount ?? styleDefaults.scene?.treeCount ?? 2,
      vignette:
        options.scene?.vignette ?? styleDefaults.scene?.vignette ?? true,
      shadowOpacity:
        options.scene?.shadowOpacity ??
        styleDefaults.scene?.shadowOpacity ??
        0.08,
    },
  };
}