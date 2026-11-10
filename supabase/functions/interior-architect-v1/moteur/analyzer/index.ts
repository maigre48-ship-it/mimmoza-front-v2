/**
 * INT-03 — Analyseur de plan.
 *
 * `analyzePlan(plan)` est PUR et DÉTERMINISTE : aucune horloge, aucun hasard, aucun appel
 * réseau ni LLM ; l'entrée n'est jamais modifiée. Rien n'est inventé : une donnée absente
 * va dans `missing`, toute supposition dans `assumptions`.
 *
 * Conventions retenues (à lire avant d'utiliser les sorties) :
 * - Les murs sont rattachés aux arêtes des pièces par colinéarité (tolérance 2 cm) ; un mur
 *   portant `level` ne concerne que les pièces de ce niveau, un mur sans `level` tous les niveaux.
 * - Charnière : `hinge: 'a'` = la charnière est à l'extrémité de l'ouverture la plus proche de
 *   `wall.a` (bord situé à `offset`), `'b'` = extrémité située à `offset + width`.
 * - Débattement : quart de cercle de rayon = largeur de l'ouverture (vantail unique), centré sur
 *   la charnière, balayé depuis le tableau opposé jusqu'à la normale intérieure de la pièce.
 * - Une portion de mur est retirée des wallRuns si la BANDE de profondeur
 *   PROFONDEUR_BANDE_DEBATTEMENT (0,60 m, profondeur d'un meuble adossé type) devant elle
 *   intersecte un débattement de la pièce : un meuble adossé là bloquerait la porte.
 */
import type { AnalyzedRoom, Fixture, FixtureKind, Opening, PlanAnalysis, PlanInput, RoomInput, RoomRole, SwingZone, Vec2, Wall, WallRun } from '../types';
import {
  area as aireAbs, bbox, clipPolygonHalfPlane, cross, dot, len, normalize, pointInPolygon, round, signedArea, sub, subtractIntervals, type Interval,
} from '../geometry';

// ───────────────────────────── Constantes ─────────────────────────────

/** Longueur minimale d'une portion de mur exploitable pour adosser un meuble (m). */
export const LONGUEUR_MIN_WALLRUN = 0.3;
/** Profondeur de la bande devant un mur testée contre les débattements (m). */
export const PROFONDEUR_BANDE_DEBATTEMENT = 0.6;
/** Nombre de segments de l'arc approchant le quart de cercle de débattement. */
export const SEGMENTS_ARC = 8;
/** Tolérance de colinéarité mur / arête de pièce (m). */
export const TOL_COLINEAIRE = 0.02;

export const ZONE_PAR_ROLE: Record<RoomRole, AnalyzedRoom['zone']> = {
  entree: 'circulation', degagement: 'circulation',
  sejour: 'jour', cuisine: 'jour', sejour_cuisine: 'jour', bureau: 'jour',
  chambre: 'nuit', chambre_parentale: 'nuit', dressing: 'nuit',
  salle_de_bain: 'service', salle_d_eau: 'service', wc: 'service', cellier: 'service', buanderie: 'service',
  exterieur: 'exterieur',
};

/** Rôles qui exigent un point d'eau. */
export const ROLES_HUMIDES: readonly RoomRole[] = ['cuisine', 'sejour_cuisine', 'salle_de_bain', 'salle_d_eau', 'wc', 'buanderie'];
/** Équipements valant « point d'eau ». */
export const EQUIPEMENTS_EAU: readonly FixtureKind[] = ['gaine', 'arrivee_eau', 'evacuation'];
/** Ouvertures praticables (passage d'une pièce à l'autre). */
const PASSAGES: ReadonlySet<Opening['kind']> = new Set(['door', 'opening', 'french_window']);
const VITRAGES: ReadonlySet<Opening['kind']> = new Set(['window', 'french_window']);
const BATTANTS: ReadonlySet<Opening['kind']> = new Set(['door', 'french_window']);

const r4 = (x: number) => round(x, 4);
const v4 = (p: Vec2): Vec2 => [r4(p[0]), r4(p[1])];
const unit6 = (p: Vec2): Vec2 => [round(p[0], 6) + 0, round(p[1], 6) + 0];
const at = (o: Vec2, d: Vec2, t: number): Vec2 => [o[0] + d[0] * t, o[1] + d[1] * t];
const parId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// ───────────────────────────── Déduction de rôle ─────────────────────────────

