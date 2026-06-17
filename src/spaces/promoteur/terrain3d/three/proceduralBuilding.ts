// proceduralBuilding.ts
// Génère un bâtiment détaillé "qualité plaquette" à partir d'un gabarit (emprise + niveaux).
// Volumétrie watertight (bonnes ombres) + façades procédurales : trame de fenêtres,
// embrasures (nez de dalle / reveal), socle RDC vitré, retrait d'attique, acrotère.
//
// Pensé pour être branché sur ton Massing 3D existant : tu passes l'emprise que tu calcules
// déjà via le polygon offset du gabarit PLU. Coordonnées locales en MÈTRES.
// Repère : X = est, Z = nord (plan au sol), Y = hauteur.

import * as THREE from 'three';

export interface FacadePalette {
  facade: number;   // enduit / béton (corps de façade)
  glass: number;    // teinte du vitrage
  reveal: number;   // embrasure / menuiserie (sombre)
  band: number;     // nez de dalle / bandeaux d'étage
  parapet: number;  // acrotère
  ground: number;   // socle RDC
}

export interface MassingParams {
  /** Emprise au sol, polygone en (x, z) via Vector2(.x = x, .y = z). Sera refermé/orienté CCW. */
  footprint: THREE.Vector2[];
  /** Nombre total de niveaux hors-sol, RDC inclus. */
  floors: number;
  floorHeight?: number;        // étage courant (m) — défaut 3.0
  groundFloorHeight?: number;  // RDC (m) — défaut 4.0 (socle commercial)
  setback?: {
    fromFloor: number;         // niveau (0 = RDC) à partir duquel on retire l'attique
    distance: number;          // retrait (m) — utilisé seulement si footprint absent
    footprint?: THREE.Vector2[]; // emprise d'attique réelle (recommandé : ton polygon offset)
  };
  bay?: {
    targetWidth?: number;        // largeur visée d'une travée (m) — défaut 3.2
    windowRatio?: number;        // part vitrée d'une travée [0..1] — défaut 0.55
    windowHeightRatio?: number;  // part vitrée de la hauteur d'étage [0..1] — défaut 0.62
    sill?: number;               // allège (m) — défaut 0.9
  };
  roof?: 'flat' | 'parapet';     // toiture terrasse, avec ou sans acrotère — défaut 'parapet'
  palette?: Partial<FacadePalette>;
}

const DEFAULT_PALETTE: FacadePalette = {
  facade: 0xd7d2c8,
  glass: 0x9fb6c4,
  reveal: 0x2b2f33,
  band: 0xbdb8ad,
  parapet: 0xc8c3b8,
  ground: 0x6f7479,
};

// ---------- géométrie utilitaire ----------

function signedArea(poly: THREE.Vector2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** Garantit un sens anti-horaire (normales sortantes cohérentes). */
function ensureCCW(poly: THREE.Vector2[]): THREE.Vector2[] {
  const cleaned = poly.slice();
  // retire un éventuel point de fermeture dupliqué
  if (cleaned.length > 1 && cleaned[0].equals(cleaned[cleaned.length - 1])) cleaned.pop();
  return signedArea(cleaned) < 0 ? cleaned.slice().reverse() : cleaned;
}

/** Retrait approximatif par homothétie vers le centroïde (fallback si pas d'emprise d'attique). */
function insetByCentroid(poly: THREE.Vector2[], distance: number): THREE.Vector2[] {
  const c = poly.reduce((s, p) => s.add(p.clone()), new THREE.Vector2()).divideScalar(poly.length);
  let r = 0;
  for (const p of poly) r += p.distanceTo(c);
  r /= poly.length;
  const factor = Math.max(0.2, 1 - distance / Math.max(r, 0.001));
  return poly.map(p => c.clone().add(p.clone().sub(c).multiplyScalar(factor)));
}

/** Prisme droit watertight (côtés + capot haut/bas) à partir d'un polygone. */
function buildPrism(poly: THREE.Vector2[], yBottom: number, yTop: number): THREE.BufferGeometry {
  const n = poly.length;
  const pos: number[] = [];
  const nor: number[] = [];

  const pushTri = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    nx: number, ny: number, nz: number,
  ) => {
    pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    for (let k = 0; k < 3; k++) nor.push(nx, ny, nz);
  };

  // côtés
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const dx = b.x - a.x, dz = b.y - a.y;
    const len = Math.hypot(dx, dz) || 1;
    const nx = dz / len, nz = -dx / len; // normale sortante (CCW)
    pushTri(a.x, yBottom, a.y,  b.x, yBottom, b.y,  b.x, yTop, b.y,  nx, 0, nz);
    pushTri(a.x, yBottom, a.y,  b.x, yTop,    b.y,  a.x, yTop, a.y,  nx, 0, nz);
  }

  // capots
  const faces = THREE.ShapeUtils.triangulateShape(poly, []);
  for (const f of faces) {
    const [i0, i1, i2] = f;
    const p0 = poly[i0], p1 = poly[i1], p2 = poly[i2];
    // haut (+Y)
    pushTri(p0.x, yTop, p0.y,  p1.x, yTop, p1.y,  p2.x, yTop, p2.y,  0, 1, 0);
    // bas (-Y), winding inversé
    pushTri(p0.x, yBottom, p0.y,  p2.x, yBottom, p2.y,  p1.x, yBottom, p1.y,  0, -1, 0);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return geo;
}

