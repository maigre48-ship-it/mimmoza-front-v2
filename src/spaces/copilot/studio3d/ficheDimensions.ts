// src/spaces/copilot/studio3d/ficheDimensions.ts
// =============================================================================
// LOT FICHE-3D — « Dimensions » et « Programme » de la fiche « Espace 3D — Dossier
// du projet » : logique PURE (testée par ficheDimensions.test.ts, node --test).
// Aucune I/O, aucun React ici.
//
// D'OÙ VIENNENT LES CHIFFRES
//   - Préremplissage : le volume calculé par le MOTEUR du Dossier 3D pour la
//     conception (outil studio_preparer_3d → ligne studio_preparations : parcelle,
//     règles PLU de la conception, programme, volume). Jamais le texte du modèle.
//   - Modification par l'utilisateur (forme, longueur, largeur, niveaux) : chaque
//     bâtiment garde son centre et son orientation calculés par le moteur ; SDP,
//     capacité en logements, emprise, reculs réels aux limites et vérifications PLU
//     sont recalculés par les MÊMES fonctions que le Dossier 3D et le serveur
//     (volumeParcelle.rectTient / segmentsDe / versWgs84, controlesVolume.controlerVolume).
//   - Hauteurs : cotes du Studio reprises par le lot brief-créatif
//     (briefCreatif.hauteurCorps : rez 3,30 m, étages 2,80 m, dalle 0,22 m, attique 2,70 m).
//     Les vérifications PLU du moteur gardent sa convention (3 m par niveau) ; la
//     hauteur dessinée par le Studio est confrontée à la règle à part, honnêtement.
//   - Programme : affiché depuis le moteur ; si le texte du modèle diverge, le moteur
//     gagne et l'écart est signalé (ecartsProgramme).
//
// FORMES : seules celles que le moteur de volume ET le Studio produisent réellement
// sont sélectionnables. Lot fiche-3d : barre, barres parallèles, plot (rectangles du
// contrat v2, `batiments`). LOT FORMES-BATIMENT : plots multiples (rectangles), en L,
// en U, cour fermée et redans (bâtiments À AILES, formesBatiment.ts : placés par le
// moteur avec ses contraintes, vérifiés aile par aile sur le vrai contour, transmis au
// Studio par les `ailes` du contrat v2 → archétype multi_wing, contrôlé aile par aile
// par le worker). Les dimensions se saisissent aile par aile (longueur hors tout,
// épaisseur, niveaux) ; le centre de l'enveloppe et l'orientation sont gardés.
//
// Jamais « conforme » : verdicts de controlerVolume (« dans la limite de la règle
// citée » seulement pour une règle confirmée et citée), sinon « à vérifier ».
// =============================================================================

import { hauteurCorps, type ApercuVolume } from './briefCreatif.ts';
import { controlerVolume, regleCitee, type ControleVolume, type RegleLue } from './controlesVolume.ts';
import { HYPOTHESES_PROGRAMME } from './implantationProgramme.ts';
import {
  corpsAffiches, HYPOTHESES_VOLUME, libelleNiveaux, NOMS_FORME_AILES, rectTient, segmentsDe, versWgs84,
  type AilePropose, type BatimentPropose, type FormeAiles, type FormeBatie, type PointLocal, type ProgrammeVolume, type VolumePropose,
} from './volumeParcelle.ts';
import {
  boitesApercu, coinsRect, contourRects, normaliserAiles, placerForme, rectsAiles, versLocal, visAVisInterieurs,
  type AileSaisie, type ContexteForme, type FormeCalculee, type RectAile,
} from './formesBatiment.ts';

export type { AileSaisie } from './formesBatiment.ts';

// ── Formes ────────────────────────────────────────────────────────────────────
export type Forme = 'barre' | 'barres' | 'plot' | 'plots' | 'l' | 'u' | 'cour' | 'redans';

export interface OptionForme {
  valeur: Forme;
  libelle: string;
  /** Une phrase simple. */
  detail: string;
  /** Faux = « bientôt », jamais sélectionnable. */
  disponible: boolean;
}

export const FORMES: readonly OptionForme[] = [
  { valeur: 'barre', libelle: 'Une barre', detail: 'Un bâtiment long et peu épais.', disponible: true },
  { valeur: 'barres', libelle: 'Barres parallèles', detail: 'Plusieurs bâtiments parallèles, espacés d’au moins leur hauteur.', disponible: true },
  { valeur: 'plot', libelle: 'Plot', detail: 'Un bâtiment compact, presque carré.', disponible: true },
  // Lot formes-batiment : calculées, vérifiées et transmises au Studio aile par aile.
  { valeur: 'plots', libelle: 'Plots', detail: 'Plusieurs bâtiments compacts, espacés comme le moteur le suppose.', disponible: true },
  { valeur: 'l', libelle: 'En L', detail: 'Deux ailes en équerre : suit un angle de la parcelle.', disponible: true },
  { valeur: 'u', libelle: 'En U', detail: 'Trois ailes autour d’une cour ouverte.', disponible: true },
  { valeur: 'cour', libelle: 'Cour fermée', detail: 'Quatre ailes autour d’une cour intérieure.', disponible: true },
  { valeur: 'redans', libelle: 'Redans', detail: 'Une barre en segments décalés : suit une limite en biais.', disponible: true },
];

/** Formes à ailes (un bâtiment, plusieurs rectangles accolés). */
export const estFormeAiles = (f: Forme | 'moteur'): f is FormeAiles => f === 'l' || f === 'u' || f === 'cour' || f === 'redans';

/** Bornes de saisie (Studio : 30 niveaux au plus, HYPOTHESES_VOLUME.niveauxMaxStudio ; côté ≥ 6 m comme le moteur). */
export const BORNES = { coteMinM: HYPOTHESES_VOLUME.coteMinM, longueurMaxM: 120, largeurMaxM: 40, niveauxMax: HYPOTHESES_VOLUME.niveauxMaxStudio } as const;

/** Un bâtiment de la fiche (repère local du Dossier 3D : x est, y nord ; angle du grand côté depuis l'est). */
export interface CorpsSaisi {
  id: string;
  nom: string;
  /** Grand côté (m) — « largeurM » du moteur. */
  longueurM: number;
  /** Épaisseur (m) — « profondeurM » du moteur. */
  largeurM: number;
  niveaux: number;
  centre: PointLocal;
  angleDeg: number;
  /** Forme bâtie du moteur (barre, plot, maisons…) quand le bâtiment vient du moteur. */
  formeMoteur: FormeBatie | null;
  /**
   * Lot formes-batiment : ailes (longueur hors tout, épaisseur, niveaux) d'un bâtiment en L, en U, à cour
   * ou à redans ; null pour un rectangle. Avec des ailes, longueurM / largeurM / niveaux sont ceux de
   * l'enveloppe (dérivés des ailes) et `centre` est le centre de l'enveloppe.
   */
  ailes?: AileSaisie[] | null;
  formeAiles?: FormeAiles;
  /** Redans : décalage de chaque segment par rapport au précédent (m, signé). */
  decalageM?: number;
}

export interface SaisieDimensions {
  /** 'moteur' : forme du moteur hors du choix (maisons, résidence) — dimensions modifiables, forme non. */
  forme: Forme | 'moteur';
  corps: CorpsSaisi[];
}

