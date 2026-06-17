// massingBuildingAssemblerV1.ts — V5.1 (MURS RÉELLEMENT PERCÉS, sans CSG)
//   + toiture (massingRoofEngine) + ouvertures (massingFacadeOpenings) + bandeaux
// Assembleur V1 — volumes simples, robuste, aucune dépendance premium.
// ─────────────────────────────────────────────────────────────────────────────
// V5 — PERÇAGE RÉEL DES MURS.
//   Avant : volume plein extrudé + vitres/cadres posés EN SURFACE (les trous
//   n'existaient pas → fenêtres "collées").
//   Maintenant : quand des ouvertures sont activées, chaque pan de façade est
//   reconstruit comme un assemblage de BANDEAUX pleins contournant les trous —
//   pilier gauche, pilier droit, allège (sous), linteau (au-dessus) — par travée
//   et par étage. Les trous restent vides ; les vitres+cadres du moteur
//   d'ouvertures viennent s'y loger. Aucune lib CSG.
//
//   Grille MUTUALISÉE : la disposition (maxBays/bayW/winW/winH/porte) provient de
//   `planEdgeOpenings` (massingFacadeOpenings) — même source pour les trous et les
//   menuiseries → alignement exact.
//
//   UV (piège des "murs noirs") : les bandeaux sont des quads à plat dont on
//   calcule nous-mêmes les UV planaires — U = abscisse curviligne le long de la
//   façade (cumulée depuis le 1er sommet de l'arête), V = hauteur depuis la base
//   de slice, le tout ÷ tileM. Jamais d'UV dégénérées, jamais de NaN.
//
//   Rétrocompat : SANS ouvertures (ou en wireframe), on garde le volume plein
//   extrudé + régénération d'UV (chemin V4 validé). Perçage = strictement opt-in.
//
//   Caps & arêtes : les arêtes (EdgesGeometry) sont toujours calculées depuis le
//   volume PLEIN → silhouette nette inchangée. En mode percé on ajoute un cap haut
//   (plancher/terrasse) sur chaque slice non-sommitale (le toit gère la sommitale)
//   pour que les retraits (setbacks) restent fermés.
//
//   Setbacks : perçage tranche par tranche, chaque slice ayant son propre
//   footprint et son propre nombre d'étages.
//
// V5.1 — NORMALE SORTANTE ROBUSTE (fix "on ne voit les murs que de l'intérieur").
//   La normale candidate (-dz,0,dx) est flippée si elle pointe vers l'intérieur
//   (produit scalaire avec le vecteur centroïde→milieu d'arête < 0). Quand on
//   flippe la normale, on inverse aussi le WINDING du quad (param `flip` de
//   pushWallQuad) pour que la face avant suive bien la normale. Indépendant du
//   sens d'enroulement réel du footprint ; gère aussi les polygones concaves.
//   Même correction côté ouvertures (massingFacadeOpenings).
//
// Repère : arête a→b, Pt2D .x/.y (.y = z monde).
//   sol monde = (a.x, yBot, a.y) ; tangente t = (dx,0,dz)/len ;
//   normale candidate n = (-dz,0,dx)/len (puis flip). Footprint forcé CCW.
//
// Hérité V4 (chemin plein) :
// - WorldUVGenerator d'ExtrudeGeometry produisait des UV dégénérées sur les faces
//   latérales → texture NOIRE. regenerateSideUVs corrige (projection planaire m).
// - bodyGeo.dispose() conservé UNIQUEMENT en mode percé (où bodyGeo ne sert qu'aux
//   arêtes) ; JAMAIS quand bodyGeo est le mesh rendu (sinon écran noir / OOM).
// - Z-FIGHTING : roofMesh.position.y = roofY + ROOF_ZFIGHT_OFFSET (+2mm)
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from "three";
import { ptsToShape, scalePolygon, centroid2D, extractEdges } from "./massingGeometry3d";
import type { Pt2D } from "./massingGeometry3d";
import { buildPitchedRoof, type RoofConfig } from "./massingRoofEngine";
import {
  addOpeningsToSlice, longestEdgeIndex, newBuffers, flushOpenings,
  planEdgeOpenings, styleForEdge, MIN_OPENING_EDGE,
  type OpeningsConfig, type OpeningBuffers,
} from "./massingFacadeOpenings";
import { addMaterialBands, type MaterialBandsConfig } from "./massingFacadeBands";
import {
  addBalconiesToSlice, newBalconyBuffers, flushBalconies,
  type BalconyConfig, type BalconyBuffers,
} from "./massingBalconies";


