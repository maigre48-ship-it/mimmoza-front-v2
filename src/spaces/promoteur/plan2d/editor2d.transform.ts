// editor2d.transform.ts
// Moteur de transformation géométrique pur pour l'éditeur 2D Mimmoza.
// Repère : parcelleLocal (Y-down, mètres). Aucune dépendance React / store.
// Testable unitairement, importable par le canvas, le store et le Massing 3D.
//
// Algorithme resize (résumé) :
//   1. Projeter le delta monde sur les axes locaux du bâtiment (dot product).
//   2. Ajuster width / depth selon les signes de la poignée.
//   3. Recalculer le centre pour que l'ancre opposée reste FIXE en monde.
// ─────────────────────────────────────────────────────────────────────────────

// ── Types ─────────────────────────────────────────────────────────────────────

/** Identifiant d'une des 8 poignées (nomenclature boussole). */
export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** Vecteur 2D en mètres dans le repère parcelleLocal. */
export interface TPoint2D { x: number; y: number; }

/**
 * Rect d'un bâtiment : centre + demi-dimensions + rotation.
 * Correspond exactement au champ `Building2D.rect` du store.
 */
export interface BuildingRect {
  cx:          number; // centre X (mètres)
  cy:          number; // centre Y (mètres, Y vers le bas)
  width:       number; // largeur dans l'axe local X (mètres)
  depth:       number; // profondeur dans l'axe local Y (mètres)
  rotationDeg: number; // rotation horaire (degrés, convention SVG)
}

// ── Constantes ────────────────────────────────────────────────────────────────

/** Taille minimale d'un bâtiment dans n'importe quel axe (mètres). */
export const MIN_BUILDING_SIZE_M = 3.0;

/**
 * Signes de la position de chaque poignée par rapport au centre en repère local.
 *
 *   sx = +1 → côté droit  (east)  | sx = -1 → côté gauche (west) | sx = 0 → centré
 *   sy = +1 → côté bas    (south) | sy = -1 → côté haut   (north) | sy = 0 → centré
 *
 * L'ancre opposée a les signes (-sx, -sy) : c'est le point qui reste fixe.
 */
const HANDLE_SIGNS: Record<HandleId, { sx: number; sy: number }> = {
  nw: { sx: -1, sy: -1 },
  n:  { sx:  0, sy: -1 },
  ne: { sx:  1, sy: -1 },
  e:  { sx:  1, sy:  0 },
  se: { sx:  1, sy:  1 },
  s:  { sx:  0, sy:  1 },
  sw: { sx: -1, sy:  1 },
  w:  { sx: -1, sy:  0 },
};

/**
 * Curseur CSS standard pour chaque poignée.
 * Note : pour les poignées diagonales d'un rect tourné, le curseur idéal
 * serait calculé dynamiquement — simplification acceptable ici.
 */
export const HANDLE_CURSORS: Record<HandleId, string> = {
  nw: 'nwse-resize',
  n:  'ns-resize',
  ne: 'nesw-resize',
  e:  'ew-resize',
  se: 'nwse-resize',
  s:  'ns-resize',
  sw: 'nesw-resize',
  w:  'ew-resize',
};

/** Ordre de rendu des poignées (priorité affichage). */
export const ALL_HANDLE_IDS: HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

// ── Repère local ─────────────────────────────────────────────────────────────

/**
 * Axes du repère local d'un bâtiment dans l'espace monde (Y-down, SVG).
 *
 * Convention rotation horaire (SVG) pour un angle θ en radians :
 *   localX = ( cos θ,  sin θ )   ← axe "largeur" (width)
 *   localY = (−sin θ,  cos θ )   ← axe "profondeur" (depth)
 *
 * Projection d'un point local (lx, ly) vers le monde :
 *   worldPos = center + localX·lx + localY·ly
 *
 * Projection inverse (monde → local via dot product) :
 *   lx = dot(worldVec, localX)
 *   ly = dot(worldVec, localY)
 */
