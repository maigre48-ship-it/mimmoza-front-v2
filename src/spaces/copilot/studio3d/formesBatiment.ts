// src/spaces/copilot/studio3d/formesBatiment.ts
// =============================================================================
// LOT FORMES-BATIMENT — formes supplémentaires du bâtiment (en L, en U, cour fermée,
// redans, plots multiples) : logique PURE (testée par formesBatiment.test.ts, node --test).
// Aucune I/O, aucun React.
//
// MODÈLE. Un bâtiment À AILES est une réunion de rectangles SANS RECOUVREMENT, tous dans
// le repère du bâtiment (u le long du grand côté `angleDeg`, v perpendiculaire vers la
// gauche — même repère que ficheDimensions.coinsDe et implantationProgramme). Chaque aile
// a une longueur HORS TOUT et une épaisseur saisies (ce qu'un promoteur mesure sur un plan),
// des niveaux propres ; le rectangle construit s'en déduit (`rectsAiles`) :
//   - en L      : A (longueur LA, à la base) + B (retour de LB hors tout, à gauche) ;
//   - en U      : A (fond) + B et C (retours à gauche et à droite) ;
//   - cour      : A et C (longs côtés, même longueur) + B et D (côtés, même longueur) ;
//   - redans    : segments accolés le long de u, chacun décalé du précédent de `decalageM`.
// Le Studio reçoit EXACTEMENT ces rectangles (contrat v2 `ailes`, archétype multi_wing).
//
// PLACEMENT (déterministe). Mêmes contraintes que le moteur du Dossier 3D
// (implantationProgramme.contraintesPlu sur reglesVolume) : recul pour la hauteur, emprise
// plafonnée, épaisseur maximale, niveaux maximaux, R+2 d'abord puis plus haut. Chaque aile
// doit tenir à ≥ recul de TOUTES les limites (rectTient, le test du moteur, tolérance 1 cm).
// La forme est dimensionnée pour la SDP visée (logements × 70 m²) et posée dans la parcelle
// (orientations du moteur, grille de centres, centre le plus « au milieu » des positions
// possibles). Distances entre façades d'une cour : max(H, 8 m), HYPOTHÈSE du moteur.
// Rien n'est présenté comme conforme.
// =============================================================================

import { contraintesPlu, HYPOTHESES_PROGRAMME, LIMITE_BATIMENTS_STUDIO } from './implantationProgramme.ts';
import { reglesVolume, type RegleLue } from './controlesVolume.ts';
import { HYPOTHESES_VOLUME, rectTient, segmentsDe, type FormeAiles, type PointLocal } from './volumeParcelle.ts';

const HP = HYPOTHESES_PROGRAMME;
const demiSup = (v: number) => Math.ceil(v * 2 - 1e-9) / 2;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Aile saisie : longueur HORS TOUT et épaisseur (m), niveaux (R+N → N+1). */
export interface AileSaisie { nom: string; longueurM: number; largeurM: number; niveaux: number }

/** Rectangle construit d'une aile, centré sur l'enveloppe du bâtiment (repère du bâtiment). */
export interface RectAile { index: number; nom: string; du: number; dv: number; lu: number; lv: number; niveaux: number }

/** Point du repère du bâtiment (u, v). */
export interface PointUV { u: number; v: number }

export const NB_AILES: Record<FormeAiles, number> = { l: 2, u: 3, cour: 4, redans: 3 };

/** Rôle lisible de chaque aile (fiche, Studio). */
export const ROLES_AILES: Record<FormeAiles, readonly string[]> = {
  l: ['base', 'retour'],
  u: ['fond', 'retour gauche', 'retour droit'],
  cour: ['grand côté', 'petit côté', 'grand côté opposé', 'petit côté opposé'],
  redans: ['segment', 'segment', 'segment'],
};

/** Contact minimal entre deux segments de redans (m) : en dessous, ce ne serait plus un seul bâtiment. */
export const CONTACT_REDANS_MIN_M = 4;
/** Ouverture minimale d'une cour ou d'un U (m) : en dessous, l'aile n'existe pas vraiment. */
export const OUVERTURE_MIN_M = 6;

const BORNE = { coteMin: HYPOTHESES_VOLUME.coteMinM, longueurMax: 120, largeurMax: 40, niveauxMax: HYPOTHESES_VOLUME.niveauxMaxStudio } as const;
const borne = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * Ailes rendues cohérentes avec la forme (déterministe) : bornes de saisie, côtés liés de la cour
 * (A = C, B = D en longueur), retours plus longs que l'épaisseur de la base, ouverture d'au moins 6 m.
 */
