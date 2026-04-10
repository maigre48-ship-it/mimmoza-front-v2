// src/spaces/promoteur/pages/FacadeGeneratorPage.tsx
// -----------------------------------------------------------------------------
// Générateur de façades -- V5.3
//
// -- CHANGELOG ----------------------------------------------------------------
// [ÉTAPE 1] Export PNG de la preview 2D (SVG -> canvas -> base64)
// [ÉTAPE 2] Payload V2 dans requestFacadeAiRender
// [ÉTAPE 3] Avertissement PLU non bloquant
// [CORRECTIF] Bug preview nbEtages
// [V3] Mise en scène + second bouton + suppression UI Blender
// [V4] Pipeline footprint réel -- resolveSelectedBuildingId multi-flags,
//      buildFacadeSceneInput + buildFacadeRenderSpec, configToFacade2DInput
//      avec dims dynamiques, payload strictement typé
// [V5] Mini masse isométrique dans le PNG de référence IA
// [V5.1 FIX] rawFootprintPts -- priorité facadeSceneInput.footprint brut
// [V5.2 PATCH] sanitizeFootprintForAi + payload footprintPoints injecté
// [V5.3 FIX] fallback direct editor2d + normalizedFootprintPoints + clean depthM
//   - extractRawFootprintFromBuildingRecord pour diagnostic local robuste
//   - rawFootprintPts priorise sceneInput puis footprintMeta puis editor2d
//   - normalizeFootprintForAi ajouté pour payload AI plus exploitable
//   - depthM nettoyé (suppression doublon inutile)
//   - logs debug enrichis
// [V5.4] Ajout style "Photo réaliste" + avertissement complexité footprint
// -----------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter";
import {
  ChevronRight, Wand2, ArrowLeft, Layers, ImageOff, Sun, Cloud, Sunset,
  TreePine, AlertCircle, RefreshCw, Download, Eye, Building2, Paintbrush,
  Users, ShoppingBag, Flower2, FileText, Check,
} from "lucide-react";

import { useLocalBlenderRender } from "../terrain3d/blender/useLocalBlenderRender";
import type { FacadeConfig } from "../terrain3d/facade/buildFacadeSceneInput";
import { buildFacadeSceneInput }  from "../terrain3d/facade/buildFacadeSceneInput";
import { buildFacadeRenderSpec }  from "../terrain3d/facade/buildFacadeRenderSpec";
import { captureFacadeSvg }       from "../terrain3d/facade/captureFacadeSvg";
import { buildFacadeAiPrompt }    from "../terrain3d/facade/buildFacadeAiPrompt";
import { requestFacadeAiRender }  from "../terrain3d/facade/requestFacadeAiRender";
import type { FacadeAiPromptInput } from "../terrain3d/facade/facadeAi.types";

import { buildFacade2DModel }    from "../terrain3d/facade2d/buildFacade2DModel";
import Facade2DSvgRenderer       from "../terrain3d/facade2d/renderFacade2DSvg";
import type {
  Facade2DStylePresetId, Facade2DBuildInput,
  Facade2DRhythm, Facade2DAmbiance, Facade2DVegetation,
} from "../terrain3d/facade2d/facade2d.types";

import { useEditor2DStore }          from "../plan2d/editor2d.store";
import { usePromoteurProjectStore }  from "../store/promoteurProject.store";
import {
  extractFromEditor2D, extractFromProjectStore, resolveFacadeProjectInput,
} from "../terrain3d/facade2d/resolveFacadeProjectInput";
import { computeLevelOpenings, toCenteredX } from "../terrain3d/facade2d/computeFacadeBays";

// -----------------------------------------------------------------------------
// Types locaux
// -----------------------------------------------------------------------------

type Style            = FacadeConfig["style"];
type Ambiance         = FacadeConfig["ambiance"];
type Vegetation       = FacadeConfig["vegetation"];
type ViewMode         = NonNullable<FacadeAiPromptInput["view"]>;
type BuildingStandard = NonNullable<FacadeAiPromptInput["buildingStandard"]>;
type DrawingStyle     = NonNullable<FacadeAiPromptInput["drawingStyle"]> | "photo_realiste" | "esquisse_architecte";
type Preset           = {
  id: string;
  label: string;
  description: string;
  config: Partial<FacadeConfig>;
  color: string;
};

/** Point 2D générique (monde ou écran) */
type Pt2D = { x: number; y: number };

// -----------------------------------------------------------------------------
// Couleur helpers
// -----------------------------------------------------------------------------

export function darken(hex: number, amount: number): number {
  const r = ((hex >> 16) & 0xff) / 255;
  const g = ((hex >> 8)  & 0xff) / 255;
  const b = (hex & 0xff) / 255;
  return (Math.round(Math.max(0, r - amount) * 255) << 16) |
         (Math.round(Math.max(0, g - amount) * 255) << 8)  |
          Math.round(Math.max(0, b - amount) * 255);
}

export function lighten(hex: number, amount: number): number {
  const r = ((hex >> 16) & 0xff) / 255;
  const g = ((hex >> 8)  & 0xff) / 255;
  const b = (hex & 0xff) / 255;
  return (Math.round(Math.min(1, r + amount) * 255) << 16) |
         (Math.round(Math.min(1, g + amount) * 255) << 8)  |
          Math.round(Math.min(1, b + amount) * 255);
}

export function toHexString(hex: number): string {
  return `#${hex.toString(16).padStart(6, "0")}`;
}

// -----------------------------------------------------------------------------
// Zone materials
// -----------------------------------------------------------------------------

type ZoneMaterialDef = { color: number; roughness: number; metalness: number };
export type ZoneMaterials = {
  soubassement: ZoneMaterialDef;
  corps: ZoneMaterialDef;
  attique: ZoneMaterialDef;
};

export function getZoneMaterials(config: FacadeConfig): ZoneMaterials {
  const bc = FACADE_COLORS[config.materiauFacade] ?? 0xe0ddd5;

  switch (config.style) {
    case "contemporain":
      return {
        soubassement: { color: darken(bc, 0.18), roughness: 0.88, metalness: 0.0 },
        corps:        { color: bc,               roughness: 0.8,  metalness: 0.0 },
        attique:      { color: lighten(bc, 0.12), roughness: 0.75, metalness: 0.0 },
      };
    case "premium":
      return {
        soubassement: { color: 0x8a7d6a, roughness: 0.92, metalness: 0.0 },
        corps:        { color: bc,       roughness: 0.72, metalness: 0.05 },
        attique:      { color: 0xb8bec4, roughness: 0.45, metalness: 0.35 },
      };
    case "haussmannien":
      return {
        soubassement: { color: 0x9e8e72, roughness: 0.92, metalness: 0.0 },
        corps:        { color: 0xd4c4a0, roughness: 0.88, metalness: 0.0 },
        attique:      { color: 0x6e7a7e, roughness: 0.5,  metalness: 0.55 },
      };
    case "mediterraneen":
      return {
        soubassement: { color: darken(bc, 0.15), roughness: 0.9,  metalness: 0.0 },
        corps:        { color: bc,               roughness: 0.85, metalness: 0.0 },
        attique:      { color: lighten(bc, 0.2), roughness: 0.8,  metalness: 0.0 },
      };
    default:
      return {
        soubassement: { color: darken(bc, 0.12), roughness: 0.85, metalness: 0.0 },
        corps:        { color: bc,               roughness: 0.82, metalness: 0.0 },
        attique:      { color: bc,               roughness: 0.82, metalness: 0.0 },
      };
  }
}

// -----------------------------------------------------------------------------
// Constantes géométriques (W/D = fallback uniquement)
// -----------------------------------------------------------------------------

const FLOOR_H = 3.0;
const RDC_H   = 4.0;
const ATTIC_H = 3.2;

const W = 20;
const D = 12;

const FACADE_COLORS: Record<string, number> = {
  "Enduit blanc": 0xf2f2ee,
  "Enduit beige": 0xe0d0b0,
  "Pierre de taille": 0xcbbc9e,
  "Brique rouge": 0xb86148,
  "Bardage bois": 0x8c6038,
  "Composite HPL": 0x999ea6,
  "Béton architectonique": 0xa5a5a1,
};

const TOITURE_COLORS: Record<string, number> = {
  "Zinc joint debout": 0x737f80,
  "Tuile canal": 0xb86a48,
  "Tuile mécanique": 0x944d38,
  "Ardoise": 0x4a4d54,
  "Toiture terrasse végétalisée": 0x4d8a40,
  "Toiture terrasse gravier": 0xaeaaa6,
};

const MENUISERIES_COLORS: Record<string, number> = {
  "Aluminium gris anthracite": 0x262626,
  "Aluminium blanc": 0xe8e8e8,
  "PVC blanc": 0xf2f2f2,
  "Bois naturel": 0x9e7348,
  "Bois peint sombre": 0x2e2820,
};

function computeHeight(config: FacadeConfig): number {
  return RDC_H + Math.max(0, config.nbEtages - 1) * FLOOR_H + (config.attique ? ATTIC_H : 0);
}

// -----------------------------------------------------------------------------
// Sélection / fallback bâtiment
// -----------------------------------------------------------------------------

const SELECTION_FLAGS = [
  "selected",
  "isSelected",
  "active",
  "isCurrent",
  "focused",
  "isActive",
] as const;

function hasUsableShape(b: Record<string, unknown>): boolean {
  const candidates = [
    b.footprint,
    b.polygon,
    b.points,
    b.outline,
    (b.geometry as Record<string, unknown> | undefined)?.footprint,
    (b.geometry as Record<string, unknown> | undefined)?.polygon,
  ];

  return candidates.some((c) => Array.isArray(c) && c.length >= 3);
}

function resolveSelectedBuildingId(buildings: unknown[]): string | null {
  if (!Array.isArray(buildings) || buildings.length === 0) return null;

  const typed = buildings.filter((b): b is Record<string, unknown> => !!b && typeof b === "object");

  const flagged = typed.find((b) => SELECTION_FLAGS.some((f) => b[f] === true));
  if (flagged && typeof flagged.id === "string" && flagged.id.trim()) {
    console.log("[MMZ][FacadeGeneratorPage] Bâtiment sélectionné par flag:", flagged.id);
    return flagged.id;
  }

  const withShape = typed.filter((b) => typeof b.id === "string" && hasUsableShape(b));
  if (withShape.length === 1) {
    console.log("[MMZ][FacadeGeneratorPage] Bâtiment unique avec emprise exploitable:", withShape[0]!.id);
    return String(withShape[0]!.id);
  }

  if (typed.length === 1) {
    const only = typed[0]!;
    if (typeof only.id === "string" && only.id.trim()) {
      console.log("[MMZ][FacadeGeneratorPage] Bâtiment unique — utilisé sans sélection explicite:", only.id);
      return only.id;
    }
  }

  console.log(`[MMZ][FacadeGeneratorPage] Aucun bâtiment résolu (${typed.length} dispo) — fallback géométrique`);
  return null;
}

