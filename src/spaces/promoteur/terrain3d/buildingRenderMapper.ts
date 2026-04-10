// src/spaces/promoteur/terrain3d/buildingRenderMapper.ts
// Mapper principal : BuildingBlenderSpec → ResolvedBuildingRender
// V2 : presets externalisés vers buildingRenderPresets.ts + renderScenePresets.ts

import type { BuildingBlenderSpec } from "./buildingBlenderSpec.types";
import type { MassingBuildingModel } from "../massingScene.types";
import { ensureBuildingRenderSpec } from "./buildingBlenderSpec.helpers";
import {
  getFacadePreset,
  getGlazingForFamily,
  getRoofPreset,
  getRailingPreset,
  legacyFacadeToFamily,
  vegetationDensityForSiteFinish,
  defaultTreeCount,
} from "./buildingRenderPresets";
import { getScenePreset } from "./renderScenePresets";

// ═════════════════════════════════════════════════════════════════════════════
// TYPE DE SORTIE PRINCIPAL
// ═════════════════════════════════════════════════════════════════════════════

export type ResolvedBuildingRender = {
  identity: {
    usage:    string;
    style:    string;
    standing: string;
  };

  facade: {
    family:             string;
    baseColor:          string;
    texturePresetId?:   string;
    textureRotationDeg: number;
    textureScale:       number;
    roughness:          number;
    metalness:          number;
    reliefStrength:     number;
    bayWidthM:          number;
    glazingRatioPct:    number;
    modulationType:     string;
    openingType:        string;
    openingRhythm:      string;
    frameColor:         string;
    frameDepth:         "thin" | "standard" | "strong";
  };

  glazing: {
    color:            string;
    opacity:          number;
    roughness:        number;
    metalness:        number;
    emissiveStrength: number;
  };

  roof: {
    type:                    string;
    color:                   string;
    texturePresetId?:        string;
    roughness:               number;
    metalness:               number;
    vegetationLevel:         "low" | "medium" | "high" | "none";
    crownType:               string;
    roofRailing:             "none" | "discreet" | "visible";
    technicalVolumesVisible: boolean;
    solarPanels:             boolean;
  };

  balconies: {
    enabled:               boolean;
    frequency:             number;
    depthM:                number;
    type:                  "filant" | "ponctuel" | "loggia" | "none";
    slabProjectionEnabled: boolean;
    railingType:           "metal" | "glass" | "masonry" | "none";
    railingColor:          string;
  };

  structure: {
    edgeColumnsEnabled: boolean;
    structureColor:     string;
    slabColor:          string;
  };

  landscape: {
    siteFinish:           "raw" | "simple" | "landscaped" | "premium";
    groundMaterial:       "asphalt" | "concrete" | "pavers" | "gravel" | "grass";
    hedgeEnabled:         boolean;
    hedgeHeightM:         number;
    treeCount:            number;
    treeType:             "deciduous" | "conifer" | "palm" | "round" | "columnar";
    fenceType:            "none" | "grid" | "low_wall" | "hedge" | "mixed";
    gateEnabled:          boolean;
    parkingVisible:       boolean;
    lightStreetFurniture: "none" | "residential" | "tertiary";
    vegetationDensity:    number;
  };

  scene: {
    renderIntent:     string;
    timeOfDay:        string;
    sky:              string;
    detailLevel:      "fast" | "standard" | "premium";
    urbanContext:     "none" | "neutral_masses" | "simplified_context";
    shadowStrength:   number;
    lightIntensity:   number;
    ambientIntensity: number;
    contrast:         number;
    saturation:       number;
  };

  camera: {
    cameraView:    "pedestrian" | "aerial_3q" | "street_front" | "parcel_corner";
    focalLengthMm: 35 | 50 | 70;
    outputFormat:  "square" | "landscape" | "portrait_a4";
    usage:         "faisabilite" | "banque" | "comite" | "commercial";
  };
};

// ═════════════════════════════════════════════════════════════════════════════
// HELPERS INTERNES
// ═════════════════════════════════════════════════════════════════════════════

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function isValidHex(s: string | undefined | null): s is string {
  return typeof s === "string" && /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(s);
}

