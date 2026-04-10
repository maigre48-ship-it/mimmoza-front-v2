// MassingRenderer.tsx — V8.6
// V8.6 : branchement renderer V2 — exploitation de glazing, balconies, roof depuis resolved
// ─────────────────────────────────────────────────────────────────────────────
// Nouveautés vs V8.5 :
//   A. createFacadeMaterialsForStyle accepte glazingOverride + railingColorOverride
//      → glass/railings pilotés par resolved.glazing et resolved.balconies.railingColor
//   B. Zone resolved capture aussi : glazing, balconies (enabled/freq/depthM/type),
//      railing color, roof color
//   C. buildFacadeGeometry reçoit hasBalconies/balconyFreq/balconyConfig depuis resolved
//      (fallback sur styleDef/legacy si resolved.balconies.enabled = false)
//   D. resolved.roof.color appliqué sur mesh.userData.isRoof === true dans v1Result
// Tout le reste = V8.5 exact, aucune suppression.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useRef, useCallback, useState } from "react";
import * as THREE from "three";
import type { Feature, FeatureCollection, Polygon, MultiPolygon } from "geojson";
import type { MassingBuildingModel, EditorTool, PlacedObject } from "../massingScene.types";
import { totalHeightM, totalLevelsCount } from "../massingScene.types";

import {
  TerrainSampler,
  anchorObjectOnTerrain,
  type ReliefData,
  type ScenePt,
} from "../services/terrainSampler";

import {
  computeSceneProjection,
  getBuildingScenePts,
  computeVolumeSlices,
  type VolumeSlice as GeoVolumeSlice,
} from "../massingGeometry";

import {
  createSceneContext,
  handleResize,
  fitCameraToBox,
  disposeSceneContext,
  disposeGroup,
  type SceneContext,
} from "../massingRendererScene";

import {
  rebuildLabels,
  updateLabelPositions,
  clearLabels,
  type LabelDef,
} from "../massingRendererLabels";

import {
  assembleSimpleBuilding,
  type SimpleSlice,
} from "../massingBuildingAssemblerV1";

import { disposeBuildingMaterials, type BuildingMaterials } from "../massingRenderMaterials";

import type { TreeType } from "../massingVegetationEngine";
import { buildBush } from "../massingVegetationEngine";

import { buildFacadeGeometry } from "../massingFacadeEngine";
import {
  getFacadeStyle,
  classifyEdge,
  resolveStyleForEdge,
  computeCentroid,
  type FacadeStyleDefinition,
} from "../massingFacadeStyles";

// ─── NOUVEAU : moteur de rendu BuildingBlenderSpec ────────────────────────────
import { ensureBuildingRenderSpec } from "../buildingBlenderSpec.helpers";
import { resolveBuildingRenderSpecSafe } from "../buildingRenderMapper";
import {
  applySceneAmbiance,
  buildAmbianceFromIntent,
  pickDominantIntent,
  applyIntentToColor,
} from "../renderScenePresets";
import {
  bboxFromBox3,
  computeCameraFraming,
  applyCameraFraming,
} from "../renderCamera.helpers";

// ─── Debug ────────────────────────────────────────────────────────────────────

const DEBUG_TERRAIN_ANCHORING = false;

// ─── Offsets Z-fighting ───────────────────────────────────────────────────────

const TERRAIN_CONTOUR_OFFSET = 0.3;
const PARCEL_OVERLAY_OFFSET  = 0.06;
const PARKING_TOP_OFFSET     = 0.22;
const PARKING_MARKING_OFFSET = 0.03;

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES LOCAUX
// ═══════════════════════════════════════════════════════════════════════════════

interface Pt2D {
  x: number;
  z: number;
}

interface HedgeGap {
  x: number;
  z: number;
  width: number;
}

interface FacadeResult {
  glass?:     THREE.BufferGeometry[];
  frames?:    THREE.BufferGeometry[];
  sills?:     THREE.BufferGeometry[];
  balconies?: THREE.BufferGeometry[];
  railings?:  THREE.BufferGeometry[];
  loggias?:   THREE.BufferGeometry[];
  shading?:   THREE.BufferGeometry[];
  banding?:   THREE.BufferGeometry[];
  doors?:     THREE.BufferGeometry[];
}

interface FacadeMaterials {
  glass:     THREE.MeshPhysicalMaterial;
  frames:    THREE.MeshStandardMaterial;
  sills:     THREE.MeshStandardMaterial;
  balconies: THREE.MeshStandardMaterial;
  railings:  THREE.MeshStandardMaterial;
  loggias:   THREE.MeshStandardMaterial;
  shading:   THREE.MeshStandardMaterial;
  banding:   THREE.MeshStandardMaterial;
  doors:     THREE.MeshStandardMaterial;
}

export interface MassingRendererCallbacks {
  onSelectBuilding:    (id: string | null) => void;
  onHoverBuilding:     (id: string | null) => void;
  onTranslateBuilding: (id: string, dx: number, dy: number) => void;
  onPlaceObject?:      (obj: Omit<PlacedObject, "id">) => void;
}

// ─── VegetationOptions ────────────────────────────────────────────────────────
// Les 6 premiers champs sont lus par le renderer Three.js.
// Les champs optionnels suivants sont stockés pour l'export Blender uniquement
// — ils sont ignorés silencieusement par le renderer actuel.

export interface VegetationOptions {
  // ── Champs renderer Three.js (existants) ─────────────────────────────────
  showHedges?:   boolean;
  showTrees?:    boolean;
  showBushes?:   boolean;
  treeType?:     TreeType;
  treeSpacing?:  number;
  hedgeHeight?:  number;

  // ── Haies — détail Blender ────────────────────────────────────────────────
  hedgeDensity?:    "sparse" | "medium" | "dense";
  hedgeSpecies?:    "buis" | "laurier" | "charme" | "thuya" | "bambou";
  hedgeFlowering?:  boolean;

  // ── Arbres — détail Blender ───────────────────────────────────────────────
  treeCount?:       number;
  treeHeightM?:     number;
  treeCrownM?:      number;
  treeSeason?:      "spring" | "summer" | "autumn" | "winter";
  treeAlignment?:   "random" | "aligned" | "double_row";
  treeSpecies?:     string;

  // ── Sol / tapis végétal — Blender ─────────────────────────────────────────
  groundCover?:      "none" | "grass_short" | "grass_long" | "wildflower" | "moss";
  plantingStrips?:   boolean;
  flowerBeds?:       boolean;
  climbingPlants?:   boolean;
  climbingSpecies?:  "lierre" | "glycine" | "rosier" | "vigne_vierge";

  // ── Ambiance globale — Blender ────────────────────────────────────────────
  greenDensity?:     "minimal" | "standard" | "lush" | "jungle";
  season?:           "spring" | "summer" | "autumn" | "winter";
  maintenanceLevel?: "wild" | "natural" | "maintained" | "formal";
}

export interface MassingRendererProps {
  buildings:        MassingBuildingModel[];
  parcel?:          Feature<Polygon | MultiPolygon>;
  parkings?:        FeatureCollection<Polygon>;
  placedObjects?:   PlacedObject[];
  reliefData?:      ReliefData | null;
  selectedId:       string | null;
  hoverId:          string | null;
  activeTool:       EditorTool;
  showTerrain:      boolean;
  showSlopeColors?: boolean;
  showWireframe:    boolean;
  vegetation?:      VegetationOptions;
  callbacks:        MassingRendererCallbacks;
}

interface RendererState {
  ctx:          SceneContext | null;
  buildingMats: Map<string, BuildingMaterials>;
  facadeMats:   Map<string, FacadeMaterials>;
  raycaster:    THREE.Raycaster;
  mouse:        THREE.Vector2;
  lastHoverId:  string | null;
  proj:         ReturnType<typeof computeSceneProjection> | null;
  cameraFitted: boolean;
  // ── NOUVEAU : intent dominant de la scène courante ────────────────────────
  lastIntent:   string | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS GÉNÉRAUX — inchangés vs V8.3
// ═══════════════════════════════════════════════════════════════════════════════

function safeArray<T>(v: T[] | undefined | null): T[] {
  return Array.isArray(v) ? v : [];
}

function setShadowsRecursive(object: THREE.Object3D, cast = true, receive = true): void {
  object.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      mesh.castShadow    = cast;
      mesh.receiveShadow = receive;
    }
  });
}

