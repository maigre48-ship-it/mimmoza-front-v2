/**
 * INT-06 — Registre des contrôles du critique.
 *
 * Chaque entrée implémente EXACTEMENT un `check.kind` de src/data/CHECKS.md (même params, même mesure,
 * même définition de violation). Les décisions prises là où le contrat était muet ou ambigu sont
 * consignées dans CHECKS.md, section « Décisions d'implémentation » (renvois « D<n> » ci-dessous).
 *
 * Un contrôle est PUR : il lit la scène (plan, analyse, implantation, brief) et renvoie un résultat ;
 * l'attribution des ids, des sévérités et des scores est faite par src/critic/index.ts.
 */
import type { z } from 'zod';
import type {
  AnalyzedRoom, FurnitureSpec, InteriorBrief, LayoutPlan, PlanAnalysis, PlanInput, Placement, RoomInput, Rule,
  UsageFunction, Vec2,
} from '../types';
import { CHECK_PARAM_SCHEMAS, type CheckKind } from '../data/schemas';
import { effectiveClearances, footprint, frontClearanceRect, frontDir, pointInPolygon, zoneAvant, rectArea, rectInPolygon, rectIntersection, rectsOverlap, dist, type Rect } from '../geometry';
import {
  PAS, TOL, aireInterPolyRect, distBord, distPointPolygonePlein, distPointRect, distRectRect, localVersMonde, longueurRayon,
  milieuAvant, normaleInterieure, pointsCote, rectFixture, type Cote, type ObstaclesRayon,
} from './geo';
import { aireApparente, defautsPalette, hexRvb, materiauDominant, partsPalette } from './style-mesures';

// ───────────────────────────── Scène et contexte ─────────────────────────────

/** Placement dont la spec est connue, avec son emprise. `ordre` = rang dans layout.placements. */
export interface Item { p: Placement; s: FurnitureSpec; fp: Rect; ordre: number }

export interface Grille {
  pts: Vec2[];
  /** Distance de chaque point aux arêtes de la pièce. */
  distBord: Float64Array;
  /** Index (i + j·nx) → indice dans pts, ou −1 hors pièce. */
  idx: Int32Array;
  nx: number; ny: number; ox: number; oy: number;
}

export interface Scene {
  input: PlanInput;
  analysis: PlanAnalysis;
  layout: LayoutPlan;
  brief: InteriorBrief;
  spec: (id: string) => FurnitureSpec | undefined;
  /** N = adultes + enfants. */
  N: number;
  /** Niveau d'accès (niveau minimal des pièces). */
  niveauAcces: number;
  roomById: Map<string, AnalyzedRoom>;
  inputRoomById: Map<string, RoomInput>;
  items: Item[];
  itemsParPiece: Map<string, Item[]>;
  /** Placements à spec inconnue (exclus de tous les contrôles sauf emprise_valide). */
  inconnus: Placement[];
  grilles: Map<string, Grille>;
}

export function construireScene(input: PlanInput, analysis: PlanAnalysis, layout: LayoutPlan, brief: InteriorBrief, spec: (id: string) => FurnitureSpec | undefined): Scene {
  const items: Item[] = [];
  const inconnus: Placement[] = [];
  layout.placements.forEach((p, ordre) => {
    const s = spec(p.specId);
    if (!s) { inconnus.push(p); return; }
    items.push({ p, s, fp: footprint(p, s), ordre });
  });
  const itemsParPiece = new Map<string, Item[]>();
  for (const it of items) (itemsParPiece.get(it.p.roomId) ?? itemsParPiece.set(it.p.roomId, []).get(it.p.roomId)!).push(it);
  const niveaux = input.rooms.map((r) => r.level);
  return {
    input, analysis, layout, brief, spec,
    N: brief.occupants.adults + brief.occupants.children,
    niveauAcces: niveaux.length ? Math.min(...niveaux) : 0,
    roomById: new Map(analysis.rooms.map((r) => [r.id, r])),
    inputRoomById: new Map(input.rooms.map((r) => [r.id, r])),
    items, itemsParPiece, inconnus, grilles: new Map(),
  };
}

export interface CheckContext {
  scene: Scene;
  rule: Rule;
  /** Pièces évaluées : analysis.rooms filtrées par applicability.roles (toutes si absent). */
  rooms: AnalyzedRoom[];
}

export interface RawViolation {
  roomId: string | null;
  placementIds: string[];
  message: string;
  measured?: number;
  expected?: number;
  /** Action corrective proposée (français clair), reprise dans les recommandations. */
  action: string;
}

export type CheckOutcome =
  | { status: 'non_applicable' }
  | { status: 'skipped'; reason: string }
  | {
    status: 'checked';
    violations: RawViolation[];
    /** Pièces auxquelles la règle s'est appliquée (scores par pièce). [] = portée logement. */
    evaluatedRoomIds: string[];
    recommendations?: string[];
    assumptions?: string[];
    missing?: string[];
  };

export type CheckFn = (ctx: CheckContext, params: Rule['check']['params']) => CheckOutcome;

type Params<K extends CheckKind> = z.infer<(typeof CHECK_PARAM_SCHEMAS)[K]>;

function def<K extends CheckKind>(kind: K, fn: (ctx: CheckContext, p: Params<K>) => CheckOutcome): CheckFn {
  return (ctx, params) => {
    const r = CHECK_PARAM_SCHEMAS[kind].safeParse(params);
    if (!r.success) return { status: 'skipped', reason: `paramètres invalides pour « ${kind} » : ${r.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join(' ; ')}` };
    return fn(ctx, r.data as Params<K>);
  };
}

// ───────────────────────────── Utilitaires ─────────────────────────────

const NA: CheckOutcome = { status: 'non_applicable' };
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const fmt = (x: number, d = 2) => r3(x).toFixed(d).replace('.', ',');

export const nomPiece = (sc: Scene, roomId: string): string => sc.inputRoomById.get(roomId)?.name ?? roomId;
const nomItem = (it: Item) => `${it.s.label} (${it.p.id})`;
const itemsDe = (sc: Scene, roomId: string): Item[] => sc.itemsParPiece.get(roomId) ?? [];
const deCategorie = (it: Item, cats: readonly string[]) => cats.includes('*') || cats.includes(it.s.category);
const ignore = (it: Item, cats: readonly string[]) => cats.includes(it.s.category);

/** §0.3 : ne garder que les pièces du niveau d'accès. */
function uniteDeVie(sc: Scene, rooms: AnalyzedRoom[], actif: boolean | undefined): AnalyzedRoom[] {
  if (!actif) return rooms;
  return rooms.filter((r) => (sc.inputRoomById.get(r.id)?.level ?? sc.niveauAcces) === sc.niveauAcces);
}
const SKIP_UDV: CheckOutcome = { status: 'skipped', reason: 'aucune pièce concernée au niveau d\'accès (unité de vie)' };

function rectsFixtures(room: AnalyzedRoom): Rect[] {
  return room.fixtures.filter((f) => f.size).map((f) => rectFixture(f.position, f.size!));
}

function aretes(poly: Vec2[]): Array<[Vec2, Vec2]> {
  return poly.map((p, i) => [p, poly[(i + 1) % poly.length]!] as [Vec2, Vec2]);
}

/** Grille de points bbox.min + k·PAS dans la pièce (D2), mise en cache. */
function grille(sc: Scene, room: AnalyzedRoom): Grille {
  const g0 = sc.grilles.get(room.id);
  if (g0) return g0;
  const { min, max } = room.bbox;
  const nx = Math.floor((max[0] - min[0]) / PAS + 1e-6) + 1, ny = Math.floor((max[1] - min[1]) / PAS + 1e-6) + 1;
  const idx = new Int32Array(nx * ny).fill(-1);
  const pts: Vec2[] = [];
  const d: number[] = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const pt: Vec2 = [min[0] + i * PAS, min[1] + j * PAS];
    if (!pointInPolygon(pt, room.polygon)) continue;
    idx[i + j * nx] = pts.length;
    pts.push(pt);
    d.push(distBord(pt, room.polygon));
  }
  const g: Grille = { pts, distBord: Float64Array.from(d), idx, nx, ny, ox: min[0], oy: min[1] };
  sc.grilles.set(room.id, g);
  return g;
}

/** Distance libre de chaque point de grille (bord de pièce + obstacles rectangulaires + polygones pleins). */
function degagementsGrille(g: Grille, rects: Rect[], polys: Vec2[][] = []): Float64Array {
  const out = new Float64Array(g.pts.length);
  for (let k = 0; k < g.pts.length; k++) {
    const pt = g.pts[k]!;
    let m = g.distBord[k]!;
    for (const r of rects) { if (m <= 0) break; m = Math.min(m, distPointRect(pt, r)); }
    for (const z of polys) { if (m <= 0) break; m = Math.min(m, distPointPolygonePlein(pt, z)); }
    out[k] = m;
  }
  return out;
}

