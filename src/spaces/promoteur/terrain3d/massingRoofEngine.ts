// massingRoofEngine.ts — toiture plate (déléguée) + 2 pentes (gable) + 4 pentes (hip)
// ─────────────────────────────────────────────────────────────────────────────
// gable ET hip sont construits sur la BOUNDING BOX ORIENTÉE du footprint :
//   1. direction de l'arête la plus longue = axe de faîtage,
//   2. emprise rectangulaire alignée sur cet axe,
//   3. gable → faîtage + 2 versants + 2 pignons ; hip → faîtage raccourci
//      + 2 versants trapèze + 2 croupes triangle (ou pyramide si quasi carré).
// → robuste sur n'importe quel polygone (la bbox existe toujours).
// Sur un footprint très irrégulier (L, T), le toit couvre la bbox : suivre le
// polygone réel (croupe vraie) demanderait un straight skeleton complet.
//
// ORIENTATION (rotate90) : par défaut le faîtage est posé sur le plus grand côté.
// rotate90 = true ajoute une bascule de 90° → échange axe faîtage ↔ pente, pour
// changer l'orientation du toit indépendamment de la forme du footprint.
//
// Débord (overhangM) : avant-toits étendus vers l'extérieur, abaissés de
// overhang * tan(pente) sous le haut de mur. Pentes égales sur toutes les faces.
//
// Texture (textureId) : tuile de toit depuis ROOF_LIBRARY, appliquée aux VERSANTS
// uniquement (pignons restent unis). UV alignées sur le repère du TOIT (U = axe
// faîtage, V = sens de la pente) → les rangées de tuiles montent toujours droit.
// Chargement via Image().decode()+CanvasTexture (évite le bug TextureLoader noir).
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from "three";
import type { Pt2D } from "./massingGeometry3d";

const ROOF_ZFIGHT_OFFSET = 0.002;

export type RoofShape = "flat" | "gable" | "hip";

export interface RoofConfig {
  shape:     RoofShape;
  slopeDeg?: number;   // pente des versants (défaut 30°)
  overhangM?: number;  // débord d'avant-toit en mètres (défaut 0.4)
  textureId?: string;  // clé ROOF_LIBRARY ; absent = couleur unie
  rotate90?: boolean;  // bascule le faîtage de 90° (change l'orientation du toit)
}

interface OrientedBox {
  cx: number; cz: number;   // centre de la bbox (monde, plan x/z)
  angle: number;            // direction du faîtage (rad)
  halfLen: number;          // demi-longueur le long du faîtage
  halfSpan: number;         // demi-portée transversale (sens de la pente)
}

// ─── Bibliothèque de tuiles de toit (extensible) ──────────────────────────────
// Ajouter une tuile = déposer le _Color dans /public/textures/roof/ + 1 ligne.
export const ROOF_LIBRARY: Record<string, { label: string; color: string; tileM: number }> = {
  tuile1: { label: "Tuile 1", color: "/textures/roof/RoofingTiles014A_2K-JPG/RoofingTiles014A_2K-JPG_Color.jpg", tileM: 1.0 },
  tuile2: { label: "Tuile 2", color: "/textures/roof/RoofingTiles013A_2K-JPG/RoofingTiles013A_2K-JPG_Color.jpg", tileM: 1.0 },
  tuile3: { label: "Tuile 3", color: "/textures/roof/RoofTiles014B_Color.jpg", tileM: 1.0 },
  tuile4: { label: "Tuile 4", color: "/textures/roof/RoofTiles015A_Color.jpg", tileM: 1.0 },
};

// ─── Chargement texture toit (Image.decode + CanvasTexture) ───────────────────

function loadRoofTexture(material: THREE.MeshLambertMaterial, url: string): void {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;
  img.decode()
    .then(() => {
      const cnv = document.createElement("canvas");
      cnv.width = img.naturalWidth; cnv.height = img.naturalHeight;
      const cctx = cnv.getContext("2d")!;
      cctx.drawImage(img, 0, 0);
      const tex = new THREE.CanvasTexture(cnv);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(1, 1);          // tuilage encodé dans les UV
      tex.anisotropy = 8;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      material.map = tex;
      material.color.set(0xffffff);  // ne pas teinter la texture
      material.needsUpdate = true;
    })
    .catch(err => console.warn("[roofEngine] texture toit échouée:", url, err));
}