function signedAreaFromPts(pts: Array<{ x: number; y: number }>): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return a / 2;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS FAÇADE PREMIUM — inchangés vs V8.3, sauf frameColorOverride ajouté
// ═══════════════════════════════════════════════════════════════════════════════

function polygonToFacadeEdgesStyled(
  pts: Pt2D[],
  facadeStyleId: string | undefined,
  totalFloors: number,
  scaleMultiplier: number,
): Array<{
  a: { x: number; z: number };
  b: { x: number; z: number };
  overrides?: Record<string, unknown>;
}> {
  if (pts.length < 3) return [];

  const style  = getFacadeStyle(facadeStyleId);
  const center = computeCentroid(pts);

  const rawEdges = pts.map((_, i) => ({
    a: { x: pts[i].x, z: pts[i].z },
    b: { x: pts[(i + 1) % pts.length].x, z: pts[(i + 1) % pts.length].z },
  }));

  return rawEdges.map((edge) => {
    const edgeType = classifyEdge(edge.a, edge.b, center, rawEdges);
    const resolved = resolveStyleForEdge(style, edgeType, totalFloors, scaleMultiplier);

    return {
      a: edge.a,
      b: edge.b,
      overrides: {
        facadeStyle:            facadeStyleId ?? style.id,
        windowRatio:            resolved.windowRatio,
        bayWidth:               resolved.bayWidth * scaleMultiplier,
        hasBanding:             resolved.hasBanding,
        bandingHeight:          resolved.bandingHeight,
        hasBalconies:           resolved.hasBalconies,
        balconyFreq:            resolved.balconyFreq,
        forceOpeningType:       resolved.forceOpeningType,
        balconyConfig:          resolved.balconyConfig,
        loggiaConfig:           resolved.loggiaConfig,
        shadingConfig:          resolved.shadingConfig,
        hasSocle:               resolved.hasSocle,
        hasCornice:             resolved.hasCornice,
        verticalRhythm:         resolved.verticalRhythm,
        frameThicknessScale:    resolved.frameThicknessScale,
        groundOpeningType:      resolved.groundOpeningType,
        upperOpeningType:       resolved.upperOpeningType,
        atticOpeningType:       resolved.atticOpeningType,
        facadeColor:            resolved.facadeColor,
        frameColor:             resolved.frameColor,
        groundBaseColor:        resolved.groundBaseColor,
        atticColor:             resolved.atticColor,
        groundHeightMultiplier: resolved.groundHeightMultiplier,
        atticRetreat:           resolved.atticRetreat,
        bayPattern:             resolved.bayPattern,
        accentColor:            resolved.accentColor,
        loggiaDepthM:           resolved.loggiaDepthM,
      },
    };
  });
}

function createFacadeMaterialsForStyle(
  styleDef: FacadeStyleDefinition,
  // ── V8.5 : couleur de frame depuis renderSpec ─────────────────────────────
  frameColorOverride?: string,
  // ── V8.6 : vitrage et garde-corps depuis renderSpec ───────────────────────
  glazingOverride?: { color: string; opacity: number; roughness: number; metalness: number } | undefined,
  railingColorOverride?: string | undefined,
): FacadeMaterials {
  const fc  = new THREE.Color(styleDef.base.facadeColor);
  const frc = new THREE.Color(frameColorOverride ?? styleDef.base.frameColor);

  const socleColor = styleDef.ground.baseColor
    ? new THREE.Color(styleDef.ground.baseColor)
    : fc.clone().multiplyScalar(0.82);

  // Vitrage : utilise les paramètres résolus si disponibles, sinon valeurs legacy
  const glassColor     = glazingOverride ? new THREE.Color(glazingOverride.color) : new THREE.Color(0x2c3e50);
  const glassOpacity   = glazingOverride?.opacity   ?? 0.82;
  const glassRoughness = glazingOverride?.roughness ?? 0.05;
  const glassMetalness = glazingOverride?.metalness ?? 0.10;

  // Garde-corps : couleur résolue si disponible, sinon dérivée du frame
  const railingColor = railingColorOverride
    ? new THREE.Color(railingColorOverride)
    : frc.clone().multiplyScalar(0.7);

  return {
    glass: new THREE.MeshPhysicalMaterial({
      color: glassColor, metalness: glassMetalness, roughness: glassRoughness,
      transmission: 0.72, transparent: true, opacity: glassOpacity,
      ior: 1.45, reflectivity: 0.6, envMapIntensity: 0.8,
      side: THREE.DoubleSide,
    }),
    frames:    new THREE.MeshStandardMaterial({ color: frc, metalness: 0.75, roughness: 0.35 }),
    sills:     new THREE.MeshStandardMaterial({ color: frc.clone().lerp(fc, 0.3), metalness: 0.2, roughness: 0.7 }),
    balconies: new THREE.MeshStandardMaterial({ color: fc.clone().multiplyScalar(0.82), metalness: 0.05, roughness: 0.85 }),
    railings:  new THREE.MeshStandardMaterial({ color: railingColor, metalness: 0.80, roughness: 0.28 }),
    loggias:   new THREE.MeshStandardMaterial({ color: fc.clone().multiplyScalar(0.88), metalness: 0.05, roughness: 0.9 }),
    shading:   new THREE.MeshStandardMaterial({ color: frc.clone().multiplyScalar(0.85), metalness: 0.72, roughness: 0.3, side: THREE.DoubleSide }),
    banding:   new THREE.MeshStandardMaterial({ color: socleColor, metalness: 0.0, roughness: 0.88 }),
    doors:     new THREE.MeshStandardMaterial({ color: frc.clone().multiplyScalar(0.45), metalness: 0.65, roughness: 0.4 }),
  };
}

function disposeFacadeMaterials(mats: FacadeMaterials): void {
  for (const mat of Object.values(mats)) {
    (mat as THREE.Material).dispose();
  }
}