const pasInferieur = (x: number) => Math.max(0, Math.floor(x / PAS + 1e-6) * PAS);

// ───────────────────────────── 1. emprise_valide ─────────────────────────────

const empriseValide = def('emprise_valide', (ctx, p) => {
  const sc = ctx.scene;
  const tous = !ctx.rule.applicability.roles;
  const v: RawViolation[] = [];
  const evalIds = ctx.rooms.map((r) => r.id);
  const evalSet = new Set(evalIds);
  // (e) spec inconnue ; pièce inconnue (D6)
  for (const pl of sc.inconnus) {
    if (!tous && !evalSet.has(pl.roomId)) continue;
    v.push({ roomId: sc.roomById.has(pl.roomId) ? pl.roomId : null, placementIds: [pl.id], message: `Placement ${pl.id} : spec « ${pl.specId} » inconnue du catalogue.`, action: `Remplacer la spec inconnue « ${pl.specId} » du placement ${pl.id} par un élément du catalogue.` });
  }
  if (tous) for (const it of sc.items) if (!sc.roomById.has(it.p.roomId))
    v.push({ roomId: null, placementIds: [it.p.id], message: `${nomItem(it)} : pièce « ${it.p.roomId} » inconnue du plan.`, action: `Rattacher ${nomItem(it)} à une pièce existante du plan.` });
  for (const room of ctx.rooms) {
    const its = itemsDe(sc, room.id);
    const fixtures = p.checkFixtures ? room.fixtures.filter((f) => f.size) : [];
    its.forEach((it, i) => {
      // (a) dans la pièce
      if (!rectInPolygon(it.fp, room.polygon, p.overlapTolerance)) {
        const hors = rectArea(it.fp) - aireInterPolyRect(room.polygon, it.fp);
        v.push({ roomId: room.id, placementIds: [it.p.id], measured: r3(hors), expected: 0, message: `${nomItem(it)} déborde de la pièce ${nomPiece(sc, room.id)} (${fmt(hors, 3)} m² hors pièce).`, action: `Déplacer ${nomItem(it)} pour le ramener entièrement dans ${nomPiece(sc, room.id)}, ou choisir un modèle plus petit.` });
      }
      // (b) chevauchements entre meubles (paire signalée une fois)
      if (!p.overlapAllowedCategories.includes(it.s.category)) {
        for (const q of its.slice(i + 1)) {
          if (p.overlapAllowedCategories.includes(q.s.category)) continue;
          if (!rectsOverlap(it.fp, q.fp, p.overlapTolerance)) continue;
          const inter = rectIntersection(it.fp, q.fp);
          v.push({ roomId: room.id, placementIds: [it.p.id, q.p.id], measured: r3(inter ? rectArea(inter) : 0), expected: 0, message: `${nomItem(it)} chevauche ${nomItem(q)}.`, action: `Séparer ${nomItem(it)} et ${nomItem(q)} (déplacer l'un des deux).` });
        }
      }
      // (c) chevauchement d'un équipement fixe dimensionné
      for (const f of fixtures) {
        const fr = rectFixture(f.position, f.size!);
        if (!rectsOverlap(it.fp, fr, p.overlapTolerance)) continue;
        const inter = rectIntersection(it.fp, fr);
        v.push({ roomId: room.id, placementIds: [it.p.id], measured: r3(inter ? rectArea(inter) : 0), expected: 0, message: `${nomItem(it)} recouvre l'équipement fixe ${f.kind} (${f.id}).`, action: `Déplacer ${nomItem(it)} : il ne doit pas recouvrir l'équipement ${f.kind} (${f.id}).` });
      }
      // (d) rôle autorisé
      if (p.checkAllowedRoles && !it.s.allowedRoles.includes(room.role))
        v.push({ roomId: room.id, placementIds: [it.p.id], message: `${nomItem(it)} n'est pas prévu pour une pièce de rôle « ${room.role} ».`, action: `Retirer ${nomItem(it)} de ${nomPiece(sc, room.id)} ou le remplacer par un meuble adapté à ce type de pièce.` });
    });
  }
  return { status: 'checked', violations: v, evaluatedRoomIds: evalIds };
});

// ───────────────────────────── 2. passage_min ─────────────────────────────

const passageMin = def('passage_min', (ctx, p) => {
  const sc = ctx.scene;
  if (!ctx.rooms.length) return NA;
  const rooms = uniteDeVie(sc, ctx.rooms, p.uniteDeVie);
  if (!rooms.length) return SKIP_UDV;
  const v: RawViolation[] = [];
  const assumptions: string[] = [];
  for (const room of rooms) {
    const g = grille(sc, room);
    const obst = itemsDe(sc, room.id).filter((it) => !ignore(it, p.ignoreCategories));
    const libre = degagementsGrille(g, [...obst.map((it) => it.fp), ...rectsFixtures(room)]);
    const portes = room.doors.map((d) => ({ d, n: normaleInterieure(room.polygon, d.a, d.b) }));
    for (const { d, n } of portes) if (!n) assumptions.push(`[${ctx.rule.id}] ouverture ${d.openingId} non située en bord de ${nomPiece(sc, room.id)} : non prise comme cible de passage`);
    // D18 : les satellites (chevet, chaises) sont atteints depuis leur meuble parent : obstacles, jamais cibles.
    const satellites = p.satelliteCategories ?? [];
    const usages = p.targets === 'portes_et_usages' ? obst.filter((it) => it.s.clearances.front > 0 && !satellites.includes(it.s.category)) : [];
    // Cible = rectangle (point dégénéré pour une porte) + distance d'atteinte. D3 : une zone d'usage est
    // atteinte si le disque libre (rayon w/2) d'une cellule passable la touche (tolérance d'un pas de grille).
    type Cible = { r: Rect; portee: number };
    const cibles = (w: number): Cible[] => [
      ...portes.filter((x) => x.n).map(({ d, n }): Cible => {
        const c: Vec2 = [(d.a[0] + d.b[0]) / 2 + n![0] * w / 2, (d.a[1] + d.b[1]) / 2 + n![1] * w / 2];
        return { r: { minX: c[0], minY: c[1], maxX: c[0], maxY: c[1] }, portee: 0.10 };
      }),
      ...usages.map((it): Cible => ({ r: frontClearanceRect(it.p, it.s)!, portee: w / 2 + PAS })),
    ];
    if (cibles(p.minWidth).length < 2) continue;
    const connecte = (w: number): boolean => {
      const passable = (k: number) => libre[k]! >= w / 2 - TOL;
      const comp = new Int32Array(g.pts.length).fill(-1);
      let nc = 0;
      for (let k0 = 0; k0 < g.pts.length; k0++) {
        if (comp[k0] !== -1 || !passable(k0)) continue;
        const pile = [k0]; comp[k0] = nc;
        while (pile.length) {
          const k = pile.pop()!;
          const i = Math.round((g.pts[k]![0] - g.ox) / PAS), j = Math.round((g.pts[k]![1] - g.oy) / PAS);
          for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const ii = i + di, jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= g.nx || jj >= g.ny) continue;
            const kk = g.idx[ii + jj * g.nx]!;
            if (kk < 0 || comp[kk] !== -1 || !passable(kk)) continue;
            comp[kk] = nc; pile.push(kk);
          }
        }
        nc++;
      }
      let commun: Set<number> | null = null;
      for (const { r, portee } of cibles(w)) {
        const s = new Set<number>();
        const i0 = Math.max(0, Math.floor((r.minX - portee - g.ox) / PAS)), i1 = Math.min(g.nx - 1, Math.ceil((r.maxX + portee - g.ox) / PAS));
        const j0 = Math.max(0, Math.floor((r.minY - portee - g.oy) / PAS)), j1 = Math.min(g.ny - 1, Math.ceil((r.maxY + portee - g.oy) / PAS));
        for (let jj = j0; jj <= j1; jj++) for (let ii = i0; ii <= i1; ii++) {
          const kk = g.idx[ii + jj * g.nx]!;
          if (kk < 0 || comp[kk]! < 0) continue;
          if (distPointRect(g.pts[kk]!, r) <= portee + TOL) s.add(comp[kk]!);
        }
        const prec: Set<number> | null = commun;
        commun = prec === null ? s : new Set<number>([...prec].filter((x: number) => s.has(x)));
        if (!commun.size) return false;
      }
      return true;
    };
    if (connecte(p.minWidth)) continue;
    let mesure = 0;
    for (let k = 1; p.minWidth - k * PAS > TOL; k++) { const w = r3(p.minWidth - k * PAS); if (connecte(w)) { mesure = w; break; } }
    const quoi = p.targets === 'portes' ? 'les portes' : 'les portes et les zones d\'usage des meubles';
    v.push({
      roomId: room.id, placementIds: [], measured: r3(mesure), expected: p.minWidth,
      message: `${nomPiece(sc, room.id)} : ${quoi} ne sont pas reliées par un passage de ${fmt(p.minWidth)} m (largeur libre continue : ${fmt(mesure)} m).`,
      action: `Dans ${nomPiece(sc, room.id)}, libérer un passage continu d'au moins ${fmt(p.minWidth)} m entre ${quoi} (déplacer, réduire ou retirer le mobilier qui l'étrangle).`,
    });
  }
  return { status: 'checked', violations: v, evaluatedRoomIds: rooms.map((r) => r.id), assumptions };
});

