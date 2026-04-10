// massingBuildingAssembler.ts — V3.2
// ─────────────────────────────────────────────────────────────────────────────
// Corrections V3.2 :
// - conservation de la structure fonctionnelle existante
// - addRoofToGroup sécurisé
// - matériaux de toit incliné en DoubleSide
// - roofCap plus lisible et moins sombre
// - roofCap ne caste plus d’ombres agressives
// - mergeAndAdd durci
// - ajout automatique de uv2 pour aoMap → correction majeure du rendu noir
// - enrichissement visuel des façades conservé
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Pt2D } from "./massingGeometry3d";
import { extractEdges, ptsToShape, scalePolygon, centroid2D } from "./massingGeometry3d";
import {
  createBuildingMaterials,
  disposeBuildingMaterials,
  applyFacadeColor,
  type BuildingMaterials,
  type FacadePaletteKey,
  type RoofStyleKey,
} from "./massingRenderMaterials";
import { buildFacadeGeometry, type FacadeConfig } from "./massingFacadeEngine";
import { buildRoofGeometry, type RoofConfig } from "./massingRoofEngine";
import { buildTerraceGeometry, hasRealTerrace, type TerraceConfig } from "./massingTerraceEngine";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VolumeSlice {
  pts: { x: number; y: number }[];
  fromFloor: number;
  toFloor: number;
  floors: number;
}

export interface BuildingAssemblyInput {
  id: string;
  name: string;
  slices: VolumeSlice[];
  totalFloors: number;
  floorHeight: number;
  platformY: number;
  style: {
    facade: string;
    roof: string;
    facadeColor: string;
    structureColor: string;
    windowRatio: number;
    bayWidth: number;
    hasBalconies: boolean;
    balconyFreq: number;
    hasBanding: boolean;
    hasCorner: boolean;
    numSetbacks: number;
    roofSlopes?: number;
    facadeTextureId?: string;
    roofTextureId?: string;
    facadeTextureRotation?: number;
    facadeTextureScale?: number;
    glassColor?: string;
    glassOpacity?: number;
    roofOverhang?: number;
    roofDormerEnabled?: boolean;
    roofDormerCount?: number;
  };
  balconyConfig?: import("./massingFacadeEngine").BalconyConfig;
  loggiaConfig?: import("./massingFacadeEngine").LoggiaConfig;
  shadingConfig?: import("./massingFacadeEngine").ShadingConfig;
  showWireframe: boolean;
  isSelected: boolean;
  isHovered: boolean;
}

export interface BuildingAssemblyResult {
  group: THREE.Group;
  materials: BuildingMaterials;
  labelPos: THREE.Vector3;
}

const HALO_COLOR = 0x5247b8;

// ─── Relief façade constants ──────────────────────────────────────────────────

const FACADE_RELIEF_DEPTH = 0.08;
const FACADE_PANEL_INSET = 0.14;
const FACADE_PANEL_MIN_LEN = 3.2;
const FACADE_PILASTER_SIZE = 0.14;
const FACADE_BAND_HEIGHT = 0.10;
const FACADE_BAND_OFFSET = 0.04;

// ─── UV helpers ───────────────────────────────────────────────────────────────

function ensureUv2(geo: THREE.BufferGeometry): void {
  const uv = geo.getAttribute("uv");
  if (!uv || uv.itemSize !== 2) return;

  const uv2 = geo.getAttribute("uv2");
  if (uv2 && uv2.count === uv.count) return;

  geo.setAttribute("uv2", new THREE.BufferAttribute((uv.array as ArrayLike<number>).slice ? (uv.array as any).slice(0) : new Float32Array(uv.array as ArrayLike<number>), 2));
}