function injectFacadeMeshes(
  result: FacadeResult,
  mats: FacadeMaterials,
  bldId: string,
  group: THREE.Group,
): void {
  const pairs: Array<[THREE.BufferGeometry[] | undefined, THREE.Material]> = [
    [result.glass,     mats.glass],
    [result.frames,    mats.frames],
    [result.sills,     mats.sills],
    [result.balconies, mats.balconies],
    [result.railings,  mats.railings],
    [result.loggias,   mats.loggias],
    [result.shading,   mats.shading],
    [result.banding,   mats.banding],
    [result.doors,     mats.doors],
  ];
  for (const [geos, mat] of pairs) {
    if (!geos?.length) continue;
    for (const geo of geos) {
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData.bldId = bldId;
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEXTURE HERBE PROCÉDURALE — inchangée vs V8.3
// ═══════════════════════════════════════════════════════════════════════════════

let _grassTexture: THREE.CanvasTexture | null = null;

function getGrassTexture(): THREE.CanvasTexture {
  if (_grassTexture) return _grassTexture;

  const W = 512, H = 512;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    const fallback = new THREE.CanvasTexture(canvas);
    fallback.wrapS = fallback.wrapT = THREE.RepeatWrapping;
    fallback.repeat.set(18, 18);
    fallback.colorSpace = THREE.SRGBColorSpace;
    fallback.needsUpdate = true;
    _grassTexture = fallback;
    return fallback;
  }

  const imgData = ctx.createImageData(W, H);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    const px = (i / 4) % W;
    const py = Math.floor(i / 4 / W);
    const n1 = Math.sin(px * 0.08 + py * 0.13 + 1.2) * Math.cos(px * 0.05 - py * 0.09 + 0.7);
    const n2 = Math.sin(px * 0.22 + py * 0.31 + 3.1) * 0.4;
    const n3 = Math.sin(px * 0.6  + py * 0.8  + 2.0) * 0.15;
    const noise = (n1 + n2 + n3) * 0.5 + 0.5;
    const lum   = 0.72 + noise * 0.32;
    d[i]     = Math.round(Math.min(255, 55  * lum));
    d[i + 1] = Math.round(Math.min(255, 115 * lum));
    d[i + 2] = Math.round(Math.min(255, 40  * lum));
    d[i + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
  ctx.globalAlpha = 0.22;
  for (let i = 0; i < 1800; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    const h = 4 + Math.random() * 10;
    const lean  = (Math.random() - 0.5) * 4;
    const green = Math.round(80 + Math.random() * 60);
    ctx.strokeStyle = `rgb(20,${green},15)`;
    ctx.lineWidth   = 0.6 + Math.random() * 0.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + lean, y - h);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(18, 18);
  tex.anisotropy   = 16;
  tex.colorSpace   = THREE.SRGBColorSpace;
  tex.needsUpdate  = true;
  _grassTexture = tex;
  return tex;
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export const MassingRenderer: React.FC<MassingRendererProps> = ({
  buildings,
  parcel,
  parkings,
  placedObjects,
  reliefData,
  selectedId,
  hoverId,
  activeTool,
  showTerrain,
  showSlopeColors = true,
  showWireframe,
  vegetation,
  callbacks,
}) => {
  const mountRef   = useRef<HTMLDivElement>(null);
  const compassRef = useRef<HTMLDivElement>(null);
  const [compassAngle, setCompassAngle] = useState(0);
  const parcelScenePtsRef = useRef<Pt2D[] | null>(null);

  const stateRef = useRef<RendererState>({
    ctx:          null,
    buildingMats: new Map(),
    facadeMats:   new Map(),
    raycaster:    new THREE.Raycaster(),
    mouse:        new THREE.Vector2(),
    lastHoverId:  null,
    proj:         null,
    cameraFitted: false,
    lastIntent:   null,         // ← NOUVEAU
  });

  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;

  // ── Mount / unmount — INCHANGÉ vs V8.3 ────────────────────────────────────
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const ctx = createSceneContext(mount);
    ctx.renderer.shadowMap.enabled = true;
    ctx.renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
    ctx.renderer.physicallyCorrectLights = false;

    ctx.scene.traverse((obj) => {
      if ((obj as THREE.DirectionalLight).isDirectionalLight) {
        const light = obj as THREE.DirectionalLight;
        light.castShadow = true;
        light.shadow.mapSize.width  = 2048;
        light.shadow.mapSize.height = 2048;
        light.shadow.camera.near    = 0.5;
        light.shadow.camera.far     = 5000;
        light.shadow.bias           = -0.0002;
        light.shadow.normalBias     = 0.015;
      }
    });

    stateRef.current.ctx          = ctx;
    stateRef.current.cameraFitted = false;
    stateRef.current.lastIntent   = null;

    const ro = new ResizeObserver(() => handleResize(ctx, mount));
    ro.observe(mount);

    let rafId    = 0;
    let disposed = false;

    const labelLoop = () => {
      if (disposed || !stateRef.current.ctx) return;
      const currentCtx = stateRef.current.ctx;
      const { camera, renderer } = currentCtx;
      updateLabelPositions(
        currentCtx.labelContainer,
        camera,
        renderer.domElement.clientWidth,
        renderer.domElement.clientHeight,
      );
      const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ");
      setCompassAngle((-euler.y * 180) / Math.PI);
      rafId = requestAnimationFrame(labelLoop);
    };
    rafId = requestAnimationFrame(labelLoop);

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      ro.disconnect();
      stateRef.current.buildingMats.forEach(m => disposeBuildingMaterials(m));
      stateRef.current.buildingMats.clear();
      stateRef.current.facadeMats.forEach(m => disposeFacadeMaterials(m));
      stateRef.current.facadeMats.clear();
      disposeSceneContext(ctx, mount);
      stateRef.current.ctx = null;
    };
  }, []);

  // ── Rebuild scene — V8.3 conservé + INTÉGRATION RENDERSPEC ────────────────
  useEffect(() => {
    const { ctx, buildingMats, facadeMats } = stateRef.current;
    if (!ctx) return;

    disposeGroup(ctx.buildingsGroup);
    disposeGroup(ctx.groundGroup);
    buildingMats.forEach(m => disposeBuildingMaterials(m));
    buildingMats.clear();
    facadeMats.forEach(m => disposeFacadeMaterials(m));
    facadeMats.clear();
    clearLabels(ctx.labelContainer);

    const allPts: [number, number][] = [];

    if (parcel) {
      const ring = parcel.geometry.type === "Polygon"
        ? parcel.geometry.coordinates[0]
        : parcel.geometry.coordinates[0]?.[0];
      if (ring) allPts.push(...(ring as [number, number][]));
    }
    if (reliefData?.bbox) {
      const [bx0, by0, bx1, by1] = reliefData.bbox;
      allPts.push([bx0, by0], [bx1, by1], [bx0, by1], [bx1, by0]);
    }
    if (!allPts.length) {
      for (const b of safeArray(buildings)) {
        const pts = (b?.footprint?.points ?? []) as [number, number][];
        if (pts.length) allPts.push(...pts);
      }
    }
    if (!allPts.length) return;

    const proj = computeSceneProjection(allPts);
    stateRef.current.proj = proj;

    const sampler: TerrainSampler | null =
      showTerrain && reliefData?.elevations?.length
        ? new TerrainSampler(reliefData, proj)
        : null;

    const parcelRingRaw = parcel
      ? (parcel.geometry.type === "Polygon"
          ? parcel.geometry.coordinates[0]
          : parcel.geometry.coordinates[0]?.[0])
      : null;

    const parcelScenePts: Pt2D[] | null = parcelRingRaw
      ? parcelRingRaw.map((c: number[]) => ({
          x: (c[0] - proj.cx) * proj.scale,
          z: (c[1] - proj.cy) * proj.scale,
        }))
      : null;

    parcelScenePtsRef.current = parcelScenePts;

    // ─────────────────────────────────────────────────────────────────────────
    // V8.8 : résolution du landscape depuis le premier bâtiment visible.
    // Pilote sol, végétation, parking. Fallback: undefined → comportements legacy.
    // ─────────────────────────────────────────────────────────────────────────
    type LandscapeResolved = {
      groundMaterial:    string;
      siteFinish:        string;
      vegetationDensity: number;
      treeCount:         number;
      hedgeEnabled:      boolean;
      parkingVisible:    boolean;
    };
    let landscapeResolved: LandscapeResolved | undefined;
    try {
      const firstVisibleBld = safeArray(buildings).find(b => b.visible !== false);
      if (firstVisibleBld) {
        const _lSpec     = ensureBuildingRenderSpec(firstVisibleBld);
        const _lResolved = resolveBuildingRenderSpecSafe(_lSpec);
        landscapeResolved = {
          groundMaterial:    _lResolved.landscape.groundMaterial,
          siteFinish:        _lResolved.landscape.siteFinish,
          vegetationDensity: _lResolved.landscape.vegetationDensity,
          treeCount:         _lResolved.landscape.treeCount,
          hedgeEnabled:      _lResolved.landscape.hedgeEnabled,
          parkingVisible:    _lResolved.landscape.parkingVisible,
        };
      }
    } catch { /* spec absent ou invalide — landscapeResolved reste undefined */ }
    // ─────────────────────────────────────────────────────────────────────────

    if (sampler && parcelScenePts) {
      const terrain = buildParcelTerrainShape(reliefData!, proj, parcelScenePts, showSlopeColors, sampler);
      setShadowsRecursive(terrain, false, true);
      ctx.groundGroup.add(terrain);
      const overlay = buildParcelOverlay(parcelScenePts, sampler);
      setShadowsRecursive(overlay, false, true);
      ctx.groundGroup.add(overlay);
    } else if (parcelScenePts) {
      // V8.8 : couleur du sol selon groundMaterial résolu
      const groundMat   = landscapeResolved?.groundMaterial;
      const useGrass    = !showSlopeColors && (groundMat === "grass" || groundMat == null);
      const groundColor = resolveGroundMaterialColor(groundMat);
      const flat        = buildFlatParcel(parcelScenePts, useGrass, groundColor);
      setShadowsRecursive(flat, false, true);
      ctx.groundGroup.add(flat);
    }
    if (parcelScenePts) buildParcelContour(ctx, parcelScenePts, sampler);

    // ─────────────────────────────────────────────────────────────────────────
    // NOUVEAU : intent dominant → ambiance de scène
    // Collecte les intents de tous les bâtiments visibles, puis applique
    // la config d'éclairage/exposition correspondante sur la scène.
    // ─────────────────────────────────────────────────────────────────────────
    const intentSet = new Set<string>();
    for (const bld of safeArray(buildings)) {
      if (bld.visible === false) continue;
      try {
        const spec = ensureBuildingRenderSpec(bld);
        if (spec.render?.intent) intentSet.add(spec.render.intent);
      } catch { /* bâtiment sans renderSpec — ignoré */ }
    }
    const dominantIntent = pickDominantIntent(intentSet);
    if (dominantIntent !== stateRef.current.lastIntent) {
      const ambiance = buildAmbianceFromIntent(dominantIntent);
      applySceneAmbiance(ctx.scene, ctx.renderer, ambiance);
      stateRef.current.lastIntent = dominantIntent;
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── Bâtiments ─────────────────────────────────────────────────────────────
    const labelDefs: LabelDef[] = [];
    const box3 = new THREE.Box3();

    for (const bld of safeArray(buildings)) {
      if (bld.visible === false) continue;

      const scenePtsTuples = getBuildingScenePts(bld, proj);
      if (!scenePtsTuples || scenePtsTuples.length < 3) continue;

      const footprintV1 = scenePtsTuples.map((p: [number, number]) => ({ x: p[0], y: p[1] }));
      const samplePts: ScenePt[] = scenePtsTuples.map((p: [number, number]) => ({ x: p[0], z: p[1] }));

      const platformY = sampler ? sampler.getAnchorHeight(samplePts, "footprint-avg") : 0;

      const totalF = Math.max(1, totalLevelsCount(bld.levels));
      const hM     = Math.max(2.5, totalHeightM(bld.levels));
      const floorH = (hM / totalF) * proj.zScale;

      const rawSlices = computeVolumeSlices(scenePtsTuples, totalF, bld.style.numSetbacks ?? 0);
      const simpleSlices: SimpleSlice[] = rawSlices.map((s: GeoVolumeSlice) => ({
        pts:       s.pts.map((p: [number, number]) => ({ x: p[0], y: p[1] })),
        fromFloor: s.f0,
        toFloor:   s.f1,
      }));

      // ───────────────────────────────────────────────────────────────────────
      // V8.5/V8.6 : résolution du renderSpec pour ce bâtiment
      // Fallback transparent : si ensureBuildingRenderSpec throw ou retourne
      // un spec invalide, on utilise bld.style.facadeColor comme avant.
      // V8.6 ajoute : glazing, balconies, roof depuis resolved
      // ───────────────────────────────────────────────────────────────────────
      let resolvedFacadeColor:  string = bld.style.facadeColor;
      let resolvedFrameColor:   string | undefined;
      let resolvedGlazing:      { color: string; opacity: number; roughness: number; metalness: number } | undefined;
      let resolvedRailingColor: string | undefined;
      let resolvedBalconies:    { enabled: boolean; frequency: number; depthM: number; type: string; railingType: string } | undefined;
      let resolvedRoofColor:    string | undefined;

      try {
        const spec     = ensureBuildingRenderSpec(bld);
        const resolved = resolveBuildingRenderSpecSafe(spec);

        const intent        = resolved.scene.renderIntent;
        resolvedFacadeColor = applyIntentToColor(resolved.facade.baseColor, intent);
        resolvedFrameColor  = resolved.structure.structureColor;

        // V8.6 — nouveaux champs exploités
        resolvedGlazing = {
          color:     resolved.glazing.color,
          opacity:   resolved.glazing.opacity,
          roughness: resolved.glazing.roughness,
          metalness: resolved.glazing.metalness,
        };
        resolvedRailingColor = resolved.balconies.railingColor;
        resolvedBalconies    = {
          enabled:   resolved.balconies.enabled,
          frequency: resolved.balconies.frequency,
          depthM:    resolved.balconies.depthM,
          type:      resolved.balconies.type,
          railingType: resolved.balconies.railingType,
        };
        resolvedRoofColor = resolved.roof.color;
      } catch {
        // Bâtiment legacy sans renderSpec — on garde les valeurs existantes
      }
      // ───────────────────────────────────────────────────────────────────────

      const v1Result = assembleSimpleBuilding({
        id:           bld.id,
        name:         bld.name,
        slices:       simpleSlices,
        totalFloors:  totalF,
        floorHeight:  floorH,
        platformY,
        facadeColor:  resolvedFacadeColor,   // ← couleur depuis renderSpec
        isSelected:   bld.id === selectedId,
        isHovered:    bld.id === hoverId,
        showWireframe,
      });

      v1Result.group.userData.bldId = bld.id;
      setShadowsRecursive(v1Result.group, true, true);
      ctx.buildingsGroup.add(v1Result.group);

      if (DEBUG_TERRAIN_ANCHORING && sampler) {
        const dbg = new THREE.Group();
        for (const p of samplePts) {
          const s = new THREE.Mesh(
            new THREE.SphereGeometry(0.3, 6, 6),
            new THREE.MeshBasicMaterial({ color: 0xff2200 }),
          );
          s.position.set(p.x, sampler.getHeight(p.x, p.z) + 0.3, p.z);
          dbg.add(s);
        }
        ctx.groundGroup.add(dbg);
      }

      const facadeStyleId = (bld.style as Record<string, unknown>).facadeStyleId as string | undefined;
      if (facadeStyleId && !showWireframe) {
        try {
          const styleDef = getFacadeStyle(facadeStyleId);
          // V8.6 : passe glazing et railingColor depuis le renderSpec
          const facadeMatsForBuilding = createFacadeMaterialsForStyle(
            styleDef,
            resolvedFrameColor,
            resolvedGlazing,
            resolvedRailingColor,
          );
          facadeMats.set(bld.id, facadeMatsForBuilding);
          const footprintPts: Pt2D[] = scenePtsTuples.map((p: [number, number]) => ({ x: p[0], z: p[1] }));
          const styledEdges = polygonToFacadeEdgesStyled(footprintPts, facadeStyleId, totalF, proj.zScale);

          // V8.6 : balconyConfig depuis resolved.balconies si disponible
          // Fallback sur les configs legacy/style def comme avant
          const balconyConfigResolved = resolvedBalconies?.enabled
            ? {
                enabled:          true,
                type:             resolvedBalconies.type,
                depthM:           resolvedBalconies.depthM * proj.zScale,
                thicknessM:       0.12 * proj.zScale,
                guardrailHeightM: 1.02 * proj.zScale,
                frequency:        resolvedBalconies.frequency,
              }
            : undefined;

          const facadeGeo = buildFacadeGeometry({
            edges:             styledEdges,
            totalFloors:       totalF,
            floorHeight:       floorH,
            baseY:             platformY,
            windowRatio:       styleDef.base.windowRatio,
            bayWidth:          styleDef.base.bayWidth * proj.zScale,
            attiqueStartFloor: Math.max(1, totalF - 1),
            // V8.6 : hasBalconies depuis resolved si dispo, sinon styleDef
            hasBalconies:      resolvedBalconies?.enabled ?? styleDef.upper.hasBalconies,
            balconyFreq:       resolvedBalconies?.frequency ?? 1,
            facadeStyle:       facadeStyleId,
            hasBanding:        styleDef.features.banding,
            balconyConfig: balconyConfigResolved ?? (bld.style as Record<string, unknown>).balconyConfig ?? {
              enabled:          styleDef.upper.hasBalconies,
              type:             styleDef.upper.balconyType,
              depthM:           styleDef.upper.balconyDepth * proj.zScale,
              thicknessM:       0.12 * proj.zScale,
              guardrailHeightM: 1.02 * proj.zScale,
              frequency:        1,
            },
            loggiaConfig: (bld.style as Record<string, unknown>).loggiaConfig ?? {
              enabled:   styleDef.features.loggias,
              depthM:    0.9 * proj.zScale,
              frequency: 2,
            },
            shadingConfig: (bld.style as Record<string, unknown>).shadingConfig ?? {
              enabled:   styleDef.features.shading,
              type:      styleDef.features.shadingType,
              openRatio: 0.35,
              frequency: 1,
            },
          }) as FacadeResult;
          injectFacadeMeshes(facadeGeo, facadeMatsForBuilding, bld.id, ctx.buildingsGroup);
        } catch (err) {
          console.warn(`[MassingRenderer V8.6] Facade premium skipped for ${bld.id}:`, err);
        }
      }

      // V8.6 : si la géométrie premium de toiture n'est pas dispo,
      // on applique au moins resolved.roof.color sur le matériau haut du v1Result.
      if (resolvedRoofColor) {
        const roofColor = new THREE.Color(resolvedRoofColor);
        v1Result.group.traverse((obj) => {
          if ((obj as THREE.Mesh).isMesh) {
            const mesh = obj as THREE.Mesh;
            // La dalle de toit dans V1 est identifiée par userData.isRoof
            if (mesh.userData.isRoof === true) {
              const mat = mesh.material as THREE.MeshStandardMaterial;
              if (mat?.isMeshStandardMaterial) {
                mat.color.copy(roofColor);
                mat.needsUpdate = true;
              }
            }
          }
        });
      }

      const bldBox = new THREE.Box3().setFromObject(v1Result.group);
      if (!bldBox.isEmpty()) {
        box3.union(bldBox);
        const ptsGeo = (bld.footprint.points as [number, number][]);
        let sdp: number;
        if (ptsGeo.length >= 3 && Math.abs(ptsGeo[0][0]) <= 180) {
          let geoAreaDeg2 = 0;
          for (let gi = 0; gi < ptsGeo.length; gi++) {
            const gj = (gi + 1) % ptsGeo.length;
            geoAreaDeg2 += ptsGeo[gi][0] * ptsGeo[gj][1] - ptsGeo[gj][0] * ptsGeo[gi][1];
          }
          geoAreaDeg2 = Math.abs(geoAreaDeg2 / 2);
          const avgLatRad = ptsGeo.reduce((s, p) => s + p[1], 0) / ptsGeo.length * Math.PI / 180;
          sdp = totalF * geoAreaDeg2 * 111000 * 111000 * Math.cos(avgLatRad);
        } else {
          const areaScene = Math.abs(signedAreaFromPts(footprintV1));
          sdp = (totalF * areaScene) / (proj.zScale * proj.zScale);
        }
        labelDefs.push({
          bldId:      bld.id,
          worldPos:   v1Result.labelPos,
          text:       `${bld.name} · R+${Math.max(0, totalF - 1)} · ${Math.round(sdp)} m²`,
          isSelected: bld.id === selectedId,
        });
      }
    }

    rebuildLabels(ctx.labelContainer, labelDefs);

    if (parcelScenePts && parcelScenePts.length > 0) {
      const avgY = sampler
        ? parcelScenePts.reduce((s, p) => s + sampler.getHeight(p.x, p.z), 0) / parcelScenePts.length
        : 0;
      for (const p of parcelScenePts) {
        box3.expandByPoint(new THREE.Vector3(p.x, avgY, p.z));
      }
    }

    if (!box3.isEmpty() && !stateRef.current.cameraFitted) {
      const center = new THREE.Vector3();
      const size   = new THREE.Vector3();
      box3.getCenter(center);
      box3.getSize(size);

      // ───────────────────────────────────────────────────────────────────────
      // V8.7 : toutes les vues (y compris aerial_3q) passent par
      // computeCameraFraming si un renderSpec valide + bbox valide existent.
      // fitCameraToBox reste uniquement en fallback si l'une ou l'autre condition
      // n'est pas remplie.
      // ───────────────────────────────────────────────────────────────────────
      const firstBld = safeArray(buildings).find(b => b.visible !== false);
      let usedSpecCamera = false;

      if (firstBld) {
        try {
          const spec       = ensureBuildingRenderSpec(firstBld);
          const cameraView = (spec.render?.cameraView    ?? "aerial_3q") as
            "pedestrian" | "aerial_3q" | "street_front" | "parcel_corner";
          const focalMm    = (spec.render?.focalLengthMm ?? 50) as 35 | 50 | 70;

          const bbox = bboxFromBox3(box3);
          if (bbox) {
            const framing = computeCameraFraming(
              { view: cameraView, focalLengthMm: focalMm },
              bbox,
            );
            applyCameraFraming(ctx.camera, ctx.controls, framing);
            usedSpecCamera = true;
          }
        } catch { /* bbox invalide ou spec absent — fallback ci-dessous */ }
      }

      if (!usedSpecCamera) {
        fitCameraToBox(ctx, center, size);
      }
      // ───────────────────────────────────────────────────────────────────────

      stateRef.current.cameraFitted = true;
    }

    // ── Végétation périmètre — V8.8 : pilotée par resolved.landscape ─────────
    if (parcel && vegetation) {
      const pr = parcel.geometry.type === "Polygon"
        ? parcel.geometry.coordinates[0]
        : parcel.geometry.coordinates[0]?.[0];

      if (pr) {
        const perimPts: Pt2D[] = pr.map((c: number[]) => ({
          x: (c[0] - proj.cx) * proj.scale,
          z: (c[1] - proj.cy) * proj.scale,
        }));

        // Haies : vegetation.showHedges ET resolved.landscape.hedgeEnabled
        // (fallback: hedgeEnabled = true si landscape non résolu → legacy)
        if (vegetation.showHedges && (landscapeResolved?.hedgeEnabled ?? true)) {
          const HEDGE_GATE_MARGIN = 0.4;
          const hedgeGaps: HedgeGap[] = safeArray(placedObjects)
            .filter(o => o.type === "portail")
            .map(o => ({
              x:     o.x,
              z:     o.z,
              width: (o.widthM ?? 3) * proj.zScale + HEDGE_GATE_MARGIN,
            }));
          const hedges = buildSegmentedHedges(
            perimPts,
            (vegetation.hedgeHeight ?? 1.2) * proj.zScale,
            sampler, 2.5, hedgeGaps,
          );
          setShadowsRecursive(hedges, true, true);
          ctx.groundGroup.add(hedges);
        }

        // Arbres : capés par treeCount, filtrés par vegetationDensity
        // (fallback: pas de cap, densité 1.0 → legacy)
        if (vegetation.showTrees) {
          const TREE_SPACING = Math.max(2, (vegetation.treeSpacing ?? 8) * proj.zScale);
          const treeH        = 1.5 * proj.zScale;
          const maxTrees     = landscapeResolved?.treeCount      ?? 9999;
          const treeProb     = landscapeResolved?.vegetationDensity ?? 1.0;
          let   treePlaced   = 0;
          for (const tp of sampleAlongPerimeter(perimPts, TREE_SPACING)) {
            if (treePlaced >= maxTrees) break;
            if (treeProb < 1.0 && Math.random() > treeProb) continue;
            const tree = buildTree(treeH, vegetation.treeType ?? "deciduous");
            tree.position.set(tp.x, 0, tp.z);
            if (sampler) anchorObjectOnTerrain(tree, sampler, [tp], "point", 0);
            setShadowsRecursive(tree, true, true);
            ctx.groundGroup.add(tree);
            treePlaced++;
          }
        }

        if (vegetation.showBushes) {
          for (const pt of perimPts) {
            const bush = buildBush(0, 0, proj.zScale * 0.3);
            bush.position.set(pt.x, 0, pt.z);
            if (sampler) anchorObjectOnTerrain(bush, sampler, [pt], "point", 0);
            setShadowsRecursive(bush, true, true);
            ctx.groundGroup.add(bush);
          }
        }
      }
    }

    // ── Parkings — V8.8 : conditionné par resolved.landscape.parkingVisible ──
    // (fallback: parkingVisible = true si landscape non résolu → legacy)
    if (parkings?.features?.length && (landscapeResolved?.parkingVisible ?? true)) {
      for (const feature of parkings.features) {
        const ring = feature.geometry?.coordinates?.[0];
        if (!ring || ring.length < 3) continue;

        const pts: Pt2D[] = ring.map((c: number[]) => ({
          x: (c[0] - proj.cx) * proj.scale,
          z: (c[1] - proj.cy) * proj.scale,
        }));

        const parking = buildParkingProjectedOnTerrain(pts, proj.zScale, sampler);
        setShadowsRecursive(parking, false, true);
        ctx.groundGroup.add(parking);
      }
    }

    // ── Objets placés — INCHANGÉ vs V8.3 ─────────────────────────────────────
    if (placedObjects?.length) {
      const ts = proj.zScale * 0.5;
      for (const obj of placedObjects) {
        let m: THREE.Object3D | null = null;
        if (obj.type === "tree") {
          m = buildTree(ts * (obj.scale ?? 1), obj.treeType ?? "deciduous");
        } else if (obj.type === "bush") {
          m = buildBush(0, 0, ts * 0.5 * (obj.scale ?? 1));
        } else if (obj.type === "portail") {
          m = buildPortail(
            0, 0, obj.rotationY ?? 0,
            (obj.widthM  ?? 3)   * proj.zScale,
            (obj.heightM ?? 2.5) * proj.zScale,
            obj.color ?? "#1a1a2e",
          );
        }
        if (m) {
          m.position.set(obj.x, 0, obj.z);
          if (obj.rotationY) m.rotation.y = obj.rotationY;
          if (sampler) anchorObjectOnTerrain(m, sampler, [{ x: obj.x, z: obj.z }], "point", 0);
          setShadowsRecursive(m, true, true);
          ctx.groundGroup.add(m);
        }
      }
    }
  }, [
    buildings, parcel, parkings, placedObjects,
    reliefData, selectedId, hoverId,
    showWireframe, showTerrain, showSlopeColors, vegetation,
  ]);

  // ── Mouse events — INCHANGÉS vs V8.3 ──────────────────────────────────────
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const { ctx, raycaster, mouse } = stateRef.current;
      if (!ctx || activeTool !== "select") return;
      const rect = ctx.renderer.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      mouse.x = ((e.clientX - rect.left) / rect.width)  * 2 - 1;
      mouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, ctx.camera);
      const its   = raycaster.intersectObjects(ctx.buildingsGroup.children, true);
      const hitId = its.length > 0 ? findBldId(its[0].object) : null;
      if (hitId !== stateRef.current.lastHoverId) {
        stateRef.current.lastHoverId = hitId;
        cbRef.current.onHoverBuilding(hitId);
      }
      ctx.renderer.domElement.style.cursor = hitId ? "pointer" : "default";
    },
    [activeTool],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const { ctx, raycaster, mouse } = stateRef.current;
      if (!ctx) return;
      const rect = ctx.renderer.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      mouse.x = ((e.clientX - rect.left) / rect.width)  * 2 - 1;
      mouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, ctx.camera);

      if (activeTool === "place_tree" || activeTool === "place_portail") {
        const hit   = new THREE.Vector3();
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const ok    = raycaster.ray.intersectPlane(plane, hit);
        if (!ok || !cbRef.current.onPlaceObject) return;
        if (activeTool === "place_tree") {
          cbRef.current.onPlaceObject({ type: "tree", x: hit.x, z: hit.z, treeType: "deciduous", scale: 1 });
        } else {
          const ppts   = parcelScenePtsRef.current;
          const facade = ppts ? getRightFacadeSegment(ppts) : null;
          if (facade) {
            cbRef.current.onPlaceObject({
              type: "portail",
              x: facade.mid.x, z: facade.mid.z,
              rotationY: facade.angle + Math.PI / 2,
              widthM: 3, heightM: 2.5, color: "#1a1a2e",
            });
          } else {
            cbRef.current.onPlaceObject({
              type: "portail", x: hit.x, z: hit.z,
              rotationY: 0, widthM: 3, heightM: 2.5, color: "#1a1a2e",
            });
          }
        }
        return;
      }

      if (activeTool !== "select") return;
      const its = raycaster.intersectObjects(ctx.buildingsGroup.children, true);
      cbRef.current.onSelectBuilding(its.length > 0 ? findBldId(its[0].object) : null);
    },
    [activeTool],
  );

  // ── Rendu JSX — INCHANGÉ vs V8.3 ──────────────────────────────────────────
  return (
    <div
      ref={mountRef}
      style={{ width: "100%", height: "100%", position: "relative" }}
      onPointerMove={onPointerMove}
      onPointerDown={onPointerDown}
    >
      <div
        ref={compassRef}
        style={{
          position: "absolute", bottom: 14, right: 14, zIndex: 20,
          width: 52, height: 52, pointerEvents: "none", userSelect: "none",
        }}
      >
        <svg viewBox="0 0 52 52" style={{ width: 52, height: 52 }}>
          <circle cx="26" cy="26" r="24" fill="rgba(255,255,255,0.88)" stroke="#e2e8f0" strokeWidth="1.2" />
          {["N", "E", "S", "O"].map((dir, i) => {
            const a   = i * 90 - compassAngle;
            const rad = (a * Math.PI) / 180;
            const tx  = 26 + 13.5 * Math.sin(rad);
            const ty  = 26 - 13.5 * Math.cos(rad);
            return (
              <g key={dir}>
                <line
                  x1={26 + 18 * Math.sin(rad)} y1={26 - 18 * Math.cos(rad)}
                  x2={26 + 22 * Math.sin(rad)} y2={26 - 22 * Math.cos(rad)}
                  stroke={dir === "N" ? "#5247B8" : "#94a3b8"}
                  strokeWidth={dir === "N" ? 2 : 1}
                />
                <text
                  x={tx} y={ty + 3.5} textAnchor="middle"
                  fontSize={dir === "N" ? 8 : 6}
                  fontWeight={dir === "N" ? "700" : "400"}
                  fill={dir === "N" ? "#5247B8" : "#94a3b8"}
                  fontFamily="system-ui, sans-serif"
                >
                  {dir}
                </text>
              </g>
            );
          })}
          <g transform={`rotate(${-compassAngle} 26 26)`}>
            <polygon points="26,8 29.5,26 22.5,26" fill="#5247B8" />
            <polygon points="26,44 29.5,26 22.5,26" fill="#cbd5e1" />
            <circle cx="26" cy="26" r="2.5" fill="white" stroke="#5247B8" strokeWidth="1.2" />
          </g>
        </svg>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS GÉOMÉTRIE — INCHANGÉS vs V8.3
// ═══════════════════════════════════════════════════════════════════════════════

function findBldId(obj: THREE.Object3D): string | null {
  let c: THREE.Object3D | null = obj;
  while (c) {
    if (c.userData?.bldId) return c.userData.bldId as string;
    c = c.parent;
  }
  return null;
}

function pointInPolygon(pt: Pt2D, poly: Pt2D[]): boolean {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, zi = poly[i].z;
    const xj = poly[j].x, zj = poly[j].z;
    if (((zi > pt.z) !== (zj > pt.z)) && pt.x < ((xj - xi) * (pt.z - zi)) / (zj - zi) + xi) {
      ins = !ins;
    }
  }
  return ins;
}

