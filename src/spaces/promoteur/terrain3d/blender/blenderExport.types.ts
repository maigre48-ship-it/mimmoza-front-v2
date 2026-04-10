// src/spaces/promoteur/terrain3d/blender/blenderExport.types.ts
// ═══════════════════════════════════════════════════════════════
// V3 — Aligné sur buildSceneRenderSpec.ts V3.
//
// Changements vs V2 :
//   - CameraCompositionSpec : interface dédiée, tous les champs V3 typés
//   - BuildingStyleSpec : interface dédiée (retour propre pour SceneObjectSpec)
//   - BuildingMetaSpec : interface dédiée, heroObject / renderPriority / landscape
//   - TerrainMetaSpec  : interface dédiée
//   - SceneObjectSpec  : style/meta typés par discriminant sur `type`
//   - ObjectMaterialSpec : conservé Record<string, PBRMaterialSpec> (non cassant)
//
// Rétrocompatible : aucun champ existant supprimé, tous les ajouts sont optionnels.
// ═══════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────
// TRANSFORM
// ─────────────────────────────────────────────────────────────

export interface TransformSpec {
  position: [number, number, number];
  rotationEuler: [number, number, number];
  scale: [number, number, number];
}

// ─────────────────────────────────────────────────────────────
// MATÉRIAUX
// ─────────────────────────────────────────────────────────────

export interface PBRMaterialSpec {
  baseColor: string;    // hex "#RRGGBB"
  roughness: number;    // 0–1
  metallic: number;     // 0–1
  alpha: number;        // 0–1
  transmission?: number; // 0–1, pour le verre
  ior?: number;
}

/**
 * Map nommée de matériaux PBR.
 * Clés standard pipeline V3 : facade, structure, roof, glazing,
 * balcony_rail, balcony_slab, frames, banding, entrance,
 * shading, loggias, socle, cornice, ground.
 */
export type ObjectMaterialSpec = Record<string, PBRMaterialSpec>;

// ─────────────────────────────────────────────────────────────
// CAMERA COMPOSITION — V3
// ─────────────────────────────────────────────────────────────

export interface CameraCompositionSpec {
  /** Preset de cadrage global. Ex: "hero_three_quarter", "bird_eye". */
  preset: string;
  /** Stratégie de fit. Pipeline V3 : "building_only" | "building_bbox" | "project_bounds". */
  fitStrategy: string;
  /** Direction cardinale de la façade héro. "south" | "west" | "north" | "east". */
  heroFacadeDirection?: string;
  /** objectKey du bâtiment héros ciblé par la caméra. */
  targetObjectKey?: string;
  /**
   * Ratio de serrage du cadre autour de l'objet héros.
   * 0.0 = très large / 1.0 = très serré. Recommandé : 0.85–0.92.
   */
  framingTightness?: number;
  /**
   * Profondeur d'avant-plan accordée (ratio hauteur bâtiment).
   * Permet de laisser de l'espace sol/végétation devant le bâtiment.
   * Recommandé : 0.15–0.25.
   */
  foregroundDepth?: number;
  /**
   * Traitement du contexte autour de l'objet héros.
   * "none" | "soft" | "strong" | "exclude".
   */
  contextSuppression?: "none" | "soft" | "strong" | "exclude";
  /**
   * Si vrai, les éléments proches occultant le bâtiment héros
   * sont masqués ou atténués automatiquement par le pipeline.
   */
  hideNearContextIfBlocking?: boolean;
  /**
   * Si vrai, le pipeline évite de positionner des occludeurs
   * sur le flanc gauche de la vue (ex. arbres, bâtiments contexte).
   */
  avoidLeftOccluder?: boolean;
}

// ─────────────────────────────────────────────────────────────
// STYLE BÂTIMENT — V3
// ─────────────────────────────────────────────────────────────

export interface BuildingStyleSpec {
  renderIntent?: string;
  facadeStyleId?: string;
  architecturalLanguage?: string;
  windowRhythm?: string;
  facadeDepthVariation?: number;
  /** Indication qualitative de la profondeur de façade pour le pipeline. */
  facadeDepthHint?: "light" | "medium" | "deep";
  socleHeightM?: number;
  socleFinish?: string;
  corniceEnabled?: boolean;
  corniceDepthM?: number;
  entranceEmphasis?: string;
  balconiesEnabled?: boolean;
  balconiesType?: string;
  balconiesFrequency?: number;
  balconiesDepthM?: number;
  balconyRailingType?: string;
  glazingColor?: string;
  glazingOpacity?: number;
  landscapeGroundMaterial?: string;
  landscapeSiteFinish?: string;
  // ── V3 : hints de rendu promoteur ──────────────────────────
  /** Direction cardinale de la façade principale (déduite de rotationY). */
  heroFacadeDirection?: string;
  /** Caractère volumétrique du massing. Ex: "clean_modern", "textured", "sculptural". */
  massingCharacter?: string;
  /** Traitement visuel de l'objet dans la composition. */
  contextTreatment?: "hero_sharp" | "soft_neutral" | "background_blur";
}

