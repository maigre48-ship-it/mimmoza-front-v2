// buildingBlenderSpec.helpers.ts
// Fonctions pures de construction / patch du BuildingBlenderSpec

import type { MassingBuildingModel } from '../massingScene.types';
import type {
  BuildingBlenderSpec,
  BuildingStyle,
  FacadeFamily,
  RoofFamily,
} from './buildingBlenderSpec.types';

// ─── Mappers internes ─────────────────────────────────────────────────────────

const FACADE_STYLE_ID_MAP: Record<string, BuildingStyle> = {
  residential_modern: 'residentiel_moderne',
  residential_brique: 'residentiel_brique',
  residential_pierre: 'residentiel_pierre',
  modern_glass:       'tertiaire_vitre',
  urban_mixed:        'urbain_mixte',
  minimal_white:      'minimal_blanc',
};

function deriveStyle(facadeStyleId?: string): BuildingStyle {
  if (!facadeStyleId) return 'residentiel_moderne';
  return FACADE_STYLE_ID_MAP[facadeStyleId] ?? 'residentiel_moderne';
}

function deriveFacadeFamily(style: MassingBuildingModel['style']): FacadeFamily {
  const tid = style.facadeTextureId ?? '';
  if (tid.startsWith('brick'))    return 'brique';
  if (tid.startsWith('concrete')) return 'beton';
  if (tid.startsWith('wood'))     return 'bois_bardage';
  const sid = (style as Record<string, unknown>).facadeStyleId as string | undefined ?? '';
  if (sid.includes('brique') || sid.includes('brick')) return 'brique';
  if (sid.includes('pierre') || sid.includes('pierre')) return 'pierre';
  if (sid.includes('glass')  || sid.includes('vitre')) return 'mur_rideau';
  return 'enduit';
}

function deriveRoofFamily(roof: string): RoofFamily {
  if (roof === 'vegetalise') return 'vegetalisee';
  if (roof === 'inclinee')   return 'inclinee';
  return 'terrasse';
}

// ─── API publique ─────────────────────────────────────────────────────────────

/**
 * Retourne un BuildingBlenderSpec complet à partir d'un bâtiment existant.
 * Fusionne les valeurs déjà stockées dans building.renderSpec avec des défauts
 * déduits des propriétés legacy (levels, style, transform).
 * Ne mute jamais le bâtiment source.
 */
