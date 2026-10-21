import type { FeatureCollection } from 'geojson';
import { pickNearbyParcels, type GpsPoint, type TerrainParcel } from './parcelFromGps';
import type { TerrainStudio } from '@/spaces/promoteur/shared/ouvrirStudio3D';
import type { AccessGate } from './accessRoutes';

export interface ConfirmedTerrain {
  parcel: TerrainParcel;
  point: GpsPoint;
  /** Equirectangular photo selected for private Studio storage after user approval. */
  panorama?: File;
  /** Relief déjà mesuré sur la parcelle confirmée, repris sans second appel dans Studio. */
  terrainData?: TerrainStudio;
  /** Georeferenced center and rotation; entry offset is measured from the local natural terrain. */
  implantation?: { lon: number; lat: number; orientationDeg: number; entryOffsetM: number };
  accesses?: AccessGate[];
}

/** The user explicitly approved sending GPS coordinates to the IGN cadastre service. */
export async function searchIgnParcels(point: GpsPoint): Promise<TerrainParcel[]> {
  const radiusLat = Math.max(0.0008, Math.min(0.0025, (point.accuracy ?? 30) / 100_000));
  const radiusLon = radiusLat / Math.max(0.35, Math.cos(point.lat * Math.PI / 180));
  const geometry = { type: 'Polygon', coordinates: [[
    [point.lon - radiusLon, point.lat - radiusLat],
    [point.lon + radiusLon, point.lat - radiusLat],
    [point.lon + radiusLon, point.lat + radiusLat],
    [point.lon - radiusLon, point.lat + radiusLat],
    [point.lon - radiusLon, point.lat - radiusLat],
  ]] };
  const params = new URLSearchParams({ geom: JSON.stringify(geometry), _limit: '500' });
  const response = await fetch(`https://apicarto.ign.fr/api/cadastre/parcelle?${params}`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('Le cadastre IGN ne répond pas. Réessayez dans un instant.');
  const data = await response.json() as FeatureCollection;
  return pickNearbyParcels(data.features ?? [], point);
}
