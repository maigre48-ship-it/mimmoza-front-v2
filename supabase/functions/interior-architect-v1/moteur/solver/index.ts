/**
 * LOT INT-05 / INT-05b — Solveur d'implantation (convergence : zones fonctionnelles, alignements, PMR).
 *
 * `solveLayout({ plan, analysis, programs, seed, variant, brief })` place le mobilier de chaque `RoomProgram`
 * dans sa pièce. PUR et DÉTERMINISTE : seul aléa = `rng(seed ^ hash(variant))` (src/geometry), utilisé
 * pour un léger bruit de score qui produit des variantes ; même graine + même variante ⇒ même JSON.
 * Les cloisons ne bougent jamais ; un meuble ne quitte jamais sa pièce.
 *
 * ─────────────────────────── Stratégie ───────────────────────────
 * Pièce par pièce (ordre de `analysis.rooms`), items triés par priorité (obligatoire > souhaité >
 * optionnel), puis rang de catégorie (RANG_CATEGORIE : cuisine, sanitaires, lit ; canapé ; reste),
 * puis emprise décroissante. Les SATELLITES sont placés AVEC leur hôte (un emplacement d'hôte n'est retenu
 * que si ses satellites obligatoires tiennent) — c'est ainsi que sont construites les ZONES fonctionnelles :
 *  - coin nuit : lit → chevets accolés de part et d'autre de la tête de lit (dos au même mur) ;
 *  - coin repas : table → une chaise par couvert, grands côtés d'abord (2 = face à face, 4 = 2 + 2,
 *    6 = 3 + 3, 8 = 3 + 3 + 1 + 1), bouts en dernier recours ;
 *  - poste de travail : bureau → chaise centrée devant le plan ;
 *  - cuisine : linéaire → réfrigérateur, lave-vaisselle et lave-linge de la pièce CONTIGUS (même mur ou
 *    retour d'angle) ;
 *  - salon : canapé → meuble TV en vis-à-vis (devants opposés, axe dégagé, 1,80–3,50 m entre faces,
 *    décalage latéral ≤ 0,50 m) et table basse centrée devant lui ; fauteuils, lampadaire et tapis sont
 *    ensuite générés autour de la zone salon (tapis centré sous la table basse) ;
 *  - salon « dos au vide » : à défaut de murs face à face à bonne distance, canapé flottant tourné vers un
 *    mur pouvant recevoir le meuble TV (candidats entrelacés avec les candidats adossés) ;
 *  - l'axe canapé ↔ meuble TV est RÉSERVÉ au salon (table, chaises, rangements interdits dedans).
 *
 * Recherche : une pièce de jour avec coin repas est résolue salon d'abord, puis repas d'abord si le premier
 * résultat laisse un défaut structurant (obligatoire non placé, perte grave, zone incomplète) ;
 * une pièce de moins de 15 m² encore incomplète ou dégradée (perte de fonction) est reprise avec des
 * permutations bornées de l'ordre de ses hôtes obligatoires (MAX_PERMUTATIONS, moitié au-delà de 9 m²) ; un
 * élément retiré par le repositionnement borné doit être replacé sans perte de fonction. Le meilleur résultat est retenu selon la clé : obligatoires non
 * placés, pertes graves (fonction, couchage, catégorie, couverts < occupants), zones incomplètes (hôte sans
 * ses satellites), pertes mineures (place de canapé), non placés, réparations. Un hôte obligatoire à
 * satellites obligatoires n'est posé seul qu'après échec du repositionnement borné. Les essais d'un hôte sont
 * diversifiés après DIVERSIFIER_APRES échecs (positions voisines à ±0,15 m écartées).
 *
 * Candidats (rotations 0/90/180/270 uniquement, coordonnées arrondies au 0,1 mm) :
 *  - adossement : le long des « lignes de mur » (arêtes axiales du polygone moins les baies de porte,
 *    fusionnées avec les fenêtres basses de la même arête), dos au mur, devant = normale intérieure, pas de
 *    0,05 m + positions calées aux extrémités ;
 *  - libre / centre_piece : grille de 0,10 m (+ positions calées contre les bords) ;
 *  - symétrie (`Placement.mirrored`, INT-05b) : un meuble à dégagements latéraux asymétriques (lit 1 place,
 *    côté sans dégagement contre le mur) est essayé dans les deux sens ;
 *  - associations : satellites et éléments de zone (ci-dessus).
 *
 * Faisabilité DURE (aucun placement illégal n'est jamais émis) :
 *  F1 emprise dans le polygone ; F2 aucune collision d'emprises (les tapis seuls peuvent chevaucher) ;
 *  F3 aucune emprise sur une fixture dimensionnée (tapis compris, USA-01) ; F4 aucun chevauchement des
 *  swingZones ; F6 fenêtres : bande de 0,40 m (0,90 m devant une porte-fenêtre) — interdit si porte-fenêtre,
 *  si !allowedUnderWindow ou si hauteur > allège (USA-06) ; F7 dégagements effectifs (spec, permutés si
 *  `mirrored`) dans la pièce et libres de tout obstacle, et réciproquement ; dos des chaises libre sur 0,30 m ;
 *  devant des éléments de cuisine fixes hors débattement (USA-04) ; F8 distances techniques : radiateur
 *  ≥ 0,30 m (TEC-01), zone libre de 0,70 m devant le tableau électrique (TEC-02, zone_avant), chaudière
 *  ≥ 0,60 m (TEC-03) ; eau ≤ 3,0 / 1,0 / 2,5 m (TEC-05..07) ; F9 passages (grille 0,05 m) : portes reliées à
 *  0,90 m (CIR-01) ; dans les pièces principales, portes + devants d'usage reliés à 0,70 m (CIR-02 ; les
 *  satellites — chevets, chaises — ne sont pas des cibles, D18) ; ailleurs 0,55 m (hypothèse Mimmoza).
 *  F10 PMR (art. 13 de l'arrêté du 24 décembre 2015) traité en contraintes DURES quand les règles
 *  s'appliquent — lecture « a » (maison neuve : seuls les éléments non mobiles comptent) ou « b » (brief pmr :
 *  tout meuble compte, tapis exceptés), pièces du niveau d'accès (unité de vie) :
 *   - cuisine : 1,50 m libres devant chaque équipement fixe (CIR-04), débattement toléré sur 0,25 m ;
 *   - chambre désignée (la plus grande) : passages 0,90 m sur les grands côtés + 1,20 m au pied du lit, ou
 *     1,20 m + 0,90 m (CIR-07) et cercle Ø 1,50 m hors lit et hors débattement (CIR-05) ;
 *   - salle d'eau désignée (la plus grande) : cercle Ø 1,50 m hors débattement (CIR-06) ;
 *   - WC désigné (pièce WC d'abord) : espace latéral 0,80 × 1,30 m hors débattement (USA-14).
 *  Les zones exigées deviennent des RÉSERVES : aucun meuble non toléré par la règle n'y est posé ensuite.
 *  Les cercles sont vérifiés après chaque pose dans la pièce (marge de 3 cm : grilles décalées du critique).
 *  Si la contrainte PMR est impossible dans la pièce désignée, elle est levée par paliers (le cercle d'abord,
 *  qu'une autre pièce peut porter, puis les zones) et c'est consigné (`pmr_impossible`).
 *
 * Scoring (points, plus = mieux ; documenté dans `scoreCandidat`).
 *
 * Réparation : replis (fallbacks) conservant les fonctions (avec satellites), hôte seul, replis perdant une
 * fonction ; si un item OBLIGATOIRE ne tient toujours pas → backtracking borné (MAX_BACKTRACK hôtes) ;
 * échec ⇒ état restauré, item dans `unplaced` avec une raison chiffrée (compte des rejets par contrainte).
 */
import type { AnalyzedRoom, Clearances, FurnitureSpec, InteriorBrief, LayoutPlan, Placement, PlanAnalysis, PlanInput, Repair, RoomProgram, Vec2 } from '../types';
import { getSpec } from '../data/catalog';
import { FURNITURE_CATEGORIES } from '../data/schemas';
import { area, centroid, clipPolygonHalfPlane, distPointSegment, frontDir, pointInPolygon, rectInPolygon, rectsOverlap, rng, round, zoneAvant, type Rect } from '../geometry';

// ───────────────────────────── Constantes ─────────────────────────────

export const PAS_MUR = 0.05;
export const PAS_GRILLE_LIBRE = 0.1;
export const PAS_GRILLE_PASSAGE = 0.05;
export const PASSAGE_PORTES = 0.9;
export const PASSAGE_USAGES_PRINCIPALES = 0.7;
export const PASSAGE_USAGES_SERVICE = 0.55;
export const TOL_DEBATTEMENT = 0.005;
export const MAX_ESSAIS_COUTEUX = 60;
export const MAX_BACKTRACK = 4;
export const BRUIT_VARIANTE = 1.5;
/** Nombre d'échecs de satellites (positions voisines) avant de diversifier les essais d'un hôte. */
export const DIVERSIFIER_APRES = 8;
/** Rayon du cercle PMR (Ø 1,50 m) + marge : la grille du critique est décalée d'un demi-pas (D2). */
export const RAYON_CERCLE_PMR = 0.75 + 0.03;
/** Distance de vision canapé ↔ TV (faces avant, ECH-07) et décalage latéral admis (ORG-12). */
export const TV_MIN = 1.8, TV_MAX = 3.5, TV_DECALAGE_MAX = 0.5;

const PIECES_PRINCIPALES = new Set(['sejour', 'sejour_cuisine', 'cuisine', 'chambre', 'chambre_parentale', 'bureau']);
/** Catégories non contrôlées / non obstacles pour les dégagements (USA-02). */
const NON_OBSTACLES = new Set(['tapis', 'chaise', 'chaise_bureau', 'chevet', 'banc']);
/** Satellites : atteints depuis leur meuble parent, jamais cibles de passage (CHECKS.md D18). */
const SATELLITES = new Set(['chevet', 'chaise', 'chaise_bureau']);
const CHAISES = new Set(['chaise', 'chaise_bureau']);
const CUISINE_FIXE = new Set(['cuisine_lineaire', 'ilot', 'refrigerateur', 'lave_vaisselle']);
const SANITAIRES = new Set(['wc', 'douche', 'baignoire', 'meuble_vasque', 'lave_mains', 'lave_linge']);
/** Mobilier mobile (lecture « a » de l'art. 13, identique à MOBILIER_MOBILE de src/data/rules.ts). */
const MOBILIER_MOBILE = new Set([
  'chevet', 'armoire', 'commode', 'canape', 'fauteuil', 'table_basse', 'meuble_tv', 'table_repas', 'chaise',
  'bureau', 'chaise_bureau', 'bibliotheque', 'meuble_entree', 'banc', 'tapis', 'luminaire_sol', 'plante', 'dressing',
]);
const TEC01 = new Set(['canape', 'armoire', 'dressing', 'bibliotheque', 'commode', 'lit', 'meuble_tv', 'meuble_entree', 'refrigerateur']);
const TEC02 = new Set(['armoire', 'dressing', 'bibliotheque', 'meuble_entree', 'commode', 'refrigerateur', 'lave_linge', 'canape', 'lit', 'table_repas', 'bureau', 'cuisine_lineaire']);
const TEC03 = new Set(['armoire', 'dressing', 'bibliotheque', 'refrigerateur', 'lave_linge', 'commode', 'meuble_entree']);
/** Meubles admis dans l'axe canapé ↔ meuble TV (zone salon réservée). */
const SALON = new Set(['tapis', 'table_basse', 'fauteuil', 'luminaire_sol', 'plante', 'canape', 'meuble_tv']);
/** Toutes catégories tolérées : zone contrôlée seulement vis-à-vis des parois, fixtures et débattements. */
const TOUTES = new Set<string>(FURNITURE_CATEGORIES);
const ROT: Placement['rotationDeg'][] = [0, 90, 180, 270];
const PRIO = { obligatoire: 0, souhaite: 1, optionnel: 2 } as const;
const r4 = (x: number) => round(x, 4) + 0;

// ───────────────────────────── Géométrie locale ─────────────────────────────

const rectDist = (a: Rect, b: Rect) => Math.hypot(Math.max(0, a.minX - b.maxX, b.minX - a.maxX), Math.max(0, a.minY - b.maxY, b.minY - a.maxY));
const ptRectDist = (p: Vec2, r: Rect) => Math.hypot(Math.max(0, r.minX - p[0], p[0] - r.maxX), Math.max(0, r.minY - p[1], p[1] - r.maxY));
const centre = (r: Rect): Vec2 => [(r.minX + r.maxX) / 2, (r.minY + r.maxY) / 2];
const d2 = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const bboxPoly = (p: Vec2[]): Rect => ({ minX: Math.min(...p.map((v) => v[0])), maxX: Math.max(...p.map((v) => v[0])), minY: Math.min(...p.map((v) => v[1])), maxY: Math.max(...p.map((v) => v[1])) });

/** Aire d'intersection polygone convexe ∩ rectangle. */
export function aireInterRect(poly: Vec2[], r: Rect): number {
  let c = clipPolygonHalfPlane(poly, [1, 0], r.maxX);
  c = clipPolygonHalfPlane(c, [-1, 0], -r.minX);
  c = clipPolygonHalfPlane(c, [0, 1], r.maxY);
  c = clipPolygonHalfPlane(c, [0, -1], -r.minY);
  return c.length < 3 ? 0 : area(c);
}