export function ensureBuildingRenderSpec(building: MassingBuildingModel): BuildingBlenderSpec {
  const ex = building.renderSpec;
  const { levels, transform, style } = building;
  const totalH = levels.groundFloorHeightM + levels.aboveGroundFloors * levels.typicalFloorHeightM;
  const facadeStyleId = (style as Record<string, unknown>).facadeStyleId as string | undefined;

  return {
    version: 'v1',

    identity: {
      usage:    ex?.identity?.usage    ?? 'logement_collectif',
      style:    ex?.identity?.style    ?? deriveStyle(facadeStyleId),
      standing: ex?.identity?.standing ?? 'standard',
    },

    morphology: {
      floorsAboveGround:     levels.aboveGroundFloors,
      groundFloorHeightM:    levels.groundFloorHeightM,
      typicalFloorHeightM:   levels.typicalFloorHeightM,
      totalHeightM:          parseFloat(totalH.toFixed(2)),
      groundFloorType:       ex?.morphology?.groundFloorType    ?? 'hall',
      setbacksCount:         (style.numSetbacks ?? 0) as 0 | 1 | 2,
      setbackDepthM:         ex?.morphology?.setbackDepthM      ?? 2,
      atticHeightM:          ex?.morphology?.atticHeightM,
      balconyEnabled:        style.hasBalconies  ?? false,
      balconyEveryNFloors:   style.balconyFreq   ?? 2,
      balconyDepthM:         ex?.morphology?.balconyDepthM      ?? 1.2,
      balconyType:           ex?.morphology?.balconyType        ?? 'filant',
      slabProjectionEnabled: style.hasBanding    ?? true,
      edgeColumnsEnabled:    style.hasCorner     ?? false,
      offsetX:               transform.offsetX,
      offsetY:               transform.offsetY,
      rotationDeg:           parseFloat((transform.rotationRad * 180 / Math.PI).toFixed(1)),
    },

    facade: {
      family:            ex?.facade?.family           ?? deriveFacadeFamily(style),
      baseColor:         style.facadeColor             ?? '#EDE8DA',
      texturePresetId:   style.facadeTextureId,
      textureRotationDeg: style.facadeTextureRotation  ?? 0,
      textureScale:      style.facadeTextureScale       ?? 1,
      glazingRatioPct:   Math.round((style.windowRatio  ?? 0.55) * 100),
      bayWidthM:         style.bayWidthM               ?? 3.5,
      reliefLevel:       ex?.facade?.reliefLevel        ?? 'light',
      modulationType:    ex?.facade?.modulationType     ?? 'horizontal_bands',
      openingType:       ex?.facade?.openingType        ?? 'window',
      openingRhythm:     ex?.facade?.openingRhythm      ?? 'regular',
      frameColor:        ex?.facade?.frameColor         ?? style.structureColor ?? '#374151',
      frameDepth:        ex?.facade?.frameDepth         ?? 'standard',
      railingType:       ex?.facade?.railingType        ?? 'metal',
      railingColor:      ex?.facade?.railingColor       ?? style.structureColor ?? '#374151',
    },

    roof: {
      type:                    deriveRoofFamily(style.roof ?? 'terrasse'),
      texturePresetId:         style.roofTextureId,
      roofColor:               ex?.roof?.roofColor,
      crownType:               ex?.roof?.crownType               ?? 'thin_parapet',
      technicalVolumesVisible: ex?.roof?.technicalVolumesVisible ?? false,
      solarPanels:             ex?.roof?.solarPanels             ?? false,
      vegetationLevel:         style.roof === 'vegetalise'
                                 ? (ex?.roof?.vegetationLevel    ?? 'medium')
                                 : ex?.roof?.vegetationLevel,
      roofRailing:             ex?.roof?.roofRailing             ?? 'discreet',
    },

    landscape: {
      siteFinish:           ex?.landscape?.siteFinish           ?? 'simple',
      groundMaterial:       ex?.landscape?.groundMaterial       ?? 'pavers',
      hedgeEnabled:         ex?.landscape?.hedgeEnabled         ?? false,
      hedgeHeightM:         ex?.landscape?.hedgeHeightM         ?? 1.2,
      treeCount:            ex?.landscape?.treeCount            ?? 0,
      treeType:             ex?.landscape?.treeType             ?? 'deciduous',
      gateEnabled:          ex?.landscape?.gateEnabled          ?? false,
      fenceType:            ex?.landscape?.fenceType            ?? 'none',
      parkingVisible:       ex?.landscape?.parkingVisible       ?? true,
      lightStreetFurniture: ex?.landscape?.lightStreetFurniture ?? 'none',
    },

    render: {
      intent:        ex?.render?.intent        ?? 'promoteur_premium',
      cameraView:    ex?.render?.cameraView    ?? 'aerial_3q',
      timeOfDay:     ex?.render?.timeOfDay     ?? 'afternoon',
      sky:           ex?.render?.sky           ?? 'neutral',
      detailLevel:   ex?.render?.detailLevel   ?? 'standard',
      urbanContext:  ex?.render?.urbanContext  ?? 'neutral_masses',
      focalLengthMm: ex?.render?.focalLengthMm ?? 50,
      outputFormat:  ex?.render?.outputFormat  ?? 'landscape',
      usage:         ex?.render?.usage         ?? 'comite',
    },
  };
}

/**
 * Retourne un nouveau BuildingBlenderSpec avec un patch appliqué sur une section.
 * Fonction pure — ne mute rien.
 */
export function patchBuildingRenderSpec<S extends Exclude<keyof BuildingBlenderSpec, 'version'>>(
  building: MassingBuildingModel,
  section: S,
  patch: Partial<BuildingBlenderSpec[S]>,
): BuildingBlenderSpec {
  const current = ensureBuildingRenderSpec(building);
  return {
    ...current,
    [section]: { ...(current[section] as object), ...(patch as object) },
  };
}