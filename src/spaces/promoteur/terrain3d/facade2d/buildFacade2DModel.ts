import type {
  Facade2DBuildInput,
  Facade2DModel,
  Facade2DLevel,
  Facade2DOpening,
  Facade2DBalcony,
  Facade2DLoggia,
  Facade2DBalconyMode,
  Facade2DLoggiaMode,
  Facade2DRhythm,
  Facade2DAmbiance,
  Facade2DVegetation,
  Facade2DPalette,
} from './facade2d.types';
import { getFacade2DPreset } from './facade2d.presets';
import type { Facade2DPreset } from './facade2d.presets';
import {
  computeBayCount,
  computeBayLayout,
  computeOpeningSpec,
  type BayRhythm,
  type BayLayout,
} from './computeFacadeBays';

// ─── Fallbacks ───
const DEFAULTS = {
  widthM: 24,
  levelsCount: 5,
  levelHeightM: 2.8,
  baysCount: 5,
} as const;

/** Garde au sol RDC (m) — offsetYM = h - oH - GAP */
const RDC_GROUND_GAP_M = 0.02;

// ─── Material → Color maps ─────────────────────────────────────────────────

const FACADE_MATERIAL_COLORS: Record<string, string> = {
  'Enduit blanc':          '#F2F2EE',
  'Enduit beige':          '#E8D8B8',
  'Pierre de taille':     '#CBBE9E',
  'Brique rouge':         '#C07058',
  'Bardage bois':         '#A07848',
  'Composite HPL':        '#A0A4AC',
  'Béton architectonique': '#B0B0AC',
};

const FACADE_ACCENT_COLORS: Record<string, string> = {
  'Enduit blanc':          '#E6E6E0',
  'Enduit beige':          '#D4C4A0',
  'Pierre de taille':     '#B8A888',
  'Brique rouge':         '#A05840',
  'Bardage bois':         '#886038',
  'Composite HPL':        '#8A8E96',
  'Béton architectonique': '#989894',
};

const WINDOW_MATERIAL_COLORS: Record<string, { frame: string; stroke: string }> = {
  'Aluminium gris anthracite': { frame: '#303030', stroke: '#505050' },
  'Aluminium blanc':           { frame: '#E0E0E0', stroke: '#B0B0B0' },
  'PVC blanc':                 { frame: '#EEEEEE', stroke: '#C0C0C0' },
  'Bois naturel':              { frame: '#9E7348', stroke: '#7A5830' },
  'Bois peint sombre':         { frame: '#3A3028', stroke: '#2A2018' },
};

const ROOF_MATERIAL_COLORS: Record<string, string> = {
  'Zinc joint debout':            '#6E7A7C',
  'Tuile canal':                  '#C07048',
  'Tuile mécanique':              '#A05838',
  'Ardoise':                      '#4A4D54',
  'Toiture terrasse végétalisée': '#5A9A48',
  'Toiture terrasse gravier':     '#B0ACA6',
};

const AMBIANCE_SKY: Record<Facade2DAmbiance, { top: string; bottom: string; shadow: string }> = {
  matin:      { top: '#D8E8F4', bottom: '#F0F6FC', shadow: 'rgba(0,0,0,0.06)' },
  golden:     { top: '#F0D8B0', bottom: '#FDF4E8', shadow: 'rgba(80,50,0,0.06)' },
  couvert:    { top: '#D0D4D8', bottom: '#E8EAEC', shadow: 'rgba(0,0,0,0.08)' },
  crepuscule: { top: '#3A3050', bottom: '#6A5870', shadow: 'rgba(0,0,0,0.12)' },
};

// ─── Public API ─────────────────────────────────────────────────────────────

export function buildFacade2DModel(input: Facade2DBuildInput): Facade2DModel {
  const presetId = input.stylePresetId ?? 'contemporain-urbain';
  const preset = getFacade2DPreset(presetId);

  const levelsCount = input.levelsCount ?? DEFAULTS.levelsCount;
  const levelHeightM = input.levelHeightM ?? DEFAULTS.levelHeightM;
  const baseLevelHeightM = levelHeightM + 0.7;
  const widthM = input.widthM ?? DEFAULTS.widthM;
  const rhythm: Facade2DRhythm = input.rhythm ?? 'regular';
  const balconyMode = input.balconyMode ?? preset.defaultBalconyMode;
  const loggiaMode = input.loggiaMode ?? preset.defaultLoggiaMode;
  const baseKind = input.baseKind ?? preset.defaultBaseKind;
  const roofKind = input.roofKind ?? preset.defaultRoofKind;
  const hasAttic = input.hasAttic ?? preset.hasAttic;
  const hasCornice = input.hasCornice ?? preset.hasCornice;
  const hasSocle = input.hasSocle ?? preset.hasSocle;
  const ambiance: Facade2DAmbiance = input.ambiance ?? 'matin';
  const vegetation: Facade2DVegetation = input.vegetation ?? 'aucune';

  // ── Calcul automatique des travées à partir de la largeur réelle ──
  const bayRhythm = rhythm as BayRhythm;
  const baysCount = input.baysCount ?? computeBayCount(widthM, bayRhythm);

  const atticHeightM = hasAttic ? levelHeightM * 0.75 : 0;
  const totalLevels = levelsCount + (hasAttic ? 1 : 0);
  const heightM = baseLevelHeightM + (levelsCount - 1) * levelHeightM + atticHeightM;

  const palette = buildPalette(input, preset, ambiance);
  const theme = { ...preset.theme, palette };
  theme.palette.shadow = AMBIANCE_SKY[ambiance].shadow;

  const hasShutter = preset.hasShutter || input.archStyle === 'mediterraneen';
  const hasArch = preset.hasArch || input.archStyle === 'haussmannien' || input.archStyle === 'mediterraneen';

  const levels = buildLevels({
    levelsCount, levelHeightM, baseLevelHeightM, widthM, baysCount,
    balconyMode, loggiaMode, baseKind, hasAttic, atticHeightM, preset,
    rhythm: bayRhythm, hasShutter, hasArch,
  });

  return {
    stylePresetId: presetId, styleLabel: preset.label,
    widthM, heightM, levelsCount: totalLevels, levelHeightM, baysCount,
    baseLevelHeightM, baseKind, roofKind, hasAttic, hasCornice, hasSocle,
    balconyMode, loggiaMode, rhythm, ambiance, vegetation,
    levels, theme,
  };
}

