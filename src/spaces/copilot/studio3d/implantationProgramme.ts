// src/spaces/copilot/studio3d/implantationProgramme.ts
//
// IMPLANTATION MULTI-BÂTIMENTS ADAPTÉE AU PROGRAMME — logique PURE (testée par node --test).
//
// Le volume historique (volumeParcelle.ts) pose UN parallélépipède, le plus grand
// possible, le long du grand côté de la parcelle. Ce module pose N emprises selon
// le programme lu dans la conversation (programmeBati.ts) :
//
//   typologie (programme → forme bâtie)
//     maisons ≤ 3                     → maisons individuelles
//     maisons 4 à 12                  → maisons jumelées (par 2)
//     maisons > 12 (ou « en bande »)  → maisons en bande (3 à 6, 8 au plus)
//     seniors                         → plain-pied d'abord (8 × 11 m), R+1 si la parcelle ne suffit pas
//     autres maisons                  → R+1 (6,5 × 8,5 m par maison)
//     logements collectifs            → plots / barres (épaisseur PLU ou 16 m, 45 m de long au plus)
//     résidence (lits, services)      → barres de 14 m d'épaisseur, 55 m² de SDP par lit ou logement
//     programme mixte                 → collectif / résidence d'abord, maisons ensuite
//
//   placement (déterministe), dans le repère tourné de la parcelle (u = grand axe)
//     - rangées parallèles au grand axe ; chaque emprise est vérifiée à ≥ recul de
//       TOUTES les limites (même test que le volume unique : rectTient) ;
//     - maisons : rangée / recul avant 5 m / voie 6 m / recul avant 5 m / rangée,
//       jardins arrière ≥ 6 m, 4 m entre pignons (venelle) ; la voie est dessinée (aplat) ;
//     - collectif : façades à ≥ max(H, 8 m), pignons à ≥ max(H/2, 6 m) ;
//     - aucun chevauchement (rangées disjointes, pignons espacés) ;
//     - emprise totale ≤ CES (règle PLU ou 40 %) et ≤ 1 − pleine terre ;
//     - deux orientations essayées (grand axe, puis perpendiculaire) : la meilleure est gardée.
//
//   limite Studio : 12 bâtiments (ARCHITECTURE_LIMITS.maxBuildings du Studio ; le contrat v2 en
//   admet 20). Au-delà, les maisons sont regroupées en bandes plus longues, et c'est dit.
//
// Rien n'est présenté comme conforme : côté voie, accès, stationnement, servitudes, OAP
// et prospects réels ne sont pas vérifiés. Aucune I/O ici.
//
// Lot C7c — bande principale (paramètre FACULTATIF `bande`, PLU « par bande », comme calculerVolumeParcelle) :
// quand le côté voie est identifié et la profondeur de bande lue, les rangées sont PARALLÈLES À LA VOIE et chaque
// bâtiment tient tout entier dans la bande principale ; l'emprise totale ne dépasse pas le plafond de la bande.
// Le résultat est REVÉRIFIÉ avant d'être rendu (verifierBandeVolume). Bande inutilisable, aucun bâtiment dans la
// bande, ou preuve manquante : implantation habituelle sur toute la parcelle, et le résultat le dit
// (`bande.statut: 'non-appliquee'`, raison dans `bande.raison` et dans les alertes) — l'appelant doit alors
// revenir au plafond d'emprise prudent. Sans le paramètre : résultat strictement identique à avant.
//
// Lot C10 —
//   · plafond d'emprise STRICT partout (défaut C) : la longueur d'un bâtiment collectif n'est plus jamais arrondie
//     au-dessus de l'emprise autorisée (avant : 168 m² pour 163,2 m² autorisés à Montreuil). Hors bande, c'est le
//     seul changement de résultat de ce lot ;
//   · recul différencié dans la bande (défaut B) : si le recul à la voie est établi par une règle lue (règle
//     chiffrée, ou alignement explicite dans `bande.implantation`), il s'applique aux limites présumées sur voie et
//     le recul aux limites séparatives aux autres. Non établi : recul uniforme d'origine, côté voie compris.

import {
  calculerVolumeParcelle, HYPOTHESES_VOLUME, hypotheseReculsDifferencies, hypothesesImplantation, orientationParcelle, projeterParcelle, rectTient, regleValide, reculsRetenus, segmentsDe, versWgs84,
  REGLES_INCONNUES,
  type BatimentPropose, type CleReglePlu, type ComposanteProgramme, type FormeBatie, type GeometrieParcelle, type KpiImplantation,
  type PointLocal, type ProgrammeVolume, type ReglePlu, type ReglesPluVolume, type Segment, type VoiePropose, type VolumePropose,
} from './volumeParcelle.ts';
import { distanceVoie, marquerSegmentsVoie, mesurerReculsVolume, preparerBande, rectangleDansBande, verifierBandeVolume, type BandePreparee, type BandeVoie, type BandeVolume, type FacadeLocale } from './bandePrincipale.ts';

/** Bâtiments au plus dans Studio (ARCHITECTURE_LIMITS.maxBuildings, mimmozia-studio/src/core/architecture/defaults.ts). */
export const LIMITE_BATIMENTS_STUDIO = 12;

export const HYPOTHESES_PROGRAMME = {
  /** Maison de plain-pied (T3 senior) : façade × profondeur, ≈ 88 m² de SDP. */
  maisonPlainPied: { facadeM: 8, profondeurM: 11 },
  /** Maison R+1 : façade × profondeur, ≈ 110 m² de SDP sur deux niveaux. */
  maisonEtage: { facadeM: 6.5, profondeurM: 8.5 },
  maisonsParBandeMax: 6,
  maisonsParBandeAbsolu: 8,
  /** Entre deux bandes d'une même rangée (venelle, passage vers les jardins). */
  ecartPignonsMaisonsM: 4,
  voieM: 6,
  reculVoieM: 5,
  jardinArriereM: 6,
  sdpLogementCollectifM2: HYPOTHESES_VOLUME.sdpParLogementM2,
  sdpUniteResidenceM2: 55,
  epaisseurResidenceM: 14,
  longueurBarreMaxM: 45,
  longueurMinCollectifM: 10,
  distanceFacadesMinM: 8,
  distancePignonsMinM: 6,
  /** Collectif : on part de R+2 (moins d'emprise, plus d'espaces libres), puis on monte. */
  niveauxCollectifDepart: 3,
} as const;

const HP = HYPOTHESES_PROGRAMME;
const fr = (v: number, d = 0) => v.toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const demi = (v: number) => Math.floor(v * 2 + 1e-9) / 2;
const demiSup = (v: number) => Math.ceil(v * 2 - 1e-9) / 2;

// ---------------------------------------------------------------------------------------------
// Règles PLU (même sélection que calculerVolumeParcelle : la plus contraignante par notion)
// ---------------------------------------------------------------------------------------------
interface Contraintes {
  niveauxMax: number;
  ratioEmprise: number;
  epaisseurMax: number;
  reculPour: (hauteurM: number) => number;
  reculConnu: boolean;
  /**
   * Lot C10 : recul côté voie quand les reculs sont différenciés (m, 0 = alignement) ; `reculPour` donne alors
   * le recul aux limites AUTRES que la voie. null (toujours, sans le second paramètre) : `reculPour` vaut partout.
   */
  reculVoieM: number | null;
}
/**
 * `implantation` (lot C10, facultatif) : implantation de la bande préparée, à passer SEULEMENT quand les limites
 * sur voie ont été retrouvées sur le contour. Absente : contraintes d'origine, recul uniforme.
 */
