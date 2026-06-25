// massingFacadeOpenings.ts — fenêtres / portes / volets détaillés, par façade, fusionnés
// ─────────────────────────────────────────────────────────────────────────────
// Posé en coordonnées monde sur le plan de chaque mur (pas de shape+rotation).
// TOUT en fractions de la hauteur d'étage et de la largeur de travée → échelle
// correcte quelle que soit l'unité de scène.
//
// V6 — NOMBRE DE BAIES ADAPTATIF : planEdgeOpenings dérive le nombre de travées
//   de la LONGUEUR du mur (entraxe cible ~3.5 m). `baysPerEdge` ne plafonne plus
//   le compte (il sert uniquement de borne haute de sécurité). Corrige le bug
//   "toujours 4 fenêtres par façade quelle que soit la longueur".
//
// V5 — La GRILLE DE TRAVÉES est désormais centralisée dans `planEdgeOpenings`,
//   consommée À LA FOIS par ce moteur (pose vitres/cadres) ET par l'assembleur
//   (perçage réel des murs). Source unique → trous et menuiseries strictement
//   alignés. `styleForEdge`, `MIN_OPENING_EDGE` et `EdgeOpeningPlan` exportés
//   pour l'assembleur.
//
// V5.1 — NORMALE SORTANTE ROBUSTE : la normale candidate (-dz,0,dx) est flippée
//   si elle pointe vers l'intérieur (produit scalaire vs vecteur centroïde→milieu
//   d'arête). Indépendant du winding réel du footprint, gère aussi les concaves.
//   Corrige le bug "on ne voit les murs que de l'intérieur".
//
// Personnalisation PAR FAÇADE : un réglage global (défaut) + overrides par index
// d'arête (edgeOverrides[i]). Le panneau choisit quelle arête éditer.
//
// PERF : toutes les boîtes sont accumulées par matériau puis fusionnées
// (mergeGeometries) en fin de bâtiment → une poignée de meshes au lieu de milliers.
//
// Repère d'une arête (Pt2D .x/.y ; .y = z monde) :
//   sol monde = (p.x, baseY, p.y)
//   tangente t = (dx,0,dz) normalisée ; normale candidate n = (-dz,0,dx) (puis flip)
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Pt2D } from "./massingGeometry3d";
import { centroid2D } from "./massingGeometry3d";

export type WindowType = "single" | "casement2" | "cross4" | "bay";
export type ShutterType = "none" | "battants" | "roulant";
export type DoorType = "plain" | "glazed" | "transom";

// Arête en-dessous de laquelle on ne pose AUCUNE ouverture (mur plein).
// Partagé avec l'assembleur pour que les murs courts soient pleins des deux côtés.
export const MIN_OPENING_EDGE = 0.8;

// Entraxe cible entre deux baies (m). Le nombre de travées en découle.
const TARGET_BAY_SPACING_M = 3.5;

// Réglages d'une façade (ou global si appliqué à toutes).
export interface OpeningStyle {
  windowType:  WindowType;
  mullions:    boolean;     // petits-bois supplémentaires
  sill:        boolean;     // appui saillant
  shutterType: ShutterType;
  doorType:    DoorType;
  widthRatio:  number;      // largeur fenêtre / travée
  heightRatio: number;      // hauteur fenêtre / étage
}

export interface OpeningsConfig {
  enabled:      boolean;
  baysPerEdge:  number;
  door:         boolean;          // porte au RDC (façade la plus longue)
  base:         OpeningStyle;     // réglage par défaut (toutes façades)
  edgeOverrides?: Record<number, Partial<OpeningStyle>>; // par index d'arête
  shutterColor?: string;          // couleur GLOBALE des volets (indépendante façade)
}

// Couleur de volet par défaut (si openings.shutterColor absent).
export const DEFAULT_SHUTTER_COLOR = "#5c6b78";

export const DEFAULT_OPENING_STYLE: OpeningStyle = {
  windowType:  "casement2",
  mullions:    true,
  sill:        true,
  shutterType: "battants",
  doorType:    "glazed",
  widthRatio:  0.45,
  heightRatio: 0.6,
};

