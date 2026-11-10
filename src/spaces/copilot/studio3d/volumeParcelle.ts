// src/spaces/copilot/studio3d/volumeParcelle.ts
//
// VOLUME D'ÉTUDE PROPOSÉ SUR LA PARCELLE — logique PURE (testée par node --test).
//
// Le panneau « Dossier 3D » montre la parcelle avec un simple parallélépipède
// (« un cube pour voir le volume »). Ce module calcule ce volume par une règle
// simple, déterministe et affichée comme HYPOTHÈSE :
//
//   1. Contour : anneau extérieur de la plus grande partie de la parcelle,
//      projeté en mètres autour de son centre (équirectangulaire local).
//   2. Orientation : grand axe du plus petit rectangle englobant la parcelle.
//   3. Règles PLU chiffrées applicables (reglesPlu.ts) : pour chaque notion, la
//      plus contraignante. Sans règle : recul 4 m, CES 40 %, épaisseur 16 m.
//      Hauteur : la plus basse des hauteurs connues (égout / faîtage), toit plat.
//      Pleine terre p : emprise ≤ (1 − p) × parcelle. Recul H/k (minimum m) :
//      recalculé pour chaque nombre de niveaux essayé (niveaux ↔ recul).
//   4. Emprise possible : le plus grand rectangle (épaisseur ≤ max, côtés ≥ 6 m)
//      tenant à distance ≥ recul de toutes les limites, borné par CES / pleine terre.
//   5. Niveaux : programme connu → le plus petit n (≤ hauteur/3 m, ≤ niveaux
//      max, ≤ 30) dont la capacité emprise × n loge la SDP visée (logements ×
//      70 m²), emprise ensuite réduite au besoin ; sinon la plus grande capacité
//      (programme non atteint, signalé). Programme inconnu → R+3 indicatif.
//   6. SDP estimée ≈ emprise × niveaux (aucune déduction).
//
// Ce volume n'est JAMAIS présenté comme conforme : côté voie, prospects entre
// bâtiments, stationnement, servitudes et OAP ne sont pas vérifiés. Aucune I/O ici.
//
// Lot C7b — bande principale (paramètre FACULTATIF `bande`, PLU « par bande ») : quand le côté voie est
// identifié (coteVoie.ts) et la profondeur de bande lue, le volume est orienté PARALLÈLEMENT À LA VOIE et tient
// tout entier dans la bande principale (étapes 2 et 4 remplacées ; reculs, CES, niveaux inchangés). Bande
// inutilisable : calcul habituel, raison écrite dans `bande.raison` et dans les alertes. Sans le paramètre :
// résultat strictement identique à avant. Rien n'est construit en bande secondaire.
//
// Lot C10 — recul différencié (seulement quand la bande est appliquée, donc le côté voie identifié) : si le recul à
// la voie est ÉTABLI par une règle lue (règle chiffrée `recul_voie_m`, ou alignement explicite passé dans
// `bande.implantation.reculVoieM`), il s'applique aux limites présumées sur voie, et le recul aux limites
// séparatives à toutes les autres. Recul à la voie non établi : recul uniforme d'origine, côté voie compris, et
// l'hypothèse affichée le dit. L'alignement n'est jamais supposé.
//
// Lot C11 (seulement quand la bande est appliquée et les limites sur voie retrouvées sur le contour) :
//   · recul sur voie « non réglementé » (règle confirmée et citée) : l'appelant passe `implantation.reculVoieM = 0`
//     avec `motifVoie: 'non_reglementee'` ; le volume retient l'ALIGNEMENT et l'écrit dans les hypothèses ;
//   · implantation en limite séparative permise (`implantation.limiteSeparativePermise`) : le volume peut venir
//     contre les limites LATÉRALES (marquerSegmentsLateraux). Chaque limite latérale est soit touchée, soit tenue à
//     distance du retrait (formule H/k) : jamais entre les deux. Le retrait reste dû sur le fond de parcelle.

import type { JarvisDraft } from './jarvisDraft.ts';
import { CONTACT_LIMITE_M, distanceVoie, lateralesAdmises, marquerSegmentsLateraux, marquerSegmentsVoie, preparerBande, rectangleDansBande, type BandePreparee, type BandeVoie, type BandeVolume, type FacadeLocale } from './bandePrincipale.ts';

export type { BandeVoie, BandeVolume, ImplantationVoie } from './bandePrincipale.ts';

export type Position = number[];
export type GeometrieParcelle =
  | { type: 'Polygon'; coordinates: Position[][] }
  | { type: 'MultiPolygon'; coordinates: Position[][][] };

/** Clés de règles PLU chiffrées utilisées par le volume (mêmes notions que les règles de conception). */
export type CleReglePlu =
  | 'hauteur_max_m'          // hauteur maximale (égout, acrotère ou non précisée)
  | 'hauteur_faitage_m'      // hauteur maximale au faîtage
  | 'niveaux_max'            // nombre de niveaux maximal (R+n → n + 1)
  | 'emprise_max_ratio'      // coefficient d'emprise au sol, 0 à 1
  | 'recul_voie_m'           // recul minimal à la voie / à l'alignement
  | 'recul_limites_m'        // recul minimal aux limites séparatives
  | 'recul_limites_formule'  // recul aux limites L ≥ H / diviseur, avec minimum éventuel
  | 'pleine_terre_min_ratio' // part minimale de pleine terre / espaces verts, 0 à 1
  | 'epaisseur_max_m';       // épaisseur (gabarit) maximale du bâtiment

export interface ReglePlu {
  cle: CleReglePlu;
  /** Valeur (m, ratio, niveaux) ; pour une formule H/k : k (diviseur). */
  valeur: number;
  /** Formule H/k : minimum en mètres. */
  minimumM?: number | null;
  /** Document ou outil d'origine. */
  source: string;
  /** Article et/ou page, si fournis. */
  reference?: string | null;
  /** `lue` : lue dans le règlement ; `importee` : règlement importé (parser) ; `estimee` : saisie non confirmée. */
  statut: 'lue' | 'importee' | 'estimee';
}

/** Règles PLU applicables à la parcelle affichée. */
export interface ReglesPluVolume {
  /**
   * `plu-chiffre` : au moins une règle chiffrée applicable ;
   * `reglement-texte` : règlement lu, aucune règle chiffrée exploitable ;
   * `aucune` : règlement PLU non lu.
   */
  source: 'plu-chiffre' | 'reglement-texte' | 'aucune';
  regles: ReglePlu[];
  /** Lignes à afficher : règles non chiffrées, non trouvées, ou ignorées (autre zone, autre parcelle). */
  nonAppliquees: string[];
}

export interface ProgrammeVolume {
  logements: number | null;
  /** Libellé court repris de la conversation, ex. « 40 logements sociaux ». */
  libelle: string | null;
  origine: 'fiche' | 'conversation' | null;
  /**
   * Programme détaillé (programmeBati.ts) : maisons, logements collectifs, résidence.
   * Absent ou vide : seul `logements` est connu (volume unique historique).
   */
  composantes?: ComposanteProgramme[];
}

/** Forme bâtie retenue pour une partie du programme (typologie programme → forme). */
export type FormeBatie = 'maison-individuelle' | 'maisons-jumelees' | 'maisons-en-bande' | 'plot' | 'barre' | 'residence';

/** Une partie du programme : « 25 maisons seniors », « 40 logements sociaux », « résidence de 80 lits ». */
export interface ComposanteProgramme {
  type: 'maisons' | 'collectif' | 'residence';
  /** Nombre d'unités : maisons, logements ou lits / chambres. */
  nombre: number;
  unite: 'maisons' | 'logements' | 'lits';
  public: 'seniors' | 'social' | 'etudiants' | null;
  /** Forme demandée explicitement (« en bande », « jumelées », « individuelles ») ; null = au choix du moteur. */
  forme: 'individuelle' | 'jumelee' | 'bande' | null;
  /** Niveaux demandés explicitement (« plain-pied » → 1, « R+1 » → 2) ; null = au choix du moteur. */
  niveaux: number | null;
  libelle: string;
}

/** Un bâtiment de l'implantation multi-bâtiments (repère local, mètres). */
export interface BatimentPropose {
  /** Identifiant stable dans l'échange (« mz-vol-1 »…). */
  id: string;
  nom: string;
  forme: FormeBatie;
  largeurM: number;
  profondeurM: number;
  niveaux: number;
  hauteurM: number;
  surfaceM2: number;
  sdpM2: number;
  /** Maisons (forme maison*) ou logements / lits (collectif, résidence) contenus. */
  unites: number;
  uniteLibelle: 'maison' | 'logement' | 'lit';
  centre: PointLocal;
  centreWgs84: { lon: number; lat: number };
  /** Angle du grand côté (largeur), en degrés depuis l'est, sens trigonométrique (comme emprise.angleDeg). */
  angleDeg: number;
  coins: PointLocal[];
  /**
   * Lot formes-batiment : bâtiment collectif À AILES (en L, en U, cour fermée, redans) calculé par
   * formesBatiment.ts. Absent pour un rectangle (barre, plot, maisons…). Avec des ailes, largeurM /
   * profondeurM / centre / angleDeg / coins sont ceux de l'ENVELOPPE (rectangle englobant) ; l'emprise
   * réelle est la réunion des ailes (surfaceM2, sdpM2 et les vérifications portent sur elles).
   */
  ailes?: AilePropose[];
  formeAiles?: FormeAiles;
  /** Redans : décalage (m) de chaque segment par rapport au précédent. */
  decalageM?: number;
}

/** Lot formes-batiment : formes à ailes d'un immeuble collectif. */
export type FormeAiles = 'l' | 'u' | 'cour' | 'redans';
export const NOMS_FORME_AILES: Record<FormeAiles, string> = { l: 'en L', u: 'en U', cour: 'à cour fermée', redans: 'à redans' };

/**
 * Lot formes-batiment : une aile (rectangle sans recouvrement avec les autres ailes du bâtiment).
 * Repère du bâtiment : u le long du grand côté (angleDeg), v perpendiculaire, vers la gauche (nord pour 0°).
 */
