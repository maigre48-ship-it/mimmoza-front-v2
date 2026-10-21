// src/spaces/promoteur/implantation/boundaryDistances.ts
//
// LOT L1b — DISTANCES ENTRE L'EMPRISE BÂTIE ET LES LIMITES DE LA PARCELLE (front).
//
// ORIGINE : portage de `mimmozia-studio/src/core/site/boundaryDistances.ts`
// (Lot 1 Studio, révisions R1 à R3 validées par le contrôleur), adapté aux
// types du front : points {x, y} en mètres dans le repère local de l'éditeur
// 2D (`parcelleLocal`, axe y vers le bas, comme `Plan2DCanvas`).
// INTENTION : mutualiser plus tard ce module avec le Studio (paquet commun
// « site/implantation ») ; d'ici là, toute correction doit être reportée des
// deux côtés.
//
// Module PUR : aucune dépendance React, store, Supabase ni stockage. Il MESURE ;
// la comparaison aux règles sourcées est faite dans `implantationCheck.ts`.
//
// Ce qui est mesuré :
//  - pour chaque PORTION de bâtiment (arête d'un polygone d'emprise) et chaque
//    SEGMENT de limite : la distance minimale et les deux points les plus
//    proches (pour tracer la cote) ;
//  - par bâtiment et par segment : la distance minimale et la portion qui la
//    détermine (à égalité, la portion la plus parallèle à la limite) ;
//  - le dépassement de parcelle (`insideParcel`) et, pour chaque limite
//    franchie, la profondeur du dépassement (`outsideDepth`) ; la distance
//    signée vaut alors −outsideDepth.
//
// Parcelle : un ou plusieurs anneaux extérieurs (MultiPolygon). Les arêtes
// communes à deux anneaux (parcelles contiguës non fusionnées) sont des
// limites INTERNES : elles ne sont ni mesurées ni jugées. Les trous (enclaves)
// ne sont pas traités.
//
// Bâtiment composé de plusieurs volumes qui se recouvrent : chaque volume est
// un polygone. La distance minimale à une limite extérieure est exacte (la
// frontière de l'union est incluse dans les arêtes des volumes) ; la portion
// désignée peut être une arête de volume plutôt qu'une façade de l'union.

export interface Pt {
  readonly x: number;
  readonly y: number;
}

export type CategorieLimite = "voirie" | "separative" | "fond" | "non-classee";
export type OrigineClassement = "utilisateur" | "deduite" | "aucune";

export interface SegmentLimite {
  /**
   * Identifiant stable : `p{polygone}-e{arête}` pour l'arête entière ou pour sa
   * première portion extérieure ; `p{k}-e{i}-{n}` pour les portions extérieures
   * suivantes ; `p{k}-e{i}-i{n}` pour les portions internes (R2).
   */
  readonly id: string;
  /** Identifiant de l'arête d'origine (`p{polygone}-e{arête}`), clé du classement. */
  readonly baseId: string;
  /** Rang global (ordre d'affichage). */
  readonly index: number;
  readonly polygonIndex: number;
  readonly edgeIndex: number;
  readonly start: Pt;
  readonly end: Pt;
  readonly length: number;
  readonly categorie: CategorieLimite;
  readonly origineClassement: OrigineClassement;
  /** Arête commune à deux anneaux de la parcelle : pas une limite extérieure. */
  readonly interne: boolean;
}

/** Emprise d'un bâtiment (polygones, sens indifférent, sans trous). */
export interface ContourBatiment {
  readonly id: string;
  readonly nom: string;
  readonly polygones: readonly (readonly Pt[])[];
}

export interface PortionFacade {
  readonly buildingId: string;
  readonly polygonIndex: number;
  readonly edgeIndex: number;
  readonly start: Pt;
  readonly end: Pt;
  readonly length: number;
}

export interface DistancePortionLimite {
  readonly portion: PortionFacade;
  readonly segmentId: string;
  readonly distance: number;
  readonly pointOnBuilding: Pt;
  readonly pointOnBoundary: Pt;
}

export interface DistanceBatimentLimite {
  readonly buildingId: string;
  readonly buildingName: string;
  readonly segmentId: string;
  readonly segmentIndex: number;
  readonly categorie: CategorieLimite;
  /** Distance non signée entre contours (m). */
  readonly distance: number;
  /** Distance signée (m) : négative de la profondeur du dépassement si la limite est franchie. */
  readonly distanceSignee: number;
  readonly pointOnBuilding: Pt;
  readonly pointOnBoundary: Pt;
  readonly portion: PortionFacade;
  readonly touchesBoundary: boolean;
  readonly exceedsBoundary: boolean;
  readonly outsideDepth: number;
}

