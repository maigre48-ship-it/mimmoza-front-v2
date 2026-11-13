// src/spaces/copilot/studio3d/implantationVoieVolume.ts
//
// LOT P9 (13/11/2026) — VOLUME D'ÉTUDE POSÉ AU RECUL SUR VOIE — logique PURE (aucune I/O, aucune IA).
//
// Constat (travail c3584258 / 2f45886a, Montfermeil 930470000P0646) : le moteur du volume d'étude, sans PLU « par
// bande », ne connaît pas le côté voie. Il cherche le plus grand rectangle à 4 m de TOUTES les limites sur une grille
// de centres et réduit ensuite l'emprise AUTOUR DE SON CENTRE pour le programme : le plot de 11 × 16 m restait au
// milieu de la parcelle (centre à 22,7 m de l'alignement, façade avant à 18,5 m de la voie), derrière la maison.
// La façade sur voie était pourtant connue (parcelles voisines conservées dans la conception, lot C7b/P2).
//
// Règle (volume à UN bâtiment rectangulaire, sans bande appliquée, façade sur voie identifiée) :
//   · façade sur voie retenue : la plus longue des limites présumées sur voie ;
//   · recul à la voie : la règle `recul_voie_m` des règles du volume (la plus forte si plusieurs), sinon 4 m SUPPOSÉS
//     (valeur par défaut du volume d'étude), et c'est dit ;
//   · recul aux autres limites : celui du moteur (reculsRetenus.limitesPour(H)) — inchangé ;
//   · le volume garde ses dimensions ; il est posé PARALLÈLE à la voie, dans l'orientation (largeur ou profondeur sur
//     la voie) la plus proche de celle du moteur, façade avant au recul ; s'il n'y tient pas, l'autre orientation ;
//     s'il ne tient dans aucune au recul exact, il est reculé par pas de 0,25 m (le recul est un MINIMUM) ;
//   · glissé le long de la voie au plus près de sa position d'origine ; vérifié par rectTient (moteur) : jamais un
//     sommet hors parcelle, jamais plus près d'une limite que le recul retenu ;
//   · rien ne tient : volume d'origine gardé (il respecte déjà le recul uniforme), statut « impossible », raison dite.
// Idempotent : un volume déjà parallèle à la voie et au recul (à 0,3 m près) est rendu tel quel (« inchangee »).

import {
  HYPOTHESES_VOLUME, dansPolygone, projeterParcelle, rectTient, reculsRetenus, regleValide, segmentsDe, versWgs84,
  volumeParBatiments, type GeometrieParcelle, type PointLocal, type ReglePlu, type ReglesPluVolume, type VolumePropose,
} from './volumeParcelle.ts';
import { marquerSegmentsVoie, type FacadeLocale } from './bandePrincipale.ts';

/** Façade sur voie telle que la fiche la porte (`charge.site.facadesVoie`, contrat photo-rue §2). */
export interface FacadeVoieWgs { debut: readonly number[]; fin: readonly number[] }

export interface PoseVoie {
  statut: 'posee' | 'inchangee' | 'impossible';
  reculVoieM: number;
  reculVoieSuppose: boolean;
  sourceReculVoie: string;
  reculLimitesM: number;
  /** Distance mini (m) de l'emprise aux limites sur voie, avant et après. */
  reculAvantM: number;
  reculApresM: number;
  deplacementM: number;
  /** Limites présumées sur voie, repère local du volume (pour les contrôles : mesurerReculsVolume). */
  facades: FacadeLocale[];
  message: string;
}

export type IssuePoseVoie = { volume: VolumePropose; pose: PoseVoie | null; raison: string | null };

export const RECUL_VOIE_SUPPOSE_M = HYPOTHESES_VOLUME.reculDefautM;
/** Extrémité de façade ramenée sur un sommet du contour à moins de cette distance (façades arrondies à 1e-7°). */
const ACCROCHE_M = 0.15;
const PAS_M = 0.25;
/** Marge ajoutée au recul (5 cm) : la projection locale du site et le Lambert-93 du Studio diffèrent de ~3 cm sur 20 m. */
const MARGE_M = 0.05;
const TOLERANCE_RECUL_M = 0.3;
const M_PAR_DEGRE = 111_320;
const fr = (v: number, d = 1) => v.toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const STATUTS: Record<ReglePlu['statut'], string> = { lue: 'lue dans le règlement', importee: 'règlement importé', estimee: 'estimée, à confirmer' };

