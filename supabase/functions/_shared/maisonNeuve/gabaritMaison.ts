// supabase/functions/_shared/maisonNeuve/gabaritMaison.ts
// =============================================================================
// LOT G10 (18/11/2026) — Gabarit d'une MAISON INDIVIDUELLE NEUVE sur une parcelle. Module PUR, déterministe.
//
// Le LLM ne calcule rien et ne place rien : ce moteur reçoit la parcelle (repère de scène, mètres), ses limites
// classées (voie / séparative / fond), les règles connues (fiche Mimmoza ; absentes = SUPPOSÉES et dites) et la
// demande (surface habitable, niveaux, toit), puis :
//   1. déduit l'emprise d'un rectangle (proportion et ratio habitable / emprise SUPPOSÉS, dits) ;
//   2. le place au plus près de la rue, centré, façade longue parallèle à la rue (puis tourné d'un quart si besoin),
//      en respectant chaque recul au millimètre près (distance mesurée à chaque limite) ;
//   3. vérifie l'emprise au sol maximale et la hauteur maximale quand elles sont connues ;
//   4. refuse en le disant (cause et vraie action), et propose ce qui passe : passer à R+1, ou la plus grande surface
//      habitable possible de plain-pied / sur 2 niveaux.
// Gabarit d'une maison individuelle : R+1 au plus (jamais un immeuble).
// =============================================================================

import type { Donnee, FormeToit, StatutDonnee } from '../extension/contrat.ts';
import { aire, dedans, type Pt } from '../extension/geometrie.ts';
import type { NiveauxMaison } from './instructionsMaison.ts';

export type CategorieLimite = 'voie' | 'separative' | 'fond';

export interface ParcelleMaison {
  /** Contour dans le repère de scène (m), ordre quelconque. */
  readonly contour: readonly Pt[];
  readonly surfaceM2?: number | null;
  /** `categories[i]` : limite contour[i] → contour[i+1] (null : non classée). */
  readonly categories: readonly (CategorieLimite | null)[];
}

export interface ReglesMaison {
  readonly voieM?: Donnee<number>;
  readonly limitesSeparativesM?: Donnee<number>;
  readonly fondM?: Donnee<number>;
  /** Coefficient d'emprise au sol, 0..1. */
  readonly cesMax?: Donnee<number>;
  /** Hauteur maximale (m), comparée au faîtage (cas le plus contraignant ; dit). */
  readonly hauteurMaxM?: Donnee<number>;
}

export interface EntreeGabaritMaison {
  readonly parcelle: ParcelleMaison;
  readonly regles: ReglesMaison;
  readonly surfaceHabitableM2: Donnee<number>;
  readonly niveaux: Donnee<NiveauxMaison>;
  readonly toit: Donnee<FormeToit>;
  /** Pente du toit (°) ; absente : SUPPOSÉE (REGLES_MAISON.penteDeg). */
  readonly penteDeg?: Donnee<number>;
}

/** Hypothèses SUPPOSÉES (aucune n'est une mesure) ; chacune est rappelée dans le résultat quand elle sert. */
export const REGLES_MAISON = {
  /** Surface habitable ≈ 82 % de l'emprise au sol par niveau (murs, cloisons, gaines). SUPPOSÉ. */
  ratioHabitableEmprise: 0.82,
  /** Rectangle : longueur = 1,5 × largeur. SUPPOSÉ (pavillon courant). */
  proportion: 1.5,
  /** Largeur au-delà de laquelle une maison courante n'est plus portée simplement : 11 m. SUPPOSÉ. */
  largeurMaxM: 11,
  /** Largeur minimale d'une maison rendue plus étroite pour tenir sous la hauteur maximale : 6 m. SUPPOSÉ. */
  largeurMinM: 6,
  /** Longueur au plus 2,5 × la largeur. SUPPOSÉ. */
  allongementMax: 2.5,
  /**
   * LOT G10b — hauteurs de CONSTRUCTION de la maison dessinée (image et plans : même modèle 3D). Ce sont les conventions
   * de la machine de rendu Mimmoza pour une maison individuelle, relevées sur la maison construite (test Studio
   * « maisonNeuve.test.ts ») : rez-de-chaussée 3,30 m, étage 2,80 m, dalles 0,22 m, débord de toit 0,40 m, pente 35°,
   * acrotère 0,90 m (toit plat). SUPPOSÉES (aucune n'est une mesure) et dites.
   */
  hauteurRdcM: 3.3,
  hauteurEtageM: 2.8,
  dalleM: 0.22,
  debordToitM: 0.4,
  acrotereM: 0.9,
  penteDeg: 35,
  /** Recul à la voie faute de règle lue : 4 m. SUPPOSÉ (même valeur que le moteur d'extension). */
  reculVoieSupposeM: 4,
  /** Limites séparatives et fond faute de règle lue : H/2, 3 m au moins (règle nationale, art. R111-17). */
  reculMinRnuM: 3,
  epaisseurMursM: 0.25,
  tremieM2: 3,
  pasRechercheM: 0.25,
  niveauxMax: 2 as NiveauxMaison,
} as const;

