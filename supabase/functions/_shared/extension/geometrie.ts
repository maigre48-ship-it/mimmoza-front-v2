// supabase/functions/_shared/extension/geometrie.ts
// COPIE (lot X3, 14/11/2026) de mimmozia-studio/src/core/extension/geometrie.ts @ 0d3a044 (sha256 du fichier source : e63b60b16ed90bd1ba4735b04ccbefa25678460f14d0a37c0c772adfd2dfd0bf).
// Seule modification : chemin d'import « ./contrat » → « ./contrat.ts » (Deno exige l'extension).
// Le Studio fait foi : toute évolution du contrat se fait d'abord dans le Studio, puis est recopiée ici.
// ----- DÉBUT DE LA COPIE -----
/**
 * GÉOMÉTRIE DE L'EXISTANT (lot X1, 13/11/2026). Module PUR et déterministe — aucune géométrie n'est placée par un LLM.
 *
 * Repère de scène du Studio : x = est-scène, z = sud-scène, y = haut (m).
 *   · `rectangleOriente`     : plus petit rectangle englobant (orienté sur une arête de l'emprise) ;
 *   · `decomposerEnCorps`    : emprise → corps rectangulaires (le plus grand d'abord), dans le repère du rectangle
 *                              englobant ; c'est sur ces corps que les toitures sont posées (une emprise en L = 2 corps) ;
 *   · `trianglesToiture`     : triangles d'une toiture 2 pans / 4 pans / monopente / plat posée sur un corps ;
 *   · `trianglesPrismeVertical` : murs + dalle haute d'une emprise extrudée (triangulation par oreilles, emprise concave
 *                              comprise).
 */
import type { FormeToit } from './contrat.ts';

export interface Pt {
  readonly x: number;
  readonly z: number;
}

/** Rectangle orienté : centre, axe de la LONGUEUR (unitaire), demi-longueur `a` ≥ demi-largeur `b`. */
export interface RectOriente {
  readonly cx: number;
  readonly cz: number;
  readonly ux: number;
  readonly uz: number;
  readonly longueur: number;
  readonly largeur: number;
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

export function aire(a: readonly Pt[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) {
    const p = a[i]!;
    const q = a[(i + 1) % a.length]!;
    s += p.x * q.z - q.x * p.z;
  }
  return s / 2;
}

export function perimetre(a: readonly Pt[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) {
    const p = a[i]!;
    const q = a[(i + 1) % a.length]!;
    s += Math.hypot(q.x - p.x, q.z - p.z);
  }
  return s;
}

export function dedans(x: number, z: number, a: readonly Pt[]): boolean {
  let d = false;
  for (let i = 0, j = a.length - 1; i < a.length; j = i, i += 1) {
    const p = a[i]!;
    const q = a[j]!;
    if (p.z > z !== q.z > z && x < ((q.x - p.x) * (z - p.z)) / (q.z - p.z) + p.x) d = !d;
  }
  return d;
}

/** Plus petit rectangle englobant, orienté sur l'une des arêtes (≥ 0,5 m) de l'emprise. Axe u = grand côté. */
export function rectangleOriente(a: readonly Pt[]): RectOriente {
  let best: RectOriente | null = null;
  let bestAire = Infinity;
  for (let i = 0; i < a.length; i += 1) {
    const p = a[i]!;
    const q = a[(i + 1) % a.length]!;
    const L = Math.hypot(q.x - p.x, q.z - p.z);
    if (L < 0.5) continue;
    const ux = (q.x - p.x) / L;
    const uz = (q.z - p.z) / L;
    let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
    for (const m of a) {
      const s = m.x * ux + m.z * uz;
      const t = -m.x * uz + m.z * ux;
      s0 = Math.min(s0, s); s1 = Math.max(s1, s);
      t0 = Math.min(t0, t); t1 = Math.max(t1, t);
    }
    const ar = (s1 - s0) * (t1 - t0);
    if (ar < bestAire - 1e-6) {
      bestAire = ar;
      const sc = (s0 + s1) / 2;
      const tc = (t0 + t1) / 2;
      const cx = sc * ux - tc * uz;
      const cz = sc * uz + tc * ux;
      // Axe u = grand côté (convention : longueur ≥ largeur).
      best = s1 - s0 >= t1 - t0
        ? { cx, cz, ux, uz, longueur: s1 - s0, largeur: t1 - t0 }
        : { cx, cz, ux: -uz, uz: ux, longueur: t1 - t0, largeur: s1 - s0 };
    }
  }
  if (!best) {
    const xs = a.map((p) => p.x);
    const zs = a.map((p) => p.z);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...zs) - Math.min(...zs);
    best = { cx: (Math.max(...xs) + Math.min(...xs)) / 2, cz: (Math.max(...zs) + Math.min(...zs)) / 2, ux: w >= h ? 1 : 0, uz: w >= h ? 0 : 1, longueur: Math.max(w, h), largeur: Math.min(w, h) };
  }
  // Signe de l'axe déterministe : composante x positive (ou z positive si x nul) — même emprise, même résultat.
  if (best.ux < -1e-9 || (Math.abs(best.ux) <= 1e-9 && best.uz < 0)) best = { ...best, ux: -best.ux, uz: -best.uz };
  return { cx: r3(best.cx), cz: r3(best.cz), ux: best.ux, uz: best.uz, longueur: r3(best.longueur), largeur: r3(best.largeur) };
}