/** Matrice d'instance : base orientée (tangente, up, normale) + échelle + position. */
const _T = new THREE.Vector3(), _U = new THREE.Vector3(0, 1, 0), _N = new THREE.Vector3();
function instanceMatrix(
  cx: number, cy: number, cz: number,
  tx: number, tz: number, nx: number, nz: number,
  sx: number, sy: number, sz: number,
): THREE.Matrix4 {
  _T.set(tx, 0, tz).normalize();
  _N.set(nx, 0, nz).normalize();
  const m = new THREE.Matrix4();
  m.makeBasis(_T, _U, _N);
  m.scale(new THREE.Vector3(sx, sy, sz));
  m.setPosition(cx, cy, cz);
  return m;
}

// ---------- générateur principal ----------

export function createProceduralBuilding(params: MassingParams): THREE.Group {
  const palette = { ...DEFAULT_PALETTE, ...(params.palette ?? {}) };
  const fh = params.floorHeight ?? 3.0;
  const gfh = params.groundFloorHeight ?? 4.0;
  const floors = Math.max(1, params.floors);
  const targetW = params.bay?.targetWidth ?? 3.2;
  const ratioW = params.bay?.windowRatio ?? 0.55;
  const ratioH = params.bay?.windowHeightRatio ?? 0.62;
  const sillStd = params.bay?.sill ?? 0.9;
  const roofKind = params.roof ?? 'parapet';

  const baseFp = ensureCCW(params.footprint);
  const hasSetback = !!params.setback && params.setback.fromFloor < floors && params.setback.fromFloor > 0;
  const atticFp = hasSetback
    ? ensureCCW(params.setback!.footprint ?? insetByCentroid(baseFp, params.setback!.distance))
    : baseFp;
  const fromFloor = hasSetback ? params.setback!.fromFloor : floors;

  // bornes Y par niveau
  const levelBottom = (lvl: number) => (lvl === 0 ? 0 : gfh + (lvl - 1) * fh);
  const levelTop = (lvl: number) => (lvl === 0 ? gfh : gfh + lvl * fh);
  const totalH = levelTop(floors - 1);
  const baseTopY = levelTop(fromFloor - 1); // sommet du corps principal

  const group = new THREE.Group();
  group.name = 'ProceduralBuilding';

  // --- volumétrie (capots + parois pleines derrière les fenêtres) ---
  const massMat = new THREE.MeshStandardMaterial({ color: palette.facade, roughness: 0.88, metalness: 0.0 });
  const groundMat = new THREE.MeshStandardMaterial({ color: palette.ground, roughness: 0.7, metalness: 0.05 });

  // corps principal en deux tranches (RDC séparé pour la couleur du socle)
  const rdc = new THREE.Mesh(buildPrism(baseFp, 0, gfh), groundMat);
  const corps = new THREE.Mesh(buildPrism(baseFp, gfh, baseTopY), massMat);
  group.add(rdc, corps);
  if (hasSetback) {
    const attique = new THREE.Mesh(buildPrism(atticFp, baseTopY, totalH), massMat);
    group.add(attique);
  }

  // --- accumulation des détails de façade (instancing) ---
  const glassM: THREE.Matrix4[] = [];
  const revealM: THREE.Matrix4[] = [];
  const bandM: THREE.Matrix4[] = [];
  const parapetM: THREE.Matrix4[] = [];

  const addFloorFacade = (poly: THREE.Vector2[], lvl: number, isGround: boolean) => {
    const yb = levelBottom(lvl), yt = levelTop(lvl);
    const lvlH = yt - yb;
    const sill = isGround ? 0.3 : sillStd;
    const winRatioH = isGround ? 0.82 : ratioH;
    const winRatioW = isGround ? Math.min(0.78, ratioW + 0.18) : ratioW;
    const winH = Math.max(0.6, lvlH * winRatioH);
    const winCY = yb + sill + winH / 2;

    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      const dx = b.x - a.x, dz = b.y - a.y;
      const len = Math.hypot(dx, dz);
      if (len < 0.5) continue;
      const tx = dx / len, tz = dz / len;
      const nx = dz / len, nz = -dx / len; // sortante

      const nbays = Math.max(1, Math.round(len / targetW));
      const bw = len / nbays;
      const winW = bw * winRatioW;

      for (let k = 0; k < nbays; k++) {
        const s = (k + 0.5) * bw;
        const cx = a.x + tx * s;
        const cz = a.y + tz * s;
        // embrasure : face externe affleurante, creusée vers l'intérieur
        const revealDepth = 0.22;
        revealM.push(instanceMatrix(
          cx + nx * (-revealDepth / 2), winCY, cz + nz * (-revealDepth / 2),
          tx, tz, nx, nz, winW, winH, revealDepth,
        ));
        // vitrage en fond d'embrasure
        glassM.push(instanceMatrix(
          cx + nx * (-revealDepth + 0.02), winCY, cz + nz * (-revealDepth + 0.02),
          tx, tz, nx, nz, winW * 0.92, winH * 0.92, 1,
        ));
      }

      // nez de dalle en sommet d'étage (saillie horizontale)
      const mx = (a.x + b.x) / 2, mz = (a.y + b.y) / 2;
      bandM.push(instanceMatrix(
        mx + nx * 0.05, yt - 0.18, mz + nz * 0.05,
        tx, tz, nx, nz, len, 0.36, 0.30,
      ));
    }
  };

  for (let lvl = 0; lvl < floors; lvl++) {
    const poly = hasSetback && lvl >= fromFloor ? atticFp : baseFp;
    addFloorFacade(poly, lvl, lvl === 0);
  }

  // acrotère sur l'emprise sommitale
  if (roofKind === 'parapet') {
    const top = hasSetback ? atticFp : baseFp;
    const n = top.length;
    for (let i = 0; i < n; i++) {
      const a = top[i], b = top[(i + 1) % n];
      const dx = b.x - a.x, dz = b.y - a.y;
      const len = Math.hypot(dx, dz);
      if (len < 0.5) continue;
      const tx = dx / len, tz = dz / len;
      const nx = dz / len, nz = -dx / len;
      const mx = (a.x + b.x) / 2, mz = (a.y + b.y) / 2;
      parapetM.push(instanceMatrix(mx, totalH + 0.5, mz, tx, tz, nx, nz, len, 1.0, 0.3));
    }
  }

  // --- matériaux détails ---
  const revealMat = new THREE.MeshStandardMaterial({ color: palette.reveal, roughness: 0.6, metalness: 0.2 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: palette.glass, roughness: 0.06, metalness: 0.25, envMapIntensity: 1.5,
  });
  const bandMat = new THREE.MeshStandardMaterial({ color: palette.band, roughness: 0.75, metalness: 0.0 });
  const parapetMat = new THREE.MeshStandardMaterial({ color: palette.parapet, roughness: 0.8, metalness: 0.0 });

  const planeGeo = new THREE.PlaneGeometry(1, 1);
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);

  const makeInstanced = (geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[], name: string) => {
    if (!mats.length) return;
    const mesh = new THREE.InstancedMesh(geo, mat, mats.length);
    mesh.name = name;
    for (let i = 0; i < mats.length; i++) mesh.setMatrixAt(i, mats[i]);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  };

  makeInstanced(boxGeo, revealMat, revealM, 'reveals');
  makeInstanced(planeGeo, glassMat, glassM, 'glazing');
  makeInstanced(boxGeo, bandMat, bandM, 'bands');
  makeInstanced(boxGeo, parapetMat, parapetM, 'parapet');

  // ombres sur la volumétrie
  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      (o as THREE.Mesh).castShadow = true;
      (o as THREE.Mesh).receiveShadow = true;
    }
  });

  return group;
}