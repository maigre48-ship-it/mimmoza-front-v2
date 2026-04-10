// massingRenderMaterials.ts — V5.1 safe
// Nouveautés V5.1 :
// - correction du rendu noir en neutralisant les maps les plus risquées
// - aoMap désactivée partout
// - metalnessMap désactivée sur façade/toiture
// - roughnessMap conservée seulement si utile
// - textures couleur + normalMap conservées
// - hiérarchie premium socle / corps / attique conservée
// - compatible avec le reste du pipeline actuel

import * as THREE from "three";
import {
  getTextureBundle,
  getTexturePreset,
  getDefaultFacadePresetId,
  getDefaultRoofPresetId,
  getConcreteTexture,
  getConcreteRoughnessTexture,
  getMetalTexture,
  getMetalRoughnessTexture,
} from "./massingTextureFactory";

// ─── Types publics ─────────────────────────────────────────────────────────────

export type FacadePaletteKey = "beton" | "vitrage" | "brique" | "zinc" | "bois" | "enduit";
export type RoofStyleKey = "terrasse" | "vegetalise" | "inclinee" | "toiture-zinc";

export interface BuildingMaterials {
  facadeSocle: THREE.Material;
  facadeBody: THREE.Material;
  facadeAttique: THREE.Material;
  glass: THREE.Material;
  frame: THREE.Material;
  slab: THREE.Material;
  door: THREE.Material;
  balconySlab: THREE.Material;
  terraceSlab: THREE.Material;
  railing: THREE.Material;
  roof: THREE.Material;
  acrotere: THREE.Material;
  edgeLine: THREE.Material;
}

// ─── Palette ──────────────────────────────────────────────────────────────────

interface PaletteEntry {
  bodyHex: string;
  roughness: number;
  metalness: number;
  socleMul: number;
  attiqueMul: number;
  normalScale: number;
}

const PALETTE: Record<FacadePaletteKey, PaletteEntry> = {
  beton: {
    bodyHex: "#D6D0C4",
    roughness: 0.9,
    metalness: 0.01,
    socleMul: 0.86,
    attiqueMul: 1.04,
    normalScale: 0.28,
  },
  vitrage: {
    bodyHex: "#C8D4DC",
    roughness: 0.34,
    metalness: 0.14,
    socleMul: 0.9,
    attiqueMul: 1.02,
    normalScale: 0.14,
  },
  brique: {
    bodyHex: "#C4826A",
    roughness: 0.9,
    metalness: 0.0,
    socleMul: 0.86,
    attiqueMul: 1.03,
    normalScale: 0.3,
  },
  zinc: {
    bodyHex: "#8A9AA8",
    roughness: 0.42,
    metalness: 0.42,
    socleMul: 0.9,
    attiqueMul: 1.03,
    normalScale: 0.16,
  },
  bois: {
    bodyHex: "#B8956A",
    roughness: 0.88,
    metalness: 0.0,
    socleMul: 0.86,
    attiqueMul: 1.04,
    normalScale: 0.24,
  },
  enduit: {
    bodyHex: "#E2D9C8",
    roughness: 0.84,
    metalness: 0.01,
    socleMul: 0.88,
    attiqueMul: 1.04,
    normalScale: 0.22,
  },
};

// ─── Helpers couleur ──────────────────────────────────────────────────────────

function darken(hex: string, f: number): string {
  const c = new THREE.Color(hex);
  c.r = Math.max(0, c.r * f);
  c.g = Math.max(0, c.g * f);
  c.b = Math.max(0, c.b * f);
  return `#${c.getHexString()}`;
}

function lighten(hex: string, f: number): string {
  const c = new THREE.Color(hex);
  c.r = Math.min(1, c.r * f);
  c.g = Math.min(1, c.g * f);
  c.b = Math.min(1, c.b * f);
  return `#${c.getHexString()}`;
}

function mixHex(a: string, b: string, t: number): string {
  const ca = new THREE.Color(a);
  const cb = new THREE.Color(b);
  const c = ca.lerp(cb, t);
  return `#${c.getHexString()}`;
}

// ─── Helpers textures ─────────────────────────────────────────────────────────