function rotSize(s: FurnitureSpec, rot: Placement['rotationDeg']) { return rot === 90 || rot === 270 ? { w: s.size.d, d: s.size.w } : { w: s.size.w, d: s.size.d }; }
function fpOf(c: Vec2, s: FurnitureSpec, rot: Placement['rotationDeg']): Rect {
  const { w, d } = rotSize(s, rot);
  return { minX: c[0] - w / 2, minY: c[1] - d / 2, maxX: c[0] + w / 2, maxY: c[1] + d / 2 };
}
/** Bande collée à un côté de l'emprise, dans la direction monde `dir` (axe), profondeur `d`. */
function bande(f: Rect, dir: Vec2, d: number): Rect {
  if (dir[0] > 0.5) return { minX: f.maxX, maxX: f.maxX + d, minY: f.minY, maxY: f.maxY };
  if (dir[0] < -0.5) return { minX: f.minX - d, maxX: f.minX, minY: f.minY, maxY: f.maxY };
  if (dir[1] > 0.5) return { minX: f.minX, maxX: f.maxX, minY: f.maxY, maxY: f.maxY + d };
  return { minX: f.minX, maxX: f.maxX, minY: f.minY - d, maxY: f.minY };
}
const rightOf = (f: Vec2): Vec2 => [f[1], -f[0]];
const leftOf = (f: Vec2): Vec2 => [-f[1], f[0]];
const neg = (v: Vec2): Vec2 => [-v[0], -v[1]];
function rotPour(front: Vec2): Placement['rotationDeg'] | null {
  for (const r of ROT) { const f = frontDir(r); if (Math.abs(f[0] - front[0]) < 1e-6 && Math.abs(f[1] - front[1]) < 1e-6) return r; }
  return null;
}
const asymetrique = (s: FurnitureSpec) => Math.abs(s.clearances.left - s.clearances.right) > 1e-9;
const clrEff = (s: FurnitureSpec, mirrored: boolean): Clearances => (mirrored ? { ...s.clearances, left: s.clearances.right, right: s.clearances.left } : s.clearances);
/** Bandes de dégagement (devant, derrière, gauche, droite) d'un meuble, dégagements effectifs `c`. */
function bandes(f: Rect, c: Clearances, rot: Placement['rotationDeg']) {
  const fr = frontDir(rot);
  const out: Array<{ cote: 'devant' | 'derriere' | 'gauche' | 'droite'; r: Rect }> = [];
  if (c.front > 0) out.push({ cote: 'devant', r: bande(f, fr, c.front) });
  if (c.back > 0) out.push({ cote: 'derriere', r: bande(f, neg(fr), c.back) });
  if (c.left > 0) out.push({ cote: 'gauche', r: bande(f, leftOf(fr), c.left) });
  if (c.right > 0) out.push({ cote: 'droite', r: bande(f, rightOf(fr), c.right) });
  return out;
}
/** Milieu du bord avant d'une emprise orientée. */
const milieuAvant = (f: Rect, rot: Placement['rotationDeg']) => centre(bande(f, frontDir(rot), 0));

// ───────────────────────────── PMR (art. 13) ─────────────────────────────

/** Lecture des règles art. 13 appliquées : « a » maison neuve (plan livré), « b » occupant PMR (meublé). */
type LecturePMR = 'a' | 'b';
interface PlanPMR {
  lecture: LecturePMR;
  cuisines: Set<string>;
  chambre: string | null;
  bain: string | null;
  wc: string | null;
  /** Pièces où un cercle Ø 1,50 m est exigé, avec les catégories ignorées. */
  cercles: Map<string, Set<string>>;
}
/** Catégories tolérées dans une zone PMR réservée selon la lecture (et le cas). */
function tolerees(lecture: LecturePMR, extra: string[] = []): Set<string> {
  return lecture === 'b' ? new Set(['tapis', ...extra]) : new Set([...MOBILIER_MOBILE, ...extra]);
}

function planPMR(plan: PlanInput, analysis: PlanAnalysis, programs: RoomProgram[], brief?: InteriorBrief): PlanPMR | null {
  const lecture: LecturePMR | null = brief?.constraints.pmr ? 'b' : plan.construction === 'neuf' && plan.kind === 'maison' ? 'a' : null;
  if (!lecture) return null;
  const niveau = new Map(plan.rooms.map((r) => [r.id, r.level]));
  const acces = Math.min(...plan.rooms.map((r) => r.level));
  const udv = analysis.rooms.filter((r) => (niveau.get(r.id) ?? acces) === acces);
  const plusGrande = (rs: AnalyzedRoom[]) => [...rs].sort((a, b) => b.area - a.area || (a.id < b.id ? -1 : 1))[0]?.id ?? null;
  const chambres = udv.filter((r) => r.role === 'chambre' || r.role === 'chambre_parentale');
  const bains = udv.filter((r) => r.role === 'salle_de_bain' || r.role === 'salle_d_eau');
  const aWc = (r: AnalyzedRoom) => programs.find((p) => p.roomId === r.id)?.items.some((i) => getSpec(i.specId)?.category === 'wc') ?? false;
  const wcs = [...udv.filter((r) => r.role === 'wc' && aWc(r)), ...bains.filter(aWc)];
  const chambre = plusGrande(chambres) ?? plusGrande(udv.filter((r) => r.role === 'sejour' || r.role === 'sejour_cuisine'));
  const bain = plusGrande(bains);
  const cercles = new Map<string, Set<string>>();
  // CIR-05 : « a » → seuls le lit et les parois ; « b » → tout sauf tapis. CIR-06 : « a » → mobilier mobile ignoré.
  if (chambre) cercles.set(chambre, tolerees(lecture));
  if (bain) cercles.set(bain, tolerees(lecture));
  return {
    lecture, chambre, bain, cercles,
    cuisines: new Set(udv.filter((r) => r.role === 'cuisine' || r.role === 'sejour_cuisine').map((r) => r.id)),
    wc: wcs[0]?.id ?? null,
  };
}

/** Zone exigée par une règle PMR pour un candidat : à garder libre maintenant ET réservée ensuite. */
interface Zone { r: Rect; tol: Set<string>; swing: 'interdit' | 'tolere_025' | 'ignore'; regle: string }

// ───────────────────────────── Contexte de pièce ─────────────────────────────

interface Ligne { normal: Vec2; axe: 'x' | 'y'; coord: number; lo: number; hi: number; runs: Array<{ idx: number; lo: number; hi: number }>; mur: boolean }
interface Fenetre { rect: Rect; kind: string; sill: number | null; mid: Vec2; normal: Vec2 }
interface Porte { mid: Vec2; n: Vec2; a: Vec2; b: Vec2; vue: Rect; versCuisine: boolean }
interface Grille { x0: number; y0: number; nx: number; ny: number; inside: Uint8Array; edge: Float64Array; champ: Float64Array; pass: Uint8Array; comp: Int32Array; swing: Float64Array }

interface RoomCtx {
  room: AnalyzedRoom;
  poly: Vec2[];
  bb: Rect;
  lignes: Ligne[];
  fenetres: Fenetre[];
  portes: Porte[];
  fixRects: Rect[];
  swingBoxes: Rect[];
  eau: { tout: Array<Vec2 | Rect>; wc: Array<Vec2 | Rect> };
  radiateurs: Array<Vec2 | Rect>; zonesTableau: Rect[]; chaudieres: Array<Vec2 | Rect>;
  grille: Grille;
  principale: boolean;
  estRect: boolean;
  exclues09: Set<number>; excluesW: Set<number>; passagePortes09: boolean;
  constats: string[];
  pmr: PlanPMR | null;
  /** Cercle Ø 1,50 m exigé dans la pièce : catégories ignorées. */
  cercle: Set<string> | null;
}

/** Distance d'un point intérieur au premier bord du polygone dans la direction axiale `f`. */
function distanceRayon(poly: Vec2[], m: Vec2, f: Vec2): number {
  let best = Infinity;
  for (let e = 0; e < poly.length; e++) {
    const a = poly[e]!, b = poly[(e + 1) % poly.length]!;
    if (Math.abs(f[0]) > 0.5) {
      if (Math.abs(a[0] - b[0]) > 1e-9) continue;
      const t = (a[0] - m[0]) * f[0];
      if (t > 1e-6 && m[1] >= Math.min(a[1], b[1]) - 1e-9 && m[1] <= Math.max(a[1], b[1]) + 1e-9) best = Math.min(best, t);
    } else {
      if (Math.abs(a[1] - b[1]) > 1e-9) continue;
      const t = (a[1] - m[1]) * f[1];
      if (t > 1e-6 && m[0] >= Math.min(a[0], b[0]) - 1e-9 && m[0] <= Math.max(a[0], b[0]) + 1e-9) best = Math.min(best, t);
    }
  }
  return best;
}

function normaleInterieure(poly: Vec2[], a: Vec2, b: Vec2): Vec2 | null {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
  if (L < 1e-9) return null;
  const n: Vec2 = [-dy / L, dx / L], m: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const p = pointInPolygon([m[0] + n[0] * 0.05, m[1] + n[1] * 0.05], poly), q = pointInPolygon([m[0] - n[0] * 0.05, m[1] - n[1] * 0.05], poly);
  if (p && !q) return [r4(n[0]), r4(n[1])];
  if (q && !p) return [r4(-n[0]), r4(-n[1])];
  return null;
}
const fixGeo = (f: { position: Vec2; size?: { w: number; d: number } }): Vec2 | Rect =>
  f.size ? { minX: f.position[0] - f.size.w / 2, maxX: f.position[0] + f.size.w / 2, minY: f.position[1] - f.size.d / 2, maxY: f.position[1] + f.size.d / 2 } : f.position;
const distGeo = (r: Rect, g: Vec2 | Rect) => (Array.isArray(g) ? ptRectDist(g, r) : rectDist(r, g));

