// massingTemplates.ts — v5
// 5 templates architecturaux enrichis, chacun avec un caractère distinct

import type {
  MassingBuildingModel, BuildingStyleOptions, BuildingTemplateConfig,
  BuildingTemplateType, TemplateFacadeStyle, TemplateRoofType,
  SetbackRule, BuildingLevels,
} from "./massingScene.types";
import { BUILDING_TEMPLATES, DEFAULT_BUILDING_STYLE } from "./massingScene.types";

// ─── Facade params ──────────────────────────────────────────────────────────

type FacadeParams = Pick<BuildingStyleOptions,
  "windowRatio" | "bayWidthM" | "hasBanding" | "hasBalconies" | "hasCorner" | "balconyFreq">;

function facadeParams(f: TemplateFacadeStyle): FacadeParams {
  switch (f) {
    case "vitrage_total": return { windowRatio: 0.45, bayWidthM: 5.0, hasBanding: false, hasBalconies: false, hasCorner: false, balconyFreq: 99 };
    case "bandes":        return { windowRatio: 0.26, bayWidthM: 5.5, hasBanding: true,  hasBalconies: true,  hasCorner: false, balconyFreq: 3 };
    case "grille_legere": return { windowRatio: 0.22, bayWidthM: 4.5, hasBanding: true,  hasBalconies: false, hasCorner: true,  balconyFreq: 99 };
    case "minimal": default: return { windowRatio: 0.15, bayWidthM: 6.5, hasBanding: false, hasBalconies: false, hasCorner: false, balconyFreq: 99 };
  }
}

function toRoofStyle(r: TemplateRoofType): BuildingStyleOptions["roof"] { return r === "flat" ? "terrasse" : "inclinee"; }
function toRoofSlopes(r: TemplateRoofType): number {
  if (r === "gable") return 2; if (r === "shed") return 1; if (r === "mansard") return 4; return 1;
}
function buildSetbacks(factors: number[], nFloors: number): SetbackRule[] {
  const r: SetbackRule[] = [];
  for (let i = 0; i < factors.length; i++)
    if (factors[i] < 1.0) r.push({ fromFloor: Math.max(1, Math.round((i / Math.max(1, factors.length)) * nFloors)), scaleFactor: factors[i] });
  return r;
}

// ─── Visual preset ──────────────────────────────────────────────────────────

export type WindowShape = "vertical" | "square" | "horizontal" | "band";
export type BalconyStyle = "none" | "filant" | "juliet" | "loggia";
export type RoofGeometry = "flat" | "gable" | "mansard";
export type ProceduralMaterial = "stone" | "plaster" | "concrete" | "glass_curtain" | "zinc" | "slate" | "tile";

export interface TemplateVisualPreset {
  facadeColor: string;
  facadeAccentColor: string;
  roofColor: string;
  windowFrameColor: string;
  glassColor: string;
  glassOpacity: number;
  windowShape: WindowShape;
  windowDensity: number;
  windowWidthRatio: number;
  windowHeightRatio: number;
  balconyStyle: BalconyStyle;
  hasBanding: boolean;
  hasCornice: boolean;
  roofGeometry: RoofGeometry;
  roofHeightRatio: number;
  groundFloorDistinct: boolean;
  facadeMaterial: ProceduralMaterial;
  roofMaterial: ProceduralMaterial;
  hasPilasters: boolean;
  hasLucarnes: boolean;
  hasRustication: boolean;
  guardrailColor: string;
  hasShutters: boolean;
  shutterColor: string;
}