export interface IndicesRole {
  name?: string;
  area: number;
  hasWater: boolean;
  /** Nombre de passages (portes, baies libres, portes-fenêtres). */
  nbPassages: number;
  /** Nombre de vitrages (fenêtres, portes-fenêtres). */
  nbFenetres: number;
  /** Une porte donne-t-elle sur l'extérieur / le palier (connects contient null) ? */
  porteSurExterieur: boolean;
  /** Rapport grand côté / petit côté de la boîte englobante. */
  elongation: number;
}

export interface RoleDeduit { role: RoomRole; confidence: number; raison: string }

const sansAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Règles sur le nom, de la plus spécifique à la plus générale. */
const REGLES_NOM: Array<[RegExp, RoomRole]> = [
  [/\bwc\b|toilette/, 'wc'],
  [/salle d.?eau|\bsde\b|douche/, 'salle_d_eau'],
  [/salle de bains?|\bsdb\b|\bbains?\b/, 'salle_de_bain'],
  [/(sejour|salon|living).*cuisine|cuisine.*(sejour|salon|living)/, 'sejour_cuisine'],
  [/cuisine|kitchenette/, 'cuisine'],
  [/sejour|salon|living|piece de vie|piece principale/, 'sejour'],
  [/chambre.*parent|suite parentale/, 'chambre_parentale'],
  [/chambre/, 'chambre'],
  [/entree|\bhall\b/, 'entree'],
  [/degagement|couloir|palier|escalier|circulation/, 'degagement'],
  [/buanderie|lingerie/, 'buanderie'],
  [/cellier|rangement|placard|debarras/, 'cellier'],
  [/bureau/, 'bureau'],
  [/dressing/, 'dressing'],
  [/balcon|terrasse|loggia|jardin/, 'exterieur'],
];

/**
 * Déduit un rôle par règles explicites (jamais de LLM). Ordre : nom de la pièce (confiance 0,9),
 * puis indices physiques (eau, surface, fenêtres, portes). Confiance toujours < 1.
 */
export function deduireRole(ix: IndicesRole): RoleDeduit {
  if (ix.name) {
    const n = sansAccents(ix.name);
    for (const [re, role] of REGLES_NOM) if (re.test(n)) return { role, confidence: 0.9, raison: `nom « ${ix.name} »` };
  }
  const s = round(ix.area, 2);
  if (ix.hasWater) {
    if (s < 2.5) return { role: 'wc', confidence: 0.75, raison: `point d'eau et ${s} m² < 2,5 m²` };
    if (s < 7) return { role: 'salle_d_eau', confidence: 0.55, raison: `point d'eau et ${s} m² < 7 m² (douche ou bain indiscernable)` };
    if (s < 14) return ix.nbFenetres > 0
      ? { role: 'cuisine', confidence: 0.5, raison: `point d'eau, ${s} m², éclairée naturellement` }
      : { role: 'salle_de_bain', confidence: 0.45, raison: `point d'eau, ${s} m², sans fenêtre` };
    return { role: 'sejour_cuisine', confidence: 0.5, raison: `point d'eau et ${s} m² >= 14 m²` };
  }
  if (ix.nbFenetres === 0) {
    if (ix.porteSurExterieur) return { role: 'entree', confidence: 0.7, raison: 'porte sur palier / extérieur, sans fenêtre' };
    if (ix.nbPassages >= 3 || ix.elongation >= 2.5) return { role: 'degagement', confidence: 0.6, raison: `sans fenêtre, ${ix.nbPassages} passages, élancement ${round(ix.elongation, 2)}` };
    if (s < 4) return { role: 'cellier', confidence: 0.4, raison: `sans fenêtre ni eau, ${s} m² < 4 m²` };
    return { role: 'degagement', confidence: 0.35, raison: `sans fenêtre ni eau, ${s} m²` };
  }
  if (s >= 18) return { role: 'sejour', confidence: 0.6, raison: `éclairée, ${s} m² >= 18 m²` };
  if (s >= 7) return { role: 'chambre', confidence: ix.nbPassages === 1 ? 0.65 : 0.5, raison: `éclairée, ${s} m² entre 7 et 18 m², ${ix.nbPassages} passage(s)` };
  return { role: 'bureau', confidence: 0.4, raison: `éclairée, ${s} m² < 7 m²` };
}

// ───────────────────────────── Géométrie des ouvertures ─────────────────────────────

