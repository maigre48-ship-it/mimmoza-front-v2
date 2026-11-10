// src/spaces/copilot/studio3d/coteVoie.ts
// =============================================================================
// CÔTÉ VOIE D'UNE PARCELLE ET BANDES DE CONSTRUCTIBILITÉ — logique PURE (aucune I/O), déterministe.
//
// Pourquoi (lot C7, mission du 10/11/2026 à Montreuil) : le règlement fixe des règles différentes dans la
// « bande principale » (les N premiers mètres depuis la voie) et dans la « bande secondaire ». Le volume
// d'étude ne savait pas où est la voie : il ne pouvait ni placer le bâtiment dans la bande, ni dire quelle
// surface de la parcelle s'y trouve.
//
// Principe : le domaine public (la voie) n'est pas cadastré. Une limite de la parcelle qui n'est mitoyenne
// d'AUCUNE autre parcelle donne donc sur la voie ou sur un espace public. On le déduit de la géométrie de la
// parcelle et de celle de ses voisines (API Carto cadastre), sans rien supposer d'autre.
//
// Limites, dites dans le résultat :
//   · sans les parcelles voisines, on ne conclut pas ;
//   · une limite non mitoyenne peut border autre chose qu'une voie (place, cours d'eau, emprise non cadastrée) :
//     le côté voie est « présumé », à confirmer ;
//   · les surfaces de bandes sont mesurées sur une grille (pas de 0,25 m), puis recalées sur la surface exacte.
//
// Lot C11 — sondage par PORTIONS d'arête. Avant : trois points par arête, et l'arête ENTIÈRE passait « sur voie »
// dès qu'un seul n'avait pas de voisine. Une limite en partie mitoyenne devenait une façade sur toute sa longueur ;
// avec l'alignement et l'implantation en limite, un bâtiment pouvait venir contre sa portion mitoyenne prise pour
// de la voie (ou, à l'inverse, une portion libre entre deux points sondés passait inaperçue). Maintenant chaque
// arête d'au moins 1 m est sondée tous les 0,5 m : seules ses portions libres (1 m au moins) sont des façades.
// Une arête entièrement libre reste UNE façade, de sommet à sommet (résultat inchangé) ; une arête en partie libre
// donne une façade plus courte que l'arête, que le moteur ne sait pas traiter en recul différencié : il garde alors
// le recul uniforme (marquerSegmentsVoie), ce qui est le comportement prudent.
// =============================================================================

import { aireSignee, dansPolygone, projeterParcelle, type GeometrieParcelle, type PointLocal } from './volumeParcelle.ts';

const M_PAR_DEGRE = 111_320;
/** Écart toléré entre deux relevés cadastraux d'une même limite (les sommets sont partagés au centimètre). */
export const TOLERANCE_MITOYENNETE_M = 0.5;
/** En dessous, une « façade » n'est qu'un décroché de relevé. */
export const FACADE_MIN_M = 3;
export const PAS_GRILLE_M = 0.25;
/** Lot C11 : pas du sondage d'une arête (m) et longueur minimale d'une portion libre retenue comme façade (m). */
export const PAS_SONDAGE_M = 0.5;
export const PORTION_LIBRE_MIN_M = 1;

export interface SegmentVoie { a: PointLocal; b: PointLocal; longueurM: number }

export interface CoteVoie {
  statut: 'identifie' | 'voisines_absentes' | 'aucune_facade' | 'contour_invalide';
  /** Origine de la projection locale (la même que projeterParcelle). */
  origine: { lon: number; lat: number } | null;
  /** Anneaux de la parcelle en mètres (extérieur, puis trous). */
  anneaux: PointLocal[][];
  /** Limites présumées sur voie, dans l'ordre du contour. */
  facades: SegmentVoie[];
  longueurFacadeM: number;
  nbVoisines: number;
  /** Phrase lisible : ce qui est établi et ce qui reste à confirmer. */
  note: string;
}

const dist = (p: PointLocal, q: PointLocal) => Math.hypot(p.x - q.x, p.y - q.y);

/** Distance d'un point à un segment, en mètres. */
export function distancePointSegment(p: PointLocal, a: PointLocal, b: PointLocal): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-12) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

const distanceAnneau = (p: PointLocal, anneau: PointLocal[]) => {
  let d = Infinity;
  for (let i = 0; i < anneau.length; i++) d = Math.min(d, distancePointSegment(p, anneau[i], anneau[(i + 1) % anneau.length]));
  return d;
};

