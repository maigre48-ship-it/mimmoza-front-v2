/**
 * resolveFacadeProjectInput.ts
 *
 * Couche de résolution des données projet réelles vers Facade2DBuildInput.
 *
 * Pipeline :
 *   project data (stores) → FacadeProjectData → resolveFacadeProjectInput()
 *   → Facade2DBuildInput enrichi (avec source tracking)
 *
 * Règle : chaque champ utilise la donnée projet si disponible,
 * sinon retombe sur la valeur du panneau UI (passée en fallback).
 *
 * Convention niveaux :
 *   floorsAboveGround = étages AU-DESSUS du RDC (RDC non inclus)
 *   levelsCount       = nombre total de niveaux affichés (RDC inclus)
 *   → levelsCount = floorsAboveGround + 1
 */

import type { Facade2DBuildInput, Facade2DRoofKind } from './facade2d.types';

// ─── Source tracking ────────────────────────────────────────────────────────

export type FacadeProjectSource = 'editor2d' | 'projectStore' | 'massing' | 'none';
export type ResolvedSource = 'editor2d' | 'projectStore' | 'fallback';

// ─── Données projet candidates (optionnelles) ──────────────────────────────

/**
 * Représente les données qu'on PEUT extraire des stores projet.
 * Tous les champs sont optionnels — le resolver gère les absences.
 */
export interface FacadeProjectData {
  source: FacadeProjectSource;

  // ─── Géométrie bâtiment ───
  buildingWidthM?: number;
  buildingDepthM?: number;
  /** Longueur façade dominante si connue (m) — prévu pour V6 massing */
  dominantFacadeLengthM?: number;
  /** Longueur façade latérale si connue (m) — prévu pour V6 massing */
  sideFacadeLengthM?: number;

  // ─── Programme ───
  /** Étages au-dessus du RDC (convention : RDC NON inclus) */
  floorsAboveGround?: number;
  groundFloorHeightM?: number;
  typicalFloorHeightM?: number;

  // ─── Toiture / attique ───
  roofType?: string;
  hasSetback?: boolean;

  // ─── Détails architecturaux ───
  hasBalconies?: boolean;
  hasLoggias?: boolean;
  hasTerraces?: boolean;

  // ─── Méta projet ───
  buildingKind?: 'INDIVIDUEL' | 'COLLECTIF';
  nbLogements?: number;
}

// ─── Extraction depuis Editor2D store ───────────────────────────────────────

/**
 * Extrait les données du premier bâtiment du store Editor2D.
 * Prend le bâtiment le plus grand par surface au sol.
 * Accepte n'importe quel shape — filtre défensivement les entrées invalides.
 */
export function extractFromEditor2D(
  buildings: ReadonlyArray<Record<string, unknown>> | null | undefined,
): FacadeProjectData {
  if (!Array.isArray(buildings) || !buildings.length) return { source: 'none' };

  // Guard : on filtre les entrées qui ont un rect valide
  const valid = buildings.filter((raw): raw is {
    rect: { width: number; depth: number };
    floorsAboveGround: number;
    groundFloorHeightM?: number;
    typicalFloorHeightM?: number;
    roofType?: string;
    balconies?: unknown[];
    loggias?: unknown[];
    terraces?: unknown[];
    floorPlans?: ReadonlyArray<{ levelIndex: number }>;
  } => {
    const r = (raw as Record<string, unknown>)?.rect as Record<string, unknown> | undefined;
    return !!r
      && typeof r.width === 'number' && r.width > 0
      && typeof r.depth === 'number' && r.depth > 0
      && typeof (raw as Record<string, unknown>).floorsAboveGround === 'number';
  });

  if (!valid.length) return { source: 'none' };

  // Prend le plus grand bâtiment par surface au sol
  const sorted = [...valid].sort(
    (a, b) => b.rect.width * b.rect.depth - a.rect.width * a.rect.depth,
  );
  const b = sorted[0];

  // Façade principale = côté le plus long
  const facadeW = Math.max(b.rect.width, b.rect.depth);
  const facadeD = Math.min(b.rect.width, b.rect.depth);

  // Détecte retrait si le bâtiment a des floor plans au-delà de floorsAboveGround
  const maxLevel = Math.max(0, ...(b.floorPlans ?? []).map(fp => fp.levelIndex));
  const hasSetback = maxLevel > b.floorsAboveGround;

  return {
    source: 'editor2d',
    buildingWidthM: round(facadeW),
    buildingDepthM: round(facadeD),
    floorsAboveGround: b.floorsAboveGround,
    groundFloorHeightM: b.groundFloorHeightM,
    typicalFloorHeightM: b.typicalFloorHeightM,
    roofType: b.roofType,
    hasSetback,
    hasBalconies: (b.balconies ?? []).length > 0,
    hasLoggias: (b.loggias ?? []).length > 0,
    hasTerraces: (b.terraces ?? []).length > 0,
  };
}

