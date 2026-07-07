// src/spaces/rehabilitation/cv/planQualityGate.ts
// ---------------------------------------------------------------------------
// Module 0 — Gate de qualité d'entrée pour les CALQUES GÉOMÉTRIQUES.
//
// Décide si un plan est éligible à la segmentation CV (aplats de couleur).
// 100 % navigateur, canvas natif, AUCUNE dépendance externe. À exécuter AVANT
// de charger OpenCV / de lancer le pipeline. Si non éligible : on n'affiche
// pas de calques faux, on montre un bandeau avec la raison, et l'analyse
// réglementaire (texte) continue normalement.
//
// Ce gate NE bloque PAS l'analyse réglementaire — il ne gouverne que les calques.
// ---------------------------------------------------------------------------

// ─── Contrat de qualité (seuils calibrables) ───────────────────────────────

export interface QualityThresholds {
  /** Largeur minimale de l'image en pixels. */
  minWidthPx: number;
  /** Hauteur minimale de l'image en pixels. */
  minHeightPx: number;
  /**
   * Nombre minimum de "familles de couleur" distinctes et significatives
   * (aplats de pièces). Un export CAO couleur en a plusieurs ; un scan N&B
   * ou une photo grisâtre non.
   */
  minColorFamilies: number;
  /**
   * Fraction minimale de l'image couverte par des aplats colorés (0..1).
   * Écarte les plans quasi monochromes (N&B) et les photos.
   */
  minColoredCoverage: number;
  /**
   * Netteté minimale (variance du Laplacien, échelle ~0..2000+).
   * Écarte les photos floues.
   */
  minSharpness: number;
  /**
   * Fraction maximale de pixels "gris/neutres" (R≈G≈B). Au-delà, l'image est
   * jugée non colorée (scan N&B, photo) → inéligible.
   */
  maxNeutralRatio: number;
}

export const DEFAULT_THRESHOLDS: QualityThresholds = {
  minWidthPx:        1500,
  minHeightPx:       1000,
  minColorFamilies:  3,
  minColoredCoverage: 0.15,
  minSharpness:      120,
  maxNeutralRatio:   0.92,
};

// ─── Résultat ───────────────────────────────────────────────────────────────

export type QualityRejectCode =
  | "RESOLUTION_TROP_BASSE"
  | "PLAN_NON_COLORE"        // N&B / scan / photo grise
  | "COULEUR_INSUFFISANTE"   // trop peu d'aplats distincts
  | "IMAGE_FLOUE"            // photo floue
  | "LECTURE_IMPOSSIBLE";    // image illisible / canvas KO

export interface QualityMetrics {
  widthPx: number;
  heightPx: number;
  colorFamilies: number;
  coloredCoverage: number; // 0..1
  neutralRatio: number;    // 0..1
  sharpness: number;       // variance Laplacien
}

export interface QualityVerdict {
  /** true → éligible au pipeline calques (segmentation couleur). */
  eligible: boolean;
  code: QualityRejectCode | null;
  /** Message prêt pour le bandeau utilisateur (français, actionnable). */
  message: string;
  metrics: QualityMetrics;
}

// ─── Messages bandeau ───────────────────────────────────────────────────────

const REJECT_MESSAGES: Record<QualityRejectCode, string> = {
  RESOLUTION_TROP_BASSE:
    "Calques indisponibles : résolution trop basse. Fournissez un export CAO net d'au moins 1500 px de large.",
  PLAN_NON_COLORE:
    "Calques indisponibles : ce plan n'a pas d'aplats de couleur par pièce. Fournissez un export CAO couleur (pas un scan noir & blanc ni une photo).",
  COULEUR_INSUFFISANTE:
    "Calques indisponibles : couleurs par pièce insuffisantes pour segmenter le plan. Fournissez un export CAO couleur avec une couleur distincte par type d'espace.",
  IMAGE_FLOUE:
    "Calques indisponibles : image trop floue. Fournissez un export CAO net (pas une photo de tirage papier).",
  LECTURE_IMPOSSIBLE:
    "Calques indisponibles : l'image n'a pas pu être analysée. Vérifiez le fichier (PNG ou JPG net).",
};

const OK_MESSAGE = "Plan éligible aux calques géométriques.";

// ─── Chargement image → ImageData ──────────────────────────────────────────

async function loadImageData(
  source: string | HTMLImageElement,
  maxSampleWidth = 1400,
): Promise<{ full: { w: number; h: number }; sample: ImageData } | null> {
  const img = await toImageElement(source);
  if (!img || img.naturalWidth === 0) return null;

  const fullW = img.naturalWidth;
  const fullH = img.naturalHeight;

  // On échantillonne à une largeur raisonnable pour la vitesse (les métriques
  // statistiques sont stables au downscale ; la résolution "vraie" reste fullW/H).
  const scale = Math.min(1, maxSampleWidth / fullW);
  const w = Math.max(1, Math.round(fullW * scale));
  const h = Math.max(1, Math.round(fullH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(img, 0, 0, w, h);
  try {
    const sample = ctx.getImageData(0, 0, w, h);
    return { full: { w: fullW, h: fullH }, sample };
  } catch {
    // getImageData peut throw sur canvas "tainted" (image cross-origin) — ici
    // on travaille sur des dataURL locales, donc improbable, mais on gère.
    return null;
  }
}

function toImageElement(source: string | HTMLImageElement): Promise<HTMLImageElement | null> {
  if (source instanceof HTMLImageElement) return Promise.resolve(source);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = source;
  });
}