function pickColor(override: string | undefined | null, fallback: string): string {
  return isValidHex(override) ? override : fallback;
}

function pickFocalLength(mm: number | undefined): 35 | 50 | 70 {
  if (mm && mm <= 42) return 35;
  if (mm && mm >= 60) return 70;
  return 50;
}

// ═════════════════════════════════════════════════════════════════════════════
// RÉSOLUTION PAR SECTION
// ═════════════════════════════════════════════════════════════════════════════

function resolveFacadeRender(spec: BuildingBlenderSpec): ResolvedBuildingRender["facade"] {
  const f      = spec.facade;
  const family = f?.family ?? legacyFacadeToFamily(undefined);
  const preset = getFacadePreset(family);

  const isCurtainWall = family === "mur_rideau";
  const isTertiaire   = spec.identity?.style === "tertiaire_vitre";
  const glazingRatio  = f?.glazingRatioPct ?? (isCurtainWall || isTertiaire ? 85 : 55);

  return {
    family,
    baseColor:          pickColor(f?.baseColor, preset.defaultColor),
    texturePresetId:    f?.texturePresetId,
    textureRotationDeg: f?.textureRotationDeg ?? 0,
    textureScale:       f?.textureScale       ?? preset.textureScale,
    roughness:          clamp(preset.roughness,      0, 1),
    metalness:          clamp(preset.metalness,      0, 1),
    reliefStrength:     clamp(preset.reliefStrength, 0, 1),
    bayWidthM:          f?.bayWidthM           ?? 3.5,
    glazingRatioPct:    clamp(glazingRatio,           0, 100),
    modulationType:     f?.modulationType      ?? "horizontal_bands",
    openingType:        f?.openingType         ?? "window",
    openingRhythm:      f?.openingRhythm       ?? "regular",
    frameColor:         pickColor(f?.frameColor, preset.frameColor),
    frameDepth:         (f?.frameDepth as "thin" | "standard" | "strong") ?? "standard",
  };
}

function resolveGlazingRender(spec: BuildingBlenderSpec): ResolvedBuildingRender["glazing"] {
  const family = spec.facade?.family;
  const preset = getGlazingForFamily(family);

  const isCurtainWall = family === "mur_rideau";
  const isTertiaire   = spec.identity?.style === "tertiaire_vitre";
  const boost = isCurtainWall || isTertiaire;

  return {
    color:            preset.color,
    opacity:          boost ? clamp(preset.opacity - 0.12, 0.30, 1) : preset.opacity,
    roughness:        boost ? clamp(preset.roughness - 0.02, 0, 1)  : preset.roughness,
    metalness:        boost ? clamp(preset.metalness + 0.10, 0, 1)  : preset.metalness,
    emissiveStrength: preset.emissiveStrength,
  };
}

function resolveRoofRender(spec: BuildingBlenderSpec): ResolvedBuildingRender["roof"] {
  const r      = spec.roof;
  const preset = getRoofPreset(r?.type);

  const vegLevel = r?.vegetationLevel;
  const resolvedVeg: "low" | "medium" | "high" | "none" =
    vegLevel === "low" || vegLevel === "medium" || vegLevel === "high" ? vegLevel : "none";

  return {
    type:                    r?.type ?? "terrasse",
    color:                   pickColor(r?.roofColor, preset.color),
    texturePresetId:         r?.texturePresetId,
    roughness:               preset.roughness,
    metalness:               preset.metalness,
    vegetationLevel:         resolvedVeg,
    crownType:               r?.crownType  ?? "thin_parapet",
    roofRailing:             (r?.roofRailing as "none" | "discreet" | "visible") ?? "discreet",
    technicalVolumesVisible: r?.technicalVolumesVisible ?? false,
    solarPanels:             r?.solarPanels ?? false,
  };
}

