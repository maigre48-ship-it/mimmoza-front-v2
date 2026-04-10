// SceneSvg3D.tsx — Three.js architectural renderer v4.1
// ─────────────────────────────────────────────────────────────────────────────
// v4.1 vs v4 :
// - ReliefData n'est plus définie localement : elle est importée et étendue
//   depuis services/terrainSampler (source unique).
// - Re-exportée pour les fichiers qui importaient depuis SceneSvg3D.
// - Suppression des champs dx/dy jamais utilisés dans le code.
// - Aucune autre modification comportementale.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Feature, FeatureCollection, Polygon, MultiPolygon, Position } from "geojson";

// ReliefData — source unique dans services/terrainSampler
import type { ReliefData as BaseReliefData } from "../services/terrainSampler";

// ─── Types publics ────────────────────────────────────────────────────────────

/**
 * Extension de ReliefData pour SceneSvg3D.
 * - platformLevel : altitude de plateforme pré-calculée (optionnel)
 * - dx/dy conservés en signature pour compatibilité ascendante, mais inutilisés.
 * Re-exporté pour les imports existants depuis ce fichier.
 */
export interface ReliefData extends BaseReliefData {
  dx?:             number;
  dy?:             number;
  platformLevel?:  number;
}

// Re-export explicite — les fichiers qui font `import type { ReliefData } from "./SceneSvg3D"`
// continuent de fonctionner sans modification.
export type { ReliefData };

export type FacadeStyle = "beton" | "vitrage" | "brique" | "zinc" | "bois";
export type RoofStyle   = "terrasse" | "vegetalise" | "inclinee";

export interface BuildingStyleOptions {
  facade:        FacadeStyle;
  roof:          RoofStyle;
  structureColor: string;
  windowRatio:   number;
  bayWidthM:     number;
  hasBalconies:  boolean;
  balconyFreq:   number;
  hasBanding:    boolean;
  hasCorner:     boolean;
  numSetbacks:   number;
}

type Props = {
  parcel?:          Feature<Polygon | MultiPolygon>;
  buildings?:       FeatureCollection<Polygon>;
  parkings?:        FeatureCollection<Polygon>;
  showTerrain:      boolean;
  showBuildings:    boolean;
  showParkings:     boolean;
  showWireframe?:   boolean;
  reliefData?:      ReliefData | null;
  buildingHeightM?: number;
  buildingStyle?:   BuildingStyleOptions;
};

interface ThreeCtx {
  renderer:       THREE.WebGLRenderer;
  camera:         THREE.PerspectiveCamera;
  controls:       OrbitControls;
  scene:          THREE.Scene;
  sceneGroup:     THREE.Group;
  labelContainer: HTMLDivElement;
  rafId:          number;
}

// ─── Geo ──────────────────────────────────────────────────────────────────────

type Pt = [number, number];

function ringFromParcel(f?: Feature<Polygon | MultiPolygon>): Position[] | null {
  const g = f?.geometry; if (!g) return null;
  return g.type === "Polygon" ? g.coordinates?.[0] ?? null : g.coordinates?.[0]?.[0] ?? null;
}
function ringFromPoly(f: any): Position[] | null {
  return f?.geometry?.type === "Polygon" ? f.geometry.coordinates?.[0] ?? null : null;
}
function bboxRings(rings: Position[][]): [number, number, number, number] | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings) for (const p of r) {
    if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
  }
  return x0 === Infinity ? null : [x0, y0, x1, y1];
}

// ─── Scene math ───────────────────────────────────────────────────────────────

function ptsToShape(pts: Pt[]): THREE.Shape {
  const s = new THREE.Shape();
  pts.forEach(([x, y], i) => i === 0 ? s.moveTo(x, y) : s.lineTo(x, y));
  s.closePath();
  return s;
}
function scalePts(pts: Pt[], f: number): Pt[] {
  let cx = 0, cy = 0;
  for (const [x, y] of pts) { cx += x; cy += y; }
  cx /= pts.length; cy /= pts.length;
  return pts.map(([x, y]) => [cx + (x - cx) * f, cy + (y - cy) * f]);
}
function centroidPts(pts: Pt[]): Pt {
  let cx = 0, cy = 0;
  for (const [x, y] of pts) { cx += x; cy += y; }
  return [cx / pts.length, cy / pts.length];
}
function areaPts(pts: Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
  }
  return Math.abs(a) / 2;
}

