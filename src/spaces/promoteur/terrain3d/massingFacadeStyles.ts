// massingFacadeStyles.ts — V2.2 bayPattern
// ═══════════════════════════════════════════════════════════════════════════════
// V2.2 :
//   - ajout bayPattern : système de composition par travée
//   - residential_modern enrichi avec vrai langage architectural
//   - tous les autres styles inchangés et compatibles
// ═══════════════════════════════════════════════════════════════════════════════

import type {
  FacadeOpeningType,
  BalconyType,
  BalconyConfig,
  LoggiaConfig,
  ShadingConfig,
  ShadingDeviceType,
} from "./massingFacadeEngine";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type FacadeStyleId =
  | "residential_modern"
  | "residential_brique"
  | "residential_pierre"
  | "modern_glass"
  | "urban_mixed"
  | "minimal_white";

export type EdgeType = "street" | "courtyard" | "side";

/**
 * Rôle d'une travée dans le motif de façade.
 *   - "plain"   : fenêtre standard, pas de balcon ni loggia
 *   - "balcony" : balcon individuel
 *   - "loggia"  : loggia profonde
 *   - "accent"  : panneau vertical décoratif + fenêtre réduite
 */
export type BayRole = "plain" | "balcony" | "loggia" | "accent";

export interface FacadeStyleDefinition {
  id: FacadeStyleId;
  label: string;

  base: {
    windowRatio: number;
    bayWidth: number;
    facadeColor: string;
    frameColor: string;
    frameThickness: number;
  };

  ground: {
    openingType: FacadeOpeningType;
    heightMultiplier: number;
    baseColor: string | null;
    hasSocle: boolean;
  };

  upper: {
    openingType: FacadeOpeningType;
    hasBalconies: boolean;
    balconyType: BalconyType;
    balconyDepth: number;
    sillHeight: number;
    lintelHeight: number;
  };

  attic: {
    openingType: FacadeOpeningType;
    retreat: number;
    atticColor: string | null;
    hasCornice: boolean;
  };

  features: {
    banding: boolean;
    bandingHeight: number;
    loggias: boolean;
    shading: boolean;
    shadingType: ShadingDeviceType;
    verticalRhythm: boolean;
  };

  /**
   * Pattern de composition des travées (façade rue).
   * Le motif est cyclique : si la façade a 8 bays et le pattern a 5 éléments,
   * le bay 5 reprend le rôle du bay 0, etc.
   * Si absent ou vide → comportement uniforme classique.
   */
  bayPattern?: BayRole[];

  /**
   * Pattern simplifié pour façade cour (optionnel).
   * Si absent → tout "plain".
   */
  bayPatternCourtyard?: BayRole[];

  /**
   * Couleur des panneaux accent verticaux (hex).
   * Utilisée quand un bay a le rôle "accent".
   */
  accentColor?: string;

