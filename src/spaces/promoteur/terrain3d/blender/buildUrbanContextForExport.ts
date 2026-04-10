// buildUrbanContextForExport.ts
// ═══════════════════════════════════════════════════════════════════════════════
// V10 — CONTEXTE URBAIN CRÉDIBLE
//
// Nouveau fichier, additionnel à buildFacadeForExport.ts.
// Génère l'environnement autour du bâtiment pour un rendu promoteur plausible.
//
// Mesh groups produits :
//   site_road            — chaussée asphaltée
//   site_sidewalk        — trottoir béton
//   site_curb            — bordure de trottoir
//   site_wall            — muret de clôture parcelle
//   site_gate            — portail d'entrée véhicule
//   site_path            — cheminement piéton parcelle → trottoir
//   site_parking         — aire de stationnement + marquage discret
//   urban_context_mass   — bâti voisin low-detail (masses sobres)
//   site_tree            — arbres en alignement le long de la rue
//   site_hedge           — haies basses sur les autres limites
//
// Intégration :
//   const facadeGroups = buildFacadeMeshGroupsForExport({ building, scenePts, prefix, platformY });
//   const urbanGroups  = buildUrbanContextMeshGroups({ building, scenePts, prefix, platformY });
//   const allGroups    = [...facadeGroups, ...urbanGroups];
//   // → passer allGroups à l'orchestrateur existant (exportEnrichedGltf.ts)
//
// Compatibilité :
//   collectCategories() et collectMeshGroupNames() sont dynamiques → aucune
//   modification de buildRenderSpecV3.ts nécessaire. Les catégories V10 sont
//   récupérées automatiquement.
// ═══════════════════════════════════════════════════════════════════════════════

import * as THREE from 'three';
import { computeCentroid } from '../massingFacadeStyles';
import type { MassingBuildingModel } from '../massingScene.types';
import { hashString, createRNG } from './buildFacadeForExport';
import type { ExportMeshGroup } from './buildFacadeForExport';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface UrbanContextInput {
  building: MassingBuildingModel;
  scenePts: Array<{ x: number; z: number }>;
  prefix: string;
  platformY?: number;
  /** Largeur de la chaussée en mètres (défaut : 8.0) */
  roadWidth?: number;
  /** Largeur du trottoir en mètres (défaut : 2.6) */
  sidewalkWidth?: number;
}

