import type { TerrainStudio } from '@/spaces/promoteur/shared/ouvrirStudio3D';
import { terrainElevationAt } from './terrainEarthworks.ts';
import { parcelContains, type GpsPoint, type TerrainParcel } from './parcelFromGps.ts';

export type AccessKind = 'pieton' | 'vehicule';
export type AccessGate = { kind: AccessKind; lon: number; lat: number };

const meters = (origin: GpsPoint, point: GpsPoint) => ({
  x: (point.lon - origin.lon) * 111_320 * Math.cos(origin.lat * Math.PI / 180),
  z: (origin.lat - point.lat) * 111_320,
});
const gps = (origin: GpsPoint, x: number, z: number): GpsPoint => ({
  lon: origin.lon + x / (111_320 * Math.cos(origin.lat * Math.PI / 180)),
  lat: origin.lat - z / 111_320,
});

/** Snap a proposed gate to the outer cadastral edge, never to a courtyard hole. */
export function snapAccessToBoundary(parcel: TerrainParcel, click: GpsPoint): GpsPoint {
  const polygons = parcel.geometry.type === 'Polygon' ? [parcel.geometry.coordinates] : parcel.geometry.coordinates;
  let best = click, distance = Infinity;
  for (const polygon of polygons) {
    const ring = polygon[0] ?? [];
    for (let i = 1; i < ring.length; i++) {
      const a = meters(click, { lon: ring[i - 1]![0], lat: ring[i - 1]![1] });
      const b = meters(click, { lon: ring[i]![0], lat: ring[i]![1] });
      const dx = b.x - a.x, dz = b.z - a.z;
      const t = Math.max(0, Math.min(1, -(a.x * dx + a.z * dz) / (dx * dx + dz * dz || 1)));
      const x = a.x + t * dx, z = a.z + t * dz;
      const d = Math.hypot(x, z);
      if (d < distance) { distance = d; best = gps(click, x, z); }
    }
  }
  return best;
}

export interface AccessRoute {
  kind: AccessKind; gate: GpsPoint; entrance: GpsPoint; lengthM: number;
  gateElevationM: number; entranceElevationM: number; slopePercent: number;
  insideParcel: boolean;
  profile: { distanceM: number; groundM: number; pathM: number }[];
}

export function calculateAccessRoute(parcel: TerrainParcel, terrain: TerrainStudio, center: GpsPoint,
  widthM: number, depthM: number, orientationDeg: number, entryOffsetM: number, gate: AccessGate): AccessRoute {
  const q = meters(center, gate);
  const a = orientationDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const lx = q.x * c + q.z * s, lz = -q.x * s + q.z * c;
  const candidates = [
    { x: -widthM / 2, z: Math.max(-depthM / 2, Math.min(depthM / 2, lz)) },
    { x: widthM / 2, z: Math.max(-depthM / 2, Math.min(depthM / 2, lz)) },
    { x: Math.max(-widthM / 2, Math.min(widthM / 2, lx)), z: -depthM / 2 },
    { x: Math.max(-widthM / 2, Math.min(widthM / 2, lx)), z: depthM / 2 },
  ];
  const nearest = candidates.reduce((best, p) => Math.hypot(p.x - lx, p.z - lz) < Math.hypot(best.x - lx, best.z - lz) ? p : best);
  const entrance = gps(center, nearest.x * c - nearest.z * s, nearest.x * s + nearest.z * c);
  const lengthM = Math.hypot(...Object.values(meters(gate, entrance)));
  const gateElevationM = terrainElevationAt(terrain, gate.lon, gate.lat);
  const entranceElevationM = terrainElevationAt(terrain, center.lon, center.lat) + entryOffsetM;
  const steps = Math.max(2, Math.min(100, Math.ceil(lengthM)));
  const profile = Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps, lon = gate.lon + (entrance.lon - gate.lon) * t, lat = gate.lat + (entrance.lat - gate.lat) * t;
    return { distanceM: lengthM * t, groundM: terrainElevationAt(terrain, lon, lat), pathM: gateElevationM + (entranceElevationM - gateElevationM) * t };
  });
  const insideParcel = profile.slice(1, -1).every((_, i) => {
    const t = (i + 1) / steps;
    return parcelContains(parcel, { lon: gate.lon + (entrance.lon - gate.lon) * t, lat: gate.lat + (entrance.lat - gate.lat) * t });
  });
  return { kind: gate.kind, gate, entrance, lengthM, gateElevationM, entranceElevationM,
    slopePercent: lengthM > .01 ? 100 * (entranceElevationM - gateElevationM) / lengthM : 0, insideParcel, profile };
}