export interface AilePropose {
  nom: string;
  /** Paramètres saisis : longueur hors tout et épaisseur de l'aile (m). */
  longueurM: number;
  epaisseurM: number;
  niveaux: number;
  /** Rectangle construit : centre (du, dv) dans le repère du bâtiment, côté lu le long de u, lv le long de v. */
  du: number;
  dv: number;
  lu: number;
  lv: number;
  /** Coins dans le repère local de la parcelle (x est, y nord). */
  coins: PointLocal[];
  surfaceM2: number;
  sdpM2: number;
}

/** Voie de desserte interne (aplat au sol, non bâti). */
export interface VoiePropose {
  largeurM: number;
  longueurM: number;
  surfaceM2: number;
  coins: PointLocal[];
}

export interface KpiImplantation {
  batiments: number;
  /** Unités placées (maisons + logements + lits). */
  unites: number;
  unitesVisees: number | null;
  maisons: number;
  logements: number;
  lits: number;
  empriseTotaleM2: number;
  sdpTotaleM2: number;
  voirieM2: number;
  /** Emprise bâtie / surface de la parcelle (0 à 1). */
  ratioEmprise: number;
}

export const HYPOTHESES_VOLUME = {
  reculDefautM: 4,
  cesDefaut: 0.4,
  hauteurEtageM: 3,
  sdpParLogementM2: 70,
  epaisseurMaxM: 16,
  coteMinM: 6,
  niveauxIndicatifs: 4,
  niveauxMaxStudio: 30,
} as const;

export const REGLES_INCONNUES: ReglesPluVolume = { source: 'aucune', regles: [], nonAppliquees: [] };

export type StatutVolume = 'calcule' | 'indicatif' | 'trop-petite' | 'hauteur-insuffisante' | 'contour-invalide';

export interface PointLocal { x: number; y: number }

export interface VolumePropose {
  statut: StatutVolume;
  /** Surface du contour cadastral (m²), calculée sur la géométrie. */
  surfaceParcelleM2: number;
  /** Contour local en mètres (x vers l'est, y vers le nord), anneau non fermé. */
  contour: PointLocal[];
  /** Origine de la projection locale (WGS84). */
  origine: { lon: number; lat: number };
  /** Emprise du volume ; null si aucun volume n'est proposé. */
  emprise: null | {
    largeurM: number; profondeurM: number; surfaceM2: number;
    centre: PointLocal; centreWgs84: { lon: number; lat: number };
    /** Angle du grand côté, en degrés depuis l'est, sens trigonométrique. */
    angleDeg: number;
    coins: PointLocal[];
  };
  niveaux: number;
  hauteurM: number;
  sdpM2: number;
  logementsEstimes: number | null;
  sdpViseeM2: number | null;
  programmeAtteint: boolean | null;
  /**
   * Recul appliqué aux limites. Reculs uniformes (cas général) : distance minimale à TOUTES les limites.
   * Lot C10, reculs différenciés (`bande.reculVoieM` présent) : recul aux limites AUTRES que la voie ; le recul
   * côté voie est `bande.reculVoieM`.
   */
  reculM: number;
  cesRetenu: number;
  /** Lignes d'hypothèses à afficher telles quelles. */
  hypotheses: string[];
  /** Avertissements (programme non atteint, hauteur bornée…). */
  alertes: string[];
  /** Mention réglementaire OBLIGATOIRE affichée près du volume. */
  mentionPlu: string;
  /** Règles PLU appliquées, une ligne chacune : valeur, effet, source, statut. */
  reglesAppliquees: string[];
  /** Règles non chiffrées, non trouvées ou ignorées (reprises de ReglesPluVolume). */
  reglesNonAppliquees: string[];
  /**
   * Implantation multi-bâtiments (implantationProgramme.ts) : TOUS les bâtiments,
   * `emprise` restant celle du bâtiment principal (le plus grand). Absent = volume unique.
   */
  batiments?: BatimentPropose[];
  voies?: VoiePropose[];
  kpi?: KpiImplantation;
  /**
   * Lot C7b : présent seulement si une bande principale a été demandée. `appliquee` : l'emprise est dans la
   * bande, parallèle à la voie ; `non-appliquee` : calcul habituel, la raison est dans `raison`.
   */
  bande?: BandeVolume;
}

const M_PAR_DEGRE = 111_320;
const arrondiInf = (v: number, pas = 0.5) => Math.floor(v / pas + 1e-9) * pas;
const fr = (v: number, d = 0) => v.toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const nombre = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null;

export function aireSignee(r: PointLocal[]): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p.x * q.y - q.x * p.y; }
  return a / 2;
}

/** Anneaux (extérieur + trous) de la plus grande partie, coordonnées WGS84 valides. */
function plusGrandePartie(g: GeometrieParcelle | null | undefined): Position[][] | null {
  if (!g) return null;
  const parties = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  let meilleure: Position[][] | null = null, aireMax = 0;
  for (const p of parties) {
    const ext = p?.[0];
    if (!Array.isArray(ext) || ext.length < 4) continue;
    if (!ext.every(c => Array.isArray(c) && nombre(c[0]) !== null && nombre(c[1]) !== null && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90)) continue;
    let a = 0;
    for (let i = 0; i < ext.length - 1; i++) a += (ext[i][0] - ext[0][0]) * (ext[i + 1][1] - ext[0][1]) - (ext[i + 1][0] - ext[0][0]) * (ext[i][1] - ext[0][1]);
    if (Math.abs(a) > aireMax) { aireMax = Math.abs(a); meilleure = p; }
  }
  return meilleure;
}

/** Projection locale en mètres autour du centre de l'emprise englobante. */
export function projeterParcelle(g: GeometrieParcelle | null | undefined): { origine: { lon: number; lat: number }; anneaux: PointLocal[][] } | null {
  const partie = plusGrandePartie(g);
  if (!partie) return null;
  const ext = partie[0];
  const lons = ext.map(c => c[0]), lats = ext.map(c => c[1]);
  const origine = { lon: (Math.min(...lons) + Math.max(...lons)) / 2, lat: (Math.min(...lats) + Math.max(...lats)) / 2 };
  const kx = M_PAR_DEGRE * Math.cos(origine.lat * Math.PI / 180);
  const anneaux = partie.filter(r => Array.isArray(r) && r.length >= 4).map(r => {
    const pts = r.map(c => ({ x: (c[0] - origine.lon) * kx, y: (c[1] - origine.lat) * M_PAR_DEGRE }));
    const dernier = pts[pts.length - 1], premier = pts[0];
    if (Math.abs(dernier.x - premier.x) < 1e-9 && Math.abs(dernier.y - premier.y) < 1e-9) pts.pop();
    return pts;
  });
  return { origine, anneaux };
}

export function versWgs84(p: PointLocal, origine: { lon: number; lat: number }) {
  return { lon: origine.lon + p.x / (M_PAR_DEGRE * Math.cos(origine.lat * Math.PI / 180)), lat: origine.lat + p.y / M_PAR_DEGRE };
}

function dansAnneau(r: PointLocal[], x: number, y: number): boolean {
  let dedans = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) dedans = !dedans;
  }
  return dedans;
}
export const dansPolygone = (anneaux: PointLocal[][], x: number, y: number) =>
  dansAnneau(anneaux[0], x, y) && !anneaux.slice(1).some(t => dansAnneau(t, x, y));

function distPointSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function seCoupent(a: PointLocal, b: PointLocal, c: PointLocal, d: PointLocal): boolean {
  const o = (p: PointLocal, q: PointLocal, r: PointLocal) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}
function distSegments(a: PointLocal, b: PointLocal, c: PointLocal, d: PointLocal): number {
  if (seCoupent(a, b, c, d)) return 0;
  return Math.min(distPointSegment(a.x, a.y, c.x, c.y, d.x, d.y), distPointSegment(b.x, b.y, c.x, c.y, d.x, d.y),
    distPointSegment(c.x, c.y, a.x, a.y, b.x, b.y), distPointSegment(d.x, d.y, a.x, a.y, b.x, b.y));
}

function enveloppeConvexe(points: PointLocal[]): PointLocal[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const croix = (o: PointLocal, a: PointLocal, b: PointLocal) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const bas: PointLocal[] = [], haut: PointLocal[] = [];
  for (const q of p) { while (bas.length >= 2 && croix(bas[bas.length - 2], bas[bas.length - 1], q) <= 0) bas.pop(); bas.push(q); }
  for (const q of [...p].reverse()) { while (haut.length >= 2 && croix(haut[haut.length - 2], haut[haut.length - 1], q) <= 0) haut.pop(); haut.push(q); }
  return [...bas.slice(0, -1), ...haut.slice(0, -1)];
}

/** Angle (radians) du grand axe du plus petit rectangle englobant ; déterministe. */
export function orientationParcelle(anneau: PointLocal[]): number {
  const h = enveloppeConvexe(anneau);
  let meilleur = { aire: Infinity, angle: 0 };
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length];
    let angle = Math.atan2(b.y - a.y, b.x - a.x);
    const c = Math.cos(-angle), s = Math.sin(-angle);
    const us = h.map(p => p.x * c - p.y * s), vs = h.map(p => p.x * s + p.y * c);
    const L = Math.max(...us) - Math.min(...us), H = Math.max(...vs) - Math.min(...vs);
    if (H > L) angle += Math.PI / 2;
    // Angle ramené dans [0, π) pour qu'un même rectangle donne toujours le même angle.
    angle = ((angle % Math.PI) + Math.PI) % Math.PI;
    const aire = L * H;
    if (aire < meilleur.aire - 1e-6 || (Math.abs(aire - meilleur.aire) <= 1e-6 && angle < meilleur.angle)) meilleur = { aire, angle };
  }
  return meilleur.angle;
}

