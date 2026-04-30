// buildFacadeForExport.ts
// ═══════════════════════════════════════════════════════════════════════════════
// V9 — VARIATION ARCHITECTURALE RÉALISTE
//
// Historique :
//   V6    : vitrage, cadres, bandeaux, socle, balcons, entrée, attique, corniche
//   V7    : setback_mass (masse haute en retrait)
//   V8    : corner_pilaster (traitement d'angle)
//   V9    : variation architecturale déterministe
//   V9.1  : guard de dimensions footprint
//
// CORRECTIF Z-FIGHTING (V9.2) :
//   L'attique (attic) démarrait exactement à Y = totalHeight - atticHeight,
//   même niveau que le top cap des murs → z-fighting entre les deux faces.
//   Fix : décalage +0.005m (5mm) sur le translate de l'attic et du setback_mass.
//   Imperceptible visuellement, mais casse l'égalité de profondeur entre faces.
// ═══════════════════════════════════════════════════════════════════════════════

import * as THREE from 'three';
import {
  buildFacadeGeometry,
  type FacadeConfig,
  type FacadeResult,
} from '../massingFacadeEngine';
import { extractEdges } from '../massingGeometry3d';
import {
  getFacadeStyle,
  resolveStyleForEdge,
  classifyEdge,
  computeCentroid,
  type FacadeStyleId,
} from '../massingFacadeStyles';
import type { MassingBuildingModel } from '../massingScene.types';
import {
  totalLevelsFromArchitecture,
} from '../massingScene.types';

// ─────────────────────────────────────────────────────────────────────────────
// Constante seuil footprint
// ─────────────────────────────────────────────────────────────────────────────

const MAX_FACADE_FOOTPRINT_M = 120;

// ─────────────────────────────────────────────────────────────────────────────
// Offset anti z-fighting (mètres)
// Décalage vertical minimal pour éviter la coplanarité entre le dessus
// des murs et le bas de l'attique / du setback.
// 5mm → imperceptible à l'œil, mais suffit pour le comparateur de profondeur GPU.
// ─────────────────────────────────────────────────────────────────────────────
const ANTI_ZFIGHT_Y = 0.005;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ExportMeshGroup {
  name: string;
  mesh: THREE.Mesh;
  category: string;
}

