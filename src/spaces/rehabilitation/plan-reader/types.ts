// src/spaces/rehabilitation/plan-reader/types.ts
// ---------------------------------------------------------------------------
// Types stricts pour le pipeline de lecture de plan Mimmoza Réhabilitation.
// Séparation stricte : image source / métadonnées / géométrie / hypothèses IA
// / validation métier. Aucun mock silencieux : tout champ inconnu est typé
// `null` + confiance "a-confirmer".
// ---------------------------------------------------------------------------

export type ConfidenceLevel = 'certain' | 'a-confirmer' | 'rejete';

export type DataSource = 'plan-text' | 'plan-geometry' | 'ai' | 'manual' | 'fallback';

// ---------------------------------------------------------------------------
// 1. Métadonnées textuelles visibles du plan
// ---------------------------------------------------------------------------

export interface MetadataField<T> {
  value: T | null;
  confidence: ConfidenceLevel;
  source: DataSource | null;
  raw?: string;
}

export interface DetectedCotation {
  /** Valeur en millimètres telle que lue sur le plan */
  valeurMm: number;
  /** Orientation en degrés (0 = horizontal, 90 = vertical) */
  orientationDeg: number;
  /** Coordonnées normalisées des deux extrémités */
  fromNormalized: Point2D;
  toNormalized: Point2D;
  raw?: string;
}

export interface PlanMetadata {
  surfaceTotale: MetadataField<number>; // m²
  echelle: MetadataField<number>;        // dénominateur : 100 pour 1/100
  niveau: MetadataField<string>;         // "RDC", "R+1", "Sous-sol", etc.
  hauteurSousPlafond: MetadataField<number>; // m
  dateDocument: MetadataField<string>;   // ISO ou tel quel
  formatPapier: MetadataField<string>;   // "A3", "A4", "A2"…
  cotationsDetectees: DetectedCotation[];
}

// ---------------------------------------------------------------------------
// 2. Calibration : conversion pixels ↔ mètres
// ---------------------------------------------------------------------------

export type CalibrationMethod =
  | 'cotation'           // depuis une cotation visible (priorité 1)
  | 'echelle'            // depuis l'échelle imprimée (priorité 2)
  | 'surface-officielle' // par calage sur la surface totale (priorité 3)
  | 'fallback'           // valeur par défaut (à confirmer)
  | null;

export interface PlanCalibration {
  pixelsPerMeter: number | null;
  method: CalibrationMethod;
  confidence: ConfidenceLevel;
  imageWidthPx: number;
  imageHeightPx: number;
  /** Surface en m² implicite, calculée depuis pixelsPerMeter et l'enveloppe */
  envelopeSurfaceM2: number | null;
  notes?: string;
}

// ---------------------------------------------------------------------------
// 3. Calques géométriques normalisés (coords 0..1 sur l'image source)
// ---------------------------------------------------------------------------

export interface Point2D {
  x: number; // 0..1 (relatif à imageWidthPx)
  y: number; // 0..1 (relatif à imageHeightPx)
}

export type WallType = 'porteur' | 'cloison-existante' | 'cloison-nouvelle';
export type OpeningType = 'porte' | 'fenetre' | 'baie' | 'porte-fenetre';
export type RoomType =
  | 'cuisine'
  | 'salle-de-bain'
  | 'wc'
  | 'chambre'
  | 'sejour'
  | 'salle-a-manger'
  | 'bureau'
  | 'circulation'
  | 'rangement'
  | 'entree'
  | 'buanderie'
  | 'inconnue';

export interface Wall {
  id: string;
  type: WallType;
  start: Point2D;          // coords normalisées
  end: Point2D;
  thicknessMeters: number; // épaisseur réelle
  locked: boolean;         // murs porteurs verrouillés par défaut
  source: DataSource;
  confidence: ConfidenceLevel;
}

export interface Opening {
  id: string;
  type: OpeningType;
  wallId: string;
  /** Position le long du mur, normalisée (0..1) */
  positionAlongWall: number;
  widthMeters: number;
  confidence: ConfidenceLevel;
  source: DataSource;
}

export interface Room {
  id: string;
  type: RoomType;
  label: string;
  polygon: Point2D[];      // coords normalisées
  surfaceM2: number | null;
  isWet: boolean;          // salle d'eau / cuisine / WC
  confidence: ConfidenceLevel;
  source: DataSource;
}

export interface PlanGeometry {
  envelopePolygon: Point2D[];
  walls: Wall[];
  openings: Opening[];
  rooms: Room[];
  normalizedBounds: { width: 1; height: 1 };
}

export const EMPTY_GEOMETRY: PlanGeometry = {
  envelopePolygon: [],
  walls: [],
  openings: [],
  rooms: [],
  normalizedBounds: { width: 1, height: 1 },
};

// ---------------------------------------------------------------------------
// 4. Validation métier
// ---------------------------------------------------------------------------