/** Anneaux extérieurs de toutes les parties d'une géométrie, projetés autour de `origine`. */
function projeterAutour(g: GeometrieParcelle | null | undefined, origine: { lon: number; lat: number }): PointLocal[][] {
  if (!g) return [];
  const parties = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  const kx = M_PAR_DEGRE * Math.cos(origine.lat * Math.PI / 180);
  const out: PointLocal[][] = [];
  for (const partie of parties) {
    const ext = partie?.[0];
    if (!Array.isArray(ext) || ext.length < 4) continue;
    const pts = ext.filter((c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]))
      .map((c) => ({ x: (c[0] - origine.lon) * kx, y: (c[1] - origine.lat) * M_PAR_DEGRE }));
    if (pts.length >= 3) out.push(pts);
  }
  return out;
}

/**
 * Identifie les limites de la parcelle qui ne sont mitoyennes d'aucune voisine : le côté voie présumé.
 * `voisines` : les parcelles qui touchent ou entourent la parcelle (la parcelle elle-même peut y figurer, elle est ignorée
 * si sa géométrie est identique).
 */
export function identifierCoteVoie(parcelle: GeometrieParcelle | null | undefined, voisines: ReadonlyArray<GeometrieParcelle | null | undefined>): CoteVoie {
  const proj = projeterParcelle(parcelle);
  const vide = (statut: CoteVoie['statut'], note: string, nb = 0): CoteVoie =>
    ({ statut, origine: proj?.origine ?? null, anneaux: proj?.anneaux ?? [], facades: [], longueurFacadeM: 0, nbVoisines: nb, note });
  if (!proj || (proj.anneaux[0]?.length ?? 0) < 3) return vide('contour_invalide', 'Contour cadastral illisible : côté voie non déterminé.');
  const contour = proj.anneaux[0];
  const surface = Math.abs(aireSignee(contour));
  // Une « voisine » qui est la parcelle elle-même (même surface, même emprise) est écartée.
  const anneauxVoisins = voisines.flatMap((v) => projeterAutour(v, proj.origine)).filter((r) => {
    const memeSurface = Math.abs(Math.abs(aireSignee(r)) - surface) < 0.5;
    return !(memeSurface && contour.every((p) => distanceAnneau(p, r) < 0.05));
  });
  if (!anneauxVoisins.length) {
    return vide('voisines_absentes', 'Parcelles voisines non fournies : le côté voie ne peut pas être déduit du cadastre.');
  }
  const mitoyen = (p: PointLocal) => anneauxVoisins.some((r) => distanceAnneau(p, r) <= TOLERANCE_MITOYENNETE_M);
  /**
   * Lot C11 — point d'une arête à `s` mètres de son sommet le plus proche. Près d'un sommet, la voisine qui borde
   * l'arête SUIVANTE est forcément à moins de la tolérance : elle ne rend pas ce point mitoyen. La tolérance est
   * donc resserrée près des sommets (un quart de la distance au sommet, 5 cm au moins) : une limite réellement
   * partagée (écart de relevé de quelques centimètres) reste mitoyenne, une limite qui s'écarte du contour ne l'est pas.
   */
  const mitoyenPres = (p: PointLocal, s: number) => {
    const tol = Math.min(TOLERANCE_MITOYENNETE_M, Math.max(0.05, 0.25 * s));
    return anneauxVoisins.some((r) => distanceAnneau(p, r) <= tol);
  };
  const facades: SegmentVoie[] = [];
  for (let i = 0; i < contour.length; i++) {
    const a = contour[i], b = contour[(i + 1) % contour.length];
    const longueurM = dist(a, b);
    if (longueurM < 0.05) continue;
    const sur = (t: number): PointLocal => ({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
    if (longueurM < 1) {
      // Arête courte : un seul point, au milieu (inchangé).
      if (!mitoyen(sur(0.5))) facades.push({ a, b, longueurM });
      continue;
    }
    // Lot C11 : sondage tous les PAS_SONDAGE_M ; chaque suite de points libres est une portion libre de l'arête.
    const n = Math.max(3, Math.ceil(longueurM / PAS_SONDAGE_M));
    const libre = Array.from({ length: n }, (_, k) => {
      const t = (k + 0.5) / n;
      return !mitoyenPres(sur(t), Math.min(t, 1 - t) * longueurM);
    });
    for (let k = 0; k < n; k++) {
      if (!libre[k]) continue;
      let fin = k;
      while (fin + 1 < n && libre[fin + 1]) fin++;
      const t0 = k / n, t1 = (fin + 1) / n;
      if (t0 === 0 && t1 === 1) facades.push({ a, b, longueurM });
      else if ((t1 - t0) * longueurM >= PORTION_LIBRE_MIN_M - 1e-9) {
        const p = t0 === 0 ? a : sur(t0), q = t1 === 1 ? b : sur(t1);
        facades.push({ a: p, b: q, longueurM: dist(p, q) });
      }
      k = fin;
    }
  }
  const longueurFacadeM = Math.round(facades.reduce((s, f) => s + f.longueurM, 0) * 100) / 100;
  if (longueurFacadeM < FACADE_MIN_M) {
    return { ...vide('aucune_facade', 'Aucune limite libre de voisine : parcelle enclavée, ou voisines incomplètes. Côté voie non déterminé.', anneauxVoisins.length), facades: [] };
  }
  return {
    statut: 'identifie', origine: proj.origine, anneaux: proj.anneaux, facades, longueurFacadeM, nbVoisines: anneauxVoisins.length,
    note: `Côté voie présumé : ${String(longueurFacadeM).replace('.', ',')} m de limite sans parcelle mitoyenne (déduit du cadastre ; ` +
      'une limite libre peut aussi border un espace public non cadastré — à confirmer).',
  };
}

/** Distance d'un point au côté voie (la plus proche des limites sur voie), en mètres. */
export function distanceALaVoie(p: PointLocal, cote: Pick<CoteVoie, 'facades'>): number {
  let d = Infinity;
  for (const f of cote.facades) d = Math.min(d, distancePointSegment(p, f.a, f.b));
  return d;
}

export interface MesureBandes {
  profondeurM: number;
  surfaceParcelleM2: number;
  /** Part de la parcelle à moins de `profondeurM` de la voie. */
  bandePrincipaleM2: number;
  bandeSecondaireM2: number;
}

/**
 * Surface de la parcelle dans la bande principale (à `profondeurM` au plus de la voie) et au-delà.
 * Mesure sur grille, recalée sur la surface exacte du contour ; arrondie au m².
 */
export function mesurerBandes(cote: CoteVoie, profondeurM: number, pasM = PAS_GRILLE_M): MesureBandes | null {
  if (cote.statut !== 'identifie' || !(profondeurM > 0) || !(pasM > 0)) return null;
  const ext = cote.anneaux[0];
  const surface = Math.abs(aireSignee(ext)) - cote.anneaux.slice(1).reduce((s, t) => s + Math.abs(aireSignee(t)), 0);
  if (!(surface > 1)) return null;
  const xs = ext.map((p) => p.x), ys = ext.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  let dedans = 0, principale = 0;
  for (let x = x0 + pasM / 2; x < x1; x += pasM) {
    for (let y = y0 + pasM / 2; y < y1; y += pasM) {
      if (!dansPolygone(cote.anneaux, x, y)) continue;
      dedans++;
      if (distanceALaVoie({ x, y }, cote) <= profondeurM) principale++;
    }
  }
  if (!dedans) return null;
  const bandePrincipaleM2 = Math.round(surface * principale / dedans);
  const surfaceParcelleM2 = Math.round(surface);
  return { profondeurM, surfaceParcelleM2, bandePrincipaleM2, bandeSecondaireM2: surfaceParcelleM2 - bandePrincipaleM2 };
}

export interface EmpriseParBande {
  principaleM2: number;
  secondaireM2: number | null;
  /** Total des deux bandes ; null si le taux de la bande secondaire n'est pas connu. */
  totalM2: number | null;
  /** Total rapporté à la parcelle, en % (1 décimale) ; null comme `totalM2`. */
  tauxParcellePct: number | null;
}

/**
 * Emprise au sol maximale autorisée par une règle par bande, en m² (arrondie au m² inférieur).
 * C'est un PLAFOND réglementaire : reculs, gabarit sur voie, pleine terre et stationnement ne sont pas déduits.
 */
export function empriseMaxParBande(m: MesureBandes, tauxPrincipalPct: number, tauxSecondairePct: number | null): EmpriseParBande | null {
  const valide = (t: number | null) => t !== null && Number.isFinite(t) && t >= 0 && t <= 100;
  if (!valide(tauxPrincipalPct)) return null;
  const principaleM2 = Math.floor(m.bandePrincipaleM2 * tauxPrincipalPct / 100);
  if (!valide(tauxSecondairePct)) return { principaleM2, secondaireM2: null, totalM2: null, tauxParcellePct: null };
  const secondaireM2 = Math.floor(m.bandeSecondaireM2 * (tauxSecondairePct as number) / 100);
  const totalM2 = principaleM2 + secondaireM2;
  return { principaleM2, secondaireM2, totalM2, tauxParcellePct: m.surfaceParcelleM2 > 0 ? Math.round(totalM2 / m.surfaceParcelleM2 * 1000) / 10 : null };
}
