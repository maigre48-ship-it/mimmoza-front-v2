// massingBalconies.ts — balcons en étage (dalle + garde-corps), par façade, fusionnés
// ─────────────────────────────────────────────────────────────────────────────
// V2.2 — FILANT : une dalle par façade, FERMÉE des deux côtés (retours + nez
//   latéraux). Plus d'inférence de voisin (fragile sur footprints à arête courte
//   ou façades non contiguës) → aucun bout ne flotte. Aux angles, deux balcons
//   se rejoignent proprement (lecture "un balcon par façade").
//
// V2 — AFFINAGE GÉOMÉTRIE :
//   • Nez de dalle (fascia) retombant → ligne d'ombre, dalle épaisse.
//   • Garde-corps proportionné : main courante + plinthe + barreaux espacés.
//   • Verre/plein : poteaux intermédiaires.
//
// Architecture identique aux ouvertures :
//   • basis t / up / n par arête ; normale sortante robuste (flip vs centroïde) ;
//   • grille mutualisée via planEdgeOpenings → balcons alignés sur les fenêtres ;
//   • tout en fractions de floorH ; géométries fusionnées par matériau.
//
// 3 modes : "continuous" (dalle filante), "perBay" (une dalle/travée),
//           "french" (garde-corps seul, plaqué façade).
// Garde-corps : "bars" | "glass" | "solid".
//
// Repère arête a→b (Pt2D .x/.y ; .y = z monde) :
//   sol = (p.x, baseY, p.y) ; t = (dx,0,dz)/len ; n = (-dz,0,dx)/len puis flip.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  DEFAULT_OPENING_STYLE, MIN_OPENING_EDGE,
  planEdgeOpenings, styleForEdge,
  type OpeningsConfig,
} from "./massingFacadeOpenings";
import type { Pt2D } from "./massingGeometry3d";
import { centroid2D } from "./massingGeometry3d";

// ─── Config ───────────────────────────────────────────────────────────────────

export type BalconyMode   = "none" | "continuous" | "perBay" | "french";
export type RailingStyle  = "bars" | "glass" | "solid";

export interface BalconyConfig {
  enabled:        boolean;
  mode:           BalconyMode;   // continuous | perBay | french
  fromFloor:      number;        // premier étage concerné (0 = RDC). Défaut 1.
  depthFrac:      number;        // profondeur dalle / floorH. Défaut 0.4.
  railStyle:      RailingStyle;  // bars | glass | solid
  railHeightFrac: number;        // hauteur garde-corps / floorH. Défaut 0.38.
  railColor?:     string;        // couleur garde-corps (défaut anthracite).
  edges?:         number[];      // restreindre à certaines arêtes (défaut: toutes).
}

export const DEFAULT_BALCONIES: BalconyConfig = {
  enabled:        false,
  mode:           "perBay",
  fromFloor:      1,
  depthFrac:      0.4,
  railStyle:      "bars",
  railHeightFrac: 0.38,
  railColor:      "#4a4f55",
  edges:          undefined,
};

// ─── Proportions (fractions de floorH) — ajustables ───────────────────────────

const SLAB_THK_FRAC    = 0.06;   // épaisseur de dalle
const SLAB_INSET_FRAC  = 0.04;   // mord dans la façade (anti-jour)
const FASCIA_DROP_FRAC = 0.05;   // retombée du nez de dalle sous la dalle
const FASCIA_THK_FRAC  = 0.03;   // épaisseur du nez de dalle

const RAIL_THK_FRAC      = 0.022; // barre de référence
const POST_THK_FRAC      = 0.030; // poteau
const BALUSTER_THK_FRAC  = 0.016; // barreau vertical (un peu épais → net)
const BALUSTER_GAP_FRAC  = 0.075; // entraxe barreaux (large → fin du "moustiquaire")
const HANDRAIL_H_FRAC    = 0.038; // hauteur de la main courante
const KICK_H_FRAC        = 0.028; // hauteur de la plinthe basse
const GLASS_THK_FRAC     = 0.012; // épaisseur panneau verre
const POST_SPACING_FRAC  = 0.9;   // entraxe poteaux (verre / plein)

