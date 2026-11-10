// src/spaces/copilot/studio3d/bandePrincipale.ts
// =============================================================================
// BANDE PRINCIPALE — géométrie PURE (aucune I/O, aucun import exécuté), déterministe.
//
// Pourquoi (lot C7b, mission du 10/11/2026 à Montreuil) : dans un PLU « par bande », le bâtiment sur rue se
// construit dans la bande principale (les N premiers mètres depuis la voie), parallèlement à la voie.
// Le lot C7a sait où est le côté voie (coteVoie.ts) ; ce module donne à volumeParcelle.ts de quoi
//   · vérifier que la bande demandée est utilisable (côté voie identifié, même parcelle, profondeur lisible) ;
//   · connaître la direction de la voie ;
//   · dire si un rectangle est ENTIÈREMENT dans la bande.
//
// Les imports ci-dessous sont des types seulement : volumeParcelle.ts peut importer ce module sans boucle.
// Rien n'est supposé : une bande inutilisable est refusée avec sa raison, jamais « réparée ».
// =============================================================================

import type { PointLocal } from './volumeParcelle.ts';
import type { CoteVoie } from './coteVoie.ts';

/** Bande principale demandée à calculerVolumeParcelle (paramètre facultatif). */
export interface BandeVoie {
  /** Résultat de identifierCoteVoie pour LA MÊME géométrie de parcelle. */
  cote: CoteVoie;
  /** Profondeur de la bande principale depuis la voie, en mètres, lue dans le règlement. */
  profondeurM: number;
  /**
   * Emprise maximale autorisée dans la bande principale, en m² (empriseMaxParBande(...).principaleM2).
   * Absente : seul le coefficient d'emprise des règles borne l'emprise.
   */
  empriseMaxM2?: number | null;
}

/** Ce que le volume dit de la bande demandée (présent seulement quand une bande a été demandée). */
export interface BandeVolume {
  statut: 'appliquee' | 'non-appliquee';
  /** Bande non appliquée : la raison, lisible. null si elle est appliquée. */
  raison: string | null;
  profondeurM: number | null;
  /** Longueur de limite présumée sur voie, reprise du côté voie fourni. */
  longueurFacadeM: number | null;
  /** Direction de la voie, en degrés depuis l'est, dans [0, 180). */
  angleVoieDeg: number | null;
  /** Plus grande distance d'un sommet de l'emprise au côté voie (m, arrondie au centimètre supérieur). */
  distanceMaxVoieM: number | null;
  /** Plafond d'emprise fourni par l'appelant (m²), s'il y en a un. */
  empriseMaxM2: number | null;
  /**
   * Lot C7c : limites présumées sur voie (repère local de la parcelle), jointes par calculerVolumeProgramme
   * quand la bande est appliquée. Elles permettent de REVÉRIFIER le volume plus tard (verifierBandeVolume) :
   * un volume modifié dans la fiche garde ce champ, mais ses bâtiments peuvent être sortis de la bande.
   */
  facades?: FacadeLocale[];
}

export interface FacadeLocale { a: PointLocal; b: PointLocal }

export interface BandePreparee {
  facades: FacadeLocale[];
  profondeurM: number;
  longueurFacadeM: number;
  /** Direction de la voie en radians, dans [0, π). */
  angle: number;
  empriseMaxM2: number | null;
}

export type PreparationBande = { ok: true; bande: BandePreparee } | { ok: false; raison: string };

/** Écart toléré entre le côté voie fourni et le contour de la parcelle (même relevé : identiques au millimètre). */
export const TOLERANCE_FACADE_SUR_CONTOUR_M = 0.05;

const fr = (v: number, d = 1) => v.toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: 0 });