export interface Rect {
  cu: number; cv: number; w: number; d: number;
  /**
   * Lot C11 : côté(s) du rectangle posé(s) CONTRE une limite latérale (u bas : 'g', u haut : 'd', les deux : 'gd').
   * Un rectangle ancré ne se réduit que du côté libre (jamais en s'écartant de la limite qu'il touche) ; ancré des
   * deux côtés, sa largeur ne change plus. Absent : rectangle en retrait, réduit autour de son centre comme avant.
   */
  ancre?: 'g' | 'd' | 'gd';
}

export interface Segment {
  a: PointLocal; b: PointLocal; x0: number; x1: number; y0: number; y1: number;
  /** Lot C10 : limite présumée sur voie (posé par marquerSegmentsVoie) ; absent = limite ordinaire. */
  voie?: boolean;
  /** Lot C11 : limite LATÉRALE, numéro du côté (posé par marquerSegmentsLateraux) ; absent = fond ou autre limite. */
  laterale?: number;
}
export const segmentsDe = (anneaux: PointLocal[][]): Segment[] => anneaux.flatMap(anneau => anneau.map((a, i) => {
  const b = anneau[(i + 1) % anneau.length];
  return { a, b, x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) };
}));

/**
 * Le rectangle (repère tourné u, v) tient-il à ≥ recul de toutes les limites ?
 * Lot C10 : `reculVoie` (facultatif) remplace `recul` pour les segments marqués `voie` (limites présumées sur
 * voie) ; sans ce paramètre, ou sans segment marqué, le test est celui d'origine.
 * Lot C11 : `reculLateral` (facultatif ; une valeur, ou une par côté) remplace `recul` pour les segments marqués `laterale`. Ce test dit
 * seulement que le rectangle reste DANS la parcelle à ces distances ; la règle « en limite OU en retrait » des
 * limites latérales se vérifie en plus (distancesLaterales + lateralesAdmises).
 */
export function rectTient(anneaux: PointLocal[][], segments: Segment[], r: Rect, recul: number, reculVoie?: number, reculLateral?: number | readonly number[]): boolean {
  const x0 = r.cu - r.w / 2, x1 = r.cu + r.w / 2, y0 = r.cv - r.d / 2, y1 = r.cv + r.d / 2;
  if (!dansPolygone(anneaux, x0, y0)) return false;
  const coins = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  const margeLimites = Math.max(recul, 1e-6);
  const margeVoie = reculVoie === undefined ? margeLimites : Math.max(reculVoie, 1e-6);
  /** Marge d'un côté latéral : une valeur pour tous, ou une par côté (indice = numéro du côté − 1). */
  const margeLaterale = (cote: number) => reculLateral === undefined ? margeLimites
    : Math.max(typeof reculLateral === 'number' ? reculLateral : reculLateral[cote - 1] ?? recul, 1e-6);
  for (const s of segments) {
    const marge = s.voie ? margeVoie : s.laterale !== undefined ? margeLaterale(s.laterale) : margeLimites;
    // Segment loin du rectangle (boîtes englobantes) : rien à vérifier.
    if (s.x1 < x0 - marge || s.x0 > x1 + marge || s.y1 < y0 - marge || s.y0 > y1 + marge) continue;
    // Sommet de la parcelle (ou d'un trou) dans le rectangle : rectangle refusé.
    if (s.a.x > x0 && s.a.x < x1 && s.a.y > y0 && s.a.y < y1) return false;
    for (let k = 0; k < 4; k++) if (distSegments(coins[k], coins[(k + 1) % 4], s.a, s.b) < marge) return false;
  }
  return true;
}

/**
 * Lot C11 — distance du rectangle à chaque côté latéral (`cotes` côtés numérotés de 1 à `cotes` dans `segments`),
 * dans le repère des segments. À passer à lateralesAdmises.
 */
export function distancesLaterales(segments: readonly Segment[], r: Rect, cotes: number): number[] {
  const x0 = r.cu - r.w / 2, x1 = r.cu + r.w / 2, y0 = r.cv - r.d / 2, y1 = r.cv + r.d / 2;
  const coins = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  const out = Array.from({ length: cotes }, () => Infinity);
  for (const s of segments) {
    if (s.laterale === undefined || s.laterale > cotes) continue;
    for (let k = 0; k < 4; k++) out[s.laterale - 1] = Math.min(out[s.laterale - 1], distSegments(coins[k], coins[(k + 1) % 4], s.a, s.b));
  }
  return out;
}

/** Plus grand rectangle orienté (épaisseur ≤ max) à distance ≥ recul des limites ; grille de centres fixe. */
function plusGrandRectangle(anneaux: PointLocal[][], recul: number, epaisseurMax: number, coteMin: number): Rect | null {
  const segments = segmentsDe(anneaux);
  const us = anneaux[0].map(p => p.x), vs = anneaux[0].map(p => p.y);
  const [u0, u1, v0, v1] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
  const largeurMax = u1 - u0 - 2 * recul, hauteurMax = v1 - v0 - 2 * recul;
  if (largeurMax < coteMin || hauteurMax < coteMin) return null;
  const epaisseurs = [...new Set([epaisseurMax, epaisseurMax * 0.75, epaisseurMax * 0.5]
    .map(e => arrondiInf(Math.min(e, hauteurMax))).filter(e => e >= coteMin))];
  // Grille de centres fixe : pas d'environ 2 m, 25 positions au plus par axe.
  const NU = Math.max(3, Math.min(25, Math.ceil(largeurMax / 2))), NV = Math.max(3, Math.min(25, Math.ceil(hauteurMax / 2)));
  let meilleur: Rect | null = null;
  for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) {
    const cu = u0 + recul + largeurMax * (i + 0.5) / NU, cv = v0 + recul + hauteurMax * (j + 0.5) / NV;
    if (!dansPolygone(anneaux, cu, cv)) continue;
    for (const d of epaisseurs) {
      if (!rectTient(anneaux, segments, { cu, cv, w: coteMin, d }, recul)) continue;
      let bas = coteMin, haut = largeurMax;
      if (rectTient(anneaux, segments, { cu, cv, w: haut, d }, recul)) bas = haut;
      else for (let k = 0; k < 16 && haut - bas > 0.1; k++) {
        const m = (bas + haut) / 2;
        if (rectTient(anneaux, segments, { cu, cv, w: m, d }, recul)) bas = m; else haut = m;
      }
      const w = arrondiInf(bas);
      if (w >= coteMin && (!meilleur || w * d > meilleur.w * meilleur.d + 1e-6)) meilleur = { cu, cv, w, d };
    }
  }
  return meilleur;
}

/**
 * Lot C7b : plus grand rectangle parallèle à la voie (repère tourné : u le long de la voie), à distance ≥ recul
 * des limites ET entièrement dans la bande principale. Grille de départs fixe, donc déterministe ; à surface
 * égale, le rectangle le plus proche de la voie.
 */