function coercePointLike(v: unknown): Pt2D | null {
  if (!v || typeof v !== "object") return null;
  const p = v as Record<string, unknown>;

  const x = typeof p.x === "number" ? p.x : null;
  const y = typeof p.y === "number" ? p.y : null;

  if (x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function extractRawFootprintFromBuildingRecord(b: unknown): Pt2D[] {
  if (!b || typeof b !== "object") return [];
  const r = b as Record<string, unknown>;

  const candidates: unknown[] = [
    r.footprint,
    r.polygon,
    r.points,
    r.outline,
    (r.geometry as Record<string, unknown> | undefined)?.footprint,
    (r.geometry as Record<string, unknown> | undefined)?.polygon,
    (r.geometry as Record<string, unknown> | undefined)?.points,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      const pts = candidate.map(coercePointLike).filter((p): p is Pt2D => !!p);
      if (pts.length >= 3) return pts;
    }
  }

  return [];
}

// -----------------------------------------------------------------------------
// [V5] Mini masse isométrique -- helpers purs
// -----------------------------------------------------------------------------

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function isoProject(wx: number, wy: number, wz: number, scale: number): Pt2D {
  const ISO_CX = 0.866;
  const ISO_CY = 0.5;
  return {
    x: (wx - wy) * ISO_CX * scale,
    y: (wx + wy) * ISO_CY * scale - wz * scale * 0.82,
  };
}

function svgPts(pts: Pt2D[]): string {
  return pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}

interface MassWall {
  pts: Pt2D[];
  shade: "front" | "side";
}
interface MassGeo {
  botPts: Pt2D[];
  topPts: Pt2D[];
  walls: MassWall[];
}

function computeMassGeo(
  rawPts: Pt2D[],
  nbEtages: number,
  svgW: number,
  svgH: number,
): MassGeo | null {
  if (rawPts.length < 3) return null;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const p of rawPts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const range = Math.max(maxX - minX, maxY - minY, 0.001);
  const norm = (p: Pt2D): Pt2D => ({ x: (p.x - minX) / range, y: (p.y - minY) / range });
  const nPts = rawPts.map(norm);
  const n    = nPts.length;

  const wz = Math.min((nbEtages * 3.0 + 4.0) / 28, 0.95);

  const SCALE = Math.min(svgW, svgH) * 0.35;
  const cx    = svgW / 2 + SCALE * 0.06;
  const cy    = svgH * 0.65;

  const proj = (p: Pt2D, z: number): Pt2D => {
    const s = isoProject(p.x - 0.5, p.y - 0.5, z, SCALE);
    return { x: cx + s.x, y: cy + s.y };
  };

  const botPts = nPts.map((p) => proj(p, 0));
  const topPts = nPts.map((p) => proj(p, wz));

  const walls: MassWall[] = [];
  for (let i = 0; i < n; i++) {
    const a = nPts[i]!;
    const b = nPts[(i + 1) % n]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const facingA = dy - dx;
    const facingB = dx - dy;
    const best = Math.max(facingA, facingB);

    if (best > 0.005) {
      walls.push({
        pts: [botPts[i]!, botPts[(i + 1) % n]!, topPts[(i + 1) % n]!, topPts[i]!],
        shade: facingA >= facingB ? "front" : "side",
      });
    }
  }

  return { botPts, topPts, walls };
}

function buildMassInsetSvg(
  rawPts: Pt2D[],
  nbEtages: number,
  svgW: number,
  svgH: number,
): string | null {
  const geo = computeMassGeo(rawPts, nbEtages, svgW, svgH);
  if (!geo) return null;

  const { botPts, topPts, walls } = geo;
  const sides  = walls.filter((w) => w.shade === "side");
  const fronts = walls.filter((w) => w.shade === "front");

  const body = [
    ...sides.map((w) => `<polygon points="${svgPts(w.pts)}" fill="#c2bfb8" stroke="#7a7870" stroke-width="0.7"/>`),
    ...fronts.map((w) => `<polygon points="${svgPts(w.pts)}" fill="#d6d3cc" stroke="#7a7870" stroke-width="0.7"/>`),
    `<polygon points="${svgPts(topPts)}" fill="#e8e5de" stroke="#7a7870" stroke-width="0.7"/>`,
    `<polygon points="${svgPts(botPts)}" fill="none" stroke="#aaa89e" stroke-width="0.45" stroke-dasharray="2,2"/>`,
  ].join("\n  ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">
  ${body}
</svg>`;
}

function FootprintMassInset({
  rawPts,
  nbEtages,
  svgW = 118,
  svgH = 100,
}: {
  rawPts: Pt2D[];
  nbEtages: number;
  svgW?: number;
  svgH?: number;
}) {
  const geo = computeMassGeo(rawPts, nbEtages, svgW, svgH);
  if (!geo) return null;

  const { botPts, topPts, walls } = geo;
  const sides  = walls.filter((w) => w.shade === "side");
  const fronts = walls.filter((w) => w.shade === "front");

  return (
    <svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} style={{ display: "block" }}>
      {sides.map((w, i) => (
        <polygon key={`s${i}`} points={svgPts(w.pts)} fill="#c2bfb8" stroke="#7a7870" strokeWidth="0.7" />
      ))}
      {fronts.map((w, i) => (
        <polygon key={`f${i}`} points={svgPts(w.pts)} fill="#d6d3cc" stroke="#7a7870" strokeWidth="0.7" />
      ))}
      <polygon points={svgPts(topPts)} fill="#e8e5de" stroke="#7a7870" strokeWidth="0.7" />
      <polygon points={svgPts(botPts)} fill="none" stroke="#aaa89e" strokeWidth="0.45" strokeDasharray="2,2" />
    </svg>
  );
}

// -----------------------------------------------------------------------------
// Fenêtres & GLTF
// -----------------------------------------------------------------------------

function addOpeningMeshes(
  scene: THREE.Scene,
  np: string,
  cx: number,
  cy: number,
  ow: number,
  oh: number,
  wz: number,
  fd: number,
  gd: number,
  fb: number,
  gm: THREE.MeshStandardMaterial,
  fm: THREE.MeshStandardMaterial,
): void {
  const fM = new THREE.Mesh(new THREE.BoxGeometry(ow + fb * 2, oh + fb * 2, fd), fm);
  fM.name = `${np}_frame`;
  fM.position.set(cx, cy, wz - (fd - gd) / 2);
  scene.add(fM);

  const gM = new THREE.Mesh(new THREE.BoxGeometry(ow, oh, gd), gm);
  gM.name = `${np}_glass`;
  gM.position.set(cx, cy, wz);
  scene.add(gM);
}

function addWindowsToScene(
  scene: THREE.Scene,
  config: FacadeConfig,
  gm: THREE.MeshStandardMaterial,
  fm: THREE.MeshStandardMaterial,
): void {
  const WZ = -D / 2 - 0.05;
  const rh = mapRhythm(config.rythme);

  {
    const { layout, openingSpecs } = computeLevelOpenings(W, rh, "base");
    layout.centerXs.forEach((xl, i) => {
      const s = openingSpecs[i];
      addOpeningMeshes(scene, `rdc_${i}`, toCenteredX(xl, W), 0.02 + s.heightM / 2, s.widthM, s.heightM, WZ, 0.06, 0.04, 0.06, gm, fm);
    });
  }

  for (let fl = 1; fl < config.nbEtages; fl++) {
    const by = RDC_H + (fl - 1) * FLOOR_H;
    const { layout, openingSpecs } = computeLevelOpenings(W, rh, "typical");
    layout.centerXs.forEach((xl, i) => {
      const s = openingSpecs[i];
      addOpeningMeshes(scene, `floor${fl}_${i}`, toCenteredX(xl, W), by + 0.6 + s.heightM / 2, s.widthM, s.heightM, WZ, 0.06, 0.04, 0.06, gm, fm);
    });
  }

  if (config.attique) {
    const ab = RDC_H + Math.max(0, config.nbEtages - 1) * FLOOR_H;
    const { layout, openingSpecs } = computeLevelOpenings(W, rh, "attic");
    layout.centerXs.forEach((xl, i) => {
      const s = openingSpecs[i];
      addOpeningMeshes(scene, `attique_${i}`, toCenteredX(xl, W * 0.85), ab + 0.6 + s.heightM / 2, s.widthM, s.heightM, WZ, 0.06, 0.04, 0.06, gm, fm);
    });
  }
}

function addBalconyRailing(
  scene: THREE.Scene,
  floor: number,
  bz: number,
  config: FacadeConfig,
  mm: THREE.MeshStandardMaterial,
  rw: number,
  fz: number,
  pfx = "rail",
): void {
  let sp = 0.115;
  let bW = 0.025;

  if (config.style === "haussmannien") {
    sp = 0.08;
    bW = 0.03;
  } else if (config.style === "contemporain" || config.style === "premium") {
    sp = 0.14;
    bW = 0.018;
  } else if (config.style === "mediterraneen") {
    sp = 0.1;
    bW = 0.028;
  }

  const tM = new THREE.Mesh(new THREE.BoxGeometry(rw, 0.04, 0.04), mm);
  tM.name = `${pfx}_top_n${floor}`;
  tM.position.set(0, bz + 0.96, fz);
  scene.add(tM);

  const bM = new THREE.Mesh(new THREE.BoxGeometry(rw, 0.04, 0.04), mm);
  bM.name = `${pfx}_bot_n${floor}`;
  bM.position.set(0, bz + 0.08, fz);
  scene.add(bM);

  const n = Math.max(1, Math.floor(rw / sp));
  const s2 = rw / n;
  const sx = -(rw / 2) + s2 / 2;
  const bH = 0.84;
  const bCY = bz + 0.08 + bH / 2;

  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(bW, bH, 0.025), mm, n);
  inst.name = `barreaux_n${floor}${pfx !== "rail" ? `_${pfx}` : ""}`;

  const d = new THREE.Object3D();
  for (let i = 0; i < n; i++) {
    d.position.set(sx + i * s2, bCY, fz);
    d.updateMatrix();
    inst.setMatrixAt(i, d.matrix);
  }
  inst.instanceMatrix.needsUpdate = true;
  scene.add(inst);
}

async function buildFacadeGltfBlob(config: FacadeConfig): Promise<Blob> {
  const scene = new THREE.Scene();
  const h = computeHeight(config);

  const tC = TOITURE_COLORS[config.materiauToiture] ?? 0x808080;
  const mC = MENUISERIES_COLORS[config.materiauMenuiseries] ?? 0x303030;
  const zm = getZoneMaterials(config);

  const sM = new THREE.MeshStandardMaterial({
    color: zm.soubassement.color,
    roughness: zm.soubassement.roughness,
    metalness: zm.soubassement.metalness,
    name: "MMZ_soubassement",
  });
  const fM = new THREE.MeshStandardMaterial({
    color: zm.corps.color,
    roughness: zm.corps.roughness,
    metalness: zm.corps.metalness,
    name: "MMZ_facade",
  });
  const aM = new THREE.MeshStandardMaterial({
    color: zm.attique.color,
    roughness: zm.attique.roughness,
    metalness: zm.attique.metalness,
    name: "MMZ_attique",
  });
  const tM = new THREE.MeshStandardMaterial({
    color: tC,
    roughness: 0.7,
    metalness: 0.2,
    name: "MMZ_toiture",
  });
  const mm = new THREE.MeshStandardMaterial({
    color: mC,
    roughness: 0.35,
    metalness: 0.7,
    name: "MMZ_menuiseries",
  });

  const su = new THREE.Mesh(new THREE.BoxGeometry(W, RDC_H, D), sM);
  su.name = "facade_soubassement";
  su.position.set(0, RDC_H / 2, 0);
  scene.add(su);

  const CH = Math.max(0, config.nbEtages - 1) * FLOOR_H;
  if (CH > 0) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(W, CH, D), fM);
    c.name = "facade_corps";
    c.position.set(0, RDC_H + CH / 2, 0);
    scene.add(c);
  }

  if (config.style === "haussmannien" || config.style === "premium") {
    const bM2 = new THREE.MeshStandardMaterial({
      color: 0x8a7a60,
      roughness: 0.88,
      metalness: 0.0,
      name: "MMZ_bandeau",
    });
    const b = new THREE.Mesh(new THREE.BoxGeometry(W + 0.1, 0.22, D + 0.1), bM2);
    b.name = "facade_bandeau";
    b.position.set(0, RDC_H + 0.11, 0);
    scene.add(b);
  }

  const gm = new THREE.MeshStandardMaterial({
    color: 0x1a2a3a,
    roughness: 0.05,
    metalness: 0.9,
    name: "MMZ_vitrage",
  });
  const fm = new THREE.MeshStandardMaterial({
    color: mC,
    roughness: 0.35,
    metalness: config.materiauMenuiseries.includes("Aluminium") ? 0.8 : 0.1,
    name: "MMZ_cadre",
  });

  addWindowsToScene(scene, config, gm, fm);

  if (config.attique) {
    const at = new THREE.Mesh(new THREE.BoxGeometry(W * 0.85, ATTIC_H, D * 0.85), aM);
    at.name = "facade_attique";
    at.position.set(0, h - ATTIC_H + ATTIC_H / 2, 0);
    scene.add(at);
  }

  const r = new THREE.Mesh(new THREE.BoxGeometry(W + 0.3, 0.4, D + 0.3), tM);
  r.name = "facade_toiture";
  r.position.set(0, h + 0.2, 0);
  scene.add(r);

  if (config.balcons) {
    const bm = new THREE.MeshStandardMaterial({ color: 0xc8c5c0, roughness: 0.9, metalness: 0.0 });
    for (let fl = 1; fl < config.nbEtages; fl++) {
      const z = RDC_H + fl * FLOOR_H - 0.1;
      const b2 = new THREE.Mesh(new THREE.BoxGeometry(W, 0.18, 1.2), bm);
      b2.name = `balcon_n${fl}`;
      b2.position.set(0, z + 0.09, -D / 2 - 0.6);
      scene.add(b2);
      addBalconyRailing(scene, fl, z + 0.18, config, mm, W, -D / 2 - 1.18);
    }
  }

  if (config.loggias) {
    const bm = new THREE.MeshStandardMaterial({ color: 0xc8c5c0, roughness: 0.9, metalness: 0.0 });
    for (let fl = 1; fl < config.nbEtages; fl++) {
      const z = RDC_H + fl * FLOOR_H - 0.1;
      const l = new THREE.Mesh(new THREE.BoxGeometry(W * 0.5, 0.12, 0.9), bm);
      l.name = `loggia_n${fl}`;
      l.position.set(0, z + 0.06, D / 2 + 0.45);
      scene.add(l);
      addBalconyRailing(scene, fl, z + 0.12, config, mm, W * 0.5, D / 2 + 0.88, "loggia");
    }
  }

  if (config.corniche) {
    const c2 = new THREE.Mesh(new THREE.BoxGeometry(W + 0.6, 0.5, D + 0.6), tM);
    c2.name = "facade_corniche";
    c2.position.set(0, h - 0.25, 0);
    scene.add(c2);
  }

  if (config.socle) {
    const s2 = new THREE.Mesh(new THREE.BoxGeometry(W + 0.2, 0.6, D + 0.2), tM);
    s2.name = "facade_socle";
    s2.position.set(0, 0.3, 0);
    scene.add(s2);
  }

  const g = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 60),
    new THREE.MeshStandardMaterial({ color: 0x595955, roughness: 0.95, metalness: 0.0 }),
  );
  g.name = "TERRAIN_ground";
  g.rotation.x = -Math.PI / 2;
  g.position.set(0, -0.01, 0);
  scene.add(g);

  return new Promise((res, rej) =>
    new GLTFExporter().parse(
      scene,
      (r2) =>
        res(
          r2 instanceof ArrayBuffer
            ? new Blob([r2], { type: "model/gltf-binary" })
            : new Blob([JSON.stringify(r2)], { type: "model/gltf+json" }),
        ),
      (e) => rej(new Error(`GLTFExporter: ${String(e)}`)),
      { binary: true },
    ),
  );
}

// -----------------------------------------------------------------------------
// UI constants
// -----------------------------------------------------------------------------

const STYLES: { id: Style; label: string; desc: string }[] = [
  { id: "contemporain",  label: "Contemporain",          desc: "Lignes épurées, matériaux nobles, fenêtres larges" },
  { id: "standard",      label: "Résidentiel standard",  desc: "Collectif traditionnel, équilibré et économique" },
  { id: "premium",       label: "Premium moderne",       desc: "Architecte, aluminium anodisé, toiture terrasse" },
  { id: "haussmannien",  label: "Haussmannien revisité", desc: "Pierre, zinc, balcons filants, corniches" },
  { id: "mediterraneen", label: "Méditerranéen",         desc: "Enduit coloré, volets bois, pergolas" },
];

const MATERIAUX_FACADE = [
  "Enduit blanc",
  "Enduit beige",
  "Pierre de taille",
  "Brique rouge",
  "Bardage bois",
  "Composite HPL",
  "Béton architectonique",
];

const MATERIAUX_MENUISERIES = [
  "Aluminium gris anthracite",
  "Aluminium blanc",
  "PVC blanc",
  "Bois naturel",
  "Bois peint sombre",
];

const MATERIAUX_TOITURE = [
  "Zinc joint debout",
  "Tuile canal",
  "Tuile mécanique",
  "Ardoise",
  "Toiture terrasse végétalisée",
  "Toiture terrasse gravier",
];

const RDC_TYPES = [
  "Vitrine commerciale",
  "Hall résidentiel",
  "Socle pierre",
  "Logements plain-pied",
  "Stationnement semi-enterré",
];

const RYTHMES = ["Régulier", "Syncopé", "Symétrique", "Dynamique décalé"];

const AMBIANCES: { id: Ambiance; label: string; icon: ReactNode }[] = [
  { id: "matin",      label: "Matin clair",       icon: <Sun className="h-4 w-4" /> },
  { id: "golden",     label: "Golden hour",       icon: <Sunset className="h-4 w-4" /> },
  { id: "couvert",    label: "Ciel couvert",      icon: <Cloud className="h-4 w-4" /> },
  { id: "crepuscule", label: "Crépuscule premium", icon: <Sunset className="h-4 w-4" /> },
];

const VEGETATIONS: { id: Vegetation; label: string }[] = [
  { id: "aucune", label: "Aucune" },
  { id: "legere", label: "Légère" },
  { id: "residentielle", label: "Résidentielle" },
  { id: "premium", label: "Premium" },
];

const VIEW_MODES: { id: ViewMode; label: string; emoji: string }[] = [
  { id: "frontale",           label: "Frontale",  emoji: "⬜" },
  { id: "3_quarts_legers",    label: "3/4 léger", emoji: "◱" },
  { id: "perspective_entree", label: "Entrée",    emoji: "🚪" },
  { id: "angle_rue",          label: "Angle rue", emoji: "🏙" },
];

const BUILDING_STANDARDS: { id: BuildingStandard; label: string }[] = [
  { id: "economique", label: "Économique" },
  { id: "standard",   label: "Standard" },
  { id: "qualitatif", label: "Qualitatif" },
  { id: "premium",    label: "Premium" },
  { id: "luxe",       label: "Luxe" },
];

const DRAWING_STYLES: { id: DrawingStyle; label: string; emoji: string }[] = [
  { id: "aquarelle",       label: "Aquarelle",       emoji: "🎨" },
  { id: "esquisse_architecte", label: "Esquisse architecte", emoji: "✏️" },
  { id: "photo_realiste",  label: "Photo réaliste",  emoji: "📷" },
];

const PRESETS: Preset[] = [
  {
    id: "urbain",
    label: "Contemporain urbain",
    description: "Façade épurée, zinc, balcons filants",
    color: "from-slate-700 to-slate-900",
    config: {
      style: "contemporain",
      materiauFacade: "Béton architectonique",
      materiauMenuiseries: "Aluminium gris anthracite",
      materiauToiture: "Zinc joint debout",
      ambiance: "matin",
      vegetation: "legere",
      balcons: true,
      corniche: false,
    },
  },
  {
    id: "premium",
    label: "Résidentiel premium",
    description: "Pierre, aluminium, toiture terrasse",
    color: "from-violet-700 to-indigo-800",
    config: {
      style: "premium",
      materiauFacade: "Pierre de taille",
      materiauMenuiseries: "Aluminium gris anthracite",
      materiauToiture: "Toiture terrasse végétalisée",
      ambiance: "golden",
      vegetation: "premium",
      loggias: true,
      attique: true,
    },
  },
  {
    id: "classique",
    label: "Façade classique revisitée",
    description: "Haussmannien moderne, corniches, zinc",
    color: "from-amber-700 to-orange-800",
    config: {
      style: "haussmannien",
      materiauFacade: "Pierre de taille",
      materiauMenuiseries: "Bois peint sombre",
      materiauToiture: "Zinc joint debout",
      ambiance: "couvert",
      vegetation: "aucune",
      corniche: true,
      socle: true,
      balcons: true,
    },
  },
  {
    id: "med",
    label: "Méditerranéen lumineux",
    description: "Enduit ocre, volets, pergola",
    color: "from-orange-500 to-yellow-600",
    config: {
      style: "mediterraneen",
      materiauFacade: "Enduit beige",
      materiauMenuiseries: "Bois naturel",
      materiauToiture: "Tuile canal",
      ambiance: "golden",
      vegetation: "residentielle",
    },
  },
];

const DEFAULT_CONFIG: FacadeConfig = {
  style: "contemporain",
  materiauFacade: "Enduit blanc",
  materiauMenuiseries: "Aluminium gris anthracite",
  materiauToiture: "Zinc joint debout",
  rdcType: "Hall résidentiel",
  nbEtages: 4,
  attique: false,
  balcons: true,
  loggias: false,
  corniche: false,
  socle: true,
  rythme: "Régulier",
  ambiance: "matin",
  vegetation: "legere",
};

const PROMOTEUR_GRADIENT = "linear-gradient(90deg, #7c6fcd 0%, #b39ddb 100%)";
const PROMOTEUR_ACCENT   = "#5247b8";

/** Seuil de complexité footprint au-delà duquel un avertissement UX est affiché */
const FOOTPRINT_COMPLEXITY_THRESHOLD = 6;

// -----------------------------------------------------------------------------
// Facade2D mappings
// -----------------------------------------------------------------------------

function mapConfigToFacade2DPreset(style: Style): Facade2DStylePresetId {
  return style === "contemporain"
    ? "contemporain-urbain"
    : style === "premium"
    ? "residentiel-premium"
    : style === "haussmannien"
    ? "classique-revisite"
    : style === "mediterraneen"
    ? "mediterraneen-lumineux"
    : "contemporain-urbain";
}

function mapRhythm(r: string): Facade2DRhythm {
  return r === "Syncopé"
    ? "syncopated"
    : r === "Symétrique"
    ? "symmetric"
    : r === "Dynamique décalé"
    ? "dynamic"
    : "regular";
}

function mapAmbiance(a: string): Facade2DAmbiance {
  return a === "golden"
    ? "golden"
    : a === "couvert"
    ? "couvert"
    : a === "crepuscule"
    ? "crepuscule"
    : "matin";
}

function mapVegetation(v: string): Facade2DVegetation {
  return v === "legere"
    ? "legere"
    : v === "residentielle"
    ? "residentielle"
    : v === "premium"
    ? "premium"
    : "aucune";
}

function configToFacade2DInput(
  config: FacadeConfig,
  dims?: { widthM?: number; depthM?: number },
): Facade2DBuildInput {
  return {
    widthM: dims?.widthM ?? W,
    depthM: dims?.depthM ?? D,
    levelsCount: config.nbEtages,
    levelHeightM: FLOOR_H,
    roofKind: config.materiauToiture.includes("terrasse")
      ? "flat"
      : config.materiauToiture.includes("Tuile")
      ? "hip"
      : config.style === "haussmannien"
      ? "mansard"
      : "flat",
    hasAttic: config.attique,
    balconyMode: config.balcons ? "continuous" : "none",
    loggiaMode: config.loggias ? "simple" : "none",
    baseKind:
      config.rdcType.includes("commerciale") || config.rdcType.includes("Vitrine")
        ? "commercial"
        : config.rdcType.includes("Stationnement")
        ? "pilotis"
        : "residential",
    stylePresetId: mapConfigToFacade2DPreset(config.style),
    facadeMaterial: config.materiauFacade,
    windowMaterial: config.materiauMenuiseries,
    roofMaterial: config.materiauToiture,
    rhythm: mapRhythm(config.rythme),
    hasCornice: config.corniche,
    hasSocle: config.socle,
    ambiance: mapAmbiance(config.ambiance),
    vegetation: mapVegetation(config.vegetation),
    archStyle: config.style,
    rdcType: config.rdcType,
  };
}

// -----------------------------------------------------------------------------
// UI helpers
// -----------------------------------------------------------------------------

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">{children}</h3>;
}

function Select({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm transition hover:border-slate-300">
      <span className="text-sm text-slate-700">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
        style={{ background: value ? PROMOTEUR_ACCENT : "#e2e8f0" }}
      >
        <span
          className={[
            "inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform",
            value ? "translate-x-4" : "translate-x-0.5",
          ].join(" ")}
        />
      </button>
    </label>
  );
}

function PreviewTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
        active ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-700",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex items-center gap-1.5 rounded-xl border px-2.5 py-2 text-xs font-medium transition-all",
        active
          ? "border-violet-300 bg-violet-50 shadow-sm"
          : "border-slate-200 bg-slate-50/60 text-slate-600 hover:border-slate-300 hover:bg-white",
      ].join(" ")}
      style={active ? { color: PROMOTEUR_ACCENT } : {}}
    >
      {children}
    </button>
  );
}

const showDebug =
  typeof window !== "undefined" &&
  (import.meta.env.DEV || new URLSearchParams(window.location.search).has("debug"));

// -----------------------------------------------------------------------------
// Helpers footprint pour payload AI
// -----------------------------------------------------------------------------

function polygonSignedArea2D(pts: Pt2D[]): number {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

function sanitizeFootprintForAi(rawPts: Pt2D[]): Pt2D[] {
  if (!Array.isArray(rawPts) || rawPts.length < 3) return [];

  const unique: Pt2D[] = [];
  const seen = new Set<string>();

  for (const p of rawPts) {
    const key = `${Math.round(p.x * 1000)}_${Math.round(p.y * 1000)}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(p);
    }
  }

  if (unique.length < 3) return [];
  if (polygonSignedArea2D(unique) < 0) unique.reverse();

  return unique;
}