// ─── Elevation color ──────────────────────────────────────────────────────────

function elevColor(t: number): [number, number, number] {
  t = Math.max(0, Math.min(1, t));
  if (t < 0.25) { const s = t / 0.25;        return [0.13 + s * 0.30, 0.47 + s * 0.30, 0.24]; }
  if (t < 0.50) { const s = (t - 0.25) / 0.25; return [0.43 + s * 0.37, 0.77 - s * 0.25, 0.19]; }
  if (t < 0.75) { const s = (t - 0.50) / 0.25; return [0.80 + s * 0.12, 0.52 - s * 0.25, 0.14]; }
  const s = (t - 0.75) / 0.25;
  return [0.92, 0.27 - s * 0.10, 0.14 + s * 0.06];
}

// ─── Sky background ───────────────────────────────────────────────────────────

function makeSkyTexture(): THREE.CanvasTexture {
  const W = 2, H = 512;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const c = cv.getContext("2d")!;
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0.00, "#2c6fa8");
  g.addColorStop(0.25, "#4b9cd3");
  g.addColorStop(0.55, "#a8d0ef");
  g.addColorStop(0.75, "#d8eaf7");
  g.addColorStop(1.00, "#eef4f9");
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  const tex = new THREE.CanvasTexture(cv);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}

// ─── Materials ────────────────────────────────────────────────────────────────

interface Mats {
  body:   THREE.MeshStandardMaterial;
  glass:  THREE.MeshStandardMaterial;
  frame:  THREE.MeshStandardMaterial;
  slab:   THREE.MeshStandardMaterial;
  roof:   THREE.MeshStandardMaterial;
  corner: THREE.MeshStandardMaterial;
  wire:   THREE.MeshBasicMaterial;
  edge:   THREE.LineBasicMaterial;
}

function makeMats(style: BuildingStyleOptions): Mats {
  const P: Record<FacadeStyle, { body: number; glass: number; slab: number }> = {
    beton:   { body: 0xe8e4d8, glass: 0x93c5fd, slab: 0xcdc8b8 },
    vitrage: { body: 0x1e3a5f, glass: 0xbae6fd, slab: 0x162d4a },
    brique:  { body: 0xb5472c, glass: 0x7ec8e3, slab: 0x9a3820 },
    zinc:    { body: 0x8fa0ae, glass: 0xbae6fd, slab: 0x6b7f8c },
    bois:    { body: 0x9b7348, glass: 0x7ec8e3, slab: 0x7a5a32 },
  };
  const p = P[style.facade] ?? P.beton;
  const roofC = style.roof === "vegetalise" ? 0x4a7c59 : style.roof === "inclinee" ? 0x64748b : 0x2d3748;
  const strC  = new THREE.Color(style.structureColor);
  return {
    body:   new THREE.MeshStandardMaterial({ color: p.body,  roughness: 0.82, metalness: 0.03 }),
    glass:  new THREE.MeshStandardMaterial({ color: p.glass, roughness: 0.05, metalness: 0.85, transparent: true, opacity: 0.78, envMapIntensity: 1.2 }),
    frame:  new THREE.MeshStandardMaterial({ color: strC,    roughness: 0.25, metalness: 0.72 }),
    slab:   new THREE.MeshStandardMaterial({ color: p.slab,  roughness: 0.86, metalness: 0.01 }),
    roof:   new THREE.MeshStandardMaterial({ color: roofC,   roughness: 0.85, metalness: 0.02 }),
    corner: new THREE.MeshStandardMaterial({ color: strC,    roughness: 0.30, metalness: 0.65 }),
    wire:   new THREE.MeshBasicMaterial({ color: 0x2563eb, wireframe: true }),
    edge:   new THREE.LineBasicMaterial({ color: 0x94a3b8 }),
  };
}
function disposeMats(m: Mats) { Object.values(m).forEach((mt: any) => mt.dispose?.()); }

// ─── Procedural windows ───────────────────────────────────────────────────────