export function normaliserAiles(forme: FormeAiles, brut: readonly AileSaisie[], decalageM = 0): { ailes: AileSaisie[]; decalageM: number } {
  // Redans : 2 ou 3 segments ; les autres formes ont un nombre d'ailes fixe.
  const n = forme === 'redans' ? Math.max(2, Math.min(3, brut.length || 3)) : NB_AILES[forme];
  const src = Array.from({ length: n }, (_, i) => brut[i] ?? brut[brut.length - 1] ?? { nom: '', longueurM: 20, largeurM: 12, niveaux: 3 });
  const a = src.map((x, i): AileSaisie => ({
    nom: `Aile ${String.fromCharCode(65 + i)}`,
    longueurM: borne(Math.round(x.longueurM * 2) / 2, BORNE.coteMin, BORNE.longueurMax),
    largeurM: borne(Math.round(x.largeurM * 2) / 2, BORNE.coteMin, BORNE.largeurMax),
    niveaux: borne(Math.round(x.niveaux), 1, BORNE.niveauxMax),
  }));
  const min = (i: number, v: number) => { a[i] = { ...a[i], longueurM: Math.min(BORNE.longueurMax, Math.max(a[i].longueurM, demiSup(v))) }; };
  if (forme === 'l') { min(1, a[0].largeurM + OUVERTURE_MIN_M); min(0, a[1].largeurM + OUVERTURE_MIN_M); }
  if (forme === 'u') { min(1, a[0].largeurM + OUVERTURE_MIN_M); min(2, a[0].largeurM + OUVERTURE_MIN_M); min(0, a[1].largeurM + a[2].largeurM + OUVERTURE_MIN_M); }
  if (forme === 'cour') {
    a[2] = { ...a[2], longueurM: a[0].longueurM }; a[3] = { ...a[3], longueurM: a[1].longueurM };
    min(0, a[1].largeurM + a[3].largeurM + OUVERTURE_MIN_M); min(1, a[0].largeurM + a[2].largeurM + OUVERTURE_MIN_M);
    a[2] = { ...a[2], longueurM: a[0].longueurM }; a[3] = { ...a[3], longueurM: a[1].longueurM };
  }
  let d = 0;
  if (forme === 'redans') {
    const contact = Math.max(1, Math.min(...a.map((x) => x.largeurM)) - CONTACT_REDANS_MIN_M);
    const brutD = Number.isFinite(decalageM) ? Math.round(decalageM * 2) / 2 : 0;
    d = Math.sign(brutD || 1) * borne(Math.abs(brutD), 1, contact);
  }
  return { ailes: a, decalageM: d };
}

/**
 * Rectangles construits des ailes (sans recouvrement), centrés sur l'enveloppe, et dimensions de
 * l'enveloppe (lu le long de u, lv le long de v). Les ailes doivent être normalisées.
 */
export function rectsAiles(forme: FormeAiles, ailes: readonly AileSaisie[], decalageM = 0): { rects: RectAile[]; lu: number; lv: number } {
  // Repère provisoire : origine au coin bas-gauche de l'enveloppe ; [u0, u1] × [v0, v1].
  const b: { u0: number; u1: number; v0: number; v1: number }[] = [];
  const [A, B, C, D] = ailes;
  if (forme === 'l') {
    b.push({ u0: 0, u1: A.longueurM, v0: 0, v1: A.largeurM });
    b.push({ u0: 0, u1: B.largeurM, v0: A.largeurM, v1: B.longueurM });
  } else if (forme === 'u') {
    b.push({ u0: 0, u1: A.longueurM, v0: 0, v1: A.largeurM });
    b.push({ u0: 0, u1: B.largeurM, v0: A.largeurM, v1: B.longueurM });
    b.push({ u0: A.longueurM - C.largeurM, u1: A.longueurM, v0: A.largeurM, v1: C.longueurM });
  } else if (forme === 'cour') {
    const L = A.longueurM, W = B.longueurM;
    b.push({ u0: 0, u1: L, v0: 0, v1: A.largeurM });
    b.push({ u0: 0, u1: B.largeurM, v0: A.largeurM, v1: W - C.largeurM });
    b.push({ u0: 0, u1: L, v0: W - C.largeurM, v1: W });
    b.push({ u0: L - D.largeurM, u1: L, v0: A.largeurM, v1: W - C.largeurM });
  } else {
    let u = 0;
    ailes.forEach((x, i) => { b.push({ u0: u, u1: u + x.longueurM, v0: i * decalageM, v1: i * decalageM + x.largeurM }); u += x.longueurM; });
  }
  const u0 = Math.min(...b.map((r) => r.u0)), u1 = Math.max(...b.map((r) => r.u1));
  const v0 = Math.min(...b.map((r) => r.v0)), v1 = Math.max(...b.map((r) => r.v1));
  const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
  return {
    rects: b.map((r, i) => ({ index: i, nom: ailes[i].nom, du: r2((r.u0 + r.u1) / 2 - cu), dv: r2((r.v0 + r.v1) / 2 - cv), lu: r2(r.u1 - r.u0), lv: r2(r.v1 - r.v0), niveaux: ailes[i].niveaux })),
    lu: r2(u1 - u0), lv: r2(v1 - v0),
  };
}

