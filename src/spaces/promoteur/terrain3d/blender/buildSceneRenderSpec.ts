// src/spaces/promoteur/terrain3d/blender/buildSceneRenderSpec.ts
// ═══════════════════════════════════════════════════════════════
// V3 — Hero building, camera composition enrichie, snake_case materials,
//       landscape étendu, inferHeroFacadeDirection, renderPriority.
//
// Dépend de blenderExport.types.ts V3 :
//   - CameraCompositionSpec (tous les champs composition typés)
//   - BuildingObjectSpec / BuildingStyleSpec / BuildingMetaSpec
//   - TerrainObjectSpec
// Aucun cast `as` de type dans ce fichier.
// ═══════════════════════════════════════════════════════════════

import type { Feature, MultiPolygon, Polygon } from "geojson";

import type { MassingBuildingModel } from "../massingScene.types";
import {
  totalHeightFromArchitecture,
  totalLevelsFromArchitecture,
} from "../massingScene.types";
import type { ReliefData } from "../services/terrainSampler";

import { getFacadeStyle } from "../massingFacadeStyles";
import { ensureBuildingRenderSpec } from "../buildingBlenderSpec.helpers";
import { resolveBuildingRenderSpecSafe } from "../buildingRenderMapper";

import type {
  BuildingMetaSpec,
  BuildingObjectSpec,
  BuildingStyleSpec,
  CameraCompositionSpec,
  CameraSpec,
  LightingSpec,
  ObjectMaterialSpec,
  PBRMaterialSpec,
  RenderSettingsSpec,
  SceneObjectSpec,
  SceneRenderSpec,
  TerrainObjectSpec,
  TransformSpec,
} from "./blenderExport.types";

import {
  makeBuildingRootName,
  makeFacadeName,
  makeGlazingName,
  makeRoofName,
  makeStructureName,
  makeTerrainName,
  makeTerrainRootName,
} from "./blenderNaming";

// ─────────────────────────────────────────────────────────────
// TYPES D'ENTRÉE
// ─────────────────────────────────────────────────────────────

export interface BuildSceneRenderSpecInput {
  buildings: MassingBuildingModel[];
  parcel?: Feature<Polygon | MultiPolygon>;
  reliefData?: ReliefData | null;
  projectName?: string;
  camera?: {
    position: [number, number, number];
    target: [number, number, number];
    lensMm?: number;
    name?: string;
    clipStart?: number;
    clipEnd?: number;
    preset?: string;
    fitStrategy?: string;
    heroFacadeDirection?: string;
    heroObjectKey?: string;
  };
  lighting?: Partial<LightingSpec>;
  render?: Partial<RenderSettingsSpec>;
}

export interface BuildSceneRenderSpecOptions {
  exportedAt?: string;
}

// ─────────────────────────────────────────────────────────────
// API PRINCIPALE
// ─────────────────────────────────────────────────────────────

export function buildSceneRenderSpec(
  input: BuildSceneRenderSpecInput,
  options: BuildSceneRenderSpecOptions = {},
): SceneRenderSpec {
  const visibleBuildings = safeArray(input.buildings).filter(
    (b) => b.visible !== false,
  );

  const dominantIntent = pickDominantIntentFromBuildings(visibleBuildings);
  const firstResolvedLandscape = resolveFirstLandscape(visibleBuildings);

  const heroBuilding = visibleBuildings[0];
  const heroObjectKey =
    input.camera?.heroObjectKey ??
    (heroBuilding ? `building:${heroBuilding.id}` : "building:main");
  const heroFacadeDirection =
    input.camera?.heroFacadeDirection ?? inferHeroFacadeDirection(heroBuilding);

  const sceneSpec: SceneRenderSpec["scene"] = {
    unitSystem: "meters",
    upAxis: "Z",
    forwardAxis: "-Y",
    renderIntent: dominantIntent ?? "promoteur_premium",
    projectName: input.projectName,
    terrain: {
      meshName: makeTerrainName("main"),
      enabled: Boolean(input.parcel ?? input.reliefData),
    },
  };

  const objects: SceneObjectSpec[] = [];

  if (input.parcel ?? input.reliefData) {
    objects.push(buildTerrainObject(firstResolvedLandscape?.groundMaterial));
  }

  for (let i = 0; i < visibleBuildings.length; i += 1) {
    objects.push(
      buildBuildingObject(visibleBuildings[i], { isHeroBuilding: i === 0 }),
    );
  }

  return {
    format: "mimmoza.blender-render-spec",
    version: "1.0.0",
    generator: {
      app: "mimmoza",
      module: "terrain3d",
      exportedAt: options.exportedAt ?? new Date().toISOString(),
    },
    scene: sceneSpec,
    objects,
    camera: buildCameraSpec(
      { ...input.camera, heroObjectKey, heroFacadeDirection },
      heroObjectKey,
    ),
    lighting: buildLightingSpec(input.lighting),
    environment: buildEnvironmentSpec(dominantIntent),
    render: buildRenderSettingsSpec(input.render),
  };
}

