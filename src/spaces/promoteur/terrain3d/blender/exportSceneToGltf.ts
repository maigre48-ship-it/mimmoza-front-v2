// src/spaces/promoteur/terrain3d/blender/exportSceneToGltf.ts
// V4 — Export GLTF + Blob pour pipeline renderer local.
//
// API publique :
//   exportSceneToGltf(input, options)  → ExportSceneToGltfResult  (download optionnel)
//   exportSceneToGltfBlob(input, options) → Blob                  (sans download)

import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

import {
  buildBlenderSceneGraph,
  type BuildBlenderSceneGraphInput,
  type BuildBlenderSceneGraphResult,
} from "./buildBlenderSceneGraph";
import {
  buildFacadeMeshGroupsForExport,
  type ExportMeshGroup,
} from "./buildFacadeForExport";
import { makeBuildingRootName } from "./blenderNaming";

// ─────────────────────────────────────────────────────────────
// CONSTANTE SEUIL
// ─────────────────────────────────────────────────────────────

const MAX_EXTRACTED_FOOTPRINT_M = 120;

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

export interface ExportSceneToGltfOptions {
  fileName?: string;
  binary?: boolean;
  onlyVisible?: boolean;
  trs?: boolean;
  maxTextureSize?: number;
  includeCustomExtensions?: boolean;
  autoDownload?: boolean;
  log?: boolean;
  enableFacadeEnrichment?: boolean;
}

export interface ExportSceneToGltfResult {
  scene: THREE.Scene;
  projection: BuildBlenderSceneGraphResult["projection"];
  payload: string | ArrayBuffer;
  blob: Blob;
  fileName: string;
  mimeType: string;
  facadeGroupsCount: number;
}

// ─────────────────────────────────────────────────────────────
// API
// ─────────────────────────────────────────────────────────────

export async function exportSceneToGltf(
  input: BuildBlenderSceneGraphInput,
  options: ExportSceneToGltfOptions = {},
): Promise<ExportSceneToGltfResult> {
  const {
    fileName = options.binary ? "scene.glb" : "scene.gltf",
    binary = false,
    onlyVisible = true,
    trs = false,
    maxTextureSize = 4096,
    includeCustomExtensions = true,
    autoDownload = true,
    log = false,
    enableFacadeEnrichment = true,
  } = options;

  const { scene, projection } = buildBlenderSceneGraph(input);

  let allFacadeGroups: ExportMeshGroup[] = [];

  try {
    if (enableFacadeEnrichment) {
      allFacadeGroups = enrichSceneWithFacades(scene, input, log);
    }

    const payload = await exportWithGLTFExporter(scene, {
      binary,
      onlyVisible,
      trs,
      maxTextureSize,
      includeCustomExtensions,
    });

    const mimeType = binary ? "model/gltf-binary" : "model/gltf+json";
    const blob = payloadToBlob(payload, mimeType);

    if (autoDownload && isBrowser()) {
      downloadPayload(payload, fileName, mimeType);
    }

    if (log) {
      console.log("[Mimmoza][Blender] GLTF export done:", {
        fileName,
        binary,
        facadeGroupsCount: allFacadeGroups.length,
        categories: [...new Set(allFacadeGroups.map((g) => g.category))],
        blobSize: blob.size,
        mimeType,
      });
    }

    return {
      scene,
      projection,
      payload,
      blob,
      fileName,
      mimeType,
      facadeGroupsCount: allFacadeGroups.length,
    };
  } finally {
    cleanupFacadeGroups(allFacadeGroups);
  }
}

/**
 * Exporte directement la scène vers un Blob, sans download navigateur.
 * Usage : const gltfBlob = await exportSceneToGltfBlob(input, { log: true });
 */
export async function exportSceneToGltfBlob(
  input: BuildBlenderSceneGraphInput,
  options: ExportSceneToGltfOptions = {},
): Promise<Blob> {
  const result = await exportSceneToGltf(input, {
    ...options,
    autoDownload: false,
  });

  return result.blob;
}

