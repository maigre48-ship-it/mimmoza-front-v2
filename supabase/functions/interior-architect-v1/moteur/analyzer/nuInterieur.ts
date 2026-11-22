/**
 * VIS-12 (19/11/2026) — AMÉNAGER AU NU INTÉRIEUR.
 *
 * Le contour d'une pièce du Studio passe par l'AXE des cloisons (et des murs séparatifs) : un meuble posé « contre le
 * mur » sur ce contour entrait de la demi-épaisseur dans la cloison (4 cm pour 8 cm, 9 cm pour un séparatif de 18 cm),
 * et un meuble aussi long que la pièce d'axe en axe ne tenait pas entre les nus (baignoire 1,60 m dans 1,56 m nets).
 *
 * `auNuInterieur(analyse, plan)` réduit chaque pièce analysée à son NU : chaque arête du polygone recule vers
 * l'intérieur de la demi-épaisseur du mur porté par cette arête (le plus épais s'il y en a plusieurs ; mur d'épaisseur
 * nulle = limite ouverte : 0) ; une arête de FAÇADE recule de `plan.nuInterieur.facadeM` (part du mur de façade à
 * l'intérieur du contour ; 0 quand le contour est déjà le nu intérieur de la façade, cas du plateau du Studio). Tout ce
 * qui est posé sur ces arêtes suit : portions de mur utilisables (`wallRuns`), fenêtres, portes, débattements. Surface et
 * boîte englobante sont celles du nu. Programme, solveur, critique et édition voient donc la pièce NETTE : un meuble qui
 * ne tient pas est remplacé par son repli (programme) ou n'est pas posé (`unplaced`, raison chiffrée) — jamais dans la
 * cloison.
 *
 * Actif seulement si le plan le demande (`PlanInput.nuInterieur`, posé par l'adaptateur du Studio `versPlanInput`) :
 * un plan sans ce champ est analysé EXACTEMENT comme avant. Pièce trop petite pour être réduite (polygone dégénéré ou
 * retourné) : gardée à l'axe, et c'est dit (`assumptions`). PUR.
 */
import type { AnalyzedRoom, PlanAnalysis, PlanInput, Vec2, Wall } from '../types';
import { area as aireAbs, bbox, cross, dot, len, normalize, signedArea, sub } from '../geometry';

const TOL_COLINEAIRE = 0.02;
const LONGUEUR_MIN_WALLRUN = 0.3;
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const v4 = (p: Vec2): Vec2 => [r4(p[0]) + 0, r4(p[1]) + 0];

interface Arete { readonly p: Vec2; readonly q: Vec2; readonly d: Vec2; readonly n: Vec2; readonly L: number; readonly e: number }

/** Retrait de chaque arête (m) : demi-épaisseur du mur le plus épais posé dessus ; façade : `facadeM`. */
function retraits(poly: readonly Vec2[], walls: readonly Wall[], level: number, facadeM: number): Arete[] {
  const out: Arete[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!, q = poly[(i + 1) % poly.length]!;
    const L = len(sub(q, p));
    const d = L > 1e-9 ? normalize(sub(q, p)) : [1, 0] as Vec2;
    const n: Vec2 = [-d[1], d[0]]; // anti-horaire ⇒ intérieur à gauche
    let e = 0;
    for (const w of walls) {
      if (w.level !== undefined && w.level !== level) continue;
      const dw = sub(w.b, w.a);
      if (len(dw) < 1e-9 || Math.abs(cross(normalize(dw), d)) > 1e-6 || Math.abs(cross(sub(w.a, p), d)) > TOL_COLINEAIRE) continue;
      const ta = dot(sub(w.a, p), d), tb = dot(sub(w.b, p), d);
      if (Math.min(L, Math.max(ta, tb)) - Math.max(0, Math.min(ta, tb)) <= 1e-6) continue;
      const t = w.exterior === true ? facadeM : Math.max(0, w.thickness) / 2;
      if (t > e) e = t;
    }
    out.push({ p, q, d, n, L, e });
  }
  return out;
}

/** Intersection des droites (p1 + s·d1) et (p2 + t·d2) ; parallèles : null. */
function intersection(p1: Vec2, d1: Vec2, p2: Vec2, d2: Vec2): Vec2 | null {
  const den = cross(d1, d2);
  if (Math.abs(den) < 1e-9) return null;
  const s = cross(sub(p2, p1), d2) / den;
  return [p1[0] + d1[0] * s, p1[1] + d1[1] * s];
}

/** Polygone décalé (sommet i = intersection des arêtes i−1 et i décalées). null si dégénéré ou retourné. */
function polygoneNet(ar: readonly Arete[]): Vec2[] | null {
  const out: Vec2[] = [];
  for (let i = 0; i < ar.length; i++) {
    const a = ar[(i - 1 + ar.length) % ar.length]!, b = ar[i]!;
    const pa: Vec2 = [a.p[0] + a.n[0] * a.e, a.p[1] + a.n[1] * a.e];
    const pb: Vec2 = [b.p[0] + b.n[0] * b.e, b.p[1] + b.n[1] * b.e];
    // Arêtes d'axe perpendiculaires (cas du Studio) : coordonnées exactes, sans erreur d'arrondi.
    let s: Vec2 | null;
    if (Math.abs(a.d[1]) < 1e-12 && Math.abs(b.d[0]) < 1e-12) s = [pb[0], pa[1]];
    else if (Math.abs(a.d[0]) < 1e-12 && Math.abs(b.d[1]) < 1e-12) s = [pa[0], pb[1]];
    else s = intersection(pa, a.d, pb, b.d);
    if (s === null) s = [b.p[0] + b.n[0] * Math.max(a.e, b.e), b.p[1] + b.n[1] * Math.max(a.e, b.e)]; // colinéaires
    out.push(v4(s));
  }
  if (signedArea(out) <= 1e-6) return null;
  // Chaque arête nette doit garder le sens de l'arête d'axe (sinon la pièce s'est retournée : trop étroite).
  for (let i = 0; i < ar.length; i++) {
    const p = out[i]!, q = out[(i + 1) % out.length]!;
    if (dot(sub(q, p), ar[i]!.d) < -1e-6) return null;
  }
  return out;
}