interface SegmentInfo {
  a:      Pt2D;
  b:      Pt2D;
  mid:    Pt2D;
  length: number;
  angle:  number;
}

function getParcelSegments(pts: Pt2D[]): SegmentInfo[] {
  return pts.map((a, i) => {
    const b = pts[(i + 1) % pts.length];
    return {
      a, b,
      mid:    { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 },
      length: Math.hypot(b.x - a.x, b.z - a.z),
      angle:  Math.atan2(b.z - a.z, b.x - a.x),
    };
  });
}

function getRightFacadeSegment(pts: Pt2D[]): SegmentInfo | null {
  const segs = getParcelSegments(pts).filter(s => s.length > 1);
  if (!segs.length) return null;
  return segs.reduce((best, s) => s.mid.x > best.mid.x ? s : best, segs[0]);
}

function sampleAlongPerimeter(pts: Pt2D[], spacing: number): Pt2D[] {
  const result: Pt2D[] = [];
  for (let i = 0; i < pts.length; i++) {
    const j  = (i + 1) % pts.length;
    const ax = pts[i].x, az = pts[i].z;
    const bx = pts[j].x, bz = pts[j].z;
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.01) continue;
    const n = Math.max(1, Math.round(len / spacing));
    for (let s = 0; s < n; s++) {
      result.push({
        x: ax + ((bx - ax) * (s + 0.5)) / n,
        z: az + ((bz - az) * (s + 0.5)) / n,
      });
    }
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SOL / TERRAIN — INCHANGÉ vs V8.3 sauf groundMaterialColor (V8.8)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Retourne la couleur hex Three.js correspondant à un groundMaterial résolu.
 * Utilisé pour la parcelle plate quand le terrain relief n'est pas disponible.
 */
function resolveGroundMaterialColor(groundMaterial: string | undefined): number {
  switch (groundMaterial) {
    case "gravel":   return 0xC8C0A8;
    case "pavers":   return 0xB8B4AE;
    case "concrete": return 0xC0C0BC;
    case "asphalt":  return 0x6A6860;
    case "grass":
    default:         return 0xE8E4DC;
  }
}

function buildFlatParcel(pts: Pt2D[], grassMode: boolean, groundColor?: number): THREE.Group {
  const shape = new THREE.Shape();
  pts.forEach((p, i) => {
    if (i === 0) shape.moveTo(p.x, p.z);
    else shape.lineTo(p.x, p.z);
  });
  shape.closePath();

  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(Math.PI / 2);
  geo.computeBoundingBox();

  const bbox = geo.boundingBox!;
  const pos  = geo.getAttribute("position");
  const uv   = new Float32Array(pos.count * 2);
  const sw   = Math.max(bbox.max.x - bbox.min.x, 0.001);
  const sd   = Math.max(bbox.max.z - bbox.min.z, 0.001);

  for (let i = 0; i < pos.count; i++) {
    uv[i * 2]     = (pos.getX(i) - bbox.min.x) / sw;
    uv[i * 2 + 1] = (pos.getZ(i) - bbox.min.z) / sd;
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));

  const mat = grassMode
    ? new THREE.MeshLambertMaterial({ map: getGrassTexture() })
    : new THREE.MeshLambertMaterial({ color: groundColor ?? 0xe8e4dc });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow    = false;

  const g = new THREE.Group();
  g.add(mesh);
  return g;
}