export interface ReculMaison {
  readonly limite: number;
  readonly categorie: CategorieLimite | null;
  readonly requis: Donnee<number>;
  /** Distance mesurée entre la maison et la limite (m). */
  readonly mesureM: number;
}

export interface GabaritMaison {
  readonly coins: readonly Pt[];
  readonly longueurM: number;
  readonly largeurM: number;
  readonly empriseM2: number;
  readonly niveaux: Donnee<NiveauxMaison>;
  readonly egoutM: Donnee<number>;
  readonly faitageM: Donnee<number>;
  readonly toit: Donnee<FormeToit>;
  readonly penteDeg: Donnee<number>;
  /** Surface de plancher estimée (m²) et sa fourchette. */
  readonly surfacePlancherM2: Donnee<number>;
  readonly surfacePlancherFourchette: readonly [number, number];
  /** Façade longue parallèle à la rue (true) ou pignon sur rue (false). */
  readonly facadeSurRue: boolean;
  readonly reculs: readonly ReculMaison[];
}

export interface ResultatGabaritMaison {
  readonly ok: boolean;
  readonly gabarit: GabaritMaison | null;
  /** Raisons d'un refus (français simple, cause réelle). */
  readonly refus: readonly string[];
  /** Ce qui passe, à proposer en puces (texte de l'option + valeurs). */
  readonly propositions: readonly { readonly libelle: string; readonly niveaux: NiveauxMaison; readonly surfaceHabitableM2: number }[];
  readonly hypotheses: readonly string[];
}

const r2 = (v: number): number => Math.round(v * 100) / 100;
const fr = (v: number, d = 1): string => (Math.round(v * 10 ** d) / 10 ** d).toString().replace('.', ',');
const D = <T,>(valeur: T, statut: StatutDonnee, source: string): Donnee<T> => ({ valeur, statut, source });

/** Distance d'un point à un segment. Pur. */
function distPointSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
}

function segmentsSeCoupent(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt): number => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Distance minimale entre un polygone (fermé) et un segment ; 0 s'ils se coupent. Pur. */
export function distancePolygoneSegment(poly: readonly Pt[], a: Pt, b: Pt): number {
  let m = Number.POSITIVE_INFINITY;
  for (let i = 0; i < poly.length; i += 1) {
    const p = poly[i]!, q = poly[(i + 1) % poly.length]!;
    if (segmentsSeCoupent(p, q, a, b)) return 0;
    m = Math.min(m, distPointSegment(p, a, b), distPointSegment(q, a, b), distPointSegment(a, p, q), distPointSegment(b, p, q));
  }
  return m;
}

/** Limite sur rue de référence : la plus longue classée « voie ». null si aucune. Pur. */
export function limiteDeRue(p: ParcelleMaison): number | null {
  let best: number | null = null, lmax = -1;
  for (let i = 0; i < p.contour.length; i += 1) {
    if (p.categories[i] !== 'voie') continue;
    const a = p.contour[i]!, b = p.contour[(i + 1) % p.contour.length]!;
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    if (l > lmax) { lmax = l; best = i; }
  }
  return best;
}

/** Hauteur à l'égout (haut des murs, départ du toit) de la maison construite (m). Pur. */
export function hauteurEgoutConstruite(niveaux: NiveauxMaison): number {
  const R = REGLES_MAISON;
  return Math.round((R.hauteurRdcM + R.dalleM + (niveaux - 1) * (R.hauteurEtageM + R.dalleM)) * 1000) / 1000;
}

