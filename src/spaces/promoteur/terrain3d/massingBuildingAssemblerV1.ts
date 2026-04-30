// massingBuildingAssemblerV1.ts
// Assembleur V1 — volumes simples, robuste, aucune dépendance premium.
// ─────────────────────────────────────────────────────────────────────────────
// Correctifs :
// - KIND_FACADE_COLOR / KIND_ROOF_COLOR définis LOCALEMENT
// - bodyGeo.dispose() SUPPRIMÉ (fuite GPU → OOM)
// - Import AnchorMode supprimé (inutilisé)
//
// CORRECTIF Z-FIGHTING (V1.1) :
//   buildFlatRoof plaçait roofMesh.position.y = roofY, identique au top cap
//   de l'ExtrudeGeometry (bodyGeo) créé dans buildSlice.
//   Les deux faces étant coplanaires (même Y exact), le GPU alternait
//   aléatoirement laquelle rendre → scintillement du toit selon angle/zoom.
//   Fix : roofMesh.position.y = roofY + ROOF_ZFIGHT_OFFSET (+2mm).
//   Imperceptible visuellement, casse définitivement l'égalité de profondeur.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from "three";
import { ptsToShape, scalePolygon, centroid2D, extractEdges } from "./massingGeometry3d";
import type { Pt2D } from "./massingGeometry3d";

// ─── Offset anti z-fighting ───────────────────────────────────────────────────

/**
 * Décalage vertical du roofMesh par rapport au top cap du bodyGeo.
 * 2mm : imperceptible à l'œil, mais suffit pour que le comparateur de
 * profondeur GPU ne soit plus en égalité entre les deux faces.
 */
const ROOF_ZFIGHT_OFFSET = 0.002;

// ─── Couleurs par défaut par type de bâtiment ────────────────────────────────

type SimpleBuildingKind =
  | "collectif" | "bureau" | "commerce"
  | "equipement" | "parking" | "generique";

const KIND_FACADE_COLOR: Record<SimpleBuildingKind, string> = {
  collectif:  "#EDE8DA",
  bureau:     "#CDD8E0",
  commerce:   "#D4A882",
  equipement: "#D6CFC0",
  parking:    "#A8A8A0",
  generique:  "#DCDAD2",
};