export interface PreparationFiche {
  idu: string;
  commune: string | null;
  volume: VolumePropose;
  regles: RegleLue[];
  programme: ProgrammeVolume | undefined;
  /** Lot formes-batiment : gabarit du programme (niveaux plafonds, choix du projet) ; null/absent si libre. */
  gabaritNiveaux?: number | null;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const demi = (v: number) => Math.round(v * 2) / 2;
const fr = (v: number, d = 0) => v.toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const COLLECTIF: readonly FormeBatie[] = ['barre', 'plot'];

/** Forme d'un rectangle au sens du moteur (implantationProgramme : plot si longueur ≤ 1,4 × épaisseur). */
export const estPlot = (longueurM: number, largeurM: number) => longueurM <= 1.4 * largeurM + 1e-9;

/** Forme du volume calculé par le moteur. */
export function formeDuVolume(v: Pick<VolumePropose, 'emprise' | 'niveaux' | 'hauteurM' | 'batiments'>): Forme | 'moteur' {
  const corps = corpsAffiches(v);
  const formes = v.batiments && v.batiments.length > 1 ? v.batiments.map(b => b.forme) : null;
  if (formes && formes.some(f => !COLLECTIF.includes(f))) return 'moteur';
  // Lot formes-batiment : bâtiment à ailes (relu d'une préparation ou d'une évaluation) ; plusieurs plots.
  const aile = corps.find(c => c.formeAiles && (c.ailes?.length ?? 0) >= 2);
  if (aile?.formeAiles) return corps.length === 1 ? aile.formeAiles : 'moteur';
  if (formes && formes.every(f => f === 'plot')) return 'plots';
  if (corps.length > 1) return 'barres';
  const c = corps[0];
  return c && estPlot(c.largeurM, c.profondeurM) ? 'plot' : 'barre';
}

/** Saisie préremplie depuis le volume du moteur (jamais depuis le texte du modèle). */
export function saisieDepuisVolume(v: Pick<VolumePropose, 'emprise' | 'niveaux' | 'hauteurM' | 'batiments'>): SaisieDimensions {
  const multiples = v.batiments && v.batiments.length > 1 ? v.batiments : null;
  const corps = corpsAffiches(v).map((c, i): CorpsSaisi => ({
    id: c.id, nom: c.nom ?? 'Bâtiment', longueurM: c.largeurM, largeurM: c.profondeurM, niveaux: c.niveaux,
    centre: { ...c.centre }, angleDeg: c.angleDeg, formeMoteur: multiples ? multiples[i].forme : null,
    // Lot formes-batiment : ailes relues (paramètres saisis : longueur hors tout, épaisseur, niveaux).
    ...(c.formeAiles && c.ailes && c.ailes.length >= 2 ? {
      formeMoteur: 'barre' as FormeBatie, formeAiles: c.formeAiles, decalageM: c.decalageM ?? 0,
      ailes: c.ailes.map((a): AileSaisie => ({ nom: a.nom, longueurM: a.longueurM, largeurM: a.epaisseurM, niveaux: a.niveaux })),
    } : {}),
  }));
  return { forme: formeDuVolume(v), corps };
}

/** Lot formes-batiment : enveloppe d'un bâtiment à ailes (longueur, largeur, niveaux) recalculée depuis ses ailes. */
function avecEnveloppe(c: CorpsSaisi): CorpsSaisi {
  if (!c.ailes || !c.formeAiles) return c;
  const nz = normaliserAiles(c.formeAiles, c.ailes, c.decalageM ?? 0);
  const { lu, lv } = rectsAiles(c.formeAiles, nz.ailes, nz.decalageM);
  return { ...c, ailes: nz.ailes, decalageM: nz.decalageM, longueurM: lu, largeurM: lv, niveaux: Math.max(...nz.ailes.map(a => a.niveaux)) };
}

/** Valeur saisie → valeur bornée (pas de 0,5 m ; niveaux entiers). null = saisie illisible (on garde l'ancienne). */
export function bornerValeur(champ: 'longueurM' | 'largeurM' | 'niveaux', brut: string | number): number | null {
  if (typeof brut === 'string' && !brut.trim()) return null;
  const n = typeof brut === 'number' ? brut : Number(brut.replace(',', '.').trim());
  if (!Number.isFinite(n)) return null;
  if (champ === 'niveaux') return Math.max(1, Math.min(BORNES.niveauxMax, Math.round(n)));
  return Math.max(BORNES.coteMinM, Math.min(champ === 'longueurM' ? BORNES.longueurMaxM : BORNES.largeurMaxM, demi(n)));
}

/** Modifie un champ d'un bâtiment (valeurs bornées) ; la forme suit (barre ↔ plot) pour un bâtiment seul. */
export function modifierCorps(s: SaisieDimensions, index: number, champ: 'longueurM' | 'largeurM' | 'niveaux', brut: string | number): SaisieDimensions {
  const v = bornerValeur(champ, brut);
  if (v === null || !s.corps[index]) return s;
  // Lot formes-batiment : un bâtiment à ailes se modifie aile par aile (modifierAile) ; ses niveaux d'un coup.
  if (s.corps[index].ailes) {
    if (champ !== 'niveaux') return s;
    return { ...s, corps: s.corps.map((c, i) => (i === index ? avecEnveloppe({ ...c, ailes: c.ailes!.map(a => ({ ...a, niveaux: v })) }) : c)) };
  }
  const corps = s.corps.map((c, i) => (i === index ? { ...c, [champ]: v } : c));
  let forme = s.forme;
  if (corps.length === 1 && (forme === 'barre' || forme === 'plot')) forme = estPlot(corps[0].longueurM, corps[0].largeurM) ? 'plot' : 'barre';
  return { forme, corps };
}

/**
 * Lot formes-batiment : modifie une aile (longueur hors tout, épaisseur, niveaux), valeurs bornées ; la forme
 * reste cohérente (côtés liés de la cour, retours plus longs que la base, ouverture ≥ 6 m) ; le centre de
 * l'enveloppe et l'orientation sont gardés.
 */
export function modifierAile(s: SaisieDimensions, index: number, aile: number, champ: 'longueurM' | 'largeurM' | 'niveaux', brut: string | number): SaisieDimensions {
  const v = bornerValeur(champ, brut);
  const c = s.corps[index];
  if (v === null || !c?.ailes?.[aile] || !c.formeAiles) return s;
  let ailes = c.ailes.map((a, k) => (k === aile ? { ...a, [champ]: v } : a));
  // Cour fermée : les côtés opposés ont la même longueur (sinon la cour ne se ferme pas).
  if (c.formeAiles === 'cour' && champ === 'longueurM') ailes = ailes.map((a, k) => (k === (aile + 2) % 4 ? { ...a, longueurM: v } : a));
  return { ...s, corps: s.corps.map((x, i) => (i === index ? avecEnveloppe({ ...x, ailes }) : x)) };
}

/** Lot formes-batiment : décalage des redans (m, signé ; borné pour garder ≥ 4 m de contact entre segments). */
export function modifierDecalage(s: SaisieDimensions, index: number, brut: string | number): SaisieDimensions {
  const c = s.corps[index];
  if (!c?.ailes || c.formeAiles !== 'redans') return s;
  const n = typeof brut === 'number' ? brut : Number(String(brut).replace(',', '.').trim());
  if (!Number.isFinite(n) || (typeof brut === 'string' && !brut.trim())) return s;
  return { ...s, corps: s.corps.map((x, i) => (i === index ? avecEnveloppe({ ...x, decalageM: n }) : x)) };
}

/** Écart minimal entre façades en vis-à-vis supposé par le moteur (max(H, 8 m)) ; H = niveaux × 3 m. */
export const ecartFacadesMoteur = (niveaux: number) => Math.max(niveaux * HYPOTHESES_VOLUME.hauteurEtageM, HYPOTHESES_PROGRAMME.distanceFacadesMinM);

/** Raison pour laquelle une forme n'est pas choisissable ; null = choisissable. */
export function raisonFormeIndisponible(forme: Forme, s: SaisieDimensions): string | null {
  const o = FORMES.find(f => f.valeur === forme);
  if (!o) return 'Forme inconnue.';
  if (!o.disponible) return 'Bientôt disponible.';
  if (s.forme === 'moteur') return 'Le choix de forme concerne les immeubles collectifs ; ce programme garde la forme du moteur.';
  return null;
}

type Cadre = { anneaux: PointLocal[][]; segments: ReturnType<typeof segmentsDe>; angle: number };
const tourner = (p: PointLocal, a: number): PointLocal => ({ x: p.x * Math.cos(-a) - p.y * Math.sin(-a), y: p.x * Math.sin(-a) + p.y * Math.cos(-a) });
function cadre(contour: PointLocal[], angleDeg: number): Cadre {
  const a = angleDeg * Math.PI / 180;
  const anneaux = [contour.map(p => tourner(p, a))];
  return { anneaux, segments: segmentsDe(anneaux), angle: a };
}
const tientDans = (k: Cadre, c: Pick<CorpsSaisi, 'centre' | 'longueurM' | 'largeurM'>, recul: number) => {
  const q = tourner(c.centre, k.angle);
  return rectTient(k.anneaux, k.segments, { cu: q.x, cv: q.y, w: c.longueurM, d: c.largeurM }, Math.max(1e-6, recul));
};

/**
 * Change la forme (transformation déterministe, centres et orientation du moteur) :
 *   - barre / plot → bâtiment principal seul (plot : longueur ramenée à 1,4 × l'épaisseur au plus) ;
 *   - barres : le volume du moteur s'il en a plusieurs ; sinon une 2ᵉ barre identique, parallèle, à
 *     l'écart de façades du moteur (max(H, 8 m)), placée du côté où les deux tiennent dans la parcelle.
 */
export function appliquerForme(p: PreparationFiche, s: SaisieDimensions, forme: Forme): SaisieDimensions {
  return appliquerFormeDetail(p, s, forme).saisie;
}

/** Lot formes-batiment : contexte du moteur pour placer une forme (mêmes contraintes que le volume du moteur). */
export function contexteForme(p: PreparationFiche): ContexteForme {
  const vises = p.programme?.logements ?? p.volume.kpi?.unitesVisees ?? null;
  return {
    contour: p.volume.contour, angleDeg: p.volume.emprise?.angleDeg ?? 0, surfaceParcelleM2: p.volume.surfaceParcelleM2,
    regles: p.regles, gabaritNiveaux: p.gabaritNiveaux ?? null,
    sdpViseeM2: vises !== null && vises > 0 ? Math.round(vises) * HYPOTHESES_VOLUME.sdpParLogementM2 : Math.max(1, p.volume.sdpM2),
  };
}

const NOM_PLACE: Record<FormeCalculee, string> = { plots: 'Plot', l: 'Immeuble en L', u: 'Immeuble en U', cour: 'Immeuble à cour', redans: 'Immeuble à redans' };

/**
 * Change la forme ; `raison` non nulle si la forme ne tient pas (saisie inchangée).
 * Plots, L, U, cour, redans : placés par le moteur (formesBatiment.placerForme), pour la SDP visée.
 */
export function appliquerFormeDetail(p: PreparationFiche, s: SaisieDimensions, forme: Forme): { saisie: SaisieDimensions; raison: string | null } {
  const indispo = raisonFormeIndisponible(forme, s);
  if (indispo) return { saisie: s, raison: indispo };
  if (forme === s.forme) return { saisie: s, raison: null };
  if (forme === 'plots' || estFormeAiles(forme)) {
    const pl = placerForme(contexteForme(p), forme);
    if (!pl.corps.length) return { saisie: s, raison: pl.raison ?? 'Cette forme ne tient pas dans la parcelle.' };
    return {
      saisie: {
        forme, corps: pl.corps.map((c, i): CorpsSaisi => avecEnveloppe({
          id: `fiche-${forme}-${i + 1}`, nom: `${NOM_PLACE[forme]}${pl.corps.length > 1 ? ` ${String.fromCharCode(65 + i)}` : ''}`,
          longueurM: c.longueurM, largeurM: c.largeurM, niveaux: c.niveaux, centre: c.centre, angleDeg: c.angleDeg,
          formeMoteur: forme === 'plots' ? 'plot' : 'barre',
          ...(c.ailes && estFormeAiles(forme) ? { ailes: c.ailes, formeAiles: forme, decalageM: c.decalageM } : {}),
        })),
      },
      raison: null,
    };
  }
  return { saisie: appliquerFormeRect(p, s, forme), raison: null };
}

function appliquerFormeRect(p: PreparationFiche, s: SaisieDimensions, forme: Forme): SaisieDimensions {
  const moteur = saisieDepuisVolume(p.volume);
  const principal = (() => {
    const i = s.corps.reduce((m, c, k) => (c.longueurM * c.largeurM > s.corps[m].longueurM * s.corps[m].largeurM ? k : m), 0);
    return sansAiles(s.corps[i]);
  })();
  if (forme === 'barre' || forme === 'plot') {
    const longueurM = forme === 'plot' ? Math.min(principal.longueurM, Math.max(BORNES.coteMinM, Math.floor(1.4 * principal.largeurM * 2) / 2))
      : estPlot(principal.longueurM, principal.largeurM) ? demi(Math.min(BORNES.longueurMaxM, principal.largeurM * 2)) : principal.longueurM;
    return { forme, corps: [{ ...principal, longueurM, formeMoteur: principal.formeMoteur, nom: principal.nom }] };
  }
  // Barres parallèles.
  if (moteur.forme === 'barres') return { forme, corps: moteur.corps.map(c => ({ ...c, centre: { ...c.centre } })) };
  const a = principal.angleDeg * Math.PI / 180;
  const normale = { x: -Math.sin(a), y: Math.cos(a) };
  const pas = principal.largeurM + ecartFacadesMoteur(principal.niveaux);
  const k = cadre(p.volume.contour, principal.angleDeg);
  const recul = Math.max(0, p.volume.reculM);
  const place = (d1: number, d2: number) => [d1, d2].map((d, i): CorpsSaisi => ({
    ...principal, id: `fiche-${i + 1}`, nom: `Barre ${String.fromCharCode(65 + i)}`, formeMoteur: 'barre',
    centre: { x: principal.centre.x + normale.x * d, y: principal.centre.y + normale.y * d },
  }));
  const essais = [place(-pas / 2, pas / 2), place(0, pas), place(-pas, 0)];
  // Tolérance de 1 cm sur le recul, comme le moteur (implantationProgramme.TOLERANCE_M).
  const retenu = essais.find(e => e.every(c => tientDans(k, c, recul - 0.01))) ?? essais[0];
  return { forme, corps: retenu };
}

/** Rectangle seul tiré d'un bâtiment (à ailes : son enveloppe ramenée à l'épaisseur de sa première aile). */
function sansAiles(c: CorpsSaisi): CorpsSaisi {
  if (!c.ailes) return c;
  const reste: CorpsSaisi = { ...c, largeurM: Math.min(c.largeurM, c.ailes[0].largeurM), formeMoteur: 'barre' };
  delete reste.ailes; delete reste.formeAiles; delete reste.decalageM;
  return reste;
}

// ── Évaluation (moteur) ───────────────────────────────────────────────────────
export interface CorpsEvalue extends CorpsSaisi {
  coins: PointLocal[];
  empriseM2: number;
  sdpM2: number;
  /** Hauteur selon le moteur (niveaux × 3 m, toit plat) : celle des vérifications PLU. */
  hauteurMoteurM: number;
  /** Hauteur dessinée par le Studio (cotes du lot brief-créatif), sans attique. */
  hauteurStudioM: number;
  /** Idem avec l'attique du brief (si choisi). */
  hauteurStudioAttiqueM: number;
  /** Distance réelle la plus courte aux limites de la parcelle (m, au cm près) ; 0 = déborde. */
  reculReelM: number;
  logements: number;
  /**
   * Lot formes-batiment : ailes évaluées (bâtiment en L, en U, à cour, à redans) — rectangles construits,
   * surface, SDP, hauteurs et recul réel de CHAQUE aile ; null pour un rectangle.
   */
  ailesEvaluees: AileEvaluee[] | null;
  /** Contour réel du bâtiment (réunion des ailes) : boucles extérieures puis cours, repère local. */
  contours: PointLocal[][];
  /** Linéaire de façade (m) : périmètre du contour réel, cours comprises. */
  facadeM: number;
}

/** Lot formes-batiment : une aile évaluée par le moteur. */
export interface AileEvaluee extends RectAile {
  longueurM: number;
  largeurM: number;
  coins: PointLocal[];
  centre: PointLocal;
  empriseM2: number;
  sdpM2: number;
  hauteurMoteurM: number;
  hauteurStudioM: number;
  reculReelM: number;
}

export interface ControleHauteurStudio { verdict: ControleVolume['verdict']; texte: string }

export interface EvaluationFiche {
  modifie: boolean;
  forme: Forme | 'moteur';
  corps: CorpsEvalue[];
  sdpM2: number;
  empriseM2: number;
  /** Emprise / surface de la parcelle (0 à 1). */
  empriseRatio: number;
  surfaceParcelleM2: number;
  /** Capacité en logements : SDP / 70 m² (hypothèse du moteur). */
  capaciteLogements: number;
  logementsVises: number | null;
  /** Logements placés : capacité plafonnée au programme visé (comme le moteur). */
  logementsPlaces: number;
  reculMinM: number;
  controles: ControleVolume[];
  hauteurStudio: ControleHauteurStudio | null;
  alertes: string[];
  /** Volume complet (même forme que celui du moteur) : aperçu, ouverture dans le Studio. */
  volume: VolumePropose;
}

/** Plus grand recul tenu par le bâtiment (bissection sur rectTient, le test du moteur), au centimètre. */
function reculReel(k: Cadre, c: Pick<CorpsSaisi, 'centre' | 'longueurM' | 'largeurM'>): number {
  if (!tientDans(k, c, 1e-6)) return 0;
  let bas = 0, haut = 60;
  if (tientDans(k, c, haut)) return haut;
  for (let i = 0; i < 24 && haut - bas > 0.004; i++) { const m = (bas + haut) / 2; if (tientDans(k, c, m)) bas = m; else haut = m; }
  return Math.floor(bas * 100) / 100;
}

function coinsDe(c: Pick<CorpsSaisi, 'centre' | 'longueurM' | 'largeurM' | 'angleDeg'>): PointLocal[] {
  const a = c.angleDeg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([du, dv]) => {
    const u = du * c.longueurM / 2, v = dv * c.largeurM / 2;
    return { x: c.centre.x + u * ca - v * sa, y: c.centre.y + u * sa + v * ca };
  });
}