// ─────────────────────────────────────────────────────────────
// ENRICHISSEMENT FACADE
// ─────────────────────────────────────────────────────────────

function enrichSceneWithFacades(
  scene: THREE.Scene,
  input: BuildBlenderSceneGraphInput,
  log: boolean,
): ExportMeshGroup[] {
  const allGroups: ExportMeshGroup[] = [];
  const buildings = (input.buildings ?? []).filter((b) => b.visible !== false);

  for (const building of buildings) {
    try {
      const rootName = makeBuildingRootName(building.id);
      const buildingRoot = scene.getObjectByName(rootName);

      if (!buildingRoot) {
        if (log) console.warn(`[MMZ][FacadeExport] Root not found: ${rootName}`);
        continue;
      }

      const scenePts = extractFootprintFromScene(buildingRoot, building.id, log);
      if (scenePts.length < 3) {
        if (log) {
          console.warn(
            `[MMZ][FacadeExport] Footprint insuffisant pour "${building.id}" ` +
              `(${scenePts.length} pts) — enrichissement skippé`,
          );
        }
        continue;
      }

      const platformY = 0;
      const prefix = rootName.replace("_ROOT", "");
      const groups = buildFacadeMeshGroupsForExport({
        building,
        scenePts,
        prefix,
        platformY,
      });

      for (const group of groups) {
        buildingRoot.add(group.mesh);
      }

      allGroups.push(...groups);

      if (log) {
        console.log(
          `[MMZ][FacadeExport] "${building.id}": ${groups.length} mesh groups ` +
            `(${groups.map((g) => g.category).join(", ")})`,
        );
      }
    } catch (error) {
      console.warn(`[MMZ][FacadeExport] Failed for building "${building.id}":`, error);
    }
  }

  return allGroups;
}

// ─────────────────────────────────────────────────────────────
// EXTRACTION FOOTPRINT — avec validation dimensionnelle
// ─────────────────────────────────────────────────────────────