function construireCtx(plan: PlanInput, analysis: PlanAnalysis, room: AnalyzedRoom, pmr: PlanPMR | null): RoomCtx {
  const poly = room.polygon;
  const bb: Rect = { minX: room.bbox.min[0], minY: room.bbox.min[1], maxX: room.bbox.max[0], maxY: room.bbox.max[1] };
  const kindOf = new Map(plan.openings.map((o) => [o.id, o.kind]));
  const roleOf = new Map(analysis.rooms.map((r) => [r.id, r.role]));
  type Seg = { normal: Vec2; axe: 'x' | 'y'; coord: number; lo: number; hi: number; idx: number };
  const segs: Seg[] = [];
  // INT-05b : lignes d'adossement = arêtes axiales du polygone moins les baies de porte (idx −2). Les wallRuns de
  // l'analyse (idx ≥ 0) écartent une bande de 0,60 m autour des débattements, trop prudente pour un meuble peu
  // profond : le débattement est de toute façon contrôlé exactement sur l'emprise (F4).
  for (let e = 0; e < poly.length; e++) {
    const a = poly[e]!, b = poly[(e + 1) % poly.length]!;
    const n = normaleInterieure(poly, a, b); if (!n) continue;
    const vert = Math.abs(a[0] - b[0]) < 1e-9, horiz = Math.abs(a[1] - b[1]) < 1e-9;
    if (!vert && !horiz) continue;
    const axe: 'x' | 'y' = horiz ? 'x' : 'y', coord = horiz ? a[1] : a[0];
    const lo = horiz ? Math.min(a[0], b[0]) : Math.min(a[1], b[1]), hi = horiz ? Math.max(a[0], b[0]) : Math.max(a[1], b[1]);
    const baies: Array<[number, number]> = room.doors
      .filter((d) => (horiz ? Math.abs(d.a[1] - coord) < 1e-6 && Math.abs(d.b[1] - coord) < 1e-6 : Math.abs(d.a[0] - coord) < 1e-6 && Math.abs(d.b[0] - coord) < 1e-6))
      .map((d) => (horiz ? [Math.min(d.a[0], d.b[0]), Math.max(d.a[0], d.b[0])] : [Math.min(d.a[1], d.b[1]), Math.max(d.a[1], d.b[1])]));
    let x = lo;
    for (const [s0, s1] of [...baies, [hi, hi] as [number, number]].sort((u, v) => u[0] - v[0])) {
      if (s0 - x > 0.3 - 1e-9) segs.push({ normal: [Math.sign(n[0]) + 0, Math.sign(n[1]) + 0], axe, coord, lo: x, hi: Math.min(s0, hi), idx: -2 });
      x = Math.max(x, s1);
    }
  }
  room.wallRuns.forEach((w, idx) => {
    const n = w.inwardNormal;
    if (Math.abs(n[0]) > 0.999) segs.push({ normal: [Math.sign(n[0]), 0], axe: 'y', coord: w.a[0], lo: Math.min(w.a[1], w.b[1]), hi: Math.max(w.a[1], w.b[1]), idx });
    else if (Math.abs(n[1]) > 0.999) segs.push({ normal: [0, Math.sign(n[1])], axe: 'x', coord: w.a[1], lo: Math.min(w.a[0], w.b[0]), hi: Math.max(w.a[0], w.b[0]), idx });
  });
  const fenetres: Fenetre[] = [];
  for (const w of room.windows) {
    const n = normaleInterieure(poly, w.a, w.b);
    if (!n) continue;
    const kind = kindOf.get(w.openingId) ?? 'window';
    const depth = kind === 'french_window' ? 0.9 : 0.4;
    const f: Rect = { minX: Math.min(w.a[0], w.b[0]), maxX: Math.max(w.a[0], w.b[0]), minY: Math.min(w.a[1], w.b[1]), maxY: Math.max(w.a[1], w.b[1]) };
    fenetres.push({ rect: bande(f, n, depth), kind, sill: w.sillHeight, mid: [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2], normal: n });
    if (kind === 'window' && (Math.abs(n[0]) > 0.999 || Math.abs(n[1]) > 0.999)) {
      const axe = Math.abs(n[0]) > 0.999 ? 'y' : 'x';
      segs.push({ normal: [Math.sign(n[0]) + 0, Math.sign(n[1]) + 0], axe, coord: axe === 'y' ? w.a[0] : w.a[1], lo: axe === 'y' ? f.minY : f.minX, hi: axe === 'y' ? f.maxY : f.maxX, idx: -1 });
    }
  }
  segs.sort((a, b) => a.axe.localeCompare(b.axe) || a.normal[0] - b.normal[0] || a.normal[1] - b.normal[1] || a.coord - b.coord || a.lo - b.lo);
  const lignes: Ligne[] = [];
  for (const s of segs) {
    const der = lignes[lignes.length - 1];
    if (der && der.axe === s.axe && der.normal[0] === s.normal[0] && der.normal[1] === s.normal[1] && Math.abs(der.coord - s.coord) < 1e-3 && s.lo <= der.hi + 1e-3) {
      der.hi = Math.max(der.hi, s.hi);
      if (s.idx >= 0) der.runs.push({ idx: s.idx, lo: s.lo, hi: s.hi });
      if (s.idx !== -1) der.mur = true;
    } else lignes.push({ normal: s.normal, axe: s.axe, coord: s.coord, lo: s.lo, hi: s.hi, runs: s.idx >= 0 ? [{ idx: s.idx, lo: s.lo, hi: s.hi }] : [], mur: s.idx !== -1 });
  }
  const portes: Porte[] = [];
  for (const d of room.doors) {
    const n = normaleInterieure(poly, d.a, d.b);
    if (!n) continue;
    const seg: Rect = { minX: Math.min(d.a[0], d.b[0]), maxX: Math.max(d.a[0], d.b[0]), minY: Math.min(d.a[1], d.b[1]), maxY: Math.max(d.a[1], d.b[1]) };
    const autre = d.to === null ? null : roleOf.get(d.to);
    portes.push({ mid: [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2], n, a: d.a, b: d.b, vue: bande(seg, n, 2.0), versCuisine: autre === 'cuisine' });
  }
  const fx = room.fixtures;
  const geos = (kinds: string[]) => fx.filter((f) => kinds.includes(f.kind)).map(fixGeo);
  const zonesTableau = fx.filter((f) => f.kind === 'tableau_electrique').map((f) => zoneAvant(poly, f, 0.7, 0.6)).filter((z): z is Rect => z !== null);
  const base: RoomCtx = {
    room, poly, bb, lignes: lignes.filter((l) => l.mur), fenetres, portes,
    fixRects: fx.filter((f) => f.size).map((f) => fixGeo(f) as Rect),
    swingBoxes: room.swingZones.map((z) => bboxPoly(z.polygon)),
    eau: { tout: geos(['gaine', 'evacuation', 'arrivee_eau']), wc: geos(['gaine', 'evacuation']) },
    radiateurs: geos(['radiateur']), zonesTableau, chaudieres: geos(['chaudiere']),
    grille: construireGrille(poly, bb, room.swingZones.map((z) => z.polygon)),
    principale: PIECES_PRINCIPALES.has(room.role),
    estRect: poly.length === 4 && Math.abs(area(poly) - (bb.maxX - bb.minX) * (bb.maxY - bb.minY)) < 1e-6,
    exclues09: new Set(), excluesW: new Set(), passagePortes09: true, constats: [],
    pmr, cercle: pmr?.cercles.get(room.id) ?? null,
  };
  const w = base.principale ? PASSAGE_USAGES_PRINCIPALES : PASSAGE_USAGES_SERVICE;
  portes.forEach((d, i) => {
    for (const [lw, set] of [[PASSAGE_PORTES, base.exclues09], [w, base.excluesW]] as const) {
      const c: Vec2 = [d.mid[0] + d.n[0] * lw / 2, d.mid[1] + d.n[1] * lw / 2];
      if (cibleAtteinte(base.grille, base.fixRects, lw, c) === null) {
        set.add(i);
        base.constats.push(`Pièce ${room.id} : porte ${room.doors[i]?.openingId ?? i} inaccessible par un passage de ${lw.toFixed(2).replace('.', ',')} m dès la pièce vide (équipements fixes / géométrie) : cible exclue du contrôle.`);
      }
    }
  });
  const c09 = portes.map((d, i) => [i, d] as const).filter(([i]) => !base.exclues09.has(i)).map(([, d]) => [d.mid[0] + d.n[0] * 0.45, d.mid[1] + d.n[1] * 0.45] as Vec2);
  if (c09.length >= 2 && !passageRelie(base.grille, base.fixRects, PASSAGE_PORTES, c09)) {
    base.passagePortes09 = false;
    base.constats.push(`Pièce ${room.id} : portes non reliables par un passage de 0,90 m dès la pièce vide : contrôle 0,90 m non applicable.`);
  }
  if (base.cercle && !cercleOk(base, [])) {
    base.constats.push(`Pièce ${room.id} : aucun cercle Ø 1,50 m possible dès la pièce vide (géométrie / débattement) : contrainte PMR non applicable.`);
    base.cercle = null;
  }
  return base;
}

function construireGrille(poly: Vec2[], bb: Rect, swings: Vec2[][]): Grille {
  const h = PAS_GRILLE_PASSAGE;
  // Points bbox.min + k·h (k ≥ 0), comme le critique (CHECKS.md D2) : un couloir de 0,90 m exact a un point sur son axe.
  const nx = Math.max(1, Math.floor((bb.maxX - bb.minX) / h + 1e-6) + 1), ny = Math.max(1, Math.floor((bb.maxY - bb.minY) / h + 1e-6) + 1);
  const inside = new Uint8Array(nx * ny), edge = new Float64Array(nx * ny), swing = new Float64Array(nx * ny).fill(Infinity);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const p: Vec2 = [bb.minX + i * h, bb.minY + j * h];
    const k = j * nx + i;
    if (!pointInPolygon(p, poly)) continue;
    inside[k] = 1;
    let m = Infinity;
    for (let e = 0; e < poly.length; e++) m = Math.min(m, distPointSegment(p, poly[e]!, poly[(e + 1) % poly.length]!));
    edge[k] = m;
    for (const z of swings) {
      let dz = pointInPolygon(p, z) ? 0 : Infinity;
      if (dz > 0) for (let e = 0; e < z.length; e++) dz = Math.min(dz, distPointSegment(p, z[e]!, z[(e + 1) % z.length]!));
      swing[k] = Math.min(swing[k]!, dz);
    }
  }
  return { x0: bb.minX, y0: bb.minY, nx, ny, inside, edge, swing, champ: new Float64Array(nx * ny), pass: new Uint8Array(nx * ny), comp: new Int32Array(nx * ny) };
}

/** Champ de distance aux obstacles (plafonné à `rmax`) sur la grille ; tampon réutilisé. */
function champObstacles(g: Grille, obstacles: Rect[], rmax: number): Float64Array {
  const h = PAS_GRILLE_PASSAGE, { nx, ny } = g, ch = g.champ;
  ch.fill(rmax);
  for (const o of obstacles) {
    const i0 = Math.max(0, Math.floor((o.minX - rmax - g.x0) / h)), i1 = Math.min(nx - 1, Math.ceil((o.maxX + rmax - g.x0) / h));
    const j0 = Math.max(0, Math.floor((o.minY - rmax - g.y0) / h)), j1 = Math.min(ny - 1, Math.ceil((o.maxY + rmax - g.y0) / h));
    for (let j = j0; j <= j1; j++) {
      const y = g.y0 + j * h, dy = Math.max(0, o.minY - y, y - o.maxY);
      for (let i = i0; i <= i1; i++) {
        const k = j * nx + i;
        if (!g.inside[k]) continue;
        const x = g.x0 + i * h, dx = Math.max(0, o.minX - x, x - o.maxX);
        const d = dx === 0 ? dy : dy === 0 ? dx : Math.sqrt(dx * dx + dy * dy);
        if (d < ch[k]!) ch[k] = d;
      }
    }
  }
  return ch;
}

/** Cible de passage : rectangle (point dégénéré pour une porte) et portée d'atteinte (CHECKS.md D3). */
interface Cible { r: Rect; portee: number }
const ciblePoint = (p: Vec2): Cible => ({ r: { minX: p[0], maxX: p[0], minY: p[1], maxY: p[1] }, portee: 0.1 });

/**
 * Les cibles sont-elles toutes reliées par un passage de largeur `w` ? Cellule passable : centre dans la
 * pièce, à ≥ w/2 des bords et de chaque obstacle ; une cible-porte est atteinte par une cellule passable à
 * ≤ 0,10 m, une zone d'usage (rectangle) à ≤ w/2 + 0,05 m (alignement sur le critique, D3) ; connexité 4-voisins.
 */
function relie(g: Grille, champ: Float64Array, w: number, cibles: Cible[]): boolean {
  if (!cibles.length) return true;
  const r = w / 2, { nx, ny } = g, pass = g.pass;
  for (let k = 0; k < nx * ny; k++) pass[k] = g.inside[k]! && g.edge[k]! >= r - 1e-9 && champ[k]! >= r - 1e-9 ? 1 : 0;
  const proches = cibles.map((c) => cellulesProches(g, pass, c));
  if (proches.some((p) => p.length === 0)) return false;
  if (cibles.length < 2) return true;
  const comp = g.comp;
  comp.fill(-1);
  let id = 0;
  const pile: number[] = [];
  for (const start of proches[0]!) {
    if (comp[start] !== -1) continue;
    pile.push(start); comp[start] = id;
    while (pile.length) {
      const k = pile.pop()!, i = k % nx, j = (k - i) / nx;
      if (i > 0 && pass[k - 1] && comp[k - 1] === -1) { comp[k - 1] = id; pile.push(k - 1); }
      if (i < nx - 1 && pass[k + 1] && comp[k + 1] === -1) { comp[k + 1] = id; pile.push(k + 1); }
      if (j > 0 && pass[k - nx] && comp[k - nx] === -1) { comp[k - nx] = id; pile.push(k - nx); }
      if (j < ny - 1 && pass[k + nx] && comp[k + nx] === -1) { comp[k + nx] = id; pile.push(k + nx); }
    }
    const cid = id++;
    if (proches.every((p) => p.some((k) => comp[k] === cid))) return true;
  }
  return false;
}

/** Variante autonome (obstacles quelconques, cibles ponctuelles). */
export function passageRelie(g: Grille, obstacles: Rect[], w: number, cibles: Vec2[]): boolean {
  return relie(g, champObstacles(g, obstacles, w / 2 + 0.01), w, cibles.map(ciblePoint));
}
function cellulesProches(g: Grille, pass: Uint8Array, c: Cible): number[] {
  const h = PAS_GRILLE_PASSAGE, out: number[] = [];
  const i0 = Math.max(0, Math.floor((c.r.minX - c.portee - g.x0) / h)), i1 = Math.min(g.nx - 1, Math.ceil((c.r.maxX + c.portee - g.x0) / h));
  const j0 = Math.max(0, Math.floor((c.r.minY - c.portee - g.y0) / h)), j1 = Math.min(g.ny - 1, Math.ceil((c.r.maxY + c.portee - g.y0) / h));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const k = j * g.nx + i;
    if (pass[k] && ptRectDist([g.x0 + i * h, g.y0 + j * h], c.r) <= c.portee + 1e-9) out.push(k);
  }
  return out;
}
function cibleAtteinte(g: Grille, obstacles: Rect[], w: number, c: Vec2): number | null {
  const r = w / 2, h = PAS_GRILLE_PASSAGE;
  const ic = Math.round((c[0] - g.x0) / h), jc = Math.round((c[1] - g.y0) / h);
  for (let j = jc - 3; j <= jc + 3; j++) for (let i = ic - 3; i <= ic + 3; i++) {
    if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) continue;
    const k = j * g.nx + i, p: Vec2 = [g.x0 + i * h, g.y0 + j * h];
    if (!g.inside[k] || g.edge[k]! < r - 1e-9 || d2(p, c) > 0.1 + 1e-9) continue;
    if (obstacles.every((o) => ptRectDist(p, o) >= r - 1e-9)) return k;
  }
  return null;
}

/** Existe-t-il un cercle libre (rayon RAYON_CERCLE_PMR) hors obstacles non ignorés, fixtures et débattements ? */
function cercleOk(rc: RoomCtx, poses: Pose[]): boolean {
  if (!rc.cercle) return true;
  const ign = rc.cercle, R = RAYON_CERCLE_PMR, g = rc.grille;
  const obs = [...poses.filter((p) => !ign.has(p.spec.category)).map((p) => p.fp), ...rc.fixRects];
  const ch = champObstacles(g, obs, R + 0.01);
  for (let k = 0; k < g.nx * g.ny; k++) if (g.inside[k] && g.edge[k]! >= R && ch[k]! >= R - 1e-9 && g.swing[k]! >= R) return true;
  return false;
}

// ───────────────────────────── État et faisabilité ─────────────────────────────

interface Pose { pl: Placement; spec: FurnitureSpec; fp: Rect; clr: Clearances; prio: number; itemIdx: number; host?: string; zones: Zone[] }
interface Cand { center: Vec2; rot: Placement['rotationDeg']; mirrored: boolean; runIdx: number | null; score: number; fp: Rect; assoc?: string; bonus?: number; zones?: Zone[]; ligne?: Ligne; famille?: 'flottant' }