/** Coins d'un rectangle orienté (sens trigonométrique dans (s, t)). */
export function coinsRect(r: RectOriente): Pt[] {
  const a = r.longueur / 2;
  const b = r.largeur / 2;
  const vx = -r.uz;
  const vz = r.ux;
  return [
    { x: r.cx - a * r.ux - b * vx, z: r.cz - a * r.uz - b * vz },
    { x: r.cx + a * r.ux - b * vx, z: r.cz + a * r.uz - b * vz },
    { x: r.cx + a * r.ux + b * vx, z: r.cz + a * r.uz + b * vz },
    { x: r.cx - a * r.ux + b * vx, z: r.cz - a * r.uz + b * vz },
  ];
}

export interface Decomposition {
  /** Corps rectangulaires, le plus grand d'abord. Chaque corps est entièrement DANS l'emprise (à la tolérance près). */
  readonly corps: readonly RectOriente[];
  /** Part de l'emprise couverte par les corps (0..1). */
  readonly couverture: number;
}

/**
 * Emprise → corps rectangulaires. Méthode (déterministe) : dans le repère du rectangle englobant, les coordonnées des
 * sommets (regroupées à `tolM` près) forment une grille ; une cellule est « pleine » si son centre est dans l'emprise ;
 * on prend la plus grande union rectangulaire de cellules pleines, on la retire, et on recommence (au plus `maxCorps`
 * corps, chacun ≥ `aireMinM2`). Une emprise oblique donne un escalier de cellules : la couverture baisse et la
 * confiance de la toiture estimée avec elle (voir maisonExistante.ts).
 */