/** Distances intérieures entre façades en vis-à-vis (U : entre les retours ; cour : les deux sens). */
export function visAVisInterieurs(forme: FormeAiles, ailes: readonly AileSaisie[]): { libelle: string; distanceM: number; niveaux: number }[] {
  const [A, B, C, D] = ailes;
  if (forme === 'u') return [{ libelle: 'entre les retours du U', distanceM: r2(A.longueurM - B.largeurM - C.largeurM), niveaux: Math.max(B.niveaux, C.niveaux) }];
  if (forme === 'cour') {
    return [
      { libelle: 'dans la cour, entre les petits côtés', distanceM: r2(A.longueurM - B.largeurM - D.largeurM), niveaux: Math.max(B.niveaux, D.niveaux) },
      { libelle: 'dans la cour, entre les grands côtés', distanceM: r2(B.longueurM - A.largeurM - C.largeurM), niveaux: Math.max(A.niveaux, C.niveaux) },
    ];
  }
  return [];
}

/** Côtés intérieurs (accolés à une autre aile sur toute leur longueur) : 0 = +v, 1 = −v, 2 = +u, 3 = −u. */
export function cotesInterieurs(forme: FormeAiles, index: number): number[] {
  if (forme === 'l' && index === 1) return [1];
  if (forme === 'u' && index > 0) return [1];
  if (forme === 'cour' && (index === 1 || index === 3)) return [0, 1];
  return [];
}

/**
 * Contour de la réunion de rectangles parallèles aux axes (repère du bâtiment) : boucles fermées,
 * extérieures dans le sens trigonométrique, cours intérieures dans le sens horaire. Sommets alignés retirés.
 */