type Rejet = 'hors_piece' | 'collision' | 'fixture' | 'debattement' | 'fenetre' | 'degagement' | 'distance_technique' | 'passage' | 'satellites' | 'role_ou_eau' | 'pmr' | 'axe_salon';
const LIBELLE_REJET: Record<Rejet, string> = {
  hors_piece: 'hors pièce', collision: 'collision', fixture: 'sur équipement fixe', debattement: 'dans un débattement',
  fenetre: 'devant une fenêtre', degagement: 'dégagement insuffisant', distance_technique: 'distance technique',
  passage: 'passage < seuil', satellites: 'satellites (chevets, chaises, TV, électroménager) impossibles', role_ou_eau: 'rôle ou eau',
  pmr: 'exigence PMR (art. 13) non tenue', axe_salon: 'dans l\'axe canapé ↔ TV',
};

function dansPiece(rc: RoomCtx, r: Rect): boolean {
  if (r.minX < rc.bb.minX - 1e-6 || r.maxX > rc.bb.maxX + 1e-6 || r.minY < rc.bb.minY - 1e-6 || r.maxY > rc.bb.maxY + 1e-6) return false;
  return rc.estRect || rectInPolygon(r, rc.poly);
}

const TOL_CHAISE = new Set(['tapis']);
const TOL_LIT = new Set(['tapis', 'chevet']);
/** Catégories admises dans les dégagements d'un meuble de catégorie `cat` (USA-02 / USA-03 / USA-05). */
function toleresDans(cat: string, cote: string): Set<string> {
  if (CHAISES.has(cat)) return TOL_CHAISE;
  if (cat === 'lit' && (cote === 'gauche' || cote === 'droite')) return TOL_LIT;
  return NON_OBSTACLES;
}

function faisableBase(rc: RoomCtx, poses: Pose[], s: FurnitureSpec, c: Cand): Rejet | null {
  const fp = c.fp, rot = c.rot, cat = s.category, tapis = cat === 'tapis';
  if (!s.allowedRoles.includes(rc.room.role) || (s.needsWater && !rc.room.hasWater)) return 'role_ou_eau';
  for (const p of poses) if (!tapis && p.spec.category !== 'tapis' && rectsOverlap(fp, p.fp)) return 'collision';
  if (!dansPiece(rc, fp)) return 'hors_piece';
  for (const f of rc.fixRects) if (rectsOverlap(fp, f)) return 'fixture';
  if (!tapis) {
    for (let i = 0; i < rc.room.swingZones.length; i++) if (rectsOverlap(fp, rc.swingBoxes[i]!, 0) && aireInterRect(rc.room.swingZones[i]!.polygon, fp) > TOL_DEBATTEMENT) return 'debattement';
    for (const w of rc.fenetres) {
      const inter = Math.max(0, Math.min(fp.maxX, w.rect.maxX) - Math.max(fp.minX, w.rect.minX)) * Math.max(0, Math.min(fp.maxY, w.rect.maxY) - Math.max(fp.minY, w.rect.minY));
      if (inter <= 0.001) continue;
      if (w.kind === 'french_window' || !s.allowedUnderWindow || (w.sill !== null && s.size.h > w.sill)) return 'fenetre';
    }
  }
  // Réserves PMR des meubles déjà posés.
  for (const p of poses) for (const z of p.zones) if (!z.tol.has(cat) && rectsOverlap(fp, z.r)) return z.regle === 'ORG-12' ? 'axe_salon' : 'pmr';
  // Dégagements propres.
  const clr = clrEff(s, c.mirrored);
  if (!tapis) {
    // USA-02 : tout meuble (chevets, bancs compris) garde ses propres dégagements libres des obstacles non
    // tolérés ; chaises : recul arrière (USA-05). Lit : ses passages (USA-03) ne tolèrent que tapis et chevets.
    const chaise = CHAISES.has(cat);
    for (const b of bandes(fp, clr, rot)) {
      if (chaise && b.cote !== 'derriere') continue;
      if (!dansPiece(rc, b.r)) return 'degagement';
      for (const f of rc.fixRects) if (rectsOverlap(b.r, f)) return 'degagement';
      const tol = toleresDans(cat, b.cote);
      for (const p of poses) {
        if (tol.has(p.spec.category)) continue;
        if (rectsOverlap(b.r, p.fp)) return 'degagement';
      }
      if (CUISINE_FIXE.has(cat) && b.cote === 'devant') for (let i = 0; i < rc.room.swingZones.length; i++) if (rectsOverlap(b.r, rc.swingBoxes[i]!, 0) && aireInterRect(rc.room.swingZones[i]!.polygon, b.r) > TOL_DEBATTEMENT) return 'degagement';
    }
    for (const p of poses) {
      const pc = p.spec.category, pChaise = CHAISES.has(pc);
      for (const b of bandes(p.fp, p.clr, p.pl.rotationDeg)) {
        if (pChaise && b.cote !== 'derriere') continue;
        if (toleresDans(pc, b.cote).has(cat)) continue;
        if (rectsOverlap(b.r, fp)) return 'degagement';
      }
    }
  }
  // Zones PMR exigées par le candidat.
  for (const z of c.zones ?? []) {
    const code: Rejet = z.regle === 'ORG-12' ? 'axe_salon' : 'pmr';
    if (!dansPiece(rc, z.r)) return code;
    for (const f of rc.fixRects) if (rectsOverlap(z.r, f)) return code;
    for (const p of poses) if (!z.tol.has(p.spec.category) && rectsOverlap(z.r, p.fp)) return code;
    if (z.swing !== 'ignore') for (let i = 0; i < rc.room.swingZones.length; i++) if (rectsOverlap(z.r, rc.swingBoxes[i]!, 0) && aireInterRect(rc.room.swingZones[i]!.polygon, z.r) > TOL_DEBATTEMENT) return code;
  }
  // Distances techniques.
  if (TEC01.has(cat) && rc.radiateurs.some((g) => distGeo(fp, g) < 0.3 - 1e-9)) return 'distance_technique';
  if (TEC02.has(cat) && rc.zonesTableau.some((z) => rectsOverlap(fp, z))) return 'distance_technique';
  if (TEC03.has(cat) && rc.chaudieres.some((g) => distGeo(fp, g) < 0.6 - 1e-9)) return 'distance_technique';
  if (s.needsWater) {
    const role = rc.room.role;
    const min = (gs: Array<Vec2 | Rect>) => gs.reduce((m, g) => Math.min(m, distGeo(fp, g)), Infinity);
    if ((role === 'cuisine' || role === 'sejour_cuisine') && ['cuisine_lineaire', 'lave_vaisselle', 'ilot'].includes(cat) && rc.eau.tout.length && min(rc.eau.tout) > 3.0 + 1e-9) return 'distance_technique';
    if (['wc', 'salle_de_bain', 'salle_d_eau'].includes(role) && cat === 'wc' && rc.eau.wc.length && min(rc.eau.wc) > 1.0 + 1e-9) return 'distance_technique';
    if (['salle_de_bain', 'salle_d_eau', 'wc', 'buanderie', 'cellier'].includes(role) && ['meuble_vasque', 'douche', 'baignoire', 'lave_mains', 'lave_linge'].includes(cat) && rc.eau.tout.length && min(rc.eau.tout) > 2.5 + 1e-9) return 'distance_technique';
  }
  return null;
}

function obstaclesPassage(rc: RoomCtx, poses: Pose[]): Rect[] {
  return [...poses.filter((p) => p.spec.category !== 'tapis').map((p) => p.fp), ...rc.fixRects];
}
function ciblesPortes(rc: RoomCtx, w: number, exclues: Set<number>): Cible[] {
  return rc.portes.filter((_, i) => !exclues.has(i)).map((d) => ciblePoint([d.mid[0] + d.n[0] * w / 2, d.mid[1] + d.n[1] * w / 2]));
}
function ciblesUsages(poses: Pose[], w: number): Cible[] {
  const out: Cible[] = [];
  for (const p of poses) {
    const c = p.spec.clearances.front;
    if (p.spec.category === 'tapis' || SATELLITES.has(p.spec.category) || c <= 0) continue;
    out.push({ r: bande(p.fp, frontDir(p.pl.rotationDeg), c), portee: w / 2 + 0.05 });
  }
  return out;
}
/** Contraintes de pièce réévaluées après chaque pose : passages (F9) et cercle PMR (F10). */
function contraintesOk(ctx: RoomCtx, poses: Pose[]): Rejet | null {
  const champ = champObstacles(ctx.grille, obstaclesPassage(ctx, poses), PASSAGE_PORTES / 2 + 0.01);
  const c09 = ciblesPortes(ctx, PASSAGE_PORTES, ctx.exclues09);
  if (ctx.passagePortes09 && c09.length >= 2 && !relie(ctx.grille, champ, PASSAGE_PORTES, c09)) return 'passage';
  const w = ctx.principale ? PASSAGE_USAGES_PRINCIPALES : PASSAGE_USAGES_SERVICE;
  const cibles = [...ciblesPortes(ctx, w, ctx.excluesW), ...ciblesUsages(poses, w)];
  if (cibles.length >= 2 && !relie(ctx.grille, champ, w, cibles)) return 'passage';
  if (!cercleOk(ctx, poses)) return 'pmr';
  return null;
}

// ───────────────────────────── Candidats ─────────────────────────────

function contreMur(rc: RoomCtx, f: Rect, dir: Vec2): boolean {
  const P = rc.poly;
  for (let e = 0; e < P.length; e++) {
    const a = P[e]!, b = P[(e + 1) % P.length]!;
    if (Math.abs(dir[0]) > 0.5) {
      const x = dir[0] > 0 ? f.maxX : f.minX;
      if (Math.abs(a[0] - x) < 1e-3 && Math.abs(b[0] - x) < 1e-3 && Math.min(a[1], b[1]) <= f.minY + 1e-3 && Math.max(a[1], b[1]) >= f.maxY - 1e-3) return true;
    } else {
      const y = dir[1] > 0 ? f.maxY : f.minY;
      if (Math.abs(a[1] - y) < 1e-3 && Math.abs(b[1] - y) < 1e-3 && Math.min(a[0], b[0]) <= f.minX + 1e-3 && Math.max(a[0], b[0]) >= f.maxX - 1e-3) return true;
    }
  }
  return false;
}

const symetries = (s: FurnitureSpec) => (asymetrique(s) ? [false, true] : [false]);

function candidatsMur(rc: RoomCtx, s: FurnitureSpec): Cand[] {
  const out: Cand[] = [];
  for (const l of rc.lignes) {
    const rot = rotPour(l.normal); if (rot === null) continue;
    const { w, d } = rotSize(s, rot);
    const larg = l.axe === 'x' ? w : d, prof = l.axe === 'x' ? d : w;
    if (larg > l.hi - l.lo + 1e-9) continue;
    const pos = new Set<number>();
    for (let t = l.lo; t <= l.hi - larg + 1e-9; t += PAS_MUR) pos.add(r4(t));
    pos.add(r4(l.hi - larg)); pos.add(r4((l.lo + l.hi - larg) / 2));
    for (const t of [...pos].sort((a, b) => a - b)) {
      const cAlong = t + larg / 2, cPerp = l.coord + (l.axe === 'x' ? l.normal[1] : l.normal[0]) * prof / 2;
      const center: Vec2 = l.axe === 'x' ? [r4(cAlong), r4(cPerp)] : [r4(cPerp), r4(cAlong)];
      let best: number | null = null, recouv = 0;
      for (const run of l.runs) { const o = Math.min(run.hi, t + larg) - Math.max(run.lo, t); if (o > recouv + 1e-9) { recouv = o; best = run.idx; } }
      for (const mirrored of symetries(s)) out.push({ center, rot, mirrored, runIdx: best, score: 0, fp: fpOf(center, s, rot), ligne: l });
    }
  }
  return out;
}

/** Éléments de décor (plante, luminaire, tapis) : grille libre plus lâche (ils ont aussi des candidats d'association). */
const DECOR = new Set(['plante', 'luminaire_sol', 'tapis']);
function candidatsLibres(rc: RoomCtx, s: FurnitureSpec): Cand[] {
  const out: Cand[] = [];
  const sym = s.clearances.front === s.clearances.back && s.clearances.left === s.clearances.right;
  const rots: Placement['rotationDeg'][] = sym ? [0, 90] : ROT;
  const pas = DECOR.has(s.category) ? 2 * PAS_GRILLE_LIBRE : PAS_GRILLE_LIBRE;
  for (const rot of rots) {
    const { w, d } = rotSize(s, rot);
    const xs = new Set<number>(), ys = new Set<number>();
    for (let x = rc.bb.minX + w / 2; x <= rc.bb.maxX - w / 2 + 1e-9; x += pas) xs.add(r4(x));
    for (let y = rc.bb.minY + d / 2; y <= rc.bb.maxY - d / 2 + 1e-9; y += pas) ys.add(r4(y));
    xs.add(r4(rc.bb.maxX - w / 2)); ys.add(r4(rc.bb.maxY - d / 2));
    for (const x of [...xs].sort((a, b) => a - b)) for (const y of [...ys].sort((a, b) => a - b)) {
      const center: Vec2 = [x, y];
      for (const mirrored of symetries(s)) out.push({ center, rot, mirrored, runIdx: null, score: 0, fp: fpOf(center, s, rot) });
    }
  }
  return out;
}

/**
 * Créneaux de chaises d'une table selon ses couverts (grands côtés d'abord) : 2 → 1 + 1 face à face ;
 * 4 → 2 + 2 ; 6 → 3 + 3 ; 8 → 3 + 3 + 1 + 1. Bouts proposés en dernier recours (bonus négatif).
 * Table ronde / carrée de 4 : un par côté.
 */