/**
 * Hauteur du toit construit au-dessus de l'égout (m) : deux ou quatre pans, faîtage au milieu de la largeur débords
 * compris ; monopente, sur toute la largeur débords compris ; toit plat, acrotère. Pur.
 */
export function hauteurToitureConstruite(toit: FormeToit, largeur: number, penteDeg: number): number {
  const R = REGLES_MAISON;
  if (toit === 'plat') return R.acrotereM;
  const portee = largeur + 2 * R.debordToitM;
  const t = Math.tan((penteDeg * Math.PI) / 180);
  return toit === 'monopente' ? portee * t : (portee / 2) * t;
}

interface Dimensions { longueur: number; largeur: number; emprise: number; egout: number; faitage: number; largeurReduite: boolean }

/**
 * Dimensions du rectangle. `hauteurMaxM` (règle lue) : si le faîtage la dépasse avec un toit en pente, la maison est
 * rendue plus étroite (et plus longue, même emprise) jusqu'à tenir — jamais sous REGLES_MAISON.largeurMinM ni au-delà
 * de REGLES_MAISON.allongementMax (dit dans les hypothèses). Pur.
 */
function dimensionsPour(shab: number, niveaux: NiveauxMaison, toit: FormeToit, pente: number, hauteurMaxM: number | null = null): Dimensions {
  const R = REGLES_MAISON;
  const emprise0 = shab / niveaux / R.ratioHabitableEmprise;
  let largeur = Math.sqrt(emprise0 / R.proportion);
  if (largeur > R.largeurMaxM) largeur = R.largeurMaxM;
  const egout = hauteurEgoutConstruite(niveaux);
  let largeurReduite = false;
  if (hauteurMaxM !== null && toit !== 'plat' && egout + hauteurToitureConstruite(toit, r2(largeur), pente) > hauteurMaxM + 1e-6) {
    const t = Math.tan((pente * Math.PI) / 180);
    const porteeMax = toit === 'monopente' ? (hauteurMaxM - egout) / t : (2 * (hauteurMaxM - egout)) / t;
    const lMax = Math.floor((porteeMax - 2 * R.debordToitM) * 100) / 100;
    if (lMax >= R.largeurMinM && emprise0 / lMax / lMax <= R.allongementMax) { largeur = lMax; largeurReduite = true; }
  }
  // Dimensions au centimètre (celles que reçoit la machine de rendu) ; emprise recalculée sur ces dimensions.
  largeur = r2(largeur);
  const longueur = r2(emprise0 / largeur);
  const emprise = longueur * largeur;
  const faitage = egout + hauteurToitureConstruite(toit, largeur, pente);
  return { longueur, largeur, emprise, egout, faitage, largeurReduite };
}

/** Recul requis pour une limite (règle lue, sinon SUPPOSÉ et dit). */
function reculRequis(cat: CategorieLimite | null, regles: ReglesMaison, hauteurM: number): Donnee<number> {
  if (cat === 'voie') return regles.voieM ?? D(REGLES_MAISON.reculVoieSupposeM, 'supposee', 'recul à la voie non lu : 4 m SUPPOSÉS');
  const lue = cat === 'fond' ? (regles.fondM ?? regles.limitesSeparativesM) : regles.limitesSeparativesM;
  if (lue) return lue;
  const v = Math.max(REGLES_MAISON.reculMinRnuM, hauteurM / 2);
  return D(r2(v), 'supposee', `règle nationale (art. R111-17) faute de règle lue : moitié de la hauteur (${fr(hauteurM)} m), 3 m au moins`);
}

/** Coins d'un rectangle (repère : origine o, axe u le long de la rue, axe v vers l'intérieur). */
function rect(o: Pt, u: Pt, v: Pt, u0: number, v0: number, lu: number, lv: number): Pt[] {
  const at = (a: number, b: number): Pt => ({ x: o.x + u.x * a + v.x * b, z: o.z + u.z * a + v.z * b });
  return [at(u0, v0), at(u0 + lu, v0), at(u0 + lu, v0 + lv), at(u0, v0 + lv)];
}

interface Placement { coins: Pt[]; reculs: ReculMaison[]; facadeSurRue: boolean }