function applyBoxUVs(geo: THREE.BufferGeometry, sx = 4, sy = 3, sz = 4): void {
  const pos = geo.getAttribute("position");
  if (!pos || pos.count === 0) return;

  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  if (!bb) return;

  const size = new THREE.Vector3();
  bb.getSize(size);

  const sx2 = Math.max(size.x, 0.0001);
  const sy2 = Math.max(size.y, 0.0001);
  const sz2 = Math.max(size.z, 0.0001);

  const uv = new Float32Array(pos.count * 2);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    const nx = (x - bb.min.x) / sx2;
    const ny = (y - bb.min.y) / sy2;
    const nz = (z - bb.min.z) / sz2;

    const dx = Math.min(nx, 1 - nx);
    const dy = Math.min(ny, 1 - ny);
    const dz = Math.min(nz, 1 - nz);

    let u = 0;
    let v = 0;

    if (dy <= dx && dy <= dz) {
      u = nx * sx;
      v = nz * sz;
    } else if (dx <= dz) {
      u = nz * sz;
      v = ny * sy;
    } else {
      u = nx * sx;
      v = ny * sy;
    }

    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }

  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  ensureUv2(geo);

  geo.attributes.uv.needsUpdate = true;
  if (geo.getAttribute("uv2")) geo.getAttribute("uv2").needsUpdate = true;
}

function applyUVs(
  geo: THREE.BufferGeometry,
  kind: "body" | "facade" | "roof" | "terrace" | "detail" = "detail",
): void {
  switch (kind) {
    case "body":
      applyBoxUVs(geo, 3.5, 2.8, 3.5);
      break;
    case "facade":
      applyBoxUVs(geo, 2.2, 2.6, 2.2);
      break;
    case "roof":
      applyBoxUVs(geo, 2.8, 1.5, 2.8);
      break;
    case "terrace":
      applyBoxUVs(geo, 2.4, 1.8, 2.4);
      break;
    default:
      applyBoxUVs(geo, 2, 2, 2);
      break;
  }
}

// ─── Helpers matériaux ────────────────────────────────────────────────────────

