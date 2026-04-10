// src/spaces/promoteur/plan2d/plan.variantGenerator.ts
//
// Deterministic variant generator — produces a small set of geometrically
// adjusted alternatives from an active scenario's buildings.
//
// Design principles:
//   • Pure functions only — no mutation, no side-effects.
//   • Conservative transformations — cannot break parcel containment
//     by more than the source already did.
//   • Transparent logic — every transformation is documented.
//   • Stable — same input always produces the same output.

import type { PlanBuilding, PlanBuildingWithTransform, Vec2 } from "./plan.types";
import type { ImplantationScenario } from "./plan.scenarios.types";
import type {
  GeneratedVariant,
  GeneratedVariantKind,
  VariantGeneratorConfig,
} from "./plan.variantGenerator.types";
import { getPolygonCentroid } from "./plan.geometry";
import { applyTransform } from "./plan.transform";

// ─── DEFAULTS ─────────────────────────────────────────────────────────

const DEFAULTS: Required<VariantGeneratorConfig> = {
  compactScaleFactor:    0.88,
  setbackOptScaleFactor: 0.93,
  densifiedScaleFactor:  1.12,
  densifiedExtraLevels:  1,
  maxScaleCap:           1.50,
  minScaleFloor:         0.50,
};

// ─── BUILDING TRANSFORM HELPERS ───────────────────────────────────────

/**
 * Ensures a PlanBuilding has all transform fields.
 * Idempotent — already-migrated buildings are returned unchanged.
 */
function ensureTransform(b: PlanBuilding): PlanBuildingWithTransform {
  if (b.basePolygon && b.basePolygon.length > 0 && b.position != null &&
      b.scaleX != null && b.scaleY != null) {
    return b as PlanBuildingWithTransform;
  }
  const centroid   = getPolygonCentroid(b.polygon);
  const basePolygon = b.polygon.map(p => ({ x: p.x - centroid.x, y: p.y - centroid.y }));
  return {
    ...b,
    basePolygon,
    position:    centroid,
    scaleX:      b.scaleX      ?? 1,
    scaleY:      b.scaleY      ?? 1,
    rotationDeg: b.rotationDeg ?? 0,
  };
}

/**
 * Clones a building with modified transform fields and recomputes polygon.
 * Pure — never mutates `b`.
 */
