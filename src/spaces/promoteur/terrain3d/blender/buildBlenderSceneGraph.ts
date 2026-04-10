// src/spaces/promoteur/terrain3d/blender/buildBlenderSceneGraph.ts
// V3 — Ajout guards de dimension footprint + diagnostic logging.

import * as THREE from "three";
import type { Feature, MultiPolygon, Polygon } from "geojson";

import type { MassingBuildingModel } from "../massingScene.types";
import { totalHeightM } from "../massingScene.types";
import { computeSceneProjection, getBuildingScenePts } from "../massingGeometry";

import { ensureBuildingRenderSpec } from "../buildingBlenderSpec.helpers";
import { resolveBuildingRenderSpecSafe } from "../buildingRenderMapper";

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
// CONSTANTES
// ─────────────────────────────────────────────────────────────

const MAX_FOOTPRINT_M = 120;

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

export interface BuildBlenderSceneGraphInput {
  buildings: MassingBuildingModel[];
  parcel?: Feature<Polygon | MultiPolygon>;
  projectName?: string;
}

export interface BuildBlenderSceneGraphResult {
  scene: THREE.Scene;
  projection: ReturnType<typeof computeSceneProjection> | null;
}

// ─────────────────────────────────────────────────────────────
// API
// ─────────────────────────────────────────────────────────────

export function buildBlenderSceneGraph(
  input: BuildBlenderSceneGraphInput,
): BuildBlenderSceneGraphResult {
  const scene = new THREE.Scene();
  scene.name = sanitizeSceneName(input.projectName ?? "Mimmoza_Blender_Export");

  const allPts = collectAllGeoPoints(input.buildings, input.parcel);
  if (!allPts.length) {
    return { scene, projection: null };
  }

  const proj = computeSceneProjection(allPts);

  if (input.parcel) {
    const terrain = buildTerrainRoot(input.parcel, proj);
    if (terrain) scene.add(terrain);
  }

  for (const building of safeArray(input.buildings)) {
    if (building.visible === false) continue;

    const root = buildBuildingRoot(building, proj);
    if (root) scene.add(root);
  }

  scene.updateMatrixWorld(true);

  return { scene, projection: proj };
}

// ─────────────────────────────────────────────────────────────
// VALIDATION FOOTPRINT
// ─────────────────────────────────────────────────────────────

interface FootprintDimensions {
  width: number;
  depth: number;
  cx: number;
  cz: number;
  valid: boolean;
}

function measureFootprint(footprint: Array<[number, number]>): FootprintDimensions {
  if (!footprint.length) {
    return { width: 0, depth: 0, cx: 0, cz: 0, valid: false };
  }

  const xs = footprint.map(([x]) => x);
  const zs = footprint.map(([, z]) => z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);

  const width = maxX - minX;
  const depth = maxZ - minZ;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;

  const valid =
    width > 0.5 &&
    depth > 0.5 &&
    width <= MAX_FOOTPRINT_M &&
    depth <= MAX_FOOTPRINT_M;

  return { width, depth, cx, cz, valid };
}

// ─────────────────────────────────────────────────────────────
// TERRAIN
// ─────────────────────────────────────────────────────────────

function buildTerrainRoot(
  parcel: Feature<Polygon | MultiPolygon>,
  proj: ReturnType<typeof computeSceneProjection>,
): THREE.Group | null {
  const ring = getParcelOuterRing(parcel);
  if (!ring || ring.length < 3) return null;

  const pts = ring.map(([x, y]) => toScenePoint(x, y, proj));
  const shape = shapeFromScenePts(pts);

  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(Math.PI / 2);
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#b8b4ae"),
    roughness: 0.95,
    metalness: 0,
    side: THREE.DoubleSide,
  });

  const terrainRootName = makeTerrainRootName("main");
  const terrainMeshName = makeTerrainName("main");

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = terrainMeshName;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.userData.mmzType = "terrain";

  const root = new THREE.Group();
  root.name = terrainRootName;
  root.userData.objectKey = "terrain:main";
  root.userData.sourceId = "main";
  root.userData.mmzType = "terrainRoot";
  root.add(mesh);

  return root;
}

// ─────────────────────────────────────────────────────────────
// BUILDINGS
// ─────────────────────────────────────────────────────────────