/** Répartit les logements placés au prorata des capacités (reste au dernier). */
function repartir(places: number, capacites: number[]): number[] {
  const total = capacites.reduce((s, c) => s + c, 0);
  if (total <= 0) return capacites.map(() => 0);
  let reste = places;
  return capacites.map((c, i) => {
    const n = i === capacites.length - 1 ? reste : Math.min(c, Math.round(places * c / total));
    reste -= n;
    return Math.max(0, n);
  });
}

const memesAiles = (a: CorpsSaisi, b: CorpsSaisi) => (a.formeAiles ?? null) === (b.formeAiles ?? null)
  && Math.abs((a.decalageM ?? 0) - (b.decalageM ?? 0)) < 1e-6
  && (a.ailes?.length ?? 0) === (b.ailes?.length ?? 0)
  && (a.ailes ?? []).every((x, k) => { const y = b.ailes![k]; return Math.abs(x.longueurM - y.longueurM) < 1e-6 && Math.abs(x.largeurM - y.largeurM) < 1e-6 && x.niveaux === y.niveaux; });

const egales = (a: SaisieDimensions, b: SaisieDimensions) => a.corps.length === b.corps.length && a.corps.every((c, i) => {
  const d = b.corps[i];
  return Math.abs(c.longueurM - d.longueurM) < 1e-6 && Math.abs(c.largeurM - d.largeurM) < 1e-6 && c.niveaux === d.niveaux
    && Math.abs(c.centre.x - d.centre.x) < 1e-6 && Math.abs(c.centre.y - d.centre.y) < 1e-6 && Math.abs(c.angleDeg - d.angleDeg) < 1e-6
    && memesAiles(c, d);
});

