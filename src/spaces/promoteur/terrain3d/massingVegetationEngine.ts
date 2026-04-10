// massingVegetationEngine.ts — Procedural vegetation engine
// Trees (deciduous, conifer, palm), hedges, bushes, ground cover
// Simple geometry, premium look — no textures needed

import * as THREE from "three";
import type { Pt2D } from "./massingGeometry3d";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TreeType = "deciduous" | "conifer" | "palm" | "round" | "columnar";
export type VegetationType = "tree" | "hedge" | "bush" | "groundcover";

export interface VegetationItem {
  type: VegetationType;
  treeType?: TreeType;
  /** Position in scene coords */
  position: { x: number; z: number };
  /** Scale multiplier (1 = default) */
  scale?: number;
}

export interface HedgeItem {
  /** Start and end points of the hedge line */
  start: { x: number; z: number };
  end: { x: number; z: number };
  /** Hedge height (scene units) */
  height?: number;
  /** Hedge width/depth */
  width?: number;
}

export interface VegetationResult {
  group: THREE.Group;
}

// ─── Materials (shared) ───────────────────────────────────────────────────────

const LEAF_COLORS = [0x4A7C59, 0x5B8C4A, 0x3D6B4A, 0x6B8E4E, 0x528C3F];
const DARK_LEAF = 0x2D5A3A;
const TRUNK_COLOR = 0x6B5B4B;
const TRUNK_DARK = 0x4A3C2C;
const HEDGE_COLOR = 0x3B6B3B;
const BUSH_COLOR = 0x4A7848;
const GROUND_COLOR = 0x6B9B5A;

let _sharedMats: {
  leaf: THREE.MeshStandardMaterial[];
  trunk: THREE.MeshStandardMaterial;
  hedge: THREE.MeshStandardMaterial;
  bush: THREE.MeshStandardMaterial;
  ground: THREE.MeshStandardMaterial;
} | null = null;

function getSharedMaterials() {
  if (_sharedMats) return _sharedMats;
  _sharedMats = {
    leaf: LEAF_COLORS.map(c => new THREE.MeshStandardMaterial({
      color: c, roughness: 0.90, metalness: 0.0,
    })),
    trunk: new THREE.MeshStandardMaterial({
      color: TRUNK_COLOR, roughness: 0.92, metalness: 0.0,
    }),
    hedge: new THREE.MeshStandardMaterial({
      color: HEDGE_COLOR, roughness: 0.92, metalness: 0.0,
    }),
    bush: new THREE.MeshStandardMaterial({
      color: BUSH_COLOR, roughness: 0.90, metalness: 0.0,
    }),
    ground: new THREE.MeshStandardMaterial({
      color: GROUND_COLOR, roughness: 0.95, metalness: 0.0,
    }),
  };
  return _sharedMats;
}

// ─── Main builders ────────────────────────────────────────────────────────────

/**
 * Build a single tree at a given position.
 */
export function buildTree(
  x: number, z: number,
  type: TreeType = "deciduous",
  scale: number = 1,
): THREE.Group {
  const group = new THREE.Group();
  group.position.set(x, 0, z);

  const s = scale * (0.85 + Math.random() * 0.3); // natural variation
  const mats = getSharedMaterials();

  switch (type) {
    case "deciduous":
      buildDeciduousTree(group, s, mats);
      break;
    case "conifer":
      buildConiferTree(group, s, mats);
      break;
    case "palm":
      buildPalmTree(group, s, mats);
      break;
    case "round":
      buildRoundTree(group, s, mats);
      break;
    case "columnar":
      buildColumnarTree(group, s, mats);
      break;
  }

  group.castShadow = true;
  return group;
}

/**
 * Build a hedge between two points.
 */
export function buildHedge(item: HedgeItem): THREE.Group {
  const group = new THREE.Group();
  const mats = getSharedMaterials();

  const dx = item.end.x - item.start.x;
  const dz = item.end.z - item.start.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.1) return group;

  const h = item.height ?? 1.2;
  const w = item.width ?? 0.6;

  // Build a box aligned along the edge using matrix
  const startV = new THREE.Vector3(item.start.x, 0, item.start.z);
  const endV = new THREE.Vector3(item.end.x, 0, item.end.z);
  const dir = endV.clone().sub(startV).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3().crossVectors(up, dir).normalize();

  const geo = new THREE.BoxGeometry(len, h, w);
  const mid = startV.clone().add(endV).multiplyScalar(0.5);
  mid.y = h / 2;

  const mat4 = new THREE.Matrix4().makeBasis(dir, up, side);
  mat4.setPosition(mid);
  geo.applyMatrix4(mat4);

  const mesh = new THREE.Mesh(geo, mats.hedge);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  // Organic bumps on top
  const numBumps = Math.max(2, Math.ceil(len / (w * 1.5)));
  for (let i = 0; i < numBumps; i++) {
    const t = (i + 0.5) / numBumps;
    const bx = item.start.x + dx * t;
    const bz = item.start.z + dz * t;
    const bumpR = w * 0.4 * (0.8 + Math.random() * 0.4);
    const bumpGeo = new THREE.SphereGeometry(bumpR, 6, 5);
    bumpGeo.translate(bx, h + bumpR * 0.2, bz);
    const bumpMesh = new THREE.Mesh(bumpGeo, mats.hedge);
    bumpMesh.castShadow = true;
    group.add(bumpMesh);
  }

  return group;
}