const PRESETS: Record<BuildingTemplateType, TemplateVisualPreset> = {

  // ── HAUSSMANNIEN ──────────────────────────────────────────────────────
  // Pierre calcaire, mansarde zinc, volets gris-bleu, balcon filant noble
  haussmannien: {
    facadeColor:      "#E8DFCc",
    facadeAccentColor:"#D6CCB8",
    roofColor:        "#788898",      // zinc gris-bleu clair
    windowFrameColor: "#D8D0C2",      // cadres pierre claire
    glassColor:       "#D4B87A",      // verre ambré chaud
    glassOpacity:     0.42,

    windowShape:      "vertical",
    windowDensity:    0.55,
    windowWidthRatio: 0.30,           // légèrement élargi
    windowHeightRatio:0.70,

    balconyStyle:     "filant",
    hasBanding:       true,
    hasCornice:       true,
    roofGeometry:     "mansard",
    roofHeightRatio:  0.22,
    groundFloorDistinct: true,
    facadeMaterial:   "stone",
    roofMaterial:     "zinc",

    hasPilasters:     true,
    hasLucarnes:      true,
    hasRustication:   true,
    guardrailColor:   "#2A3038",
    hasShutters:      true,
    shutterColor:     "#6B7B8B",      // gris-bleu assorti zinc
  },

  // ── COLLECTIF MODERNE ──────────────────────────────────────────────────
  // Enduit blanc cassé, fenêtres horizontales, loggias, toit terrasse
  collectif_moderne: {
    facadeColor:      "#F0ECE2",
    facadeAccentColor:"#E0DBD0",
    roofColor:        "#A0A8B0",
    windowFrameColor: "#8A8680",      // aluminium foncé
    glassColor:       "#98C0DC",      // verre bleuté froid
    glassOpacity:     0.35,

    windowShape:      "horizontal",
    windowDensity:    0.38,
    windowWidthRatio: 0.50,
    windowHeightRatio:0.40,

    balconyStyle:     "loggia",
    hasBanding:       true,
    hasCornice:       false,
    roofGeometry:     "flat",
    roofHeightRatio:  0,
    groundFloorDistinct: true,
    facadeMaterial:   "plaster",
    roofMaterial:     "concrete",

    hasPilasters:     false,
    hasLucarnes:      false,
    hasRustication:   false,
    guardrailColor:   "#5A6068",      // garde-corps alu foncé
    hasShutters:      false,
    shutterColor:     "#888",
  },

  // ── PAVILLON ──────────────────────────────────────────────────────────
  // Enduit clair, toiture tuile, volets bois vert, peu de fenêtres
  pavillon: {
    facadeColor:      "#F4EEE2",
    facadeAccentColor:"#E8DFD0",
    roofColor:        "#9A7A5C",      // tuile terre cuite
    windowFrameColor: "#C0B4A6",      // bois clair
    glassColor:       "#B0D0E0",
    glassOpacity:     0.30,

    windowShape:      "vertical",
    windowDensity:    0.25,           // très peu de fenêtres
    windowWidthRatio: 0.30,
    windowHeightRatio:0.55,

    balconyStyle:     "none",
    hasBanding:       false,
    hasCornice:       false,
    roofGeometry:     "gable",
    roofHeightRatio:  0.38,
    groundFloorDistinct: false,
    facadeMaterial:   "plaster",
    roofMaterial:     "tile",

    hasPilasters:     false,
    hasLucarnes:      false,
    hasRustication:   false,
    guardrailColor:   "#888",
    hasShutters:      true,           // volets bois !
    shutterColor:     "#5A7050",      // vert volets classique
  },

  // ── BUREAUX ───────────────────────────────────────────────────────────
  // Mur-rideau vitré, socle opaque, toit plat technique
  bureaux: {
    facadeColor:      "#D4DCE4",
    facadeAccentColor:"#B8C4D0",      // socle plus soutenu
    roofColor:        "#7A8490",
    windowFrameColor: "#90989E",      // alu brossé
    glassColor:       "#88B4D0",      // verre bleuté
    glassOpacity:     0.42,

    windowShape:      "band",
    windowDensity:    0.80,
    windowWidthRatio: 0.85,
    windowHeightRatio:0.50,

    balconyStyle:     "none",
    hasBanding:       true,           // bandes horizontales structurelles
    hasCornice:       false,
    roofGeometry:     "flat",
    roofHeightRatio:  0,
    groundFloorDistinct: true,
    facadeMaterial:   "glass_curtain",
    roofMaterial:     "concrete",

    hasPilasters:     false,
    hasLucarnes:      false,
    hasRustication:   false,
    guardrailColor:   "#888",
    hasShutters:      false,
    shutterColor:     "#888",
  },

  // ── BARRE ─────────────────────────────────────────────────────────────
  // Béton clair, fenêtres carrées, balcons filants, long volume horizontal
  barre: {
    facadeColor:      "#E2DED6",
    facadeAccentColor:"#D5D0C8",
    roofColor:        "#909AA4",
    windowFrameColor: "#A8A29A",      // béton clair
    glassColor:       "#A0C0D8",
    glassOpacity:     0.32,

    windowShape:      "square",
    windowDensity:    0.40,
    windowWidthRatio: 0.38,
    windowHeightRatio:0.44,

    balconyStyle:     "filant",
    hasBanding:       true,
    hasCornice:       false,
    roofGeometry:     "flat",
    roofHeightRatio:  0,
    groundFloorDistinct: true,
    facadeMaterial:   "concrete",
    roofMaterial:     "concrete",

    hasPilasters:     false,
    hasLucarnes:      false,
    hasRustication:   false,
    guardrailColor:   "#606870",      // garde-corps béton/métal
    hasShutters:      false,
    shutterColor:     "#888",
  },
};