export interface RapportBatiment {
  readonly buildingId: string;
  readonly buildingName: string;
  readonly portions: readonly PortionFacade[];
  readonly pairs: readonly DistancePortionLimite[];
  /** Une entrée par segment de limite EXTÉRIEUR, dans l'ordre des segments. */
  readonly perSegment: readonly DistanceBatimentLimite[];
  readonly minDistance: number | null;
  readonly insideParcel: boolean;
}

export interface RapportDistances {
  readonly buildings: readonly RapportBatiment[];
  /** Nombre d'anneaux de parcelle pris en compte. */
  readonly anneauxParcelle: number;
  /** Segments internes (exclus des mesures). */
  readonly segmentsInternes: readonly string[];
}

const EPS = 1e-9;
/** Tolérance de détection des arêtes communes entre anneaux (m). */
export const TOLERANCE_ARETE_COMMUNE_M = 0.05;

export const pt = (x: number, y: number): Pt => ({ x, y });

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

export function closestPointOnSegment(p: Pt, a: Pt, b: Pt): Pt {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < EPS) return a;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return pt(a.x + t * dx, a.y + t * dy);
}

export function distancePointToSegment(p: Pt, a: Pt, b: Pt): number {
  const c = closestPointOnSegment(p, a, b);
  return Math.hypot(p.x - c.x, p.y - c.y);
}

export function distancePointToRing(p: Pt, ring: readonly Pt[]): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i += 1) {
    const d = distancePointToSegment(p, ring[i]!, ring[(i + 1) % ring.length]!);
    if (d < best) best = d;
  }
  return best;
}