/**
 * Build a bush at a position.
 */
export function buildBush(x: number, z: number, scale: number = 1): THREE.Group {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  const mats = getSharedMaterials();

  const s = scale * (0.7 + Math.random() * 0.6);
  const r = 0.5 * s;

  // Main sphere
  const mainGeo = new THREE.SphereGeometry(r, 7, 6);
  mainGeo.translate(0, r * 0.8, 0);
  const main = new THREE.Mesh(mainGeo, mats.bush);
  main.castShadow = true;
  group.add(main);

  // 2-3 extra lobes
  const lobes = 2 + Math.floor(Math.random() * 2);
  for (let i = 0; i < lobes; i++) {
    const angle = (i / lobes) * Math.PI * 2 + Math.random() * 0.5;
    const lr = r * (0.5 + Math.random() * 0.3);
    const lGeo = new THREE.SphereGeometry(lr, 6, 5);
    lGeo.translate(
      Math.cos(angle) * r * 0.6,
      lr * 0.7 + Math.random() * r * 0.3,
      Math.sin(angle) * r * 0.6,
    );
    const lMesh = new THREE.Mesh(lGeo, randomLeafMat(mats));
    lMesh.castShadow = true;
    group.add(lMesh);
  }

  return group;
}

/**
 * Build hedges around a polygon (parcel outline).
 */
export function buildHedgesAroundPolygon(
  pts: Pt2D[],
  height?: number,
  width?: number,
  gapIndices?: number[], // edge indices to skip (for entrances)
): THREE.Group {
  const group = new THREE.Group();
  group.name = "parcel_hedges";

  for (let i = 0; i < pts.length; i++) {
    if (gapIndices && gapIndices.includes(i)) continue;
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const hedge = buildHedge({
      start: { x: a.x, z: a.y },
      end: { x: b.x, z: b.y },
      height,
      width,
    });
    group.add(hedge);
  }

  return group;
}

/**
 * Scatter trees along a polygon perimeter with spacing.
 */
export function scatterTreesAlongPolygon(
  pts: Pt2D[],
  spacing: number = 8,
  treeType: TreeType = "deciduous",
  scale: number = 1,
  inset: number = 2, // distance inside from edge
): THREE.Group {
  const group = new THREE.Group();
  group.name = "perimeter_trees";

  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < spacing * 0.5) continue;

    // Normal (inward)
    const nx = -dy / len;
    const ny = dx / len;

    const numTrees = Math.floor(len / spacing);
    for (let t = 0; t < numTrees; t++) {
      const frac = (t + 0.5) / numTrees;
      const px = a.x + dx * frac + nx * inset;
      const pz = a.y + dy * frac + ny * inset;
      group.add(buildTree(px, pz, treeType, scale));
    }
  }

  return group;
}

// ─── Tree builders ────────────────────────────────────────────────────────────

function buildDeciduousTree(group: THREE.Group, s: number, mats: ReturnType<typeof getSharedMaterials>): void {
  // Trunk
  const trunkH = 2.5 * s;
  const trunkR = 0.12 * s;
  const trunkGeo = new THREE.CylinderGeometry(trunkR * 0.7, trunkR, trunkH, 6);
  trunkGeo.translate(0, trunkH / 2, 0);
  const trunk = new THREE.Mesh(trunkGeo, mats.trunk);
  trunk.castShadow = true;
  group.add(trunk);

  // Crown: 2-3 overlapping spheres
  const crownBase = trunkH * 0.7;
  const crownR = 1.8 * s;
  const numSpheres = 3;
  for (let i = 0; i < numSpheres; i++) {
    const angle = (i / numSpheres) * Math.PI * 2;
    const r = crownR * (0.7 + Math.random() * 0.3);
    const ox = Math.cos(angle) * crownR * 0.25;
    const oz = Math.sin(angle) * crownR * 0.25;
    const oy = crownBase + crownR * 0.3 + i * crownR * 0.15;
    const geo = new THREE.SphereGeometry(r, 8, 7);
    geo.translate(ox, oy, oz);
    const mesh = new THREE.Mesh(geo, randomLeafMat(mats));
    mesh.castShadow = true;
    group.add(mesh);
  }
}

