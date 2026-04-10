// services/terrainSampler.ts
// Service pur d'échantillonnage du terrain — sans React, sans Three.js scene.
// Importé par MassingRenderer.tsx V8 et MassingEditor3D.tsx.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from "three";
import type { AnchorMode } from "../massingScene.types";
import type { SceneProjection } from "../massingGeometry";

// ─── ReliefData — source unique ───────────────────────────────────────────────
// Les autres fichiers (SceneSvg3D, MassingEditor3D) importent depuis ici.

export interface ReliefData {
  /** Grille d'élévations aplatie, row-major (ny * nx valeurs) */
  elevations: number[];
  nx:         number;
  ny:         number;
  minZ:       number;
  maxZ:       number;
  /** [minLng, minLat, maxLng, maxLat] en coords source */
  bbox:       [number, number, number, number];
  /** Optionnel — utilisé par SceneSvg3D uniquement */
  dx?:             number;
  dy?:             number;
  platformLevel?:  number;
}

// ─── Point scène ──────────────────────────────────────────────────────────────

/** Point dans l'espace scène (Y-up, XZ = plan horizontal) */
export interface ScenePt {
  x: number;
  z: number;
}

// ─── Lissage gaussien ─────────────────────────────────────────────────────────

export function gaussianSmooth(
  elev: number[],
  nx: number,
  ny: number,
  radius = 2,
): number[] {
  const size = radius * 2 + 1;
  const sigma = Math.max(radius / 2, 0.0001);
  const kernel: number[] = [];
  let ksum = 0;

  for (let j = -radius; j <= radius; j++) {
    for (let i = -radius; i <= radius; i++) {
      const w = Math.exp(-(i * i + j * j) / (2 * sigma * sigma));
      kernel.push(w);
      ksum += w;
    }
  }
  for (let k = 0; k < kernel.length; k++) kernel[k] /= ksum;

  const out = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      let val = 0;
      for (let dj = -radius; dj <= radius; dj++) {
        for (let di = -radius; di <= radius; di++) {
          const ni = Math.max(0, Math.min(nx - 1, i + di));
          const nj = Math.max(0, Math.min(ny - 1, j + dj));
          val += elev[nj * nx + ni] * kernel[(dj + radius) * size + (di + radius)];
        }
      }
      out[j * nx + i] = val;
    }
  }
  return Array.from(out);
}

// ─── TerrainSampler ───────────────────────────────────────────────────────────

export class TerrainSampler {
  readonly elevations: number[];
  readonly nx:         number;
  readonly ny:         number;
  readonly minZ:       number;
  readonly maxZ:       number;
  readonly bbox:       [number, number, number, number];
  readonly elevScale:  number;

  private readonly proj:  SceneProjection;
  private readonly cache = new Map<string, number>();

  constructor(reliefData: ReliefData, proj: SceneProjection) {
    this.nx   = reliefData.nx;
    this.ny   = reliefData.ny;
    this.minZ = reliefData.minZ;
    this.maxZ = reliefData.maxZ;
    this.bbox = reliefData.bbox;
    this.proj = proj;

    // Facteur de conversion altitude → unités scène
    const [bx0, , bx1] = reliefData.bbox;
    const isGeo = Math.max(Math.abs(bx0), Math.abs(bx1)) <= 180
      && (bx1 - bx0) < 10;
    const mPerUnit = isGeo ? 111_000 : 1;
    this.elevScale = proj.scale / mPerUnit;

    // Lissage adaptatif selon l'amplitude de relief
    const dZ     = Math.max(0.5, reliefData.maxZ - reliefData.minZ);
    const passes = dZ < 10 ? 3 : dZ < 30 ? 2 : 1;
    let elev     = reliefData.elevations.slice();
    for (let p = 0; p < passes; p++) {
      elev = gaussianSmooth(elev, this.nx, this.ny, 3);
    }
    this.elevations = elev;
  }

