// src/spaces/promoteur/terrain3d/facade/buildFacadeRenderSpec.ts
// ─────────────────────────────────────────────────────────────────────────────
// Construction du FacadeRenderSpec transmis au pipeline Blender.
//
// Historique :
//   V1  — Résolution ambiance / palette / géométrie depuis Facade2DModel
//         ou config générateur
//   V2  — Branchement footprint 2D réel (FacadeSceneInput.footprint)
//         • Non destructif : tout l'existant est conservé
//         • Si hasRealFootprint === true, on calcule widthM / depth depuis
//           le polygone réel et on enrichit le spec
//         • Sinon, comportement V1 inchangé
//         • Nouveaux helpers : isValidFootprint, buildFootprintSegments,
//           distance2D, computeFootprintBounds, pickMainFacadeSegment
//         • Logging préfixé [MMZ][FacadeRenderSpec]
//
//   V3  — Correction géométrie irrégulière
//         • Les dimensions réelles sont calculées dans le repère de la
//           façade principale (et non plus seulement via bbox monde)
//         • Exposition du footprint brut dans footprintMeta
//         • Ajout des projections locales (localWidth/localDepth)
//         • BaysCount dérivé de la longueur réelle de façade si footprint réel
//         • Caméra recentrée sur le footprint réel
//         • 100% rétrocompatible : tous les champs existants restent valides
// ─────────────────────────────────────────────────────────────────────────────

import type { Facade2DModel } from './facade2d.types';
import type { FootprintPoint } from './extractFootprintFrom2D';
import type { FacadeSceneInput } from './buildFacadeSceneInput';

// ─────────────────────────────────────────────────────────────────────────────
// Types publics (compatibles V1/V2)
// ─────────────────────────────────────────────────────────────────────────────

export type BlenderAmbiance = 'matin' | 'golden' | 'couvert' | 'crepuscule';

export interface FacadeRenderCamera {
  positionX: number;
  positionY: number;
  positionZ: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  /** Focal length mm équivalent 35mm */
  focalLengthMm: number;
}

export interface FacadeRenderLight {
  sunEnergy: number;
  sunAngleDeg: number;
  /** Azimut en degrés (0 = face, 45 = quart) */
  sunAzimuthDeg: number;
  worldStrength: number;
  worldColorHex: string;
  /** Lumière d'appoint fill */
  fillStrength: number;
}

export interface FacadeRenderSpec {
  // ── Géométrie ──────────────────────────────────────
  widthM: number;
  heightM: number;
  levelsCount: number;
  baysCount: number;

  // ── Matériaux ──────────────────────────────────────
  facadeColorHex: string;
  facadeRoughness: number;
  glazingColorHex: string;
  glazingRoughness: number;
  glazingMetalness: number;
  frameColorHex: string;
  frameRoughness: number;
  frameMetalness: number;
  roofColorHex: string;
  groundColorHex: string;
  groundRoughness: number;

  // ── Caméra ─────────────────────────────────────────
  camera: FacadeRenderCamera;

  // ── Lumière ────────────────────────────────────────
  light: FacadeRenderLight;

  // ── Ambiance ───────────────────────────────────────
  ambiance: BlenderAmbiance;

  // ── Output ─────────────────────────────────────────
  resolutionX: number;
  resolutionY: number;
  samples: number;

  // ── Contexte ───────────────────────────────────────
  addNeighborVolumes: boolean;
  addTrees: boolean;

  // ── V2/V3 — Emprise réelle (optionnel) ─────────────
  // Présent uniquement si hasRealFootprint === true.
  // Les consommateurs existants peuvent ignorer ces champs en toute sécurité.
  footprintMeta?: FootprintMeta;
}

/**
 * Métadonnées calculées depuis le footprint réel.
 * Exposées dans le spec pour que le pipeline Blender puisse adapter
 * la caméra et les volumes aux dimensions réelles de la parcelle.
 */
export interface FootprintMeta {
  /** Largeur de la façade principale en mètres */
  mainFacadeLength: number;

