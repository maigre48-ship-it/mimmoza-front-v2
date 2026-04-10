// massingFacadeEngine.ts — V6.5 residential_modern premium
// ═══════════════════════════════════════════════════════════════════════════════
// V6.5 par rapport à V6.4 :
//   - EdgeFacadeOverrides + ResolvedEdgeConfig étendus (couleurs, retreat, groundMul)
//   - constantes MODERN_* pour loggias, balcons, écrans, pergolas
//   - helpers addModernVerticalScreen / addModernSolidVerticalPanel / addModernAtticPergola
//   - retrait attique dynamique via edgeCfg.atticRetreat
//   - residential_modern : loggias profondes, balcons larges, écrans verticaux,
//     panneaux accent, pergolas attique — vrai langage architectural
// ═══════════════════════════════════════════════════════════════════════════════

import * as THREE from "three";
import type { Pt2D } from "./massingGeometry3d";
import {
  addIndividualBalcony,
  addContinuousBalcony,
  addLoggiaGeo,
  addShading,
} from "./massingFacadeDetails";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES PUBLICS
// ═══════════════════════════════════════════════════════════════════════════════

export type FacadeOpeningType =
  | "window"
  | "french_window"
  | "sliding_bay"
  | "loggia_opening"
  | "retail_opening"
  | "none";

export type BalconyType =
  | "none"
  | "individual"
  | "continuous"
  | "corner"
  | "recessed";

export interface BalconyConfig {
  enabled: boolean;
  type: BalconyType;
  depthM: number;
  thicknessM: number;
  guardrailHeightM: number;
  frequency?: number;
  levels?: number[];
}

export interface LoggiaConfig {
  enabled: boolean;
  depthM: number;
  levels?: number[];
  frequency?: number;
}

export type ShadingDeviceType =
  | "none"
  | "roller_blind"
  | "brise_soleil"
  | "sliding_panel"
  | "awning"
  | "swing_shutters"
  | "roller_shutter";

export interface ShadingConfig {
  enabled: boolean;
  type: ShadingDeviceType;
  openRatio?: number;
  levels?: number[];
  frequency?: number;
  color?: number;
}

export interface FacadeConfig {
  edges: any[];
  totalFloors: number;
  floorHeight: number;
  baseY: number;
  windowRatio: number;
  bayWidth: number;
  attiqueStartFloor: number;
  hasBalconies: boolean;
  balconyFreq: number;
  facadeStyle: string;
  hasBanding: boolean;
  balconyConfig?: BalconyConfig;
  loggiaConfig?: LoggiaConfig;
  shadingConfig?: ShadingConfig;
}