export function contourRects(rects: readonly Pick<RectAile, 'du' | 'dv' | 'lu' | 'lv'>[]): PointUV[][] {
  const q = (x: number) => Math.round(x * 1000) / 1000;
  const bx = rects.map((r) => ({ u0: q(r.du - r.lu / 2), u1: q(r.du + r.lu / 2), v0: q(r.dv - r.lv / 2), v1: q(r.dv + r.lv / 2) }));
  const us = [...new Set(bx.flatMap((r) => [r.u0, r.u1]))].sort((a, b) => a - b);
  const vs = [...new Set(bx.flatMap((r) => [r.v0, r.v1]))].sort((a, b) => a - b);
  const plein = (i: number, j: number) => {
    if (i < 0 || j < 0 || i >= us.length - 1 || j >= vs.length - 1) return false;
    const cu = (us[i] + us[i + 1]) / 2, cv = (vs[j] + vs[j + 1]) / 2;
    return bx.some((r) => cu > r.u0 && cu < r.u1 && cv > r.v0 && cv < r.v1);
  };
  // Arêtes orientées (intérieur à gauche) entre sommets de la grille.
  const aretes = new Map<string, [number, number][]>();
  const cle = (i: number, j: number) => `${i},${j}`;
  const ajoute = (a: [number, number], b: [number, number]) => { const k = cle(...a); if (!aretes.has(k)) aretes.set(k, []); aretes.get(k)!.push(b); };
  for (let i = 0; i < us.length - 1; i++) for (let j = 0; j < vs.length - 1; j++) {
    if (!plein(i, j)) continue;
    if (!plein(i, j - 1)) ajoute([i, j], [i + 1, j]);
    if (!plein(i + 1, j)) ajoute([i + 1, j], [i + 1, j + 1]);
    if (!plein(i, j + 1)) ajoute([i + 1, j + 1], [i, j + 1]);
    if (!plein(i - 1, j)) ajoute([i, j + 1], [i, j]);
  }
  const boucles: PointUV[][] = [];
  for (;;) {
    const depart = [...aretes.entries()].find(([, l]) => l.length > 0);
    if (!depart) break;
    const [k0] = depart;
    const [i0, j0] = k0.split(',').map(Number) as [number, number];
    const pts: [number, number][] = [[i0, j0]];
    let cur: [number, number] = [i0, j0];
    for (let garde = 0; garde < 10_000; garde++) {
      const l = aretes.get(cle(...cur))!;
      const nxt = l.shift()!;
      if (nxt[0] === i0 && nxt[1] === j0) break;
      pts.push(nxt); cur = nxt;
    }
    // Sommets alignés retirés.
    const p = pts.map(([i, j]) => ({ u: us[i], v: vs[j] }));
    const net = p.filter((c, k) => {
      const a = p[(k - 1 + p.length) % p.length], b = p[(k + 1) % p.length];
      return Math.abs((c.u - a.u) * (b.v - c.v) - (c.v - a.v) * (b.u - c.u)) > 1e-9;
    });
    if (net.length >= 3) boucles.push(net);
  }
  const aire = (b: PointUV[]) => b.reduce((s, p, k) => { const n = b[(k + 1) % b.length]; return s + p.u * n.v - n.u * p.v; }, 0) / 2;
  return boucles.sort((a, b) => aire(b) - aire(a));
}

/** Repère du bâtiment → repère local de la parcelle (x est, y nord). */
export function versLocal(centre: PointLocal, angleDeg: number, p: PointUV): PointLocal {
  const a = angleDeg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  return { x: centre.x + p.u * ca - p.v * sa, y: centre.y + p.u * sa + p.v * ca };
}

/** Coins d'un rectangle du repère du bâtiment, dans le repère local. */
export function coinsRect(centre: PointLocal, angleDeg: number, r: Pick<RectAile, 'du' | 'dv' | 'lu' | 'lv'>): PointLocal[] {
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([su, sv]) => versLocal(centre, angleDeg, { u: r.du + su * r.lu / 2, v: r.dv + sv * r.lv / 2 }));
}

// ── Placement dans la parcelle ─────────────────────────────────────────────────
export type FormeCalculee = FormeAiles | 'plots';

/** Contexte du moteur : contour, orientation du moteur, règles de la conception, programme visé. */
export interface ContexteForme {
  contour: PointLocal[];
  /** Angle du grand côté retenu par le moteur (degrés depuis l'est). */
  angleDeg: number;
  surfaceParcelleM2: number;
  regles: readonly RegleLue[];
  gabaritNiveaux: number | null;
  /** SDP visée (m²) : logements visés × 70 m², sinon la SDP du volume du moteur. */
  sdpViseeM2: number;
}

/** Un bâtiment placé : rectangle (plots) ou bâtiment à ailes. */
export interface CorpsPlace {
  centre: PointLocal;
  angleDeg: number;
  longueurM: number;
  largeurM: number;
  niveaux: number;
  ailes: AileSaisie[] | null;
  decalageM: number;
}

export interface PlacementForme {
  forme: FormeCalculee;
  corps: CorpsPlace[];
  niveaux: number;
  reculM: number;
  /** Faux : la SDP visée ne tient pas avec cette forme (plus grande capacité trouvée). */
  atteint: boolean;
  /** Raison quand aucune position n'a été trouvée. */
  raison: string | null;
}

interface Piece { du: number; dv: number; lu: number; lv: number }
interface Gabarit { pieces: Piece[]; lu: number; lv: number; corps: (centre: PointLocal, angleDeg: number) => CorpsPlace[]; emprise: number }

const tourner = (p: PointLocal, a: number): PointLocal => ({ x: p.x * Math.cos(-a) - p.y * Math.sin(-a), y: p.x * Math.sin(-a) + p.y * Math.cos(-a) });

/**
 * Épaisseurs essayées pour les ailes d'un U ou d'une cour : celle du moteur (épaisseur maximale PLU, sinon 16 m),
 * puis 80 % de celle-ci (≈ 12,5 m) pour ouvrir la cour à emprise égale — hypothèse du moteur, modifiable aile par aile.
 */