function plusGrandRectangleBande(anneaux: PointLocal[][], recul: number, epaisseurMax: number, coteMin: number, facades: FacadeLocale[], profondeurM: number, reculVoie?: number,
  /** Lot C11 : implantation en limite latérale permise ; `capM2` : emprise maximale (le rectangle rendu la respecte déjà). */
  enLimite?: { capM2: number } | null): Rect | null {
  const segments = segmentsDe(anneaux);
  // Lot C10 : recul différencié seulement si chaque façade sur voie est retrouvée sur le contour ; sinon recul uniforme.
  const differencie = reculVoie !== undefined && marquerSegmentsVoie(segments, facades);
  // Lot C11 : limites latérales retrouvées sur le contour → recherche « en limite ou en retrait » (ci-dessous).
  const cotes = enLimite ? marquerSegmentsLateraux(segments, anneaux[0].length, facades) : 0;
  const rVoie = differencie ? reculVoie as number : recul, rMin = cotes ? 0 : Math.min(recul, rVoie);
  const us = anneaux[0].map(p => p.x), vs = anneaux[0].map(p => p.y);
  const fu = facades.flatMap(f => [f.a.x, f.b.x]), fv = facades.flatMap(f => [f.a.y, f.b.y]);
  // Zone utile : la parcelle moins le recul, réduite à ce qui peut être à moins de `profondeurM` d'une façade.
  const u0 = Math.max(Math.min(...us) + rMin, Math.min(...fu) - profondeurM), u1 = Math.min(Math.max(...us) - rMin, Math.max(...fu) + profondeurM);
  const v0 = Math.max(Math.min(...vs) + rMin, Math.min(...fv) - profondeurM), v1 = Math.min(Math.max(...vs) - rMin, Math.max(...fv) + profondeurM);
  const largeurMax = u1 - u0, hauteurMax = v1 - v0;
  if (largeurMax < coteMin || hauteurMax < coteMin) return null;
  // Épaisseurs essayées : celles du calcul habituel, et la profondeur de bande moins le recul côté voie (à 0,5 m et 1 m près).
  const habituelles = [epaisseurMax, epaisseurMax * 0.75, epaisseurMax * 0.5, profondeurM - rVoie, profondeurM - rVoie - 0.5, profondeurM - rVoie - 1];
  // Lot C11, en limite : un bâtiment de limite à limite ne passe sous le plafond d'emprise qu'à une épaisseur
  // précise — on ajoute les épaisseurs proches du maximum (pas de 0,5 m sur 4 m) et celles qui mettent une largeur
  // égale à la façade sous le plafond (à ± 1 m).
  const candidates = cotes && enLimite ? [...habituelles, ...epaisseursEnLimite(epaisseurMax, enLimite.capM2, facades)] : habituelles;
  const epaisseurs = [...new Set(candidates
    .map(e => arrondiInf(Math.min(e, epaisseurMax, hauteurMax))).filter(e => e >= coteMin))].sort((a, b) => b - a);
  const tient = (r: Rect, lateral?: readonly number[]) => {
    if (!rectTient(anneaux, segments, r, recul, differencie ? rVoie : undefined, lateral)) return false;
    const x0 = r.cu - r.w / 2, x1 = r.cu + r.w / 2, y0 = r.cv - r.d / 2, y1 = r.cv + r.d / 2;
    return rectangleDansBande([{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], facades, profondeurM);
  };
  // Lot C11 : chaque côté latéral est à gauche (u bas) ou à droite (u haut) du côté voie. Deux côtés du même bord,
  // ou plus de deux côtés : cas non traité, le retrait est gardé partout (cotesG null).
  const milieuFacades = fu.reduce((a, b) => a + b, 0) / fu.length;
  const gauches = Array.from({ length: cotes }, (_, i) => {
    const us2 = segments.filter(s => s.laterale === i + 1).flatMap(s => [s.a.x, s.b.x]);
    return us2.reduce((a, b) => a + b, 0) / us2.length < milieuFacades;
  });
  const cotesG: boolean[] | null = cotes >= 1 && cotes <= 2 && (cotes === 1 || gauches[0] !== gauches[1]) ? gauches : null;
  /** Marges tenues aux limites latérales : `mG` au côté gauche, `mD` au côté droit (0 : contact permis ; `recul` : retrait). */
  const tientCotes = (r: Rect, mG: number, mD: number) => tient(r, (cotesG ?? []).map(gauche => gauche ? mG : mD));
  // Le plus loin que le bord peut aller (de `depuis` vers `jusque`) sans que le rectangle cesse de tenir.
  const pousser = (depuis: number, jusque: number, essai: (bord: number) => boolean) => {
    if (essai(jusque)) return jusque;
    let bas = depuis, haut = jusque;
    for (let k = 0; k < 24 && Math.abs(haut - bas) > 0.01; k++) { const m = (bas + haut) / 2; if (essai(m)) bas = m; else haut = m; }
    return bas;
  };
  // Grille de départs fixe : environ 2 m le long de la voie, 0,25 m en profondeur ; chaque départ est élargi
  // vers la gauche puis vers la droite (le rectangle n'est pas forcément centré sur son départ).
  const NU = Math.max(3, Math.min(25, Math.ceil(largeurMax / 2))), NV = Math.max(3, Math.min(120, Math.ceil(hauteurMax / 0.25)));
  let meilleur: Rect | null = null, distanceMeilleur = Infinity;
  const rangeesVues = new Set<string>();
  for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) {
    const su = u0 + largeurMax * (i + 0.5) / NU, cv = v0 + hauteurMax * (j + 0.5) / NV;
    if (distanceVoie({ x: su, y: cv }, facades) > profondeurM || !dansPolygone(anneaux, su, cv)) continue;
    for (const d of epaisseurs) {
      if (meilleur && largeurMax * d < meilleur.w * meilleur.d - 1e-6) continue;
      const entre = (g: number, dr: number): Rect => ({ cu: (g + dr) / 2, cv, w: dr - g, d });
      // Départ : le plus petit rectangle admis, calé sur le départ et ramené dans la zone utile.
      const g0 = Math.max(u0, Math.min(su - coteMin / 2, u1 - coteMin));
      if (cotesG !== null && enLimite) {
        // Lot C11 — « en limite OU en retrait » : de chaque côté, le rectangle est poussé soit jusqu'au contact de la
        // limite latérale (marge 0), soit jusqu'au retrait ; les quatre combinaisons sont essayées. Un bord au contact
        // est gardé tel quel (pas d'arrondi qui le décollerait) ; seul un bord libre est arrondi ou ramené sous le plafond.
        if (!tientCotes(entre(g0, g0 + coteMin), 0, 0)) continue;
        // Une même rangée (profondeur, épaisseur) donne les mêmes rectangles quel que soit le départ : un seul départ par rangée.
        const rangee = `${j}:${d}`;
        if (rangeesVues.has(rangee)) continue;
        rangeesVues.add(rangee);
        for (const mG of [0, recul]) {
          if (!tientCotes(entre(g0, g0 + coteMin), mG, 0)) continue;
          const g = pousser(g0, u0, x => tientCotes(entre(x, g0 + coteMin), mG, 0));
          for (const mD of [0, recul]) {
            if (!tientCotes(entre(g, g + coteMin), mG, mD)) continue;
            const dr = pousser(g + coteMin, u1, x => tientCotes(entre(g, x), mG, mD));
            if (dr - g < coteMin - 1e-9) continue;
            const dl = distancesLaterales(segments, entre(g, dr), cotes);
            const contact = (cote: 'g' | 'd') => cotesG.some((gauche, i) => gauche === (cote === 'g') && dl[i] <= CONTACT_LIMITE_M);
            const aG = contact('g'), aD = contact('d');
            let r: Rect;
            if (aG && aD) {
              // De limite à limite : largeur gardée (au centimètre inférieur, le contact reste dans la tolérance).
              const w = Math.floor((dr - g) * 100) / 100;
              if (w * d > enLimite.capM2 + 1e-6) continue;
              r = { cu: (g + dr) / 2, cv, w, d, ancre: 'gd' };
            }
            else {
              const w = arrondiInf(Math.min(dr - g, enLimite.capM2 / d));
              if (w < coteMin) continue;
              r = aD && !aG ? { ...entre(dr - w, dr), ancre: 'd' } : aG ? { ...entre(g, g + w), ancre: 'g' } : entre(g, g + w);
            }
            if (!tientCotes(r, 0, 0) || !lateralesAdmises(distancesLaterales(segments, r, cotes), recul)) continue;
            const distance = distanceVoie({ x: r.cu, y: r.cv }, facades);
            const aire = r.w * d, aireMeilleur = meilleur ? meilleur.w * meilleur.d : -1;
            if (aire > aireMeilleur + 1e-6 || (Math.abs(aire - aireMeilleur) <= 1e-6 && distance < distanceMeilleur - 1e-9)) { meilleur = r; distanceMeilleur = distance; }
          }
        }
        continue;
      }
      if (!tient(entre(g0, g0 + coteMin))) continue;
      const gauche = pousser(g0, u0, g => tient(entre(g, g0 + coteMin)));
      const droite = pousser(g0 + coteMin, u1, dr => tient(entre(gauche, dr)));
      const w = arrondiInf(droite - gauche);
      if (w < coteMin) continue;
      const r = entre(gauche, gauche + w);
      const distance = distanceVoie({ x: r.cu, y: r.cv }, facades);
      const aire = w * d, aireMeilleur = meilleur ? meilleur.w * meilleur.d : -1;
      if (aire > aireMeilleur + 1e-6 || (Math.abs(aire - aireMeilleur) <= 1e-6 && distance < distanceMeilleur - 1e-9)) { meilleur = r; distanceMeilleur = distance; }
    }
  }
  return meilleur;
}

/**
 * Lot C11 — épaisseurs supplémentaires essayées quand un bâtiment peut aller d'une limite latérale à l'autre :
 * les demi-mètres sous l'épaisseur maximale (sur 4 m), et autour de plafond d'emprise / longueur de façade (± 1 m).
 */
export function epaisseursEnLimite(epaisseurMax: number, capM2: number | null, facades: readonly FacadeLocale[]): number[] {
  const out = Array.from({ length: 9 }, (_, i) => epaisseurMax - 0.5 * i);
  const facade = facades.reduce((s, f) => s + Math.hypot(f.b.x - f.a.x, f.b.y - f.a.y), 0);
  if (capM2 !== null && capM2 > 0 && facade > 0) { const e = capM2 / facade; out.push(e + 1, e + 0.5, e, e - 0.5, e - 1); }
  return out;
}

/** Normalise un ratio PLU : seuls les ratios entre 0 et 1 sont acceptés (40 → refusé, comme ailleurs dans l'app). */
export function ratioEmprise(v: unknown): number | null {
  const n = nombre(v);
  return n !== null && n > 0 && n <= 1 ? n : null;
}

const LIBELLES_REGLES: Record<CleReglePlu, string> = {
  hauteur_max_m: 'Hauteur maximale', hauteur_faitage_m: 'Hauteur au faîtage', niveaux_max: 'Niveaux maximum',
  emprise_max_ratio: 'Emprise au sol (CES)', recul_voie_m: 'Recul à la voie', recul_limites_m: 'Recul aux limites séparatives',
  recul_limites_formule: 'Recul aux limites séparatives', pleine_terre_min_ratio: 'Pleine terre / espaces verts', epaisseur_max_m: 'Épaisseur maximale',
};
const STATUTS_REGLE = { lue: 'lue dans le règlement', importee: 'règlement importé', estimee: 'estimée, à confirmer' } as const;

/** Valeur lisible d'une règle (« 12 m », « 40 % », « H/2, min. 4 m », « R+4 »). */
export function valeurRegleLisible(r: ReglePlu): string {
  if (r.cle === 'recul_limites_formule') return `H/${fr(r.valeur, 1)}${r.minimumM ? `, min. ${fr(r.minimumM, 1)} m` : ''}`;
  if (r.cle === 'emprise_max_ratio' || r.cle === 'pleine_terre_min_ratio') return `${fr(r.valeur * 100, 1)} %`;
  if (r.cle === 'niveaux_max') return `${fr(r.valeur)} niveaux (R+${fr(r.valeur - 1)})`;
  return `${fr(r.valeur, 1)} m`;
}

/** Règle valide (bornes de bon sens) ; les autres sont ignorées. */
export function regleValide(r: ReglePlu): boolean {
  const v = r.valeur;
  if (!Number.isFinite(v) || v <= 0) return false;
  switch (r.cle) {
    case 'emprise_max_ratio': return v <= 1;
    case 'pleine_terre_min_ratio': return v < 1;
    case 'niveaux_max': return Number.isInteger(v) && v <= 80;
    case 'recul_limites_formule': return v >= 1 && v <= 4 && (r.minimumM == null || (r.minimumM >= 0 && r.minimumM <= 50));
    case 'epaisseur_max_m': return v >= 6 && v <= 60;
    default: return v <= (r.cle.startsWith('recul') ? 50 : 200);
  }
}

