// massingFacadeBands.ts — bandes verticales de matière (accents) plaquées en façade
// ─────────────────────────────────────────────────────────────────────────────
// Pose des bandes verticales pleine hauteur, PLAQUÉES sur la façade (placage fin,
// légère saillie), d'une couleur contrastante (bois par défaut). Accents entre
// les travées de fenêtres. Construit en monde sur le plan de chaque mur, tout en
// fractions de la hauteur d'étage. Fusionné en un seul mesh (perf).
//
// V2 — FIX "bandes flottant devant la façade" :
//   • Normale sortante ROBUSTE : candidate (-dz,0,dx), flippée si elle pointe vers
//     l'intérieur (produit scalaire avec centroïde→milieu d'arête < 0). Identique
//     aux murs / fenêtres / balcons → les bandes se plaquent du BON côté quel que
//     soit le sens d'enroulement du footprint.
//   • Saillie réduite à un vrai placage (~2 cm) au lieu de ~12 cm (poutre).
//   • La bande mord légèrement dans le mur (pas de jour entre bande et façade).
//
// ⚠ Bandes LARGES = passent devant les vitres (en retrait) et les cachent. Défaut
// = bandes FINES intercalées entre travées. À élargir seulement sur une façade
// sans fenêtres.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Pt2D } from "./massingGeometry3d";
import { centroid2D } from "./massingGeometry3d";

export interface MaterialBandsConfig {
  enabled:    boolean;
  color:      string;   // couleur de la matière (bois par défaut)
  perEdge:    number;   // nb de bandes verticales par façade
  widthRatio: number;   // largeur bande / espacement (0.1–0.9)
}

export const DEFAULT_BANDS: MaterialBandsConfig = {
  enabled: false, color: "#A57C52", perEdge: 2, widthRatio: 0.3,
};

export function addMaterialBands(
  group: THREE.Group,
  pts: Pt2D[],          // footprint CCW
  baseY: number,
  totalHeight: number,
  floorHeight: number,
  cfg: MaterialBandsConfig,
  bldId: string,
): void {
  if (!cfg.enabled || pts.length < 3 || cfg.perEdge < 1) return;

  // Placage fin posé ENTIÈREMENT en saillie : la face arrière reste juste à
  // l'extérieur du plan de façade (micro-décollement anti z-fighting), donc rien
  // ne pénètre à l'intérieur — le mur percé est une coque fine, toute pénétration
  // ressortirait côté intérieur.
  const veneer = Math.max(floorHeight * 0.02,  0.02);  // épaisseur du placage
  const stand  = Math.max(floorHeight * 0.003, 0.004); // décollement (reste dehors)
  const depth  = veneer;
  const cN     = stand + veneer / 2;                   // centre le long de n (extérieur)
  const cy     = baseY + totalHeight / 2;

  const C    = centroid2D(pts);
  const geos: THREE.BufferGeometry[] = [];

  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x, dz = b.y - a.y;
    const len = Math.hypot(dx, dz);
    if (len < 1) continue;

    const tx = dx / len, tz = dz / len;
    // Normale candidate + flip vers l'extérieur réel (centroïde → milieu d'arête).
    // Strictement identique aux murs / fenêtres / balcons.
    let nx = -dz / len, nz = dx / len;
    const mx = (a.x + b.x) / 2, mz = (a.y + b.y) / 2;
    if (nx * (mx - C.x) + nz * (mz - C.y) < 0) { nx = -nx; nz = -nz; }

    const slot  = len / cfg.perEdge;
    const bandW = slot * Math.max(0.1, Math.min(0.9, cfg.widthRatio));

    for (let k = 0; k < cfg.perEdge; k++) {
      const t  = (k + 0.5) / cfg.perEdge;
      const cx = a.x + dx * t;
      const cz = a.y + dz * t;

      const geo = new THREE.BoxGeometry(bandW, totalHeight, depth);
      const m = new THREE.Matrix4().makeBasis(
        new THREE.Vector3(tx, 0, tz),
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(nx, 0, nz),
      );
      geo.applyMatrix4(m);
      // Face arrière à +stand (juste dehors), face avant à +stand+veneer.
      geo.translate(cx + nx * cN, cy, cz + nz * cN);
      geos.push(geo);
    }
  }

  if (!geos.length) return;
  const merged = mergeGeometries(geos, false);
  geos.forEach(g => g.dispose());
  if (!merged) return;

  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(cfg.color), roughness: 0.85, metalness: 0.0,
  });
  const mesh = new THREE.Mesh(merged, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.bldId = bldId;
  group.add(mesh);
}