/** Point strictement intérieur (lancer de rayon) ; le bord n'est pas garanti. */
export function pointInRing(p: Pt, ring: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Intersection de deux segments (contact compris), ou null. */
export function segmentIntersection(p1: Pt, p2: Pt, q1: Pt, q2: Pt): Pt | null {
  const rx = p2.x - p1.x;
  const ry = p2.y - p1.y;
  const sx = q2.x - q1.x;
  const sy = q2.y - q1.y;
  const denom = cross(rx, ry, sx, sy);
  if (Math.abs(denom) < EPS) return null;
  const qpx = q1.x - p1.x;
  const qpy = q1.y - p1.y;
  const t = cross(qpx, qpy, sx, sy) / denom;
  const u = cross(qpx, qpy, rx, ry) / denom;
  if (t < -1e-12 || t > 1 + 1e-12 || u < -1e-12 || u > 1 + 1e-12) return null;
  return pt(p1.x + t * rx, p1.y + t * ry);
}

/** Croisement PROPRE (les deux segments se traversent, hors extrémités). */
function croisementPropre(p1: Pt, p2: Pt, q1: Pt, q2: Pt): boolean {
  const rx = p2.x - p1.x;
  const ry = p2.y - p1.y;
  const sx = q2.x - q1.x;
  const sy = q2.y - q1.y;
  const denom = cross(rx, ry, sx, sy);
  if (Math.abs(denom) < EPS) return false;
  const qpx = q1.x - p1.x;
  const qpy = q1.y - p1.y;
  const t = cross(qpx, qpy, sx, sy) / denom;
  const u = cross(qpx, qpy, rx, ry) / denom;
  const m = 1e-9;
  return t > m && t < 1 - m && u > m && u < 1 - m;
}

export function closestBetweenSegments(
  a1: Pt,
  a2: Pt,
  b1: Pt,
  b2: Pt,
): { readonly distance: number; readonly onA: Pt; readonly onB: Pt; readonly crossing: boolean } {
  const hit = segmentIntersection(a1, a2, b1, b2);
  if (hit) return { distance: 0, onA: hit, onB: hit, crossing: true };
  const options = [
    { distance: distancePointToSegment(a1, b1, b2), onA: a1, onB: closestPointOnSegment(a1, b1, b2) },
    { distance: distancePointToSegment(a2, b1, b2), onA: a2, onB: closestPointOnSegment(a2, b1, b2) },
    { distance: distancePointToSegment(b1, a1, a2), onA: closestPointOnSegment(b1, a1, a2), onB: b1 },
    { distance: distancePointToSegment(b2, a1, a2), onA: closestPointOnSegment(b2, a1, a2), onB: b2 },
  ];
  let best = options[0]!;
  for (const o of options) if (o.distance < best.distance) best = o;
  return { ...best, crossing: best.distance < 1e-9 };
}

function sinusAngle(a1: Pt, a2: Pt, b1: Pt, b2: Pt): number {
  const ax = a2.x - a1.x;
  const ay = a2.y - a1.y;
  const bx = b2.x - b1.x;
  const by = b2.y - b1.y;
  const n = Math.hypot(ax, ay) * Math.hypot(bx, by);
  return n < EPS ? 1 : Math.abs(cross(ax, ay, bx, by)) / n;
}

/**
 * Anneau ouvert : retire seulement le point de fermeture (dernier = premier).
 * Les doublons intermédiaires sont conservés pour que l'indice d'arête reste
 * celui de l'éditeur (`parcelFrontEdgeIndex`) ; les arêtes nulles sont
 * ignorées par les calculs.
 */
export function anneauOuvert(ring: readonly Pt[]): Pt[] {
  const out = [...ring];
  while (out.length > 1) {
    const a = out[0]!;
    const b = out[out.length - 1]!;
    if (Math.hypot(a.x - b.x, a.y - b.y) <= 1e-9) out.pop();
    else break;
  }
  return out;
}

/**
 * R2 — portions de l'arête [a1, a2] recouvertes par un segment colinéaire
 * [b1, b2] d'un autre anneau, en abscisses curvilignes le long de a ; null si
 * aucun recouvrement de plus de `tol`.
 */
function recouvrement(a1: Pt, a2: Pt, b1: Pt, b2: Pt, tol: number): [number, number] | null {
  const len = Math.hypot(a2.x - a1.x, a2.y - a1.y);
  if (len < tol) return null;
  const ux = (a2.x - a1.x) / len;
  const uy = (a2.y - a1.y) / len;
  const dLine = (p: Pt): number => Math.abs(cross(ux, uy, p.x - a1.x, p.y - a1.y));
  if (dLine(b1) > tol || dLine(b2) > tol) return null;
  const proj = (p: Pt): number => (p.x - a1.x) * ux + (p.y - a1.y) * uy;
  const lo = Math.max(0, Math.min(proj(b1), proj(b2)));
  const hi = Math.min(len, Math.max(proj(b1), proj(b2)));
  return hi - lo > tol ? [lo, hi] : null;
}

/** R2 — intervalles internes fusionnés et calés sur les extrémités (tolérance `tol`). */
function intervallesInternes(len: number, bruts: Array<[number, number]>, tol: number): Array<[number, number]> {
  const tri = bruts
    .map(([lo, hi]) => [lo <= tol ? 0 : lo, hi >= len - tol ? len : hi] as [number, number])
    .sort((x, y) => x[0] - y[0]);
  const out: Array<[number, number]> = [];
  for (const iv of tri) {
    const last = out[out.length - 1];
    if (last && iv[0] <= last[1] + tol) last[1] = Math.max(last[1], iv[1]);
    else out.push([iv[0], iv[1]]);
  }
  return out;
}

export interface ClassementArete {
  readonly categorie: CategorieLimite;
  readonly origine: OrigineClassement;
}

/**
 * Segments de limite d'une parcelle à un ou plusieurs anneaux.
 * `classement(polygonIndex, edgeIndex)` donne la catégorie de chaque arête.
 */
export function construireSegments(
  anneaux: readonly (readonly Pt[])[],
  classement: (polygonIndex: number, edgeIndex: number, id: string) => ClassementArete,
): SegmentLimite[] {
  const rings = anneaux.map(anneauOuvert);
  const out: SegmentLimite[] = [];
  let index = 0;
  rings.forEach((ring, polygonIndex) => {
    if (ring.length < 3) return;
    for (let i = 0; i < ring.length; i += 1) {
      const start = ring[i]!;
      const end = ring[(i + 1) % ring.length]!;
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      if (length < 1e-6) continue;
      // R2 : seule la portion réellement commune avec un autre anneau est interne ;
      // le reste de l'arête demeure une limite extérieure.
      const bruts: Array<[number, number]> = [];
      rings.forEach((other, k) => {
        if (k === polygonIndex) return;
        for (let j = 0; j < other.length; j += 1) {
          const r = recouvrement(start, end, other[j]!, other[(j + 1) % other.length]!, TOLERANCE_ARETE_COMMUNE_M);
          if (r) bruts.push(r);
        }
      });
      const baseId = `p${polygonIndex}-e${i}`;
      const c = classement(polygonIndex, i, baseId);
      const internes = intervallesInternes(length, bruts, TOLERANCE_ARETE_COMMUNE_M);
      const morceaux: Array<{ lo: number; hi: number; interne: boolean }> = [];
      let t = 0;
      for (const [lo, hi] of internes) {
        if (lo - t > TOLERANCE_ARETE_COMMUNE_M) morceaux.push({ lo: t, hi: lo, interne: false });
        morceaux.push({ lo, hi, interne: true });
        t = hi;
      }
      if (length - t > TOLERANCE_ARETE_COMMUNE_M || morceaux.length === 0) morceaux.push({ lo: t, hi: length, interne: false });
      const ux = (end.x - start.x) / length;
      const uy = (end.y - start.y) / length;
      const at = (d: number): Pt => (d <= 0 ? start : d >= length ? end : pt(start.x + ux * d, start.y + uy * d));
      let nExt = 0;
      let nInt = 0;
      for (const m of morceaux) {
        let id: string;
        if (morceaux.length === 1) id = baseId;
        else if (m.interne) id = `${baseId}-i${++nInt}`;
        else id = ++nExt === 1 ? baseId : `${baseId}-${nExt}`;
        out.push({
          id, baseId, index, polygonIndex, edgeIndex: i, start: at(m.lo), end: at(m.hi), length: m.hi - m.lo,
          categorie: c.categorie, origineClassement: c.origine, interne: m.interne,
        });
        index += 1;
      }
    }
  });
  return out;
}

export function portionsFacade(buildingId: string, polygones: readonly (readonly Pt[])[]): PortionFacade[] {
  const out: PortionFacade[] = [];
  polygones.forEach((poly, polygonIndex) => {
    const ring = anneauOuvert(poly);
    const n = ring.length;
    if (n < 2) return;
    for (let i = 0; i < n; i += 1) {
      const start = ring[i]!;
      const end = ring[(i + 1) % n]!;
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      if (length < 1e-6) continue;
      out.push({ buildingId, polygonIndex, edgeIndex: i, start, end, length });
    }
  });
  return out;
}

/** Aire signée (formule du lacet) d'un anneau ouvert. */
export function aireSignee(ring: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function dansParcelle(p: Pt, rings: readonly Pt[][]): boolean {
  return rings.some((r) => pointInRing(p, r) || distancePointToRing(p, r) < 1e-6);
}

/**
 * L'emprise est-elle entièrement dans la parcelle ? Tous les sommets dans un
 * anneau (bord compris) et aucune arête ne traverse proprement une limite
 * extérieure (cas d'un angle rentrant de parcelle recouvert par le bâtiment).
 */
export function empriseDansParcelle(
  polygones: readonly (readonly Pt[])[],
  anneaux: readonly (readonly Pt[])[],
  segmentsExterieurs: readonly SegmentLimite[],
): boolean {
  const rings = anneaux.map(anneauOuvert).filter((r) => r.length >= 3);
  if (rings.length === 0 || polygones.length === 0) return false;
  for (const poly of polygones) {
    const ring = anneauOuvert(poly);
    if (ring.length < 3) return false;
    if (!ring.every((v) => dansParcelle(v, rings))) return false;
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      if (segmentsExterieurs.some((s) => croisementPropre(a, b, s.start, s.end))) return false;
      // milieu d'arête hors parcelle (arête qui passe par deux sommets de parcelle)
      if (!dansParcelle(pt((a.x + b.x) / 2, (a.y + b.y) / 2), rings)) return false;
    }
  }
  return true;
}

/**
 * Limites FRANCHIES par une emprise qui déborde (portage Studio R2/R3) :
 * chaque sommet d'emprise hors parcelle est rattaché à TOUS les segments
 * extérieurs les plus proches (à égalité : coin franchi en diagonale) ; un
 * sommet de parcelle recouvert par l'emprise rend franchis ses deux segments
 * adjacents. Profondeur = plus grande distance d'un tel sommet au segment.
 */
function depassementsParSegment(
  segmentsExterieurs: readonly SegmentLimite[],
  anneaux: readonly Pt[][],
  polygones: readonly (readonly Pt[])[],
): Map<string, number> {
  const out = new Map<string, number>();
  const noter = (id: string, prof: number): void => {
    out.set(id, Math.max(out.get(id) ?? 0, prof));
  };
  if (segmentsExterieurs.length === 0) return out;
  // R2 : profondeur = distance du sommet extérieur à la DROITE de la limite, du
  // côté extérieur (coin franchi en diagonale : 3 m au-delà de chaque limite, et
  // non la distance au coin) ; à défaut (côté intérieur de la droite), distance au segment.
  const orientation = anneaux.map((r) => Math.sign(aireSignee(r)) || 1);
  const profondeur = (v: Pt, s: SegmentLimite): number => {
    const len = Math.hypot(s.end.x - s.start.x, s.end.y - s.start.y);
    if (len < EPS) return distancePointToSegment(v, s.start, s.end);
    const c = cross(s.end.x - s.start.x, s.end.y - s.start.y, v.x - s.start.x, v.y - s.start.y) / len;
    const dehors = -c * (orientation[s.polygonIndex] ?? 1);
    return dehors > 1e-9 ? dehors : distancePointToSegment(v, s.start, s.end);
  };
  for (const polyBrut of polygones) {
    const poly = anneauOuvert(polyBrut);
    for (const v of poly) {
      if (dansParcelle(v, anneaux)) continue;
      const d = segmentsExterieurs.map((s) => distancePointToSegment(v, s.start, s.end));
      const bestD = Math.min(...d);
      segmentsExterieurs.forEach((s, i) => {
        if (d[i]! <= bestD + 1e-9) noter(s.id, profondeur(v, s));
      });
    }
    // sommets de limite (y compris extrémités de portions) recouverts par l'emprise :
    // le segment qui en part et celui qui y arrive sont franchis.
    for (const s of segmentsExterieurs) {
      const v = s.start;
      if (!pointInRing(v, poly) || distancePointToRing(v, poly) < 1e-9) continue;
      const prof = distancePointToRing(v, poly);
      noter(s.id, prof);
      for (const k of segmentsExterieurs) {
        if (k !== s && Math.hypot(k.end.x - v.x, k.end.y - v.y) < 1e-9) noter(k.id, prof);
      }
    }
  }
  return out;
}

export interface OptionsDistances {
  /** Produire le détail portion × segment (défaut : true). */
  readonly includePairs?: boolean;
}

export function distancesBatiment(
  segments: readonly SegmentLimite[],
  anneaux: readonly (readonly Pt[])[],
  batiment: ContourBatiment,
  options: OptionsDistances = {},
): RapportBatiment {
  const includePairs = options.includePairs ?? true;
  const exterieurs = segments.filter((s) => !s.interne);
  const rings = anneaux.map(anneauOuvert);
  const portions = portionsFacade(batiment.id, batiment.polygones);
  const pairs: DistancePortionLimite[] = [];
  const perSegment: DistanceBatimentLimite[] = [];
  for (const seg of exterieurs) {
    let best: DistanceBatimentLimite | null = null;
    for (const portion of portions) {
      const c = closestBetweenSegments(portion.start, portion.end, seg.start, seg.end);
      if (includePairs) {
        pairs.push({ portion, segmentId: seg.id, distance: c.distance, pointOnBuilding: c.onA, pointOnBoundary: c.onB });
      }
      const plusProche = best === null || c.distance < best.distance - 1e-9;
      const egalEtPlusParallele =
        best !== null &&
        Math.abs(c.distance - best.distance) <= 1e-9 &&
        sinusAngle(portion.start, portion.end, seg.start, seg.end) <
          sinusAngle(best.portion.start, best.portion.end, seg.start, seg.end) - 1e-12;
      if (plusProche || egalEtPlusParallele) {
        best = {
          buildingId: batiment.id,
          buildingName: batiment.nom,
          segmentId: seg.id,
          segmentIndex: seg.index,
          categorie: seg.categorie,
          distance: c.distance,
          distanceSignee: c.distance,
          pointOnBuilding: c.onA,
          pointOnBoundary: c.onB,
          portion,
          touchesBoundary: c.crossing,
          exceedsBoundary: false,
          outsideDepth: 0,
        };
      }
    }
    if (best) perSegment.push(best);
  }
  const insideParcel = empriseDansParcelle(batiment.polygones, rings, exterieurs);
  const depassements = insideParcel ? new Map<string, number>() : depassementsParSegment(exterieurs, rings, batiment.polygones);
  const minDistance = perSegment.length === 0 ? null : Math.min(...perSegment.map((d) => d.distance));
  return {
    buildingId: batiment.id,
    buildingName: batiment.nom,
    portions,
    pairs,
    perSegment: perSegment.map((d) => {
      const prof = depassements.get(d.segmentId);
      return prof === undefined ? d : { ...d, exceedsBoundary: true, outsideDepth: prof, distanceSignee: -prof };
    }),
    minDistance,
    insideParcel,
  };
}

export function calculerDistances(
  segments: readonly SegmentLimite[],
  anneaux: readonly (readonly Pt[])[],
  batiments: readonly ContourBatiment[],
  options: OptionsDistances = {},
): RapportDistances {
  return {
    buildings: batiments.map((b) => distancesBatiment(segments, anneaux, b, options)),
    anneauxParcelle: anneaux.filter((a) => anneauOuvert(a).length >= 3).length,
    segmentsInternes: segments.filter((s) => s.interne).map((s) => s.id),
  };
}
