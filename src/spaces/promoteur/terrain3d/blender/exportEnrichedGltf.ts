// ============================================================================
// exportEnrichedGltf.ts
// Mimmoza — Orchestration de l'export GLTF enrichi + render-spec V3
//
// Point d'entrée unique pour exporter un GLTF avec mesh groups architecturaux
// et le render-spec JSON correspondant.
//
// Usage dans le code Mimmoza existant :
//   import { exportEnrichedScene } from './exportEnrichedGltf';
//   await exportEnrichedScene(scene, buildingGroup, config);
// ============================================================================

import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter';
import {
  buildArchitecturalMeshGroups,
  type BuildingEnvelope,
  type ArchitecturalStyle,
  type ArchMeshGroupResult,
  DEFAULT_STYLE,
} from './buildArchitecturalMeshGroups';
import {
  buildRenderSpecV3,
  type BuildRenderSpecV3Input,
  type RenderSpecV3,
  type LandscapeSpec,
} from './buildRenderSpecV3';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────

export interface ExportConfig {
  projectName: string;
  studyId: string;

  // Building info
  buildingSourceId: string;
  buildingName: string;
  buildingRootName: string;

  // Envelope
  footprint: THREE.Vector2[];
  totalHeightM: number;
  levelCount: number;
  floorToFloorM: number;
  groundFloorHeightM: number;
  baseZ: number;

  // Style
  style: Partial<ArchitecturalStyle>;

  // Colors
  facadeColor: string;
  structureColor: string;
  roofColor: string;
  roofType: string;
  glazingColor: string;
  glazingOpacity: number;

  // Camera
  heroFacadeDirection: 'north' | 'south' | 'east' | 'west';
  cameraPreset: 'hero_three_quarter' | 'hero_frontal' | 'committee_wide';
  framingTightness: number;

  // Terrain
  terrainMeshName: string;
  terrainGroundMaterial: string;

  // Landscape
  landscape: LandscapeSpec;

  // Render
  renderIntent: string;

  // Enable/disable enrichment (fallback to V1-style export)
  enableArchitecturalEnrichment: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// FOOTPRINT EXTRACTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracts the XY footprint from a building's STRUCTURE mesh.
 * Projects all vertices onto XY, then computes convex hull.
 */
export function extractFootprintFromMesh(structureMesh: THREE.Mesh): THREE.Vector2[] {
  const geo = structureMesh.geometry;
  if (!geo) return [];

  const posAttr = geo.getAttribute('position');
  if (!posAttr) return [];

  const points: THREE.Vector2[] = [];
  const mat = structureMesh.matrixWorld;

  for (let i = 0; i < posAttr.count; i++) {
    const v = new THREE.Vector3(
      posAttr.getX(i),
      posAttr.getY(i),
      posAttr.getZ(i),
    );
    v.applyMatrix4(mat);
    points.push(new THREE.Vector2(v.x, v.y));
  }

  // Simple convex hull (Graham scan)
  return convexHull2D(points);
}

function convexHull2D(points: THREE.Vector2[]): THREE.Vector2[] {
  if (points.length < 3) return points;

  // Find bottom-most point (min Y, then min X)
  let pivot = points[0];
  for (const p of points) {
    if (p.y < pivot.y || (p.y === pivot.y && p.x < pivot.x)) {
      pivot = p;
    }
  }

  // Sort by polar angle from pivot
  const sorted = points
    .filter(p => p !== pivot)
    .sort((a, b) => {
      const angleA = Math.atan2(a.y - pivot.y, a.x - pivot.x);
      const angleB = Math.atan2(b.y - pivot.y, b.x - pivot.x);
      return angleA - angleB;
    });

  const hull: THREE.Vector2[] = [pivot];
  for (const p of sorted) {
    while (hull.length >= 2) {
      const a = hull[hull.length - 2];
      const b = hull[hull.length - 1];
      const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
      if (cross <= 0) hull.pop();
      else break;
    }
    hull.push(p);
  }

  return hull;
}

// ─────────────────────────────────────────────────────────────────────────────
// MATERIAL ASSIGNMENT
// ─────────────────────────────────────────────────────────────────────────────

/** Assign a simple PBR material to a mesh for GLTF export. */
function assignMaterial(
  mesh: THREE.Mesh,
  color: string,
  roughness: number = 0.8,
  metallic: number = 0,
  options?: { opacity?: number; transparent?: boolean },
): void {
  const c = new THREE.Color(color);
  const mat = new THREE.MeshStandardMaterial({
    color: c,
    roughness,
    metallic,
    ...(options?.transparent ? { transparent: true, opacity: options.opacity ?? 1 } : {}),
  });
  mesh.material = mat;
}

// Category → material config
const CATEGORY_MATERIALS: Record<string, { color: string; roughness: number; metallic: number }> = {
  frames:       { color: '#f0ece4', roughness: 0.55, metallic: 0 },
  socle:        { color: '#8a8578', roughness: 0.78, metallic: 0 },
  cornice:      { color: '#d8d4cc', roughness: 0.60, metallic: 0 },
  balcony_slab: { color: '#c7c3b7', roughness: 0.86, metallic: 0.02 },
  balcony_rail: { color: '#374151', roughness: 0.35, metallic: 0.7 },
  entrance:     { color: '#2d2d2d', roughness: 0.45, metallic: 0.3 },
  attic:        { color: '#d8d2c5', roughness: 0.78, metallic: 0 },
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────

export interface ExportResult {
  gltfBlob: Blob;
  renderSpec: RenderSpecV3;
}

/**
 * Main export function:
 * 1. Generate architectural mesh groups from envelope + style
 * 2. Attach them to the building root in the scene
 * 3. Build render-spec V3 JSON
 * 4. Export GLTF
 */
export async function exportEnrichedScene(
  scene: THREE.Scene,
  buildingRoot: THREE.Object3D,
  config: ExportConfig,
): Promise<ExportResult> {
  let archMeshGroups: ArchMeshGroupResult[] = [];

  // ── 1. Generate architectural mesh groups ──
  if (config.enableArchitecturalEnrichment) {
    const envelope: BuildingEnvelope = {
      footprint: config.footprint,
      totalHeightM: config.totalHeightM,
      levelCount: config.levelCount,
      floorToFloorM: config.floorToFloorM,
      groundFloorHeightM: config.groundFloorHeightM,
      baseZ: config.baseZ,
    };

    const mergedStyle: ArchitecturalStyle = {
      ...DEFAULT_STYLE,
      ...config.style,
    };

    archMeshGroups = buildArchitecturalMeshGroups(
      config.buildingRootName.replace('_ROOT', ''),
      envelope,
      mergedStyle,
    );

    // ── 2. Assign materials and attach to building root ──
    for (const group of archMeshGroups) {
      const matConfig = CATEGORY_MATERIALS[group.category];
      if (matConfig) {
        assignMaterial(group.mesh, matConfig.color, matConfig.roughness, matConfig.metallic);
      }
      buildingRoot.add(group.mesh);
    }

    console.log(`[MMZ] Attached ${archMeshGroups.length} architectural mesh groups to ${buildingRoot.name}`);
  }

  // ── 3. Collect existing mesh names ──
  const structureNames: string[] = [];
  const roofNames: string[] = [];
  const facadeNames: string[] = [];
  const glazingNames: string[] = [];

  buildingRoot.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const up = child.name.toUpperCase();
    if (up.includes('STRUCTURE'))     structureNames.push(child.name);
    else if (up.includes('ROOF'))     roofNames.push(child.name);
    else if (up.includes('GLAZING_')) glazingNames.push(child.name);
    else if (up.includes('FACADE_')) facadeNames.push(child.name);
  });