function ensureColorTexture(tex?: THREE.Texture | null): THREE.Texture | null {
  if (!tex) return null;
  const t = tex.clone();
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

function ensureDataTexture(tex?: THREE.Texture | null): THREE.Texture | null {
  if (!tex) return null;
  const t = tex.clone();
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/**
 * scale > 1 → motif plus petit
 * scale < 1 → motif plus grand
 */
function applyTexTransform(tex: THREE.Texture | null, deg: number, scale: number): void {
  if (!tex) return;

  tex.center.set(0.5, 0.5);
  tex.rotation = THREE.MathUtils.degToRad(deg);

  if (scale !== 1) {
    tex.repeat.multiplyScalar(scale);
  }

  tex.needsUpdate = true;
}

function cloneBundle(bundle: {
  map?: THREE.Texture;
  normalMap?: THREE.Texture;
  roughnessMap?: THREE.Texture;
  aoMap?: THREE.Texture;
  displacementMap?: THREE.Texture;
  metalnessMap?: THREE.Texture;
}) {
  return {
    map: ensureColorTexture(bundle.map),
    normalMap: ensureDataTexture(bundle.normalMap),
    roughnessMap: ensureDataTexture(bundle.roughnessMap),
    aoMap: ensureDataTexture(bundle.aoMap),
    metalnessMap: ensureDataTexture(bundle.metalnessMap),
  };
}

function resolveFacadePresetId(facade: FacadePaletteKey, id?: string): string {
  if (id && getTexturePreset(id)) return id;
  return getDefaultFacadePresetId(facade);
}

function resolveRoofPresetId(id?: string): string {
  if (id && getTexturePreset(id)) return id;
  return getDefaultRoofPresetId();
}

// ─── Constructeurs matériaux ───────────────────────────────────────────────────

function stdTex(p: {
  color: string | number;
  roughness?: number;
  metalness?: number;
  map?: THREE.Texture | null;
  normalMap?: THREE.Texture | null;
  roughnessMap?: THREE.Texture | null;
  aoMap?: THREE.Texture | null;
  metalnessMap?: THREE.Texture | null;
  normalScale?: number;
  opacity?: number;
  transparent?: boolean;
  side?: THREE.Side;
  depthWrite?: boolean;
  envMapIntensity?: number;
}): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: p.color,
    roughness: p.roughness ?? 0.7,
    metalness: p.metalness ?? 0.0,
    map: p.map ?? undefined,
    normalMap: p.normalMap ?? undefined,
    normalScale: p.normalMap
      ? new THREE.Vector2(p.normalScale ?? 0.35, p.normalScale ?? 0.35)
      : undefined,
    roughnessMap: p.roughnessMap ?? undefined,

    // IMPORTANT : coupés pour éviter le rendu noir
    aoMap: undefined,
    metalnessMap: undefined,

    transparent: p.transparent ?? (p.opacity !== undefined && p.opacity < 1),
    opacity: p.opacity ?? 1,
    side: p.side ?? THREE.FrontSide,
    depthWrite: p.depthWrite ?? true,
  });

  if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
  if (mat.normalMap) mat.normalMap.colorSpace = THREE.NoColorSpace;
  if (mat.roughnessMap) mat.roughnessMap.colorSpace = THREE.NoColorSpace;

  mat.envMapIntensity = p.envMapIntensity ?? 1;
  mat.needsUpdate = true;
  return mat;
}

function std(p: {
  color: string | number;
  roughness?: number;
  metalness?: number;
  opacity?: number;
  transparent?: boolean;
  side?: THREE.Side;
  depthWrite?: boolean;
  envMapIntensity?: number;
}): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: p.color,
    roughness: p.roughness ?? 0.7,
    metalness: p.metalness ?? 0.0,
    transparent: p.transparent ?? (p.opacity !== undefined && p.opacity < 1),
    opacity: p.opacity ?? 1,
    side: p.side ?? THREE.FrontSide,
    depthWrite: p.depthWrite ?? true,
  });

  mat.envMapIntensity = p.envMapIntensity ?? 1;
  mat.needsUpdate = true;
  return mat;
}

// ─── Factory principale ───────────────────────────────────────────────────────

