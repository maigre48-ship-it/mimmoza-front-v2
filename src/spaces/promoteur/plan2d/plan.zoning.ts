// src/spaces/promoteur/plan2d/plan.zoning.ts

import type { Vec2 } from "./plan.types";
import type {
  ZoningOverlay,
  ZoningOverlayKind,
  ZoningOverlayStyle,
  ZoningLayerSet,
} from "./plan.zoning.types";
import { getPolygonCentroid, getBoundingBox } from "./plan.geometry";

// ─── DEFAULT STYLE TABLE ──────────────────────────────────────────────
//
// Design rationale:
//   • All fills are very desaturated / low opacity — overlays must not
//     compete visually with buildings (amber) or the parcel (blue).
//   • Strokes are slightly more saturated than fills for clear edge cues.
//   • Dashes differentiate categories without colour alone (accessibility).

const DEFAULT_STYLES: Readonly<Record<ZoningOverlayKind, ZoningOverlayStyle>> = {
  buildable: {
    fill:        "#22c55e",
    stroke:      "#16a34a",
    fillOpacity: 0.08,
    strokeWidth: 1.25,
    dashArray:   "none",
  },
  non_buildable: {
    fill:        "#ef4444",
    stroke:      "#b91c1c",
    fillOpacity: 0.10,
    strokeWidth: 1.5,
    dashArray:   "4 3",
  },
  street_setback: {
    fill:        "#f59e0b",
    stroke:      "#b45309",
    fillOpacity: 0.11,
    strokeWidth: 1.5,
    dashArray:   "7 4",
  },
  green_space: {
    fill:        "#86efac",
    stroke:      "#16a34a",
    fillOpacity: 0.18,
    strokeWidth: 1.25,
    dashArray:   "none",
  },
  servitude: {
    fill:        "#c4b5fd",
    stroke:      "#7c3aed",
    fillOpacity: 0.13,
    strokeWidth: 1.5,
    dashArray:   "5 4",
  },
  attention_zone: {
    fill:        "#fdba74",
    stroke:      "#ea580c",
    fillOpacity: 0.12,
    strokeWidth: 1.5,
    dashArray:   "8 4",
  },
} as const;

// ─── PURE HELPERS ─────────────────────────────────────────────────────

/**
 * Returns the canonical default style for a ZoningOverlayKind.
 * Pure — returns a new object each call (safe for spread/merge).
 */
export function getDefaultZoningStyle(kind: ZoningOverlayKind): ZoningOverlayStyle {
  return { ...DEFAULT_STYLES[kind] };
}

/**
 * Merges a base style with per-overlay overrides.
 * Only non-undefined fields in `override` replace the base.
 * Pure — never mutates either argument.
 */
export function mergeZoningStyle(
  base: ZoningOverlayStyle,
  override?: Partial<ZoningOverlayStyle>,
): ZoningOverlayStyle {
  if (!override) return base;
  // Spread preserves all base fields; explicit keys in override win.
  return {
    ...base,
    ...(override.fill        !== undefined && { fill:        override.fill }),
    ...(override.stroke      !== undefined && { stroke:      override.stroke }),
    ...(override.fillOpacity !== undefined && { fillOpacity: override.fillOpacity }),
    ...(override.strokeWidth !== undefined && { strokeWidth: override.strokeWidth }),
    ...(override.dashArray   !== undefined && { dashArray:   override.dashArray }),
  };
}

/**
 * Returns overlays sorted by ascending priority (lower = rendered first).
 * Stable sort: overlays with the same priority keep their original order.
 * Pure — returns a new array, never mutates the input.
 */
export function sortZoningOverlays(overlays: readonly ZoningOverlay[]): ZoningOverlay[] {
  return [...overlays].sort((a, b) => a.priority - b.priority);
}

/**
 * Convenience constructor for a ZoningOverlay with sensible defaults.
 *
 * Callers only need to supply id, label, kind, polygon, and priority.
 * Optional style overrides are applied on top of the kind defaults.
 */
export function createZoningOverlay(params: {
  id:       string;
  label:    string;
  kind:     ZoningOverlayKind;
  polygon:  Vec2[];
  priority: number;
  style?:   Partial<ZoningOverlayStyle>;
}): ZoningOverlay {
  return {
    id:       params.id,
    label:    params.label,
    kind:     params.kind,
    polygon:  params.polygon,
    priority: params.priority,
    style:    params.style,
  };
}

/**
 * Returns the world-space centroid of an overlay's polygon.
 * Useful for label placement in canvas renderers.
 */
export function getOverlayLabelPosition(overlay: ZoningOverlay): Vec2 {
  return getPolygonCentroid(overlay.polygon);
}

// ─── DEMO OVERLAY GENERATOR ───────────────────────────────────────────

/**
 * Generates a representative set of zoning overlays derived from a parcel
 * polygon for demo / testing purposes.
 *
 * Overlays are positioned relative to the parcel bounding box so they
 * always remain visually meaningful regardless of parcel shape or scale.
 *
 * NOT intended for production use — replace with actual PLU / cadastral
 * data when available.
 */
export function createDemoZoningOverlays(parcel: Vec2[]): ZoningOverlay[] {
  if (parcel.length < 3) return [];

  const bb = getBoundingBox(parcel);
  const { minX, minY, maxX, maxY, width, height } = bb;

  // 1. Street setback — south edge band (bottom of parcel in world Y-up)
  const sbDepth = Math.min(height * 0.14, width * 0.10);
  const streetSetback = createZoningOverlay({
    id:       "demo-street-setback",
    label:    "Recul voirie",
    kind:     "street_setback",
    priority: 10,
    polygon: [
      { x: minX,           y: minY           },
      { x: maxX,           y: minY           },
      { x: maxX,           y: minY + sbDepth },
      { x: minX,           y: minY + sbDepth },
    ],
  });

  // 2. Green space — NW corner (top-left, high world-Y / low screen-Y)
  const gsW = width  * 0.22;
  const gsH = height * 0.28;
  const greenSpace = createZoningOverlay({
    id:       "demo-green-space",
    label:    "Espace vert",
    kind:     "green_space",
    priority: 20,
    polygon: [
      { x: minX,        y: maxY - gsH },
      { x: minX + gsW,  y: maxY - gsH },
      { x: minX + gsW,  y: maxY       },
      { x: minX,        y: maxY       },
    ],
  });

  // 3. Attention zone — center-right strip
  const azX0 = minX + width * 0.62;
  const azX1 = minX + width * 0.88;
  const azY0 = minY + height * 0.28;
  const azY1 = minY + height * 0.72;
  const attentionZone = createZoningOverlay({
    id:       "demo-attention-zone",
    label:    "Zone vigilance",
    kind:     "attention_zone",
    priority: 30,
    polygon: [
      { x: azX0, y: azY0 },
      { x: azX1, y: azY0 },
      { x: azX1, y: azY1 },
      { x: azX0, y: azY1 },
    ],
  });

  return [streetSetback, greenSpace, attentionZone];
}

// ─── LAYER SET HELPERS ────────────────────────────────────────────────

/**
 * Returns all overlays in a layer set, sorted by priority.
 * Convenience wrapper around sortZoningOverlays.
 */
export function getRenderedOverlays(layerSet: ZoningLayerSet): ZoningOverlay[] {
  return sortZoningOverlays(layerSet.overlays);
}