// ───────────────────────────── 3. cercle_manoeuvre ─────────────────────────────

const cercleManoeuvre = def('cercle_manoeuvre', (ctx, p) => {
  const sc = ctx.scene;
  let rooms = uniteDeVie(sc, ctx.rooms, p.uniteDeVie);
  let substitution = false;
  if (!ctx.rooms.length || (!rooms.length && p.includeSejourIfNoChambre)) {
    if (!p.includeSejourIfNoChambre) return NA;
    // D7 : pièce principale à défaut de pièce du rôle (studio, ou aucune chambre au niveau d'accès).
    rooms = uniteDeVie(sc, sc.analysis.rooms.filter((r) => r.role === 'sejour' || r.role === 'sejour_cuisine'), p.uniteDeVie);
    substitution = true;
    if (!rooms.length) return ctx.rooms.length ? SKIP_UDV : NA;
  }
  if (!rooms.length) return SKIP_UDV;
  const R = p.diameter / 2;
  const mesures = rooms.map((room) => {
    const g = grille(sc, room);
    const rects = [...itemsDe(sc, room.id).filter((it) => !ignore(it, p.ignoreCategories)).map((it) => it.fp), ...rectsFixtures(room)];
    const libre = degagementsGrille(g, rects, p.swingAllowed ? [] : room.swingZones.map((z) => z.polygon));
    let m = 0;
    for (let k = 0; k < libre.length; k++) m = Math.max(m, libre[k]!);
    return { room, rMax: m, ok: m >= R - TOL };
  });
  const diam = (rMax: number) => r3(pasInferieur(2 * rMax));
  const v: RawViolation[] = [];
  const note = substitution ? ' (pièce principale retenue à défaut de pièce du rôle)' : '';
  if (p.scope === 'chaque_piece') {
    for (const m of mesures) if (!m.ok) v.push({
      roomId: m.room.id, placementIds: [], measured: diam(m.rMax), expected: p.diameter,
      message: `${nomPiece(sc, m.room.id)} : aucun cercle libre de ${fmt(p.diameter)} m de diamètre (plus grand : ${fmt(diam(m.rMax))} m)${note}.`,
      action: `Dans ${nomPiece(sc, m.room.id)}, dégager un cercle libre de ${fmt(p.diameter)} m de diamètre${p.swingAllowed ? '' : ' hors débattement de porte'} (déplacer ou réduire le mobilier).`,
    });
  } else if (!mesures.some((m) => m.ok)) {
    const best = mesures.reduce((a, b) => (b.rMax > a.rMax ? b : a));
    v.push({
      roomId: null, placementIds: [], measured: diam(best.rMax), expected: p.diameter,
      message: `Aucune des pièces concernées (${mesures.map((m) => nomPiece(sc, m.room.id)).join(', ')}) n'offre un cercle libre de ${fmt(p.diameter)} m (plus grand : ${fmt(diam(best.rMax))} m dans ${nomPiece(sc, best.room.id)})${note}.`,
      action: `Dégager, dans au moins une des pièces (${mesures.map((m) => nomPiece(sc, m.room.id)).join(', ')}), un cercle libre de ${fmt(p.diameter)} m de diamètre${p.swingAllowed ? '' : ' hors débattement de porte'}.`,
    });
  }
  return { status: 'checked', violations: v, evaluatedRoomIds: p.scope === 'chaque_piece' ? rooms.map((r) => r.id) : [] };
});

// ───────────────────────────── 4. degagement_categorie ─────────────────────────────

const COTES_FR: Record<Cote, string> = { front: 'devant', back: 'derrière', left: 'à gauche', right: 'à droite' };

const degagementCategorie = def('degagement_categorie', (ctx, p) => {
  const sc = ctx.scene;
  if (!ctx.rooms.length) return NA;
  const rooms = uniteDeVie(sc, ctx.rooms, p.uniteDeVie);
  if (!rooms.length) return SKIP_UDV;
  const unePiece = sc.input.typology === 'studio' || sc.input.typology === 'T1';
  const v: RawViolation[] = [];
  interface Bilan { it: Item; ok: boolean; pire: { cote: Cote; libre: number; seuil: number } | null }
  const bilans: Bilan[] = [];
  for (const room of rooms) {
    const its = itemsDe(sc, room.id);
    const cibles = its.filter((it) => deCategorie(it, p.categories) && (!p.requireProvides || it.s.provides.includes(p.requireProvides)));
    for (const it of cibles) {
      const obs: ObstaclesRayon = {
        segments: aretes(room.polygon),
        rects: [...its.filter((q) => q !== it && !ignore(q, p.ignoreCategories)).map((q) => q.fp), ...rectsFixtures(room)],
        zones: p.swingCounts ? room.swingZones.map((z) => z.polygon) : [],
        tolZone: p.swingTolerance ?? 0,
      };
      const cache = new Map<Cote, number>();
      const libre = (cote: Cote): number => {
        const c = cache.get(cote);
        if (c !== undefined) return c;
        const lateral = cote === 'left' || cote === 'right';
        const { dir, pts } = pointsCote(it.p, it.s, it.fp, cote, lateral ? p.sideZoneLength : undefined);
        let m = Infinity;
        for (const { pt, prolongement } of pts) {
          if (prolongement && !pointInPolygon(pt, room.polygon)) { m = 0; break; }
          m = Math.min(m, longueurRayon(pt, dir, obs));
          if (m <= 0) break;
        }
        cache.set(cote, m);
        return m;
      };
      type Seuils = { front?: number | undefined; back?: number | undefined; left?: number | undefined; right?: number | undefined };
      let mode: 'tous' | 'au_moins_un';
      let principal: Seuils, alternatif: Seuils | null = null;
      if (p.useSpecClearances) {
        const c = effectiveClearances(it.p, it.s); // D19 : `mirrored` permute gauche/droite
        const pos = (x: number) => (x > 0 ? x : undefined);
        principal = { front: pos(c.front), back: pos(c.back), left: pos(c.left), right: pos(c.right) };
        mode = 'tous';
      } else {
        principal = { front: p.minFront, back: p.minBack, left: p.minLeft, right: p.minRight };
        if (p.altMinFront !== undefined || p.altMinLeft !== undefined || p.altMinRight !== undefined)
          alternatif = { front: p.altMinFront ?? p.minFront, back: p.minBack, left: p.altMinLeft ?? p.minLeft, right: p.altMinRight ?? p.minRight };
        const lm = p.lateralMode ?? 'tous';
        mode = lm === 'tous_si_double' ? (it.s.provides.includes('dormir_double') ? 'tous' : 'au_moins_un') : lm;
      }
      if (p.relaxOneSideIfSinglePiece && unePiece && mode === 'tous') mode = 'au_moins_un';
      const evalue = (s: Seuils): { ok: boolean; defauts: Array<{ cote: Cote; libre: number; seuil: number }> } => {
        const defauts: Array<{ cote: Cote; libre: number; seuil: number }> = [];
        for (const cote of ['front', 'back'] as const) {
          const seuil = s[cote];
          if (seuil !== undefined && libre(cote) < seuil - TOL) defauts.push({ cote, libre: libre(cote), seuil });
        }
        const lat = (['left', 'right'] as const).filter((c) => s[c] !== undefined).map((cote) => ({ cote, libre: libre(cote), seuil: s[cote]! }));
        const latKo = lat.filter((x) => x.libre < x.seuil - TOL);
        if (mode === 'tous') defauts.push(...latKo);
        else if (lat.length && latKo.length === lat.length) defauts.push(...latKo);
        return { ok: defauts.length === 0, defauts };
      };
      const ep = evalue(principal);
      const ea = alternatif ? evalue(alternatif) : null;
      const okCible = ep.ok || (ea?.ok ?? false);
      const pire = ep.defauts.length ? ep.defauts.reduce((a, b) => (b.libre < a.libre - 1e-12 ? b : a)) : null;
      bilans.push({ it, ok: okCible, pire });
    }
  }
  const dmsg = (b: Bilan) => (b.pire ? `${fmt(b.pire.libre)} m libre ${COTES_FR[b.pire.cote]} pour ${fmt(b.pire.seuil)} m exigé` : 'dégagement insuffisant');
  if (p.scope === 'chaque_placement') {
    for (const b of bilans) if (!b.ok) v.push({
      roomId: b.it.p.roomId, placementIds: [b.it.p.id],
      ...(b.pire ? { measured: r3(Math.min(b.pire.libre, 5)), expected: b.pire.seuil } : {}),
      message: `${nomItem(b.it)} dans ${nomPiece(sc, b.it.p.roomId)} : ${dmsg(b)}.`,
      action: `Dégager ${nomItem(b.it)}${b.pire ? ` ${COTES_FR[b.pire.cote]} (au moins ${fmt(b.pire.seuil)} m libres)` : ''} en déplaçant le meuble ou ce qui l'entoure, ou choisir un modèle plus petit.`,
    });
    return { status: 'checked', violations: v, evaluatedRoomIds: rooms.map((r) => r.id) };
  }
  if (!bilans.length) return { status: 'skipped', reason: `aucune cible (${p.categories.join(', ')}) placée dans les pièces concernées` };
  if (!bilans.some((b) => b.ok)) {
    const best = bilans.reduce((a, b) => ((b.pire?.libre ?? 0) > (a.pire?.libre ?? 0) ? b : a));
    v.push({
      roomId: null, placementIds: bilans.map((b) => b.it.p.id),
      ...(best.pire ? { measured: r3(Math.min(best.pire.libre, 5)), expected: best.pire.seuil } : {}),
      message: `Aucun élément (${p.categories.join(', ')}) du logement n'offre les dégagements exigés (meilleur : ${nomItem(best.it)}, ${dmsg(best)}).`,
      action: `Réorganiser au moins une pièce pour que ${nomItem(best.it)} offre les dégagements exigés (${dmsg(best)}).`,
    });
  }
  return { status: 'checked', violations: v, evaluatedRoomIds: [] };
});