function getLocalAxes(rotationDeg: number): { localX: TPoint2D; localY: TPoint2D } {
  const θ = rotationDeg * (Math.PI / 180);
  return {
    localX: { x:  Math.cos(θ), y: Math.sin(θ) },
    localY: { x: -Math.sin(θ), y: Math.cos(θ) },
  };
}

// ── Primitives mathématiques ─────────────────────────────────────────────────

function dot(a: TPoint2D, b: TPoint2D): number {
  return a.x * b.x + a.y * b.y;
}

/**
 * Projette les coordonnées locales (lx, ly) vers l'espace monde
 * en partant d'un `origin` (centre ou ancre).
 */
function localToWorld(
  origin: TPoint2D,
  localX: TPoint2D,
  localY: TPoint2D,
  lx:     number,
  ly:     number,
): TPoint2D {
  return {
    x: origin.x + localX.x * lx + localY.x * ly,
    y: origin.y + localX.y * lx + localY.y * ly,
  };
}

// ── Positions des poignées ────────────────────────────────────────────────────

/**
 * Position monde d'une poignée donnée pour un rect.
 *
 * En repère local : pos = (sx · width/2,  sy · depth/2)
 * En monde         : center + rot(pos)
 */
export function getHandleWorldPos(rect: BuildingRect, handle: HandleId): TPoint2D {
  const { sx, sy }         = HANDLE_SIGNS[handle];
  const { localX, localY } = getLocalAxes(rect.rotationDeg);
  return localToWorld(
    { x: rect.cx, y: rect.cy },
    localX, localY,
    sx * rect.width / 2,
    sy * rect.depth / 2,
  );
}

/** Toutes les positions monde des 8 poignées pour un rect donné. */
export function getAllHandlePositions(rect: BuildingRect): Record<HandleId, TPoint2D> {
  return Object.fromEntries(
    ALL_HANDLE_IDS.map(h => [h, getHandleWorldPos(rect, h)]),
  ) as Record<HandleId, TPoint2D>;
}

/**
 * Les 4 coins du rect dans l'ordre nw → ne → se → sw.
 * Utilisé pour tracer le contour de sélection.
 */
export function getRectCornersWorld(rect: BuildingRect): [TPoint2D, TPoint2D, TPoint2D, TPoint2D] {
  return [
    getHandleWorldPos(rect, 'nw'),
    getHandleWorldPos(rect, 'ne'),
    getHandleWorldPos(rect, 'se'),
    getHandleWorldPos(rect, 'sw'),
  ];
}

// ── Transformations ───────────────────────────────────────────────────────────

/** Résultat d'un resize (la rotationDeg n'est jamais modifiée par le resize). */
export interface ResizeResult {
  cx:    number;
  cy:    number;
  width: number;
  depth: number;
}

/**
 * Applique un resize vectoriel robuste sur un rect.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Étape 1 — Projection du delta monde sur les axes locaux                  │
 * │   dLocalX = dot(worldDelta, localX)                                      │
 * │   dLocalY = dot(worldDelta, localY)                                      │
 * │                                                                          │
 * │ Étape 2 — Nouvelles dimensions (clampées à MIN_BUILDING_SIZE_M)          │
 * │   newW = max(MIN, w + sx · dLocalX)   si sx ≠ 0, sinon w               │
 * │   newD = max(MIN, d + sy · dLocalY)   si sy ≠ 0, sinon d               │
 * │                                                                          │
 * │   Avec Shift (coins uniquement) → maintien du ratio d'aspect             │
 * │                                                                          │
 * │ Étape 3 — Ancre monde (reste ABSOLUMENT FIXE)                            │
 * │   anchorLocal = (−sx · w/2,  −sy · d/2)          ← poignée opposée      │
 * │   anchorWorld = center + rot(anchorLocal)                                │
 * │                                                                          │
 * │ Étape 4 — Nouveau centre (garantit que l'ancre reste en place)           │
 * │   newCenter = anchorWorld + rot(sx · newW/2,  sy · newD/2)              │
 * │                                                                          │
 * │ Invariant : anchorWorld est identique avant et après → 0 dérive. ✓      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * @param rect       Rect initial du bâtiment (snapshots au départ du drag).
 * @param handle     Poignée draguée.
 * @param worldDelta Delta en mètres (pointerCurrent − pointerStart, espace monde).
 * @param shiftKey   true → maintien du ratio d'aspect (coins uniquement).
 */