// ─── Extraction depuis PromoteurProject store ───────────────────────────────

/**
 * Extrait les données du meta implantation2d.
 * Accepte n'importe quel shape — vérifie chaque champ individuellement.
 */
export function extractFromProjectStore(
  meta: Record<string, unknown> | null | undefined,
): FacadeProjectData {
  if (!meta || typeof meta !== 'object') return { source: 'none' };

  const floorsSpec = meta.floorsSpec as Record<string, unknown> | undefined;
  const aboveGround = typeof floorsSpec?.aboveGroundFloors === 'number'
    ? floorsSpec.aboveGroundFloors : undefined;
  const gfH = typeof floorsSpec?.groundFloorHeightM === 'number'
    ? floorsSpec.groundFloorHeightM : undefined;
  const tfH = typeof floorsSpec?.typicalFloorHeightM === 'number'
    ? floorsSpec.typicalFloorHeightM : undefined;
  const kind = meta.buildingKind;
  const nbLog = typeof meta.nbLogements === 'number' ? meta.nbLogements : undefined;

  return {
    source: 'projectStore',
    floorsAboveGround: aboveGround,
    groundFloorHeightM: gfH,
    typicalFloorHeightM: tfH,
    buildingKind: kind === 'INDIVIDUEL' || kind === 'COLLECTIF' ? kind : undefined,
    nbLogements: nbLog,
  };
}

// ─── Résolution finale ──────────────────────────────────────────────────────

export function resolveFacadeProjectInput(
  editor2d: FacadeProjectData,
  project: FacadeProjectData,
  uiFallback: Facade2DBuildInput,
): Facade2DBuildInput & { sourceResolved: ResolvedSource } {

  const pick = <T,>(...candidates: (T | undefined | null)[]): T | undefined =>
    candidates.find(v => v !== undefined && v !== null) as T | undefined;

  // ─── Géométrie ───
  const widthM = pick(
    editor2d.buildingWidthM, project.buildingWidthM, uiFallback.widthM,
  ) ?? uiFallback.widthM;

  const depthM = pick(
    editor2d.buildingDepthM, project.buildingDepthM, uiFallback.depthM,
  ) ?? uiFallback.depthM;

  // ─── Niveaux (sécurisé : minimum 1 niveau) ───
  const rawFloors = pick(editor2d.floorsAboveGround, project.floorsAboveGround);
  const levelsCount = rawFloors !== undefined
    ? Math.max(1, rawFloors + 1)
    : uiFallback.levelsCount;

  const levelHeightM = pick(
    editor2d.typicalFloorHeightM, project.typicalFloorHeightM, uiFallback.levelHeightM,
  ) ?? uiFallback.levelHeightM;

  // ─── Toiture ───
  const roofKind = pick(
    mapRoofType(editor2d.roofType), mapRoofType(project.roofType), uiFallback.roofKind,
  ) ?? uiFallback.roofKind;

  // ─── Attique : OR logique — l'intention UI prime, le projet peut ajouter ───
  const hasAttic =
    uiFallback.hasAttic ||
    !!editor2d.hasSetback ||
    !!project.hasSetback;

  // ─── Balcons : si le projet en a, on active (sans écraser le choix UI si déjà actif) ───
  const balconyMode = editor2d.hasBalconies
    ? (uiFallback.balconyMode === 'none' ? 'continuous' : uiFallback.balconyMode)
    : uiFallback.balconyMode;

  // ─── Loggias : idem ───
  const loggiaMode = editor2d.hasLoggias
    ? (uiFallback.loggiaMode === 'none' ? 'simple' : uiFallback.loggiaMode)
    : uiFallback.loggiaMode;

  // ─── Source tracking (debug) ───
  const sourceResolved: ResolvedSource =
    editor2d.source !== 'none' ? 'editor2d'
    : project.source !== 'none' ? 'projectStore'
    : 'fallback';

  return {
    ...uiFallback,
    widthM,
    depthM,
    levelsCount,
    levelHeightM,
    roofKind,
    hasAttic,
    balconyMode,
    loggiaMode,
    sourceResolved,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function mapRoofType(roofType: string | undefined): Facade2DRoofKind | undefined {
  if (!roofType) return undefined;
  const lower = roofType.toLowerCase();
  if (lower.includes('flat') || lower.includes('terrasse')) return 'flat';
  if (lower.includes('mansard')) return 'mansard';
  if (lower.includes('hip') || lower.includes('croupe')) return 'hip';
  if (lower.includes('gable') || lower.includes('pignon')) return 'gable';
  return undefined;
}

function round(v: number, decimals = 1): number {
  const f = Math.pow(10, decimals);
  return Math.round(v * f) / f;
}