function normalizeFootprintForAi(rawPts: Pt2D[]): Pt2D[] {
  if (!Array.isArray(rawPts) || rawPts.length < 3) return [];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const p of rawPts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  const dx = Math.max(maxX - minX, 0.001);
  const dy = Math.max(maxY - minY, 0.001);

  return rawPts.map((p) => ({
    x: Number(((p.x - minX) / dx).toFixed(4)),
    y: Number(((p.y - minY) / dy).toFixed(4)),
  }));
}

function computeFootprintMetrics(pts: Pt2D[]): {
  widthM: number | null;
  depthM: number | null;
  aspectRatio: number | null;
  complexity: "simple" | "intermediate" | "complex" | null;
  volumeBreakCount: number | null;
} {
  if (!Array.isArray(pts) || pts.length < 3) {
    return { widthM: null, depthM: null, aspectRatio: null, complexity: null, volumeBreakCount: null };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const widthM = Math.max(0, maxX - minX);
  const depthM = Math.max(0, maxY - minY);
  const aspectRatio = depthM > 0.001 ? widthM / depthM : null;

  const uniqueDirs = new Set<string>();
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const angle = Math.atan2(dy, dx);
    const bucket = Math.round((angle * 180) / Math.PI / 15) * 15;
    uniqueDirs.add(String(bucket));
  }

  const breakCount = Math.max(0, pts.length - 4);

  const complexity: "simple" | "intermediate" | "complex" =
    pts.length >= 8 || uniqueDirs.size >= 6
      ? "complex"
      : pts.length >= 6 || uniqueDirs.size >= 4
      ? "intermediate"
      : "simple";

  return {
    widthM: Number(widthM.toFixed(2)),
    depthM: Number(depthM.toFixed(2)),
    aspectRatio: aspectRatio !== null ? Number(aspectRatio.toFixed(3)) : null,
    complexity,
    volumeBreakCount: breakCount,
  };
}