const NOMS: Partial<Record<FormeBatie, string>> = { barre: 'Barre', plot: 'Plot' };

/** Lot formes-batiment : rectangles construits d'un bâtiment (ses ailes, sinon lui-même). */
function piecesDe(c: CorpsSaisi): RectAile[] {
  if (c.ailes && c.formeAiles) return rectsAiles(c.formeAiles, c.ailes, c.decalageM ?? 0).rects;
  return [{ index: 0, nom: c.nom, du: 0, dv: 0, lu: c.longueurM, lv: c.largeurM, niveaux: c.niveaux }];
}

/** Périmètre (m) de boucles fermées. */
const perimetre = (boucles: { x: number; y: number }[][]) => boucles.reduce((s, b) => s + b.reduce((t, p, k) => { const n = b[(k + 1) % b.length]; return t + Math.hypot(n.x - p.x, n.y - p.y); }, 0), 0);

/**
 * Évalue la saisie avec le moteur. Saisie identique au volume du moteur : ses chiffres tels quels
 * (et ses vérifications, recalculées par la même fonction que le serveur → mêmes verdicts).
 * Lot formes-batiment : un bâtiment à ailes est évalué AILE PAR AILE (emprise et SDP réelles, recul réel de
 * chaque aile mesuré sur le contour de la parcelle) ; l'écart entre façades en vis-à-vis d'une cour est
 * confronté à l'hypothèse du moteur (max(H, 8 m)), jamais présenté comme une règle PLU.
 */