// ─────────────────────────────────────────────────────────────
// META BÂTIMENT — V3
// ─────────────────────────────────────────────────────────────

export interface BuildingLandscapeMetaSpec {
  groundMaterial?: string;
  siteFinish?: string;
  vegetationDensity?: number;
  treeCount?: number;
  hedgeEnabled?: boolean;
  parkingVisible?: boolean;
  // V3 : génération paysagère guidée
  treeMode?: "guided" | "random" | "none";
  generateExtendedGround?: boolean;
  generateParvis?: boolean;
  generateAccessPath?: boolean;
  generateTrees?: boolean;
  generateHedges?: boolean;
}

export interface BuildingMetaSpec {
  name?: string;
  visible?: boolean;
  levelCount?: number;
  totalHeightM?: number;
  floorToFloorM?: number;
  groundFloorHeightM?: number;
  roofType?: string;
  roofColor?: string;
  landscape?: BuildingLandscapeMetaSpec;
  // ── V3 : priorité de rendu et rôle dans la scène ──────────
  /** Vrai si ce bâtiment est l'objet héros de la composition. */
  heroObject?: boolean;
  /**
   * Priorité de rendu dans la scène.
   * 1 = objet principal, 2 = contexte.
   */
  renderPriority?: 1 | 2;
  /**
   * Si vrai, ce bâtiment est exclu de la suppression de contexte
   * (il reste visible même si contextSuppression est actif).
   */
  excludeFromContextSuppression?: boolean;
}

export interface TerrainMetaSpec {
  groundMaterial?: string;
}

// ─────────────────────────────────────────────────────────────
// OBJET DE SCÈNE
// ─────────────────────────────────────────────────────────────

/**
 * SceneObjectSpec V3 — style et meta typés proprement selon le `type`.
 * Rétrocompatible : les surcharges de type permettent de garder
 * Record<string, unknown> pour les types non couverts.
 */
export type SceneObjectSpec =
  | BuildingObjectSpec
  | TerrainObjectSpec
  | GenericObjectSpec;

interface BaseSceneObjectSpec {
  objectKey: string;
  sourceId: string;
  rootObjectName: string;
  meshNames: string[];
  meshGroups: Record<string, string[]>;
  transform?: TransformSpec;
  materials: ObjectMaterialSpec;
}

export interface BuildingObjectSpec extends BaseSceneObjectSpec {
  type: "building";
  style?: BuildingStyleSpec;
  meta?: BuildingMetaSpec;
}

export interface TerrainObjectSpec extends BaseSceneObjectSpec {
  type: "terrain";
  style?: Record<string, unknown>;
  meta?: TerrainMetaSpec;
}

export interface GenericObjectSpec extends BaseSceneObjectSpec {
  type: "vegetation" | "parking" | "light" | "camera";
  style?: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────
// ÉCLAIRAGE
// ─────────────────────────────────────────────────────────────

export interface LightingSpec {
  sun: {
    enabled: boolean;
    name: string;
    rotationEulerDeg: [number, number, number];
    energy: number;
    angle: number;
    color: string;
  };
  fillLight: {
    enabled: boolean;
  };
}

// ─────────────────────────────────────────────────────────────
// CAMÉRA
// ─────────────────────────────────────────────────────────────

export interface CameraSpec {
  mode: string;
  name: string;
  position: [number, number, number];
  target: [number, number, number];
  lensMm: number;
  clipStart: number;
  clipEnd: number;
  composition: CameraCompositionSpec;
}

// ─────────────────────────────────────────────────────────────
// RENDU
// ─────────────────────────────────────────────────────────────

export interface RenderSettingsSpec {
  engine: "CYCLES" | "EEVEE";
  samples: number;
  resolution: {
    width: number;
    height: number;
    percentage: number;
  };
  transparentBackground: boolean;
  look: string;
  output: {
    format: "PNG" | "JPEG" | "EXR";
    colorMode: "RGB" | "RGBA";
  };
}

// ─────────────────────────────────────────────────────────────
// SPEC DE SCÈNE COMPLÈTE
// ─────────────────────────────────────────────────────────────

export interface SceneRenderSpec {
  format: string;
  version: string;
  generator: {
    app: string;
    module: string;
    exportedAt: string;
  };
  scene: {
    unitSystem: string;
    upAxis: string;
    forwardAxis: string;
    renderIntent: string | undefined;
    projectName: string | undefined;
    terrain: {
      meshName: string;
      enabled: boolean;
    };
  };
  objects: SceneObjectSpec[];
  camera: CameraSpec;
  lighting: LightingSpec;
  environment: {
    world: {
      mode: string;
      skyColor: string;
      horizonColor: string;
      strength: number;
    };
    groundShadowCatcher: {
      enabled: boolean;
    };
  };
  render: RenderSettingsSpec;
}