// ─── Palette builder ────────────────────────────────────────────────────────

function buildPalette(
  input: Facade2DBuildInput,
  preset: Facade2DPreset,
  ambiance: Facade2DAmbiance,
): Facade2DPalette {
  const base = { ...preset.theme.palette };

  if (input.facadeMaterial && FACADE_MATERIAL_COLORS[input.facadeMaterial]) {
    base.facade = FACADE_MATERIAL_COLORS[input.facadeMaterial];
    base.facadeAccent = FACADE_ACCENT_COLORS[input.facadeMaterial] ?? base.facadeAccent;
  }
  if (input.windowMaterial && WINDOW_MATERIAL_COLORS[input.windowMaterial]) {
    const wm = WINDOW_MATERIAL_COLORS[input.windowMaterial];
    base.frameFill = wm.frame;
    base.openingStroke = wm.stroke;
  }
  if (input.roofMaterial && ROOF_MATERIAL_COLORS[input.roofMaterial]) {
    base.roofFill = ROOF_MATERIAL_COLORS[input.roofMaterial];
  }

  const sky = AMBIANCE_SKY[ambiance];
  base.skyTop = sky.top;
  base.skyBottom = sky.bottom;

  if (ambiance === 'crepuscule') {
    base.facade = darkenHex(base.facade, 0.08);
    base.facadeAccent = darkenHex(base.facadeAccent, 0.08);
    base.groundFill = '#4A4848';
    base.treeFill = '#3A5830';
  }
  if (ambiance === 'golden') {
    base.facade = warmHex(base.facade, 0.04);
  }

  return base;
}

// ─── Level builder ──────────────────────────────────────────────────────────

interface LevelsBuildCtx {
  levelsCount: number;
  levelHeightM: number;
  baseLevelHeightM: number;
  widthM: number;
  baysCount: number;
  balconyMode: Facade2DBalconyMode;
  loggiaMode: Facade2DLoggiaMode;
  baseKind: string;
  hasAttic: boolean;
  atticHeightM: number;
  preset: Facade2DPreset;
  rhythm: BayRhythm;
  hasShutter: boolean;
  hasArch: boolean;
}

function buildLevels(ctx: LevelsBuildCtx): Facade2DLevel[] {
  const levels: Facade2DLevel[] = [];

  levels.push(buildBaseLevel(ctx));

  for (let i = 1; i < ctx.levelsCount; i++) {
    levels.push(buildTypicalLevel(i, ctx));
  }

  if (ctx.hasAttic) {
    levels.push(buildAtticLevel(ctx.levelsCount, ctx));
  }

  return levels;
}

function buildBaseLevel(ctx: LevelsBuildCtx): Facade2DLevel {
  const h = ctx.baseLevelHeightM;
  const isCom = ctx.baseKind === 'commercial' || ctx.baseKind === 'pilotis';

  const layout = computeBayLayout(ctx.widthM, ctx.baysCount, ctx.rhythm);

  const openings: Facade2DOpening[] = [];
  for (let b = 0; b < layout.count; b++) {
    const bayW = layout.bayWidths[b] ?? (ctx.widthM / ctx.baysCount);
    const baySpec = computeOpeningSpec(bayW, 'base');

    const oH = isCom ? Math.min(h * 0.7, baySpec.heightM) : Math.min(baySpec.heightM, h - 0.3);
    const oWBase = isCom ? baySpec.widthM * 1.1 : baySpec.widthM;

    const isDoor = b === Math.floor(layout.count / 2) && !isCom;
    const thisW = isDoor ? oWBase * 1.1 : oWBase;
    const thisH = isDoor ? oH * 1.05 : oH;

    const cx = layout.centerXs[b];

    openings.push({
      kind: isCom ? 'bay' : (isDoor ? 'door' : 'french-window'),
      widthM: thisW,
      heightM: thisH,
      offsetXM: cx - thisW / 2,
      offsetYM: h - thisH - RDC_GROUND_GAP_M,
      hasShutter: false,
      hasArch: ctx.hasArch && isCom,
    });
  }

  return { index: 0, kind: 'base', heightM: h, openings, balconies: [], loggias: [] };
}

