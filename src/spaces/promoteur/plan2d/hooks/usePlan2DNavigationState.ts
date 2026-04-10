// src/spaces/promoteur/plan2d/hooks/usePlan2DNavigationState.ts
//
// Hook qui lit les données de navigation passées par Implantation2DPage (v2.0).
// À utiliser en PRIORITÉ par le Plan 2D avant tout autre source de données.
//
// Implantation2DPage passe dans location.state :
//   - initialPlanProject      : le projet construit depuis la géométrie restaurée
//   - fromImplantation2D      : booléen sentinelle
//   - restoredParcelIds       : string[]
//   - restoredCommuneInsee    : string | null
//   - restoredLeafletBounds   : [[lat,lng],[lat,lng]] | null
//   - restoredParcelFeatures  : Feature<Polygon|MultiPolygon>[]
//   - restoredCombinedFeature : Feature<Polygon|MultiPolygon> | null
//
// Ce hook normalise tout ça en une interface propre.
// Si le Plan 2D est ouvert directement (sans passer par Implantation2D),
// il retourne des valeurs nulles et Plan 2D se replie sur usePromoteurParcelRestore.

import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import type { Feature, Polygon, MultiPolygon } from "geojson";
import { normalizeToGeoJSONFeature } from "../getCurrentPromoteurParcelSelection";

export interface Plan2DNavigationState {
  /** Projet plan complet passé par Implantation2D */
  initialPlanProject:     unknown | null;
  /** true si la navigation vient d'Implantation2DPage */
  fromImplantation2D:     boolean;
  /** IDs des parcelles sélectionnées */
  parcelIds:              string[];
  /** Code INSEE */
  communeInsee:           string | null;
  /** Bounds Leaflet [[minLat, minLng], [maxLat, maxLng]] */
  leafletBounds:          [[number, number], [number, number]] | null;
  /** Features GeoJSON normalisées */
  parcelFeatures:         Feature<Polygon | MultiPolygon>[];
  /** Feature combinée (union) */
  combinedFeature:        Feature<Polygon | MultiPolygon> | null;
  /** true si des données utiles sont présentes dans le state */
  hasNavigationData:      boolean;
}

export function usePlan2DNavigationState(): Plan2DNavigationState {
  const location = useLocation();
  const state    = (location.state ?? {}) as Record<string, unknown>;

  return useMemo<Plan2DNavigationState>(() => {
    const fromImplantation2D = state.fromImplantation2D === true;

    if (!fromImplantation2D) {
      return {
        initialPlanProject:  null,
        fromImplantation2D:  false,
        parcelIds:           [],
        communeInsee:        null,
        leafletBounds:       null,
        parcelFeatures:      [],
        combinedFeature:     null,
        hasNavigationData:   false,
      };
    }

    // Parcelle IDs
    const parcelIds = Array.isArray(state.restoredParcelIds)
      ? (state.restoredParcelIds as unknown[]).filter((v): v is string => typeof v === "string")
      : [];

    // Commune
    const communeInsee = typeof state.restoredCommuneInsee === "string"
      ? state.restoredCommuneInsee
      : null;

    // Bounds Leaflet
    let leafletBounds: [[number, number], [number, number]] | null = null;
    if (Array.isArray(state.restoredLeafletBounds) && state.restoredLeafletBounds.length === 2) {
      leafletBounds = state.restoredLeafletBounds as [[number, number], [number, number]];
    }

    // Features GeoJSON — normalisation tolérante
    let parcelFeatures: Feature<Polygon | MultiPolygon>[] = [];
    if (Array.isArray(state.restoredParcelFeatures)) {
      parcelFeatures = (state.restoredParcelFeatures as unknown[])
        .map((f, idx) => normalizeToGeoJSONFeature(f, parcelIds[idx]))
        .filter((f): f is Feature<Polygon | MultiPolygon> => f !== null);
    }

    // Feature combinée
    let combinedFeature: Feature<Polygon | MultiPolygon> | null = null;
    if (state.restoredCombinedFeature) {
      combinedFeature = normalizeToGeoJSONFeature(state.restoredCombinedFeature) ??
        (parcelFeatures[0] ?? null);
    } else if (parcelFeatures.length > 0) {
      combinedFeature = parcelFeatures[0];
    }

    const hasNavigationData = parcelIds.length > 0;

    return {
      initialPlanProject:  state.initialPlanProject ?? null,
      fromImplantation2D:  true,
      parcelIds,
      communeInsee,
      leafletBounds,
      parcelFeatures,
      combinedFeature,
      hasNavigationData,
    };
  }, [location.state]); // eslint-disable-line react-hooks/exhaustive-deps
}