// ─── Buffers ──────────────────────────────────────────────────────────────────

export interface BalconyBuffers {
  slab:  THREE.BufferGeometry[];
  rail:  THREE.BufferGeometry[];
  glass: THREE.BufferGeometry[];
}

export function newBalconyBuffers(): BalconyBuffers {
  return { slab: [], rail: [], glass: [] };
}

// ─── Box orientée (basis horizontal w / up / depth) ───────────────────────────

function pushBox(
  buf: THREE.BufferGeometry[],
  cx: number, cy: number, cz: number,
  ux: number, uz: number,   // axe largeur (horizontal unitaire)
  vx: number, vz: number,   // axe profondeur (horizontal unitaire, ⟂ à u)
  w: number, h: number, d: number,
): void {
  if (w <= 0 || h <= 0 || d <= 0) return;
  const geo = new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(ux, 0, uz),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(vx, 0, vz),
  );
  geo.applyMatrix4(m);
  geo.translate(cx, cy, cz);
  buf.push(geo);
}

// ─── Un segment droit de garde-corps ──────────────────────────────────────────

function addRailRun(
  bufRail: THREE.BufferGeometry[],
  bufGlass: THREE.BufferGeometry[],
  style: RailingStyle,
  sx: number, sz: number,
  dx: number, dz: number,    // direction unitaire du run (horizontal)
  runLen: number,
  baseY: number, railH: number,
  floorH: number,
): void {
  if (runLen < 1e-3) return;

  const px = -dz, pz = dx;                 // ⟂ horizontal (épaisseur)
  const mx = sx + dx * runLen / 2;         // milieu du run
  const mz = sz + dz * runLen / 2;

  const railThk   = floorH * RAIL_THK_FRAC;
  const postThk   = floorH * POST_THK_FRAC;
  const handH     = floorH * HANDRAIL_H_FRAC;
  const kickH     = floorH * KICK_H_FRAC;
  const balThk    = floorH * BALUSTER_THK_FRAC;

  // Main courante (chunky, légèrement plus large que les poteaux)
  pushBox(bufRail, mx, baseY + railH - handH / 2, mz, dx, dz, px, pz, runLen, handH, postThk * 1.2);
  // Plinthe basse
  pushBox(bufRail, mx, baseY + kickH / 2, mz, dx, dz, px, pz, runLen, kickH, railThk * 1.3);
  // Poteaux d'extrémité
  for (const e of [0, 1] as const) {
    const ex = sx + dx * runLen * e;
    const ez = sz + dz * runLen * e;
    pushBox(bufRail, ex, baseY + railH / 2, ez, dx, dz, px, pz, postThk, railH, postThk);
  }

  // Remplissage entre plinthe et main courante
  const fillBot = baseY + kickH;
  const fillTop = baseY + railH - handH;
  const fillH   = Math.max(0, fillTop - fillBot);
  const fillCY  = (fillBot + fillTop) / 2;

  if (style === "bars") {
    const gap   = floorH * BALUSTER_GAP_FRAC;
    const nGaps = Math.max(2, Math.round(runLen / gap));
    for (let k = 1; k < nGaps; k++) {
      const t  = k / nGaps;
      const bx = sx + dx * runLen * t;
      const bz = sz + dz * runLen * t;
      pushBox(bufRail, bx, fillCY, bz, dx, dz, px, pz, balThk, fillH, balThk);
    }
  } else if (style === "glass") {
    pushBox(bufGlass, mx, fillCY, mz, dx, dz, px, pz,
      runLen - postThk * 2, fillH, floorH * GLASS_THK_FRAC);
    const ps = floorH * POST_SPACING_FRAC;
    const nP = Math.max(1, Math.round(runLen / ps));
    for (let k = 1; k < nP; k++) {
      const t  = k / nP;
      const bx = sx + dx * runLen * t;
      const bz = sz + dz * runLen * t;
      pushBox(bufRail, bx, baseY + railH / 2, bz, dx, dz, px, pz, postThk * 0.7, railH, postThk * 0.7);
    }
  } else { // solid
    pushBox(bufRail, mx, fillCY, mz, dx, dz, px, pz, runLen, fillH, floorH * 0.03);
  }
}