/** Lot C10 : reculs retenus pour un jeu de règles (même sélection pour le volume unique et pour l'implantation multi-bâtiments). */
export interface ReculsRetenus {
  /** Au moins un recul lu (voie, limites ou formule). */
  reculConnu: boolean;
  /** Recul UNIFORME d'origine : le plus fort des reculs lus pour cette hauteur, ou 4 m par défaut. */
  uniformePour: (hauteurM: number) => number;
  /** Un recul aux limites séparatives est lu (valeur ou formule H/k). */
  limitesLues: boolean;
  /** Recul aux limites AUTRES que la voie : reculs aux limites lus ; à défaut, le recul uniforme d'origine. */
  limitesPour: (hauteurM: number) => number;
  /** Recul côté voie ÉTABLI par une règle lue (m ; 0 = alignement permis) ; null : non établi, recul uniforme partout. */
  voieM: number | null;
  /** D'où vient `voieM` : règle chiffrée des règles du volume, ou implantation fournie par l'appelant. */
  origineVoie: 'regle' | 'implantation' | null;
  /** Lot C11 : implantation en limite séparative permise par la règle lue (fournie par l'appelant avec la bande). */
  enLimite: boolean;
}

/**
 * Lot C10 — reculs à appliquer. `implantation` : celle de la bande préparée (côté voie identifié) ; null hors
 * bande → `voieM` null, donc aucun recul différencié. Le recul à la voie n'est établi que par une règle chiffrée
 * `recul_voie_m` ou par `implantation.reculVoieM` (valeur lue, 0 = alignement) ; si les deux existent, le plus fort.
 */
export function reculsRetenus(regles: readonly ReglePlu[], implantation: { reculVoieM: number | null; limiteSeparativePermise?: boolean } | null): ReculsRetenus {
  const H = HYPOTHESES_VOLUME;
  const valides = regles.filter(regleValide);
  const max = (cle: CleReglePlu) => { const l = valides.filter(r => r.cle === cle); return l.length ? Math.max(...l.map(r => r.valeur)) : null; };
  const voieRegle = max('recul_voie_m'), limites = max('recul_limites_m');
  const formules = valides.filter(r => r.cle === 'recul_limites_formule');
  const formule = formules.length ? formules.reduce((a, b) => b.valeur < a.valeur || (b.valeur === a.valeur && (b.minimumM ?? 0) > (a.minimumM ?? 0)) ? b : a) : null;
  const parFormule = (h: number) => formule ? Math.max(formule.minimumM ?? 0, h / formule.valeur) : 0;
  const reculConnu = voieRegle !== null || limites !== null || formule !== null;
  const uniformePour = (h: number) => !reculConnu ? H.reculDefautM : Math.max(voieRegle ?? 0, limites ?? 0, parFormule(h));
  const limitesLues = limites !== null || formule !== null;
  const lue = implantation ? implantation.reculVoieM : null;
  const voieM = !implantation ? null : lue !== null ? Math.max(lue, voieRegle ?? 0) : voieRegle;
  return {
    reculConnu, uniformePour, limitesLues,
    limitesPour: (h: number) => limitesLues ? Math.max(limites ?? 0, parFormule(h)) : uniformePour(h),
    voieM, origineVoie: voieM === null ? null : lue !== null && lue >= (voieRegle ?? 0) ? 'implantation' : 'regle',
    enLimite: !!implantation && implantation.limiteSeparativePermise === true,
  };
}

/**
 * Volume d'étude proposé sur la parcelle.
 * `bande` (facultatif, lot C7b) : bande principale d'un PLU « par bande ». Absente : calcul habituel, résultat
 * inchangé. Présente et utilisable : volume dans la bande, parallèle à la voie. Présente mais inutilisable
 * (côté voie non identifié, bande trop petite…) : calcul habituel, avec la raison dans `bande.raison` et dans
 * les alertes — jamais d'exception, jamais de valeur supposée.
 */
export function calculerVolumeParcelle(
  geometrie: GeometrieParcelle | null | undefined,
  programme: ProgrammeVolume,
  regles: ReglesPluVolume = REGLES_INCONNUES,
  bande?: BandeVoie | null,
): VolumePropose {
  if (bande === undefined || bande === null) return calculerVolume(geometrie, programme, regles, null);
  const H = HYPOTHESES_VOLUME;
  const profondeurLue = typeof bande.profondeurM === 'number' && Number.isFinite(bande.profondeurM) && bande.profondeurM > 0 ? bande.profondeurM : null;
  const plafondLu = typeof bande.empriseMaxM2 === 'number' && Number.isFinite(bande.empriseMaxM2) && bande.empriseMaxM2 > 0 ? bande.empriseMaxM2 : null;
  const sansBande = (raison: string): VolumePropose => {
    const v = calculerVolume(geometrie, programme, regles, null);
    const texte = `Bande principale non appliquée : ${raison}${v.emprise ? ' Volume placé sans tenir compte de la bande.' : ''}`;
    return { ...v, alertes: [...v.alertes, texte], bande: { statut: 'non-appliquee', raison: texte, profondeurM: profondeurLue, longueurFacadeM: null, angleVoieDeg: null, distanceMaxVoieM: null, empriseMaxM2: plafondLu } };
  };
  const proj = projeterParcelle(geometrie);
  if (!proj || proj.anneaux[0].length < 3) return sansBande('contour cadastral illisible.');
  const prep = preparerBande(bande, proj.origine, proj.anneaux[0], H.coteMinM);
  if (!prep.ok) return sansBande(prep.raison);
  const b = prep.bande;
  // Lot C11 — implantation en limite séparative permise : d'abord le volume EN RETRAIT de toutes les limites
  // séparatives (calcul du lot C10, inchangé). L'implantation en limite n'est utilisée que si le programme n'y
  // tient pas (ou s'il est inconnu), et gardée seulement si elle donne plus de surface de plancher.
  let limite: 'appliquee' | 'inutile' | 'sans-gain' | 'impossible' = 'impossible';
  let v: VolumePropose;
  if (!b.implantation.limiteSeparativePermise) v = calculerVolume(geometrie, programme, regles, b);
  else {
    const retrait = calculerVolume(geometrie, programme, regles, { ...b, implantation: { ...b.implantation, limiteSeparativePermise: false } });
    if (retrait.emprise && retrait.programmeAtteint === true) { v = retrait; limite = 'inutile'; }
    else {
      const enLimite = calculerVolume(geometrie, programme, regles, b);
      if (enLimite.emprise && enLimite.bande?.reculLateralM !== undefined && enLimite.sdpM2 > retrait.sdpM2) { v = enLimite; limite = 'appliquee'; }
      else { v = retrait; if (enLimite.bande?.reculLateralM !== undefined) limite = 'sans-gain'; }
    }
  }
  if (!v.emprise) {
    return sansBande(v.statut === 'trop-petite'
      ? `aucun rectangle de ${H.coteMinM} × ${H.coteMinM} m ne tient à la fois à ${fr(v.reculM, 1)} m des limites et à moins de ${fr(b.profondeurM, 1)} m du côté voie${b.empriseMaxM2 !== null ? ` (emprise maximale ${fr(b.empriseMaxM2)} m²)` : ''}.`
      : 'aucun volume proposé sur cette parcelle.');
  }
  const distanceMax = Math.max(...v.emprise.coins.map(p => distanceVoie(p, b.facades)));
  return {
    ...v,
    hypotheses: [...v.hypotheses,
      ...(b.empriseMaxM2 !== null ? [`Emprise au sol bornée à ${fr(b.empriseMaxM2)} m² : maximum de la bande principale.`] : []),
      `Bande secondaire (au-delà de ${fr(b.profondeurM, 1)} m depuis la voie) : non construite dans ce volume d’étude.`,
      ...hypothesesImplantation(b, limite)],
    bande: {
      statut: 'appliquee', raison: null, profondeurM: b.profondeurM, longueurFacadeM: b.longueurFacadeM,
      angleVoieDeg: Math.round(b.angle * 180 / Math.PI * 10) / 10,
      distanceMaxVoieM: Math.ceil(distanceMax * 100 - 1e-6) / 100, empriseMaxM2: b.empriseMaxM2,
      ...(v.bande?.reculVoieM !== undefined ? { reculVoieM: v.bande.reculVoieM, reculLimitesM: v.reculM } : {}),
      ...(v.bande?.reculLateralM !== undefined ? { reculLateralM: v.bande.reculLateralM, reculLimitesM: v.reculM } : {}),
      ...(b.surfaceBandeM2 !== null ? { surfaceBandeM2: b.surfaceBandeM2 } : {}),
    },
  };
}

/**
 * Lot C10 : lignes d'hypothèses tirées de l'implantation fournie (notes de l'appelant).
 * Lot C11 : `limite` — sort de l'implantation en limite quand la règle lue la permet : appliquée (l'hypothèse des
 * reculs le dit alors), inutile (le programme tient en retrait), sans gain, impossible, ou programme de maisons.
 */
export function hypothesesImplantation(b: BandePreparee, limite: 'appliquee' | 'inutile' | 'sans-gain' | 'impossible' | 'maisons' = 'impossible'): string[] {
  const permise = `Implantation en limite séparative permise selon la règle lue${b.implantation.sourceLimites ? ` (${b.implantation.sourceLimites})` : ''}`;
  const suite: Record<typeof limite, string | null> = {
    appliquee: null,   // dite dans l'hypothèse des reculs
    inutile: 'non utilisée dans ce volume d’étude, le programme tient en retrait des limites séparatives.',
    'sans-gain': 'non utilisée dans ce volume d’étude, elle n’y loge rien de plus que l’implantation en retrait.',
    impossible: 'NON appliquée dans ce volume d’étude (limites latérales non identifiables sur le contour) — retrait conservé sur les limites autres que la voie, ce qui peut sous-estimer l’emprise possible.',
    maisons: 'NON appliquée aux maisons de ce volume d’étude — retrait conservé sur les limites autres que la voie.',
  };
  return [
    ...b.implantation.notes,
    ...(b.implantation.limiteSeparativePermise && suite[limite] ? [`${permise} : ${suite[limite]}`] : []),
  ];
}

/**
 * Lot C10 : première ligne d'hypothèses quand les reculs sont différenciés (recul côté voie établi par une règle lue).
 * `reculLimitesM` null : la valeur dépend du bâtiment (plusieurs hauteurs), elle n'est pas chiffrée dans la phrase.
 */