function creneauxChaises(t: Pose): Array<{ dir: Vec2; n: number; long: number; bonus: number }> {
  const seats = t.spec.seats ?? 2, f = frontDir(t.pl.rotationDeg);
  const tw = t.spec.size.w, td = t.spec.size.d;
  const carre = Math.abs(tw - td) < 1e-9 && seats >= 4;
  if (carre) return [f, neg(f), leftOf(f), rightOf(f)].map((dir) => ({ dir, n: 1, long: tw, bonus: 3 }));
  const parCote = seats >= 8 ? Math.round((seats - 2) / 2) : Math.ceil(seats / 2);
  return [
    { dir: f, n: parCote, long: tw, bonus: 3 }, { dir: neg(f), n: parCote, long: tw, bonus: 3 },
    { dir: leftOf(f), n: 1, long: td, bonus: seats >= 8 ? 3 : -3 }, { dir: rightOf(f), n: 1, long: td, bonus: seats >= 8 ? 3 : -3 },
  ];
}

/** Candidats d'association (satellites et éléments de zone), relatifs à l'hôte si connu. */
function candidatsAssoc(rc: RoomCtx, s: FurnitureSpec, poses: Pose[], hote: Pose | null, bouts = true): Cand[] {
  const out: Cand[] = [];
  const push = (center: Vec2, rot: Placement['rotationDeg'], assoc: string, runIdx: number | null = null, bonus = 0) => {
    const c: Vec2 = [r4(center[0]), r4(center[1])];
    out.push({ center: c, rot, mirrored: false, runIdx, score: 0, fp: fpOf(c, s, rot), assoc, bonus });
  };
  const hotes = (cat: string) => (hote ? (hote.spec.category === cat ? [hote] : []) : poses.filter((p) => p.spec.category === cat));
  const cat = s.category;
  if (cat === 'chevet') {
    for (const p of hotes('lit')) {
      const rot = p.pl.rotationDeg, f = frontDir(rot), back = neg(f);
      const { w: cw, d: cd } = rotSize(s, rot);
      for (const side of [leftOf(f), rightOf(f)]) {
        // accolé au grand côté du lit, dos aligné sur la tête de lit (même mur)
        const lx = side[0] !== 0 ? (side[0] > 0 ? p.fp.maxX + cw / 2 : p.fp.minX - cw / 2) : null;
        const ly = side[1] !== 0 ? (side[1] > 0 ? p.fp.maxY + cd / 2 : p.fp.minY - cd / 2) : null;
        const bx = back[0] !== 0 ? (back[0] < 0 ? p.fp.minX + cw / 2 : p.fp.maxX - cw / 2) : null;
        const by = back[1] !== 0 ? (back[1] < 0 ? p.fp.minY + cd / 2 : p.fp.maxY - cd / 2) : null;
        push([lx ?? bx!, ly ?? by!], rot, p.pl.id, p.pl.anchoredTo?.wallRunIndex ?? null);
      }
    }
  } else if (cat === 'chaise' && s.id !== 'tabouret_haut') {
    for (const p of hotes('table_repas')) {
      const c = centre(p.fp);
      for (const k of creneauxChaises(p)) {
        if (!bouts && k.bonus < 0) continue;
        const crot = rotPour(neg(k.dir)); if (crot === null) continue;
        const { w: cw, d: cd } = rotSize(s, crot);
        const ext = Math.abs(k.dir[0]) > 0.5 ? cw / 2 : cd / 2;
        const base: Vec2 = [k.dir[0] > 0 ? p.fp.maxX + ext : k.dir[0] < 0 ? p.fp.minX - ext : c[0], k.dir[1] > 0 ? p.fp.maxY + ext : k.dir[1] < 0 ? p.fp.minY - ext : c[1]];
        const t: Vec2 = [Math.abs(k.dir[1]), Math.abs(k.dir[0])];
        for (let i = 0; i < k.n; i++) {
          const off = -k.long / 2 + (k.long * (i + 0.5)) / k.n;
          push([base[0] + t[0] * off, base[1] + t[1] * off], crot, p.pl.id, null, k.bonus);
        }
      }
    }
  } else if (cat === 'chaise_bureau') {
    for (const p of hotes('bureau')) {
      const f = frontDir(p.pl.rotationDeg), crot = rotPour(neg(f))!;
      const { w: cw, d: cd } = rotSize(s, crot), c = centre(p.fp);
      const ext = Math.abs(f[0]) > 0.5 ? cw / 2 : cd / 2;
      push([f[0] > 0 ? p.fp.maxX + ext : f[0] < 0 ? p.fp.minX - ext : c[0], f[1] > 0 ? p.fp.maxY + ext : f[1] < 0 ? p.fp.minY - ext : c[1]], crot, p.pl.id);
    }
  } else if (cat === 'table_basse') {
    for (const p of hotes('canape')) {
      const rot = p.pl.rotationDeg, f = frontDir(rot), c = milieuAvant(p.fp, rot);
      const rrs: Placement['rotationDeg'][] = Math.abs(s.size.w - s.size.d) < 1e-9 ? [rot] : [rot];
      for (const rr of rrs) {
        const { w: tw, d: td } = rotSize(s, rr);
        const ext = Math.abs(f[0]) > 0.5 ? tw / 2 : td / 2;
        for (const gap of [0.4, 0.45, 0.5]) push([c[0] + f[0] * (gap + ext), c[1] + f[1] * (gap + ext)], rr, p.pl.id);
      }
    }
  } else if (cat === 'meuble_tv') {
    // Vis-à-vis du canapé : mur opposé, devant opposé, distance faces avant 1,80–3,50 m, décalage ≤ 0,50 m.
    for (const p of hotes('canape')) {
      const fc = frontDir(p.pl.rotationDeg), a = milieuAvant(p.fp, p.pl.rotationDeg);
      for (const c of candidatsMur(rc, s)) {
        const f = frontDir(c.rot);
        if (f[0] !== -fc[0] || f[1] !== -fc[1]) continue;
        const b = milieuAvant(c.fp, c.rot);
        const dist = (b[0] - a[0]) * fc[0] + (b[1] - a[1]) * fc[1];
        const lat = Math.abs((b[0] - a[0]) * fc[1] - (b[1] - a[1]) * fc[0]);
        if (dist < TV_MIN - 1e-9 || dist > TV_MAX + 1e-9 || lat > TV_DECALAGE_MAX + 1e-9) continue;
        // Axe du salon (entre la face avant du canapé et celle du TV, sur la largeur du canapé) : réservé au salon.
        const fa = bande(p.fp, fc, 0), fb = bande(c.fp, f, 0);
        const axe: Rect = Math.abs(fc[0]) > 0.5
          ? { minX: Math.min(fa.minX, fb.minX), maxX: Math.max(fa.maxX, fb.maxX), minY: p.fp.minY, maxY: p.fp.maxY }
          : { minX: p.fp.minX, maxX: p.fp.maxX, minY: Math.min(fa.minY, fb.minY), maxY: Math.max(fa.maxY, fb.maxY) };
        out.push({ ...c, assoc: p.pl.id, bonus: 0, zones: [{ r: axe, tol: SALON, swing: 'ignore', regle: 'ORG-12' }] });
      }
    }
  } else if (cat === 'refrigerateur' || cat === 'lave_vaisselle' || (cat === 'lave_linge' && (rc.room.role === 'cuisine' || rc.room.role === 'sejour_cuisine'))) {
    // Contigu au linéaire de cuisine : même mur (prolongement) ou retour d'angle (lave-linge en cuisine compris).
    for (const p of [...hotes('cuisine_lineaire'), ...(hote ? [] : poses.filter((q) => q.spec.category === 'ilot' || (cat === 'lave_linge' && CUISINE_FIXE.has(q.spec.category) && q.spec.category !== 'cuisine_lineaire')))]) {
      for (const c of candidatsMur(rc, s)) {
        if (rectsOverlap(c.fp, p.fp) || rectDist(c.fp, p.fp) > 1e-3) continue;
        const aligne = c.rot === p.pl.rotationDeg;
        out.push({ ...c, assoc: p.pl.id, bonus: aligne ? 3 : 1 });
      }
    }
  } else if (cat === 'tapis') {
    const tb = poses.find((p) => p.spec.category === 'table_basse'), cs = poses.find((p) => p.spec.category === 'canape');
    const lit = poses.find((p) => p.spec.category === 'lit');
    if (cs && (rc.room.role === 'sejour' || rc.room.role === 'sejour_cuisine')) {
      const rot = cs.pl.rotationDeg, f = frontDir(rot);
      const tv = poses.find((p) => p.spec.category === 'meuble_tv');
      const a = milieuAvant(cs.fp, rot);
      const cible: Vec2 = tb ? centre(tb.fp) : tv ? (() => { const b = milieuAvant(tv.fp, tv.pl.rotationDeg); return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as Vec2; })() : [a[0] + f[0] * 0.9, a[1] + f[1] * 0.9];
      for (const off of [0, -0.1, 0.1, -0.2, 0.2, -0.3]) push([cible[0] + f[0] * off, cible[1] + f[1] * off], rot, cs.pl.id);
    } else if (lit) {
      const rot = lit.pl.rotationDeg, f = frontDir(rot), pied = milieuAvant(lit.fp, rot);
      for (const off of [0.4, 0.5, 0.3, 0.6, 0.2]) push([pied[0] - f[0] * off, pied[1] - f[1] * off], rot, lit.pl.id);
    }
  } else if (cat === 'fauteuil') {
    const cs = poses.find((p) => p.spec.category === 'canape');
    if (cs) {
      const fc = frontDir(cs.pl.rotationDeg), a = milieuAvant(cs.fp, cs.pl.rotationDeg);
      const tb = poses.find((p) => p.spec.category === 'table_basse');
      const ctr: Vec2 = tb ? centre(tb.fp) : [a[0] + fc[0] * 0.75, a[1] + fc[1] * 0.75];
      const demi = tb ? (Math.abs(fc[0]) > 0.5 ? (tb.fp.maxY - tb.fp.minY) / 2 : (tb.fp.maxX - tb.fp.minX) / 2) : 0.5;
      for (const side of [leftOf(fc), rightOf(fc)]) {
        const rot = rotPour(neg(side)); if (rot === null) continue;
        const prof = s.size.d;
        for (const gap of [0.35, 0.45, 0.6, 0.8]) for (const along of [0, 0.15, -0.15, 0.3]) {
          const e = demi + gap + prof / 2;
          push([ctr[0] + side[0] * e + fc[0] * along, ctr[1] + side[1] * e + fc[1] * along], rot, cs.pl.id, null, 2);
        }
      }
    }
  } else if (cat === 'luminaire_sol') {
    const cs = poses.find((p) => p.spec.category === 'canape');
    if (cs) {
      const f = frontDir(cs.pl.rotationDeg), back = neg(f);
      const { w: lw, d: ld } = rotSize(s, 0);
      for (const side of [leftOf(f), rightOf(f)]) for (const gap of [0.05, 0.15]) {
        const lx = side[0] !== 0 ? (side[0] > 0 ? cs.fp.maxX + gap + lw / 2 : cs.fp.minX - gap - lw / 2) : null;
        const ly = side[1] !== 0 ? (side[1] > 0 ? cs.fp.maxY + gap + ld / 2 : cs.fp.minY - gap - ld / 2) : null;
        const bx = back[0] !== 0 ? (back[0] < 0 ? cs.fp.minX + lw / 2 : cs.fp.maxX - lw / 2) : null;
        const by = back[1] !== 0 ? (back[1] < 0 ? cs.fp.minY + ld / 2 : cs.fp.maxY - ld / 2) : null;
        push([lx ?? bx!, ly ?? by!], 0, cs.pl.id, null, 3);
      }
    }
  }
  return out;
}

/** Satellites placés exclusivement autour de leur hôte. */
const ASSOC_SEULEMENT = new Set(['chevet', 'chaise', 'chaise_bureau', 'table_basse']);
const ASSOC_SI_HOTE = new Set(['meuble_tv', 'refrigerateur', 'lave_vaisselle', 'lave_linge']);

/**
 * Canapé « dos au vide » (INT-05b) : salon tourné vers un mur pouvant recevoir le meuble TV, canapé centré sur
 * l'axe, faces avant à 2,2 / 2,6 / 3,0 m. Composition professionnelle courante dans un séjour traversant ou
 * ouvert, quand aucun couple de murs ne se fait face à bonne distance. Bonus négatif : l'adossement reste préféré.
 */
function candidatsSalonFlottant(rc: RoomCtx, s: FurnitureSpec): Cand[] {
  const out: Cand[] = [];
  for (const l of rc.lignes) {
    if (l.hi - l.lo < 1.2 - 1e-9) continue;
    const rot = rotPour(neg(l.normal)); if (rot === null) continue;
    const prof = rotSize(s, rot)[l.axe === 'x' ? 'd' : 'w'];
    for (let t = l.lo + 0.6; t <= l.hi - 0.6 + 1e-9; t += 0.1) for (const dist of [2.2, 2.6, 3.0]) {
      const e = 0.42 + dist + prof / 2; // profondeur type d'un meuble TV + distance faces avant + demi-canapé
      const center: Vec2 = l.axe === 'x' ? [r4(t), r4(l.coord + l.normal[1] * e)] : [r4(l.coord + l.normal[0] * e), r4(t)];
      out.push({ center, rot, mirrored: false, runIdx: null, score: 0, fp: fpOf(center, s, rot), bonus: -4, famille: 'flottant' });
    }
  }
  return out;
}

