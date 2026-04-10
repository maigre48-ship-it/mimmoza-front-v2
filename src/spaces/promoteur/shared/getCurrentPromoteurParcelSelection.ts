// src/spaces/promoteur/shared/getCurrentPromoteurParcelSelection.ts
//
// Selector synchrone partagé — source de vérité unique pour la sélection foncière.
// Utilisable hors composant React (utils, init, tests, logs).
//
// V1.2 — normalizer tolérant : accepte Feature, Feature[], FeatureCollection,
//         Polygon brut, MultiPolygon brut, formats legacy Mimmoza.
//
// V1.3 — Fallback étendu :
//         1. useFoncierSelection localStorage (mimmoza.promoteur.foncier.selected_v1)
//         2. snapshot.foncier  (patchModule("foncier", {...}) — FoncierPluPage v8.1+)
//         3. snapshot.implantation2d.data
//         4. snapshot.project
//         5. mimmoza.session.* (clés génériques)

import type { Feature, Polygon, MultiPolygon, Geometry, FeatureCollection } from "geojson";
import type { SelectedParcel } from "./hooks/useFoncierSelection";
import { getSnapshot } from "./promoteurSnapshot.store";

// ── localStorage keys ─────────────────────────────────────────────────────────
const LS_SELECTED = "mimmoza.promoteur.foncier.selected_v1";
const LS_FOCUS    = "mimmoza.promoteur.foncier.focus_v1";
const LS_COMMUNE  = "mimmoza.promoteur.foncier.commune_v1";

// ── Types ──────────────────────────────────────────────────────────────────────
export interface PromoteurParcelSelection {
  selectedParcels:  SelectedParcel[];
  focusParcelId:    string | null;
  communeInsee:     string | null;
  /** Features GeoJSON normalisées (parcelles avec géométrie chargée uniquement) */
  parcelFeatures:   Feature<Polygon | MultiPolygon>[];
  /** Bounds Leaflet [[minLat, minLng], [maxLat, maxLng]] ou null */
  leafletBounds:    [[number, number], [number, number]] | null;
  totalAreaM2:      number | null;
  /** true si parcelles connues mais aucune géométrie disponible */
  missingGeometry:  boolean;
  /** Source ayant fourni les données (pour debug) */
  _source: "foncier_ls" | "snapshot_foncier" | "snapshot_implantation2d" | "snapshot_project" | "session" | "empty";
}

// ── Internal helpers ───────────────────────────────────────────────────────────

function safeJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Normalise n'importe quelle valeur géographique en Feature<Polygon|MultiPolygon>.
 *
 * Formats acceptés (tolérance legacy) :
 *   • GeoJSON Feature<Polygon|MultiPolygon>
 *   • GeoJSON FeatureCollection (prend le premier Polygon/MultiPolygon)
 *   • GeoJSON Polygon brut  { type: "Polygon", coordinates: [...] }
 *   • GeoJSON MultiPolygon brut
 *   • Feature avec geometry imbriquée sous .geometry
 *   • Tout objet avec .geometry.type === "Polygon"|"MultiPolygon"
 */
export function normalizeToGeoJSONFeature(
  raw: unknown,
  parcelId?: string
): Feature<Polygon | MultiPolygon> | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;

  // ── Feature standard ──────────────────────────────────────────────────────
  if (data.type === "Feature" && data.geometry) {
    const g = data.geometry as Record<string, unknown>;
    if (g.type === "Polygon" || g.type === "MultiPolygon") {
      return {
        type: "Feature",
        geometry: g as unknown as Polygon | MultiPolygon,
        properties: {
          ...((data.properties as Record<string, unknown>) ?? {}),
          ...(parcelId ? { parcel_id: parcelId } : {}),
        },
      };
    }
  }

  // ── Polygon / MultiPolygon brut ───────────────────────────────────────────
  if (
    (data.type === "Polygon" || data.type === "MultiPolygon") &&
    Array.isArray(data.coordinates)
  ) {
    return {
      type: "Feature",
      geometry: data as unknown as Polygon | MultiPolygon,
      properties: parcelId ? { parcel_id: parcelId } : {},
    };
  }

  // ── FeatureCollection → prend le premier polygone ─────────────────────────
  if (data.type === "FeatureCollection" && Array.isArray(data.features)) {
    for (const f of data.features as unknown[]) {
      const norm = normalizeToGeoJSONFeature(f, parcelId);
      if (norm) return norm;
    }
  }

  // ── Objet avec .geometry imbriquée (format legacy Mimmoza) ───────────────
  if (data.geometry && typeof data.geometry === "object") {
    const g = data.geometry as Record<string, unknown>;
    if (
      (g.type === "Polygon" || g.type === "MultiPolygon") &&
      Array.isArray(g.coordinates)
    ) {
      return {
        type: "Feature",
        geometry: g as unknown as Polygon | MultiPolygon,
        properties: {
          ...((data.properties as Record<string, unknown>) ?? {}),
          ...(parcelId ? { parcel_id: parcelId } : {}),
        },
      };
    }
  }

  return null;
}

