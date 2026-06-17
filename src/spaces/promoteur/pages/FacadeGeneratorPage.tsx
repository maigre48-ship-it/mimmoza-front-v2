// src/spaces/promoteur/pages/FacadeGeneratorPage.tsx
// -----------------------------------------------------------------------------
// Générateur de façades -- V5.9
// [V5.9] Sélecteur de style UNIFIÉ (fusion Styles prédéfinis + Style architectural
//        + Inspiration régionale en un seul axe, 3 familles : Contemporain ·
//        Classique · Régional). "Détails architecturaux" enrichi de 8 ornements
//        (colombages, volets, encadrements, lucarnes, ferronnerie, bandeaux,
//        brise-soleil, parement brique) — injectés au prompt IA ET câblés vers
//        le modèle 2D pour être DESSINÉS dans la preview. Auto-activation des
//        ornements pertinents selon le style choisi.
//        ⚠ Dépend des fichiers étendus : facade2d.types.ts, buildFacade2DModel.ts,
//          renderFacade2DSvg.tsx (livrés ensuite).
// [V5.8] Couche "Inspiration régionale" (remplacée par le sélecteur unifié)
// [V5.7] Hero v2 : PromoteurPageHero
// [V5.6] init nbEtages depuis snapshot Massing3D en priorité
// [V5.5] Persistance image façade entre onglets
// [V5.4] Style "Photo réaliste" + avertissement complexité footprint
// [V5.3 FIX] fallback direct editor2d + normalizedFootprintPoints
// [V5.2 PATCH] sanitizeFootprintForAi + payload footprintPoints
// [V5.1 FIX] rawFootprintPts -- priorité facadeSceneInput.footprint brut
// [V5] Mini masse isométrique dans le PNG de référence IA
// [V4] Pipeline footprint réel
// -----------------------------------------------------------------------------

import {
  AlertCircle,
  ArrowLeft,
  Blinds,
  BrickWall,
  Building2,
  Check,
  Cloud,
  Download, Eye,
  Fence,
  FileText,
  Flower2,
  Frame,
  Grid3x3,
  Home,
  ImageOff,
  Paintbrush,
  RefreshCw,
  Rows3,
  SeparatorHorizontal,
  ShoppingBag,
  Sun,
  Sunset,
  TreePine,
  Users,
  Wand2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter";

import { buildRectangularSilhouetteDataUrl } from "@/utils/buildRectangularSilhouette";
import { useLocalBlenderRender } from "../terrain3d/blender/useLocalBlenderRender";
import { buildFacadeAiPrompt } from "../terrain3d/facade/buildFacadeAiPrompt";
import { buildFacadeRenderSpec } from "../terrain3d/facade/buildFacadeRenderSpec";
import type { FacadeConfig } from "../terrain3d/facade/buildFacadeSceneInput";
import { buildFacadeSceneInput } from "../terrain3d/facade/buildFacadeSceneInput";
import { captureFacadeSvg } from "../terrain3d/facade/captureFacadeSvg";
import type { FacadeAiPromptInput } from "../terrain3d/facade/facadeAi.types";
import { requestFacadeAiRender } from "../terrain3d/facade/requestFacadeAiRender";

import { buildFacade2DModel } from "../terrain3d/facade2d/buildFacade2DModel";
import type {
  Facade2DAmbiance,
  Facade2DBuildInput,
  Facade2DRhythm,
  Facade2DStylePresetId,
  Facade2DVegetation,
} from "../terrain3d/facade2d/facade2d.types";
import Facade2DSvgRenderer from "../terrain3d/facade2d/renderFacade2DSvg";

import { useEditor2DStore } from "../plan2d/editor2d.store";
import { writeCapture } from "../shared/captures.store";
import {
  HeroGhostButton,
  HeroPrimaryButton,
  PromoteurPageHero,
} from "../shared/components/PromoteurPageHero";
import { ACCENT_PRO, GRAD_PRO } from "../shared/promoteurDesign.tokens";
import {
  clearFacadeImage,
  getFacadeImage,
  getSnapshot,
  setFacadeImage,
} from "../shared/promoteurSnapshot.store";
import { usePromoteurProjectStore } from "../store/promoteurProject.store";
import { computeLevelOpenings, toCenteredX } from "../terrain3d/facade2d/computeFacadeBays";
import {
  extractFromEditor2D, extractFromProjectStore, resolveFacadeProjectInput,
} from "../terrain3d/facade2d/resolveFacadeProjectInput";

import type { MassingSceneModel } from "../terrain3d/massingScene.types";

// -----------------------------------------------------------------------------
// Types locaux
// -----------------------------------------------------------------------------

type Style            = FacadeConfig["style"] | "verre";
type Ambiance         = FacadeConfig["ambiance"];
type Vegetation       = FacadeConfig["vegetation"];
type ViewMode         = NonNullable<FacadeAiPromptInput["view"]>;
type BuildingStandard = NonNullable<FacadeAiPromptInput["buildingStandard"]>;
type DrawingStyle     = NonNullable<FacadeAiPromptInput["drawingStyle"]> | "photo_realiste" | "esquisse_architecte";
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
  soubassement: ZoneMaterialDef; corps: ZoneMaterialDef; attique: ZoneMaterialDef;
};

export function getZoneMaterials(config: FacadeConfig): ZoneMaterials {
  const bc = FACADE_COLORS[config.materiauFacade] ?? 0xe0ddd5;
  if ((config.style as Style) === "verre") {
    return {
      soubassement: { color: 0x9aa0a6, roughness: 0.6,  metalness: 0.2  },
      corps:        { color: 0x7a94a8, roughness: 0.1,  metalness: 0.85 },
      attique:      { color: 0xc4cad0, roughness: 0.35, metalness: 0.6  },
    };
  }
  switch (config.style) {
    case "contemporain":
      return {
        soubassement: { color: darken(bc, 0.18),  roughness: 0.88, metalness: 0.0 },
        corps:        { color: bc,                roughness: 0.8,  metalness: 0.0 },
        attique:      { color: lighten(bc, 0.12), roughness: 0.75, metalness: 0.0 },
      };
    case "premium":
      return {
        soubassement: { color: 0x8a7d6a, roughness: 0.92, metalness: 0.0  },
        corps:        { color: bc,       roughness: 0.72, metalness: 0.05 },
        attique:      { color: 0xb8bec4, roughness: 0.45, metalness: 0.35 },
      };
    case "haussmannien":
      return {
        soubassement: { color: 0x9e8e72, roughness: 0.92, metalness: 0.0  },
        corps:        { color: 0xd4c4a0, roughness: 0.88, metalness: 0.0  },
        attique:      { color: 0x6e7a7e, roughness: 0.5,  metalness: 0.55 },
      };
    case "mediterraneen":
      return {
        soubassement: { color: darken(bc, 0.15),  roughness: 0.9,  metalness: 0.0 },
        corps:        { color: bc,                roughness: 0.85, metalness: 0.0 },
        attique:      { color: lighten(bc, 0.2),  roughness: 0.8,  metalness: 0.0 },
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
// Constantes
// -----------------------------------------------------------------------------

const FLOOR_H = 3.0;
const RDC_H   = 4.0;
const ATTIC_H = 3.2;
const W = 20;
const D = 12;

const FACADE_COLORS: Record<string, number> = {
  "Enduit blanc": 0xf2f2ee, "Enduit beige": 0xe0d0b0, "Pierre de taille": 0xcbbc9e,
  "Brique rouge": 0xb86148, "Bardage bois": 0x8c6038, "Composite HPL": 0x999ea6,
  "Béton architectonique": 0xa5a5a1, "Mur-rideau verre": 0x7a94a8,
};
const TOITURE_COLORS: Record<string, number> = {
  "Zinc joint debout": 0x737f80, "Tuile canal": 0xb86a48, "Tuile mécanique": 0x944d38,
  "Ardoise": 0x4a4d54, "Toiture terrasse végétalisée": 0x4d8a40, "Toiture terrasse gravier": 0xaeaaa6,
};
const MENUISERIES_COLORS: Record<string, number> = {
  "Aluminium gris anthracite": 0x262626, "Aluminium blanc": 0xe8e8e8,
  "PVC blanc": 0xf2f2f2, "Bois naturel": 0x9e7348, "Bois peint sombre": 0x2e2820,
};

function computeHeight(config: FacadeConfig): number {
  return RDC_H + Math.max(0, config.nbEtages - 1) * FLOOR_H + (config.attique ? ATTIC_H : 0);
}

// -----------------------------------------------------------------------------
// Sélection / fallback bâtiment
// -----------------------------------------------------------------------------

const SELECTION_FLAGS = ["selected","isSelected","active","isCurrent","focused","isActive"] as const;

function hasUsableShape(b: Record<string, unknown>): boolean {
  return [b.footprint, b.polygon, b.points, b.outline,
    (b.geometry as Record<string, unknown> | undefined)?.footprint,
    (b.geometry as Record<string, unknown> | undefined)?.polygon,
  ].some((c) => Array.isArray(c) && c.length >= 3);
}

function resolveSelectedBuildingId(buildings: unknown[]): string | null {
  if (!Array.isArray(buildings) || buildings.length === 0) return null;
  const typed = buildings.filter((b): b is Record<string, unknown> => !!b && typeof b === "object");
  const flagged = typed.find((b) => SELECTION_FLAGS.some((f) => b[f] === true));
  if (flagged && typeof flagged.id === "string" && flagged.id.trim()) return flagged.id;
  const withShape = typed.filter((b) => typeof b.id === "string" && hasUsableShape(b));
  if (withShape.length === 1) return String(withShape[0]!.id);
  if (typed.length === 1) { const o = typed[0]!; if (typeof o.id === "string" && o.id.trim()) return o.id; }
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
    r.footprint, r.polygon, r.points, r.outline,
    (r.geometry as Record<string, unknown> | undefined)?.footprint,
    (r.geometry as Record<string, unknown> | undefined)?.polygon,
    (r.geometry as Record<string, unknown> | undefined)?.points,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) {
      const pts = c.map(coercePointLike).filter((p): p is Pt2D => !!p);
      if (pts.length >= 3) return pts;
    }
  }
  return [];
}

// -----------------------------------------------------------------------------
// [V5] Mini masse isométrique
// -----------------------------------------------------------------------------

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

function isoProject(wx: number, wy: number, wz: number, scale: number): Pt2D {
  return { x: (wx - wy) * 0.866 * scale, y: (wx + wy) * 0.5 * scale - wz * scale * 0.82 };
}
function svgPts(pts: Pt2D[]): string { return pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" "); }

interface MassWall { pts: Pt2D[]; shade: "front" | "side"; }
interface MassGeo  { botPts: Pt2D[]; topPts: Pt2D[]; walls: MassWall[]; }

function computeMassGeo(rawPts: Pt2D[], nbEtages: number, svgW: number, svgH: number): MassGeo | null {
  if (rawPts.length < 3) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of rawPts) { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
  const range = Math.max(maxX - minX, maxY - minY, 0.001);
  const nPts = rawPts.map((p) => ({ x: (p.x - minX) / range, y: (p.y - minY) / range }));
  const n = nPts.length;
  const wz = Math.min((nbEtages * 3.0 + 4.0) / 28, 0.95);
  const SCALE = Math.min(svgW, svgH) * 0.35;
  const cx = svgW / 2 + SCALE * 0.06, cy = svgH * 0.65;
  const proj = (p: Pt2D, z: number): Pt2D => { const s = isoProject(p.x - 0.5, p.y - 0.5, z, SCALE); return { x: cx + s.x, y: cy + s.y }; };
  const botPts = nPts.map((p) => proj(p, 0));
  const topPts = nPts.map((p) => proj(p, wz));
  const walls: MassWall[] = [];
  for (let i = 0; i < n; i++) {
    const a = nPts[i]!, b = nPts[(i + 1) % n]!;
    const dx = b.x - a.x, dy = b.y - a.y;
    const fA = dy - dx, fB = dx - dy;
    if (Math.max(fA, fB) > 0.005) walls.push({ pts: [botPts[i]!, botPts[(i + 1) % n]!, topPts[(i + 1) % n]!, topPts[i]!], shade: fA >= fB ? "front" : "side" });
  }
  return { botPts, topPts, walls };
}