export function contraintesPlu(regles: ReglesPluVolume, implantation: { reculVoieM: number | null } | null = null): Contraintes {
  const H = HYPOTHESES_VOLUME;
  const valides = (regles.regles ?? []).filter(regleValide);
  const plus = (cle: CleReglePlu, sens: 'min' | 'max'): ReglePlu | null => {
    const l = valides.filter(r => r.cle === cle);
    return l.length ? l.reduce((a, b) => (sens === 'min' ? b.valeur < a.valeur : b.valeur > a.valeur) ? b : a) : null;
  };
  const hauteurs = [plus('hauteur_max_m', 'min'), plus('hauteur_faitage_m', 'min')].filter((r): r is ReglePlu => !!r).map(r => r.valeur);
  const niveauxParHauteur = hauteurs.length ? Math.floor(Math.min(...hauteurs) / H.hauteurEtageM + 1e-9) : H.niveauxMaxStudio;
  const rNiveaux = plus('niveaux_max', 'min');
  const ces = plus('emprise_max_ratio', 'min')?.valeur ?? H.cesDefaut;
  const pleine = plus('pleine_terre_min_ratio', 'max');
  const rVoie = plus('recul_voie_m', 'max'), rLimites = plus('recul_limites_m', 'max');
  const formules = valides.filter(r => r.cle === 'recul_limites_formule');
  const rFormule = formules.length ? formules.reduce((a, b) => b.valeur < a.valeur || (b.valeur === a.valeur && (b.minimumM ?? 0) > (a.minimumM ?? 0)) ? b : a) : null;
  const reculConnu = Boolean(rVoie || rLimites || rFormule);
  return {
    niveauxMax: Math.min(H.niveauxMaxStudio, niveauxParHauteur, rNiveaux?.valeur ?? H.niveauxMaxStudio),
    ratioEmprise: Math.min(ces, pleine ? 1 - pleine.valeur : 1),
    epaisseurMax: plus('epaisseur_max_m', 'min')?.valeur ?? H.epaisseurMaxM,
    reculConnu,
    reculPour: (h: number) => Math.round((!reculConnu ? H.reculDefautM : Math.max(rVoie?.valeur ?? 0, rLimites?.valeur ?? 0,
      rFormule ? Math.max(rFormule.minimumM ?? 0, h / rFormule.valeur) : 0)) * 100) / 100,
    reculVoieM: null,
    // Lot C10 : recul à la voie établi → recul « limites » pour les autres limites, recul « voie » à part.
    ...(() => {
      const rc = implantation ? reculsRetenus(valides, implantation) : null;
      return rc && rc.voieM !== null ? { reculVoieM: rc.voieM, reculPour: (h: number) => Math.round(rc.limitesPour(h) * 100) / 100 } : {};
    })(),
  };
}

// ---------------------------------------------------------------------------------------------
// Repère tourné et rangées
// ---------------------------------------------------------------------------------------------
interface Cadre {
  anneaux: PointLocal[][]; segments: Segment[]; u0: number; u1: number; v0: number; v1: number;
  /** Lot C7c : bande principale dans le repère tourné (façades sur voie, profondeur) ; null = pas de bande. */
  bande: { facades: FacadeLocale[]; profondeurM: number } | null;
  /** Lot C10 : recul côté voie (segments sur voie marqués dans `segments`) ; null = recul uniforme. */
  reculVoieM: number | null;
  /**
   * Lot C10 : plus grand v qu'un point de la bande principale peut atteindre (v le plus haut d'une façade +
   * profondeur de bande) ; +∞ sans bande. Une rangée qui finit au-delà ne peut pas être dans la bande : inutile
   * de la chercher (même résultat, calcul plus court sur les parcelles profondes).
   */
  vMaxBande: number;
}

/** Lot C7c : bande principale à respecter par l'implantation (repère local de la parcelle). */
interface BandeImplantation { facades: FacadeLocale[]; profondeurM: number; empriseMaxM2: number | null; /** Lot C10 : recul côté voie, null = uniforme. */ reculVoieM?: number | null }

function cadreTourne(anneaux: PointLocal[][], angle: number, bande: BandeImplantation | null = null): Cadre {
  const c = Math.cos(-angle), s = Math.sin(-angle);
  const t = (p: PointLocal) => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c });
  const a = anneaux.map(r => r.map(t));
  const us = a[0].map(p => p.x), vs = a[0].map(p => p.y);
  const segments = segmentsDe(a);
  const facades = bande ? bande.facades.map(f => ({ a: t(f.a), b: t(f.b) })) : null;
  // Lot C10 : les limites sur voie sont marquées ; si une façade n'est pas retrouvée sur le contour, recul uniforme.
  const reculVoieM = bande && facades && bande.reculVoieM !== undefined && bande.reculVoieM !== null && marquerSegmentsVoie(segments, facades) ? bande.reculVoieM : null;
  return {
    anneaux: a, segments, u0: Math.min(...us), u1: Math.max(...us), v0: Math.min(...vs), v1: Math.max(...vs),
    bande: bande && facades ? { facades, profondeurM: bande.profondeurM } : null, reculVoieM,
    vMaxBande: bande && facades ? Math.max(...facades.flatMap(f => [f.a.y, f.b.y])) + bande.profondeurM : Infinity,
  };
}

/** Tolérance sur les reculs (1 cm) : une limite à 20,0001° ne doit pas faire perdre une rangée entière. */
const TOLERANCE_M = 0.01;
/** Rectangle [ua, ub] × [va, vb] à ≥ recul de toutes les limites (à 1 cm près). */
const tient = (k: Cadre, ua: number, ub: number, va: number, vb: number, recul: number) =>
  ub - ua > 0 && vb - va > 0 && rectTient(k.anneaux, k.segments, { cu: (ua + ub) / 2, cv: (va + vb) / 2, w: ub - ua, d: vb - va }, Math.max(1e-6, recul - TOLERANCE_M),
    k.reculVoieM !== null ? Math.max(1e-6, k.reculVoieM - TOLERANCE_M) : undefined);
/** Lot C10 : recul à tenir depuis le bord côté voie du cadre (v0) — recul « voie » s'il est différencié, sinon le recul courant. */
const reculCoteVoie = (k: Cadre, recul: number) => k.reculVoieM !== null ? k.reculVoieM : recul;
/** Lot C10 : pas de recherche d'une rangée en profondeur — 1 m à l'origine ; 0,25 m quand le bâtiment peut venir à l'alignement. */
const pasRangee = (k: Cadre) => k.reculVoieM !== null ? 0.25 : 1;

/**
 * Lot C7c : le rectangle BÂTI [ua, ub] × [va, vb] est-il entièrement dans la bande principale du cadre ?
 * Toujours vrai sans bande (comportement d'origine). Preuve sans faux « oui » (rectangleDansBande).
 */
const dansBande = (k: Cadre, ua: number, ub: number, va: number, vb: number) =>
  !k.bande || rectangleDansBande([{ x: ua, y: va }, { x: ub, y: va }, { x: ub, y: vb }, { x: ua, y: vb }], k.bande.facades, k.bande.profondeurM);

