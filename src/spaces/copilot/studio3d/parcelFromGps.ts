import type { Feature, Polygon, MultiPolygon } from 'geojson';

export type TerrainParcel = Feature<Polygon | MultiPolygon> & { properties: Record<string, unknown> };
export type GpsPoint = { lat: number; lon: number; accuracy?: number };

function ringContains(ring: number[][], lon: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (!a || !b) continue;
    if ((a[1] > lat) !== (b[1] > lat) && lon < (b[0] - a[0]) * (lat - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export function parcelContains(parcel: TerrainParcel, point: GpsPoint): boolean {
  const polygons = parcel.geometry.type === 'Polygon' ? [parcel.geometry.coordinates] : parcel.geometry.coordinates;
  return polygons.some(rings => rings.length > 0 && ringContains(rings[0] as number[][], point.lon, point.lat)
    && !rings.slice(1).some(hole => ringContains(hole as number[][], point.lon, point.lat)));
}

/** Bounding footprint, sampled along its edges so a concave parcel or hole cannot be crossed silently. */
export function footprintPoints(center: GpsPoint, widthM: number, depthM: number, orientationDeg: number): GpsPoint[] {
  const a = orientationDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const corners = [[-widthM / 2, -depthM / 2], [widthM / 2, -depthM / 2], [widthM / 2, depthM / 2], [-widthM / 2, depthM / 2]];
  const result: GpsPoint[] = [];
  for (let edge = 0; edge < 4; edge++) {
    const start = corners[edge]!, end = corners[(edge + 1) % 4]!;
    const steps = Math.max(1, Math.ceil(Math.hypot(end[0] - start[0], end[1] - start[1])));
    for (let i = 0; i < steps; i++) {
      const f = i / steps, x = start[0] + (end[0] - start[0]) * f, z = start[1] + (end[1] - start[1]) * f;
      const east = x * c - z * s, south = x * s + z * c;
      result.push({ lon: center.lon + east / (111_320 * Math.cos(center.lat * Math.PI / 180)), lat: center.lat - south / 111_320 });
    }
  }
  return result;
}

export function footprintFits(parcel: TerrainParcel, center: GpsPoint, widthM: number, depthM: number, orientationDeg: number): boolean {
  return parcelContains(parcel, center) && footprintPoints(center, widthM, depthM, orientationDeg).every(p => parcelContains(parcel, p));
}

export function parcelCenter(parcel: TerrainParcel): GpsPoint {
  const polygon = parcel.geometry.type === 'Polygon' ? parcel.geometry.coordinates : parcel.geometry.coordinates[0];
  const ring = polygon?.[0] ?? [];
  const points = ring.slice(0, -1);
  const basis = points.length ? points : ring;
  return { lon: basis.reduce((sum, value) => sum + value[0], 0) / (basis.length || 1),
    lat: basis.reduce((sum, value) => sum + value[1], 0) / (basis.length || 1) };
}

export function parcelDistanceMeters(parcel: TerrainParcel, point: GpsPoint): number {
  if (parcelContains(parcel, point)) return 0;
  const center = parcelCenter(parcel);
  const dy = (center.lat - point.lat) * 111_320;
  const dx = (center.lon - point.lon) * 111_320 * Math.cos(point.lat * Math.PI / 180);
  return Math.hypot(dx, dy);
}

/** Shortest planimetric distance from the GPS point to a cadastral boundary. */
export function parcelBoundaryDistanceMeters(parcel: TerrainParcel, point: GpsPoint): number {
  const polygons = parcel.geometry.type === 'Polygon' ? [parcel.geometry.coordinates] : parcel.geometry.coordinates;
  const scaleX = 111_320 * Math.cos(point.lat * Math.PI / 180);
  const scaleY = 111_320;
  let shortest = Infinity;
  for (const polygon of polygons) for (const ring of polygon) for (let index = 1; index < ring.length; index++) {
    const start = ring[index - 1], end = ring[index];
    const ax = (start[0] - point.lon) * scaleX, ay = (start[1] - point.lat) * scaleY;
    const bx = (end[0] - point.lon) * scaleX, by = (end[1] - point.lat) * scaleY;
    const dx = bx - ax, dy = by - ay;
    const fraction = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    shortest = Math.min(shortest, Math.hypot(ax + fraction * dx, ay + fraction * dy));
  }
  return shortest;
}

export function parcelLabel(parcel: TerrainParcel): string {
  const p = parcel.properties;
  const section = String(p.section ?? p.SECTION ?? '').trim();
  const number = String(p.numero ?? p.NUMERO ?? '').trim();
  return section && number ? `${section} ${number}` : String(p.id ?? p.idu ?? p.parcel_id ?? 'Parcelle sans référence');
}

export function parcelId(parcel: TerrainParcel): string {
  const p = parcel.properties;
  const id = p.idu ?? p.parcel_id ?? p.id;
  return typeof id === 'string' && id.trim() ? id.trim() : parcelLabel(parcel);
}

export function pickNearbyParcels(features: unknown[], point: GpsPoint, max = 8): TerrainParcel[] {
  return features.filter((item): item is TerrainParcel => {
    const f = item as Partial<TerrainParcel>;
    return f?.type === 'Feature' && (f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon')
      && Array.isArray(f.geometry.coordinates);
  }).sort((a, b) => parcelDistanceMeters(a, point) - parcelDistanceMeters(b, point)).slice(0, max);
}
