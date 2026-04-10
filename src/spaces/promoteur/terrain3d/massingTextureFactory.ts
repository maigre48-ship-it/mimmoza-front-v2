// massingTextureFactory.ts — Texture factory hybride V3.0
// - charge des textures réelles depuis /public/textures/... quand elles existent
// - garde des fallbacks procéduraux pour bois / béton / métal / brique
// - clone toujours les textures source pour éviter qu'un preset en écrase un autre
// - expose un catalogue prêt pour un select matériau dans l'UI
//
// CORRECTIONS V3.0 :
// - fini les textures noires fantômes dues aux 404 asynchrones
// - repeat physique plus crédible selon la famille et la taille réelle de façade
// - orientation standardisée des textures (façades droites par défaut)
// - center + rotation appliqués proprement sur chaque clone
// - displacement désactivé volontairement pour éviter les artefacts
// - support robuste des suffixes BaseColor / Albedo / AO / AmbientOcclusion / Height
// - alphaMap toujours volontairement absent

import * as THREE from "three";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES PUBLICS
// ═══════════════════════════════════════════════════════════════════════════════

export type TextureFamily =
  | "brick"
  | "concrete"
  | "wood"
  | "roof"
  | "ground"
  | "road"
  | "moss"
  | "metal"
  | "procedural";

export interface TexturePreset {
  id: string;
  label: string;
  family: TextureFamily;
  basePath?: string;
  repeat: { x: number; y: number };
  proceduralHex?: string;
}

export interface TextureBundle {
  map?: THREE.Texture;
  normalMap?: THREE.Texture;
  roughnessMap?: THREE.Texture;
  aoMap?: THREE.Texture;
  displacementMap?: THREE.Texture;
  metalnessMap?: THREE.Texture;
  // alphaMap volontairement absent : les textures architecturales sont opaques.
  // Un alphaMap noir (404) rend le matériau entièrement transparent.
}

export interface FacadeTextureSelection {
  facade?: string;
  roof?: string;
  ground?: string;
  road?: string;
}

type TextureKind =
  | "color"
  | "normal"
  | "roughness"
  | "ao"
  | "displacement"
  | "metalness";

type TextureLoadState = "idle" | "pending" | "ready" | "failed";

// ═══════════════════════════════════════════════════════════════════════════════
// CATALOGUE DES PRESETS
// ═══════════════════════════════════════════════════════════════════════════════