/** Cherche un placement valide (au plus près de la rue, puis centré). null si aucun. Pur. */
function placer(p: ParcelleMaison, regles: ReglesMaison, d: Dimensions, iRue: number): Placement | null {
  const n = p.contour.length;
  const a = p.contour[iRue]!, b = p.contour[(iRue + 1) % n]!;
  // LOT G10b — direction de la façade au 1/10 de degré : c'est la précision de la rotation transmise à la machine de
  // rendu (contrat v2). La maison placée ici est donc EXACTEMENT celle qui sera construite (image et plans).
  const angle = Math.round((Math.atan2(b.z - a.z, b.x - a.x) * 180) / Math.PI * 10) / 10;
  const u = { x: Math.cos((angle * Math.PI) / 180), z: Math.sin((angle * Math.PI) / 180) };
  // Normale vers l'intérieur : celle qui, depuis le milieu de la limite, entre dans la parcelle.
  let v = { x: -u.z, z: u.x };
  const mil = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
  if (!dedans(mil.x + v.x * 0.5, mil.z + v.z * 0.5, p.contour)) v = { x: u.z, z: -u.x };
  // Étendue de la parcelle dans ce repère.
  let umin = Infinity, umax = -Infinity, vmax = -Infinity;
  for (const q of p.contour) {
    const du = (q.x - a.x) * u.x + (q.z - a.z) * u.z;
    const dv = (q.x - a.x) * v.x + (q.z - a.z) * v.z;
    umin = Math.min(umin, du); umax = Math.max(umax, du); vmax = Math.max(vmax, dv);
  }
  const requis = p.contour.map((_, i) => reculRequis(p.categories[i] ?? null, regles, d.faitage));
  const pas = REGLES_MAISON.pasRechercheM;
  const centreU = (umin + umax) / 2;
  for (const facadeSurRue of [true, false]) {
    const lu = facadeSurRue ? d.longueur : d.largeur;
    const lv = facadeSurRue ? d.largeur : d.longueur;
    const candidats: { u0: number; v0: number }[] = [];
    for (let v0 = 0; v0 + lv <= vmax + 1e-9; v0 += pas) {
      for (let u0 = umin; u0 + lu <= umax + 1e-9; u0 += pas) candidats.push({ u0, v0 });
    }
    // Au plus près de la rue, puis au plus près du centre.
    candidats.sort((x, y) => x.v0 - y.v0 || Math.abs(x.u0 + lu / 2 - centreU) - Math.abs(y.u0 + lu / 2 - centreU));
    for (const c of candidats) {
      // LOT G10b — rectangle EXACT (dimensions au cm, rotation au 1/10 de degré : ce que reçoit la machine de rendu) ;
      // les reculs sont vérifiés et mesurés sur ces coins-là.
      const coins = rect(a, u, v, c.u0, c.v0, lu, lv);
      if (!coins.every((q) => dedans(q.x, q.z, p.contour))) continue;
      let bon = true;
      const reculs: ReculMaison[] = [];
      for (let i = 0; i < n && bon; i += 1) {
        const m = distancePolygoneSegment(coins, p.contour[i]!, p.contour[(i + 1) % n]!);
        if (m + 1e-6 < requis[i]!.valeur) bon = false;
        reculs.push({ limite: i, categorie: p.categories[i] ?? null, requis: requis[i]!, mesureM: Math.round(m * 1000) / 1000 });
      }
      if (bon) return { coins, reculs, facadeSurRue };
    }
  }
  return null;
}

/** Surface de plancher estimée (même méthode que l'estimation de la maison existante : murs et trémie SUPPOSÉS). */
function surfacePlancher(dim: Dimensions, niveaux: NiveauxMaison): { valeur: number; fourchette: [number, number] } {
  const perim = 2 * (dim.longueur + dim.largeur);
  const parNiveau = dim.emprise - perim * REGLES_MAISON.epaisseurMursM;
  const v = Math.max(0, niveaux * parNiveau - (niveaux - 1) * REGLES_MAISON.tremieM2);
  return { valeur: Math.round(v), fourchette: [Math.round(v * 0.9), Math.round(v * 1.1)] };
}