// ─────────────────────────────────────────────────────────────
// BUILDERS OBJETS
// ─────────────────────────────────────────────────────────────

interface BuildBuildingObjectOptions {
  isHeroBuilding?: boolean;
}

function buildBuildingObject(
  building: MassingBuildingModel,
  options: BuildBuildingObjectOptions = {},
): BuildingObjectSpec {
  const isHeroBuilding = options.isHeroBuilding === true;

  const spec = ensureBuildingRenderSpec(building);
  const resolved = resolveBuildingRenderSpecSafe(spec);

  const buildingId = building.id;
  const prefix = makeBuildingRootName(buildingId).replace("_ROOT", "");

  const structureMeshName = makeStructureName(buildingId);
  const roofMeshName = makeRoofName(buildingId);
  const facadeMeshName = makeFacadeName(buildingId, 0);
  const glazingMeshName = makeGlazingName(buildingId, 0);

  const arch = building.architecture;
  const styleId = readFacadeStyleId(building);
  const facadeStyleDef = getFacadeStyle(styleId ?? null);

  const facadeCategories: string[] = ["glazing", "frames", "banding"];
  if (
    facadeStyleDef.upper.hasBalconies &&
    facadeStyleDef.upper.balconyType !== "none"
  ) {
    facadeCategories.push("balcony_slab", "balcony_rail");
  }
  if (facadeStyleDef.features.loggias) {
    facadeCategories.push("loggias");
  }
  if (
    facadeStyleDef.features.shading &&
    facadeStyleDef.features.shadingType !== "none"
  ) {
    facadeCategories.push("shading");
  }
  if (facadeStyleDef.ground.hasSocle) {
    facadeCategories.push("socle");
  }
  if (facadeStyleDef.attic.hasCornice) {
    facadeCategories.push("cornice");
  }
  facadeCategories.push("entrance");

  const enrichedMeshNames: string[] = [];
  const enrichedMeshGroups: Record<string, string[]> = {};
  for (const cat of facadeCategories) {
    const meshName = `${prefix}_${cat.toUpperCase()}_00`;
    enrichedMeshNames.push(meshName);
    enrichedMeshGroups[cat] = [meshName];
  }

  const meshNames = uniqueStrings([
    structureMeshName,
    roofMeshName,
    facadeMeshName,
    glazingMeshName,
    ...enrichedMeshNames,
  ]);

  const meshGroups: Record<string, string[]> = {
    structure: [structureMeshName],
    roof:      [roofMeshName],
    facade:    [facadeMeshName],
    glazing:   enrichedMeshGroups["glazing"] ?? [glazingMeshName],
    ...enrichedMeshGroups,
  };

  const hasSocle = facadeStyleDef.ground.hasSocle;
  const hasCornice = facadeStyleDef.attic.hasCornice;
  const facadeBaseColor = resolved.facade.baseColor;
  const frameColor = normalizeHex(facadeStyleDef.base.frameColor, "#3A3A3A");

  const materials: ObjectMaterialSpec = {
    facade:       buildFacadeMaterial(facadeBaseColor),
    structure:    buildStructureMaterial(resolved.structure.structureColor),
    roof:         buildRoofMaterial(resolved.roof.color),
    glazing:      buildGlazingMaterial({
      color:     resolved.glazing.color,
      opacity:   resolved.glazing.opacity,
      roughness: resolved.glazing.roughness,
      metalness: resolved.glazing.metalness,
    }),
    balcony_rail: buildBalconyRailingMaterial(resolved.balconies.railingColor),
    balcony_slab: buildBalconySlabMaterial(facadeBaseColor),
    frames: {
      baseColor: frameColor,
      roughness: 0.55,
      metallic:  0.02,
      alpha:     1.0,
    },
    banding: {
      baseColor: "#d8d4cc",
      roughness: 0.65,
      metallic:  0.0,
      alpha:     1.0,
    },
    entrance: {
      baseColor: "#2d2d2d",
      roughness: 0.45,
      metallic:  0.3,
      alpha:     1.0,
    },
    shading: {
      baseColor: "#8B8B85",
      roughness: 0.70,
      metallic:  0.1,
      alpha:     1.0,
    },
    loggias: {
      baseColor: "#d0ccc4",
      roughness: 0.80,
      metallic:  0.0,
      alpha:     1.0,
    },
    ...(hasSocle
      ? {
          socle: {
            baseColor: darkenHex(facadeBaseColor ?? "#d9d1c3", 0.78),
            roughness: 0.90,
            metallic:  0.0,
            alpha:     1.0,
          } satisfies PBRMaterialSpec,
        }
      : {}),
    ...(hasCornice
      ? {
          cornice: {
            baseColor: "#d8d4cc",
            roughness: 0.72,
            metallic:  0.0,
            alpha:     1.0,
          } satisfies PBRMaterialSpec,
        }
      : {}),
  };

  const heroFacadeDir = inferHeroFacadeDirection(building);
  const facadeDepthHint: BuildingStyleSpec["facadeDepthHint"] =
    facadeStyleDef.base.frameThickness > 0.18
      ? "deep"
      : facadeStyleDef.base.frameThickness > 0.10
        ? "medium"
        : "light";

  const style: BuildingStyleSpec = {
    renderIntent:          resolved.scene.renderIntent,
    facadeStyleId:         styleId,
    architecturalLanguage: facadeStyleDef.id,
    windowRhythm:          "regular",
    facadeDepthVariation:  facadeStyleDef.base.frameThickness,
    facadeDepthHint,
    socleHeightM: hasSocle
      ? safeNumber(arch?.vertical?.socleHeightM ?? 3.6, 3.6)
      : 0,
    socleFinish:           hasSocle ? "concrete" : "none",
    corniceEnabled:        hasCornice,
    corniceDepthM:         hasCornice ? 0.25 : 0,
    entranceEmphasis:      "marquise",
    balconiesEnabled:
      resolved.balconies.enabled || facadeStyleDef.upper.hasBalconies,
    balconiesType:
      facadeStyleDef.upper.balconyType !== "none"
        ? facadeStyleDef.upper.balconyType
        : (resolved.balconies.type ?? "none"),
    balconiesFrequency:  resolved.balconies.frequency,
    balconiesDepthM:
      facadeStyleDef.upper.balconyDepth || resolved.balconies.depthM,
    balconyRailingType:  resolved.balconies.railingType ?? "glass",
    glazingColor:        resolved.glazing.color,
    glazingOpacity:      resolved.glazing.opacity,
    landscapeGroundMaterial: resolved.landscape.groundMaterial,
    landscapeSiteFinish: resolved.landscape.siteFinish,
    heroFacadeDirection: heroFacadeDir,
    massingCharacter:    "clean_modern",
    contextTreatment:    isHeroBuilding ? "hero_sharp" : "soft_neutral",
  };

  const meta: BuildingMetaSpec = {
    name:    building.name,
    visible: building.visible !== false,
    levelCount: arch
      ? totalLevelsFromArchitecture(arch)
      : safeNumber(totalLevelsCountSafe(building), 1),
    totalHeightM: arch
      ? totalHeightFromArchitecture(arch)
      : safeNumber(totalHeightSafe(building), 3),
    floorToFloorM:
      arch?.vertical?.upperFloorHeightM ??
      building.levels?.typicalFloorHeightM ??
      2.8,
    groundFloorHeightM:
      arch?.vertical?.socleHeightM ??
      building.levels?.groundFloorHeightM ??
      3.0,
    roofType:  arch?.roof?.roofType ?? "flat",
    roofColor: resolved.roof.color,
    heroObject:                    isHeroBuilding,
    renderPriority:                isHeroBuilding ? 1 : 2,
    excludeFromContextSuppression: false,
    landscape: {
      groundMaterial:    resolved.landscape.groundMaterial,
      siteFinish:        resolved.landscape.siteFinish,
      vegetationDensity: resolved.landscape.vegetationDensity,
      treeCount:         resolved.landscape.treeCount,
      hedgeEnabled:      resolved.landscape.hedgeEnabled,
      parkingVisible:    resolved.landscape.parkingVisible,
      treeMode:               "guided",
      generateExtendedGround: true,
      generateParvis:         isHeroBuilding,
      generateAccessPath:     isHeroBuilding,
      generateTrees:          true,
      generateHedges:         resolved.landscape.hedgeEnabled,
    },
  };

  return {
    type: "building",
    objectKey: `building:${buildingId}`,
    sourceId:  buildingId,
    rootObjectName: makeBuildingRootName(buildingId),
    meshNames,
    meshGroups,
    transform: buildTransformSpec(building),
    materials,
    style,
    meta,
  };
}