const TEXTURE_PRESETS: TexturePreset[] = [
  // ── Briques ────────────────────────────────────────────────────────────────
  {
    id: "brick/bricks060",
    label: "Brique claire 060",
    family: "brick",
    basePath: "/textures/brick/Bricks060_2K-JPG",
    repeat: { x: 1, y: 1 },
  },
  {
    id: "brick/bricks084",
    label: "Brique pierre 084",
    family: "brick",
    basePath: "/textures/brick/Bricks084_2K-JPG",
    repeat: { x: 1, y: 1 },
  },
  {
    id: "brick/bricks101",
    label: "Brique rouge 101",
    family: "brick",
    basePath: "/textures/brick/Bricks101_2K-JPG",
    repeat: { x: 1, y: 1 },
  },
  {
    id: "brick/bricks103",
    label: "Brique beige 103",
    family: "brick",
    basePath: "/textures/brick/Bricks103_2K-JPG",
    repeat: { x: 1, y: 1 },
  },

  // ── Béton / Enduit ─────────────────────────────────────────────────────────
  {
    id: "concrete/concrete045",
    label: "Béton coffré 045",
    family: "concrete",
    basePath: "/textures/concrete/Concrete045_2K-JPG",
    repeat: { x: 1, y: 1 },
  },
  {
    id: "concrete/concrete047a",
    label: "Béton minéral 047A",
    family: "concrete",
    basePath: "/textures/concrete/Concrete047A_2K-JPG",
    repeat: { x: 1, y: 1 },
  },
  {
    id: "plaster/plaster001",
    label: "Enduit réaliste 001",
    family: "concrete",
    basePath: "/textures/plaster/Plaster001",
    repeat: { x: 1, y: 1 },
  },

  // ── Bois ───────────────────────────────────────────────────────────────────
  {
    id: "wood/planks023a",
    label: "Bardage bois sombre 023A",
    family: "wood",
    basePath: "/textures/wood/Planks023A_2K-JPG",
    repeat: { x: 1, y: 1 },
  },
  {
    id: "wood/planks039",
    label: "Bardage bois clair 039",
    family: "wood",
    basePath: "/textures/wood/Planks039_2K-JPG",
    repeat: { x: 1, y: 1 },
  },

  // ── Sol / végétal ──────────────────────────────────────────────────────────
  {
    id: "ground/grass005",
    label: "Herbe 005",
    family: "ground",
    basePath: "/textures/ground/Grass005_2K-JPG",
    repeat: { x: 1, y: 1 },
  },
  {
    id: "ground/moss002",
    label: "Mousse 002",
    family: "moss",
    basePath: "/textures/ground/Moss002_2K-JPG",
    repeat: { x: 1, y: 1 },
  },

  // ── Voirie ─────────────────────────────────────────────────────────────────
  {
    id: "road/road012a",
    label: "Enrobé 012A",
    family: "road",
    basePath: "/textures/road/Road012A_2K-JPG",
    repeat: { x: 1, y: 1 },
  },

  // ── Toiture ────────────────────────────────────────────────────────────────
  {
    id: "roof/roofingtiles013a",
    label: "Tuiles sombres 013A",
    family: "roof",
    basePath: "/textures/roof/RoofingTiles013A_2K-JPG",
    repeat: { x: 1, y: 1 },
  },
  {
    id: "roof/roofingtiles014a",
    label: "Tuiles terre cuite 014A",
    family: "roof",
    basePath: "/textures/roof/RoofingTiles014A_2K-JPG",
    repeat: { x: 1, y: 1 },
  },
  {
    id: "roof/roofingtiles015a",
    label: "Tuiles grises 015A",
    family: "roof",
    basePath: "/textures/roof/RoofTiles015A",
    repeat: { x: 1, y: 1 },
  },
  {
    id: "roof/roofingtiles014b",
    label: "Tuiles terre cuite 014B",
    family: "roof",
    basePath: "/textures/roof/RoofTiles014B",
    repeat: { x: 1, y: 1 },
  },

  // ── Presets procéduraux fallback ───────────────────────────────────────────
  {
    id: "procedural/wood_default",
    label: "Bois procédural",
    family: "procedural",
    repeat: { x: 1, y: 1 },
    proceduralHex: "#B8956A",
  },
  {
    id: "procedural/concrete_default",
    label: "Béton procédural",
    family: "procedural",
    repeat: { x: 1, y: 1 },
    proceduralHex: "#D6D0C4",
  },
  {
    id: "procedural/brick_default",
    label: "Brique procédurale",
    family: "procedural",
    repeat: { x: 1, y: 1 },
    proceduralHex: "#C4826A",
  },
  {
    id: "procedural/metal_default",
    label: "Métal procédural",
    family: "procedural",
    repeat: { x: 1, y: 1 },
    proceduralHex: "#8A9AA8",
  },
];

const PRESET_INDEX = new Map(TEXTURE_PRESETS.map((p) => [p.id, p]));

// ═══════════════════════════════════════════════════════════════════════════════
// CACHE SINGLETON
// ═══════════════════════════════════════════════════════════════════════════════

const _textureCache = new Map<string, THREE.Texture>();
const _bundleCache = new Map<string, TextureBundle>();
const _textureState = new Map<string, TextureLoadState>();
const _failedUrls = new Set<string>();
const _loader = new THREE.TextureLoader();

/**
 * Version de chargement incrémentée quand une texture réelle devient prête.
 * Permet au moteur / React de re-déclencher une reconstruction si besoin.
 */
let _textureRevision = 0;

function cachedTexture(key: string, build: () => THREE.Texture): THREE.Texture {
  if (!_textureCache.has(key)) {
    _textureCache.set(key, build());
  }
  return _textureCache.get(key)!;
}

function cachedBundle(key: string, build: () => TextureBundle): TextureBundle {
  if (!_bundleCache.has(key)) {
    _bundleCache.set(key, build());
  }
  return _bundleCache.get(key)!;
}

export function getTextureRevision(): number {
  return _textureRevision;
}

export function disposeTextureCache(): void {
  _textureCache.forEach((t) => t.dispose());
  _textureCache.clear();

  _bundleCache.forEach((bundle) => {
    bundle.map?.dispose();
    bundle.normalMap?.dispose();
    bundle.roughnessMap?.dispose();
    bundle.aoMap?.dispose();
    bundle.displacementMap?.dispose();
    bundle.metalnessMap?.dispose();
  });
  _bundleCache.clear();
  _textureState.clear();
  _failedUrls.clear();
  _textureRevision = 0;
}