function distancePointSegment(p: PointLocal, a: PointLocal, b: PointLocal): number {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 > 1e-12 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Distance d'un point au côté voie (la plus proche des façades), en mètres. */
export function distanceVoie(p: PointLocal, facades: readonly FacadeLocale[]): number {
  let d = Infinity;
  for (const f of facades) d = Math.min(d, distancePointSegment(p, f.a, f.b));
  return d;
}

/**
 * Direction de la voie (radians, dans [0, π)) : moyenne des directions des façades, pondérée par leur longueur
 * (moyenne d'axes : deux segments de sens opposés comptent pour la même direction). Si les façades ne
 * s'accordent pas (parcelle d'angle à deux voies de même longueur), la direction de la plus longue est
 * retenue (la première en cas d'égalité). null sans façade mesurable.
 */
export function directionVoie(facades: readonly FacadeLocale[]): number | null {
  let sx = 0, sy = 0, total = 0, plusLongue = 0, anglePlusLongue = 0;
  for (const f of facades) {
    const l = Math.hypot(f.b.x - f.a.x, f.b.y - f.a.y);
    if (!(l > 1e-6)) continue;
    const a = Math.atan2(f.b.y - f.a.y, f.b.x - f.a.x);
    sx += l * Math.cos(2 * a); sy += l * Math.sin(2 * a); total += l;
    if (l > plusLongue + 1e-9) { plusLongue = l; anglePlusLongue = a; }
  }
  if (!(total > 0)) return null;
  const angle = Math.hypot(sx, sy) >= 0.2 * total ? Math.atan2(sy, sx) / 2 : anglePlusLongue;
  const norme = ((angle % Math.PI) + Math.PI) % Math.PI;
  // Un angle à un cheveu de π est le même axe que 0 : ramené à 0 pour rester déterministe.
  return Math.PI - norme < 1e-9 ? 0 : norme;
}

/**
 * La bande demandée est-elle utilisable pour cette parcelle ? `origine` et `contour` sont ceux de
 * projeterParcelle(geometrie) : le côté voie doit avoir été calculé sur la même géométrie.
 */
export function preparerBande(
  bande: BandeVoie | null | undefined,
  origine: { lon: number; lat: number },
  contour: readonly PointLocal[],
  coteMinM: number,
): PreparationBande {
  const non = (raison: string): PreparationBande => ({ ok: false, raison });
  const cote = bande?.cote;
  if (!bande || !cote || typeof cote !== 'object') return non('côté voie non fourni.');
  if (cote.statut !== 'identifie' || !Array.isArray(cote.facades) || !cote.facades.length) {
    return non(`côté voie non identifié${typeof cote.note === 'string' && cote.note ? ` (${cote.note.replace(/[.\s]+$/u, '')})` : ''}.`);
  }
  const p = bande.profondeurM;
  if (typeof p !== 'number' || !Number.isFinite(p) || p <= 0) return non('profondeur de la bande principale non fournie.');
  if (p < coteMinM) return non(`bande principale de ${fr(p)} m, moins profonde que le côté minimal constructible de ${fr(coteMinM)} m.`);
  const max = bande.empriseMaxM2;
  let empriseMaxM2: number | null = null;
  if (max !== undefined && max !== null) {
    if (typeof max !== 'number' || !Number.isFinite(max) || max <= 0) return non('emprise maximale de la bande principale illisible.');
    if (max < coteMinM * coteMinM) return non(`emprise maximale de la bande principale (${fr(max)} m²) inférieure au minimum constructible de ${fr(coteMinM * coteMinM)} m².`);
    empriseMaxM2 = max;
  }
  const o = cote.origine;
  if (!o || Math.abs(o.lon - origine.lon) > 1e-9 || Math.abs(o.lat - origine.lat) > 1e-9) return non('côté voie calculé pour une autre géométrie que celle de la parcelle.');
  const facades: FacadeLocale[] = [];
  for (const f of cote.facades) {
    const pts = [f?.a, f?.b];
    if (!pts.every((q) => q && Number.isFinite(q.x) && Number.isFinite(q.y))) return non('côté voie illisible.');
    for (const q of pts) {
      let d = Infinity;
      for (let i = 0; i < contour.length; i++) d = Math.min(d, distancePointSegment(q, contour[i], contour[(i + 1) % contour.length]));
      if (d > TOLERANCE_FACADE_SUR_CONTOUR_M) return non('côté voie calculé pour une autre géométrie que celle de la parcelle.');
    }
    if (Math.hypot(f.b.x - f.a.x, f.b.y - f.a.y) > 1e-6) facades.push({ a: { x: f.a.x, y: f.a.y }, b: { x: f.b.x, y: f.b.y } });
  }
  const angle = directionVoie(facades);
  if (angle === null) return non('côté voie illisible.');
  const longueurFacadeM = Math.round(facades.reduce((s, f) => s + Math.hypot(f.b.x - f.a.x, f.b.y - f.a.y), 0) * 100) / 100;
  return { ok: true, bande: { facades, profondeurM: p, longueurFacadeM, angle, empriseMaxM2 } };
}

/**
 * Le rectangle est-il ENTIÈREMENT à `profondeurM` au plus du côté voie ?
 * `coins` : les quatre coins dans l'ordre du contour (même repère que `facades`).
 *
 * Preuve sans échantillonnage : la zone à moins de D d'UN segment est convexe. Le rectangle est découpé en
 * tranches (coupes à l'aplomb des extrémités de façades) ; une tranche dont les quatre coins sont à moins de D
 * d'une même façade est tout entière dans la bande. Le test est donc sûr (jamais de faux « oui ») et peut
 * refuser un rectangle limite que seule la réunion de deux façades couvrirait.
 */
export function rectangleDansBande(coins: readonly PointLocal[], facades: readonly FacadeLocale[], profondeurM: number): boolean {
  if (coins.length !== 4 || !facades.length) return false;
  const limite = profondeurM + 1e-9;
  const [c0, c1, c2, c3] = coins;
  const couverts = (pts: readonly PointLocal[]) => facades.some((f) => pts.every((q) => distancePointSegment(q, f.a, f.b) <= limite));
  if (couverts(coins)) return true;
  // Chaque coin doit déjà être dans la bande (condition nécessaire, peu coûteuse).
  if (!coins.every((q) => distanceVoie(q, facades) <= limite)) return false;
  const ux = c1.x - c0.x, uy = c1.y - c0.y, l2 = ux * ux + uy * uy;
  if (!(l2 > 1e-12)) return false;
  const coupes = new Set<number>([0, 1]);
  for (const f of facades) for (const q of [f.a, f.b]) {
    const t = ((q.x - c0.x) * ux + (q.y - c0.y) * uy) / l2;
    if (t > 1e-9 && t < 1 - 1e-9) coupes.add(t);
  }
  const ts = [...coupes].sort((a, b) => a - b);
  const sur = (p: PointLocal, q: PointLocal, t: number) => ({ x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) });
  for (let i = 0; i + 1 < ts.length; i++) {
    if (!couverts([sur(c0, c1, ts[i]), sur(c0, c1, ts[i + 1]), sur(c3, c2, ts[i + 1]), sur(c3, c2, ts[i])])) return false;
  }
  return true;
}