/**
 * Intervalles en u où une bande [va, vb] tient : échantillonnage au mètre, bords affinés au centimètre.
 * `bati` (lot C7c) : étendue en v du bâtiment lui-même (sans son jardin) ; avec une bande principale, chaque
 * tranche doit aussi y être contenue. Sans bande, ou sans `bati` (voie de desserte) : test d'origine.
 */
function intervalles(k: Cadre, va: number, vb: number, recul: number, bati: readonly [number, number] | null = null): [number, number][] {
  const ok = (ua: number, ub: number) => tient(k, ua, ub, va, vb, recul) && (!k.bande || !bati || dansBande(k, ua, ub, bati[0], bati[1]));
  const brut: [number, number][] = [];
  let debut: number | null = null, fin = 0;
  // Départ calé sur le recul : sur une limite droite, le premier pas tombe juste à la bonne distance.
  for (let u = k.u0 + recul + 1e-3; u < k.u1; u += 1) {
    if (ok(u, u + 1)) { if (debut === null) debut = u; fin = u + 1; }
    else if (debut !== null) { brut.push([debut, fin]); debut = null; }
  }
  if (debut !== null) brut.push([debut, fin]);
  // Bords : jusqu'à 1 m de plus de chaque côté, par dichotomie sur une tranche de 1 m.
  return brut.map(([a, b]) => {
    let lo = b, hi = b + 1;
    for (let i = 0; i < 7; i++) { const m = (lo + hi) / 2; if (ok(m - 1, m)) lo = m; else hi = m; }
    let lo2 = a - 1, hi2 = a;
    for (let i = 0; i < 7; i++) { const m = (lo2 + hi2) / 2; if (ok(m, m + 1)) hi2 = m; else lo2 = m; }
    return [hi2, lo] as [number, number];
  });
}

interface RectUV { ua: number; ub: number; va: number; vb: number }
interface BatUV extends RectUV { forme: FormeBatie; niveaux: number; unites: number; uniteLibelle: BatimentPropose['uniteLibelle']; composante: number }

/**
 * Remplit une rangée [va, vb] : `choisir(disponible)` donne la longueur voulue (null : rien de plus).
 * `arriere` : profondeur supplémentaire testée côté jardin (−1 vers v bas, +1 vers v haut).
 */