function buildParcelContour(ctx: SceneContext, pts: Pt2D[], sampler: TerrainSampler | null): void {
  const v3 = pts.map(p => new THREE.Vector3(
    p.x,
    sampler ? sampler.getHeight(p.x, p.z) + TERRAIN_CONTOUR_OFFSET : TERRAIN_CONTOUR_OFFSET,
    p.z,
  ));
  ctx.groundGroup.add(
    new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(v3),
      new THREE.LineBasicMaterial({ color: 0x5247b8, opacity: 0.9, transparent: true }),
    ),
  );
}

function slopeColor(deg: number): [number, number, number] {
  if (deg < 5)  return [0.28, 0.85, 0.45];
  if (deg < 15) return [0.97, 0.82, 0.18];
  if (deg < 25) return [0.97, 0.55, 0.14];
  if (deg < 35) return [0.92, 0.22, 0.22];
  return [0.48, 0.06, 0.06];
}

function buildParcelTerrainShape(
  reliefData: ReliefData,
  proj: ReturnType<typeof computeSceneProjection>,
  parcelPts: Pt2D[],
  showSlopeColors: boolean,
  sampler: TerrainSampler,
): THREE.Group {
  const { nx, ny } = reliefData;
  const subdivide  = Math.max(1, Math.min(6, Math.floor(Math.max(nx, ny) / 8)));

  const dPts: Pt2D[] = [];
  for (let i = 0; i < parcelPts.length; i++) {
    const j = (i + 1) % parcelPts.length;
    for (let s = 0; s < subdivide; s++) {
      const t = s / subdivide;
      dPts.push({
        x: parcelPts[i].x * (1 - t) + parcelPts[j].x * t,
        z: parcelPts[i].z * (1 - t) + parcelPts[j].z * t,
      });
    }
  }

  const shape = new THREE.Shape();
  dPts.forEach((p, i) => {
    if (i === 0) shape.moveTo(p.x, p.z);
    else shape.lineTo(p.x, p.z);
  });
  shape.closePath();

  const sg = new THREE.ShapeGeometry(shape);
  const pa = sg.getAttribute("position");
  const nV = pa.count;

  const pos   = new Float32Array(nV * 3);
  const col   = new Float32Array(nV * 3);
  const uvArr = new Float32Array(nV * 2);

  let minX = Infinity, maxX = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < nV; i++) {
    minX = Math.min(minX, pa.getX(i)); maxX = Math.max(maxX, pa.getX(i));
    minZ = Math.min(minZ, pa.getY(i)); maxZ = Math.max(maxZ, pa.getY(i));
  }
  const sw = Math.max(maxX - minX, 0.001);
  const sd = Math.max(maxZ - minZ, 0.001);

  for (let i = 0; i < nV; i++) {
    const sx = pa.getX(i);
    const sz = pa.getY(i);
    const sy = sampler.getHeight(sx, sz);

    pos[i * 3]     = sx;
    pos[i * 3 + 1] = sy;
    pos[i * 3 + 2] = sz;

    if (showSlopeColors) {
      const eps   = Math.max(proj.scale * 0.003, 0.01);
      const h1    = sampler.getHeight(sx + eps, sz);
      const h2    = sampler.getHeight(sx - eps, sz);
      const h3    = sampler.getHeight(sx, sz + eps);
      const h4    = sampler.getHeight(sx, sz - eps);
      const cellM = Math.max(eps * sampler.getElevScale(), 0.01);
      const dzdx  = (h1 - h2) / (2 * cellM);
      const dzdy  = (h3 - h4) / (2 * cellM);
      const deg   = (Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy)) * 180) / Math.PI;
      const [r, g, bv] = slopeColor(deg);
      col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = bv;
    } else {
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 1;
    }

    uvArr[i * 2]     = (sx - minX) / sw;
    uvArr[i * 2 + 1] = (sz - minZ) / sd;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color",    new THREE.BufferAttribute(col, 3));
  geo.setAttribute("uv",       new THREE.BufferAttribute(uvArr, 2));

  const idx = sg.getIndex();
  if (idx) geo.setIndex(idx);
  geo.computeVertexNormals();

  const mat = showSlopeColors
    ? new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })
    : new THREE.MeshLambertMaterial({ map: getGrassTexture(), side: THREE.DoubleSide });

  const terrainMesh = new THREE.Mesh(geo, mat);
  terrainMesh.renderOrder   = 0;
  terrainMesh.receiveShadow = true;
  terrainMesh.castShadow    = false;

  const g = new THREE.Group();
  g.add(terrainMesh);
  return g;
}