function extractAllCoords(f: Feature<Polygon | MultiPolygon>): [number, number][] {
  const geom   = f.geometry;
  const coords: [number, number][] = [];
  if (geom.type === "Polygon") {
    for (const ring of geom.coordinates) for (const c of ring) coords.push([c[0], c[1]]);
  } else if (geom.type === "MultiPolygon") {
    for (const poly of geom.coordinates)
      for (const ring of poly) for (const c of ring) coords.push([c[0], c[1]]);
  }
  return coords;
}

function computeLeafletBounds(
  features: Feature<Polygon | MultiPolygon>[]
): [[number, number], [number, number]] | null {
  if (!features.length) return null;
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const f of features) {
    for (const [lng, lat] of extractAllCoords(f)) {
      if (lng < minLng) minLng = lng; if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng; if (lat > maxLat) maxLat = lat;
    }
  }
  return minLng === Infinity ? null : [[minLat, minLng], [maxLat, maxLng]];
}

// ── Main selector ──────────────────────────────────────────────────────────────

/**
 * Lit la sélection foncière depuis toutes les sources disponibles (cascade).
 * Synchrone — utilisable hors React.
 *
 * Ordre de priorité :
 *   1. mimmoza.promoteur.foncier.selected_v1 (useFoncierSelection — le plus riche)
 *   2. snapshot.foncier  (patchModule("foncier", {...}) — FoncierPluPage v8.1+)
 *   3. snapshot.implantation2d.data
 *   4. snapshot.project
 *   5. mimmoza.session.* (clés génériques FoncierPluPage)
 */