function buildTerrainObject(groundMaterial: string | undefined): TerrainObjectSpec {
  const terrainRootName = makeTerrainRootName("main");
  const terrainMeshName = makeTerrainName("main");
  return {
    type: "terrain",
    objectKey: "terrain:main",
    sourceId:  "main",
    rootObjectName: terrainRootName,
    meshNames: [terrainMeshName],
    meshGroups: { ground: [terrainMeshName] },
    materials:  { ground: buildGroundMaterial(groundMaterial) },
    meta:       { groundMaterial: groundMaterial ?? "grass" },
  };
}

// ─────────────────────────────────────────────────────────────
// CAMERA / LIGHT / WORLD / RENDER
// ─────────────────────────────────────────────────────────────

function buildCameraSpec(
  input?: BuildSceneRenderSpecInput["camera"],
  heroObjectKey?: string,
): CameraSpec {
  const composition: CameraCompositionSpec = {
    preset:                   input?.preset      ?? "hero_three_quarter",
    fitStrategy:              input?.fitStrategy ?? "building_only",
    heroFacadeDirection:      input?.heroFacadeDirection ?? "south",
    targetObjectKey:          input?.heroObjectKey ?? heroObjectKey ?? "building:main",
    framingTightness:         0.88,
    foregroundDepth:          0.18,
    contextSuppression:       "soft",
    hideNearContextIfBlocking: true,
    avoidLeftOccluder:        true,
  };
  return {
    mode: "perspective",
    name: input?.name ?? "MMZ_CAMERA_MAIN",
    position: input?.position ?? [30, 20, -15],
    target:   input?.target   ?? [0, 5, 0],
    lensMm:   input?.lensMm   ?? 42,
    clipStart: input?.clipStart ?? 0.1,
    clipEnd:   input?.clipEnd   ?? 5000,
    composition,
  };
}