interface OuvertureGeo { opening: Opening; wall: Wall; p0: Vec2; p1: Vec2 }

const murDuNiveau = (w: Wall, level: number) => w.level === undefined || w.level === level;

/** Normale unitaire de l'ouverture pointant vers l'intérieur de `room`, ou null si l'ouverture n'est pas en bord de pièce. */
function normaleVers(room: { polygon: Vec2[] }, p0: Vec2, p1: Vec2): Vec2 | null {
  const d = normalize(sub(p1, p0)), n: Vec2 = [-d[1], d[0]];
  const m: Vec2 = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
  const plus = pointInPolygon(at(m, n, 0.05), room.polygon), moins = pointInPolygon(at(m, n, -0.05), room.polygon);
  if (plus && !moins) return n;
  if (moins && !plus) return [-n[0], -n[1]];
  return null;
}

/** Quart de cercle (polygone anti-horaire) : charnière, puis arc du tableau opposé vers la normale. */
function secteur(h: Vec2, e: Vec2, n: Vec2, r: number): Vec2[] {
  const u = normalize(sub(e, h));
  const arc: Vec2[] = [];
  for (let k = 0; k <= SEGMENTS_ARC; k++) {
    const t = (k * Math.PI) / 2 / SEGMENTS_ARC, c = Math.cos(t), s = Math.sin(t);
    arc.push(v4([h[0] + r * (c * u[0] + s * n[0]), h[1] + r * (c * u[1] + s * n[1])]));
  }
  if (cross(u, n) < 0) arc.reverse();
  return [v4(h), ...arc];
}

// ───────────────────────────── Analyse ─────────────────────────────

interface Travail {
  input: RoomInput;
  polygon: Vec2[];
  area: number;
  fixtures: Fixture[];
  hasWater: boolean;
  role: RoomRole;
  roleSource: AnalyzedRoom['roleSource'];
  roleConfidence: number;
}