interface EdgeInfo {
  a: { x: number; z: number };
  b: { x: number; z: number };
  midpoint: { x: number; z: number };
  outward: { x: number; z: number };
  tangent: { x: number; z: number };
  length: number;
  edgeIndex: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Matériaux urbains
// ─────────────────────────────────────────────────────────────────────────────

const URBAN_MATERIALS: Record<string, {
  color: string;
  roughness: number;
  metallic: number;
}> = {
  site_road: {
    color: '#252523',
    roughness: 0.94,
    metallic: 0.0,
  },
  site_sidewalk: {
    color: '#C2BCB0',
    roughness: 0.88,
    metallic: 0.0,
  },
  site_curb: {
    color: '#9A9690',
    roughness: 0.85,
    metallic: 0.0,
  },
  site_wall: {
    color: '#B6B0A4',
    roughness: 0.87,
    metallic: 0.0,
  },
  site_gate: {
    color: '#363636',
    roughness: 0.44,
    metallic: 0.62,
  },
  site_path: {
    color: '#CEC8B8',
    roughness: 0.84,
    metallic: 0.0,
  },
  site_parking: {
    color: '#2C2C2A',
    roughness: 0.91,
    metallic: 0.0,
  },
  urban_context_mass: {
    color: '#C6C2BC',
    roughness: 0.82,
    metallic: 0.0,
  },
  site_tree: {
    color: '#3B5C2D',
    roughness: 0.92,
    metallic: 0.0,
  },
  site_hedge: {
    color: '#2D4924',
    roughness: 0.93,
    metallic: 0.0,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Point d'entrée principal
// ─────────────────────────────────────────────────────────────────────────────

export function buildUrbanContextMeshGroups(input: UrbanContextInput): ExportMeshGroup[] {
  const {
    building,
    scenePts,
    prefix,
    platformY = 0,
    roadWidth = 8.0,
    sidewalkWidth = 2.6,
  } = input;

  if (!scenePts || scenePts.length < 3) return [];

  const primaryEdge = findPrimaryStreetEdge(scenePts);
  if (!primaryEdge) return [];

  const buildingId = (building as any)?.id ?? (building as any)?.uuid ?? prefix;
  const seed = hashString(buildingId);

  const groups: ExportMeshGroup[] = [];

  // ── 1. Rue ────────────────────────────────────────────────────────────────
  const roadGroup = buildRoadGroup({
    primaryEdge, prefix, baseY: platformY, roadWidth, sidewalkWidth,
  });
  if (roadGroup) groups.push(roadGroup);

  // ── 2. Trottoir ───────────────────────────────────────────────────────────
  const sidewalkGroup = buildSidewalkGroup({
    primaryEdge, prefix, baseY: platformY, sidewalkWidth,
  });
  if (sidewalkGroup) groups.push(sidewalkGroup);

  // ── 3. Bordure ────────────────────────────────────────────────────────────
  const curbGroup = buildCurbGroup({
    primaryEdge, prefix, baseY: platformY, sidewalkWidth,
  });
  if (curbGroup) groups.push(curbGroup);

  // ── 4. Murets de clôture (arêtes secondaires) ─────────────────────────────
  const wallGroup = buildParcelWallGroup({
    scenePts, primaryEdge, prefix, baseY: platformY,
  });
  if (wallGroup) groups.push(wallGroup);

  // ── 5. Portail ────────────────────────────────────────────────────────────
  const gateGroup = buildGateGroup({
    primaryEdge, prefix, baseY: platformY,
  });
  if (gateGroup) groups.push(gateGroup);

  // ── 6. Cheminement piéton ─────────────────────────────────────────────────
  const pathGroup = buildPedestrianPathGroup({
    primaryEdge, prefix, baseY: platformY, sidewalkWidth,
  });
  if (pathGroup) groups.push(pathGroup);

  // ── 7. Stationnement ──────────────────────────────────────────────────────
  const parkingGroup = buildParkingGroup({
    scenePts, primaryEdge, prefix, baseY: platformY,
    rng: createRNG(seed ^ 0x9A4B1C),
  });
  if (parkingGroup) groups.push(parkingGroup);

  // ── 8. Masses voisines ────────────────────────────────────────────────────
  const contextGroup = buildUrbanContextMassesGroup({
    primaryEdge, prefix, baseY: platformY, roadWidth, sidewalkWidth,
    rng: createRNG(seed ^ 0xB3C0FF),
  });
  if (contextGroup) groups.push(contextGroup);

  // ── 9. Arbres en alignement ───────────────────────────────────────────────
  const treesGroup = buildStreetTreesGroup({
    primaryEdge, prefix, baseY: platformY, sidewalkWidth,
    rng: createRNG(seed ^ 0xD7E502),
  });
  if (treesGroup) groups.push(treesGroup);

  // ── 10. Haies ────────────────────────────────────────────────────────────
  const hedgeGroup = buildHedgeGroup({
    scenePts, primaryEdge, prefix, baseY: platformY,
  });
  if (hedgeGroup) groups.push(hedgeGroup);

  console.log(
    `[MMZ][buildUrbanContextForExport][V10] prefix=${prefix} ` +
    `road=${roadGroup ? 'on' : 'off'} ` +
    `sidewalk=${sidewalkGroup ? 'on' : 'off'} ` +
    `curb=${curbGroup ? 'on' : 'off'} ` +
    `wall=${wallGroup ? 'on' : 'off'} ` +
    `gate=${gateGroup ? 'on' : 'off'} ` +
    `path=${pathGroup ? 'on' : 'off'} ` +
    `parking=${parkingGroup ? 'on' : 'off'} ` +
    `context=${contextGroup ? 'on' : 'off'} ` +
    `trees=${treesGroup ? 'on' : 'off'} ` +
    `hedge=${hedgeGroup ? 'on' : 'off'} ` +
    `seed=${seed.toString(16)}`
  );

  return groups;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. RUE
// ─────────────────────────────────────────────────────────────────────────────

function buildRoadGroup(params: {
  primaryEdge: EdgeInfo;
  prefix: string;
  baseY: number;
  roadWidth: number;
  sidewalkWidth: number;
}): ExportMeshGroup | null {
  const { primaryEdge, prefix, baseY, roadWidth, sidewalkWidth } = params;

  // La chaussée commence au bord extérieur du trottoir
  const centerOffset = sidewalkWidth + roadWidth * 0.5;
  const roadThickness = 0.06;
  const overflow = 7.0; // débord de chaque côté de l'arête

  const cx = primaryEdge.midpoint.x + primaryEdge.outward.x * centerOffset;
  const cz = primaryEdge.midpoint.z + primaryEdge.outward.z * centerOffset;
  const roadLen = primaryEdge.length + 2 * overflow;

  const geo = new THREE.BoxGeometry(roadLen, roadThickness, roadWidth);
  const tmp = new THREE.Mesh(geo);
  tmp.position.set(cx, baseY - roadThickness * 0.5, cz);
  orientMeshToEdge(tmp, primaryEdge.a, primaryEdge.b);
  tmp.updateMatrixWorld(true);

  const finalGeo = toNonIndexed(geo).applyMatrix4(tmp.matrixWorld);
  finalGeo.computeVertexNormals();
  finalGeo.computeBoundingSphere();

  const mesh = new THREE.Mesh(finalGeo, makeMaterial('site_road'));
  mesh.name = `${prefix}_SITE_ROAD_00`;
  mesh.userData = { mmzType: 'site_road' };
  mesh.receiveShadow = true;

  return { name: mesh.name, mesh, category: 'site_road' };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. TROTTOIR
// ─────────────────────────────────────────────────────────────────────────────

function buildSidewalkGroup(params: {
  primaryEdge: EdgeInfo;
  prefix: string;
  baseY: number;
  sidewalkWidth: number;
}): ExportMeshGroup | null {
  const { primaryEdge, prefix, baseY, sidewalkWidth } = params;

  const sidewalkThickness = 0.10;
  const sidewalkElevation = 0.06; // trottoir légèrement surélevé
  const overflow = 1.5;

  const centerOffset = sidewalkWidth * 0.5;
  const cx = primaryEdge.midpoint.x + primaryEdge.outward.x * centerOffset;
  const cz = primaryEdge.midpoint.z + primaryEdge.outward.z * centerOffset;
  const swLen = primaryEdge.length + 2 * overflow;

  const geo = new THREE.BoxGeometry(swLen, sidewalkThickness, sidewalkWidth);
  const tmp = new THREE.Mesh(geo);
  tmp.position.set(cx, baseY + sidewalkElevation - sidewalkThickness * 0.5, cz);
  orientMeshToEdge(tmp, primaryEdge.a, primaryEdge.b);
  tmp.updateMatrixWorld(true);

  const finalGeo = toNonIndexed(geo).applyMatrix4(tmp.matrixWorld);
  finalGeo.computeVertexNormals();
  finalGeo.computeBoundingSphere();

  const mesh = new THREE.Mesh(finalGeo, makeMaterial('site_sidewalk'));
  mesh.name = `${prefix}_SITE_SIDEWALK_00`;
  mesh.userData = { mmzType: 'site_sidewalk' };
  mesh.receiveShadow = true;

  return { name: mesh.name, mesh, category: 'site_sidewalk' };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. BORDURE DE TROTTOIR
// ─────────────────────────────────────────────────────────────────────────────

function buildCurbGroup(params: {
  primaryEdge: EdgeInfo;
  prefix: string;
  baseY: number;
  sidewalkWidth: number;
}): ExportMeshGroup | null {
  const { primaryEdge, prefix, baseY, sidewalkWidth } = params;

  const curbH = 0.14;
  const curbW = 0.22;
  const overflow = 1.5;

  // Bordure au bord extérieur du trottoir
  const offset = sidewalkWidth - curbW * 0.5;
  const cx = primaryEdge.midpoint.x + primaryEdge.outward.x * offset;
  const cz = primaryEdge.midpoint.z + primaryEdge.outward.z * offset;
  const curbLen = primaryEdge.length + 2 * overflow;

  const geo = new THREE.BoxGeometry(curbLen, curbH, curbW);
  const tmp = new THREE.Mesh(geo);
  tmp.position.set(cx, baseY + curbH * 0.5, cz);
  orientMeshToEdge(tmp, primaryEdge.a, primaryEdge.b);
  tmp.updateMatrixWorld(true);

  const finalGeo = toNonIndexed(geo).applyMatrix4(tmp.matrixWorld);
  finalGeo.computeVertexNormals();
  finalGeo.computeBoundingSphere();

  const mesh = new THREE.Mesh(finalGeo, makeMaterial('site_curb'));
  mesh.name = `${prefix}_SITE_CURB_00`;
  mesh.userData = { mmzType: 'site_curb' };
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  return { name: mesh.name, mesh, category: 'site_curb' };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. MURETS DE CLÔTURE (arêtes secondaires)
// ─────────────────────────────────────────────────────────────────────────────

function buildParcelWallGroup(params: {
  scenePts: Array<{ x: number; z: number }>;
  primaryEdge: EdgeInfo;
  prefix: string;
  baseY: number;
}): ExportMeshGroup | null {
  const { scenePts, primaryEdge, prefix, baseY } = params;

  const wallH = 0.90;
  const wallT = 0.18;
  const centroid = computeCentroid(scenePts);
  const geometries: THREE.BufferGeometry[] = [];

  for (let i = 0; i < scenePts.length; i++) {
    if (i === primaryEdge.edgeIndex) continue; // pas de muret côté rue

    const a = scenePts[i];
    const b = scenePts[(i + 1) % scenePts.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1.0) continue;

    const midpoint = { x: (a.x + b.x) * 0.5, z: (a.z + b.z) * 0.5 };
    const outward = computeEdgeOutward(a, b, centroid);

    // Le muret est posé sur le bord de la parcelle, côté extérieur
    const wallOffsetOutward = wallT * 0.5;
    const geo = new THREE.BoxGeometry(len, wallH, wallT);
    const tmp = new THREE.Mesh(geo);
    tmp.position.set(
      midpoint.x + outward.x * wallOffsetOutward,
      baseY + wallH * 0.5,
      midpoint.z + outward.z * wallOffsetOutward,
    );
    orientMeshToEdge(tmp, a, b);
    tmp.updateMatrixWorld(true);

    geometries.push(toNonIndexed(geo).applyMatrix4(tmp.matrixWorld));
  }

  if (geometries.length === 0) return null;

  const merged = mergeGeometries(geometries);
  merged.computeVertexNormals();
  merged.computeBoundingSphere();

  const mesh = new THREE.Mesh(merged, makeMaterial('site_wall'));
  mesh.name = `${prefix}_SITE_WALL_00`;
  mesh.userData = { mmzType: 'site_wall' };
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  return { name: mesh.name, mesh, category: 'site_wall' };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. PORTAIL
// ─────────────────────────────────────────────────────────────────────────────

function buildGateGroup(params: {
  primaryEdge: EdgeInfo;
  prefix: string;
  baseY: number;
}): ExportMeshGroup | null {
  const { primaryEdge, prefix, baseY } = params;

  if (primaryEdge.length < 8) return null;

  const gateW = 3.8;       // largeur du portail
  const gateH = 2.0;       // hauteur
  const gateT = 0.06;      // épaisseur de la grille
  const postW = 0.20;      // largeur des poteaux
  const postH = 2.3;

  const geometries: THREE.BufferGeometry[] = [];

  // Position du portail : légèrement à gauche du centre (offset esthétique)
  const offset = primaryEdge.length * 0.12;
  const gx = primaryEdge.midpoint.x
    + primaryEdge.tangent.x * offset
    + primaryEdge.outward.x * 0.02;
  const gz = primaryEdge.midpoint.z
    + primaryEdge.tangent.z * offset
    + primaryEdge.outward.z * 0.02;

  // Vantail
  const panelGeo = new THREE.BoxGeometry(gateW, gateH, gateT);
  const panelMesh = new THREE.Mesh(panelGeo);
  panelMesh.position.set(gx, baseY + gateH * 0.5, gz);
  orientMeshToEdge(panelMesh, primaryEdge.a, primaryEdge.b);
  panelMesh.updateMatrixWorld(true);
  geometries.push(toNonIndexed(panelGeo).applyMatrix4(panelMesh.matrixWorld));

  // Poteaux gauche + droit
  for (const side of [-1, 1]) {
    const postGeo = new THREE.BoxGeometry(postW, postH, postW);
    const postMesh = new THREE.Mesh(postGeo);
    postMesh.position.set(
      gx + primaryEdge.tangent.x * side * (gateW * 0.5 + postW * 0.5),
      baseY + postH * 0.5,
      gz + primaryEdge.tangent.z * side * (gateW * 0.5 + postW * 0.5),
    );
    orientMeshToEdge(postMesh, primaryEdge.a, primaryEdge.b);
    postMesh.updateMatrixWorld(true);
    geometries.push(toNonIndexed(postGeo).applyMatrix4(postMesh.matrixWorld));
  }

  const merged = mergeGeometries(geometries);
  merged.computeVertexNormals();
  merged.computeBoundingSphere();

  const mesh = new THREE.Mesh(merged, makeMaterial('site_gate'));
  mesh.name = `${prefix}_SITE_GATE_00`;
  mesh.userData = { mmzType: 'site_gate' };
  mesh.castShadow = true;

  return { name: mesh.name, mesh, category: 'site_gate' };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. CHEMINEMENT PIÉTON
// ─────────────────────────────────────────────────────────────────────────────

function buildPedestrianPathGroup(params: {
  primaryEdge: EdgeInfo;
  prefix: string;
  baseY: number;
  sidewalkWidth: number;
}): ExportMeshGroup | null {
  const { primaryEdge, prefix, baseY, sidewalkWidth } = params;

  const pathW = 1.80;
  const pathT = 0.06;
  // Le chemin va du bâtiment (offset 0) jusqu'au bord intérieur du trottoir
  const pathLen = sidewalkWidth;

  const geometries: THREE.BufferGeometry[] = [];

  // Axe principal : centre de l'arête → trottoir
  const pathGeo = new THREE.BoxGeometry(pathW, pathT, pathLen);
  const pathMesh = new THREE.Mesh(pathGeo);
  pathMesh.position.set(
    primaryEdge.midpoint.x + primaryEdge.outward.x * (pathLen * 0.5),
    baseY + pathT * 0.5 + 0.01,
    primaryEdge.midpoint.z + primaryEdge.outward.z * (pathLen * 0.5),
  );
  orientMeshToEdge(pathMesh, primaryEdge.a, primaryEdge.b);
  pathMesh.updateMatrixWorld(true);
  geometries.push(toNonIndexed(pathGeo).applyMatrix4(pathMesh.matrixWorld));

  // Parvis léger devant l'entrée
  const parvisW = pathW * 2.2;
  const parvisD = 1.4;
  const parvisGeo = new THREE.BoxGeometry(parvisW, pathT, parvisD);
  const parvisMesh = new THREE.Mesh(parvisGeo);
  parvisMesh.position.set(
    primaryEdge.midpoint.x + primaryEdge.outward.x * (parvisD * 0.5),
    baseY + pathT * 0.5 + 0.01,
    primaryEdge.midpoint.z + primaryEdge.outward.z * (parvisD * 0.5),
  );
  orientMeshToEdge(parvisMesh, primaryEdge.a, primaryEdge.b);
  parvisMesh.updateMatrixWorld(true);
  geometries.push(toNonIndexed(parvisGeo).applyMatrix4(parvisMesh.matrixWorld));

  const merged = mergeGeometries(geometries);
  merged.computeVertexNormals();
  merged.computeBoundingSphere();

  const mesh = new THREE.Mesh(merged, makeMaterial('site_path'));
  mesh.name = `${prefix}_SITE_PATH_00`;
  mesh.userData = { mmzType: 'site_path' };
  mesh.receiveShadow = true;

  return { name: mesh.name, mesh, category: 'site_path' };
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. STATIONNEMENT
// ─────────────────────────────────────────────────────────────────────────────

function buildParkingGroup(params: {
  scenePts: Array<{ x: number; z: number }>;
  primaryEdge: EdgeInfo;
  prefix: string;
  baseY: number;
  rng: () => number;
}): ExportMeshGroup | null {
  const { scenePts, primaryEdge, prefix, baseY, rng } = params;

  // On place le parking sur l'arête opposée à la rue
  // Heuristique : arête la plus éloignée du centroïde côté rue
  const centroid = computeCentroid(scenePts);
  let parkingEdge: EdgeInfo | null = null;
  let maxDot = -Infinity;

  for (let i = 0; i < scenePts.length; i++) {
    if (i === primaryEdge.edgeIndex) continue;
    const a = scenePts[i];
    const b = scenePts[(i + 1) % scenePts.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 5) continue;

    const mid = { x: (a.x + b.x) * 0.5, z: (a.z + b.z) * 0.5 };
    const outward = computeEdgeOutward(a, b, centroid);
    // On cherche l'arête dont la normale pointe le plus vers l'opposé de la rue
    const dot = -(outward.x * primaryEdge.outward.x + outward.z * primaryEdge.outward.z);
    if (dot > maxDot) {
      maxDot = dot;
      parkingEdge = {
        a, b,
        midpoint: mid,
        outward,
        tangent: { x: dx / len, z: dz / len },
        length: len,
        edgeIndex: i,
      };
    }
  }

  if (!parkingEdge) return null;

  const spaceW = 2.60;
  const spaceD = 5.20;
  const slabT = 0.05;
  const markT = 0.02;
  const edgeOffset = spaceD * 0.5 + 0.4;

  const numSpaces = Math.max(2, Math.min(8, Math.floor(parkingEdge.length / spaceW)));
  const totalParkW = numSpaces * spaceW;
  const startT = (parkingEdge.length - totalParkW) * 0.5;

  const geometries: THREE.BufferGeometry[] = [];

  // Dalle générale
  const slabGeo = new THREE.BoxGeometry(totalParkW, slabT, spaceD);
  const slabMesh = new THREE.Mesh(slabGeo);
  slabMesh.position.set(
    parkingEdge.midpoint.x + parkingEdge.outward.x * edgeOffset,
    baseY - slabT * 0.5,
    parkingEdge.midpoint.z + parkingEdge.outward.z * edgeOffset,
  );
  orientMeshToEdge(slabMesh, parkingEdge.a, parkingEdge.b);
  slabMesh.updateMatrixWorld(true);
  geometries.push(toNonIndexed(slabGeo).applyMatrix4(slabMesh.matrixWorld));

  // Marquage : lignes de délimitation entre les places
  for (let s = 0; s <= numSpaces; s++) {
    const markGeo = new THREE.BoxGeometry(0.10, markT, spaceD);
    const markMesh = new THREE.Mesh(markGeo);
    const tOff = startT + s * spaceW - parkingEdge.length * 0.5;
    markMesh.position.set(
      parkingEdge.midpoint.x
        + parkingEdge.tangent.x * tOff
        + parkingEdge.outward.x * edgeOffset,
      baseY + markT * 0.5,
      parkingEdge.midpoint.z
        + parkingEdge.tangent.z * tOff
        + parkingEdge.outward.z * edgeOffset,
    );
    orientMeshToEdge(markMesh, parkingEdge.a, parkingEdge.b);
    markMesh.updateMatrixWorld(true);
    geometries.push(toNonIndexed(markGeo).applyMatrix4(markMesh.matrixWorld));
  }

  // Consommation RNG pour variation future (stable)
  void rng();

  const merged = mergeGeometries(geometries);
  merged.computeVertexNormals();
  merged.computeBoundingSphere();

  const mesh = new THREE.Mesh(merged, makeMaterial('site_parking'));
  mesh.name = `${prefix}_SITE_PARKING_00`;
  mesh.userData = { mmzType: 'site_parking', spaces: numSpaces };
  mesh.receiveShadow = true;

  return { name: mesh.name, mesh, category: 'site_parking' };
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. MASSES VOISINES (bâti low-detail)
// ─────────────────────────────────────────────────────────────────────────────
//
// Génère 4 masses :
//   [0] Voisin gauche (même îlot, arête gauche de la façade rue)
//   [1] Voisin droit  (même îlot, arête droite de la façade rue)
//   [2] Masse en face (de l'autre côté de la rue, côté gauche)
//   [3] Masse en face (de l'autre côté de la rue, côté droit)
//
// Toutes les masses sont sobres, légèrement plus petites ou plus grandes
// que le bâtiment projet, et sans aucun détail de façade.
// ─────────────────────────────────────────────────────────────────────────────

function buildUrbanContextMassesGroup(params: {
  primaryEdge: EdgeInfo;
  prefix: string;
  baseY: number;
  roadWidth: number;
  sidewalkWidth: number;
  rng: () => number;
}): ExportMeshGroup | null {
  const { primaryEdge, prefix, baseY, roadWidth, sidewalkWidth, rng } = params;

  const geometries: THREE.BufferGeometry[] = [];
  const edge = primaryEdge;

  // ── Voisins sur le même îlot ─────────────────────────────────────────────
  // Positionnés à l'extrémité gauche et droite de l'arête rue, dans son alignement.

  for (const side of [-1, 1] as const) {
    const massW = 10.0 + rng() * 14.0;     // largeur [10 ; 24]
    const massD = 9.0 + rng() * 10.0;      // profondeur [9 ; 19]
    const massH = 8.0 + rng() * 18.0;      // hauteur [8 ; 26]
    const gap = 0.6 + rng() * 1.2;         // espace entre bâtiments [0.6 ; 1.8]

    // Extrémité gauche (a) ou droite (b) de l'arête
    const anchor = side === -1 ? edge.a : edge.b;
    const tDir = side === -1 ? -1 : 1;

    // Centre de la masse : décalée le long de l'arête, même alignement
    const cx = anchor.x
      + edge.tangent.x * tDir * (gap + massW * 0.5)
      + edge.outward.x * (massD * 0.5 - 0.3); // légèrement en retrait
    const cz = anchor.z
      + edge.tangent.z * tDir * (gap + massW * 0.5)
      + edge.outward.z * (massD * 0.5 - 0.3);

    const geo = new THREE.BoxGeometry(massW, massH, massD);
    const tmp = new THREE.Mesh(geo);
    tmp.position.set(cx, baseY + massH * 0.5, cz);
    orientMeshToEdge(tmp, edge.a, edge.b);
    tmp.updateMatrixWorld(true);
    geometries.push(toNonIndexed(geo).applyMatrix4(tmp.matrixWorld));
  }

  // ── Masses en face (de l'autre côté de la rue) ───────────────────────────

  const streetTotalOffset = sidewalkWidth + roadWidth; // bord de la rue côté opposé

  for (const lateralShift of [-0.25, 0.3] as const) {
    const massW = 16.0 + rng() * 20.0;
    const massD = 10.0 + rng() * 12.0;
    const massH = 10.0 + rng() * 22.0;
    const setback = 2.0 + rng() * 4.0;   // retrait depuis le bord opposé de la rue

    const cx = edge.midpoint.x
      + edge.outward.x * (streetTotalOffset + setback + massD * 0.5)
      + edge.tangent.x * edge.length * lateralShift;
    const cz = edge.midpoint.z
      + edge.outward.z * (streetTotalOffset + setback + massD * 0.5)
      + edge.tangent.z * edge.length * lateralShift;

    const geo = new THREE.BoxGeometry(massW, massH, massD);
    const tmp = new THREE.Mesh(geo);
    tmp.position.set(cx, baseY + massH * 0.5, cz);
    orientMeshToEdge(tmp, edge.a, edge.b);
    tmp.updateMatrixWorld(true);
    geometries.push(toNonIndexed(geo).applyMatrix4(tmp.matrixWorld));
  }

  if (geometries.length === 0) return null;

  const merged = mergeGeometries(geometries);
  merged.computeVertexNormals();
  merged.computeBoundingSphere();

  const mesh = new THREE.Mesh(merged, makeMaterial('urban_context_mass'));
  mesh.name = `${prefix}_URBAN_CONTEXT_MASS_00`;
  mesh.userData = { mmzType: 'urban_context_mass' };
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  return { name: mesh.name, mesh, category: 'urban_context_mass' };
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. ARBRES EN ALIGNEMENT
// ─────────────────────────────────────────────────────────────────────────────
//
// Rangée d'arbres le long du trottoir (côté rue).
// Positionnés à 1.1m du bord extérieur de l'arête principale.
// Pas : 6–8m, décalage de départ déterministe par seed.
// Tronc + frondaison fusionnés dans un seul mesh 'site_tree'.
// On évite la zone centrale (entrée) pour ne pas bloquer la façade.
// ─────────────────────────────────────────────────────────────────────────────

function buildStreetTreesGroup(params: {
  primaryEdge: EdgeInfo;
  prefix: string;
  baseY: number;
  sidewalkWidth: number;
  rng: () => number;
}): ExportMeshGroup | null {
  const { primaryEdge, prefix, baseY, sidewalkWidth, rng } = params;

  const treeSpacing = 6.5 + rng() * 1.5;   // espacement [6.5 ; 8.0]
  const trunkH = 3.8 + rng() * 1.0;        // hauteur tronc [3.8 ; 4.8]
  const trunkR = 0.18;
  const canopyR = 2.2 + rng() * 0.6;       // rayon frondaison [2.2 ; 2.8]
  const trunkRadSeg = 6;
  const canopyRadSeg = 6;

  // Les arbres sont côté extérieur du trottoir, légèrement en retrait de la bordure
  const lateralOffset = sidewalkWidth * 0.78;
  const entranceClearance = 5.0; // zone libre autour du centre (entrée)

  const numTrees = Math.floor(primaryEdge.length / treeSpacing);
  const startOffset = (primaryEdge.length - (numTrees - 1) * treeSpacing) * 0.5;

  const geometries: THREE.BufferGeometry[] = [];

  for (let t = 0; t < numTrees; t++) {
    const posAlong = startOffset + t * treeSpacing - primaryEdge.length * 0.5;

    // Éviter la zone d'entrée (centre de l'arête ± clearance)
    if (Math.abs(posAlong) < entranceClearance) continue;

    const tx = primaryEdge.midpoint.x
      + primaryEdge.tangent.x * posAlong
      + primaryEdge.outward.x * lateralOffset;
    const tz = primaryEdge.midpoint.z
      + primaryEdge.tangent.z * posAlong
      + primaryEdge.outward.z * lateralOffset;

    // Variation individuelle légère
    const hVar = 1.0 + (rng() - 0.5) * 0.2;
    const effectiveTrunkH = trunkH * hVar;
    const effectiveCanopyR = canopyR * hVar;

    // Tronc
    const trunkGeo = new THREE.CylinderGeometry(
      trunkR * 0.75, trunkR, effectiveTrunkH, trunkRadSeg,
    );
    const trunkMesh = new THREE.Mesh(trunkGeo);
    trunkMesh.position.set(tx, baseY + effectiveTrunkH * 0.5, tz);
    trunkMesh.updateMatrixWorld(true);
    geometries.push(toNonIndexed(trunkGeo).applyMatrix4(trunkMesh.matrixWorld));

    // Frondaison
    const canopyGeo = new THREE.SphereGeometry(effectiveCanopyR, canopyRadSeg, 4);
    const canopyMesh = new THREE.Mesh(canopyGeo);
    canopyMesh.position.set(tx, baseY + effectiveTrunkH + effectiveCanopyR * 0.62, tz);
    canopyMesh.updateMatrixWorld(true);
    geometries.push(toNonIndexed(canopyGeo).applyMatrix4(canopyMesh.matrixWorld));
  }

  if (geometries.length === 0) return null;

  const merged = mergeGeometries(geometries);
  merged.computeVertexNormals();
  merged.computeBoundingSphere();

  const mesh = new THREE.Mesh(merged, makeMaterial('site_tree'));
  mesh.name = `${prefix}_SITE_TREE_00`;
  mesh.userData = { mmzType: 'site_tree', count: numTrees };
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  return { name: mesh.name, mesh, category: 'site_tree' };
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. HAIES (arêtes secondaires, en complément des murets)
// ─────────────────────────────────────────────────────────────────────────────

function buildHedgeGroup(params: {
  scenePts: Array<{ x: number; z: number }>;
  primaryEdge: EdgeInfo;
  prefix: string;
  baseY: number;
}): ExportMeshGroup | null {
  const { scenePts, primaryEdge, prefix, baseY } = params;

  const hedgeH = 1.15;
  const hedgeT = 0.45;
  const insetFromWall = 0.06; // haie légèrement en avant du muret
  const centroid = computeCentroid(scenePts);
  const geometries: THREE.BufferGeometry[] = [];

  for (let i = 0; i < scenePts.length; i++) {
    if (i === primaryEdge.edgeIndex) continue;

    const a = scenePts[i];
    const b = scenePts[(i + 1) % scenePts.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    // Haie uniquement sur les arêtes assez longues (pas les petits retours)
    if (len < 3.5) continue;

    const midpoint = { x: (a.x + b.x) * 0.5, z: (a.z + b.z) * 0.5 };
    const outward = computeEdgeOutward(a, b, centroid);

    // La haie est côté intérieur de la parcelle, devant le muret
    const hedge = new THREE.BoxGeometry(len * 0.92, hedgeH, hedgeT);
    const tmp = new THREE.Mesh(hedge);
    tmp.position.set(
      midpoint.x - outward.x * insetFromWall,
      baseY + hedgeH * 0.5,
      midpoint.z - outward.z * insetFromWall,
    );
    orientMeshToEdge(tmp, a, b);
    tmp.updateMatrixWorld(true);
    geometries.push(toNonIndexed(hedge).applyMatrix4(tmp.matrixWorld));
  }

  if (geometries.length === 0) return null;

  const merged = mergeGeometries(geometries);
  merged.computeVertexNormals();
  merged.computeBoundingSphere();

  const mesh = new THREE.Mesh(merged, makeMaterial('site_hedge'));
  mesh.name = `${prefix}_SITE_HEDGE_00`;
  mesh.userData = { mmzType: 'site_hedge' };
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  return { name: mesh.name, mesh, category: 'site_hedge' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers géométriques
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Trouve l'arête principale côté rue = arête la plus longue du polygone.
 * Cohérent avec la logique d'entrée de buildFacadeForExport.
 */
function findPrimaryStreetEdge(scenePts: Array<{ x: number; z: number }>): EdgeInfo | null {
  if (scenePts.length < 2) return null;

  const centroid = computeCentroid(scenePts);
  let best: EdgeInfo | null = null;

  for (let i = 0; i < scenePts.length; i++) {
    const a = scenePts[i];
    const b = scenePts[(i + 1) % scenePts.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    if (length < 2) continue;

    const tangent = { x: dx / length, z: dz / length };
    const outward = computeEdgeOutward(a, b, centroid);
    const midpoint = { x: (a.x + b.x) * 0.5, z: (a.z + b.z) * 0.5 };

    if (!best || length > best.length) {
      best = { a, b, midpoint, outward, tangent, length, edgeIndex: i };
    }
  }

  return best;
}

/**
 * Calcule la normale outward d'une arête par rapport au centroïde du polygone.
 */
function computeEdgeOutward(
  a: { x: number; z: number },
  b: { x: number; z: number },
  centroid: { x: number; z: number },
): { x: number; z: number } {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return { x: 1, z: 0 };

  const nx = -dz / len;
  const nz = dx / len;
  const mid = { x: (a.x + b.x) * 0.5, z: (a.z + b.z) * 0.5 };
  const dot = nx * (centroid.x - mid.x) + nz * (centroid.z - mid.z);
  return dot > 0 ? { x: -nx, z: -nz } : { x: nx, z: nz };
}

function orientMeshToEdge(
  mesh: THREE.Object3D,
  a: { x: number; z: number },
  b: { x: number; z: number },
) {
  mesh.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
}

/**
 * Convertit une BufferGeometry indexée en non-indexée pour un merge sûr.
 * Les BoxGeometry/CylinderGeometry/SphereGeometry de Three.js sont indexées par défaut.
 */
function toNonIndexed(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  return geo.index ? geo.toNonIndexed() : geo.clone();
}

function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const nonIndexed = geos.filter((g) => !!g?.getAttribute('position'));

  if (nonIndexed.length === 0) return new THREE.BufferGeometry();

  let totalVerts = 0;
  for (const g of nonIndexed) {
    const pos = g.getAttribute('position');
    if (pos) totalVerts += pos.count;
  }

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  let offset = 0;

  for (const g of nonIndexed) {
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
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return merged;
}

function makeMaterial(category: string): THREE.MeshStandardMaterial {
  const def = URBAN_MATERIALS[category] ?? { color: '#AAAAAA', roughness: 0.85, metallic: 0.0 };
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(def.color),
    roughness: def.roughness,
    metallic: def.metallic,
    side: THREE.DoubleSide,
  });
}

function clampNumber(v: number | undefined, min: number, max: number): number {
  if (typeof v !== 'number' || Number.isNaN(v)) return min;
  return Math.max(min, Math.min(max, v));
}