function buildParcelOverlay(parcelPts: Pt2D[], sampler: TerrainSampler): THREE.Group {
  if (parcelPts.length < 3) return new THREE.Group();

  const pos: number[] = [];
  const cx = parcelPts.reduce((s, p) => s + p.x, 0) / parcelPts.length;
  const cz = parcelPts.reduce((s, p) => s + p.z, 0) / parcelPts.length;
  const cy = sampler.getHeight(cx, cz) + PARCEL_OVERLAY_OFFSET;

  for (let i = 0; i < parcelPts.length; i++) {
    const j  = (i + 1) % parcelPts.length;
    const ax = parcelPts[i].x, az = parcelPts[i].z;
    const ay = sampler.getHeight(ax, az) + PARCEL_OVERLAY_OFFSET;
    const bx = parcelPts[j].x, bz = parcelPts[j].z;
    const by = sampler.getHeight(bx, bz) + PARCEL_OVERLAY_OFFSET;
    pos.push(cx, cy, cz, ax, ay, az, bx, by, bz);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color: 0x5247b8, transparent: true, opacity: 0.05,
    side: THREE.DoubleSide, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
  }));
  mesh.renderOrder   = 1;
  mesh.receiveShadow = false;
  mesh.castShadow    = false;

  const g = new THREE.Group();
  g.add(mesh);
  return g;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ARBRES — INCHANGÉ vs V8.3
