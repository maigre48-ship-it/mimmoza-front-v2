// src/spaces/promoteur/plan2d/plan.types.ts

import type { GeoJSON } from "geojson";

export type Vec2 = { x: number; y: number };

export type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

// ─── SITE ─────────────────────────────────────────────────────────────

export type PlanSite = {
  parcel: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null;
  buildableEnvelope: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null;
  forbiddenBand: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null;
  facadeSegment: GeoJSON.Feature<GeoJSON.LineString> | null;
  communeInsee: string | null;
  parcelIds: string[];
};

// ─── PROGRAMME ────────────────────────────────────────────────────────

export type PlanProgram = {
  buildingKind: "INDIVIDUEL" | "COLLECTIF";
  nbLogements: number;
  surfaceMoyLogementM2: number;
};

// ─── VOLUMÉTRIE ───────────────────────────────────────────────────────

export type PlanFloorsSpec = {
  aboveGroundFloors: number;
  groundFloorHeightM: number;
  typicalFloorHeightM: number;
};

// ─── BÂTIMENT ─────────────────────────────────────────────────────────

/**
 * PlanBuilding with optional transform fields for backward compat.
 * Legacy buildings (without transform fields) are migrated at runtime
 * via ensureBuildingTransform() before entering the canvas.
 */
export type PlanBuilding = {
  id: string;
  /** World-space polygon — kept in sync with transform fields. */
  polygon: Vec2[];
  rotationDeg: number;
  levels: number;
  groundFloorHeightM: number;
  typicalFloorHeightM: number;
  usage: "logement" | "mixte" | "service";
  name?: string;
  // ── Transform fields (optional: missing on legacy buildings) ──
  /** Local-space polygon with centroid at origin. */
  basePolygon?: Vec2[];
  /** World position of the centroid. */
  position?: Vec2;
  scaleX?: number;
  scaleY?: number;
};

/**
 * PlanBuilding guaranteed to have all transform fields populated.
 * All buildings in the canvas are this type after migration.
 */
export type PlanBuildingWithTransform = PlanBuilding & {
  basePolygon: Vec2[];
  position: Vec2;
  scaleX: number;
  scaleY: number;
  rotationDeg: number;
};

// ─── PARKING ──────────────────────────────────────────────────────────

export type PlanParking = {
  id: string;
  polygon: Vec2[];
  kind: "surface" | "rampe" | "sous-sol_access";
  spacesEstimate?: number;
};

// ─── STYLE / RENDU ────────────────────────────────────────────────────

export type PlanVisualIntent = {
  styleFamily:
    | "contemporain_sobre"
    | "contemporain_premium"
    | "classique_urbain"
    | "haussmannien_simplifie";
  facadeRhythm: "regulier" | "mixte";
  balconies: "absent" | "discret" | "marque";
  roofType: "terrasse" | "inclinee";
  vegetationLevel: "faible" | "moyen" | "fort";
  imageStyle: "technique" | "esquisse" | "aquarelle" | "presentation_premium";
  strictGeometry: boolean;
};

// ─── PROJET GLOBAL ────────────────────────────────────────────────────

export type PlanProject = {
  id: string;
  name: string;
  site: PlanSite;
  program: PlanProgram;
  floorsSpec: PlanFloorsSpec;
  buildings: PlanBuilding[];
  parkings: PlanParking[];
  visualIntent: PlanVisualIntent;
};