function buildBuildingRoot(
  building: MassingBuildingModel,
  proj: ReturnType<typeof computeSceneProjection>,
): THREE.Group | null {
  const footprint = getBuildingScenePts(building, proj);
  if (!footprint || footprint.length < 3) return null;

  const dims = measureFootprint(footprint);

  console.log(
    `[MMZ][SceneGraph] Building "${building.id}" footprint: ` +
      `${dims.width.toFixed(1)}m × ${dims.depth.toFixed(1)}m ` +
      `centre=(${dims.cx.toFixed(1)}, ${dims.cz.toFixed(1)}) ` +
      `pts=${footprint.length}`,
  );

  if (!dims.valid) {
    console.error(
      `[MMZ][SceneGraph] ⛔ Footprint INVALIDE pour "${building.id}": ` +
        `${dims.width.toFixed(1)}m × ${dims.depth.toFixed(1)}m — ` +
        `MAX_FOOTPRINT_M=${MAX_FOOTPRINT_M}m. ` +
        `Probable cause: getBuildingScenePts retourne l'emprise parcelle. ` +
        `Bâtiment ignoré dans le GLTF.`,
    );
    return null;
  }

  const resolved = safeResolveBuilding(building);
  const shape = shapeFromScenePts(footprint.map(([x, z]) => ({ x, z })));

  const heightM = normalizeHeightM(totalHeightM(building.levels));
  const height = heightM * proj.zScale;

  const root = new THREE.Group();
  root.name = makeBuildingRootName(building.id);
  root.userData.objectKey = `building:${building.id}`;
  root.userData.sourceId = building.id;
  root.userData.mmzType = "buildingRoot";
  root.userData.footprintWidthM = dims.width;
  root.userData.footprintDepthM = dims.depth;
  root.userData.footprintCenterX = dims.cx;
  root.userData.footprintCenterZ = dims.cz;
  root.userData.totalHeightM = heightM;

  const structureMesh = buildStructureMesh(building.id, shape, height, resolved.structureColor);
  const roofMesh = buildRoofMesh(building.id, shape, height, resolved.roofColor);
  const facadeMesh = buildFacadeMesh(building.id, shape, height, resolved.facadeColor);
  const glazingMesh = buildGlazingMesh(building.id, footprint, height, resolved.glazingColor);

  root.add(structureMesh);
  root.add(roofMesh);
  root.add(facadeMesh);
  if (glazingMesh) root.add(glazingMesh);

  return root;
}

function buildStructureMesh(
  buildingId: string,
  shape: THREE.Shape,
  height: number,
  color: string,
): THREE.Mesh {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
    curveSegments: 1,
    steps: 1,
  });
  geo.rotateX(-Math.PI / 2);
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: 0.78,
    metalness: 0,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = makeStructureName(buildingId);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.mmzType = "structure";

  return mesh;
}

function buildRoofMesh(
  buildingId: string,
  shape: THREE.Shape,
  height: number,
  color: string,
): THREE.Mesh {
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(Math.PI / 2);
  geo.translate(0, height, 0);
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: 0.65,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = makeRoofName(buildingId);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.mmzType = "roof";

  return mesh;
}

function buildFacadeMesh(
  buildingId: string,
  shape: THREE.Shape,
  height: number,
  color: string,
): THREE.Mesh {
  const edgePts = getShapePointsClosed(shape);
  const positions: number[] = [];

  for (let i = 0; i < edgePts.length - 1; i++) {
    const a = edgePts[i];
    const b = edgePts[i + 1];
    pushQuad(
      positions,
      [a.x, 0, a.y],
      [b.x, 0, b.y],
      [b.x, height, b.y],
      [a.x, height, a.y],
    );
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: 0.82,
    metalness: 0,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = makeFacadeName(buildingId, 0);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.mmzType = "facade";

  return mesh;
}

function buildGlazingMesh(
  buildingId: string,
  footprint: Array<[number, number]>,
  height: number,
  color: string,
): THREE.Mesh | null {
  if (footprint.length < 2) return null;

  const positions: number[] = [];
  const sillY = height * 0.38;
  const headY = height * 0.72;
  const inset = 0.06;

  for (let i = 0; i < footprint.length; i++) {
    const j = (i + 1) % footprint.length;
    const [ax, az] = footprint[i];
    const [bx, bz] = footprint[j];

    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.001) continue;

    const ux = dx / len;
    const uz = dz / len;
    const nx = -uz * inset;
    const nz = ux * inset;
    const margin = Math.min(len * 0.18, 0.8);

    const x1 = ax + ux * margin + nx;
    const z1 = az + uz * margin + nz;
    const x2 = bx - ux * margin + nx;
    const z2 = bz - uz * margin + nz;

    if (Math.hypot(x2 - x1, z2 - z1) < 0.3) continue;

    pushQuad(
      positions,
      [x1, sillY, z1],
      [x2, sillY, z2],
      [x2, headY, z2],
      [x1, headY, z1],
    );
  }

  if (positions.length === 0) return null;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color),
    roughness: 0.08,
    metalness: 0.1,
    transparent: true,
    opacity: 0.68,
    transmission: 0.15,
    ior: 1.45,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = makeGlazingName(buildingId, 0);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.userData.mmzType = "glazing";

  return mesh;
}