  // ── 4. Build render-spec V3 ──
  const renderSpecInput: BuildRenderSpecV3Input = {
    projectName: config.projectName,
    studyId: config.studyId,
    terrainMeshName: config.terrainMeshName,
    terrainGroundMaterial: config.terrainGroundMaterial,
    buildingSourceId: config.buildingSourceId,
    buildingRootName: config.buildingRootName,
    buildingName: config.buildingName,
    structureMeshNames: structureNames,
    roofMeshNames: roofNames,
    facadeMeshNames: facadeNames,
    glazingMeshNames: glazingNames,
    archMeshGroups,
    style: config.style,
    levelCount: config.levelCount,
    totalHeightM: config.totalHeightM,
    floorToFloorM: config.floorToFloorM,
    groundFloorHeightM: config.groundFloorHeightM,
    roofType: config.roofType,
    facadeColor: config.facadeColor,
    structureColor: config.structureColor,
    roofColor: config.roofColor,
    glazingColor: config.glazingColor,
    glazingOpacity: config.glazingOpacity,
    heroFacadeDirection: config.heroFacadeDirection,
    cameraPreset: config.cameraPreset,
    framingTightness: config.framingTightness,
    landscape: config.landscape,
    renderIntent: config.renderIntent,
  };

  const renderSpec = buildRenderSpecV3(renderSpecInput);

  // ── 5. Export GLTF ──
  const gltfBlob = await exportSceneToGltf(scene);

  // ── 6. Cleanup: remove arch groups from scene to not pollute Three.js state ──
  for (const group of archMeshGroups) {
    buildingRoot.remove(group.mesh);
    group.mesh.geometry.dispose();
    if (group.mesh.material instanceof THREE.Material) {
      group.mesh.material.dispose();
    }
  }

  return { gltfBlob, renderSpec };
}


async function exportSceneToGltf(scene: THREE.Scene): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const exporter = new GLTFExporter();
    exporter.parse(
      scene,
      (result) => {
        const json = JSON.stringify(result);
        resolve(new Blob([json], { type: 'application/json' }));
      },
      (error) => reject(error),
      {
        binary: false,
        onlyVisible: true,
        includeCustomExtensions: true,
      },
    );
  });
}


// ─────────────────────────────────────────────────────────────────────────────
// DOWNLOAD HELPERS (pour usage dans le front)
// ─────────────────────────────────────────────────────────────────────────────

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadJson(data: object, filename: string): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  downloadBlob(blob, filename);
}