const KIND_ROOF_COLOR: Record<SimpleBuildingKind, string> = {
  collectif:  "#8A8278",
  bureau:     "#6E7A82",
  commerce:   "#787068",
  equipement: "#7A7268",
  parking:    "#606060",
  generique:  "#787068",
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SimpleSlice {
  pts:       Pt2D[];
  fromFloor: number;
  toFloor:   number;
}

export interface SimpleAssemblyInput {
  id:           string;
  name:         string;
  slices:       SimpleSlice[];
  totalFloors:  number;
  floorHeight:  number;
  platformY:    number;
  kind?:        SimpleBuildingKind;
  facadeColor?: string;
  roofColor?:   string;
  isSelected:   boolean;
  isHovered:    boolean;
  showWireframe: boolean;
}

export interface SimpleAssemblyResult {
  group:    THREE.Group;
  labelPos: THREE.Vector3;
  metrics: {
    footprintScene:   number;
    totalHeightScene: number;
  };
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const SELECTION_COLOR = 0x5247b8;
const WIREFRAME_COLOR = 0x4a90d9;
const EDGE_OPACITY    = 0.14;
const EDGE_ANGLE_DEG  = 30;

// ─── Assembleur principal ─────────────────────────────────────────────────────

export function assembleSimpleBuilding(input: SimpleAssemblyInput): SimpleAssemblyResult {
  const group = new THREE.Group();
  group.name           = `bld_v1_${input.id}`;
  group.userData.bldId = input.id;

  const { slices, floorHeight, platformY, showWireframe } = input;
  const kind      = input.kind ?? "generique";
  const facadeHex = input.facadeColor ?? KIND_FACADE_COLOR[kind];
  const roofHex   = input.roofColor   ?? KIND_ROOF_COLOR[kind];
  const mats      = buildSimpleMaterials(facadeHex, roofHex);

  for (let si = 0; si < slices.length; si++) {
    const slice = slices[si];
    const isTop = si === slices.length - 1;
    const yBot  = platformY + slice.fromFloor * floorHeight;
    const yTop  = platformY + slice.toFloor   * floorHeight;
    const h     = yTop - yBot;
    if (h < 0.01 || slice.pts.length < 3) continue;
    buildSlice(group, slice.pts, yBot, h, mats, input.id, isTop, showWireframe);
  }

  if ((input.isSelected || input.isHovered) && slices.length > 0) {
    addSelectionHalo(group, slices[0].pts, platformY, input.isSelected);
  }

  const topSlice       = slices[slices.length - 1] ?? slices[0];
  const c              = topSlice ? centroid2D(topSlice.pts) : { x: 0, y: 0 };
  const topY           = platformY + input.totalFloors * floorHeight;
  const footprintScene = Math.abs(signedArea(slices[0]?.pts ?? []));

  return {
    group,
    labelPos: new THREE.Vector3(c.x, topY + 2.5, c.y),
    metrics:  { footprintScene, totalHeightScene: input.totalFloors * floorHeight },
  };
}

// ─── Construction d'une tranche ───────────────────────────────────────────────

function buildSlice(
  group: THREE.Group,
  pts: Pt2D[],
  yBot: number,
  height: number,
  mats: SimpleMats,
  bldId: string,
  isTop: boolean,
  showWireframe: boolean,
): void {
  const shape   = ptsToShape(pts);
  const bodyGeo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
  bodyGeo.computeVertexNormals();

  const bodyMesh = new THREE.Mesh(bodyGeo, showWireframe ? mats.wire : mats.body);
  bodyMesh.rotation.x     = -Math.PI / 2;
  bodyMesh.position.y     = yBot;
  bodyMesh.castShadow     = !showWireframe;
  bodyMesh.receiveShadow  = true;
  bodyMesh.userData.bldId = bldId;
  group.add(bodyMesh);

  // ⚠️ PAS de bodyGeo.dispose() ici.
  // bodyMesh référence bodyGeo pour le rendu GPU. Disposer ici = fuite mémoire → OOM.
  // disposeGroup() dans massingRendererScene.ts s'en charge lors du prochain rebuild.

  if (!showWireframe) {
    const edgeGeo  = new THREE.EdgesGeometry(bodyGeo, EDGE_ANGLE_DEG);
    const edgeMesh = new THREE.LineSegments(edgeGeo, mats.edge);
    edgeMesh.rotation.x     = -Math.PI / 2;
    edgeMesh.position.y     = yBot + 0.02;
    edgeMesh.userData.bldId = bldId;
    group.add(edgeMesh);

    if (isTop) buildFlatRoof(group, pts, yBot + height, mats, bldId);
  }
}

// ─── Toit plat ────────────────────────────────────────────────────────────────

function buildFlatRoof(
  group: THREE.Group,
  pts: Pt2D[],
  roofY: number,
  mats: SimpleMats,
  bldId: string,
): void {
  const roofGeo = new THREE.ShapeGeometry(ptsToShape(pts));
  roofGeo.rotateX(-Math.PI / 2);
  roofGeo.computeVertexNormals();

  const roofMesh = new THREE.Mesh(roofGeo, mats.roof);

  // ── CORRECTIF Z-FIGHTING ────────────────────────────────────────────────────
  // Sans offset, roofMesh.position.y = roofY = yBot + height, identique au
  // top cap de l'ExtrudeGeometry (bodyGeo) dans buildSlice.
  // → Deux faces exactement coplanaires → z-fighting → scintillement du toit.
  //
  // +ROOF_ZFIGHT_OFFSET (2mm) : le roofMesh est désormais légèrement au-dessus
  // du top cap → il gagne toujours le test de profondeur → couleur du toit
  // stable quel que soit l'angle ou le zoom de caméra.
  roofMesh.position.y = roofY + ROOF_ZFIGHT_OFFSET;
  // ────────────────────────────────────────────────────────────────────────────

  roofMesh.castShadow     = false;
  roofMesh.receiveShadow  = true;
  roofMesh.userData.bldId = bldId;
  roofMesh.userData.isRoof = true; // tag pour d'éventuels post-traitements
  group.add(roofMesh);

  addParapet(group, pts, roofY + ROOF_ZFIGHT_OFFSET, mats, bldId);
}

// ─── Acrotère ─────────────────────────────────────────────────────────────────

function addParapet(
  group: THREE.Group,
  pts: Pt2D[],
  baseY: number,
  mats: SimpleMats,
  bldId: string,
): void {
  const edges      = extractEdges(pts);
  const parapetH   = 0.4;
  const parapetThk = 0.12;

  for (const edge of edges) {
    if (edge.length < 0.5) continue;
    const geo   = new THREE.BoxGeometry(edge.length, parapetH, parapetThk);
    const cx    = (edge.a.x + edge.b.x) / 2;
    const cz    = (edge.a.y + edge.b.y) / 2;
    const angle = Math.atan2(edge.b.y - edge.a.y, edge.b.x - edge.a.x);
    const mesh  = new THREE.Mesh(geo, mats.parapet);
    mesh.position.set(cx, baseY + parapetH / 2, cz);
    mesh.rotation.y     = -angle;
    mesh.castShadow     = true;
    mesh.receiveShadow  = true;
    mesh.userData.bldId = bldId;
    group.add(mesh);
  }
}

// ─── Halo de sélection ────────────────────────────────────────────────────────

function addSelectionHalo(
  group: THREE.Group,
  pts: Pt2D[],
  baseY: number,
  isSelected: boolean,
): void {
  if (pts.length < 3) return;
  const scaled = scalePolygon(pts, 1.04);
  const v3     = scaled.map(p => new THREE.Vector3(p.x, baseY + 0.12, p.y));
  v3.push(v3[0].clone());
  group.add(
    new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(v3),
      new THREE.LineBasicMaterial({
        color:       SELECTION_COLOR,
        transparent: true,
        opacity:     isSelected ? 0.8 : 0.35,
      }),
    ),
  );
}

// ─── Matériaux ────────────────────────────────────────────────────────────────

interface SimpleMats {
  body:    THREE.Material;
  roof:    THREE.Material;
  parapet: THREE.Material;
  edge:    THREE.Material;
  wire:    THREE.Material;
}

function buildSimpleMaterials(facadeHex: string, roofHex: string): SimpleMats {
  const fc = new THREE.Color(facadeHex);
  const rc = new THREE.Color(roofHex);
  return {
    body:    new THREE.MeshStandardMaterial({ color: fc,                              roughness: 0.88, metalness: 0.02 }),
    roof:    new THREE.MeshStandardMaterial({ color: rc,                              roughness: 0.94, metalness: 0.0, side: THREE.DoubleSide }),
    parapet: new THREE.MeshStandardMaterial({ color: fc.clone().multiplyScalar(0.88), roughness: 0.92, metalness: 0.0 }),
    edge:    new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: EDGE_OPACITY }),
    wire:    new THREE.MeshBasicMaterial({ color: WIREFRAME_COLOR, wireframe: true }),
  };
}

// ─── Dispose complet ──────────────────────────────────────────────────────────

/** Dispose Mesh + LineSegments + Line — plus complet que disposeGroup (isMesh only). */
export function disposeSimpleAssembly(group: THREE.Group): void {
  group.traverse(obj => {
    const o = obj as THREE.Mesh;
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m && typeof (m as THREE.Material).dispose === "function") {
          (m as THREE.Material).dispose();
        }
      }
    }
  });
}

// ─── Signed area ──────────────────────────────────────────────────────────────

function signedArea(pts: Pt2D[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return a / 2;
}