function resolveBalconiesRender(spec: BuildingBlenderSpec): ResolvedBuildingRender["balconies"] {
  const m       = spec.morphology;
  const enabled = m?.balconyEnabled ?? false;

  if (!enabled) {
    return {
      enabled:               false,
      frequency:             0,
      depthM:                0,
      type:                  "none",
      slabProjectionEnabled: m?.slabProjectionEnabled ?? false,
      railingType:           "none",
      railingColor:          "#374151",
    };
  }

  const railingType   = spec.facade?.railingType ?? "metal";
  const railingPreset = getRailingPreset(railingType);

  return {
    enabled:               true,
    frequency:             m?.balconyEveryNFloors ?? 1,
    depthM:                clamp(m?.balconyDepthM ?? 1.2, 0.6, 2.5),
    type:                  (m?.balconyType as "filant" | "ponctuel" | "loggia") ?? "filant",
    slabProjectionEnabled: m?.slabProjectionEnabled ?? false,
    railingType:           railingType as "metal" | "glass" | "masonry",
    railingColor:          pickColor(spec.facade?.railingColor, railingPreset.color),
  };
}

function resolveStructureRender(spec: BuildingBlenderSpec): ResolvedBuildingRender["structure"] {
  return {
    edgeColumnsEnabled: spec.morphology?.edgeColumnsEnabled ?? false,
    structureColor:     pickColor(spec.facade?.frameColor, "#374151"),
    slabColor:          "#D8D4CC",
  };
}

function resolveLandscapeRender(spec: BuildingBlenderSpec): ResolvedBuildingRender["landscape"] {
  const ls         = spec.landscape;
  const siteFinish = (ls?.siteFinish as "raw" | "simple" | "landscaped" | "premium") ?? "simple";

  return {
    siteFinish,
    groundMaterial:      (ls?.groundMaterial as ResolvedBuildingRender["landscape"]["groundMaterial"]) ?? "pavers",
    hedgeEnabled:        ls?.hedgeEnabled ?? false,
    hedgeHeightM:        ls?.hedgeHeightM ?? 1.2,
    treeCount:           ls?.treeCount    ?? defaultTreeCount(siteFinish),
    treeType:            (ls?.treeType as ResolvedBuildingRender["landscape"]["treeType"]) ?? "deciduous",
    fenceType:           (ls?.fenceType  as ResolvedBuildingRender["landscape"]["fenceType"]) ?? "none",
    gateEnabled:         ls?.gateEnabled    ?? false,
    parkingVisible:      ls?.parkingVisible ?? true,
    lightStreetFurniture:(ls?.lightStreetFurniture as ResolvedBuildingRender["landscape"]["lightStreetFurniture"]) ?? "none",
    vegetationDensity:   vegetationDensityForSiteFinish(siteFinish),
  };
}

function resolveSceneRender(spec: BuildingBlenderSpec): ResolvedBuildingRender["scene"] {
  const r      = spec.render;
  const intent = r?.intent ?? "promoteur_premium";
  const preset = getScenePreset(intent);

  return {
    renderIntent:     intent,
    timeOfDay:        r?.timeOfDay    ?? "afternoon",
    sky:              r?.sky          ?? "neutral",
    detailLevel:      (r?.detailLevel  as "fast" | "standard" | "premium") ?? "standard",
    urbanContext:     (r?.urbanContext as "none" | "neutral_masses" | "simplified_context") ?? "neutral_masses",
    shadowStrength:   preset.shadowStrength,
    lightIntensity:   preset.lightIntensity,
    ambientIntensity: preset.ambientIntensity,
    contrast:         preset.contrast,
    saturation:       preset.saturation,
  };
}

