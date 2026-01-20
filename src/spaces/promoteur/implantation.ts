// src/spaces/promoteur/implantation.ts
import * as turf from "@turf/turf";
import type { Feature, Polygon, MultiPolygon } from "geojson";
import type { ImplantationUserParams, ImplantationResult, PluRules } from "./types";

/**
 * computeImplantationV1 — implémentation minimale "safe"
 * Objectif: ne pas casser l'UI, renvoyer un résultat cohérent,
 * et une enveloppe après reculs simple (buffer négatif).
 */
export default function computeImplantationV1(args: {
  parcelGeometry: Feature<Polygon | MultiPolygon>;
  surfaceTerrainM2: number;
  pluRules: PluRules | null;
  userParams: ImplantationUserParams;
}): { result: ImplantationResult; buildableGeom: Feature<Polygon | MultiPolygon> | null } {
  const { parcelGeometry, surfaceTerrainM2, userParams } = args;

  const avant = Number((userParams as any)?.reculs?.avant_m ?? 0) || 0;
  const lat = Number((userParams as any)?.reculs?.lateral_m ?? 0) || 0;
  const arr = Number((userParams as any)?.reculs?.arriere_m ?? 0) || 0;
  const reculMax = Math.max(0, avant, lat, arr);

  let envelopeAfterReculs: Feature<Polygon | MultiPolygon> | null = null;
  if (parcelGeometry && reculMax > 0) {
    try {
      const buffered = turf.buffer(parcelGeometry as any, -reculMax, { units: "meters" }) as any;
      if (buffered?.geometry?.type === "Polygon" || buffered?.geometry?.type === "MultiPolygon") {
        envelopeAfterReculs = buffered as Feature<Polygon | MultiPolygon>;
      }
    } catch {
      envelopeAfterReculs = null;
    }
  }

  const nbLogements = Math.max(1, Number(userParams.nbLogements) || 1);
  const placesParLogement = 1;
  const surfaceParPlaceM2 = 25;
  const placesParking = Math.ceil(nbLogements * placesParLogement);
  const surfaceParkingM2 = placesParking * surfaceParPlaceM2;

  const empriseRatio = 0.4;
  const surfaceTerrainApresReculsM2 = Math.max(0, surfaceTerrainM2);
  const surfaceEmpriseMaxM2 = surfaceTerrainApresReculsM2 * empriseRatio;
  const surfaceEmpriseUtilisableM2 = Math.max(0, surfaceEmpriseMaxM2 - surfaceParkingM2);

  const result: any = {
    surfaceTerrainM2,
    surfaceTerrainApresReculsM2,
    surfaceParkingM2,
    surfaceEmpriseMaxM2,
    surfaceEmpriseUtilisableM2,
    nbBatiments: Math.max(1, Number(userParams.nbBatiments) || 1),
    nbLogements,
    placesParking,
    envelopeAfterReculs,
    reculsUsed: {
      recul_avant_m: avant || null,
      recul_lateral_m: lat || null,
      recul_fond_m: arr || null,
      reculMax,
      source: "USERPARAMS",
      mode: "UNIFORM",
    },
  };

  return { result: result as ImplantationResult, buildableGeom: null };
}
