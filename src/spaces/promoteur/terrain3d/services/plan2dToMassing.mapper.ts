// services/plan2dToMassing.mapper.ts
// Convertit les données de l'implantation 2D en modèle de scène 3D.
// Zéro dépendance Three.js / React — testable unitairement.
// ─────────────────────────────────────────────────────────────────────────────

import type { Feature, FeatureCollection, Polygon, MultiPolygon } from "geojson";
import {
  type MassingBuildingModel,
  type ProjectSceneModel,
  type SimpleBuildingKind,
  type BuildingV1Meta,
  createBuilding,
  buildingLevelsFromArchitecture,
  defaultBuildingV1Meta,
  generateBuildingId,
} from "../massingScene.types";

// ─── Types entrée ─────────────────────────────────────────────────────────────

export interface Plan2DBuilding {
  /** ID depuis l'éditeur 2D */
  id?: string;
  /** Nom affiché */
  name?: string;
  /** Polygone en coords géographiques sources (WGS84 ou Lambert93) */
  polygon: Feature<Polygon | MultiPolygon>;
  /** Nombre de niveaux total (RDC inclus) */
  totalFloors?: number;
  /** Hauteur par niveau en mètres */
  floorHeightM?: number;
  /** Type de bâtiment métier */
  kind?: SimpleBuildingKind;
  /** Mode d'ancrage terrain */
  anchorMode?: BuildingV1Meta["anchorMode"];
}

export interface Plan2DContext {
  /** Parcelle en coords géographiques sources */
  parcel?: Feature<Polygon | MultiPolygon>;
  /** Polygones parking en coords sources */
  parkings?: FeatureCollection<Polygon>;
  /** SRID source — "WGS84" | "LAMBERT93" */
  srid?: string;
}

// ─── Mapper principal ─────────────────────────────────────────────────────────

/**
 * Convertit un tableau de bâtiments 2D en `ProjectSceneModel`.
 * Peut être appelé depuis n'importe quel contexte (hook, worker, test).
 */
export function plan2dToProjectScene(
  plan2dBuildings: Plan2DBuilding[],
  context: Plan2DContext = {},
): ProjectSceneModel {
  const buildings: MassingBuildingModel[] = plan2dBuildings
    .map(mapOneBuilding)
    .filter((b): b is MassingBuildingModel => b !== null);

  const parcelRing = extractFirstRing(context.parcel);
  const parkingRings = context.parkings?.features
    .map(f => extractFirstRing(f))
    .filter((r): r is [number, number][] => r !== null) ?? [];

  return {
    version: 1,
    buildings,
    parcelRing: parcelRing ?? undefined,
    parkingRings: parkingRings.length ? parkingRings : undefined,
    placedObjects: [],
    projectMeta: { createdAt: Date.now(), updatedAt: Date.now() },
  };
}

// ─── Mapping d'un bâtiment ────────────────────────────────────────────────────

function mapOneBuilding(src: Plan2DBuilding): MassingBuildingModel | null {
  const ring = extractFirstRing(src.polygon);
  if (!ring || ring.length < 3) return null;

  const id = src.id ?? generateBuildingId();
  const name = src.name ?? `Bâtiment ${id.slice(-4)}`;
  const totalFloors = Math.max(1, src.totalFloors ?? 4);
  const floorHeightM = Math.max(2.2, src.floorHeightM ?? 2.9);
  const kind: SimpleBuildingKind = src.kind ?? "generique";

  // Construire BuildingLevels compatible legacy
  const levels = {
    aboveGroundFloors: Math.max(0, totalFloors - 1),
    groundFloorHeightM: floorHeightM,
    typicalFloorHeightM: floorHeightM,
  };

  const v1Meta: BuildingV1Meta = {
    ...defaultBuildingV1Meta(kind),
    anchorMode: src.anchorMode ?? "footprint-avg",
  };

  return createBuilding(
    id,
    name,
    { points: ring, epsg: "SOURCE" },
    {
      levels,
      visible: true,
      meta: {
        footprintM2: approximateArea(ring),
        // Stockage des métadonnées V1 — champ libre dans meta
        ...(({ v1: v1Meta } as unknown) as Record<string, unknown>),
      },
    },
  );
}

// ─── Helpers géométrie pure ───────────────────────────────────────────────────

function extractFirstRing(
  feature?: Feature<Polygon | MultiPolygon> | null,
): [number, number][] | null {
  if (!feature?.geometry) return null;
  const coords =
    feature.geometry.type === "Polygon"
      ? feature.geometry.coordinates[0]
      : feature.geometry.coordinates[0]?.[0];
  if (!coords?.length) return null;
  return coords as [number, number][];
}

/** Surface approximative en m² pour WGS84 (Shoelace + échelle lat) */
function approximateArea(ring: [number, number][]): number {
  if (ring.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    a += ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1];
  }
  const areaDeg2 = Math.abs(a) / 2;
  const midLat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const mPerDegLat = 111_320;
  const mPerDegLon = 111_320 * Math.cos((midLat * Math.PI) / 180);
  return Math.round(areaDeg2 * mPerDegLat * mPerDegLon);
}