export const DEFAULT_OPENINGS: OpeningsConfig = {
  enabled:     false,
  baysPerEdge: 4,
  door:        true,
  base:        { ...DEFAULT_OPENING_STYLE },
  edgeOverrides: {},
};

// Résout le style effectif d'une arête (base + override éventuel).
// EXPORTÉ : l'assembleur l'utilise pour percer les murs avec le même style.
export function styleForEdge(cfg: OpeningsConfig, edgeIdx: number): OpeningStyle {
  const base = { ...DEFAULT_OPENING_STYLE, ...(cfg.base ?? {}) };
  const ov = cfg.edgeOverrides?.[edgeIdx];
  return ov ? { ...base, ...ov } : base;
}

// ─── Grille de travées MUTUALISÉE ─────────────────────────────────────────────
// Source unique de vérité pour la disposition des ouvertures sur une arête, à un
// étage donné. L'assembleur en dérive les TROUS, ce moteur en dérive les
// MENUISERIES. Tout en unités de scène (dérivé de floorH / longueur d'arête).
export interface EdgeOpeningPlan {
  maxBays:    number;
  bayW:       number;   // largeur d'une travée (unités scène)
  winW:       number;   // largeur fenêtre (unités scène)
  winH:       number;   // hauteur fenêtre (unités scène)
  winVCenter: number;   // centre vertical fenêtre, mesuré depuis la base d'étage
  doorBay:    number;   // index de travée porte, -1 si aucune
  doorW:      number;
  doorH:      number;
}

export function planEdgeOpenings(
  edgeLen: number,
  floorH: number,
  st: OpeningStyle,
  baysPerEdge: number,
  doorOnEdge: boolean,
): EdgeOpeningPlan {
  // V6 — Le nombre de baies suit la LONGUEUR du mur (entraxe cible ~3.5 m).
  // `baysPerEdge` ne plafonne plus le compte : il ne sert que de borne haute de
  // sécurité (anti-surcharge sur murs très longs), relevée pour ne pas brider.
  const idealBays = Math.max(1, Math.round(edgeLen / TARGET_BAY_SPACING_M));
  const hardCap   = Math.max(baysPerEdge, Math.floor(edgeLen / 1.5));
  const maxBays   = Math.max(1, Math.min(idealBays, hardCap));

  const bayW    = edgeLen / maxBays;
  const winH    = floorH * Math.max(0.2, Math.min(0.8, st.heightRatio));
  const winW    = bayW   * Math.max(0.2, Math.min(0.9, st.widthRatio));
  const doorBay = doorOnEdge ? Math.floor(maxBays / 2) : -1;
  const doorH   = floorH * 0.82;
  const doorW   = Math.min(winW * 1.1, bayW * 0.6);

  return { maxBays, bayW, winW, winH, winVCenter: floorH * 0.5, doorBay, doorW, doorH };
}

// ── Fractions de relief (en fraction de la hauteur d'étage) ──
const GLASS_INSET  = 0.03;   // vitre en retrait dans le mur
const FRAME_OUT    = 0.006;  // cadre quasi affleurant (petite saillie)
const FRAME_W      = 0.05;   // épaisseur cadre / hauteur fenêtre
const MULLION_W    = 0.03;   // épaisseur petit-bois / hauteur fenêtre
const SILL_OUT     = 0.02;   // appui saillant (réduit)
const SILL_H       = 0.04;   // hauteur appui / étage
const SHUTTER_OUT  = 0.012;  // volet posé sur la façade (saillie faible)
const SLAT_COUNT   = 6;      // lames par volet
const HANDLE_OUT   = 0.03;   // poignée saillante (réduit)

// Accumulateurs de géométrie par matériau (fusionnés en fin de bâtiment).
interface OpeningBuffers {
  frame:   THREE.BufferGeometry[];
  glass:   THREE.BufferGeometry[];
  shutter: THREE.BufferGeometry[];
  door:    THREE.BufferGeometry[];
  handle:  THREE.BufferGeometry[];
  sill:    THREE.BufferGeometry[];
}

function newBuffers(): OpeningBuffers {
  return { frame: [], glass: [], shutter: [], door: [], handle: [], sill: [] };
}