function buildTypicalLevel(idx: number, ctx: LevelsBuildCtx): Facade2DLevel {
  const h = ctx.levelHeightM;

  const layout = computeBayLayout(ctx.widthM, ctx.baysCount, ctx.rhythm);

  const openings: Facade2DOpening[] = [];
  const balconies: Facade2DBalcony[] = [];
  const loggias: Facade2DLoggia[] = [];

  for (let b = 0; b < layout.count; b++) {
    const cx = layout.centerXs[b];
    const bayW = layout.bayWidths[b] ?? (ctx.widthM / ctx.baysCount);
    const baySpec = computeOpeningSpec(bayW, 'typical');

    const oH = Math.min(baySpec.heightM, h * ctx.preset.openingHeightRatio);
    const clampedW = Math.max(0.8, Math.min(baySpec.widthM, bayW * 0.7));

    openings.push({
      kind: ctx.balconyMode !== 'none' ? 'french-window' : 'window',
      widthM: clampedW,
      heightM: oH,
      offsetXM: cx - clampedW / 2,
      offsetYM: (h - oH) * 0.55,
      hasShutter: ctx.hasShutter,
      hasArch: ctx.hasArch,
    });
  }

  if (ctx.balconyMode === 'continuous') {
    const margin = layout.marginM * 0.6;
    balconies.push({
      mode: 'continuous',
      widthM: ctx.widthM - margin * 2,
      depthM: 0.15,
      heightM: 0.95,
      offsetXM: margin,
      offsetYM: (h - (openings[0]?.heightM ?? 1.8)) * 0.55,
    });
  } else if (ctx.balconyMode === 'punctual') {
    for (let b = 0; b < layout.count; b += 2) {
      const cx = layout.centerXs[b];
      const bw = (layout.bayWidths[b] ?? 3) * 0.55 + 0.4;
      balconies.push({
        mode: 'punctual',
        widthM: bw,
        depthM: 0.12,
        heightM: 0.9,
        offsetXM: cx - bw / 2,
        offsetYM: (h - (openings[b]?.heightM ?? 1.8)) * 0.55,
      });
    }
  }

  if (ctx.loggiaMode === 'simple') {
    for (let b = 1; b < layout.count; b += 3) {
      const cx = layout.centerXs[b];
      const lw = (layout.bayWidths[b] ?? 3) * 0.5 + 0.3;
      loggias.push({
        widthM: lw,
        heightM: (openings[b]?.heightM ?? 1.8) + 0.2,
        offsetXM: cx - lw / 2,
        offsetYM: (h - (openings[b]?.heightM ?? 1.8)) * 0.55 - 0.1,
      });
    }
  }

  return { index: idx, kind: 'typical', heightM: h, openings, balconies, loggias };
}

function buildAtticLevel(idx: number, ctx: LevelsBuildCtx): Facade2DLevel {
  const h = ctx.atticHeightM;

  const atticWidthM = ctx.widthM * 0.85;
  const sideOffsetM = (ctx.widthM - atticWidthM) / 2;

  const layout = computeBayLayout(atticWidthM, ctx.baysCount, ctx.rhythm);

  const openings: Facade2DOpening[] = [];
  for (let b = 0; b < layout.count; b++) {
    const bayW = layout.bayWidths[b] ?? (atticWidthM / ctx.baysCount);
    const baySpec = computeOpeningSpec(bayW, 'attic');
    const oH = Math.min(baySpec.heightM, h * 0.55);
    const cx = layout.centerXs[b];

    openings.push({
      kind: 'window',
      widthM: baySpec.widthM,
      heightM: oH,
      offsetXM: sideOffsetM + cx - baySpec.widthM / 2,
      offsetYM: (h - oH) * 0.5,
      hasShutter: false,
      hasArch: false,
    });
  }

  return { index: idx, kind: 'attic', heightM: h, openings, balconies: [], loggias: [] };
}

// ─── Color utils ────────────────────────────────────────────────────────────

function darkenHex(hex: string, amount: number): string {
  const c = parseHex(hex);
  return rgbToHex(
    Math.max(0, c.r - amount * 255),
    Math.max(0, c.g - amount * 255),
    Math.max(0, c.b - amount * 255),
  );
}

function warmHex(hex: string, amount: number): string {
  const c = parseHex(hex);
  return rgbToHex(
    Math.min(255, c.r + amount * 255),
    c.g,
    Math.max(0, c.b - amount * 128),
  );
}

function parseHex(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.round(Math.max(0, Math.min(255, v)));
  return `#${clamp(r).toString(16).padStart(2, '0')}${clamp(g).toString(16).padStart(2, '0')}${clamp(b).toString(16).padStart(2, '0')}`;
}