// ─────────────────────────────────────────────────────────────
// COULEURS RÉSOLUES
// ─────────────────────────────────────────────────────────────

function safeResolveBuilding(building: MassingBuildingModel): {
  facadeColor: string;
  structureColor: string;
  roofColor: string;
  glazingColor: string;
} {
  try {
    const spec = ensureBuildingRenderSpec(building);
    const resolved = resolveBuildingRenderSpecSafe(spec);
    return {
      facadeColor: resolved.facade.baseColor || "#EDE8DA",
      structureColor: resolved.structure.structureColor || "#374151",
      roofColor: resolved.roof.color || "#C0BCBA",
      glazingColor: resolved.glazing.color || "#A0C0D0",
    };
  } catch {
    return {
      facadeColor: "#EDE8DA",
      structureColor: "#374151",
      roofColor: "#C0BCBA",
      glazingColor: "#A0C0D0",
    };
  }
}

// ─────────────────────────────────────────────────────────────
// GEO / SHAPES
// ─────────────────────────────────────────────────────────────

function collectAllGeoPoints(
  buildings: MassingBuildingModel[],
  parcel?: Feature<Polygon | MultiPolygon>,
): [number, number][] {
  const pts: [number, number][] = [];

  if (parcel) {
    const ring = getParcelOuterRing(parcel);
    if (ring?.length) pts.push(...ring);
  }

  for (const building of safeArray(buildings)) {
    const rawPts = (building?.footprint?.points ?? []) as [number, number][];
    if (rawPts.length) pts.push(...rawPts);
  }

  return pts;
}

function getParcelOuterRing(
  parcel: Feature<Polygon | MultiPolygon>,
): [number, number][] | null {
  const geom = parcel.geometry;
  if (!geom) return null;

  if (geom.type === "Polygon") return (geom.coordinates?.[0] as [number, number][]) ?? null;
  if (geom.type === "MultiPolygon") return (geom.coordinates?.[0]?.[0] as [number, number][]) ?? null;

  return null;
}

function toScenePoint(
  x: number,
  y: number,
  proj: ReturnType<typeof computeSceneProjection>,
): { x: number; z: number } {
  return {
    x: (x - proj.cx) * proj.scale,
    z: (y - proj.cy) * proj.scale,
  };
}

function shapeFromScenePts(pts: Array<{ x: number; z: number }>): THREE.Shape {
  const shape = new THREE.Shape();
  pts.forEach((p, i) => {
    if (i === 0) shape.moveTo(p.x, p.z);
    else shape.lineTo(p.x, p.z);
  });
  shape.closePath();
  return shape;
}

function getShapePointsClosed(shape: THREE.Shape): THREE.Vector2[] {
  const pts = shape.extractPoints(1).shape;
  if (pts.length < 2) return pts;

  const first = pts[0];
  const last = pts[pts.length - 1];

  if (Math.abs(first.x - last.x) > 1e-6 || Math.abs(first.y - last.y) > 1e-6) {
    return [...pts, first.clone()];
  }

  return pts;
}

function pushQuad(
  positions: number[],
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
  d: [number, number, number],
): void {
  positions.push(
    a[0], a[1], a[2],
    b[0], b[1], b[2],
    c[0], c[1], c[2],

    a[0], a[1], a[2],
    c[0], c[1], c[2],
    d[0], d[1], d[2],
  );
}

// ─────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────

function safeArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function normalizeHeightM(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 3;
}

function sanitizeSceneName(value: string): string {
  return value.replace(/[^\w\-]+/g, "_");
}