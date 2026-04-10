// massingScene.types.ts

import type { BuildingBlenderSpec } from './terrain3d/components/buildingBlenderSpec.types';

export type FacadeStyle = "beton" | "vitrage" | "brique" | "zinc" | "bois";
export type RoofStyle = "terrasse" | "vegetalise" | "inclinee";

export interface BuildingStyleOptions {
  facade: FacadeStyle;
  roof: RoofStyle;
  facadeColor: string;
  structureColor: string;
  windowRatio: number;
  bayWidthM: number;
  hasBalconies: boolean;
  balconyFreq: number;
  hasBanding: boolean;
  hasCorner: boolean;
  numSetbacks: number;
  roofSlopes: number;

  facadeTextureId?: string;
  roofTextureId?: string;
  facadeTextureRotation?: number;
  facadeTextureScale?: number;

  glassColor?: string;
  glassOpacity?: number;

  /** Débord de toit en mètres (0 = ras du mur, 1.2 = débord typique) */
  roofOverhangM?: number;
  /** Activer les chiens assis (toiture inclinée uniquement) */
  roofDormerEnabled?: boolean;
  /** Nombre de chiens assis par versant (1-4) */
  roofDormerCount?: number;

  /** Style architectural sélectionné dans le panneau */
  facadeStyleId?: string;
}

export const DEFAULT_BUILDING_STYLE: BuildingStyleOptions = {
  facade: "beton",
  roof: "terrasse",
  facadeColor: "#EDE8DA",
  structureColor: "#374151",
  windowRatio: 0.55,
  bayWidthM: 3.5,
  hasBalconies: false,
  balconyFreq: 2,
  hasBanding: true,
  hasCorner: false,
  numSetbacks: 1,
  roofSlopes: 2,
  facadeTextureId: "concrete/concrete047a",
  roofTextureId: "roof/roofingtiles014a",
  facadeTextureRotation: 0,
  facadeTextureScale: 1,
  glassColor: "#2A3540",
  glassOpacity: 0.8,
  roofOverhangM: 0,
  roofDormerEnabled: false,
  roofDormerCount: 1,
  facadeStyleId: "",
};

// ─── Géométrie ────────────────────────────────────────────────────────────────

export type Pt2D = [number, number];

export interface BuildingFootprint {
  points: [number, number][];
  epsg: string;
}

export interface BuildingTransform {
  offsetX: number;
  offsetY: number;
  rotationRad: number;
}

export interface BuildingLevels {
  aboveGroundFloors: number;
  groundFloorHeightM: number;
  typicalFloorHeightM: number;
}

export function totalHeightM(levels: BuildingLevels): number {
  return levels.groundFloorHeightM + levels.aboveGroundFloors * levels.typicalFloorHeightM;
}

export function totalLevelsCount(levels: BuildingLevels): number {
  return 1 + levels.aboveGroundFloors;
}

export interface SetbackRule {
  fromFloor: number;
  scaleFactor: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ARCHITECTURE PARAMÉTRIQUE V1
// ═══════════════════════════════════════════════════════════════════════════════

export type BuildingSide = "front" | "back" | "left" | "right";

export type MassingFacadeStyleType =
  | "residential"
  | "residential_balcony"
  | "residential_loggia"
  | "office"
  | "mixed_base"
  | "blank";

export type MassingRoofType =
  | "flat"
  | "flat_attic"
  | "double_pitch"
  | "single_pitch";

export interface MassingVerticalComposition {
  /** Nombre de niveaux du socle, RDC inclus */
  socleLevels: number;
  /** Nombre de niveaux courants au-dessus du socle */
  upperLevels: number;
  /** Nombre de niveaux d'attique */
  atticLevels: number;

