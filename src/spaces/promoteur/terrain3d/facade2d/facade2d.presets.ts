import type {
  Facade2DStylePresetId,
  Facade2DBalconyMode,
  Facade2DLoggiaMode,
  Facade2DBaseKind,
  Facade2DRenderTheme,
  Facade2DRoofKind,
} from './facade2d.types';

export interface Facade2DPreset {
  id: Facade2DStylePresetId;
  label: string;
  description: string;
  theme: Facade2DRenderTheme;
  defaultBaysCount: number;
  defaultBalconyMode: Facade2DBalconyMode;
  defaultLoggiaMode: Facade2DLoggiaMode;
  defaultBaseKind: Facade2DBaseKind;
  defaultRoofKind: Facade2DRoofKind;
  hasAttic: boolean;
  hasCornice: boolean;
  hasSocle: boolean;
  openingHeightRatio: number;
  openingWidthRatio: number;
  baseSocleRatio: number;
  /** Fenêtres avec arches arrondies */
  hasArch: boolean;
  /** Volets par défaut */
  hasShutter: boolean;
}

const PRESETS: Record<Facade2DStylePresetId, Facade2DPreset> = {
  'contemporain-urbain': {
    id: 'contemporain-urbain',
    label: 'Contemporain Urbain',
    description: 'Lignes épurées, grandes baies vitrées, balcons filants',
    theme: {
      palette: {
        facade: '#F5F5F0', facadeAccent: '#E8E6E0', base: '#3A3A3A',
        openingFill: '#B8D4E3', openingStroke: '#6B6B6B', frameFill: '#404040',
        balconyFill: '#D4D4D4', balconyStroke: '#888888',
        roofFill: '#7A7A7A', groundFill: '#C8C0B4', shadow: 'rgba(0,0,0,0.06)',
        corniceFill: '#A0A0A0', shutterFill: '#606060', loggiaBg: '#E8E6E0',
        skyTop: '#E8F0F8', skyBottom: '#F8FAFE',
        treeFill: '#6B9E5A', treeTrunk: '#8B7355',
      },
      strokeWidth: 1, cornerRadius: 0, showShadow: true, tone: 'cool',
    },
    defaultBaysCount: 5, defaultBalconyMode: 'continuous', defaultLoggiaMode: 'none',
    defaultBaseKind: 'commercial', defaultRoofKind: 'flat',
    hasAttic: true, hasCornice: false, hasSocle: true,
    openingHeightRatio: 0.6, openingWidthRatio: 0.55, baseSocleRatio: 0.3,
    hasArch: false, hasShutter: false,
  },

  'residentiel-premium': {
    id: 'residentiel-premium',
    label: 'Résidentiel Premium',
    description: 'Enduit clair, balcons ponctuels, modénatures élégantes',
    theme: {
      palette: {
        facade: '#FAF7F2', facadeAccent: '#EDE8DF', base: '#8C7B6B',
        openingFill: '#C5D8E8', openingStroke: '#7A7A7A', frameFill: '#505050',
        balconyFill: '#E0DAD0', balconyStroke: '#9E9080',
        roofFill: '#A09080', groundFill: '#D4CFC6', shadow: 'rgba(0,0,0,0.05)',
        corniceFill: '#B0A090', shutterFill: '#7A7060', loggiaBg: '#EDE8DF',
        skyTop: '#F0EBE0', skyBottom: '#FAF7F2',
        treeFill: '#5E8F50', treeTrunk: '#7A6545',
      },
      strokeWidth: 1.2, cornerRadius: 2, showShadow: true, tone: 'warm',
    },
    defaultBaysCount: 4, defaultBalconyMode: 'punctual', defaultLoggiaMode: 'none',
    defaultBaseKind: 'residential', defaultRoofKind: 'hip',
    hasAttic: false, hasCornice: false, hasSocle: false,
    openingHeightRatio: 0.55, openingWidthRatio: 0.4, baseSocleRatio: 0.25,
    hasArch: false, hasShutter: false,
  },

  'classique-revisite': {
    id: 'classique-revisite',
    label: 'Classique Revisité',
    description: 'Toiture mansardée, travées régulières, socle pierre',
    theme: {
      palette: {
        facade: '#F0EDE6', facadeAccent: '#DDD8CE', base: '#A09585',
        openingFill: '#BCC8D4', openingStroke: '#666666', frameFill: '#3A3A3A',
        balconyFill: '#C8C0B4', balconyStroke: '#8A8070',
        roofFill: '#5C5C5C', groundFill: '#C0B8A8', shadow: 'rgba(0,0,0,0.07)',
        corniceFill: '#9E8E72', shutterFill: '#2E2820', loggiaBg: '#DDD8CE',
        skyTop: '#E5E8ED', skyBottom: '#F0EDE6',
        treeFill: '#4D7A40', treeTrunk: '#6B5535',
      },
      strokeWidth: 1.4, cornerRadius: 3, showShadow: true, tone: 'cool',
    },
    defaultBaysCount: 5, defaultBalconyMode: 'punctual', defaultLoggiaMode: 'none',
    defaultBaseKind: 'commercial', defaultRoofKind: 'mansard',
    hasAttic: true, hasCornice: true, hasSocle: true,
    openingHeightRatio: 0.58, openingWidthRatio: 0.38, baseSocleRatio: 0.35,
    hasArch: true, hasShutter: false,
  },

  'mediterraneen-lumineux': {
    id: 'mediterraneen-lumineux',
    label: 'Méditerranéen Lumineux',
    description: 'Enduit chaud, volets, terrasses ouvertes',
    theme: {
      palette: {
        facade: '#FDF6EC', facadeAccent: '#F0E4D0', base: '#C4A882',
        openingFill: '#A3CBE0', openingStroke: '#8A7A6A', frameFill: '#6A5A4A',
        balconyFill: '#D8C8B0', balconyStroke: '#B0A090',
        roofFill: '#C27040', groundFill: '#E0D4C0', shadow: 'rgba(0,0,0,0.04)',
        corniceFill: '#C4A882', shutterFill: '#6A8A5A', loggiaBg: '#F0E4D0',
        skyTop: '#D4E8F8', skyBottom: '#FDF6EC',
        treeFill: '#5A8848', treeTrunk: '#8A7050',
      },
      strokeWidth: 1, cornerRadius: 4, showShadow: true, tone: 'warm',
    },
    defaultBaysCount: 4, defaultBalconyMode: 'continuous', defaultLoggiaMode: 'none',
    defaultBaseKind: 'residential', defaultRoofKind: 'hip',
    hasAttic: false, hasCornice: false, hasSocle: false,
    openingHeightRatio: 0.52, openingWidthRatio: 0.42, baseSocleRatio: 0.2,
    hasArch: true, hasShutter: true,
  },
};

export function getFacade2DPreset(id: Facade2DStylePresetId): Facade2DPreset {
  return PRESETS[id];
}

export function getAllFacade2DPresets(): Facade2DPreset[] {
  return Object.values(PRESETS);
}

export const FACADE2D_PRESET_IDS = Object.keys(PRESETS) as Facade2DStylePresetId[];