export function hypotheseReculsDifferencies(rc: ReculsRetenus, b: BandePreparee, reculLimitesM: number,
  /** Lot C11 : implantation en limite appliquée aux limites latérales ; `contacts` : limites latérales touchées par au moins un bâtiment, `videMaxM` : plus grand vide derrière un contact. */
  enLimite: { contacts: number; cotes: number; videMaxM: number } | null = null): string {
  const source = rc.origineVoie === 'implantation' && b.implantation.sourceVoie ? ` (${b.implantation.sourceVoie})` : '';
  const coteVoie = rc.voieM === null
    // Lot C11 : recul à la voie non établi, mais limites latérales différenciées — le recul prudent reste dû côté voie.
    ? `Recul de ${fr(reculLimitesM, 1)} m côté voie (recul à la voie non établi : le plus fort des reculs lus pour cette hauteur, ou la valeur par défaut)`
    : rc.voieM === 0
      ? (rc.origineVoie === 'implantation' && b.implantation.motifVoie === 'non_reglementee'
        ? `Côté voie : implantation à l’alignement (recul 0 m) RETENUE par le volume d’étude, le recul sur voie n’étant pas réglementé${source}`
        : `Côté voie : implantation à l’alignement (recul 0 m), permise par la règle lue${source}`)
      : `Recul de ${fr(rc.voieM, 1)} m côté voie : règle de recul à la voie lue${source}`;
  if (enLimite) {
    const src = b.implantation.sourceLimites ? ` (${b.implantation.sourceLimites})` : '';
    const contact = enLimite.contacts === 0 ? 'aucune n’est touchée par ce volume'
      : `${enLimite.contacts} sur ${enLimite.cotes} touchée${enLimite.contacts > 1 ? 's' : ''} par ce volume` +
        (enLimite.videMaxM > CONTACT_LIMITE_M ? ` ; limite non parallèle au pignon : contact en un point, vide en biais jusqu’à ${fr(enLimite.videMaxM, 1)} m à traiter au plan` : '');
    return `${coteVoie} ; limites latérales (celles qui partent de la voie) : implantation en limite séparative permise par la règle lue${src} — ${contact} ; ` +
      `retrait de ${fr(reculLimitesM, 1)} m sur le fond de parcelle et sur toute limite latérale non touchée${rc.limitesLues ? ' (le plus fort des reculs aux limites lus pour cette hauteur)' : ' (recul aux limites non lu : valeur prudente)'}. ` +
      'Côté voie et limites latérales présumés d’après le cadastre, à confirmer.';
  }
  const autres = rc.limitesLues
    ? `recul de ${fr(reculLimitesM, 1)} m aux autres limites : le plus fort des reculs aux limites séparatives lus pour cette hauteur`
    : rc.reculConnu
      ? `recul de ${fr(reculLimitesM, 1)} m aux autres limites : recul aux limites séparatives non lu, valeur du recul à la voie reprise`
      : `recul de ${fr(reculLimitesM, 1)} m aux autres limites (valeur par défaut : recul aux limites séparatives non lu)`;
  return `${coteVoie} ; ${autres}. Reculs différenciés : le côté voie est présumé d’après le cadastre (limite sans parcelle mitoyenne), à confirmer.`;
}

/** Lot C11 : précision ajoutée à la règle de recul (formule) quand le volume est implanté en limite latérale. */
export const PRECISION_RETRAIT_EN_LIMITE = ' — dû sur le fond de parcelle et sur toute limite latérale non touchée';