  /**
   * Profondeur de loggia spécifique au style (m).
   * Écrase le default de LoggiaConfig si présent.
   */
  loggiaDepthM?: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// LES 6 STYLES
// ═══════════════════════════════════════════════════════════════════════════════

const RESIDENTIAL_MODERN: FacadeStyleDefinition = {
  id: "residential_modern",
  label: "Résidentiel moderne",
  base: {
    windowRatio: 0.48,
    bayWidth: 2.8,
    facadeColor: "#E5DDD0",     // enduit clair chaud
    frameColor: "#3A3A3A",      // menuiseries anthracite
    frameThickness: 0.055,
  },
  ground: {
    openingType: "retail_opening",   // halls / baies généreuses au RDC
    heightMultiplier: 1.30,          // RDC plus haut → socle massif
    baseColor: "#C2BAA8",           // socle minéral gris-beige
    hasSocle: true,
  },
  upper: {
    openingType: "french_window",
    hasBalconies: true,
    balconyType: "individual",
    balconyDepth: 1.6,              // balcons généreux
    sillHeight: 0.0,
    lintelHeight: 0.22,
  },
  attic: {
    openingType: "sliding_bay",     // grandes baies vitrées attique
    retreat: 1.4,                   // retrait visible
    atticColor: "#50504A",          // attique zinc/bardage sombre
    hasCornice: false,               // pas de corniche → langage moderne
  },
  features: {
    banding: true,
    bandingHeight: 0.12,
    loggias: true,                  // loggias activées
    shading: true,
    shadingType: "brise_soleil",    // casquettes brise-soleil
    verticalRhythm: false,          // pas de pilastres classiques
  },

  // ── Composition par travée (façade rue) ────────────────────────────────
  // Motif : loggia – plain – balcon – accent – balcon – plain
  // Cela crée un rythme asymétrique contrôlé sur 6 bays
  bayPattern: ["loggia", "plain", "balcony", "accent", "balcony", "plain"],

  // Façade cour : plus sobre
  bayPatternCourtyard: ["plain", "plain", "balcony", "plain"],

  // Panneaux verticaux accent : bois chaud / métal bronze
  accentColor: "#8B6B45",

  // Loggias plus profondes que le défaut
  loggiaDepthM: 1.2,
};

const RESIDENTIAL_BRIQUE: FacadeStyleDefinition = {
  id: "residential_brique",
  label: "Résidentiel brique",
  base: {
    windowRatio: 0.30,
    bayWidth: 2.5,
    facadeColor: "#A0522D",
    frameColor: "#F5F0E8",
    frameThickness: 0.08,
  },
  ground: {
    openingType: "french_window",
    heightMultiplier: 1.15,
    baseColor: "#8B4513",
    hasSocle: true,
  },
  upper: {
    openingType: "window",
    hasBalconies: true,
    balconyType: "individual",
    balconyDepth: 0.9,
    sillHeight: 0.90,
    lintelHeight: 0.30,
  },
  attic: {
    openingType: "window",
    retreat: 0.0,
    atticColor: null,
    hasCornice: true,
  },
  features: {
    banding: false,
    bandingHeight: 0.0,
    loggias: false,
    shading: false,
    shadingType: "none",
    verticalRhythm: true,
  },
};

const RESIDENTIAL_PIERRE: FacadeStyleDefinition = {
  id: "residential_pierre",
  label: "Résidentiel pierre de taille",
  base: {
    windowRatio: 0.35,
    bayWidth: 2.8,
    facadeColor: "#F2EADC",
    frameColor: "#5C5040",
    frameThickness: 0.10,
  },
  ground: {
    openingType: "french_window",
    heightMultiplier: 1.35,
    baseColor: "#D6CBBA",
    hasSocle: true,
  },
  upper: {
    openingType: "french_window",
    hasBalconies: true,
    balconyType: "individual",
    balconyDepth: 0.6,
    sillHeight: 0.0,
    lintelHeight: 0.35,
  },
  attic: {
    openingType: "window",
    retreat: 0.0,
    atticColor: "#B8B0A0",
    hasCornice: true,
  },
  features: {
    banding: true,
    bandingHeight: 0.20,
    loggias: false,
    shading: false,
    shadingType: "none",
    verticalRhythm: true,
  },
};

const MODERN_GLASS: FacadeStyleDefinition = {
  id: "modern_glass",
  label: "Tertiaire vitré",
  base: {
    windowRatio: 0.75,
    bayWidth: 1.5,
    facadeColor: "#505860",
    frameColor: "#2A2A2A",
    frameThickness: 0.04,
  },
  ground: {
    openingType: "retail_opening",
    heightMultiplier: 1.40,
    baseColor: "#3A3E44",
    hasSocle: false,
  },
  upper: {
    openingType: "sliding_bay",
    hasBalconies: false,
    balconyType: "none",
    balconyDepth: 0,
    sillHeight: 0.08,
    lintelHeight: 0.15,
  },
  attic: {
    openingType: "sliding_bay",
    retreat: 0.8,
    atticColor: "#383C42",
    hasCornice: false,
  },
  features: {
    banding: true,
    bandingHeight: 0.08,
    loggias: false,
    shading: true,
    shadingType: "brise_soleil",
    verticalRhythm: false,
  },
};

const URBAN_MIXED: FacadeStyleDefinition = {
  id: "urban_mixed",
  label: "Urbain mixte (commerce + logement)",
  base: {
    windowRatio: 0.42,
    bayWidth: 3.2,
    facadeColor: "#DDD5C8",
    frameColor: "#404040",
    frameThickness: 0.07,
  },
  ground: {
    openingType: "retail_opening",
    heightMultiplier: 1.45,
    baseColor: "#2E3338",
    hasSocle: true,
  },
  upper: {
    openingType: "french_window",
    hasBalconies: true,
    balconyType: "individual",
    balconyDepth: 1.1,
    sillHeight: 0.0,
    lintelHeight: 0.28,
  },
  attic: {
    openingType: "sliding_bay",
    retreat: 1.0,
    atticColor: "#5A5550",
    hasCornice: true,
  },
  features: {
    banding: true,
    bandingHeight: 0.18,
    loggias: true,
    shading: false,
    shadingType: "none",
    verticalRhythm: false,
  },
};

const MINIMAL_WHITE: FacadeStyleDefinition = {
  id: "minimal_white",
  label: "Minimal blanc",
  base: {
    windowRatio: 0.55,
    bayWidth: 3.6,
    facadeColor: "#F5F2EE",
    frameColor: "#2A2A2A",
    frameThickness: 0.035,
  },
  ground: {
    openingType: "sliding_bay",
    heightMultiplier: 1.20,
    baseColor: null,
    hasSocle: false,
  },
  upper: {
    openingType: "sliding_bay",
    hasBalconies: true,
    balconyType: "continuous",
    balconyDepth: 1.8,
    sillHeight: 0.0,
    lintelHeight: 0.12,
  },
  attic: {
    openingType: "sliding_bay",
    retreat: 0.6,
    atticColor: "#ECEAE6",
    hasCornice: false,
  },
  features: {
    banding: false,
    bandingHeight: 0.0,
    loggias: false,
    shading: false,
    shadingType: "none",
    verticalRhythm: false,
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// REGISTRE
// ═══════════════════════════════════════════════════════════════════════════════

export const FACADE_STYLES: Record<FacadeStyleId, FacadeStyleDefinition> = {
  residential_modern: RESIDENTIAL_MODERN,
  residential_brique: RESIDENTIAL_BRIQUE,
  residential_pierre: RESIDENTIAL_PIERRE,
  modern_glass: MODERN_GLASS,
  urban_mixed: URBAN_MIXED,
  minimal_white: MINIMAL_WHITE,
};

export const FACADE_STYLE_OPTIONS: Array<{ value: FacadeStyleId; label: string }> =
  Object.values(FACADE_STYLES).map((s) => ({ value: s.id, label: s.label }));

export function getFacadeStyle(id?: string | null): FacadeStyleDefinition {
  if (id && id in FACADE_STYLES) return FACADE_STYLES[id as FacadeStyleId];
  return FACADE_STYLES.residential_modern;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLASSIFY EDGE
// ═══════════════════════════════════════════════════════════════════════════════

export function classifyEdge(
  a: { x: number; z: number },
  b: { x: number; z: number },
  center: { x: number; z: number },
  allEdges: Array<{ a: { x: number; z: number }; b: { x: number; z: number } }>,
): EdgeType {
  if (allEdges.length <= 2) return "street";

  const projections = allEdges.map((edge) => {
    const mx = (edge.a.x + edge.b.x) / 2;
    const mz = (edge.a.z + edge.b.z) / 2;
    const dx = edge.b.x - edge.a.x;
    const dz = edge.b.z - edge.a.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.001) return 0;
    const nx = -dz / len;
    const nz = dx / len;
    return (mx - center.x) * nx + (mz - center.z) * nz;
  });

  const maxProj = Math.max(...projections);
  const minProj = Math.min(...projections);
  const range = maxProj - minProj;

  const mx = (a.x + b.x) / 2;
  const mz = (a.z + b.z) / 2;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.001) return "side";

  const nx = -dz / len;
  const nz = dx / len;
  const proj = (mx - center.x) * nx + (mz - center.z) * nz;

  if (range < 0.01) return "street";

  const normalized = (proj - minProj) / range;

  if (normalized > 0.7) return "street";
  if (normalized < 0.3) return "courtyard";
  return "side";
}

// ═══════════════════════════════════════════════════════════════════════════════
// RÉSOLUTION STYLE → OVERRIDES COMPLETS
// ═══════════════════════════════════════════════════════════════════════════════

export interface ResolvedStyleOverrides {
  windowRatio: number;
  bayWidth: number;
  hasBanding: boolean;
  bandingHeight: number;
  hasBalconies: boolean;
  balconyFreq: number;
  balconyConfig?: BalconyConfig;
  loggiaConfig?: LoggiaConfig;
  shadingConfig?: ShadingConfig;
  frameThicknessScale: number;
  groundOpeningType: FacadeOpeningType;
  upperOpeningType: FacadeOpeningType;
  atticOpeningType: FacadeOpeningType;
  forceOpeningType?: FacadeOpeningType;
  hasSocle: boolean;
  hasCornice: boolean;
  verticalRhythm: boolean;
  facadeColor: string;
  frameColor: string;
  groundBaseColor: string;
  atticColor: string;
  groundHeightMultiplier: number;
  atticRetreat: number;
  // V2.2 — bay pattern
  bayPattern?: BayRole[];
  accentColor?: string;
  loggiaDepthM?: number;
}

const DEFAULT_FRAME_THICKNESS = 0.06;

export function resolveStyleForEdge(
  style: FacadeStyleDefinition,
  edgeType: EdgeType,
  totalFloors: number,
  scaleMultiplier = 1,
): ResolvedStyleOverrides {
  let windowRatio = style.base.windowRatio;
  let hasBalconies = style.upper.hasBalconies;
  let balconyType: BalconyType = style.upper.balconyType;
  let hasBanding = style.features.banding;
  let hasLoggias = style.features.loggias;
  let hasShading = style.features.shading;
  let hasSocle = style.ground.hasSocle;
  let hasCornice = style.attic.hasCornice;
  let verticalRhythm = style.features.verticalRhythm;

  // Sélection du pattern selon le type d'edge
  let bayPattern: BayRole[] | undefined;

  switch (edgeType) {
    case "street":
      windowRatio += 0.10;
      bayPattern = style.bayPattern;
      break;

    case "courtyard":
      windowRatio -= 0.10;
      hasBalconies = false;
      balconyType = "none";
      hasLoggias = false;
      hasCornice = false;
      bayPattern = style.bayPatternCourtyard;
      break;

    case "side":
      windowRatio -= 0.15;
      windowRatio *= 0.85;
      hasBalconies = false;
      balconyType = "none";
      hasBanding = false;
      hasLoggias = false;
      hasShading = false;
      hasSocle = false;
      hasCornice = false;
      verticalRhythm = false;
      bayPattern = undefined; // pignons = tout plain
      break;
  }

  windowRatio = Math.max(0.15, Math.min(0.92, windowRatio));

  const frameThicknessScale = style.base.frameThickness / DEFAULT_FRAME_THICKNESS;

  const balconyConfig: BalconyConfig = {
    enabled: hasBalconies,
    type: balconyType,
    depthM: style.upper.balconyDepth * scaleMultiplier,
    thicknessM: 0.12 * scaleMultiplier,
    guardrailHeightM: 1.02 * scaleMultiplier,
    frequency: 1,
  };

  const loggiaConfig: LoggiaConfig = {
    enabled: hasLoggias && edgeType !== "side",
    depthM: (style.loggiaDepthM ?? 0.9) * scaleMultiplier,
    frequency: 2,
  };

  const shadingConfig: ShadingConfig = {
    enabled: hasShading && edgeType !== "side",
    type: style.features.shadingType,
    openRatio: 0.35,
    frequency: 1,
  };

  let forceOpeningType: FacadeOpeningType | undefined;
  if (edgeType === "side") {
    forceOpeningType = "window";
  }

  const groundBaseColor = style.ground.baseColor ?? style.base.facadeColor;
  const atticColor = style.attic.atticColor ?? style.base.facadeColor;

  return {
    windowRatio,
    bayWidth: style.base.bayWidth,
    hasBanding,
    bandingHeight: style.features.bandingHeight,
    hasBalconies,
    balconyFreq: 1,
    balconyConfig,
    loggiaConfig,
    shadingConfig,
    frameThicknessScale,
    groundOpeningType: style.ground.openingType,
    upperOpeningType: style.upper.openingType,
    atticOpeningType: style.attic.openingType,
    forceOpeningType,
    hasSocle,
    hasCornice,
    verticalRhythm,
    facadeColor: style.base.facadeColor,
    frameColor: style.base.frameColor,
    groundBaseColor,
    atticColor,
    groundHeightMultiplier: style.ground.heightMultiplier,
    atticRetreat: style.attic.retreat,
    // V2.2
    bayPattern,
    accentColor: style.accentColor,
    loggiaDepthM: style.loggiaDepthM,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER : CENTROÏDE
// ═══════════════════════════════════════════════════════════════════════════════

export function computeCentroid(pts: Array<{ x: number; z: number }>): { x: number; z: number } {
  if (pts.length === 0) return { x: 0, z: 0 };
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
  return { x: cx, z: cz };
}