// ───────────────────────────── 5. debattement_libre ─────────────────────────────

const debattementLibre = def('debattement_libre', (ctx, p) => {
  const sc = ctx.scene;
  if (!ctx.rooms.length) return NA;
  const v: RawViolation[] = [];
  for (const room of ctx.rooms) for (const z of room.swingZones) for (const it of itemsDe(sc, room.id)) {
    if (ignore(it, p.ignoreCategories)) continue;
    const a = aireInterPolyRect(z.polygon, it.fp);
    if (a > p.toleranceArea + 1e-9) v.push({
      roomId: room.id, placementIds: [it.p.id], measured: r3(a), expected: p.toleranceArea,
      message: `${nomItem(it)} empiète sur le débattement de la porte ${z.openingId} (${fmt(a, 3)} m²).`,
      action: `Déplacer ${nomItem(it)} hors de la zone d'ouverture de la porte ${z.openingId} dans ${nomPiece(sc, room.id)}.`,
    });
  }
  return { status: 'checked', violations: v, evaluatedRoomIds: ctx.rooms.map((r) => r.id) };
});

// ───────────────────────────── 6. ouverture_non_obstruee ─────────────────────────────

const ouvertureNonObstruee = def('ouverture_non_obstruee', (ctx, p) => {
  const sc = ctx.scene;
  if (!ctx.rooms.length) return NA;
  const v: RawViolation[] = [];
  const assumptions: string[] = [];
  const kindOf = new Map(sc.input.openings.map((o) => [o.id, o.kind]));
  for (const room of ctx.rooms) for (const w of room.windows) {
    const pf = kindOf.get(w.openingId) === 'french_window';
    const n = normaleInterieure(room.polygon, w.a, w.b);
    if (!n) { assumptions.push(`[${ctx.rule.id}] vitrage ${w.openingId} non situé en bord de ${nomPiece(sc, room.id)} : non contrôlé`); continue; }
    const prof = pf ? p.frenchWindowDepth : p.depth;
    const bande: Vec2[] = [w.a, w.b, [w.b[0] + n[0] * prof, w.b[1] + n[1] * prof], [w.a[0] + n[0] * prof, w.a[1] + n[1] * prof]];
    if (!pf && w.sillHeight === null) assumptions.push(`[${ctx.rule.id}] fenêtre ${w.openingId} : hauteur d'allège inconnue, seule l'autorisation « sous fenêtre » du meuble est contrôlée`);
    for (const it of itemsDe(sc, room.id)) {
      if (ignore(it, p.ignoreCategories)) continue;
      const a = aireInterPolyRect(bande, it.fp);
      if (a <= 0.001) continue;
      if (pf) {
        v.push({ roomId: room.id, placementIds: [it.p.id], measured: r3(a), expected: 0, message: `${nomItem(it)} obstrue la porte-fenêtre ${w.openingId} (zone libre de ${fmt(prof)} m).`, action: `Libérer une profondeur de ${fmt(prof)} m devant la porte-fenêtre ${w.openingId} : déplacer ${nomItem(it)}.` });
      } else if (!it.s.allowedUnderWindow) {
        v.push({ roomId: room.id, placementIds: [it.p.id], message: `${nomItem(it)} est placé devant la fenêtre ${w.openingId} alors qu'il ne peut pas l'être.`, action: `Déplacer ${nomItem(it)} hors de la bande de ${fmt(prof)} m devant la fenêtre ${w.openingId}.` });
      } else if (w.sillHeight !== null && it.s.size.h > w.sillHeight + p.heightTolerance + TOL) {
        v.push({ roomId: room.id, placementIds: [it.p.id], measured: it.s.size.h, expected: r3(w.sillHeight + p.heightTolerance), message: `${nomItem(it)} (h ${fmt(it.s.size.h)} m) dépasse l'allège de la fenêtre ${w.openingId} (${fmt(w.sillHeight)} m).`, action: `Remplacer ${nomItem(it)} par un meuble plus bas que l'allège (${fmt(w.sillHeight)} m) ou le déplacer hors de la fenêtre ${w.openingId}.` });
      }
    }
  }
  return { status: 'checked', violations: v, evaluatedRoomIds: ctx.rooms.map((r) => r.id), assumptions };
});

// ───────────────────────────── 7. distance_fixture ─────────────────────────────

const distanceFixture = def('distance_fixture', (ctx, p) => {
  const sc = ctx.scene;
  if (!ctx.rooms.length) return NA;
  const v: RawViolation[] = [];
  const missing: string[] = [];
  let controles = 0, sansDonnee = 0;
  for (const room of ctx.rooms) {
    const its = itemsDe(sc, room.id).filter((it) => deCategorie(it, p.categories)
      && (p.minHeight === undefined || it.s.size.h >= p.minHeight - TOL)
      && (!p.requireNeedsWater || it.s.needsWater));
    if (!its.length) continue;
    if (p.mode === 'piece_humide') {
      for (const it of its) if (room.hasWater === false) v.push({ roomId: room.id, placementIds: [it.p.id], message: `${nomItem(it)} nécessite l'eau mais ${nomPiece(sc, room.id)} n'a aucun point d'eau.`, action: `Déplacer ${nomItem(it)} dans une pièce disposant d'un point d'eau (cuisine, salle d'eau, buanderie…).` });
      continue;
    }
    const fx = room.fixtures.filter((f) => (p.fixtureKinds as string[]).includes(f.kind));
    const distance = p.distance ?? 0; // D9 : distance absente en min/max => 0
    if (p.mode === 'zone_avant') {
      // D20 : zone libre devant l'équipement (rectangle adossé à l'arête de pièce la plus proche).
      for (const f of fx) {
        const z = zoneAvant(room.polygon, f, distance, p.zoneWidth ?? 0.6);
        if (!z) continue;
        for (const it of its) {
          controles++;
          const inter = rectIntersection(it.fp, z);
          const a = inter ? rectArea(inter) : 0;
          if (a > 0.001) v.push({ roomId: room.id, placementIds: [it.p.id], measured: r3(a), expected: 0, message: `${nomItem(it)} empiète sur la zone libre de ${fmt(distance)} m devant l'équipement ${f.kind} (${f.id}) (${fmt(a, 3)} m²).`, action: `Dégager ${nomItem(it)} de la zone de ${fmt(distance)} m devant l'équipement ${f.kind} (${f.id}) : le décaler latéralement.` });
        }
      }
      continue;
    }
    if (!fx.length) {
      if (p.mode === 'max') { sansDonnee += its.length; missing.push(`[${ctx.rule.id}] ${nomPiece(sc, room.id)} : aucun équipement (${p.fixtureKinds.join(', ')}) renseigné, distance non contrôlée`); }
      continue;
    }
    for (const it of its) {
      controles++;
      const ds = fx.map((f) => ({ f, d: f.size ? distRectRect(it.fp, rectFixture(f.position, f.size)) : distPointRect(f.position, it.fp) }));
      const plus = ds.reduce((a, b) => (b.d < a.d - 1e-12 ? b : a));
      if (p.mode === 'min' && plus.d < distance - TOL) v.push({ roomId: room.id, placementIds: [it.p.id], measured: r3(plus.d), expected: distance, message: `${nomItem(it)} est à ${fmt(plus.d)} m de l'équipement ${plus.f.kind} (${plus.f.id}) ; minimum ${fmt(distance)} m.`, action: `Éloigner ${nomItem(it)} d'au moins ${fmt(distance)} m de l'équipement ${plus.f.kind} (${plus.f.id}).` });
      if (p.mode === 'max' && plus.d > distance + TOL) v.push({ roomId: room.id, placementIds: [it.p.id], measured: r3(plus.d), expected: distance, message: `${nomItem(it)} est à ${fmt(plus.d)} m de l'équipement le plus proche (${plus.f.kind}, ${plus.f.id}) ; maximum ${fmt(distance)} m.`, action: `Rapprocher ${nomItem(it)} à ${fmt(distance)} m au plus d'une ${p.fixtureKinds.join(' / ')} de ${nomPiece(sc, room.id)}.` });
    }
  }
  if (p.mode === 'max' && sansDonnee > 0 && controles === 0) return { status: 'skipped', reason: 'équipement d\'eau non renseigné' };
  return { status: 'checked', violations: v, evaluatedRoomIds: ctx.rooms.map((r) => r.id), missing };
});