// ─── Métriques ──────────────────────────────────────────────────────────────

/**
 * Parcourt les pixels une seule fois pour calculer :
 *  - ratio de pixels neutres (gris, R≈G≈B)
 *  - couverture colorée (fraction de pixels non neutres et non blancs)
 *  - familles de couleur distinctes (quantification grossière teinte/lum)
 */
function computeColorMetrics(data: ImageData): {
  neutralRatio: number;
  coloredCoverage: number;
  colorFamilies: number;
} {
  const { data: px, width, height } = data;
  const total = width * height;

  let neutral = 0;
  let colored = 0;

  // Buckets de couleur : on quantifie chaque pixel coloré en un index grossier
  // (teinte 12 pas × saturation 3 × luminosité 3) et on compte les buckets
  // significatifs. Écarte le bruit fin sans fusionner des pièces distinctes.
  const buckets = new Map<number, number>();

  const NEUTRAL_TOL = 16; // écart max R/G/B pour être "gris"
  const WHITE_MIN   = 240; // quasi-blanc = fond, ignoré
  const BLACK_MAX   = 24;  // quasi-noir = traits, ignoré

  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const chroma = max - min;

    const isWhite = r >= WHITE_MIN && g >= WHITE_MIN && b >= WHITE_MIN;
    const isBlack = r <= BLACK_MAX && g <= BLACK_MAX && b <= BLACK_MAX;
    const isNeutral = chroma <= NEUTRAL_TOL;

    if (isNeutral || isWhite || isBlack) {
      if (!isWhite && !isBlack) neutral++;  // gris "utile" (hors fond/traits)
      else neutral++;                       // blanc/noir comptent comme neutres
      continue;
    }

    colored++;

    // Teinte approximative (0..11)
    let hue: number;
    if (max === r)      hue = ((g - b) / chroma) % 6;
    else if (max === g) hue = (b - r) / chroma + 2;
    else                hue = (r - g) / chroma + 4;
    hue = ((Math.round(hue * 2) % 12) + 12) % 12; // 12 secteurs

    const satBucket = chroma < 40 ? 0 : chroma < 100 ? 1 : 2;
    const lumBucket = max < 100 ? 0 : max < 190 ? 1 : 2;
    const key = hue * 9 + satBucket * 3 + lumBucket;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  const neutralRatio = total > 0 ? neutral / total : 1;
  const coloredCoverage = total > 0 ? colored / total : 0;

  // Familles significatives = buckets couvrant chacun ≥ 0.8 % de l'image.
  const minBucketPixels = total * 0.008;
  let colorFamilies = 0;
  for (const count of buckets.values()) {
    if (count >= minBucketPixels) colorFamilies++;
  }

  return { neutralRatio, coloredCoverage, colorFamilies };
}

/**
 * Netteté = variance du Laplacien sur le canal luminance (méthode standard de
 * détection de flou). Valeur haute = net ; valeur basse = flou.
 */
function computeSharpness(data: ImageData): number {
  const { data: px, width, height } = data;
  if (width < 3 || height < 3) return 0;

  // Luminance en niveaux de gris
  const gray = new Float64Array(width * height);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    gray[j] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  }

  // Laplacien 3x3 : [0 1 0; 1 -4 1; 0 1 0]
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const lap =
        gray[idx - width] + gray[idx + width] +
        gray[idx - 1] + gray[idx + 1] -
        4 * gray[idx];
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean; // variance
}

// ─── API principale ─────────────────────────────────────────────────────────

/**
 * Évalue l'éligibilité d'un plan aux calques géométriques.
 * @param source dataURL (string) ou HTMLImageElement déjà chargé.
 * @param thresholds seuils (optionnels) — surcharge partielle.
 */
export async function evaluatePlanQuality(
  source: string | HTMLImageElement,
  thresholds: Partial<QualityThresholds> = {},
): Promise<QualityVerdict> {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };

  const loaded = await loadImageData(source);
  if (!loaded) {
    return {
      eligible: false,
      code: "LECTURE_IMPOSSIBLE",
      message: REJECT_MESSAGES.LECTURE_IMPOSSIBLE,
      metrics: { widthPx: 0, heightPx: 0, colorFamilies: 0, coloredCoverage: 0, neutralRatio: 1, sharpness: 0 },
    };
  }

  const { full, sample } = loaded;
  const color = computeColorMetrics(sample);
  const sharpness = computeSharpness(sample);

  const metrics: QualityMetrics = {
    widthPx: full.w,
    heightPx: full.h,
    colorFamilies: color.colorFamilies,
    coloredCoverage: color.coloredCoverage,
    neutralRatio: color.neutralRatio,
    sharpness,
  };

  // Ordre des vérifications : du plus structurel au plus fin.
  let code: QualityRejectCode | null = null;

  if (full.w < t.minWidthPx || full.h < t.minHeightPx) {
    code = "RESOLUTION_TROP_BASSE";
  } else if (color.neutralRatio > t.maxNeutralRatio || color.coloredCoverage < t.minColoredCoverage) {
    code = "PLAN_NON_COLORE";
  } else if (color.colorFamilies < t.minColorFamilies) {
    code = "COULEUR_INSUFFISANTE";
  } else if (sharpness < t.minSharpness) {
    code = "IMAGE_FLOUE";
  }

  if (code) {
    return { eligible: false, code, message: REJECT_MESSAGES[code], metrics };
  }

  return { eligible: true, code: null, message: OK_MESSAGE, metrics };
}