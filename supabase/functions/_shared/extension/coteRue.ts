// supabase/functions/_shared/extension/coteRue.ts
// =============================================================================
// LOT X10 (17/11/2026) — Côté rue d'une parcelle quand il n'a pas pu être déduit automatiquement. Module PUR.
//
// Quand le cadastre ne permet pas de situer la limite sur rue (pas de fiche de parcelle avec ses voisines, ou voisines
// indisponibles), le parcours d'extension ne doit plus s'arrêter sur une consigne impossible (« classez la limite sur
// rue »). Il propose, en puces, les CÔTÉS de la parcelle décrits simplement (« Au nord (limite de 18 m) ») ; le côté
// choisi par l'utilisateur devient la limite sur rue (statut « confirmée », source : saisie de l'utilisateur).
//
// Un « côté » regroupe les arêtes consécutives du contour cadastral presque alignées (écart ≤ 20°). Rien n'est
// inventé : les longueurs et les orientations sont calculées sur le contour cadastral (Lambert-93).
// =============================================================================

import { contourEnLambert93, type SommetL93 } from './bdtopoParcelle.ts';
import { lambert93VersWgs84 } from './lambert93.ts';

/** Écart d'orientation (°) en deçà duquel deux arêtes consécutives forment un même côté. */
export const ECART_MEME_COTE_DEG = 20;
/** Longueur minimale d'un côté proposé (m) : en deçà, ce n'est pas une limite sur rue plausible pour une maison. */
export const LONGUEUR_MIN_COTE_M = 3;
/** Nombre maximal de côtés proposés (les plus longs). */
export const COTES_PROPOSES_MAX = 5;

export interface SegmentWgs84 { readonly debut: readonly [number, number]; readonly fin: readonly [number, number] }

export interface CandidatCoteRue {
  /** Libellé de la puce, stable pour un même contour (« Au nord (limite de 18 m) »). */
  readonly libelle: string;
  /** Orientation de la limite vue depuis la parcelle (« nord », « sud-est »…). */
  readonly direction: string;
  readonly longueurM: number;
  /** Arêtes du contour cadastral qui forment ce côté (WGS 84). */
  readonly segments: readonly SegmentWgs84[];
}

const DIRECTIONS = ['est', 'nord-est', 'nord', 'nord-ouest', 'ouest', 'sud-ouest', 'sud', 'sud-est'] as const;
const PREFIXE: Readonly<Record<(typeof DIRECTIONS)[number], string>> = {
  est: 'À l’est', 'nord-est': 'Au nord-est', nord: 'Au nord', 'nord-ouest': 'Au nord-ouest',
  ouest: 'À l’ouest', 'sud-ouest': 'Au sud-ouest', sud: 'Au sud', 'sud-est': 'Au sud-est',
};

const fr = (v: number): string => String(Math.round(v)).replace('.', ',');
const r7 = (v: number): number => Math.round(v * 1e7) / 1e7;

/** Anneau sans point de fermeture répété. */
function anneauOuvert(c: readonly SommetL93[]): SommetL93[] {
  const a = [...c];
  while (a.length > 3 && a[0]![0] === a.at(-1)![0] && a[0]![1] === a.at(-1)![1]) a.pop();
  return a;
}

/**
 * Côtés de la parcelle, du plus long au plus court (au plus COTES_PROPOSES_MAX, chacun ≥ LONGUEUR_MIN_COTE_M).
 * Contour illisible (moins de 3 sommets) → liste vide.
 */