function buildRoundTree(group: THREE.Group, s: number, mats: ReturnType<typeof getSharedMaterials>): void {
  // Trunk
  const trunkH = 1.8 * s;
  const trunkR = 0.10 * s;
  const trunkGeo = new THREE.CylinderGeometry(trunkR * 0.6, trunkR, trunkH, 6);
  trunkGeo.translate(0, trunkH / 2, 0);
  group.add(new THREE.Mesh(trunkGeo, mats.trunk));

  // Single large sphere crown
  const crownR = 1.5 * s;
  const crownGeo = new THREE.SphereGeometry(crownR, 10, 8);
  crownGeo.translate(0, trunkH + crownR * 0.6, 0);
  const crown = new THREE.Mesh(crownGeo, randomLeafMat(mats));
  crown.castShadow = true;
  group.add(crown);
}

function buildConiferTree(group: THREE.Group, s: number, mats: ReturnType<typeof getSharedMaterials>): void {
  // Trunk
  const trunkH = 3.5 * s;
  const trunkR = 0.10 * s;
  const trunkGeo = new THREE.CylinderGeometry(trunkR * 0.5, trunkR, trunkH, 6);
  trunkGeo.translate(0, trunkH / 2, 0);
  group.add(new THREE.Mesh(trunkGeo, mats.trunk));

  // Stacked cones
  const coneBase = trunkH * 0.3;
  const layers = 3;
  for (let i = 0; i < layers; i++) {
    const t = i / layers;
    const coneR = (1.3 - t * 0.6) * s;
    const coneH = (1.5 - t * 0.3) * s;
    const y = coneBase + i * coneH * 0.65;
    const geo = new THREE.ConeGeometry(coneR, coneH, 8);
    geo.translate(0, y + coneH / 2, 0);
    const darkMat = new THREE.MeshStandardMaterial({
      color: DARK_LEAF, roughness: 0.92, metalness: 0,
    });
    const mesh = new THREE.Mesh(geo, i === 0 ? darkMat : randomLeafMat(mats));
    mesh.castShadow = true;
    group.add(mesh);
  }
}

function buildColumnarTree(group: THREE.Group, s: number, mats: ReturnType<typeof getSharedMaterials>): void {
  // Trunk
  const trunkH = 2.0 * s;
  const trunkR = 0.08 * s;
  const trunkGeo = new THREE.CylinderGeometry(trunkR, trunkR, trunkH, 6);
  trunkGeo.translate(0, trunkH / 2, 0);
  group.add(new THREE.Mesh(trunkGeo, mats.trunk));

  // Tall narrow crown (cypress-like)
  const crownH = 4.0 * s;
  const crownR = 0.6 * s;
  const crownGeo = new THREE.CylinderGeometry(crownR * 0.3, crownR, crownH, 8);
  crownGeo.translate(0, trunkH + crownH / 2, 0);
  const crown = new THREE.Mesh(crownGeo, new THREE.MeshStandardMaterial({
    color: DARK_LEAF, roughness: 0.90, metalness: 0,
  }));
  crown.castShadow = true;
  group.add(crown);
}

function buildPalmTree(group: THREE.Group, s: number, mats: ReturnType<typeof getSharedMaterials>): void {
  // Trunk: slightly curved cylinder
  const trunkH = 4.5 * s;
  const trunkR = 0.15 * s;
  const trunkGeo = new THREE.CylinderGeometry(trunkR * 0.6, trunkR, trunkH, 6);
  trunkGeo.translate(0, trunkH / 2, 0);
  const trunkMat = new THREE.MeshStandardMaterial({
    color: TRUNK_DARK, roughness: 0.95, metalness: 0,
  });
  group.add(new THREE.Mesh(trunkGeo, trunkMat));

  // Crown: flat discs (simplified palm fronds)
  const numFronds = 6;
  for (let i = 0; i < numFronds; i++) {
    const angle = (i / numFronds) * Math.PI * 2;
    const frondLen = 2.0 * s;
    const frondW = 0.4 * s;
    const geo = new THREE.PlaneGeometry(frondLen, frondW);
    geo.translate(frondLen / 2, 0, 0);
    const mesh = new THREE.Mesh(geo, randomLeafMat(mats));
    mesh.position.set(0, trunkH, 0);
    mesh.rotation.y = angle;
    mesh.rotation.z = -0.5; // droop down
    mesh.castShadow = true;
    group.add(mesh);
  }

  // Coconut cluster
  const coconutGeo = new THREE.SphereGeometry(0.15 * s, 5, 4);
  coconutGeo.translate(0, trunkH - 0.1 * s, 0);
  group.add(new THREE.Mesh(coconutGeo, trunkMat));
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function randomLeafMat(mats: ReturnType<typeof getSharedMaterials>): THREE.MeshStandardMaterial {
  return mats.leaf[Math.floor(Math.random() * mats.leaf.length)];
}