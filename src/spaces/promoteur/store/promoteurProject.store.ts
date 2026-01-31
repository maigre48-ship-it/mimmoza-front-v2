// src/spaces/promoteur/store/promoteurProject.store.ts
// Updated: adds implantation2d structure with meta for business parameters handoff

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Feature, FeatureCollection, Polygon, MultiPolygon } from "geojson";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------
export type ParcelFeature = Feature<Polygon | MultiPolygon>;
export type Footprints = FeatureCollection<Polygon>;

export type BuildingKind = "INDIVIDUEL" | "COLLECTIF";

export type FloorsSpec = {
  aboveGroundFloors: number;
  groundFloorHeightM: number;
  typicalFloorHeightM: number;
};

export type Implantation2DMeta = {
  buildingKind: BuildingKind;
  floorsSpec: FloorsSpec;
  nbLogements: number;
  surfaceMoyLogementM2: number;
};

export type Implantation2DData = {
  parcel: ParcelFeature | null;
  buildings: Footprints | null;
  parkings: Footprints | null;
  epsg: "EPSG:2154" | "EPSG:4326" | "UNKNOWN";
  bbox: [number, number, number, number] | null;
  meta: Implantation2DMeta | null;
};

export type PromoteurProjectState = {
  version: number;
  projectId: string | null;
  lastUpdatedAt: number | null;

  // Legacy fields (kept for backward compat, but prefer implantation2d)
  epsg: "EPSG:2154" | "EPSG:4326" | "UNKNOWN";
  bbox: [number, number, number, number] | null;
  parcel: ParcelFeature | null;
  buildings: Footprints | null;
  parkings: Footprints | null;

  // New unified structure
  implantation2d: Implantation2DData | null;

  // Actions
  setProjectId: (id: string | null) => void;

  setFromImplantation2D: (payload: {
    parcel?: ParcelFeature | null;
    buildings?: Footprints | null;
    parkings?: Footprints | null;
    epsg?: Implantation2DData["epsg"];
    bbox?: Implantation2DData["bbox"];
    meta?: Implantation2DMeta | null;
  }) => void;

  clearImplantation: () => void;
  clearAll: () => void;
};

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------
const STORE_VERSION = 2; // Bumped for meta support
const LS_KEY = "mimmoza.promoteur.project.v2";

function now(): number {
  return Date.now();
}

// -----------------------------------------------------------------------------
// Store
// -----------------------------------------------------------------------------
export const usePromoteurProjectStore = create<PromoteurProjectState>()(
  persist(
    (set, get) => ({
      version: STORE_VERSION,
      projectId: null,
      lastUpdatedAt: null,

      // Legacy
      epsg: "UNKNOWN",
      bbox: null,
      parcel: null,
      buildings: null,
      parkings: null,

      // New unified
      implantation2d: null,

      setProjectId: (id) => set({ projectId: id, lastUpdatedAt: now() }),

      setFromImplantation2D: (payload) => {
        const current = get();
        const currentImpl = current.implantation2d;

        const newParcel = payload.parcel !== undefined ? payload.parcel : (currentImpl?.parcel ?? current.parcel);
        const newBuildings = payload.buildings !== undefined ? payload.buildings : (currentImpl?.buildings ?? current.buildings);
        const newParkings = payload.parkings !== undefined ? payload.parkings : (currentImpl?.parkings ?? current.parkings);
        const newEpsg = payload.epsg ?? currentImpl?.epsg ?? current.epsg;
        const newBbox = payload.bbox ?? currentImpl?.bbox ?? current.bbox;
        const newMeta = payload.meta !== undefined ? payload.meta : (currentImpl?.meta ?? null);

        const newImplantation2d: Implantation2DData = {
          parcel: newParcel,
          buildings: newBuildings,
          parkings: newParkings,
          epsg: newEpsg,
          bbox: newBbox,
          meta: newMeta,
        };

        set({
          // Update legacy fields for backward compat
          parcel: newParcel,
          buildings: newBuildings,
          parkings: newParkings,
          epsg: newEpsg,
          bbox: newBbox,
          // Update new unified structure
          implantation2d: newImplantation2d,
          lastUpdatedAt: now(),
        });
      },

      clearImplantation: () =>
        set({
          parcel: null,
          buildings: null,
          parkings: null,
          bbox: null,
          implantation2d: null,
          lastUpdatedAt: now(),
        }),

      clearAll: () =>
        set({
          projectId: null,
          epsg: "UNKNOWN",
          bbox: null,
          parcel: null,
          buildings: null,
          parkings: null,
          implantation2d: null,
          lastUpdatedAt: now(),
        }),
    }),
    {
      name: LS_KEY,
      version: STORE_VERSION,
      storage: createJSONStorage(() => localStorage),
      migrate: (persistedState, version) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const s: any = persistedState;
        if (!s) return persistedState;

        // Migration from v1 to v2: create implantation2d from legacy fields
        if (version < 2) {
          const impl2d: Implantation2DData = {
            parcel: s.parcel ?? null,
            buildings: s.buildings ?? null,
            parkings: s.parkings ?? null,
            epsg: s.epsg ?? "UNKNOWN",
            bbox: s.bbox ?? null,
            meta: null, // No meta in v1
          };
          return {
            ...s,
            version: STORE_VERSION,
            implantation2d: impl2d,
          };
        }

        return { ...s, version: STORE_VERSION };
      },
      partialize: (state) => ({
        version: state.version,
        projectId: state.projectId,
        lastUpdatedAt: state.lastUpdatedAt,
        epsg: state.epsg,
        bbox: state.bbox,
        parcel: state.parcel,
        buildings: state.buildings,
        parkings: state.parkings,
        implantation2d: state.implantation2d,
      }),
    },
  ),
);