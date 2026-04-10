// ─── Facade2D Types V2 ───

export type Facade2DStylePresetId =
  | 'contemporain-urbain'
  | 'residentiel-premium'
  | 'classique-revisite'
  | 'mediterraneen-lumineux';

export type Facade2DMaterialTone = 'light' | 'warm' | 'cool' | 'dark';
export type Facade2DOpeningKind = 'window' | 'door' | 'bay' | 'french-window';
export type Facade2DBalconyMode = 'none' | 'punctual' | 'continuous';
export type Facade2DLoggiaMode = 'none' | 'simple';
export type Facade2DBaseKind = 'commercial' | 'residential' | 'pilotis' | 'plain';
export type Facade2DRoofKind = 'flat' | 'gable' | 'hip' | 'mansard';
export type Facade2DRhythm = 'regular' | 'syncopated' | 'symmetric' | 'dynamic';
export type Facade2DAmbiance = 'matin' | 'golden' | 'couvert' | 'crepuscule';
export type Facade2DVegetation = 'aucune' | 'legere' | 'residentielle' | 'premium';

export interface Facade2DOpening {
  kind: Facade2DOpeningKind;
  widthM: number;
  heightM: number;
  offsetXM: number;
  offsetYM: number;
  hasShutter: boolean;
  /** Arche arrondie (haussmannien / méditerranéen) */
  hasArch: boolean;
}

export interface Facade2DBalcony {
  mode: 'punctual' | 'continuous';
  widthM: number;
  depthM: number;
  heightM: number;
  offsetXM: number;
  offsetYM: number;
}

export interface Facade2DLoggia {
  widthM: number;
  heightM: number;
  offsetXM: number;
  offsetYM: number;
}

export interface Facade2DLevel {
  index: number;
  kind: 'base' | 'typical' | 'attic';
  heightM: number;
  openings: Facade2DOpening[];
  balconies: Facade2DBalcony[];
  loggias: Facade2DLoggia[];
}

export interface Facade2DPalette {
  facade: string;
  facadeAccent: string;
  base: string;
  openingFill: string;
  openingStroke: string;
  frameFill: string;
  balconyFill: string;
  balconyStroke: string;
  roofFill: string;
  groundFill: string;
  shadow: string;
  corniceFill: string;
  shutterFill: string;
  loggiaBg: string;
  /** Fond SVG selon ambiance */
  skyTop: string;
  skyBottom: string;
  /** Teinte végétation */
  treeFill: string;
  treeTrunk: string;
}

export interface Facade2DRenderTheme {
  palette: Facade2DPalette;
  strokeWidth: number;
  cornerRadius: number;
  showShadow: boolean;
  tone: Facade2DMaterialTone;
}

export interface Facade2DModel {
  stylePresetId: Facade2DStylePresetId;
  styleLabel: string;
  widthM: number;
  heightM: number;
  levelsCount: number;
  levelHeightM: number;
  baysCount: number;
  baseLevelHeightM: number;
  baseKind: Facade2DBaseKind;
  roofKind: Facade2DRoofKind;
  hasAttic: boolean;
  hasCornice: boolean;
  hasSocle: boolean;
  balconyMode: Facade2DBalconyMode;
  loggiaMode: Facade2DLoggiaMode;
  rhythm: Facade2DRhythm;
  ambiance: Facade2DAmbiance;
  vegetation: Facade2DVegetation;
  levels: Facade2DLevel[];
  theme: Facade2DRenderTheme;
}

/** Input enrichi V2 — tout ce que le panneau gauche peut transmettre */
export interface Facade2DBuildInput {
  widthM?: number;
  depthM?: number;
  levelsCount?: number;
  levelHeightM?: number;
  totalHeightM?: number;
  baysCount?: number;
  roofKind?: Facade2DRoofKind;
  hasAttic?: boolean;
  balconyMode?: Facade2DBalconyMode;
  loggiaMode?: Facade2DLoggiaMode;
  baseKind?: Facade2DBaseKind;
  stylePresetId?: Facade2DStylePresetId;
  /** Matériau façade brut depuis le panneau */
  facadeMaterial?: string;
  /** Matériau menuiseries brut */
  windowMaterial?: string;
  /** Matériau toiture brut */
  roofMaterial?: string;
  /** Rythme de façade */
  rhythm?: Facade2DRhythm;
  /** Corniche activée */
  hasCornice?: boolean;
  /** Socle activé */
  hasSocle?: boolean;
  /** Ambiance lumineuse */
  ambiance?: Facade2DAmbiance;
  /** Végétation */
  vegetation?: Facade2DVegetation;
  /** Type de RDC brut */
  rdcType?: string;
  /** Style architectural brut */
  archStyle?: string;
}