function buildWindowsForEdge(
  pts: Pt[], edgeIdx: number, cX: number, cY: number,
  f0: number, f1: number, floorH: number, platformY: number,
  zScale: number, winRatio: number, bayW: number,
  glassGeos: THREE.BufferGeometry[], frameGeos: THREE.BufferGeometry[],
): void {
  const i = edgeIdx, j = (edgeIdx + 1) % pts.length;
  const [x1, y1] = pts[i], [x2, y2] = pts[j];
  const eLen = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
  if (eLen < 0.5) return;

  const eDX = (x2 - x1) / eLen, eDZ = -(y2 - y1) / eLen;
  const midSX = (x1 + x2) / 2, midSY = (y1 + y2) / 2;
  const toCX = cX - midSX, toCY = cY - midSY, toCL = Math.sqrt(toCX ** 2 + toCY ** 2);
  if (toCL < 1e-6) return;
  const outX = -toCX / toCL, outZ = toCY / toCL;

  const basis = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(eDX, 0, eDZ),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(outX, 0, outZ),
  );
  basis.setPosition(x1, 0, -y1);

  const numBays = Math.max(1, Math.round(eLen / bayW));
  const bW = eLen / numBays;
  const winW = bW * Math.min(0.88, winRatio + 0.15);
  const winH = floorH * Math.min(0.80, winRatio + 0.10);
  const gDep = Math.max(0.3, 0.25 * zScale);
  const fSz  = Math.max(0.20, 0.08 * zScale);
  const fDep = Math.max(0.4,  0.30 * zScale);

  for (let f = f0; f < f1; f++) {
    const lY = platformY + f * floorH + floorH * 0.50;
    for (let b = 0; b < numBays; b++) {
      const lX = (b + 0.5) * bW;
      const gGeo = new THREE.BoxGeometry(winW, winH, gDep);
      gGeo.applyMatrix4(basis.clone().multiply(new THREE.Matrix4().makeTranslation(lX, lY, gDep * 0.5 + 0.08)));
      glassGeos.push(gGeo);
      const fGeo = new THREE.BoxGeometry(winW + fSz, winH + fSz, fDep);
      fGeo.applyMatrix4(basis.clone().multiply(new THREE.Matrix4().makeTranslation(lX, lY, fDep * 0.5 - 0.04)));
      frameGeos.push(fGeo);
    }
  }
}

// ─── Volume ───────────────────────────────────────────────────────────────────