// Crée une box orientée sur le plan du mur, l'ajoute au buffer voulu.
function pushBox(
  buf: THREE.BufferGeometry[],
  cx: number, cy: number, cz: number,
  tx: number, tz: number, nx: number, nz: number,
  w: number, h: number, depth: number,
): void {
  if (w <= 0 || h <= 0 || depth <= 0) return;
  const geo = new THREE.BoxGeometry(w, h, depth);
  const m = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(tx, 0, tz),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(nx, 0, nz),
  );
  geo.applyMatrix4(m);
  geo.translate(cx, cy, cz);
  buf.push(geo);
}

// ── Une fenêtre complète selon le style ──
function addWindow(
  buf: OpeningBuffers, st: OpeningStyle,
  cx: number, cy: number, cz: number,
  tx: number, tz: number, nx: number, nz: number,
  winW: number, winH: number, floorH: number,
): void {
  const frameW  = winH * FRAME_W;
  const mulW    = winH * MULLION_W;
  const glassIns = floorH * GLASS_INSET;
  const frameOut = floorH * FRAME_OUT;
  const glassD   = Math.max(floorH * 0.01, 0.01);

  // Vitre (en retrait)
  pushBox(buf.glass, cx + nx*(-glassIns), cy, cz + nz*(-glassIns), tx, tz, nx, nz,
    winW - frameW, winH - frameW, glassD);

  // Cadre dormant : 4 barres saillantes
  for (const s of [-1, 1] as const) {
    pushBox(buf.frame, cx + tx*(s*(winW/2 - frameW/2)) + nx*frameOut, cy, cz + tz*(s*(winW/2 - frameW/2)) + nz*frameOut,
      tx, tz, nx, nz, frameW, winH, frameW*1.4);
  }
  for (const s of [-1, 1] as const) {
    pushBox(buf.frame, cx + nx*frameOut, cy + s*(winH/2 - frameW/2), cz + nz*frameOut,
      tx, tz, nx, nz, winW, frameW, frameW*1.4);
  }

  // Divisions selon le type
  const vMul = (offX: number) => pushBox(buf.frame,
    cx + tx*offX + nx*frameOut, cy, cz + tz*offX + nz*frameOut,
    tx, tz, nx, nz, mulW, winH - frameW, frameW*1.2);
  const hMul = (offY: number) => pushBox(buf.frame,
    cx + nx*frameOut, cy + offY, cz + nz*frameOut,
    tx, tz, nx, nz, winW - frameW, mulW, frameW*1.2);

  if (st.windowType === "casement2") {
    vMul(0); // un montant central
  } else if (st.windowType === "cross4") {
    vMul(0); hMul(0); // croix
  }
  // "single" et "bay" → pas de division principale

  // Petits-bois (grille fine) si demandé — sauf sur baie
  if (st.mullions && st.windowType !== "bay") {
    const nV = st.windowType === "cross4" ? 1 : 2;
    const nH = 2;
    for (let i = 1; i <= nV; i++) {
      const offX = (i/(nV+1) - 0.5) * (winW - frameW);
      pushBox(buf.frame, cx + tx*offX + nx*frameOut*0.8, cy, cz + tz*offX + nz*frameOut*0.8,
        tx, tz, nx, nz, mulW*0.6, winH - frameW, frameW*0.8);
    }
    for (let i = 1; i <= nH; i++) {
      const offY = (i/(nH+1) - 0.5) * (winH - frameW);
      pushBox(buf.frame, cx + nx*frameOut*0.8, cy + offY, cz + nz*frameOut*0.8,
        tx, tz, nx, nz, winW - frameW, mulW*0.6, frameW*0.8);
    }
  }

  // Appui de fenêtre
  if (st.sill) {
    const sillOut = floorH * SILL_OUT;
    const sillH   = floorH * SILL_H;
    pushBox(buf.sill, cx + nx*sillOut*0.5, cy - winH/2 - sillH/2, cz + nz*sillOut*0.5,
      tx, tz, nx, nz, winW + frameW*2, sillH, sillOut*1.6);
  }

  // Volets
  if (st.shutterType === "battants") {
    const shW  = winW * 0.5;
    const shOut = floorH * SHUTTER_OUT;
    for (const s of [-1, 1] as const) {
      // panneau de fond du volet
      const bx = cx + tx*(s*(winW/2 + shW/2)) + nx*shOut;
      const bz = cz + tz*(s*(winW/2 + shW/2)) + nz*shOut;
      pushBox(buf.shutter, bx, cy, bz, tx, tz, nx, nz, shW, winH, Math.max(floorH*0.012, 0.012));
      // lames horizontales en relief
      for (let l = 0; l < SLAT_COUNT; l++) {
        const offY = (l/(SLAT_COUNT-1) - 0.5) * (winH - winH*0.08);
        pushBox(buf.shutter, bx + nx*floorH*0.008, cy + offY, bz + nz*floorH*0.008,
          tx, tz, nx, nz, shW*0.9, (winH/SLAT_COUNT)*0.55, floorH*0.008);
      }
    }
  } else if (st.shutterType === "roulant") {
    // coffre de volet roulant au-dessus de la fenêtre
    const boxH = winH * 0.12;
    pushBox(buf.shutter, cx + nx*floorH*FRAME_OUT, cy + winH/2 + boxH/2, cz + nz*floorH*FRAME_OUT,
      tx, tz, nx, nz, winW + frameW*2, boxH, floorH*0.06);
  }
}