// ═══════════════════════════════════════════════════════════════════════════════

function buildTree(totalH: number, type: TreeType = "deciduous"): THREE.Group {
  const g      = new THREE.Group();
  const trunkH = totalH * 0.28;
  const crownH = totalH * 0.72;
  const trunkR = totalH * 0.04;

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(trunkR * 0.7, trunkR, trunkH, 6),
    new THREE.MeshLambertMaterial({ color: 0x6b4226 }),
  );
  trunk.position.y           = trunkH / 2;
  trunk.castShadow           = trunk.receiveShadow = true;
  g.add(trunk);

  if (type === "deciduous") {
    const crown = new THREE.Mesh(
      new THREE.SphereGeometry(crownH * 0.55, 7, 6),
      new THREE.MeshLambertMaterial({ color: 0x2d6b2a }),
    );
    crown.position.y = trunkH + crownH * 0.45;
    crown.castShadow = crown.receiveShadow = true;
    g.add(crown);
  } else {
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(crownH * 0.35, crownH, 7),
      new THREE.MeshLambertMaterial({ color: 0x1e4d2b }),
    );
    cone.position.y = trunkH + crownH / 2;
    cone.castShadow = cone.receiveShadow = true;
    g.add(cone);
  }
  return g;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HAIES — INCHANGÉ vs V8.3
// ═══════════════════════════════════════════════════════════════════════════════

