// ============================================================================
// buildRenderSpecV3.ts
// Mimmoza — Génère le render-spec.json V3 enrichi
//
// Intègre les mesh groups architecturaux dans le JSON pour Blender V3.
// Rétrocompatible : le format reste "mimmoza.blender-render-spec" v1.0.0,
// mais avec des champs optionnels supplémentaires.
// ============================================================================

import type { ArchMeshGroupResult, ArchitecturalStyle } from './buildArchitecturalMeshGroups';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface RenderSpecV3 {
  format: 'mimmoza.blender-render-spec';
  version: '1.0.0';
  generator: {
    app: 'mimmoza';
    module: string;
    exportedAt: string;
  };
  scene: {
    unitSystem: 'meters';
    upAxis: 'Z';
    forwardAxis: '-Y';
    renderIntent: string;
    projectName: string;
    terrain: { meshName: string; enabled: boolean };
  };
  objects: RenderObject[];
  camera: CameraSpec;
  lighting: LightingSpec;
  environment: EnvironmentSpec;
  render: RenderSettingsSpec;
}

export interface RenderObject {
  type: 'terrain' | 'building';
  objectKey: string;
  sourceId: string;
  rootObjectName: string;
  meshNames: string[];
  meshGroups: Record<string, string[]>;
  materials: Record<string, MaterialSpec>;
  transform?: {
    position: [number, number, number];
    rotationEuler: [number, number, number];
    scale: [number, number, number];
  };
  style?: Partial<ArchitecturalStyle> & {
    renderIntent?: string;
    glazingColor?: string;
    glazingOpacity?: number;
    landscapeGroundMaterial?: string;
    landscapeSiteFinish?: string;
  };
  meta?: {
    name?: string;
    visible?: boolean;
    levelCount?: number;
    totalHeightM?: number;
    floorToFloorM?: number;
    groundFloorHeightM?: number;
    roofType?: string;
    roofColor?: string;
    landscape?: LandscapeSpec;
  };
}

export interface MaterialSpec {
  baseColor?: string;
  roughness?: number;
  metallic?: number;
  alpha?: number;
  transmission?: number;
  ior?: number;
  railingType?: string;
}

export interface LandscapeSpec {
  groundMaterial: string;
  siteFinish: string;
  vegetationDensity: number;
  treeCount?: number;
  treePositions?: Array<{ x: number; y: number; height: number; species?: string }>;
  hedgeEnabled?: boolean;
  hedges?: Array<{ start: [number, number]; end: [number, number]; height: number }>;
  paths?: Array<{ type: string; width: number; points: Array<[number, number]> }>;
  parkingVisible?: boolean;
  parkingLayout?: string;
  parkingCount?: number;
  streetFurniture?: string[];
}

export interface CameraSpec {
  mode: 'perspective';
  name: string;
  position: [number, number, number];
  target: [number, number, number];
  lensMm: number;
  clipStart: number;
  clipEnd: number;
  composition: {
    preset: 'hero_three_quarter' | 'hero_frontal' | 'committee_wide';
    fitStrategy: string;
    heroFacadeDirection?: 'north' | 'south' | 'east' | 'west';
    heroFacadeIndex?: number;
    framingTightness?: number;
    foregroundDepth?: number;
  };
}

export interface LightingSpec {
  sun: {
    enabled: boolean;
    name: string;
    rotationEulerDeg: [number, number, number];
    energy: number;
    angle: number;
    color: string;
  };
  fillLight: { enabled: boolean };
}

export interface EnvironmentSpec {
  world: {
    mode: string;
    skyColor: string;
    horizonColor: string;
    strength: number;
  };
  groundShadowCatcher: { enabled: boolean };
}

export interface RenderSettingsSpec {
  engine: 'CYCLES';
  samples: number;
  resolution: { width: number; height: number; percentage: number };
  transparentBackground: boolean;
  look: string;
  output: { format: string; colorMode: string };
}

// ─────────────────────────────────────────────────────────────────────────────
// BUILDER
// ─────────────────────────────────────────────────────────────────────────────

export interface BuildRenderSpecV3Input {
  projectName: string;
  studyId: string;

  // Terrain
  terrainMeshName: string;
  terrainGroundMaterial: string;

  // Building
  buildingSourceId: string;
  buildingRootName: string;
  buildingName: string;

  // Base mesh names (V1 compat)
  structureMeshNames: string[];
  roofMeshNames: string[];
  facadeMeshNames: string[];
  glazingMeshNames: string[];

  // Enriched mesh groups (V3)
  archMeshGroups: ArchMeshGroupResult[];

  // Style + meta
  style: Partial<ArchitecturalStyle>;
  levelCount: number;
  totalHeightM: number;
  floorToFloorM: number;
  groundFloorHeightM: number;
  roofType: string;

  // Materials
  facadeColor: string;
  structureColor: string;
  roofColor: string;
  glazingColor: string;
  glazingOpacity: number;

  // Camera
  heroFacadeDirection: 'north' | 'south' | 'east' | 'west';
  cameraPreset: 'hero_three_quarter' | 'hero_frontal' | 'committee_wide';
  framingTightness: number;

  // Landscape
  landscape: LandscapeSpec;

  // Render intent
  renderIntent: string;
}