function extractFootprintFromScene(
  buildingRoot: THREE.Object3D,
  buildingId: string,
  log: boolean = false,
): Array<{ x: number; z: number }> {
  // 1. Trouver le mesh STRUCTURE (ou premier mesh enfant en fallback)
  let structureMesh: THREE.Mesh | null = null;

  buildingRoot.traverse((child) => {
    if (
      !structureMesh &&
      child instanceof THREE.Mesh &&
      child.name.toUpperCase().includes("STRUCTURE")
    ) {
      structureMesh = child;
    }
  });

  if (!structureMesh) {
    buildingRoot.traverse((child) => {
      if (!structureMesh && child instanceof THREE.Mesh) {
        structureMesh = child;
      }
    });
  }

  if (!structureMesh) return [];

  const mesh = structureMesh as THREE.Mesh;
  const geo = mesh.geometry;
  if (!geo) return [];

  const posAttr = geo.getAttribute("position");
  if (!posAttr) return [];

  // 2. Transformer vers le repère local du building root
  buildingRoot.updateMatrixWorld(true);
  mesh.updateMatrixWorld(true);

  const rootInverse = new THREE.Matrix4().copy(buildingRoot.matrixWorld).invert();
  const meshToRootLocal = new THREE.Matrix4().multiplyMatrices(
    rootInverse,
    mesh.matrixWorld,
  );

  const allPts: Array<{ x: number; y: number; z: number }> = [];
  for (let i = 0; i < posAttr.count; i++) {
    const v = new THREE.Vector3(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
    v.applyMatrix4(meshToRootLocal);
    allPts.push({ x: v.x, y: v.y, z: v.z });
  }

  if (allPts.length === 0) return [];

  // 3. Isoler les vertices au sol
  const minY = Math.min(...allPts.map((p) => p.y));
  const groundPts = allPts.filter((p) => p.y <= minY + 0.5);

  // 4. Déduplication
  const seen = new Set<string>();
  const unique: Array<{ x: number; z: number }> = [];

  for (const p of groundPts) {
    const key = `${Math.round(p.x * 10)},${Math.round(p.z * 10)}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push({ x: p.x, z: p.z });
    }
  }

  if (unique.length < 3) return [];

  // 5. Tri angulaire autour du centroïde
  const cx = unique.reduce((s, p) => s + p.x, 0) / unique.length;
  const cz = unique.reduce((s, p) => s + p.z, 0) / unique.length;

  unique.sort((a, b) => {
    return Math.atan2(a.z - cz, a.x - cx) - Math.atan2(b.z - cz, b.x - cx);
  });

  // 6. Validation dimensionnelle
  const xs = unique.map((p) => p.x);
  const zs = unique.map((p) => p.z);
  const fpW = Math.max(...xs) - Math.min(...xs);
  const fpD = Math.max(...zs) - Math.min(...zs);

  if (log || fpW > MAX_EXTRACTED_FOOTPRINT_M || fpD > MAX_EXTRACTED_FOOTPRINT_M) {
    console.log(
      `[MMZ][extractFootprint] "${buildingId}": ` +
        `footprint ${fpW.toFixed(1)}m × ${fpD.toFixed(1)}m ` +
        `centre=(${cx.toFixed(1)}, ${cz.toFixed(1)}) pts_ground=${unique.length}`,
    );
  }

  if (fpW > MAX_EXTRACTED_FOOTPRINT_M || fpD > MAX_EXTRACTED_FOOTPRINT_M) {
    console.error(
      `[MMZ][extractFootprint] ⛔ "${buildingId}" — footprint TROP GRAND: ` +
        `${fpW.toFixed(1)}m × ${fpD.toFixed(1)}m (seuil: ${MAX_EXTRACTED_FOOTPRINT_M}m). ` +
        `Cause probable: STRUCTURE mesh = emprise parcelle. Enrichissement annulé. ` +
        `→ Vérifier getBuildingScenePts() dans massingGeometry.ts`,
    );
    return [];
  }

  return unique;
}

function cleanupFacadeGroups(groups: ExportMeshGroup[]): void {
  for (const group of groups) {
    group.mesh.parent?.remove(group.mesh);
    group.mesh.geometry?.dispose();

    const mat = group.mesh.material;
    if (Array.isArray(mat)) {
      mat.forEach((m) => m.dispose());
    } else if (mat instanceof THREE.Material) {
      mat.dispose();
    }
  }
}

// ─────────────────────────────────────────────────────────────
// GLTF EXPORTER
// ─────────────────────────────────────────────────────────────

async function exportWithGLTFExporter(
  scene: THREE.Scene,
  options: {
    binary: boolean;
    onlyVisible: boolean;
    trs: boolean;
    maxTextureSize: number;
    includeCustomExtensions: boolean;
  },
): Promise<string | ArrayBuffer> {
  const exporter = new GLTFExporter();

  return new Promise<string | ArrayBuffer>((resolve, reject) => {
    try {
      exporter.parse(
        scene,
        (result) => {
          if (result instanceof ArrayBuffer) {
            resolve(result);
            return;
          }
          try {
            resolve(JSON.stringify(result, null, 2));
          } catch (e) {
            reject(e);
          }
        },
        (error) => {
          reject(error instanceof Error ? error : new Error(String(error)));
        },
        {
          binary: options.binary,
          onlyVisible: options.onlyVisible,
          trs: options.trs,
          maxTextureSize: options.maxTextureSize,
          includeCustomExtensions: options.includeCustomExtensions,
        },
      );
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function payloadToBlob(payload: string | ArrayBuffer, mimeType: string): Blob {
  return typeof payload === "string"
    ? new Blob([payload], { type: `${mimeType};charset=utf-8` })
    : new Blob([payload], { type: mimeType });
}

// ─────────────────────────────────────────────────────────────
// DOWNLOAD
// ─────────────────────────────────────────────────────────────

function downloadPayload(
  payload: string | ArrayBuffer,
  fileName: string,
  mimeType: string,
): void {
  const blob = payloadToBlob(payload, mimeType);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}