/** Arête d'axe qui porte le segment [a, b] (colinéaire, recouvrement) ; −1 sinon. */
function areteDe(ar: readonly Arete[], a: Vec2, b: Vec2): number {
  let best = -1, bestDist = Infinity;
  for (let i = 0; i < ar.length; i++) {
    const x = ar[i]!;
    const dab = sub(b, a);
    if (len(dab) > 1e-9 && Math.abs(cross(normalize(dab), x.d)) > 1e-6) continue;
    const dist = Math.max(Math.abs(cross(sub(a, x.p), x.d)), Math.abs(cross(sub(b, x.p), x.d)));
    if (dist > TOL_COLINEAIRE) continue;
    const ta = dot(sub(a, x.p), x.d), tb = dot(sub(b, x.p), x.d);
    if (Math.min(x.L, Math.max(ta, tb)) - Math.max(0, Math.min(ta, tb)) < -1e-6) continue;
    if (dist < bestDist) { best = i; bestDist = dist; }
  }
  return best;
}

/** Segment [a, b] posé sur l'arête i : décalé au nu et borné à l'arête nette. null s'il disparaît. */
function segmentAuNu(ar: readonly Arete[], net: readonly Vec2[], i: number, a: Vec2, b: Vec2, minLong = 1e-3): [Vec2, Vec2] | null {
  const x = ar[i]!;
  const p = net[i]!, q = net[(i + 1) % net.length]!;
  const Ln = len(sub(q, p));
  const t = (y: Vec2) => dot(sub(y, p), x.d);
  const ta = Math.max(0, Math.min(Ln, t(a))), tb = Math.max(0, Math.min(Ln, t(b)));
  if (Math.abs(tb - ta) < minLong) return null;
  const at = (s: number): Vec2 => v4([p[0] + x.d[0] * s, p[1] + x.d[1] * s]);
  return [at(ta), at(tb)];
}

/** Analyse au nu intérieur (voir l'en-tête). Renvoie l'analyse d'entrée telle quelle si le plan ne le demande pas. */
export function auNuInterieur(analysis: PlanAnalysis, plan: PlanInput): PlanAnalysis {
  const opt = plan.nuInterieur;
  if (!opt) return analysis;
  const facadeM = Math.max(0, opt.facadeM ?? 0);
  const levelOf = new Map(plan.rooms.map((r) => [r.id, r.level]));
  const assumptions: string[] = [];
  const rooms: AnalyzedRoom[] = analysis.rooms.map((room) => {
    const ar = retraits(room.polygon, plan.walls, levelOf.get(room.id) ?? 0, facadeM);
    if (ar.every((x) => x.e <= 1e-9)) return room;
    const net = polygoneNet(ar);
    if (net === null) {
      assumptions.push(`pièce ${room.id} : trop étroite pour être réduite au nu des cloisons, aménagée à l'axe`);
      return room;
    }
    const decale = (i: number, y: Vec2): Vec2 => v4([y[0] + ar[i]!.n[0] * ar[i]!.e, y[1] + ar[i]!.n[1] * ar[i]!.e]);
    const wallRuns = room.wallRuns.flatMap((w) => {
      const i = areteDe(ar, w.a, w.b);
      if (i < 0) return [w];
      const s = segmentAuNu(ar, net, i, decale(i, w.a), decale(i, w.b), LONGUEUR_MIN_WALLRUN - 1e-9);
      return s ? [{ ...w, a: s[0], b: s[1], length: r4(len(sub(s[1], s[0]))) }] : [];
    });
    const surSegment = <T extends { a: Vec2; b: Vec2 }>(o: T): T => {
      const i = areteDe(ar, o.a, o.b);
      if (i < 0) return o;
      const s = segmentAuNu(ar, net, i, decale(i, o.a), decale(i, o.b));
      return s ? { ...o, a: s[0], b: s[1] } : { ...o, a: decale(i, o.a), b: decale(i, o.b) };
    };
    const windows = room.windows.map(surSegment);
    const doors = room.doors.map(surSegment);
    // Débattement : le secteur suit sa porte (translation de la porte au nu).
    const swingZones = room.swingZones.map((z) => {
      const porte = room.doors.find((d) => d.openingId === z.openingId);
      const i = porte ? areteDe(ar, porte.a, porte.b) : -1;
      if (i < 0) return z;
      return { ...z, polygon: z.polygon.map((y) => decale(i, y)) };
    });
    const bb = bbox(net);
    return { ...room, polygon: net, area: r4(aireAbs(net)), bbox: { min: v4(bb.min), max: v4(bb.max) }, wallRuns, windows, doors, swingZones };
  });
  const totalArea = Math.round(rooms.filter((r) => r.zone !== 'exterieur').reduce((s, r) => s + r.area, 0) * 100) / 100;
  return {
    ...analysis, rooms, totalArea,
    assumptions: [...analysis.assumptions, `pièces aménagées au nu intérieur (contour d'axe réduit de la demi-épaisseur des cloisons et séparatifs, façade ${String(facadeM)} m)`, ...assumptions],
  };
}