// ─── Offset anti z-fighting ───────────────────────────────────────────────────

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

// ─── Mapping type de bâtiment → matière PBR ───────────────────────────────────

interface MatSpec {
  color:      string;
  normal?:    string;
  roughness?: string;
  tileM:      number;
  roughness0: number;
}

const ENDUIT: MatSpec = {
  color:     "/textures/plaster/Plaster001_Color.jpg",
  normal:    "/textures/plaster/Plaster001_NormalGL.jpg",
  roughness: "/textures/plaster/Plaster001_Roughness.jpg",
  tileM: 3, roughness0: 0.9,
};

const BETON: MatSpec = {
  color:     "/textures/concrete/Concrete047A_2K-JPG/Concrete047A_2K-JPG_Color.jpg",
  normal:    "/textures/concrete/Concrete047A_2K-JPG/Concrete047A_2K-JPG_NormalGL.jpg",
  roughness: "/textures/concrete/Concrete047A_2K-JPG/Concrete047A_2K-JPG_Roughness.jpg",
  tileM: 3, roughness0: 0.92,
};

const BRIQUE: MatSpec = {
  color:     "/textures/brick/Bricks101_2K-JPG/Bricks101_2K-JPG_Color.jpg",
  normal:    "/textures/brick/Bricks101_2K-JPG/Bricks101_2K-JPG_NormalGL.jpg",
  roughness: "/textures/brick/Bricks101_2K-JPG/Bricks101_2K-JPG_Roughness.jpg",
  tileM: 1.8, roughness0: 0.9,
};

const KIND_MATERIAL: Record<SimpleBuildingKind, MatSpec> = {
  collectif:  ENDUIT,
  generique:  ENDUIT,
  bureau:     BETON,
  equipement: BETON,
  parking:    BETON,
  commerce:   BRIQUE,
};

// ─── Bibliothèque de matières façade (extensible) ────────────────────────────
export const FACADE_LIBRARY: Record<string, { label: string; spec: MatSpec }> = {
  enduit:  { label: "Enduit",   spec: ENDUIT },
  beton:   { label: "Béton",    spec: BETON },
  beton2:  { label: "Béton 2",  spec: { color: "/textures/concrete/Concrete045_2K-JPG/Concrete045_2K-JPG_Color.jpg", tileM: 3,   roughness0: 0.9 } },

  brique:  { label: "Brique",   spec: BRIQUE },
  brique2: { label: "Brique 2", spec: { color: "/textures/brick/Bricks059_2K-JPG_Color.jpg",                tileM: 1.8, roughness0: 0.9 } },
  brique3: { label: "Brique 3", spec: { color: "/textures/brick/Bricks060_2K-JPG/Bricks060_2K-JPG_Color.jpg", tileM: 1.8, roughness0: 0.9 } },
  brique4: { label: "Brique 4", spec: { color: "/textures/brick/Bricks084_2K-JPG/Bricks084_2K-JPG_Color.jpg", tileM: 1.8, roughness0: 0.9 } },
  brique5: { label: "Brique 5", spec: { color: "/textures/brick/Bricks103_2K-JPG/Bricks103_2K-JPG_Color.jpg", tileM: 1.8, roughness0: 0.9 } },
};

// ─── Chargement de texture (Image.decode + CanvasTexture) ─────────────────────
// THREE.TextureLoader rendait les JPEG noirs ici (cause racine du bug). Ce chemin
// décode l'image en RGBA avant upload.

