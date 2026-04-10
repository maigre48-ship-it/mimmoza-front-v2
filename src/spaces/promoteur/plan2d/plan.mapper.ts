// src/spaces/promoteur/plan2d/plan.mapper.ts
//
// Flux : données Geoman (drawnBuildings / drawnParkings en GeoJSON)
//        → PlanProject (géométrie Vec2, pour rendu 3D / génération image)
//
// Ce mapper est indépendant du moteur d'évaluation (scenarioEvaluation.ts).
// Il ne doit pas servir à calculer des métriques métier — celles-ci sont
// calculées par evaluateScenario() à partir de Building2D / Parking2D.
//
// Source de vérité parking : Parking2D.slotCount (éditeur 2D).
// PlanParking.spacesEstimate n'est pas renseigné ici intentionnellement.

import type {
  PlanProject,
  PlanBuilding,
  PlanParking,
  Vec2,
} from "./plan.types";

// ─── HELPERS ──────────────────────────────────────────────────────────

function polygonToVec2Array(coords: number[][]): Vec2[] {
  return coords.map(([x, y]) => ({ x: x ?? 0, y: y ?? 0 }));
}

/**
 * Tente d'extraire l'anneau extérieur d'un polygone depuis les différentes
 * imbrications GeoJSON rencontrées dans le projet (direct, .feature, .geojson).
 * Retourne null si aucune géométrie n'est trouvée.
 */
function tryExtractPolygonRing(feature: unknown): number[][] | null {
  if (!feature || typeof feature !== "object") return null;
  const f = feature as Record<string, any>;

  // Direct .geometry
  if (f.geometry?.type === "Polygon")      return f.geometry.coordinates?.[0]      ?? null;
  if (f.geometry?.type === "MultiPolygon") return f.geometry.coordinates?.[0]?.[0] ?? null;

  // Nested .feature.geometry
  if (f.feature?.geometry?.type === "Polygon")      return f.feature.geometry.coordinates?.[0]      ?? null;
  if (f.feature?.geometry?.type === "MultiPolygon") return f.feature.geometry.coordinates?.[0]?.[0] ?? null;

  // Nested .geojson.geometry
  if (f.geojson?.geometry?.type === "Polygon")      return f.geojson.geometry.coordinates?.[0]      ?? null;
  if (f.geojson?.geometry?.type === "MultiPolygon") return f.geojson.geometry.coordinates?.[0]?.[0] ?? null;

  return null;
}

/**
 * Extrait et valide un anneau polygonal depuis un feature.
 * Filtre les coordonnées invalides (NaN, non-arrays).
 * Retourne null si l'anneau est absent ou produit moins de 3 points valides.
 */
function extractPolygonFromFeature(feature: unknown, entityId?: string): number[][] | null {
  const ring = tryExtractPolygonRing(feature);

  if (!ring || ring.length < 3) {
    console.warn(
      `[plan.mapper] Entité "${entityId ?? "?"}": polygone absent ou insuffisant (${ring?.length ?? 0} pts) — ignoré.`,
    );
    return null;
  }

  // Filtrer les coordonnées invalides
  const valid = ring.filter(
    (c) => Array.isArray(c) && c.length >= 2 && isFinite(c[0]) && isFinite(c[1]),
  );

  if (valid.length < 3) {
    console.warn(
      `[plan.mapper] Entité "${entityId ?? "?"}": coordonnées invalides après filtrage (${valid.length} valides) — ignoré.`,
    );
    return null;
  }

  return valid;
}

// ─── BÂTIMENTS ────────────────────────────────────────────────────────

function mapDrawnBuildings(
  drawn: unknown[],
  floorsSpec: {
    aboveGroundFloors:   number;
    groundFloorHeightM:  number;
    typicalFloorHeightM: number;
  },
): PlanBuilding[] {
  return drawn.map((b) => {
    const raw    = b as Record<string, any>;
    const coords = extractPolygonFromFeature(b, raw.id);

    return {
      id:                  raw.id ?? `b-${Math.random().toString(36).slice(2)}`,
      polygon:             coords ? polygonToVec2Array(coords) : [],
      rotationDeg:         0,
      levels:              1 + floorsSpec.aboveGroundFloors,
      groundFloorHeightM:  floorsSpec.groundFloorHeightM,
      typicalFloorHeightM: floorsSpec.typicalFloorHeightM,
      usage:               "logement",
    };
  });
}

// ─── PARKINGS ─────────────────────────────────────────────────────────

function mapDrawnParkings(drawn: unknown[]): PlanParking[] {
  return drawn.map((p) => {
    const raw    = p as Record<string, any>;
    const coords = extractPolygonFromFeature(p, raw.id);

    return {
      id:      raw.id ?? `p-${Math.random().toString(36).slice(2)}`,
      polygon: coords ? polygonToVec2Array(coords) : [],
      kind:    "surface",
      // spacesEstimate délibérément absent :
      // la source de vérité places de parking est Parking2D.slotCount,
      // maintenu par l'éditeur 2D et utilisé par evaluateScenario().
    };
  });
}

// ─── MAPPER PRINCIPAL ─────────────────────────────────────────────────

export function buildPlanProjectFromImplantation(input: {
  parcelIds:    string[];
  communeInsee: string | null;

  combinedParcelFeature: unknown;
  envelopeFeature:       unknown;
  forbiddenBand:         unknown;
  facadeSegment:         unknown;

  buildingKind: "INDIVIDUEL" | "COLLECTIF";

  floorsSpec: {
    aboveGroundFloors:   number;
    groundFloorHeightM:  number;
    typicalFloorHeightM: number;
  };

  nbLogements:          number;
  surfaceMoyLogementM2: number;

  drawnBuildings: unknown[];
  drawnParkings:  unknown[];
}): PlanProject {
  return {
    id:   `plan-${Date.now()}`,
    name: "Projet issu implantation",

    site: {
      parcel:            (input.combinedParcelFeature as any) ?? null,
      buildableEnvelope: (input.envelopeFeature       as any) ?? null,
      forbiddenBand:     (input.forbiddenBand          as any) ?? null,
      facadeSegment:     (input.facadeSegment          as any) ?? null,
      communeInsee:      input.communeInsee,
      parcelIds:         input.parcelIds,
    },

    program: {
      buildingKind:         input.buildingKind,
      nbLogements:          input.nbLogements,
      surfaceMoyLogementM2: input.surfaceMoyLogementM2,
    },

    floorsSpec: {
      aboveGroundFloors:   input.floorsSpec.aboveGroundFloors,
      groundFloorHeightM:  input.floorsSpec.groundFloorHeightM,
      typicalFloorHeightM: input.floorsSpec.typicalFloorHeightM,
    },

    buildings: mapDrawnBuildings(input.drawnBuildings, input.floorsSpec),
    parkings:  mapDrawnParkings(input.drawnParkings),

    visualIntent: {
      styleFamily:     "contemporain_sobre",
      facadeRhythm:    "regulier",
      balconies:       "discret",
      roofType:        "terrasse",
      vegetationLevel: "moyen",
      imageStyle:      "presentation_premium",
      strictGeometry:  true,
    },
  };
}