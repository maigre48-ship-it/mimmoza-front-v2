// massingArchitectureEngine.ts
// Moteur d'assemblage V1 : socle / corps / attique / toiture
// Construit des meshes Three.js à partir du modèle d'architecture paramétrique.

import * as THREE from "three";
import type {
  Pt2D,
  MassingBuildingModel,
  MassingArchitectureStyle,
  BuildingSide,
  MassingFacadeStyle,
} from "./massingScene.types";
import {
  buildArchitectureSlices,
  buildFacadeRunsForSlice,
  type ArchitectureSlice,
  type ArchitectureSliceRole,
  type FacadeRun,
} from "./massingArchitectureGeometry";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES PUBLICS
// ═══════════════════════════════════════════════════════════════════════════════

export interface ArchitectureFacadeMeta {
  buildingId: string;
  side: BuildingSide;
  role: ArchitectureSliceRole;
  width: number;
  height: number;
  zBase: number;
  start: Pt2D;
  end: Pt2D;
  style: MassingFacadeStyle;
  slice: ArchitectureSlice;
  run: FacadeRun;
}

export interface ArchitectureSliceMesh {
  role: ArchitectureSliceRole;
  slice: ArchitectureSlice;
  mesh: THREE.Mesh;
}

export interface BuiltArchitectureMeshes {
  sliceMeshes: ArchitectureSliceMesh[];
  roofMeshes: THREE.Mesh[];
  facadeMeta: ArchitectureFacadeMeta[];
  group: THREE.Group;
  totalHeight: number;
}

export interface BuildArchitectureMeshesOptions {
  baseMaterial?: THREE.Material | THREE.Material[];
  socleMaterial?: THREE.Material | THREE.Material[];
  upperMaterial?: THREE.Material | THREE.Material[];
  atticMaterial?: THREE.Material | THREE.Material[];
  roofMaterial?: THREE.Material | THREE.Material[];
  applyShadows?: boolean;
  userData?: Record<string, unknown>;
}