/** Ce qui est lu d'un volume pour revérifier sa bande (sous-ensemble de VolumePropose). */
export interface VolumeAVerifier {
  bande?: BandeVolume;
  emprise: { largeurM: number; profondeurM: number; coins: readonly PointLocal[] } | null;
  batiments?: ReadonlyArray<{
    largeurM: number; profondeurM: number; coins: readonly PointLocal[];
    ailes?: ReadonlyArray<{ lu: number; lv: number; coins: readonly PointLocal[] }>;
  }>;
}

export interface VerificationBande {
  /** Vrai seulement si TOUS les rectangles bâtis sont prouvés dans la bande ET si leur emprise tient sous le plafond. */
  prouvee: boolean;
  /** Pourquoi ce n'est pas prouvé (phrase courte, sans point final) ; null si prouvé. */
  raison: string | null;
  /** Somme des emprises des rectangles bâtis (m²). */
  empriseM2: number;
  /** Plus grande distance d'un sommet bâti au côté voie (m, arrondie au centimètre supérieur) ; null si non mesurable. */
  distanceMaxVoieM: number | null;
}

/**
 * Lot C7c — vérification INDÉPENDANTE du placement : le volume tel qu'il est (bâtiments du moteur, ou modifiés
 * dans la fiche) est-il entièrement dans la bande principale, sous le plafond d'emprise de cette bande ?
 * Ne se fie pas à `bande.statut` seul : chaque rectangle bâti (aile par aile pour un bâtiment à ailes) est
 * repassé par rectangleDansBande (preuve sans faux « oui »). Sans façades dans le volume : non prouvé.
 */
export function verifierBandeVolume(v: VolumeAVerifier): VerificationBande {
  const rectangles: { coins: readonly PointLocal[]; aire: number }[] = [];
  const corps = v.batiments?.length ? v.batiments : v.emprise ? [v.emprise] : [];
  for (const c of corps) {
    const ailes = 'ailes' in c && c.ailes && c.ailes.length >= 2 ? c.ailes : null;
    if (ailes) for (const a of ailes) rectangles.push({ coins: a.coins, aire: a.lu * a.lv });
    else rectangles.push({ coins: c.coins, aire: c.largeurM * c.profondeurM });
  }
  const empriseM2 = rectangles.reduce((s, r) => s + r.aire, 0);
  const non = (raison: string, distanceMaxVoieM: number | null = null): VerificationBande => ({ prouvee: false, raison, empriseM2, distanceMaxVoieM });
  const b = v.bande;
  if (!b) return non('bande principale non demandée pour ce volume');
  if (b.statut !== 'appliquee') return non('bande principale non appliquée au volume');
  const facades = (b.facades ?? []).filter((f) => f && [f.a, f.b].every((q) => q && Number.isFinite(q.x) && Number.isFinite(q.y)));
  const p = b.profondeurM;
  if (!facades.length || typeof p !== 'number' || !Number.isFinite(p) || p <= 0) return non('côté voie absent du volume : bande non vérifiable');
  if (!rectangles.length) return non('aucun bâtiment à vérifier');
  let dehors = 0, distance = 0;
  for (const r of rectangles) {
    if (r.coins.length !== 4 || !r.coins.every((q) => q && Number.isFinite(q.x) && Number.isFinite(q.y))) { dehors++; continue; }
    for (const q of r.coins) distance = Math.max(distance, distanceVoie(q, facades));
    if (!rectangleDansBande(r.coins, facades, p)) dehors++;
  }
  const distanceMaxVoieM = Number.isFinite(distance) ? Math.ceil(distance * 100 - 1e-6) / 100 : null;
  if (dehors) {
    return non(`${dehors} emprise${dehors > 1 ? 's' : ''} bâtie${dehors > 1 ? 's' : ''} sur ${rectangles.length} non contenue${dehors > 1 ? 's' : ''} dans la bande principale de ${fr(p)} m`, distanceMaxVoieM);
  }
  if (b.empriseMaxM2 !== null && empriseM2 > b.empriseMaxM2 + 1e-6) {
    return non(`emprise de ${fr(empriseM2)} m² au-dessus du maximum de ${fr(b.empriseMaxM2)} m² de la bande principale`, distanceMaxVoieM);
  }
  return { prouvee: true, raison: null, empriseM2, distanceMaxVoieM };
}