const epaisseursCour = (e: number) => [...new Set([e, Math.max(HYPOTHESES_VOLUME.coteMinM, Math.floor(0.8 * e * 2) / 2)])];

/** Gabarits candidats d'une forme pour une emprise visée E (épaisseur e, H = hauteur), du plus souhaitable au moins souhaitable. */
function gabarits(forme: FormeCalculee, E: number, e: number, n: number): Gabarit[] {
  const H = n * HYPOTHESES_VOLUME.hauteurEtageM;
  const ecart = Math.max(H, HP.distanceFacadesMinM);
  const Lmax = HP.longueurBarreMaxM;
  const out: Gabarit[] = [];
  const aile = (longueurM: number, largeurM = e): AileSaisie => ({ nom: '', longueurM, largeurM, niveaux: n });
  const ajouteAiles = (f: FormeAiles, ailes: AileSaisie[], d = 0) => {
    if (ailes.some((x) => x.longueurM > Lmax + 1e-9)) return;
    const nz = normaliserAiles(f, ailes, d);
    const { rects, lu, lv } = rectsAiles(f, nz.ailes, nz.decalageM);
    out.push({
      pieces: rects.map((r) => ({ du: r.du, dv: r.dv, lu: r.lu, lv: r.lv })), lu, lv,
      emprise: rects.reduce((s, r) => s + r.lu * r.lv, 0),
      corps: (centre, angleDeg) => [{ centre, angleDeg, longueurM: lu, largeurM: lv, niveaux: n, ailes: nz.ailes, decalageM: nz.decalageM }],
    });
  };
  if (forme === 'l') {
    for (const rho of [1, 0.75, 1.33, 0.55, 1.8]) {
      const S = E / e + e;
      const LA = Math.max(e + OUVERTURE_MIN_M, demiSup(S / (1 + rho))), LB = Math.max(e + OUVERTURE_MIN_M, demiSup(S - LA + 1e-9));
      ajouteAiles('l', [aile(LA), aile(LB)]);
    }
  } else if (forme === 'u') {
    // Retours d'au moins une épaisseur au-delà du fond ; ailes à l'épaisseur du moteur ou à 80 % (cour plus ouverte).
    for (const ep of epaisseursCour(e)) for (const rho of [0.6, 0.8, 0.45, 1]) {
      const LA = Math.max(2 * ep + ecart, demiSup((E / ep + 2 * ep) / (1 + 2 * rho)));
      const LB = Math.max(2 * ep, demiSup((E / ep + 2 * ep - LA) / 2));
      ajouteAiles('u', [aile(LA, ep), aile(LB, ep), aile(LB, ep)]);
    }
  } else if (forme === 'cour') {
    for (const ep of epaisseursCour(e)) for (const rho of [1, 0.8, 1.25, 0.65]) {
      const S = E / (2 * ep) + 2 * ep;
      const L = Math.max(2 * ep + ecart, demiSup(S / (1 + rho)));
      const W = Math.max(2 * ep + ecart, demiSup(S - L));
      ajouteAiles('cour', [aile(L, ep), aile(W, ep), aile(L, ep), aile(W, ep)]);
    }
  } else if (forme === 'redans') {
    for (const k of [3, 2]) for (const signe of [1, -1]) {
      const Ls = Math.max(HP.longueurMinCollectifM, demiSup(E / (k * e)));
      ajouteAiles('redans', Array.from({ length: k === 3 ? 3 : 2 }, () => aile(Ls)), signe * Math.round(e / 2 * 2) / 2);
    }
  } else {
    // Plots multiples : rectangles compacts (longueur ≤ 1,4 × épaisseur), en grille ; pignons à ≥ max(H/2, 6 m),
    // façades à ≥ max(H, 8 m) (hypothèses du moteur).
    const gu = Math.max(H / 2, HP.distancePignonsMinM), gv = ecart;
    for (const p of [e, demiSup(1.2 * e), Math.floor(1.4 * e * 2) / 2]) {
      const k = Math.max(2, Math.ceil(E / (p * e) - 1e-9));
      if (k > LIMITE_BATIMENTS_STUDIO) continue;
      for (let rangs = 1; rangs <= Math.min(k, 4); rangs++) {
        const cols = Math.ceil(k / rangs);
        const lu = cols * p + (cols - 1) * gu, lv = rangs * e + (rangs - 1) * gv;
        const pieces: Piece[] = [];
        for (let j = 0; j < rangs; j++) for (let i = 0; i < cols && pieces.length < k; i++) {
          pieces.push({ du: -lu / 2 + p / 2 + i * (p + gu), dv: -lv / 2 + e / 2 + j * (e + gv), lu: p, lv: e });
        }
        out.push({
          pieces, lu, lv, emprise: pieces.length * p * e,
          corps: (centre, angleDeg) => pieces.map((q) => ({
            centre: versLocal(centre, angleDeg, { u: q.du, v: q.dv }), angleDeg, longueurM: p, largeurM: e, niveaux: n, ailes: null, decalageM: 0,
          })),
        });
      }
    }
  }
  return out;
}

