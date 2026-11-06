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
// sont sélectionnables (barre, barres parallèles, plot : rectangles du contrat v2,
// `batiments`). L, U et cour fermée existent dans le Studio (archétypes l_shape,
// u_shape, courtyard_block) mais ni le moteur de volume ni ses vérifications ne les
// calculent : « bientôt ».
//
// Jamais « conforme » : verdicts de controlerVolume (« dans la limite de la règle
// citée » seulement pour une règle confirmée et citée), sinon « à vérifier ».
// =============================================================================

import { hauteurCorps, type ApercuVolume } from './briefCreatif.ts';
import { controlerVolume, regleCitee, type ControleVolume, type RegleLue } from './controlesVolume.ts';
import { HYPOTHESES_PROGRAMME } from './implantationProgramme.ts';
import {
  corpsAffiches, HYPOTHESES_VOLUME, libelleNiveaux, rectTient, segmentsDe, versWgs84,
  type BatimentPropose, type FormeBatie, type PointLocal, type ProgrammeVolume, type VolumePropose,
} from './volumeParcelle.ts';

// ── Formes ────────────────────────────────────────────────────────────────────
export type Forme = 'barre' | 'barres' | 'plot' | 'l' | 'u' | 'cour';

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
  { valeur: 'l', libelle: 'En L', detail: 'Bientôt : le calcul du volume et les vérifications ne la traitent pas encore.', disponible: false },
  { valeur: 'u', libelle: 'En U', detail: 'Bientôt : le calcul du volume et les vérifications ne la traitent pas encore.', disponible: false },
  { valeur: 'cour', libelle: 'Cour fermée', detail: 'Bientôt : le calcul du volume et les vérifications ne la traitent pas encore.', disponible: false },
];

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
  }));
  return { forme: formeDuVolume(v), corps };
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
  const corps = s.corps.map((c, i) => (i === index ? { ...c, [champ]: v } : c));
  let forme = s.forme;
  if (corps.length === 1 && (forme === 'barre' || forme === 'plot')) forme = estPlot(corps[0].longueurM, corps[0].largeurM) ? 'plot' : 'barre';
  return { forme, corps };
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
  if (raisonFormeIndisponible(forme, s) || forme === s.forme) return s;
  const moteur = saisieDepuisVolume(p.volume);
  const principal = (() => {
    const i = s.corps.reduce((m, c, k) => (c.longueurM * c.largeurM > s.corps[m].longueurM * s.corps[m].largeurM ? k : m), 0);
    return s.corps[i];
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
function reculReel(k: Cadre, c: CorpsSaisi): number {
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

const egales = (a: SaisieDimensions, b: SaisieDimensions) => a.corps.length === b.corps.length && a.corps.every((c, i) => {
  const d = b.corps[i];
  return Math.abs(c.longueurM - d.longueurM) < 1e-6 && Math.abs(c.largeurM - d.largeurM) < 1e-6 && c.niveaux === d.niveaux
    && Math.abs(c.centre.x - d.centre.x) < 1e-6 && Math.abs(c.centre.y - d.centre.y) < 1e-6 && Math.abs(c.angleDeg - d.angleDeg) < 1e-6;
});

const NOMS: Partial<Record<FormeBatie, string>> = { barre: 'Barre', plot: 'Plot' };

/**
 * Évalue la saisie avec le moteur. Saisie identique au volume du moteur : ses chiffres tels quels
 * (et ses vérifications, recalculées par la même fonction que le serveur → mêmes verdicts).
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
    const empriseM2 = c.longueurM * c.largeurM;
    const sdpM2 = empriseM2 * c.niveaux;
    return { c, empriseM2, sdpM2, capacite: sdpM2 / sdpParLogement };
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
    const forme = c.formeMoteur && !COLLECTIF.includes(c.formeMoteur) ? c.formeMoteur : estPlot(c.longueurM, c.largeurM) ? 'plot' : 'barre';
    const nom = !modifie ? c.nom : COLLECTIF.includes(forme)
      ? `${NOMS[forme]} ${String.fromCharCode(65 + i)} — ${repartis[i]} logement${repartis[i] > 1 ? 's' : ''} ${libelleNiveaux(c.niveaux)}`
      : c.nom.replace(/R\+\d+/, libelleNiveaux(c.niveaux));
    return {
      ...c, nom, formeMoteur: forme, coins: coinsDe(c), empriseM2: b.empriseM2, sdpM2: b.sdpM2,
      hauteurMoteurM: c.niveaux * HYPOTHESES_VOLUME.hauteurEtageM,
      hauteurStudioM: hauteurCorps(c.niveaux, false), hauteurStudioAttiqueM: hauteurCorps(c.niveaux, true),
      reculReelM: modifie ? reculReel(cadreDe(c.angleDeg), c) : p.volume.reculM,
      logements: repartis[i] ?? 0,
    };
  });

  const alertes: string[] = [];
  const reculMinM = corps.length ? Math.min(...corps.map(c => c.reculReelM)) : 0;
  if (modifie) {
    for (const c of corps) if (c.reculReelM === 0) alertes.push(`${c.nom} déborde de la parcelle ou touche une limite.`);
    // Chevauchements et écarts entre bâtiments (même orientation) : hypothèses du moteur, pas des règles PLU.
    for (let i = 0; i < corps.length; i++) for (let j = i + 1; j < corps.length; j++) {
      const a = corps[i], b = corps[j];
      const da = ((a.angleDeg - b.angleDeg) % 180 + 180) % 180;
      if (Math.min(da, 180 - da) > 0.5) continue;
      const ang = a.angleDeg * Math.PI / 180;
      const pa = tourner(a.centre, ang), pb = tourner(b.centre, ang);
      const gapU = Math.abs(pa.x - pb.x) - (a.longueurM + b.longueurM) / 2;
      const gapV = Math.abs(pa.y - pb.y) - (a.largeurM + b.largeurM) / 2;
      const n = Math.max(a.niveaux, b.niveaux);
      if (gapU < -1e-6 && gapV < -1e-6) alertes.push(`${a.nom.split(' —')[0]} et ${b.nom.split(' —')[0]} se chevauchent.`);
      else if (gapU < -1e-6 && gapV + 1e-6 < ecartFacadesMoteur(n)) alertes.push(`${fr(Math.max(0, gapV), 1)} m entre les façades de ${a.nom.split(' —')[0]} et ${b.nom.split(' —')[0]} : moins que l’écart supposé par le moteur (${fr(ecartFacadesMoteur(n), 1)} m, sa hauteur et 8 m au moins) — hypothèse du moteur, à vérifier.`);
      else if (gapV < -1e-6 && gapU + 1e-6 < Math.max(n * HYPOTHESES_VOLUME.hauteurEtageM / 2, HYPOTHESES_PROGRAMME.distancePignonsMinM)) alertes.push(`${fr(Math.max(0, gapU), 1)} m entre les pignons de ${a.nom.split(' —')[0]} et ${b.nom.split(' —')[0]} : moins que l’écart supposé par le moteur — à vérifier.`);
    }
    if (vises !== null && capacite < vises) alertes.push(`Programme non atteint : ${capacite} logement${capacite > 1 ? 's' : ''} possibles pour ${vises} visés (${fr(sdpParLogement)} m² de SDP par logement).`);
  } else alertes.push(...p.volume.alertes);

  // Volume complet, même forme que celui du moteur (aperçu, ouverture dans le Studio, vérifications).
  const nMax = Math.max(1, ...corps.map(c => c.niveaux));
  const principal = corps.length ? corps.reduce((a, b) => (b.empriseM2 > a.empriseM2 ? b : a)) : null;
  const batiments: BatimentPropose[] | undefined = corps.length > 1 ? corps.map(c => ({
    id: c.id, nom: c.nom, forme: c.formeMoteur ?? 'barre', largeurM: r2(c.longueurM), profondeurM: r2(c.largeurM), niveaux: c.niveaux,
    hauteurM: c.hauteurMoteurM, surfaceM2: Math.round(c.empriseM2), sdpM2: Math.round(c.sdpM2), unites: c.logements,
    uniteLibelle: 'logement', centre: c.centre, centreWgs84: versWgs84(c.centre, p.volume.origine), angleDeg: c.angleDeg, coins: c.coins,
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
  return {
    corps: ev.corps.slice(0, 12).map(c => ({ cx: r1(c.centre.x), cy: r1(c.centre.y), l: r1(c.longueurM), p: r1(c.largeurM), a: r1(c.angleDeg), n: c.niveaux })),
    contour: contour && contour.length >= 3 ? contour : null,
  };
}

export interface CoteSvg { x1: number; y1: number; x2: number; y2: number; tx: number; ty: number; texte: string }
export interface SchemaForme {
  /** viewBox SVG (mètres ; y vers le bas = sud). */
  vue: { x: number; y: number; w: number; h: number };
  parcelle: string;
  corps: { points: string; etiquette: string; ex: number; ey: number; cotes: CoteSvg[] }[];
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
    return {
      points: k.map(q => `${f(q.x)},${f(q.y)}`).join(' '),
      etiquette: String.fromCharCode(65 + i),
      ex: f(ctr.x), ey: f(ctr.y),
      cotes: [cote(k[0], k[1], `${fr(c.longueurM, 1)} m`), cote(k[1], k[2], `${fr(c.largeurM, 1)} m`)],
    };
  });
  return { vue: { x: f(vue.x), y: f(vue.y), w: f(vue.w), h: f(vue.h) }, parcelle: ev.volume.contour.map(q => `${f(q.x)},${f(-q.y)}`).join(' '), corps };
}