// ───────────────────────────── 8. fonctions_requises ─────────────────────────────

const fonctionsRequises = def('fonctions_requises', (ctx, p) => {
  const sc = ctx.scene;
  if (p.whenBrief !== 'toujours' && sc.brief.constraints[p.whenBrief] !== true)
    return { status: 'skipped', reason: `condition du brief « ${p.whenBrief} » non remplie` };
  const fournies = (roomIds: string[]): Set<UsageFunction> => new Set(roomIds.flatMap((id) => itemsDe(sc, id).flatMap((it) => it.s.provides)));
  const manquantes = (F: Set<UsageFunction>): UsageFunction[] => {
    const m = p.functions.filter((f) => !F.has(f));
    if (p.anyOf && p.anyOf.length && !p.anyOf.some((f) => F.has(f))) m.push(...p.anyOf);
    return m;
  };
  const anyOfTxt = (m: UsageFunction[]) => {
    const tous = m.filter((f) => !(p.anyOf ?? []).includes(f) || p.functions.includes(f));
    const alt = m.filter((f) => (p.anyOf ?? []).includes(f) && !p.functions.includes(f));
    return [...tous, ...(alt.length ? [alt.join(' ou ')] : [])].join(', ');
  };
  const nonPlaces = (roomIds: string[], m: UsageFunction[]) => sc.layout.unplaced.filter((u) => (roomIds.length === 0 || roomIds.includes(u.roomId))
    && (sc.spec(u.specId)?.provides.some((f) => m.includes(f)) ?? false));
  const suffixe = (np: LayoutPlan['unplaced']) => (np.length ? ` Non placé(s) : ${np.map((u) => `${u.specId} (${u.reason})`).join(' ; ')}.` : '');
  const v: RawViolation[] = [];

  if (p.scope === 'logement') {
    if (!ctx.rooms.length) return NA;
    const m = manquantes(fournies(ctx.rooms.map((r) => r.id)));
    if (m.length) {
      const np = nonPlaces([], m);
      v.push({ roomId: null, placementIds: [], message: `Logement : fonction(s) manquante(s) : ${anyOfTxt(m)}.${suffixe(np)}`, action: `Prévoir dans le logement un meuble assurant : ${anyOfTxt(m)}${np.length ? ` (élément non placé à réintégrer : ${np.map((u) => u.specId).join(', ')})` : ''}.` });
    }
    return { status: 'checked', violations: v, evaluatedRoomIds: [] };
  }

  let rooms = ctx.rooms;
  if (!rooms.length) {
    if (!p.fallbackToEntranceRoom) return NA;
    const kindOf = new Map(sc.input.openings.map((o) => [o.id, o.kind]));
    const entree = sc.analysis.rooms.find((r) => r.doors.some((d) => d.to === null && kindOf.get(d.openingId) === 'door'));
    if (!entree) return { status: 'skipped', reason: 'aucune pièce desservie par une porte palière / extérieure' };
    rooms = [entree];
  }
  for (const room of rooms) {
    const ids = [room.id];
    if (p.acceptAdjacentRoles) for (const a of sc.analysis.adjacency) {
      const autre = a.a === room.id ? a.b : a.b === room.id ? a.a : null;
      if (autre === null) continue;
      const r2 = sc.roomById.get(autre);
      if (r2 && p.acceptAdjacentRoles.includes(r2.role) && !ids.includes(autre)) ids.push(autre);
    }
    const m = manquantes(fournies(ids));
    if (!m.length) continue;
    const np = nonPlaces([room.id], m);
    v.push({
      roomId: room.id, placementIds: [],
      message: `${nomPiece(sc, room.id)} : fonction(s) manquante(s) : ${anyOfTxt(m)}.${suffixe(np)}`,
      action: `Placer dans ${nomPiece(sc, room.id)} un meuble assurant : ${anyOfTxt(m)}${np.length ? ` (élément non placé : ${np.map((u) => `${u.specId} — ${u.reason}`).join(' ; ')} ; essayer une variante plus petite)` : ''}.`,
    });
  }
  return { status: 'checked', violations: v, evaluatedRoomIds: rooms.map((r) => r.id) };
});

// ───────────────────────────── 9. capacite_occupants ─────────────────────────────

const capaciteOccupants = def('capacite_occupants', (ctx, p) => {
  const sc = ctx.scene;
  if (!ctx.rooms.length) return NA;
  // D21 : `ignoreOnlyIfRoles` — l'exclusion ne vaut que si le plan compte une pièce de ces rôles (studio : le convertible EST le couchage).
  const exclure = !p.ignoreOnlyIfRoles || sc.analysis.rooms.some((r) => p.ignoreOnlyIfRoles!.includes(r.role));
  const assumptions = exclure || !p.ignoreCategories.length ? [] : [`[${ctx.rule.id}] aucune pièce de rôle ${p.ignoreOnlyIfRoles!.join(' / ')} : ${p.ignoreCategories.join(', ')} compté(s)`];
  const comptes = ctx.rooms.flatMap((r) => itemsDe(sc, r.id)).filter((it) => !(exclure && ignore(it, p.ignoreCategories)) && it.s.provides.includes(p.providing));
  const vals = comptes.map((it) => it.s[p.measure] ?? 0);
  const V = p.aggregate === 'somme' ? vals.reduce((a, b) => a + b, 0) : vals.length ? Math.max(...vals) : 0;
  const E = sc.N + p.margin;
  const quoi = p.measure === 'sleeps' ? 'couchage(s)' : 'place(s)';
  const v: RawViolation[] = [];
  if (p.bound === 'min' && V < E) v.push({ roomId: null, placementIds: comptes.map((it) => it.p.id), measured: V, expected: E, message: `${V} ${quoi} (${p.providing}) pour ${E} requis (${sc.N} occupant(s)${p.margin ? `, marge ${p.margin}` : ''}).`, action: `Ajouter ou agrandir le mobilier assurant « ${p.providing} » pour atteindre ${E} ${quoi} (actuellement ${V}).` });
  if (p.bound === 'max' && V > 0 && V > E) v.push({ roomId: null, placementIds: comptes.map((it) => it.p.id), measured: V, expected: E, message: `${V} ${quoi} (${p.providing}) pour ${E} au plus (${sc.N} occupant(s)${p.margin ? ` + ${p.margin}` : ''}) : surdimensionné.`, action: `Choisir un modèle plus petit pour « ${p.providing} » (au plus ${E} ${quoi}, actuellement ${V}).` });
  return { status: 'checked', violations: v, evaluatedRoomIds: [], assumptions };
});

// ───────────────────────────── 10. triangle_cuisine ─────────────────────────────

const POLES: UsageFunction[] = ['froid', 'evier', 'cuisson'];

