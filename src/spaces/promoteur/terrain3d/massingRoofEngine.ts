// massingRoofEngine.ts — V3.1
// Retour à computeVertexNormals() simple, mais avec correction d’orientation
// des triangles/quads de toiture pour éviter les normales inversées.
// Projection ridge : V2.7 (ridgeDist sur droite infinie, classification correcte)

import * as THREE from "three";
import type { Pt2D } from "./massingGeometry3d";
import { ptsToShape, aabb2D, extractEdges, insetPolygon, centroid2D } from "./massingGeometry3d";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES PUBLICS
// ═══════════════════════════════════════════════════════════════════════════════

export type RoofType = "terrasse" | "vegetalise" | "inclinee";

export interface DormerSpec {
  enabled: boolean;
  count: number;
  widthFactor: number;
  heightFactor: number;
}

export interface RoofConfig {
  topPts: Pt2D[];
  roofBaseY: number;
  floorHeight: number;
  totalFloors: number;
  roofType: RoofType;
  roofSlopes: number;
  acrotereHeight?: number;
  overhangM?: number;
  dormers?: DormerSpec;
}

export interface RoofResult {
  acrotere: THREE.BufferGeometry[];
  roofSurface: THREE.BufferGeometry[];
  roofCap: THREE.BufferGeometry[];
  edicule: THREE.BufferGeometry[];
  dormerGlass: THREE.BufferGeometry[];
}