export interface FacadeExportInput {
  building: MassingBuildingModel;
  scenePts: Array<{ x: number; z: number }>;
  prefix: string;
  platformY?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapping catégories
// ─────────────────────────────────────────────────────────────────────────────

const RESULT_KEY_TO_CATEGORY: Partial<Record<keyof FacadeResult, string>> = {
  glass: 'glazing',
  frames: 'frames',
  sills: 'frames',
  banding: 'banding',
  balconies: 'balcony_slab',
  railings: 'balcony_rail',
  doors: 'entrance',
};

// ─────────────────────────────────────────────────────────────────────────────
// Matériaux export GLTF — V9
// ─────────────────────────────────────────────────────────────────────────────

const EXPORT_MATERIALS: Record<string, {
  color: string;
  roughness: number;
  metallic: number;
  transparent?: boolean;
  opacity?: number;
}> = {
  glazing:        { color: '#2A3540', roughness: 0.06, metallic: 0.08, transparent: true, opacity: 0.72 },
  frames:         { color: '#4A4A4A', roughness: 0.55, metallic: 0.03 },
  banding:        { color: '#D8D4CC', roughness: 0.72, metallic: 0.0  },
  socle:          { color: '#C8C2B6', roughness: 0.82, metallic: 0.0  },
  balcony_slab:   { color: '#C7C3B7', roughness: 0.86, metallic: 0.02 },
  balcony_rail:   { color: '#374151', roughness: 0.35, metallic: 0.70 },
  entrance:       { color: '#2D2D2D', roughness: 0.42, metallic: 0.25 },
  attic:          { color: '#E4DED2', roughness: 0.74, metallic: 0.0  },
  cornice:        { color: '#D6D0C4', roughness: 0.68, metallic: 0.0  },
  setback_mass:   { color: '#DDD6C9', roughness: 0.76, metallic: 0.0  },
  corner_pilaster:{ color: '#E0DBD0', roughness: 0.70, metallic: 0.0  },
  facade_relief:  { color: '#D4CFC4', roughness: 0.78, metallic: 0.0  },
  facade_fin:     { color: '#C9C4B9', roughness: 0.66, metallic: 0.0  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Point d'entrée principal
// ─────────────────────────────────────────────────────────────────────────────

export function buildFacadeMeshGroupsForExport(input: FacadeExportInput): ExportMeshGroup[] {
  const { building, scenePts, prefix, platformY = 0 } = input;

  if (scenePts.length < 3) {
    console.warn('[MMZ][buildFacadeForExport] Not enough points for facade generation');
    return [];
  }

  // ── V9.1: Guard dimensions footprint ──────────────────────────────────────
  {
    const fpXs = scenePts.map(p => p.x);
    const fpZs = scenePts.map(p => p.z);
    const fpW  = Math.max(...fpXs) - Math.min(...fpXs);
    const fpD  = Math.max(...fpZs) - Math.min(...fpZs);
    const fpCx = (Math.max(...fpXs) + Math.min(...fpXs)) / 2;
    const fpCz = (Math.max(...fpZs) + Math.min(...fpZs)) / 2;

    console.log(
      `[MMZ][buildFacadeForExport] "${prefix}": ` +
      `footprint ${fpW.toFixed(1)}m × ${fpD.toFixed(1)}m ` +
      `centre=(${fpCx.toFixed(1)}, ${fpCz.toFixed(1)}) ` +
      `pts=${scenePts.length}`,
    );

    if (fpW > MAX_FACADE_FOOTPRINT_M || fpD > MAX_FACADE_FOOTPRINT_M) {
      console.error(
        `[MMZ][buildFacadeForExport] ⛔ "${prefix}" — ` +
        `footprint TROP GRAND: ${fpW.toFixed(1)}m × ${fpD.toFixed(1)}m ` +
        `(seuil: ${MAX_FACADE_FOOTPRINT_M}m). ` +
        `Enrichissement annulé. ` +
        `→ Vérifier getBuildingScenePts() / extractFootprintFromScene().`,
      );
      return [];
    }
  }

  const arch = building.architecture;
  const styleId = building.style?.facadeStyleId as FacadeStyleId | undefined;
  const facadeStyleDef = getFacadeStyle(styleId ?? null);

  const totalFloors =
    arch
      ? Math.max(1, totalLevelsFromArchitecture(arch))
      : Math.max(1, 1 + building.levels.aboveGroundFloors);

  const floorHeight =
    arch
      ? Math.max(2.5, arch.vertical.upperFloorHeightM)
      : Math.max(2.5, building.levels.typicalFloorHeightM);

  const totalHeight = Math.max(3, totalFloors * floorHeight);

  const socleHeight =
    arch
      ? clampNumber((arch.vertical?.groundFloorHeightM ?? floorHeight), 2.8, 5.5)
      : clampNumber((building.levels?.groundFloorHeightM ?? floorHeight), 2.8, 5.5);

  const attiqueStart = Math.max(1, totalFloors - 1);
  const atticHeight  = clampNumber(floorHeight, 2.5, 3.5);
  const atticInset   = resolveAtticInset(building);

  const pts2d  = scenePts.map((p) => ({ x: p.x, y: p.z }));
  const edges  = extractEdges(pts2d);

  if (edges.length === 0) {
    console.warn('[MMZ][buildFacadeForExport] No edges extracted from footprint');
    return [];
  }

  const centerFacade = computeCentroid(scenePts);

  const edgesXZ = edges.map((e) => ({
    a: { x: e.a.x, z: e.a.y },
    b: { x: e.b.x, z: e.b.y },
  }));

  const balconiesEnabled = resolveBalconiesEnabled(building, facadeStyleDef);
  const balconyFreq      = resolveBalconyFreq(building);

  const facadeEdges = edges.map((edge, i) => {
    const a = edgesXZ[i].a;
    const b = edgesXZ[i].b;
    const edgeType = classifyEdge(a, b, centerFacade, edgesXZ);
    const overrides = resolveStyleForEdge(facadeStyleDef, edgeType, totalFloors);

    return {
      a,
      b,
      overrides: {
        ...overrides,
        attiqueStartFloor: attiqueStart,
        hasBalconies: balconiesEnabled,
        hasLoggias: false,
        hasBanding: true,
      },
    };
  });

  const facadeConfig: FacadeConfig = {
    edges: facadeEdges,
    totalFloors,
    floorHeight,
    baseY: platformY,
    windowRatio:       clampNumber(facadeStyleDef.base.windowRatio, 0.35, 0.75),
    bayWidth:          clampNumber(facadeStyleDef.base.bayWidth, 2.6, 4.2),
    attiqueStartFloor: attiqueStart,
    hasBalconies:      balconiesEnabled,
    balconyFreq:       balconiesEnabled ? balconyFreq : 0,
    facadeStyle:       facadeStyleDef.id,
    hasBanding:        true,
  };

  const result: FacadeResult = buildFacadeGeometry(facadeConfig);
  const groups = facadeResultToMeshGroups(result, prefix);

  // ── V6 : éléments architecturaux de base ──────────────────────────────────

  const socleGroup   = buildSocleMeshGroup({ scenePts, prefix, baseY: platformY, socleHeight });
  if (socleGroup)    groups.push(socleGroup);

  const entranceGroup = buildEntranceMeshGroup({ scenePts, prefix, baseY: platformY, socleHeight });
  if (entranceGroup) groups.push(entranceGroup);

  const atticGroup   = buildAtticMeshGroup({
    scenePts, prefix, baseY: platformY, totalHeight, atticHeight, atticInset,
  });
  if (atticGroup)    groups.push(atticGroup);

  const corniceGroup = buildCorniceMeshGroup({
    scenePts, prefix, baseY: platformY, totalHeight, atticHeight,
  });
  if (corniceGroup)  groups.push(corniceGroup);

  // ── V7 : retrait volumétrique ─────────────────────────────────────────────

  const setbackGroup = buildSetbackMassMeshGroup({
    scenePts,
    prefix,
    baseY:            platformY,
    totalHeight,
    atticHeight,
    setbackStartRatio: 0.58,
    setbackHeight:    Math.max(atticHeight, floorHeight * 1.15),
    setbackInset:     resolveSetbackInset(building),
  });
  if (setbackGroup)  groups.push(setbackGroup);

  // ── V8 : pilastres d'angle ────────────────────────────────────────────────

  const cornerGroup = buildCornerPilasterMeshGroup({
    scenePts, prefix, baseY: platformY, totalHeight, atticHeight,
  });
  if (cornerGroup)   groups.push(cornerGroup);

  // ── V9 : variation architecturale déterministe ────────────────────────────

  const buildingId = (building as Record<string, unknown>)?.id as string
    ?? (building as Record<string, unknown>)?.uuid as string
    ?? prefix;
  const seed = hashString(buildingId);
  const rng  = createRNG(seed);

  const reliefGroup = buildFacadeReliefGroup({
    scenePts,
    prefix,
    baseY:       platformY,
    totalFloors,
    floorHeight,
    socleHeight,
    atticHeight,
    totalHeight,
    rng:         createRNG(seed),
  });
  if (reliefGroup)   groups.push(reliefGroup);

  const finGroup = buildFacadeVerticalFinsGroup({
    scenePts,
    prefix,
    baseY:      platformY,
    totalHeight,
    atticHeight,
    rng:        createRNG(seed ^ 0xDEAD),
  });
  if (finGroup)      groups.push(finGroup);

  void rng;

  console.log(
    `[MMZ][buildFacadeForExport][V9] floors=${totalFloors} floorH=${floorHeight.toFixed(2)} ` +
    `socle=${socleHeight.toFixed(2)} balconies=${balconiesEnabled ? 'on' : 'off'} freq=${balconyFreq} ` +
    `entrance=${entranceGroup ? 'on' : 'off'} attic=${atticGroup ? 'on' : 'off'} ` +
    `cornice=${corniceGroup ? 'on' : 'off'} setback=${setbackGroup ? 'on' : 'off'} ` +
    `corners=${cornerGroup ? 'on' : 'off'} ` +
    `relief=${reliefGroup ? 'on' : 'off'} fins=${finGroup ? 'on' : 'off'} ` +
    `seed=${seed.toString(16)}`,
  );

  return groups;
}

// ─────────────────────────────────────────────────────────────────────────────
// Conversion FacadeResult → mesh groups
// ─────────────────────────────────────────────────────────────────────────────

function facadeResultToMeshGroups(
  result: FacadeResult,
  prefix: string,
): ExportMeshGroup[] {
  const groups: ExportMeshGroup[] = [];
  const mergedByCategory = new Map<string, THREE.BufferGeometry[]>();

  for (const [key, geos] of Object.entries(result) as Array<[keyof FacadeResult, THREE.BufferGeometry[]]>) {
    if (!Array.isArray(geos) || geos.length === 0) continue;
    const category = RESULT_KEY_TO_CATEGORY[key];
    if (!category) continue;
    const arr = mergedByCategory.get(category) ?? [];
    arr.push(...geos);
    mergedByCategory.set(category, arr);
  }

  for (const [category, geos] of mergedByCategory.entries()) {
    if (geos.length === 0) continue;

    const merged = mergeGeometries(geos);
    merged.computeVertexNormals();
    merged.computeBoundingSphere();

    const matDef   = EXPORT_MATERIALS[category] ?? EXPORT_MATERIALS.frames;
    const material = new THREE.MeshStandardMaterial({
      color:     new THREE.Color(matDef.color),
      roughness: matDef.roughness,
      metallic:  matDef.metallic,
      side:      THREE.DoubleSide,
      ...(matDef.transparent
        ? { transparent: true, opacity: matDef.opacity ?? 1, depthWrite: false }
        : {}),
    });

    const mesh = new THREE.Mesh(merged, material);
    mesh.name        = `${prefix}_${category.toUpperCase()}_00`;
    mesh.userData    = { mmzType: category };
    mesh.castShadow  = true;
    mesh.receiveShadow = true;

    groups.push({ name: mesh.name, mesh, category });
  }

  return groups;
}

// ─────────────────────────────────────────────────────────────────────────────
// SOCLE
// ─────────────────────────────────────────────────────────────────────────────

function buildSocleMeshGroup(params: {
  scenePts: Array<{ x: number; z: number }>;
  prefix: string;
  baseY: number;
  socleHeight: number;
}): ExportMeshGroup | null {
  const { scenePts, prefix, baseY, socleHeight } = params;
  if (!scenePts || scenePts.length < 3) return null;
  if (socleHeight <= 0.1) return null;

  const shape  = shapeFromScenePts(scenePts);
  const geo2d  = new THREE.ExtrudeGeometry(shape, {
    depth: socleHeight, bevelEnabled: false, steps: 1, curveSegments: 1,
  });
  geo2d.rotateX(-Math.PI / 2);
  geo2d.translate(0, baseY, 0);

  const socleGeo = insetHorizontalGeometry(geo2d, 0.985);
  socleGeo.computeVertexNormals();
  socleGeo.computeBoundingSphere();

  const matDef   = EXPORT_MATERIALS.socle;
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(matDef.color), roughness: matDef.roughness,
    metallic: matDef.metallic, side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(socleGeo, material);
  mesh.name = `${prefix}_SOCLE_00`;
  mesh.userData = { mmzType: 'socle' };
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return { name: mesh.name, mesh, category: 'socle' };
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTRÉE
// ─────────────────────────────────────────────────────────────────────────────

function buildEntranceMeshGroup(params: {
  scenePts: Array<{ x: number; z: number }>;
  prefix: string;
  baseY: number;
  socleHeight: number;
}): ExportMeshGroup | null {
  const { scenePts, prefix, baseY, socleHeight } = params;
  if (!scenePts || scenePts.length < 2) return null;

  const edge = findPrimaryEntranceEdge(scenePts);
  if (!edge) return null;

  const { a, b, midpoint, outward, length } = edge;
  const entranceWidth  = clampNumber(length * 0.18, 2.2, 4.2);
  const entranceHeight = clampNumber(socleHeight * 0.72, 2.4, 4.4);
  const entranceDepth  = 0.45;

  const center = new THREE.Vector3(
    midpoint.x + outward.x * (entranceDepth * 0.5 + 0.02),
    baseY + entranceHeight * 0.5,
    midpoint.z + outward.z * (entranceDepth * 0.5 + 0.02),
  );

  const geometries: THREE.BufferGeometry[] = [];

  const bodyGeo  = new THREE.BoxGeometry(entranceWidth, entranceHeight, entranceDepth);
  const bodyMesh = new THREE.Mesh(bodyGeo);
  orientMeshToEdge(bodyMesh, a, b);
  bodyMesh.position.copy(center);
  bodyMesh.updateMatrixWorld(true);
  geometries.push(bodyGeo.clone().applyMatrix4(bodyMesh.matrixWorld));

  const canopyWidth  = entranceWidth * 1.15;
  const canopyHeight = 0.18;
  const canopyDepth  = 0.95;
  const canopyGeo    = new THREE.BoxGeometry(canopyWidth, canopyHeight, canopyDepth);
  const canopyMesh   = new THREE.Mesh(canopyGeo);
  canopyMesh.position.set(
    midpoint.x + outward.x * (canopyDepth * 0.5 + 0.05),
    baseY + entranceHeight + canopyHeight * 0.5,
    midpoint.z + outward.z * (canopyDepth * 0.5 + 0.05),
  );
  orientMeshToEdge(canopyMesh, a, b);
  canopyMesh.updateMatrixWorld(true);
  geometries.push(canopyGeo.clone().applyMatrix4(canopyMesh.matrixWorld));

  const jambWidth  = 0.16;
  const jambHeight = entranceHeight;
  const jambDepth  = entranceDepth * 0.9;
  const sideDir    = normalized2D({ x: b.x - a.x, z: b.z - a.z });
  const halfSpan   = entranceWidth * 0.5 - jambWidth * 0.5;

  for (const sign of [-1, 1]) {
    const jGeo  = new THREE.BoxGeometry(jambWidth, jambHeight, jambDepth);
    const jMesh = new THREE.Mesh(jGeo);
    jMesh.position.set(
      center.x + sideDir.x * halfSpan * sign,
      baseY + jambHeight * 0.5,
      center.z + sideDir.z * halfSpan * sign,
    );
    orientMeshToEdge(jMesh, a, b);
    jMesh.updateMatrixWorld(true);
    geometries.push(jGeo.clone().applyMatrix4(jMesh.matrixWorld));
  }

  const merged   = mergeGeometries(geometries);
  merged.computeVertexNormals();
  merged.computeBoundingSphere();

  const matDef   = EXPORT_MATERIALS.entrance;
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(matDef.color), roughness: matDef.roughness,
    metallic: matDef.metallic, side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(merged, material);
  mesh.name = `${prefix}_ENTRANCE_00`;
  mesh.userData = { mmzType: 'entrance' };
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return { name: mesh.name, mesh, category: 'entrance' };
}

// ─────────────────────────────────────────────────────────────────────────────
// ATTIQUE — CORRECTIF Z-FIGHTING V9.2
// Le translate Y utilise + ANTI_ZFIGHT_Y pour ne pas être coplanaire
// avec le top cap des murs du volume principal.
// ─────────────────────────────────────────────────────────────────────────────

function buildAtticMeshGroup(params: {
  scenePts: Array<{ x: number; z: number }>;
  prefix: string;
  baseY: number;
  totalHeight: number;
  atticHeight: number;
  atticInset: number;
}): ExportMeshGroup | null {
  const { scenePts, prefix, baseY, totalHeight, atticHeight, atticInset } = params;
  if (!scenePts || scenePts.length < 3) return null;
  if (atticHeight <= 0.25) return null;

  const shape  = shapeFromScenePts(scenePts);
  const geo2d  = new THREE.ExtrudeGeometry(shape, {
    depth: atticHeight, bevelEnabled: false, steps: 1, curveSegments: 1,
  });
  geo2d.rotateX(-Math.PI / 2);

  // ── CORRECTIF Z-FIGHTING : +ANTI_ZFIGHT_Y ────────────────────────────────
  // Sans ce décalage, la face basse de l'attique = face haute du volume mur
  // → exactement coplanaires → scintillement selon angle/zoom de caméra.
  geo2d.translate(0, baseY + Math.max(0, totalHeight - atticHeight) + ANTI_ZFIGHT_Y, 0);

  const scaleXZ  = Math.max(0.80, 1.0 - atticInset);
  const atticGeo = insetHorizontalGeometry(geo2d, scaleXZ);
  atticGeo.computeVertexNormals();
  atticGeo.computeBoundingSphere();

  const matDef   = EXPORT_MATERIALS.attic;
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(matDef.color), roughness: matDef.roughness,
    metallic: matDef.metallic, side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(atticGeo, material);
  mesh.name = `${prefix}_ATTIC_00`;
  mesh.userData = { mmzType: 'attic' };
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return { name: mesh.name, mesh, category: 'attic' };
}

// ─────────────────────────────────────────────────────────────────────────────
// CORNICHE / COURONNEMENT
// ─────────────────────────────────────────────────────────────────────────────

function buildCorniceMeshGroup(params: {
  scenePts: Array<{ x: number; z: number }>;
  prefix: string;
  baseY: number;
  totalHeight: number;
  atticHeight: number;
}): ExportMeshGroup | null {
  const { scenePts, prefix, baseY, totalHeight, atticHeight } = params;
  if (!scenePts || scenePts.length < 3) return null;

  const corniceHeight  = 0.22;
  const corniceTopY    = baseY + Math.max(0, totalHeight - atticHeight);
  const corniceBottomY = corniceTopY - corniceHeight * 0.5;
  const centroid       = computeCentroid(scenePts);
  const geometries: THREE.BufferGeometry[] = [];

  for (let i = 0; i < scenePts.length; i++) {
    const a  = scenePts[i];
    const b  = scenePts[(i + 1) % scenePts.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.5) continue;

    const midpoint = { x: (a.x + b.x) * 0.5, z: (a.z + b.z) * 0.5 };
    const nx0 = -dz / len;
    const nz0 =  dx / len;
    const dot = nx0 * (centroid.x - midpoint.x) + nz0 * (centroid.z - midpoint.z);
    const outward = dot > 0 ? { x: -nx0, z: -nz0 } : { x: nx0, z: nz0 };

    const bandDepth = 0.28;
    const bandGeo   = new THREE.BoxGeometry(len, corniceHeight, bandDepth);
    const bandMesh  = new THREE.Mesh(bandGeo);
    bandMesh.position.set(
      midpoint.x + outward.x * (bandDepth * 0.5 + 0.03),
      corniceBottomY + corniceHeight * 0.5,
      midpoint.z + outward.z * (bandDepth * 0.5 + 0.03),
    );
    orientMeshToEdge(bandMesh, a, b);
    bandMesh.updateMatrixWorld(true);
    geometries.push(bandGeo.clone().applyMatrix4(bandMesh.matrixWorld));
  }

  if (geometries.length === 0) return null;

  const merged   = mergeGeometries(geometries);
  merged.computeVertexNormals();
  merged.computeBoundingSphere();

  const matDef   = EXPORT_MATERIALS.cornice;
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(matDef.color), roughness: matDef.roughness,
    metallic: matDef.metallic, side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(merged, material);
  mesh.name = `${prefix}_CORNICE_00`;
  mesh.userData = { mmzType: 'cornice' };
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return { name: mesh.name, mesh, category: 'cornice' };
}

// ─────────────────────────────────────────────────────────────────────────────
// SETBACK MASS — V7 + CORRECTIF Z-FIGHTING V9.2
// ─────────────────────────────────────────────────────────────────────────────

function buildSetbackMassMeshGroup(params: {
  scenePts: Array<{ x: number; z: number }>;
  prefix: string;
  baseY: number;
  totalHeight: number;
  atticHeight: number;
  setbackStartRatio: number;
  setbackHeight: number;
  setbackInset: number;
}): ExportMeshGroup | null {
  const { scenePts, prefix, baseY, totalHeight, atticHeight,
          setbackStartRatio, setbackHeight, setbackInset } = params;

  if (!scenePts || scenePts.length < 3) return null;
  if (setbackInset <= 0.01) return null;

  const basePoly  = scenePts.map((p) => ({ x: p.x, z: p.z }));
  const insetPoly = insetPolygon2D(basePoly, setbackInset);
  if (!insetPoly || insetPoly.length < 3) return null;

  const shape           = shapeFromScenePts(insetPoly);
  const effectiveHeight = clampNumber(
    setbackHeight,
    Math.max(1.8, atticHeight * 0.8),
    Math.max(3.5, totalHeight * 0.45),
  );

  // ── CORRECTIF Z-FIGHTING : +ANTI_ZFIGHT_Y sur startY ───────────────────
  // Si setbackStartRatio tombe exactement sur une arête de plancher, la face
  // basse du setback est coplanaire avec la face haute du volume sous-jacent.
  const startY = baseY + totalHeight * setbackStartRatio + ANTI_ZFIGHT_Y;

  const geo2d = new THREE.ExtrudeGeometry(shape, {
    depth: effectiveHeight, bevelEnabled: false, steps: 1, curveSegments: 1,
  });
  geo2d.rotateX(-Math.PI / 2);
  geo2d.translate(0, startY, 0);
  geo2d.computeVertexNormals();
  geo2d.computeBoundingSphere();

  const matDef   = EXPORT_MATERIALS.setback_mass;
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(matDef.color), roughness: matDef.roughness,
    metallic: matDef.metallic, side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geo2d, material);
  mesh.name = `${prefix}_SETBACK_MASS_00`;
  mesh.userData = { mmzType: 'setback_mass' };
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return { name: mesh.name, mesh, category: 'setback_mass' };
}

// ─────────────────────────────────────────────────────────────────────────────
// CORNER PILASTERS — V8
// ─────────────────────────────────────────────────────────────────────────────

function buildCornerPilasterMeshGroup(params: {
  scenePts: Array<{ x: number; z: number }>;
  prefix: string;
  baseY: number;
  totalHeight: number;
  atticHeight: number;
}): ExportMeshGroup | null {
  const { scenePts, prefix, baseY, totalHeight, atticHeight } = params;
  if (!scenePts || scenePts.length < 3) return null;

  const pilasterHeight = Math.max(1.0, totalHeight - atticHeight);
  const pilasterSize   = 0.28;
  const protrusion     = 0.04;
  const centroid       = computeCentroid(scenePts);
  const geometries: THREE.BufferGeometry[] = [];

  for (let i = 0; i < scenePts.length; i++) {
    const prev = scenePts[(i - 1 + scenePts.length) % scenePts.length];
    const curr = scenePts[i];
    const next = scenePts[(i + 1) % scenePts.length];

    const dxIn  = curr.x - prev.x;
    const dzIn  = curr.z - prev.z;
    const lenIn = Math.hypot(dxIn, dzIn);
    const dxOut  = next.x - curr.x;
    const dzOut  = next.z - curr.z;
    const lenOut = Math.hypot(dxOut, dzOut);
    if (lenIn < 0.5 || lenOut < 0.5) continue;

    const nxIn = -dzIn / lenIn;
    const nzIn =  dxIn / lenIn;
    const nxOut = -dzOut / lenOut;
    const nzOut =  dxOut / lenOut;
    const toCx  = centroid.x - curr.x;
    const toCz  = centroid.z - curr.z;

    const outIn  = (nxIn * toCx + nzIn * toCz) > 0
      ? { x: -nxIn,  z: -nzIn  } : { x: nxIn,  z: nzIn  };
    const outOut = (nxOut * toCx + nzOut * toCz) > 0
      ? { x: -nxOut, z: -nzOut } : { x: nxOut, z: nzOut };

    const bx   = outIn.x + outOut.x;
    const bz   = outIn.z + outOut.z;
    const bLen = Math.hypot(bx, bz);
    if (bLen < 1e-6) continue;

    const outward = { x: bx / bLen, z: bz / bLen };
    const px = curr.x + outward.x * (pilasterSize * 0.5 + protrusion);
    const pz = curr.z + outward.z * (pilasterSize * 0.5 + protrusion);

    const geo      = new THREE.BoxGeometry(pilasterSize, pilasterHeight, pilasterSize);
    const tempMesh = new THREE.Mesh(geo);
    tempMesh.position.set(px, baseY + pilasterHeight * 0.5, pz);
    tempMesh.rotation.y = -Math.atan2(outward.z, outward.x);
    tempMesh.updateMatrixWorld(true);
    geometries.push(geo.clone().applyMatrix4(tempMesh.matrixWorld));
  }

  if (geometries.length === 0) return null;

  const merged   = mergeGeometries(geometries);
  merged.computeVertexNormals();
  merged.computeBoundingSphere();

  const matDef   = EXPORT_MATERIALS.corner_pilaster;
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(matDef.color), roughness: matDef.roughness,
    metallic: matDef.metallic, side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(merged, material);
  mesh.name = `${prefix}_CORNER_PILASTER_00`;
  mesh.userData = { mmzType: 'corner_pilaster' };
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return { name: mesh.name, mesh, category: 'corner_pilaster' };
}

// ─────────────────────────────────────────────────────────────────────────────
// FACADE RELIEF PANELS — V9
// ─────────────────────────────────────────────────────────────────────────────

const SPANDREL_HEIGHT_RATIO = 0.28;
const ZONE_WIDTH_BASE       = 4.0;
const WALL_DEPTH_BASE       = 0.12;
const RELIEF_MIN_DEPTH      = 0.06;
const RELIEF_MAX_DEPTH      = 0.22;

function buildFacadeReliefGroup(params: {
  scenePts: Array<{ x: number; z: number }>;
  prefix: string;
  baseY: number;
  totalFloors: number;
  floorHeight: number;
  socleHeight: number;
  atticHeight: number;
  totalHeight: number;
  rng: () => number;
}): ExportMeshGroup | null {
  const {
    scenePts, prefix, baseY,
    totalFloors, floorHeight, socleHeight, atticHeight, totalHeight, rng,
  } = params;

  if (!scenePts || scenePts.length < 3) return null;
  if (totalFloors < 2) return null;

  const centroid    = computeCentroid(scenePts);
  const geometries: THREE.BufferGeometry[] = [];
  const firstFloor  = 1;
  const lastFloor   = Math.max(firstFloor, totalFloors - 2);

  for (let ei = 0; ei < scenePts.length; ei++) {
    const a  = scenePts[ei];
    const b  = scenePts[(ei + 1) % scenePts.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const edgeLen = Math.hypot(dx, dz);
    if (edgeLen < 2.5) continue;

    const nx0 = -dz / edgeLen;
    const nz0 =  dx / edgeLen;
    const mid = { x: (a.x + b.x) * 0.5, z: (a.z + b.z) * 0.5 };
    const dot = nx0 * (centroid.x - mid.x) + nz0 * (centroid.z - mid.z);
    const outward  = dot > 0 ? { x: -nx0, z: -nz0 } : { x: nx0, z: nz0 };
    const tangent  = { x: dx / edgeLen, z: dz / edgeLen };

    const zoneWidthVariation = 0.6 + rng() * 0.8;
    const targetZoneWidth    = ZONE_WIDTH_BASE + zoneWidthVariation - 0.7;
    const numZones  = Math.max(1, Math.round(edgeLen / targetZoneWidth));
    const zoneWidth = edgeLen / numZones;

    type ZoneType = 'proud' | 'flush' | 'recessed';
    const zoneTypes:  ZoneType[] = [];
    const zoneDepths: number[]   = [];
    for (let z = 0; z < numZones; z++) {
      const v = rng();
      if (v < 0.40) {
        zoneTypes.push('proud');
        zoneDepths.push(WALL_DEPTH_BASE + RELIEF_MIN_DEPTH + rng() * (RELIEF_MAX_DEPTH - RELIEF_MIN_DEPTH));
      } else if (v < 0.75) {
        zoneTypes.push('flush');
        zoneDepths.push(WALL_DEPTH_BASE);
      } else {
        zoneTypes.push('recessed');
        zoneDepths.push(Math.max(0.04, WALL_DEPTH_BASE - rng() * 0.08));
      }
    }

    const spandrelH = clampNumber(floorHeight * SPANDREL_HEIGHT_RATIO, 0.55, 1.05);
    const windowH   = floorHeight - spandrelH;

    for (let floor = firstFloor; floor <= lastFloor; floor++) {
      const floorBaseY        = baseY + socleHeight + (floor - 1) * floorHeight;
      const spandrelY         = floorBaseY + windowH + spandrelH * 0.5;
      const remainingHeight   = baseY + totalHeight - atticHeight - spandrelY;
      if (remainingHeight < spandrelH * 0.5) continue;

      for (let zi = 0; zi < numZones; zi++) {
        const depth       = zoneDepths[zi];
        const type        = zoneTypes[zi];
        const widthShrink = type === 'flush' ? 0.0 : 0.08;
        const panelW      = Math.max(0.5, zoneWidth - widthShrink * 2);
        const panelH      = type === 'flush' ? spandrelH * 0.85 : spandrelH;
        const t           = (zi + 0.5) / numZones;
        const cx          = a.x + tangent.x * edgeLen * t;
        const cz          = a.z + tangent.z * edgeLen * t;

        const panelGeo  = new THREE.BoxGeometry(panelW, panelH, depth);
        const panelMesh = new THREE.Mesh(panelGeo);
        panelMesh.position.set(
          cx + outward.x * (depth * 0.5 + 0.01),
          spandrelY,
          cz + outward.z * (depth * 0.5 + 0.01),
        );
        orientMeshToEdge(panelMesh, a, b);
        panelMesh.updateMatrixWorld(true);
        geometries.push(panelGeo.clone().applyMatrix4(panelMesh.matrixWorld));
      }
    }
  }

  if (geometries.length === 0) return null;

  const merged   = mergeGeometries(geometries);
  merged.computeVertexNormals();
  merged.computeBoundingSphere();

  const matDef   = EXPORT_MATERIALS.facade_relief;
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(matDef.color), roughness: matDef.roughness,
    metallic: matDef.metallic, side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(merged, material);
  mesh.name = `${prefix}_FACADE_RELIEF_00`;
  mesh.userData = { mmzType: 'facade_relief' };
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return { name: mesh.name, mesh, category: 'facade_relief' };
}

// ─────────────────────────────────────────────────────────────────────────────
// FACADE VERTICAL FINS — V9
// ─────────────────────────────────────────────────────────────────────────────

const FIN_WIDTH = 0.08;
const FIN_DEPTH = 0.14;
const FIN_FREQ  = 0.62;

function buildFacadeVerticalFinsGroup(params: {
  scenePts: Array<{ x: number; z: number }>;
  prefix: string;
  baseY: number;
  totalHeight: number;
  atticHeight: number;
  rng: () => number;
}): ExportMeshGroup | null {
  const { scenePts, prefix, baseY, totalHeight, atticHeight, rng } = params;
  if (!scenePts || scenePts.length < 3) return null;

  const finHeight  = Math.max(1.0, totalHeight - atticHeight);
  const centroid   = computeCentroid(scenePts);
  const geometries: THREE.BufferGeometry[] = [];

  for (let ei = 0; ei < scenePts.length; ei++) {
    const a  = scenePts[ei];
    const b  = scenePts[(ei + 1) % scenePts.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const edgeLen = Math.hypot(dx, dz);
    if (edgeLen < 3.0) continue;

    const tangent  = { x: dx / edgeLen, z: dz / edgeLen };
    const nx0 = -dz / edgeLen;
    const nz0 =  dx / edgeLen;
    const mid = { x: (a.x + b.x) * 0.5, z: (a.z + b.z) * 0.5 };
    const dot = nx0 * (centroid.x - mid.x) + nz0 * (centroid.z - mid.z);
    const outward  = dot > 0 ? { x: -nx0, z: -nz0 } : { x: nx0, z: nz0 };

    const numZones  = Math.max(1, Math.round(edgeLen / ZONE_WIDTH_BASE));
    const zoneWidth = edgeLen / numZones;

    for (let zi = 1; zi < numZones; zi++) {
      if (rng() > FIN_FREQ) continue;

      const t     = zi / numZones;
      const fx    = a.x + tangent.x * edgeLen * t;
      const fz    = a.z + tangent.z * edgeLen * t;
      const nudge = (rng() - 0.5) * zoneWidth * 0.08;
      const fnx   = fx + tangent.x * nudge;
      const fnz   = fz + tangent.z * nudge;

      const finGeo  = new THREE.BoxGeometry(FIN_WIDTH, finHeight, FIN_DEPTH);
      const finMesh = new THREE.Mesh(finGeo);
      finMesh.position.set(
        fnx + outward.x * (FIN_DEPTH * 0.5 + 0.02),
        baseY + finHeight * 0.5,
        fnz + outward.z * (FIN_DEPTH * 0.5 + 0.02),
      );
      orientMeshToEdge(finMesh, a, b);
      finMesh.updateMatrixWorld(true);
      geometries.push(finGeo.clone().applyMatrix4(finMesh.matrixWorld));
    }
  }

  if (geometries.length === 0) return null;

  const merged   = mergeGeometries(geometries);
  merged.computeVertexNormals();
  merged.computeBoundingSphere();

  const matDef   = EXPORT_MATERIALS.facade_fin;
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(matDef.color), roughness: matDef.roughness,
    metallic: matDef.metallic, side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(merged, material);
  mesh.name = `${prefix}_FACADE_FIN_00`;
  mesh.userData = { mmzType: 'facade_fin' };
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return { name: mesh.name, mesh, category: 'facade_fin' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Merge utility
// ─────────────────────────────────────────────────────────────────────────────

function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const clones = geos
    .filter((g) => !!g?.getAttribute('position'))
    .map((g) => g.clone());

  if (clones.length === 0) return new THREE.BufferGeometry();

  let totalVerts = 0;
  for (const g of clones) {
    const pos = g.getAttribute('position');
    if (pos) totalVerts += pos.count;
  }

  const positions = new Float32Array(totalVerts * 3);
  const normals   = new Float32Array(totalVerts * 3);
  let offset = 0;

  for (const g of clones) {
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    if (!pos) continue;
    positions.set(
      new Float32Array(pos.array.buffer, pos.array.byteOffset, pos.count * 3),
      offset * 3,
    );
    const nrm = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
    if (nrm) {
      normals.set(
        new Float32Array(nrm.array.buffer, nrm.array.byteOffset, nrm.count * 3),
        offset * 3,
      );
    }
    offset += pos.count;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal',   new THREE.Float32BufferAttribute(normals,   3));
  return merged;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers render-spec
// ─────────────────────────────────────────────────────────────────────────────

export function collectMeshGroupNames(
  groups: ExportMeshGroup[],
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const g of groups) {
    if (!result[g.category]) result[g.category] = [];
    result[g.category].push(g.name);
  }
  return result;
}

export function collectCategories(groups: ExportMeshGroup[]): string[] {
  return [...new Set(groups.map((g) => g.category))];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers métier
// ─────────────────────────────────────────────────────────────────────────────

function resolveBalconiesEnabled(building: MassingBuildingModel, facadeStyleDef: unknown): boolean {
  const archAny  = building.architecture as Record<string, unknown> | undefined;
  const styleAny = building.style        as Record<string, unknown> | undefined;
  const details  = archAny?.details  as Record<string, unknown> | undefined;
  const balcs    = archAny?.balconies as Record<string, unknown> | undefined;
  const fd       = facadeStyleDef     as Record<string, unknown> | undefined;
  const upper    = fd?.upper          as Record<string, unknown> | undefined;
  if (typeof details?.balconiesEnabled === 'boolean') return details.balconiesEnabled;
  if (typeof balcs?.enabled === 'boolean')             return balcs.enabled;
  if (typeof styleAny?.balconiesEnabled === 'boolean') return styleAny.balconiesEnabled;
  if (typeof upper?.hasBalconies === 'boolean')        return upper.hasBalconies;
  return false;
}

function resolveBalconyFreq(building: MassingBuildingModel): number {
  const archAny  = building.architecture as Record<string, unknown> | undefined;
  const styleAny = building.style        as Record<string, unknown> | undefined;
  const details  = archAny?.details      as Record<string, unknown> | undefined;
  const balcs    = archAny?.balconies    as Record<string, unknown> | undefined;
  const raw = details?.balconyFrequency ?? balcs?.frequency ?? styleAny?.balconiesFrequency ?? 1;
  const v   = Number(raw);
  if (!Number.isFinite(v)) return 1;
  return Math.max(1, Math.min(3, Math.round(v)));
}

function resolveAtticInset(building: MassingBuildingModel): number {
  const archAny  = building.architecture as Record<string, unknown> | undefined;
  const styleAny = building.style        as Record<string, unknown> | undefined;
  const details  = archAny?.details      as Record<string, unknown> | undefined;
  const vert     = archAny?.vertical     as Record<string, unknown> | undefined;
  const attic    = archAny?.attic        as Record<string, unknown> | undefined;
  const raw = details?.atticInset ?? vert?.atticInsetM ?? attic?.setbackM ?? styleAny?.atticSetbackM ?? 0.08;
  const v   = Number(raw);
  if (!Number.isFinite(v)) return 0.08;
  return Math.max(0.04, Math.min(0.18, v));
}

function resolveSetbackInset(building: MassingBuildingModel): number {
  const archAny  = building.architecture as Record<string, unknown> | undefined;
  const styleAny = building.style        as Record<string, unknown> | undefined;
  const details  = archAny?.details      as Record<string, unknown> | undefined;
  const vert     = archAny?.vertical     as Record<string, unknown> | undefined;
  const setbacks = archAny?.setbacks     as Record<string, unknown> | undefined;
  const raw = details?.setbackInsetM ?? vert?.setbackInsetM ?? setbacks?.insetM ?? styleAny?.setbackInsetM ?? 1.2;
  const v   = Number(raw);
  if (!Number.isFinite(v)) return 1.2;
  return Math.max(0.6, Math.min(2.4, v));
}

function clampNumber(v: number | undefined, min: number, max: number): number {
  if (typeof v !== 'number' || Number.isNaN(v)) return min;
  return Math.max(min, Math.min(max, v));
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers géométriques
// ─────────────────────────────────────────────────────────────────────────────

function insetHorizontalGeometry(
  geometry: THREE.BufferGeometry,
  scaleXZ: number,
): THREE.BufferGeometry {
  const g = geometry.clone();
  g.computeBoundingBox();
  const bb = g.boundingBox;
  if (!bb) return g;

  const cx  = (bb.min.x + bb.max.x) * 0.5;
  const cz  = (bb.min.z + bb.max.z) * 0.5;
  const pos = g.getAttribute('position') as THREE.BufferAttribute;

  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(
      i,
      cx + (pos.getX(i) - cx) * scaleXZ,
      pos.getY(i),
      cz + (pos.getZ(i) - cz) * scaleXZ,
    );
  }

  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

function insetPolygon2D(
  pts: Array<{ x: number; z: number }>,
  inset: number,
): Array<{ x: number; z: number }> | null {
  if (!pts || pts.length < 3) return null;
  const centroid = computeCentroid(pts);
  const out: Array<{ x: number; z: number }> = [];

  for (const p of pts) {
    const dx  = p.x - centroid.x;
    const dz  = p.z - centroid.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) {
      out.push({ x: p.x, z: p.z });
      continue;
    }
    out.push({ x: p.x - (dx / len) * inset, z: p.z - (dz / len) * inset });
  }

  return out;
}

function findPrimaryEntranceEdge(scenePts: Array<{ x: number; z: number }>) {
  if (scenePts.length < 2) return null;
  let best: {
    a: { x: number; z: number };
    b: { x: number; z: number };
    midpoint: { x: number; z: number };
    outward: { x: number; z: number };
    length: number;
  } | null = null;

  const centroid = computeCentroid(scenePts);

  for (let i = 0; i < scenePts.length; i++) {
    const a      = scenePts[i];
    const b      = scenePts[(i + 1) % scenePts.length];
    const dx     = b.x - a.x;
    const dz     = b.z - a.z;
    const length = Math.hypot(dx, dz);
    if (length < 2) continue;

    const midpoint = { x: (a.x + b.x) * 0.5, z: (a.z + b.z) * 0.5 };
    const nx  = -dz / length;
    const nz  =  dx / length;
    const dot = nx * (centroid.x - midpoint.x) + nz * (centroid.z - midpoint.z);
    const outward = dot > 0 ? { x: -nx, z: -nz } : { x: nx, z: nz };

    if (!best || length > best.length) {
      best = { a, b, midpoint, outward, length };
    }
  }

  return best;
}

function orientMeshToEdge(
  mesh: THREE.Object3D,
  a: { x: number; z: number },
  b: { x: number; z: number },
) {
  mesh.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
}

function normalized2D(v: { x: number; z: number }): { x: number; z: number } {
  const len = Math.hypot(v.x, v.z);
  if (len < 1e-6) return { x: 1, z: 0 };
  return { x: v.x / len, z: v.z / len };
}

function shapeFromScenePts(scenePts: Array<{ x: number; z: number }>): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(scenePts[0].x, scenePts[0].z);
  for (let i = 1; i < scenePts.length; i++) {
    shape.lineTo(scenePts[i].x, scenePts[i].z);
  }
  shape.closePath();
  return shape;
}

// ─────────────────────────────────────────────────────────────────────────────
// V9 — Utilitaires RNG déterministe
// ─────────────────────────────────────────────────────────────────────────────

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h  = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createRNG(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return (): number => {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    s  = s >>> 0;
    return s / 0x100000000;
  };
}