// ═══════════════════════════════════════════════════════════════════════════════
// API PUBLIQUE
// ═══════════════════════════════════════════════════════════════════════════════

export function getTexturePresets(): TexturePreset[] {
  return TEXTURE_PRESETS.slice();
}

export function getTexturePresetsByFamily(family: TextureFamily): TexturePreset[] {
  return TEXTURE_PRESETS.filter((p) => p.family === family);
}

export function getTexturePreset(id: string): TexturePreset | undefined {
  return PRESET_INDEX.get(id);
}

export function getDefaultFacadePresetId(style?: string): string {
  switch ((style ?? "").toLowerCase()) {
    case "brique":
    case "brick":
      return "brick/bricks101";
    case "bois":
    case "wood":
    case "bardage_bois":
      return "wood/planks023a";
    case "enduit":
    case "plaster":
      return "plaster/plaster001";
    case "beton":
    case "béton":
      return "concrete/concrete047a";
    case "metal":
    case "métal":
    case "zinc":
      return "procedural/metal_default";
    default:
      return "concrete/concrete047a";
  }
}

export function getDefaultRoofPresetId(): string {
  return "roof/roofingtiles014a";
}

export function getDefaultGroundPresetId(): string {
  return "ground/grass005";
}

export function getDefaultRoadPresetId(): string {
  return "road/road012a";
}

/**
 * Précharge explicitement un preset réel.
 * Pratique si tu veux lancer le chargement avant l'affichage.
 */
export function warmTexturePreset(presetId: string): void {
  const preset = PRESET_INDEX.get(presetId);
  if (!preset?.basePath) return;

  for (const kind of ["color", "normal", "roughness", "ao", "metalness"] as TextureKind[]) {
    const candidates = buildCandidateUrls(preset.basePath, kind);
    for (const url of candidates) {
      if (_failedUrls.has(url)) continue;
      ensureTextureRequested(url, kind === "color");
    }
  }
}

/**
 * Charge un bundle complet de textures PBR.
 *
 * IMPORTANT — alphaMap volontairement absent :
 * Les textures architecturales (brique, béton, bois, tuiles) n'ont pas de
 * fichier _Opacity.jpg. THREE.TextureLoader.load() ne lève PAS d'exception
 * synchrone sur une 404 : il retourne immédiatement une texture vide puis
 * signale l'erreur plus tard. Ici on ne considère donc une texture utilisable
 * que lorsqu'elle a réellement terminé son chargement avec succès.
 */