function buildMassInsetSvg(rawPts: Pt2D[], nbEtages: number, svgW: number, svgH: number): string | null {
  const geo = computeMassGeo(rawPts, nbEtages, svgW, svgH);
  if (!geo) return null;
  const { botPts, topPts, walls } = geo;
  const sides = walls.filter((w) => w.shade === "side");
  const fronts = walls.filter((w) => w.shade === "front");
  const body = [
    ...sides.map((w) => `<polygon points="${svgPts(w.pts)}" fill="#c2bfb8" stroke="#7a7870" stroke-width="0.7"/>`),
    ...fronts.map((w) => `<polygon points="${svgPts(w.pts)}" fill="#d6d3cc" stroke="#7a7870" stroke-width="0.7"/>`),
    `<polygon points="${svgPts(topPts)}" fill="#e8e5de" stroke="#7a7870" stroke-width="0.7"/>`,
    `<polygon points="${svgPts(botPts)}" fill="none" stroke="#aaa89e" stroke-width="0.45" stroke-dasharray="2,2"/>`,
  ].join("\n  ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">\n  ${body}\n</svg>`;
}

// -----------------------------------------------------------------------------
// Fenêtres & GLTF
// -----------------------------------------------------------------------------

function addOpeningMeshes(scene: THREE.Scene, np: string, cx: number, cy: number, ow: number, oh: number, wz: number, fd: number, gd: number, fb: number, gm: THREE.MeshStandardMaterial, fm: THREE.MeshStandardMaterial): void {
  const fM = new THREE.Mesh(new THREE.BoxGeometry(ow + fb * 2, oh + fb * 2, fd), fm);
  fM.name = `${np}_frame`; fM.position.set(cx, cy, wz - (fd - gd) / 2); scene.add(fM);
  const gM2 = new THREE.Mesh(new THREE.BoxGeometry(ow, oh, gd), gm);
  gM2.name = `${np}_glass`; gM2.position.set(cx, cy, wz); scene.add(gM2);
}

function addWindowsToScene(scene: THREE.Scene, config: FacadeConfig, gm: THREE.MeshStandardMaterial, fm: THREE.MeshStandardMaterial): void {
  const WZ = -D / 2 - 0.05;
  const rh = mapRhythm(config.rythme);
  { const { layout, openingSpecs } = computeLevelOpenings(W, rh, "base"); layout.centerXs.forEach((xl, i) => { const s = openingSpecs[i]; addOpeningMeshes(scene, `rdc_${i}`, toCenteredX(xl, W), 0.02 + s.heightM / 2, s.widthM, s.heightM, WZ, 0.06, 0.04, 0.06, gm, fm); }); }
  for (let fl = 1; fl < config.nbEtages; fl++) {
    const by = RDC_H + (fl - 1) * FLOOR_H;
    const { layout, openingSpecs } = computeLevelOpenings(W, rh, "typical");
    layout.centerXs.forEach((xl, i) => { const s = openingSpecs[i]; addOpeningMeshes(scene, `floor${fl}_${i}`, toCenteredX(xl, W), by + 0.6 + s.heightM / 2, s.widthM, s.heightM, WZ, 0.06, 0.04, 0.06, gm, fm); });
  }
  if (config.attique) {
    const ab = RDC_H + Math.max(0, config.nbEtages - 1) * FLOOR_H;
    const { layout, openingSpecs } = computeLevelOpenings(W, rh, "attic");
    layout.centerXs.forEach((xl, i) => { const s = openingSpecs[i]; addOpeningMeshes(scene, `attique_${i}`, toCenteredX(xl, W * 0.85), ab + 0.6 + s.heightM / 2, s.widthM, s.heightM, WZ, 0.06, 0.04, 0.06, gm, fm); });
  }
}

function addBalconyRailing(scene: THREE.Scene, floor: number, bz: number, config: FacadeConfig, mm: THREE.MeshStandardMaterial, rw: number, fz: number, pfx = "rail"): void {
  let sp = 0.115, bW = 0.025;
  if (config.style === "haussmannien") { sp = 0.08; bW = 0.03; }
  else if (config.style === "contemporain" || config.style === "premium") { sp = 0.14; bW = 0.018; }
  else if (config.style === "mediterraneen") { sp = 0.1; bW = 0.028; }
  const tM = new THREE.Mesh(new THREE.BoxGeometry(rw, 0.04, 0.04), mm); tM.name = `${pfx}_top_n${floor}`; tM.position.set(0, bz + 0.96, fz); scene.add(tM);
  const bM = new THREE.Mesh(new THREE.BoxGeometry(rw, 0.04, 0.04), mm); bM.name = `${pfx}_bot_n${floor}`; bM.position.set(0, bz + 0.08, fz); scene.add(bM);
  const n2 = Math.max(1, Math.floor(rw / sp)), s2 = rw / n2, sx = -(rw / 2) + s2 / 2, bH = 0.84, bCY = bz + 0.08 + bH / 2;
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(bW, bH, 0.025), mm, n2); inst.name = `barreaux_n${floor}${pfx !== "rail" ? `_${pfx}` : ""}`;
  const d = new THREE.Object3D();
  for (let i = 0; i < n2; i++) { d.position.set(sx + i * s2, bCY, fz); d.updateMatrix(); inst.setMatrixAt(i, d.matrix); }
  inst.instanceMatrix.needsUpdate = true; scene.add(inst);
}

async function buildFacadeGltfBlob(config: FacadeConfig): Promise<Blob> {
  const scene = new THREE.Scene();
  const h = computeHeight(config);
  const tC = TOITURE_COLORS[config.materiauToiture] ?? 0x808080;
  const mC = MENUISERIES_COLORS[config.materiauMenuiseries] ?? 0x303030;
  const zm = getZoneMaterials(config);
  const sM = new THREE.MeshStandardMaterial({ color: zm.soubassement.color, roughness: zm.soubassement.roughness, metalness: zm.soubassement.metalness, name: "MMZ_soubassement" });
  const fM = new THREE.MeshStandardMaterial({ color: zm.corps.color, roughness: zm.corps.roughness, metalness: zm.corps.metalness, name: "MMZ_facade" });
  const aM = new THREE.MeshStandardMaterial({ color: zm.attique.color, roughness: zm.attique.roughness, metalness: zm.attique.metalness, name: "MMZ_attique" });
  const tM = new THREE.MeshStandardMaterial({ color: tC, roughness: 0.7, metalness: 0.2, name: "MMZ_toiture" });
  const mm = new THREE.MeshStandardMaterial({ color: mC, roughness: 0.35, metalness: 0.7, name: "MMZ_menuiseries" });
  const su = new THREE.Mesh(new THREE.BoxGeometry(W, RDC_H, D), sM); su.name = "facade_soubassement"; su.position.set(0, RDC_H / 2, 0); scene.add(su);
  const CH = Math.max(0, config.nbEtages - 1) * FLOOR_H;
  if (CH > 0) { const c = new THREE.Mesh(new THREE.BoxGeometry(W, CH, D), fM); c.name = "facade_corps"; c.position.set(0, RDC_H + CH / 2, 0); scene.add(c); }
  if (config.style === "haussmannien" || config.style === "premium") {
    const bM2 = new THREE.MeshStandardMaterial({ color: 0x8a7a60, roughness: 0.88, metalness: 0.0, name: "MMZ_bandeau" });
    const b = new THREE.Mesh(new THREE.BoxGeometry(W + 0.1, 0.22, D + 0.1), bM2); b.name = "facade_bandeau"; b.position.set(0, RDC_H + 0.11, 0); scene.add(b);
  }
  const gm = new THREE.MeshStandardMaterial({ color: 0x1a2a3a, roughness: 0.05, metalness: 0.9, name: "MMZ_vitrage" });
  const fm = new THREE.MeshStandardMaterial({ color: mC, roughness: 0.35, metalness: config.materiauMenuiseries.includes("Aluminium") ? 0.8 : 0.1, name: "MMZ_cadre" });
  addWindowsToScene(scene, config, gm, fm);
  if (config.attique) { const at = new THREE.Mesh(new THREE.BoxGeometry(W * 0.85, ATTIC_H, D * 0.85), aM); at.name = "facade_attique"; at.position.set(0, h - ATTIC_H + ATTIC_H / 2, 0); scene.add(at); }
  const r = new THREE.Mesh(new THREE.BoxGeometry(W + 0.3, 0.4, D + 0.3), tM); r.name = "facade_toiture"; r.position.set(0, h + 0.2, 0); scene.add(r);
  if (config.balcons) {
    const bm = new THREE.MeshStandardMaterial({ color: 0xc8c5c0, roughness: 0.9, metalness: 0.0 });
    for (let fl = 1; fl < config.nbEtages; fl++) { const z = RDC_H + fl * FLOOR_H - 0.1; const b2 = new THREE.Mesh(new THREE.BoxGeometry(W, 0.18, 1.2), bm); b2.name = `balcon_n${fl}`; b2.position.set(0, z + 0.09, -D / 2 - 0.6); scene.add(b2); addBalconyRailing(scene, fl, z + 0.18, config, mm, W, -D / 2 - 1.18); }
  }
  if (config.loggias) {
    const bm = new THREE.MeshStandardMaterial({ color: 0xc8c5c0, roughness: 0.9, metalness: 0.0 });
    for (let fl = 1; fl < config.nbEtages; fl++) { const z = RDC_H + fl * FLOOR_H - 0.1; const l = new THREE.Mesh(new THREE.BoxGeometry(W * 0.5, 0.12, 0.9), bm); l.name = `loggia_n${fl}`; l.position.set(0, z + 0.06, D / 2 + 0.45); scene.add(l); addBalconyRailing(scene, fl, z + 0.12, config, mm, W * 0.5, D / 2 + 0.88, "loggia"); }
  }
  if (config.corniche) { const c2 = new THREE.Mesh(new THREE.BoxGeometry(W + 0.6, 0.5, D + 0.6), tM); c2.name = "facade_corniche"; c2.position.set(0, h - 0.25, 0); scene.add(c2); }
  if (config.socle) { const s2 = new THREE.Mesh(new THREE.BoxGeometry(W + 0.2, 0.6, D + 0.2), tM); s2.name = "facade_socle"; s2.position.set(0, 0.3, 0); scene.add(s2); }
  const g = new THREE.Mesh(new THREE.PlaneGeometry(80, 60), new THREE.MeshStandardMaterial({ color: 0x595955, roughness: 0.95, metalness: 0.0 }));
  g.name = "TERRAIN_ground"; g.rotation.x = -Math.PI / 2; g.position.set(0, -0.01, 0); scene.add(g);
  return new Promise((res, rej) => new GLTFExporter().parse(scene,
    (r2) => res(r2 instanceof ArrayBuffer ? new Blob([r2], { type: "model/gltf-binary" }) : new Blob([JSON.stringify(r2)], { type: "model/gltf+json" })),
    (e) => rej(new Error(`GLTFExporter: ${String(e)}`)), { binary: true }));
}

// -----------------------------------------------------------------------------
// [V5.9] Ornements de façade (détails architecturaux d'habillage)
// -----------------------------------------------------------------------------
// Chaque ornement actif est : (a) injecté dans le prompt IA via `promptHint`,
// (b) câblé vers le modèle 2D via `buildFlag` (clé de Facade2DBuildInput) pour
// être DESSINÉ dans la preview. Pour en ajouter un : une entrée ici + le flag
// correspondant dans facade2d.types.ts / buildFacade2DModel.ts / renderFacade2DSvg.tsx.
// -----------------------------------------------------------------------------

type OrnamentId =
  | "colombages" | "volets" | "encadrements" | "lucarnes"
  | "ferronnerie" | "bandeaux" | "brise_soleil" | "parement_brique";

interface OrnamentDef {
  id: OrnamentId;
  label: string;
  icon: ReactNode;
  /** Clé booléenne transmise à Facade2DBuildInput pour le rendu 2D. */
  buildFlag: keyof Facade2DBuildInput;
  /** Descripteur injecté dans le prompt IA. */
  promptHint: string;
}

const ORNAMENTS: OrnamentDef[] = [
  {
    id: "colombages", label: "Colombages", icon: <Grid3x3 className="h-3.5 w-3.5 shrink-0" />,
    buildFlag: "hasColombages",
    promptHint: " ORNEMENT : pans de bois (colombages) apparents structurant la façade — montants verticaux et croisillons sombres sur un remplissage en enduit clair.",
  },
  {
    id: "volets", label: "Volets battants", icon: <Blinds className="h-3.5 w-3.5 shrink-0" />,
    buildFlag: "hasShutters",
    promptHint: " ORNEMENT : volets battants en bois (pleins ou persiennés) de part et d'autre de chaque fenêtre.",
  },
  {
    id: "encadrements", label: "Encadrements", icon: <Frame className="h-3.5 w-3.5 shrink-0" />,
    buildFlag: "hasEncadrements",
    promptHint: " ORNEMENT : encadrements de baies marqués (pierre ou enduit contrastant) autour de chaque ouverture.",
  },
  {
    id: "lucarnes", label: "Lucarnes", icon: <Home className="h-3.5 w-3.5 shrink-0" />,
    buildFlag: "hasLucarnes",
    promptHint: " ORNEMENT : lucarnes à fronton émergeant des versants de toiture (uniquement si toiture en pente).",
  },
  {
    id: "ferronnerie", label: "Ferronnerie", icon: <Fence className="h-3.5 w-3.5 shrink-0" />,
    buildFlag: "hasFerronnerie",
    promptHint: " ORNEMENT : garde-corps et grilles en fer forgé ouvragé aux balcons et fenêtres.",
  },
  {
    id: "bandeaux", label: "Bandeaux & moulures", icon: <SeparatorHorizontal className="h-3.5 w-3.5 shrink-0" />,
    buildFlag: "hasBandeaux",
    promptHint: " ORNEMENT : bandeaux horizontaux et moulures soulignant la séparation des niveaux.",
  },
  {
    id: "brise_soleil", label: "Brise-soleil", icon: <Rows3 className="h-3.5 w-3.5 shrink-0" />,
    buildFlag: "hasBriseSoleil",
    promptHint: " ORNEMENT : brise-soleil à lames horizontales / pergolas contemporaines en façade.",
  },
  {
    id: "parement_brique", label: "Parement brique", icon: <BrickWall className="h-3.5 w-3.5 shrink-0" />,
    buildFlag: "hasParementBrique",
    promptHint: " ORNEMENT : parement de brique apparente en accent sur une partie de la façade.",
  },
];

// -----------------------------------------------------------------------------
// [V5.9] Sélecteur de style UNIFIÉ
// -----------------------------------------------------------------------------
// Fusionne les anciens "Styles prédéfinis" + "Style architectural" + "Inspiration
// régionale" en un seul axe rangé en 3 familles. Choisir un style applique une
// config complète + (régional) un `promptHint` + des ornements pertinents.
// Pour ajouter un style : une entrée dans FACADE_STYLES. Rien d'autre à toucher.
// -----------------------------------------------------------------------------

type FacadeStyleFamily = "contemporain" | "classique" | "regional";

interface FacadeStyleDef {
  id: string;
  family: FacadeStyleFamily;
  label: string;
  description: string;
  /** Config appliquée à la sélection (inclut `style` structurel). */
  config: Partial<FacadeConfig>;
  /** Descripteur IA fort (styles régionaux). */
  promptHint?: string;
  /** Ornements auto-activés à la sélection. */
  autoOrnaments?: OrnamentId[];
}

const FACADE_FAMILIES: { id: FacadeStyleFamily; label: string }[] = [
  { id: "contemporain", label: "Contemporain" },
  { id: "classique",    label: "Classique" },
  { id: "regional",     label: "Régional" },
];

const BASQUE_HINT =
  " STYLE RÉGIONAL OBLIGATOIRE — MAISON BASQUE LABOURDINE : murs en enduit à la chaux BLANC immaculé ; colombages verticaux peints en ROUGE BASQUE (rouge sang-de-bœuf), parfois vert basque, concentrés sur l'étage et autour des ouvertures ; toiture à deux pans ASYMÉTRIQUES de faible pente en tuiles canal rouge-orangé ; large débord de toit ; volets bois assortis. NE PAS produire un immeuble contemporain. Conserver impérativement le nombre d'étages de l'image de référence.";
const BRETONNE_HINT =
  " STYLE RÉGIONAL OBLIGATOIRE — LONGÈRE BRETONNE : murs en GRANIT gris apparent en moellons, encadrements de baies en pierre de taille plus claire ; toiture à FORTE pente en ARDOISE bleu-noir ; lucarnes à fronton ; menuiseries bois peint ; volume bas et allongé ; ambiance côtière atlantique. Conserver impérativement le nombre d'étages de l'image de référence.";
const ALSACIENNE_HINT =
  " STYLE RÉGIONAL OBLIGATOIRE — MAISON ALSACIENNE À COLOMBAGES (Fachwerk) : pans de bois TRÈS APPARENTS en motifs géométriques (croix de Saint-André, losanges) ; remplissage en enduit coloré (ocre, rose pâle, bleu) ; toiture à TRÈS FORTE pente en tuiles plates ; lucarnes ; volets bois peint. Conserver impérativement le nombre d'étages de l'image de référence.";
const NORMANDE_HINT =
  " STYLE RÉGIONAL OBLIGATOIRE — MAISON NORMANDE À COLOMBAGES (Pays d'Auge) : pans de bois BRUN FONCÉ verticaux et en croisillons sur enduit clair ; toiture à forte pente en ardoise foncée ; lucarnes ; soubassement brique ou silex. Conserver impérativement le nombre d'étages de l'image de référence.";
const LANDAISE_HINT =
  " STYLE RÉGIONAL OBLIGATOIRE — MAISON LANDAISE (airial) : maison BASSE et allongée, façade sous un grand AUVENT débordant porté par des poteaux de bois ; murs en enduit clair avec colombages discrets ; toiture à deux pans de faible pente en tuiles canal ; environnement de pins. Conserver impérativement le nombre d'étages de l'image de référence.";
const CHALET_HINT =
  " STYLE RÉGIONAL OBLIGATOIRE — CHALET SAVOYARD ALPIN : soubassement en PIERRE maçonnée, étages en BOIS (madriers/bardage) couleur miel à brun ; grands BALCONS en bois ouvragé ; toiture à deux pans de faible pente avec TRÈS LARGE débord ; volets bois ; ambiance montagne. Conserver impérativement le nombre d'étages de l'image de référence.";
const PROVENCAL_HINT =
  " STYLE RÉGIONAL OBLIGATOIRE — MAISON PROVENÇALE / MAS : façade en enduit à la chaux teinté OCRE (jaune paille, terre de Sienne) ; corniche en GÉNOISE sous le toit ; toiture à faible pente en tuiles canal vieillies ; volets bois persiennés (bleu lavande, vert amande) ; cyprès et oliviers. Conserver impérativement le nombre d'étages de l'image de référence.";

const FACADE_STYLES: FacadeStyleDef[] = [
  // ── Contemporain ──
  {
    id: "contemporain-urbain", family: "contemporain",
    label: "Contemporain urbain", description: "Façade épurée, zinc, balcons filants",
    config: { style: "contemporain", materiauFacade: "Béton architectonique", materiauMenuiseries: "Aluminium gris anthracite", materiauToiture: "Zinc joint debout", ambiance: "matin", vegetation: "legere", balcons: true, corniche: false },
  },
  {
    id: "premium-moderne", family: "contemporain",
    label: "Premium moderne", description: "Pierre, aluminium, toiture terrasse",
    config: { style: "premium", materiauFacade: "Pierre de taille", materiauMenuiseries: "Aluminium gris anthracite", materiauToiture: "Toiture terrasse végétalisée", ambiance: "golden", vegetation: "premium", loggias: true, attique: true },
    autoOrnaments: ["brise_soleil"],
  },
  {
    id: "tour-de-verre", family: "contemporain",
    label: "Tour de verre", description: "Mur-rideau, structure acier, tertiaire",
    config: { style: "verre" as FacadeConfig["style"], materiauFacade: "Mur-rideau verre", materiauMenuiseries: "Aluminium gris anthracite", materiauToiture: "Toiture terrasse gravier", ambiance: "golden", vegetation: "legere", balcons: false, loggias: false, corniche: false, socle: false, attique: true, rdcType: "Hall résidentiel", rythme: "Régulier" },
  },
  // ── Classique ──
  {
    id: "haussmannien", family: "classique",
    label: "Haussmannien revisité", description: "Pierre, zinc, corniches, balcons filants",
    config: { style: "haussmannien", materiauFacade: "Pierre de taille", materiauMenuiseries: "Bois peint sombre", materiauToiture: "Zinc joint debout", ambiance: "couvert", vegetation: "aucune", corniche: true, socle: true, balcons: true },
    autoOrnaments: ["encadrements", "ferronnerie", "bandeaux", "lucarnes"],
  },
  {
    id: "mediterraneen", family: "classique",
    label: "Méditerranéen", description: "Enduit ocre, volets bois, pergola",
    config: { style: "mediterraneen", materiauFacade: "Enduit beige", materiauMenuiseries: "Bois naturel", materiauToiture: "Tuile canal", ambiance: "golden", vegetation: "residentielle" },
    autoOrnaments: ["volets"],
  },
  {
    id: "neo-provencal", family: "classique",
    label: "Néo-provençal", description: "Génoise, tuiles canal, volets pastel",
    config: { style: "mediterraneen", materiauFacade: "Enduit beige", materiauMenuiseries: "Bois peint sombre", materiauToiture: "Tuile canal", ambiance: "golden", vegetation: "residentielle" },
    promptHint: PROVENCAL_HINT, autoOrnaments: ["volets", "bandeaux"],
  },
  // ── Régional ──
  {
    id: "basque", family: "regional",
    label: "Maison basque", description: "Colombages rouge basque, toit asymétrique",
    config: { style: "mediterraneen", materiauFacade: "Enduit blanc", materiauMenuiseries: "Bois peint sombre", materiauToiture: "Tuile canal", ambiance: "matin", vegetation: "residentielle" },
    promptHint: BASQUE_HINT, autoOrnaments: ["colombages", "volets"],
  },
  {
    id: "bretonne", family: "regional",
    label: "Longère bretonne", description: "Granit, ardoise pentue, lucarnes",
    config: { style: "standard", materiauFacade: "Pierre de taille", materiauMenuiseries: "Bois peint sombre", materiauToiture: "Ardoise", ambiance: "couvert", vegetation: "legere" },
    promptHint: BRETONNE_HINT, autoOrnaments: ["lucarnes", "encadrements"],
  },
  {
    id: "alsacienne", family: "regional",
    label: "Alsacienne", description: "Colombages géométriques, toit pentu",
    config: { style: "standard", materiauFacade: "Enduit beige", materiauMenuiseries: "Bois naturel", materiauToiture: "Tuile mécanique", ambiance: "matin", vegetation: "residentielle" },
    promptHint: ALSACIENNE_HINT, autoOrnaments: ["colombages", "volets"],
  },
  {
    id: "normande", family: "regional",
    label: "Normande", description: "Colombages bruns, ardoise, lucarnes",
    config: { style: "standard", materiauFacade: "Enduit blanc", materiauMenuiseries: "Bois peint sombre", materiauToiture: "Ardoise", ambiance: "couvert", vegetation: "residentielle" },
    promptHint: NORMANDE_HINT, autoOrnaments: ["colombages", "lucarnes"],
  },
  {
    id: "landaise", family: "regional",
    label: "Landaise", description: "Basse, grand auvent bois en façade",
    config: { style: "mediterraneen", materiauFacade: "Enduit blanc", materiauMenuiseries: "Bois peint sombre", materiauToiture: "Tuile canal", ambiance: "golden", vegetation: "residentielle" },
    promptHint: LANDAISE_HINT, autoOrnaments: ["colombages"],
  },
  {
    id: "chalet-savoyard", family: "regional",
    label: "Chalet savoyard", description: "Bois, balcons ouvragés, toit débordant",
    config: { style: "standard", materiauFacade: "Bardage bois", materiauMenuiseries: "Bois naturel", materiauToiture: "Tuile mécanique", ambiance: "golden", vegetation: "premium" },
    promptHint: CHALET_HINT, autoOrnaments: ["volets", "ferronnerie"],
  },
];

// -----------------------------------------------------------------------------
// UI constants
// -----------------------------------------------------------------------------

const MATERIAUX_FACADE = ["Enduit blanc","Enduit beige","Pierre de taille","Brique rouge","Bardage bois","Composite HPL","Béton architectonique","Mur-rideau verre"];
const MATERIAUX_MENUISERIES = ["Aluminium gris anthracite","Aluminium blanc","PVC blanc","Bois naturel","Bois peint sombre"];
const MATERIAUX_TOITURE = ["Zinc joint debout","Tuile canal","Tuile mécanique","Ardoise","Toiture terrasse végétalisée","Toiture terrasse gravier"];
const RDC_TYPES = ["Vitrine commerciale","Hall résidentiel","Socle pierre","Logements plain-pied","Stationnement semi-enterré"];
const RYTHMES = ["Régulier","Syncopé","Symétrique","Dynamique décalé"];

const AMBIANCES: { id: Ambiance; label: string; icon: ReactNode }[] = [
  { id: "matin",      label: "Matin clair",        icon: <Sun className="h-4 w-4" /> },
  { id: "golden",     label: "Golden hour",        icon: <Sunset className="h-4 w-4" /> },
  { id: "couvert",    label: "Ciel couvert",       icon: <Cloud className="h-4 w-4" /> },
  { id: "crepuscule", label: "Crépuscule premium", icon: <Sunset className="h-4 w-4" /> },
];
const VEGETATIONS: { id: Vegetation; label: string }[] = [
  { id: "aucune", label: "Aucune" }, { id: "legere", label: "Légère" },
  { id: "residentielle", label: "Résidentielle" }, { id: "premium", label: "Premium" },
];
const VIEW_MODES: { id: ViewMode; label: string; emoji: string }[] = [
  { id: "frontale",        label: "Frontale",  emoji: "⬜" },
  { id: "3_quarts_legers", label: "3/4 léger", emoji: "◱" },
  { id: "angle_rue",       label: "Angle rue", emoji: "🏙" },
];
const BUILDING_STANDARDS: { id: BuildingStandard; label: string }[] = [
  { id: "economique", label: "Économique" }, { id: "standard", label: "Standard" },
  { id: "qualitatif", label: "Qualitatif" }, { id: "premium", label: "Premium" },
  { id: "luxe", label: "Luxe" },
];
const DRAWING_STYLES: { id: DrawingStyle; label: string; emoji: string }[] = [
  { id: "aquarelle",           label: "Aquarelle",           emoji: "🎨" },
  { id: "esquisse_architecte", label: "Esquisse architecte", emoji: "✏️" },
  { id: "photo_realiste",      label: "Photo réaliste",      emoji: "📷" },
];

const DEFAULT_CONFIG: FacadeConfig = {
  style: "contemporain", materiauFacade: "Enduit blanc", materiauMenuiseries: "Aluminium gris anthracite",
  materiauToiture: "Zinc joint debout", rdcType: "Hall résidentiel", nbEtages: 4,
  attique: false, balcons: true, loggias: false, corniche: false, socle: true,
  rythme: "Régulier", ambiance: "matin", vegetation: "legere",
};

const PROMOTEUR_ACCENT = ACCENT_PRO;
const FOOTPRINT_COMPLEXITY_THRESHOLD = 6;

// -----------------------------------------------------------------------------
// Facade2D mappings
// -----------------------------------------------------------------------------

function mapConfigToFacade2DPreset(style: Style): Facade2DStylePresetId {
  if (style === "verre") return "contemporain-urbain";
  return style === "contemporain" ? "contemporain-urbain" : style === "premium" ? "residentiel-premium" : style === "haussmannien" ? "classique-revisite" : style === "mediterraneen" ? "mediterraneen-lumineux" : "contemporain-urbain";
}
function mapRhythm(r: string): Facade2DRhythm { return r === "Syncopé" ? "syncopated" : r === "Symétrique" ? "symmetric" : r === "Dynamique décalé" ? "dynamic" : "regular"; }
function mapAmbiance(a: string): Facade2DAmbiance { return a === "golden" ? "golden" : a === "couvert" ? "couvert" : a === "crepuscule" ? "crepuscule" : "matin"; }
function mapVegetation(v: string): Facade2DVegetation { return v === "legere" ? "legere" : v === "residentielle" ? "residentielle" : v === "premium" ? "premium" : "aucune"; }

function configToFacade2DInput(
  config: FacadeConfig,
  dims?: { widthM?: number; depthM?: number },
  ornaments?: Set<OrnamentId>,
): Facade2DBuildInput {
  const orn = ornaments ?? new Set<OrnamentId>();
  return {
    widthM: dims?.widthM ?? W, depthM: dims?.depthM ?? D, levelsCount: config.nbEtages, levelHeightM: FLOOR_H,
    roofKind: config.materiauToiture.includes("terrasse") ? "flat" : config.materiauToiture.includes("Tuile") ? "hip" : config.style === "haussmannien" ? "mansard" : "flat",
    hasAttic: config.attique, balconyMode: config.balcons ? "continuous" : "none", loggiaMode: config.loggias ? "simple" : "none",
    baseKind: config.rdcType.includes("commerciale") || config.rdcType.includes("Vitrine") ? "commercial" : config.rdcType.includes("Stationnement") ? "pilotis" : "residential",
    stylePresetId: mapConfigToFacade2DPreset(config.style), facadeMaterial: config.materiauFacade,
    windowMaterial: config.materiauMenuiseries, roofMaterial: config.materiauToiture, rhythm: mapRhythm(config.rythme),
    hasCornice: config.corniche, hasSocle: config.socle, ambiance: mapAmbiance(config.ambiance),
    vegetation: mapVegetation(config.vegetation), archStyle: config.style, rdcType: config.rdcType,
    // [V5.9] Ornements → rendu 2D (flags consommés par buildFacade2DModel / renderFacade2DSvg)
    hasColombages: orn.has("colombages"),
    hasShutters: orn.has("volets"),
    hasEncadrements: orn.has("encadrements"),
    hasLucarnes: orn.has("lucarnes"),
    hasFerronnerie: orn.has("ferronnerie"),
    hasBandeaux: orn.has("bandeaux"),
    hasBriseSoleil: orn.has("brise_soleil"),
    hasParementBrique: orn.has("parement_brique"),
  };
}

// -----------------------------------------------------------------------------
// UI helpers
// -----------------------------------------------------------------------------

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">{children}</h3>;
}
function Select({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-200">
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}
function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm transition hover:border-slate-300">
      <span className="text-sm text-slate-700">{label}</span>
      <button type="button" role="switch" aria-checked={value} onClick={() => onChange(!value)} className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors" style={{ background: value ? PROMOTEUR_ACCENT : "#e2e8f0" }}>
        <span className={["inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform", value ? "translate-x-4" : "translate-x-0.5"].join(" ")} />
      </button>
    </label>
  );
}
/** Toggle compact 2-colonnes (icône + label + mini-switch) pour la liste de détails. */
function DetailToggle({ label, icon, value, onChange }: { label: string; icon: ReactNode; value: boolean; onChange: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={value} onClick={onChange} className={["flex items-center justify-between gap-2 rounded-xl border px-2.5 py-2 text-left transition-all", value ? "border-violet-300 bg-violet-50 shadow-sm" : "border-slate-200 bg-slate-50/60 hover:border-slate-300 hover:bg-white"].join(" ")}>
      <span className="flex items-center gap-1.5 text-xs font-medium" style={value ? { color: PROMOTEUR_ACCENT } : { color: "#475569" }}>
        <span style={{ color: value ? PROMOTEUR_ACCENT : "#94a3b8" }}>{icon}</span>{label}
      </span>
      <span className="relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors" style={{ background: value ? PROMOTEUR_ACCENT : "#e2e8f0" }}>
        <span className={["inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform", value ? "translate-x-3.5" : "translate-x-0.5"].join(" ")} />
      </span>
    </button>
  );
}
function PreviewTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={["rounded-lg px-3 py-1.5 text-xs font-medium transition-all", active ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-700"].join(" ")}>
      {label}
    </button>
  );
}
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={["flex items-center gap-1.5 rounded-xl border px-2.5 py-2 text-xs font-medium transition-all", active ? "border-violet-300 bg-violet-50 shadow-sm" : "border-slate-200 bg-slate-50/60 text-slate-600 hover:border-slate-300 hover:bg-white"].join(" ")} style={active ? { color: PROMOTEUR_ACCENT } : {}}>
      {children}
    </button>
  );
}

const showDebug = typeof window !== "undefined" && (import.meta.env.DEV || new URLSearchParams(window.location.search).has("debug"));

// -----------------------------------------------------------------------------
// Helpers footprint
// -----------------------------------------------------------------------------

function polygonSignedArea2D(pts: Pt2D[]): number {
  let area = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i]!, b = pts[(i + 1) % pts.length]!; area += a.x * b.y - b.x * a.y; }
  return area / 2;
}
function sanitizeFootprintForAi(rawPts: Pt2D[]): Pt2D[] {
  if (!Array.isArray(rawPts) || rawPts.length < 3) return [];
  const unique: Pt2D[] = []; const seen = new Set<string>();
  for (const p of rawPts) { const key = `${Math.round(p.x * 1000)}_${Math.round(p.y * 1000)}`; if (!seen.has(key)) { seen.add(key); unique.push(p); } }
  if (unique.length < 3) return [];
  if (polygonSignedArea2D(unique) < 0) unique.reverse();
  return unique;
}
function normalizeFootprintForAi(rawPts: Pt2D[]): Pt2D[] {
  if (!Array.isArray(rawPts) || rawPts.length < 3) return [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of rawPts) { if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y; if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y; }
  const dx = Math.max(maxX - minX, 0.001), dy = Math.max(maxY - minY, 0.001);
  return rawPts.map((p) => ({ x: Number(((p.x - minX) / dx).toFixed(4)), y: Number(((p.y - minY) / dy).toFixed(4)) }));
}
function computeFootprintMetrics(pts: Pt2D[]): { widthM: number | null; depthM: number | null; aspectRatio: number | null; complexity: "simple"|"intermediate"|"complex"|null; volumeBreakCount: number | null } {
  if (!Array.isArray(pts) || pts.length < 3) return { widthM: null, depthM: null, aspectRatio: null, complexity: null, volumeBreakCount: null };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
  const widthM = Math.max(0, maxX - minX), depthM = Math.max(0, maxY - minY);
  const aspectRatio = depthM > 0.001 ? widthM / depthM : null;
  const uniqueDirs = new Set<string>();
  for (let i = 0; i < pts.length; i++) { const a = pts[i]!, b = pts[(i + 1) % pts.length]!; const angle = Math.atan2(b.y - a.y, b.x - a.x); uniqueDirs.add(String(Math.round((angle * 180) / Math.PI / 15) * 15)); }
  const breakCount = Math.max(0, pts.length - 4);
  const complexity: "simple"|"intermediate"|"complex" = pts.length >= 8 || uniqueDirs.size >= 6 ? "complex" : pts.length >= 6 || uniqueDirs.size >= 4 ? "intermediate" : "simple";
  return { widthM: Number(widthM.toFixed(2)), depthM: Number(depthM.toFixed(2)), aspectRatio: aspectRatio !== null ? Number(aspectRatio.toFixed(3)) : null, complexity, volumeBreakCount: breakCount };
}

async function urlToDataUrl(url: string): Promise<string> {
  if (url.startsWith("data:")) return url;
  const res = await fetch(url); const blob = await res.blob();
  return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onloadend = () => resolve(reader.result as string); reader.onerror = () => reject(new Error("FileReader failed")); reader.readAsDataURL(blob); });
}

function resolveNbEtagesFromMassing3DSnapshot(): number | null {
  try {
    const snap = getSnapshot();
    const payload = snap["massing3d"] as { data?: { scene?: MassingSceneModel } } | undefined;
    const scene = payload?.data?.scene;
    if (!scene?.buildings?.length) return null;
    const bld = scene.buildings[0]; if (!bld) return null;
    const floorsAbove = bld.levels?.aboveGroundFloors;
    if (typeof floorsAbove !== "number" || !Number.isFinite(floorsAbove) || floorsAbove < 0) return null;
    return Math.max(1, Math.min(20, floorsAbove + 1));
  } catch { return null; }
}

// -----------------------------------------------------------------------------
// Page principale
// -----------------------------------------------------------------------------

export default function FacadeGeneratorPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const studyId = searchParams.get("study");
  const previewWrapperRef = useRef<HTMLDivElement | null>(null);

  const [config, setConfig] = useState<FacadeConfig>(() => {
    const nbEtagesFromMassing3D = resolveNbEtagesFromMassing3DSnapshot();
    if (nbEtagesFromMassing3D !== null) return { ...DEFAULT_CONFIG, nbEtages: nbEtagesFromMassing3D };
    const { buildings, selectedIds } = useEditor2DStore.getState();
    if (buildings.length === 0) return DEFAULT_CONFIG;
    const selected = buildings.find((b) => selectedIds.includes(b.id));
    const target = selected ?? [...buildings].sort((a, b) => b.rect.width * b.rect.depth - a.rect.width * a.rect.depth)[0];
    const floorsAbove = typeof target?.floorsAboveGround === "number" ? target.floorsAboveGround : DEFAULT_CONFIG.nbEtages - 1;
    return { ...DEFAULT_CONFIG, nbEtages: Math.max(1, Math.min(20, floorsAbove + 1)) };
  });

  const [previewTab, setPreviewTab] = useState<"principale"|"frontale"|"contexte">(() => getFacadeImage(studyId) ? "contexte" : "frontale");
  const [viewMode, setViewMode] = useState<ViewMode>("3_quarts_legers");
  const [buildingStandard, setBuildingStandard] = useState<BuildingStandard>("standard");
  const [drawingStyle, setDrawingStyle] = useState<DrawingStyle>("aquarelle");

  // [V5.9] Sélecteur de style unifié
  const [activeFamily, setActiveFamily] = useState<FacadeStyleFamily>("contemporain");
  const [selectedStyleId, setSelectedStyleId] = useState<string | null>(null);
  // [V5.9] Ornements actifs
  const [ornaments, setOrnaments] = useState<Set<OrnamentId>>(() => new Set());

  const [includePeople, setIncludePeople] = useState(false);
  const [includeGroundFloorShops, setIncludeGroundFloorShops] = useState(false);
  const [includeWindowFlowerPots, setIncludeWindowFlowerPots] = useState(false);
  const [imageUrl, setImageUrlState] = useState<string | null>(() => getFacadeImage(studyId));
  const setImageUrl = useCallback((url: string | null) => { setImageUrlState(url); if (!url) clearFacadeImage(studyId); }, [studyId]);
  const persistImageAsync = useCallback(async (url: string) => {
    try { const dataUrl = await urlToDataUrl(url); setFacadeImage(studyId, dataUrl); setImageUrlState(dataUrl); } catch (e) { console.warn("[MMZ] persistImageAsync failed:", e); }
  }, [studyId]);

  const [generating, setGenerating] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [lastPromptUsed, setLastPromptUsed] = useState<string | null>(null);
  const [baseImageDataUrl, setBaseImageDataUrl] = useState<string | null>(null);
  const [pluOverrideConfirmed, setPluOverrideConfirmed] = useState(false);
  const [showPluWarningBanner, setShowPluWarningBanner] = useState(false);

  useLocalBlenderRender();

  const patch = (p: Partial<FacadeConfig>) => setConfig((prev) => ({ ...prev, ...p }));

  // [V5.9] Application d'un style unifié : config + ornements pertinents + (régional) hint
  const applyFacadeStyle = (s: FacadeStyleDef) => {
    setSelectedStyleId(s.id);
    setActiveFamily(s.family);
    setConfig((prev) => ({ ...prev, ...s.config }));
    setOrnaments(new Set(s.autoOrnaments ?? []));
    setRenderError(null);
  };

  const toggleOrnament = (id: OrnamentId) => {
    setOrnaments((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  const editor2dBuildings = useEditor2DStore((s) => s.buildings ?? []);
  const implMeta = usePromoteurProjectStore((s) => { try { return s.implantation2d?.meta ?? null; } catch { return null; } });

  const { facade2DModel, facadeSource, facadeRenderSpec, facadeSceneInput, selectedBuildingId } = useMemo(() => {
    const selectedBuildingId = resolveSelectedBuildingId(editor2dBuildings);
    const facadeSceneInput   = buildFacadeSceneInput(config, selectedBuildingId);
    const facadeRenderSpec   = buildFacadeRenderSpec(facadeSceneInput);
    const widthM = facadeRenderSpec.widthM;
    const depthM = facadeRenderSpec.footprintMeta?.footprintDepth ?? (facadeSceneInput.footprint?.length >= 3 ? (() => { const pts = facadeSceneInput.footprint as Array<{ x: number; y: number }>; const ys = pts.map((p) => p.y); return Math.max(...ys) - Math.min(...ys); })() : D);
    const uiFallback = configToFacade2DInput(config, undefined, ornaments);
    const resolved = resolveFacadeProjectInput(extractFromEditor2D(editor2dBuildings), extractFromProjectStore(implMeta), uiFallback);
    return { facade2DModel: buildFacade2DModel(configToFacade2DInput(config, { widthM, depthM }, ornaments)), facadeSource: resolved.sourceResolved, facadeRenderSpec, facadeSceneInput, selectedBuildingId };
  }, [config, editor2dBuildings, implMeta, ornaments]);

  const rawFootprintPts = useMemo((): Pt2D[] => {
    const rawFp = facadeSceneInput.footprint as Array<{ x: number; y: number }> | undefined;
    if (Array.isArray(rawFp) && rawFp.length >= 3) { const s = sanitizeFootprintForAi(rawFp.map((p) => ({ x: p.x, y: p.y }))); if (s.length >= 3) return s; }
    const segs = facadeRenderSpec.footprintMeta?.segments;
    if (Array.isArray(segs) && segs.length >= 3) { const s = sanitizeFootprintForAi(segs.map((s2) => ({ x: s2.start.x, y: s2.start.y }))); if (s.length >= 3) return s; }
    const selected = editor2dBuildings.find((b) => { if (!b || typeof b !== "object") return false; const r = b as Record<string, unknown>; return typeof r.id === "string" && r.id === selectedBuildingId; });
    const localPts = extractRawFootprintFromBuildingRecord(selected);
    if (localPts.length >= 3) return sanitizeFootprintForAi(localPts);
    return [];
  }, [facadeSceneInput.footprint, facadeRenderSpec.footprintMeta, editor2dBuildings, selectedBuildingId]);

  const hasRealFootprint = facadeSceneInput.hasRealFootprint === true;
  const showMassInset = false;
  const isFootprintComplex = hasRealFootprint && rawFootprintPts.length >= FOOTPRINT_COMPLEXITY_THRESHOLD;

  const { pluMaxFloorsIndicative, floorsExceedPlu, floorWarningLevel, floorWarningMessage } = useMemo(() => {
    const rn = (implMeta as { nbEtagesMaxPlu?: number } | null)?.nbEtagesMaxPlu ?? (implMeta as { plu?: { nbEtagesMax?: number } } | null)?.plu?.nbEtagesMax ?? null;
    const rh = (implMeta as { plu?: { hauteurMax?: number } } | null)?.plu?.hauteurMax ?? null;
    const plu = rn ?? (rh !== null ? Math.floor(rh / FLOOR_H) : null);
    const exc = plu !== null && config.nbEtages > plu;
    const ov = plu !== null ? config.nbEtages - plu : 0;
    const lvl: "none"|"soft"|"hard" = !exc ? "none" : ov <= 1 ? "soft" : "hard";
    const msg = !exc ? null : `Le PLU indique un plafond de ${plu} étage${plu! > 1 ? "s" : ""} sur cette parcelle. Vous en demandez ${config.nbEtages - 1} (R+${config.nbEtages - 1}) — le rendu sera réalisé à titre indicatif.`;
    return { pluMaxFloorsIndicative: plu, floorsExceedPlu: exc, floorWarningLevel: lvl, floorWarningMessage: msg };
  }, [implMeta, config.nbEtages]);

  useEffect(() => { if (!floorsExceedPlu) { setPluOverrideConfirmed(false); setShowPluWarningBanner(false); } }, [floorsExceedPlu]);
  useEffect(() => { return () => { if (imageUrl?.startsWith("blob:")) URL.revokeObjectURL(imageUrl); }; }, [imageUrl]);

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
        const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) { URL.revokeObjectURL(mainUrl); reject(new Error("Canvas 2D context unavailable")); return; }
        ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, width, height); ctx.drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(mainUrl);
        const INSET_W = 300, INSET_H = 240, MARGIN = 22;
        const insetSvgStr = showMassInset && rawFootprintPts.length >= 3 ? buildMassInsetSvg(rawFootprintPts, config.nbEtages, INSET_W, INSET_H) : null;
        if (insetSvgStr) {
          const insetUrl = URL.createObjectURL(new Blob([insetSvgStr], { type: "image/svg+xml;charset=utf-8" }));
          const insetImg = new Image();
          insetImg.onload = () => {
            const BW = INSET_W + 22, BH = INSET_H + 28, bx = width - BW - MARGIN, by = MARGIN;
            ctx.save(); ctx.fillStyle = "rgba(255,255,255,0.93)"; ctx.strokeStyle = "rgba(0,0,0,0.09)"; ctx.lineWidth = 1;
            roundRectPath(ctx, bx, by, BW, BH, 8); ctx.fill(); ctx.stroke();
            ctx.fillStyle = "#909090"; ctx.font = "bold 10px 'Helvetica Neue',Arial,sans-serif"; ctx.textAlign = "center";
            ctx.fillText("MASSE · EMPRISE RÉELLE", bx + BW / 2, by + 16); ctx.drawImage(insetImg, bx + 11, by + 22, INSET_W, INSET_H); ctx.restore();
            URL.revokeObjectURL(insetUrl); resolve(canvas.toDataURL("image/png"));
          };
          insetImg.onerror = () => { URL.revokeObjectURL(insetUrl); resolve(canvas.toDataURL("image/png")); };
          insetImg.src = insetUrl;
        } else { resolve(canvas.toDataURL("image/png")); }
      };
      img.onerror = () => { URL.revokeObjectURL(mainUrl); reject(new Error("Échec chargement SVG")); };
      img.src = mainUrl;
    });
  };

  const handleGenerateFacadeSketch = async () => {
    if (floorsExceedPlu && !pluOverrideConfirmed) { setShowPluWarningBanner(true); return; }
    setGenerating(true); setRenderError(null); setShowPluWarningBanner(false); setPreviewTab("contexte");
    try {
      const effectiveWidthM = facadeRenderSpec.widthM;
      const hasRealFp = facadeSceneInput.hasRealFootprint === true;
      let pngDataUrl = await exportPreviewAsPng(1400, 900);
      if ((viewMode === "frontale" || viewMode === "angle_rue") && !hasRealFp) {
        pngDataUrl = buildRectangularSilhouetteDataUrl(1536, 1024, config.nbEtages, 5);
      }
      setBaseImageDataUrl(pngDataUrl);
      const basePrompt = buildFacadeAiPrompt({ config, widthM: effectiveWidthM, heightM: facade2DModel.heightM, levelsCount: facade2DModel.levelsCount, sourceLabel: facadeSource, view: viewMode, buildingStandard, drawingStyle: drawingStyle as NonNullable<FacadeAiPromptInput["drawingStyle"]> });
      const massHint = hasRealFp && rawFootprintPts.length >= 3 ? " L'emprise au sol du bâtiment est irrégulière ; respecter scrupuleusement la volumétrie et ne pas la simplifier en bloc rectangulaire." : "";
      const floorCountHint = ` CONTRAINTE STRUCTURELLE IMPÉRATIVE : le bâtiment doit avoir EXACTEMENT ${config.nbEtages} niveau${config.nbEtages > 1 ? "x" : ""} habitable${config.nbEtages > 1 ? "s" : ""} au total${config.attique ? ", plus UN attique légèrement en retrait au sommet (et seulement un)" : ""}. INTERDICTION FORMELLE d'ajouter des étages supplémentaires, même pour des raisons esthétiques ou de proportion. Respecter scrupuleusement la hauteur et le gabarit de l'image de référence. ` + (config.nbEtages === 1 ? "Bâtiment BAS de type R+0 : UN SEUL niveau au-dessus du sol. " : config.nbEtages === 2 ? "Bâtiment bas R+1 : exactement 2 niveaux visibles (RDC + 1 étage au-dessus). " : config.nbEtages <= 4 ? `Immeuble bas à moyen R+${config.nbEtages - 1} : ${config.nbEtages} niveaux distincts visibles. ` : "");
      const photoRealisteHint = drawingStyle === "photo_realiste" ? " STYLE OBLIGATOIRE : rendu photoréaliste de promotion immobilière. Matériaux crédibles et texturés, ombres portées réalistes, lumière naturelle directionnelle, proportions architecturales strictes, ciel photographique, reflets vitrés réalistes. Ne PAS utiliser de style aquarelle, sketch, illustration ou dessin." : "";
      const esquisseArchitecteHint = drawingStyle === "esquisse_architecte" ? " STYLE OBLIGATOIRE : CROQUIS CONCEPTUEL D'ARCHITECTE sur papier technique. Le trait noir au crayon et à l'encre doit dominer. OBLIGATOIRE : lignes de construction, lignes de fuite, cotes et annotations techniques visibles. Appliquer des lavis aquarelle transparents UNIQUEMENT en couleur secondaire. Ratio minimum 70% trait, 30% couleur. Inclure une texture de papier technique en fond." : "";
      const verreHint = (config.style as Style) === "verre" ? " ARCHITECTURE OBLIGATOIRE : façade ENTIÈREMENT VITRÉE type mur-rideau. Vitrage teinté bleu-gris occupant 90 à 95% de la surface de façade, structure métallique apparente en aluminium anodisé gris anthracite. INTERDICTION ABSOLUE de fenêtres traditionnelles isolées, d'enduit, de pierre de taille, de brique, de bardage bois. Vitrage continu du sol au plafond sur chaque niveau existant. Matériaux : acier, verre, aluminium anodisé, béton clair uniquement." : "";
      // [V5.9] Renfort de style régional (si style sélectionné porteur d'un hint)
      const styleDef = FACADE_STYLES.find((s) => s.id === selectedStyleId);
      const styleHint = styleDef?.promptHint ?? "";
      // [V5.9] Ornements actifs → descripteurs injectés
      const ornamentHint = ORNAMENTS.filter((o) => ornaments.has(o.id)).map((o) => o.promptHint).join("");
      const prompt = basePrompt + massHint + floorCountHint + photoRealisteHint + esquisseArchitecteHint + verreHint + styleHint + ornamentHint;
      const aiFootprint = sanitizeFootprintForAi(rawFootprintPts);
      const aiFootprintNormalized = normalizeFootprintForAi(aiFootprint);
      const footprintMetrics = computeFootprintMetrics(aiFootprint);
      const activeOrnaments = ORNAMENTS.filter((o) => ornaments.has(o.id)).map((o) => o.id);
      const result = await requestFacadeAiRender({
        prompt, baseImageDataUrl: pngDataUrl, drawingStyle: drawingStyle as string, view: viewMode, buildingStandard,
        floors: config.nbEtages, levelsCount: facade2DModel.levelsCount, widthM: effectiveWidthM, heightM: facade2DModel.heightM,
        facadeStyleLabel: styleDef?.label ?? (facade2DModel as { styleLabel?: string }).styleLabel ?? config.style, sourceLabel: facadeSource,
        includePeople, includeGroundFloorShops, includeWindowFlowerPots,
        hasRealFootprint: hasRealFp,
        footprintPoints: aiFootprint.length >= 3 ? aiFootprint : undefined,
        normalizedFootprintPoints: aiFootprintNormalized.length >= 3 ? aiFootprintNormalized : undefined,
        footprintWidthM: footprintMetrics.widthM ?? undefined, footprintDepthM: footprintMetrics.depthM ?? undefined,
        footprintAspectRatio: footprintMetrics.aspectRatio ?? undefined, footprintComplexity: footprintMetrics.complexity ?? undefined,
        volumeBreakCount: footprintMetrics.volumeBreakCount ?? undefined,
        massingNotes: hasRealFp ? ["Non rectangular building footprint","Preserve all recesses and offsets","Do not simplify into a rectangular building","Side volumes must follow real footprint","Main facade must match the 2D elevation exactly","Use the isometric mass inset as a strict volumetric guide"] : undefined,
        ...(styleDef ? { facadeStyleId: styleDef.id, facadeStyleFamily: styleDef.family } : {}),
        ...(activeOrnaments.length ? { ornaments: activeOrnaments } : {}),
        ...(pluOverrideConfirmed && pluMaxFloorsIndicative !== null ? { pluContext: { maxFloorsIndicative: pluMaxFloorsIndicative, notes: [`Dépassement PLU confirmé : ${config.nbEtages} étages demandés, plafond indicatif ${pluMaxFloorsIndicative}.`, "Rendu à titre indicatif uniquement."] } } : {}),
        size: "1536x1024", quality: "high", outputFormat: "png", background: "opaque",
      } as Parameters<typeof requestFacadeAiRender>[0]);
      setImageUrl(result.imageUrl); setLastPromptUsed(result.promptUsed);
      void persistImageAsync(result.imageUrl);
    } catch (e) {
      console.error("[MMZ][FacadeGeneratorPage] render failed", e);
      setRenderError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally { setGenerating(false); }
  };

  const handleDownloadFacadeImage = () => {
    if (!imageUrl) return;
    const a = document.createElement("a"); a.href = imageUrl; a.download = "mimmoza-facade-render-v1.png"; document.body.appendChild(a); a.click(); a.remove();
  };

  const [savedToSynthese, setSavedToSynthese] = useState(false);
  const handleUseInSynthese = () => {
    const imageToSave = getFacadeImage(studyId) ?? imageUrl;
    if (!imageToSave) return;
    try { const ok = writeCapture(studyId, "facadeIA", imageToSave); if (!ok) console.warn("[MMZ] writeCapture a échoué"); setSavedToSynthese(true); setTimeout(() => setSavedToSynthese(false), 3000); } catch (err) { console.error("[MMZ] Erreur sauvegarde synthèse:", err); }
  };

  const currentStyleDef = FACADE_STYLES.find((s) => s.id === selectedStyleId);
  const currentView     = VIEW_MODES.find((v) => v.id === viewMode);
  const currentDrawing  = DRAWING_STYLES.find((d) => d.id === drawingStyle);
  const familyStyles    = FACADE_STYLES.filter((s) => s.family === activeFamily);
  const activeOrnamentDefs = ORNAMENTS.filter((o) => ornaments.has(o.id));

  // Liste unique des détails architecturaux (volumétrie + ornements), sans étiquette de groupe.
  const detailItems: { key: string; label: string; icon: ReactNode; on: boolean; toggle: () => void }[] = [
    { key: "balcons",  label: "Balcons",  icon: <Building2 className="h-3.5 w-3.5 shrink-0" />, on: config.balcons,  toggle: () => patch({ balcons: !config.balcons }) },
    { key: "loggias",  label: "Loggias",  icon: <Building2 className="h-3.5 w-3.5 shrink-0" />, on: config.loggias,  toggle: () => patch({ loggias: !config.loggias }) },
    { key: "corniche", label: "Corniche", icon: <SeparatorHorizontal className="h-3.5 w-3.5 shrink-0" />, on: config.corniche, toggle: () => patch({ corniche: !config.corniche }) },
    { key: "socle",    label: "Socle",    icon: <BrickWall className="h-3.5 w-3.5 shrink-0" />, on: config.socle,    toggle: () => patch({ socle: !config.socle }) },
    ...ORNAMENTS.map((o) => ({ key: o.id, label: o.label, icon: o.icon, on: ornaments.has(o.id), toggle: () => toggleOrnament(o.id) })),
  ];

  // ── render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ── Hero v2 ── */}
      <PromoteurPageHero
        badge="Promoteur · Conception"
        title="Générateur de façades"
        metaLines={[
          { text: "Priorité à une image fidèle à la façade 2D, propre et exploitable." },
          ...(hasRealFootprint && facadeRenderSpec.footprintMeta
            ? [{ text: `⬡ Emprise réelle · ${facadeRenderSpec.widthM.toFixed(1)}m × ${facadeRenderSpec.footprintMeta.footprintDepth.toFixed(1)}m` }]
            : []),
        ]}
        actions={
          <>
            <HeroGhostButton onClick={() => navigate(studyId ? `/promoteur/massing-3d?study=${encodeURIComponent(studyId)}` : "/promoteur/massing-3d")}>
              <ArrowLeft className="h-4 w-4" />
              Massing 3D
            </HeroGhostButton>
            <HeroPrimaryButton onClick={() => void handleGenerateFacadeSketch()} disabled={generating}>
              {generating ? <><RefreshCw className="h-4 w-4 animate-spin" />Génération…</> : <><Wand2 className="h-4 w-4" />Générer image façade</>}
            </HeroPrimaryButton>
          </>
        }
      />

      {/* ── Grid panneau + preview ── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_1fr]">

        {/* ── Panneau gauche ── */}
        <div className="space-y-4">

          {/* ── [V5.9] Sélecteur de style unifié ── */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <SectionTitle><span className="flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5" />Style de façade</span></SectionTitle>
            {/* Onglets familles */}
            <div className="mb-3 flex gap-1.5">
              {FACADE_FAMILIES.map((f) => {
                const active = activeFamily === f.id;
                return (
                  <button key={f.id} type="button" onClick={() => setActiveFamily(f.id)} className={["flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-all", active ? "text-white shadow-sm" : "border border-slate-200 bg-white text-slate-500 hover:text-slate-700"].join(" ")} style={active ? { background: PROMOTEUR_ACCENT } : {}}>
                    {f.label}
                  </button>
                );
              })}
            </div>
            {/* Grille de styles */}
            <div className="grid grid-cols-2 gap-2">
              {familyStyles.map((s) => {
                const active = selectedStyleId === s.id;
                return (
                  <button key={s.id} type="button" onClick={() => applyFacadeStyle(s)} title={s.description} className={["flex flex-col items-start gap-0.5 rounded-xl border px-2.5 py-2 text-left transition-all", active ? "border-violet-300 bg-violet-50 shadow-sm" : "border-slate-200 bg-slate-50/60 text-slate-700 hover:border-slate-300 hover:bg-white"].join(" ")} style={active ? { color: PROMOTEUR_ACCENT } : {}}>
                    <span className="text-xs font-medium leading-tight">{s.label}</span>
                    <span className="text-[10px] leading-snug text-slate-400">{s.description}</span>
                  </button>
                );
              })}
            </div>
            {currentStyleDef?.promptHint && (
              <p className="mt-2.5 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-2 text-[11px] leading-relaxed text-violet-700">
                <strong>{currentStyleDef.label}</strong> — renfort de caractère régional appliqué au rendu IA. Matériaux et ornements préréglés, ajustables ci-dessous.
              </p>
            )}
          </div>

          {/* ── Matériaux ── */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <SectionTitle>Matériaux</SectionTitle>
            <div className="space-y-3">
              <div><label className="mb-1 block text-xs text-slate-500">Façade</label><Select value={config.materiauFacade} options={MATERIAUX_FACADE} onChange={(v) => patch({ materiauFacade: v })} /></div>
              <div><label className="mb-1 block text-xs text-slate-500">Menuiseries</label><Select value={config.materiauMenuiseries} options={MATERIAUX_MENUISERIES} onChange={(v) => patch({ materiauMenuiseries: v })} /></div>
              <div><label className="mb-1 block text-xs text-slate-500">Toiture</label><Select value={config.materiauToiture} options={MATERIAUX_TOITURE} onChange={(v) => patch({ materiauToiture: v })} /></div>
            </div>
          </div>

          {/* ── Composition ── */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <SectionTitle>Composition</SectionTitle>
            <div className="space-y-3">
              <div><label className="mb-1 block text-xs text-slate-500">RDC</label><Select value={config.rdcType} options={RDC_TYPES} onChange={(v) => patch({ rdcType: v })} /></div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">
                  Nombre d&apos;étages — <span className="font-semibold" style={{ color: PROMOTEUR_ACCENT }}>R+{config.nbEtages - 1}</span>
                  {pluMaxFloorsIndicative !== null && (
                    <span className={["ml-2 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium", floorsExceedPlu ? floorWarningLevel === "hard" ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-600" : "bg-emerald-100 text-emerald-600"].join(" ")}>PLU max {pluMaxFloorsIndicative}</span>
                  )}
                </label>
                <input type="range" min={1} max={20} value={config.nbEtages} onChange={(e) => patch({ nbEtages: Number(e.target.value) })} className="w-full" style={{ accentColor: PROMOTEUR_ACCENT }} />
                <div className="mt-1 flex justify-between text-[10px] text-slate-400"><span>R+0</span><span>R+9</span><span>R+19</span></div>
              </div>
              {floorsExceedPlu && (
                <div className={["rounded-xl border px-3 py-3 text-xs leading-relaxed", floorWarningLevel === "hard" ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-700"].join(" ")}>
                  <div className="mb-1 flex items-center gap-1.5 font-semibold"><AlertCircle className="h-3.5 w-3.5 shrink-0" /><span>{floorWarningLevel === "hard" ? "Dépassement PLU significatif" : "Dépassement PLU indicatif"}</span></div>
                  <p className="mb-2.5">{floorWarningMessage}</p>
                  {showPluWarningBanner && !pluOverrideConfirmed ? (
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => { if (pluMaxFloorsIndicative !== null) patch({ nbEtages: pluMaxFloorsIndicative }); setShowPluWarningBanner(false); }} className={["inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 font-medium transition hover:brightness-95", floorWarningLevel === "hard" ? "border-red-300 bg-white text-red-700" : "border-amber-300 bg-white text-amber-700"].join(" ")}>Ajuster à {pluMaxFloorsIndicative} étage{pluMaxFloorsIndicative! > 1 ? "s" : ""}</button>
                      <button type="button" onClick={() => { setPluOverrideConfirmed(true); setShowPluWarningBanner(false); setTimeout(() => void handleGenerateFacadeSketch(), 0); }} className={["inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 font-medium text-white transition hover:opacity-90", floorWarningLevel === "hard" ? "bg-red-500" : "bg-amber-500"].join(" ")}>Continuer quand même</button>
                    </div>
                  ) : pluOverrideConfirmed && <p className={["text-[11px] font-medium", floorWarningLevel === "hard" ? "text-red-500" : "text-amber-500"].join(" ")}>✓ Rendu effectué en dépassement PLU — à titre indicatif uniquement</p>}
                </div>
              )}
              <Toggle label="Attique" value={config.attique} onChange={(v) => patch({ attique: v })} />
            </div>
          </div>

          {/* ── [V5.9] Détails architecturaux enrichis (liste unique) ── */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <SectionTitle>Détails architecturaux</SectionTitle>
            <div className="grid grid-cols-2 gap-2">
              {detailItems.map((d) => (
                <DetailToggle key={d.key} label={d.label} icon={d.icon} value={d.on} onChange={d.toggle} />
              ))}
            </div>
            <div className="pt-3"><label className="mb-1 block text-xs text-slate-500">Rythme de façade</label><Select value={config.rythme} options={RYTHMES} onChange={(v) => patch({ rythme: v })} /></div>
          </div>

          {/* ── Mise en scène ── */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <SectionTitle><span className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5" />Mise en scène</span></SectionTitle>
            <div className="space-y-2">
              {([
                { st: includePeople, set: setIncludePeople, icon: <Users className="h-3.5 w-3.5 shrink-0 text-slate-400" />, lbl: "Personnes" },
                { st: includeGroundFloorShops, set: setIncludeGroundFloorShops, icon: <ShoppingBag className="h-3.5 w-3.5 shrink-0 text-slate-400" />, lbl: "RDC commerces" },
                { st: includeWindowFlowerPots, set: setIncludeWindowFlowerPots, icon: <Flower2 className="h-3.5 w-3.5 shrink-0 text-slate-400" />, lbl: "Pots de fleurs aux fenêtres" },
              ] as const).map(({ st, set, icon, lbl }) => (
                <label key={lbl} className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm transition hover:border-slate-300">
                  <span className="flex items-center gap-2 text-sm text-slate-700">{icon}{lbl}</span>
                  <button type="button" role="switch" aria-checked={st} onClick={() => set((v) => !v)} className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors" style={{ background: st ? PROMOTEUR_ACCENT : "#e2e8f0" }}>
                    <span className={["inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform", st ? "translate-x-4" : "translate-x-0.5"].join(" ")} />
                  </button>
                </label>
              ))}
            </div>
            {(includePeople || includeGroundFloorShops || includeWindowFlowerPots) && (
              <p className="mt-2.5 text-[11px] leading-relaxed text-slate-400">{[includePeople && "Personnes", includeGroundFloorShops && "RDC commerces", includeWindowFlowerPots && "Pots de fleurs"].filter(Boolean).join(" · ")} seront intégrés au rendu AI.</p>
            )}
          </div>

          {/* ── Ambiance ── */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <SectionTitle>Ambiance</SectionTitle>
            <div className="grid grid-cols-2 gap-2">
              {AMBIANCES.map((a) => (
                <button key={a.id} type="button" onClick={() => patch({ ambiance: a.id })} className={["flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-all", config.ambiance === a.id ? "border-violet-300 bg-violet-50 shadow-sm" : "border-slate-200 bg-slate-50/60 text-slate-600 hover:border-slate-300 hover:bg-white"].join(" ")} style={config.ambiance === a.id ? { color: PROMOTEUR_ACCENT } : {}}>
                  {a.icon}<span className="text-xs">{a.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* ── Végétation ── */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <SectionTitle>Végétation</SectionTitle>
            <div className="grid grid-cols-2 gap-2">
              {VEGETATIONS.map((v) => (
                <button key={v.id} type="button" onClick={() => patch({ vegetation: v.id })} className={["flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm transition-all", config.vegetation === v.id ? "border-violet-300 bg-violet-50 font-medium shadow-sm" : "border-slate-200 bg-slate-50/60 text-slate-600 hover:border-slate-300 hover:bg-white"].join(" ")} style={config.vegetation === v.id ? { color: PROMOTEUR_ACCENT } : {}}>
                  <TreePine className="h-3.5 w-3.5 shrink-0" /><span className="text-xs">{v.label}</span>
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
            <SectionTitle><span className="flex items-center gap-1.5"><Eye className="h-3.5 w-3.5" />Vue</span></SectionTitle>
            <div className="grid grid-cols-2 gap-2">
              {VIEW_MODES.map((v) => (<Chip key={v.id} active={viewMode === v.id} onClick={() => setViewMode(v.id)}><span>{v.emoji}</span><span>{v.label}</span></Chip>))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <SectionTitle><span className="flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5" />Standard bâtiment</span></SectionTitle>
            <div className="flex flex-wrap gap-2">
              {BUILDING_STANDARDS.map((s) => (<Chip key={s.id} active={buildingStandard === s.id} onClick={() => setBuildingStandard(s.id)}>{s.label}</Chip>))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <SectionTitle><span className="flex items-center gap-1.5"><Paintbrush className="h-3.5 w-3.5" />Style de dessin</span></SectionTitle>
            <div className="grid grid-cols-2 gap-2">
              {DRAWING_STYLES.map((d) => (<Chip key={d.id} active={drawingStyle === d.id} onClick={() => setDrawingStyle(d.id)}><span>{d.emoji}</span><span>{d.label}</span></Chip>))}
            </div>
          </div>
        </div>

        {/* ── Colonne droite ── */}
        <div className="space-y-4">

          {/* Preview façade 2D */}
          <div className="sticky top-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div className="flex items-center gap-2">
                <ImageOff className="h-4 w-4 text-slate-400" />
                <span className="text-sm font-semibold text-slate-700">Prévisualisation façade</span>
                {hasRealFootprint && <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">⬡ Emprise réelle</span>}
              </div>
              <div className="flex items-center gap-0.5 rounded-xl bg-slate-100 p-1">
                <PreviewTab label="Vue principale" active={previewTab === "principale"} onClick={() => setPreviewTab("principale")} />
                <PreviewTab label="Frontale"       active={previewTab === "frontale"}   onClick={() => setPreviewTab("frontale")} />
                <PreviewTab label="Contexte"       active={previewTab === "contexte"}   onClick={() => setPreviewTab("contexte")} />
              </div>
            </div>

            <div className="relative flex aspect-[16/10] w-full items-center justify-center overflow-hidden bg-gradient-to-br from-slate-100 via-slate-50 to-purple-50">
              <div ref={previewWrapperRef} className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white" style={{ display: previewTab === "contexte" ? "none" : "flex" }}>
                <div className="w-full max-w-2xl px-4"><Facade2DSvgRenderer model={facade2DModel} width={640} /></div>
                <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-400">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  {facade2DModel.styleLabel} · {facade2DModel.widthM.toFixed(1)}m × {facade2DModel.heightM.toFixed(1)}m · {facade2DModel.levelsCount}N
                </div>
              </div>

              {previewTab === "contexte" && imageUrl && !generating && (
                <img src={imageUrl} alt="Image façade générée" className="absolute inset-0 h-full w-full object-cover" />
              )}
              {previewTab === "contexte" && generating && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm">
                  <div className="h-10 w-10 animate-spin rounded-full border-4" style={{ borderColor: "#e9d5ff", borderTopColor: PROMOTEUR_ACCENT }} />
                  <p className="mt-3 text-sm font-medium text-slate-600">Génération image façade…</p>
                </div>
              )}
              {previewTab === "contexte" && renderError && !generating && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-red-50/90 px-8 text-center backdrop-blur-sm">
                  <AlertCircle className="mb-2 h-8 w-8 text-red-400" />
                  <p className="text-sm font-semibold text-red-700">Erreur de rendu</p>
                  <p className="mt-1 max-w-xs text-xs leading-relaxed text-red-500">{renderError}</p>
                  <button type="button" onClick={() => void handleGenerateFacadeSketch()} className="mt-3 inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium text-white" style={{ background: GRAD_PRO }}>
                    <RefreshCw className="h-4 w-4" />Réessayer
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
                    <p className="mt-1 text-xs leading-relaxed text-slate-400">Cliquez sur <strong>Générer image façade</strong>.</p>
                  </div>
                  <button type="button" onClick={() => void handleGenerateFacadeSketch()} className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow-md transition hover:opacity-90" style={{ background: GRAD_PRO }}>
                    <Wand2 className="h-4 w-4" />Générer image façade
                  </button>
                </div>
              )}
              {previewTab === "contexte" && !generating && (
                <div className="absolute bottom-3 left-3 z-20 rounded-lg border border-slate-200/80 bg-white/90 px-2.5 py-1 text-xs font-medium text-slate-600 backdrop-blur-sm shadow-sm">Vue contexte 2D stylisée</div>
              )}
              {previewTab === "contexte" && imageUrl && !generating && (
                <button type="button" onClick={() => void handleGenerateFacadeSketch()} className="absolute bottom-3 right-3 z-20 inline-flex items-center gap-1.5 rounded-xl border border-white/25 bg-black/40 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm transition hover:bg-black/60">
                  <RefreshCw className="h-3.5 w-3.5" />Régénérer
                </button>
              )}
            </div>

            <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3">
              <div className="flex flex-wrap gap-2">
                {currentStyleDef && <span className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2 py-1 text-[11px] font-medium" style={{ color: PROMOTEUR_ACCENT }}>{currentStyleDef.label}</span>}
                <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600">R+{config.nbEtages - 1}{config.attique ? " + Attique" : ""}</span>
                {hasRealFootprint && facadeRenderSpec.footprintMeta && <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] text-emerald-700">{facadeRenderSpec.widthM.toFixed(1)}m × {facadeRenderSpec.footprintMeta.footprintDepth.toFixed(1)}m</span>}
                <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600">{config.materiauFacade}</span>
                <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600">{AMBIANCES.find((a) => a.id === config.ambiance)?.label}</span>
                <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600">{currentView?.emoji} {currentView?.label}</span>
                <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600">{currentDrawing?.emoji} {currentDrawing?.label}</span>
                {config.vegetation !== "aucune" && <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] text-emerald-700"><TreePine className="h-3 w-3" />Végétation {config.vegetation}</span>}
                {activeOrnamentDefs.map((o) => (
                  <span key={o.id} className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2 py-1 text-[11px]" style={{ color: PROMOTEUR_ACCENT }}>{o.icon}{o.label}</span>
                ))}
                {includePeople && <span className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2 py-1 text-[11px] text-violet-700"><Users className="h-3 w-3" />Personnes</span>}
                {includeGroundFloorShops && <span className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2 py-1 text-[11px] text-violet-700"><ShoppingBag className="h-3 w-3" />Commerces</span>}
                {includeWindowFlowerPots && <span className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2 py-1 text-[11px] text-violet-700"><Flower2 className="h-3 w-3" />Fleurs</span>}
              </div>
            </div>
          </div>

          {/* Image générée */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div className="flex items-center gap-2">
                <Wand2 className="h-4 w-4 text-slate-400" />
                <span className="text-sm font-semibold text-slate-700">Image façade générée</span>
                {imageUrl && !generating && <span className="inline-flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-medium" style={{ color: PROMOTEUR_ACCENT }}>{currentDrawing?.emoji} {currentDrawing?.label}</span>}
              </div>
              {imageUrl && !generating && (
                <div className="flex items-center gap-2">
                  <button type="button" onClick={handleDownloadFacadeImage} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-slate-800"><Download className="h-3.5 w-3.5" />Télécharger</button>
                  <button type="button" onClick={handleUseInSynthese} disabled={savedToSynthese} className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium shadow-sm transition disabled:opacity-70" style={savedToSynthese ? { borderColor: "#86efac", background: "#f0fdf4", color: "#16a34a" } : { borderColor: "#c4b5fd", background: "#f5f3ff", color: PROMOTEUR_ACCENT }}>
                    {savedToSynthese ? <><Check className="h-3.5 w-3.5" />Ajouté à la synthèse</> : <><FileText className="h-3.5 w-3.5" />Utiliser dans la synthèse</>}
                  </button>
                  <button type="button" onClick={() => void handleGenerateFacadeSketch()} disabled={generating} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-slate-800 disabled:opacity-50"><RefreshCw className="h-3.5 w-3.5" />Régénérer</button>
                </div>
              )}
            </div>
            <div className="p-4">
              {generating && (
                <div className="flex flex-col items-center justify-center gap-3 py-12">
                  <div className="h-10 w-10 animate-spin rounded-full border-4" style={{ borderColor: "#e9d5ff", borderTopColor: PROMOTEUR_ACCENT }} />
                  <p className="text-sm font-medium text-slate-600">Génération image façade…</p>
                  <p className="text-xs text-slate-400">{currentView?.emoji} {currentView?.label} · {currentDrawing?.label} · {buildingStandard}{currentStyleDef ? ` · ${currentStyleDef.label}` : ""}{hasRealFootprint && " · emprise réelle"}</p>
                </div>
              )}
              {!generating && renderError && (
                <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-red-100 bg-red-50 px-6 py-10 text-center">
                  <AlertCircle className="h-8 w-8 text-red-400" />
                  <p className="text-sm font-semibold text-red-700">Erreur de rendu image façade</p>
                  <p className="max-w-xs text-xs leading-relaxed text-red-500">{renderError}</p>
                  <button type="button" onClick={() => void handleGenerateFacadeSketch()} className="mt-1 inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium text-white" style={{ background: GRAD_PRO }}><RefreshCw className="h-4 w-4" />Réessayer</button>
                </div>
              )}
              {!generating && !renderError && imageUrl && (
                <div className="overflow-hidden rounded-xl border border-slate-100">
                  <img src={imageUrl} alt="Façade générée" className="w-full object-cover" style={{ maxHeight: 620 }} />
                  {showDebug && lastPromptUsed && <div className="border-t border-slate-100 bg-slate-50 px-3 py-2"><p className="font-mono text-[9px] leading-relaxed text-slate-400 line-clamp-3">{lastPromptUsed}</p></div>}
                </div>
              )}
              {!generating && !renderError && !imageUrl && (
                <div className="flex flex-col items-center justify-center gap-5 py-16 text-center">
                  <div className="relative flex h-20 w-20 items-center justify-center">
                    <div className="absolute inset-0 rounded-2xl opacity-15" style={{ background: GRAD_PRO }} />
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl" style={{ background: "rgba(124,111,205,0.12)" }}><Wand2 className="h-8 w-8" style={{ color: PROMOTEUR_ACCENT }} /></div>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-base font-semibold text-slate-700">Aucune image générée</p>
                    <p className="max-w-xs text-xs leading-relaxed text-slate-400">Configurez votre façade dans le panneau de gauche, puis lancez la génération.</p>
                    {hasRealFootprint && facadeRenderSpec.footprintMeta && <p className="text-[11px] text-emerald-600">Emprise réelle · {facadeRenderSpec.widthM.toFixed(1)}m × {facadeRenderSpec.footprintMeta.footprintDepth.toFixed(1)}m</p>}
                  </div>
                  <button type="button" onClick={() => void handleGenerateFacadeSketch()} disabled={generating} className="inline-flex items-center gap-2.5 rounded-2xl px-7 py-3 text-sm font-semibold text-white shadow-lg transition hover:opacity-90 disabled:opacity-60" style={{ background: GRAD_PRO }}>
                    <Wand2 className="h-4 w-4" />Générer image façade
                  </button>
                  <p className="text-[11px] text-slate-400">Vue {currentView?.label} · {currentDrawing?.label} · {buildingStandard}</p>
                </div>
              )}
            </div>
          </div>

          {/* Pipeline info */}
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl" style={{ background: "#ede9fe" }}>
                <Wand2 className="h-4 w-4" style={{ color: PROMOTEUR_ACCENT }} />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-700">Pipeline recommandé</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  <strong>emprise réelle → façade 2D + masse ISO → PNG composite → rendu AI PNG</strong>.
                  {hasRealFootprint ? ` Emprise réelle détectée · ${rawFootprintPts.length} pts.` : " Fallback géométrique (aucun bâtiment sélectionné ou emprise indisponible)."}
                </p>
                {isFootprintComplex && (
                  <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] leading-relaxed text-amber-700">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                    <span>L&apos;emprise de ce bâtiment présente une géométrie complexe ({rawFootprintPts.length} sommets). Le rendu final peut présenter des écarts par rapport au plan 2D.</span>
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {showDebug && baseImageDataUrl && <div className="hidden"><img src={baseImageDataUrl} alt="debug-base-preview" /></div>}
    </div>
  );
}