export function applyResize(
  rect:       BuildingRect,
  handle:     HandleId,
  worldDelta: TPoint2D,
  shiftKey    = false,
): ResizeResult {
  const { sx, sy }         = HANDLE_SIGNS[handle];
  const { localX, localY } = getLocalAxes(rect.rotationDeg);

  // ── Étape 1 : projection delta → axes locaux ──────────────────────
  const dLocalX = dot(worldDelta, localX);
  const dLocalY = dot(worldDelta, localY);

  // ── Étape 2 : nouvelles dimensions ────────────────────────────────
  let newW = sx !== 0
    ? Math.max(MIN_BUILDING_SIZE_M, rect.width  + sx * dLocalX)
    : rect.width;
  let newD = sy !== 0
    ? Math.max(MIN_BUILDING_SIZE_M, rect.depth + sy * dLocalY)
    : rect.depth;

  // Shift = maintien du ratio (uniquement pour les 4 coins)
  if (shiftKey && sx !== 0 && sy !== 0) {
    const ratio  = rect.width / rect.depth;
    const scaleW = newW / rect.width;
    const scaleD = newD / rect.depth;
    if (scaleW >= scaleD) {
      // La largeur a le plus bougé → contraindre la profondeur
      newD = Math.max(MIN_BUILDING_SIZE_M, newW / ratio);
    } else {
      // La profondeur a le plus bougé → contraindre la largeur
      newW = Math.max(MIN_BUILDING_SIZE_M, newD * ratio);
    }
  }

  // ── Étape 3 : position monde de l'ancre (fixe) ────────────────────
  // anchorLocal = (−sx · w/2,  −sy · d/2) → poignée diamétralement opposée
  const anchorWorld = localToWorld(
    { x: rect.cx, y: rect.cy },
    localX, localY,
    -sx * rect.width  / 2,
    -sy * rect.depth / 2,
  );

  // ── Étape 4 : nouveau centre ───────────────────────────────────────
  // L'ancre est à (−sx · newW/2, −sy · newD/2) en local du nouveau rect
  // → new_center = anchorWorld + rot(sx · newW/2,  sy · newD/2)
  const newCenter = localToWorld(
    anchorWorld,
    localX, localY,
    sx * newW / 2,
    sy * newD / 2,
  );

  return { cx: newCenter.x, cy: newCenter.y, width: newW, depth: newD };
}

/**
 * Applique une translation simple (move).
 * La rotation est préservée, seul le centre change.
 */
export function applyMove(
  rect:       BuildingRect,
  worldDelta: TPoint2D,
): { cx: number; cy: number } {
  return {
    cx: rect.cx + worldDelta.x,
    cy: rect.cy + worldDelta.y,
  };
}

/**
 * Snaps un delta (vecteur en mètres) sur une grille régulière.
 * Chaque composante est arrondie indépendamment.
 *
 * @param delta   Delta brut en mètres.
 * @param gridM   Taille de la grille en mètres (≤ 0 = snap désactivé).
 */
export function snapDelta(delta: TPoint2D, gridM: number): TPoint2D {
  if (gridM <= 0) return delta;
  return {
    x: Math.round(delta.x / gridM) * gridM,
    y: Math.round(delta.y / gridM) * gridM,
  };
}

/**
 * Snaps un point absolu (en mètres) sur une grille.
 * Utile pour snapper la position cible d'une poignée, puis recalculer le delta.
 */
export function snapPoint(pt: TPoint2D, gridM: number): TPoint2D {
  if (gridM <= 0) return pt;
  return {
    x: Math.round(pt.x / gridM) * gridM,
    y: Math.round(pt.y / gridM) * gridM,
  };
}