// ─── Zones architecturales ──────────────────────────────────────────────────

export type ZoneKind = "socle" | "corps" | "noble" | "attique" | "couronnement";

export interface ArchitecturalZone {
  kind: ZoneKind;
  fromFloor: number;
  toFloor: number;
  scaleFactor: number;
  facadeColor: string;
  windowDensityOverride?: number;
  hasBalconies?: boolean;
}

export function getArchitecturalZones(type: BuildingTemplateType, totalFloors: number): ArchitecturalZone[] {
  const p = PRESETS[type];

  switch (type) {
    case "haussmannien": {
      const socleEnd = Math.min(2, totalFloors);
      const nobleFloor = socleEnd;
      const attiqueStart = Math.max(nobleFloor + 1, totalFloors - 1);
      const z: ArchitecturalZone[] = [];
      if (socleEnd > 0)
        z.push({ kind: "socle", fromFloor: 0, toFloor: socleEnd, scaleFactor: 1.0, facadeColor: p.facadeAccentColor, windowDensityOverride: 0.40, hasBalconies: false });
      if (nobleFloor < totalFloors) {
        z.push({ kind: "noble", fromFloor: nobleFloor, toFloor: nobleFloor + 1, scaleFactor: 1.0, facadeColor: p.facadeColor, windowDensityOverride: 0.60, hasBalconies: true });
        if (nobleFloor + 1 < attiqueStart)
          z.push({ kind: "corps", fromFloor: nobleFloor + 1, toFloor: attiqueStart, scaleFactor: 1.0, facadeColor: p.facadeColor, windowDensityOverride: 0.55 });
      }
      if (attiqueStart < totalFloors)
        z.push({ kind: "attique", fromFloor: attiqueStart, toFloor: totalFloors, scaleFactor: 0.94, facadeColor: "#E8E2D4", windowDensityOverride: 0.30 });
      return z;
    }

    case "collectif_moderne": {
      const z: ArchitecturalZone[] = [];
      const midBreak = Math.min(Math.floor(totalFloors * 0.55), totalFloors);
      const topBreak = Math.min(Math.floor(totalFloors * 0.82), totalFloors);
      // Socle commerce/hall
      z.push({ kind: "socle", fromFloor: 0, toFloor: Math.min(1, totalFloors), scaleFactor: 1.0, facadeColor: p.facadeAccentColor, windowDensityOverride: 0.50 });
      // Corps principal
      if (1 < midBreak) z.push({ kind: "corps", fromFloor: 1, toFloor: midBreak, scaleFactor: 1.0, facadeColor: p.facadeColor, hasBalconies: true });
      // Retrait intermédiaire
      if (midBreak < topBreak) z.push({ kind: "corps", fromFloor: midBreak, toFloor: topBreak, scaleFactor: 0.93, facadeColor: p.facadeColor, hasBalconies: true });
      // Couronnement attique
      if (topBreak < totalFloors) z.push({ kind: "couronnement", fromFloor: topBreak, toFloor: totalFloors, scaleFactor: 0.85, facadeColor: p.facadeAccentColor, windowDensityOverride: 0.28 });
      return z;
    }

    case "pavillon":
      return [{ kind: "corps", fromFloor: 0, toFloor: totalFloors, scaleFactor: 1.0, facadeColor: p.facadeColor }];

    case "bureaux": {
      const z: ArchitecturalZone[] = [];
      // Socle opaque
      z.push({ kind: "socle", fromFloor: 0, toFloor: Math.min(1, totalFloors), scaleFactor: 1.0, facadeColor: p.facadeAccentColor, windowDensityOverride: 0.40 });
      if (1 < totalFloors) {
        const topStart = Math.max(1, totalFloors - 1);
        // Corps vitré
        if (1 < topStart) z.push({ kind: "corps", fromFloor: 1, toFloor: topStart, scaleFactor: 1.0, facadeColor: p.facadeColor });
        // Attique retrait
        z.push({ kind: "attique", fromFloor: topStart, toFloor: totalFloors, scaleFactor: 0.95, facadeColor: p.facadeColor, windowDensityOverride: 0.65 });
      }
      return z;
    }

    case "barre": {
      const z: ArchitecturalZone[] = [];
      // Socle parking/commerce
      z.push({ kind: "socle", fromFloor: 0, toFloor: Math.min(1, totalFloors), scaleFactor: 1.0, facadeColor: p.facadeAccentColor, windowDensityOverride: 0.22 });
      const topBreak = Math.max(1, totalFloors - 2);
      // Corps principal
      if (1 < topBreak) z.push({ kind: "corps", fromFloor: 1, toFloor: topBreak, scaleFactor: 1.0, facadeColor: p.facadeColor, hasBalconies: true });
      // Couronnement
      if (topBreak < totalFloors) z.push({ kind: "couronnement", fromFloor: topBreak, toFloor: totalFloors, scaleFactor: 0.93, facadeColor: p.facadeAccentColor });
      return z;
    }

    default:
      return [{ kind: "corps", fromFloor: 0, toFloor: totalFloors, scaleFactor: 1.0, facadeColor: p.facadeColor }];
  }
}