  /** Hauteur libre/étage du socle */
  socleHeightM: number;
  /** Hauteur libre/étage courant */
  upperFloorHeightM: number;
  /** Hauteur libre/étage attique */
  atticFloorHeightM: number;
}

export interface MassingSetbackRule {
  enabled: boolean;
  frontM: number;
  backM: number;
  leftM: number;
  rightM: number;
}

export interface MassingFacadeStyle {
  type: MassingFacadeStyleType;
  materialPresetId?: string;
  openingPreset?: string;
  bayWidthM: number;
  windowWidthM: number;
  windowHeightM: number;
  sillHeightM: number;
  frameDepthM: number;
  spandrelHeightM?: number;
  groundFloorVitrified: boolean;
  balconyEnabled?: boolean;
  loggiaEnabled?: boolean;
}

export interface MassingFacadeOverrides {
  front?: Partial<MassingFacadeStyle>;
  back?: Partial<MassingFacadeStyle>;
  left?: Partial<MassingFacadeStyle>;
  right?: Partial<MassingFacadeStyle>;
}

export interface MassingRoofStyleEx {
  roofType: MassingRoofType;
  parapetHeightM: number;
  atticSetbackM: number;
  slopeDeg: number;
}

export interface MassingArchitectureStyle {
  vertical: MassingVerticalComposition;
  setback: MassingSetbackRule;
  facadeBase: MassingFacadeStyle;
  facadeOverrides?: MassingFacadeOverrides;
  roof: MassingRoofStyleEx;
}

export function defaultVerticalComposition(): MassingVerticalComposition {
  return {
    socleLevels: 1,
    upperLevels: 2,
    atticLevels: 0,
    socleHeightM: 3.6,
    upperFloorHeightM: 2.9,
    atticFloorHeightM: 2.7,
  };
}

export function defaultMassingSetbackRule(): MassingSetbackRule {
  return {
    enabled: false,
    frontM: 2,
    backM: 2,
    leftM: 2,
    rightM: 2,
  };
}

export function defaultMassingFacadeStyle(): MassingFacadeStyle {
  return {
    type: "residential",
    materialPresetId: "concrete/concrete047a",
    openingPreset: "window",
    bayWidthM: 3.2,
    windowWidthM: 1.6,
    windowHeightM: 1.45,
    sillHeightM: 0.9,
    frameDepthM: 0.12,
    spandrelHeightM: 0.75,
    groundFloorVitrified: true,
    balconyEnabled: false,
    loggiaEnabled: false,
  };
}

export function defaultMassingRoofStyleEx(): MassingRoofStyleEx {
  return {
    roofType: "flat",
    parapetHeightM: 0.45,
    atticSetbackM: 2,
    slopeDeg: 0,
  };
}

export function createDefaultArchitectureStyle(): MassingArchitectureStyle {
  return {
    vertical: defaultVerticalComposition(),
    setback: defaultMassingSetbackRule(),
    facadeBase: defaultMassingFacadeStyle(),
    facadeOverrides: {
      front: {
        groundFloorVitrified: true,
      },
    },
    roof: defaultMassingRoofStyleEx(),
  };
}

export function getResolvedFacadeStyleForSide(
  architecture: MassingArchitectureStyle | undefined,
  side: BuildingSide,
): MassingFacadeStyle {
  const base = architecture?.facadeBase ?? defaultMassingFacadeStyle();
  const override = architecture?.facadeOverrides?.[side];

  return {
    ...base,
    ...(override ?? {}),
  };
}

/**
 * Synchronise les niveaux "legacy" avec la composition verticale architecture.
 * Pratique pour conserver la compatibilité du moteur existant pendant la transition.
 */
export function buildingLevelsFromArchitecture(
  architecture?: MassingArchitectureStyle,
): BuildingLevels {
  const vertical = architecture?.vertical ?? defaultVerticalComposition();
  const aboveGroundFloors = Math.max(0, vertical.socleLevels + vertical.upperLevels + vertical.atticLevels - 1);

  return {
    aboveGroundFloors,
    groundFloorHeightM: vertical.socleHeightM,
    typicalFloorHeightM: vertical.upperFloorHeightM,
  };
}

export function architectureFromBuildingLevels(
  levels: BuildingLevels,
): MassingArchitectureStyle {
  const total = totalLevelsCount(levels);
  const upperLevels = Math.max(0, total - 1);

  return {
    vertical: {
      socleLevels: 1,
      upperLevels,
      atticLevels: 0,
      socleHeightM: levels.groundFloorHeightM,
      upperFloorHeightM: levels.typicalFloorHeightM,
      atticFloorHeightM: Math.max(2.6, levels.typicalFloorHeightM - 0.1),
    },
    setback: defaultMassingSetbackRule(),
    facadeBase: {
      ...defaultMassingFacadeStyle(),
      bayWidthM: DEFAULT_BUILDING_STYLE.bayWidthM,
      groundFloorVitrified: true,
      materialPresetId: DEFAULT_BUILDING_STYLE.facadeTextureId,
    },
    facadeOverrides: {
      front: {
        groundFloorVitrified: true,
      },
    },
    roof: defaultMassingRoofStyleEx(),
  };
}

export function totalHeightFromArchitecture(
  architecture?: MassingArchitectureStyle,
): number {
  const vertical = architecture?.vertical ?? defaultVerticalComposition();

  return (
    vertical.socleLevels * vertical.socleHeightM +
    vertical.upperLevels * vertical.upperFloorHeightM +
    vertical.atticLevels * vertical.atticFloorHeightM
  );
}

export function totalLevelsFromArchitecture(
  architecture?: MassingArchitectureStyle,
): number {
  const vertical = architecture?.vertical ?? defaultVerticalComposition();
  return vertical.socleLevels + vertical.upperLevels + vertical.atticLevels;
}

// ─── Modèle bâtiment ──────────────────────────────────────────────────────────

export interface MassingBuildingModel {
  id: string;
  name: string;
  footprint: BuildingFootprint;
  transform: BuildingTransform;
  levels: BuildingLevels;
  setbacks: SetbackRule[];
  style: BuildingStyleOptions;
  /**
   * Nouveau modèle paramétrique d'architecture.
   * Le moteur legacy peut continuer à lire levels/style/setbacks,
   * mais la nouvelle V1 architecture doit prioriser ce bloc.
   */
  architecture?: MassingArchitectureStyle;
  /**
   * Contrat de rendu Blender — source de vérité pour l'export 3D.
   * Déduit automatiquement depuis les propriétés legacy si absent.
   */
  renderSpec?: BuildingBlenderSpec;
  visible: boolean;
  meta?: {
    footprintM2?: number;
    sdpEstimeeM2?: number;
    nbLogementsEst?: number;
  };
}

export function defaultBuildingLevels(): BuildingLevels {
  return { aboveGroundFloors: 3, groundFloorHeightM: 3.0, typicalFloorHeightM: 2.8 };
}

export function defaultBuildingTransform(): BuildingTransform {
  return { offsetX: 0, offsetY: 0, rotationRad: 0 };
}

export function createBuilding(
  id: string,
  name: string,
  footprint: BuildingFootprint,
  overrides?: Partial<Omit<MassingBuildingModel, "id" | "name" | "footprint">>,
): MassingBuildingModel {
  const defaultArchitecture = createDefaultArchitectureStyle();
  const defaultLevels = buildingLevelsFromArchitecture(defaultArchitecture);

  return {
    id,
    name,
    footprint,
    transform: defaultBuildingTransform(),
    levels: defaultLevels,
    setbacks: [],
    style: { ...DEFAULT_BUILDING_STYLE },
    architecture: defaultArchitecture,
    visible: true,
    ...overrides,
  };
}

export function normalizeBuildingArchitecture(
  building: MassingBuildingModel,
): MassingBuildingModel {
  const architecture = building.architecture ?? architectureFromBuildingLevels(building.levels);
  const levels = buildingLevelsFromArchitecture(architecture);

  return {
    ...building,
    architecture,
    levels,
  };
}

// ─── Objets placés ────────────────────────────────────────────────────────────

export type PlacedObjectType = "tree" | "portail" | "bush";

export interface PlacedObject {
  id: string;
  type: PlacedObjectType;
  x: number;
  z: number;
  rotationY?: number;
  treeType?: string;
  scale?: number;
  widthM?: number;
  heightM?: number;
  color?: string;
}

export interface MassingSceneModel {
  version: number;
  buildings: MassingBuildingModel[];
  parcel?: unknown;
  parkings?: unknown;
  placedObjects?: PlacedObject[];
  reliefData?: unknown;
}

export const SCENE_VERSION = 1;

export function emptyScene(): MassingSceneModel {
  return { version: SCENE_VERSION, buildings: [], placedObjects: [] };
}

// ─── Éditeur ──────────────────────────────────────────────────────────────────

export type EditorTool =
  | "select"
  | "add_rect"
  | "orbit"
  | "place_tree"
  | "place_portail";

export type DragMode = "none" | "translate" | "rotate";

export interface EditorState {
  activeTool: EditorTool;
  selectedId: string | null;
  hoverId: string | null;
  dragMode: DragMode;
  scene: MassingSceneModel;
  isDirty: boolean;
}

export type EditorAction =
  | { type: "SET_TOOL"; tool: EditorTool }
  | { type: "SELECT"; id: string | null }
  | { type: "HOVER"; id: string | null }
  | { type: "ADD_BUILDING"; building: MassingBuildingModel }
  | { type: "DELETE_BUILDING"; id: string }
  | { type: "DUPLICATE_BUILDING"; id: string }
  | { type: "UPDATE_BUILDING"; id: string; patch: Partial<Omit<MassingBuildingModel, "id">> }
  | { type: "UPDATE_LEVELS"; id: string; levels: Partial<BuildingLevels> }
  | { type: "UPDATE_TRANSFORM"; id: string; transform: Partial<BuildingTransform> }
  | { type: "UPDATE_STYLE"; id: string; style: Partial<BuildingStyleOptions> }
  | { type: "UPDATE_ARCHITECTURE"; id: string; architecture: Partial<MassingArchitectureStyle> }
  | { type: "SET_SCENE"; scene: MassingSceneModel }
  | { type: "ADD_OBJECT"; obj: PlacedObject }
  | { type: "DELETE_OBJECT"; id: string }
  | { type: "MARK_CLEAN" };

let _idCounter = 0;
export function generateBuildingId(): string {
  return `bld_${Date.now().toString(36)}_${++_idCounter}`;
}

// ─── Calculs / meta ───────────────────────────────────────────────────────────

export function polygonArea(pts: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
  }
  return Math.abs(a) / 2;
}