function remplirRangee(k: Cadre, va: number, vb: number, recul: number, ecart: number,
  choisir: (disponible: number) => { longueur: number; info: number } | null,
  arriere: { sens: -1 | 1; profondeurM: number } | null,
  poser: (r: RectUV, info: number) => void) {
  const vaT = arriere?.sens === -1 ? va - arriere.profondeurM : va, vbT = arriere?.sens === 1 ? vb + arriere.profondeurM : vb;
  for (const [a, b] of intervalles(k, vaT, vbT, recul, [va, vb])) {
    let u = a;
    while (u < b) {
      const c = choisir(b - u);
      if (!c) return;
      // Lot C7c : avec une bande principale, le bâtiment entier (sans son jardin) doit y être contenu.
      if (c.longueur <= b - u + 1e-9 && tient(k, u, u + c.longueur, vaT, vbT, recul) && dansBande(k, u, u + c.longueur, va, vb)) { poser({ ua: u, ub: u + c.longueur, va, vb }, c.info); u += c.longueur + ecart; }
      else u += 0.5;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Maisons
// ---------------------------------------------------------------------------------------------
interface EssaiMaisons { batiments: BatUV[]; voies: RectUV[]; placees: number; vFin: number }

function implanterMaisons(k: Cadre, c: ComposanteProgramme, idx: number, o: {
  niveaux: number; taille: number; tailleMin: number; maxBatiments: number; recul: number; empriseLibre: number; vDebut: number; jardinDebut: boolean;
}): EssaiMaisons {
  const gabarit = o.niveaux === 1 ? HP.maisonPlainPied : HP.maisonEtage;
  const f = gabarit.facadeM, p = gabarit.profondeurM;
  const jardin = Math.max(0, HP.jardinArriereM - o.recul);
  const batiments: BatUV[] = [], voies: RectUV[] = [];
  let placees = 0, emprise = 0, vFin = o.vDebut;
  const forme = (n: number): FormeBatie => n === 1 ? 'maison-individuelle' : n === 2 ? 'maisons-jumelees' : 'maisons-en-bande';
  const choisir = (dispo: number) => {
    const restant = c.nombre - placees;
    if (restant <= 0 || batiments.length >= o.maxBatiments) return null;
    let n = Math.min(o.taille, restant, Math.floor((dispo + 1e-9) / f), Math.floor((o.empriseLibre - emprise + 1e-6) / (f * p)));
    // Dernier bâtiment possible : il prend tout ce qui reste (dans la limite absolue d'une bande).
    if (batiments.length === o.maxBatiments - 1) n = Math.min(Math.max(n, Math.min(restant, HP.maisonsParBandeAbsolu, Math.floor((dispo + 1e-9) / f))), Math.floor((o.empriseLibre - emprise + 1e-6) / (f * p)));
    if (n < Math.min(o.tailleMin, restant) || n < 1) return null;
    return { longueur: n * f, info: n };
  };
  const poser = (r: RectUV, n: number) => {
    batiments.push({ ...r, forme: forme(n), niveaux: o.niveaux, unites: n, uniteLibelle: 'maison', composante: idx });
    placees += n; emprise += (r.ub - r.ua) * (r.vb - r.va);
  };
  let v = o.vDebut;
  while (placees < c.nombre && batiments.length < o.maxBatiments && v + p <= k.v1 - o.recul + 1e-9 && v + p <= k.vMaxBande + 1e-9) {
    // Rangée A (jardin côté v bas), voie, rangée B (jardin côté v haut).
    const avantA = batiments.length;
    remplirRangee(k, v, v + p, o.recul, HP.ecartPignonsMaisonsM, choisir, o.jardinDebut || v > o.vDebut ? { sens: -1, profondeurM: jardin } : null, poser);
    if (batiments.length === avantA) { v += pasRangee(k); continue; }
    const vVoie = v + p + HP.reculVoieM, vB = vVoie + HP.voieM + HP.reculVoieM;
    const avantB = batiments.length;
    if (placees < c.nombre) remplirRangee(k, vB, vB + p, o.recul, HP.ecartPignonsMaisonsM, choisir, { sens: 1, profondeurM: jardin }, poser);
    const rangees = batiments.slice(avantA);
    const umin = Math.min(...rangees.map(b => b.ua)), umax = Math.max(...rangees.map(b => b.ub));
    // Voie : sur toute la longueur libre de sa bande qui dessert les maisons (vers les limites : raccordement à définir).
    const libres = intervalles(k, vVoie, vVoie + HP.voieM, 0.05).filter(([a, b]) => b > umin && a < umax);
    if (libres.length) voies.push({ ua: Math.min(...libres.map(l => l[0])), ub: Math.max(...libres.map(l => l[1])), va: vVoie, vb: vVoie + HP.voieM });
    vFin = batiments.length > avantB ? vB + p : vVoie + HP.voieM;
    v = batiments.length > avantB ? vB + p + 2 * HP.jardinArriereM : vB + p + HP.jardinArriereM;
  }
  return { batiments, voies, placees, vFin };
}

// ---------------------------------------------------------------------------------------------
// Collectif et résidence
// ---------------------------------------------------------------------------------------------
interface EssaiCollectif { batiments: BatUV[]; sdp: number; atteint: boolean; vFin: number; niveaux: number; recul: number }

function implanterCollectif(k: Cadre, c: ComposanteProgramme, idx: number, ct: Contraintes, o: { maxBatiments: number; empriseLibre: number; vDebut: number }): EssaiCollectif | null {
  const residence = c.type === 'residence';
  const sdpU = residence ? HP.sdpUniteResidenceM2 : HP.sdpLogementCollectifM2;
  const d = Math.max(HYPOTHESES_VOLUME.coteMinM, residence ? Math.min(HP.epaisseurResidenceM, ct.epaisseurMax) : ct.epaisseurMax);
  const cible = c.nombre * sdpU;
  /** `strict` : bâtiments de longueur cible, sauf le dernier (reste du programme) ; sinon tout ce qui tient. */
  const essai = (n: number, longueurCible: number, empriseVisee: number, strict: boolean): EssaiCollectif => {
    const H = n * HYPOTHESES_VOLUME.hauteurEtageM, recul = ct.reculPour(H);
    const batiments: BatUV[] = [];
    let emprise = 0, v = Math.max(o.vDebut, k.v0 + reculCoteVoie(k, recul)), vFin = o.vDebut;
    const choisir = (dispo: number) => {
      const reste = empriseVisee - emprise;
      if (reste <= 1e-6 || batiments.length >= o.maxBatiments) return null;
      let L = Math.min(longueurCible, HP.longueurBarreMaxM, demi(dispo));
      if (reste / d < L) L = Math.max(HP.longueurMinCollectifM, demiSup(reste / d));
      else if (strict && L < longueurCible - 1e-9) return null; // pas de chute : rangée suivante
      // Lot C7c puis C10 : le plafond d'emprise est STRICT, dans la bande comme hors bande (la longueur n'est
      // jamais arrondie au-dessus de l'emprise encore autorisée ; trop court pour un bâtiment : rien n'est posé).
      L = Math.min(L, demi((o.empriseLibre - emprise + 1e-6) / d));
      if (L > dispo + 1e-9 || L < HP.longueurMinCollectifM) return null;
      return { longueur: L, info: 0 };
    };
    while (emprise < empriseVisee - 1e-6 && batiments.length < o.maxBatiments && v + d <= k.v1 - recul + 1e-9 && v + d <= k.vMaxBande + 1e-9) {
      const avant = batiments.length;
      remplirRangee(k, v, v + d, recul, Math.max(H / 2, HP.distancePignonsMinM), choisir, null, r => {
        batiments.push({ ...r, forme: residence ? 'residence' : 'barre', niveaux: n, unites: 0, uniteLibelle: residence && c.unite === 'lits' ? 'lit' : 'logement', composante: idx });
        emprise += (r.ub - r.ua) * (r.vb - r.va);
      });
      if (batiments.length === avant) { v += pasRangee(k); continue; }
      vFin = v + d;
      v += d + Math.max(H, HP.distanceFacadesMinM);
    }
    for (const b of batiments) if (!residence && (b.ub - b.ua) <= 1.4 * (b.vb - b.va)) b.forme = 'plot';
    const sdp = emprise * n;
    return { batiments, sdp, atteint: sdp + 1e-6 >= cible, vFin, niveaux: n, recul };
  };
  const nMax = Math.max(1, ct.niveauxMax);
  const depart = Math.min(HP.niveauxCollectifDepart, nMax);
  let meilleur: EssaiCollectif | null = null;
  for (let n = depart; n <= nMax; n++) {
    const E = cible / n;
    if (E > o.empriseLibre + 1e-6) continue;
    const k0 = Math.max(1, Math.ceil(E / (HP.longueurBarreMaxM * d) - 1e-9));
    let atteintN: EssaiCollectif | null = null;
    for (let nb = k0; nb <= Math.min(k0 + 3, o.maxBatiments); nb++) {
      const L = Math.min(HP.longueurBarreMaxM, Math.max(HP.longueurMinCollectifM, demiSup(E / (nb * d))));
      const r = essai(n, L, E, true);
      if (r.atteint && r.batiments.length <= nb) return r;
      if (r.atteint && !atteintN) atteintN = r;
      if (!meilleur || r.sdp > meilleur.sdp) meilleur = r;
    }
    if (atteintN) return atteintN;
  }
  // Programme hors d'atteinte : la plus grande capacité (niveaux max, barres longues, emprise libre).
  // Lot C10 : dans la bande principale, TOUS les nombres de niveaux sont essayés — avec un recul aux limites en
  // H/k, une hauteur intermédiaire loge souvent plus que le maximum (recul trop fort) ou que R+2 (trop bas).
  // Hors bande : les deux essais d'origine, inchangés.
  const hauteursEssayees = k.bande ? Array.from({ length: nMax - depart + 1 }, (_, i) => nMax - i) : [...new Set([nMax, depart])];
  for (const n of hauteursEssayees) {
    const r = essai(n, HP.longueurBarreMaxM, o.empriseLibre, false);
    if (r.batiments.length && (!meilleur || r.sdp > meilleur.sdp)) meilleur = r;
  }
  return meilleur && meilleur.batiments.length ? meilleur : null;
}

// ---------------------------------------------------------------------------------------------
// Implantation complète pour une orientation
// ---------------------------------------------------------------------------------------------
interface Implantation {
  angle: number;
  batiments: BatUV[];
  voies: RectUV[];
  /** Unités placées par composante. */
  placees: number[];
  alertes: string[];
  notes: string[];
  reculM: number;
}

function ordreTailles(c: ComposanteProgramme, maxBat: number): { tailles: number[]; regroupe: boolean } {
  const N = c.nombre, mini = Math.max(1, Math.ceil(N / Math.max(1, maxBat)));
  const bandes = [] as number[];
  for (let t = Math.max(3, mini); t <= HP.maisonsParBandeAbsolu; t++) bandes.push(t);
  if (c.forme === 'individuelle') return mini <= 1 ? { tailles: [1], regroupe: false } : { tailles: [Math.max(2, mini), ...bandes], regroupe: true };
  if (c.forme === 'jumelee') return mini <= 2 ? { tailles: [2], regroupe: false } : { tailles: bandes, regroupe: true };
  if (c.forme === 'bande') return { tailles: bandes.length ? bandes : [HP.maisonsParBandeAbsolu], regroupe: false };
  if (N <= 3) return { tailles: [1, 2, 3], regroupe: false };
  if (N <= 12 && mini <= 2) return { tailles: [2, ...bandes], regroupe: false };
  return { tailles: bandes.length ? bandes : [HP.maisonsParBandeAbsolu], regroupe: false };
}

function implanter(anneaux: PointLocal[][], angle: number, composantes: ComposanteProgramme[], ct: Contraintes, surface: number, bande: BandeImplantation | null = null): Implantation {
  const k = cadreTourne(anneaux, angle, bande);
  const res: Implantation = { angle, batiments: [], voies: [], placees: composantes.map(() => 0), alertes: [], notes: [], reculM: ct.reculPour(HYPOTHESES_VOLUME.hauteurEtageM) };
  // Lot C7c : dans la bande principale, le plafond de la bande (m²) s'ajoute au coefficient d'emprise.
  const empriseMax = bande && bande.empriseMaxM2 !== null ? Math.min(ct.ratioEmprise * surface, bande.empriseMaxM2) : ct.ratioEmprise * surface;
  const ou = bande ? 'dans la bande principale' : 'sur la parcelle';
  const empriseUtilisee = () => res.batiments.reduce((s, b) => s + (b.ub - b.ua) * (b.vb - b.va), 0);
  let vCurseur = k.v0, premier = true;
  // Collectif et résidence d'abord (gros volumes), maisons ensuite.
  const ordre = composantes.map((c, i) => ({ c, i })).sort((a, b) => Number(a.c.type === 'maisons') - Number(b.c.type === 'maisons'));
  for (const { c, i } of ordre) {
    const maxBatiments = LIMITE_BATIMENTS_STUDIO - res.batiments.length;
    if (maxBatiments <= 0) { res.alertes.push(`${c.libelle} : limite de ${LIMITE_BATIMENTS_STUDIO} bâtiments de Studio atteinte, partie non placée.`); continue; }
    if (c.type !== 'maisons') {
      const r = implanterCollectif(k, c, i, ct, { maxBatiments, empriseLibre: empriseMax - empriseUtilisee(), vDebut: premier ? k.v0 : vCurseur });
      if (!r) { res.alertes.push(`${c.libelle} : aucun bâtiment ne tient ${ou} avec ces reculs et cette emprise.`); continue; }
      const sdpU = c.type === 'residence' ? HP.sdpUniteResidenceM2 : HP.sdpLogementCollectifM2;
      const unites = r.atteint ? c.nombre : Math.floor(r.sdp / sdpU + 1e-9);
      // Répartition des unités au prorata des emprises (le reste au plus grand).
      const empr = r.batiments.map(b => (b.ub - b.ua) * (b.vb - b.va)), tot = empr.reduce((s, e) => s + e, 0);
      r.batiments.forEach((b, j) => { b.unites = Math.floor(unites * empr[j] / tot); });
      const reste = unites - r.batiments.reduce((s, b) => s + b.unites, 0);
      r.batiments[empr.indexOf(Math.max(...empr))].unites += reste;
      res.batiments.push(...r.batiments);
      res.placees[i] = unites;
      res.reculM = Math.max(res.reculM, r.recul);
      if (!r.atteint) res.alertes.push(`${c.libelle} : programme non atteint — ${fr(unites)} ${c.unite} au plus (${r.niveaux} niveaux, ${r.batiments.length} bâtiment${r.batiments.length > 1 ? 's' : ''}${bande ? ', dans la bande principale' : ''}).`);
      vCurseur = r.vFin + Math.max(r.niveaux * HYPOTHESES_VOLUME.hauteurEtageM, HP.distanceFacadesMinM);
      premier = false;
      continue;
    }
    // Maisons : niveaux puis taille des bandes, du plus souhaitable au moins souhaitable.
    const niveauxPossibles = (c.niveaux ? [c.niveaux] : c.public === 'seniors' ? [1, 2] : [2, 1]).filter(n => n <= Math.max(1, ct.niveauxMax));
    if (!niveauxPossibles.length) niveauxPossibles.push(1);
    const { tailles, regroupe } = ordreTailles(c, maxBatiments);
    const libre = empriseMax - empriseUtilisee();
    let meilleur: { e: EssaiMaisons; niveaux: number; taille: number } | null = null;
    for (const niveaux of niveauxPossibles) {
      const recul = ct.reculPour(niveaux * HYPOTHESES_VOLUME.hauteurEtageM);
      for (const taille of tailles) {
        const e = implanterMaisons(k, c, i, { niveaux, taille, tailleMin: 1, maxBatiments, recul, empriseLibre: libre,
          vDebut: premier ? k.v0 + reculCoteVoie(k, recul) : vCurseur, jardinDebut: premier });
        if (!meilleur || e.placees > meilleur.e.placees) meilleur = { e, niveaux, taille };
        if (e.placees >= c.nombre) break;
      }
      if (meilleur && meilleur.e.placees >= c.nombre) break;
    }
    if (!meilleur || !meilleur.e.placees) { res.alertes.push(`${c.libelle} : aucune maison ne tient ${ou} avec ces reculs et cette emprise.`); continue; }
    const { e, niveaux } = meilleur;
    res.batiments.push(...e.batiments);
    res.voies.push(...e.voies);
    res.placees[i] = e.placees;
    res.reculM = Math.max(res.reculM, ct.reculPour(niveaux * HYPOTHESES_VOLUME.hauteurEtageM));
    const tailleMaxi = Math.max(...e.batiments.map(b => b.unites));
    if (niveaux !== niveauxPossibles[0] && c.niveaux === null && c.public === 'seniors') {
      const pp = HP.maisonPlainPied, besoin = c.nombre * pp.facadeM * pp.profondeurM;
      res.notes.push(`Plain-pied impossible pour ${c.libelle} sur cette parcelle (${besoin > libre + 1e-6
        ? `${fr(besoin)} m² d’emprise pour ${fr(libre)} m² autorisés, CES ${fr(ct.ratioEmprise * 100, 1)} %`
        : 'place insuffisante avec voies, reculs et jardins'}) : maisons en R+1, chambre au rez-de-chaussée conseillée.`);
    }
    if (regroupe) res.notes.push(`Maisons ${c.forme === 'individuelle' ? 'individuelles' : 'jumelées'} demandées, mais Studio accepte ${LIMITE_BATIMENTS_STUDIO} bâtiments au plus : ${fr(e.placees)} maisons regroupées en ${e.batiments.length} bandes (jusqu’à ${tailleMaxi} maisons accolées).`);
    else if (c.nombre > LIMITE_BATIMENTS_STUDIO && tailleMaxi > 2) res.notes.push(`${fr(e.placees)} maisons regroupées en ${e.batiments.length} bandes (jusqu’à ${tailleMaxi} maisons accolées) : densité de la parcelle, et Studio accepte ${LIMITE_BATIMENTS_STUDIO} bâtiments au plus.`);
    if (e.placees < c.nombre) res.alertes.push(`${c.libelle} : programme non atteint — ${fr(e.placees)} maison${e.placees > 1 ? 's' : ''} au plus ${bande ? 'dans la bande principale' : 'sur cette parcelle'} (${niveaux === 1 ? 'plain-pied' : 'R+1'}, reculs, emprise au sol ${fr(ct.ratioEmprise * 100)} %).`);
    vCurseur = e.vFin + HP.jardinArriereM * 2;
    premier = false;
  }
  return res;
}

// ---------------------------------------------------------------------------------------------
// Volume multi-bâtiments (même type VolumePropose, compatible avec la vue et Studio)
// ---------------------------------------------------------------------------------------------
const NOMS_FORME: Record<FormeBatie, string> = {
  'maison-individuelle': 'Maison', 'maisons-jumelees': 'Maisons jumelées', 'maisons-en-bande': 'Maisons en bande',
  plot: 'Plot', barre: 'Barre', residence: 'Résidence',
};
const libelleRn = (n: number) => `R+${Math.max(0, n - 1)}`;

/**
 * Volume adapté au programme : plusieurs bâtiments si le programme le demande.
 * Sans programme détaillé (`composantes` absent ou vide) : volume unique historique.
 *
 * `bande` (facultatif, lot C7c) : bande principale d'un PLU « par bande », même paramètre que
 * calculerVolumeParcelle. Absente (`undefined` ou `null`) : résultat inchangé. Présente et utilisable : tous les
 * bâtiments sont dans la bande principale, en rangées parallèles à la voie, emprise totale sous le plafond de la
 * bande (`bande.statut: 'appliquee'`, revérifié avant d'être rendu). Présente mais inutilisable, ou aucun
 * bâtiment du programme dans la bande : implantation habituelle sur toute la parcelle, `bande.statut:
 * 'non-appliquee'` et la raison dans `bande.raison` et dans les alertes. Dans ce dernier cas les règles passées
 * (plafond de la bande principale) ne valent PAS pour ce résultat : l'appelant doit recalculer avec le plafond prudent.
 */
export function calculerVolumeProgramme(
  geometrie: GeometrieParcelle | null | undefined,
  programme: ProgrammeVolume,
  regles: ReglesPluVolume = REGLES_INCONNUES,
  bande?: BandeVoie | null,
): VolumePropose {
  const habituelle = () => (implantationProgramme(geometrie, programme, regles, calculerVolumeParcelle(geometrie, programme, regles), null) as { volume: VolumePropose }).volume;
  if (bande === undefined || bande === null) return habituelle();
  const H = HYPOTHESES_VOLUME;
  const profondeurLue = typeof bande.profondeurM === 'number' && Number.isFinite(bande.profondeurM) && bande.profondeurM > 0 ? bande.profondeurM : null;
  const plafondLu = typeof bande.empriseMaxM2 === 'number' && Number.isFinite(bande.empriseMaxM2) && bande.empriseMaxM2 > 0 ? bande.empriseMaxM2 : null;
  /** Repli : implantation d'origine (sans bande), et le résultat DIT que la bande n'est pas appliquée. */
  const repli = (texte: string): VolumePropose => {
    const v = habituelle();
    return { ...v, alertes: [...v.alertes, texte], bande: { statut: 'non-appliquee', raison: texte, profondeurM: profondeurLue, longueurFacadeM: null, angleVoieDeg: null, distanceMaxVoieM: null, empriseMaxM2: plafondLu } };
  };
  const base = calculerVolumeParcelle(geometrie, programme, regles, bande);
  const composantes = (programme.composantes ?? []).filter(c => c.nombre >= 1);
  const proj = projeterParcelle(geometrie);
  const prep = proj && proj.anneaux[0].length >= 3 ? preparerBande(bande, proj.origine, proj.anneaux[0], H.coteMinM) : null;
  const appliquee = base.bande?.statut === 'appliquee' && !!prep && prep.ok;
  if (!composantes.length || base.statut === 'contour-invalide' || base.statut === 'hauteur-insuffisante') {
    // Volume unique : placé dans la bande par calculerVolumeParcelle (lot C7b). Les façades sont jointes pour
    // que le volume puisse être revérifié, et la preuve est refaite ici.
    if (!appliquee || !prep || !prep.ok || !base.bande) return base;
    const v: VolumePropose = { ...base, bande: { ...base.bande, facades: copieFacades(prep.bande) } };
    const preuve = verifierBandeVolume(v);
    return preuve.prouvee ? v : repli(`Bande principale non appliquée : implantation dans la bande non prouvée (${preuve.raison}). Volume placé sans tenir compte de la bande.`);
  }
  if (!appliquee || !prep || !prep.ok) {
    return repli(base.bande?.raison ?? `Bande principale non appliquée : ${prep && !prep.ok ? prep.raison : 'contour cadastral illisible.'} Bâtiments placés sans tenir compte de la bande.`);
  }
  const r = implantationProgramme(geometrie, programme, regles, base, prep.bande);
  return 'volume' in r ? r.volume : repli(`Bande principale non appliquée : ${r.raison} Bâtiments placés sans tenir compte de la bande.`);
}

const copieFacades = (b: BandePreparee): FacadeLocale[] => b.facades.map(f => ({ a: { x: f.a.x, y: f.a.y }, b: { x: f.b.x, y: f.b.y } }));

/**
 * Lot C7c : repère des rangées dans la bande principale — u le long de la voie, v croissant EN S'ÉLOIGNANT de
 * la voie (les rangées partent de la voie). Angle de la voie, retourné d'un demi-tour si la voie est du côté des v hauts.
 */
function angleRangeesBande(contour: PointLocal[], bande: BandePreparee): number {
  const c = Math.cos(-bande.angle), s = Math.sin(-bande.angle);
  const vDe = (p: PointLocal) => p.x * s + p.y * c;
  const vs = contour.map(vDe), milieu = (Math.min(...vs) + Math.max(...vs)) / 2;
  let somme = 0, poids = 0;
  for (const f of bande.facades) { const l = Math.hypot(f.b.x - f.a.x, f.b.y - f.a.y); somme += l * (vDe(f.a) + vDe(f.b)) / 2; poids += l; }
  return poids > 0 && somme / poids > milieu ? bande.angle + Math.PI : bande.angle;
}

/**
 * Lot C7c : épaisseurs de bâtiment collectif essayées dans la bande principale, de la plus grande à la plus
 * petite. L'épaisseur du moteur (règle PLU ou 16 m) ne tient pas toujours entre le recul et le fond de bande
 * (18 m − 4 m = 14 m à Montreuil) : comme calculerVolumeParcelle, on essaie aussi la profondeur de bande moins
 * le recul (à 0,5 m et 1 m près), et les trois quarts et la moitié de l'épaisseur. Jamais plus que l'épaisseur maximale.
 */
function epaisseursBande(ct: Contraintes, profondeurM: number): number[] {
  const H = HYPOTHESES_VOLUME, ep = ct.epaisseurMax;
  // Lot C10 : c'est le recul côté VOIE qui borne l'épaisseur dans la bande (recul uniforme quand il n'est pas différencié).
  const reculs = ct.reculVoieM !== null ? [ct.reculVoieM]
    : [...new Set(Array.from({ length: Math.max(1, ct.niveauxMax) }, (_, i) => ct.reculPour((i + 1) * H.hauteurEtageM)))].slice(0, 3);
  const candidats = [ep, ep * 0.75, ep * 0.5, ...reculs.flatMap(r => [profondeurM - r, profondeurM - r - 0.5, profondeurM - r - 1])]
    .map(e => demi(Math.min(e, ep))).filter(e => e >= H.coteMinM);
  const liste = [...new Set(candidats)].sort((a, b) => b - a).slice(0, 8);
  return liste.length ? liste : [ep];
}

/**
 * L'implantation elle-même. `bande` null : comportement d'origine, à l'identique (toujours `{ volume }`).
 * Avec une bande : `{ raison }` si aucun bâtiment n'y tient ou si la preuve manque (l'appelant se replie).
 */
function implantationProgramme(
  geometrie: GeometrieParcelle | null | undefined,
  programme: ProgrammeVolume,
  regles: ReglesPluVolume,
  base: VolumePropose,
  bande: BandePreparee | null,
): { volume: VolumePropose } | { raison: string } {
  const composantes = (programme.composantes ?? []).filter(c => c.nombre >= 1);
  if (!composantes.length || base.statut === 'contour-invalide' || base.statut === 'hauteur-insuffisante') return { volume: base };
  const proj = projeterParcelle(geometrie)!;
  // Lot C10 : reculs différenciés seulement dans la bande, si chaque façade sur voie est une arête du contour.
  const differencie = !!bande && marquerSegmentsVoie(segmentsDe(proj.anneaux), bande.facades);
  const ct = contraintesPlu(regles, differencie && bande ? bande.implantation : null);
  const rc = bande ? reculsRetenus(regles.regles ?? [], differencie ? bande.implantation : null) : null;
  const angle = orientationParcelle(proj.anneaux[0]);
  const surface = base.surfaceParcelleM2;
  let essais: Implantation[];
  /** Avec une bande : épaisseur du collectif de chaque essai (même indice que `essais`). */
  let epaisseursEssais: number[] | null = null;
  if (!bande) essais = [angle, (angle + Math.PI / 2) % Math.PI].map(a => implanter(proj.anneaux, a, composantes, ct, surface));
  else {
    // Une seule orientation : celle de la voie. Plusieurs épaisseurs de collectif (une seule s'il n'y a que des maisons).
    const a = angleRangeesBande(proj.anneaux[0], bande);
    const dansLaBande: BandeImplantation = { facades: bande.facades, profondeurM: bande.profondeurM, empriseMaxM2: bande.empriseMaxM2, reculVoieM: ct.reculVoieM };
    epaisseursEssais = composantes.some(c => c.type !== 'maisons') ? epaisseursBande(ct, bande.profondeurM) : [ct.epaisseurMax];
    essais = epaisseursEssais.map(e => implanter(proj.anneaux, a, composantes, { ...ct, epaisseurMax: e }, surface, dansLaBande));
  }
  const score = (r: Implantation) => r.placees.reduce((s, n, i) => s + Math.min(n, composantes[i].nombre), 0);
  const retenue = essais.reduce((a, b) => score(b) > score(a) || (score(b) === score(a) && b.batiments.length < a.batiments.length) ? b : a);
  if (!retenue.batiments.length) {
    if (bande) return { raison: `aucun bâtiment du programme ne tient à la fois à ${fr(retenue.reculM, 1)} m des limites et à moins de ${fr(bande.profondeurM, 1)} m du côté voie${bande.empriseMaxM2 !== null ? ` (emprise maximale ${fr(bande.empriseMaxM2)} m²)` : ''}.` };
    return { volume: { ...base, alertes: [...retenue.alertes, ...base.alertes] } };
  }
  const epaisseurCollectif = epaisseursEssais ? epaisseursEssais[essais.indexOf(retenue)] : ct.epaisseurMax;

  // Retour au repère local (x est, y nord).
  const ci = Math.cos(retenue.angle), si = Math.sin(retenue.angle);
  const versLocal = (u: number, v: number): PointLocal => ({ x: u * ci - v * si, y: u * si + v * ci });
  const coinsDe = (r: RectUV) => [versLocal(r.ua, r.va), versLocal(r.ub, r.va), versLocal(r.ub, r.vb), versLocal(r.ua, r.vb)];
  const angleDeg = Math.round(((retenue.angle * 180 / Math.PI) % 180 + 180) % 180 * 10) / 10;
  // Ordre stable : par composante, puis rangée (v), puis u.
  const tries = [...retenue.batiments].sort((a, b) => a.composante - b.composante || a.va - b.va || a.ua - b.ua);
  const compteurs = new Map<string, number>();
  const batiments: BatimentPropose[] = tries.map((b, i) => {
    const largeurM = Math.round((b.ub - b.ua) * 100) / 100, profondeurM = Math.round((b.vb - b.va) * 100) / 100;
    const centre = versLocal((b.ua + b.ub) / 2, (b.va + b.vb) / 2);
    const nomForme = NOMS_FORME[b.forme];
    const rang = (compteurs.get(nomForme) ?? 0) + 1; compteurs.set(nomForme, rang);
    const detail = b.uniteLibelle === 'maison' ? (b.unites > 1 ? ` — ${b.unites} maisons` : '') : ` — ${b.unites} ${b.uniteLibelle}${b.unites > 1 ? 's' : ''}`;
    return {
      id: `mz-vol-${i + 1}`,
      nom: `${nomForme} ${String.fromCharCode(64 + Math.min(26, rang))}${detail} ${libelleRn(b.niveaux)}`.slice(0, 80),
      forme: b.forme, largeurM, profondeurM, niveaux: b.niveaux, hauteurM: b.niveaux * HYPOTHESES_VOLUME.hauteurEtageM,
      surfaceM2: Math.round(largeurM * profondeurM), sdpM2: Math.round(largeurM * profondeurM * b.niveaux),
      unites: b.unites, uniteLibelle: b.uniteLibelle,
      centre, centreWgs84: versWgs84(centre, proj.origine), angleDeg, coins: coinsDe(b),
    };
  });
  const voies: VoiePropose[] = retenue.voies.map(r => ({
    largeurM: r.vb - r.va, longueurM: Math.round((r.ub - r.ua) * 10) / 10, surfaceM2: Math.round((r.ub - r.ua) * (r.vb - r.va)), coins: coinsDe(r),
  }));
  const empriseTotale = batiments.reduce((s, b) => s + b.largeurM * b.profondeurM, 0);
  const sdpTotale = batiments.reduce((s, b) => s + b.largeurM * b.profondeurM * b.niveaux, 0);
  const somme = (u: BatimentPropose['uniteLibelle']) => batiments.filter(b => b.uniteLibelle === u).reduce((s, b) => s + b.unites, 0);
  const kpi: KpiImplantation = {
    batiments: batiments.length, unites: batiments.reduce((s, b) => s + b.unites, 0), unitesVisees: composantes.reduce((s, c) => s + c.nombre, 0),
    maisons: somme('maison'), logements: somme('logement'), lits: somme('lit'),
    empriseTotaleM2: Math.round(empriseTotale), sdpTotaleM2: Math.round(sdpTotale), voirieM2: voies.reduce((s, v) => s + v.surfaceM2, 0),
    ratioEmprise: surface > 0 ? Math.round(empriseTotale / surface * 1000) / 1000 : 0,
  };
  const principal = batiments.reduce((a, b) => b.largeurM * b.profondeurM > a.largeurM * a.profondeurM ? b : a);
  const niveaux = Math.max(...batiments.map(b => b.niveaux));
  const atteint = composantes.every((c, i) => retenue.placees[i] >= c.nombre);
  const sdpVisee = composantes.reduce((s, c) => s + c.nombre * (c.type === 'maisons' ? 0 : c.type === 'residence' ? HP.sdpUniteResidenceM2 : HP.sdpLogementCollectifM2), 0);

  const typologie = composantes.map(c => c.type === 'maisons'
    ? (() => {
      const bm = batiments.filter(b => b.uniteLibelle === 'maison'), n = bm[0]?.niveaux ?? 1;
      const g = n === 1 ? HP.maisonPlainPied : HP.maisonEtage;
      return `${c.libelle} : ${n === 1 ? 'plain-pied' : 'R+1'}, ${fr(g.facadeM, 1)} × ${fr(g.profondeurM, 1)} m par maison (≈ ${fr(g.facadeM * g.profondeurM * n)} m² de SDP), ${bm.length > 0 ? `${bm.length} bâtiment${bm.length > 1 ? 's' : ''} (${[...new Set(bm.map(b => NOMS_FORME[b.forme].toLowerCase()))].join(', ')})` : 'non placées'}.`;
    })()
    : `${c.libelle} : ${c.type === 'residence' ? `${fr(HP.sdpUniteResidenceM2)} m² de SDP par ${c.unite === 'lits' ? 'lit' : 'logement'} (chambres, communs, services), épaisseur ${fr(Math.min(HP.epaisseurResidenceM, epaisseurCollectif), 1)} m` : `${fr(HP.sdpLogementCollectifM2)} m² de SDP par logement, plots ou barres de ${fr(epaisseurCollectif, 1)} m d’épaisseur et ${fr(HP.longueurBarreMaxM)} m de long au plus`}.`);
  const hypotheses = [
    bande && rc && ct.reculVoieM !== null ? hypotheseReculsDifferencies(rc, bande, retenue.reculM)
    : bande
      ? (ct.reculConnu ? `Recul de ${fr(retenue.reculM, 1)} m sur toutes les limites, côté voie compris : le plus fort des reculs PLU (recul à la voie et reculs aux limites non différenciés).` : `Recul de ${fr(HYPOTHESES_VOLUME.reculDefautM)} m sur toutes les limites, côté voie compris (valeur par défaut).`)
      : ct.reculConnu ? `Recul de ${fr(retenue.reculM, 1)} m sur toutes les limites : le plus fort des reculs PLU (côté voie non identifié).` : `Recul de ${fr(HYPOTHESES_VOLUME.reculDefautM)} m sur toutes les limites (valeur par défaut).`,
    `Emprise au sol totale bornée à ${fr(ct.ratioEmprise * 100, 1)} % de la parcelle${regles.regles.length ? '' : ' (valeur par défaut)'} ; voies et stationnements non comptés.`,
    ...(bande && bande.empriseMaxM2 !== null ? [`Emprise au sol bornée à ${fr(bande.empriseMaxM2)} m² : maximum de la bande principale.`] : []),
    ...typologie,
    ...(composantes.some(c => c.type === 'maisons') ? [`Maisons : voie de desserte de ${fr(HP.voieM)} m, ${fr(HP.reculVoieM)} m entre maison et voie (stationnement), jardins arrière ≥ ${fr(HP.jardinArriereM)} m, ${fr(HP.ecartPignonsMaisonsM)} m entre pignons, ${HP.maisonsParBandeMax} maisons par bande (${HP.maisonsParBandeAbsolu} au plus).`] : []),
    ...(composantes.some(c => c.type !== 'maisons') ? [`Collectif : façades en vis-à-vis à ≥ max(H, ${fr(HP.distanceFacadesMinM)} m), pignons à ≥ max(H/2, ${fr(HP.distancePignonsMinM)} m) ; R+${HP.niveauxCollectifDepart - 1} d’abord, plus haut si nécessaire.`] : []),
    ...(bande
      ? [`Implantation en rangées parallèles à la voie, dans la bande principale (${fr(bande.profondeurM, 1)} m depuis le côté voie présumé) : chaque bâtiment y est contenu en entier ; hauteur d’étage ${fr(HYPOTHESES_VOLUME.hauteurEtageM)} m, toit plat.`,
        `Bande secondaire (au-delà de ${fr(bande.profondeurM, 1)} m depuis la voie) : non construite dans ce volume d’étude.`,
        ...hypothesesImplantation(bande)]
      : [`Implantation en rangées parallèles au ${Math.abs(retenue.angle - angle) < 1e-9 ? 'grand côté' : 'petit côté'} de la parcelle (deux orientations essayées) ; hauteur d’étage ${fr(HYPOTHESES_VOLUME.hauteurEtageM)} m, toit plat.`]),
    `Studio : ${LIMITE_BATIMENTS_STUDIO} bâtiments au plus.`,
  ];
  const volume: VolumePropose = {
    ...base,
    statut: 'calcule',
    emprise: { largeurM: principal.largeurM, profondeurM: principal.profondeurM, surfaceM2: principal.surfaceM2, centre: principal.centre, centreWgs84: principal.centreWgs84, angleDeg: principal.angleDeg, coins: principal.coins },
    niveaux, hauteurM: niveaux * HYPOTHESES_VOLUME.hauteurEtageM, sdpM2: kpi.sdpTotaleM2,
    logementsEstimes: kpi.unites, sdpViseeM2: sdpVisee > 0 ? sdpVisee : null, programmeAtteint: atteint,
    reculM: retenue.reculM, cesRetenu: base.cesRetenu,
    hypotheses, alertes: [...retenue.notes, ...retenue.alertes],
    batiments, voies, kpi,
  };
  if (!bande) return { volume };
  // Lot C7c — preuve avant de rendre : chaque bâtiment est repassé par le test de bande (dans le repère local,
  // indépendamment du repère des rangées), et l'emprise totale est comparée aux deux plafonds.
  const etat: BandeVolume = {
    statut: 'appliquee', raison: null, profondeurM: bande.profondeurM, longueurFacadeM: bande.longueurFacadeM,
    angleVoieDeg: Math.round(bande.angle * 180 / Math.PI * 10) / 10,
    distanceMaxVoieM: Math.ceil(Math.max(...batiments.flatMap(b => b.coins.map(p => distanceVoie(p, bande.facades)))) * 100 - 1e-6) / 100,
    empriseMaxM2: bande.empriseMaxM2, facades: copieFacades(bande),
    ...(ct.reculVoieM !== null ? { reculVoieM: ct.reculVoieM, reculLimitesM: retenue.reculM } : {}),
  };
  const dansLaBande: VolumePropose = { ...volume, bande: etat };
  const preuve = verifierBandeVolume(dansLaBande);
  if (!preuve.prouvee) return { raison: `implantation dans la bande non prouvée (${preuve.raison}).` };
  if (empriseTotale > ct.ratioEmprise * surface + 1e-6) return { raison: `emprise de ${fr(empriseTotale)} m² au-dessus du plafond de ${fr(ct.ratioEmprise * surface)} m² (${fr(ct.ratioEmprise * 100, 1)} % de la parcelle).` };
  // Lot C10 — reculs différenciés : distances RÉELLES des bâtiments au côté voie et aux autres limites, remesurées
  // sur le résultat (indépendamment du placement, à 2 cm près). Preuve manquante : repli, jamais un volume douteux.
  if (ct.reculVoieM !== null) {
    for (const b of batiments) {
      // Bâtiment par bâtiment : le recul aux limites dépend de la hauteur de chacun (règle H/k).
      const m = mesurerReculsVolume({ bande: etat, contour: dansLaBande.contour, emprise: null, batiments: [b] });
      const exige = ct.reculPour(b.hauteurM);
      if (!m) return { raison: 'reculs à la voie et aux limites non mesurables sur le volume obtenu.' };
      if (m.voieM < ct.reculVoieM - 0.02) return { raison: `bâtiment à ${fr(m.voieM, 2)} m du côté voie pour ${fr(ct.reculVoieM, 2)} m exigés.` };
      if (m.limitesM !== null && m.limitesM < exige - 0.02) return { raison: `bâtiment à ${fr(m.limitesM, 2)} m d’une limite séparative pour ${fr(exige, 2)} m exigés.` };
    }
  }
  return { volume: dansLaBande };
}