// Types internes niveau module
interface SlopeData {
  eaveA: Pt2D;
  eaveB: Pt2D;
  ridgeA: Pt2D;
  ridgeB: Pt2D;
  edgeNx: number;
  edgeNy: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTES
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULT_ACROTERE_H = 0.40;
const ACROTERE_THICKNESS = 0.12;
const EDICULE_SIZE = 1.50;
const EDICULE_HEIGHT = 1.80;
const FASCIA_H = 0.18;
const DORMER_SLOPE_T = 0.18;
const DORMER_MINI_RIDGE = 0.28;

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS — normales / orientation
// ═══════════════════════════════════════════════════════════════════════════════

function orientTriUp(pos: number[]): number[] {
  if (pos.length !== 9) return pos;

  const ax = pos[0], ay = pos[1], az = pos[2];
  const bx = pos[3], by = pos[4], bz = pos[5];
  const cx = pos[6], cy = pos[7], cz = pos[8];

  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;

  const acx = cx - ax;
  const acy = cy - ay;
  const acz = cz - az;

  // composante Y de AB x AC
  const ny = abz * acx - abx * acz;

  // Si la normale pointe vers le bas, on inverse B et C
  if (ny < 0) {
    return [
      ax, ay, az,
      cx, cy, cz,
      bx, by, bz,
    ];
  }

  return pos;
}

function geo(pos: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function geoN(pos: number[], nrm: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  return g;
}

function tri(pos: number[]): THREE.BufferGeometry {
  return geo(orientTriUp(pos));
}

function quad(pos: number[]): THREE.BufferGeometry {
  const t1 = orientTriUp([
    pos[0], pos[1], pos[2],
    pos[3], pos[4], pos[5],
    pos[6], pos[7], pos[8],
  ]);

  const t2 = orientTriUp([
    pos[0], pos[1], pos[2],
    pos[6], pos[7], pos[8],
    pos[9], pos[10], pos[11],
  ]);

  return geo([...t1, ...t2]);
}

function wallQ(
  x0: number, z0: number,
  x1: number, z1: number,
  yBot: number, yTop: number,
  nx: number, nz: number,
): THREE.BufferGeometry {
  return geoN(
    [
      x0, yBot, z0,
      x1, yBot, z1,
      x1, yTop, z1,

      x0, yBot, z0,
      x1, yTop, z1,
      x0, yTop, z0,
    ],
    [
      nx, 0, nz,
      nx, 0, nz,
      nx, 0, nz,

      nx, 0, nz,
      nx, 0, nz,
      nx, 0, nz,
    ],
  );
}

function edgeN(a: Pt2D, b: Pt2D): [number, number] {
  const dx = b.x - a.x;
  const dz = b.y - a.y;
  const l = Math.hypot(dx, dz);
  return l > 1e-8 ? [dz / l, -dx / l] : [0, 0];
}

function expandPoly(pts: Pt2D[], amount: number): Pt2D[] {
  if (amount <= 0 || pts.length < 3) return pts.slice();
  const edges = extractEdges(pts);
  const n = pts.length;

  return pts.map((pt, i) => {
    const e0 = edges[(i - 1 + n) % n];
    const e1 = edges[i];
    if (!e0 || !e1) return { x: pt.x, y: pt.y };

    const bx = e0.nx + e1.nx;
    const by = e0.ny + e1.ny;
    const bl = Math.hypot(bx, by);

    if (bl < 0.15) {
      return { x: pt.x + e1.nx * amount, y: pt.y + e1.ny * amount };
    }

    const m = Math.min((amount * 2) / bl, amount * 4);
    return {
      x: pt.x + (bx / bl) * m,
      y: pt.y + (by / bl) * m,
    };
  });
}

function lerp2(a: Pt2D, b: Pt2D, t: number): Pt2D {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function empty(): RoofResult {
  return {
    acrotere: [],
    roofSurface: [],
    roofCap: [],
    edicule: [],
    dormerGlass: [],
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// AXE DE FAÎTAGE — plus longue arête réelle (rotation-agnostique)
// ═══════════════════════════════════════════════════════════════════════════════

interface RidgeAxis {
  rdx: number;
  rdz: number;
  cx: number;
  cy: number;
  halfLen: number;
}

function ridgeAxis(topPts: Pt2D[], overhang: number): RidgeAxis {
  const n = topPts.length;
  let best = -1;
  let rdx = 1;
  let rdz = 0;

  for (let i = 0; i < n; i++) {
    const a = topPts[i];
    const b = topPts[(i + 1) % n];
    const dx = b.x - a.x;
    const dz = b.y - a.y;
    const l = Math.hypot(dx, dz);
    if (l > best) {
      best = l;
      rdx = dx / l;
      rdz = dz / l;
    }
  }

  let cx = 0;
  let cy = 0;
  for (const p of topPts) {
    cx += p.x;
    cy += p.y;
  }
  cx /= n;
  cy /= n;

  let minA = Infinity;
  let maxA = -Infinity;
  for (const p of topPts) {
    const a = (p.x - cx) * rdx + (p.y - cy) * rdz;
    if (a < minA) minA = a;
    if (a > maxA) maxA = a;
  }

  return {
    rdx,
    rdz,
    cx,
    cy,
    halfLen: (maxA - minA) * 0.5 + overhang,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════════

export function buildRoofGeometry(config: RoofConfig): RoofResult {
  try {
    if (!config?.topPts || config.topPts.length < 3) return empty();

    const result = empty();
    const acroH = config.acrotereHeight ?? DEFAULT_ACROTERE_H;
    const overhang = Math.max(0, config.overhangM ?? 0);
    const eavePts = overhang > 0 ? expandPoly(config.topPts, overhang) : config.topPts.slice();

    if (config.roofType !== "inclinee") {
      try {
        result.acrotere.push(...buildAcrotere(config.topPts, config.roofBaseY, acroH));
      } catch (e) {
        console.warn("[roof]acrotere", e);
      }

      try {
        result.roofSurface.push(buildFlatCap(config.topPts, config.roofBaseY + acroH + 0.05));
      } catch (e) {
        console.warn("[roof]flatCap", e);
      }

      if (config.totalFloors >= 3) {
        try {
          result.edicule.push(...buildEdicule(config.topPts, config.roofBaseY + acroH));
        } catch (e) {
          console.warn("[roof]edicule", e);
        }
      }
    } else {
      if (overhang > 0) {
        try {
          buildFascia(eavePts, config.roofBaseY, result);
        } catch (e) {
          console.warn("[roof]fascia", e);
        }
      } else {
        try {
          result.acrotere.push(...buildAcrotere(config.topPts, config.roofBaseY, acroH * 0.5));
        } catch (e) {
          console.warn("[roof]acrotere-half", e);
        }
      }

      try {
        buildInclined(config, eavePts, overhang, result);
      } catch (e) {
        console.error("[roof]inclined CRASH:", e);
        try {
          result.roofSurface.push(buildFlatCap(config.topPts, config.roofBaseY + 0.05));
        } catch {
          // noop
        }
      }
    }

    return result;
  } catch (e) {
    console.error("[roof]global crash", e);
    return empty();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOIT PLAT
// ═══════════════════════════════════════════════════════════════════════════════

function buildAcrotere(pts: Pt2D[], baseY: number, h: number): THREE.BufferGeometry[] {
  if (pts.length < 3 || h <= 0) return [];

  const geos: THREE.BufferGeometry[] = [];
  const n = pts.length;

  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const [nx, ny] = edgeN(a, b);

    geos.push(wallQ(a.x, a.y, b.x, b.y, baseY, baseY + h, nx, ny));

    const ia = { x: a.x - nx * ACROTERE_THICKNESS, y: a.y - ny * ACROTERE_THICKNESS };
    const ib = { x: b.x - nx * ACROTERE_THICKNESS, y: b.y - ny * ACROTERE_THICKNESS };
    geos.push(wallQ(ib.x, ib.y, ia.x, ia.y, baseY, baseY + h, -nx, -ny));
  }

  try {
    const inner = insetPolygon(pts, ACROTERE_THICKNESS);
    if (inner?.length >= 3) {
      const pos: number[] = [];
      const nrm: number[] = [];
      const m = Math.min(pts.length, inner.length);

      for (let i = 0; i < m; i++) {
        const j = (i + 1) % m;
        const o0 = pts[i];
        const o1 = pts[j];
        const i0 = inner[i];
        const i1 = inner[j];

        pos.push(
          o0.x, baseY + h, o0.y,
          o1.x, baseY + h, o1.y,
          i1.x, baseY + h, i1.y,

          o0.x, baseY + h, o0.y,
          i1.x, baseY + h, i1.y,
          i0.x, baseY + h, i0.y,
        );

        for (let k = 0; k < 6; k++) nrm.push(0, 1, 0);
      }

      if (pos.length > 0) geos.push(geoN(pos, nrm));
    }
  } catch (e) {
    console.warn("[roof]topCap", e);
  }

  return geos;
}

function buildFlatCap(pts: Pt2D[], y: number): THREE.BufferGeometry {
  const g = new THREE.ShapeGeometry(ptsToShape(pts));
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  g.computeVertexNormals();
  return g;
}

function buildEdicule(pts: Pt2D[], roofY: number): THREE.BufferGeometry[] {
  const c = centroid2D(pts);
  const bb = aabb2D(pts);
  const size = Math.min(EDICULE_SIZE, bb.w * 0.15, bb.h * 0.15);
  if (size < 0.3) return [];

  const g = new THREE.BoxGeometry(size, EDICULE_HEIGHT, size * 0.6);
  g.translate(c.x, roofY + EDICULE_HEIGHT / 2, c.y);
  return [g];
}

// ═══════════════════════════════════════════════════════════════════════════════
// FASCIA
// ═══════════════════════════════════════════════════════════════════════════════

function buildFascia(eavePts: Pt2D[], baseY: number, result: RoofResult): void {
  const n = eavePts.length;
  if (n < 3) return;

  for (let i = 0; i < n; i++) {
    const a = eavePts[i];
    const b = eavePts[(i + 1) % n];
    const [nx, ny] = edgeN(a, b);
    result.acrotere.push(wallQ(a.x, a.y, b.x, b.y, baseY - FASCIA_H, baseY, nx, ny));
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DISPATCH
// ═══════════════════════════════════════════════════════════════════════════════

function buildInclined(
  config: RoofConfig,
  eavePts: Pt2D[],
  overhang: number,
  result: RoofResult,
): void {
  if (eavePts.length < 3 || config.topPts.length < 3) return;

  const acroH = overhang > 0 ? 0 : (config.acrotereHeight ?? DEFAULT_ACROTERE_H) * 0.5;
  const baseY = config.roofBaseY + acroH;
  const ridgeH = Math.max(1.2, (config.floorHeight ?? 3) * 0.75);

  switch (config.roofSlopes) {
    case 1:
      buildShed(eavePts, config.topPts, baseY, ridgeH, result);
      break;
    case 4:
      buildHip(eavePts, config.topPts, baseY, ridgeH, result);
      break;
    case 2:
    default:
      buildGable(eavePts, config.topPts, baseY, ridgeH, overhang, config.dormers, result);
      break;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PIGNON (2 PENTES)
// ═══════════════════════════════════════════════════════════════════════════════

function buildGable(
  eavePts: Pt2D[],
  topPts: Pt2D[],
  baseY: number,
  ridgeH: number,
  overhang: number,
  dormers: DormerSpec | undefined,
  result: RoofResult,
): void {
  const ridgeY = baseY + ridgeH;
  const ax = ridgeAxis(topPts, overhang);
  const { rdx, rdz, cx, cy, halfLen } = ax;
  const nE = eavePts.length;
  const nT = topPts.length;
  const pignonThresh = Math.max(halfLen * 0.15, 0.3);
  const longSides: SlopeData[] = [];

  for (let i = 0; i < nE; i++) {
    try {
      const eA = eavePts[i];
      const eB = eavePts[(i + 1) % nE];
      const tA = topPts[i % nT];
      const tB = topPts[(i + 1) % nT];

      if (
        !Number.isFinite(eA.x) || !Number.isFinite(eA.y) ||
        !Number.isFinite(eB.x) || !Number.isFinite(eB.y)
      ) {
        continue;
      }

      const pA = (eA.x - cx) * rdx + (eA.y - cy) * rdz;
      const pB = (eB.x - cx) * rdx + (eB.y - cy) * rdz;
      const rAx = cx + pA * rdx;
      const rAz = cy + pA * rdz;
      const rBx = cx + pB * rdx;
      const rBz = cy + pB * rdz;
      const rDist = Math.hypot(rBx - rAx, rBz - rAz);

      const [enx, enz] = edgeN(eA, eB);

      if (rDist < pignonThresh) {
        const apX = (rAx + rBx) * 0.5;
        const apZ = (rAz + rBz) * 0.5;
        if (!Number.isFinite(apX) || !Number.isFinite(apZ)) continue;

        result.roofSurface.push(
          tri([
            eA.x, baseY, eA.y,
            eB.x, baseY, eB.y,
            apX, ridgeY, apZ,
          ]),
        );

        result.roofCap.push(
          tri([
            tA.x, baseY, tA.y,
            tB.x, baseY, tB.y,
            apX, ridgeY, apZ,
          ]),
        );

        if (overhang > 0) {
          result.roofCap.push(
            quad([
              tA.x, baseY, tA.y,
              tB.x, baseY, tB.y,
              eB.x, baseY, eB.y,
              eA.x, baseY, eA.y,
            ]),
          );
        }
      } else {
        if (
          !Number.isFinite(rAx) || !Number.isFinite(rAz) ||
          !Number.isFinite(rBx) || !Number.isFinite(rBz)
        ) {
          continue;
        }

        result.roofSurface.push(
          quad([
            eA.x, baseY, eA.y,
            eB.x, baseY, eB.y,
            rBx, ridgeY, rBz,
            rAx, ridgeY, rAz,
          ]),
        );

        if (overhang > 0) {
          result.roofCap.push(
            quad([
              eA.x, baseY, eA.y,
              eB.x, baseY, eB.y,
              tB.x, baseY, tB.y,
              tA.x, baseY, tA.y,
            ]),
          );
        }

        longSides.push({
          eaveA: eA,
          eaveB: eB,
          ridgeA: { x: rAx, y: rAz },
          ridgeB: { x: rBx, y: rBz },
          edgeNx: enx,
          edgeNy: enz,
        });
      }
    } catch (e) {
      console.warn(`[roof]gable edge ${i}`, e);
    }
  }

  if (dormers?.enabled && longSides.length > 0) {
    for (const s of longSides) {
      try {
        addDormers(s, baseY, ridgeY, ridgeH, dormers, result);
      } catch (e) {
        console.warn("[roof]dormer", e);
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHIENS ASSIS
// ═══════════════════════════════════════════════════════════════════════════════

function addDormers(
  slope: SlopeData,
  baseY: number,
  ridgeY: number,
  ridgeH: number,
  spec: DormerSpec,
  result: RoofResult,
): void {
  const { eaveA, eaveB, ridgeA, ridgeB, edgeNx, edgeNy } = slope;
  const slopeW = Math.hypot(eaveB.x - eaveA.x, eaveB.y - eaveA.y);
  if (slopeW < 3) return;

  const count = Math.max(1, Math.round(spec.count));
  const dHW = Math.min(slopeW * spec.widthFactor * 0.5, slopeW / (count * 2.5));
  const dormerH = ridgeH * Math.max(0.25, Math.min(0.65, spec.heightFactor));
  const miniRH = dormerH * DORMER_MINI_RIDGE;
  const li = 1 / Math.max(slopeW, 0.01);
  const aX = (eaveB.x - eaveA.x) * li;
  const aZ = (eaveB.y - eaveA.y) * li;

  for (let di = 0; di < count; di++) {
    const t = (di + 0.5) / count;
    const ec = lerp2(eaveA, eaveB, t);
    const rc = lerp2(ridgeA, ridgeB, t);

    const fbcX = ec.x + DORMER_SLOPE_T * (rc.x - ec.x);
    const fbcZ = ec.y + DORMER_SLOPE_T * (rc.y - ec.y);
    const fbcY = baseY + DORMER_SLOPE_T * (ridgeY - baseY);
    const ftY = fbcY + dormerH;

    if (ftY >= ridgeY - 0.3) continue;

    const BLx = fbcX - aX * dHW;
    const BLz = fbcZ - aZ * dHW;
    const BRx = fbcX + aX * dHW;
    const BRz = fbcZ + aZ * dHW;
    const rPX = (BLx + BRx) * 0.5;
    const rPZ = (BLz + BRz) * 0.5;
    const rPY = ftY + miniRH;

    if (!Number.isFinite(BLx + BLz + BRx + BRz + rPX + rPZ + rPY)) continue;

    const sT = (ftY - baseY) / Math.max(0.01, ridgeY - baseY);
    const tL = Math.max(0, t - dHW / slopeW);
    const tR = Math.min(1, t + dHW / slopeW);
    const ecL = lerp2(eaveA, eaveB, tL);
    const rcL = lerp2(ridgeA, ridgeB, tL);
    const ecR = lerp2(eaveA, eaveB, tR);
    const rcR = lerp2(ridgeA, ridgeB, tR);
    const bkLx = ecL.x + sT * (rcL.x - ecL.x);
    const bkLz = ecL.y + sT * (rcL.y - ecL.y);
    const bkRx = ecR.x + sT * (rcR.x - ecR.x);
    const bkRz = ecR.y + sT * (rcR.y - ecR.y);

    result.roofCap.push(
      quad([
        BLx, fbcY, BLz,
        BRx, fbcY, BRz,
        BRx, ftY, BRz,
        BLx, ftY, BLz,
      ]),
    );

    result.roofCap.push(
      tri([
        BLx, ftY, BLz,
        BRx, ftY, BRz,
        rPX, rPY, rPZ,
      ]),
    );

    result.roofSurface.push(
      tri([
        BLx, ftY, BLz,
        rPX, rPY, rPZ,
        bkLx, ftY, bkLz,
      ]),
    );

    result.roofSurface.push(
      tri([
        BRx, ftY, BRz,
        bkRx, ftY, bkRz,
        rPX, rPY, rPZ,
      ]),
    );

    result.roofCap.push(
      tri([
        BLx, fbcY, BLz,
        BLx, ftY, BLz,
        bkLx, ftY, bkLz,
      ]),
    );

    result.roofCap.push(
      tri([
        BRx, fbcY, BRz,
        bkRx, ftY, bkRz,
        BRx, ftY, BRz,
      ]),
    );

    const gInset = dHW * 0.28;
    const gBot = fbcY + dormerH * 0.18;
    const gTop = ftY - dormerH * 0.12;

    if (gTop > gBot + 0.1) {
      const ox = edgeNx * 0.06;
      const oz = edgeNy * 0.06;
      result.dormerGlass.push(
        quad([
          BLx + aX * gInset + ox, gBot, BLz + aZ * gInset + oz,
          BRx - aX * gInset + ox, gBot, BRz - aZ * gInset + oz,
          BRx - aX * gInset + ox, gTop, BRz - aZ * gInset + oz,
          BLx + aX * gInset + ox, gTop, BLz + aZ * gInset + oz,
        ]),
      );
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HIP ROOF (4 PENTES)
// ═══════════════════════════════════════════════════════════════════════════════

function buildHip(
  eavePts: Pt2D[],
  topPts: Pt2D[],
  baseY: number,
  ridgeH: number,
  result: RoofResult,
): void {
  if (eavePts.length < 3) return;

  const c = centroid2D(topPts);
  const ridgeY = baseY + ridgeH;

  for (let i = 0; i < eavePts.length; i++) {
    const a = eavePts[i];
    const b = eavePts[(i + 1) % eavePts.length];
    result.roofSurface.push(
      tri([
        a.x, baseY, a.y,
        b.x, baseY, b.y,
        c.x, ridgeY, c.y,
      ]),
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHED ROOF (1 PENTE)
// ═══════════════════════════════════════════════════════════════════════════════

function buildShed(
  eavePts: Pt2D[],
  topPts: Pt2D[],
  baseY: number,
  ridgeH: number,
  result: RoofResult,
): void {
  if (eavePts.length < 3 || topPts.length < 3) return;

  const edges = extractEdges(topPts);
  if (!edges?.length) return;

  const be = [...edges].sort((a, b) => b.length - a.length)[0];
  if (!be) return;

  const bb = aabb2D(topPts);
  const maxD = Math.max(bb.w, bb.h, 0.01);
  const c = centroid2D(topPts);

  for (let i = 0; i < eavePts.length; i++) {
    const p0 = eavePts[i];
    const p1 = eavePts[(i + 1) % eavePts.length];
    const h0 = shedH(p0.x, p0.y, be.mx, be.my, be.nx, be.ny, maxD, ridgeH);
    const h1 = shedH(p1.x, p1.y, be.mx, be.my, be.nx, be.ny, maxD, ridgeH);
    const hc = shedH(c.x, c.y, be.mx, be.my, be.nx, be.ny, maxD, ridgeH);

    result.roofSurface.push(
      tri([
        p0.x, baseY + h0, p0.y,
        p1.x, baseY + h1, p1.y,
        c.x, baseY + hc, c.y,
      ]),
    );
  }
}

function shedH(
  px: number,
  py: number,
  mx: number,
  my: number,
  nx: number,
  ny: number,
  maxD: number,
  maxH: number,
): number {
  return Math.max(0, ((px - mx) * nx + (py - my) * ny) / maxD) * maxH;
}