export function evaluerSaisie(p: PreparationFiche, s: SaisieDimensions, attique = false): EvaluationFiche {
  const moteur = saisieDepuisVolume(p.volume);
  const modifie = !egales(s, moteur);
  const visesBrut = p.programme?.logements ?? p.volume.kpi?.unitesVisees ?? null;
  const vises = visesBrut !== null && visesBrut > 0 ? Math.round(visesBrut) : null;
  const surface = p.volume.surfaceParcelleM2;
  const sdpParLogement = HYPOTHESES_VOLUME.sdpParLogementM2;
  const k = new Map<number, Cadre>();
  const cadreDe = (angleDeg: number) => { const cle = Math.round(angleDeg * 10); if (!k.has(cle)) k.set(cle, cadre(p.volume.contour, angleDeg)); return k.get(cle)!; };

  const bruts = s.corps.map(c => {
    const pieces = piecesDe(c);
    const empriseM2 = pieces.reduce((x, r) => x + r.lu * r.lv, 0);
    const sdpM2 = pieces.reduce((x, r) => x + r.lu * r.lv * r.niveaux, 0);
    return { c, pieces, empriseM2, sdpM2, capacite: sdpM2 / sdpParLogement };
  });
  const sdpTotal = bruts.reduce((x, b) => x + b.sdpM2, 0);
  // Capacité de l'ensemble (comme le moteur) : SDP totale / 70 m², arrondie à l'unité inférieure.
  const capacite = Math.floor(sdpTotal / sdpParLogement + 1e-9);
  const empriseTotal = bruts.reduce((x, b) => x + b.empriseM2, 0);
  const placesTotal = modifie ? (vises !== null ? Math.min(capacite, vises) : capacite) : (p.volume.logementsEstimes ?? capacite);
  const repartis = modifie ? repartir(placesTotal, bruts.map(b => b.capacite))
    : (p.volume.batiments && p.volume.batiments.length > 1 ? p.volume.batiments.map(b => b.unites) : [placesTotal]);

  const corps: CorpsEvalue[] = bruts.map((b, i) => {
    const c = b.c;
    const forme = c.formeMoteur && !COLLECTIF.includes(c.formeMoteur) ? c.formeMoteur : c.ailes ? 'barre' : estPlot(c.longueurM, c.largeurM) ? 'plot' : 'barre';
    const radical = c.formeAiles ? `Immeuble ${NOMS_FORME_AILES[c.formeAiles]}` : NOMS[forme];
    const nom = !modifie ? c.nom : COLLECTIF.includes(forme)
      ? `${radical}${c.formeAiles && s.corps.length === 1 ? '' : ` ${String.fromCharCode(65 + i)}`} — ${repartis[i]} logement${repartis[i] > 1 ? 's' : ''} ${libelleNiveaux(c.niveaux)}`
      : c.nom.replace(/R\+\d+/, libelleNiveaux(c.niveaux));
    const kd = cadreDe(c.angleDeg);
    const ailesEvaluees: AileEvaluee[] | null = c.ailes ? b.pieces.map((r): AileEvaluee => {
      const centre = versLocal(c.centre, c.angleDeg, { u: r.du, v: r.dv });
      const a = c.ailes![r.index];
      return {
        ...r, longueurM: a.longueurM, largeurM: a.largeurM, centre, coins: coinsRect(c.centre, c.angleDeg, r),
        empriseM2: r.lu * r.lv, sdpM2: r.lu * r.lv * r.niveaux, hauteurMoteurM: r.niveaux * HYPOTHESES_VOLUME.hauteurEtageM,
        hauteurStudioM: hauteurCorps(r.niveaux, false), reculReelM: reculReel(kd, { centre, longueurM: r.lu, largeurM: r.lv }),
      };
    }) : null;
    const contours = c.ailes ? contourRects(b.pieces).map(l => l.map(q => versLocal(c.centre, c.angleDeg, q))) : [coinsDe(c)];
    return {
      ...c, nom, formeMoteur: forme, coins: coinsDe(c), empriseM2: b.empriseM2, sdpM2: b.sdpM2,
      hauteurMoteurM: c.niveaux * HYPOTHESES_VOLUME.hauteurEtageM,
      hauteurStudioM: hauteurCorps(c.niveaux, false), hauteurStudioAttiqueM: hauteurCorps(c.niveaux, true),
      reculReelM: !modifie ? p.volume.reculM : ailesEvaluees ? Math.min(...ailesEvaluees.map(a => a.reculReelM)) : reculReel(kd, c),
      logements: repartis[i] ?? 0,
      ailesEvaluees, contours, facadeM: Math.round(perimetre(contours) * 10) / 10,
    };
  });

  const alertes: string[] = [];
  const reculMinM = corps.length ? Math.min(...corps.map(c => c.reculReelM)) : 0;
  const court = (c: CorpsEvalue) => c.nom.split(' —')[0];
  if (modifie) {
    for (const c of corps) {
      if (c.reculReelM === 0) {
        const ailes = c.ailesEvaluees?.filter(a => a.reculReelM === 0).map(a => a.nom) ?? [];
        alertes.push(`${c.nom} déborde de la parcelle ou touche une limite${ailes.length && ailes.length < (c.ailesEvaluees?.length ?? 0) ? ` (${ailes.join(', ')})` : ''}.`);
      }
      // Cour et U : façades d'un même bâtiment en vis-à-vis (hypothèse du moteur, pas une règle PLU).
      if (c.formeAiles && c.ailes) for (const va of visAVisInterieurs(c.formeAiles, c.ailes)) {
        const ecart = ecartFacadesMoteur(va.niveaux);
        if (va.distanceM + 1e-6 < ecart) alertes.push(`${court(c)} : ${fr(va.distanceM, 1)} m ${va.libelle} — moins que l’écart entre façades supposé par le moteur (${fr(ecart, 1)} m : leur hauteur, 8 m au moins). Hypothèse du moteur, aucune règle PLU de prospect entre façades d’un même bâtiment n’est connue : à vérifier.`);
      }
    }
    // Chevauchements et écarts entre bâtiments (même orientation) : hypothèses du moteur, pas des règles PLU.
    for (let i = 0; i < corps.length; i++) for (let j = i + 1; j < corps.length; j++) {
      const a = corps[i], b = corps[j];
      const da = ((a.angleDeg - b.angleDeg) % 180 + 180) % 180;
      if (Math.min(da, 180 - da) > 0.5) continue;
      const ang = a.angleDeg * Math.PI / 180;
      const n = Math.max(a.niveaux, b.niveaux);
      if (a.ailesEvaluees || b.ailesEvaluees) {
        // Lot formes-batiment : aile par aile.
        const pa = a.ailesEvaluees ?? [{ centre: a.centre, lu: a.longueurM, lv: a.largeurM }], pb = b.ailesEvaluees ?? [{ centre: b.centre, lu: b.longueurM, lv: b.largeurM }];
        let chevauche = false, dmin = Infinity;
        for (const x of pa) for (const y of pb) {
          const qx = tourner(x.centre, ang), qy = tourner(y.centre, ang);
          const gu = Math.abs(qx.x - qy.x) - (x.lu + y.lu) / 2, gv = Math.abs(qx.y - qy.y) - (x.lv + y.lv) / 2;
          if (gu < -1e-6 && gv < -1e-6) chevauche = true;
          dmin = Math.min(dmin, Math.max(gu, gv, 0) === 0 ? 0 : Math.hypot(Math.max(gu, 0), Math.max(gv, 0)));
        }
        if (chevauche) alertes.push(`${court(a)} et ${court(b)} se chevauchent.`);
        else if (dmin + 1e-6 < ecartFacadesMoteur(n)) alertes.push(`${fr(dmin, 1)} m entre ${court(a)} et ${court(b)} : moins que l’écart supposé par le moteur (${fr(ecartFacadesMoteur(n), 1)} m) — hypothèse du moteur, à vérifier.`);
        continue;
      }
      const pa = tourner(a.centre, ang), pb = tourner(b.centre, ang);
      const gapU = Math.abs(pa.x - pb.x) - (a.longueurM + b.longueurM) / 2;
      const gapV = Math.abs(pa.y - pb.y) - (a.largeurM + b.largeurM) / 2;
      if (gapU < -1e-6 && gapV < -1e-6) alertes.push(`${a.nom.split(' —')[0]} et ${b.nom.split(' —')[0]} se chevauchent.`);
      else if (gapU < -1e-6 && gapV + 1e-6 < ecartFacadesMoteur(n)) alertes.push(`${fr(Math.max(0, gapV), 1)} m entre les façades de ${a.nom.split(' —')[0]} et ${b.nom.split(' —')[0]} : moins que l’écart supposé par le moteur (${fr(ecartFacadesMoteur(n), 1)} m, sa hauteur et 8 m au moins) — hypothèse du moteur, à vérifier.`);
      else if (gapV < -1e-6 && gapU + 1e-6 < Math.max(n * HYPOTHESES_VOLUME.hauteurEtageM / 2, HYPOTHESES_PROGRAMME.distancePignonsMinM)) alertes.push(`${fr(Math.max(0, gapU), 1)} m entre les pignons de ${a.nom.split(' —')[0]} et ${b.nom.split(' —')[0]} : moins que l’écart supposé par le moteur — à vérifier.`);
    }
    if (vises !== null && capacite < vises) alertes.push(`Programme non atteint : ${capacite} logement${capacite > 1 ? 's' : ''} possibles pour ${vises} visés (${fr(sdpParLogement)} m² de SDP par logement).`);
  } else alertes.push(...p.volume.alertes);

  // Volume complet, même forme que celui du moteur (aperçu, ouverture dans le Studio, vérifications).
  const nMax = Math.max(1, ...corps.map(c => c.niveaux));
  const principal = corps.length ? corps.reduce((a, b) => (b.empriseM2 > a.empriseM2 ? b : a)) : null;
  const avecAiles = corps.some(c => c.ailesEvaluees);
  const ailesPropose = (c: CorpsEvalue): AilePropose[] | undefined => c.ailesEvaluees?.map(a => ({
    nom: a.nom, longueurM: a.longueurM, epaisseurM: a.largeurM, niveaux: a.niveaux, du: a.du, dv: a.dv, lu: a.lu, lv: a.lv,
    coins: a.coins, surfaceM2: Math.round(a.empriseM2), sdpM2: Math.round(a.sdpM2),
  }));
  const batiments: BatimentPropose[] | undefined = corps.length > 1 || avecAiles ? corps.map(c => ({
    id: c.id, nom: c.nom, forme: c.formeMoteur ?? 'barre', largeurM: r2(c.longueurM), profondeurM: r2(c.largeurM), niveaux: c.niveaux,
    hauteurM: c.hauteurMoteurM, surfaceM2: Math.round(c.empriseM2), sdpM2: Math.round(c.sdpM2), unites: c.logements,
    uniteLibelle: 'logement', centre: c.centre, centreWgs84: versWgs84(c.centre, p.volume.origine), angleDeg: c.angleDeg, coins: c.coins,
    ...(c.ailesEvaluees && c.formeAiles ? { ailes: ailesPropose(c), formeAiles: c.formeAiles, ...(c.formeAiles === 'redans' ? { decalageM: c.decalageM ?? 0 } : {}) } : {}),
  })) : undefined;
  const volume: VolumePropose = !modifie ? p.volume : {
    ...p.volume,
    emprise: principal ? {
      largeurM: r2(principal.longueurM), profondeurM: r2(principal.largeurM), surfaceM2: Math.round(principal.empriseM2),
      centre: principal.centre, centreWgs84: versWgs84(principal.centre, p.volume.origine), angleDeg: principal.angleDeg, coins: principal.coins,
    } : null,
    niveaux: nMax, hauteurM: nMax * HYPOTHESES_VOLUME.hauteurEtageM, sdpM2: Math.round(sdpTotal),
    logementsEstimes: placesTotal, programmeAtteint: vises !== null ? capacite >= vises : null,
    reculM: reculMinM, alertes, batiments, voies: undefined,
    kpi: batiments ? {
      batiments: batiments.length, unites: placesTotal, unitesVisees: vises, maisons: 0, logements: placesTotal, lits: 0,
      empriseTotaleM2: Math.round(empriseTotal), sdpTotaleM2: Math.round(sdpTotal), voirieM2: 0,
      ratioEmprise: surface > 0 ? Math.round(empriseTotal / surface * 1000) / 1000 : 0,
    } : undefined,
  };
  const controles = controlerVolume(volume, p.regles, volume.logementsEstimes ?? vises);
  return {
    modifie, forme: s.forme, corps, sdpM2: Math.round(modifie ? sdpTotal : p.volume.sdpM2), empriseM2: Math.round(empriseTotal),
    empriseRatio: surface > 0 ? empriseTotal / surface : 0, surfaceParcelleM2: surface,
    capaciteLogements: capacite, logementsVises: vises, logementsPlaces: placesTotal, reculMinM,
    controles, hauteurStudio: controleHauteurStudio(corps, p.regles, attique), alertes, volume,
  };
}