function createVolume(
  pts: Pt[], f0: number, f1: number,
  floorH: number, platformY: number,
  mats: Mats, zScale: number, style: BuildingStyleOptions, showWire: boolean,
): THREE.Group {
  const group = new THREE.Group();
  const nF = f1 - f0; if (nF <= 0) return group;
  const h = nF * floorH, baseY = platformY + f0 * floorH;
  const shape  = ptsToShape(pts);
  const [cX, cY] = centroidPts(pts);
  const bayW   = style.bayWidthM * zScale;

  // Corps principal
  const geo  = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
  const mesh = new THREE.Mesh(geo, showWire ? mats.wire : [mats.roof, mats.body]);
  mesh.rotation.x = -Math.PI / 2; mesh.position.y = baseY;
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);

  if (!showWire) {
    // Arêtes
    const el = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 18), mats.edge);
    el.rotation.x = -Math.PI / 2; el.position.y = baseY + 0.04;
    group.add(el);

    // Fenêtres
    const glassGeos: THREE.BufferGeometry[] = [], frameGeos: THREE.BufferGeometry[] = [];
    for (let i = 0; i < pts.length; i++) {
      buildWindowsForEdge(pts, i, cX, cY, f0, f1, floorH, platformY, zScale, style.windowRatio, bayW, glassGeos, frameGeos);
    }
    if (glassGeos.length) {
      const mg = mergeGeometries(glassGeos);
      if (mg) { const m = new THREE.Mesh(mg, mats.glass); m.castShadow = true; group.add(m); }
      glassGeos.forEach(g => g.dispose());
    }
    if (frameGeos.length) {
      const mf = mergeGeometries(frameGeos);
      if (mf) { const m = new THREE.Mesh(mf, mats.frame); m.castShadow = true; group.add(m); }
      frameGeos.forEach(g => g.dispose());
    }

    // Dalles plancher en saillie (banding)
    if (style.hasBanding) {
      const slabH    = Math.max(0.25, floorH * 0.055);
      const slabPts  = scalePts(pts, 1.015);
      const slabShape = ptsToShape(slabPts);
      for (let f = 1; f <= nF; f++) {
        const sGeo  = new THREE.ExtrudeGeometry(slabShape, { depth: slabH, bevelEnabled: false });
        const sMesh = new THREE.Mesh(sGeo, mats.slab);
        sMesh.rotation.x = -Math.PI / 2; sMesh.position.y = baseY + f * floorH - slabH;
        sMesh.castShadow = sMesh.receiveShadow = true;
        group.add(sMesh);
      }
    }

    // Poteaux de rive
    if (style.hasCorner) {
      const cornerW = Math.max(0.5, 0.5 * zScale), cornerD = Math.max(0.5, 0.5 * zScale);
      for (const [px, py] of pts) {
        const cGeo  = new THREE.BoxGeometry(cornerW, h + 0.2, cornerD);
        const cMesh = new THREE.Mesh(cGeo, mats.corner);
        cMesh.position.set(px, baseY + h / 2, -py);
        cMesh.castShadow = true;
        group.add(cMesh);
      }
    }

    // Balcons
    if (style.hasBalconies) {
      const bDep  = Math.max(0.4, 0.9 * zScale), bH = Math.max(0.12, 0.08 * zScale);
      const railH = Math.max(0.3, 0.28 * zScale), railT = Math.max(0.06, 0.04 * zScale);
      for (let f = style.balconyFreq; f <= nF; f += style.balconyFreq) {
        const bY = baseY + f * floorH - bH * 0.5;
        for (let idx = 0; idx < pts.length; idx += 2) {
          const jdx  = (idx + 1) % pts.length;
          const eLen = Math.sqrt((pts[jdx][0] - pts[idx][0]) ** 2 + (pts[jdx][1] - pts[idx][1]) ** 2);
          if (eLen < 4) continue;
          const midSX = (pts[idx][0] + pts[jdx][0]) / 2, midSY = (pts[idx][1] + pts[jdx][1]) / 2;
          const toCX2 = cX - midSX, toCY2 = cY - midSY, toCL2 = Math.sqrt(toCX2 ** 2 + toCY2 ** 2);
          if (toCL2 < 1e-6) continue;
          const outX = -toCX2 / toCL2, outY = -toCY2 / toCL2;
          const bW2  = Math.min(eLen * 0.60, 3.0 * zScale);
          const ang  = Math.atan2((pts[jdx][0] - pts[idx][0]) / eLen, -(pts[jdx][1] - pts[idx][1]) / eLen);
          const slabGeo = new THREE.BoxGeometry(bW2, bH, bDep);
          slabGeo.rotateY(ang);
          slabGeo.translate(midSX + outX * bDep * 0.5, bY, -(midSY + outY * bDep * 0.5));
          group.add(new THREE.Mesh(slabGeo, mats.slab));
          const railGeo = new THREE.BoxGeometry(bW2, railH, railT);
          railGeo.rotateY(ang);
          railGeo.translate(midSX + outX * bDep, bY + railH * 0.5, -(midSY + outY * bDep));
          group.add(new THREE.Mesh(railGeo, mats.frame));
        }
      }
    }
  }
  return group;
}

// ─── Bâtiment complet ─────────────────────────────────────────────────────────