export type ValidationSeverity = 'info' | 'warning' | 'error';

export type ValidationCode =
  | 'SURFACE_IA_INCOHERENTE'      // > 10 % d'écart
  | 'SURFACE_OFFICIELLE_MANQUANTE'
  | 'PIECE_HORS_ENVELOPPE'
  | 'SALLE_EAU_DANS_CUISINE'
  | 'PORTES_MANQUANTES'
  | 'RATIO_MURS_SURFACE_ANORMAL'
  | 'CALIBRATION_FALLBACK'
  | 'PIECE_SANS_OUVERTURE'
  | 'ENVELOPPE_VIDE'
  | 'METADONNEE_MANQUANTE';

export interface ValidationIssue {
  code: ValidationCode;
  severity: ValidationSeverity;
  message: string;
  context?: Record<string, unknown>;
}

export interface ValidationResult {
  isValid: boolean;
  /** Surface retenue après arbitrage métier (officielle prioritaire) */
  surfaceRetenueM2: number | null;
  surfaceOfficielleM2: number | null;
  surfaceIAEstimeeM2: number | null;
  ecartRelatif: number | null; // valeur absolue, ex : 0.79 = 79 %
  surfaceIARejetee: boolean;
  issues: ValidationIssue[];
}

// ---------------------------------------------------------------------------
// 5. Calques affichables (toggles utilisateur)
// ---------------------------------------------------------------------------

export interface LayerVisibility {
  imageSource: boolean;
  mursDetectes: boolean;
  mursPorteurs: boolean;
  ouvertures: boolean;
  zonesHumides: boolean;
  pieces: boolean;
  cotations: boolean;
  planGenere: boolean;
}

export const DEFAULT_LAYER_VISIBILITY: LayerVisibility = {
  imageSource: true,
  mursDetectes: true,
  mursPorteurs: true,
  ouvertures: true,
  zonesHumides: true,
  pieces: true,
  cotations: false,
  planGenere: false,
};

// ---------------------------------------------------------------------------
// 6. Snapshot complet persistant
// ---------------------------------------------------------------------------

export interface PlanSourceImage {
  dataUrl: string | null;
  filename: string | null;
  mimeType: string | null;
  widthPx: number;
  heightPx: number;
}

export interface RawAIResult {
  /** Sortie brute du modèle (texte, json…) pour traçabilité */
  rawResponse: string;
  /** Surface estimée par l'IA (avant validation) */
  surfaceM2: number | null;
  geometry: PlanGeometry;
  metadata: Partial<PlanMetadata>;
  model: string;
  invokedAt: string;
}

export interface PlanOverlaySnapshot {
  version: 1;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;

  sourceImage: PlanSourceImage;
  metadata: PlanMetadata;
  calibration: PlanCalibration;

  /** Calques détectés sur le plan source (vérité terrain) */
  detectedGeometry: PlanGeometry;

  /** Hypothèses IA brutes — séparées du détecté */
  aiHypothesis: RawAIResult | null;

  /** Plan généré pour la phase Création — recalé sur l'enveloppe */
  generatedPlan: PlanGeometry | null;

  validation: ValidationResult;
  layerVisibility: LayerVisibility;
}

export const PLAN_OVERLAY_STORAGE_KEY = 'mimmoza.rehabilitation.planOverlay.v1';

// ---------------------------------------------------------------------------
// Helpers de fabrication "vide" pour éviter les nullables non typés
// ---------------------------------------------------------------------------

export const emptyMetadataField = <T>(): MetadataField<T> => ({
  value: null,
  confidence: 'a-confirmer',
  source: null,
});

export const emptyMetadata = (): PlanMetadata => ({
  surfaceTotale: emptyMetadataField<number>(),
  echelle: emptyMetadataField<number>(),
  niveau: emptyMetadataField<string>(),
  hauteurSousPlafond: emptyMetadataField<number>(),
  dateDocument: emptyMetadataField<string>(),
  formatPapier: emptyMetadataField<string>(),
  cotationsDetectees: [],
});

export const emptyCalibration = (widthPx = 0, heightPx = 0): PlanCalibration => ({
  pixelsPerMeter: null,
  method: null,
  confidence: 'a-confirmer',
  imageWidthPx: widthPx,
  imageHeightPx: heightPx,
  envelopeSurfaceM2: null,
});

export const emptyValidation = (): ValidationResult => ({
  isValid: false,
  surfaceRetenueM2: null,
  surfaceOfficielleM2: null,
  surfaceIAEstimeeM2: null,
  ecartRelatif: null,
  surfaceIARejetee: false,
  issues: [],
});

export const confidenceLabel = (c: ConfidenceLevel): string => {
  switch (c) {
    case 'certain': return 'certain';
    case 'a-confirmer': return 'à confirmer';
    case 'rejete': return 'rejeté';
  }
};