/** Le gabarit tient-il (placement + emprise max + hauteur max) ? Renvoie le placement ou la raison. */
function essayer(e: EntreeGabaritMaison, shab: number, niveaux: NiveauxMaison, iRue: number): { placement: Placement | null; dim: Dimensions; raison: string | null } {
  const pente = e.penteDeg?.valeur ?? REGLES_MAISON.penteDeg;
  const dim = dimensionsPour(shab, niveaux, e.toit.valeur, pente, e.regles.hauteurMaxM?.valeur ?? null);
  const sParcelle = e.parcelle.surfaceM2 ?? aire(e.parcelle.contour);
  if (e.regles.cesMax && dim.emprise > e.regles.cesMax.valeur * sParcelle + 1e-6) {
    return { placement: null, dim, raison: `emprise au sol ${fr(dim.emprise)} m² au-delà du maximum (${Math.round(e.regles.cesMax.valeur * 100)} % de ${Math.round(sParcelle)} m², soit ${fr(e.regles.cesMax.valeur * sParcelle)} m² — ${e.regles.cesMax.source})` };
  }
  if (e.regles.hauteurMaxM && dim.faitage > e.regles.hauteurMaxM.valeur + 1e-6) {
    return { placement: null, dim, raison: `hauteur au faîtage ${fr(dim.faitage)} m au-delà du maximum ${fr(e.regles.hauteurMaxM.valeur)} m (${e.regles.hauteurMaxM.source})` };
  }
  const placement = placer(e.parcelle, e.regles, dim, iRue);
  return { placement, dim, raison: placement ? null : `une maison de ${fr(dim.longueur)} × ${fr(dim.largeur)} m (emprise ${Math.round(dim.emprise)} m²) ne tient pas sur la parcelle en respectant les reculs` };
}

/** Plus grande surface habitable (pas de 5 m²) qui tient pour ce nombre de niveaux, ou null. Pur. */
function surfaceMaxPossible(e: EntreeGabaritMaison, niveaux: NiveauxMaison, iRue: number, plafond: number): number | null {
  let lo = BORNE_MIN, hi = Math.floor(plafond / 5) * 5, best: number | null = null;
  if (!essayer(e, lo, niveaux, iRue).placement) return null;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 10) * 5;
    if (essayer(e, mid, niveaux, iRue).placement) { best = mid; lo = mid + 5; } else hi = mid - 5;
  }
  return best;
}
const BORNE_MIN = 30;

/**
 * Gabarit de la maison neuve. Jamais d'exception : un refus est une sortie normale, avec sa cause et des
 * propositions qui passent. Pur.
 */