function loadTextureInto(
  material: THREE.MeshStandardMaterial | THREE.MeshLambertMaterial | THREE.MeshBasicMaterial,
  slot: "map" | "normalMap" | "roughnessMap",
  url: string,
  isColor: boolean,
  _tileM: number,
): void {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;
  img.decode()
    .then(() => {
      const cnv = document.createElement("canvas");
      cnv.width = img.naturalWidth;
      cnv.height = img.naturalHeight;
      const ctx = cnv.getContext("2d")!;
      ctx.drawImage(img, 0, 0);

      const tex = new THREE.CanvasTexture(cnv);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(1, 1); // tuilage déjà encodé dans les UV (÷ tileM)
      tex.anisotropy = 8;
      tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      tex.needsUpdate = true;

      (material as unknown as Record<string, unknown>)[slot] = tex;
      material.needsUpdate = true;
    })
    .catch((err) => {
      console.warn("[Massing3D] décodage texture échoué, couleur de repli conservée :", url, err);
    });
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SimpleSlice {
  pts:       Pt2D[];
  fromFloor: number;
  toFloor:   number;
}

export type FacadeMaterialSpec =
  | { mode: "preset"; preset: SimpleBuildingKind }
  | { mode: "lib";    id: string; tileM?: number }
  | { mode: "color";  color: string }
  | { mode: "custom"; textureUrl: string; tileM?: number };

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
  facadeMaterial?: FacadeMaterialSpec;
  roof?:        RoofConfig;
  openings?:    OpeningsConfig;
  bands?:       MaterialBandsConfig;
  balconies?:   BalconyConfig;        // ← balcons en étage (absent = aucun)
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

// Recouvrement du trou par le cadre : on rétrécit légèrement le trou par rapport
// à la fenêtre/porte pour que le bord du mur passe DERRIÈRE le cadre saillant
// (masque la couture mur/menuiserie). Fractions de winH/doorH.
const WIN_REVEAL_FRAC  = 0.03;
const DOOR_REVEAL_FRAC = 0.02;

// ─── Assembleur principal ─────────────────────────────────────────────────────

export function assembleSimpleBuilding(input: SimpleAssemblyInput): SimpleAssemblyResult {
  const group = new THREE.Group();
  group.name           = `bld_v1_${input.id}`;
  group.userData.bldId = input.id;

  const { slices, floorHeight, platformY, showWireframe } = input;
  const kind      = input.kind ?? "generique";
  const facadeHex = input.facadeColor ?? KIND_FACADE_COLOR[kind];
  const roofHex   = input.roofColor   ?? KIND_ROOF_COLOR[kind];
  const facadeMat: FacadeMaterialSpec =
    input.facadeMaterial ?? { mode: "preset", preset: kind };
  const mats      = buildSimpleMaterials(facadeHex, roofHex, facadeMat);

  const openBuffers: OpeningBuffers | null =
    input.openings?.enabled && !showWireframe ? newBuffers() : null;

  const balconyBuffers: BalconyBuffers | null =
    input.balconies?.enabled && !showWireframe ? newBalconyBuffers() : null;

  for (let si = 0; si < slices.length; si++) {
    const slice = slices[si];
    const isTop = si === slices.length - 1;
    const yBot  = platformY + slice.fromFloor * floorHeight;
    const yTop  = platformY + slice.toFloor   * floorHeight;
    const h     = yTop - yBot;
    if (h < 0.01 || slice.pts.length < 3) continue;
    buildSlice(group, slice.pts, yBot, h, mats, input.id, isTop, showWireframe, input.roof,
               input.openings, slice.fromFloor, floorHeight, openBuffers,
               input.balconies, balconyBuffers);
  }

  if (openBuffers) flushOpenings(group, input.id, openBuffers, input.openings?.shutterColor);
  if (balconyBuffers) flushBalconies(group, input.id, balconyBuffers, input.balconies?.railColor);

  // ── Bandeaux de matière (accents verticaux, plaqués PAR TRANCHE) ──
  // Posés par slice pour suivre les retraits (setbacks) : une bande sur le
  // footprint de base ne doit pas flotter devant les étages en retrait.
  if (input.bands?.enabled && !showWireframe) {
    for (const slice of slices) {
      const fp = ensureCCW(slice.pts);
      if (fp.length < 3) continue;
      const yB = platformY + slice.fromFloor * floorHeight;
      const hB = (slice.toFloor - slice.fromFloor) * floorHeight;
      if (hB < 0.01) continue;
      addMaterialBands(group, fp, yB, hB, floorHeight, input.bands, input.id);
    }
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

// ─── Winding : garantir CCW ───────────────────────────────────────────────────

function ensureCCW(pts: Pt2D[]): Pt2D[] {
  return signedArea(pts) < 0 ? pts.slice().reverse() : pts;
}

// ─── Régénération des UV des faces latérales (chemin PLEIN uniquement) ────────
// Voir en-tête V4. Projection planaire en mètres pour les faces verticales d'une
// ExtrudeGeometry, U = abscisse le long de la face, V = hauteur (z avant rotation).

function regenerateSideUVs(geo: THREE.ExtrudeGeometry, tileM: number): void {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const uvAttr = geo.getAttribute("uv")     as THREE.BufferAttribute;
  if (!pos || !uvAttr) return;

  const n = pos.count;
  for (let t = 0; t < n; t += 3) {
    const i0 = t, i1 = t + 1, i2 = t + 2;
    const z0 = pos.getZ(i0), z1 = pos.getZ(i1), z2 = pos.getZ(i2);
    const zVar = Math.max(z0, z1, z2) - Math.min(z0, z1, z2);

    if (zVar < 1e-3) continue; // cap horizontal : on n'y touche pas

    const x0 = pos.getX(i0), y0 = pos.getY(i0);
    for (const i of [i0, i1, i2]) {
      const dx = pos.getX(i) - x0;
      const dy = pos.getY(i) - y0;
      const horiz = Math.sqrt(dx * dx + dy * dy);
      const u = horiz / tileM;
      const v = pos.getZ(i) / tileM;
      uvAttr.setXY(
        i,
        Number.isFinite(u) ? u : 0,
        Number.isFinite(v) ? v : 0,
      );
    }
  }
  uvAttr.needsUpdate = true;
}

// ─── Quad de mur (un bandeau plein) ───────────────────────────────────────────
// Pousse un rectangle plat sur le plan de l'arête, dans les accumulateurs P/N/UV.
//   ax,az  : origine de l'arête (a.x, a.y=z monde)
//   tx,tz  : tangente unitaire ; nx,nz : normale sortante unitaire (déjà flippée)
//   flip   : true si la normale a été flippée → inverse le winding du quad
//   yBot   : base de slice (monde)
//   u0,u1  : abscisses le long de l'arête (depuis a), unités scène
//   v0,v1  : hauteurs depuis la base de slice, unités scène
//   tileM  : taille de tuile (÷ pour les UV)
// La face avant suit toujours (nx,nz) : winding (0,1,2,0,2,3) ou inversé si flip.

function pushWallQuad(
  P: number[], N: number[], UV: number[],
  ax: number, az: number, tx: number, tz: number, nx: number, nz: number,
  flip: boolean, yBot: number, u0: number, u1: number, v0: number, v1: number, tileM: number,
): void {
  if (u1 - u0 <= 1e-4 || v1 - v0 <= 1e-4) return;

  const x00 = ax + tx * u0, z00 = az + tz * u0;
  const x10 = ax + tx * u1, z10 = az + tz * u1;
  const y0  = yBot + v0,    y1  = yBot + v1;

  // 4 sommets : p00, p10, p11, p01
  const VX = [x00, x10, x10, x00];
  const VY = [y0,  y0,  y1,  y1 ];
  const VZ = [z00, z10, z10, z00];
  const VU = [u0,  u1,  u1,  u0 ];
  const VV = [v0,  v0,  v1,  v1 ];

  // flip → ordre inversé (face avant suit (nx,nz)).
  const idx = flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
  for (const k of idx) {
    P.push(VX[k], VY[k], VZ[k]);
    N.push(nx, 0, nz);
    UV.push(VU[k] / tileM, VV[k] / tileM);
  }
}

// ─── Murs percés (bandeaux contournant les trous) ─────────────────────────────

function buildPiercedWalls(
  group: THREE.Group,
  ptsCCW: Pt2D[],
  yBot: number,
  height: number,
  mats: SimpleMats,
  bldId: string,
  openings: OpeningsConfig,
  fromFloor: number,
  floorHeight: number,
): void {
  const tileM   = mats.bodyTileM;
  const leIdx   = longestEdgeIndex(ptsCCW);
  const nFloors = Math.max(1, Math.round(height / floorHeight));
  const C       = centroid2D(ptsCCW);   // oriente les normales vers l'extérieur

  const P: number[] = [];
  const N: number[] = [];
  const UV: number[] = [];

  for (let i = 0; i < ptsCCW.length; i++) {
    const a = ptsCCW[i];
    const b = ptsCCW[(i + 1) % ptsCCW.length];
    const dx = b.x - a.x, dz = b.y - a.y;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) continue;

    const tx = dx / len, tz = dz / len;
    // Normale candidate + flip si elle pointe vers l'intérieur (vers C).
    let nx = -dz / len, nz = dx / len;
    const mx = (a.x + b.x) / 2, mz = (a.y + b.y) / 2;
    let flip = false;
    if (nx * (mx - C.x) + nz * (mz - C.y) < 0) { nx = -nx; nz = -nz; flip = true; }

    // Arête trop courte : mur plein pleine hauteur.
    if (len < MIN_OPENING_EDGE) {
      pushWallQuad(P, N, UV, a.x, a.y, tx, tz, nx, nz, flip, yBot, 0, len, 0, height, tileM);
      continue;
    }

    const style = styleForEdge(openings, i);

    for (let f = 0; f < nFloors; f++) {
      const floorIdx  = fromFloor + f;
      const floorBase = f * floorHeight; // base de l'étage depuis la base de slice
      const doorHere  = !!openings.door && floorIdx === 0 && i === leIdx;
      const plan = planEdgeOpenings(len, floorHeight, style, openings.baysPerEdge, doorHere);

      for (let bay = 0; bay < plan.maxBays; bay++) {
        const colL = bay * plan.bayW;
        const colR = (bay + 1) * plan.bayW;
        const uC   = len * (bay + 0.5) / plan.maxBays;

        // Trou (coords v relatives à la base d'étage). Légèrement rétréci pour
        // passer derrière le cadre saillant.
        let hUMin: number, hUMax: number, hVMin: number, hVMax: number;
        if (bay === plan.doorBay) {
          const r = plan.doorH * DOOR_REVEAL_FRAC;
          hUMin = uC - plan.doorW / 2 + r;
          hUMax = uC + plan.doorW / 2 - r;
          hVMin = 0;                       // porte au sol → pas d'allège
          hVMax = plan.doorH - r;
        } else {
          const r = plan.winH * WIN_REVEAL_FRAC;
          hUMin = uC - plan.winW / 2 + r;
          hUMax = uC + plan.winW / 2 - r;
          hVMin = plan.winVCenter - plan.winH / 2 + r;
          hVMax = plan.winVCenter + plan.winH / 2 - r;
        }

        // Sécurité : borne le trou dans sa colonne et dans l'étage.
        hUMin = Math.max(hUMin, colL);
        hUMax = Math.min(hUMax, colR);
        hVMin = Math.max(hVMin, 0);
        hVMax = Math.min(hVMax, floorHeight);

        const vb = floorBase;
        // pilier gauche
        pushWallQuad(P, N, UV, a.x, a.y, tx, tz, nx, nz, flip, yBot, colL,  hUMin, vb,         vb + floorHeight, tileM);
        // pilier droit
        pushWallQuad(P, N, UV, a.x, a.y, tx, tz, nx, nz, flip, yBot, hUMax, colR,  vb,         vb + floorHeight, tileM);
        // allège (sous le trou)
        pushWallQuad(P, N, UV, a.x, a.y, tx, tz, nx, nz, flip, yBot, hUMin, hUMax, vb,         vb + hVMin,       tileM);
        // linteau (au-dessus du trou)
        pushWallQuad(P, N, UV, a.x, a.y, tx, tz, nx, nz, flip, yBot, hUMin, hUMax, vb + hVMax, vb + floorHeight, tileM);
      }
    }
  }

  if (P.length === 0) return;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(P), 3));
  geo.setAttribute("normal",   new THREE.BufferAttribute(new Float32Array(N), 3));
  geo.setAttribute("uv",       new THREE.BufferAttribute(new Float32Array(UV), 2));

  const mesh = new THREE.Mesh(geo, mats.body);
  mesh.castShadow     = true;
  mesh.receiveShadow  = true;
  mesh.userData.bldId = bldId;
  group.add(mesh);
}