export function candidatsCoteRue(contourWgs84: readonly (readonly [number, number])[] | null): CandidatCoteRue[] {
  if (!contourWgs84 || contourWgs84.length < 3) return [];
  const pts = anneauOuvert(contourEnLambert93(contourWgs84));
  const n = pts.length;
  if (n < 3) return [];
  let aire2 = 0;
  for (let i = 0; i < n; i++) { const p = pts[i]!, q = pts[(i + 1) % n]!; aire2 += p[0] * q[1] - q[0] * p[1]; }
  if (aire2 === 0) return [];
  const sens = aire2 > 0 ? 1 : -1;   // +1 : anneau anti-horaire (normale extérieure = (dy, -dx))
  const aretes = pts.map((p, i) => {
    const q = pts[(i + 1) % n]!;
    const dx = q[0] - p[0], dy = q[1] - p[1];
    return { i, p, q, l: Math.hypot(dx, dy), angle: Math.atan2(dy, dx) };
  }).filter((a) => a.l > 0.05);
  if (aretes.length < 3) return [];
  const ecart = (a: number, b: number): number => { let d = Math.abs(a - b) % (2 * Math.PI); if (d > Math.PI) d = 2 * Math.PI - d; return d * 180 / Math.PI; };
  // Point de départ : une arête dont l'orientation diffère nettement de la précédente (sinon un côté serait coupé en deux).
  let debut = aretes.findIndex((a, k) => ecart(a.angle, aretes[(k - 1 + aretes.length) % aretes.length]!.angle) > ECART_MEME_COTE_DEG);
  if (debut < 0) debut = 0;
  const groupes: (typeof aretes)[] = [];
  for (let k = 0; k < aretes.length; k++) {
    const a = aretes[(debut + k) % aretes.length]!;
    const g = groupes.at(-1);
    if (g && ecart(a.angle, g[0]!.angle) <= ECART_MEME_COTE_DEG && ecart(a.angle, g.at(-1)!.angle) <= ECART_MEME_COTE_DEG) g.push(a);
    else groupes.push([a]);
  }
  const cotes = groupes.map((g) => {
    const longueur = g.reduce((s, a) => s + a.l, 0);
    // Orientation moyenne pondérée par la longueur, puis normale extérieure.
    const vx = g.reduce((s, a) => s + Math.cos(a.angle) * a.l, 0), vy = g.reduce((s, a) => s + Math.sin(a.angle) * a.l, 0);
    const nx = sens * vy, ny = -sens * vx;
    const deg = ((Math.atan2(ny, nx) * 180 / Math.PI) + 360) % 360;
    const direction = DIRECTIONS[Math.round(deg / 45) % 8]!;
    const segments: SegmentWgs84[] = g.map((a) => {
      const [lo1, la1] = lambert93VersWgs84(a.p[0], a.p[1]);
      const [lo2, la2] = lambert93VersWgs84(a.q[0], a.q[1]);
      return { debut: [r7(lo1), r7(la1)] as const, fin: [r7(lo2), r7(la2)] as const };
    });
    return { direction, longueurM: Math.round(longueur * 100) / 100, segments };
  }).filter((c) => c.longueurM >= LONGUEUR_MIN_COTE_M)
    .sort((a, b) => b.longueurM - a.longueurM)
    .slice(0, COTES_PROPOSES_MAX);
  // Libellés uniques : même orientation et même longueur arrondie → numéro d'ordre.
  const vus = new Map<string, number>();
  return cotes.map((c) => {
    let libelle = `${PREFIXE[c.direction as (typeof DIRECTIONS)[number]]} (limite de ${fr(c.longueurM)} m)`;
    const deja = vus.get(libelle) ?? 0;
    vus.set(libelle, deja + 1);
    if (deja) libelle = `${libelle.slice(0, -1)}, n° ${deja + 1})`;
    return { libelle, direction: c.direction, longueurM: c.longueurM, segments: c.segments };
  });
}

/** Candidat dont le libellé correspond à la réponse (comparaison sans accents ni casse). null sinon. */
export function candidatChoisi(candidats: readonly CandidatCoteRue[], reponse: string | null | undefined): CandidatCoteRue | null {
  if (!reponse) return null;
  const n = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
  const r = n(reponse);
  return candidats.find((c) => n(c.libelle) === r) ?? null;
}