export function getTextureBundle(
  presetId: string,
  options?: {
    facadeWidthM?: number;
    facadeHeightM?: number;
    repeatScaleX?: number;
    repeatScaleY?: number;
    rotationDeg?: number;
  },
): TextureBundle {
  const preset = PRESET_INDEX.get(presetId);
  if (!preset) {
    return cloneBundle(getProceduralFallbackBundle("procedural/concrete_default"));
  }

  const repeat = resolveRepeat(preset, options);
  const rotationRad = getDefaultRotationForFamily(preset.family) + degToRad(options?.rotationDeg ?? 0);

  const cacheKey = [
    presetId,
    options?.facadeWidthM ?? "",
    options?.facadeHeightM ?? "",
    options?.repeatScaleX ?? "",
    options?.repeatScaleY ?? "",
    options?.rotationDeg ?? "",
    getTextureRevision(),
  ].join("|");

  return cachedBundle(cacheKey, () => {
    if (!preset.basePath) {
      return cloneBundle(getProceduralFallbackBundle(preset.id));
    }

    const bundle: TextureBundle = {
      map: tryLoadTexture(preset.basePath, "color", repeat, true, rotationRad),
      normalMap: tryLoadTexture(preset.basePath, "normal", repeat, false, rotationRad),
      roughnessMap: tryLoadTexture(preset.basePath, "roughness", repeat, false, rotationRad),
      aoMap: tryLoadTexture(preset.basePath, "ao", repeat, false, rotationRad),
      displacementMap: undefined, // volontairement désactivé pour éviter les artefacts
      metalnessMap: tryLoadTexture(preset.basePath, "metalness", repeat, false, rotationRad),
    };

    // Tant que la couleur réelle n'est pas prête, on bascule sur fallback propre.
    if (!bundle.map) {
      return cloneBundle(
        getProceduralFallbackBundleFromFamily(preset.family, preset.proceduralHex),
      );
    }

    return bundle;
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHARGEMENT DES TEXTURES RÉELLES
// ═══════════════════════════════════════════════════════════════════════════════

function resolveRepeat(
  preset: TexturePreset,
  options?: {
    facadeWidthM?: number;
    facadeHeightM?: number;
    repeatScaleX?: number;
    repeatScaleY?: number;
  },
): { x: number; y: number } {
  const width = Math.max(1, options?.facadeWidthM ?? 8);
  const height = Math.max(1, options?.facadeHeightM ?? 6);
  const sx = options?.repeatScaleX ?? 1;
  const sy = options?.repeatScaleY ?? 1;

  let rx = preset.repeat.x;
  let ry = preset.repeat.y;

  switch (preset.family) {
    case "brick":
      // Briques plus fines et crédibles : répétition forte
      rx = width / 0.95;
      ry = height / 0.28;
      break;

    case "concrete":
      rx = width / 2.8;
      ry = height / 2.8;
      break;

    case "wood":
      // Bardage vertical plus réaliste
      rx = width / 1.35;
      ry = height / 2.4;
      break;

    case "roof":
      rx = width / 1.8;
      ry = height / 1.4;
      break;

    case "ground":
    case "moss":
      rx = width / 1.1;
      ry = height / 1.1;
      break;

    case "road":
      rx = width / 2.2;
      ry = height / 2.2;
      break;

    case "metal":
      rx = width / 2.0;
      ry = height / 2.0;
      break;

    case "procedural":
    default:
      rx = preset.repeat.x;
      ry = preset.repeat.y;
      break;
  }

  return {
    x: Math.max(0.25, rx * sx),
    y: Math.max(0.25, ry * sy),
  };
}

function getDefaultRotationForFamily(family: TextureFamily): number {
  switch (family) {
    case "brick":
    case "concrete":
    case "wood":
    case "metal":
    case "roof":
    case "ground":
    case "road":
    case "moss":
    case "procedural":
    default:
      return 0;
  }
}

function getTextureSuffix(kind: TextureKind): string[] {
  switch (kind) {
    case "color":
      return [
        "_Color.jpg",
        "_Color.png",
        "_BaseColor.jpg",
        "_BaseColor.png",
        "_Albedo.jpg",
        "_Albedo.png",
        "_Col.jpg",
        "_Col.png",
      ];
    case "normal":
      return [
        "_NormalGL.jpg",
        "_NormalGL.png",
        "_Normal.jpg",
        "_Normal.png",
      ];
    case "roughness":
      return [
        "_Roughness.jpg",
        "_Roughness.png",
        "_Rough.jpg",
        "_Rough.png",
      ];
    case "ao":
      return [
        "_AO.jpg",
        "_AO.png",
        "_AmbientOcclusion.jpg",
        "_AmbientOcclusion.png",
      ];
    case "displacement":
      return [
        "_Displacement.jpg",
        "_Displacement.png",
        "_Height.jpg",
        "_Height.png",
      ];
    case "metalness":
      return [
        "_Metalness.jpg",
        "_Metalness.png",
      ];
    default:
      return [];
  }
}

function getBaseFileStem(basePath: string): string {
  const parts = basePath.split("/");
  return parts[parts.length - 1];
}

function buildCandidateUrls(basePath: string, kind: TextureKind): string[] {
  const stem = getBaseFileStem(basePath);
  const suffixes = getTextureSuffix(kind);
  const urls: string[] = [];

  for (const suffix of suffixes) {
    urls.push(`${basePath}${suffix}`);
    urls.push(`${basePath}/${stem}${suffix}`);
  }

  return [...new Set(urls)];
}

function cloneTextureForUse(
  source: THREE.Texture,
  repeat: { x: number; y: number },
  isColor: boolean,
  rotationRad: number,
): THREE.Texture {
  const tex = source.clone();
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat.x, repeat.y);
  tex.center.set(0.5, 0.5);
  tex.rotation = rotationRad;
  tex.anisotropy = 16;
  tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Tente de charger une texture depuis le disque.
 * Ici une texture n'est renvoyée que si elle est réellement prête.
 * Sinon on lance son chargement en tâche de fond puis on retourne undefined.
 */
function tryLoadTexture(
  basePath: string,
  kind: TextureKind,
  repeat: { x: number; y: number },
  isColor: boolean,
  rotationRad: number,
): THREE.Texture | undefined {
  const candidates = buildCandidateUrls(basePath, kind);

  for (const url of candidates) {
    if (_failedUrls.has(url)) continue;

    const state = _textureState.get(url) ?? "idle";

    if (state === "ready") {
      const source = _textureCache.get(url);
      if (source) {
        return cloneTextureForUse(source, repeat, isColor, rotationRad);
      }
    }

    if (state === "idle") {
      ensureTextureRequested(url, isColor);
    }
  }

  return undefined;
}

function ensureTextureRequested(url: string, isColor: boolean): void {
  if (_failedUrls.has(url)) return;

  const state = _textureState.get(url) ?? "idle";
  if (state === "pending" || state === "ready") return;

  _textureState.set(url, "pending");

  _loader.load(
    url,
    (texture) => {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(1, 1);
      texture.center.set(0.5, 0.5);
      texture.rotation = 0;
      texture.anisotropy = 16;
      texture.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.needsUpdate = true;

      const previous = _textureCache.get(url);
      if (previous && previous !== texture) previous.dispose();

      _textureCache.set(url, texture);
      _textureState.set(url, "ready");
      _textureRevision += 1;
    },
    undefined,
    () => {
      _failedUrls.add(url);
      _textureState.set(url, "failed");

      const previous = _textureCache.get(url);
      if (previous) previous.dispose();
      _textureCache.delete(url);

      _textureRevision += 1;
    },
  );
}

function cloneBundle(bundle: TextureBundle): TextureBundle {
  const cloneTex = (tex?: THREE.Texture): THREE.Texture | undefined => {
    if (!tex) return undefined;
    const t = tex.clone();
    t.needsUpdate = true;
    return t;
  };

  return {
    map: cloneTex(bundle.map),
    normalMap: cloneTex(bundle.normalMap),
    roughnessMap: cloneTex(bundle.roughnessMap),
    aoMap: cloneTex(bundle.aoMap),
    displacementMap: cloneTex(bundle.displacementMap),
    metalnessMap: cloneTex(bundle.metalnessMap),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// FALLBACKS PROCÉDURAUX
// ═══════════════════════════════════════════════════════════════════════════════

function getProceduralFallbackBundleFromFamily(
  family: TextureFamily,
  hex?: string,
): TextureBundle {
  switch (family) {
    case "wood":
      return {
        map: getWoodTexture(hex ?? "#B8956A"),
        normalMap: getWoodNormalTexture(),
      };
    case "brick":
      return {
        map: getBrickTexture(hex ?? "#C4826A"),
      };
    case "concrete":
      return {
        map: getConcreteTexture(hex ?? "#D6D0C4"),
        roughnessMap: getConcreteRoughnessTexture(),
      };
    case "metal":
      return {
        map: getMetalTexture(hex ?? "#8A9AA8"),
        roughnessMap: getMetalRoughnessTexture(),
      };
    default:
      return {
        map: getConcreteTexture("#D6D0C4"),
        roughnessMap: getConcreteRoughnessTexture(),
      };
  }
}

function getProceduralFallbackBundle(presetId: string): TextureBundle {
  switch (presetId) {
    case "procedural/wood_default":
      return {
        map: getWoodTexture("#B8956A"),
        normalMap: getWoodNormalTexture(),
      };
    case "procedural/brick_default":
      return {
        map: getBrickTexture("#C4826A"),
      };
    case "procedural/metal_default":
      return {
        map: getMetalTexture("#8A9AA8"),
        roughnessMap: getMetalRoughnessTexture(),
      };
    case "procedural/concrete_default":
    default:
      return {
        map: getConcreteTexture("#D6D0C4"),
        roughnessMap: getConcreteRoughnessTexture(),
      };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS INTERNES PROCÉDURAUX
// ═══════════════════════════════════════════════════════════════════════════════

function makeCanvas(
  w: number,
  h: number,
): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

function noiseAt(x: number, y: number, seed: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + seed) * 43758.5453123;
  return s - Math.floor(s);
}

function fbm(x: number, y: number, octaves = 3, seed = 0): number {
  let v = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    v += noiseAt(x * freq, y * freq, seed + i * 13) * amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return v;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function hexToRgb(hex: string): [number, number, number] {
  const c = new THREE.Color(hex);
  return [
    Math.round(c.r * 255),
    Math.round(c.g * 255),
    Math.round(c.b * 255),
  ];
}

function degToRad(v: number): number {
  return (v * Math.PI) / 180;
}

// ═══════════════════════════════════════════════════════════════════════════════
// BARDAGE BOIS PROCÉDURAL
// ═══════════════════════════════════════════════════════════════════════════════

export function getWoodTexture(hexBase = "#B8956A"): THREE.CanvasTexture {
  return cachedTexture(`wood_${hexBase}`, () => {
    const W = 512;
    const H = 1024;
    const [canvas, ctx] = makeCanvas(W, H);
    const [br, bg, bb] = hexToRgb(hexBase);

    const nPlanks = 12;
    const plankW = W / nPlanks;

    for (let i = 0; i < nPlanks; i++) {
      const px = i * plankW;

      const lum = 0.84 + noiseAt(i, 0, 7) * 0.28;
      const r = clamp(Math.round(br * lum), 0, 255);
      const g = clamp(Math.round(bg * lum), 0, 255);
      const b = clamp(Math.round(bb * lum), 0, 255);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(px, 0, plankW, H);

      for (let gi = 0; gi < 40; gi++) {
        const gx = px + noiseAt(i, gi, 0) * plankW;
        const opacity = 0.02 + noiseAt(i, gi, 1) * 0.10;
        const width = 0.3 + noiseAt(i, gi, 2) * 1.4;
        ctx.strokeStyle = `rgba(0,0,0,${opacity.toFixed(3)})`;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        let py = 0;
        while (py < H) {
          py += 12 + noiseAt(gx * 0.1, py * 0.02, 3) * 20;
          const drift = Math.sin(py * 0.035 + i * 0.8) * 3.5;
          ctx.lineTo(gx + drift, py);
        }
        ctx.stroke();
      }

      for (let gi = 0; gi < 8; gi++) {
        const gx = px + noiseAt(i, gi, 20) * plankW;
        const opacity = 0.04 + noiseAt(i, gi, 21) * 0.06;
        ctx.strokeStyle = `rgba(255,220,160,${opacity.toFixed(3)})`;
        ctx.lineWidth = 0.5 + noiseAt(i, gi, 22) * 0.8;
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        for (let py = 0; py < H; py += 18) {
          ctx.lineTo(gx + Math.sin(py * 0.04 + i) * 2, py);
        }
        ctx.stroke();
      }

      const grad = ctx.createLinearGradient(px + plankW - 5, 0, px + plankW, 0);
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(1, "rgba(0,0,0,0.28)");
      ctx.fillStyle = grad;
      ctx.fillRect(px + plankW - 5, 0, 5, H);

      if (noiseAt(i, 0, 99) > 0.6) {
        const kx = px + plankW * 0.5 + (noiseAt(i, 1, 99) - 0.5) * plankW * 0.4;
        const ky = H * noiseAt(i, 2, 99);
        const kr = 4 + noiseAt(i, 3, 99) * 10;
        const kg = ctx.createRadialGradient(kx, ky, 0, kx, ky, kr);
        kg.addColorStop(0, "rgba(40,20,8,0.55)");
        kg.addColorStop(0.6, "rgba(40,20,8,0.18)");
        kg.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = kg;
        ctx.beginPath();
        ctx.ellipse(kx, ky, kr, kr * 0.65, 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(0.7, 2.0);
    tex.center.set(0.5, 0.5);
    tex.rotation = 0;
    tex.anisotropy = 16;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }) as THREE.CanvasTexture;
}

export function getWoodNormalTexture(): THREE.CanvasTexture {
  return cachedTexture("wood_normal", () => {
    const W = 512;
    const H = 1024;
    const [canvas, ctx] = makeCanvas(W, H);

    ctx.fillStyle = "#8080ff";
    ctx.fillRect(0, 0, W, H);

    const nPlanks = 12;
    const plankW = W / nPlanks;

    for (let i = 0; i < nPlanks; i++) {
      const px = i * plankW;

      for (let gi = 0; gi < 20; gi++) {
        const gx = px + noiseAt(i, gi, 10) * plankW;
        ctx.strokeStyle = "rgba(80,80,255,0.28)";
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        for (let py = 0; py < H; py += 16) {
          ctx.lineTo(gx + Math.sin(py * 0.04 + i) * 2.5, py);
        }
        ctx.stroke();
      }

      ctx.fillStyle = "rgba(80,80,240,0.72)";
      ctx.fillRect(px + plankW - 3, 0, 3, H);
      ctx.fillStyle = "rgba(160,160,255,0.55)";
      ctx.fillRect(px + plankW - 6, 0, 3, H);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(0.7, 2.0);
    tex.center.set(0.5, 0.5);
    tex.rotation = 0;
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    return tex;
  }) as THREE.CanvasTexture;
}

// ═══════════════════════════════════════════════════════════════════════════════
// BÉTON PROCÉDURAL
// ═══════════════════════════════════════════════════════════════════════════════

export function getConcreteTexture(hexBase = "#D6D0C4"): THREE.CanvasTexture {
  return cachedTexture(`concrete_${hexBase}`, () => {
    const W = 512;
    const H = 512;
    const [canvas, ctx] = makeCanvas(W, H);
    const [br, bg, bb] = hexToRgb(hexBase);

    const imgData = ctx.createImageData(W, H);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const px = (i / 4) % W;
      const py = Math.floor(i / 4 / W);
      const n = fbm(px * 0.018, py * 0.018, 4, 0);
      const lum = 0.78 + n * 0.34;
      d[i] = clamp(Math.round(br * lum), 0, 255);
      d[i + 1] = clamp(Math.round(bg * lum), 0, 255);
      d[i + 2] = clamp(Math.round(bb * lum), 0, 255);
      d[i + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);

    let y = 0;
    while (y < H) {
      const jitterH = 60 + noiseAt(0, y, 5) * 24;
      ctx.strokeStyle = `rgba(0,0,0,${(0.04 + noiseAt(y, 0, 6) * 0.06).toFixed(3)})`;
      ctx.lineWidth = 0.6 + noiseAt(y, 1, 7) * 0.8;
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x < W; x += 8) {
        ctx.lineTo(x, y + (noiseAt(x, y, 8) - 0.5) * 1.5);
      }
      ctx.stroke();
      y += jitterH;
    }

    for (let f = 0; f < 5; f++) {
      const fx = noiseAt(f, 0, 30) * W;
      const fy = noiseAt(f, 1, 30) * H;
      ctx.strokeStyle = "rgba(0,0,0,0.06)";
      ctx.lineWidth = 0.4;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      let cx2 = fx;
      let cy2 = fy;
      for (let s = 0; s < 8; s++) {
        cx2 += (noiseAt(f, s, 31) - 0.5) * 20;
        cy2 += (noiseAt(f, s, 32) - 0.5) * 8;
        ctx.lineTo(cx2, cy2);
      }
      ctx.stroke();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1.2, 1.8);
    tex.center.set(0.5, 0.5);
    tex.rotation = 0;
    tex.anisotropy = 8;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }) as THREE.CanvasTexture;
}

export function getConcreteRoughnessTexture(): THREE.CanvasTexture {
  return cachedTexture("concrete_roughness", () => {
    const W = 256;
    const H = 256;
    const [canvas, ctx] = makeCanvas(W, H);
    const d = ctx.createImageData(W, H);
    for (let i = 0; i < d.data.length; i += 4) {
      const px = (i / 4) % W;
      const py = Math.floor(i / 4 / W);
      const n = fbm(px * 0.04, py * 0.04, 3, 42);
      const v = Math.round(clamp(195 + n * 60, 0, 255));
      d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
      d.data[i + 3] = 255;
    }
    ctx.putImageData(d, 0, 0);

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1.2, 1.8);
    tex.center.set(0.5, 0.5);
    tex.rotation = 0;
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    return tex;
  }) as THREE.CanvasTexture;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MÉTAL PROCÉDURAL
// ═══════════════════════════════════════════════════════════════════════════════

export function getMetalTexture(hexBase = "#8A9AA8"): THREE.CanvasTexture {
  return cachedTexture(`metal_${hexBase}`, () => {
    const W = 512;
    const H = 512;
    const [canvas, ctx] = makeCanvas(W, H);
    const [br, bg, bb] = hexToRgb(hexBase);

    ctx.fillStyle = hexBase;
    ctx.fillRect(0, 0, W, H);

    const imgData = ctx.createImageData(W, H);
    const d = imgData.data;
    for (let py = 0; py < H; py++) {
      const nLow = noiseAt(0, py * 0.012, 0);
      const nHigh = noiseAt(0, py * 0.9, 1);
      const lum = 0.7 + nLow * 0.48 + nHigh * 0.1;
      const r = clamp(Math.round(br * lum), 0, 255);
      const g = clamp(Math.round(bg * lum), 0, 255);
      const b = clamp(Math.round(bb * lum), 0, 255);
      for (let px = 0; px < W; px++) {
        const nX = noiseAt(px * 0.005, py * 0.005, 2) * 0.08;
        const ri = i4(px, py, W);
        d[ri] = clamp(r + Math.round(nX * 40), 0, 255);
        d[ri + 1] = clamp(g + Math.round(nX * 40), 0, 255);
        d[ri + 2] = clamp(b + Math.round(nX * 50), 0, 255);
        d[ri + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);

    for (let i = 0; i < 4; i++) {
      const rx = noiseAt(i, 0, 50) * W;
      const ry = noiseAt(i, 1, 50) * H;
      const rr = 60 + noiseAt(i, 2, 50) * 100;
      const grad = ctx.createRadialGradient(rx, ry, 0, rx, ry, rr);
      grad.addColorStop(0, "rgba(255,255,255,0.14)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1.0, 1.0);
    tex.center.set(0.5, 0.5);
    tex.rotation = 0;
    tex.anisotropy = 16;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }) as THREE.CanvasTexture;
}

export function getMetalRoughnessTexture(): THREE.CanvasTexture {
  return cachedTexture("metal_roughness", () => {
    const W = 256;
    const H = 256;
    const [canvas, ctx] = makeCanvas(W, H);
    const imgData = ctx.createImageData(W, H);

    for (let i = 0; i < imgData.data.length; i += 4) {
      const py = Math.floor(i / 4 / W);
      const n = noiseAt(0, py * 0.9, 3);
      const v = Math.round(clamp(80 + n * 80, 0, 200));
      imgData.data[i] = imgData.data[i + 1] = imgData.data[i + 2] = v;
      imgData.data[i + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 1);
    tex.center.set(0.5, 0.5);
    tex.rotation = 0;
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    return tex;
  }) as THREE.CanvasTexture;
}

// ═══════════════════════════════════════════════════════════════════════════════
// BRIQUE PROCÉDURALE
// ═══════════════════════════════════════════════════════════════════════════════

export function getBrickTexture(hexBase = "#C4826A"): THREE.CanvasTexture {
  return cachedTexture(`brick_${hexBase}`, () => {
    const W = 1024;
    const H = 1024;
    const [canvas, ctx] = makeCanvas(W, H);
    const [br, bg, bb] = hexToRgb(hexBase);

    const brickH = 26;
    const brickW = 64;
    const jointW = 3;
    const nRows = Math.ceil(H / brickH);
    const nCols = Math.ceil(W / brickW) + 1;

    ctx.fillStyle = "#C7C0B7";
    ctx.fillRect(0, 0, W, H);

    for (let row = 0; row < nRows; row++) {
      const offsetX = row % 2 === 0 ? 0 : brickW / 2;

      for (let col = -1; col < nCols; col++) {
        const bx = col * brickW - offsetX;
        const by = row * brickH;

        const lum = 0.82 + noiseAt(col, row, 0) * 0.30;
        const rr = clamp(Math.round(br * lum), 0, 255);
        const rg = clamp(Math.round(bg * lum * 0.96), 0, 255);
        const rb = clamp(Math.round(bb * lum * 0.92), 0, 255);

        const x = bx + jointW;
        const y = by + jointW;
        const w = brickW - jointW;
        const h = brickH - jointW;

        if (x > W || y > H || x + w < 0 || y + h < 0) continue;

        ctx.fillStyle = `rgb(${rr},${rg},${rb})`;
        ctx.fillRect(x, y, w, h);

        for (let dy = 0; dy < h; dy++) {
          for (let dx = 0; dx < w; dx++) {
            const n = noiseAt((bx + dx) * 0.08, (by + dy) * 0.12, row + col);
            const lum2 = 0.90 + n * 0.18;
            ctx.fillStyle = `rgba(${Math.round(rr * lum2)},${Math.round(rg * lum2)},${Math.round(rb * lum2)},0.18)`;
            ctx.fillRect(x + dx, y + dy, 1, 1);
          }
        }
      }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1.0, 1.0);
    tex.center.set(0.5, 0.5);
    tex.rotation = 0;
    tex.anisotropy = 8;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }) as THREE.CanvasTexture;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER
// ═══════════════════════════════════════════════════════════════════════════════

function i4(px: number, py: number, W: number): number {
  return (py * W + px) * 4;
}