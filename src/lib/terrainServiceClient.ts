import { wgs84ToLambert93 } from "./projection";

// Configurable via .env.local (Vite). Fallback local.
const TERRAIN_URL =
  (import.meta as any)?.env?.VITE_TERRAIN_SERVICE_URL?.trim() || "http://localhost:4010";

export type ElevationPoint = { x: number; y: number };

export type ElevationResponse = {
  success: boolean;
  deptCode: string;
  elevations: Array<number | null>;
  error?: string;
  message?: string;
};

export type EnsureDepartmentResponse = {
  success: boolean;
  deptCode: string;
  urlUsed?: string;
  subResourceName?: string | null;
  archivePath?: string;
  extractedDir?: string;
  tilesCount?: number;
  error?: string;
  message?: string;
};

async function parseJsonSafe(resp: Response): Promise<any> {
  const text = await resp.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // If backend returns non-JSON, preserve raw text for debugging
    return { message: text };
  }
}

export async function ensureDepartment(deptCode: string): Promise<EnsureDepartmentResponse> {
  const resp = await fetch(`${TERRAIN_URL}/ensure-department`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deptCode }),
  });

  const json = (await parseJsonSafe(resp)) as EnsureDepartmentResponse | null;

  if (!resp.ok || !json?.success) {
    throw new Error(json?.message || json?.error || `ENSURE_DEPARTMENT_FAILED (HTTP ${resp.status})`);
  }

  return json;
}

export async function elevationLambert93(
  deptCode: string,
  points: ElevationPoint[],
): Promise<ElevationResponse> {
  const resp = await fetch(`${TERRAIN_URL}/elevation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deptCode, points }),
  });

  const json = (await parseJsonSafe(resp)) as ElevationResponse | null;

  if (!resp.ok || !json?.success) {
    throw new Error(json?.message || json?.error || `ELEVATION_FAILED (HTTP ${resp.status})`);
  }

  return json;
}

/**
 * Helper: from WGS84 lon/lat points (e.g., parcel ring) to Lambert93 points
 */
export function wgsPointsToLambert93(
  points: Array<{ lon: number; lat: number }>,
): ElevationPoint[] {
  return points.map((p) => wgs84ToLambert93(p.lon, p.lat));
}