/** Le calcul lui-même. `bande` null : comportement d'origine, à l'identique. */
function calculerVolume(
  geometrie: GeometrieParcelle | null | undefined,
  programme: ProgrammeVolume,
  regles: ReglesPluVolume,
  bande: BandePreparee | null,
): VolumePropose {
  const H = HYPOTHESES_VOLUME;
  const valides = (regles.regles ?? []).filter(regleValide);
  // Pour chaque notion, la règle la PLUS CONTRAIGNANTE est retenue (plusieurs sources ou valeurs possibles).
  const plusContraignante = (cle: CleReglePlu, sens: 'min' | 'max'): ReglePlu | null => {
    const l = valides.filter(r => r.cle === cle);
    return l.length ? l.reduce((a, b) => (sens === 'min' ? b.valeur < a.valeur : b.valeur > a.valeur) ? b : a) : null;
  };
  const rHauteur = plusContraignante('hauteur_max_m', 'min'), rFaitage = plusContraignante('hauteur_faitage_m', 'min');
  const rNiveaux = plusContraignante('niveaux_max', 'min'), rCes = plusContraignante('emprise_max_ratio', 'min');
  const rVoie = plusContraignante('recul_voie_m', 'max'), rLimites = plusContraignante('recul_limites_m', 'max');
  const rPleineTerre = plusContraignante('pleine_terre_min_ratio', 'max'), rEpaisseur = plusContraignante('epaisseur_max_m', 'min');
  // Formule H/k : la plus contraignante est celle de plus petit diviseur (à minimum égal, le plus grand minimum).
  const formules = valides.filter(r => r.cle === 'recul_limites_formule');
  const rFormule = formules.length ? formules.reduce((a, b) => b.valeur < a.valeur || (b.valeur === a.valeur && (b.minimumM ?? 0) > (a.minimumM ?? 0)) ? b : a) : null;
  const appliquees = new Map<ReglePlu, string>();
  const noter = (r: ReglePlu | null, effet: string) => { if (r) appliquees.set(r, effet); };

  // Hauteur : la contrainte la plus sûre pour un volume à toit plat est la plus basse des hauteurs connues.
  const hauteurRegle = rHauteur && rFaitage ? (rHauteur.valeur <= rFaitage.valeur ? rHauteur : rFaitage) : rHauteur ?? rFaitage;
  const hauteurMax = hauteurRegle?.valeur ?? null;
  if (hauteurRegle) noter(hauteurRegle, rHauteur && rFaitage
    ? `hauteur retenue ${fr(hauteurRegle.valeur, 1)} m (la plus basse entre égout ${fr(rHauteur.valeur, 1)} m et faîtage ${fr(rFaitage.valeur, 1)} m), toit plat`
    : hauteurRegle.cle === 'hauteur_faitage_m' ? 'hauteur au faîtage appliquée au toit plat du volume' : 'hauteur du volume plafonnée');
  const niveauxParHauteur = hauteurMax !== null ? Math.floor(hauteurMax / H.hauteurEtageM + 1e-9) : H.niveauxMaxStudio;
  const niveauxMax = Math.min(H.niveauxMaxStudio, niveauxParHauteur, rNiveaux?.valeur ?? H.niveauxMaxStudio);
  if (rNiveaux) noter(rNiveaux, 'nombre de niveaux plafonné');

  // Emprise : CES (règle ou 40 % par défaut) et pleine terre (la part non bâtie doit au moins la couvrir).
  const cesRetenu = rCes?.valeur ?? H.cesDefaut;
  const capPleineTerre = rPleineTerre ? 1 - rPleineTerre.valeur : 1;
  const ratioEmpriseRetenu = Math.min(cesRetenu, capPleineTerre);
  if (rCes) noter(rCes, 'emprise au sol plafonnée');
  if (rPleineTerre) noter(rPleineTerre, `emprise plafonnée à ${fr(capPleineTerre * 100, 1)} % de la parcelle (le reste supposé en pleine terre, voiries et stationnements non déduits)`);
  const epaisseurMax = rEpaisseur?.valeur ?? H.epaisseurMaxM;
  if (rEpaisseur) noter(rEpaisseur, 'épaisseur du volume plafonnée');

  // Recul uniforme sur toutes les limites (côté voie non identifié) : le plus fort des reculs connus pour une hauteur donnée.
  const reculConnu = Boolean(rVoie || rLimites || rFormule);
  const reculUniformePour = (hauteurM: number) => !reculConnu ? H.reculDefautM : Math.max(
    rVoie?.valeur ?? 0, rLimites?.valeur ?? 0,
    rFormule ? Math.max(rFormule.minimumM ?? 0, hauteurM / rFormule.valeur) : 0);
  // Lot C10 — bande appliquée ET recul à la voie établi par une règle lue ET façades retrouvées sur le contour :
  // recul « voie » côté voie, recul « limites » ailleurs. Sinon (toujours hors bande) : recul uniforme d'origine.
  const rc = reculsRetenus(valides, bande ? bande.implantation : null);
  const proj0 = bande && (rc.voieM !== null || rc.enLimite) ? projeterParcelle(geometrie) : null;
  const differencie = !!bande && rc.voieM !== null && !!proj0 && marquerSegmentsVoie(segmentsDe(proj0.anneaux), bande.facades);
  const reculVoieM = differencie ? rc.voieM as number : null;
  const reculPour = differencie ? rc.limitesPour : reculUniformePour;
  // Lot C11 — implantation en limite : seulement si la règle lue la permet ET si les limites latérales sont
  // retrouvées sur le contour (ce qui exige les limites sur voie). Sinon rien ne change.
  const cotesLateraux = bande && rc.enLimite && proj0 ? marquerSegmentsLateraux(segmentsDe(proj0.anneaux), proj0.anneaux[0].length, bande.facades) : 0;
  const enLimite = cotesLateraux > 0;

  const mentionPlu = appliquees.size || valides.length
    ? 'Règles PLU appliquées — conformité à vérifier par un professionnel'
    : regles.source === 'reglement-texte'
      ? 'Hypothèse — règlement PLU lu, aucune règle chiffrée reprise'
      : 'Hypothèse — règlement PLU non lu';
  const hypotheses = [
    reculConnu ? `Recul appliqué sur toutes les limites : le plus fort des reculs PLU (côté voie non identifié).`
      : bande ? `Recul de ${fr(H.reculDefautM)} m sur toutes les limites, côté voie compris (valeur par défaut).`
      : `Recul de ${fr(H.reculDefautM)} m sur toutes les limites (valeur par défaut).`,
    rCes ? `Emprise au sol bornée à ${fr(cesRetenu * 100, 1)} % de la parcelle (règle PLU).` : `Emprise au sol bornée à ${fr(cesRetenu * 100)} % de la parcelle (valeur par défaut).`,
    bande
      ? `Bâtiment d’épaisseur ${fr(epaisseurMax, 1)} m au plus${rEpaisseur ? ' (règle PLU)' : ''}, implanté dans la bande principale (${fr(bande.profondeurM, 1)} m depuis le côté voie présumé), parallèlement à la voie.`
      : `Bâtiment d’épaisseur ${fr(epaisseurMax, 1)} m au plus${rEpaisseur ? ' (règle PLU)' : ''}, orienté selon le grand côté de la parcelle.`,
    `Hauteur d’étage ${fr(H.hauteurEtageM)} m, toit plat ; SDP estimée ≈ emprise × niveaux.`,
  ];
  const lignesRegles = () => [...appliquees.entries()].map(([r, effet]) =>
    `${LIBELLES_REGLES[r.cle]} : ${valeurRegleLisible(r)} — ${effet} (${r.source}${r.reference ? `, ${r.reference}` : ''} ; ${STATUTS_REGLE[r.statut]}).`);
  const vide = (statut: StatutVolume, contour: PointLocal[], origine: { lon: number; lat: number }, surface: number, alertes: string[], reculM = reculPour(0)): VolumePropose => ({
    statut, surfaceParcelleM2: surface, contour, origine, emprise: null, niveaux: 0, hauteurM: 0, sdpM2: 0,
    logementsEstimes: null, sdpViseeM2: null, programmeAtteint: null, reculM, cesRetenu, hypotheses, alertes, mentionPlu,
    reglesAppliquees: lignesRegles(), reglesNonAppliquees: [...regles.nonAppliquees],
  });

  const proj = projeterParcelle(geometrie);
  if (!proj || proj.anneaux[0].length < 3) return vide('contour-invalide', [], { lon: 0, lat: 0 }, 0, ['Contour cadastral illisible : aucun volume proposé.']);
  const contour = proj.anneaux[0];
  const surface = Math.abs(aireSignee(contour)) - proj.anneaux.slice(1).reduce((s, t) => s + Math.abs(aireSignee(t)), 0);
  if (!(surface > 1)) return vide('contour-invalide', contour, proj.origine, 0, ['Contour cadastral de surface nulle : aucun volume proposé.']);
  if (niveauxMax < 1) return vide('hauteur-insuffisante', contour, proj.origine, surface, [`Hauteur PLU de ${fr(hauteurMax ?? 0, 1)} m inférieure à un étage de ${H.hauteurEtageM} m : aucun volume proposé.`]);

  // Repère tourné : u le long du grand axe de la parcelle — ou le long de la voie si une bande est appliquée.
  const angle = bande ? bande.angle : orientationParcelle(contour);
  const c = Math.cos(-angle), s = Math.sin(-angle);
  const tourner = (p: PointLocal) => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c });
  const anneauxUV = proj.anneaux.map(r => r.map(tourner));
  const facadesUV = bande ? bande.facades.map(f => ({ a: tourner(f.a), b: tourner(f.b) })) : null;
  const empriseMaxSurface = bande && bande.empriseMaxM2 !== null ? Math.min(ratioEmpriseRetenu * surface, bande.empriseMaxM2) : ratioEmpriseRetenu * surface;
  const cacheRect = new Map<string, Rect | null>();
  /** Emprise possible pour n niveaux : le recul peut dépendre de la hauteur (règle H/k). */
  const evaluer = (n: number) => {
    const reculM = Math.round(reculPour(n * H.hauteurEtageM) * 100) / 100;
    const cle = reculM.toFixed(2);
    if (!cacheRect.has(cle)) cacheRect.set(cle, bande && facadesUV
      ? plusGrandRectangleBande(anneauxUV, reculM, epaisseurMax, H.coteMinM, facadesUV, bande.profondeurM, reculVoieM ?? undefined, enLimite ? { capM2: empriseMaxSurface } : null)
      : plusGrandRectangle(anneauxUV, reculM, epaisseurMax, H.coteMinM));
    const rect = cacheRect.get(cle);
    if (!rect) return null;
    let w = rect.w, d = rect.d;
    // Lot C11 : un rectangle « en limite » sort de la recherche déjà sous le plafond d'emprise (il n'est pas réduit ici).
    if (w * d > empriseMaxSurface + 1e-6 && !enLimite) {
      w = arrondiInf(Math.max(H.coteMinM, empriseMaxSurface / d));
      if (w * d > empriseMaxSurface + 1e-6 || w <= H.coteMinM) { const cote = arrondiInf(Math.sqrt(empriseMaxSurface)); w = Math.min(w, cote); d = Math.min(d, cote); }
    }
    if (w < H.coteMinM || d < H.coteMinM) return null;
    return { n, reculM, rect, w, d };
  };

  const alertes: string[] = [];
  const logements = programme.logements !== null && programme.logements > 0 ? Math.round(programme.logements) : null;
  const sdpVisee = logements !== null ? logements * H.sdpParLogementM2 : null;
  let choix: NonNullable<ReturnType<typeof evaluer>> | null = null;
  if (sdpVisee !== null) {
    // Plus petit nombre de niveaux qui loge le programme ; à défaut, la plus grande capacité.
    let meilleur: NonNullable<ReturnType<typeof evaluer>> | null = null;
    for (let n = 1; n <= niveauxMax; n++) {
      const e = evaluer(n);
      if (!e) { if (rFormule) continue; else break; }
      if (e.w * e.d * n + 1e-6 >= sdpVisee) { choix = e; break; }
      if (!meilleur || e.w * e.d * n > meilleur.w * meilleur.d * meilleur.n) meilleur = e;
    }
    if (choix) {
      const cible = sdpVisee / choix.n;
      // Lot C11 : un rectangle posé contre les DEUX limites latérales garde sa largeur (la réduire le décollerait
      // d'une limite sans atteindre le retrait) : l'emprise peut alors dépasser le besoin du programme.
      if (cible < choix.w * choix.d && choix.rect.ancre !== 'gd') {
        const w2 = Math.ceil(cible / choix.d / 0.5 - 1e-9) * 0.5;
        if (w2 >= H.coteMinM) choix.w = Math.min(choix.w, w2);
        else { const cote = Math.max(H.coteMinM, Math.ceil(Math.sqrt(cible) / 0.5 - 1e-9) * 0.5); choix.w = Math.min(choix.w, cote); choix.d = Math.min(choix.d, cote); }
      }
    } else if (meilleur) {
      choix = meilleur;
      const borneHauteur = niveauxMax < H.niveauxMaxStudio && meilleur.n === niveauxMax;
      alertes.push(borneHauteur && hauteurRegle && niveauxMax === niveauxParHauteur
        ? `Hauteur bornée par le PLU (${fr(hauteurMax!, 1)} m, soit ${niveauxMax} niveau${niveauxMax > 1 ? 'x' : ''}) : programme non atteint.`
        : borneHauteur && rNiveaux
          ? `Niveaux bornés par le PLU (${niveauxMax}) : programme non atteint.`
          : `Programme non atteint avec ${meilleur.n} niveau${meilleur.n > 1 ? 'x' : ''} sur cette parcelle.`);
    }
  } else {
    for (let n = Math.min(H.niveauxIndicatifs, niveauxMax); n >= 1 && !choix; n--) choix = evaluer(n);
    if (choix && niveauxMax < H.niveauxIndicatifs) alertes.push(`Hauteur bornée par le PLU (${fr(hauteurMax ?? niveauxMax * H.hauteurEtageM, 1)} m).`);
  }
  if (!choix) return vide('trop-petite', contour, proj.origine, surface, [
    `Parcelle trop petite ou trop étroite : aucun rectangle de ${H.coteMinM} × ${H.coteMinM} m ne tient à ${fr(reculPour(H.hauteurEtageM), 1)} m des limites${empriseMaxSurface < H.coteMinM ** 2 ? ' (ou emprise autorisée trop faible)' : ''}.`]);

  const { n: niveaux, reculM, rect } = choix;
  const w = choix.w, d = choix.d;
  // Lot C11 : rectangle ancré à une limite latérale — la réduction de largeur se fait du côté libre (le centre se déplace).
  const cuFinal = rect.ancre === 'g' ? rect.cu - rect.w / 2 + w / 2 : rect.ancre === 'd' ? rect.cu + rect.w / 2 - w / 2 : rect.cu;
  // Lot C11 : contacts réels du volume avec les limites latérales, mesurés sur le rectangle final (repère tourné).
  let mesureLimite: { contacts: number; cotes: number; videMaxM: number } | null = null;
  if (enLimite && bande && facadesUV) {
    const segs = segmentsDe(anneauxUV);
    const cotes = marquerSegmentsLateraux(segs, anneauxUV[0].length, facadesUV);
    const final: Rect = { cu: cuFinal, cv: rect.cv, w, d };
    const dl = distancesLaterales(segs, final, cotes);
    // Garde : le volume final doit respecter « en limite OU en retrait » ; sinon aucun volume n'est rendu en bande (repli de l'appelant).
    if (!cotes || !lateralesAdmises(dl, reculM)) return vide('trop-petite', contour, proj.origine, surface, ['Implantation en limite séparative non prouvée sur le volume obtenu : aucun volume proposé dans la bande.'], reculM);
    const coinsUV = [{ x: final.cu - w / 2, y: final.cv - d / 2 }, { x: final.cu + w / 2, y: final.cv - d / 2 }, { x: final.cu + w / 2, y: final.cv + d / 2 }, { x: final.cu - w / 2, y: final.cv + d / 2 }];
    let vide2 = 0, contacts = 0;
    dl.forEach((x, i) => {
      if (x > CONTACT_LIMITE_M + 1e-9) return;
      contacts++;
      const chaine = segs.filter(sg => sg.laterale === i + 1);
      const ds = coinsUV.map(q => Math.min(...chaine.map(sg => distPointSegment(q.x, q.y, sg.a.x, sg.a.y, sg.b.x, sg.b.y)))).sort((p, q) => p - q);
      vide2 = Math.max(vide2, ds[1]);
    });
    mesureLimite = { contacts, cotes, videMaxM: Math.round(vide2 * 100) / 100 };
  }
  if (rVoie) noter(rVoie, differencie ? 'recul appliqué côté voie' : 'recul appliqué');
  if (rLimites) noter(rLimites, differencie ? 'recul appliqué aux limites autres que la voie' : 'recul appliqué');
  if (rFormule) noter(rFormule, `recul recalculé pour H = ${fr(niveaux * H.hauteurEtageM)} m : ${fr(Math.max(rFormule.minimumM ?? 0, niveaux * H.hauteurEtageM / rFormule.valeur), 1)} m${mesureLimite ? PRECISION_RETRAIT_EN_LIMITE : ''}`);
  if (bande && (differencie || mesureLimite)) hypotheses[0] = hypotheseReculsDifferencies(rc, bande, reculM, mesureLimite);
  else if (reculConnu) hypotheses[0] = bande
    ? `Recul de ${fr(reculM, 1)} m sur toutes les limites, côté voie compris : le plus fort des reculs PLU pour cette hauteur (recul à la voie et reculs aux limites non différenciés).`
    : `Recul de ${fr(reculM, 1)} m sur toutes les limites : le plus fort des reculs PLU pour cette hauteur (côté voie non identifié).`;
  if (hauteurMax === null && !rNiveaux) alertes.push(sdpVisee !== null ? 'Hauteur maximale du PLU inconnue : niveaux déduits du seul programme.' : 'Hauteur maximale du PLU inconnue : hauteur indicative.');

  const surfaceEmprise = w * d;
  const sdp = surfaceEmprise * niveaux;
  const programmeAtteint = sdpVisee !== null ? sdp + 1e-6 >= sdpVisee : null;
  const ci = Math.cos(angle), si = Math.sin(angle);
  const retour = (p: PointLocal) => ({ x: p.x * ci - p.y * si, y: p.x * si + p.y * ci });
  const coins = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([du, dv]) => retour({ x: cuFinal + du, y: rect.cv + dv }));
  const centre = retour({ x: cuFinal, y: rect.cv });
  return {
    statut: logements !== null ? 'calcule' : 'indicatif',
    surfaceParcelleM2: Math.round(surface),
    contour, origine: proj.origine,
    emprise: {
      largeurM: w, profondeurM: d, surfaceM2: Math.round(surfaceEmprise),
      centre, centreWgs84: versWgs84(centre, proj.origine),
      angleDeg: Math.round(angle * 180 / Math.PI * 10) / 10, coins,
    },
    niveaux, hauteurM: niveaux * H.hauteurEtageM, sdpM2: Math.round(sdp),
    logementsEstimes: Math.floor(sdp / H.sdpParLogementM2 + 1e-9),
    sdpViseeM2: sdpVisee, programmeAtteint, reculM, cesRetenu,
    hypotheses: [...hypotheses, logements !== null
      ? `Programme : ${logements} logements × ${H.sdpParLogementM2} m² de SDP par logement (parties communes comprises) = ${fr(sdpVisee!)} m² visés.`
      : `Programme inconnu : volume indicatif en R+${H.niveauxIndicatifs - 1} au plus, sur l’emprise possible.`],
    alertes, mentionPlu,
    reglesAppliquees: lignesRegles(),
    reglesNonAppliquees: [...regles.nonAppliquees],
    // Lot C10 : reculs différenciés → repris et complétés par calculerVolumeParcelle (état de la bande).
    ...(reculVoieM !== null || mesureLimite ? { bande: { statut: 'appliquee' as const, raison: null, profondeurM: null, longueurFacadeM: null, angleVoieDeg: null, distanceMaxVoieM: null, empriseMaxM2: null,
      ...(reculVoieM !== null ? { reculVoieM } : {}), reculLimitesM: reculM, ...(mesureLimite ? { reculLateralM: 0 } : {}) } } : {}),
  };
}

