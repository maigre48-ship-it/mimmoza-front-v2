/**
 * computeFacadeBays.ts
 *
 * Helper pur pour calculer la trame d'ouvertures d'une façade
 * à partir de sa largeur réelle et du rythme choisi.
 *
 * Utilisé par :
 *   - buildFacade2DModel.ts (preview SVG)
 *   - FacadeGeneratorPage.tsx / addWindowsToScene() (GLTF)
 *
 * Convention :
 *   - les positions X retournées sont en mètres depuis le bord gauche de la façade
 *   - le centre de la façade est à widthM / 2
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type BayRhythm = "regular" | "symmetric" | "syncopated" | "dynamic";

export type LevelKind = "base" | "typical" | "attic";

export interface BayLayout {
  /** Nombre de travées */
  count: number;
  /** Largeur de chaque travée (m) — peut varier si rythme non régulier */
  bayWidths: number[];
  /** Position X du centre de chaque ouverture (m, depuis bord gauche) */
  centerXs: number[];
  /** Largeur de la marge latérale (m) */
  marginM: number;
  /** Largeur utile entre marges (m) */
  usableWidthM: number;
}

export interface OpeningSpec {
  /** Largeur de l'ouverture (m) */
  widthM: number;
  /** Hauteur de l'ouverture (m) */
  heightM: number;
}

// ─── Constantes architecturales ─────────────────────────────────────────────

/** Module de travée cible (m) — le calcul arrondit autour de cette valeur */
const TARGET_BAY_MODULE = 3.7;
/** Bornes du module de travée acceptable */
const MIN_BAY_MODULE = 2.8;
const MAX_BAY_MODULE = 4.8;
/** Bornes absolues du nombre de travées */
const MIN_BAYS = 2;
const MAX_BAYS = 12;
/** Marge latérale minimum (m) */
const MIN_MARGIN = 0.6;

// ─── Ratios ouverture / travée par type de niveau ───────────────────────────

const OPENING_RATIOS: Record<LevelKind, { widthRatio: number; heightM: number }> = {
  /** RDC : ouvertures larges et hautes */
  base: { widthRatio: 0.62, heightM: 2.8 },
  /** Étages courants : ouvertures standard */
  typical: { widthRatio: 0.48, heightM: 1.8 },
  /** Attique : ouvertures contenues */
  attic: { widthRatio: 0.40, heightM: 1.3 },
};

// ─── API publique ───────────────────────────────────────────────────────────

/**
 * Calcule le nombre de travées optimal pour une largeur de façade donnée.
 */
export function computeBayCount(widthM: number, rhythm: BayRhythm = "regular"): number {
  if (!Number.isFinite(widthM) || widthM <= 0) return MIN_BAYS;

  let raw = widthM / TARGET_BAY_MODULE;

  // Ajustements légers selon l'intention de composition
  if (rhythm === "syncopated") raw += 0.4;
  if (rhythm === "dynamic") raw -= 0.3;

  let count = Math.round(raw);
  count = clamp(count, MIN_BAYS, MAX_BAYS);

  // En symétrique, on préfère un nombre impair pour marquer un axe central
  if (rhythm === "symmetric" && count % 2 === 0) {
    const up = count + 1;
    const down = count - 1;
    count = down >= MIN_BAYS ? down : up;
    count = clamp(count, MIN_BAYS, MAX_BAYS);
  }

  // Vérification du module final
  let mod = widthM / count;

  if (mod < MIN_BAY_MODULE && count > MIN_BAYS) {
    count -= 1;
    mod = widthM / count;
  }

  if (mod > MAX_BAY_MODULE && count < MAX_BAYS) {
    count += 1;
  }

  return clamp(count, MIN_BAYS, MAX_BAYS);
}

/**
 * Calcule la disposition complète des travées sur la façade.
 */
export function computeBayLayout(
  widthM: number,
  count: number,
  rhythm: BayRhythm = "regular",
): BayLayout {
  const safeWidth = Math.max(1, widthM);
  const safeCount = clamp(Math.round(count || MIN_BAYS), MIN_BAYS, MAX_BAYS);

  const rawModule = safeWidth / safeCount;
  const marginM = Math.max(MIN_MARGIN, rawModule * 0.4);
  const usableWidthM = Math.max(0.5, safeWidth - marginM * 2);

  const bayWidths = computeBayWidthsNormalized(usableWidthM, safeCount, rhythm);
  const centerXs = computeCenterPositions(bayWidths, marginM);

  return {
    count: safeCount,
    bayWidths,
    centerXs,
    marginM: roundTo(marginM, 3),
    usableWidthM: roundTo(usableWidthM, 3),
  };
}