// Matériau de versant : couleur unie, ou texturé si textureId fourni.
function makeSlopeMaterial(roofMat: THREE.Material, config: RoofConfig): THREE.MeshLambertMaterial {
  const baseColor = (roofMat as THREE.MeshLambertMaterial).color?.clone?.() ?? new THREE.Color(0x9a948c);
  const entry = config.textureId ? ROOF_LIBRARY[config.textureId] : undefined;
  const mat = new THREE.MeshLambertMaterial({ color: baseColor, side: THREE.DoubleSide });
  if (entry) loadRoofTexture(mat, entry.color);
  return mat;
}

// Génère des UV alignées sur le repère du TOIT (pas du triangle) :
//   U = le long du faîtage, V = sens de la pente (eave → faîtage).
function generateRoofUVs(
  geo: THREE.BufferGeometry,
  tileM: number,
  uDirX: number, uDirZ: number,
  vDirX: number, vDirZ: number,
): void {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  if (!pos) return;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const u = (x * uDirX + z * uDirZ) / tileM;
    const vHoriz = x * vDirX + z * vDirZ;
    const v = (Math.hypot(vHoriz, y) * Math.sign(vHoriz || 1)) / tileM;
    uv[i * 2]     = Number.isFinite(u) ? u : 0;
    uv[i * 2 + 1] = Number.isFinite(v) ? v : 0;
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

// ─── Bounding box orientée (axe = arête la plus longue) ───────────────────────

function orientedBox(pts: Pt2D[], rotate90 = false): OrientedBox | null {
  if (pts.length < 3) return null;

  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cz = pts.reduce((s, p) => s + p.y, 0) / pts.length;

  let bestLen = 0, angle = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    const dx = pts[j].x - pts[i].x;
    const dz = pts[j].y - pts[i].y;
    const len = Math.hypot(dx, dz);
    if (len > bestLen) { bestLen = len; angle = Math.atan2(dz, dx); }
  }

  const extents = (a: number) => {
    const c = Math.cos(a), s = Math.sin(a);
    let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
    for (const p of pts) {
      const u =  (p.x - cx) * c + (p.y - cz) * s;
      const v = -(p.x - cx) * s + (p.y - cz) * c;
      uMin = Math.min(uMin, u); uMax = Math.max(uMax, u);
      vMin = Math.min(vMin, v); vMax = Math.max(vMax, v);
    }
    return { uMin, uMax, vMin, vMax };
  };

  let e = extents(angle);
  // faîtage sur le plus grand côté → bascule de 90° si besoin
  if ((e.uMax - e.uMin) < (e.vMax - e.vMin)) {
    angle += Math.PI / 2;
    e = extents(angle);
  }
  // Bascule manuelle 90° : échange axe faîtage ↔ pente (orientation au choix).
  if (rotate90) {
    angle += Math.PI / 2;
    e = extents(angle);
  }

  const c = Math.cos(angle), s = Math.sin(angle);
  const uc = (e.uMin + e.uMax) / 2;
  const vc = (e.vMin + e.vMax) / 2;

  return {
    cx: cx + uc * c - vc * s,
    cz: cz + uc * s + vc * c,
    angle,
    halfLen:  (e.uMax - e.uMin) / 2,
    halfSpan: (e.vMax - e.vMin) / 2,
  };
}

// ─── Helper : pousse un triangle en garantissant une normale vers le haut ─────

function pushTriUp(
  arr: number[],
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): void {
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  const ny = uz * vx - ux * vz; // composante Y du produit vectoriel u×v
  if (ny < 0) {
    arr.push(ax, ay, az, cx, cy, cz, bx, by, bz); // inverse b/c
  } else {
    arr.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  }
}

// ─── Toit 2 pentes (gable) ────────────────────────────────────────────────────