// ─── Cap horizontal (plancher / terrasse de retrait) ──────────────────────────

function buildTopCap(
  group: THREE.Group,
  pts: Pt2D[],
  y: number,
  mats: SimpleMats,
  bldId: string,
): void {
  const geo = new THREE.ShapeGeometry(ptsToShape(pts));
  geo.rotateX(-Math.PI / 2);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mats.roof);
  mesh.position.y     = y;
  mesh.castShadow     = false;
  mesh.receiveShadow  = true;
  mesh.userData.bldId = bldId;
  group.add(mesh);
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
  roofConfig?: RoofConfig,
  openings?: OpeningsConfig,
  fromFloor = 0,
  floorHeight = height,
  openBuffers?: OpeningBuffers | null,
  balconies?: BalconyConfig,
  balconyBuffers?: BalconyBuffers | null,
): void {
  const ptsCCW  = ensureCCW(pts);
  const shape   = ptsToShape(ptsCCW);
  const bodyGeo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });

  // ── Wireframe : volume plein filaire, rien d'autre ──
  if (showWireframe) {
    const wm = new THREE.Mesh(bodyGeo, mats.wire);
    wm.rotation.x     = -Math.PI / 2;
    wm.position.y     = yBot;
    wm.userData.bldId = bldId;
    group.add(wm);
    return;
  }

  const pierce = !!openings?.enabled;

  if (!pierce) {
    // ── Chemin historique (V4) : volume plein texturé ──
    regenerateSideUVs(bodyGeo, mats.bodyTileM);
    const bodyMesh = new THREE.Mesh(bodyGeo, mats.body);
    bodyMesh.rotation.x     = -Math.PI / 2;
    bodyMesh.position.y     = yBot;
    bodyMesh.castShadow     = true;
    bodyMesh.receiveShadow  = true;
    bodyMesh.userData.bldId = bldId;
    group.add(bodyMesh);
  } else {
    // ── Chemin percé : murs en bandeaux + cap (setbacks fermés) ──
    buildPiercedWalls(group, ptsCCW, yBot, height, mats, bldId, openings!, fromFloor, floorHeight);
    if (!isTop) buildTopCap(group, ptsCCW, yBot + height, mats, bldId);
  }

  // ── Arêtes : toujours depuis le volume PLEIN → silhouette nette ──
  const edgeGeo  = new THREE.EdgesGeometry(bodyGeo, EDGE_ANGLE_DEG);
  const edgeMesh = new THREE.LineSegments(edgeGeo, mats.edge);
  edgeMesh.rotation.x     = -Math.PI / 2;
  edgeMesh.position.y     = yBot + 0.02;
  edgeMesh.userData.bldId = bldId;
  group.add(edgeMesh);

  // En mode percé, bodyGeo n'est rendu par aucun mesh (servi uniquement aux
  // arêtes, qui en ont copié les positions) → on peut le libérer ici.
  // En mode plein, bodyGeo EST le mesh → surtout NE PAS disposer.
  if (pierce) bodyGeo.dispose();

  // ── Toiture (top slice) ──
  if (isTop) {
    const roofShape = roofConfig?.shape ?? "flat";
    if (roofShape === "flat") {
      buildFlatRoof(group, ptsCCW, yBot + height, mats, bldId);
    } else {
      buildPitchedRoof(group, ptsCCW, yBot + height, roofConfig!, mats.roof, bldId);
    }
  }

  // ── Ouvertures : vitres/cadres/portes posés DANS les trous ──
  if (pierce && openBuffers) {
    const nFloorsInSlice = Math.max(1, Math.round(height / floorHeight));
    const leIdx = longestEdgeIndex(ptsCCW);
    for (let f = 0; f < nFloorsInSlice; f++) {
      const floorYBot = yBot + f * floorHeight;
      const floorIdx  = fromFloor + f;
      addOpeningsToSlice(group, ptsCCW, floorYBot, floorHeight, floorIdx, openings!, bldId, leIdx, openBuffers);
    }
  }

  // ── Balcons en étage (dalle + garde-corps) ──
  if (!showWireframe && balconies?.enabled && balconyBuffers) {
    const nFloorsInSlice = Math.max(1, Math.round(height / floorHeight));
    for (let f = 0; f < nFloorsInSlice; f++) {
      const floorYBot = yBot + f * floorHeight;
      const floorIdx  = fromFloor + f;
      addBalconiesToSlice(group, ptsCCW, floorYBot, floorHeight, floorIdx, balconies, openings, bldId, balconyBuffers);
    }
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
  roofMesh.position.y = roofY + ROOF_ZFIGHT_OFFSET;
  roofMesh.castShadow     = false;
  roofMesh.receiveShadow  = true;
  roofMesh.userData.bldId = bldId;
  roofMesh.userData.isRoof = true;
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
  body:       THREE.Material;
  bodyTileM:  number;       // tuile (m) du corps, pour la régénération d'UV / quads
  roof:       THREE.Material;
  parapet:    THREE.Material;
  edge:       THREE.Material;
  wire:       THREE.Material;
}