export function analyzePlan(plan: PlanInput): PlanAnalysis {
  const missing: string[] = [];
  const assumptions: string[] = [];

  if (plan.northDeg === null) missing.push('orientation inconnue');
  if (plan.walls.some((w) => w.loadBearing === null)) missing.push('murs porteurs inconnus');

  const roomById = new Map(plan.rooms.map((r) => [r.id, r]));
  const wallById = new Map(plan.walls.map((w) => [w.id, w]));

  // 1. Géométrie monde des ouvertures.
  const geo = new Map<string, OuvertureGeo>();
  for (const o of plan.openings) {
    const w = wallById.get(o.wallId);
    if (!w) { missing.push(`ouverture ${o.id} : mur ${o.wallId} introuvable`); continue; }
    const L = len(sub(w.b, w.a));
    if (o.offset < -1e-6 || o.width <= 0 || o.offset + o.width > L + 1e-6) { missing.push(`ouverture ${o.id} : position incohérente sur le mur ${w.id} (offset ${o.offset}, largeur ${o.width}, mur ${r4(L)} m)`); continue; }
    for (const c of o.connects) if (c !== null && !roomById.has(c)) missing.push(`ouverture ${o.id} : pièce reliée ${c} inconnue`);
    const d = normalize(sub(w.b, w.a));
    geo.set(o.id, { opening: o, wall: w, p0: at(w.a, d, o.offset), p1: at(w.a, d, o.offset + o.width) });
  }
  const geoValides = plan.openings.map((o) => geo.get(o.id)).filter((g): g is OuvertureGeo => g !== undefined);

  // 2. Pièces : polygone, surface, équipements, rôle.
  const travaux: Travail[] = plan.rooms.map((r) => {
    let polygon = r.polygon.map((p) => [p[0], p[1]] as Vec2);
    if (signedArea(polygon) < 0) {
      polygon = polygon.reverse();
      assumptions.push(`pièce ${r.id} : polygone fourni en sens horaire, réorienté en anti-horaire`);
    }
    const fixtures = plan.fixtures.filter((f) => f.roomId === r.id).map((f) => ({ ...f, position: [f.position[0], f.position[1]] as Vec2, ...(f.size ? { size: { ...f.size } } : {}) }));
    const hasWater = fixtures.some((f) => EQUIPEMENTS_EAU.includes(f.kind));
    const ouv = geoValides.filter((g) => g.opening.connects.includes(r.id));
    let role: RoomRole, roleSource: AnalyzedRoom['roleSource'], roleConfidence: number;
    if (r.declaredRole !== null) { role = r.declaredRole; roleSource = 'declare'; roleConfidence = 1; }
    else {
      const bb = bbox(polygon), w = bb.max[0] - bb.min[0], h = bb.max[1] - bb.min[1];
      const ded = deduireRole({
        ...(r.name !== undefined ? { name: r.name } : {}),
        area: aireAbs(polygon), hasWater,
        nbPassages: ouv.filter((g) => PASSAGES.has(g.opening.kind)).length,
        nbFenetres: ouv.filter((g) => VITRAGES.has(g.opening.kind)).length,
        porteSurExterieur: ouv.some((g) => g.opening.kind === 'door' && g.opening.connects.includes(null)),
        elongation: Math.max(w, h) / Math.max(Math.min(w, h), 1e-6),
      });
      role = ded.role; roleSource = 'deduit'; roleConfidence = ded.confidence;
      assumptions.push(`pièce ${r.id} : rôle non déclaré, déduit « ${role} » (${ded.raison} ; confiance ${ded.confidence})`);
    }
    return { input: r, polygon, area: aireAbs(polygon), fixtures, hasWater, role, roleSource, roleConfidence };
  });
  const travailById = new Map(travaux.map((t) => [t.input.id, t]));

  // 3. Sens d'ouverture des battants (déclaré ou supposé).
  const debattements: SwingZone[] = [];
  for (const g of geoValides) {
    const o = g.opening;
    if (!BATTANTS.has(o.kind) || o.swing === null) continue;
    let into: string | null, hinge: 'a' | 'b';
    if (o.swing !== undefined) { into = o.swing.into; hinge = o.swing.hinge; }
    else {
      const relies = o.connects.filter((c): c is string => c !== null && travailById.has(c)).map((c) => travailById.get(c)!);
      const horsCirc = relies.filter((t) => ZONE_PAR_ROLE[t.role] !== 'circulation' && ZONE_PAR_ROLE[t.role] !== 'exterieur');
      const candidats = horsCirc.length ? horsCirc : relies.filter((t) => ZONE_PAR_ROLE[t.role] !== 'exterieur');
      const choix = [...candidats].sort((a, b) => b.area - a.area || (a.input.id < b.input.id ? -1 : 1))[0];
      if (!choix) { missing.push(`ouverture ${o.id} : sens d'ouverture inconnu et aucune pièce desservie exploitable`); continue; }
      into = choix.input.id; hinge = 'a';
      assumptions.push(`ouverture ${o.id} : sens d'ouverture absent, supposé vers ${into} (plus grande pièce desservie hors circulation), charnière côté a`);
    }
    if (into === null) continue; // s'ouvre vers le palier / l'extérieur : rien à réserver dans le logement
    const t = travailById.get(into);
    if (!t || !o.connects.includes(into)) { missing.push(`ouverture ${o.id} : s'ouvre vers ${into}, pièce non reliée par cette ouverture`); continue; }
    const n = normaleVers(t, g.p0, g.p1);
    if (!n) { missing.push(`ouverture ${o.id} : non située en bord de la pièce ${into}`); continue; }
    const [h, e] = hinge === 'a' ? [g.p0, g.p1] : [g.p1, g.p0];
    debattements.push({ openingId: o.id, roomId: into, polygon: secteur(h, e, n, o.width) });
  }

  // 4. Assemblage par pièce.
  const rooms: AnalyzedRoom[] = travaux.map((t) => {
    const r = t.input;
    const swingZones = debattements.filter((z) => z.roomId === r.id);
    const ouv = geoValides.filter((g) => g.opening.connects.includes(r.id));
    const windows = ouv.filter((g) => VITRAGES.has(g.opening.kind))
      .map((g) => ({ openingId: g.opening.id, a: v4(g.p0), b: v4(g.p1), sillHeight: g.opening.sillHeight ?? null }));
    const doors = ouv.filter((g) => PASSAGES.has(g.opening.kind)).map((g) => {
      const [c0, c1] = g.opening.connects;
      return { openingId: g.opening.id, a: v4(g.p0), b: v4(g.p1), to: c0 === r.id ? c1 : c0 };
    });
    const { runs, nonCouvert } = wallRunsDe(t, plan.walls, geoValides, swingZones);
    if (nonCouvert > 0.01) missing.push(`pièce ${r.id} : ${r4(nonCouvert)} m de contour sans mur renseigné`);
    if (ROLES_HUMIDES.includes(t.role) && !t.hasWater) missing.push(`pièce ${r.id} (${t.role}) : aucun point d'eau renseigné`);
    const bb = bbox(t.polygon);
    return {
      id: r.id, role: t.role, roleSource: t.roleSource, roleConfidence: t.roleConfidence,
      area: r4(t.area), polygon: t.polygon.map(v4), bbox: { min: v4(bb.min), max: v4(bb.max) },
      wallRuns: runs, swingZones, windows, doors, fixtures: t.fixtures, hasWater: t.hasWater, zone: ZONE_PAR_ROLE[t.role],
    };
  });

  // 5. Adjacences (passages uniquement ; les fenêtres ne relient pas de pièces).
  const adjacency: PlanAnalysis['adjacency'] = [];
  for (const g of geoValides) {
    if (!PASSAGES.has(g.opening.kind)) continue;
    const [c0, c1] = g.opening.connects;
    if (c0 === null && c1 === null) { missing.push(`ouverture ${g.opening.id} : ne relie aucune pièce`); continue; }
    adjacency.push(c0 !== null ? { a: c0, b: c1, viaOpening: g.opening.id } : { a: c1!, b: null, viaOpening: g.opening.id });
  }

  const totalArea = round(travaux.filter((t) => t.role !== 'exterieur').reduce((s, t) => s + t.area, 0), 2);
  return { planId: plan.id, rooms, adjacency, totalArea, missing, assumptions };
}