export interface ResolvedArchitectureMaterials {
  socleMaterial: THREE.Material | THREE.Material[];
  upperMaterial: THREE.Material | THREE.Material[];
  atticMaterial: THREE.Material | THREE.Material[];
  roofMaterial: THREE.Material | THREE.Material[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// API PRINCIPALE
// ═══════════════════════════════════════════════════════════════════════════════

export function buildArchitectureMeshes(
  building: MassingBuildingModel,
  options: BuildArchitectureMeshesOptions = {},
): BuiltArchitectureMeshes {
  const architecture = resolveArchitecture(building);
  const slicesResult = buildArchitectureSlices({
    footprint: building.footprint.points,
    baseZ: 0,
    architecture,
  });

  const materials = resolveArchitectureMaterials(options);

  const group = new THREE.Group();
  group.name = `architecture_${building.id}`;

  const sliceMeshes: ArchitectureSliceMesh[] = [];
  const roofMeshes: THREE.Mesh[] = [];
  const facadeMeta: ArchitectureFacadeMeta[] = [];

  for (const slice of slicesResult.slices) {
    const material = getMaterialForRole(slice.role, materials);
    const mesh = createExtrudedSliceMesh(slice, material);

    mesh.name = `${building.id}_${slice.role}`;
    mesh.userData = {
      ...(options.userData ?? {}),
      kind: "architecture_slice",
      buildingId: building.id,
      sliceRole: slice.role,
      levelStart: slice.levelStart,
      levelCount: slice.levelCount,
    };

    applyShadowFlags(mesh, options.applyShadows ?? true);

    group.add(mesh);
    sliceMeshes.push({
      role: slice.role,
      slice,
      mesh,
    });

    const runs = buildFacadeRunsForSlice(slice);
    for (const run of runs) {
      facadeMeta.push({
        buildingId: building.id,
        side: run.side,
        role: slice.role,
        width: run.width,
        height: run.height,
        zBase: run.zBase,
        start: run.start,
        end: run.end,
        style: resolveFacadeStyleForSlice(architecture, run.side, slice.role),
        slice,
        run,
      });
    }
  }

  const roofMesh = createRoofMeshForArchitecture(
    building,
    slicesResult.slices,
    materials.roofMaterial,
    options,
  );

  if (roofMesh) {
    roofMeshes.push(roofMesh);
    group.add(roofMesh);
  }

  return {
    sliceMeshes,
    roofMeshes,
    facadeMeta,
    group,
    totalHeight: slicesResult.totalHeight,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// RÉSOLUTION ARCHITECTURE / STYLES
// ═══════════════════════════════════════════════════════════════════════════════

export function resolveArchitecture(
  building: MassingBuildingModel,
): MassingArchitectureStyle {
  if (building.architecture) return building.architecture;

  return {
    vertical: {
      socleLevels: 1,
      upperLevels: Math.max(0, building.levels.aboveGroundFloors),
      atticLevels: 0,
      socleHeightM: building.levels.groundFloorHeightM,
      upperFloorHeightM: building.levels.typicalFloorHeightM,
      atticFloorHeightM: Math.max(2.6, building.levels.typicalFloorHeightM - 0.1),
    },
    setback: {
      enabled: false,
      frontM: 2,
      backM: 2,
      leftM: 2,
      rightM: 2,
    },
    facadeBase: {
      type: "residential",
      materialPresetId: building.style.facadeTextureId,
      openingPreset: "window",
      bayWidthM: building.style.bayWidthM ?? 3.2,
      windowWidthM: 1.6,
      windowHeightM: 1.45,
      sillHeightM: 0.9,
      frameDepthM: 0.12,
      spandrelHeightM: 0.75,
      groundFloorVitrified: true,
      balconyEnabled: !!building.style.hasBalconies,
      loggiaEnabled: false,
    },
    facadeOverrides: {
      front: {
        groundFloorVitrified: true,
      },
    },
    roof: {
      roofType: "flat",
      parapetHeightM: 0.45,
      atticSetbackM: 2,
      slopeDeg: 0,
    },
  };
}

export function resolveFacadeStyleForSide(
  architecture: MassingArchitectureStyle,
  side: BuildingSide,
): MassingFacadeStyle {
  const base = architecture.facadeBase;
  const override = architecture.facadeOverrides?.[side];

  return {
    ...base,
    ...(override ?? {}),
  };
}

export function resolveFacadeStyleForSlice(
  architecture: MassingArchitectureStyle,
  side: BuildingSide,
  role: ArchitectureSliceRole,
): MassingFacadeStyle {
  const base = resolveFacadeStyleForSide(architecture, side);

  if (role === "socle") {
    return {
      ...base,
      groundFloorVitrified: true,
      frameDepthM: Math.max(base.frameDepthM ?? 0.12, 0.12),
    };
  }

  if (role === "attic") {
    return {
      ...base,
      balconyEnabled: false,
    };
  }

  return base;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MATÉRIAUX
// ═══════════════════════════════════════════════════════════════════════════════

export function resolveArchitectureMaterials(
  options: BuildArchitectureMeshesOptions,
): ResolvedArchitectureMaterials {
  const fallback = options.baseMaterial ?? createDefaultArchitectureMaterial();

  return {
    socleMaterial: options.socleMaterial ?? fallback,
    upperMaterial: options.upperMaterial ?? fallback,
    atticMaterial: options.atticMaterial ?? fallback,
    roofMaterial: options.roofMaterial ?? createDefaultRoofMaterial(),
  };
}

export function createDefaultArchitectureMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: "#E5E0D4",
    roughness: 0.92,
    metalness: 0.04,
  });
}

export function createDefaultRoofMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: "#B8B3A8",
    roughness: 0.95,
    metalness: 0.03,
  });
}

function getMaterialForRole(
  role: ArchitectureSliceRole,
  materials: ResolvedArchitectureMaterials,
): THREE.Material | THREE.Material[] {
  switch (role) {
    case "socle":
      return materials.socleMaterial;
    case "upper":
      return materials.upperMaterial;
    case "attic":
      return materials.atticMaterial;
    default:
      return materials.upperMaterial;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CRÉATION DES MESHES
// ═══════════════════════════════════════════════════════════════════════════════

export function createExtrudedSliceMesh(
  slice: ArchitectureSlice,
  material: THREE.Material | THREE.Material[],
): THREE.Mesh {
  const shape = polygonToShape(slice.footprint);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: slice.height,
    bevelEnabled: false,
    steps: 1,
  });

  // ExtrudeGeometry extrude par défaut sur +Z.
  // On veut X/Z au sol et Y vertical, comme dans la plupart des scènes archi Three.
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, slice.zBase, 0);
  geometry.computeVertexNormals();

  ensureUv2(geometry);

  const mesh = new THREE.Mesh(geometry, material);
  return mesh;
}