/**
 * Hauteur DESSINÉE par le Studio (cotes réelles, attique compris si choisi) confrontée à la hauteur
 * maximale de la conception. Même principe que controlerVolume : « dans la limite de la règle citée »
 * seulement pour une règle confirmée, citée et sans condition complémentaire ; sinon « à vérifier ».
 */
export function controleHauteurStudio(corps: readonly CorpsEvalue[], regles: readonly RegleLue[], attique: boolean): ControleHauteurStudio | null {
  if (!corps.length) return null;
  const h = Math.max(...corps.map(c => (attique ? c.hauteurStudioAttiqueM : c.hauteurStudioM)));
  const r = regles.find(x => x.cle === 'hauteur_max_m' && x.statut !== 'manquant' && typeof x.valeur === 'number' && Number.isFinite(x.valeur));
  const dessin = `Hauteur dessinée par le Studio : ${fr(h, 2)} m${attique ? ' (attique compris)' : ''}`;
  if (!r) return { verdict: 'non_controle', texte: `${dessin} ; hauteur maximale inconnue : non contrôlée.` };
  const v = r.valeur as number;
  const regle = `${fr(v, 1)} m max. (${r.source}${r.article ? `, ${r.article}` : ''})`;
  if (h > v + 1e-9) return { verdict: 'au_dela', texte: `${dessin} : au-delà de la règle (${regle}).` };
  const sure = regleCitee(r) && !r.regle_relative;
  return {
    verdict: sure ? 'dans_la_limite' : 'a_verifier',
    texte: sure ? `${dessin} : dans la limite de la règle citée (${regle}).`
      : `${dessin} pour ${regle} : à vérifier.${r.regle_relative ? ` Condition complémentaire non vérifiée : ${r.regle_relative}.` : ''}`,
  };
}

// ── Programme : le moteur gagne ───────────────────────────────────────────────
/** Gabarits distincts (« R+2 », « R+2 et R+4 »). */
export function gabarits(ev: Pick<EvaluationFiche, 'corps'>): string {
  const g = [...new Set(ev.corps.map(c => libelleNiveaux(c.niveaux)))];
  return g.length > 1 ? `${g.slice(0, -1).join(', ')} et ${g[g.length - 1]}` : g[0] ?? '';
}

/** Ligne « Programme » de la fiche, écrite depuis le moteur. */
export function programmeMoteur(ev: EvaluationFiche): string {
  const n = ev.corps.length;
  return [
    ev.logementsVises !== null ? `${ev.logementsVises} logements visés` : null,
    `${n} bâtiment${n > 1 ? 's' : ''} en ${gabarits(ev)}`,
    `SDP ≈ ${fr(ev.sdpM2)} m² (estimée)`,
    `${ev.logementsPlaces} logement${ev.logementsPlaces > 1 ? 's' : ''} placé${ev.logementsPlaces > 1 ? 's' : ''}`,
  ].filter((x): x is string => !!x).join(' · ');
}

export interface EcartProgramme { libelle: string; modele: string; moteur: string }

const nombreFr = (t: string) => Number(t.replace(/[\s\u00a0\u202f.]/g, '').replace(',', '.'));

/**
 * Chiffres du texte du modèle (programme, dimensions) qui divergent du moteur. Le moteur gagne ;
 * chaque écart est affiché. La SHAB n'est pas calculée par le moteur : signalée comme telle.
 */
export function ecartsProgramme(texte: string | null | undefined, ev: EvaluationFiche): EcartProgramme[] {
  if (!texte) return [];
  const t = texte.normalize('NFC');
  const out: EcartProgramme[] = [];
  const rn = [...t.matchAll(/\bR\s*\+\s*(\d{1,2})\b/gi)].map(m => `R+${m[1]}`);
  const g = gabarits(ev);
  const rnDiff = [...new Set(rn)].filter(x => !g.split(/, | et /).includes(x));
  if (rnDiff.length) out.push({ libelle: 'Gabarit', modele: [...new Set(rn)].join(', '), moteur: g });
  const sdp = /\bSDP\b[^\d]{0,12}(\d[\d\s\u00a0\u202f.]*(?:,\d+)?)\s*m(?:²|2)/i.exec(t);
  if (sdp) {
    const v = nombreFr(sdp[1]);
    if (Number.isFinite(v) && Math.abs(v - ev.sdpM2) > Math.max(20, ev.sdpM2 * 0.02)) out.push({ libelle: 'Surface de plancher', modele: `≈ ${fr(v)} m²`, moteur: `≈ ${fr(ev.sdpM2)} m²` });
  }
  const shab = /\bSHAB\b[^\d]{0,12}(\d[\d\s\u00a0\u202f.]*(?:,\d+)?)\s*m(?:²|2)/i.exec(t);
  if (shab) out.push({ libelle: 'Surface habitable', modele: `≈ ${fr(nombreFr(shab[1]))} m²`, moteur: 'non calculée par le moteur' });
  const lg = /\b(\d{1,4})\s+logements?\b/i.exec(t);
  const reference = ev.logementsVises ?? ev.logementsPlaces;
  if (lg && Number(lg[1]) !== reference) out.push({ libelle: 'Logements', modele: lg[1], moteur: String(reference) });
  const m2 = !sdp && !shab ? /(\d[\d\s\u00a0\u202f.]*(?:,\d+)?)\s*m(?:²|2)\b/i.exec(t) : null;
  if (m2) {
    const v = nombreFr(m2[1]);
    if (Number.isFinite(v) && Math.abs(v - ev.sdpM2) > Math.max(20, ev.sdpM2 * 0.02) && Math.abs(v - ev.empriseM2) > Math.max(20, ev.empriseM2 * 0.02)) {
      out.push({ libelle: 'Surface', modele: `${fr(v)} m²`, moteur: `emprise ≈ ${fr(ev.empriseM2)} m², SDP ≈ ${fr(ev.sdpM2)} m²` });
    }
  }
  return out;
}

// ── Aperçu (carte « Brief créatif ») et schéma coté (SVG) ───────────────────────
/** Corps de l'aperçu 3D du brief : mêmes arrondis que apercuVolume (serveur). */
export function apercuDepuisEvaluation(ev: Pick<EvaluationFiche, 'corps' | 'volume'>): ApercuVolume {
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const brut = ev.volume.contour;
  const pas = Math.max(1, Math.ceil(brut.length / 48));
  const contour = brut.length >= 3 ? brut.filter((_, i) => i % pas === 0).slice(0, 48).map(q => [r1(q.x), r1(q.y)] as [number, number]) : null;
  // Lot formes-batiment : un bâtiment à ailes devient une boîte par aile (côtés accolés marqués `int` :
  // ni fenêtres ni retrait d'attique sur ces faces, comme le Studio qui ne dessine que les façades extérieures).
  const boites = ev.corps.flatMap(c => boitesApercu({ centre: c.centre, angleDeg: c.angleDeg, largeurM: c.longueurM, profondeurM: c.largeurM,
    niveaux: c.niveaux, ailes: c.ailesEvaluees, formeAiles: c.formeAiles ?? null }));
  return {
    corps: boites.slice(0, 12),
    contour: contour && contour.length >= 3 ? contour : null,
  };
}