// ── Une porte selon le type ──
function addDoor(
  buf: OpeningBuffers, st: OpeningStyle,
  cx: number, baseY: number, cz: number,
  tx: number, tz: number, nx: number, nz: number,
  doorW: number, doorH: number, floorH: number,
): void {
  const frameOut = floorH * FRAME_OUT;
  const frameW   = doorH * FRAME_W * 0.7;
  const leafD    = Math.max(floorH*0.02, 0.02);

  // Encadrement
  for (const s of [-1, 1] as const) {
    pushBox(buf.frame, cx + tx*(s*(doorW/2 + frameW/2)) + nx*frameOut, baseY + doorH/2, cz + tz*(s*(doorW/2 + frameW/2)) + nz*frameOut,
      tx, tz, nx, nz, frameW, doorH + frameW, frameW*1.4);
  }
  pushBox(buf.frame, cx + nx*frameOut, baseY + doorH + frameW/2, cz + nz*frameOut,
    tx, tz, nx, nz, doorW + frameW*2, frameW, frameW*1.4);

  // Vantail
  pushBox(buf.door, cx + nx*frameOut, baseY + doorH/2, cz + nz*frameOut,
    tx, tz, nx, nz, doorW, doorH, leafD);

  // Vitrage selon type
  if (st.doorType === "glazed") {
    // demi-vitre haute
    pushBox(buf.glass, cx + nx*(frameOut + leafD*0.5), baseY + doorH*0.68, cz + nz*(frameOut + leafD*0.5),
      tx, tz, nx, nz, doorW*0.7, doorH*0.4, floorH*0.008);
  } else if (st.doorType === "transom") {
    // imposte vitrée au-dessus
    pushBox(buf.glass, cx + nx*(frameOut + leafD*0.5), baseY + doorH + doorH*0.1, cz + nz*(frameOut + leafD*0.5),
      tx, tz, nx, nz, doorW*0.92, doorH*0.16, floorH*0.008);
  }

  // Poignée
  const hOut = floorH * HANDLE_OUT;
  pushBox(buf.handle, cx + tx*(doorW*0.36) + nx*hOut, baseY + doorH*0.45, cz + tz*(doorW*0.36) + nz*hOut,
    tx, tz, nx, nz, doorW*0.06, doorH*0.12, hOut*1.2);
}