export function buildRenderSpecV3(input: BuildRenderSpecV3Input): RenderSpecV3 {
  // ── Collect all mesh names ──
  const allBuildingMeshNames = [
    ...input.structureMeshNames,
    ...input.roofMeshNames,
    ...input.facadeMeshNames,
    ...input.glazingMeshNames,
    ...input.archMeshGroups.map(g => g.name),
  ];

  // ── Build meshGroups from arch mesh groups ──
  const meshGroups: Record<string, string[]> = {
    structure: input.structureMeshNames,
    roof: input.roofMeshNames,
    facade: input.facadeMeshNames,
    glazing: input.glazingMeshNames,
  };

  // Add enriched groups
  const archCategories = new Set(input.archMeshGroups.map(g => g.category));
  for (const cat of archCategories) {
    meshGroups[cat] = input.archMeshGroups
      .filter(g => g.category === cat)
      .map(g => g.name);
  }

  // ── Materials ──
  const materials: Record<string, MaterialSpec> = {
    facade: { baseColor: input.facadeColor, roughness: 0.82, metallic: 0, alpha: 1 },
    structure: { baseColor: input.structureColor, roughness: 0.78, metallic: 0, alpha: 1 },
    roof: { baseColor: input.roofColor, roughness: 0.65, metallic: 0.05, alpha: 1 },
    glazing: {
      baseColor: input.glazingColor,
      roughness: 0.08, metallic: 0.1,
      transmission: 0.15, ior: 1.45,
      alpha: input.glazingOpacity,
    },
  };

  // Add materials for enriched groups
  if (archCategories.has('frames')) {
    materials.frames = { baseColor: '#f0ece4', roughness: 0.55, metallic: 0 };
  }
  if (archCategories.has('socle')) {
    materials.socle = {
      baseColor: input.style.socleFinish === 'stone' ? '#8a8578' : '#7a7870',
      roughness: 0.78, metallic: 0,
    };
  }
  if (archCategories.has('cornice')) {
    materials.cornice = { baseColor: '#d8d4cc', roughness: 0.60, metallic: 0 };
  }
  if (archCategories.has('balcony_slab')) {
    materials.balcony_slab = { baseColor: '#c7c3b7', roughness: 0.86, metallic: 0.02 };
  }
  if (archCategories.has('balcony_rail')) {
    materials.balcony_rail = {
      baseColor: '#374151',
      roughness: input.style.balconyRailingType === 'glass' ? 0.05 : 0.35,
      metallic: input.style.balconyRailingType === 'glass' ? 0 : 0.7,
      railingType: input.style.balconyRailingType,
    };
  }
  if (archCategories.has('entrance')) {
    materials.entrance = { baseColor: '#2d2d2d', roughness: 0.45, metallic: 0.3 };
  }

  // ── Assemble ──
  const spec: RenderSpecV3 = {
    format: 'mimmoza.blender-render-spec',
    version: '1.0.0',
    generator: {
      app: 'mimmoza',
      module: 'terrain3d',
      exportedAt: new Date().toISOString(),
    },
    scene: {
      unitSystem: 'meters',
      upAxis: 'Z',
      forwardAxis: '-Y',
      renderIntent: input.renderIntent,
      projectName: input.projectName,
      terrain: { meshName: input.terrainMeshName, enabled: true },
    },
    objects: [
      // Terrain
      {
        type: 'terrain',
        objectKey: 'terrain:main',
        sourceId: 'main',
        rootObjectName: 'MMZ_TERRAIN_main_ROOT',
        meshNames: [input.terrainMeshName],
        meshGroups: { ground: [input.terrainMeshName] },
        materials: {
          ground: {
            baseColor: '#b8b4ae',
            roughness: 0.9,
            metallic: 0,
            alpha: 1,
          },
        },
        meta: { groundMaterial: input.terrainGroundMaterial },
      },
      // Building
      {
        type: 'building',
        objectKey: `building:${input.buildingSourceId}`,
        sourceId: input.buildingSourceId,
        rootObjectName: input.buildingRootName,
        meshNames: allBuildingMeshNames,
        meshGroups,
        materials,
        transform: { position: [0, 0, 0], rotationEuler: [0, 0, 0], scale: [1, 1, 1] },
        style: {
          ...input.style,
          renderIntent: input.renderIntent,
          glazingColor: input.glazingColor,
          glazingOpacity: input.glazingOpacity,
          landscapeGroundMaterial: input.terrainGroundMaterial,
          landscapeSiteFinish: input.landscape.siteFinish,
        },
        meta: {
          name: input.buildingName,
          visible: true,
          levelCount: input.levelCount,
          totalHeightM: input.totalHeightM,
          floorToFloorM: input.floorToFloorM,
          groundFloorHeightM: input.groundFloorHeightM,
          roofType: input.roofType,
          roofColor: input.roofColor,
          landscape: input.landscape,
        },
      },
    ],
    camera: {
      mode: 'perspective',
      name: 'MMZ_CAMERA_MAIN',
      position: [30, 20, -15], // dummy, overridden by Blender V3 pipeline
      target: [0, 5, 0],
      lensMm: 35,
      clipStart: 0.1,
      clipEnd: 5000,
      composition: {
        preset: input.cameraPreset,
        fitStrategy: 'building_bbox',
        heroFacadeDirection: input.heroFacadeDirection,
        heroFacadeIndex: 0,
        framingTightness: input.framingTightness,
        foregroundDepth: 0.25,
      },
    },
    lighting: {
      sun: {
        enabled: true,
        name: 'MMZ_SUN_MAIN',
        rotationEulerDeg: [42, 0, 128],
        energy: 3.5,
        angle: 0.8,
        color: '#fff5e0',
      },
      fillLight: { enabled: true },
    },
    environment: {
      world: {
        mode: 'flat_sky',
        skyColor: '#a8cef0',
        horizonColor: '#e8eff8',
        strength: 1.0,
      },
      groundShadowCatcher: { enabled: false },
    },
    render: {
      engine: 'CYCLES',
      samples: 256,
      resolution: { width: 1920, height: 1080, percentage: 100 },
      transparentBackground: false,
      look: 'medium_high_contrast',
      output: { format: 'PNG', colorMode: 'RGBA' },
    },
  };

  return spec;
}