// ─── Patch / Accesseurs / Détection ─────────────────────────────────────────

export function patchFromTemplate(cfg: BuildingTemplateConfig): Pick<MassingBuildingModel, "levels" | "setbacks" | "style"> {
  const { params } = cfg;
  const levels: BuildingLevels = {
    aboveGroundFloors: params.floors,
    groundFloorHeightM: params.floors <= 2 ? 2.8 : 3.2,
    typicalFloorHeightM: params.floorHeightM,
  };
  const setbacks = buildSetbacks(params.setbackFactors ?? [], params.floors);
  const fp = facadeParams(params.facadeStyle);
  const style: BuildingStyleOptions = {
    ...DEFAULT_BUILDING_STYLE, ...fp,
    windowRatio: Math.min(fp.windowRatio, 0.28),
    bayWidthM: Math.max(fp.bayWidthM, 4.5),
    roof: toRoofStyle(params.roofType),
    roofSlopes: toRoofSlopes(params.roofType),
    numSetbacks: Math.min(2, setbacks.length) as 0 | 1 | 2,
    structureColor: params.roofColor ?? "#6B6B66",
  };
  return { levels, setbacks, style };
}

export function patchFromTemplateType(type: BuildingTemplateType): Pick<MassingBuildingModel, "levels" | "setbacks" | "style"> {
  return patchFromTemplate(BUILDING_TEMPLATES[type]);
}

export function getVisualPresetForTemplate(type: BuildingTemplateType): TemplateVisualPreset {
  return PRESETS[type] ?? PRESETS.collectif_moderne;
}
export function getFacadeColorForTemplate(type: BuildingTemplateType): string {
  return PRESETS[type]?.facadeColor ?? "#F5F5F3";
}
export function getRoofColorForTemplate(type: BuildingTemplateType): string {
  return PRESETS[type]?.roofColor ?? "#7A7A74";
}
export function detectTemplateType(b: MassingBuildingModel): BuildingTemplateType {
  const f = b.levels.aboveGroundFloors;
  if ((b.style.windowRatio ?? 0) > 0.48) return "bureaux";
  if (f <= 2) return "pavillon";
  if (f >= 9) return "barre";
  if (b.style.roof === "inclinee" && (b.style.roofSlopes ?? 2) >= 4) return "haussmannien";
  return "collectif_moderne";
}

// Compat
export interface HaussmannianLevelStyle {
  zone: "soubassement" | "corps" | "attique"; facadeHex: string; windowRatio: number; bayWidthM: number;
  hasBanding?: boolean; hasBalconies?: boolean; hasRustication?: boolean;
}
export function getHaussmannianLevelStyle(floorIndex: number, totalFloors: number): HaussmannianLevelStyle {
  if (floorIndex <= 1) return { zone: "soubassement", facadeHex: "#D5CEBB", windowRatio: 0.22, bayWidthM: 5.0, hasBanding: true, hasBalconies: false, hasRustication: true };
  if (floorIndex >= totalFloors - 1) return { zone: "attique", facadeHex: "#ECE6D7", windowRatio: 0.18, bayWidthM: 5.5, hasBanding: false, hasBalconies: false, hasRustication: false };
  return { zone: "corps", facadeHex: "#E4DDCB", windowRatio: floorIndex === 2 ? 0.26 : 0.22, bayWidthM: 4.5, hasBanding: true, hasBalconies: floorIndex === 2, hasRustication: false };
}