function cloneMeshStdMaterial(
  base: THREE.Material,
  patch?: Partial<THREE.MeshStandardMaterial>,
): THREE.Material {
  if ((base as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
    const m = (base as THREE.MeshStandardMaterial).clone();
    if (patch) Object.assign(m, patch);
    m.needsUpdate = true;
    return m;
  }

  const fallback = new THREE.MeshStandardMaterial({
    color: 0x999999,
    side: THREE.DoubleSide,
  });
  if (patch) Object.assign(fallback, patch);
  fallback.needsUpdate = true;
  return fallback;
}

// ─── Main assembler ───────────────────────────────────────────────────────────

export function assembleBuilding(input: BuildingAssemblyInput): BuildingAssemblyResult {
  const group = new THREE.Group();
  group.name = `building_${input.id}`;
  group.userData.bldId = input.id;

  const mats = createBuildingMaterials({
    facade: input.style.facade as FacadePaletteKey,
    roof: input.style.roof as RoofStyleKey,
    structureColor: input.style.structureColor,
    facadeTextureId: input.style.facadeTextureId,
    roofTextureId: input.style.roofTextureId,
    facadeTextureRotation: input.style.facadeTextureRotation,
    facadeTextureScale: input.style.facadeTextureScale,
    glassColor: input.style.glassColor,
    glassOpacity: input.style.glassOpacity,
  });

  if (input.style.facadeColor) {
    applyFacadeColor(mats, input.style.facadeColor);
  }

  const { slices, totalFloors, floorHeight, platformY, style, showWireframe } = input;

  for (let si = 0; si < slices.length; si++) {
    const slice = slices[si];
    const isTop = si === slices.length - 1;
    const isBot = si === 0;
    const nextSlice = si < slices.length - 1 ? slices[si + 1] : null;

    const sliceBaseY = platformY + slice.fromFloor * floorHeight;
    const sliceTopY = platformY + slice.toFloor * floorHeight;
    const attiqueStart = isTop && slices.length > 1 ? slice.floors - 1 : -1;

    buildSliceBody(
      group,
      slice.pts,
      sliceBaseY,
      sliceTopY,
      mats,
      showWireframe,
      input.id,
      isBot,
      isTop,
      slices.length > 1,
    );

    if (!showWireframe) {
      addFacadeReliefToGroup(
        group,
        slice.pts,
        sliceBaseY,
        sliceTopY,
        floorHeight,
        mats,
        input.id,
        {
          hasBanding: style.hasBanding,
          isSocle: isBot,
          isAttique: isTop && slices.length > 1,
        },
      );
    }

    if (style.hasCorner && !showWireframe) {
      addCornerPosts(group, slice.pts, sliceBaseY, sliceTopY, floorHeight, mats, input.id);
    }

    if (!showWireframe) {
      const balconyConfig = input.balconyConfig ?? {
        enabled: style.hasBalconies,
        type: "individual" as const,
        depthM: 1.0,
        thicknessM: 0.12,
        guardrailHeightM: 1.0,
        frequency: style.balconyFreq,
      };

      addFacadeToGroup(
        group,
        {
          edges: extractEdges(slice.pts),
          totalFloors: slice.floors,
          floorHeight,
          baseY: sliceBaseY,
          windowRatio: style.windowRatio,
          bayWidth: style.bayWidth,
          attiqueStartFloor: attiqueStart,
          hasBalconies: style.hasBalconies,
          balconyFreq: style.balconyFreq,
          facadeStyle: style.facade,
          hasBanding: style.hasBanding,
          balconyConfig,
          loggiaConfig: input.loggiaConfig,
          shadingConfig: input.shadingConfig,
        },
        mats,
        input.id,
      );
    }

    if (nextSlice && !showWireframe && hasRealTerrace(slice.pts, nextSlice.pts)) {
      addTerraceToGroup(
        group,
        {
          lowerPts: slice.pts,
          upperPts: nextSlice.pts,
          terraceY: sliceTopY,
          floorHeight,
        },
        mats,
        input.id,
      );
    }
  }

  if (slices.length > 0) {
    const topSlice = slices[slices.length - 1];
    const roofBaseY = platformY + topSlice.toFloor * floorHeight;

    addRoofToGroup(
      group,
      {
        topPts: topSlice.pts,
        roofBaseY,
        floorHeight,
        totalFloors,
        roofType: style.roof as any,
        roofSlopes: style.roofSlopes ?? 2,
        overhangM: style.roofOverhang ?? 0,
        dormers: style.roofDormerEnabled
          ? {
              enabled: true,
              count: style.roofDormerCount ?? 1,
              widthFactor: 0.18,
              heightFactor: 0.52,
            }
          : undefined,
      },
      mats,
      input.id,
      showWireframe,
    );
  }

  if (input.isSelected || input.isHovered) {
    addSelectionHalo(group, slices, platformY, floorHeight, input.isSelected);
  }

  if (!showWireframe) {
    addEdgeLines(group, slices, platformY, floorHeight, mats);
  }

  const lastSlice = slices[slices.length - 1] ?? slices[0];
  const center = lastSlice ? centroid2D(lastSlice.pts) : { x: 0, y: 0 };
  const topY = platformY + totalFloors * floorHeight;

  return {
    group,
    materials: mats,
    labelPos: new THREE.Vector3(center.x, topY + 3, center.y),
  };
}

// ─── Slice body ───────────────────────────────────────────────────────────────

function buildSliceBody(
  group: THREE.Group,
  pts: { x: number; y: number }[],
  yBot: number,
  yTop: number,
  mats: BuildingMaterials,
  showWireframe: boolean,
  bldId: string,
  isBot: boolean,
  isTop: boolean,
  hasSetbacks: boolean,
): void {
  const height = yTop - yBot;
  if (height < 0.01) return;

  const geo = new THREE.ExtrudeGeometry(ptsToShape(pts), {
    depth: height,
    bevelEnabled: false,
  });

  geo.computeVertexNormals();
  applyUVs(geo, "body");

  let wallMat: THREE.Material;
  if (showWireframe) {
    wallMat = new THREE.MeshBasicMaterial({
      color: 0x4a90d9,
      wireframe: true,
    });
  } else if (isBot) {
    wallMat = mats.facadeSocle;
  } else if (isTop && hasSetbacks) {
    wallMat = mats.facadeAttique;
  } else {
    wallMat = mats.facadeBody;
  }

  const mesh = new THREE.Mesh(geo, [mats.slab, wallMat]);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = yBot;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.bldId = bldId;
  group.add(mesh);
}

function addCornerPosts(
  group: THREE.Group,
  pts: { x: number; y: number }[],
  yBot: number,
  yTop: number,
  fh: number,
  mats: BuildingMaterials,
  bldId: string,
): void {
  const h = yTop - yBot;
  if (h < 0.01 || pts.length < 3) return;

  const ps = Math.min(0.6, Math.max(0.15, fh * 0.18));
  const g = new THREE.BoxGeometry(ps, h, ps);
  g.computeVertexNormals();
  applyUVs(g, "detail");

  for (const pt of pts) {
    const m = new THREE.Mesh(g, mats.frame);
    m.position.set(pt.x, yBot + h / 2, pt.y);
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.bldId = bldId;
    group.add(m);
  }
}

function addFacadeToGroup(
  group: THREE.Group,
  config: FacadeConfig,
  mats: BuildingMaterials,
  bldId: string,
): void {
  const f = buildFacadeGeometry(config);
  mergAndAdd(group, f.glass, mats.glass, bldId, true, "facade");
  mergAndAdd(group, f.frames, mats.frame, bldId, true, "detail");
  mergAndAdd(group, f.sills, mats.slab, bldId, true, "detail");
  mergAndAdd(group, f.balconies, mats.balconySlab, bldId, true, "terrace");
  mergAndAdd(group, f.railings, mats.railing, bldId, true, "detail");
  mergAndAdd(group, f.loggias, mats.facadeSocle, bldId, true, "facade");
  mergAndAdd(group, f.shading, mats.frame, bldId, true, "detail");
  mergAndAdd(group, f.doors, mats.door, bldId, true, "detail");
  mergAndAdd(group, f.banding, mats.slab, bldId, true, "detail");
}

function addTerraceToGroup(
  group: THREE.Group,
  config: TerraceConfig,
  mats: BuildingMaterials,
  bldId: string,
): void {
  const t = buildTerraceGeometry(config);
  mergAndAdd(group, t.slab, mats.terraceSlab, bldId, true, "terrace");
  mergAndAdd(group, t.rails, mats.railing, bldId, true, "detail");
  mergAndAdd(group, t.posts, mats.railing, bldId, true, "detail");
}

// ─── Reliefs de façade ────────────────────────────────────────────────────────

function addFacadeReliefToGroup(
  group: THREE.Group,
  pts: { x: number; y: number }[],
  yBot: number,
  yTop: number,
  floorHeight: number,
  mats: BuildingMaterials,
  bldId: string,
  options: {
    hasBanding: boolean;
    isSocle: boolean;
    isAttique: boolean;
  },
): void {
  const h = yTop - yBot;
  if (h < 0.5 || pts.length < 3) return;

  const reliefDepth = FACADE_RELIEF_DEPTH;
  const panelInset = FACADE_PANEL_INSET;

  const edges = extractEdges(pts);
  const panelGeos: THREE.BufferGeometry[] = [];
  const pilasterGeos: THREE.BufferGeometry[] = [];
  const bandGeos: THREE.BufferGeometry[] = [];

  for (const edge of edges) {
    const dx = edge.b.x - edge.a.x;
    const dz = edge.b.y - edge.a.y;
    const len = Math.hypot(dx, dz);
    if (len < FACADE_PANEL_MIN_LEN) continue;

    const ux = dx / len;
    const uz = dz / len;
    const nx = -uz;
    const nz = ux;

    const usable = Math.max(0, len - panelInset * 2);
    if (usable < 1.2) continue;

    const panelHeight =
      options.isSocle
        ? Math.max(0.55, h - 0.18)
        : options.isAttique
          ? Math.max(0.40, h - 0.12)
          : Math.max(0.70, h - 0.14);

    const panelBottom =
      options.isSocle
        ? yBot + 0.06
        : options.isAttique
          ? yBot + 0.04
          : yBot + 0.07;

    const px = edge.a.x + ux * panelInset;
    const pz = edge.a.y + uz * panelInset;

    const panelGeo = new THREE.BoxGeometry(usable, panelHeight, reliefDepth);
    panelGeo.translate(0, panelHeight / 2, 0);
    orientAndPlaceBoxGeometry(
      panelGeo,
      px + ux * (usable / 2) + nx * (reliefDepth / 2 + 0.01),
      panelBottom,
      pz + uz * (usable / 2) + nz * (reliefDepth / 2 + 0.01),
      Math.atan2(dz, dx),
    );
    panelGeos.push(panelGeo);

    const pilasterHeight = panelHeight;
    const pilasterW = FACADE_PILASTER_SIZE;
    const pilasterD = reliefDepth * 1.15;

    const leftPilaster = new THREE.BoxGeometry(pilasterW, pilasterHeight, pilasterD);
    leftPilaster.translate(0, pilasterHeight / 2, 0);
    orientAndPlaceBoxGeometry(
      leftPilaster,
      px + nx * (pilasterD / 2 + 0.012),
      panelBottom,
      pz + nz * (pilasterD / 2 + 0.012),
      Math.atan2(dz, dx),
    );
    pilasterGeos.push(leftPilaster);

    const rightPilaster = new THREE.BoxGeometry(pilasterW, pilasterHeight, pilasterD);
    rightPilaster.translate(0, pilasterHeight / 2, 0);
    orientAndPlaceBoxGeometry(
      rightPilaster,
      px + ux * usable + nx * (pilasterD / 2 + 0.012),
      panelBottom,
      pz + uz * usable + nz * (pilasterD / 2 + 0.012),
      Math.atan2(dz, dx),
    );
    pilasterGeos.push(rightPilaster);

    if (options.hasBanding && h >= floorHeight * 0.8) {
      const bandY = yBot + Math.min(h - 0.12, floorHeight + FACADE_BAND_OFFSET);
      if (bandY > yBot + 0.18 && bandY < yTop - 0.08) {
        const bandGeo = new THREE.BoxGeometry(usable, FACADE_BAND_HEIGHT, reliefDepth * 1.1);
        bandGeo.translate(0, FACADE_BAND_HEIGHT / 2, 0);
        orientAndPlaceBoxGeometry(
          bandGeo,
          px + ux * (usable / 2) + nx * (reliefDepth / 2 + 0.018),
          bandY,
          pz + uz * (usable / 2) + nz * (reliefDepth / 2 + 0.018),
          Math.atan2(dz, dx),
        );
        bandGeos.push(bandGeo);
      }
    }
  }

  if (panelGeos.length) {
    mergAndAdd(
      group,
      panelGeos,
      options.isSocle ? mats.facadeSocle : mats.facadeBody,
      bldId,
      true,
      "facade",
    );
  }
  if (pilasterGeos.length) {
    mergAndAdd(group, pilasterGeos, mats.frame, bldId, true, "detail");
  }
  if (bandGeos.length) {
    mergAndAdd(group, bandGeos, mats.slab, bldId, true, "detail");
  }
}

function orientAndPlaceBoxGeometry(
  geo: THREE.BufferGeometry,
  x: number,
  y: number,
  z: number,
  angleY: number,
): void {
  geo.rotateY(-angleY);
  geo.translate(x, y, z);
}

// ─── addRoofToGroup corrigé ───────────────────────────────────────────────────

function addRoofToGroup(
  group: THREE.Group,
  config: RoofConfig,
  mats: BuildingMaterials,
  bldId: string,
  showWireframe: boolean,
): void {
  const roof = buildRoofGeometry(config);
  const isInclined = config.roofType === "inclinee";

  const wireMat = new THREE.MeshBasicMaterial({ color: 0x4a90d9, wireframe: true });

  const roofSurfaceMat = showWireframe
    ? wireMat
    : isInclined
      ? cloneMeshStdMaterial(mats.roof, { side: THREE.DoubleSide })
      : mats.roof;

  const roofCapMat = showWireframe
    ? wireMat
    : isInclined
      ? cloneMeshStdMaterial(mats.facadeAttique, {
          side: THREE.DoubleSide,
          roughness: 0.92,
          metalness: 0.0,
        })
      : cloneMeshStdMaterial(mats.facadeBody, { side: THREE.DoubleSide });

  const acrotereMat = showWireframe
    ? wireMat
    : isInclined
      ? cloneMeshStdMaterial(mats.acrotere, { side: THREE.DoubleSide })
      : mats.acrotere;

  mergAndAdd(group, roof.acrotere, acrotereMat, bldId, true, "roof");
  mergAndAdd(group, roof.roofSurface, roofSurfaceMat, bldId, true, "roof");
  mergAndAdd(group, roof.roofCap, roofCapMat, bldId, false, "roof");
  mergAndAdd(group, roof.edicule, mats.slab, bldId, true, "detail");

  if (roof.dormerGlass.length > 0) {
    mergAndAdd(group, roof.dormerGlass, mats.glass, bldId, false, "facade");
  }
}

function addSelectionHalo(
  group: THREE.Group,
  slices: VolumeSlice[],
  platformY: number,
  fh: number,
  isSelected: boolean,
): void {
  const bp = slices[0]?.pts;
  if (!bp || bp.length < 3) return;

  const haloPts = scalePolygon(bp, 1.03);
  const pts = haloPts.map((p) => new THREE.Vector3(p.x, platformY + 0.08, p.y));
  pts.push(pts[0].clone());

  group.add(
    new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({
        color: HALO_COLOR,
        transparent: true,
        opacity: isSelected ? 0.7 : 0.35,
      }),
    ),
  );

  const ec = isSelected ? 0x5247b8 : 0x7b73d0;
  const eo = isSelected ? 0.5 : 0.25;

  for (const s of slices) {
    const by = platformY + s.fromFloor * fh;
    const ty = platformY + s.toFloor * fh;
    const bg = new THREE.ExtrudeGeometry(ptsToShape(s.pts), {
      depth: ty - by,
      bevelEnabled: false,
    });
    bg.computeVertexNormals();

    const el = new THREE.LineSegments(
      new THREE.EdgesGeometry(bg, 85),
      new THREE.LineBasicMaterial({
        color: ec,
        transparent: true,
        opacity: eo,
      }),
    );
    el.rotation.x = -Math.PI / 2;
    el.position.y = by + 0.03;
    group.add(el);
    bg.dispose();
  }
}