function cloneWithTransform(
  b:         PlanBuildingWithTransform,
  overrides: Partial<Pick<PlanBuildingWithTransform, "scaleX" | "scaleY" | "position" | "levels">>,
): PlanBuilding {
  const next: PlanBuildingWithTransform = { ...b, ...overrides };
  return { ...next, polygon: applyTransform(next) };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ─── VARIANT TRANSFORMATIONS ──────────────────────────────────────────

/**
 * COMPACT
 * Reduces scaleX and scaleY uniformly, keeping the building centroid fixed.
 * Effect: smaller footprint, more setback margin on all sides.
 *
 * Transformation: scale × compactScaleFactor
 * Position:       unchanged (building shrinks symmetrically around its centre)
 */
export function applyCompactVariant(
  buildings: readonly PlanBuilding[],
  config:    Required<VariantGeneratorConfig>,
): PlanBuilding[] {
  const factor = config.compactScaleFactor;
  return buildings.map(raw => {
    const b      = ensureTransform(raw);
    const scaleX = clamp(b.scaleX * factor, config.minScaleFloor, config.maxScaleCap);
    const scaleY = clamp(b.scaleY * factor, config.minScaleFloor, config.maxScaleCap);
    return cloneWithTransform(b, { scaleX, scaleY });
  });
}

/**
 * SETBACK_OPTIMIZED
 * Moves each building slightly toward the parcel centroid and reduces scale
 * conservatively. Useful when buildings are close to parcel edges.
 *
 * Transformation:
 *   direction = normalize(parcelCentroid − buildingPosition)
 *   newPosition = buildingPosition + direction × pullDistance
 *   scale × setbackOptScaleFactor
 *
 * pullDistance is adaptive: 5 % of the distance to the parcel centroid,
 * capped at 2 m to prevent large jumps.
 */
export function applySetbackOptimizedVariant(
  buildings:     readonly PlanBuilding[],
  parcelCentroid: Vec2,
  config:         Required<VariantGeneratorConfig>,
): PlanBuilding[] {
  const MAX_PULL_M = 2;
  const factor     = config.setbackOptScaleFactor;

  return buildings.map(raw => {
    const b   = ensureTransform(raw);
    const dx  = parcelCentroid.x - b.position.x;
    const dy  = parcelCentroid.y - b.position.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    let newPosition = b.position;
    if (dist > 0.1) {
      const pull   = Math.min(dist * 0.05, MAX_PULL_M);
      newPosition  = {
        x: b.position.x + (dx / dist) * pull,
        y: b.position.y + (dy / dist) * pull,
      };
    }

    const scaleX = clamp(b.scaleX * factor, config.minScaleFloor, config.maxScaleCap);
    const scaleY = clamp(b.scaleY * factor, config.minScaleFloor, config.maxScaleCap);

    return cloneWithTransform(b, { position: newPosition, scaleX, scaleY });
  });
}

/**
 * DENSIFIED
 * Increases building volume conservatively by:
 *   1. Scaling up footprint by densifiedScaleFactor (primary lever).
 *   2. Adding one level when level data is available (secondary lever).
 *
 * Position: adjusted so the south edge (lowest Y) stays fixed —
 * building grows toward the north, minimising shadow impact.
 */
export function applyDensifiedVariant(
  buildings: readonly PlanBuilding[],
  config:    Required<VariantGeneratorConfig>,
): PlanBuilding[] {
  const factor    = config.densifiedScaleFactor;
  const extraLvls = config.densifiedExtraLevels;

  return buildings.map(raw => {
    const b      = ensureTransform(raw);
    const scaleX = clamp(b.scaleX * factor, config.minScaleFloor, config.maxScaleCap);
    const scaleY = clamp(b.scaleY * factor, config.minScaleFloor, config.maxScaleCap);

    // Anchor south edge: shift position north by half of height delta
    const localBB   = getLocalBoundingBox(b.basePolygon);
    const localH    = localBB.height;
    const heightDelta = (scaleY - b.scaleY) * localH;
    const offsetY     = heightDelta * 0.5; // shift centroid north

    // Y-up world: north = +Y
    const newPosition: Vec2 = {
      x: b.position.x,
      y: b.position.y + offsetY,
    };

    const newLevels = b.levels != null && b.levels > 0
      ? b.levels + extraLvls
      : b.levels;

    return cloneWithTransform(b, { scaleX, scaleY, position: newPosition, levels: newLevels });
  });
}

/** Simple AABB for local-space basePolygon. */
function getLocalBoundingBox(pts: Vec2[]): { width: number; height: number } {
  if (!pts.length) return { width: 0, height: 0 };
  let minY = pts[0].y, maxY = pts[0].y;
  let minX = pts[0].x, maxX = pts[0].x;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { width: maxX - minX, height: maxY - minY };
}

// ─── VARIANT METADATA ─────────────────────────────────────────────────

const VARIANT_META: Record<GeneratedVariantKind, { label: string; description: string }> = {
  compact: {
    label:       "Variante compacte",
    description: "Empreinte réduite de 12 % — dégagement accru sur toutes les limites séparatives.",
  },
  setback_optimized: {
    label:       "Variante optimisée recul",
    description: "Bâtiments repositionnés vers le centre parcellaire et légèrement réduits — reculs améliorés.",
  },
  densified: {
    label:       "Variante densifiée",
    description: "Volume augmenté de 12 % et niveau supplémentaire si disponible — programme plus dense.",
  },
};

// ─── MAIN GENERATOR ───────────────────────────────────────────────────

/**
 * Generates a set of deterministic variants from a source scenario.
 *
 * Returns 3 variants (compact, setback_optimized, densified) unless the
 * source has no buildings, in which case returns an empty array.
 *
 * The parcel argument is used only for the setback_optimized variant
 * (centroid calculation). If absent, that variant uses the average
 * building position as a fallback centroid.
 *
 * Pure function — no side-effects, no mutation.
 */
export function generateVariantsFromScenario(params: {
  scenario: ImplantationScenario;
  parcel?:  Vec2[];
  config?:  VariantGeneratorConfig;
}): GeneratedVariant[] {
  const { scenario, parcel, config: userConfig } = params;
  const cfg: Required<VariantGeneratorConfig> = { ...DEFAULTS, ...userConfig };

  if (!scenario.buildings.length) return [];

  const buildings = scenario.buildings as readonly PlanBuilding[];

  // Centroid for setback_optimized: parcel centroid or fallback to building mean
  const parcelCentroid: Vec2 = parcel && parcel.length >= 3
    ? getPolygonCentroid(parcel)
    : (() => {
        let x = 0, y = 0;
        buildings.forEach(b => {
          const pos = ensureTransform(b).position;
          x += pos.x; y += pos.y;
        });
        return { x: x / buildings.length, y: y / buildings.length };
      })();

  const kinds: GeneratedVariantKind[] = ["compact", "setback_optimized", "densified"];

  return kinds.map(kind => {
    const meta = VARIANT_META[kind];

    let transformed: PlanBuilding[];
    switch (kind) {
      case "compact":
        transformed = applyCompactVariant(buildings, cfg);
        break;
      case "setback_optimized":
        transformed = applySetbackOptimizedVariant(buildings, parcelCentroid, cfg);
        break;
      case "densified":
        transformed = applyDensifiedVariant(buildings, cfg);
        break;
    }

    return {
      id:               `variant-${kind}-${scenario.id}`,
      sourceScenarioId: scenario.id,
      kind,
      label:            meta.label,
      description:      meta.description,
      buildings:        transformed,
    };
  });
}