function buildGableRoof(
  group:  THREE.Group,
  pts:    Pt2D[],
  baseY:  number,
  config: RoofConfig,
  roofMat: THREE.Material,
  bldId:  string,
): void {
  const box = orientedBox(pts, config.rotate90 ?? false);
  if (!box) return;

  const slope = Math.max(5, Math.min(60, config.slopeDeg ?? 30));
  const oh    = Math.max(0, config.overhangM ?? 0.4);
  const tan   = Math.tan((slope * Math.PI) / 180);

  const { cx, cz, angle, halfLen, halfSpan } = box;
  const cA = Math.cos(angle), sA = Math.sin(angle);

  const W = (u: number, v: number): [number, number] => [
    cx + u * cA - v * sA,
    cz + u * sA + v * cA,
  ];

  const ridgeY  = baseY + halfSpan * tan;
  const eaveYoh = baseY - oh * tan;
  const Z = ROOF_ZFIGHT_OFFSET;

  const [r0x, r0z] = W(-(halfLen + oh), 0);
  const [r1x, r1z] = W( (halfLen + oh), 0);
  const [nA, nAz]  = W(-(halfLen + oh),  (halfSpan + oh));
  const [nB, nBz]  = W( (halfLen + oh),  (halfSpan + oh));
  const [sA0, sAz] = W(-(halfLen + oh), -(halfSpan + oh));
  const [sB0, sBz] = W( (halfLen + oh), -(halfSpan + oh));

  const slopes: number[] = [];
  pushTriUp(slopes, r0x, ridgeY + Z, r0z, r1x, ridgeY + Z, r1z, nB, eaveYoh + Z, nBz);
  pushTriUp(slopes, r0x, ridgeY + Z, r0z, nB, eaveYoh + Z, nBz, nA, eaveYoh + Z, nAz);
  pushTriUp(slopes, r1x, ridgeY + Z, r1z, r0x, ridgeY + Z, r0z, sA0, eaveYoh + Z, sAz);
  pushTriUp(slopes, r1x, ridgeY + Z, r1z, sA0, eaveYoh + Z, sAz, sB0, eaveYoh + Z, sBz);

  const slopeGeo = new THREE.BufferGeometry();
  slopeGeo.setAttribute("position", new THREE.Float32BufferAttribute(slopes, 3));
  slopeGeo.computeVertexNormals();
  const slopeMat = makeSlopeMaterial(roofMat, config);
  if (config.textureId && ROOF_LIBRARY[config.textureId]) {
    // U = axe faîtage (cA,sA) ; V = transversale (-sA,cA) = sens pente
    generateRoofUVs(slopeGeo, ROOF_LIBRARY[config.textureId].tileM, -sA, cA, cA, sA);
  }
  const slopeMesh = new THREE.Mesh(slopeGeo, slopeMat);
  slopeMesh.castShadow      = true;
  slopeMesh.receiveShadow   = true;
  slopeMesh.userData.bldId  = bldId;
  slopeMesh.userData.isRoof = true;
  group.add(slopeMesh);

  // Pignons triangulaires (au nu du mur, sans débord) — DoubleSide, restent unis
  const gableMat = new THREE.MeshLambertMaterial({
    color: (roofMat as THREE.MeshLambertMaterial).color?.clone?.() ?? new THREE.Color(0x9a948c),
    side:  THREE.DoubleSide,
  });
  const gable: number[] = [];
  for (const uEnd of [-halfLen, halfLen]) {
    const [tx, tz] = W(uEnd, 0);
    const [blx, blz] = W(uEnd,  halfSpan);
    const [brx, brz] = W(uEnd, -halfSpan);
    gable.push(tx, ridgeY, tz, blx, baseY, blz, brx, baseY, brz);
  }
  const gableGeo = new THREE.BufferGeometry();
  gableGeo.setAttribute("position", new THREE.Float32BufferAttribute(gable, 3));
  gableGeo.computeVertexNormals();
  const gableMesh = new THREE.Mesh(gableGeo, gableMat);
  gableMesh.castShadow     = true;
  gableMesh.receiveShadow  = true;
  gableMesh.userData.bldId = bldId;
  group.add(gableMesh);
}

// ─── Toit 4 pentes (hip) — croupe sur bounding box orientée ───────────────────