export function getCurrentPromoteurParcelSelection(): PromoteurParcelSelection {
  // ── 1. Source primaire : useFoncierSelection localStorage ─────────────────
  const lsSelected = safeJSON<SelectedParcel[]>(LS_SELECTED, []);
  const lsFocus    = localStorage.getItem(LS_FOCUS) ?? null;
  const lsCommune  = localStorage.getItem(LS_COMMUNE) ?? null;

  let selectedParcels: SelectedParcel[] = lsSelected;
  let focusParcelId:   string | null    = lsFocus;
  let communeInsee:    string | null    = lsCommune;
  let _source: PromoteurParcelSelection["_source"] = "foncier_ls";

  // ── 2–5. Fallback cascade si foncier_ls vide ──────────────────────────────
  if (selectedParcels.length === 0 || !communeInsee) {
    try {
      const snapshot = getSnapshot();

      // ── 2. snapshot.foncier (FoncierPluPage v8.1+ via patchModule) ──────────
      const foncier = snapshot.foncier as Record<string, unknown> | undefined;
      if (foncier) {
        const parcelIds = (foncier.parcelIds  as string[] | undefined) ?? [];
        const parcelId  = (foncier.parcelId   as string   | undefined) ?? null;
        const commune   = (foncier.communeInsee as string | undefined) ?? null;
        const ids = parcelIds.length > 0 ? parcelIds : (parcelId ? [parcelId] : []);

        if (ids.length > 0) {
          if (selectedParcels.length === 0) {
            selectedParcels = ids.map(id => ({ id, area_m2: null }));
          }
          if (!focusParcelId) focusParcelId = parcelId ?? ids[0] ?? null;
          if (!communeInsee && commune) communeInsee = commune;
          _source = "snapshot_foncier";
        }
      }

      // ── 3. snapshot.implantation2d.data ───────────────────────────────────
      if (selectedParcels.length === 0) {
        const implData = (snapshot.implantation2d as Record<string, unknown> | undefined)
          ?.data as Record<string, unknown> | undefined;
        if (implData && Array.isArray(implData.parcelIds) && (implData.parcelIds as string[]).length > 0) {
          _source = "snapshot_implantation2d";
          const ids     = implData.parcelIds as string[];
          const commune = implData.communeInsee as string | undefined;
          selectedParcels = ids.map((id) => ({ id, area_m2: null }));
          if (!focusParcelId) focusParcelId = (implData.primaryParcelId as string | undefined) ?? ids[0] ?? null;
          if (!communeInsee && commune) communeInsee = commune;
        }
      }

      // ── 4. snapshot.project ───────────────────────────────────────────────
      const project = snapshot.project as Record<string, unknown> | undefined;
      if (selectedParcels.length === 0 && project?.parcelId) {
        _source = "snapshot_project";
        const id = String(project.parcelId);
        selectedParcels = [{ id, area_m2: null }];
        if (!focusParcelId) focusParcelId = id;
        if (!communeInsee && project.commune_insee) communeInsee = String(project.commune_insee);
      }

      // Commune depuis project même si parcelles déjà présentes
      if (!communeInsee && project?.commune_insee) {
        communeInsee = String(project.commune_insee);
      }
    } catch (e) {
      console.warn("[getCurrentPromoteurParcelSelection] snapshot read error:", e);
    }

    // ── 5. mimmoza.session.* (clés génériques FoncierPluPage) ────────────────
    if (selectedParcels.length === 0) {
      const sessionParcelId  = localStorage.getItem("mimmoza.session.parcel_id");
      const sessionParcelIds = safeJSON<string[]>("mimmoza.session.parcel_ids", []);
      const sessionCommune   = localStorage.getItem("mimmoza.session.commune_insee");

      const ids = sessionParcelIds.length > 0 ? sessionParcelIds : (sessionParcelId ? [sessionParcelId] : []);
      if (ids.length > 0) {
        _source = "session";
        selectedParcels = ids.map(id => ({ id, area_m2: null }));
        if (!focusParcelId) focusParcelId = sessionParcelId ?? ids[0] ?? null;
        if (!communeInsee && sessionCommune) communeInsee = sessionCommune;
      }
    }
  }

  if (selectedParcels.length === 0) _source = "empty";

  // ── 3. Normalisation tolérante des features ───────────────────────────────
  const parcelFeatures: Feature<Polygon | MultiPolygon>[] = [];
  for (const parcel of selectedParcels) {
    if (parcel.feature) {
      const norm = normalizeToGeoJSONFeature(parcel.feature, parcel.id);
      if (norm) {
        parcelFeatures.push(norm);
      } else {
        console.debug(
          `[getCurrentPromoteurParcelSelection] normalizeToGeoJSONFeature échoué pour ${parcel.id}`,
          parcel.feature
        );
      }
    }
  }

  // ── 4. Surface totale ─────────────────────────────────────────────────────
  const areas       = selectedParcels.map((p) => p.area_m2).filter((a): a is number => typeof a === "number");
  const totalAreaM2 = areas.length ? areas.reduce((s, a) => s + a, 0) : null;

  // ── 5. Bounds ─────────────────────────────────────────────────────────────
  const leafletBounds   = computeLeafletBounds(parcelFeatures);
  const missingGeometry = selectedParcels.length > 0 && parcelFeatures.length === 0;

  console.debug(
    `[getCurrentPromoteurParcelSelection] source=${_source},` +
    ` parcelles=${selectedParcels.length}, features=${parcelFeatures.length},` +
    ` commune=${communeInsee}`
  );

  return {
    selectedParcels, focusParcelId, communeInsee,
    parcelFeatures, leafletBounds, totalAreaM2,
    missingGeometry, _source,
  };
}