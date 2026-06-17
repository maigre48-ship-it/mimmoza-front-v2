// src/services/knowledgeGraph/resolvers/parcelResolver.ts
//
// ÉTAPE 2 — Résolution des coordonnées parcelle-précises.
// Source réelle : Edge Function `cadastre-parcelle-by-id` (utilisée par Foncier + Copilot).
// Body confirmé : { parcel_id, commune_insee }  ->  { feature: { geometry } } (GeoJSON WGS84).
// Fallback : centroïde commune via geo.api.gouv.fr.

import { supabase } from "@/lib/supabaseClient";

export type ParcelSource = "parcel" | "commune_centroid";
export type ParcelConfidence = "high" | "low";

export interface ParcelCoordinates {
  parcelId: string;
  latitude: number;
  longitude: number;
  source: ParcelSource;
  confidence: ParcelConfidence;
}

/** INSEE = 5 premiers caractères de la réf cadastrale (64065000AI0001 -> 64065). */
function inseeFromParcel(parcelId: string): string | null {
  const m = parcelId.trim().match(/^(\d{5})/);
  return m ? m[1] : null;
}

/** Bounds-center d'une géométrie GeoJSON WGS84 (Polygon / MultiPolygon). */
function centroidFromGeometry(geometry: unknown): { lat: number; lon: number } | null {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  let count = 0;

  const visit = (node: unknown): void => {
    if (!Array.isArray(node)) return;
    if (node.length >= 2 && typeof node[0] === "number" && typeof node[1] === "number") {
      const lon = node[0] as number;
      const lat = node[1] as number;
      if (lon < minLon) minLon = lon;
      if (lat < minLat) minLat = lat;
      if (lon > maxLon) maxLon = lon;
      if (lat > maxLat) maxLat = lat;
      count++;
    } else {
      for (const child of node) visit(child);
    }
  };

  const geom = geometry as { coordinates?: unknown } | null;
  if (geom?.coordinates) visit(geom.coordinates);
  if (count === 0 || !Number.isFinite(minLon)) return null;
  return { lat: (minLat + maxLat) / 2, lon: (minLon + maxLon) / 2 };
}

async function resolveFromCadastre(
  parcelId: string,
  insee: string,
): Promise<{ lat: number; lon: number } | null> {
  try {
    const { data, error } = await supabase.functions.invoke("cadastre-parcelle-by-id", {
      body: { parcel_id: parcelId, commune_insee: insee },
    });
    if (error) return null;
    const geometry = (data as { feature?: { geometry?: unknown } } | null)?.feature?.geometry;
    if (!geometry) return null;
    return centroidFromGeometry(geometry);
  } catch {
    return null;
  }
}

async function resolveFromCommune(insee: string): Promise<{ lat: number; lon: number } | null> {
  try {
    const res = await fetch("https://geo.api.gouv.fr/communes/" + insee + "?fields=centre");
    if (!res.ok) return null;
    const j = (await res.json()) as { centre?: { coordinates?: [number, number] } };
    const c = j?.centre?.coordinates;
    if (!c || c.length < 2) return null;
    return { lon: c[0], lat: c[1] };
  } catch {
    return null;
  }
}

/**
 * Résout les coordonnées d'une parcelle.
 * - géométrie cadastrale obtenue -> source="parcel",          confidence="high"
 * - sinon centroïde commune      -> source="commune_centroid", confidence="low"
 */
export async function resolveParcelCoordinates(
  parcelId: string,
): Promise<ParcelCoordinates | null> {
  const insee = inseeFromParcel(parcelId);
  if (!insee) return null;

  const parcel = await resolveFromCadastre(parcelId, insee);
  if (parcel) {
    return { parcelId, latitude: parcel.lat, longitude: parcel.lon, source: "parcel", confidence: "high" };
  }

  const commune = await resolveFromCommune(insee);
  if (commune) {
    return {
      parcelId,
      latitude: commune.lat,
      longitude: commune.lon,
      source: "commune_centroid",
      confidence: "low",
    };
  }

  return null;
}