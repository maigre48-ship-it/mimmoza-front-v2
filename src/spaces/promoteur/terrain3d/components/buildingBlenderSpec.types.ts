// buildingBlenderSpec.types.ts
// Contrat de données pour l'export Blender — source de vérité pour le rendu 3D

export type BlenderRenderIntent =
  | 'esquisse_blanche'
  | 'aquarelle'
  | 'realiste_doux'
  | 'promoteur_premium'
  | 'comite_investissement';

export type BuildingUsage =
  | 'logement_collectif'
  | 'tertiaire'
  | 'mixte'
  | 'hotel'
  | 'residence_senior'
  | 'commerce_logement';

export type BuildingStyle =
  | 'residentiel_moderne'
  | 'residentiel_brique'
  | 'residentiel_pierre'
  | 'tertiaire_vitre'
  | 'urbain_mixte'
  | 'minimal_blanc'
  | 'haussmannien'
  | 'patrimonial';

export type FacadeFamily =
  | 'enduit'
  | 'beton'
  | 'brique'
  | 'pierre'
  | 'zinc_metal'
  | 'bois_bardage'
  | 'mur_rideau';

export type RoofFamily =
  | 'terrasse'
  | 'vegetalisee'
  | 'inclinee';

export type RailingType =
  | 'metal'
  | 'glass'
  | 'masonry';

export type GroundFloorType =
  | 'none'
  | 'hall'
  | 'retail'
  | 'office';

export type BuildingBlenderSpec = {
  version: 'v1';

  identity: {
    usage:    BuildingUsage;
    style:    BuildingStyle;
    standing: 'economique' | 'standard' | 'premium' | 'prestige';
  };

  morphology: {
    floorsAboveGround:     number;
    groundFloorHeightM:    number;
    typicalFloorHeightM:   number;
    totalHeightM:          number;
    groundFloorType:       GroundFloorType;
    setbacksCount:         0 | 1 | 2;
    setbackDepthM?:        number;
    atticHeightM?:         number;
    balconyEnabled:        boolean;
    balconyEveryNFloors?:  number;
    balconyDepthM?:        number;
    balconyType?:          'filant' | 'ponctuel' | 'loggia';
    slabProjectionEnabled: boolean;
    edgeColumnsEnabled:    boolean;
    offsetX?:              number;
    offsetY?:              number;
    rotationDeg?:          number;
  };

  facade: {
    family:            FacadeFamily;
    baseColor:         string;
    texturePresetId?:  string;
    textureRotationDeg?: number;
    textureScale?:     number;
    glazingRatioPct:   number;
    bayWidthM?:        number;
    reliefLevel:       'flat' | 'light' | 'marked';
    modulationType:
      | 'none'
      | 'horizontal_bands'
      | 'vertical_rhythm'
      | 'framed_openings'
      | 'cornice';
    openingType:
      | 'window'
      | 'french_window'
      | 'sliding'
      | 'curtain_wall';
    openingRhythm:
      | 'regular'
      | 'alternating'
      | 'vertical'
      | 'mixed';
    frameColor?:   string;
    frameDepth?:   'thin' | 'standard' | 'strong';
    railingType?:  RailingType;
    railingColor?: string;
  };

  roof: {
    type:                    RoofFamily;
    texturePresetId?:        string;
    roofColor?:              string;
    crownType:
      | 'neutral'
      | 'thin_parapet'
      | 'thick_parapet'
      | 'attic_marked'
      | 'cornice';
    technicalVolumesVisible: boolean;
    solarPanels:             boolean;
    vegetationLevel?:        'low' | 'medium' | 'high';
    roofRailing?:            'none' | 'discreet' | 'visible';
  };

  landscape: {
    siteFinish:           'raw' | 'simple' | 'landscaped' | 'premium';
    groundMaterial:       'asphalt' | 'concrete' | 'pavers' | 'gravel' | 'grass';
    hedgeEnabled:         boolean;
    hedgeHeightM?:        number;
    treeCount?:           number;
    treeType?:            'deciduous' | 'conifer' | 'palm' | 'round' | 'columnar';
    gateEnabled?:         boolean;
    fenceType:            'none' | 'grid' | 'low_wall' | 'hedge' | 'mixed';
    parkingVisible:       boolean;
    lightStreetFurniture?: 'none' | 'residential' | 'tertiary';
  };

  render: {
    intent:        BlenderRenderIntent;
    cameraView:    'pedestrian' | 'aerial_3q' | 'street_front' | 'parcel_corner';
    timeOfDay:     'morning' | 'midday' | 'afternoon' | 'sunset';
    sky:           'clear' | 'light_clouds' | 'warm_sunny' | 'neutral';
    detailLevel:   'fast' | 'standard' | 'premium';
    urbanContext:  'none' | 'neutral_masses' | 'simplified_context';
    focalLengthMm: 35 | 50 | 70;
    outputFormat:  'square' | 'landscape' | 'portrait_a4';
    usage:         'faisabilite' | 'banque' | 'comite' | 'commercial';
  };
};