// ─── Point d'entrée : pose les ouvertures d'une tranche ───────────────────────
// V5 : la grille (maxBays/bayW/winW/winH/door) vient de `planEdgeOpenings` →
// strictement identique aux trous percés par l'assembleur.
// V5.1 : normale flippée vers l'extérieur réel (centroïde).
export function addOpeningsToSlice(
  group: THREE.Group,
  pts: Pt2D[],
  yBot: number,
  floorH: number,
  floorIndex: number,
  cfg: OpeningsConfig,
  bldId: string,
  longestEdgeIdx: number,
  buffers: OpeningBuffers,   // accumulateur partagé (fusion en fin de bâtiment)
): void {
  if (!cfg.enabled || pts.length < 3) return;
  const cy = yBot + floorH * 0.5;
  const C  = centroid2D(pts);   // oriente la normale vers l'extérieur réel

  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x, dz = b.y - a.y;
    const len = Math.hypot(dx, dz);
    if (len < MIN_OPENING_EDGE) continue;

    const tx = dx / len, tz = dz / len;
    // Normale candidate, flip si elle pointe vers l'intérieur (vers C).
    let nx = -dz / len, nz = dx / len;
    const mx = (a.x + b.x) / 2, mz = (a.y + b.y) / 2;
    if (nx * (mx - C.x) + nz * (mz - C.y) < 0) { nx = -nx; nz = -nz; }

    const st = styleForEdge(cfg, i);
    const doorHere = cfg.door && floorIndex === 0 && i === longestEdgeIdx;
    const plan = planEdgeOpenings(len, floorH, st, cfg.baysPerEdge, doorHere);

    for (let bay = 0; bay < plan.maxBays; bay++) {
      const t  = (bay + 0.5) / plan.maxBays;
      const cx = a.x + dx * t;
      const cz = a.y + dz * t;

      if (bay === plan.doorBay) {
        addDoor(buffers, st, cx, yBot, cz, tx, tz, nx, nz, plan.doorW, plan.doorH, floorH);
      } else {
        addWindow(buffers, st, cx, cy, cz, tx, tz, nx, nz, plan.winW, plan.winH, floorH);
      }
    }
  }
}

// Fusionne les buffers accumulés en meshes (un par matériau) et les ajoute au groupe.
let _mats: Record<string, THREE.Material> | null = null;
function getMats(): Record<string, THREE.Material> {
  if (_mats) return _mats;
  _mats = {
    // Cadre blanc cassé, net (lit comme menuiserie alu/PVC)
    frame:   new THREE.MeshStandardMaterial({ color: 0xf5f3ee, roughness: 0.55, metalness: 0.0 }),
    glass:   new THREE.MeshStandardMaterial({ color: 0x141d28, roughness: 0.08, metalness: 0.9, envMapIntensity: 1.0 }),
    shutter: new THREE.MeshStandardMaterial({ color: 0x5c6b78, roughness: 0.7, metalness: 0.0 }),
    door:    new THREE.MeshStandardMaterial({ color: 0x3f3228, roughness: 0.6, metalness: 0.05 }),
    handle:  new THREE.MeshStandardMaterial({ color: 0xc9b88a, roughness: 0.3, metalness: 0.8 }),
    sill:    new THREE.MeshStandardMaterial({ color: 0xe6e1d6, roughness: 0.8, metalness: 0.0 }),
  };
  return _mats;
}

export function flushOpenings(
  group: THREE.Group,
  bldId: string,
  buffers: OpeningBuffers,
  shutterColor: string = DEFAULT_SHUTTER_COLOR,
): void {
  const mats = getMats();
  // Le volet a sa propre couleur (globale par bâtiment) → matériau dédié, créé
  // ici et non partagé. Les autres matériaux restent des singletons partagés.
  const shutterMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(shutterColor), roughness: 0.7, metalness: 0.0,
  });
  let shutterUsed = false;

  for (const key of Object.keys(buffers) as (keyof OpeningBuffers)[]) {
    const geos = buffers[key];
    if (!geos.length) continue;
    const merged = mergeGeometries(geos, false);
    geos.forEach(g => g.dispose());
    if (!merged) continue;
    const mat = key === "shutter" ? shutterMat : mats[key];
    if (key === "shutter") shutterUsed = true;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.bldId = bldId;
    group.add(mesh);
  }

  if (!shutterUsed) shutterMat.dispose();
}

export { newBuffers };
export type { OpeningBuffers };

export function longestEdgeIndex(pts: Pt2D[]): number {
  let best = 0, bestLen = -1;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > bestLen) { bestLen = len; best = i; }
  }
  return best;
}