export function computeBuildingMeta(
  b: MassingBuildingModel,
  mPerGeoUnit: number,
): NonNullable<MassingBuildingModel["meta"]> {
  const footprintM2 = Math.round(polygonArea(b.footprint.points) * mPerGeoUnit * mPerGeoUnit);

  const levelCount = b.architecture
    ? totalLevelsFromArchitecture(b.architecture)
    : totalLevelsCount(b.levels);

  const sdpEstimeeM2 = Math.round(footprintM2 * levelCount * 0.82);
  const nbLogementsEst = Math.max(0, Math.round(sdpEstimeeM2 / 55));

  return { footprintM2, sdpEstimeeM2, nbLogementsEst };
}

export type LevelSetback = SetbackRule;

export const DEFAULT_LEVELS: BuildingLevels = {
  aboveGroundFloors: 3,
  groundFloorHeightM: 3.0,
  typicalFloorHeightM: 2.8,
};

export const DEFAULT_STYLE: BuildingStyleOptions = { ...DEFAULT_BUILDING_STYLE };

export const DEFAULT_TRANSFORM: BuildingTransform = {
  offsetX: 0,
  offsetY: 0,
  rotationRad: 0,
};

export const DEFAULT_ARCHITECTURE: MassingArchitectureStyle = createDefaultArchitectureStyle();