interface Cadre { anneaux: PointLocal[][]; segments: ReturnType<typeof segmentsDe>; a: number; u0: number; u1: number; v0: number; v1: number }
function cadre(contour: PointLocal[], angleDeg: number): Cadre {
  const a = angleDeg * Math.PI / 180;
  const anneau = contour.map((p) => tourner(p, a));
  const us = anneau.map((p) => p.x), vs = anneau.map((p) => p.y);
  const anneaux = [anneau];
  return { anneaux, segments: segmentsDe(anneaux), a, u0: Math.min(...us), u1: Math.max(...us), v0: Math.min(...vs), v1: Math.max(...vs) };
}

/** Tolérance de 1 cm sur le recul, comme le moteur (implantationProgramme.TOLERANCE_M). */
const TOLERANCE_M = 0.01;
const tient = (k: Cadre, cu: number, cv: number, pieces: readonly Piece[], recul: number) =>
  pieces.every((p) => rectTient(k.anneaux, k.segments, { cu: cu + p.du, cv: cv + p.dv, w: p.lu, d: p.lv }, Math.max(1e-6, recul - TOLERANCE_M)));

/** Positions possibles du gabarit (grille de centres) ; null si aucune. Retient la plus centrale. */
function poser(k: Cadre, g: Gabarit, recul: number): { cu: number; cv: number; places: number } | null {
  const a0 = k.u0 + recul + g.lu / 2, a1 = k.u1 - recul - g.lu / 2, b0 = k.v0 + recul + g.lv / 2, b1 = k.v1 - recul - g.lv / 2;
  if (a1 < a0 - 1e-9 || b1 < b0 - 1e-9) return null;
  const pas = Math.max(1, Math.max(a1 - a0, b1 - b0) / 40);
  const ok: { cu: number; cv: number }[] = [];
  for (let cu = a0; cu <= a1 + 1e-9; cu += pas) for (let cv = b0; cv <= b1 + 1e-9; cv += pas) if (tient(k, cu, cv, g.pieces, recul)) ok.push({ cu, cv });
  if (!ok.length) return null;
  const mu = ok.reduce((s, p) => s + p.cu, 0) / ok.length, mv = ok.reduce((s, p) => s + p.cv, 0) / ok.length;
  const c = ok.reduce((m, p) => (Math.hypot(p.cu - mu, p.cv - mv) < Math.hypot(m.cu - mu, m.cv - mv) ? p : m));
  return { cu: Math.round(c.cu * 100) / 100, cv: Math.round(c.cv * 100) / 100, places: ok.length };
}

const ORIENTATIONS: Record<FormeCalculee, number[]> = { l: [0, 90, 180, 270], u: [0, 90, 180, 270], redans: [0, 90, 180, 270], cour: [0, 90], plots: [0, 90] };

/**
 * Place la forme dans la parcelle pour la SDP visée : R+2 d'abord (comme le moteur), puis plus haut ;
 * à niveaux égaux, la plus petite emprise, puis la position la plus libre. Programme hors d'atteinte :
 * la plus grande emprise qui tient au nombre maximal de niveaux (atteint = false).
 */