export interface CoteSvg { x1: number; y1: number; x2: number; y2: number; tx: number; ty: number; texte: string }
export interface SchemaForme {
  /** viewBox SVG (mètres ; y vers le bas = sud). */
  vue: { x: number; y: number; w: number; h: number };
  parcelle: string;
  corps: {
    points: string; etiquette: string; ex: number; ey: number; cotes: CoteSvg[];
    /** Lot formes-batiment : contour réel (chemin SVG, cours comprises, règle evenodd) ; ailes étiquetées. */
    trace: string;
    ailes: { etiquette: string; ex: number; ey: number; texte: string }[];
  }[];
}

/** Lot formes-batiment : cotes hors tout d'un bâtiment à ailes (segments du repère du bâtiment). */
function cotesForme(c: CorpsEvalue): { a: { u: number; v: number }; b: { u: number; v: number }; texte: string }[] {
  const ae = c.ailesEvaluees!;
  const Lu = c.longueurM, Lv = c.largeurM;
  const m = (x: number) => `${fr(x, 1)} m`;
  const bas = (u0: number, u1: number, v: number, t: string) => ({ a: { u: u0, v }, b: { u: u1, v }, texte: t });
  const cote = (u: number, v0: number, v1: number, t: string) => ({ a: { u, v: v0 }, b: { u, v: v1 }, texte: t });
  if (c.formeAiles === 'redans') return ae.map(a => bas(a.du - a.lu / 2, a.du + a.lu / 2, a.dv - a.lv / 2, m(a.longueurM)));
  const out = [bas(-Lu / 2, Lu / 2, -Lv / 2, m(ae[0].longueurM)), cote(-Lu / 2, -Lv / 2, -Lv / 2 + (c.formeAiles === 'cour' ? Lv : ae[1].longueurM), m(ae[1].longueurM))];
  if (c.formeAiles === 'u') out.push(cote(Lu / 2, -Lv / 2, -Lv / 2 + ae[2].longueurM, m(ae[2].longueurM)));
  return out;
}

/** Plan coté : parcelle, bâtiments, longueur et largeur de chacun (repère SVG : y = −nord). */
export function schemaForme(ev: Pick<EvaluationFiche, 'corps' | 'volume'>): SchemaForme {
  const pt = (p: PointLocal) => ({ x: p.x, y: -p.y });
  const pts = [...ev.volume.contour.map(pt), ...ev.corps.flatMap(c => c.coins.map(pt))];
  const xs = pts.map(q => q.x), ys = pts.map(q => q.y);
  const marge = 6;
  const vue = pts.length
    ? { x: Math.min(...xs) - marge, y: Math.min(...ys) - marge, w: Math.max(...xs) - Math.min(...xs) + 2 * marge, h: Math.max(...ys) - Math.min(...ys) + 2 * marge }
    : { x: -10, y: -10, w: 20, h: 20 };
  const f = (n: number) => Math.round(n * 100) / 100;
  const corps = ev.corps.map((c, i) => {
    const k = c.coins.map(pt);
    const ctr = pt(c.centre);
    const cote = (a: { x: number; y: number }, b: { x: number; y: number }, texte: string): CoteSvg => {
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const dx = mx - ctr.x, dy = my - ctr.y, l = Math.hypot(dx, dy) || 1;
      const o = 2.2;
      const ox = dx / l * o, oy = dy / l * o;
      return { x1: f(a.x + ox), y1: f(a.y + oy), x2: f(b.x + ox), y2: f(b.y + oy), tx: f(mx + ox * 2.1), ty: f(my + oy * 2.1), texte };
    };
    const contours = c.contours.map(l => l.map(pt));
    const trace = contours.map(l => `M${l.map(q => `${f(q.x)},${f(q.y)}`).join('L')}Z`).join('');
    if (c.ailesEvaluees) {
      const ptUV = (q: { u: number; v: number }) => pt(versLocal(c.centre, c.angleDeg, q));
      return {
        points: contours[0].map(q => `${f(q.x)},${f(q.y)}`).join(' '), trace,
        etiquette: String.fromCharCode(65 + i), ex: f(ctr.x), ey: f(ctr.y),
        cotes: cotesForme(c).map(x => cote(ptUV(x.a), ptUV(x.b), x.texte)),
        ailes: c.ailesEvaluees.map(a => { const q = pt(a.centre); return { etiquette: `${String.fromCharCode(65 + i)}${a.index + 1}`, ex: f(q.x), ey: f(q.y), texte: `ép. ${fr(a.largeurM, 1)} m · ${libelleNiveaux(a.niveaux)}` }; }),
      };
    }
    return {
      points: k.map(q => `${f(q.x)},${f(q.y)}`).join(' '), trace,
      etiquette: String.fromCharCode(65 + i),
      ex: f(ctr.x), ey: f(ctr.y),
      cotes: [cote(k[0], k[1], `${fr(c.longueurM, 1)} m`), cote(k[1], k[2], `${fr(c.largeurM, 1)} m`)],
      ailes: [],
    };
  });
  return { vue: { x: f(vue.x), y: f(vue.y), w: f(vue.w), h: f(vue.h) }, parcelle: ev.volume.contour.map(q => `${f(q.x)},${f(-q.y)}`).join(' '), corps };
}

// ── Lot formes-batiment : comparaison des formes par le moteur (suggestion de Mimmo) ─────────
export interface FormeComparee {
  forme: Forme;
  libelle: string;
  /** null : la forme ne tient pas (raison donnée). */
  ev: EvaluationFiche | null;
  saisie: SaisieDimensions | null;
  raison: string | null;
  /** Aucune vérification « au-delà », aucun débord ni chevauchement. */
  dansLesRegles: boolean;
  logements: number;
  niveaux: number;
  sdpM2: number;
  empriseM2: number;
  facadeM: number;
  /** Alertes du moteur (hypothèses : écarts entre façades, programme non atteint…). */
  alertes: number;
}

/**
 * Compare les formes disponibles avec le moteur, depuis le volume du moteur : chaque forme est placée
 * (plots, L, U, cour, redans : formesBatiment.placerForme ; barre, barres, plot : transformation
 * déterministe du volume) puis évaluée (SDP, logements, emprise, vérifications). Classement :
 *   1. dans les règles (aucun verdict « au-delà », aucun débord ni chevauchement) ;
 *   2. logements placés (plafonnés au programme visé) ;
 *   3. moins de niveaux (moins de hauteur pour le même programme) ;
 *   4. moins de linéaire de façade (même surface, enveloppe plus compacte) ;
 *   5. moins d'emprise au sol ; 6. moins d'alertes du moteur.
 * C'est une SUGGESTION : l'utilisateur choisit ; rien n'est présenté comme conforme.
 */
export function comparerFormes(p: PreparationFiche, attique = false): FormeComparee[] {
  const base = saisieDepuisVolume(p.volume);
  if (base.forme === 'moteur') return [];
  const liste = FORMES.filter(f => f.disponible).map((f): FormeComparee => {
    const r = f.valeur === base.forme ? { saisie: base, raison: null } : appliquerFormeDetail(p, base, f.valeur);
    if (r.raison || (r.saisie === base && f.valeur !== base.forme)) {
      return { forme: f.valeur, libelle: f.libelle, ev: null, saisie: null, raison: r.raison ?? 'Forme non calculable ici.', dansLesRegles: false, logements: 0, niveaux: 0, sdpM2: 0, empriseM2: 0, facadeM: 0, alertes: 0 };
    }
    const ev = evaluerSaisie(p, r.saisie, attique);
    const regles = !ev.controles.some(c => c.verdict === 'au_dela') && !ev.alertes.some(a => /déborde|chevauchent/.test(a));
    return {
      forme: f.valeur, libelle: f.libelle, ev, saisie: r.saisie, raison: null, dansLesRegles: regles,
      logements: ev.logementsPlaces, niveaux: Math.max(...ev.corps.map(c => c.niveaux)), sdpM2: ev.sdpM2, empriseM2: ev.empriseM2,
      facadeM: Math.round(ev.corps.reduce((x, c) => x + c.facadeM, 0)), alertes: ev.alertes.length,
    };
  });
  const cle = (x: FormeComparee) => [x.ev ? 0 : 1, x.dansLesRegles ? 0 : 1, -x.logements, x.niveaux, x.facadeM, x.empriseM2, x.alertes];
  return liste.map((x, i) => ({ x, i })).sort((a, b) => {
    const ka = cle(a.x), kb = cle(b.x);
    for (let k = 0; k < ka.length; k++) if (Math.abs(ka[k] - kb[k]) > 1e-6) return ka[k] - kb[k];
    return a.i - b.i;
  }).map(e => e.x);
}