function buildSegmentedHedges(
  perimPts: Pt2D[],
  hedgeH: number,
  sampler: TerrainSampler | null,
  segLen = 2.5,
  gaps: HedgeGap[] = [],
): THREE.Group {
  const group  = new THREE.Group();
  const mat    = new THREE.MeshLambertMaterial({ color: 0x2d5a1b });
  const hedgeW = hedgeH * 0.5;

  for (let i = 0; i < perimPts.length; i++) {
    const j  = (i + 1) % perimPts.length;
    const ax = perimPts[i].x, az = perimPts[i].z;
    const bx = perimPts[j].x, bz = perimPts[j].z;
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.01) continue;

    const nSegs = Math.max(1, Math.round(len / segLen));
    const dx    = (bx - ax) / nSegs;
    const dz    = (bz - az) / nSegs;
    const angle = Math.atan2(bz - az, bx - ax);

    for (let s = 0; s < nSegs; s++) {
      const mx = ax + dx * (s + 0.5);
      const mz = az + dz * (s + 0.5);

      const isInGap = gaps.some(gap => {
        const halfW   = gap.width / 2;
        const segNorm = Math.max(len / nSegs, 0.001);
        const segUx   = dx / segNorm;
        const segUz   = dz / segNorm;
        const gpx     = gap.x - mx;
        const gpz     = gap.z - mz;
        return (
          Math.abs(gpx * segUx + gpz * segUz) <= halfW &&
          Math.abs(gpx * -segUz + gpz * segUx) <= 3.0
        );
      });
      if (isInGap) continue;

      const h   = hedgeH + (Math.random() - 0.5) * hedgeH * 0.12;
      const geo = new THREE.BoxGeometry(segLen * 1.05, h, hedgeW);
      geo.translate(0, h / 2, 0);

      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(mx, sampler ? sampler.getHeight(mx, mz) : 0, mz);
      mesh.rotation.y          = -angle;
      mesh.castShadow          = mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
  return group;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PARKING — INCHANGÉ vs V8.3
// ═══════════════════════════════════════════════════════════════════════════════

function buildParkingProjectedOnTerrain(
  pts: Pt2D[],
  zScale: number,
  sampler: TerrainSampler | null,
): THREE.Group {
  if (pts.length < 3) return new THREE.Group();

  const group = new THREE.Group();
  const cx    = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cz    = pts.reduce((s, p) => s + p.z, 0) / pts.length;
  const getTopH = (x: number, z: number) =>
    sampler ? sampler.getHeight(x, z) + PARKING_TOP_OFFSET : PARKING_TOP_OFFSET;

  const cY        = getTopH(cx, cz);
  const positions: number[] = [];

  for (let i = 0; i < pts.length; i++) {
    const j  = (i + 1) % pts.length;
    const ax = pts[i].x, az = pts[i].z, ay = getTopH(ax, az);
    const bx = pts[j].x, bz = pts[j].z, by = getTopH(bx, bz);
    positions.push(cx, cY, cz, ax, ay, az, bx, by, bz);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();

  const asphalt = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color: 0x5a554d, transparent: true, opacity: 0.55,
    side: THREE.DoubleSide, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
  }));
  asphalt.renderOrder   = 3;
  asphalt.receiveShadow = true;
  asphalt.castShadow    = false;
  group.add(asphalt);

  const { angle, cx: ocx, cz: ocz } = getParkingOrientation(pts);
  const cosA = Math.cos(-angle);
  const sinA = Math.sin(-angle);

  const local = pts.map(p => ({
    u: (p.x - ocx) * cosA - (p.z - ocz) * sinA,
    v: (p.x - ocx) * sinA + (p.z - ocz) * cosA,
  }));

  const minU = Math.min(...local.map(p => p.u));
  const maxU = Math.max(...local.map(p => p.u));
  const minV = Math.min(...local.map(p => p.v));
  const maxV = Math.max(...local.map(p => p.v));

  const bayW = 2.5 * zScale;
  const bayD = Math.min(5 * zScale, (maxV - minV) * 0.44);

  const nSpots = Math.min(500, Math.floor((maxU - minU) / Math.max(bayW, 0.001)));
  const aspect = (maxU - minU) / Math.max(maxV - minV, 0.001);

  if (nSpots >= 2 && aspect <= 12 && bayD >= zScale * 1.5) {
    const wm = new THREE.LineBasicMaterial({ color: 0xffffff });
    const ym = new THREE.MeshBasicMaterial({
      color: 0xffcc00, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8,
    });

    const usedLen = nSpots * bayW;
    const uStart  = (minU + maxU) / 2 - usedLen / 2;
    const lineH   = (lx: number, lz: number) => getTopH(lx, lz) + PARKING_MARKING_OFFSET;

    for (const side of [-1, 1] as const) {
      const fV = side === 1 ? maxV : minV;
      const bV = fV - side * bayD;

      const bl: THREE.Vector3[] = [];
      for (let i = 0; i <= nSpots; i++) {
        const w = l2w(ocx, ocz, angle, uStart + i * bayW, bV);
        if (pointInPolygon({ x: w.x, z: w.z }, pts)) {
          bl.push(new THREE.Vector3(w.x, lineH(w.x, w.z), w.z));
        }
      }
      if (bl.length >= 2) {
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(bl), wm);
        line.renderOrder = 4;
        group.add(line);
      }

      for (let i = 0; i <= nSpots; i++) {
        const wF = l2w(ocx, ocz, angle, uStart + i * bayW, fV);
        const wB = l2w(ocx, ocz, angle, uStart + i * bayW, bV);
        if (!pointInPolygon({ x: wF.x, z: wF.z }, pts) && !pointInPolygon({ x: wB.x, z: wB.z }, pts)) continue;
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(wF.x, lineH(wF.x, wF.z), wF.z),
            new THREE.Vector3(wB.x, lineH(wB.x, wB.z), wB.z),
          ]),
          wm,
        );
        line.renderOrder = 4;
        group.add(line);
      }
    }

    const midV = (minV + maxV) / 2;
    const nA   = Math.max(1, Math.floor(nSpots / 4));
    for (let i = 0; i < nA; i++) {
      const w = l2w(ocx, ocz, angle, uStart + ((i + 0.5) / nA) * usedLen, midV);
      if (pointInPolygon({ x: w.x, z: w.z }, pts)) {
        buildArrow(group, w.x, w.z, angle, zScale * 0.5, ym, lineH(w.x, w.z) + 0.01);
      }
    }
  }

  return group;
}

function getParkingOrientation(pts: Pt2D[]) {
  let maxLen = 0, angle = 0;
  for (let i = 0; i < pts.length; i++) {
    const j  = (i + 1) % pts.length;
    const dx = pts[j].x - pts[i].x;
    const dz = pts[j].z - pts[i].z;
    const len = Math.hypot(dx, dz);
    if (len > maxLen) { maxLen = len; angle = Math.atan2(dz, dx); }
  }
  return {
    angle,
    cx: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    cz: pts.reduce((s, p) => s + p.z, 0) / pts.length,
  };
}

function l2w(cx: number, cz: number, angle: number, u: number, v: number) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return { x: cx + u * c - v * s, z: cz + u * s + v * c };
}

function buildArrow(
  group: THREE.Group, x: number, z: number,
  angle: number, size: number, mat: THREE.Material, y = 0.05,
): void {
  const shape = new THREE.Shape();
  shape.moveTo(0, size * 0.55);
  shape.lineTo(-size * 0.28, -size * 0.28);
  shape.lineTo(0, -size * 0.1);
  shape.lineTo(size * 0.28, -size * 0.28);
  shape.closePath();

  const geo  = new THREE.ShapeGeometry(shape);
  geo.rotateX(Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.rotation.y = -angle;
  group.add(mesh);
}

function buildPortail(
  x: number, z: number, rotY: number,
  w: number, h: number, color: string,
): THREE.Group {
  const g   = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rotY;

  const mat = new THREE.MeshLambertMaterial({ color });
  const pw  = Math.max(w * 0.07, 0.08);

  for (const px of [-w / 2, w / 2]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(pw, h, pw), mat);
    m.position.set(px, h / 2, 0);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  }

  const lm = new THREE.Mesh(new THREE.BoxGeometry(w + pw * 2, pw, pw), mat);
  lm.position.set(0, h + pw / 2, 0);
  lm.castShadow = lm.receiveShadow = true;
  g.add(lm);

  const bm = new THREE.MeshLambertMaterial({ color: darkenHex(color, 0.6) });
  const nb = Math.max(3, Math.round(w / (pw * 2.5)));
  const bh = h * 0.88;
  const bg = new THREE.CylinderGeometry(pw * 0.22, pw * 0.22, bh, 5);
  const st = w / (nb + 1);

  for (let i = 1; i <= nb; i++) {
    const bar = new THREE.Mesh(bg, bm);
    bar.position.set(-w / 2 + st * i, bh / 2, 0);
    bar.castShadow = bar.receiveShadow = true;
    g.add(bar);
  }
  return g;
}

function darkenHex(hex: string, f: number): number {
  const c = parseInt(hex.replace("#", ""), 16);
  return (
    (Math.round(((c >> 16) & 0xff) * f) << 16) |
    (Math.round(((c >> 8)  & 0xff) * f) <<  8) |
     Math.round(( c        & 0xff) * f)
  );
}

export default MassingRenderer;