function buildLightingSpec(input?: Partial<LightingSpec>): LightingSpec {
  return {
    sun: {
      enabled:          input?.sun?.enabled          ?? true,
      name:             input?.sun?.name             ?? "MMZ_SUN_MAIN",
      rotationEulerDeg: input?.sun?.rotationEulerDeg ?? [42, 0, 128],
      energy:           input?.sun?.energy           ?? 3.5,
      angle:            input?.sun?.angle            ?? 0.8,
      color:            input?.sun?.color            ?? "#fff5e0",
    },
    fillLight: { enabled: input?.fillLight?.enabled ?? true },
  };
}

function buildEnvironmentSpec(renderIntent?: string): SceneRenderSpec["environment"] {
  const n = (renderIntent ?? "").toLowerCase();
  if (n.includes("sunset") || n.includes("golden"))
    return { world: { mode: "flat_sky", skyColor: "#f6d8b8", horizonColor: "#fff0de", strength: 0.9 }, groundShadowCatcher: { enabled: false } };
  if (n.includes("overcast") || n.includes("soft"))
    return { world: { mode: "flat_sky", skyColor: "#d7dee7", horizonColor: "#eef2f6", strength: 0.8 }, groundShadowCatcher: { enabled: false } };
  return { world: { mode: "flat_sky", skyColor: "#a8cef0", horizonColor: "#e8eff8", strength: 1.0 }, groundShadowCatcher: { enabled: false } };
}