function genererCandidats(rc: RoomCtx, s: FurnitureSpec, poses: Pose[], hote: Pose | null, bouts = true): Cand[] {
  const assoc = candidatsAssoc(rc, s, poses, hote, bouts);
  if (ASSOC_SEULEMENT.has(s.category) && (assoc.length || hote)) return assoc;
  if (hote && ASSOC_SI_HOTE.has(s.category)) return assoc;
  let base: Cand[];
  if (s.anchor === 'mur_dos' || s.anchor === 'angle') base = candidatsMur(rc, s);
  else base = candidatsLibres(rc, s);
  if (s.category === 'canape') base = [...base, ...candidatsSalonFlottant(rc, s)];
  return [...assoc, ...base];
}

/** Variantes PMR d'un candidat (zones exigées) ; [] si aucune exigence dans cette pièce. */
function variantesPMR(rc: RoomCtx, s: FurnitureSpec, c: Cand): Cand[] | null {
  const pmr = rc.pmr; if (!pmr) return null;
  const id = rc.room.id, cat = s.category, f = frontDir(c.rot), fp = c.fp, L = pmr.lecture;
  if (pmr.cuisines.has(id) && CUISINE_FIXE.has(cat)) {
    // CIR-04 : 1,50 m devant ; débattement toléré sur 0,25 m → bande de 1,25 m hors débattement.
    const tol = L === 'b' ? tolerees('b') : tolerees('a');
    return [{ ...c, zones: [
      { r: bande(fp, f, 1.5), tol, swing: 'ignore', regle: 'CIR-04' },
      { r: bande(fp, f, 1.25), tol: TOUTES, swing: 'interdit', regle: 'CIR-04' },
    ] }];
  }
  if (pmr.chambre === id && cat === 'lit') {
    // CIR-07 : 0,90 m sur les grands côtés + 1,20 m au pied, ou 1,20 m + 0,90 m. Chevets tolérés (b), mobile (a).
    const tol = tolerees(L, ['chevet']);
    return [[0.9, 1.2], [1.2, 0.9]].map(([lat, pied]) => ({ ...c, zones: [
      { r: bande(fp, leftOf(f), lat!), tol, swing: 'ignore' as const, regle: 'CIR-07' },
      { r: bande(fp, rightOf(f), lat!), tol, swing: 'ignore' as const, regle: 'CIR-07' },
      { r: bande(fp, f, pied!), tol, swing: 'ignore' as const, regle: 'CIR-07' },
    ] }));
  }
  if (pmr.wc === id && cat === 'wc') {
    // USA-14 : espace latéral 0,80 × 1,30 m depuis le mur arrière, hors débattement. « a » : mobile + lave-linge tolérés.
    const tol = tolerees(L, L === 'a' ? ['lave_linge'] : []);
    const back = neg(f), arriere = centre(bande(fp, back, 0));
    return [leftOf(f), rightOf(f)].map((side) => {
      const bord = centre(bande(fp, side, 0));
      const lo: Vec2 = [arriere[0] * Math.abs(f[0]) + bord[0] * Math.abs(side[0]), arriere[1] * Math.abs(f[1]) + bord[1] * Math.abs(side[1])];
      const hi: Vec2 = [lo[0] + f[0] * 1.3 + side[0] * 0.8, lo[1] + f[1] * 1.3 + side[1] * 0.8];
      const r: Rect = { minX: Math.min(lo[0], hi[0]), maxX: Math.max(lo[0], hi[0]), minY: Math.min(lo[1], hi[1]), maxY: Math.max(lo[1], hi[1]) };
      return { ...c, zones: [{ r, tol, swing: 'interdit' as const, regle: 'USA-14' }] };
    });
  }
  return null;
}

// ───────────────────────────── Scoring ─────────────────────────────

/**
 * Score d'un candidat (points). Termes :
 *  adossement +2 (mur_dos/angle) ; angle : côté sans dégagement contre un mur +3 ;
 *  alignement : calé dans un angle +0,5, centré sur sa ligne +0,3 ; bonus d'association (créneaux de chaises,
 *  électroménager aligné, fauteuils et lampadaire autour du salon) ;
 *  lit : +1/m d'éloignement de la porte (≤ 4), tête sous fenêtre −1,5, tête sur le mur d'une porte −3,
 *    lit dans la vue directe d'une porte (2 m) −2, à moins de 0,30 m d'un débattement −2, lit double centré
 *    sur son mur +1,5 ;
 *  chevet : +10 accolé (≤ 1 cm) à un lit, −6 s'il double un chevet existant du même côté ;
 *  canapé : +3 si 2,2–4,5 m libres devant, +1/m d'éloignement de la cuisine (≤ 3), dos à une fenêtre −1 ;
 *  meuble TV : face au canapé +4, distance 1,8–3,5 m +4 (sinon −3/m d'écart), −2/m de décalage latéral,
 *    devant une fenêtre −1 ;
 *  table basse : +10 devant le canapé ; fauteuil : −2/m d'écart à 1,3 m du centre du salon, +2 tourné vers lui ;
 *  table de repas : coin repas entre cuisine et salon — −1/m d'écart à 1,2 m de la cuisine (ou de la porte
 *    de la cuisine fermée), −2 si plus près du salon que de la cuisine, −0,5/m à la fenêtre ;
 *  bureau : sous la fenêtre (face au jour) +3, perpendiculaire à la fenêtre et à ≤ 1 m d'elle +2,
 *    sinon −1,5/m à la fenêtre la plus proche ;
 *  cuisine linéaire : −3/m à l'eau ; frigo / lave-vaisselle : −4/m à la cuisine ;
 *  sanitaires / lave-linge : −1,5/m à l'eau ; armoire / rangements : −0,5 devant une fenêtre, −1 sur le mur
 *    de la tête de lit, +0,5 calée dans un angle ;
 *  tapis : −2/m au centre du salon (séjour) ou sous le bas du lit (chambre) ; lampadaire : −2/m au canapé ;
 *  plante : +1 dans un angle ; zonage séjour-cuisine : salon −1/m de proximité de la cuisine (< 2 m) ;
 *  axe du salon : −6 pour tout meuble hors salon empiétant sur l'enveloppe canapé ↔ meuble TV.
 */
function scoreCandidat(rc: RoomCtx, s: FurnitureSpec, c: Cand, poses: Pose[]): number {
  let sc = c.bonus ?? 0;
  const cat = s.category, f = frontDir(c.rot), ctr = c.center;
  const parCat = (k: string) => poses.filter((p) => p.spec.category === k);
  const cuisine = poses.filter((p) => p.spec.category === 'cuisine_lineaire');
  const distCuisine = cuisine.length ? Math.min(...cuisine.map((p) => rectDist(p.fp, c.fp))) : null;
  const fenetre = rc.fenetres.length ? Math.min(...rc.fenetres.map((w) => d2(w.mid, ctr))) : null;
  if (c.ligne && (s.anchor === 'mur_dos' || s.anchor === 'angle')) sc += 2;
  if (s.anchor === 'angle') {
    const cl = clrEff(s, c.mirrored);
    // Angle tenu : le côté sans (ou avec le moindre) dégagement contre un mur ; les deux côtés si symétrique.
    const cotes = Math.abs(cl.left - cl.right) < 1e-9 ? [leftOf(f), rightOf(f)] : [cl.left < cl.right ? leftOf(f) : rightOf(f)];
    if (cotes.some((v) => contreMur(rc, c.fp, v))) sc += 3;
  }
  if (c.ligne) {
    if (contreMur(rc, c.fp, leftOf(f)) || contreMur(rc, c.fp, rightOf(f))) sc += 0.5;
    const l = c.ligne, along = l.axe === 'x' ? ctr[0] : ctr[1];
    if (Math.abs(along - (l.lo + l.hi) / 2) < 0.1) sc += 0.3;
  }
  const salonC = (() => { const cs = parCat('canape'); if (!cs.length) return null; const tb = parCat('table_basse'); return centre((tb[0] ?? cs[0]!).fp); })();
  const murTete = (fp: Rect, rot: Placement['rotationDeg']) => bande(fp, neg(frontDir(rot)), 0.05);
  switch (cat) {
    case 'lit': {
      const dp = rc.portes.length ? Math.min(...rc.portes.map((d) => d2(d.mid, ctr))) : 4;
      sc += Math.min(dp, 4);
      const tete = murTete(c.fp, c.rot);
      if (rc.fenetres.some((w) => rectsOverlap(tete, w.rect, 0))) sc -= 1.5;
      // tête de lit sur le mur d'une porte
      const teteLigne = bande(c.fp, neg(f), 0);
      if (rc.portes.some((d) => Math.abs(d.n[0] - f[0]) < 1e-6 && Math.abs(d.n[1] - f[1]) < 1e-6 && Math.abs((d.mid[0] - teteLigne.minX) * f[0] + (d.mid[1] - teteLigne.minY) * f[1]) < 0.05)) sc -= 3;
      if (rc.portes.some((d) => rectsOverlap(d.vue, c.fp, 0))) sc -= 2;
      if (rc.swingBoxes.some((z) => rectDist(z, c.fp) < 0.3)) sc -= 2;
      if (s.provides.includes('dormir_double')) {
        const l = c.ligne;
        if (l) { const along = l.axe === 'x' ? ctr[0] : ctr[1]; if (Math.abs(along - (l.lo + l.hi) / 2) < 0.15) sc += 1.5; }
      }
      break;
    }
    case 'chevet': {
      const lits = parCat('lit');
      if (lits.some((l) => rectDist(l.fp, c.fp) <= 0.01)) sc += 10;
      if (parCat('chevet').some((x) => rectDist(x.fp, c.fp) < 0.5)) sc -= 6;
      break;
    }
    case 'canape': {
      const libre = distanceRayon(rc.poly, centre(bande(c.fp, f, 0)), f);
      if (libre >= 2.2 && libre <= 4.5) sc += 3;
      if (distCuisine !== null) sc += Math.min(distCuisine, 3);
      break;
    }
    case 'meuble_tv': {
      const cs = parCat('canape')[0];
      if (cs) {
        const fc = frontDir(cs.pl.rotationDeg);
        if (fc[0] === -f[0] && fc[1] === -f[1]) {
          sc += 4;
          const a = milieuAvant(cs.fp, cs.pl.rotationDeg), b = milieuAvant(c.fp, c.rot);
          const dist = Math.abs((b[0] - a[0]) * fc[0] + (b[1] - a[1]) * fc[1]);
          const lat = Math.abs((b[0] - a[0]) * fc[1] - (b[1] - a[1]) * fc[0]);
          sc += dist >= TV_MIN && dist <= TV_MAX ? 4 : -3 * (dist < TV_MIN ? TV_MIN - dist : dist - TV_MAX);
          if (dist >= 2.1) sc += 1.5; // place pour une table basse et ses dégagements entre canapé et TV
          sc -= 2 * lat;
        } else {
          // Hors vis-à-vis strict : l'écran doit au moins être tourné vers le canapé (vu de biais), jamais dos à lui.
          const cc = centre(cs.fp), v: Vec2 = [cc[0] - ctr[0], cc[1] - ctr[1]], n = Math.hypot(v[0], v[1]) || 1;
          const vise = (v[0] * f[0] + v[1] * f[1]) / n;
          sc += vise > 0.5 ? -1 - 2 * Math.abs((v[0] * f[1] - v[1] * f[0]) / n) : -10;
        }
      }
      if (rc.fenetres.some((w) => rectsOverlap(c.fp, w.rect, 0))) sc -= 1;
      if (distCuisine !== null) sc += Math.min(distCuisine, 2) * 0.5;
      break;
    }
    case 'table_basse': if (c.assoc) sc += 10; break;
    case 'fauteuil': {
      if (salonC) {
        const dd = d2(ctr, salonC); sc -= 2 * Math.abs(dd - 1.3);
        const v: Vec2 = [(salonC[0] - ctr[0]) / (dd || 1), (salonC[1] - ctr[1]) / (dd || 1)];
        if (v[0] * f[0] + v[1] * f[1] > 0.7) sc += 2;
      }
      break;
    }
    case 'table_repas': {
      if (fenetre !== null) sc -= 0.5 * fenetre;
      const portesCuisine = rc.portes.filter((d) => d.versCuisine);
      const dCuis = distCuisine ?? (portesCuisine.length ? Math.min(...portesCuisine.map((d) => ptRectDist(d.mid, c.fp))) : null);
      if (dCuis !== null) {
        sc -= Math.abs(dCuis - 1.2);
        if (salonC && d2(ctr, salonC) < dCuis + 0.5) sc -= 2;
      }
      break;
    }
    case 'bureau': {
      const sous = rc.fenetres.find((w) => rectsOverlap(c.fp, w.rect, 0));
      const perp = rc.fenetres.find((w) => Math.abs(w.normal[0] * f[0] + w.normal[1] * f[1]) < 1e-6 && ptRectDist(w.mid, c.fp) <= 1.0);
      if (sous && sous.normal[0] === f[0] && sous.normal[1] === f[1]) sc += 3;
      else if (perp) sc += 2;
      else if (fenetre !== null) sc -= 1.5 * fenetre;
      break;
    }
    case 'cuisine_lineaire': case 'ilot': {
      const e = rc.eau.tout; if (e.length) sc -= 3 * Math.min(...e.map((g) => distGeo(c.fp, g)));
      if (cat === 'ilot' && distCuisine !== null) sc -= Math.abs(distCuisine - 1.0) * 2;
      break;
    }
    case 'refrigerateur': case 'lave_vaisselle': {
      if (distCuisine !== null) sc -= 4 * distCuisine;
      else { const e = rc.eau.tout; if (e.length && cat === 'lave_vaisselle') sc -= 1.5 * Math.min(...e.map((g) => distGeo(c.fp, g))); }
      break;
    }
    case 'meuble_vasque': case 'douche': case 'baignoire': case 'wc': case 'lave_mains': case 'lave_linge': {
      const e = cat === 'wc' && rc.eau.wc.length ? rc.eau.wc : rc.eau.tout;
      if (e.length) sc -= 1.5 * Math.min(...e.map((g) => distGeo(c.fp, g)));
      if (cat === 'lave_linge' && distCuisine !== null) sc -= 4 * distCuisine; // lave-linge en cuisine : dans le linéaire
      break;
    }
    case 'armoire': case 'bibliotheque': case 'dressing': case 'commode': {
      if (rc.fenetres.some((w) => rectsOverlap(c.fp, w.rect, 0))) sc -= 0.5;
      const lit = parCat('lit')[0];
      if (lit && rectsOverlap(bande(c.fp, neg(f), 0.05), murTete(lit.fp, lit.pl.rotationDeg), 0)) sc -= 1;
      if (contreMur(rc, c.fp, leftOf(f)) || contreMur(rc, c.fp, rightOf(f))) sc += 0.5;
      break;
    }
    case 'tapis': {
      const lit = parCat('lit')[0];
      const cible = salonC ?? (lit ? (() => { const fl = frontDir(lit.pl.rotationDeg), m = milieuAvant(lit.fp, lit.pl.rotationDeg); return [m[0] - fl[0] * 0.4, m[1] - fl[1] * 0.4] as Vec2; })() : centroid(rc.poly));
      sc -= 2 * d2(ctr, cible);
      break;
    }
    case 'luminaire_sol': {
      // Lampadaire : à côté d'une assise (canapé, sinon fauteuil), contre un mur de préférence.
      const assise = parCat('canape')[0] ?? parCat('fauteuil')[0];
      if (assise) sc -= 2 * rectDist(assise.fp, c.fp);
      if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some((v) => contreMur(rc, c.fp, v as Vec2))) sc -= 2;
      break;
    }
    case 'plante': {
      // Plante : dans un angle (+2), au moins contre un mur, jamais au milieu de la pièce (−4).
      const coins = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter((v) => contreMur(rc, c.fp, v as Vec2)).length;
      sc += coins >= 2 ? 2 : coins === 1 ? 0 : -4;
      break;
    }
    default: break;
  }
  if (rc.room.role === 'sejour_cuisine' && ['canape', 'fauteuil', 'table_basse', 'meuble_tv'].includes(cat) && distCuisine !== null && distCuisine < 2) sc -= 2 - distCuisine;
  const cs = parCat('canape')[0], tv = parCat('meuble_tv')[0];
  if (cs && tv && !['table_basse', 'tapis', 'fauteuil', 'luminaire_sol', 'plante'].includes(cat)) {
    const z: Rect = { minX: Math.min(cs.fp.minX, tv.fp.minX), minY: Math.min(cs.fp.minY, tv.fp.minY), maxX: Math.max(cs.fp.maxX, tv.fp.maxX), maxY: Math.max(cs.fp.maxY, tv.fp.maxY) };
    if (rectsOverlap(z, c.fp)) sc -= 6;
  }
  return sc;
}