export function decomposerEnCorps(a: readonly Pt[], opts: { tolM?: number; maxCorps?: number; aireMinM2?: number } = {}): Decomposition {
  const tol = opts.tolM ?? 0.35;
  const maxCorps = opts.maxCorps ?? 4;
  const aireMin = opts.aireMinM2 ?? 4;
  const R = rectangleOriente(a);
  const vx = -R.uz, vz = R.ux;
  const loc = a.map((p) => ({ s: (p.x - R.cx) * R.ux + (p.z - R.cz) * R.uz, t: (p.x - R.cx) * vx + (p.z - R.cz) * vz }));
  const grouper = (vals: number[]): number[] => {
    const s = [...vals].sort((x, y) => x - y);
    const out: number[][] = [];
    for (const v of s) {
      const g = out[out.length - 1];
      if (g && v - g[g.length - 1]! <= tol) g.push(v);
      else out.push([v]);
    }
    return out.map((g) => g.reduce((x, y) => x + y, 0) / g.length);
  };
  const S = grouper(loc.map((p) => p.s));
  const T = grouper(loc.map((p) => p.t));
  const ns = S.length - 1, nt = T.length - 1;
  const surface = Math.abs(aire(a));
  if (ns < 1 || nt < 1 || surface <= 0) return { corps: [], couverture: 0 };
  const plein: boolean[][] = [];
  for (let i = 0; i < ns; i += 1) {
    plein.push([]);
    for (let j = 0; j < nt; j += 1) {
      const s = (S[i]! + S[i + 1]!) / 2, t = (T[j]! + T[j + 1]!) / 2;
      plein[i]!.push(dedans(R.cx + s * R.ux + t * vx, R.cz + s * R.uz + t * vz, a));
    }
  }
  const corps: RectOriente[] = [];
  let couvert = 0;
  for (let k = 0; k < maxCorps; k += 1) {
    let best: { i0: number; i1: number; j0: number; j1: number; ar: number } | null = null;
    for (let i0 = 0; i0 < ns; i0 += 1) {
      for (let j0 = 0; j0 < nt; j0 += 1) {
        if (!plein[i0]![j0]) continue;
        let jMax = nt - 1;
        for (let i1 = i0; i1 < ns && plein[i1]![j0]; i1 += 1) {
          let j1 = j0;
          while (j1 + 1 <= jMax && plein[i1]![j1 + 1]) j1 += 1;
          jMax = j1;
          const ar = (S[i1 + 1]! - S[i0]!) * (T[jMax + 1]! - T[j0]!);
          if (!best || ar > best.ar + 1e-9) best = { i0, i1, j0, j1: jMax, ar };
        }
      }
    }
    if (!best || best.ar < aireMin) break;
    for (let i = best.i0; i <= best.i1; i += 1) for (let j = best.j0; j <= best.j1; j += 1) plein[i]![j] = false;
    const s0 = S[best.i0]!, s1 = S[best.i1 + 1]!, t0 = T[best.j0]!, t1 = T[best.j1 + 1]!;
    const sc = (s0 + s1) / 2, tc = (t0 + t1) / 2;
    const cx = R.cx + sc * R.ux + tc * vx, cz = R.cz + sc * R.uz + tc * vz;
    const ls = s1 - s0, lt = t1 - t0;
    corps.push(ls >= lt
      ? { cx: r3(cx), cz: r3(cz), ux: R.ux, uz: R.uz, longueur: r3(ls), largeur: r3(lt) }
      : { cx: r3(cx), cz: r3(cz), ux: vx >= 0 ? vx : -vx, uz: vx >= 0 ? vz : -vz, longueur: r3(lt), largeur: r3(ls) });
    couvert += best.ar;
  }
  return { corps, couverture: Math.round(Math.min(1, couvert / surface) * 1000) / 1000 };
}

/* ------------------------------------------------------------------ */
/* Triangles (silhouettes, z-buffer, aperçus) — y = haut               */
/* ------------------------------------------------------------------ */

/** Triangulation par oreilles d'un polygone simple (concave admis). Renvoie des triplets d'indices. */
export function trianguler(a: readonly Pt[]): number[] {
  const n = a.length;
  if (n < 3) return [];
  const idx = Array.from({ length: n }, (_, i) => i);
  if (aire(a) < 0) idx.reverse();
  const out: number[] = [];
  const croix = (o: Pt, p: Pt, q: Pt): number => (p.x - o.x) * (q.z - o.z) - (p.z - o.z) * (q.x - o.x);
  const dansTri = (p: Pt, A: Pt, B: Pt, C: Pt): boolean => croix(A, B, p) >= -1e-12 && croix(B, C, p) >= -1e-12 && croix(C, A, p) >= -1e-12;
  let garde = 0;
  while (idx.length > 3 && garde < 10_000) {
    garde += 1;
    let coupe = false;
    for (let k = 0; k < idx.length; k += 1) {
      const i0 = idx[(k + idx.length - 1) % idx.length]!, i1 = idx[k]!, i2 = idx[(k + 1) % idx.length]!;
      const A = a[i0]!, B = a[i1]!, C = a[i2]!;
      if (croix(A, B, C) <= 1e-12) continue;
      if (idx.some((j) => j !== i0 && j !== i1 && j !== i2 && dansTri(a[j]!, A, B, C))) continue;
      out.push(i0, i1, i2);
      idx.splice(k, 1);
      coupe = true;
      break;
    }
    if (!coupe) break; // polygone dégénéré : on s'arrête (le reste en éventail ci-dessous)
  }
  for (let k = 1; k + 1 < idx.length; k += 1) out.push(idx[0]!, idx[k]!, idx[k + 1]!);
  return out;
}

