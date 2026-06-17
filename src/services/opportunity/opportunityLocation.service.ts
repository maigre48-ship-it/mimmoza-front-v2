// =============================================================
// Mimmoza · Opportunity Engine — Résolution de localisation (V1)
// Géocode (code postal -> centroïde commune + INSEE via geo.api.gouv.fr),
// puis score de mobilité GTFS (transport-score-gtfs-v1) via le client front.
//
// Résolution PAR ZONE (cache mémoire) : 1 géocodage + 1 appel mobilité par
// code postal distinct, pas par annonce.
// Défensif : toute erreur -> champs null (pilier localisation "en attente").
// =============================================================

// ⚠️ CHEMIN À CONFIRMER : client mobilité existant.
//    Hypothèse : src/services/mobility/mobilityClient.ts
import { fetchMobilityScoreSafe } from '@/services/mobility/mobilityClient';

export interface LocationContext {
  latitude: number | null;
  longitude: number | null;
  codeInsee: string | null;
  /** Score mobilité GTFS 0..100 (commune), ou null si indisponible. */
  mobilityScore: number | null;
}

const EMPTY: LocationContext = {
  latitude: null,
  longitude: null,
  codeInsee: null,
  mobilityScore: null,
};

const cache = new Map<string, LocationContext>();

interface GeoCommune {
  code?: string;
  nom?: string;
  centre?: { type?: string; coordinates?: [number, number] };
}

async function geocodeCommune(
  zip?: string,
  city?: string,
): Promise<{ lat: number | null; lon: number | null; codeInsee: string | null }> {
  const z = zip?.trim();
  const c = city?.trim();
  let url: string | null = null;

  if (z) {
    url = `https://geo.api.gouv.fr/communes?codePostal=${encodeURIComponent(z)}&fields=nom,code,centre&format=json`;
  } else if (c) {
    url = `https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(c)}&fields=nom,code,centre&format=json&boost=population&limit=1`;
  }
  if (!url) return { lat: null, lon: null, codeInsee: null };

  try {
    const res = await fetch(url);
    if (!res.ok) return { lat: null, lon: null, codeInsee: null };
    const arr = (await res.json()) as GeoCommune[];
    const first = Array.isArray(arr) ? arr[0] : null;
    const coords = first?.centre?.coordinates;
    const lon = Array.isArray(coords) && typeof coords[0] === 'number' ? coords[0] : null;
    const lat = Array.isArray(coords) && typeof coords[1] === 'number' ? coords[1] : null;
    return { lat, lon, codeInsee: first?.code ?? null };
  } catch {
    return { lat: null, lon: null, codeInsee: null };
  }
}

/**
 * Résout la localisation pour une zone (code postal prioritaire, sinon ville).
 * Mise en cache par clé de zone.
 */
export async function resolveLocationForZone(
  zip?: string,
  city?: string,
): Promise<LocationContext> {
  const key = (zip?.trim() || city?.trim() || '').toLowerCase();
  if (!key) return EMPTY;

  const cached = cache.get(key);
  if (cached) return cached;

  const { lat, lon, codeInsee } = await geocodeCommune(zip, city);

  let mobilityScore: number | null = null;
  if (lat != null && lon != null) {
    try {
      const m = await fetchMobilityScoreSafe(lat, lon, 500);
      const total = m?.total;
      mobilityScore = typeof total === 'number' && Number.isFinite(total) ? Math.round(total) : null;
    } catch {
      mobilityScore = null;
    }
  }

  const ctx: LocationContext = { latitude: lat, longitude: lon, codeInsee, mobilityScore };
  cache.set(key, ctx);
  return ctx;
}

/** Vide le cache (utile pour forcer un recalcul). */
export function clearLocationCache(): void {
  cache.clear();
}