function buildHipRoof(
  group:  THREE.Group,
  pts:    Pt2D[],
  baseY:  number,
  config: RoofConfig,
  roofMat: THREE.Material,
  bldId:  string,
): boolean {
  const box = orientedBox(pts, config.rotate90 ?? false);
  if (!box) return false;

  const slope = Math.max(5, Math.min(60, config.slopeDeg ?? 30));
  const oh    = Math.max(0, config.overhangM ?? 0.4);
  const tan   = Math.tan((slope * Math.PI) / 180);
  const Z     = ROOF_ZFIGHT_OFFSET;

  const { cx, cz, angle, halfLen, halfSpan } = box;
  const cA = Math.cos(angle), sA = Math.sin(angle);
  const W = (u: number, v: number): [number, number] => [
    cx + u * cA - v * sA,
    cz + u * sA + v * cA,
  ];

  const ridgeY = baseY + halfSpan * tan; // hauteur du faîtage
  const eaveY  = baseY - oh * tan;        // avant-toit (descend)

  const [Ax, Az] = W(-(halfLen + oh),  (halfSpan + oh)); // arrière-gauche
  const [Bx, Bz] = W( (halfLen + oh),  (halfSpan + oh)); // arrière-droite
  const [Cx, Cz] = W( (halfLen + oh), -(halfSpan + oh)); // avant-droite
  const [Dx, Dz] = W(-(halfLen + oh), -(halfSpan + oh)); // avant-gauche

  const rl = halfLen - halfSpan;
  const tris: number[] = [];

  if (rl > 0.05) {
    const [R0x, R0z] = W(-rl, 0);
    const [R1x, R1z] = W( rl, 0);

    pushTriUp(tris, R0x, ridgeY + Z, R0z, R1x, ridgeY + Z, R1z, Bx, eaveY + Z, Bz);
    pushTriUp(tris, R0x, ridgeY + Z, R0z, Bx, eaveY + Z, Bz, Ax, eaveY + Z, Az);
    pushTriUp(tris, R1x, ridgeY + Z, R1z, R0x, ridgeY + Z, R0z, Dx, eaveY + Z, Dz);
    pushTriUp(tris, R1x, ridgeY + Z, R1z, Dx, eaveY + Z, Dz, Cx, eaveY + Z, Cz);
    pushTriUp(tris, R0x, ridgeY + Z, R0z, Ax, eaveY + Z, Az, Dx, eaveY + Z, Dz);
    pushTriUp(tris, R1x, ridgeY + Z, R1z, Cx, eaveY + Z, Cz, Bx, eaveY + Z, Bz);
  } else {
    const [Px, Pz] = W(0, 0);
    pushTriUp(tris, Px, ridgeY + Z, Pz, Ax, eaveY + Z, Az, Bx, eaveY + Z, Bz);
    pushTriUp(tris, Px, ridgeY + Z, Pz, Bx, eaveY + Z, Bz, Cx, eaveY + Z, Cz);
    pushTriUp(tris, Px, ridgeY + Z, Pz, Cx, eaveY + Z, Cz, Dx, eaveY + Z, Dz);
    pushTriUp(tris, Px, ridgeY + Z, Pz, Dx, eaveY + Z, Dz, Ax, eaveY + Z, Az);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(tris, 3));
  geo.computeVertexNormals();
  const hipMat = makeSlopeMaterial(roofMat, config);
  if (config.textureId && ROOF_LIBRARY[config.textureId]) {
    generateRoofUVs(geo, ROOF_LIBRARY[config.textureId].tileM, -sA, cA, cA, sA);
  }
  const mesh = new THREE.Mesh(geo, hipMat);
  mesh.castShadow      = true;
  mesh.receiveShadow   = true;
  mesh.userData.bldId  = bldId;
  mesh.userData.isRoof = true;
  group.add(mesh);

  return true;
}

// ─── Point d'entrée toit en pente (gable + hip) ───────────────────────────────

export function buildPitchedRoof(
  group:  THREE.Group,
  pts:    Pt2D[],
  baseY:  number,
  config: RoofConfig,
  roofMat: THREE.Material,
  bldId:  string,
): void {
  if (config.shape === "hip") {
    if (buildHipRoof(group, pts, baseY, config, roofMat, bldId)) return;
    // bbox introuvable (footprint < 3 pts) → repli 2 pentes, jamais d'écran cassé
  }
  buildGableRoof(group, pts, baseY, config, roofMat, bldId);
}