const triangleCuisine = def('triangle_cuisine', (ctx, p) => {
  const sc = ctx.scene;
  if (!ctx.rooms.length) return NA;
  const v: RawViolation[] = [];
  const evalues: string[] = [];
  const manques: string[] = [];
  for (const room of ctx.rooms) {
    const its = [...itemsDe(sc, room.id)].sort((a, b) => a.ordre - b.ordre);
    const fournisseur = new Map<UsageFunction, Item>();
    for (const f of POLES) { const it = its.find((x) => x.s.provides.includes(f)); if (it) fournisseur.set(f, it); }
    if (fournisseur.size < 3) { manques.push(`${nomPiece(sc, room.id)} (${POLES.filter((f) => !fournisseur.has(f)).join(', ')})`); continue; }
    evalues.push(room.id);
    const pos = new Map<UsageFunction, Vec2>();
    for (const it of new Set(fournisseur.values())) {
      const siens = POLES.filter((f) => fournisseur.get(f) === it);
      const w = it.s.size.w, k = siens.length;
      siens.forEach((f, i) => pos.set(f, localVersMonde(it.p, -w / 2 + (w * (i + 0.5)) / k, it.s.size.d / 2)));
    }
    const [F, E, C] = [pos.get('froid')!, pos.get('evier')!, pos.get('cuisson')!];
    const cotes: Array<[string, number]> = [['froid – évier', dist(F, E)], ['évier – cuisson', dist(E, C)], ['cuisson – froid', dist(C, F)]];
    const per = cotes.reduce((s, [, d]) => s + d, 0);
    const defauts: Array<{ txt: string; mesure: number; seuil: number }> = [];
    for (const [nom, d] of cotes) {
      if (d < p.minLeg - TOL) defauts.push({ txt: `${nom} ${fmt(d)} m < ${fmt(p.minLeg)} m`, mesure: d, seuil: p.minLeg });
      else if (d > p.maxLeg + TOL) defauts.push({ txt: `${nom} ${fmt(d)} m > ${fmt(p.maxLeg)} m`, mesure: d, seuil: p.maxLeg });
    }
    if (per > p.maxPerimeter + TOL) defauts.push({ txt: `périmètre ${fmt(per)} m > ${fmt(p.maxPerimeter)} m`, mesure: per, seuil: p.maxPerimeter });
    if (defauts.length) v.push({
      roomId: room.id, placementIds: [...new Set(fournisseur.values())].map((it) => it.p.id), measured: r3(defauts[0]!.mesure), expected: defauts[0]!.seuil,
      message: `${nomPiece(sc, room.id)} : triangle évier – cuisson – froid hors bornes (${defauts.map((d) => d.txt).join(' ; ')}).`,
      action: `Dans ${nomPiece(sc, room.id)}, rapprocher ou réordonner évier, cuisson et réfrigérateur (côtés entre ${fmt(p.minLeg)} et ${fmt(p.maxLeg)} m, périmètre ≤ ${fmt(p.maxPerimeter)} m).`,
    });
  }
  if (!evalues.length) return { status: 'skipped', reason: `pôle(s) du triangle manquant(s) : ${manques.join(' ; ')}` };
  return { status: 'checked', violations: v, evaluatedRoomIds: evalues };
});

// ───────────────────────────── 11. ratio_dimension ─────────────────────────────

const ratioDimension = def('ratio_dimension', (ctx, p) => {
  const sc = ctx.scene;
  if (!ctx.rooms.length) return NA;
  const v: RawViolation[] = [];
  const hors = (x: number) => (p.min !== undefined && x < p.min - 1e-9) || (p.max !== undefined && x > p.max + 1e-9);
  const borne = (x: number) => (p.min !== undefined && x < p.min - 1e-9 ? p.min : p.max!);
  const bornesTxt = [p.min !== undefined ? `≥ ${fmt(p.min, 3)}` : '', p.max !== undefined ? `≤ ${fmt(p.max, 3)}` : ''].filter(Boolean).join(' et ');
  const tolMur = p.wallTolerance ?? 0.3;
  for (const room of ctx.rooms) {
    const its = itemsDe(sc, room.id);
    const num = its.filter((it) => deCategorie(it, p.categories) && !ignore(it, p.ignoreCategories));
    const numer = (it: Item) => (p.numerator === 'largeur' ? it.s.size.w : rectArea(it.fp));
    if (p.reference === 'piece') {
      const ratio = num.reduce((s, it) => s + rectArea(it.fp), 0) / room.area;
      if (hors(ratio)) v.push({ roomId: room.id, placementIds: num.map((it) => it.p.id), measured: r3(ratio), expected: borne(ratio), message: `${nomPiece(sc, room.id)} : emprise du mobilier retenu = ${fmt(ratio * 100, 0)} % de la surface (attendu ${bornesTxt}).`, action: `Alléger ${nomPiece(sc, room.id)} : retirer un meuble ou choisir des modèles plus compacts (ratio ${bornesTxt}).` });
      continue;
    }
    for (const it of num) {
      let den: number | null = null, refTxt = '';
      if (p.reference === 'mur') {
        // D10 : arête parallèle au bord arrière, à ≤ tolMur derrière lui, avec recouvrement latéral.
        const back = pointsCote(it.p, it.s, it.fp, 'back');
        const dir = back.dir; // vers l'arrière
        const horiz = Math.abs(dir[0]) > 0.5;
        const ligne = horiz ? (dir[0] > 0 ? it.fp.maxX : it.fp.minX) : (dir[1] > 0 ? it.fp.maxY : it.fp.minY);
        const [lo, hi] = horiz ? [it.fp.minY, it.fp.maxY] : [it.fp.minX, it.fp.maxX];
        let meilleur: { d: number; L: number } | null = null;
        for (const [a, c] of aretes(room.polygon)) {
          const par = horiz ? Math.abs(a[0] - c[0]) < 1e-6 : Math.abs(a[1] - c[1]) < 1e-6;
          if (!par) continue;
          const pos = horiz ? a[0] : a[1];
          const d = (pos - ligne) * (horiz ? dir[0] : dir[1]);
          if (d < -tolMur - 1e-9 || d > tolMur + 1e-9) continue;
          const [e0, e1] = horiz ? [Math.min(a[1], c[1]), Math.max(a[1], c[1])] : [Math.min(a[0], c[0]), Math.max(a[0], c[0])];
          if (Math.min(hi, e1) - Math.max(lo, e0) <= 1e-6) continue;
          const L = e1 - e0;
          if (!meilleur || Math.abs(d) < Math.abs(meilleur.d) - 1e-9) meilleur = { d, L };
        }
        if (meilleur) { den = meilleur.L; refTxt = `mur d'adossement de ${fmt(meilleur.L)} m`; }
      } else {
        const refs = its.filter((q) => q !== it && (p.referenceCategories ?? []).includes(q.s.category));
        if (refs.length) {
          const q = refs.reduce((a, b) => (dist(b.p.center, it.p.center) < dist(a.p.center, it.p.center) - 1e-12 ? b : a));
          den = q.s.size.w; refTxt = `${nomItem(q)} de ${fmt(q.s.size.w)} m`;
        }
      }
      if (den === null || den <= 0) continue;
      const ratio = numer(it) / den;
      if (hors(ratio)) v.push({ roomId: room.id, placementIds: [it.p.id], measured: r3(ratio), expected: borne(ratio), message: `${nomItem(it)} : rapport ${fmt(ratio, 3)} au ${refTxt} (attendu ${bornesTxt}).`, action: `Redimensionner ${nomItem(it)} : rapport au ${refTxt} attendu ${bornesTxt}.` });
    }
  }
  return { status: 'checked', violations: v, evaluatedRoomIds: ctx.rooms.map((r) => r.id) };
});

// ───────────────────────────── 12. distance_entre_categories ─────────────────────────────

const distanceEntreCategories = def('distance_entre_categories', (ctx, p) => {
  const sc = ctx.scene;
  if (!ctx.rooms.length) return NA;
  const v: RawViolation[] = [];
  const mesure = (a: Item, b: Item) => (p.measure === 'bord_a_bord' ? distRectRect(a.fp, b.fp)
    : p.measure === 'faces_avant' ? dist(milieuAvant(a.p, a.s), milieuAvant(b.p, b.s)) : dist(a.p.center, b.p.center));
  for (const room of ctx.rooms) for (const src of itemsDe(sc, room.id).filter((it) => (p.from as string[]).includes(it.s.category))) {
    const pool = (p.sameRoomOnly ? itemsDe(sc, room.id) : sc.items).filter((q) => q !== src && (p.to as string[]).includes(q.s.category));
    if (!pool.length) continue;
    let best = pool[0]!, d = mesure(src, best);
    for (const q of pool.slice(1)) { const dq = mesure(src, q); if (dq < d - 1e-12) { best = q; d = dq; } }
    const bas = p.min !== undefined && d < p.min - TOL, haut = p.max !== undefined && d > p.max + TOL;
    if (!bas && !haut) continue;
    const seuil = bas ? p.min! : p.max!;
    v.push({
      roomId: room.id, placementIds: [src.p.id, best.p.id], measured: r3(d), expected: seuil,
      message: `${nomItem(src)} est à ${fmt(d)} m de ${nomItem(best)} (${bas ? 'minimum' : 'maximum'} ${fmt(seuil)} m).`,
      action: `${bas ? 'Éloigner' : 'Rapprocher'} ${nomItem(src)} de ${nomItem(best)} (${bas ? 'au moins' : 'au plus'} ${fmt(seuil)} m).`,
    });
  }
  return { status: 'checked', violations: v, evaluatedRoomIds: ctx.rooms.map((r) => r.id) };
});