function createBuilding(
  pts: Pt[], totalFloors: number, floorH: number, platformY: number,
  mats: Mats, zScale: number, showWire: boolean, style: BuildingStyleOptions,
): THREE.Group {
  const group = new THREE.Group();

  let volumes: { pts: Pt[]; f0: number; f1: number }[];
  if (style.numSetbacks === 0 || totalFloors <= 3) {
    volumes = [{ pts, f0: 0, f1: totalFloors }];
  } else if (style.numSetbacks === 1 || totalFloors <= 6) {
    volumes = [
      { pts, f0: 0, f1: totalFloors - 2 },
      { pts: scalePts(pts, 0.84), f0: totalFloors - 2, f1: totalFloors },
    ];
  } else {
    volumes = [
      { pts, f0: 0, f1: 3 },
      { pts: scalePts(pts, 0.88), f0: 3, f1: totalFloors - 3 },
      { pts: scalePts(pts, 0.72), f0: totalFloors - 3, f1: totalFloors },
    ];
  }

  for (const v of volumes) {
    group.add(createVolume(v.pts, v.f0, v.f1, floorH, platformY, mats, zScale, style, showWire));
  }

  if (!showWire) {
    const topPts   = volumes[volumes.length - 1].pts;
    const parapetH = Math.max(0.6, 0.6 * zScale);
    const pGeo     = new THREE.ExtrudeGeometry(ptsToShape(topPts), { depth: parapetH, bevelEnabled: false });
    const pMesh    = new THREE.Mesh(pGeo, mats.slab);
    pMesh.rotation.x = -Math.PI / 2; pMesh.position.y = platformY + totalFloors * floorH;
    pMesh.castShadow = true; group.add(pMesh);

    const roofY = platformY + totalFloors * floorH + parapetH;

    if (style.roof === "vegetalise") {
      const vMesh = new THREE.Mesh(new THREE.ShapeGeometry(ptsToShape(topPts)), mats.roof);
      vMesh.rotation.x = -Math.PI / 2; vMesh.position.y = roofY + 0.15;
      group.add(vMesh);
      const [cX, cY] = centroidPts(topPts);
      [0, 1, 2, 3].forEach(k => {
        const ang = k / 4 * Math.PI * 2, r = 1.4 * zScale;
        const bGeo  = new THREE.SphereGeometry(Math.max(0.5, 0.5 * zScale), 7, 5);
        const bMesh = new THREE.Mesh(bGeo, new THREE.MeshStandardMaterial({ color: 0x2d5a27, roughness: 0.9 }));
        bMesh.position.set(cX + Math.cos(ang) * r, roofY + Math.max(0.5, 0.5 * zScale), -(cY + Math.sin(ang) * r));
        bMesh.castShadow = true; group.add(bMesh);
      });
    } else if (style.roof === "inclinee") {
      const [cX, cY] = centroidPts(topPts);
      const ridgeH   = Math.min(totalFloors * floorH * 0.20, 7 * zScale);
      const verts: number[] = [], idxs: number[] = [];
      topPts.forEach(([x, y]) => { verts.push(x, roofY, -y); });
      verts.push(cX, roofY + ridgeH, -cY);
      const ri = topPts.length;
      for (let k = 0; k < topPts.length; k++) idxs.push(k, (k + 1) % topPts.length, ri);
      const rGeo = new THREE.BufferGeometry();
      rGeo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
      rGeo.setIndex(idxs); rGeo.computeVertexNormals();
      const rMesh = new THREE.Mesh(rGeo, mats.roof);
      rMesh.castShadow = true; group.add(rMesh);
    }

    if (totalFloors >= 3) {
      const [cX, cY] = centroidPts(topPts);
      const ltW    = Math.min(2.2 * zScale, 22), ltD = Math.min(3.0 * zScale, 28);
      const ltH    = Math.min(1.8 * zScale, totalFloors * floorH * 0.13);
      const ltMesh = new THREE.Mesh(
        new THREE.BoxGeometry(ltW, ltH, ltD),
        new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.88 }),
      );
      ltMesh.position.set(cX, roofY + ltH / 2, -cY);
      ltMesh.castShadow = true; group.add(ltMesh);
    }
  }
  return group;
}

// ─── Labels ───────────────────────────────────────────────────────────────────

const _v = new THREE.Vector3();

function updateLabels(c: HTMLDivElement, cam: THREE.PerspectiveCamera, cv: HTMLCanvasElement): void {
  const w = cv.clientWidth || cv.width, h = cv.clientHeight || cv.height;
  c.querySelectorAll<HTMLElement>("[data-wp]").forEach(el => {
    const [wx, wy, wz] = (el.dataset.wp ?? "0,0,0").split(",").map(Number);
    _v.set(wx, wy, wz).project(cam);
    const sx = (_v.x * 0.5 + 0.5) * w, sy = (1 - (_v.y * 0.5 + 0.5)) * h;
    const vis = _v.z < 1 && sx > 10 && sx < w - 10 && sy > 10 && sy < h - 10;
    el.style.transform = `translate(-50%,-50%) translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px)`;
    el.style.opacity   = vis ? "1" : "0";
  });
}