// ───────────────────────────── Solveur ─────────────────────────────

export interface SolveInput {
  plan: PlanInput; analysis: PlanAnalysis; programs: RoomProgram[]; seed: number; variant?: string;
  /** Brief (facultatif, INT-05b) : seul `constraints.pmr` est lu (exigences PMR « b » en contraintes dures). */
  brief?: InteriorBrief;
  /**
   * INT-09c — restreint la résolution à ces pièces (évaluation rapide des gaines candidates par `amenager`).
   * Absent : toutes les pièces (comportement inchangé). L'aléa n'avance pas pour les pièces sautées.
   */
  pieces?: readonly string[];
}

function hash(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

/**
 * Rang d'ordonnancement à priorité égale (puis emprise décroissante) : les éléments « structurants » et
 * fortement contraints d'abord (cuisine, sanitaires, lit), puis le salon, puis le reste.
 */
const RANG_CATEGORIE: Record<string, number> = {
  cuisine_lineaire: 0, wc: 0, baignoire: 0, douche: 0, lit: 0,
  canape: 1, meuble_tv: 2, fauteuil: 3, table_repas: 4,
};
/** Ordre alternatif essayé dans les pièces de jour : coin repas avant le salon (on garde le meilleur résultat). */
const RANG_REPAS_D_ABORD: Record<string, number> = { ...RANG_CATEGORIE, table_repas: 0.5 };

interface Tache { itemIdx: number; specId: string; fallbacks: string[]; prio: number; satellites: Tache[] }
/** Satellites placés avec leur hôte : catégories et nombre (dans l'ordre d'essai). */
function satellitesDe(s: FurnitureSpec): Array<{ cat: string; n: number }> {
  switch (s.category) {
    case 'lit': return [{ cat: 'chevet', n: s.provides.includes('dormir_double') ? 2 : 1 }];
    case 'table_repas': return [{ cat: 'chaise', n: s.seats ?? 2 }];
    case 'bureau': return [{ cat: 'chaise_bureau', n: 1 }];
    case 'cuisine_lineaire': return [{ cat: 'refrigerateur', n: 1 }, { cat: 'lave_vaisselle', n: 1 }, { cat: 'lave_linge', n: 1 }];
    case 'canape': return [{ cat: 'meuble_tv', n: 1 }, { cat: 'table_basse', n: 1 }];
    default: return [];
  }
}
type Essai = { ok: true } | { ok: false; rejets: Partial<Record<Rejet, number>>; n: number };

export function solveLayout(input: SolveInput): LayoutPlan {
  const { plan, analysis, programs, seed } = input;
  const variant = input.variant ?? 'base';
  const alea = rng((seed ^ hash(variant)) >>> 0);
  const placements: Placement[] = [];
  const unplaced: LayoutPlan['unplaced'] = [];
  const repairs: Repair[] = [];
  const repair = (action: string, reason: string, placementId?: string) => repairs.push({ step: repairs.length + 1, action, reason, ...(placementId ? { placementId } : {}) });
  const pmr = planPMR(plan, analysis, programs, input.brief);
  const N = input.brief ? input.brief.occupants.adults + input.brief.occupants.children : null;
  const ctxCache = new Map<string, RoomCtx>();

  for (const room of analysis.rooms) {
    if (input.pieces && !input.pieces.includes(room.id)) continue;
    const prog = programs.find((p) => p.roomId === room.id);
    if (!prog || !prog.items.length) continue;
    // Pièces de jour avec coin repas : deux ordres essayés (salon d'abord, repas d'abord), meilleur retenu
    // (moins d'obligatoires non placés, puis moins de non placés, puis moins de réparations ; égalité → ordre 1).
    const avecRepas = prog.items.some((i) => getSpec(i.specId)?.category === 'table_repas') && prog.items.some((i) => getSpec(i.specId)?.category === 'canape');
    // Clé de comparaison (plus petit = meilleur) : obligatoires non placés, pertes graves (fonction, couchage,
    // catégorie, couverts < occupants), zones incomplètes (hôte sans satellites), pertes mineures (place de canapé),
    // non placés, réparations.
    const cle = (r: ResultatPiece) => [r.unplaced.filter((u) => u.prio === 0).length, r.pertes, r.repairs.filter((x) => x.action === 'hote_sans_satellites').length, r.pertesMineures, r.unplaced.length, r.repairs.filter((x) => x.action !== 'constat_passage').length];
    const meilleur = (a: ResultatPiece, b: ResultatPiece) => { const ka = cle(a), kb = cle(b); for (let i = 0; i < ka.length; i++) if (kb[i]! !== ka[i]!) return kb[i]! < ka[i]! ? b : a; return a; };
    let best = placerPiece(room, prog, RANG_CATEGORIE);
    // Second ordre seulement si le premier laisse un défaut structurant (obligatoire, perte grave, zone incomplète).
    if (avecRepas && cle(best).slice(0, 3).some((x) => x > 0)) best = meilleur(best, placerPiece(room, prog, RANG_REPAS_D_ABORD));
    // Petite pièce encore incomplète (sanitaires, entrée…) : permutations bornées de l'ordre des hôtes obligatoires.
    if (cle(best)[0]! + cle(best)[1]! > 0 && room.area < 15) {
      for (const ordre of permutations(best.hotesObligatoires, room.area < 9 ? MAX_PERMUTATIONS : MAX_PERMUTATIONS / 2)) {
        best = meilleur(best, placerPiece(room, prog, RANG_CATEGORIE, ordre));
        if (cle(best)[0] === 0 && cle(best)[1] === 0) break;
      }
    }
    for (const r of best.repairs) repair(r.action, r.reason, r.placementId);
    for (const u of best.unplaced) unplaced.push({ roomId: u.roomId, specId: u.specId, reason: u.reason });
    placements.push(...best.placements);
  }

  return { version: 1, planId: plan.id, variant, seed, placements, unplaced, repairs };

  function placerPiece(room: AnalyzedRoom, prog: RoomProgram, RANGS: Record<string, number>, ordreForce?: number[]): ResultatPiece {
    const repairsP: Array<{ action: string; reason: string; placementId?: string }> = [];
    const repair = (action: string, reason: string, placementId?: string) => repairsP.push({ action, reason, ...(placementId ? { placementId } : {}) });
    // Contexte de pièce (grilles, lignes…) calculé une fois, copié par essai (seul `cercle` est modifié en cours d'essai).
    const base = ctxCache.get(room.id) ?? ctxCache.set(room.id, construireCtx(plan, analysis, room, pmr)).get(room.id)!;
    const rctx: RoomCtx = { ...base, constats: [...base.constats] };
    for (const c of rctx.constats) repair('constat_passage', c);
    let poses: Pose[] = [];
    const raisons = new Map<number, string>();
    /**
     * Exigences PMR levées dans cette pièce, par paliers (aucune position ne les tient) : 0 = toutes,
     * 1 = cercle Ø 1,50 m levé (zones gardées : l'autre « au moins une pièce » peut porter le cercle),
     * 2 = toutes levées. Chaque palier est consigné.
     */
    let pmrLeve = 0;

    const taches: Tache[] = [];
    prog.items.forEach((it, i) => {
      if (getSpec(it.specId)) taches.push({ itemIdx: i, specId: it.specId, fallbacks: it.fallbacks.filter((f) => getSpec(f)), prio: PRIO[it.priority], satellites: [] });
      else raisons.set(i, `Spec « ${it.specId} » inconnue du catalogue.`);
    });
    const empr = (t: Tache) => { const s = getSpec(t.specId)!; return s.size.w * s.size.d; };
    const rang = (t: Tache) => RANGS[getSpec(t.specId)!.category] ?? 9;
    const force = (t: Tache) => (ordreForce ? (ordreForce.indexOf(t.itemIdx) + 1 || 99) : 0);
    taches.sort((a, b) => a.prio - b.prio || force(a) - force(b) || rang(a) - rang(b) || empr(b) - empr(a) || a.itemIdx - b.itemIdx);
    const file: Tache[] = [];
    const pris = new Set<Tache>();
    for (const t of taches) {
      if (pris.has(t)) continue;
      pris.add(t); file.push(t);
      for (const sat of satellitesDe(getSpec(t.specId)!)) {
        let n = 0;
        for (const u of taches) {
          if (n >= sat.n) break;
          if (pris.has(u) || getSpec(u.specId)!.category !== sat.cat || u.specId === 'tabouret_haut') continue;
          t.satellites.push(u); pris.add(u); n++;
        }
      }
    }
    const idOf = (t: Tache) => `${room.id}-i${t.itemIdx}`;
    /** Chaises en bout de table : seulement si aucune position de la table ne garnit ses grands côtés. */
    let boutsAutorises = true;
    const memoCands = new Map<string, { poses: Pose[]; ok: Cand[]; rejets: Partial<Record<Rejet, number>>; nCands: number }>();

    const essayer = (t: Tache, specId: string, mode: 'tous' | 'obligatoires' | 'seul', host?: Pose, cap = MAX_ESSAIS_COUTEUX, replisSat = false): Essai => {
      const s = getSpec(specId)!;
      // Mémo : mêmes poses (même tableau), même spec, même hôte, mêmes options ⇒ mêmes candidats faisables.
      const cleMemo = `${specId}|${host?.pl.id ?? ''}|${host?.pl.center.join(',') ?? ''}|${boutsAutorises}|${pmrLeve}|${rctx.cercle ? 1 : 0}`;
      const memo = memoCands.get(cleMemo);
      let rejets: Partial<Record<Rejet, number>>, ok: Cand[], nCands: number;
      if (memo && memo.poses === poses) ({ rejets, nCands } = memo, ok = [...memo.ok]);
      else {
        rejets = {};
        const bruts = genererCandidats(rctx, s, poses, host ?? null, boutsAutorises);
        const cands: Cand[] = [];
        for (const c of bruts) { const v = pmrLeve >= 2 ? null : variantesPMR(rctx, s, c); if (v) cands.push(...v); else cands.push(c); }
        ok = [];
        for (const c of cands) {
          const r = faisableBase(rctx, poses, s, c);
          if (r) { rejets[r] = (rejets[r] ?? 0) + 1; continue; }
          c.score = scoreCandidat(rctx, s, c, poses) + alea() * BRUIT_VARIANTE;
          ok.push(c);
        }
        nCands = cands.length;
        memoCands.set(cleMemo, { poses, ok: [...ok], rejets: { ...rejets }, nCands });
        rejets = { ...rejets };
      }
      ok.sort((a, b) => b.score - a.score || a.center[0] - b.center[0] || a.center[1] - b.center[1] || a.rot - b.rot || Number(a.mirrored) - Number(b.mirrored));
      // Familles de candidats (adossé / salon flottant) entrelacées : le budget d'essais couvre les deux compositions.
      if (ok.some((c) => c.famille)) {
        const A = ok.filter((c) => !c.famille), B = ok.filter((c) => c.famille);
        ok.length = 0;
        for (let i = 0; i < Math.max(A.length, B.length); i++) { if (A[i]) ok.push(A[i]!); if (B[i]) ok.push(B[i]!); }
      }
      let essais = 0;
      /**
       * Diversification (hôtes à satellites) : après DIVERSIFIER_APRES échecs (passages ou satellites), un candidat à
       * ±0,15 m (même rotation) d'un échec n'est plus essayé (évite d'épuiser le budget sur des décalages de 5 cm
       * d'une même impasse).
       */
      const echecsSat: Cand[] = [];
      for (const c of ok) {
        if (echecsSat.length >= DIVERSIFIER_APRES && echecsSat.some((e) => e.rot === c.rot && Math.abs(e.center[0] - c.center[0]) <= 0.15 + 1e-9 && Math.abs(e.center[1] - c.center[1]) <= 0.15 + 1e-9)) continue;
        if (essais++ >= cap) break;
        const pose: Pose = { pl: mkPl(idOf(t), specId, room.id, c), spec: s, fp: c.fp, clr: clrEff(s, c.mirrored), prio: t.prio, itemIdx: t.itemIdx, zones: c.zones ?? [], ...(host ? { host: host.pl.id } : {}) };
        const avant = poses;
        poses = [...poses, pose];
        const rc = contraintesOk(rctx, poses);
        if (rc) { poses = avant; rejets[rc] = (rejets[rc] ?? 0) + 1; if (t.satellites.length) echecsSat.push(c); continue; }
        let satOk = true;
        const requis = mode === 'seul' ? [] : t.satellites.filter((u) => mode === 'tous' || u.prio === 0);
        // Replis d'un satellite : toujours pour un souhaité (table basse plus petite…), sur demande pour un obligatoire.
        for (const u of requis) if (!essayer(u, u.specId, 'tous', pose, 12).ok && !((replisSat || u.prio > 0) && u.fallbacks.some((fb) => { const r = essayer(u, fb, 'tous', pose, 12); if (r.ok) u.specId = fb; return r.ok; }))) { satOk = false; break; }
        if (!satOk) { poses = avant; rejets.satellites = (rejets.satellites ?? 0) + 1; echecsSat.push(c); continue; }
        for (const u of t.satellites) if (!requis.includes(u)) {
          let r = essayer(u, u.specId, 'tous', pose, 12);
          for (const fb of r.ok ? [] : u.fallbacks) { r = essayer(u, fb, 'tous', pose, 12); if (r.ok) { u.specId = fb; break; } }
          // Hôte posé seul : le satellite est ensuite cherché librement (ex. meuble TV hors vis-à-vis strict), replis admis.
          if (!r.ok && mode === 'seul' && !ASSOC_SEULEMENT.has(getSpec(u.specId)!.category)) {
            for (const sid of [u.specId, ...u.fallbacks]) {
              r = essayer(u, sid, 'tous', undefined, MAX_ESSAIS_COUTEUX);
              if (r.ok) { if (sid !== u.specId) { repair('repli', `« ${u.specId} » (satellite de « ${specId} ») ne tient pas : repli « ${sid} ».`, idOf(u)); u.specId = sid; } break; }
            }
          }
          if (!r.ok) raisons.set(u.itemIdx, `Satellite de « ${specId} » (${pose.pl.id}) : aucune place autour de l'hôte (${resume(u.specId, r)}).`);
        }
        return { ok: true };
      }
      return { ok: false, rejets, n: nCands };
    };

    /**
     * Ordre des essais : (1) spec puis replis conservant toutes les fonctions de la spec, avec satellites ;
     * (2) les mêmes, hôte seul ; (3) replis perdant une fonction, avec satellites ; (4) les mêmes, hôte seul.
     */
    const placer = (t: Tache, autoriserSeul = true, sansPerte = false): { ok: boolean; detail: string } => {
      const details: string[] = [];
      const orig = getSpec(t.specId)!;
      const ids = [t.specId, ...t.fallbacks];
      const garde = ids.filter((id) => orig.provides.every((f) => getSpec(id)!.provides.includes(f)));
      const perd = ids.filter((id) => !garde.includes(id));
      const etapes: Array<{ ids: string[]; seul: boolean }> = [{ ids: garde, seul: false }, { ids: garde, seul: true }, ...(sansPerte ? [] : [{ ids: perd, seul: false }, { ids: perd, seul: true }])];
      for (const { ids: lot, seul } of etapes) {
        if (seul && (!t.satellites.length || !autoriserSeul)) continue;
        for (const sid of lot) {
          let r: Essai = { ok: false, rejets: {}, n: 0 };
          if (seul) r = essayer(t, sid, 'seul');
          else {
            const table = getSpec(sid)!.category === 'table_repas';
            for (const bouts of table ? [false, true] : [true]) {
              boutsAutorises = bouts;
              if (t.satellites.some((u) => u.prio > 0)) r = essayer(t, sid, 'tous', undefined, 25);
              if (!r.ok) r = essayer(t, sid, 'obligatoires');
              if (!r.ok && t.satellites.some((u) => u.prio === 0 && u.fallbacks.length)) r = essayer(t, sid, 'obligatoires', undefined, MAX_ESSAIS_COUTEUX, true);
              if (r.ok) break;
            }
            boutsAutorises = true;
          }
          if (r.ok) {
            if (sid !== t.specId) {
              const perdues = orig.provides.filter((f) => !getSpec(sid)!.provides.includes(f));
              repair('repli', `« ${t.specId} » ne tient pas (${details.join(' ; ')}) : repli « ${sid} »${perdues.length ? ` (fonctions perdues : ${perdues.join(', ')})` : ''}.`, idOf(t));
              t.specId = sid;
            }
            if (seul) repair('hote_sans_satellites', `« ${sid} » placé sans ses satellites obligatoires (aucune position ne les accueille).`, idOf(t));
            return { ok: true, detail: '' };
          }
          if (!seul) details.push(resume(sid, r));
        }
      }
      return { ok: false, detail: details.join(' ; ') };
    };

    for (const t of file) {
      // Hôte obligatoire à satellites obligatoires : on tente d'abord la zone complète (y compris par
      // repositionnement d'un hôte déjà posé) avant d'accepter l'hôte seul.
      const zoneComplete = t.prio === 0 && t.satellites.some((u) => u.prio === 0);
      let res = placer(t, !zoneComplete);
      while (!res.ok && t.prio === 0 && pmrLeve < 2 && rctx.pmr && pmrConcerne(rctx, getSpec(t.specId)!)) {
        // Exigence PMR impossible dans la pièce désignée : on lève d'abord le cercle, puis le reste ; consigné.
        if (pmrLeve === 0 && rctx.cercle) {
          pmrLeve = 1; rctx.cercle = null;
          repair('pmr_impossible', `Pièce ${room.id} : aucune position de « ${t.specId} » ne laisse de cercle Ø 1,50 m (art. 13) avec les autres exigences (${res.detail}) ; cercle levé dans cette pièce, passages / espaces PMR maintenus.`);
        } else {
          pmrLeve = 2; rctx.cercle = null;
          repair('pmr_impossible', `Pièce ${room.id} : aucune position de « ${t.specId} » ne tient les exigences PMR de l'art. 13 (${res.detail}) ; élément posé sans ces exigences.`);
        }
        res = placer(t, !zoneComplete);
      }
      if (res.ok) continue;
      let repare = false;
      if (t.prio === 0) {
        const hotes = poses.filter((p) => p.host === undefined && file.some((x) => x.itemIdx === p.itemIdx));
        const ordre = [...hotes].reverse().sort((a, b) => b.prio - a.prio).slice(0, MAX_BACKTRACK);
        for (const victime of ordre) {
          const sauvegarde = poses, nRep = repairs.length;
          const specsAvant = new Map(taches.map((x) => [x, x.specId]));
          poses = poses.filter((p) => p !== victime && p.host !== victime.pl.id);
          const tv = file.find((x) => x.itemIdx === victime.itemIdx)!;
          // L'élément retiré doit être replacé sans perdre de fonction (sinon le repositionnement dégrade la pièce).
          if (placer(t, !zoneComplete).ok && placer(tv, true, true).ok) {
            repair('repositionnement', `« ${t.specId} » (obligatoire) ne tenait pas : « ${victime.pl.specId} » (${victime.pl.id}) retiré avec ses satellites, « ${t.specId} » placé, puis « ${tv.specId} » replacé.`, victime.pl.id);
            repare = true;
            break;
          }
          poses = sauvegarde; repairs.length = nRep;
          for (const [x, sid] of specsAvant) x.specId = sid;
        }
      }
      if (!repare && zoneComplete) {
        const r2 = placer(t, true);
        if (r2.ok) continue;
        res = r2;
      }
      if (!repare) {
        const prioTxt = ['obligatoire', 'souhaité', 'optionnel'][t.prio];
        raisons.set(t.itemIdx, `Élément ${prioTxt} sans position faisable : ${res.detail}${t.prio === 0 ? ` ; repositionnement borné (${MAX_BACKTRACK} hôtes) sans succès` : ''}.`);
        for (const u of t.satellites) raisons.set(u.itemIdx, `Satellite de « ${t.specId} » : hôte non placé.`);
        if (t.prio === 0) repair('non_place', `« ${t.specId} » (obligatoire, ${idOf(t)}) consigné dans unplaced.`);
      }
    }
    const poseIdx = new Set(poses.map((p) => p.itemIdx));
    const nonPlaces: ResultatPiece['unplaced'] = [];
    prog.items.forEach((it, i) => {
      if (poseIdx.has(i)) return;
      const t = taches.find((x) => x.itemIdx === i);
      nonPlaces.push({ roomId: room.id, specId: t?.specId ?? it.specId, prio: PRIO[it.priority], reason: raisons.get(i) ?? 'Retiré lors d\'un repositionnement et non replacé.' });
    });
    poses.sort((a, b) => a.itemIdx - b.itemIdx);
    // Pertes : repli qui perd une fonction, des places assises ou des couchages par rapport au programme.
    let pertes = 0, pertesMineures = 0;
    for (const p of poses) {
      const o = getSpec(prog.items[p.itemIdx]!.specId)!, f = p.spec;
      // Couverts : une table plus petite n'est une perte grave que sous le nombre d'occupants (USA-13), si le brief est connu.
      const table = f.category === 'table_repas';
      const couvertsPerdus = table && N !== null ? (f.seats ?? 0) < Math.min(N, o.seats ?? 0) : table && (f.seats ?? 0) < (o.seats ?? 0);
      if (o.provides.some((x) => !f.provides.includes(x)) || couvertsPerdus || (f.sleeps ?? 0) < (o.sleeps ?? 0) || f.category !== o.category) pertes++;
      else if ((f.seats ?? 0) < (o.seats ?? 0)) pertesMineures++;
    }
    const hotesObligatoires = file.filter((t) => t.prio === 0).map((t) => t.itemIdx);
    return { placements: poses.map((p) => p.pl), unplaced: nonPlaces, repairs: repairsP, pertes, pertesMineures, hotesObligatoires };
  }
}

/** Nombre maximal de permutations d'ordre essayées dans une petite pièce incomplète. */
export const MAX_PERMUTATIONS = 24;
/** Permutations (ordre lexicographique, déterministe) de `xs`, au plus `max`, l'identité exclue. */
function permutations(xs: number[], max: number): number[][] {
  const out: number[][] = [];
  const rec = (pref: number[], reste: number[]) => {
    if (out.length >= max + 1) return;
    if (!reste.length) { out.push(pref); return; }
    for (let i = 0; i < reste.length; i++) rec([...pref, reste[i]!], [...reste.slice(0, i), ...reste.slice(i + 1)]);
  };
  rec([], xs);
  return out.slice(1, max + 1);
}

interface ResultatPiece {
  pertes: number;
  pertesMineures: number;
  hotesObligatoires: number[];
  placements: Placement[];
  unplaced: Array<{ roomId: string; specId: string; prio: number; reason: string }>;
  repairs: Array<{ action: string; reason: string; placementId?: string }>;
}

/** L'élément porte-t-il une exigence PMR dans cette pièce (zones ou cercle) ? */
function pmrConcerne(rc: RoomCtx, s: FurnitureSpec): boolean {
  const p = rc.pmr; if (!p) return false;
  const id = rc.room.id;
  return (p.cuisines.has(id) && CUISINE_FIXE.has(s.category)) || (p.chambre === id && s.category === 'lit') || (p.wc === id && s.category === 'wc')
    || (rc.cercle !== null && !rc.cercle.has(s.category)) || (p.bain === id && SANITAIRES.has(s.category));
}

function mkPl(id: string, specId: string, roomId: string, c: Cand): Placement {
  return { id, specId, roomId, center: [c.center[0], c.center[1]], rotationDeg: c.rot, anchoredTo: c.runIdx !== null ? { wallRunIndex: c.runIdx } : null, ...(c.mirrored ? { mirrored: true } : {}) };
}

function resume(specId: string, r: Essai): string {
  if (r.ok) return '';
  const parts = (Object.entries(r.rejets) as Array<[Rejet, number]>).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} ${LIBELLE_REJET[k]}`);
  return `« ${specId} » : ${r.n} candidats${parts.length ? ` (${parts.join(', ')})` : ''}`;
}