export function placerForme(ctx: ContexteForme, forme: FormeCalculee): PlacementForme {
  const ct = contraintesPlu(reglesVolume([...ctx.regles], ctx.gabaritNiveaux));
  const e = Math.max(HYPOTHESES_VOLUME.coteMinM, ct.epaisseurMax);
  const nMax = Math.max(1, ct.niveauxMax);
  const depart = Math.min(HP.niveauxCollectifDepart, nMax);
  const empriseMax = ct.ratioEmprise * ctx.surfaceParcelleM2;
  const cadres = new Map<number, Cadre>();
  const cadreDe = (deg: number) => { const c = ((Math.round(deg * 10) % 3600) + 3600) % 3600; if (!cadres.has(c)) cadres.set(c, cadre(ctx.contour, c / 10)); return cadres.get(c)!; };
  const essayer = (n: number, E: number) => {
    const recul = ct.reculPour(n * HYPOTHESES_VOLUME.hauteurEtageM);
    let meilleur: { g: Gabarit; deg: number; pose: NonNullable<ReturnType<typeof poser>> } | null = null;
    for (const g of gabarits(forme, E, e, n)) {
      if (g.emprise > empriseMax + 1e-6) continue;
      if (meilleur && g.emprise > meilleur.g.emprise + 1e-6) continue;
      for (const o of ORIENTATIONS[forme]) {
        const deg = ctx.angleDeg + o;
        const pose = poser(cadreDe(deg), g, recul);
        if (!pose) continue;
        if (!meilleur || g.emprise < meilleur.g.emprise - 1e-6 || pose.places > meilleur.pose.places) meilleur = { g, deg, pose };
      }
    }
    if (!meilleur) return null;
    const k = cadreDe(meilleur.deg);
    const centre = tourner({ x: meilleur.pose.cu, y: meilleur.pose.cv }, -k.a);
    const deg = Math.round((((meilleur.deg % 360) + 360) % 360) * 10) / 10;
    return { corps: meilleur.g.corps({ x: r2(centre.x), y: r2(centre.y) }, deg), recul };
  };
  for (let n = depart; n <= nMax; n++) {
    const r = essayer(n, ctx.sdpViseeM2 / n);
    if (r) return { forme, corps: r.corps, niveaux: n, reculM: r.recul, atteint: true, raison: null };
  }
  // Hors d'atteinte : emprise décroissante au nombre maximal de niveaux.
  for (let i = 1; i <= 24; i++) {
    const r = essayer(nMax, ctx.sdpViseeM2 / nMax * Math.pow(0.88, i));
    if (r) return { forme, corps: r.corps, niveaux: nMax, reculM: r.recul, atteint: false, raison: null };
  }
  return { forme, corps: [], niveaux: depart, reculM: ct.reculPour(depart * HYPOTHESES_VOLUME.hauteurEtageM), atteint: false,
    raison: 'Cette forme ne tient pas dans la parcelle avec les reculs et l’épaisseur du moteur.' };
}

// ── Aperçu 3D du brief (carte « Brief créatif ») ──────────────────────────────────
/** Boîte de l'aperçu (même forme que briefCreatif.CorpsApercu, arrondie au décimètre). */
export interface BoiteApercu { cx: number; cy: number; l: number; p: number; a: number; n: number; int?: number[] }

/**
 * Boîtes de l'aperçu d'un bâtiment : une par aile pour un bâtiment à ailes (côtés accolés marqués
 * `int` : ni façade ni retrait d'attique), sinon son rectangle. Utilisée par la fiche
 * (ficheDimensions.apercuDepuisEvaluation) ET par le serveur (studio.ts::apercuVolume) : même aperçu.
 */
export function boitesApercu(c: {
  centre: PointLocal; angleDeg: number; largeurM: number; profondeurM: number; niveaux: number;
  ailes?: readonly { du: number; dv: number; lu: number; lv: number; niveaux: number }[] | null; formeAiles?: FormeAiles | null;
}): BoiteApercu[] {
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const n = (x: number) => Math.max(1, Math.min(60, Math.round(x)));
  if (!c.ailes || c.ailes.length < 2 || !c.formeAiles) {
    return [{ cx: r1(c.centre.x), cy: r1(c.centre.y), l: r1(c.largeurM), p: r1(c.profondeurM), a: r1(c.angleDeg), n: n(c.niveaux) }];
  }
  const forme = c.formeAiles;
  return c.ailes.map((a, i) => {
    const q = versLocal(c.centre, c.angleDeg, { u: a.du, v: a.dv });
    const int = cotesInterieurs(forme, i);
    return { cx: r1(q.x), cy: r1(q.y), l: r1(a.lu), p: r1(a.lv), a: r1(c.angleDeg), n: n(a.niveaux), ...(int.length ? { int } : {}) };
  });
}