// ───────────────────────────── 13. zonage_jour_nuit ─────────────────────────────

const zonageJourNuit = def('zonage_jour_nuit', (ctx, p) => {
  const sc = ctx.scene;
  if (!ctx.rooms.length) return NA;
  const kindOf = new Map(sc.input.openings.map((o) => [o.id, o.kind]));
  const candidats = sc.analysis.adjacency.filter((a) => a.b === null && kindOf.get(a.viaOpening) === 'door').map((a) => a.a);
  if (!candidats.length) return { status: 'skipped', reason: 'pièce d\'entrée introuvable (aucune porte vers le palier / l\'extérieur)' };
  // D12 : plusieurs candidates => la pièce de rôle « entree » d'abord, puis la plus petite id.
  const tri = [...new Set(candidats)].sort((x, y) => {
    const ex = sc.roomById.get(x)?.role === 'entree' ? 0 : 1, ey = sc.roomById.get(y)?.role === 'entree' ? 0 : 1;
    return ex - ey || (x < y ? -1 : x > y ? 1 : 0);
  });
  const entree = tri[0]!;
  const voisins = new Map<string, string[]>();
  for (const a of sc.analysis.adjacency) {
    if (a.b === null) continue;
    for (const [x, y] of [[a.a, a.b], [a.b, a.a]] as const) { const l = voisins.get(x) ?? []; if (!l.includes(y)) l.push(y); voisins.set(x, l); }
  }
  for (const l of voisins.values()) l.sort();
  const parent = new Map<string, string | null>([[entree, null]]);
  const file = [entree];
  while (file.length) {
    const x = file.shift()!;
    for (const y of voisins.get(x) ?? []) if (!parent.has(y)) { parent.set(y, x); file.push(y); }
  }
  const v: RawViolation[] = [];
  const missing: string[] = [];
  const nuits = ctx.rooms.filter((r) => r.zone === 'nuit');
  for (const room of nuits) {
    if (!parent.has(room.id)) { missing.push(`[${ctx.rule.id}] ${nomPiece(sc, room.id)} non reliée à l'entrée par une ouverture : zonage non évalué`); continue; }
    const chemin: string[] = [];
    for (let x = parent.get(room.id) ?? null; x !== null && x !== entree; x = parent.get(x) ?? null) chemin.unshift(x);
    const jours = chemin.filter((id) => sc.roomById.get(id)?.zone === 'jour');
    if (jours.length > p.maxJourCrossings) v.push({
      roomId: room.id, placementIds: [], measured: jours.length, expected: p.maxJourCrossings,
      message: `${nomPiece(sc, room.id)} n'est accessible depuis l'entrée qu'en traversant ${jours.map((id) => nomPiece(sc, id)).join(', ')} (pièce(s) de jour).`,
      action: `Défaut du plan (cloisons figées) : signaler au client que ${nomPiece(sc, room.id)} est desservie par ${jours.map((id) => nomPiece(sc, id)).join(', ')} ; prévoir une séparation visuelle (claustra, rideau) si souhaité.`,
    });
  }
  return { status: 'checked', violations: v, evaluatedRoomIds: nuits.map((r) => r.id), missing };
});

// ───────────────────────────── 14. recommandation_prises ─────────────────────────────

const recommandationPrises = def('recommandation_prises', (ctx, p) => {
  const sc = ctx.scene;
  if (!ctx.rooms.length) return NA;
  const recos: string[] = [];
  const id = ctx.rule.id;
  for (const room of ctx.rooms) {
    const nom = nomPiece(sc, room.id);
    const its = itemsDe(sc, room.id);
    let n: number | null = null, pourquoi = '';
    if (p.smallAreaThreshold !== undefined && p.smallAreaCount !== undefined && room.area <= p.smallAreaThreshold + 1e-9) { n = p.smallAreaCount; pourquoi = ` (surface ${fmt(room.area, 1)} m² ≤ ${fmt(p.smallAreaThreshold, 0)} m²)`; }
    else if (p.m2PerSocket !== undefined) {
      n = Math.max(p.minCount ?? 0, Math.ceil(room.area / p.m2PerSocket - 1e-9));
      if (p.maxRequired !== undefined) n = Math.min(n, p.maxRequired);
      pourquoi = ` (1 par tranche de ${fmt(p.m2PerSocket, 0)} m²)`;
    } else if (p.minCount !== undefined) n = p.minCount;
    const morceaux: string[] = [];
    if (n !== null && n > 0) morceaux.push(`prévoir au moins ${n} prise${n > 1 ? 's' : ''} de courant${pourquoi}${p.minAboveWorktop ? `, dont ${p.minAboveWorktop} au-dessus du plan de travail` : ''}`);
    if (p.nearSwitch) morceaux.push('prévoir une prise à proximité immédiate de l\'interrupteur d\'entrée de pièce et ne pas la masquer par un meuble haut');
    const proches = p.nearFunctions ? its.filter((it) => it.s.provides.some((f) => p.nearFunctions!.includes(f))) : [];
    if (proches.length) morceaux.push(`${morceaux.length ? 'dont ' : 'prévoir des prises '}près de : ${proches.map((it) => `${it.s.label} (placement ${it.p.id})`).join(', ')}`);
    if (morceaux.length) recos.push(`[${id}] ${nom} : ${morceaux.join(' ; ')}.`);
    if (p.dedicatedFor) for (const it of its) {
      const fs = it.s.provides.filter((f) => p.dedicatedFor!.includes(f));
      if (fs.length) recos.push(`[${id}] ${nom} : prévoir une alimentation dédiée pour ${it.s.label} (placement ${it.p.id}) — ${fs.join(', ')}.`);
    }
  }
  return { status: 'checked', violations: [], evaluatedRoomIds: ctx.rooms.map((r) => r.id), recommendations: recos };
});

// ───────────────────────────── 15. style_coherence ─────────────────────────────

const styleCoherence = def('style_coherence', (ctx, p) => {
  const sc = ctx.scene;
  if (!ctx.rooms.length) return NA;
  // INT-07 (D24) : les catégories exclues sont ignorées par ce contrôle (y compris pour décider rulesSkipped).
  const exclues = new Set<string>(p.excludeCategories ?? []);
  const finis = (ids: string[]) => ids.flatMap((id) => itemsDe(sc, id)).filter((it) => it.p.finish && !exclues.has(it.s.category));
  const tousFinis = finis(ctx.rooms.map((r) => r.id));
  if (!tousFinis.length) return { status: 'skipped', reason: 'finitions non renseignées' };
  const v: RawViolation[] = [];
  const evalues: string[] = [];
  const groupes: Array<{ roomId: string | null; its: Item[] }> = p.scope === 'logement'
    ? [{ roomId: null, its: tousFinis }]
    : ctx.rooms.map((r) => ({ roomId: r.id, its: finis([r.id]) })).filter((g) => g.its.length);
  const ou = (g: { roomId: string | null }) => (g.roomId ? nomPiece(sc, g.roomId) : 'Logement');

  if (p.aspect === 'materiau_commun') {
    // Toujours agrégé sur le logement (comparaison entre pièces).
    const dom = ctx.rooms.map((r) => {
      const its = finis([r.id]);
      if (!its.length) return null;
      const m = materiauDominant(its.map((it) => ({ material: it.p.finish!.material, A: aireApparente(it.s) })))!;
      return { roomId: r.id, m };
    }).filter((x): x is { roomId: string; m: string } => x !== null);
    const distincts = [...new Set(dom.map((d) => d.m))];
    if (distincts.length >= 2) v.push({
      roomId: null, placementIds: [], measured: distincts.length, expected: 1,
      message: `Matériaux dominants différents selon les pièces : ${dom.map((d) => `${nomPiece(sc, d.roomId)} = ${d.m}`).join(', ')}.`,
      action: `Harmoniser le matériau dominant des pièces (${dom.map((d) => nomPiece(sc, d.roomId)).join(', ')}) : choisir un matériau commun (ex. ${distincts[0]}).`,
    });
    return { status: 'checked', violations: v, evaluatedRoomIds: [] };
  }

  for (const g of groupes) {
    if (g.roomId) evalues.push(g.roomId);
    if (p.aspect === 'essences_bois_max' || p.aspect === 'materiaux_max') {
      const vals = p.aspect === 'essences_bois_max'
        ? g.its.filter((it) => it.p.finish!.material === 'bois' && it.p.finish!.woodSpecies).map((it) => it.p.finish!.woodSpecies!)
        : g.its.map((it) => it.p.finish!.material);
      const d = [...new Set(vals)].sort();
      const max = p.max ?? Infinity; // D13 : max absent => non borné
      if (d.length > max) v.push({
        roomId: g.roomId, placementIds: g.its.map((it) => it.p.id), measured: d.length, expected: max,
        message: `${ou(g)} : ${d.length} ${p.aspect === 'essences_bois_max' ? 'essences de bois' : 'matériaux'} distincts (${d.join(', ')}) pour ${max} au plus.`,
        action: `${ou(g)} : réduire à ${max} ${p.aspect === 'essences_bois_max' ? 'essences de bois' : 'matériaux principaux'} au plus (actuellement ${d.join(', ')}).`,
      });
      continue;
    }
    // palette_60_30_10
    const colores = g.its.map((it) => ({ it, c: hexRvb(it.p.finish!.color), A: aireApparente(it.s) })).filter((x) => x.c !== null)
      .sort((a, b) => b.A - a.A || a.it.ordre - b.it.ordre);
    if (!colores.length) continue;
    if (colores.length < (p.minPlacements ?? 1)) { if (g.roomId) evalues.pop(); continue; } // D24 : trop peu de meubles colorés, pièce non évaluée
    const parts = partsPalette(colores.map((x) => ({ rvb: x.c!, hex: x.it.p.finish!.color!, A: x.A })), p.colorTolerance ?? 0);
    const defauts = defautsPalette(parts, p, (x) => fmt(x * 100, 0));
    if (defauts.length) v.push({
      roomId: g.roomId, placementIds: colores.map((x) => x.it.p.id), measured: r3(defauts[0]!.m), expected: defauts[0]!.e,
      message: `${ou(g)} : palette hors règle 60/30/10 (${defauts.map((d) => d.txt).join(' ; ')} ; couleurs ${parts.map((x) => `${x.hex} ${fmt(x.part * 100, 0)} %`).join(', ')}).`,
      action: `${ou(g)} : rééquilibrer les couleurs du mobilier vers ~60 % dominante, ~30 % secondaire, ~10 % accent.`,
    });
  }
  return { status: 'checked', violations: v, evaluatedRoomIds: p.scope === 'logement' ? [] : evalues };
});