  /** Hauteur terrain en unités scène au point (sceneX, sceneZ) */
  getHeight(sceneX: number, sceneZ: number): number {
    const key = `${sceneX.toFixed(2)},${sceneZ.toFixed(2)}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const h = this._sample(sceneX, sceneZ);
    this.cache.set(key, h);
    return h;
  }

  /** Échantillonner un tableau de ScenePt */
  samplePts(pts: ScenePt[]): number[] {
    return pts.map(p => this.getHeight(p.x, p.z));
  }

  /** Amplitude de relief brute (unités source) */
  getDeltaZ(): number {
    return Math.max(0, this.maxZ - this.minZ);
  }

  getElevScale(): number {
    return this.elevScale;
  }

  /**
   * Retourne la hauteur scène à utiliser comme platformY selon le mode d'ancrage.
   */
  getAnchorHeight(pts: ScenePt[], mode: AnchorMode = "footprint-avg"): number {
    if (!pts.length) return 0;
    const sample  = buildSamplePts(pts);
    const heights = this.samplePts(sample);
    if (!heights.length) return 0;

    switch (mode) {
      case "footprint-min": return Math.min(...heights);
      case "footprint-max": return Math.max(...heights);
      case "centroid": {
        const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
        const cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
        return this.getHeight(cx, cz);
      }
      case "footprint-avg":
      default:
        return heights.reduce((s, v) => s + v, 0) / heights.length;
    }
  }

  private _sample(sceneX: number, sceneZ: number): number {
    const { nx, ny, minZ, bbox, proj, elevations, elevScale } = this;
    const [bx0, by0, bx1, by1] = bbox;

    const lon = sceneX / proj.scale + proj.cx;
    const lat = sceneZ / proj.scale + proj.cy;

    const u  = clamp((lon - bx0) / Math.max(bx1 - bx0, 1e-9), 0, 1);
    const v  = clamp((lat - by0) / Math.max(by1 - by0, 1e-9), 0, 1);
    const fi = u * (nx - 1);
    const fj = v * (ny - 1);

    const i0 = Math.min(nx - 2, Math.max(0, Math.floor(fi)));
    const j0 = Math.min(ny - 2, Math.max(0, Math.floor(fj)));
    const fu  = fi - i0;
    const fv  = fj - j0;

    const z00 = elevations[j0 * nx + i0]           ?? minZ;
    const z10 = elevations[j0 * nx + i0 + 1]       ?? minZ;
    const z01 = elevations[(j0 + 1) * nx + i0]     ?? minZ;
    const z11 = elevations[(j0 + 1) * nx + i0 + 1] ?? minZ;

    const elev =
      z00 * (1 - fu) * (1 - fv) +
      z10 * fu       * (1 - fv) +
      z01 * (1 - fu) * fv       +
      z11 * fu       * fv;

    return (elev - minZ) * elevScale;
  }
}

// ─── anchorObjectOnTerrain ────────────────────────────────────────────────────

/**
 * Pose un Object3D sur le terrain en ajustant position.y.
 * Compatible avec ScenePt {x, z} OU Pt2D {x, z} locaux de MassingRenderer.
 */
export function anchorObjectOnTerrain(
  object: THREE.Object3D,
  sampler: TerrainSampler,
  pts: ScenePt[],
  mode: AnchorMode = "footprint-avg",
  clearance = 0,
): void {
  if (!pts.length) return;

  object.position.y = 0;
  object.updateMatrixWorld(true);
  const box     = new THREE.Box3().setFromObject(object);
  const bboxMinY = box.isEmpty() ? 0 : box.min.y;

  const terrainY = sampler.getAnchorHeight(pts, mode);
  object.position.y = terrainY - bboxMinY + clearance;
}

// ─── Helpers internes ─────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Centroïde + sommets + milieux d'arêtes pour un échantillonnage dense */
function buildSamplePts(pts: ScenePt[]): ScenePt[] {
  if (!pts.length) return [];
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
  const result: ScenePt[] = [{ x: cx, z: cz }, ...pts];
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    result.push({
      x: (pts[i].x + pts[j].x) / 2,
      z: (pts[i].z + pts[j].z) / 2,
    });
  }
  return result;
}