function addLabel(c: HTMLDivElement, pos: THREE.Vector3, text: string, color: string): void {
  const el = document.createElement("div");
  el.dataset.wp = `${pos.x},${pos.y},${pos.z}`;
  el.style.cssText = [
    "position:absolute;top:0;left:0;opacity:0;transition:opacity .12s",
    "padding:3px 8px",
    `background:rgba(255,255,255,0.93);border:1.5px solid ${color};border-radius:6px`,
    `font-size:11px;font-weight:700;color:${color};font-family:system-ui,sans-serif`,
    "pointer-events:none;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.10)",
  ].join(";");
  el.textContent = text;
  c.appendChild(el);
}

// ─── Dispose ──────────────────────────────────────────────────────────────────

function disposeGroup(g: THREE.Group): void {
  const ms = new Set<THREE.Material>();
  g.traverse(obj => {
    const m = obj as THREE.Mesh; if (!m.isMesh) return;
    m.geometry?.dispose();
    (Array.isArray(m.material) ? m.material : [m.material]).forEach((mt: any) => mt && ms.add(mt));
  });
  ms.forEach(m => m.dispose());
  g.clear();
}

// ─── Component ────────────────────────────────────────────────────────────────

export const SceneSvg3D: React.FC<Props> = ({
  parcel, buildings, parkings,
  showTerrain, showBuildings, showParkings, showWireframe,
  reliefData, buildingHeightM,
  buildingStyle = {
    facade: "beton", roof: "terrasse", structureColor: "#64748b",
    windowRatio: 0.55, bayWidthM: 3.5, hasBalconies: false,
    balconyFreq: 2, hasBanding: true, hasCorner: false, numSetbacks: 1,
  },
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const ctxRef   = useRef<ThreeCtx | null>(null);

  // ── Init ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const mount = mountRef.current; if (!mount) return;
    const W = mount.clientWidth || 700, H = mount.clientHeight || 420;

    const scene    = new THREE.Scene();
    const skyTex   = makeSkyTexture();
    const skySphere = new THREE.Mesh(
      new THREE.SphereGeometry(4000, 16, 8),
      new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide }),
    );
    scene.add(skySphere);

    scene.add(new THREE.AmbientLight(0xfff5e0, 0.48));
    const sun = new THREE.DirectionalLight(0xfff4d0, 1.20);
    sun.position.set(420, 540, 300); sun.castShadow = true;
    sun.shadow.mapSize.setScalar(4096); sun.shadow.normalBias = 0.010; sun.shadow.radius = 2.5;
    const sc = sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = sc.bottom = -700; sc.right = sc.top = 700; sc.near = 1; sc.far = 3000;
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xb8d0e8, 0.28);
    fill.position.set(-300, 200, -200); scene.add(fill);
    scene.add(new THREE.HemisphereLight(0xcce4f5, 0xaa9966, 0.22));

    const grid = new THREE.GridHelper(1200, 50, 0xbbc8c4, 0xd0d9d5);
    (grid.material as any).opacity = 0.40; (grid.material as any).transparent = true;
    scene.add(grid);

    const camera = new THREE.PerspectiveCamera(36, W / H, 1, 6000);
    camera.position.set(300, 200, 300);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI / 2.06;
    controls.minDistance = 15; controls.maxDistance = 5000;
    controls.screenSpacePanning = true; controls.update();

    const labelContainer = document.createElement("div");
    labelContainer.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;";
    mount.appendChild(labelContainer);

    const sceneGroup = new THREE.Group(); scene.add(sceneGroup);

    let rafId: number;
    const loop = () => {
      rafId = requestAnimationFrame(loop);
      controls.update();
      renderer.render(scene, camera);
      updateLabels(labelContainer, camera, renderer.domElement);
    };
    loop();

    ctxRef.current = { renderer, camera, controls, scene, sceneGroup, labelContainer, rafId };

    const ro = new ResizeObserver(() => {
      const w2 = mount.clientWidth, h2 = mount.clientHeight;
      if (!w2 || !h2) return;
      camera.aspect = w2 / h2; camera.updateProjectionMatrix(); renderer.setSize(w2, h2);
    });
    ro.observe(mount);

    return () => {
      ro.disconnect(); cancelAnimationFrame(rafId);
      controls.dispose(); renderer.dispose(); skyTex.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
      if (mount.contains(labelContainer)) mount.removeChild(labelContainer);
    };
  }, []);

  // ── Rebuild ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const ctx = ctxRef.current; if (!ctx) return;
    const { sceneGroup, labelContainer, controls, camera } = ctx;
    disposeGroup(sceneGroup); labelContainer.innerHTML = "";

    const parcelRing = ringFromParcel(parcel);
    const bRings = (buildings?.features ?? []).map(ringFromPoly).filter(Boolean) as Position[][];
    const pRings = (parkings?.features  ?? []).map(ringFromPoly).filter(Boolean) as Position[][];
    const allRings = [...(parcelRing ? [parcelRing] : []), ...bRings, ...pRings];
    const bb = bboxRings(allRings); if (!bb) return;

    const [minX, minY, maxX, maxY] = bb;
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const spanX = Math.max(1e-9, maxX - minX), spanY = Math.max(1e-9, maxY - minY);
    const scale = 520 / Math.max(spanX, spanY);
    const toXY  = (p: Position): Pt => [(p[0] - cx) * scale, (p[1] - cy) * scale];
    const isGeo = Math.max(spanX, spanY) < 1;
    const mPU   = isGeo ? 111_000 : 1;
    const zScale = scale / mPU;

    const totalFloors = buildingHeightM ? Math.max(1, Math.round(buildingHeightM / 3)) : 3;
    const floorH      = (buildingHeightM ?? (totalFloors * 3)) / totalFloors * zScale;
    const H_PARK      = 2.5 * zScale;
    let platformY     = 0;

    // Terrain
    if (showTerrain && reliefData?.elevations?.length) {
      const { elevations, nx, ny, minZ, maxZ, bbox: rb, platformLevel } = reliefData;
      const [bx0, by0, bx1, by1] = rb;
      const dZ  = maxZ - minZ, rZ = dZ > 0 ? 150 / dZ : zScale;
      const rCx = (bx0 + bx1) / 2, rCy = (by0 + by1) / 2;
      const rSX = bx1 - bx0, rSY = by1 - by0, rSc = 520 / Math.max(rSX, rSY);

      platformY = typeof platformLevel === "number" ? (platformLevel - minZ) * rZ : rZ * 2;

      const pos  = new Float32Array(nx * ny * 3);
      const cols = new Float32Array(nx * ny * 3);

      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const idx = j * nx + i, z = elevations[idx];
        pos[idx * 3]     = (bx0 + (i / (nx - 1)) * rSX - rCx) * rSc;
        pos[idx * 3 + 1] = Number.isFinite(z) ? (z - minZ) * rZ : 0;
        pos[idx * 3 + 2] = -(by0 + (j / (ny - 1)) * rSY - rCy) * rSc;
        const t = dZ > 0 ? Math.min(1, Math.max(0, (z - minZ) / dZ)) : 0.5;
        const [r, g, b] = elevColor(t);
        cols[idx * 3] = r; cols[idx * 3 + 1] = g; cols[idx * 3 + 2] = b;
      }

      const iArr = new Uint32Array((nx - 1) * (ny - 1) * 6); let k = 0;
      for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, b2 = j * nx + i + 1, c2 = (j + 1) * nx + i, d = (j + 1) * nx + i + 1;
        iArr[k++] = a; iArr[k++] = b2; iArr[k++] = c2;
        iArr[k++] = b2; iArr[k++] = d; iArr[k++] = c2;
      }

      const tGeo = new THREE.BufferGeometry();
      tGeo.setAttribute("position", new THREE.BufferAttribute(pos,  3));
      tGeo.setAttribute("color",    new THREE.BufferAttribute(cols, 3));
      tGeo.setIndex(new THREE.BufferAttribute(iArr, 1));
      tGeo.computeVertexNormals();

      const tMesh = new THREE.Mesh(tGeo, new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.82, metalness: 0, side: THREE.DoubleSide,
      }));
      tMesh.receiveShadow = true; sceneGroup.add(tMesh);
    }

    // Parcelle
    if (showTerrain && parcelRing?.length) {
      const pts = parcelRing.map(toXY);
      if (!reliefData?.elevations?.length) {
        const pMesh = new THREE.Mesh(
          new THREE.ShapeGeometry(ptsToShape(pts)),
          new THREE.MeshStandardMaterial({
            color: 0x86efac, transparent: true, opacity: 0.16,
            side: THREE.DoubleSide, depthWrite: false,
          }),
        );
        pMesh.rotation.x = -Math.PI / 2; pMesh.position.y = platformY + 0.2;
        pMesh.receiveShadow = true; sceneGroup.add(pMesh);
      }
      const lp = pts.map(([x, y]) => new THREE.Vector3(x, platformY + 0.5, -y));
      lp.push(lp[0].clone());
      sceneGroup.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(lp),
        new THREE.LineBasicMaterial({ color: 0x16a34a }),
      ));
    }

    // Bâtiments
    if (showBuildings && bRings.length) {
      const mats = makeMats(buildingStyle);
      bRings.forEach(ring => {
        const pts = ring.map(toXY);
        sceneGroup.add(createBuilding(pts, totalFloors, floorH, platformY, mats, zScale, Boolean(showWireframe), buildingStyle));

        const [cXp, cYp] = centroidPts(pts);
        let maxXp = -Infinity; for (const [x] of pts) if (x > maxXp) maxXp = x;
        const labelPos = new THREE.Vector3(maxXp + 8 * zScale, platformY + totalFloors * floorH / 2, -cYp);
        const aM2 = Math.round(areaPts(pts) / (scale * scale) * mPU * mPU);
        const lp2: string[] = [];
        if (buildingHeightM != null) lp2.push(`H ${buildingHeightM.toFixed(1)} m`);
        if (aM2 > 0) lp2.push(`${aM2.toLocaleString("fr-FR")} m²`);
        if (lp2.length) addLabel(labelContainer, labelPos, lp2.join("  ·  "), "#1e3a8a");
      });
    }

    // Parkings
    if (showParkings && pRings.length) {
      const pMat  = new THREE.MeshStandardMaterial({ color: 0xa855f7, transparent: true, opacity: 0.52, roughness: 0.45, metalness: 0.08 });
      const pEdge = new THREE.LineBasicMaterial({ color: 0x7c3aed });
      pRings.forEach(ring => {
        const pts = ring.map(toXY);
        const geo = new THREE.ExtrudeGeometry(ptsToShape(pts), { depth: H_PARK, bevelEnabled: false });
        const mat = showWireframe ? new THREE.MeshBasicMaterial({ color: 0x9333ea, wireframe: true }) : pMat;
        const mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.x = -Math.PI / 2; mesh.position.y = platformY;
        mesh.castShadow = mesh.receiveShadow = true; sceneGroup.add(mesh);
        if (!showWireframe) {
          const el = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 15), pEdge);
          el.rotation.x = -Math.PI / 2; el.position.y = platformY + 0.1; sceneGroup.add(el);
        }
        const [cXp2, cYp2] = centroidPts(pts);
        const aM2 = Math.round(areaPts(pts) / (scale * scale) * mPU * mPU);
        if (aM2 > 0) addLabel(labelContainer, new THREE.Vector3(cXp2, platformY + H_PARK + zScale, -cYp2), `🅿 ${aM2.toLocaleString("fr-FR")} m²`, "#7c3aed");
      });
    }

    // Fit caméra
    const box = new THREE.Box3().setFromObject(sceneGroup);
    if (!box.isEmpty()) {
      const center = new THREE.Vector3(); box.getCenter(center);
      const size   = new THREE.Vector3(); box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z, 1);
      const dist   = (maxDim / 2) / Math.tan((36 / 2) * (Math.PI / 180)) * 1.85;
      controls.target.copy(center);
      camera.position.set(center.x + dist * 0.70, center.y + dist * 0.48, center.z + dist * 0.70);
      camera.lookAt(center);
      controls.minDistance = dist * 0.04; controls.maxDistance = dist * 9; controls.update();
    }
  }, [parcel, buildings, parkings, showTerrain, showBuildings, showParkings, showWireframe, reliefData, buildingHeightM, buildingStyle]);

  return (
    <div
      ref={mountRef}
      style={{ position: "relative", width: "100%", height: "100%", minHeight: 420, overflow: "hidden", borderRadius: 8 }}
      title="Drag : orbit · Wheel : zoom · Clic-droit : pan"
    />
  );
};