/** Phrase de la suggestion (forme en tête du classement). */
export function phraseSuggestion(c: readonly FormeComparee[]): string | null {
  const t = c[0];
  if (!t?.ev) return null;
  const n = libelleNiveaux(t.niveaux);
  return `${t.libelle} : ${t.logements} logement${t.logements > 1 ? 's' : ''}${t.ev.logementsVises !== null ? ` / ${t.ev.logementsVises} visés` : ''}, ${n}, SDP ≈ ${fr(t.sdpM2)} m², emprise ${fr(t.empriseM2)} m², ${fr(t.facadeM)} m de façade${t.dansLesRegles ? '' : ' — au moins une vérification au-delà de la règle'}.`;
}

// ── Lot formes-batiment : forme choisie dans la fiche → préparation 3D du serveur ──────────────
/**
 * Bloc ```mimmoza-forme``` envoyé par la fiche (« Préparer la 3D avec cette forme ») : la forme et les
 * dimensions SAISIES (centre, orientation, ailes), jamais les chiffres calculés. Le serveur
 * (copilot-chat/agent/studio.ts, outil studio_preparer_3d) les relit avec `saisieDepuisBloc` et les
 * RÉÉVALUE avec ce même moteur sur sa propre préparation : la fiche ne peut imposer aucun résultat.
 */
export const FORME_BLOC_LANGUE = 'mimmoza-forme';
export const FORME_BLOC_VERSION = 1;

export interface BlocForme {
  v: typeof FORME_BLOC_VERSION;
  forme: Forme;
  corps: { centre: PointLocal; angleDeg: number; longueurM: number; largeurM: number; niveaux: number; ailes?: { longueurM: number; largeurM: number; niveaux: number }[]; decalageM?: number }[];
}

export function blocForme(s: SaisieDimensions): BlocForme | null {
  if (s.forme === 'moteur' || !s.corps.length) return null;
  const r = (x: number) => Math.round(x * 100) / 100;
  return {
    v: FORME_BLOC_VERSION, forme: s.forme,
    corps: s.corps.map(c => ({
      centre: { x: r(c.centre.x), y: r(c.centre.y) }, angleDeg: r(c.angleDeg), longueurM: c.longueurM, largeurM: c.largeurM, niveaux: c.niveaux,
      ...(c.ailes ? { ailes: c.ailes.map(a => ({ longueurM: a.longueurM, largeurM: a.largeurM, niveaux: a.niveaux })), ...(c.formeAiles === 'redans' ? { decalageM: c.decalageM ?? 0 } : {}) } : {}),
    })),
  };
}

/** Texte du message de la fiche : une phrase lisible + le bloc. */
export function messageForme(s: SaisieDimensions, ev: Pick<EvaluationFiche, 'logementsPlaces' | 'sdpM2'>): string | null {
  const b = blocForme(s);
  if (!b) return null;
  const f = FORMES.find(x => x.valeur === b.forme)?.libelle ?? b.forme;
  const dims = s.corps.map(c => c.ailes
    ? c.ailes.map(a => `${a.nom} ${fr(a.longueurM, 1)} × ${fr(a.largeurM, 1)} m ${libelleNiveaux(a.niveaux)}`).join(', ')
    : `${fr(c.longueurM, 1)} × ${fr(c.largeurM, 1)} m ${libelleNiveaux(c.niveaux)}`).join(' ; ');
  return `Prépare la 3D avec la forme choisie dans la fiche : ${f.charAt(0).toLowerCase()}${f.slice(1)} (${dims}) — ${ev.logementsPlaces} logements, SDP ≈ ${fr(ev.sdpM2)} m² selon le moteur.\n\`\`\`${FORME_BLOC_LANGUE}\n${JSON.stringify(b)}\n\`\`\``;
}

/** Bloc relu SANS confiance → saisie (bornée, normalisée) ; erreur lisible sinon. */
export function saisieDepuisBloc(brut: unknown): { ok: true; saisie: SaisieDimensions } | { ok: false; erreur: string } {
  const o = brut as Record<string, unknown> | null;
  if (!o || typeof o !== 'object' || Array.isArray(o) || o.v !== FORME_BLOC_VERSION) return { ok: false, erreur: 'Bloc de forme d’une version inconnue.' };
  const inconnue = Object.keys(o).find(k => !['v', 'forme', 'corps'].includes(k));
  if (inconnue) return { ok: false, erreur: `Bloc de forme : champ inconnu ${inconnue}.` };
  const forme = FORMES.find(f => f.valeur === o.forme && f.disponible)?.valeur;
  if (!forme) return { ok: false, erreur: 'Bloc de forme : forme inconnue ou indisponible.' };
  const corpsBrut = Array.isArray(o.corps) ? o.corps : null;
  if (!corpsBrut || corpsBrut.length < 1 || corpsBrut.length > LIMITE_CORPS_BLOC) return { ok: false, erreur: 'Bloc de forme : 1 à 12 bâtiments.' };
  const fini = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const corps: CorpsSaisi[] = [];
  for (const [i, c] of corpsBrut.entries()) {
    const k = c as Record<string, unknown>;
    const ctr = k?.centre as Record<string, unknown> | undefined;
    if (!k || typeof k !== 'object' || !ctr || !fini(ctr.x) || !fini(ctr.y) || Math.abs(ctr.x) > 2000 || Math.abs(ctr.y) > 2000 || !fini(k.angleDeg) || Math.abs(k.angleDeg) > 720) {
      return { ok: false, erreur: `Bloc de forme : bâtiment ${i + 1} illisible.` };
    }
    const lg = bornerValeur('longueurM', k.longueurM as number), la = bornerValeur('largeurM', k.largeurM as number), nv = bornerValeur('niveaux', k.niveaux as number);
    if (lg === null || la === null || nv === null) return { ok: false, erreur: `Bloc de forme : dimensions du bâtiment ${i + 1} illisibles.` };
    const base: CorpsSaisi = {
      id: `fiche-${forme}-${i + 1}`, nom: `${forme === 'plots' || forme === 'plot' ? 'Plot' : estFormeAiles(forme) ? NOM_PLACE[forme] : 'Barre'} ${String.fromCharCode(65 + i)}`,
      longueurM: lg, largeurM: la, niveaux: nv, centre: { x: ctr.x, y: ctr.y }, angleDeg: k.angleDeg, formeMoteur: forme === 'plot' || forme === 'plots' ? 'plot' : 'barre',
    };
    if (estFormeAiles(forme)) {
      const ab = Array.isArray(k.ailes) ? k.ailes : null;
      const attendu = forme === 'redans' ? (ab?.length === 2 || ab?.length === 3) : ab?.length === NB_AILES_FORME[forme];
      if (!ab || !attendu) return { ok: false, erreur: `Bloc de forme : ${forme === 'redans' ? '2 ou 3' : NB_AILES_FORME[forme]} ailes attendues.` };
      const ailes: AileSaisie[] = [];
      for (const [j, a] of ab.entries()) {
        const x = a as Record<string, unknown>;
        const al = bornerValeur('longueurM', x?.longueurM as number), ae = bornerValeur('largeurM', x?.largeurM as number), an = bornerValeur('niveaux', x?.niveaux as number);
        if (al === null || ae === null || an === null) return { ok: false, erreur: `Bloc de forme : aile ${j + 1} illisible.` };
        ailes.push({ nom: `Aile ${String.fromCharCode(65 + j)}`, longueurM: al, largeurM: ae, niveaux: an });
      }
      corps.push(avecEnveloppe({ ...base, ailes, formeAiles: forme, decalageM: fini(k.decalageM) ? k.decalageM : 0 }));
    } else if (k.ailes !== undefined) return { ok: false, erreur: 'Bloc de forme : ailes inattendues pour cette forme.' };
    else corps.push(base);
  }
  if (estFormeAiles(forme) && corps.length !== 1) return { ok: false, erreur: 'Bloc de forme : un seul bâtiment à ailes.' };
  return { ok: true, saisie: { forme, corps } };
}
const LIMITE_CORPS_BLOC = 12;
const NB_AILES_FORME: Record<FormeAiles, number> = { l: 2, u: 3, cour: 4, redans: 3 };