// ─── Dalle de balcon (+ nez de dalle) ─────────────────────────────────────────
// sideMask : [gauche, droite] — pose le nez latéral seulement si true de ce côté.

function addSlab(
  buf: BalconyBuffers,
  Px: number, Pz: number,
  tx: number, tz: number, nx: number, nz: number,
  W: number, yBase: number, depth: number, floorH: number,
  sideMask: [boolean, boolean],
): void {
  const slabThk = floorH * SLAB_THK_FRAC;
  const ov      = floorH * SLAB_INSET_FRAC;
  const faDrop  = floorH * FASCIA_DROP_FRAC;
  const faThk   = floorH * FASCIA_THK_FRAC;
  const faH     = slabThk + faDrop;
  const halfW   = W / 2;

  // Dalle
  const slabLen = depth + ov;
  const slabCN  = (depth - ov) / 2;
  pushBox(buf.slab, Px + nx * slabCN, yBase - slabThk / 2, Pz + nz * slabCN,
    tx, tz, nx, nz, W, slabThk, slabLen);

  // Nez de dalle avant
  const ox = Px + nx * (depth - faThk / 2);
  const oz = Pz + nz * (depth - faThk / 2);
  pushBox(buf.slab, ox, yBase - faH / 2, oz, tx, tz, nx, nz, W, faH, faThk);

  // Nez de dalle latéraux (selon masque)
  const signs: Array<[-1 | 1, number]> = [[-1, 0], [1, 1]];
  for (const [s, idx] of signs) {
    if (!sideMask[idx]) continue;
    const cx = Px + tx * (s * (halfW - faThk / 2)) + nx * (depth / 2);
    const cz = Pz + tz * (s * (halfW - faThk / 2)) + nz * (depth / 2);
    pushBox(buf.slab, cx, yBase - faH / 2, cz, nx, nz, tx, tz, depth, faH, faThk);
  }
}

// ─── Un balcon (dalle + garde-corps) ──────────────────────────────────────────
// closeLeft / closeRight : ferme (retour garde-corps + nez latéral) ce bout.

function addOneBalcony(
  buf: BalconyBuffers, style: RailingStyle,
  Px: number, Pz: number,
  tx: number, tz: number, nx: number, nz: number,
  W: number, yBase: number, depth: number, railH: number, floorH: number,
  closeLeft: boolean, closeRight: boolean,
): void {
  const halfW = W / 2;

  addSlab(buf, Px, Pz, tx, tz, nx, nz, W, yBase, depth, floorH, [closeLeft, closeRight]);

  // Garde-corps avant
  const ox = Px + nx * depth, oz = Pz + nz * depth;
  addRailRun(buf.rail, buf.glass, style, ox + tx * (-halfW), oz + tz * (-halfW), tx, tz, W, yBase, railH, floorH);

  // Retour gauche (inner-left → outer-left)
  if (closeLeft) {
    addRailRun(buf.rail, buf.glass, style, Px + tx * (-halfW), Pz + tz * (-halfW), nx, nz, depth, yBase, railH, floorH);
  }
  // Retour droit (inner-right → outer-right)
  if (closeRight) {
    addRailRun(buf.rail, buf.glass, style, Px + tx * (halfW), Pz + tz * (halfW), nx, nz, depth, yBase, railH, floorH);
  }
}

// ─── Balcon à la française (garde-corps seul, plaqué façade) ──────────────────

function addFrenchBalcony(
  buf: BalconyBuffers, style: RailingStyle,
  Px: number, Pz: number,
  tx: number, tz: number, nx: number, nz: number,
  W: number, yBase: number, railH: number, floorH: number,
): void {
  const halfW = W / 2;
  const out   = floorH * 0.05;
  addRailRun(buf.rail, buf.glass, style,
    Px + tx * (-halfW) + nx * out, Pz + tz * (-halfW) + nz * out,
    tx, tz, W, yBase + floorH * 0.04, railH, floorH);
}

// ─── Point d'entrée : balcons d'un étage donné ────────────────────────────────

