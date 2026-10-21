import type { TerrainStudio } from '@/spaces/promoteur/shared/ouvrirStudio3D';

export interface JarvisEarthworkEstimate {
  cutM3: number;
  fillM3: number;
  platformM: number;
  minGroundM: number;
  maxGroundM: number;
  profile: { distanceM: number; groundM: number }[];
}

/** Bilinear elevation in the measured south-to-north WGS84 grid. */
export function terrainElevationAt(terrain: TerrainStudio, lon: number, lat: number): number {
  const [west, south, east, north] = terrain.renderBounds;
  const { n, z } = terrain.grid;
  const col = Math.max(0, Math.min(n - 1, (lon - west) / (east - west) * (n - 1)));
  const row = Math.max(0, Math.min(n - 1, (lat - south) / (north - south) * (n - 1)));
  const x = Math.min(n - 2, Math.floor(col)), y = Math.min(n - 2, Math.floor(row));
  const fx = col - x, fy = row - y;
  return (z[y][x] * (1 - fx) + z[y][x + 1] * fx) * (1 - fy)
    + (z[y + 1][x] * (1 - fx) + z[y + 1][x + 1] * fx) * fy;
}

/** Preliminary rectangular-envelope estimate; Studio refines it on the true footprint. */
export function estimateJarvisEarthworks(terrain: TerrainStudio, pose: { lon: number; lat: number; orientationDeg: number; entryOffsetM: number }, widthM: number, depthM: number): JarvisEarthworkEstimate | null {
  if (!(widthM > 0 && depthM > 0 && Number.isFinite(pose.entryOffsetM))) return null;
  const platformM = terrainElevationAt(terrain, pose.lon, pose.lat) + pose.entryOffsetM;
  const a = pose.orientationDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const sample = (x: number, z: number) => {
    const east = x * c - z * s, south = x * s + z * c;
    return terrainElevationAt(terrain, pose.lon + east / (111_320 * Math.cos(pose.lat * Math.PI / 180)), pose.lat - south / 111_320);
  };
  const cols = Math.max(1, Math.min(160, Math.ceil(widthM)));
  const rows = Math.max(1, Math.min(160, Math.ceil(depthM)));
  const area = widthM * depthM / (cols * rows);
  let cutM3 = 0, fillM3 = 0, minGroundM = Infinity, maxGroundM = -Infinity;
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const ground = sample((col + 0.5) / cols * widthM - widthM / 2, (row + 0.5) / rows * depthM - depthM / 2);
    minGroundM = Math.min(minGroundM, ground); maxGroundM = Math.max(maxGroundM, ground);
    cutM3 += Math.max(0, ground - platformM) * area;
    fillM3 += Math.max(0, platformM - ground) * area;
  }
  const profile = Array.from({ length: 41 }, (_, i) => {
    const distanceM = (i / 40 - 0.5) * widthM;
    return { distanceM, groundM: sample(distanceM, 0) };
  });
  return { cutM3, fillM3, platformM, minGroundM, maxGroundM, profile };
}