// ───────────────────────────── Portions de murs utilisables ─────────────────────────────

function wallRunsDe(t: Travail, walls: Wall[], ouvertures: OuvertureGeo[], zones: SwingZone[]): { runs: WallRun[]; nonCouvert: number } {
  const runs: WallRun[] = [];
  let nonCouvert = 0;
  const P = t.polygon;
  const mursNiveau = walls.filter((w) => murDuNiveau(w, t.input.level));
  for (let i = 0; i < P.length; i++) {
    const p = P[i]!, q = P[(i + 1) % P.length]!;
    const L = len(sub(q, p));
    if (L < 1e-9) continue;
    const d = normalize(sub(q, p));
    const n: Vec2 = [-d[1], d[0]]; // anti-horaire => intérieur à gauche
    const proj = (x: Vec2) => dot(sub(x, p), d);

    // Débattements : étendue (le long de l'arête) de leur intersection avec la bande intérieure.
    const coupesDebattement: Interval[] = [];
    for (const z of zones) {
      let c = clipPolygonHalfPlane(z.polygon, [-n[0], -n[1]], -dot(n, p) + 1e-9);
      c = clipPolygonHalfPlane(c, n, dot(n, p) + PROFONDEUR_BANDE_DEBATTEMENT);
      if (c.length < 3 || aireAbs(c) < 1e-4) continue;
      const ts = c.map(proj);
      coupesDebattement.push([Math.min(...ts), Math.max(...ts)]);
    }

    const couverts: Interval[] = [];
    const murs = mursNiveau
      .filter((w) => Math.abs(cross(normalize(sub(w.b, w.a)), d)) < 1e-6 && Math.abs(cross(sub(w.a, p), d)) <= TOL_COLINEAIRE)
      .map((w) => {
        const ta = proj(w.a), tb = proj(w.b);
        return { w, lo: Math.max(0, Math.min(ta, tb)), hi: Math.min(L, Math.max(ta, tb)) };
      })
      .filter((m) => m.hi - m.lo > 1e-6)
      .sort((x, y) => x.lo - y.lo || parId(x.w, y.w));
    for (const { w, lo, hi } of murs) {
      couverts.push([lo, hi]);
      const coupes: Interval[] = [...coupesDebattement];
      for (const g of ouvertures) if (g.wall.id === w.id) { const a = proj(g.p0), b = proj(g.p1); coupes.push([Math.min(a, b), Math.max(a, b)]); }
      for (const [s, e] of subtractIntervals([lo, hi], coupes)) {
        if (e - s < LONGUEUR_MIN_WALLRUN - 1e-9) continue;
        runs.push({ roomId: t.input.id, wallId: w.id, a: v4(at(p, d, s)), b: v4(at(p, d, e)), length: r4(e - s), inwardNormal: unit6(n) });
      }
    }
    for (const [s, e] of subtractIntervals([0, L], couverts)) nonCouvert += e - s;
  }
  return { runs, nonCouvert };
}
