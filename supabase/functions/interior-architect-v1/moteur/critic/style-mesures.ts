/**
 * INT-07 — Mesures de style partagées par le critique (style_coherence, CHECKS.md §15) et par l'application
 * de style (src/style) : une seule définition de la mesure, pour que applyStyle vise exactement ce que le
 * critique mesure.
 */
import type { FurnitureSpec } from '../types';

export const hexRvb = (c: string | undefined): [number, number, number] | null => {
  if (!c || !/^#[0-9a-fA-F]{6}$/.test(c)) return null;
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
};

/** Surface apparente A(p) = max(w·h, w·d) de la spec. */
export const aireApparente = (s: FurnitureSpec): number => Math.max(s.size.w * s.size.h, s.size.w * s.size.d);

export const distanceRvb = (a: [number, number, number], b: [number, number, number]): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * Parts de couleur. `entrees` DOIT être triée par A décroissante (puis ordre du layout) : regroupement glouton,
 * représentant = première couleur du groupe, distance RVB ≤ tolérance. Parts triées par ordre décroissant.
 */
export function partsPalette(entrees: Array<{ rvb: [number, number, number]; hex: string; A: number }>, tol: number): Array<{ hex: string; part: number }> {
  const grp: Array<{ ref: [number, number, number]; A: number; hex: string }> = [];
  for (const x of entrees) {
    const gr = grp.find((y) => distanceRvb(y.ref, x.rvb) <= tol + 1e-9);
    if (gr) gr.A += x.A; else grp.push({ ref: x.rvb, A: x.A, hex: x.hex.toLowerCase() });
  }
  const tot = grp.reduce((s, y) => s + y.A, 0);
  return grp.map((y) => ({ hex: y.hex, part: y.A / tot })).sort((a, b) => b.part - a.part);
}

export interface BornesPalette {
  // `| undefined` explicite : la règle zod (champs `.optional()`) est passée telle quelle (exactOptionalPropertyTypes).
  dominantMin?: number | undefined; dominantMax?: number | undefined; secondaryMin?: number | undefined;
  secondaryMax?: number | undefined; accentMax?: number | undefined;
}

/** Défauts de la palette (dans l'ordre : dominante, secondaire, accents). `m` = mesuré, `e` = attendu. */
export function defautsPalette(parts: Array<{ hex: string; part: number }>, p: BornesPalette, pct: (x: number) => string): Array<{ txt: string; m: number; e: number }> {
  const p1 = parts[0]?.part ?? 0, p2 = parts[1]?.part ?? 0;
  const d: Array<{ txt: string; m: number; e: number }> = [];
  if (p.dominantMin !== undefined && p1 < p.dominantMin - 1e-9) d.push({ txt: `dominante ${pct(p1)} % < ${pct(p.dominantMin)} %`, m: p1, e: p.dominantMin });
  if (p.dominantMax !== undefined && p1 > p.dominantMax + 1e-9) d.push({ txt: `dominante ${pct(p1)} % > ${pct(p.dominantMax)} %`, m: p1, e: p.dominantMax });
  if (p.secondaryMin !== undefined && p2 < p.secondaryMin - 1e-9) d.push({ txt: `secondaire ${pct(p2)} % < ${pct(p.secondaryMin)} %`, m: p2, e: p.secondaryMin });
  if (p.secondaryMax !== undefined && p2 > p.secondaryMax + 1e-9) d.push({ txt: `secondaire ${pct(p2)} % > ${pct(p.secondaryMax)} %`, m: p2, e: p.secondaryMax });
  if (p.accentMax !== undefined) for (const x of parts.slice(2)) if (x.part > p.accentMax + 1e-9) d.push({ txt: `accent ${x.hex} ${pct(x.part)} % > ${pct(p.accentMax)} %`, m: x.part, e: p.accentMax });
  return d;
}

/** Matériau dominant (A cumulée maximale ; égalité départagée par ordre alphabétique). */
export function materiauDominant(entrees: Array<{ material: string; A: number }>, exclues: (i: number) => boolean = () => false): string | null {
  const parMat = new Map<string, number>();
  entrees.forEach((e, i) => { if (!exclues(i)) parMat.set(e.material, (parMat.get(e.material) ?? 0) + e.A); });
  const tri = [...parMat.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  return tri[0]?.[0] ?? null;
}