// ─── Templates ────────────────────────────────────────────────────────────────

export type BuildingTemplateType =
  | "collectif_moderne"
  | "haussmannien"
  | "pavillon"
  | "bureaux"
  | "barre";

export type TemplateFacadeStyle =
  | "minimal"
  | "bandes"
  | "grille_legere"
  | "vitrage_total";

export type TemplateRoofType = "flat" | "gable" | "mansard" | "shed";

export interface BuildingTemplateConfig {
  type: BuildingTemplateType;
  label: string;
  params: {
    floors: number;
    floorHeightM: number;
    roofType: TemplateRoofType;
    facadeStyle: TemplateFacadeStyle;
    setbackFactors?: number[];
    facadeColor?: string;
    roofColor?: string;
  };
}

export const BUILDING_TEMPLATES: Record<BuildingTemplateType, BuildingTemplateConfig> = {
  collectif_moderne: {
    type: "collectif_moderne",
    label: "Collectif moderne",
    params: {
      floors: 7,
      floorHeightM: 2.9,
      roofType: "flat",
      facadeStyle: "bandes",
      facadeColor: "#EAE6DA",
      roofColor: "#C8C2B0",
      setbackFactors: [1, 1, 0.9, 0.82],
    },
  },
  haussmannien: {
    type: "haussmannien",
    label: "Haussmannien",
    params: {
      floors: 6,
      floorHeightM: 3.15,
      roofType: "mansard",
      facadeStyle: "grille_legere",
      facadeColor: "#E8E2D0",
      roofColor: "#2C3440",
      setbackFactors: [1, 1, 1, 1, 0.96, 0.9],
    },
  },
  pavillon: {
    type: "pavillon",
    label: "Pavillon",
    params: {
      floors: 1,
      floorHeightM: 2.8,
      roofType: "gable",
      facadeStyle: "minimal",
      facadeColor: "#F0EDE4",
      roofColor: "#6B5A4E",
    },
  },
  bureaux: {
    type: "bureaux",
    label: "Bureaux contemporains",
    params: {
      floors: 5,
      floorHeightM: 3.5,
      roofType: "flat",
      facadeStyle: "vitrage_total",
      facadeColor: "#CDD8E8",
      roofColor: "#374151",
      setbackFactors: [1, 1, 1, 0.94],
    },
  },
  barre: {
    type: "barre",
    label: "Barre résidentielle",
    params: {
      floors: 9,
      floorHeightM: 2.8,
      roofType: "flat",
      facadeStyle: "bandes",
      facadeColor: "#E8E4D8",
      roofColor: "#B8B4A8",
      setbackFactors: [1, 1, 1, 1, 1, 0.92, 0.85],
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// V1 MASSING — TYPES MÉTIER SIMPLES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mode d'ancrage d'un bâtiment sur le terrain.
 */
export type AnchorMode = "centroid" | "footprint-min" | "footprint-avg" | "footprint-max";

/**
 * Type de bâtiment simplifié pour le massing V1.
 */
export type SimpleBuildingKind =
  | "collectif"
  | "bureau"
  | "commerce"
  | "equipement"
  | "parking"
  | "generique";

export const KIND_FACADE_COLOR: Record<SimpleBuildingKind, string> = {
  collectif:  "#EDE8DA",
  bureau:     "#CDD8E0",
  commerce:   "#D4A882",
  equipement: "#D6CFC0",
  parking:    "#A8A8A0",
  generique:  "#DCDAD2",
};

export const KIND_ROOF_COLOR: Record<SimpleBuildingKind, string> = {
  collectif:  "#8A8278",
  bureau:     "#6E7A82",
  commerce:   "#787068",
  equipement: "#7A7268",
  parking:    "#606060",
  generique:  "#787068",
};

export interface BuildingV1Meta {
  kind: SimpleBuildingKind;
  anchorMode: AnchorMode;
  atticHeightM: number;
  atticSetbackRatio: number;
  facadeColorOverride?: string;
  roofColorOverride?: string;
}

export function defaultBuildingV1Meta(kind: SimpleBuildingKind = "generique"): BuildingV1Meta {
  return {
    kind,
    anchorMode: "footprint-avg",
    atticHeightM: 0,
    atticSetbackRatio: 0.1,
  };
}

export interface ProjectSceneModel {
  version: number;
  buildings: MassingBuildingModel[];
  parcelRing?: [number, number][];
  parkingRings?: [number, number][][];
  placedObjects?: PlacedObject[];
  reliefData?: unknown;
  projectMeta?: {
    communeInsee?: string;
    parcelAreaM2?: number;
    zoneUrb?: string;
    createdAt?: number;
    updatedAt?: number;
  };
}

export function projectSceneFromMassingScene(s: MassingSceneModel): ProjectSceneModel {
  return {
    version: s.version,
    buildings: s.buildings,
    placedObjects: s.placedObjects ?? [],
  };
}