/** R+n lisible (1 niveau → R+0). */
export const libelleNiveaux = (niveaux: number) => `R+${Math.max(0, niveaux - 1)}`;

/** Un corps à dessiner (vue 3D, plan axonométrique) : le volume unique ou chacun des bâtiments. */
export interface CorpsAffiche {
  id: string;
  nom: string | null;
  coins: PointLocal[];
  centre: PointLocal;
  largeurM: number;
  profondeurM: number;
  angleDeg: number;
  niveaux: number;
  hauteurM: number;
  /** Bâtiment principal (le plus grand) : celui qui porte les cotes L / P / H. */
  principal: boolean;
  /** Lot formes-batiment : ailes du bâtiment (L, U, cour, redans) ; absent pour un rectangle. */
  ailes?: AilePropose[];
  formeAiles?: FormeAiles;
  decalageM?: number;
}

/** Lot formes-batiment : le volume part à Studio bâtiment par bâtiment (plusieurs, ou un seul à ailes). */
export const volumeParBatiments = (v: Pick<VolumePropose, 'batiments'>): boolean =>
  !!v.batiments && (v.batiments.length > 1 || v.batiments.some(b => (b.ailes?.length ?? 0) >= 2));

/** Corps à dessiner : tous les bâtiments d'une implantation multiple, sinon le volume unique. */
export function corpsAffiches(v: Pick<VolumePropose, 'emprise' | 'niveaux' | 'hauteurM' | 'batiments'>): CorpsAffiche[] {
  const e = v.emprise;
  if (!e) return [];
  if (v.batiments && volumeParBatiments(v)) {
    const principal = v.batiments.find(b => Math.abs(b.centre.x - e.centre.x) < 1e-6 && Math.abs(b.centre.y - e.centre.y) < 1e-6) ?? v.batiments[0];
    return v.batiments.map(b => ({ id: b.id, nom: b.nom, coins: b.coins, centre: b.centre, largeurM: b.largeurM, profondeurM: b.profondeurM,
      angleDeg: b.angleDeg, niveaux: b.niveaux, hauteurM: b.hauteurM, principal: b === principal,
      ...(b.ailes && b.ailes.length >= 2 ? { ailes: b.ailes, formeAiles: b.formeAiles, ...(b.decalageM !== undefined ? { decalageM: b.decalageM } : {}) } : {}) }));
  }
  return [{ id: 'volume', nom: null, coins: e.coins, centre: e.centre, largeurM: e.largeurM, profondeurM: e.profondeurM,
    angleDeg: e.angleDeg, niveaux: v.niveaux, hauteurM: v.hauteurM, principal: true }];
}

/**
 * Brouillon de fiche 3D pour Studio, tiré du volume proposé. Il suit le format
 * attendu par diagnostiquerPreparation3D / studioCommand (« L m x P m » et R+N
 * dans l'objectif) et garde l'hypothèse lisible dans les contraintes.
 */
export function ficheStudioDepuisVolume(v: VolumePropose, contexte: { adresse?: string | null; reference?: string | null; programme?: ProgrammeVolume; base?: JarvisDraft | null }): JarvisDraft | null {
  if (!v.emprise || v.niveaux < 1) return null;
  const e = v.emprise;
  const dimension = (n: number) => fr(n, 1);
  const logements = contexte.programme?.logements ?? null;
  // Plusieurs bâtiments : la fiche décrit le bâtiment PRINCIPAL (dimensions, R+N uniques, exigés par
  // diagnostiquerPreparation3D) ; l'ensemble part à Studio dans `batiments` du projet v2. Le mot
  // « bâtiments » précédé d'un nombre est évité : il déclencherait la composition nommée A à H.
  const principal = v.batiments && volumeParBatiments(v)
    ? v.batiments.find(b => Math.abs(b.largeurM - e.largeurM) < 1e-6 && Math.abs(b.profondeurM - e.profondeurM) < 1e-6) ?? v.batiments[0]
    : null;
  const niveaux = principal?.niveaux ?? v.niveaux;
  const usage = principal
    // « Bâtiment de maisons… » : studioCommand reconnaît « bâtiment » (« maisons » au pluriel ne l'est pas).
    ? (principal.forme.startsWith('maison') ? (principal.forme === 'maisons-en-bande' ? 'Bâtiment de maisons en bande' : principal.forme === 'maisons-jumelees' ? 'Bâtiment de maisons jumelées' : 'Maison')
      : principal.forme === 'residence' ? 'Résidence' : 'Immeuble de logements')
    : logements !== null ? 'Immeuble de logements' : 'Bâtiment';
  // Lot formes-batiment : un seul bâtiment à ailes part aussi dans `batiments` (avec ses ailes).
  const formeAiles = principal?.formeAiles ? NOMS_FORME_AILES[principal.formeAiles] : null;
  const ensemble = !principal ? ''
    : v.batiments!.length > 1 ? ` (ensemble de ${v.batiments!.length} volumes${v.kpi ? `, ${v.kpi.unites} unités` : ''} transmis à Studio)`
    : ` (bâtiment ${formeAiles ?? 'à ailes'} transmis à Studio aile par aile)`;
  return {
    version: 1,
    objectif: `${usage} en ${libelleNiveaux(niveaux)}, volume d’étude proposé par Mimmo sur la parcelle${contexte.reference ? ' ' + contexte.reference : ''}${ensemble}`,
    localisation: contexte.base?.localisation ?? contexte.adresse ?? null,
    programme: contexte.programme?.libelle ?? (logements !== null ? `${logements} logements` : contexte.base?.programme ?? null),
    dimensions: `${dimension(e.largeurM)} m x ${dimension(e.profondeurM)} m`,
    style: contexte.base?.style ?? null,
    contraintes: `${v.mentionPlu}. Volume simple calculé ${v.reglesAppliquees.length ? 'avec les règles PLU lues listées dans le Dossier 3D, complétées par des valeurs par défaut' : 'par une règle par défaut (reculs, coefficient d’emprise, hauteur d’étage)'} ; implantation et conformité à vérifier.`,
    questions: [],
    pieces: contexte.base?.pieces ? [...contexte.base.pieces] : [],
  };
}