const tourner = (p: PointLocal, a: number): PointLocal => ({ x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) });
const ecartAxe = (a: number, b: number) => { const d = Math.abs(((a - b) % Math.PI + Math.PI) % Math.PI); return Math.min(d, Math.PI - d); };

function distPointSegment(p: PointLocal, a: PointLocal, b: PointLocal): number {
  const dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
/** Distance mini d'un rectangle (4 coins) aux segments donnés (rectangle supposé ne pas les couper). */
function distanceRect(coins: readonly PointLocal[], segs: readonly { a: PointLocal; b: PointLocal }[]): number {
  let d = Infinity;
  for (const s of segs) for (let k = 0; k < 4; k++) {
    const p = coins[k], q = coins[(k + 1) % 4];
    d = Math.min(d, distPointSegment(p, s.a, s.b), distPointSegment(q, s.a, s.b), distPointSegment(s.a, p, q), distPointSegment(s.b, p, q));
  }
  return d;
}
/** Coins au sens du moteur (calculerVolume) : largeur le long de `angle`, profondeur perpendiculaire. */
function coinsDe(c: PointLocal, angle: number, largeurM: number, profondeurM: number): PointLocal[] {
  return [[-largeurM / 2, -profondeurM / 2], [largeurM / 2, -profondeurM / 2], [largeurM / 2, profondeurM / 2], [-largeurM / 2, profondeurM / 2]]
    .map(([u, v]) => { const r = tourner({ x: u, y: v }, angle); return { x: c.x + r.x, y: c.y + r.y }; });
}

/** Recul sur voie à retenir : règle `recul_voie_m` (la plus forte), sinon 4 m SUPPOSÉS. */
export function reculVoieDuVolume(regles: ReglesPluVolume): { valeurM: number; suppose: boolean; source: string } {
  const l = (regles.regles ?? []).filter(regleValide).filter((r) => r.cle === 'recul_voie_m');
  if (!l.length) return { valeurM: RECUL_VOIE_SUPPOSE_M, suppose: true, source: `recul de ${fr(RECUL_VOIE_SUPPOSE_M)} m SUPPOSÉ (aucune règle de recul à la voie connue ; valeur par défaut du volume d’étude)` };
  const r = l.reduce((a, b) => (b.valeur > a.valeur ? b : a));
  return { valeurM: r.valeur, suppose: false, source: `recul de ${fr(r.valeur)} m : ${r.source}${r.reference ? `, ${r.reference}` : ''} ; ${STATUTS[r.statut]}` };
}

/** Volume posé au recul sur voie (voir l'en-tête). Ne lève jamais. */
export function poserVolumeSurVoie(v: VolumePropose, geometrie: GeometrieParcelle | null | undefined, facadesWgs: readonly FacadeVoieWgs[] | null | undefined, regles: ReglesPluVolume): IssuePoseVoie {
  const non = (raison: string): IssuePoseVoie => ({ volume: v, pose: null, raison });
  const e = v.emprise;
  if (!e) return non('aucun volume');
  if (volumeParBatiments(v) || (v.batiments?.length ?? 0) > 1) return non('volume à plusieurs bâtiments ou à ailes : non traité (positions du moteur gardées)');
  if (v.bande?.statut === 'appliquee') return non('bande principale déjà appliquée : volume déjà parallèle à la voie');
  const fw = (facadesWgs ?? []).filter((f) => f && f.debut?.length >= 2 && f.fin?.length >= 2 && [f.debut[0], f.debut[1], f.fin[0], f.fin[1]].every(Number.isFinite));
  if (!fw.length) return non('façade sur voie non identifiée');
  const proj = projeterParcelle(geometrie);
  if (!proj || proj.anneaux[0].length < 3) return non('contour cadastral illisible');
  const o = proj.origine, kx = M_PAR_DEGRE * Math.cos(o.lat * Math.PI / 180);
  const contour = proj.anneaux[0];
  const accroche = (lon: number, lat: number): PointLocal => {
    const p = { x: (lon - o.lon) * kx, y: (lat - o.lat) * M_PAR_DEGRE };
    let best = p, dmin = ACCROCHE_M;
    for (const q of contour) { const d = Math.hypot(q.x - p.x, q.y - p.y); if (d <= dmin) { dmin = d; best = q; } }
    return best;
  };
  const facades: FacadeLocale[] = fw.map((f) => ({ a: accroche(f.debut[0], f.debut[1]), b: accroche(f.fin[0], f.fin[1]) }));
  const segs = segmentsDe(proj.anneaux);
  if (!marquerSegmentsVoie(segs, facades)) return non('façade sur voie non retrouvée sur le contour cadastral');
  const segsVoie = segs.filter((s) => s.voie);

  // Façade principale : la plus longue ; normale vers l'intérieur de la parcelle.
  const f = facades.reduce((a, b) => (Math.hypot(b.b.x - b.a.x, b.b.y - b.a.y) > Math.hypot(a.b.x - a.a.x, a.b.y - a.a.y) ? b : a));
  const lg = Math.hypot(f.b.x - f.a.x, f.b.y - f.a.y);
  if (lg < 1) return non('façade sur voie trop courte');
  const thetaV = Math.atan2(f.b.y - f.a.y, f.b.x - f.a.x);
  const mil = { x: (f.a.x + f.b.x) / 2, y: (f.a.y + f.b.y) / 2 };
  const nG = { x: -Math.sin(thetaV), y: Math.cos(thetaV) };
  const sens = dansPolygone(proj.anneaux, mil.x + 0.5 * nG.x, mil.y + 0.5 * nG.y) ? 1 : -1;

  const rv = reculVoieDuVolume(regles);
  const reculVoie = rv.valeurM;
  const reculLimites = Math.round(reculsRetenus((regles.regles ?? []).filter(regleValide), null).limitesPour(v.hauteurM) * 100) / 100;
  const base = { reculVoieM: reculVoie, reculVoieSuppose: rv.suppose, sourceReculVoie: rv.source, reculLimitesM: reculLimites, facades };

  const theta0 = e.angleDeg * Math.PI / 180;
  const reculAvant = distanceRect(e.coins, segsVoie);
  const candidats = [
    { front: e.largeurM, prof: e.profondeurM, axeLargeur: thetaV },
    { front: e.profondeurM, prof: e.largeurM, axeLargeur: thetaV + Math.PI / 2 },
  ].sort((a, b) => ecartAxe(a.axeLargeur, theta0) - ecartAxe(b.axeLargeur, theta0));
  if (ecartAxe(candidats[0].axeLargeur, theta0) < Math.PI / 180 && Math.abs(reculAvant - reculVoie) <= TOLERANCE_RECUL_M) {
    const pose: PoseVoie = { ...base, statut: 'inchangee', reculAvantM: r2(reculAvant), reculApresM: r2(reculAvant), deplacementM: 0,
      message: `Implantation gardée : volume déjà parallèle à la voie, façade à ${fr(reculAvant, 2)} m de la voie (${rv.source}).` };
    return { volume: { ...v, poseVoie: pose }, pose, raison: null };
  }

  // Repère tourné : x le long de la voie, y vers l'intérieur (sens) ; mêmes fonctions que le moteur (rectTient).
  const anneauxR = proj.anneaux.map((r) => r.map((p) => tourner(p, -thetaV)));
  const segsR = segmentsDe(anneauxR);
  marquerSegmentsVoie(segsR, facades.map((x) => ({ a: tourner(x.a, -thetaV), b: tourner(x.b, -thetaV) })));
  const aR = tourner(f.a, -thetaV);
  const xs = anneauxR[0].map((p) => p.x), ys = anneauxR[0].map((p) => p.y);
  const [xMin, xMax] = [Math.min(...xs), Math.max(...xs)];
  const profondeurParcelle = Math.max(...ys) - Math.min(...ys);
  const s0 = tourner(e.centre, -thetaV).x;
  let trouve: { c: PointLocal; cand: typeof candidats[number] } | null = null;
  for (let extra = 0; extra <= profondeurParcelle && !trouve; extra += PAS_M) {
    for (const cand of candidats) {
      const cv = aR.y + sens * (reculVoie + extra + cand.prof / 2 + MARGE_M);
      for (let j = 0; j * PAS_M <= xMax - xMin && !trouve; j++) {
        for (const cu of j === 0 ? [s0] : [s0 + j * PAS_M, s0 - j * PAS_M]) {
          if (cu < xMin || cu > xMax) continue;
          if (rectTient(anneauxR, segsR, { cu, cv, w: cand.front, d: cand.prof }, reculLimites, reculVoie)) { trouve = { c: tourner({ x: cu, y: cv }, thetaV), cand }; break; }
        }
      }
      if (trouve) break;
    }
  }
  if (!trouve) {
    const pose: PoseVoie = { ...base, statut: 'impossible', reculAvantM: r2(reculAvant), reculApresM: r2(reculAvant), deplacementM: 0,
      message: `Le volume (${fr(e.largeurM)} × ${fr(e.profondeurM)} m) ne tient pas parallèle à la voie à ${fr(reculVoie)} m de la voie et ${fr(reculLimites)} m des autres limites : implantation du moteur gardée (façade à ${fr(reculAvant, 2)} m de la voie).` };
    return { volume: { ...v, poseVoie: pose, alertes: [...v.alertes, pose.message] }, pose, raison: null };
  }
  const angle = ((trouve.cand.axeLargeur % Math.PI) + Math.PI) % Math.PI;
  const coins = coinsDe(trouve.c, angle, e.largeurM, e.profondeurM);
  const reculApres = distanceRect(coins, segsVoie);
  const deplacement = Math.hypot(trouve.c.x - e.centre.x, trouve.c.y - e.centre.y);
  const emprise = { ...e, centre: trouve.c, centreWgs84: versWgs84(trouve.c, o), angleDeg: Math.round(angle * 180 / Math.PI * 10) / 10, coins };
  const phrase = `Implantation : volume posé parallèlement à la voie (côté voie présumé d’après le cadastre — limite sans parcelle mitoyenne —, à confirmer), façade avant à ${fr(reculApres, 2)} m de l’alignement (${rv.source}) ; ${fr(reculLimites)} m au moins des autres limites. Position calculée (déplacement de ${fr(deplacement)} m depuis le placement du moteur), à vérifier par un professionnel.`;
  const pose: PoseVoie = { ...base, statut: 'posee', reculAvantM: r2(reculAvant), reculApresM: r2(reculApres), deplacementM: r2(deplacement), message: phrase };
  const batiments = v.batiments?.length === 1 ? [{ ...v.batiments[0], centre: emprise.centre, centreWgs84: emprise.centreWgs84, angleDeg: emprise.angleDeg, coins }] : v.batiments;
  return {
    volume: {
      ...v, emprise, ...(batiments ? { batiments } : {}),
      hypotheses: [...v.hypotheses.filter((h) => !/côté voie non identifié/u.test(h)), phrase],
      poseVoie: pose,
    },
    pose, raison: null,
  };
}

const r2 = (x: number) => Math.round(x * 100) / 100;

/** Ligne « hauteur » de la fiche : comment la hauteur du volume est comptée (règlement non lu → SUPPOSÉ). */
export function ligneHauteurFiche(v: Pick<VolumePropose, 'niveaux' | 'hauteurM'>, regles: ReglesPluVolume): string {
  const h = (regles.regles ?? []).filter(regleValide).filter((r) => r.cle === 'hauteur_max_m' || r.cle === 'hauteur_faitage_m')
    .reduce<ReglePlu | null>((a, b) => (!a || b.valeur < a.valeur ? b : a), null);
  const vol = `${v.niveaux} niveau${v.niveaux > 1 ? 'x' : ''} × ${fr(HYPOTHESES_VOLUME.hauteurEtageM)} m = ${fr(v.hauteurM)} m au sommet de la toiture-terrasse (acrotère non compris)`;
  if (!h) return `hauteur : ${vol} ; hauteur maximale du PLU inconnue.`;
  return `hauteur : ${vol} pour ${fr(h.valeur)} m max. (${h.source} ; ${STATUTS[h.statut]}). Hauteur maximale comptée ACROTÈRE COMPRIS (décision de prudence ; mode de calcul du règlement — égout ou acrotère — non lu) : un acrotère ou des hauteurs d’étage supérieures à ${fr(HYPOTHESES_VOLUME.hauteurEtageM)} m modélisés par le Studio dépasseraient la règle ; hauteur rendue à contrôler.`;
}
