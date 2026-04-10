// src/spaces/promoteur/plan2d/plan.zoning.types.ts

import type { Vec2 } from "./plan.types";

// ─── OVERLAY KIND ─────────────────────────────────────────────────────

/**
 * Semantic category for a zoning overlay.
 *
 * Used to derive default styles and future rule-based logic.
 * Extensibility: add new kinds here — all helper functions will handle
 * them via their lookup tables without requiring call-site changes.
 */
export type ZoningOverlayKind =
  | "buildable"       // clearly constructible zone
  | "non_buildable"   // prohibited area (EBC, flood, etc.)
  | "street_setback"  // road-side recul / alignment constraint
  | "green_space"     // planted / open space obligation
  | "servitude"       // easement / servitude d'utilité publique
  | "attention_zone"; // general vigilance area (geological, noise, etc.)

// ─── STYLE ────────────────────────────────────────────────────────────

/**
 * Visual style for an overlay polygon.
 *
 * All fields are optional in ZoningOverlay.style so callers only override
 * what they need. mergeZoningStyle() combines base + override at render time.
 */
export interface ZoningOverlayStyle {
  fill:          string;
  stroke:        string;
  fillOpacity:   number;
  strokeWidth:   number;
  dashArray:     string; // SVG strokeDasharray value, or "none"
}

// ─── OVERLAY ──────────────────────────────────────────────────────────

/**
 * A single named spatial overlay polygon.
 *
 * Overlays are rendered in ascending `priority` order (lower = drawn first
 * = behind subsequent overlays). Use priorities like 10, 20, 30 so future
 * overlays can be inserted between existing ones without renumbering.
 *
 * Extensibility roadmap (add fields here):
 *   articleRef?     — PLU article this overlay derives from
 *   ruleSource?     — "plu_engine" | "cadastre" | "manual"
 *   isEditable?     — allow user to toggle visibility
 *   groupId?        — collapse related overlays in legend
 *   metadata?       — arbitrary key-value for future rule display
 */
export interface ZoningOverlay {
  /** Stable machine identifier. */
  id: string;
  /** Business-readable label displayed in the canvas and legend. */
  label: string;
  /** Semantic category — drives default style and future rule logic. */
  kind: ZoningOverlayKind;
  /** World-space polygon vertices. */
  polygon: Vec2[];
  /**
   * Render order: lower = painted first (behind), higher = painted last (on top).
   * Recommended spacing: 10, 20, 30 …
   */
  priority: number;
  /**
   * Optional per-overlay style overrides applied on top of the kind's
   * default style. Omit fields you want to inherit from the default.
   */
  style?: Partial<ZoningOverlayStyle>;
}

// ─── LAYER COLLECTION ─────────────────────────────────────────────────

/**
 * A named, ordered set of zoning overlays for a project.
 *
 * Extensibility: future versions can add visibility toggles, source
 * metadata, or per-layer opacity controls at this level.
 */
export interface ZoningLayerSet {
  overlays: ZoningOverlay[];
}