// ─────────────────────────────────────────────────────────────────────────────
// planScaleCalibrator.ts
// Calibration manuelle de l'échelle d'un plan architectural
// L'utilisateur clique 2 points → saisit la distance réelle → on calcule
// pixelsPerMeter et metersPerPixel pour tous les calculs de surface/longueur.
//
// RÈGLE ABSOLUE : aucune surface métier ne doit venir de l'IA.
// Les surfaces calculées ici ont la mention 'user_calibrated'.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import type { NormalizedPoint } from './planTranscription.types';
import { userStorage } from "@/lib/storage/userScopedStorage";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type CalibrationStatus =
  | 'idle'              // aucune calibration en cours
  | 'picking_point1'    // attente du 1er clic
  | 'picking_point2'    // attente du 2e clic
  | 'awaiting_distance' // les 2 points sont posés, attente de la saisie
  | 'calibrated';       // calibration terminée et valide

/** Résultat persisté d'une calibration validée. */
export interface ScaleCalibration {
  readonly plan_id: string;
  readonly point1: NormalizedPoint;
  readonly point2: NormalizedPoint;
  readonly realDistance_m: number;
  /** Pixels naturels de l'image par mètre réel */
  readonly pixelsPerMeter: number;
  /** Mètres par pixel naturel de l'image */
  readonly metersPerPixel: number;
  /** Dimensions naturelles de l'image au moment de la calibration */
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly calibratedAt: string; // ISO 8601
}