function buildRenderSettingsSpec(input?: Partial<RenderSettingsSpec>): RenderSettingsSpec {
  return {
    engine:  input?.engine  ?? "CYCLES",
    samples: input?.samples ?? 256,
    resolution: {
      width:      input?.resolution?.width      ?? 1920,
      height:     input?.resolution?.height     ?? 1080,
      percentage: input?.resolution?.percentage ?? 100,
    },
    transparentBackground: input?.transparentBackground ?? false,
    look:   input?.look   ?? "medium_high_contrast",
    output: {
      format:    input?.output?.format    ?? "PNG",
      colorMode: input?.output?.colorMode ?? "RGBA",
    },
  };
}

// ─────────────────────────────────────────────────────────────
// MATERIAL HELPERS
// ─────────────────────────────────────────────────────────────

function buildFacadeMaterial(color?: string): PBRMaterialSpec {
  return { baseColor: normalizeHex(color, "#d9d1c3"), roughness: 0.82, metallic: 0.0, alpha: 1.0 };
}
function buildStructureMaterial(color?: string): PBRMaterialSpec {
  return { baseColor: normalizeHex(color, "#b8b1a6"), roughness: 0.78, metallic: 0.0, alpha: 1.0 };
}
function buildRoofMaterial(color?: string): PBRMaterialSpec {
  return { baseColor: normalizeHex(color, "#6f6f72"), roughness: 0.65, metallic: 0.05, alpha: 1.0 };
}
function buildGlazingMaterial(input: {
  color?: string; opacity?: number; roughness?: number; metalness?: number;
}): PBRMaterialSpec {
  return {
    baseColor:    normalizeHex(input.color, "#a9c7d8"),
    roughness:    clamp01(input.roughness ?? 0.05),
    metallic:     clamp01(input.metalness ?? 0.0),
    transmission: 0.15,
    ior:          1.45,
    alpha:        clamp01(input.opacity   ?? 0.82),
  };
}
function buildBalconyRailingMaterial(color?: string): PBRMaterialSpec {
  return { baseColor: normalizeHex(color, "#47484d"), roughness: 0.32, metallic: 0.68, alpha: 1.0 };
}
function buildBalconySlabMaterial(baseFacadeColor?: string): PBRMaterialSpec {
  return { baseColor: darkenHex(baseFacadeColor ?? "#d9d1c3", 0.84), roughness: 0.86, metallic: 0.02, alpha: 1.0 };
}
function buildGroundMaterial(groundMaterial?: string): PBRMaterialSpec {
  switch (groundMaterial) {
    case "gravel":   return { baseColor: "#c8c0a8", roughness: 0.96, metallic: 0.0, alpha: 1.0 };
    case "pavers":   return { baseColor: "#b8b4ae", roughness: 0.90, metallic: 0.0, alpha: 1.0 };
    case "concrete": return { baseColor: "#c0c0bc", roughness: 0.88, metallic: 0.0, alpha: 1.0 };
    case "asphalt":  return { baseColor: "#6a6860", roughness: 0.94, metallic: 0.0, alpha: 1.0 };
    default:         return { baseColor: "#7e9b62", roughness: 1.00, metallic: 0.0, alpha: 1.0 };
  }
}

// ─────────────────────────────────────────────────────────────
// TRANSFORM / INFOS BÂTIMENT
// ─────────────────────────────────────────────────────────────

function buildTransformSpec(building: MassingBuildingModel): TransformSpec {
  const rec = building as unknown as Record<string, unknown>;
  return {
    position:      [readNumber(rec.x, 0), readNumber(rec.y, 0), readNumber(rec.z, 0)],
    rotationEuler: [0, readRotationY(building), 0],
    scale:         [1, 1, 1],
  };
}