export function createRoofMeshForArchitecture(
  building: MassingBuildingModel,
  slices: ArchitectureSlice[],
  roofMaterial: THREE.Material | THREE.Material[],
  options: BuildArchitectureMeshesOptions = {},
): THREE.Mesh | null {
  if (slices.length === 0) return null;

  const topSlice = slices[slices.length - 1];
  const architecture = resolveArchitecture(building);
  const parapetHeight = Math.max(0, architecture.roof.parapetHeightM ?? 0);

  const shape = polygonToShape(topSlice.footprint);
  const thickness = Math.max(0.08, parapetHeight > 0 ? 0.08 : 0.06);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
    steps: 1,
  });

  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, topSlice.zBase + topSlice.height, 0);
  geometry.computeVertexNormals();
  ensureUv2(geometry);

  const mesh = new THREE.Mesh(geometry, roofMaterial);
  mesh.name = `${building.id}_roof`;
  mesh.userData = {
    ...(options.userData ?? {}),
    kind: "architecture_roof",
    buildingId: building.id,
  };

  applyShadowFlags(mesh, options.applyShadows ?? true);

  return mesh;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHAPES / UV / SHADOWS
// ═══════════════════════════════════════════════════════════════════════════════

export function polygonToShape(points: Pt2D[]): THREE.Shape {
  if (!points.length) {
    throw new Error("polygonToShape: empty polygon");
  }

  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);

  for (let i = 1; i < points.length; i++) {
    shape.lineTo(points[i][0], points[i][1]);
  }

  shape.lineTo(points[0][0], points[0][1]);
  return shape;
}

export function ensureUv2(geometry: THREE.BufferGeometry): void {
  const uv = geometry.getAttribute("uv");
  const uv2 = geometry.getAttribute("uv2");

  if (uv && !uv2) {
    geometry.setAttribute("uv2", uv);
  }
}

export function applyShadowFlags(
  mesh: THREE.Mesh,
  enabled: boolean,
): void {
  mesh.castShadow = enabled;
  mesh.receiveShadow = enabled;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS D'INTÉGRATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Retourne la slice la plus adaptée pour piloter un futur moteur façade.
 */
export function getPrimaryUpperSlice(
  built: BuiltArchitectureMeshes,
): ArchitectureSlice | null {
  const upper = built.sliceMeshes.find((s) => s.role === "upper");
  if (upper) return upper.slice;

  const socle = built.sliceMeshes.find((s) => s.role === "socle");
  if (socle) return socle.slice;

  return built.sliceMeshes[0]?.slice ?? null;
}

/**
 * Retourne les façades d'un côté donné.
 */
export function getFacadeMetaBySide(
  built: BuiltArchitectureMeshes,
  side: BuildingSide,
): ArchitectureFacadeMeta[] {
  return built.facadeMeta.filter((f) => f.side === side);
}

/**
 * Retourne les façades d'un rôle donné.
 */
export function getFacadeMetaByRole(
  built: BuiltArchitectureMeshes,
  role: ArchitectureSliceRole,
): ArchitectureFacadeMeta[] {
  return built.facadeMeta.filter((f) => f.role === role);
}

/**
 * Nettoyage des géométries créées par ce moteur.
 * Les matériaux ne sont pas disposés ici par sécurité, car ils peuvent être partagés.
 */
export function disposeBuiltArchitectureMeshes(
  built: BuiltArchitectureMeshes | null | undefined,
): void {
  if (!built) return;

  for (const item of built.sliceMeshes) {
    item.mesh.geometry.dispose();
  }

  for (const roof of built.roofMeshes) {
    roof.geometry.dispose();
  }
}