import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Feature, FeatureCollection, Polygon, MultiPolygon } from "geojson";

export type ParcelFeature = Feature<Polygon | MultiPolygon>;
export type Footprints = FeatureCollection<Polygon>;

export type PromoteurProjectState = {
  version: number;
  projectId: string | null;
  lastUpdatedAt: number | null;

  epsg: "EPSG:2154" | "EPSG:4326" | "UNKNOWN";
  bbox: [number, number, number, number] | null; // [minX,minY,maxX,maxY]

  parcel: ParcelFeature | null;
  buildings: Footprints | null;
  parkings: Footprints | null;

  setProjectId: (id: string | null) => void;

  setFromImplantation2D: (payload: {
    parcel?: ParcelFeature | null;
    buildings?: Footprints | null;
    parkings?: Footprints | null;
    epsg?: PromoteurProjectState["epsg"];
    bbox?: PromoteurProjectState["bbox"];
  }) => void;

  clearImplantation: () => void;
  clearAll: () => void;
};

const STORE_VERSION = 1;
const LS_KEY = "mimmoza.promoteur.project.v1";

function now(): number {
  return Date.now();
}

export const usePromoteurProjectStore = create<PromoteurProjectState>()(
  persist(
    (set, get) => ({
      version: STORE_VERSION,
      projectId: null,
      lastUpdatedAt: null,

      epsg: "UNKNOWN",
      bbox: null,

      parcel: null,
      buildings: null,
      parkings: null,

      setProjectId: (id) => set({ projectId: id, lastUpdatedAt: now() }),

      setFromImplantation2D: (payload) =>
        set({
          parcel: payload.parcel !== undefined ? payload.parcel : get().parcel,
          buildings: payload.buildings !== undefined ? payload.buildings : get().buildings,
          parkings: payload.parkings !== undefined ? payload.parkings : get().parkings,
          epsg: payload.epsg ?? get().epsg,
          bbox: payload.bbox ?? get().bbox,
          lastUpdatedAt: now(),
        }),

      clearImplantation: () =>
        set({
          parcel: null,
          buildings: null,
          parkings: null,
          bbox: null,
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
          lastUpdatedAt: now(),
        }),
    }),
    {
      name: LS_KEY,
      version: STORE_VERSION,
      storage: createJSONStorage(() => localStorage),
      migrate: (persistedState) => {
        // Future migrations if STORE_VERSION increments.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const s: any = persistedState;
        if (!s) return persistedState;
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
      }),
    },
  ),
);