// -----------------------------------------------------------------------------
// Page principale
// -----------------------------------------------------------------------------

export default function FacadeGeneratorPage() {
  const navigate = useNavigate();
  const previewWrapperRef = useRef<HTMLDivElement | null>(null);

  const [config, setConfig] = useState<FacadeConfig>(DEFAULT_CONFIG);
  const [previewTab, setPreviewTab] = useState<"principale" | "frontale" | "contexte">("frontale");
  const [viewMode, setViewMode] = useState<ViewMode>("3_quarts_legers");
  const [buildingStandard, setBuildingStandard] = useState<BuildingStandard>("standard");
  const [drawingStyle, setDrawingStyle] = useState<DrawingStyle>("aquarelle");

  const [includePeople, setIncludePeople] = useState(false);
  const [includeGroundFloorShops, setIncludeGroundFloorShops] = useState(false);
  const [includeWindowFlowerPots, setIncludeWindowFlowerPots] = useState(false);

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [lastPromptUsed, setLastPromptUsed] = useState<string | null>(null);
  const [baseImageDataUrl, setBaseImageDataUrl] = useState<string | null>(null);

  const [pluOverrideConfirmed, setPluOverrideConfirmed] = useState(false);
  const [showPluWarningBanner, setShowPluWarningBanner] = useState(false);

  useLocalBlenderRender();

  const patch = (p: Partial<FacadeConfig>) => setConfig((prev) => ({ ...prev, ...p }));
  const applyPreset = (preset: Preset) => {
    setConfig((prev) => ({ ...prev, ...preset.config }));
    setRenderError(null);
  };

  const editor2dBuildings = useEditor2DStore((s) => s.buildings ?? []);
  const implMeta = usePromoteurProjectStore((s) => {
    try {
      return s.implantation2d?.meta ?? null;
    } catch {
      return null;
    }
  });

  const {
    facade2DModel,
    facadeSource,
    facadeRenderSpec,
    facadeSceneInput,
    selectedBuildingId,
  } = useMemo(() => {
    const buildingIds = editor2dBuildings
      .map((b) => (b !== null && typeof b === "object" ? (b as Record<string, unknown>).id : undefined))
      .filter(Boolean);

    const selectedBuildingId = resolveSelectedBuildingId(editor2dBuildings);
    const facadeSceneInput   = buildFacadeSceneInput(config, selectedBuildingId);
    const facadeRenderSpec   = buildFacadeRenderSpec(facadeSceneInput);

    const widthM = facadeRenderSpec.widthM;
    const depthM =
      facadeRenderSpec.footprintMeta?.footprintDepth ??
      (facadeSceneInput.footprint?.length >= 3
        ? (() => {
            const pts = facadeSceneInput.footprint as Array<{ x: number; y: number }>;
            const ys = pts.map((p) => p.y);
            return Math.max(...ys) - Math.min(...ys);
          })()
        : D);

    const uiFallback = configToFacade2DInput(config);
    const resolved = resolveFacadeProjectInput(
      extractFromEditor2D(editor2dBuildings),
      extractFromProjectStore(implMeta),
      uiFallback,
    );

    console.log(
      "[MMZ][FacadeGeneratorPage] useMemo pipeline\n" +
      `  buildings          : ${editor2dBuildings.length} (ids: ${buildingIds.join(", ") || "aucun"})\n` +
      `  selectedBuildingId : ${selectedBuildingId ?? "null"}\n` +
      `  hasRealFootprint   : ${String(facadeSceneInput.hasRealFootprint)}\n` +
      `  footprint.length   : ${Array.isArray(facadeSceneInput.footprint) ? facadeSceneInput.footprint.length : "n/a (non array)"}\n` +
      `  footprintMeta      : ${facadeRenderSpec.footprintMeta ? "présent" : "absent"}\n` +
      `  segments.length    : ${facadeRenderSpec.footprintMeta?.segments?.length ?? "n/a"}\n` +
      `  widthM             : ${widthM.toFixed(2)}m\n` +
      `  depthM             : ${depthM.toFixed(2)}m`,
    );

    return {
      facade2DModel: buildFacade2DModel(configToFacade2DInput(config, { widthM, depthM })),
      facadeSource: resolved.sourceResolved,
      facadeRenderSpec,
      facadeSceneInput,
      selectedBuildingId,
    };
  }, [config, editor2dBuildings, implMeta]);

  const rawFootprintPts = useMemo((): Pt2D[] => {
    const rawFp = facadeSceneInput.footprint as Array<{ x: number; y: number }> | undefined;
    if (Array.isArray(rawFp) && rawFp.length >= 3) {
      const sanitized = sanitizeFootprintForAi(rawFp.map((p) => ({ x: p.x, y: p.y })));
      if (sanitized.length >= 3) return sanitized;
    }

    const segs = facadeRenderSpec.footprintMeta?.segments;
    if (Array.isArray(segs) && segs.length >= 3) {
      const sanitized = sanitizeFootprintForAi(segs.map((s) => ({ x: s.start.x, y: s.start.y })));
      if (sanitized.length >= 3) return sanitized;
    }

    const selected = editor2dBuildings.find((b) => {
      if (!b || typeof b !== "object") return false;
      const r = b as Record<string, unknown>;
      return typeof r.id === "string" && r.id === selectedBuildingId;
    });

    const localPts = extractRawFootprintFromBuildingRecord(selected);
    if (localPts.length >= 3) {
      console.log("[MMZ][FacadeGeneratorPage] rawFootprintPts fallback local editor2d:", localPts.length);
      return sanitizeFootprintForAi(localPts);
    }

    return [];
  }, [
    facadeSceneInput.footprint,
    facadeRenderSpec.footprintMeta,
    editor2dBuildings,
    selectedBuildingId,
  ]);

  const hasRealFootprint = facadeSceneInput.hasRealFootprint === true;
  // Désactivé : l'encart isométrique ne correspond pas fidèlement au plan 2D.
  const showMassInset = false;

  /** Heuristique simple : emprise réelle avec géométrie complexe (≥ seuil de points) */
  const isFootprintComplex = hasRealFootprint && rawFootprintPts.length >= FOOTPRINT_COMPLEXITY_THRESHOLD;

  if (showDebug) {
    console.log(
      `[MMZ][FacadeGeneratorPage] flags — hasRealFp:${String(hasRealFootprint)} · rawFpPts:${rawFootprintPts.length} · showInset:${String(showMassInset)} · complex:${String(isFootprintComplex)}`,
    );
  }

  const {
    pluMaxFloorsIndicative,
    floorsExceedPlu,
    floorWarningLevel,
    floorWarningMessage,
  } = useMemo(() => {
    const rn =
      (implMeta as { nbEtagesMaxPlu?: number } | null)?.nbEtagesMaxPlu ??
      (implMeta as { plu?: { nbEtagesMax?: number } } | null)?.plu?.nbEtagesMax ??
      null;

    const rh =
      (implMeta as { plu?: { hauteurMax?: number } } | null)?.plu?.hauteurMax ??
      null;

    const plu = rn ?? (rh !== null ? Math.floor(rh / FLOOR_H) : null);
    const exc = plu !== null && config.nbEtages > plu;
    const ov  = plu !== null ? config.nbEtages - plu : 0;
    const lvl: "none" | "soft" | "hard" = !exc ? "none" : ov <= 1 ? "soft" : "hard";
    const msg = !exc
      ? null
      : `Le PLU indique un plafond de ${plu} étage${plu! > 1 ? "s" : ""} sur cette parcelle. Vous en demandez ${config.nbEtages} — le rendu sera réalisé à titre indicatif.`;

    return {
      pluMaxFloorsIndicative: plu,
      floorsExceedPlu: exc,
      floorWarningLevel: lvl,
      floorWarningMessage: msg,
    };
  }, [implMeta, config.nbEtages]);

  useEffect(() => {
    if (!floorsExceedPlu) {
      setPluOverrideConfirmed(false);
      setShowPluWarningBanner(false);
    }
  }, [floorsExceedPlu]);

  useEffect(() => {
    return () => {
      if (imageUrl?.startsWith("blob:")) URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);

  function getPreviewSvgElement(): SVGSVGElement {
    const root = previewWrapperRef.current;
    if (!root) throw new Error("Zone de prévisualisation introuvable.");
    const svg = root.querySelector("svg");
    if (!(svg instanceof SVGSVGElement)) throw new Error("Le SVG de façade n'a pas été trouvé.");
    return svg;
  }

  const exportPreviewAsPng = (width = 1400, height = 900): Promise<string> => {
    return new Promise((resolve, reject) => {
      const svgStr = captureFacadeSvg({ svgElement: getPreviewSvgElement(), width, height });
      const mainUrl = URL.createObjectURL(new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" }));
      const img = new Image();

      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          URL.revokeObjectURL(mainUrl);
          reject(new Error("Canvas 2D context unavailable"));
          return;
        }

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(mainUrl);

        const INSET_W = 300;
        const INSET_H = 240;
        const MARGIN = 22;

        const insetSvgStr =
          showMassInset && rawFootprintPts.length >= 3
            ? buildMassInsetSvg(rawFootprintPts, config.nbEtages, INSET_W, INSET_H)
            : null;

        if (insetSvgStr) {
          const insetUrl = URL.createObjectURL(
            new Blob([insetSvgStr], { type: "image/svg+xml;charset=utf-8" }),
          );
          const insetImg = new Image();

          insetImg.onload = () => {
            const BW = INSET_W + 22;
            const BH = INSET_H + 28;
            const bx = width - BW - MARGIN;
            const by = MARGIN;

            ctx.save();
            ctx.fillStyle = "rgba(255,255,255,0.93)";
            ctx.strokeStyle = "rgba(0,0,0,0.09)";
            ctx.lineWidth = 1;
            roundRectPath(ctx, bx, by, BW, BH, 8);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = "#909090";
            ctx.font = "bold 10px 'Helvetica Neue',Arial,sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("MASSE · EMPRISE RÉELLE", bx + BW / 2, by + 16);
            ctx.drawImage(insetImg, bx + 11, by + 22, INSET_W, INSET_H);
            ctx.restore();

            URL.revokeObjectURL(insetUrl);
            console.log("[MMZ][FacadeGeneratorPage] Mini masse composite dans le PNG export ✓");
            resolve(canvas.toDataURL("image/png"));
          };

          insetImg.onerror = () => {
            URL.revokeObjectURL(insetUrl);
            console.warn("[MMZ][FacadeGeneratorPage] Inset masse SVG non chargé — export PNG sans encart");
            resolve(canvas.toDataURL("image/png"));
          };

          insetImg.src = insetUrl;
        } else {
          console.log("[MMZ][FacadeGeneratorPage] Export PNG sans encart masse (rawFootprintPts insuffisants)");
          resolve(canvas.toDataURL("image/png"));
        }
      };

      img.onerror = () => {
        URL.revokeObjectURL(mainUrl);
        reject(new Error("Échec chargement SVG"));
      };

      img.src = mainUrl;
    });
  };

  const handleGenerateFacadeSketch = async () => {
    if (floorsExceedPlu && !pluOverrideConfirmed) {
      setShowPluWarningBanner(true);
      return;
    }

    setGenerating(true);
    setRenderError(null);
    setShowPluWarningBanner(false);

    try {
      const effectiveWidthM = facadeRenderSpec.widthM;
      const hasRealFp = facadeSceneInput.hasRealFootprint === true;

      if (hasRealFp) {
        const depthM = facadeRenderSpec.footprintMeta?.footprintDepth ?? D;
        console.log(
          `[MMZ][FacadeGeneratorPage] Rendu emprise réelle — w:${effectiveWidthM.toFixed(2)}m · d:${depthM.toFixed(2)}m · rawFpPts:${rawFootprintPts.length} · seg:${facadeRenderSpec.footprintMeta?.segments?.length ?? "n/a"}`,
        );
      }

      const pngDataUrl = await exportPreviewAsPng(1400, 900);
      setBaseImageDataUrl(pngDataUrl);

      const basePrompt = buildFacadeAiPrompt({
        config,
        widthM: effectiveWidthM,
        heightM: facade2DModel.heightM,
        levelsCount: facade2DModel.levelsCount,
        sourceLabel: facadeSource,
        view: viewMode,
        buildingStandard,
        drawingStyle: drawingStyle as NonNullable<FacadeAiPromptInput["drawingStyle"]>,
      });

      const massHint =
        hasRealFp && rawFootprintPts.length >= 3
          ? " L'emprise au sol du bâtiment est irrégulière ; respecter scrupuleusement la volumétrie et ne pas la simplifier en bloc rectangulaire."
          : "";

      // Override prompt suffix pour le style photo réaliste
      const photoRealisteHint =
        drawingStyle === "photo_realiste"
          ? " STYLE OBLIGATOIRE : rendu photoréaliste de promotion immobilière. Matériaux crédibles et texturés, ombres portées réalistes, lumière naturelle directionnelle, proportions architecturales strictes, ciel photographique, reflets vitrés réalistes. Ne PAS utiliser de style aquarelle, sketch, illustration ou dessin. Le résultat doit ressembler à une photographie professionnelle de perspective immobilière neuve."
          : "";

      // Override prompt suffix pour le style esquisse architecte
      const esquisseArchitecteHint =
        drawingStyle === "esquisse_architecte"
          ? " STYLE OBLIGATOIRE : CROQUIS CONCEPTUEL D'ARCHITECTE sur papier technique. Le trait noir au crayon et à l'encre doit dominer — traits épais pour les contours, traits fins pour les détails. OBLIGATOIRE : lignes de construction, lignes de fuite, cotes et annotations techniques visibles dépassant les bords du bâtiment. Appliquer des lavis aquarelle transparents UNIQUEMENT en couleur secondaire sur le trait (cyan pour le verre, ocre pour la pierre, gris pour le béton). Ratio minimum 70% trait, 30% couleur. Inclure une texture de papier technique en fond. Ne PAS produire un rendu aquarelle fini, un rendu photoréaliste, ni une illustration de brochure propre."
          : "";

      const prompt = basePrompt + massHint + photoRealisteHint + esquisseArchitecteHint;

      const aiFootprint = sanitizeFootprintForAi(rawFootprintPts);
      const aiFootprintNormalized = normalizeFootprintForAi(aiFootprint);
      const footprintMetrics = computeFootprintMetrics(aiFootprint);

      const result = await requestFacadeAiRender({
        prompt,
        baseImageDataUrl: pngDataUrl,

        drawingStyle: drawingStyle as string,
        view: viewMode,
        buildingStandard,

        floors: config.nbEtages,
        levelsCount: facade2DModel.levelsCount,
        widthM: effectiveWidthM,
        heightM: facade2DModel.heightM,

        facadeStyleLabel: (facade2DModel as { styleLabel?: string }).styleLabel ?? config.style,
        sourceLabel: facadeSource,

        includePeople,
        includeGroundFloorShops,
        includeWindowFlowerPots,

        hasRealFootprint: hasRealFp,
        footprintPoints: aiFootprint.length >= 3 ? aiFootprint : undefined,
        normalizedFootprintPoints:
          aiFootprintNormalized.length >= 3 ? aiFootprintNormalized : undefined,
        footprintWidthM: footprintMetrics.widthM ?? undefined,
        footprintDepthM: footprintMetrics.depthM ?? undefined,
        footprintAspectRatio: footprintMetrics.aspectRatio ?? undefined,
        footprintComplexity: footprintMetrics.complexity ?? undefined,
        volumeBreakCount: footprintMetrics.volumeBreakCount ?? undefined,
        massingNotes: hasRealFp
          ? [
              "Non rectangular building footprint",
              "Preserve all recesses and offsets",
              "Do not simplify into a rectangular building",
              "Side volumes must follow real footprint",
              "Main facade must match the 2D elevation exactly",
              "Use the isometric mass inset as a strict volumetric guide",
            ]
          : undefined,

        ...(pluOverrideConfirmed && pluMaxFloorsIndicative !== null
          ? {
              pluContext: {
                maxFloorsIndicative: pluMaxFloorsIndicative,
                notes: [
                  `Dépassement PLU confirmé : ${config.nbEtages} étages demandés, plafond indicatif ${pluMaxFloorsIndicative}.`,
                  "Rendu à titre indicatif uniquement.",
                ],
              },
            }
          : {}),

        size: "1536x1024",
        quality: "high",
        outputFormat: "png",
        background: "opaque",
      } as Parameters<typeof requestFacadeAiRender>[0]);

      setImageUrl(result.imageUrl);
      setLastPromptUsed(result.promptUsed);
    } catch (e) {
      console.error("[MMZ][FacadeGeneratorPage] render failed", e);
      setRenderError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setGenerating(false);
    }
  };

  const handleDownloadFacadeImage = () => {
    if (!imageUrl) return;
    const a = document.createElement("a");
    a.href = imageUrl;
    a.download = "mimmoza-facade-render-v1.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const [savedToSynthese, setSavedToSynthese] = useState(false);

  const handleUseInSynthese = () => {
    if (!imageUrl) return;
    try {
      const store = usePromoteurProjectStore.getState();
      if (typeof store.patchConception === "function") {
        store.patchConception({ facadeRenderUrl: imageUrl });
      } else if (typeof store.patch === "function") {
        store.patch({ facadeRenderUrl: imageUrl });
      } else {
        // Fallback : stocker directement dans le state
        usePromoteurProjectStore.setState((s: Record<string, unknown>) => ({
          ...s,
          facadeRenderUrl: imageUrl,
        }));
      }
      setSavedToSynthese(true);
      setTimeout(() => setSavedToSynthese(false), 3000);
      console.log("[MMZ][FacadeGeneratorPage] Image façade enregistrée pour la synthèse PDF");
    } catch (err) {
      console.error("[MMZ][FacadeGeneratorPage] Erreur sauvegarde synthèse:", err);
    }
  };

  const currentStyle   = STYLES.find((s) => s.id === config.style);
  const currentView    = VIEW_MODES.find((v) => v.id === viewMode);
  const currentDrawing = DRAWING_STYLES.find((d) => d.id === drawingStyle);

  return (
    <div className="space-y-6">
      <div
        className="overflow-hidden rounded-2xl px-6 py-6 text-white"
        style={{ background: PROMOTEUR_GRADIENT, boxShadow: "0 8px 32px rgba(124,111,205,0.25)" }}
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs" style={{ color: "rgba(255,255,255,0.75)" }}>
              <span>Promoteur</span>
              <ChevronRight className="h-3 w-3" />
              <span>Conception</span>
              <ChevronRight className="h-3 w-3" />
              <span className="font-medium text-white">Générateur de façades</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/20 backdrop-blur-sm">
                <Wand2 className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight">Générateur de façades</h1>
                <p className="mt-0.5 text-sm" style={{ color: "rgba(255,255,255,0.8)" }}>
                  Priorité à une image fidèle à la façade 2D, propre et exploitable.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => navigate("/promoteur/massing-3d")}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/25 bg-white/15 px-3 py-2 text-sm font-medium text-white backdrop-blur-sm transition hover:bg-white/25"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline">Massing 3D</span>
            </button>

            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/25 bg-white/15 px-3 py-2 text-sm font-medium text-white backdrop-blur-sm transition hover:bg-white/25"
            >
              <Layers className="h-4 w-4" />
              Styles prédéfinis
            </button>

            <button
              type="button"
              onClick={() => void handleGenerateFacadeSketch()}
              disabled={generating}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-sm font-semibold shadow-md shadow-black/10 transition hover:bg-slate-50 disabled:opacity-60"
              style={{ color: PROMOTEUR_ACCENT }}
            >
              {generating ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Génération image…
                </>
              ) : (
                <>
                  <Wand2 className="h-4 w-4" />
                  Générer image façade
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Styles prédéfinis</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => applyPreset(p)}
              className={[
                "group relative overflow-hidden rounded-2xl bg-gradient-to-br p-4 text-left text-white shadow-md transition-all hover:scale-[1.02] hover:shadow-lg",
                p.color,
              ].join(" ")}
            >
              <div className="text-sm font-semibold leading-tight">{p.label}</div>
              <div className="mt-1 text-[11px] leading-snug text-white/70">{p.description}</div>
              <div className="mt-3 inline-flex items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-2 py-1 text-[10px] font-medium backdrop-blur-sm">
                Appliquer
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_1fr]">
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <SectionTitle>Style architectural</SectionTitle>
            <div className="space-y-2">
              {STYLES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => patch({ style: s.id })}
                  className={[
                    "w-full rounded-xl border px-3 py-2.5 text-left transition-all",
                    config.style === s.id
                      ? "border-violet-300 bg-violet-50 shadow-sm"
                      : "border-slate-200 bg-slate-50/60 text-slate-700 hover:border-slate-300 hover:bg-white",
                  ].join(" ")}
                  style={config.style === s.id ? { color: PROMOTEUR_ACCENT } : {}}
                >
                  <div className="text-sm font-medium">{s.label}</div>
                  <div className="mt-0.5 text-[11px] text-slate-400">{s.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <SectionTitle>Matériaux</SectionTitle>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-slate-500">Façade</label>
                <Select value={config.materiauFacade} options={MATERIAUX_FACADE} onChange={(v) => patch({ materiauFacade: v })} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Menuiseries</label>
                <Select
                  value={config.materiauMenuiseries}
                  options={MATERIAUX_MENUISERIES}
                  onChange={(v) => patch({ materiauMenuiseries: v })}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Toiture</label>
                <Select value={config.materiauToiture} options={MATERIAUX_TOITURE} onChange={(v) => patch({ materiauToiture: v })} />
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <SectionTitle>Composition</SectionTitle>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-slate-500">RDC</label>
                <Select value={config.rdcType} options={RDC_TYPES} onChange={(v) => patch({ rdcType: v })} />
              </div>

              <div>
                <label className="mb-1 block text-xs text-slate-500">
                  Nombre d&apos;étages —{" "}
                  <span className="font-semibold" style={{ color: PROMOTEUR_ACCENT }}>
                    {config.nbEtages}
                  </span>
                  {pluMaxFloorsIndicative !== null && (
                    <span
                      className={[
                        "ml-2 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium",
                        floorsExceedPlu
                          ? floorWarningLevel === "hard"
                            ? "bg-red-100 text-red-600"
                            : "bg-amber-100 text-amber-600"
                          : "bg-emerald-100 text-emerald-600",
                      ].join(" ")}
                    >
                      PLU max {pluMaxFloorsIndicative}
                    </span>
                  )}
                </label>

                <input
                  type="range"
                  min={1}
                  max={20}
                  value={config.nbEtages}
                  onChange={(e) => patch({ nbEtages: Number(e.target.value) })}
                  className="w-full"
                  style={{ accentColor: PROMOTEUR_ACCENT }}
                />

                <div className="mt-1 flex justify-between text-[10px] text-slate-400">
                  <span>R+1</span>
                  <span>R+10</span>
                  <span>R+20</span>
                </div>
              </div>

              {floorsExceedPlu && (
                <div
                  className={[
                    "rounded-xl border px-3 py-3 text-xs leading-relaxed",
                    floorWarningLevel === "hard"
                      ? "border-red-200 bg-red-50 text-red-700"
                      : "border-amber-200 bg-amber-50 text-amber-700",
                  ].join(" ")}
                >
                  <div className="mb-1 flex items-center gap-1.5 font-semibold">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      {floorWarningLevel === "hard" ? "Dépassement PLU significatif" : "Dépassement PLU indicatif"}
                    </span>
                  </div>

                  <p className="mb-2.5">{floorWarningMessage}</p>

                  {showPluWarningBanner && !pluOverrideConfirmed ? (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (pluMaxFloorsIndicative !== null) patch({ nbEtages: pluMaxFloorsIndicative });
                          setShowPluWarningBanner(false);
                        }}
                        className={[
                          "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 font-medium transition hover:brightness-95",
                          floorWarningLevel === "hard"
                            ? "border-red-300 bg-white text-red-700"
                            : "border-amber-300 bg-white text-amber-700",
                        ].join(" ")}
                      >
                        Ajuster à {pluMaxFloorsIndicative} étage{pluMaxFloorsIndicative! > 1 ? "s" : ""}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setPluOverrideConfirmed(true);
                          setShowPluWarningBanner(false);
                          setTimeout(() => void handleGenerateFacadeSketch(), 0);
                        }}
                        className={[
                          "inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 font-medium text-white transition hover:opacity-90",
                          floorWarningLevel === "hard" ? "bg-red-500" : "bg-amber-500",
                        ].join(" ")}
                      >
                        Continuer quand même
                      </button>
                    </div>
                  ) : pluOverrideConfirmed && (
                    <p
                      className={[
                        "text-[11px] font-medium",
                        floorWarningLevel === "hard" ? "text-red-500" : "text-amber-500",
                      ].join(" ")}
                    >
                      ✓ Rendu effectué en dépassement PLU — à titre indicatif uniquement
                    </p>
                  )}
                </div>
              )}

              <Toggle label="Attique" value={config.attique} onChange={(v) => patch({ attique: v })} />
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <SectionTitle>Détails architecturaux</SectionTitle>
            <div className="space-y-2">
              <Toggle label="Balcons" value={config.balcons} onChange={(v) => patch({ balcons: v })} />
              <Toggle label="Loggias" value={config.loggias} onChange={(v) => patch({ loggias: v })} />
              <Toggle label="Corniche" value={config.corniche} onChange={(v) => patch({ corniche: v })} />
              <Toggle label="Socle" value={config.socle} onChange={(v) => patch({ socle: v })} />
              <div className="pt-1">
                <label className="mb-1 block text-xs text-slate-500">Rythme de façade</label>
                <Select value={config.rythme} options={RYTHMES} onChange={(v) => patch({ rythme: v })} />
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <SectionTitle>
              <span className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" />
                Mise en scène
              </span>
            </SectionTitle>

            <div className="space-y-2">
              {([
                {
                  st: includePeople,
                  set: setIncludePeople,
                  icon: <Users className="h-3.5 w-3.5 shrink-0 text-slate-400" />,
                  lbl: "Personnes",
                },
                {
                  st: includeGroundFloorShops,
                  set: setIncludeGroundFloorShops,
                  icon: <ShoppingBag className="h-3.5 w-3.5 shrink-0 text-slate-400" />,
                  lbl: "RDC commerces",
                },
                {
                  st: includeWindowFlowerPots,
                  set: setIncludeWindowFlowerPots,
                  icon: <Flower2 className="h-3.5 w-3.5 shrink-0 text-slate-400" />,
                  lbl: "Pots de fleurs aux fenêtres",
                },
              ] as const).map(({ st, set, icon, lbl }) => (
                <label
                  key={lbl}
                  className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm transition hover:border-slate-300"
                >
                  <span className="flex items-center gap-2 text-sm text-slate-700">
                    {icon}
                    {lbl}
                  </span>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={st}
                    onClick={() => set((v) => !v)}
                    className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
                    style={{ background: st ? PROMOTEUR_ACCENT : "#e2e8f0" }}
                  >
                    <span
                      className={[
                        "inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform",
                        st ? "translate-x-4" : "translate-x-0.5",
                      ].join(" ")}
                    />
                  </button>
                </label>
              ))}
            </div>

            {(includePeople || includeGroundFloorShops || includeWindowFlowerPots) && (
              <p className="mt-2.5 text-[11px] leading-relaxed text-slate-400">
                {[
                  includePeople && "Personnes",
                  includeGroundFloorShops && "RDC commerces",
                  includeWindowFlowerPots && "Pots de fleurs",
                ]
                  .filter(Boolean)
                  .join(" · ")}{" "}
                seront intégrés au rendu AI.
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <SectionTitle>Ambiance</SectionTitle>
            <div className="grid grid-cols-2 gap-2">
              {AMBIANCES.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => patch({ ambiance: a.id })}
                  className={[
                    "flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-all",
                    config.ambiance === a.id
                      ? "border-violet-300 bg-violet-50 shadow-sm"
                      : "border-slate-200 bg-slate-50/60 text-slate-600 hover:border-slate-300 hover:bg-white",
                  ].join(" ")}
                  style={config.ambiance === a.id ? { color: PROMOTEUR_ACCENT } : {}}
                >
                  {a.icon}
                  <span className="text-xs">{a.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <SectionTitle>Végétation</SectionTitle>
            <div className="grid grid-cols-2 gap-2">
              {VEGETATIONS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => patch({ vegetation: v.id })}
                  className={[
                    "flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm transition-all",
                    config.vegetation === v.id
                      ? "border-violet-300 bg-violet-50 font-medium shadow-sm"
                      : "border-slate-200 bg-slate-50/60 text-slate-600 hover:border-slate-300 hover:bg-white",
                  ].join(" ")}
                  style={config.vegetation === v.id ? { color: PROMOTEUR_ACCENT } : {}}
                >
                  <TreePine className="h-3.5 w-3.5 shrink-0" />
                  <span className="text-xs">{v.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 px-1 pt-1">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Paramètres AI</span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <SectionTitle>
              <span className="flex items-center gap-1.5">
                <Eye className="h-3.5 w-3.5" />
                Vue
              </span>
            </SectionTitle>
            <div className="grid grid-cols-2 gap-2">
              {VIEW_MODES.map((v) => (
                <Chip key={v.id} active={viewMode === v.id} onClick={() => setViewMode(v.id)}>
                  <span>{v.emoji}</span>
                  <span>{v.label}</span>
                </Chip>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <SectionTitle>
              <span className="flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5" />
                Standard bâtiment
              </span>
            </SectionTitle>
            <div className="flex flex-wrap gap-2">
              {BUILDING_STANDARDS.map((s) => (
                <Chip key={s.id} active={buildingStandard === s.id} onClick={() => setBuildingStandard(s.id)}>
                  {s.label}
                </Chip>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <SectionTitle>
              <span className="flex items-center gap-1.5">
                <Paintbrush className="h-3.5 w-3.5" />
                Style de dessin
              </span>
            </SectionTitle>
            <div className="grid grid-cols-2 gap-2">
              {DRAWING_STYLES.map((d) => (
                <Chip key={d.id} active={drawingStyle === d.id} onClick={() => setDrawingStyle(d.id)}>
                  <span>{d.emoji}</span>
                  <span>{d.label}</span>
                </Chip>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="sticky top-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div className="flex items-center gap-2">
                <ImageOff className="h-4 w-4 text-slate-400" />
                <span className="text-sm font-semibold text-slate-700">Prévisualisation façade</span>

                {hasRealFootprint && (
                  <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                    ⬡ Emprise réelle
                  </span>
                )}

                {showMassInset && (
                  <span
                    className="inline-flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-medium"
                    style={{ color: PROMOTEUR_ACCENT }}
                  >
                    ⬢ Masse ISO dans le PNG
                  </span>
                )}

                {showDebug && !showMassInset && (
                  <span className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-500">
                    Inset OFF
                  </span>
                )}
              </div>

              <div className="flex items-center gap-0.5 rounded-xl bg-slate-100 p-1">
                <PreviewTab label="Vue principale" active={previewTab === "principale"} onClick={() => setPreviewTab("principale")} />
                <PreviewTab label="Frontale" active={previewTab === "frontale"} onClick={() => setPreviewTab("frontale")} />
                <PreviewTab label="Contexte" active={previewTab === "contexte"} onClick={() => setPreviewTab("contexte")} />
              </div>
            </div>

            <div className="relative flex aspect-[16/10] w-full items-center justify-center overflow-hidden bg-gradient-to-br from-slate-100 via-slate-50 to-purple-50">
              {previewTab !== "contexte" && (
                <div ref={previewWrapperRef} className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white">
                  <div className="w-full max-w-2xl px-4">
                    <Facade2DSvgRenderer model={facade2DModel} width={640} />
                  </div>

                  <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-400">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    {facade2DModel.styleLabel} · {facade2DModel.widthM.toFixed(1)}m × {facade2DModel.heightM.toFixed(1)}m · {facade2DModel.levelsCount}N
                  </div>

                  {showDebug && (
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[9px] font-mono text-slate-300">
                      <span
                        className={[
                          "inline-block h-1 w-1 rounded-full",
                          facadeSource === "editor2d"
                            ? "bg-blue-400"
                            : facadeSource === "projectStore"
                            ? "bg-amber-400"
                            : "bg-slate-300",
                        ].join(" ")}
                      />
                      <span>src:{facadeSource}</span>
                      <span>buildingId:{selectedBuildingId ?? "null"}</span>
                      <span>hasFp:{String(hasRealFootprint)}</span>
                      <span>fpPts:{rawFootprintPts.length}</span>
                      <span>seg:{facadeRenderSpec.footprintMeta?.segments?.length ?? "n/a"}</span>
                      <span>showInset:{String(showMassInset)}</span>
                      <span>w:{facadeRenderSpec.widthM.toFixed(2)}m</span>
                      <span>lvl:{facade2DModel.levelsCount}</span>
                      <span>cfg:{config.nbEtages}</span>
                      {hasRealFootprint && facadeRenderSpec.footprintMeta && (
                        <span className="text-emerald-400">
                          d:{facadeRenderSpec.footprintMeta.footprintDepth.toFixed(2)}m
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {previewTab !== "contexte" && showMassInset && (
                <div className="absolute right-2 top-2 z-20" style={{ pointerEvents: "none" }}>
                  <div
                    style={{
                      background: "rgba(255,255,255,0.92)",
                      border: "1px solid rgba(0,0,0,0.08)",
                      borderRadius: 8,
                      padding: "4px 8px 6px",
                      boxShadow: "0 1px 6px rgba(0,0,0,0.09)",
                    }}
                  >
                    <p
                      style={{
                        fontSize: 8,
                        color: "#909090",
                        textAlign: "center",
                        margin: "0 0 3px",
                        fontFamily: "'Helvetica Neue',Arial,sans-serif",
                        fontWeight: 700,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                      }}
                    >
                      Masse · Emprise réelle
                    </p>
                    <FootprintMassInset rawPts={rawFootprintPts} nbEtages={config.nbEtages} svgW={112} svgH={96} />
                  </div>
                </div>
              )}

              {previewTab === "contexte" && imageUrl && !generating && (
                <img src={imageUrl} alt="Image façade générée" className="absolute inset-0 h-full w-full object-cover" />
              )}

              {previewTab === "contexte" && generating && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm">
                  <div
                    className="h-10 w-10 animate-spin rounded-full border-4"
                    style={{ borderColor: "#e9d5ff", borderTopColor: PROMOTEUR_ACCENT }}
                  />
                  <p className="mt-3 text-sm font-medium text-slate-600">Génération image façade…</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Capture SVG · composite masse iso · rendu AI{hasRealFootprint ? " · emprise réelle" : ""}
                  </p>
                </div>
              )}

              {previewTab === "contexte" && renderError && !generating && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-red-50/90 px-8 text-center backdrop-blur-sm">
                  <AlertCircle className="mb-2 h-8 w-8 text-red-400" />
                  <p className="text-sm font-semibold text-red-700">Erreur de rendu</p>
                  <p className="mt-1 max-w-xs text-xs leading-relaxed text-red-500">{renderError}</p>
                  <button
                    type="button"
                    onClick={() => void handleGenerateFacadeSketch()}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium text-white"
                    style={{ background: PROMOTEUR_GRADIENT }}
                  >
                    <RefreshCw className="h-4 w-4" />
                    Réessayer
                  </button>
                </div>
              )}

              {previewTab === "contexte" && !imageUrl && !generating && !renderError && (
                <div className="flex flex-col items-center gap-4 px-8 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-md">
                    <Wand2 className="h-8 w-8" style={{ color: "#b39ddb" }} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-600">L&apos;image façade s&apos;affichera ici</p>
                    <p className="mt-1 text-xs leading-relaxed text-slate-400">
                      Cliquez sur <strong>Générer image façade</strong>.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleGenerateFacadeSketch()}
                    className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow-md transition hover:opacity-90"
                    style={{ background: PROMOTEUR_GRADIENT, boxShadow: "0 4px 16px rgba(124,111,205,0.3)" }}
                  >
                    <Wand2 className="h-4 w-4" />
                    Générer image façade
                  </button>
                </div>
              )}

              {previewTab === "contexte" && !generating && (
                <div className="absolute bottom-3 left-3 z-20 rounded-lg border border-slate-200/80 bg-white/90 px-2.5 py-1 text-xs font-medium text-slate-600 backdrop-blur-sm shadow-sm">
                  Vue contexte 2D stylisée
                </div>
              )}

              {previewTab === "contexte" && imageUrl && !generating && (
                <button
                  type="button"
                  onClick={() => void handleGenerateFacadeSketch()}
                  className="absolute bottom-3 right-3 z-20 inline-flex items-center gap-1.5 rounded-xl border border-white/25 bg-black/40 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm transition hover:bg-black/60"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Régénérer
                </button>
              )}
            </div>

            <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3">
              <div className="flex flex-wrap gap-2">
                <span
                  className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2 py-1 text-[11px] font-medium"
                  style={{ color: PROMOTEUR_ACCENT }}
                >
                  {currentStyle?.label}
                </span>

                <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600">
                  R+{config.nbEtages}
                  {config.attique ? " + Attique" : ""}
                  {floorsExceedPlu && (
                    <span
                      className={[
                        "ml-1 rounded px-1 text-[9px] font-semibold",
                        floorWarningLevel === "hard" ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-600",
                      ].join(" ")}
                    >
                      ⚠ PLU
                    </span>
                  )}
                </span>

                {hasRealFootprint && facadeRenderSpec.footprintMeta && (
                  <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] text-emerald-700">
                    {facadeRenderSpec.widthM.toFixed(1)}m × {facadeRenderSpec.footprintMeta.footprintDepth.toFixed(1)}m
                  </span>
                )}

                {hasRealFootprint && !facadeRenderSpec.footprintMeta && (
                  <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] text-emerald-700">
                    {facadeRenderSpec.widthM.toFixed(1)}m · emprise réelle
                  </span>
                )}

                {showMassInset && (
                  <span
                    className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2 py-1 text-[11px]"
                    style={{ color: PROMOTEUR_ACCENT }}
                  >
                    ⬢ Masse ISO ({rawFootprintPts.length}pts)
                  </span>
                )}

                <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600">
                  {config.materiauFacade}
                </span>
                <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600">
                  {AMBIANCES.find((a) => a.id === config.ambiance)?.label}
                </span>
                <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600">
                  {currentView?.emoji} {currentView?.label}
                </span>
                <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600">
                  {currentDrawing?.emoji} {currentDrawing?.label}
                </span>

                {config.balcons && (
                  <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600">
                    Balcons
                  </span>
                )}
                {config.loggias && (
                  <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600">
                    Loggias
                  </span>
                )}

                {config.vegetation !== "aucune" && (
                  <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] text-emerald-700">
                    <TreePine className="h-3 w-3" />
                    Végétation {config.vegetation}
                  </span>
                )}

                {includePeople && (
                  <span className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2 py-1 text-[11px] text-violet-700">
                    <Users className="h-3 w-3" />
                    Personnes
                  </span>
                )}
                {includeGroundFloorShops && (
                  <span className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2 py-1 text-[11px] text-violet-700">
                    <ShoppingBag className="h-3 w-3" />
                    Commerces
                  </span>
                )}
                {includeWindowFlowerPots && (
                  <span className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2 py-1 text-[11px] text-violet-700">
                    <Flower2 className="h-3 w-3" />
                    Fleurs
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div className="flex items-center gap-2">
                <Wand2 className="h-4 w-4 text-slate-400" />
                <span className="text-sm font-semibold text-slate-700">Image façade générée</span>

                {imageUrl && !generating && (
                  <span
                    className="inline-flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-medium"
                    style={{ color: PROMOTEUR_ACCENT }}
                  >
                    {currentDrawing?.emoji} {currentDrawing?.label}
                  </span>
                )}

                {imageUrl && !generating && pluOverrideConfirmed && (
                  <span
                    className={[
                      "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-medium",
                      floorWarningLevel === "hard"
                        ? "border-red-200 bg-red-50 text-red-600"
                        : "border-amber-200 bg-amber-50 text-amber-600",
                    ].join(" ")}
                  >
                    <AlertCircle className="h-3 w-3" />
                    Indicatif PLU
                  </span>
                )}
              </div>

              {imageUrl && !generating && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDownloadFacadeImage}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-slate-800"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Télécharger
                  </button>

                  <button
                    type="button"
                    onClick={handleUseInSynthese}
                    disabled={savedToSynthese}
                    className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium shadow-sm transition disabled:opacity-70"
                    style={
                      savedToSynthese
                        ? { borderColor: "#86efac", background: "#f0fdf4", color: "#16a34a" }
                        : { borderColor: "#c4b5fd", background: "#f5f3ff", color: PROMOTEUR_ACCENT }
                    }
                  >
                    {savedToSynthese ? (
                      <>
                        <Check className="h-3.5 w-3.5" />
                        Ajouté à la synthèse
                      </>
                    ) : (
                      <>
                        <FileText className="h-3.5 w-3.5" />
                        Utiliser dans la synthèse
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleGenerateFacadeSketch()}
                    disabled={generating}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-slate-800 disabled:opacity-50"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Régénérer
                  </button>
                </div>
              )}
            </div>

            <div className="p-4">
              {generating && (
                <div className="flex flex-col items-center justify-center gap-3 py-12">
                  <div
                    className="h-10 w-10 animate-spin rounded-full border-4"
                    style={{ borderColor: "#e9d5ff", borderTopColor: PROMOTEUR_ACCENT }}
                  />
                  <p className="text-sm font-medium text-slate-600">Génération image façade…</p>
                  <p className="text-xs text-slate-400">
                    {currentView?.emoji} {currentView?.label} · {currentDrawing?.label} · {buildingStandard}
                    {showMassInset && " · masse ISO"}
                    {hasRealFootprint && " · emprise réelle"}
                    {pluOverrideConfirmed && " · PLU override"}
                  </p>
                </div>
              )}

              {!generating && renderError && (
                <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-red-100 bg-red-50 px-6 py-10 text-center">
                  <AlertCircle className="h-8 w-8 text-red-400" />
                  <p className="text-sm font-semibold text-red-700">Erreur de rendu image façade</p>
                  <p className="max-w-xs text-xs leading-relaxed text-red-500">{renderError}</p>
                  <button
                    type="button"
                    onClick={() => void handleGenerateFacadeSketch()}
                    className="mt-1 inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium text-white"
                    style={{ background: PROMOTEUR_GRADIENT }}
                  >
                    <RefreshCw className="h-4 w-4" />
                    Réessayer
                  </button>
                </div>
              )}

              {!generating && !renderError && imageUrl && (
                <div className="overflow-hidden rounded-xl border border-slate-100">
                  <img src={imageUrl} alt="Façade générée" className="w-full object-cover" style={{ maxHeight: 620 }} />
                  {showDebug && lastPromptUsed && (
                    <div className="border-t border-slate-100 bg-slate-50 px-3 py-2">
                      <p className="font-mono text-[9px] leading-relaxed text-slate-400 line-clamp-3">
                        {lastPromptUsed}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {!generating && !renderError && !imageUrl && (
                <div className="flex flex-col items-center justify-center gap-5 py-16 text-center">
                  <div className="relative flex h-20 w-20 items-center justify-center">
                    <div className="absolute inset-0 rounded-2xl opacity-15" style={{ background: PROMOTEUR_GRADIENT }} />
                    <div
                      className="flex h-16 w-16 items-center justify-center rounded-2xl"
                      style={{ background: "rgba(124,111,205,0.12)" }}
                    >
                      <Wand2 className="h-8 w-8" style={{ color: PROMOTEUR_ACCENT }} />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <p className="text-base font-semibold text-slate-700">Aucune image générée</p>
                    <p className="max-w-xs text-xs leading-relaxed text-slate-400">
                      Configurez votre façade dans le panneau de gauche, puis lancez la génération.
                    </p>

                    {showMassInset && (
                      <p className="text-[11px] text-violet-600">
                        ⬢ Mini masse isométrique ({rawFootprintPts.length}pts) sera incluse dans le PNG envoyé à l&apos;IA
                      </p>
                    )}

                    {hasRealFootprint && !showMassInset && (
                      <p className="text-[11px] text-amber-600">
                        ⚠ Emprise réelle détectée mais footprint insuffisant ({rawFootprintPts.length} pts)
                      </p>
                    )}

                    {hasRealFootprint && facadeRenderSpec.footprintMeta && (
                      <p className="text-[11px] text-emerald-600">
                        Emprise réelle · {facadeRenderSpec.widthM.toFixed(1)}m × {facadeRenderSpec.footprintMeta.footprintDepth.toFixed(1)}m
                      </p>
                    )}

                    {(includePeople || includeGroundFloorShops || includeWindowFlowerPots) && (
                      <p className="text-[11px] text-violet-500">
                        Mise en scène :{" "}
                        {[
                          includePeople && "Personnes",
                          includeGroundFloorShops && "Commerces",
                          includeWindowFlowerPots && "Fleurs",
                        ]
                          .filter(Boolean)
                          .join(", ")}
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleGenerateFacadeSketch()}
                    disabled={generating}
                    className="inline-flex items-center gap-2.5 rounded-2xl px-7 py-3 text-sm font-semibold text-white shadow-lg transition hover:opacity-90 disabled:opacity-60"
                    style={{ background: PROMOTEUR_GRADIENT, boxShadow: "0 6px 24px rgba(124,111,205,0.35)" }}
                  >
                    <Wand2 className="h-4 w-4" />
                    Générer image façade
                  </button>

                  <p className="text-[11px] text-slate-400">
                    Vue {currentView?.label} · {currentDrawing?.label} · {buildingStandard}
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl" style={{ background: "#ede9fe" }}>
                <Wand2 className="h-4 w-4" style={{ color: PROMOTEUR_ACCENT }} />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-700">Pipeline recommandé</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  <strong>emprise réelle → façade 2D + masse ISO → PNG composite → rendu AI PNG</strong>.
                  {showMassInset
                    ? ` L'image de référence envoyée à l'IA contient la façade principale ET un encart isométrique de la masse réelle (${rawFootprintPts.length} points).`
                    : hasRealFootprint
                    ? ` Emprise réelle détectée (hasRealFootprint=true) mais footprint brut insuffisant (${rawFootprintPts.length} pts — min 3 requis).`
                    : " Fallback géométrique (aucun bâtiment sélectionné ou emprise indisponible)."}
                </p>

                {isFootprintComplex && (
                  <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] leading-relaxed text-amber-700">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                    <span>
                      L&apos;emprise de ce bâtiment présente une géométrie complexe ({rawFootprintPts.length} sommets).
                      Le rendu final peut présenter des écarts par rapport au plan 2D, notamment sur les décrochés et les angles non orthogonaux.
                    </span>
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {showDebug && baseImageDataUrl && (
        <div className="hidden">
          <img src={baseImageDataUrl} alt="debug-base-preview" />
        </div>
      )}
    </div>
  );
}