// ───────────────────────────── 16. vis_a_vis ─────────────────────────────

const visAVis = def('vis_a_vis', (ctx, p) => {
  const sc = ctx.scene;
  if (!ctx.rooms.length) return NA;
  const v: RawViolation[] = [];
  const evalues: string[] = [];
  for (const room of ctx.rooms) for (const src of itemsDe(sc, room.id).filter((it) => (p.from as string[]).includes(it.s.category))) {
    const pool = (p.sameRoomOnly ? itemsDe(sc, room.id) : sc.items).filter((q) => q !== src && (p.to as string[]).includes(q.s.category));
    if (!pool.length) continue;
    if (!evalues.includes(room.id)) evalues.push(room.id);
    const f = frontDir(src.p.rotationDeg), a = milieuAvant(src.p, src.s);
    // D22 : face à face = devants opposés, cible devant la source ; décalage latéral = écart des milieux des faces avant
    // perpendiculairement à l'axe. On retient la cible au plus petit décalage.
    let best: { q: Item; lat: number } | null = null;
    for (const q of pool) {
      const g = frontDir(q.p.rotationDeg);
      if (g[0] !== -f[0] || g[1] !== -f[1]) continue;
      const b = milieuAvant(q.p, q.s);
      const ax = (b[0] - a[0]) * f[0] + (b[1] - a[1]) * f[1];
      if (ax <= 0) continue;
      const lat = Math.abs((b[0] - a[0]) * f[1] - (b[1] - a[1]) * f[0]);
      if (!best || lat < best.lat - 1e-12) best = { q, lat };
    }
    if (best && best.lat <= p.maxLateralOffset + TOL) continue;
    const cible = best?.q ?? pool[0]!;
    v.push({
      roomId: room.id, placementIds: [src.p.id, cible.p.id], ...(best ? { measured: r3(best.lat), expected: p.maxLateralOffset } : {}),
      message: best ? `${nomItem(src)} et ${nomItem(cible)} se font face mais sont décalés de ${fmt(best.lat)} m (au plus ${fmt(p.maxLateralOffset)} m).`
        : `${nomItem(src)} ne fait face à aucun ${p.to.join(' / ')} de ${nomPiece(sc, room.id)} (${nomItem(cible)} n'est pas en vis-à-vis).`,
      action: `Placer ${nomItem(cible)} face à ${nomItem(src)}, dans son axe (décalage ≤ ${fmt(p.maxLateralOffset)} m).`,
    });
  }
  if (!evalues.length) return { status: 'skipped', reason: `aucune paire (${p.from.join(', ')}) / (${p.to.join(', ')}) dans les pièces concernées` };
  return { status: 'checked', violations: v, evaluatedRoomIds: evalues };
});

// ───────────────────────────── 17. adossement ─────────────────────────────

const adossement = def('adossement', (ctx, p) => {
  const sc = ctx.scene;
  if (!ctx.rooms.length) return NA;
  const v: RawViolation[] = [];
  const evalues: string[] = [];
  for (const room of ctx.rooms) for (const it of itemsDe(sc, room.id).filter((x) => (p.categories as string[]).includes(x.s.category))) {
    if (!evalues.includes(room.id)) evalues.push(room.id);
    // D23 : le bord arrière est adossé si une arête du polygone, parallèle, à ≤ maxGap derrière lui, couvre toute sa largeur.
    const back = pointsCote(it.p, it.s, it.fp, 'back');
    const horiz = Math.abs(back.dir[0]) > 0.5;
    const ligne = horiz ? (back.dir[0] > 0 ? it.fp.maxX : it.fp.minX) : (back.dir[1] > 0 ? it.fp.maxY : it.fp.minY);
    const [lo, hi] = horiz ? [it.fp.minY, it.fp.maxY] : [it.fp.minX, it.fp.maxX];
    const couverts: Array<[number, number]> = [];
    let ecart = Infinity;
    for (const [a, c] of aretes(room.polygon)) {
      if (horiz ? Math.abs(a[0] - c[0]) > 1e-6 : Math.abs(a[1] - c[1]) > 1e-6) continue;
      const d = ((horiz ? a[0] : a[1]) - ligne) * (horiz ? back.dir[0] : back.dir[1]);
      if (d < -1e-6) continue;
      const [e0, e1] = horiz ? [Math.min(a[1], c[1]), Math.max(a[1], c[1])] : [Math.min(a[0], c[0]), Math.max(a[0], c[0])];
      if (Math.min(hi, e1) - Math.max(lo, e0) <= 1e-6) continue;
      ecart = Math.min(ecart, d);
      if (d <= p.maxGap + TOL) couverts.push([Math.max(lo, e0), Math.min(hi, e1)]);
    }
    couverts.sort((x, y) => x[0] - y[0]);
    let x = lo;
    for (const [a, b] of couverts) if (a <= x + 1e-6) x = Math.max(x, b);
    if (x >= hi - 1e-6) continue;
    v.push({
      roomId: room.id, placementIds: [it.p.id], ...(Number.isFinite(ecart) ? { measured: r3(ecart), expected: p.maxGap } : {}),
      message: `${nomItem(it)} n'est pas adossé à un mur sur toute sa largeur (${Number.isFinite(ecart) ? `écart ${fmt(ecart)} m` : 'aucun mur derrière'}).`,
      action: `Adosser ${nomItem(it)} à un mur plein de ${nomPiece(sc, room.id)}.`,
    });
  }
  if (!evalues.length) return { status: 'skipped', reason: `aucune cible (${p.categories.join(', ')}) placée dans les pièces concernées` };
  return { status: 'checked', violations: v, evaluatedRoomIds: evalues };
});

// ───────────────────────────── Registre ─────────────────────────────

export const CHECKS: Record<CheckKind, CheckFn> = {
  emprise_valide: empriseValide,
  passage_min: passageMin,
  cercle_manoeuvre: cercleManoeuvre,
  degagement_categorie: degagementCategorie,
  debattement_libre: debattementLibre,
  ouverture_non_obstruee: ouvertureNonObstruee,
  distance_fixture: distanceFixture,
  fonctions_requises: fonctionsRequises,
  capacite_occupants: capaciteOccupants,
  triangle_cuisine: triangleCuisine,
  ratio_dimension: ratioDimension,
  distance_entre_categories: distanceEntreCategories,
  zonage_jour_nuit: zonageJourNuit,
  recommandation_prises: recommandationPrises,
  style_coherence: styleCoherence,
  vis_a_vis: visAVis,
  adossement,
};