function addEdgeLines(
  group: THREE.Group,
  slices: VolumeSlice[],
  platformY: number,
  fh: number,
  mats: BuildingMaterials,
): void {
  for (const s of slices) {
    const by = platformY + s.fromFloor * fh;
    const ty = platformY + s.toFloor * fh;
    const bg = new THREE.ExtrudeGeometry(ptsToShape(s.pts), {
      depth: ty - by,
      bevelEnabled: false,
    });
    bg.computeVertexNormals();

    const lines = new THREE.LineSegments(new THREE.EdgesGeometry(bg, 85), mats.edgeLine);
    lines.rotation.x = -Math.PI / 2;
    lines.position.y = by + 0.02;
    lines.userData.bldId = group.userData.bldId;
    group.add(lines);
    bg.dispose();
  }
}

// ─── mergAndAdd — version sécurisée ──────────────────────────────────────────

function mergAndAdd(
  group: THREE.Group,
  geos: THREE.BufferGeometry[],
  material: THREE.Material,
  bldId: string,
  castShadow = true,
  uvKind: "body" | "facade" | "roof" | "terrace" | "detail" = "detail",
): void {
  const valid = geos.filter((g) => {
    const p = g.getAttribute("position");
    return !!p && p.count > 0;
  });

  if (valid.length === 0) return;

  for (const g of valid) {
    g.computeVertexNormals();
    applyUVs(g, uvKind);
    ensureUv2(g);
  }

  const merged = valid.length === 1 ? valid[0] : mergeGeometries(valid, false);
  if (!merged) {
    if (valid.length > 1) valid.forEach((g) => g.dispose());
    return;
  }

  merged.computeVertexNormals();
  applyUVs(merged, uvKind);
  ensureUv2(merged);

  const mesh = new THREE.Mesh(merged, material);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  mesh.userData.bldId = bldId;
  group.add(mesh);

  if (valid.length > 1) {
    valid.forEach((g) => g.dispose());
  }
}

export { disposeBuildingMaterials };