/** État transactionnel du calibrateur (inclut le transit et le résultat). */
export interface ScaleCalibratorState {
  readonly activePlanId: string | null;
  readonly status: CalibrationStatus;
  readonly pendingPoint1: NormalizedPoint | null;
  readonly pendingPoint2: NormalizedPoint | null;
  /** Saisie brute de la distance (string pour contrôle de champ libre) */
  readonly distanceInput: string;
  readonly calibration: ScaleCalibration | null;
  readonly error: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PERSISTANCE localStorage
// ═══════════════════════════════════════════════════════════════════════════════

const STORAGE_PREFIX = 'mimmoza_scale_cal_v1_' as const;

function storageKey(planId: string): string {
  return `${STORAGE_PREFIX}${planId}`;
}

function loadCalibration(planId: string): ScaleCalibration | null {
  try {
    const raw = userStorage.getItem(storageKey(planId));
    if (!raw) return null;
    return JSON.parse(raw) as ScaleCalibration;
  } catch {
    return null;
  }
}

function persistCalibration(cal: ScaleCalibration): void {
  try {
    userStorage.setItem(storageKey(cal.plan_id), JSON.stringify(cal));
  } catch {
    console.warn('[planScaleCalibrator] localStorage indisponible.');
  }
}

function removeCalibration(planId: string): void {
  try {
    userStorage.removeItem(storageKey(planId));
  } catch { /* silent */ }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ÉTAT INITIAL
// ═══════════════════════════════════════════════════════════════════════════════

function makeInitialState(planId: string | null = null): ScaleCalibratorState {
  return {
    activePlanId: planId,
    status: 'idle',
    pendingPoint1: null,
    pendingPoint2: null,
    distanceInput: '',
    calibration: planId ? loadCalibration(planId) : null,
    error: null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// EVENT BUS
// ═══════════════════════════════════════════════════════════════════════════════

type CalibrationListener = (state: ScaleCalibratorState) => void;
const listeners = new Set<CalibrationListener>();

let calibratorState: ScaleCalibratorState = makeInitialState();

function mutate(updater: (s: ScaleCalibratorState) => ScaleCalibratorState): void {
  calibratorState = updater(calibratorState);
  listeners.forEach((fn) => fn(calibratorState));
}

export function subscribeToCalibrator(listener: CalibrationListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCalibratorState(): Readonly<ScaleCalibratorState> {
  return calibratorState;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACTIONS PUBLIQUES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Initialise le calibrateur pour un plan donné.
 * Charge la calibration persistée si elle existe.
 */
export function initCalibrator(planId: string): void {
  mutate(() => makeInitialState(planId));
}

/** Lance la séquence de calibration (picking_point1). */
export function startCalibration(): void {
  mutate((s) => ({
    ...s,
    status: 'picking_point1',
    pendingPoint1: null,
    pendingPoint2: null,
    distanceInput: '',
    error: null,
  }));
}

/** Enregistre le premier point cliqué (normalized [0,1]). */
export function pickPoint1(point: NormalizedPoint): void {
  mutate((s) => ({
    ...s,
    status: 'picking_point2',
    pendingPoint1: point,
    pendingPoint2: null,
    error: null,
  }));
}

/** Enregistre le deuxième point cliqué (normalized [0,1]). */
export function pickPoint2(point: NormalizedPoint): void {
  mutate((s) => ({
    ...s,
    status: 'awaiting_distance',
    pendingPoint2: point,
    error: null,
  }));
}

/** Met à jour la saisie brute de distance. */
export function setDistanceInput(value: string): void {
  mutate((s) => ({ ...s, distanceInput: value, error: null }));
}

/**
 * Valide la calibration en calculant pixelsPerMeter.
 * Nécessite les dimensions naturelles de l'image source.
 */
export function confirmCalibration(
  naturalWidth: number,
  naturalHeight: number
): boolean {
  const { pendingPoint1, pendingPoint2, distanceInput, activePlanId } = calibratorState;

  if (!pendingPoint1 || !pendingPoint2) {
    mutate((s) => ({ ...s, error: 'Deux points requis avant de valider.' }));
    return false;
  }

  const distance_m = parseFloat(distanceInput.replace(',', '.'));
  if (isNaN(distance_m) || distance_m <= 0) {
    mutate((s) => ({ ...s, error: 'Saisissez une distance positive en mètres.' }));
    return false;
  }

  const d_px = rawPixelDistance(pendingPoint1, pendingPoint2, naturalWidth, naturalHeight);
  if (d_px < 10) {
    mutate((s) => ({ ...s, error: 'Points trop proches — cliquez plus loin l\'un de l\'autre.' }));
    return false;
  }

  const pixelsPerMeter = d_px / distance_m;
  const calibration: ScaleCalibration = {
    plan_id: activePlanId ?? 'default',
    point1: pendingPoint1,
    point2: pendingPoint2,
    realDistance_m: distance_m,
    pixelsPerMeter,
    metersPerPixel: 1 / pixelsPerMeter,
    naturalWidth,
    naturalHeight,
    calibratedAt: new Date().toISOString(),
  };

  persistCalibration(calibration);

  mutate((s) => ({
    ...s,
    status: 'calibrated',
    calibration,
    pendingPoint1: null,
    pendingPoint2: null,
    distanceInput: '',
    error: null,
  }));

  return true;
}

/** Annule la calibration en cours (revient à idle, garde la calibration précédente). */
export function cancelCalibration(): void {
  mutate((s) => ({
    ...s,
    status: s.calibration ? 'calibrated' : 'idle',
    pendingPoint1: null,
    pendingPoint2: null,
    distanceInput: '',
    error: null,
  }));
}

/** Supprime la calibration validée et remet en idle. */
export function clearCalibration(): void {
  const planId = calibratorState.activePlanId;
  if (planId) removeCalibration(planId);
  mutate((s) => ({
    ...s,
    status: 'idle',
    calibration: null,
    pendingPoint1: null,
    pendingPoint2: null,
    distanceInput: '',
    error: null,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// CALCULS GÉOMÉTRIQUES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Distance en pixels naturels entre deux points normalisés.
 * Tient compte du rapport d'aspect de l'image.
 */
export function rawPixelDistance(
  p1: NormalizedPoint,
  p2: NormalizedPoint,
  naturalWidth: number,
  naturalHeight: number
): number {
  const dx = (p2.x - p1.x) * naturalWidth;
  const dy = (p2.y - p1.y) * naturalHeight;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Surface en m² d'un rectangle défini par ses coins normalisés.
 * Retourne null si aucune calibration n'est disponible.
 */
export function computeSurface_m2(
  topLeft: NormalizedPoint,
  bottomRight: NormalizedPoint,
  calibration: ScaleCalibration | null
): number | null {
  if (!calibration) return null;
  const widthPx  = (bottomRight.x - topLeft.x) * calibration.naturalWidth;
  const heightPx = (bottomRight.y - topLeft.y) * calibration.naturalHeight;
  const widthM   = widthPx  * calibration.metersPerPixel;
  const heightM  = heightPx * calibration.metersPerPixel;
  const raw      = widthM * heightM;
  return Math.round(raw * 100) / 100; // 2 décimales
}

/**
 * Longueur en mètres d'un segment défini par deux points normalisés.
 * Retourne null si aucune calibration.
 */
export function computeLength_m(
  p1: NormalizedPoint,
  p2: NormalizedPoint,
  calibration: ScaleCalibration | null
): number | null {
  if (!calibration) return null;
  const d_px = rawPixelDistance(p1, p2, calibration.naturalWidth, calibration.naturalHeight);
  return Math.round(d_px * calibration.metersPerPixel * 100) / 100;
}

/**
 * Formate une surface pour l'affichage.
 * Si pas de calibration : retourne le message d'avertissement standard.
 */
export function formatSurface(
  topLeft: NormalizedPoint,
  bottomRight: NormalizedPoint,
  calibration: ScaleCalibration | null,
  options: { showSource?: boolean } = {}
): string {
  const m2 = computeSurface_m2(topLeft, bottomRight, calibration);
  if (m2 === null) return 'Surface non calculable — calibration requise';
  return options.showSource
    ? `${m2} m² (calibration utilisateur)`
    : `${m2} m²`;
}

/** Label résumant l'échelle calibrée, e.g. "1 m ≈ 42 px". */
export function formatCalibrationLabel(calibration: ScaleCalibration): string {
  const pxPerM = Math.round(calibration.pixelsPerMeter * 10) / 10;
  const mPerM  = calibration.realDistance_m;
  const d      = Math.round(rawPixelDistance(
    calibration.point1, calibration.point2,
    calibration.naturalWidth, calibration.naturalHeight,
  ));
  return `${mPerM} m = ${d} px mesurés · 1 m ≈ ${pxPerM} px`;
}

// ── Qualité de calibration ────────────────────────────────────────────────────

export type CalibrationQuality = 'bonne' | 'acceptable' | 'faible';

export interface CalibrationAssessment {
  quality:       CalibrationQuality;
  pixelDistance: number;
  /** Message affiché à l'utilisateur */
  message:       string;
  /** Conseils pour améliorer la précision */
  tips:          ReadonlyArray<string>;
}

/**
 * Évalue la qualité d'une calibration selon la distance en pixels mesurée.
 * Plus la distance est longue (en pixels naturels), plus la précision est élevée.
 *
 * Seuils :
 * - ≥ 200 px → bonne    (< 0.5% d'erreur attendue)
 * - ≥ 80 px  → acceptable (~1-3% d'erreur attendue)
 * - < 80 px  → faible   (> 5% d'erreur attendue)
 */
export function assessCalibrationQuality(
  calibration: ScaleCalibration,
): CalibrationAssessment {
  const d = rawPixelDistance(
    calibration.point1,
    calibration.point2,
    calibration.naturalWidth,
    calibration.naturalHeight,
  );

  const TIPS_GENERIC: ReadonlyArray<string> = [
    'Zoomez au maximum avant de placer les points.',
    'Choisissez une cote inscrite explicitement sur le plan (ex. : 6,00).',
    'Mesurez la distance la plus longue possible (ex. : largeur totale du bâtiment).',
    'Évitez les diagonales : préférez les segments strictement horizontaux ou verticaux.',
  ];

  if (d >= 200) {
    return {
      quality: 'bonne',
      pixelDistance: d,
      message: `${Math.round(d)} px mesurés — précision élevée.`,
      tips: [],
    };
  }

  if (d >= 80) {
    return {
      quality: 'acceptable',
      pixelDistance: d,
      message: `${Math.round(d)} px mesurés — précision correcte. Une mesure plus longue améliorerait la fiabilité.`,
      tips: TIPS_GENERIC.slice(0, 2),
    };
  }

  return {
    quality: 'faible',
    pixelDistance: d,
    message: `Seulement ${Math.round(d)} px mesurés — imprécision élevée (> 5% probable).`,
    tips: TIPS_GENERIC,
  };
}

/**
 * Évalue l'écart entre la surface totale calculée (rooms dessinés) et
 * la surface de référence connue. Retourne des conseils si l'écart est significatif.
 */
export function assessSurfaceMismatch(params: {
  calculatedM2: number;
  referenceM2: number;
  calibration: ScaleCalibration;
}): {
  ecartPct: number;
  ecartM2:  number;
  isCritical: boolean;
  tips: ReadonlyArray<string>;
} | null {
  const { calculatedM2, referenceM2, calibration } = params;
  if (calculatedM2 <= 0 || referenceM2 <= 0) return null;

  const ecartM2  = calculatedM2 - referenceM2;
  const ecartPct = Math.abs(ecartM2) / referenceM2;
  if (ecartPct < 0.12) return null; // < 12% : tolérable

  const isCritical = ecartPct > 0.30;

  const assessment = assessCalibrationQuality(calibration);
  const tips: string[] = [];

  if (assessment.quality === 'faible' || assessment.quality === 'acceptable') {
    tips.push('La mesure de calibration est trop courte — zoomez et choisissez des points plus éloignés.');
  }

  tips.push(
    ecartM2 > 0
      ? 'La surface calculée est trop grande : la valeur de la cote saisie est peut-être trop petite.'
      : 'La surface calculée est trop petite : la valeur de la cote saisie est peut-être trop grande.',
  );
  tips.push('Mesurez une cote dont vous connaissez exactement la valeur (ex. : largeur inscrite sur le plan).');
  tips.push('Pour un bâtiment complexe, prenez 2-3 mesures sur différentes parties du plan.');

  return { ecartPct, ecartM2, isCritical, tips };
}

/**
 * Calcule la surface en m² d'un polygone défini par ses sommets en coordonnées normalisées.
 * Algorithme : formule du lacet (Shoelace / formule de Gauss).
 * Fonctionne pour tout polygone simple (convexe ou concave, non auto-intersectant).
 *
 * @param vertices  Liste ordonnée des sommets du polygone (sens horaire ou anti-horaire)
 * @param calibration  Calibration validée par l'utilisateur
 */
export function computePolygonArea_m2(
  vertices: ReadonlyArray<NormalizedPoint>,
  calibration: ScaleCalibration,
): number | null {
  if (vertices.length < 3) return null;

  // Convertir les coordonnées normalisées [0,1] en pixels naturels de l'image
  const pts = vertices.map((v) => ({
    x: v.x * calibration.naturalWidth,
    y: v.y * calibration.naturalHeight,
  }));

  // Formule du lacet (Shoelace / Gauss)
  let area = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += pts[i].x * pts[j].y;
    area -= pts[j].x * pts[i].y;
  }
  const areaPx2 = Math.abs(area) / 2;

  // Convertir px² → m²  (metersPerPixel = 1 / pixelsPerMeter)
  const m2 = areaPx2 * calibration.metersPerPixel * calibration.metersPerPixel;
  return Math.round(m2 * 10) / 10; // 1 décimale
}

/** Retourne true si une calibration valide est disponible dans l'état courant. */
export function isCalibrated(): boolean {
  return calibratorState.status === 'calibrated' && calibratorState.calibration !== null;
}

// ── Alias de compatibilité ────────────────────────────────────────────────────
// Pour les modules du projet qui importent sous l'ancien nom.

/**
 * Alias de `computeSurface_m2`.
 * Calcule la surface en m² d'un rectangle normalisé après calibration utilisateur.
 * Retourne null si aucune calibration n'est disponible.
 */
export const estimateSurface = computeSurface_m2;

// ── Pipeline automatique (compatibilité AnalysePlanPage) ─────────────────────

/**
 * Résultat d'une calibration automatique issue des métadonnées du plan.
 * Distinct de `ScaleCalibration` qui est le résultat de la calibration manuelle.
 */
export interface PipelineCalibration {
  readonly method: string | null;
  readonly pixelsPerMeter: number | null;
  readonly widthPx: number;
  readonly heightPx: number;
}

/**
 * Calibration automatique depuis les métadonnées extraites du plan
 * (échelle détectée, dimensions image).
 * Utilisée par le pipeline AnalysePlanPage → planValidationEngine.
 *
 * Distinct de la calibration manuelle (startCalibration / confirmCalibration)
 * qui reste la source de vérité pour les surfaces métier.
 */
export function calibratePlan(params: {
  widthPx: number;
  heightPx: number;
  metadata: unknown;
  detectedGeometry: unknown;
}): PipelineCalibration {
  const meta = params.metadata as
    | { echelle?: { value?: number | null; confidence?: string } }
    | null | undefined;

  const echelle = meta?.echelle?.value ?? null;

  if (!echelle || echelle <= 0 || params.widthPx <= 0) {
    return {
      method: null,
      pixelsPerMeter: null,
      widthPx: params.widthPx,
      heightPx: params.heightPx,
    };
  }

  // Heuristique : plan sur feuille A1 (594 mm de large).
  // 1:X signifie que 1 unité sur le plan = X unités réelles.
  // pixelsPerMeter_réel = widthPx / (largeurFeuille_m × echelle)
  const largeurFeuille_m = 0.594; // A1 paysage
  const pixelsPerMeter   = params.widthPx / (largeurFeuille_m * echelle);

  return {
    method:        `Auto — 1:${echelle}`,
    pixelsPerMeter: Math.round(pixelsPerMeter * 10) / 10,
    widthPx:        params.widthPx,
    heightPx:       params.heightPx,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// HOOK REACT
// ═══════════════════════════════════════════════════════════════════════════════

export interface UseScaleCalibratorReturn {
  readonly calibratorState: ScaleCalibratorState;
  readonly isCalibrating: boolean;
  readonly isCalibrated: boolean;
  readonly calibration: ScaleCalibration | null;
  readonly start: () => void;
  readonly pick1: (p: NormalizedPoint) => void;
  readonly pick2: (p: NormalizedPoint) => void;
  readonly setDistance: (v: string) => void;
  readonly confirm: (naturalW: number, naturalH: number) => boolean;
  readonly cancel: () => void;
  readonly clear: () => void;
  readonly surfaceOf: (tl: NormalizedPoint, br: NormalizedPoint) => number | null;
  readonly lengthOf: (p1: NormalizedPoint, p2: NormalizedPoint) => number | null;
}

export function useScaleCalibrator(planId?: string): UseScaleCalibratorReturn {
  const [state, setState] = useState<ScaleCalibratorState>(() => getCalibratorState());

  useEffect(() => {
    if (planId) initCalibrator(planId);
    setState(getCalibratorState());
    const unsub = subscribeToCalibrator((s) => setState(s));
    return unsub;
  }, [planId]);

  return {
    calibratorState: state,
    isCalibrating: state.status === 'picking_point1'
      || state.status === 'picking_point2'
      || state.status === 'awaiting_distance',
    isCalibrated: state.status === 'calibrated' && state.calibration !== null,
    calibration: state.calibration,
    start:       startCalibration,
    pick1:       pickPoint1,
    pick2:       pickPoint2,
    setDistance: setDistanceInput,
    confirm:     confirmCalibration,
    cancel:      cancelCalibration,
    clear:       clearCalibration,
    surfaceOf:   (tl, br) => computeSurface_m2(tl, br, state.calibration),
    lengthOf:    (p1, p2) => computeLength_m(p1, p2, state.calibration),
  };
}