export function calculerGabaritMaison(e: EntreeGabaritMaison): ResultatGabaritMaison {
  const hypotheses: string[] = [];
  const niveaux = e.niveaux.valeur > REGLES_MAISON.niveauxMax ? REGLES_MAISON.niveauxMax : e.niveaux.valeur;
  if (e.parcelle.contour.length < 3) return { ok: false, gabarit: null, refus: ['contour de la parcelle illisible'], propositions: [], hypotheses };
  const iRue = limiteDeRue(e.parcelle);
  if (iRue === null) {
    return { ok: false, gabarit: null, refus: ['le côté de la rue n’est pas connu : la façade et les reculs ne peuvent pas être placés'], propositions: [], hypotheses };
  }
  const pente = e.penteDeg ?? D(REGLES_MAISON.penteDeg, 'supposee', `pente ${REGLES_MAISON.penteDeg}° SUPPOSÉE`);
  hypotheses.push(
    `Emprise déduite de la surface habitable : habitable ≈ ${Math.round(REGLES_MAISON.ratioHabitableEmprise * 100)} % de l’emprise par niveau (SUPPOSÉ).`,
    `Forme : rectangle, longueur ≈ ${fr(REGLES_MAISON.proportion)} × largeur (SUPPOSÉ), largeur ${REGLES_MAISON.largeurMaxM} m au plus.`,
    `Hauteurs : rez-de-chaussée ${fr(REGLES_MAISON.hauteurRdcM, 2)} m, étage ${fr(REGLES_MAISON.hauteurEtageM, 2)} m, dalles ${fr(REGLES_MAISON.dalleM, 2)} m, débord de toit ${fr(REGLES_MAISON.debordToitM, 2)} m (SUPPOSÉS : conventions de construction de la maison dessinée).`,
  );
  if (!e.regles.voieM) hypotheses.push('Recul à la voie non lu dans le règlement : 4 m SUPPOSÉS.');
  if (!e.regles.limitesSeparativesM) hypotheses.push('Recul aux limites séparatives non lu : règle nationale (moitié de la hauteur, 3 m au moins) appliquée.');
  if (!e.regles.cesMax) hypotheses.push('Emprise au sol maximale non lue : non vérifiée.');
  if (!e.regles.hauteurMaxM) hypotheses.push('Hauteur maximale non lue : non vérifiée.');
  if (e.parcelle.categories.some((c) => c === null)) hypotheses.push('Certaines limites ne sont pas classées : traitées comme limites séparatives.');

  const t = essayer(e, e.surfaceHabitableM2.valeur, niveaux, iRue);
  if (t.placement) {
    if (t.dim.largeurReduite) hypotheses.push(`Maison rendue plus étroite (${fr(t.dim.largeur, 2)} m) et plus longue, même surface, pour tenir sous la hauteur maximale de ${fr(e.regles.hauteurMaxM!.valeur)} m.`);
    const sdp = surfacePlancher(t.dim, niveaux);
    const egout = D(r2(t.dim.egout), 'supposee', niveaux === 1 ? `rez-de-chaussée ${fr(REGLES_MAISON.hauteurRdcM, 2)} m + dalle ${fr(REGLES_MAISON.dalleM, 2)} m SUPPOSÉS` : `rez-de-chaussée ${fr(REGLES_MAISON.hauteurRdcM, 2)} m + étage ${fr(REGLES_MAISON.hauteurEtageM, 2)} m + dalles ${fr(REGLES_MAISON.dalleM, 2)} m SUPPOSÉS`);
    const faitage = D(r2(t.dim.faitage), 'estimee', e.toit.valeur === 'plat' ? `toit plat : égout + acrotère ${fr(REGLES_MAISON.acrotereM)} m` : `égout + toiture (${LIBELLE_PENTE(e.toit.valeur, pente.valeur)}, débords ${fr(REGLES_MAISON.debordToitM)} m)`);
    return {
      ok: true,
      refus: [],
      propositions: [],
      hypotheses,
      gabarit: {
        coins: t.placement.coins,
        longueurM: r2(t.dim.longueur),
        largeurM: r2(t.dim.largeur),
        empriseM2: r2(t.dim.emprise),
        niveaux: niveaux === e.niveaux.valeur ? e.niveaux : D(niveaux, 'supposee', 'maison individuelle limitée à R+1'),
        egoutM: egout,
        faitageM: faitage,
        toit: e.toit,
        penteDeg: pente,
        surfacePlancherM2: D(sdp.valeur, 'estimee', `${niveaux} niveau(x) × (emprise − murs ${REGLES_MAISON.epaisseurMursM} m SUPPOSÉS)${niveaux > 1 ? ` − trémie ${REGLES_MAISON.tremieM2} m² SUPPOSÉE` : ''}`),
        surfacePlancherFourchette: sdp.fourchette,
        facadeSurRue: t.placement.facadeSurRue,
        reculs: t.placement.reculs,
      },
    };
  }
  // Refus : proposer ce qui passe.
  const propositions: { libelle: string; niveaux: NiveauxMaison; surfaceHabitableM2: number }[] = [];
  const shab = e.surfaceHabitableM2.valeur;
  if (niveaux === 1 && essayer(e, shab, 2, iRue).placement) propositions.push({ libelle: `${shab} m² sur 2 niveaux (R+1)`, niveaux: 2, surfaceHabitableM2: shab });
  for (const nv of [niveaux, (niveaux === 1 ? 2 : 1) as NiveauxMaison]) {
    const max = surfaceMaxPossible(e, nv, iRue, shab - 5);
    if (max !== null && max >= BORNE_MIN && !propositions.some((p) => p.niveaux === nv)) {
      propositions.push({ libelle: `${max} m² ${nv === 1 ? 'de plain-pied' : 'sur 2 niveaux (R+1)'}`, niveaux: nv, surfaceHabitableM2: max });
    }
  }
  return { ok: false, gabarit: null, refus: [t.raison ?? 'placement impossible'], propositions: propositions.slice(0, 3), hypotheses };
}

function LIBELLE_PENTE(toit: FormeToit, pente: number): string {
  if (toit === 'monopente') return `monopente, pente ${fr(pente, 0)}°`;
  return `${toit === 'quatre-pans' ? '4 pans' : '2 pans'}, pente ${fr(pente, 0)}°`;
}