export function createBuildingMaterials(opts: {
  facade: FacadePaletteKey;
  roof: RoofStyleKey;
  structureColor: string;
  facadeTextureId?: string;
  roofTextureId?: string;
  facadeTextureRotation?: number;
  facadeTextureScale?: number;
  glassColor?: string;
  glassOpacity?: number;
}): BuildingMaterials {
  const pal = PALETTE[opts.facade] ?? PALETTE.beton;
  const rotDeg = opts.facadeTextureRotation ?? 0;
  const scale = Math.max(0.1, opts.facadeTextureScale ?? 1);

  // ── Bundle façade ──────────────────────────────────────────────────────────
  const facadePresetId = resolveFacadePresetId(opts.facade, opts.facadeTextureId);
  const rawBundle = getTextureBundle(facadePresetId, { repeatScaleX: 1, repeatScaleY: 1 });
  const fb = cloneBundle(rawBundle);

  applyTexTransform(fb.map, rotDeg, scale);
  applyTexTransform(fb.normalMap, rotDeg, scale);
  applyTexTransform(fb.roughnessMap, rotDeg, scale);

  const bodyMap = fb.map ?? null;
  const normalMap = fb.normalMap ?? null;
  const roughMap = fb.roughnessMap ?? null;

  const structureBase = opts.structureColor ?? "#374151";
  const structureDark = mixHex(structureBase, "#14181f", 0.22);
  const structureMid = mixHex(structureBase, "#9ca3af", 0.08);

  const baseColor = pal.bodyHex;
  const socleColor = darken(baseColor, pal.socleMul);
  const attiqueColor = lighten(baseColor, pal.attiqueMul);

  const facadeSocle = stdTex({
    color: socleColor,
    roughness: Math.min(1, pal.roughness + 0.03),
    metalness: pal.metalness * 0.22,
    map: bodyMap,
    normalMap,
    roughnessMap: roughMap,
    normalScale: pal.normalScale * 0.8,
    envMapIntensity: 0.55,
  });

  const facadeBody = stdTex({
    color: baseColor,
    roughness: pal.roughness,
    metalness: pal.metalness * 0.55,
    map: bodyMap,
    normalMap,
    roughnessMap: roughMap,
    normalScale: pal.normalScale,
    envMapIntensity: 0.7,
  });

  const facadeAttique = stdTex({
    color: attiqueColor,
    roughness: Math.max(0.22, pal.roughness - 0.05),
    metalness: pal.metalness * 0.5,
    map: bodyMap,
    normalMap,
    roughnessMap: roughMap,
    normalScale: pal.normalScale * 0.72,
    envMapIntensity: 0.8,
  });

  // ── Vitrage premium ────────────────────────────────────────────────────────
  const glass = std({
    color: opts.glassColor ?? "#2B3642",
    roughness: 0.08,
    metalness: 0.18,
    transparent: true,
    opacity: THREE.MathUtils.clamp(opts.glassOpacity ?? 0.78, 0.18, 0.95),
    depthWrite: false,
    envMapIntensity: 1.15,
  });

  // ── Structure / éléments fixes ─────────────────────────────────────────────
  const frame = std({
    color: structureMid,
    roughness: 0.48,
    metalness: 0.24,
    envMapIntensity: 0.9,
  });

  const slab = std({
    color: darken(baseColor, 0.76),
    roughness: 0.9,
    metalness: 0.0,
    envMapIntensity: 0.35,
  });

  const door = std({
    color: structureDark,
    roughness: 0.42,
    metalness: 0.2,
    envMapIntensity: 0.95,
  });

  const balconySlab = std({
    color: darken(baseColor, 0.72),
    roughness: 0.92,
    metalness: 0.0,
    envMapIntensity: 0.3,
  });

  // ── Dalle terrasse ─────────────────────────────────────────────────────────
  const tcm = ensureColorTexture(getConcreteTexture("#8E8880"));
  const tcr = ensureDataTexture(getConcreteRoughnessTexture());

  if (tcm) {
    tcm.repeat.set(3, 3);
    tcm.needsUpdate = true;
  }
  if (tcr) {
    tcr.repeat.set(3, 3);
    tcr.needsUpdate = true;
  }

  const terraceSlab = stdTex({
    color: "#8E8880",
    roughness: 0.94,
    metalness: 0.0,
    map: tcm ?? undefined,
    roughnessMap: tcr ?? undefined,
    side: THREE.DoubleSide,
    envMapIntensity: 0.3,
  });

  // ── Garde-corps ────────────────────────────────────────────────────────────
  const rmm = ensureColorTexture(getMetalTexture("#A8B0B8"));
  const rmr = ensureDataTexture(getMetalRoughnessTexture());

  if (rmm) {
    rmm.repeat.set(1.5, 1.5);
    rmm.needsUpdate = true;
  }
  if (rmr) {
    rmr.repeat.set(1.5, 1.5);
    rmr.needsUpdate = true;
  }

  const railing = stdTex({
    color: "#A8B0B8",
    roughness: 0.28,
    metalness: 0.62,
    map: rmm ?? undefined,
    roughnessMap: rmr ?? undefined,
    envMapIntensity: 1.0,
  });

  // ── Toiture ────────────────────────────────────────────────────────────────
  const roofColorMap: Record<RoofStyleKey, string> = {
    terrasse: "#787068",
    vegetalise: "#4A6040",
    inclinee: "#6A6158",
    "toiture-zinc": "#6E7A82",
  };

  const roofMetalMap: Record<RoofStyleKey, number> = {
    terrasse: 0.02,
    vegetalise: 0.0,
    inclinee: 0.04,
    "toiture-zinc": 0.38,
  };

  const roofRoughMap: Record<RoofStyleKey, number> = {
    terrasse: 0.94,
    vegetalise: 0.97,
    inclinee: 0.86,
    "toiture-zinc": 0.38,
  };

  const roofHex = roofColorMap[opts.roof] ?? roofColorMap.terrasse;
  const roofMetal = roofMetalMap[opts.roof] ?? 0;
  const roofRough = roofRoughMap[opts.roof] ?? 0.9;

  const rb = cloneBundle(getTextureBundle(resolveRoofPresetId(opts.roofTextureId)));
  const isVeg = opts.roof === "vegetalise";

  const roof = stdTex({
    color: roofHex,
    roughness: roofRough,
    metalness: roofMetal,
    map: isVeg ? null : rb.map ?? null,
    normalMap: isVeg ? null : rb.normalMap ?? null,
    roughnessMap: isVeg ? null : rb.roughnessMap ?? null,
    side: THREE.DoubleSide,
    envMapIntensity: opts.roof === "toiture-zinc" ? 0.95 : 0.45,
    normalScale: opts.roof === "toiture-zinc" ? 0.18 : 0.12,
  });

  const acrotere = std({
    color: darken(baseColor, 0.72),
    roughness: 0.92,
    metalness: 0.0,
    envMapIntensity: 0.3,
  });

  const edgeLine = new THREE.LineBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.055,
  });

  return {
    facadeSocle,
    facadeBody,
    facadeAttique,
    glass,
    frame,
    slab,
    door,
    balconySlab,
    terraceSlab,
    railing,
    roof,
    acrotere,
    edgeLine,
  };
}