export function addBalconiesToSlice(
  group: THREE.Group,
  ptsCCW: Pt2D[],
  yFloorBase: number,
  floorH: number,
  floorIndex: number,
  cfg: BalconyConfig,
  openingsCfg: OpeningsConfig | undefined,
  bldId: string,
  buf: BalconyBuffers,
): void {
  if (!cfg.enabled || cfg.mode === "none") return;
  if (floorIndex < cfg.fromFloor) return;
  if (ptsCCW.length < 3) return;

  const n       = ptsCCW.length;
  const C       = centroid2D(ptsCCW);
  const depth   = floorH * cfg.depthFrac;
  const railH   = floorH * cfg.railHeightFrac;
  const baysDef = openingsCfg?.baysPerEdge ?? 4;

  for (let i = 0; i < n; i++) {
    if (cfg.edges && !cfg.edges.includes(i)) continue;

    const a = ptsCCW[i];
    const b = ptsCCW[(i + 1) % n];
    const dx = b.x - a.x, dz = b.y - a.y;
    const len = Math.hypot(dx, dz);
    if (len < MIN_OPENING_EDGE) continue;

    const tx = dx / len, tz = dz / len;
    let nx = -dz / len, nz = dx / len;
    const mx = (a.x + b.x) / 2, mz = (a.y + b.y) / 2;
    if (nx * (mx - C.x) + nz * (mz - C.y) < 0) { nx = -nx; nz = -nz; }

    if (cfg.mode === "continuous") {
      // Une dalle par façade, fermée des DEUX côtés (retours + nez latéraux).
      // Aux angles, le balcon de la façade voisine vient buter contre → lecture
      // "un balcon par façade". Largeur légèrement réduite pour éviter le
      // z-fighting des dalles adjacentes au coin.
      addOneBalcony(buf, cfg.railStyle, mx, mz, tx, tz, nx, nz,
        len * 0.995, yFloorBase, depth, railH, floorH, true, true);
      continue;
    }

    // perBay / french : une instance par travée
    const st   = openingsCfg ? styleForEdge(openingsCfg, i) : DEFAULT_OPENING_STYLE;
    const plan = planEdgeOpenings(len, floorH, st, baysDef, false);

    for (let bay = 0; bay < plan.maxBays; bay++) {
      const uC = len * (bay + 0.5) / plan.maxBays;
      const Px = a.x + tx * uC, Pz = a.y + tz * uC;

      if (cfg.mode === "french") {
        addFrenchBalcony(buf, cfg.railStyle, Px, Pz, tx, tz, nx, nz,
          plan.winW * 1.15, yFloorBase, railH, floorH);
      } else { // perBay : balcons isolés → toujours fermés des 2 côtés
        const W = Math.min(plan.bayW * 0.9, plan.winW * 1.5);
        addOneBalcony(buf, cfg.railStyle, Px, Pz, tx, tz, nx, nz,
          W, yFloorBase, depth, railH, floorH, true, true);
      }
    }
  }
}

// ─── Flush : fusion par matériau, matériaux créés PAR bâtiment ─────────────────

export function flushBalconies(
  group: THREE.Group,
  bldId: string,
  buf: BalconyBuffers,
  railColor: string = "#4a4f55",
): void {
  const mats: Record<keyof BalconyBuffers, THREE.Material> = {
    slab:  new THREE.MeshStandardMaterial({ color: 0xdedad2, roughness: 0.9,  metalness: 0.0 }),
    rail:  new THREE.MeshStandardMaterial({ color: new THREE.Color(railColor), roughness: 0.5, metalness: 0.55 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x33414e, roughness: 0.1,  metalness: 0.6, transparent: true, opacity: 0.5 }),
  };

  for (const key of Object.keys(buf) as (keyof BalconyBuffers)[]) {
    const geos = buf[key];
    if (!geos.length) { mats[key].dispose(); continue; }
    const merged = mergeGeometries(geos, false);
    geos.forEach(g => g.dispose());
    if (!merged) { mats[key].dispose(); continue; }
    const mesh = new THREE.Mesh(merged, mats[key]);
    mesh.castShadow    = true;
    mesh.receiveShadow = true;
    mesh.userData.bldId = bldId;
    group.add(mesh);
  }
}