/**
 * Retourne les dimensions d'ouverture pour un type de niveau et une largeur de travée donnée.
 */
export function computeOpeningSpec(
  bayWidthM: number,
  levelKind: LevelKind,
): OpeningSpec {
  const ratios = OPENING_RATIOS[levelKind];
  return {
    widthM: roundTo(bayWidthM * ratios.widthRatio, 2),
    heightM: ratios.heightM,
  };
}

/**
 * Variante pratique : calcule une spec par travée.
 * Utile si les largeurs de travées varient réellement.
 */
export function computeOpeningSpecsForLayout(
  layout: BayLayout,
  levelKind: LevelKind,
): OpeningSpec[] {
  return layout.bayWidths.map((w) => computeOpeningSpec(w, levelKind));
}

/**
 * Raccourci : calcule tout d'un coup pour un niveau donné.
 */
export function computeLevelOpenings(
  widthM: number,
  rhythm: BayRhythm,
  levelKind: LevelKind,
): {
  layout: BayLayout;
  openingSpec: OpeningSpec;
  openingSpecs: OpeningSpec[];
} {
  const count = computeBayCount(widthM, rhythm);
  const layout = computeBayLayout(widthM, count, rhythm);

  const avgBay =
    layout.bayWidths.reduce((a, b) => a + b, 0) / layout.bayWidths.length;

  return {
    layout,
    openingSpec: computeOpeningSpec(avgBay, levelKind),
    openingSpecs: computeOpeningSpecsForLayout(layout, levelKind),
  };
}

/**
 * Convertit un X mesuré depuis le bord gauche en X centré sur 0.
 * Pratique pour Three.js.
 */
export function toCenteredX(centerXFromLeftM: number, facadeWidthM: number): number {
  return roundTo(centerXFromLeftM - facadeWidthM / 2, 3);
}

// ─── Internals ──────────────────────────────────────────────────────────────

function computeBayWidthsNormalized(
  usableW: number,
  count: number,
  rhythm: BayRhythm,
): number[] {
  const baseW = usableW / count;
  let widths: number[];

  switch (rhythm) {
    case "symmetric": {
      if (count < 3) {
        widths = Array(count).fill(baseW);
        break;
      }

      const mid = Math.floor(count / 2);
      const boost = baseW * 0.12;
      const shrink = boost / (count - 1);

      widths = Array.from({ length: count }, (_, i) =>
        i === mid ? baseW + boost : baseW - shrink,
      );
      break;
    }

    case "syncopated": {
      const delta = baseW * 0.08;
      widths = Array.from({ length: count }, (_, i) =>
        i % 2 === 0 ? baseW + delta : baseW - delta,
      );
      break;
    }

    case "dynamic": {
      const amplitude = baseW * 0.06;
      const step = count > 1 ? (2 * amplitude) / (count - 1) : 0;

      widths = Array.from({ length: count }, (_, i) =>
        baseW - amplitude + step * i,
      );
      break;
    }

    case "regular":
    default:
      widths = Array(count).fill(baseW);
      break;
  }

  return normalizeWidths(widths, usableW);
}

function normalizeWidths(widths: number[], targetSum: number): number[] {
  const sum = widths.reduce((a, b) => a + b, 0);

  if (!Number.isFinite(sum) || sum <= 0) {
    const fallback = targetSum / Math.max(1, widths.length);
    return widths.map(() => roundTo(fallback, 3));
  }

  const scale = targetSum / sum;
  const scaled = widths.map((w) => w * scale);

  // Arrondi contrôlé + correction finale sur la dernière travée
  const rounded = scaled.map((w) => roundTo(w, 3));
  const roundedSum = rounded.reduce((a, b) => a + b, 0);
  const diff = roundTo(targetSum - roundedSum, 3);

  if (rounded.length > 0) {
    rounded[rounded.length - 1] = roundTo(rounded[rounded.length - 1] + diff, 3);
  }

  return rounded;
}

function computeCenterPositions(bayWidths: number[], marginM: number): number[] {
  const positions: number[] = [];
  let cursor = marginM;

  for (const w of bayWidths) {
    positions.push(roundTo(cursor + w / 2, 3));
    cursor += w;
  }

  return positions;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function roundTo(v: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(v * f) / f;
}