// ─── Couleur façade ───────────────────────────────────────────────────────────

export function applyFacadeColor(mats: BuildingMaterials, hex: string): void {
  if (!hex) return;

  const base = new THREE.Color(hex);

  const clampC = (c: THREE.Color) => {
    c.r = Math.min(1, Math.max(0, c.r));
    c.g = Math.min(1, Math.max(0, c.g));
    c.b = Math.min(1, Math.max(0, c.b));
    return c;
  };

  const setC = (mat: THREE.Material, col: THREE.Color) => {
    const m = mat as THREE.MeshStandardMaterial;
    if (!m.color) return;
    m.color.copy(col);
    m.needsUpdate = true;
  };

  setC(mats.facadeSocle, clampC(base.clone().multiplyScalar(0.9)));
  setC(mats.facadeBody, clampC(base.clone()));
  setC(mats.facadeAttique, clampC(base.clone().multiplyScalar(1.04)));
}

// ─── Dispose ─────────────────────────────────────────────────────────────────

export function disposeBuildingMaterials(mats: BuildingMaterials): void {
  const done = new Set<THREE.Texture>();

  Object.values(mats).forEach((material) => {
    const m = material as THREE.Material & {
      map?: THREE.Texture | null;
      normalMap?: THREE.Texture | null;
      roughnessMap?: THREE.Texture | null;
      aoMap?: THREE.Texture | null;
      metalnessMap?: THREE.Texture | null;
    };

    const d = (t?: THREE.Texture | null) => {
      if (!t || done.has(t)) return;
      t.dispose();
      done.add(t);
    };

    d(m.map);
    d(m.normalMap);
    d(m.roughnessMap);
    d(m.aoMap);
    d(m.metalnessMap);

    if (typeof m.dispose === "function") m.dispose();
  });
}