  /** Profondeur réelle du bâtiment dans le repère local de la façade principale */
  footprintDepth: number;

  /** Largeur de la bbox monde du polygone */
  footprintWidth: number;

  /** Hauteur de la bbox monde du polygone */
  footprintHeight: number;

  /** Largeur du bâtiment dans le repère local de la façade principale */
  localWidth: number;

  /** Profondeur du bâtiment dans le repère local de la façade principale */
  localDepth: number;

  /** Centre de la bbox monde */
  center: {
    x: number;
    y: number;
  };

  /** Segment identifié comme façade principale */
  mainSegment: FootprintSegment;

  /** Tous les segments du polygone */
  segments: FootprintSegment[];

  /** Footprint brut conservé tel qu’extrait du plan 2D */
  footprint: FootprintPoint[];

  /** Angle de la façade principale en radians dans le plan XY */
  mainFacadeAngleRad: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Types internes
// ─────────────────────────────────────────────────────────────────────────────

type RenderSpecOverrides = Partial<
  Pick<
    FacadeRenderSpec,
    'resolutionX' | 'resolutionY' | 'samples' | 'addNeighborVolumes' | 'addTrees'
  >
>;

/**
 * Source acceptée :
 * - soit un vrai Facade2DModel
 * - soit un objet de config façade venant du générateur
 * - soit un FacadeSceneInput (V2/V3 — enrichi avec footprint)
 */
type FacadeRenderSource = Facade2DModel | FacadeSceneInput | Record<string, unknown>;

export interface FootprintSegment {
  start: FootprintPoint;
  end: FootprintPoint;
  length: number;
  index: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constantes (compatibles V1)
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_WIDTH_M = 20;
const DEFAULT_LEVELS_COUNT = 4;
const DEFAULT_BAYS_COUNT = 5;
const DEFAULT_LEVEL_HEIGHT_M = 3.0;
const DEFAULT_BASE_LEVEL_HEIGHT_M = 4.0;
const DEFAULT_ATTIC_HEIGHT_M = 3.2;

const DEFAULT_BAY_WIDTH_M = 3.6;
const MIN_BAYS_COUNT = 2;
const MAX_BAYS_COUNT = 18;

// ─────────────────────────────────────────────────────────────────────────────
// Ambiance presets (inchangés)
// ─────────────────────────────────────────────────────────────────────────────

const AMBIANCE_LIGHT: Record<BlenderAmbiance, FacadeRenderLight> = {
  matin: {
    sunEnergy: 3.5,
    sunAngleDeg: 55,
    sunAzimuthDeg: 30,
    worldStrength: 0.9,
    worldColorHex: '#D8E8F4',
    fillStrength: 0.4,
  },
  golden: {
    sunEnergy: 4.5,
    sunAngleDeg: 20,
    sunAzimuthDeg: 50,
    worldStrength: 0.7,
    worldColorHex: '#F0D8B0',
    fillStrength: 0.25,
  },
  couvert: {
    sunEnergy: 1.2,
    sunAngleDeg: 80,
    sunAzimuthDeg: 0,
    worldStrength: 1.4,
    worldColorHex: '#D0D4D8',
    fillStrength: 0.7,
  },
  crepuscule: {
    sunEnergy: 1.8,
    sunAngleDeg: 10,
    sunAzimuthDeg: 70,
    worldStrength: 0.4,
    worldColorHex: '#3A3050',
    fillStrength: 0.15,
  },
};

const GROUND_COLOR: Record<BlenderAmbiance, string> = {
  matin: '#8A8C84',
  golden: '#94907A',
  couvert: '#787A78',
  crepuscule: '#4A4848',
};

// ─────────────────────────────────────────────────────────────────────────────
// Material → Color maps (inchangés)
// ─────────────────────────────────────────────────────────────────────────────

const FACADE_MATERIAL_COLORS: Record<string, string> = {
  'Enduit blanc': '#F2F2EE',
  'Enduit beige': '#E8D8B8',
  'Pierre de taille': '#CBBE9E',
  'Brique rouge': '#C07058',
  'Bardage bois': '#A07848',
  'Composite HPL': '#A0A4AC',
  'Béton architectonique': '#B0B0AC',
};

const WINDOW_MATERIAL_COLORS: Record<string, { frame: string; stroke: string }> = {
  'Aluminium gris anthracite': { frame: '#303030', stroke: '#505050' },
  'Aluminium blanc': { frame: '#E0E0E0', stroke: '#B0B0B0' },
  'PVC blanc': { frame: '#EEEEEE', stroke: '#C0C0C0' },
  'Bois naturel': { frame: '#9E7348', stroke: '#7A5830' },
  'Bois peint sombre': { frame: '#3A3028', stroke: '#2A2018' },
};

const ROOF_MATERIAL_COLORS: Record<string, string> = {
  'Zinc joint debout': '#6E7A7C',
  'Tuile canal': '#C07048',
  'Tuile mécanique': '#A05838',
  'Ardoise': '#4A4D54',
  'Toiture terrasse végétalisée': '#5A9A48',
  'Toiture terrasse gravier': '#B0ACA6',
};

// ─────────────────────────────────────────────────────────────────────────────
// [V3] Helpers footprint
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Vérifie qu'un tableau de points constitue un footprint exploitable.
 * Critère : >= 3 points finis.
 */
function isValidFootprint(pts: unknown): pts is FootprintPoint[] {
  if (!Array.isArray(pts) || pts.length < 3) return false;

  return pts.every(
    (p) =>
      p !== null &&
      typeof p === 'object' &&
      typeof (p as Record<string, unknown>).x === 'number' &&
      typeof (p as Record<string, unknown>).y === 'number' &&
      Number.isFinite((p as FootprintPoint).x) &&
      Number.isFinite((p as FootprintPoint).y),
  );
}

/**
 * Distance euclidienne entre deux points 2D.
 */
function distance2D(a: FootprintPoint, b: FootprintPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Construit tous les segments du polygone (n points → n segments, fermé).
 * Chaque segment expose start, end, length et son index dans le polygone.
 */
function buildFootprintSegments(pts: FootprintPoint[]): FootprintSegment[] {
  const segments: FootprintSegment[] = [];
  const n = pts.length;

  for (let i = 0; i < n; i++) {
    const start = pts[i]!;
    const end = pts[(i + 1) % n]!;
    const length = distance2D(start, end);

    // Ignorer les segments dégénérés
    if (length < 0.001) continue;

    segments.push({ start, end, length, index: i });
  }

  return segments;
}

/**
 * Calcule la bounding box axis-aligned du polygone dans le repère monde.
 */
function computeFootprintBounds(pts: FootprintPoint[]): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  footprintWidth: number;
  footprintHeight: number;
  center: { x: number; y: number };
} {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const footprintWidth = maxX - minX;
  const footprintHeight = maxY - minY;

  return {
    minX,
    maxX,
    minY,
    maxY,
    footprintWidth,
    footprintHeight,
    center: {
      x: minX + footprintWidth * 0.5,
      y: minY + footprintHeight * 0.5,
    },
  };
}

/**
 * Identifie la façade principale comme le segment le plus long du polygone.
 * Heuristique simple, stable pour les formes rectangulaires et en L.
 */
function pickMainFacadeSegment(segments: FootprintSegment[]): FootprintSegment | null {
  if (segments.length === 0) return null;

  return segments.reduce(
    (longest, seg) => (seg.length > longest.length ? seg : longest),
    segments[0]!,
  );
}

/**
 * Retourne l'angle du segment dans le plan XY.
 */
function computeSegmentAngleRad(seg: FootprintSegment): number {
  return Math.atan2(seg.end.y - seg.start.y, seg.end.x - seg.start.x);
}

/**
 * Projette un point dans le repère local de la façade principale :
 * - axe X local = direction de la façade principale
 * - axe Y local = normale "vers l'intérieur/extérieur" indifférente ici
 */
function projectPointToLocalAxes(
  point: FootprintPoint,
  origin: FootprintPoint,
  angleRad: number,
): { x: number; y: number } {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;

  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);