function buildSimpleMaterials(
  facadeHex: string,
  roofHex: string,
  facadeMat: FacadeMaterialSpec,
): SimpleMats {
  const fc = new THREE.Color(facadeHex);
  const rc = new THREE.Color(roofHex);

  let body: THREE.MeshBasicMaterial;
  let bodyTileM = 3;

  if (facadeMat.mode === "color") {
    body = new THREE.MeshBasicMaterial({ color: new THREE.Color(facadeMat.color) });
  } else if (facadeMat.mode === "custom") {
    body = new THREE.MeshBasicMaterial({ color: 0xffffff });
    bodyTileM = facadeMat.tileM ?? 3;
    loadTextureInto(body, "map", facadeMat.textureUrl, true, bodyTileM);
  } else if (facadeMat.mode === "lib") {
    const entry = FACADE_LIBRARY[facadeMat.id] ?? FACADE_LIBRARY.enduit;
    bodyTileM = facadeMat.tileM ?? entry.spec.tileM;
    body = new THREE.MeshBasicMaterial({ color: 0xffffff });
    loadTextureInto(body, "map", entry.spec.color, true, bodyTileM);
  } else {
    const spec = KIND_MATERIAL[facadeMat.preset] ?? KIND_MATERIAL.generique;
    bodyTileM = spec.tileM;
    body = new THREE.MeshBasicMaterial({ color: 0xffffff });
    loadTextureInto(body, "map", spec.color, true, spec.tileM);
  }

  const roof = new THREE.MeshLambertMaterial({ color: rc, side: THREE.DoubleSide });
  const parapet = new THREE.MeshLambertMaterial({ color: fc.clone().multiplyScalar(0.88) });

  return {
    body,
    bodyTileM,
    roof,
    parapet,
    edge:    new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: EDGE_OPACITY }),
    wire:    new THREE.MeshBasicMaterial({ color: WIREFRAME_COLOR, wireframe: true }),
  };
}

// ─── Dispose complet ──────────────────────────────────────────────────────────

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