function totalLevelsCountSafe(building: MassingBuildingModel): number {
  if (building.architecture) return totalLevelsFromArchitecture(building.architecture);
  const raw = (building as unknown as Record<string, unknown>).levels;
  if (!raw || typeof raw !== "object") return 1;
  const rec = raw as Record<string, unknown>;
  let total = 0;
  for (const key of ["basement", "ground", "upper", "attic", "roof", "mezzanine"]) {
    const v = rec[key];
    if (typeof v === "number" && Number.isFinite(v)) total += Math.max(0, v);
  }
  return total > 0 ? total : Math.max(1, readNumber(rec.count, 1));
}

function totalHeightSafe(building: MassingBuildingModel): number {
  if (building.architecture) return totalHeightFromArchitecture(building.architecture);
  const rec = building as unknown as Record<string, unknown>;
  const h =
    readNumber(rec.heightM, NaN) ||
    readNumber(rec.totalHeightM, NaN) ||
    readNumber(rec.height, NaN);
  if (Number.isFinite(h) && h > 0) return h;
  return Math.max(3, totalLevelsCountSafe(building) * 3);
}

function readFacadeStyleId(building: MassingBuildingModel): string | undefined {
  const style = (building as unknown as Record<string, unknown>).style;
  if (!style || typeof style !== "object") return undefined;
  const value = (style as Record<string, unknown>).facadeStyleId;
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readRotationY(building: MassingBuildingModel): number {
  const rec = building as unknown as Record<string, unknown>;
  const ry = readNumber(rec.rotationY, NaN);
  if (Number.isFinite(ry)) return ry;
  const t = rec.transform;
  if (t && typeof t === "object") {
    const rot = readNumber((t as Record<string, unknown>).rotationY, NaN);
    if (Number.isFinite(rot)) return rot;
  }
  return 0;
}

// ─────────────────────────────────────────────────────────────
// HERO FACADE DIRECTION
// ─────────────────────────────────────────────────────────────

function inferHeroFacadeDirection(building?: MassingBuildingModel): string {
  if (!building) return "south";
  const TWO_PI = Math.PI * 2;
  const norm = ((readRotationY(building) % TWO_PI) + TWO_PI) % TWO_PI;
  const deg = (norm * 180) / Math.PI;
  if (deg >= 315 || deg < 45)  return "south";
  if (deg >= 45  && deg < 135) return "west";
  if (deg >= 135 && deg < 225) return "north";
  return "east";
}

// ─────────────────────────────────────────────────────────────
// EXTRACTION GLOBAL SCÈNE
// ─────────────────────────────────────────────────────────────

function pickDominantIntentFromBuildings(buildings: MassingBuildingModel[]): string | undefined {
  const counts = new Map<string, number>();
  for (const b of buildings) {
    try {
      const intent = resolveBuildingRenderSpecSafe(ensureBuildingRenderSpec(b)).scene.renderIntent;
      if (intent) counts.set(intent, (counts.get(intent) ?? 0) + 1);
    } catch { /* ignore */ }
  }
  let best: string | undefined;
  let score = -1;
  for (const [k, v] of counts.entries()) { if (v > score) { best = k; score = v; } }
  return best;
}

function resolveFirstLandscape(buildings: MassingBuildingModel[]): { groundMaterial: string } | undefined {
  for (const b of buildings) {
    try {
      return { groundMaterial: resolveBuildingRenderSpecSafe(ensureBuildingRenderSpec(b)).landscape.groundMaterial };
    } catch { /* ignore */ }
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────

function safeArray<T>(value: T[] | null | undefined): T[] { return Array.isArray(value) ? value : []; }
function safeNumber(value: number, fallback: number): number { return Number.isFinite(value) ? value : fallback; }
function clamp01(value: number): number { return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0; }
function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function normalizeHex(value: string | undefined, fallback: string): string {
  if (!value || typeof value !== "string") return fallback;
  const v = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v;
  if (/^#[0-9a-fA-F]{3}$/.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  return fallback;
}
function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.filter((v): v is string => typeof v === "string" && v.length > 0))];
}
function darkenHex(hex: string, factor: number): string {
  const n = normalizeHex(hex, "#d9d1c3");
  const clamp = (x: number) => Math.max(0, Math.min(255, x));
  const r = clamp(Math.round(parseInt(n.slice(1, 3), 16) * factor));
  const g = clamp(Math.round(parseInt(n.slice(3, 5), 16) * factor));
  const b = clamp(Math.round(parseInt(n.slice(5, 7), 16) * factor));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}