  return {
    x: dx * cos + dy * sin,
    y: -dx * sin + dy * cos,
  };
}

/**
 * Calcule les dimensions du footprint dans le repère local de la façade principale.
 * C'est cette étape qui évite de déformer les formes irrégulières / orientées
 * via une simple bbox monde.
 */
function computeLocalFootprintExtents(
  pts: FootprintPoint[],
  mainSegment: FootprintSegment,
): {
  localMinX: number;
  localMaxX: number;
  localMinY: number;
  localMaxY: number;
  localWidth: number;
  localDepth: number;
  angleRad: number;
} {
  const angleRad = computeSegmentAngleRad(mainSegment);
  const origin = mainSegment.start;

  let localMinX = Infinity;
  let localMaxX = -Infinity;
  let localMinY = Infinity;
  let localMaxY = -Infinity;

  for (const p of pts) {
    const local = projectPointToLocalAxes(p, origin, angleRad);

    if (local.x < localMinX) localMinX = local.x;
    if (local.x > localMaxX) localMaxX = local.x;
    if (local.y < localMinY) localMinY = local.y;
    if (local.y > localMaxY) localMaxY = local.y;
  }

  return {
    localMinX,
    localMaxX,
    localMinY,
    localMaxY,
    localWidth: localMaxX - localMinX,
    localDepth: localMaxY - localMinY,
    angleRad,
  };
}

/**
 * Déduit un nombre de travées plausible depuis la longueur réelle de façade.
 * Non destructif : seulement utilisé si footprint réel dispo.
 */
function deriveBaysCountFromFacadeLength(mainFacadeLength: number): number {
  if (!Number.isFinite(mainFacadeLength) || mainFacadeLength <= 0) {
    return DEFAULT_BAYS_COUNT;
  }

  const bays = Math.round(mainFacadeLength / DEFAULT_BAY_WIDTH_M);
  return clampInt(bays, MIN_BAYS_COUNT, MAX_BAYS_COUNT);
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

/**
 * Calcule les métadonnées footprint complètes à partir des points du polygone.
 */
function computeFootprintMeta(pts: FootprintPoint[]): FootprintMeta | null {
  try {
    const segments = buildFootprintSegments(pts);

    if (segments.length < 2) {
      console.warn(
        '[MMZ][FacadeRenderSpec] Footprint dégénéré — ' +
          `${segments.length} segment(s) valide(s), minimum 2 requis`,
      );
      return null;
    }

    const mainSegment = pickMainFacadeSegment(segments);
    if (!mainSegment) return null;

    const bounds = computeFootprintBounds(pts);
    const local = computeLocalFootprintExtents(pts, mainSegment);

    const localDepth = Math.abs(local.localDepth);
    const localWidth = Math.abs(local.localWidth);

    if (mainSegment.length <= 0.001 || localDepth <= 0.001) {
      console.warn(
        '[MMZ][FacadeRenderSpec] Footprint exploitable mais dimensions locales trop faibles',
        {
          mainFacadeLength: mainSegment.length,
          localDepth,
        },
      );
    }

    return {
      mainFacadeLength: mainSegment.length,
      footprintDepth: localDepth,
      footprintWidth: bounds.footprintWidth,
      footprintHeight: bounds.footprintHeight,
      localWidth,
      localDepth,
      center: bounds.center,
      mainSegment,
      segments,
      footprint: pts,
      mainFacadeAngleRad: local.angleRad,
    };
  } catch (err) {
    console.error('[MMZ][FacadeRenderSpec] Erreur calcul footprint meta :', err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Camera builders
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Caméra legacy V1/V2 — centrée sur une façade frontale abstraite.
 */
function buildCamera(widthM: number, heightM: number): FacadeRenderCamera {
  const recul = Math.max(widthM * 1.6, heightM * 1.4);
  const camHeight = heightM * 0.5;
  const targetHeight = heightM * 0.48;

  return {
    positionX: 0,
    positionY: -recul,
    positionZ: camHeight,
    targetX: 0,
    targetY: 0,
    targetZ: targetHeight,
    focalLengthMm: 45,
  };
}

/**
 * Caméra V3 — si footprint réel disponible, on recule selon la largeur réelle
 * de façade ET la profondeur réelle du bâtiment, et on centre sur le footprint.
 *
 * Important : on reste volontairement dans une convention frontale simple pour
 * ne rien casser côté Blender. On ajuste surtout recul + centre.
 */
function buildCameraFromFootprintMeta(
  meta: FootprintMeta,
  heightM: number,
): FacadeRenderCamera {
  const effectiveWidth = Math.max(meta.mainFacadeLength, 6);
  const effectiveDepth = Math.max(meta.footprintDepth, 4);

  const recul = Math.max(
    effectiveWidth * 1.45,
    heightM * 1.35,
    effectiveDepth * 2.1,
  );

  const camHeight = heightM * 0.5;
  const targetHeight = heightM * 0.48;

  return {
    positionX: meta.center.x,
    positionY: meta.center.y - recul,
    positionZ: camHeight,
    targetX: meta.center.x,
    targetY: meta.center.y,
    targetZ: targetHeight,
    focalLengthMm: effectiveWidth > 28 ? 50 : 45,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fonction publique principale
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Construit le FacadeRenderSpec complet transmis au pipeline Blender.
 *
 * V3 :
 * - Si `source` est un FacadeSceneInput avec hasRealFootprint === true,
 *   les dimensions réelles sont calculées depuis l’emprise polygonale.
 * - Le footprint complet est exposé dans `footprintMeta`.
 * - La caméra est recentrée sur le footprint réel.
 * - Sinon, comportement legacy inchangé.
 */
export function buildFacadeRenderSpec(
  source: FacadeRenderSource,
  overrides?: RenderSpecOverrides,
): FacadeRenderSpec {
  try {
    const ambiance = resolveAmbiance(source);
    const palette = resolvePalette(source, ambiance);

    const { geometry, footprintMeta } = resolveGeometryWithFootprint(source);

    const spec: FacadeRenderSpec = {
      // ── Géométrie
      widthM: geometry.widthM,
      heightM: geometry.heightM,
      levelsCount: geometry.levelsCount,
      baysCount: geometry.baysCount,

      // ── Matériaux façade
      facadeColorHex: palette.facadeColorHex,
      facadeRoughness: 0.75,

      // ── Vitrage
      glazingColorHex: '#8BAABB',
      glazingRoughness: 0.05,
      glazingMetalness: 0.8,

      // ── Menuiseries
      frameColorHex: palette.frameColorHex,
      frameRoughness: 0.35,
      frameMetalness: 0.7,

      // ── Toiture
      roofColorHex: palette.roofColorHex,

      // ── Sol
      groundColorHex: GROUND_COLOR[ambiance],
      groundRoughness: 0.88,

      // ── Caméra
      camera:
        footprintMeta !== null
          ? buildCameraFromFootprintMeta(footprintMeta, geometry.heightM)
          : buildCamera(geometry.widthM, geometry.heightM),

      // ── Lumière
      light: AMBIANCE_LIGHT[ambiance],

      // ── Ambiance
      ambiance,

      // ── Output
      resolutionX: overrides?.resolutionX ?? 2560,
      resolutionY: overrides?.resolutionY ?? 1440,
      samples: overrides?.samples ?? 128,

      // ── Contexte
      addNeighborVolumes: overrides?.addNeighborVolumes ?? true,
      addTrees: overrides?.addTrees ?? false,

      // ── [V2/V3] Métadonnées footprint
      ...(footprintMeta !== null ? { footprintMeta } : {}),
    };

    return spec;
  } catch (err) {
    console.error(
      '[MMZ][FacadeRenderSpec] Erreur inattendue, spec minimal retourné :',
      err,
    );
    return buildMinimalFallbackSpec();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Résolution ambiance / palette (legacy inchangé)
// ─────────────────────────────────────────────────────────────────────────────

function resolveAmbiance(source: FacadeRenderSource): BlenderAmbiance {
  const raw = getString(source, 'ambiance');

  if (
    raw === 'golden' ||
    raw === 'couvert' ||
    raw === 'crepuscule' ||
    raw === 'matin'
  ) {
    return raw;
  }

  return 'matin';
}

function resolvePalette(
  source: FacadeRenderSource,
  ambiance: BlenderAmbiance,
): {
  facadeColorHex: string;
  frameColorHex: string;
  roofColorHex: string;
} {
  const themePalette = getNestedRecord(source, ['theme', 'palette']);

  const facadeFromTheme = getString(themePalette, 'facade');
  const frameFromTheme = getString(themePalette, 'frameFill');
  const roofFromTheme = getString(themePalette, 'roofFill');

  const facadeMaterial =
    getString(source, 'facadeMaterial') ?? getString(source, 'materiauFacade');
  const windowMaterial =
    getString(source, 'windowMaterial') ?? getString(source, 'materiauMenuiseries');
  const roofMaterial =
    getString(source, 'roofMaterial') ?? getString(source, 'materiauToiture');

  const facadeColorHex =
    facadeFromTheme ??
    (facadeMaterial ? FACADE_MATERIAL_COLORS[facadeMaterial] : undefined) ??
    '#F2F2EE';

  const frameColorHex =
    frameFromTheme ??
    (windowMaterial ? WINDOW_MATERIAL_COLORS[windowMaterial]?.frame : undefined) ??
    '#303030';

  const roofColorHex =
    roofFromTheme ??
    (roofMaterial ? ROOF_MATERIAL_COLORS[roofMaterial] : undefined) ??
    (ambiance === 'crepuscule' ? '#4A4D54' : '#6E7A7C');

  return { facadeColorHex, frameColorHex, roofColorHex };
}

// ─────────────────────────────────────────────────────────────────────────────
// [V3] Résolution géométrie — avec branchement footprint réel
// ─────────────────────────────────────────────────────────────────────────────

function resolveGeometryWithFootprint(source: FacadeRenderSource): {
  geometry: {
    widthM: number;
    heightM: number;
    levelsCount: number;
    baysCount: number;
  };
  footprintMeta: FootprintMeta | null;
} {
  const hasRealFootprint = getBoolean(source, 'hasRealFootprint') === true;
  const rawFootprint = (source as Record<string, unknown>).footprint;

  if (hasRealFootprint && isValidFootprint(rawFootprint)) {
    const meta = computeFootprintMeta(rawFootprint);

    if (meta !== null) {
      const baseGeometry = resolveGeometryV1(source);

      const widthM = Math.max(meta.mainFacadeLength, 4);
      const baysCount =
        getNumber(source, 'baysCount') ?? deriveBaysCountFromFacadeLength(widthM);

      console.log(
        `[MMZ][FacadeRenderSpec] Footprint réel utilisé — ` +
          `façade principale : ${meta.mainFacadeLength.toFixed(2)}m` +
          ` · profondeur locale : ${meta.footprintDepth.toFixed(2)}m` +
          ` · bbox monde : ${meta.footprintWidth.toFixed(2)}m x ${meta.footprintHeight.toFixed(2)}m` +
          ` · local : ${meta.localWidth.toFixed(2)}m x ${meta.localDepth.toFixed(2)}m` +
          ` · travées : ${baysCount}` +
          ` · segments : ${meta.segments.length}`,
      );

      return {
        geometry: {
          ...baseGeometry,
          widthM,
          baysCount,
        },
        footprintMeta: meta,
      };
    }

    console.warn(
      '[MMZ][FacadeRenderSpec] Footprint déclaré valide mais dégénéré — fallback géométrique activé',
    );
  } else if (hasRealFootprint && !isValidFootprint(rawFootprint)) {
    console.warn(
      '[MMZ][FacadeRenderSpec] hasRealFootprint=true mais footprint invalide — fallback géométrique activé',
      {
        footprintType: typeof rawFootprint,
        isArray: Array.isArray(rawFootprint),
      },
    );
  }

  return {
    geometry: resolveGeometryV1(source),
    footprintMeta: null,
  };
}

/**
 * Résolution géométrie legacy V1.
 * Conservée telle quelle pour le fallback.
 */
function resolveGeometryV1(source: FacadeRenderSource): {
  widthM: number;
  heightM: number;
  levelsCount: number;
  baysCount: number;
} {
  const widthM = getNumber(source, 'widthM') ?? DEFAULT_WIDTH_M;

  const levelsCount =
    getNumber(source, 'levelsCount') ??
    getNumber(source, 'nbEtages') ??
    DEFAULT_LEVELS_COUNT;

  const baysCount = getNumber(source, 'baysCount') ?? DEFAULT_BAYS_COUNT;

  const heightFromModel = getNumber(source, 'heightM');
  if (heightFromModel !== undefined) {
    return { widthM, heightM: heightFromModel, levelsCount, baysCount };
  }

  const hasAttic =
    getBoolean(source, 'hasAttic') ??
    getBoolean(source, 'attique') ??
    false;

  const levelHeightM =
    getNumber(source, 'levelHeightM') ?? DEFAULT_LEVEL_HEIGHT_M;

  const baseLevelHeightM =
    getNumber(source, 'baseLevelHeightM') ?? DEFAULT_BASE_LEVEL_HEIGHT_M;

  const atticHeightM = hasAttic ? DEFAULT_ATTIC_HEIGHT_M : 0;

  const upperLevels = Math.max(0, levelsCount - 1);
  const heightM = baseLevelHeightM + upperLevels * levelHeightM + atticHeightM;

  return {
    widthM,
    heightM,
    levelsCount: levelsCount + (hasAttic ? 1 : 0),
    baysCount,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Spec minimal de secours
// ─────────────────────────────────────────────────────────────────────────────

function buildMinimalFallbackSpec(): FacadeRenderSpec {
  const ambiance: BlenderAmbiance = 'matin';

  return {
    widthM: DEFAULT_WIDTH_M,
    heightM:
      DEFAULT_BASE_LEVEL_HEIGHT_M +
      (DEFAULT_LEVELS_COUNT - 1) * DEFAULT_LEVEL_HEIGHT_M,
    levelsCount: DEFAULT_LEVELS_COUNT,
    baysCount: DEFAULT_BAYS_COUNT,
    facadeColorHex: '#F2F2EE',
    facadeRoughness: 0.75,
    glazingColorHex: '#8BAABB',
    glazingRoughness: 0.05,
    glazingMetalness: 0.8,
    frameColorHex: '#303030',
    frameRoughness: 0.35,
    frameMetalness: 0.7,
    roofColorHex: '#6E7A7C',
    groundColorHex: GROUND_COLOR[ambiance],
    groundRoughness: 0.88,
    camera: buildCamera(DEFAULT_WIDTH_M, 13),
    light: AMBIANCE_LIGHT[ambiance],
    ambiance,
    resolutionX: 2560,
    resolutionY: 1440,
    samples: 128,
    addNeighborVolumes: true,
    addTrees: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Safe helpers (legacy inchangé)
// ─────────────────────────────────────────────────────────────────────────────

function getString(obj: unknown, key: string): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const value = (obj as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

function getNumber(obj: unknown, key: string): number | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const value = (obj as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getBoolean(obj: unknown, key: string): boolean | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const value = (obj as Record<string, unknown>)[key];
  return typeof value === 'boolean' ? value : undefined;
}

function getNestedRecord(
  obj: unknown,
  path: string[],
): Record<string, unknown> | undefined {
  let current: unknown = obj;

  for (const segment of path) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }

  return current && typeof current === 'object'
    ? (current as Record<string, unknown>)
    : undefined;
}