export interface FacadeResult {
  glass: THREE.BufferGeometry[];
  frames: THREE.BufferGeometry[];
  sills: THREE.BufferGeometry[];
  balconies: THREE.BufferGeometry[];
  railings: THREE.BufferGeometry[];
  loggias: THREE.BufferGeometry[];
  shading: THREE.BufferGeometry[];
  banding: THREE.BufferGeometry[];
  doors: THREE.BufferGeometry[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES PARTAGÉS
// ═══════════════════════════════════════════════════════════════════════════════

export type FacadePt = { x: number; z: number };

export interface LocalFacadeAxes {
  ux: number; uz: number; nx: number; nz: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES INTERNES
// ═══════════════════════════════════════════════════════════════════════════════

type BayRole = "plain" | "balcony" | "loggia" | "accent";

type EdgeLikePoint =
  | { x: number; z: number }
  | { x: number; y: number }
  | { x: number; z?: number; y?: number };

interface EdgeFacadeOverrides {
  facadeStyle?: string;
  windowRatio?: number;
  bayWidth?: number;
  hasBanding?: boolean;
  hasBalconies?: boolean;
  balconyFreq?: number;
  balconyConfig?: Partial<BalconyConfig>;
  loggiaConfig?: Partial<LoggiaConfig>;
  shadingConfig?: Partial<ShadingConfig>;
  attiqueStartFloor?: number;
  forceOpeningType?: FacadeOpeningType;
  disabled?: boolean;
  hasSocle?: boolean;
  hasCornice?: boolean;
  verticalRhythm?: boolean;
  frameThicknessScale?: number;
  bandingHeight?: number;
  groundOpeningType?: FacadeOpeningType;
  upperOpeningType?: FacadeOpeningType;
  atticOpeningType?: FacadeOpeningType;
  bayPattern?: BayRole[];
  accentColor?: string;
  loggiaDepthM?: number;
  // V6.5
  facadeColor?: string;
  frameColor?: string;
  groundBaseColor?: string;
  atticColor?: string;
  groundHeightMultiplier?: number;
  atticRetreat?: number;
}

interface NormalizedEdge {
  a: FacadePt;
  b: FacadePt;
  overrides?: EdgeFacadeOverrides;
}

interface LevelRules {
  openingType: FacadeOpeningType;
  widthRatio: number;
  heightM: number;
  silHeightM: number;
  glazingSetback: number;
  frameThick: number;
  outerFrameThick: number;
  revealDepth: number;
}

interface ResolvedEdgeConfig {
  facadeStyle: string;
  windowRatio: number;
  bayWidth: number;
  attiqueStartFloor: number;
  hasBalconies: boolean;
  balconyFreq: number;
  hasBanding: boolean;
  balconyConfig?: BalconyConfig;
  loggiaConfig?: LoggiaConfig;
  shadingConfig?: ShadingConfig;
  forceOpeningType?: FacadeOpeningType;
  hasSocle: boolean;
  hasCornice: boolean;
  verticalRhythm: boolean;
  frameThicknessScale: number;
  bandingHeight: number;
  groundOpeningType?: FacadeOpeningType;
  upperOpeningType?: FacadeOpeningType;
  atticOpeningType?: FacadeOpeningType;
  bayPattern?: BayRole[];
  accentColor: string;
  loggiaDepthM: number;
  // V6.5
  facadeColor: string;
  frameColor: string;
  groundBaseColor: string;
  atticColor: string;
  groundHeightMultiplier: number;
  atticRetreat: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTES
// ═══════════════════════════════════════════════════════════════════════════════

const ATTIC_RETREAT_DEFAULT = 0.18;
const OUTER_FRAME_BOOST = 1.22;
const REVEAL_BOOST = 1.18;
const SILL_EXTRA_DEPTH = 0.025;
const SILL_EXTRA_HEIGHT = 0.008;

const SOCLE_H_RATIO = 0.10;
const SOCLE_D_RATIO = 0.028;
const CORNICHE_H_RATIO = 0.050;
const CORNICHE_D_RATIO = 0.042;
const CORNICHE_FILET_H_RATIO = 0.028;
const CORNICHE_FILET_D_RATIO = 0.028;
const PILASTER_W_RATIO = 0.048;
const PILASTER_D_RATIO = 0.030;

const ACCENT_PANEL_W = 0.12;
const ACCENT_PANEL_D = 0.06;
const ACCENT_PANEL_MARGIN = 0.08;

// V6.5 — residential_modern premium
const MODERN_LOGGIA_EXTRA_DEPTH = 0.28;
const MODERN_BALCONY_EXTRA_DEPTH = 0.22;
const MODERN_SCREEN_DEPTH = 0.09;
const MODERN_SCREEN_THICK = 0.03;
const MODERN_SCREEN_GAP = 0.11;
const MODERN_PANEL_DEPTH = 0.065;
const MODERN_PANEL_MARGIN = 0.08;
const MODERN_ATTIC_PERGOLA_DEPTH = 1.55;
const MODERN_ATTIC_PERGOLA_THICK = 0.045;
const MODERN_ATTIC_PERGOLA_STEP = 0.28;

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS — exportés pour massingFacadeDetails
// ═══════════════════════════════════════════════════════════════════════════════

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function safeNumber(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function safeBool(v: unknown, fallback = false): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function getPtZ(pt: any): number {
  if (typeof pt?.z === "number") return pt.z;
  if (typeof pt?.y === "number") return pt.y;
  return 0;
}

function toFacadePt(pt: EdgeLikePoint | null | undefined): FacadePt {
  return { x: typeof pt?.x === "number" ? pt.x : 0, z: getPtZ(pt) };
}

export function facadeRotation(ux: number, uz: number): THREE.Matrix4 {
  return new THREE.Matrix4().makeRotationY(-Math.atan2(uz, ux));
}

export function facadeAngle(ux: number, uz: number): number {
  return -Math.atan2(uz, ux);
}

export function translateOnFacade(
  cx: number, cz: number, axes: LocalFacadeAxes,
  tangentOffset: number, normalOffset: number,
): { x: number; z: number } {
  return {
    x: cx + axes.ux * tangentOffset + axes.nx * normalOffset,
    z: cz + axes.uz * tangentOffset + axes.nz * normalOffset,
  };
}

export function pushBox(
  arr: THREE.BufferGeometry[],
  w: number, h: number, d: number,
  centerX: number, centerY: number, centerZ: number,
  ux: number, uz: number,
): void {
  if (w <= 0 || h <= 0 || d <= 0) return;
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.applyMatrix4(facadeRotation(ux, uz));
  geo.translate(centerX, centerY, centerZ);
  arr.push(geo);
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS — merge configs
// ═══════════════════════════════════════════════════════════════════════════════

function mergeBalconyConfig(base?: BalconyConfig, override?: Partial<BalconyConfig>): BalconyConfig | undefined {
  if (!base && !override) return undefined;
  return {
    enabled: override?.enabled ?? base?.enabled ?? false,
    type: override?.type ?? base?.type ?? "none",
    depthM: safeNumber(override?.depthM, safeNumber(base?.depthM, 1)),
    thicknessM: safeNumber(override?.thicknessM, safeNumber(base?.thicknessM, 0.12)),
    guardrailHeightM: safeNumber(override?.guardrailHeightM, safeNumber(base?.guardrailHeightM, 1.02)),
    frequency: safeNumber(override?.frequency, safeNumber(base?.frequency, 1)),
    levels: Array.isArray(override?.levels) ? override?.levels : Array.isArray(base?.levels) ? base?.levels : undefined,
  };
}

function mergeLoggiaConfig(base?: LoggiaConfig, override?: Partial<LoggiaConfig>): LoggiaConfig | undefined {
  if (!base && !override) return undefined;
  return {
    enabled: override?.enabled ?? base?.enabled ?? false,
    depthM: safeNumber(override?.depthM, safeNumber(base?.depthM, 0.9)),
    frequency: safeNumber(override?.frequency, safeNumber(base?.frequency, 2)),
    levels: Array.isArray(override?.levels) ? override?.levels : Array.isArray(base?.levels) ? base?.levels : undefined,
  };
}

function mergeShadingConfig(base?: ShadingConfig, override?: Partial<ShadingConfig>): ShadingConfig | undefined {
  if (!base && !override) return undefined;
  return {
    enabled: override?.enabled ?? base?.enabled ?? false,
    type: override?.type ?? base?.type ?? "none",
    openRatio: safeNumber(override?.openRatio, safeNumber(base?.openRatio, 0.35)),
    frequency: safeNumber(override?.frequency, safeNumber(base?.frequency, 1)),
    color: typeof override?.color === "number" ? override.color : base?.color,
    levels: Array.isArray(override?.levels) ? override?.levels : Array.isArray(base?.levels) ? base?.levels : undefined,
  };
}

function resolveEdgeConfig(globalConfig: FacadeConfig, overrides?: EdgeFacadeOverrides): ResolvedEdgeConfig {
  return {
    facadeStyle: overrides?.facadeStyle ?? globalConfig.facadeStyle,
    windowRatio: clamp(safeNumber(overrides?.windowRatio, globalConfig.windowRatio), 0.2, 0.95),
    bayWidth: Math.max(1.1, safeNumber(overrides?.bayWidth, globalConfig.bayWidth)),
    attiqueStartFloor: Math.max(0, Math.floor(safeNumber(overrides?.attiqueStartFloor, globalConfig.attiqueStartFloor))),
    hasBalconies: safeBool(overrides?.hasBalconies, globalConfig.hasBalconies),
    balconyFreq: Math.max(1, Math.floor(safeNumber(overrides?.balconyFreq, globalConfig.balconyFreq))),
    hasBanding: safeBool(overrides?.hasBanding, globalConfig.hasBanding),
    balconyConfig: mergeBalconyConfig(globalConfig.balconyConfig, overrides?.balconyConfig),
    loggiaConfig: mergeLoggiaConfig(globalConfig.loggiaConfig, overrides?.loggiaConfig),
    shadingConfig: mergeShadingConfig(globalConfig.shadingConfig, overrides?.shadingConfig),
    forceOpeningType: overrides?.forceOpeningType,
    hasSocle: safeBool(overrides?.hasSocle, true),
    hasCornice: safeBool(overrides?.hasCornice, true),
    verticalRhythm: safeBool(overrides?.verticalRhythm, false),
    frameThicknessScale: safeNumber(overrides?.frameThicknessScale, 1),
    bandingHeight: safeNumber(overrides?.bandingHeight, 0.15),
    groundOpeningType: overrides?.groundOpeningType,
    upperOpeningType: overrides?.upperOpeningType,
    atticOpeningType: overrides?.atticOpeningType,
    bayPattern: Array.isArray(overrides?.bayPattern) && overrides!.bayPattern!.length > 0 ? overrides!.bayPattern as BayRole[] : undefined,
    accentColor: typeof overrides?.accentColor === "string" ? overrides!.accentColor : "#8B6B45",
    loggiaDepthM: safeNumber(overrides?.loggiaDepthM, 0.9),
    // V6.5
    facadeColor: typeof overrides?.facadeColor === "string" ? overrides.facadeColor : "#E5DDD0",
    frameColor: typeof overrides?.frameColor === "string" ? overrides.frameColor : "#3A3A3A",
    groundBaseColor: typeof overrides?.groundBaseColor === "string" ? overrides.groundBaseColor : "#C2BAA8",
    atticColor: typeof overrides?.atticColor === "string" ? overrides.atticColor : "#50504A",
    groundHeightMultiplier: safeNumber(overrides?.groundHeightMultiplier, 1.15),
    atticRetreat: safeNumber(overrides?.atticRetreat, ATTIC_RETREAT_DEFAULT),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// NORMALISATION DES EDGES
// ═══════════════════════════════════════════════════════════════════════════════

function maybeReadOverrides(raw: any): EdgeFacadeOverrides | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  for (const c of [raw.overrides, raw.facadeOverrides, raw.facade, raw.meta?.facade, raw.meta?.overrides, raw.style]) {
    if (c && typeof c === "object") return c as EdgeFacadeOverrides;
  }
  return undefined;
}

function normalizeEdges(rawEdges: any[]): NormalizedEdge[] {
  if (!Array.isArray(rawEdges) || rawEdges.length === 0) return [];
  const out: NormalizedEdge[] = [];
  for (const raw of rawEdges) {
    if (!raw) continue;
    let a: FacadePt | null = null;
    let b: FacadePt | null = null;
    if (Array.isArray(raw) && raw.length >= 2) { a = toFacadePt(raw[0]); b = toFacadePt(raw[1]); }
    else if (raw.a && raw.b) { a = toFacadePt(raw.a); b = toFacadePt(raw.b); }
    else if (raw.p0 && raw.p1) { a = toFacadePt(raw.p0); b = toFacadePt(raw.p1); }
    else if (raw.start && raw.end) { a = toFacadePt(raw.start); b = toFacadePt(raw.end); }
    if (!a || !b) continue;
    out.push({ a, b, overrides: maybeReadOverrides(raw) });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════
// RÈGLES ARCHITECTURALES
// ═══════════════════════════════════════════════════════════════════════════════

function getLevelRules(
  floor: number, totalFloors: number, attiqueStart: number,
  windowRatio: number, hasBalcony: boolean,
  facadeStyle?: string, forcedOpeningType?: FacadeOpeningType, ftScale = 1,
): LevelRules {
  const isRdc = floor === 0;
  const isAttique = attiqueStart > 0 ? floor >= attiqueStart : floor >= Math.max(1, totalFloors - 1);
  const fBst = OUTER_FRAME_BOOST * ftScale;
  const rBst = REVEAL_BOOST;

  if (forcedOpeningType && forcedOpeningType !== "none") {
    switch (forcedOpeningType) {
      case "retail_opening":
        return { openingType: "retail_opening", widthRatio: Math.min(0.9, windowRatio + 0.14), heightM: 2.65, silHeightM: 0, glazingSetback: 0.13, frameThick: 0.05 * ftScale, outerFrameThick: 0.075 * fBst, revealDepth: 0.18 * rBst };
      case "sliding_bay":
        return { openingType: "sliding_bay", widthRatio: Math.min(0.92, windowRatio + 0.14), heightM: 2.26, silHeightM: 0.14, glazingSetback: 0.22, frameThick: 0.04 * ftScale, outerFrameThick: 0.055 * fBst, revealDepth: 0.22 * rBst };
      case "french_window":
        return { openingType: "french_window", widthRatio: Math.min(0.84, windowRatio + 0.08), heightM: 2.14, silHeightM: 0.1, glazingSetback: 0.19, frameThick: 0.038 * ftScale, outerFrameThick: 0.052 * fBst, revealDepth: 0.19 * rBst };
      case "window": default:
        return { openingType: "window", widthRatio: Math.max(0.52, Math.min(0.78, windowRatio)), heightM: 1.58, silHeightM: 0.7, glazingSetback: 0.21, frameThick: 0.042 * ftScale, outerFrameThick: 0.06 * fBst, revealDepth: 0.21 * rBst };
    }
  }

  if (isRdc) return { openingType: "retail_opening", widthRatio: Math.min(0.88, windowRatio + 0.14), heightM: 2.65, silHeightM: 0, glazingSetback: 0.13, frameThick: 0.05 * ftScale, outerFrameThick: 0.075 * fBst, revealDepth: 0.18 * rBst };
  if (isAttique) return { openingType: "sliding_bay", widthRatio: Math.min(0.92, windowRatio + 0.14), heightM: 2.28, silHeightM: 0.14, glazingSetback: 0.22, frameThick: 0.04 * ftScale, outerFrameThick: 0.055 * fBst, revealDepth: 0.22 * rBst };
  if (facadeStyle === "curtain_wall") return { openingType: "sliding_bay", widthRatio: Math.min(0.95, windowRatio + 0.2), heightM: 2.3, silHeightM: 0.08, glazingSetback: 0.16, frameThick: 0.035 * ftScale, outerFrameThick: 0.045 * fBst, revealDepth: 0.17 * rBst };
  if (hasBalcony) return { openingType: "french_window", widthRatio: Math.min(0.82, windowRatio + 0.08), heightM: 2.16, silHeightM: 0.1, glazingSetback: 0.19, frameThick: 0.038 * ftScale, outerFrameThick: 0.052 * fBst, revealDepth: 0.19 * rBst };

  return { openingType: "window", widthRatio: Math.max(0.52, Math.min(0.78, windowRatio)), heightM: 1.58, silHeightM: 0.7, glazingSetback: 0.21, frameThick: 0.042 * ftScale, outerFrameThick: 0.06 * fBst, revealDepth: 0.21 * rBst };
}

// ═══════════════════════════════════════════════════════════════════════════════
// V6.5 — HELPERS RESIDENTIAL MODERN
// ═══════════════════════════════════════════════════════════════════════════════

function addModernVerticalScreen(
  r: FacadeResult,
  p: {
    cx: number; cz: number; ux: number; uz: number; nx: number; nz: number;
    floorBaseY: number; floorHeight: number;
    offsetAlong: number; screenDepth: number; screenWidth: number;
  },
): void {
  const { cx, cz, ux, uz, nx, nz, floorBaseY, floorHeight, offsetAlong, screenDepth, screenWidth } = p;
  const slatH = Math.max(0.4, floorHeight - MODERN_PANEL_MARGIN * 2);
  const nSlats = Math.max(3, Math.floor(screenWidth / MODERN_SCREEN_GAP));

  for (let i = 0; i < nSlats; i++) {
    const localOffset = offsetAlong - screenWidth / 2 + (i + 0.5) * (screenWidth / nSlats);
    const gx = cx + ux * localOffset + nx * (screenDepth * 0.5);
    const gz = cz + uz * localOffset + nz * (screenDepth * 0.5);
    pushBox(r.shading, MODERN_SCREEN_THICK, slatH, screenDepth, gx, floorBaseY + MODERN_PANEL_MARGIN + slatH / 2, gz, ux, uz);
  }
}

function addModernSolidVerticalPanel(
  r: FacadeResult,
  p: {
    cx: number; cz: number; ux: number; uz: number; nx: number; nz: number;
    floorBaseY: number; floorHeight: number;
    offsetAlong: number; panelWidth: number; panelDepth: number;
  },
): void {
  const { cx, cz, ux, uz, nx, nz, floorBaseY, floorHeight, offsetAlong, panelWidth, panelDepth } = p;
  const ph = Math.max(0.5, floorHeight - MODERN_PANEL_MARGIN * 2);
  const gx = cx + ux * offsetAlong + nx * (panelDepth * 0.5);
  const gz = cz + uz * offsetAlong + nz * (panelDepth * 0.5);
  pushBox(r.frames, panelWidth, ph, panelDepth, gx, floorBaseY + MODERN_PANEL_MARGIN + ph / 2, gz, ux, uz);
}

function addModernAtticPergola(
  r: FacadeResult,
  p: {
    cx: number; cz: number; ux: number; uz: number; nx: number; nz: number;
    winW: number; wyTop: number;
  },
): void {
  const { cx, cz, ux, uz, nx, nz, winW, wyTop } = p;
  const depth = MODERN_ATTIC_PERGOLA_DEPTH;
  const nSlats = Math.max(3, Math.floor(depth / MODERN_ATTIC_PERGOLA_STEP));

  for (let i = 0; i < nSlats; i++) {
    const d = (i + 0.5) * (depth / nSlats);
    const gx = cx + nx * (d * 0.5);
    const gz = cz + nz * (d * 0.5);
    pushBox(r.shading, winW + 0.18, MODERN_ATTIC_PERGOLA_THICK, MODERN_ATTIC_PERGOLA_THICK, gx, wyTop + 0.22, gz, ux, uz);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTRUCTEUR PRINCIPAL — V6.5
// ═══════════════════════════════════════════════════════════════════════════════

export function buildFacadeGeometry(config: FacadeConfig): FacadeResult {
  const result: FacadeResult = {
    glass: [], frames: [], sills: [], balconies: [],
    railings: [], loggias: [], shading: [], banding: [], doors: [],
  };

  const totalFloors = Math.max(1, Math.floor(safeNumber(config.totalFloors, 1)));
  const fhM = Math.max(2.2, safeNumber(config.floorHeight, 2.8));
  const baseY = safeNumber(config.baseY, 0);
  const buildingTopY = baseY + totalFloors * fhM;

  const edges = normalizeEdges(config.edges);
  if (!edges.length) return result;

  for (const edge of edges) {
    if (edge.overrides?.disabled) continue;

    const ptA = edge.a;
    const ptB = edge.b;
    const dx = ptB.x - ptA.x;
    const dz = ptB.z - ptA.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.5) continue;

    const ux = dx / len;
    const uz = dz / len;
    const nx = -uz;
    const nz = ux;

    const edgeCfg = resolveEdgeConfig(config, edge.overrides);
    const bayWidth = Math.max(1.1, edgeCfg.bayWidth);
    const nBays = Math.max(1, Math.floor(len / bayWidth));
    const actBayW = len / nBays;
    const ftScale = edgeCfg.frameThicknessScale;

    const pattern = edgeCfg.bayPattern;
    const patternLen = pattern?.length ?? 0;

    for (let floor = 0; floor < totalFloors; floor++) {
      const floorBaseY = baseY + floor * fhM;
      const isGround = floor === 0;
      const isAttique =
        edgeCfg.attiqueStartFloor > 0
          ? floor >= edgeCfg.attiqueStartFloor
          : floor >= Math.max(1, totalFloors - 1);

      // V6.5 — retrait attique dynamique
      let normalOffset = 0;
      if (isAttique && totalFloors >= 3) {
        normalOffset = -Math.max(ATTIC_RETREAT_DEFAULT, edgeCfg.atticRetreat);
      }

      let stratumOpeningType: FacadeOpeningType | undefined;
      if (edgeCfg.forceOpeningType) {
        stratumOpeningType = edgeCfg.forceOpeningType;
      } else if (isGround && edgeCfg.groundOpeningType) {
        stratumOpeningType = edgeCfg.groundOpeningType;
      } else if (isAttique && edgeCfg.atticOpeningType) {
        stratumOpeningType = edgeCfg.atticOpeningType;
      } else if (!isGround && !isAttique && edgeCfg.upperOpeningType) {
        stratumOpeningType = edgeCfg.upperOpeningType;
      }

      const balconyLevels =
        edgeCfg.balconyConfig?.levels && edgeCfg.balconyConfig.levels.length > 0
          ? edgeCfg.balconyConfig.levels.includes(floor)
          : floor > 0 && floor < totalFloors - 1;

      const useBalconyGlobal =
        edgeCfg.hasBalconies &&
        !!edgeCfg.balconyConfig?.enabled &&
        balconyLevels &&
        (edgeCfg.balconyConfig.type === "individual" || edgeCfg.balconyConfig.type === "continuous" || edgeCfg.balconyConfig.type === "corner" || edgeCfg.balconyConfig.type === "recessed");

      const hasLoggiaGlobal =
        !!edgeCfg.loggiaConfig?.enabled &&
        (!edgeCfg.loggiaConfig.levels || edgeCfg.loggiaConfig.levels.includes(floor));

      const loggiaDepth = Math.max(0.42, edgeCfg.loggiaDepthM * (fhM / 2.8));

      const hasShade =
        !!edgeCfg.shadingConfig?.enabled &&
        edgeCfg.shadingConfig.type !== "none" &&
        (!edgeCfg.shadingConfig.levels || edgeCfg.shadingConfig.levels.includes(floor));

      for (let bay = 0; bay < nBays; bay++) {
        const tc = (bay + 0.5) / nBays;
        const cx = ptA.x + dx * tc + nx * normalOffset;
        const cz = ptA.z + dz * tc + nz * normalOffset;

        const bayRole: BayRole = (pattern && patternLen > 0 && !isGround)
          ? pattern[bay % patternLen]
          : "plain";

        const isCourant = !isGround && !isAttique;
        const forceLoggia  = isCourant && bayRole === "loggia";
        const forceBalcony = isCourant && bayRole === "balcony";
        const forceAccent  = isCourant && bayRole === "accent";
        const forcePlain   = isCourant && bayRole === "plain";

        const isModern = edgeCfg.facadeStyle === "residential_modern";

        const useBalconyThisBay =
          forceBalcony ||
          (!forceLoggia &&
            !forceAccent &&
            !forcePlain &&
            useBalconyGlobal &&
            bay % Math.max(1, edgeCfg.balconyFreq) === 0);

        const rules = getLevelRules(
          floor, totalFloors, edgeCfg.attiqueStartFloor,
          forceAccent ? edgeCfg.windowRatio * 0.65 : edgeCfg.windowRatio,
          useBalconyThisBay,
          edgeCfg.facadeStyle,
          stratumOpeningType,
          ftScale,
        );

        const scale = fhM / 2.8;
        const winH = rules.heightM * scale;
        const silH = rules.silHeightM * scale;
        const setb = Math.max(0.04, rules.glazingSetback * scale);
        const frameT = Math.max(0.02, rules.frameThick * scale);
        const outerFrameT = Math.max(0.028, rules.outerFrameThick * scale);
        const revealDepth = Math.max(setb + 0.02, rules.revealDepth * scale);
        const winW = Math.max(0.5, actBayW * rules.widthRatio);

        const wyBot = floorBaseY + silH;
        const wyTop = wyBot + winH;
        if (wyTop > floorBaseY + fhM * 0.98) continue;

        // V6.5 — modern accent: panneau + écrans verticaux AVANT la baie
        if (isModern && isCourant && forceAccent) {
          addModernSolidVerticalPanel(result, {
            cx, cz, ux, uz, nx, nz,
            floorBaseY, floorHeight: fhM,
            offsetAlong: 0,
            panelWidth: actBayW * 0.92,
            panelDepth: MODERN_PANEL_DEPTH,
          });
          addModernVerticalScreen(result, {
            cx, cz, ux, uz, nx, nz,
            floorBaseY, floorHeight: fhM,
            offsetAlong: 0,
            screenDepth: MODERN_SCREEN_DEPTH,
            screenWidth: actBayW * 0.82,
          });
        }

        // ── Loggia ────────────────────────────────────────────────────
        const loggiaByFreq =
          hasLoggiaGlobal &&
          rules.openingType !== "window" &&
          bay % Math.max(1, safeNumber(edgeCfg.loggiaConfig?.frequency, 2)) === 1;

        if (forceLoggia || (loggiaByFreq && !forceBalcony && !forceAccent && !forcePlain)) {
          const modernLoggiaDepth = isModern ? loggiaDepth + MODERN_LOGGIA_EXTRA_DEPTH : loggiaDepth;
          const modernLoggiaWidth = isModern ? Math.min(actBayW * 0.92, winW + actBayW * 0.08) : winW;

          addLoggiaGeo(result, {
            cx, cz, ux, uz, nx, nz,
            wyBot, wyTop,
            winW: modernLoggiaWidth,
            loggiaDepth: modernLoggiaDepth,
            frameT: isModern ? frameT * 1.15 : frameT,
            outerFrameT: isModern ? outerFrameT * 1.2 : outerFrameT,
            revealDepth: isModern ? revealDepth * 1.08 : revealDepth,
          });

          if (isModern) {
            addModernVerticalScreen(result, {
              cx, cz, ux, uz, nx, nz,
              floorBaseY, floorHeight: fhM,
              offsetAlong: modernLoggiaWidth / 2 + 0.11,
              screenDepth: MODERN_SCREEN_DEPTH,
              screenWidth: 0.34,
            });
          }
          continue;
        }

        // ── Accent: fenêtre réduite + écrans verticaux ────────────────
        if (forceAccent) {
          const reducedWinW = Math.max(0.62, winW * 0.62);

          addGlazingUnit(result, {
            cx, cz, ux, uz, nx, nz,
            wyBot, wyTop,
            winW: reducedWinW,
            frameT, outerFrameT, setb, revealDepth,
            openingType: "window",
          });

          addModernVerticalScreen(result, {
            cx, cz, ux, uz, nx, nz,
            floorBaseY, floorHeight: fhM,
            offsetAlong: -actBayW * 0.24,
            screenDepth: MODERN_SCREEN_DEPTH,
            screenWidth: 0.34,
          });
          addModernVerticalScreen(result, {
            cx, cz, ux, uz, nx, nz,
            floorBaseY, floorHeight: fhM,
            offsetAlong: actBayW * 0.24,
            screenDepth: MODERN_SCREEN_DEPTH,
            screenWidth: 0.34,
          });
          continue;
        }

        // ── Baie vitrée standard ──────────────────────────────────────
        addGlazingUnit(result, {
          cx, cz, ux, uz, nx, nz,
          wyBot, wyTop, winW,
          frameT, outerFrameT, setb, revealDepth,
          openingType: rules.openingType,
        });

        // V6.5 — panneau vertical discret sur travées plain modern
        if (isModern && isCourant && forcePlain) {
          addModernSolidVerticalPanel(result, {
            cx, cz, ux, uz, nx, nz,
            floorBaseY, floorHeight: fhM,
            offsetAlong: actBayW * 0.34,
            panelWidth: 0.16,
            panelDepth: MODERN_PANEL_DEPTH * 0.8,
          });
        }

        if (rules.openingType === "retail_opening") {
          addGroundDoor(result, {
            cx, cz, ux, uz, nx, nz,
            wyBot, wyTop,
            winW: Math.min(winW * 0.58, actBayW * 0.56),
            revealDepth,
          });
        }

        // ── Shading ───────────────────────────────────────────────────
        if (hasShade && bay % Math.max(1, safeNumber(edgeCfg.shadingConfig?.frequency, 1)) === 0) {
          addShading(result, {
            cx, cz, ux, uz, nx, nz,
            wyBot, wyTop, winW, fhM,
            type: edgeCfg.shadingConfig?.type ?? "brise_soleil",
            openRatio: clamp(safeNumber(edgeCfg.shadingConfig?.openRatio, 0.35), 0, 1),
            color: edgeCfg.shadingConfig?.color,
          });
        }

        // ── Balcon individuel ─────────────────────────────────────────
        const balconyEligible =
          (forceBalcony || useBalconyThisBay) &&
          (rules.openingType === "french_window" || rules.openingType === "sliding_bay") &&
          edgeCfg.balconyConfig &&
          edgeCfg.balconyConfig.type !== "continuous";

        if (balconyEligible && edgeCfg.balconyConfig) {
          const depS = Math.max(
            0.4,
            safeNumber(edgeCfg.balconyConfig.depthM, 1.0) * scale + (isModern ? MODERN_BALCONY_EXTRA_DEPTH : 0),
          );
          const thkS = Math.max(0.05, safeNumber(edgeCfg.balconyConfig.thicknessM, 0.12) * scale);
          const railH = Math.max(0.9, safeNumber(edgeCfg.balconyConfig.guardrailHeightM, 1.02) * scale);

          const balconyW = isModern
            ? Math.min(actBayW * 0.96, winW + actBayW * 0.18)
            : (winW + actBayW * 0.12);

          addIndividualBalcony(result, {
            cx, cz, ux, uz, nx, nz,
            wyBot: floorBaseY,
            winW: balconyW,
            depthS: depS, thickS: thkS, railH,
          });

          if (isModern) {
            addModernVerticalScreen(result, {
              cx, cz, ux, uz, nx, nz,
              floorBaseY, floorHeight: fhM,
              offsetAlong: balconyW / 2 + 0.08,
              screenDepth: MODERN_SCREEN_DEPTH,
              screenWidth: 0.30,
            });
          }
        }

        // V6.5 — pergola attique modern
        if (isModern && isAttique && (forceBalcony || forceLoggia || forcePlain) && bay % 2 === 0) {
          addModernAtticPergola(result, {
            cx, cz, ux, uz, nx, nz,
            winW: Math.min(actBayW * 0.92, winW + 0.18),
            wyTop,
          });
        }
      }

      // ── Balcon continu ──────────────────────────────────────────────────
      if (useBalconyGlobal && edgeCfg.balconyConfig && edgeCfg.balconyConfig.type === "continuous" && !pattern) {
        const scaleB = fhM / 2.8;
        const depS = Math.max(0.4, safeNumber(edgeCfg.balconyConfig.depthM, 1) * scaleB);
        const thkS = Math.max(0.05, safeNumber(edgeCfg.balconyConfig.thicknessM, 0.12) * scaleB);
        const railH = Math.max(0.9, safeNumber(edgeCfg.balconyConfig.guardrailHeightM, 1.02) * scaleB);
        const bPtA: FacadePt = normalOffset !== 0 ? { x: ptA.x + nx * normalOffset, z: ptA.z + nz * normalOffset } : ptA;
        const bPtB: FacadePt = normalOffset !== 0 ? { x: ptB.x + nx * normalOffset, z: ptB.z + nz * normalOffset } : ptB;
        addContinuousBalcony(result, { ptA: bPtA, ptB: bPtB, len, ux, uz, nx, nz, floorBaseY, depthS: depS, thickS: thkS, railH });
      }

      // ── Bandeaux ────────────────────────────────────────────────────────
      if (edgeCfg.hasBanding && floor > 0) {
        const bandH = Math.max(0.03, edgeCfg.bandingHeight * (fhM / 2.8));
        const bandD = Math.max(0.03, fhM * 0.011);
        const bNormOff = normalOffset !== 0 ? normalOffset : 0;
        const bGeo = new THREE.BoxGeometry(len, bandH, bandD);
        bGeo.applyMatrix4(facadeRotation(ux, uz));
        bGeo.translate(ptA.x + dx / 2 + nx * (bandD * 0.55 + bNormOff), floorBaseY + bandH / 2, ptA.z + dz / 2 + nz * (bandD * 0.55 + bNormOff));
        result.banding.push(bGeo);
      }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // ÉLÉMENTS ARCHITECTURAUX PAR EDGE
    // ═════════════════════════════════════════════════════════════════════════

    const totalHeight = buildingTopY - baseY;

    if (edgeCfg.hasSocle && len > 0.8) {
      const socleH = Math.max(0.08, fhM * SOCLE_H_RATIO);
      const socleD = Math.max(0.03, fhM * SOCLE_D_RATIO);
      const socle = new THREE.BoxGeometry(len + 0.02, socleH, socleD);
      socle.applyMatrix4(facadeRotation(ux, uz));
      socle.translate(ptA.x + dx / 2 + nx * socleD * 0.6, baseY + socleH / 2, ptA.z + dz / 2 + nz * socleD * 0.6);
      result.banding.push(socle);
    }

    if (edgeCfg.hasCornice && len > 0.8) {
      const corniH = Math.max(0.06, fhM * CORNICHE_H_RATIO);
      const corniD = Math.max(0.04, fhM * CORNICHE_D_RATIO);
      const corni = new THREE.BoxGeometry(len + 0.04, corniH, corniD);
      corni.applyMatrix4(facadeRotation(ux, uz));
      corni.translate(ptA.x + dx / 2 + nx * corniD * 0.7, buildingTopY - corniH / 2, ptA.z + dz / 2 + nz * corniD * 0.7);
      result.banding.push(corni);

      const filetH = Math.max(0.03, fhM * CORNICHE_FILET_H_RATIO);
      const filetD = Math.max(0.03, fhM * CORNICHE_FILET_D_RATIO);
      const filet = new THREE.BoxGeometry(len + 0.02, filetH, filetD);
      filet.applyMatrix4(facadeRotation(ux, uz));
      filet.translate(ptA.x + dx / 2 + nx * filetD * 0.5, buildingTopY - corniH - filetH / 2 - 0.005, ptA.z + dz / 2 + nz * filetD * 0.5);
      result.banding.push(filet);
    }

    if (edgeCfg.verticalRhythm && len > 2.0) {
      const pilW = Math.max(0.08, fhM * PILASTER_W_RATIO);
      const pilD = Math.max(0.04, fhM * PILASTER_D_RATIO);
      for (const pt of [ptA, ptB]) {
        const geo = new THREE.BoxGeometry(pilW, totalHeight, pilD);
        geo.applyMatrix4(facadeRotation(ux, uz));
        geo.translate(pt.x + nx * pilD * 0.6, baseY + totalHeight / 2, pt.z + nz * pilD * 0.6);
        result.frames.push(geo);
      }
      if (len > bayWidth * 2.5) {
        const nPilasters = Math.max(1, Math.floor(len / bayWidth)) - 1;
        for (let p = 1; p <= nPilasters; p++) {
          const t = p / (nPilasters + 1);
          const geo = new THREE.BoxGeometry(pilW, totalHeight, pilD);
          geo.applyMatrix4(facadeRotation(ux, uz));
          geo.translate(ptA.x + dx * t + nx * pilD * 0.6, baseY + totalHeight / 2, ptA.z + dz * t + nz * pilD * 0.6);
          result.frames.push(geo);
        }
      }
    }
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// BAIE VITRÉE
// ═══════════════════════════════════════════════════════════════════════════════

interface GlazingP {
  cx: number; cz: number; ux: number; uz: number; nx: number; nz: number;
  wyBot: number; wyTop: number; winW: number;
  frameT: number; outerFrameT: number; setb: number; revealDepth: number;
  openingType: FacadeOpeningType;
}

function addGlazingUnit(r: FacadeResult, p: GlazingP): void {
  const { cx, cz, ux, uz, nx, nz, wyBot, wyTop, winW, frameT, outerFrameT, setb, revealDepth, openingType } = p;
  const winH = wyTop - wyBot;
  if (winH < 0.05 || winW < 0.1) return;

  const axes: LocalFacadeAxes = { ux, uz, nx, nz };
  const rotM = facadeRotation(ux, uz);
  const midY = wyBot + winH / 2;
  const outerW = winW + outerFrameT * 2;
  const outerH = winH + outerFrameT * 2;
  const revealD = Math.max(revealDepth, setb + 0.03);
  const innerW = Math.max(0.08, winW - frameT * 2);
  const innerH = Math.max(0.08, winH - frameT * 2.1);
  const glassD = 0.022;
  const revealFaceOffset = -revealD / 2;

  for (const s of [-1, 1] as const) {
    const c = translateOnFacade(cx, cz, axes, s * (outerW / 2 - outerFrameT / 2), revealFaceOffset);
    pushBox(r.frames, outerFrameT, outerH, revealD, c.x, midY, c.z, ux, uz);
  }
  { const c = translateOnFacade(cx, cz, axes, 0, revealFaceOffset); pushBox(r.frames, outerW, outerFrameT, revealD, c.x, wyTop + outerFrameT / 2, c.z, ux, uz); }
  { const bottomH = openingType === "window" ? Math.max(outerFrameT, winH * 0.12) : outerFrameT; const c = translateOnFacade(cx, cz, axes, 0, revealFaceOffset); pushBox(r.frames, outerW, bottomH, revealD, c.x, wyBot - bottomH / 2, c.z, ux, uz); }

  const innerFrameOffset = -setb;
  for (const s of [-1, 1] as const) { const c = translateOnFacade(cx, cz, axes, s * (winW / 2 - frameT / 2), innerFrameOffset); pushBox(r.frames, frameT, winH, Math.max(0.05, revealD * 0.68), c.x, midY, c.z, ux, uz); }
  { const c = translateOnFacade(cx, cz, axes, 0, innerFrameOffset); pushBox(r.frames, winW, frameT, Math.max(0.05, revealD * 0.68), c.x, wyTop - frameT / 2, c.z, ux, uz); }
  { const c = translateOnFacade(cx, cz, axes, 0, -setb - glassD * 0.5); const glass = new THREE.BoxGeometry(innerW, innerH, glassD); glass.applyMatrix4(rotM); glass.translate(c.x, midY, c.z); r.glass.push(glass); }

  if (openingType === "sliding_bay" || openingType === "retail_opening") {
    const mullionCount = winW > 3.4 ? 2 : winW > 1.8 ? 1 : 0;
    for (let i = 0; i < mullionCount; i++) { const t = ((i + 1) / (mullionCount + 1) - 0.5) * innerW; const c = translateOnFacade(cx, cz, axes, t, -setb - glassD * 0.25); pushBox(r.frames, Math.max(frameT * 0.75, 0.025), innerH, glassD * 1.25, c.x, midY, c.z, ux, uz); }
  }

  { const sillW = outerW + 0.06; const sillH = Math.max(frameT * 0.9, 0.028) + SILL_EXTRA_HEIGHT; const sillD = Math.max(revealD * 0.95, 0.09) + SILL_EXTRA_DEPTH; const c = translateOnFacade(cx, cz, axes, 0, -sillD * 0.18); pushBox(r.sills, sillW, sillH, sillD, c.x, wyBot + sillH * 0.42, c.z, ux, uz); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PORTE / HALL RDC
// ═══════════════════════════════════════════════════════════════════════════════

interface DoorP {
  cx: number; cz: number; ux: number; uz: number; nx: number; nz: number;
  wyBot: number; wyTop: number; winW: number; revealDepth: number;
}

function addGroundDoor(r: FacadeResult, p: DoorP): void {
  const { cx, cz, ux, uz, nx, nz, wyBot, wyTop, winW, revealDepth } = p;
  const axes: LocalFacadeAxes = { ux, uz, nx, nz };
  const rotM = facadeRotation(ux, uz);
  const h = Math.max(2.08, (wyTop - wyBot) * 0.84);
  const w = Math.max(1.0, winW);
  const hallW = Math.min(w * 1.55, w + 0.9);
  const doorD = 0.038; const frameW = 0.06;
  const transomH = Math.max(0.22, h * 0.13);
  const revealD = Math.max(revealDepth, 0.15);

  for (const s of [-1, 1] as const) { const c = translateOnFacade(cx, cz, axes, s * (hallW / 2 - frameW / 2), -revealD / 2); pushBox(r.frames, frameW, h + transomH + 0.12, revealD, c.x, wyBot + (h + transomH + 0.12) / 2, c.z, ux, uz); }
  { const c = translateOnFacade(cx, cz, axes, 0, -revealD / 2); pushBox(r.frames, hallW, frameW, revealD, c.x, wyBot + h + transomH + frameW / 2, c.z, ux, uz); }
  { const c = translateOnFacade(cx, cz, axes, 0, -doorD * 0.8); const leaf = new THREE.BoxGeometry(w, h, doorD); leaf.applyMatrix4(rotM); leaf.translate(c.x, wyBot + h / 2, c.z); r.doors.push(leaf); }
  { const c = translateOnFacade(cx, cz, axes, 0, -doorD * 0.95); const transom = new THREE.BoxGeometry(Math.max(w * 0.92, 0.7), transomH, 0.022); transom.applyMatrix4(rotM); transom.translate(c.x, wyBot + h + transomH / 2 + 0.03, c.z); r.glass.push(transom); }
  for (const s of [-1, 1] as const) { const c = translateOnFacade(cx, cz, axes, s * (w / 2 + frameW / 2), -doorD * 1.05); pushBox(r.frames, frameW, h, doorD * 1.4, c.x, wyBot + h / 2, c.z, ux, uz); }
  { const c = translateOnFacade(cx, cz, axes, 0, -doorD * 1.05); pushBox(r.frames, w + frameW * 2, frameW, doorD * 1.4, c.x, wyBot + h + frameW / 2, c.z, ux, uz); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT UTILITAIRE
// ═══════════════════════════════════════════════════════════════════════════════

export function segmentAngle(ptA: Pt2D, ptB: Pt2D): number {
  const a = toFacadePt(ptA);
  const b = toFacadePt(ptB);
  return Math.atan2(b.z - a.z, b.x - a.x);
}