function resolveCameraRender(spec: BuildingBlenderSpec): ResolvedBuildingRender["camera"] {
  const r = spec.render;
  return {
    cameraView:    (r?.cameraView   as ResolvedBuildingRender["camera"]["cameraView"]) ?? "aerial_3q",
    focalLengthMm: pickFocalLength(r?.focalLengthMm),
    outputFormat:  (r?.outputFormat as ResolvedBuildingRender["camera"]["outputFormat"]) ?? "landscape",
    usage:         (r?.usage        as ResolvedBuildingRender["camera"]["usage"]) ?? "comite",
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// DÉFAUT COMPLET
// ═════════════════════════════════════════════════════════════════════════════

function makeDefaultResolved(): ResolvedBuildingRender {
  const fp = getFacadePreset("enduit");
  const gp = getGlazingForFamily("enduit");
  const rp = getRoofPreset("terrasse");
  const sp = getScenePreset("promoteur_premium");

  return {
    identity: { usage: "logement_collectif", style: "residentiel_moderne", standing: "standard" },
    facade: {
      family: "enduit", baseColor: fp.defaultColor,
      textureRotationDeg: 0, textureScale: 1.0,
      roughness: fp.roughness, metalness: fp.metalness, reliefStrength: fp.reliefStrength,
      bayWidthM: 3.5, glazingRatioPct: 55, modulationType: "horizontal_bands",
      openingType: "window", openingRhythm: "regular",
      frameColor: fp.frameColor, frameDepth: "standard",
    },
    glazing: { color: gp.color, opacity: gp.opacity, roughness: gp.roughness, metalness: gp.metalness, emissiveStrength: 0 },
    roof: {
      type: "terrasse", color: rp.color, roughness: rp.roughness, metalness: rp.metalness,
      vegetationLevel: "none", crownType: "thin_parapet", roofRailing: "discreet",
      technicalVolumesVisible: false, solarPanels: false,
    },
    balconies: {
      enabled: false, frequency: 0, depthM: 0, type: "none",
      slabProjectionEnabled: false, railingType: "none", railingColor: "#374151",
    },
    structure: { edgeColumnsEnabled: false, structureColor: "#374151", slabColor: "#D8D4CC" },
    landscape: {
      siteFinish: "simple", groundMaterial: "pavers", hedgeEnabled: false,
      hedgeHeightM: 1.2, treeCount: 1, treeType: "deciduous",
      fenceType: "none", gateEnabled: false, parkingVisible: true,
      lightStreetFurniture: "none", vegetationDensity: 0.25,
    },
    scene: {
      renderIntent: "promoteur_premium", timeOfDay: "afternoon", sky: "neutral",
      detailLevel: "standard", urbanContext: "neutral_masses",
      shadowStrength: sp.shadowStrength, lightIntensity: sp.lightIntensity,
      ambientIntensity: sp.ambientIntensity, contrast: sp.contrast, saturation: sp.saturation,
    },
    camera: { cameraView: "aerial_3q", focalLengthMm: 50, outputFormat: "landscape", usage: "comite" },
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// EXPORTS PRINCIPAUX
// ═════════════════════════════════════════════════════════════════════════════

export function resolveBuildingRenderSpec(spec: BuildingBlenderSpec): ResolvedBuildingRender {
  try {
    return {
      identity: {
        usage:    spec.identity?.usage    ?? "logement_collectif",
        style:    spec.identity?.style    ?? "residentiel_moderne",
        standing: spec.identity?.standing ?? "standard",
      },
      facade:    resolveFacadeRender(spec),
      glazing:   resolveGlazingRender(spec),
      roof:      resolveRoofRender(spec),
      balconies: resolveBalconiesRender(spec),
      structure: resolveStructureRender(spec),
      landscape: resolveLandscapeRender(spec),
      scene:     resolveSceneRender(spec),
      camera:    resolveCameraRender(spec),
    };
  } catch {
    return makeDefaultResolved();
  }
}

export function resolveBuildingRenderFromBuilding(building: MassingBuildingModel): ResolvedBuildingRender {
  try {
    return resolveBuildingRenderSpec(ensureBuildingRenderSpec(building));
  } catch {
    return makeDefaultResolved();
  }
}

export function resolveBuildingRenderSpecSafe(
  spec: BuildingBlenderSpec | null | undefined,
): ResolvedBuildingRender {
  if (!spec) return makeDefaultResolved();
  return resolveBuildingRenderSpec(spec);
}

export function resolveFacadeColorQuick(spec: BuildingBlenderSpec | null | undefined): string {
  if (!spec) return getFacadePreset("enduit").defaultColor;
  const preset = getFacadePreset(spec.facade?.family);
  return isValidHex(spec.facade?.baseColor) ? spec.facade!.baseColor! : preset.defaultColor;
}