/** Murs (quads) et dalle haute d'une emprise extrudée de `bas` à `haut`. */
export function trianglesPrismeVertical(a: readonly Pt[], bas: number, haut: number, dalle = true): number[] {
  const out: number[] = [];
  const n = a.length;
  for (let i = 0; i < n; i += 1) {
    const p = a[i]!;
    const q = a[(i + 1) % n]!;
    out.push(p.x, bas, p.z, q.x, bas, q.z, q.x, haut, q.z, p.x, bas, p.z, q.x, haut, q.z, p.x, haut, p.z);
  }
  if (dalle) {
    const t = trianguler(a);
    for (const i of t) out.push(a[i]!.x, haut, a[i]!.z);
  }
  return out;
}

/** Hauteur de faîtage d'une toiture posée sur un corps de largeur `largeur` avec la pente `penteDeg`. */
export function hauteurToiture(forme: FormeToit, largeur: number, penteDeg: number): number {
  const t = Math.tan((penteDeg * Math.PI) / 180);
  if (forme === 'plat') return 0;
  if (forme === 'monopente') return largeur * t;
  return (largeur / 2) * t;
}

/**
 * Triangles d'une toiture posée sur le corps `r`, égout à `y0`, hauteur `h` (faîtage − égout).
 * `faitage` : 'grand-axe' (faîtage parallèle à la longueur, le cas courant) ou 'petit-axe'.
 * 4 pans : croupes à pente égale (le faîtage raccourcit de la largeur ; pyramide sur un carré).
 * Monopente : le haut du pan est du côté +v (v = normale à gauche de l'axe du faîtage).
 */
export function trianglesToiture(r: RectOriente, forme: FormeToit, y0: number, h: number, faitage: 'grand-axe' | 'petit-axe' = 'grand-axe'): number[] {
  if (forme === 'plat' || h <= 0) return [];
  const rr = faitage === 'grand-axe' ? r : { ...r, ux: -r.uz, uz: r.ux, longueur: r.largeur, largeur: r.longueur };
  const a = rr.longueur / 2, b = rr.largeur / 2;
  const vx = -rr.uz, vz = rr.ux;
  const P = (s: number, t: number, y: number): [number, number, number] => [rr.cx + s * rr.ux + t * vx, y, rr.cz + s * rr.uz + t * vz];
  const tri = (...p: [number, number, number][]): number[] => p.flat();
  const y1 = y0 + h;
  if (forme === 'monopente') {
    const A = P(-a, -b, y0), B = P(a, -b, y0), C = P(a, b, y1), D = P(-a, b, y1), Cb = P(a, b, y0), Db = P(-a, b, y0);
    return [...tri(A, B, C), ...tri(A, C, D), ...tri(Db, Cb, C), ...tri(Db, C, D), ...tri(A, D, Db), ...tri(B, Cb, C)];
  }
  const recul = forme === 'quatre-pans' ? Math.min(b, a) : 0;
  const A = P(-a, -b, y0), B = P(a, -b, y0), C = P(a, b, y0), D = P(-a, b, y0);
  const R1 = P(-a + recul, 0, y1), R2 = P(a - recul, 0, y1);
  return [...tri(A, B, R2), ...tri(A, R2, R1), ...tri(D, R1, R2), ...tri(D, R2, C), ...tri(A, R1, D), ...tri(B, C, R2)];
}
