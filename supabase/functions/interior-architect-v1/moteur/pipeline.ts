/**
 * INT-09c — `amenager(plan, brief, options)` : POINT D'ENTRÉE UNIQUE RECOMMANDÉ du moteur.
 *
 *   positions candidates des gaines supposées (candidatsPointsEau, règles R1 à R5 comme filtres)
 *   → choix, pièce humide par pièce humide, de la position qui donne le meilleur aménagement
 *   → analyse → programme → solveur → style → critique (chaîne complète, graine `seed`).
 *
 * CHOIX DE LA GAINE (hypothèse Mimmoza « supposer, puis confirmer », la position reste à confirmer) :
 * pour chaque pièce humide sans point d'eau, dans l'ordre de l'analyse, les positions retenues par
 * `candidatsPointsEau` (au plus MAX_CANDIDATS_PIECE) sont évaluées les autres pièces étant figées :
 *  1. résolution de CETTE pièce seule (`solveLayout` option `pieces`), le reste du logement gardant
 *     l'implantation courante ; clé rapide = (obligatoires non placés, non placés, rang R3) ;
 *     (pièce de jour à cuisine ouverte, dont la résolution coûte 0,1 à 0,3 s : au plus MAX_CANDIDATS_SEJOUR) ;
 *  2. critique (sans style) dans cet ordre, la position R3 d'origine toujours comprise ; on s'arrête dès qu'une
 *     position SANS DÉFAUT (0 violation bloquante, minimum d'obligatoires non placés) a été trouvée et qu'au moins
 *     MIN_CRITIQUES_SCORE positions ont été critiquées (comparaison de score) ; au plus MAX_CRITIQUES_PIECE.
 *     Clé de choix (plus petit = meilleur) : violations bloquantes de la pièce et du logement (roomId null ; celles
 *     des autres pièces ne dépendent pas de cette gaine), obligatoires non placés, −score
 *     de la pièce (moyenne des familles hors style), rang R3 d'origine (départage déterministe).
 * Ensuite la chaîne complète est relancée avec les positions retenues (résolution complète, et composition pièce
 * par pièce) ; si aucune ne bat (même clé, score moyen hors style) les positions R3 d'origine, ces dernières sont
 * conservées : `amenager` ne fait jamais moins bien que `supposerPointsEau` + chaîne (bloquantes, obligatoires).
 * Un plan qui a déjà tous ses points d'eau passe par la chaîne seule, sans aucun changement.
 *
 * PUR et DÉTERMINISTE (aucune horloge, aucun hasard hors `rng(seed)`). Le plan d'entrée n'est pas modifié.
 */
import type { Fixture, InteriorBrief, InteriorReport, LayoutPlan, PlanAnalysis, PlanInput, RoomProgram } from './types';
import { analyzePlan } from './analyzer';
import { buildProgram } from './programmer';
import { solveLayout } from './solver';
import { critique } from './critic';
import { applyStyle, buildStyleSheet } from './style';
import type { StyleSheet } from './style/types';
import { candidatsPointsEau, MAX_CANDIDATS_PIECE, type CandidatPointEau } from './hypotheses/pointsEau';

/** Nombre maximal de critiques (≈ 20 à 60 ms chacune) par pièce humide évaluée. */
export const MAX_CRITIQUES_PIECE = 10;
/** Une fois une position sans défaut trouvée, nombre minimal de positions critiquées (départage par le score). */
export const MIN_CRITIQUES_SCORE = 2;
/** Positions candidates évaluées dans un séjour-cuisine (résolution coûteuse). */
export const MAX_CANDIDATS_SEJOUR = 4;

export interface OptionsAmenager {
  /** Graine du solveur et du style. Défaut 1. */
  seed?: number;
  variant?: string;
  /** Positions candidates évaluées par pièce (défaut MAX_CANDIDATS_PIECE). 1 = choix R3 d'origine seul. */
  maxCandidats?: number;
}

export interface ChoixGaine {
  roomId: string;
  /** Rang R3 d'origine de la position retenue (0 = choix de `supposerPointsEau`). */
  rangR3: number;
  admissibles: number;
  /** Positions résolues (étape 1) et critiquées (étape 2). */
  resolues: number;
  critiquees: number;
  /** Clé de la position retenue lors de l'évaluation pièce par pièce. */
  evaluation: { bloquantes: number; obligatoiresNonPlaces: number; score: number };
}

export interface ResultatAmenager {
  /** Plan d'entrée complété des gaines supposées retenues. */
  plan: PlanInput;
  analysis: PlanAnalysis;
  programs: RoomProgram[];
  feuilleDeStyle: StyleSheet;
  /** Implantation habillée (style appliqué). */
  layout: LayoutPlan;
  report: InteriorReport;
  /** Gaines supposées retenues (supposed: true) et phrases d'hypothèse (une par gaine posée ou impossible). */
  supposes: Fixture[];
  hypotheses: string[];
  /** Détail du choix pour chaque pièce humide sans point d'eau. */
  choix: ChoixGaine[];
  /** true si la chaîne avec les positions optimisées a été préférée à celle des positions R3 d'origine. */
  optimise: boolean;
}

/** Identifiants des items obligatoires du programme non posés (convention `${roomId}-i${k}` du solveur). */
function obligatoiresNonPlaces(programs: RoomProgram[], layout: LayoutPlan, roomId?: string): number {
  const poses = new Set(layout.placements.map((p) => p.id));
  let n = 0;
  for (const pr of programs) {
    if (roomId !== undefined && pr.roomId !== roomId) continue;
    pr.items.forEach((it, k) => { if (it.priority === 'obligatoire' && !poses.has(`${pr.roomId}-i${k}`)) n++; });
  }
  return n;
}

const moyenne = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
function scorePiece(report: InteriorReport, roomId: string, sansStyle: boolean): number {
  const r = report.rooms.find((x) => x.roomId === roomId);
  return r ? moyenne(r.scores.filter((s) => !sansStyle || s.family !== 'style').map((s) => s.score)) : 0;
}
/** Violations bloquantes du logement ; avec `roomId` : celles de cette pièce et celles du logement (roomId null). */
const nbBloquantes = (report: InteriorReport, roomId?: string) =>
  report.violations.filter((v) => v.severity === 'bloquante' && (roomId === undefined || v.roomId === roomId || v.roomId === null)).length;

interface Chaine { plan: PlanInput; analysis: PlanAnalysis; programs: RoomProgram[]; feuilleDeStyle: StyleSheet; layout: LayoutPlan; report: InteriorReport }

function chaine(plan: PlanInput, brief: InteriorBrief, seed: number, variant: string | undefined, brut?: { analysis: PlanAnalysis; programs: RoomProgram[]; layout: LayoutPlan }): Chaine {
  const analysis = brut?.analysis ?? analyzePlan(plan);
  const programs = brut?.programs ?? buildProgram(analysis, brief);
  const feuilleDeStyle = buildStyleSheet(brief, analysis);
  const solved = brut?.layout ?? solveLayout({ plan, analysis, programs, seed, brief, ...(variant !== undefined ? { variant } : {}) });
  const layout = applyStyle(solved, feuilleDeStyle, seed);
  const report = critique({ plan, analysis, layout, brief });
  return { plan, analysis, programs, feuilleDeStyle, layout, report };
}

/** Rang de pièce dans l'analyse : les placements composés gardent l'ordre pièce par pièce du solveur. */
let rangPiece: Map<string, number> = new Map();
function composer(courant: LayoutPlan, room: string, partiel: LayoutPlan): LayoutPlan {
  const tri = <T extends { roomId: string }>(xs: T[]) => xs.map((x, i) => ({ x, i }))
    .sort((a, b) => (rangPiece.get(a.x.roomId) ?? 0) - (rangPiece.get(b.x.roomId) ?? 0) || a.i - b.i).map((y) => y.x);
  return {
    ...courant,
    placements: tri([...courant.placements.filter((x) => x.roomId !== room), ...partiel.placements]),
    unplaced: tri([...courant.unplaced.filter((x) => x.roomId !== room), ...partiel.unplaced]),
    repairs: courant.repairs,
  };
}

export function amenager(plan: PlanInput, brief: InteriorBrief, options: OptionsAmenager = {}): ResultatAmenager {
  const seed = options.seed ?? 1;
  const variant = options.variant;
  const max = Math.max(1, options.maxCandidats ?? MAX_CANDIDATS_PIECE);
  const cand = candidatsPointsEau(plan, analyzePlan(plan), { max });
  const pieces = cand.pieces;
  const choixIdx = new Map<string, number>(pieces.map((p) => [p.roomId, 0]));
  const avec = (idx: Map<string, number>): PlanInput => ({
    ...plan,
    fixtures: [...plan.fixtures, ...pieces.map((p) => p.candidats[idx.get(p.roomId) ?? 0]!.fixture)],
  });
  const solve = (p: PlanInput, analysis: PlanAnalysis, programs: RoomProgram[], seulement?: string[]) =>
    solveLayout({ plan: p, analysis, programs, seed, brief, ...(variant !== undefined ? { variant } : {}), ...(seulement ? { pieces: seulement } : {}) });

  // Point de départ : positions R3 d'origine (= supposerPointsEau), implantation brute complète.
  const planDefaut = avec(choixIdx);
  const anDefaut = analyzePlan(planDefaut);
  const progDefaut = buildProgram(anDefaut, brief);
  rangPiece = new Map(anDefaut.rooms.map((r, i) => [r.id, i]));
  const brutDefaut = solve(planDefaut, anDefaut, progDefaut);
  let courant: LayoutPlan = brutDefaut;
  const choix: ChoixGaine[] = [];

  for (const pc of pieces) {
    const room = pc.roomId;
    if (pc.candidats.length === 1) {
      choix.push({ roomId: room, rangR3: 0, admissibles: pc.admissibles, resolues: 0, critiquees: 0, evaluation: { bloquantes: -1, obligatoiresNonPlaces: -1, score: -1 } });
      continue;
    }
    // Étape 1 : résolution de la pièce seule pour chaque position (la position courante réutilise l'implantation courante).
    const sejour = anDefaut.rooms.find((r) => r.id === room)?.role === 'sejour_cuisine';
    const evaluees = pc.candidats.slice(0, sejour ? Math.min(max, MAX_CANDIDATS_SEJOUR) : max);
    const essais = evaluees.map((c: CandidatPointEau, j) => {
      const idx = new Map(choixIdx).set(room, j);
      const p = avec(idx);
      const analysis = analyzePlan(p);
      const programs = buildProgram(analysis, brief);
      if (j === (choixIdx.get(room) ?? 0)) return { j, c, p, analysis, programs, layout: courant, oblig: obligatoiresNonPlaces(programs, courant), nonPlaces: courant.unplaced.length };
      const partiel = solve(p, analysis, programs, [room]);
      const layout = composer(courant, room, partiel);
      return { j, c, p, analysis, programs, layout, oblig: obligatoiresNonPlaces(programs, layout), nonPlaces: layout.unplaced.length };
    });
    const ordre = [...essais].sort((a, b) => a.oblig - b.oblig || a.nonPlaces - b.nonPlaces || a.c.rangR3 - b.c.rangR3);
    // Étape 2 : critique (sans style) dans l'ordre de l'étape 1, arrêt anticipé (voir en tête) ; R3 d'origine toujours comprise.
    const minOblig = ordre[0]!.oblig;
    const notes: Array<{ e: (typeof essais)[number]; bloquantes: number; oblig: number; score: number }> = [];
    for (const e of ordre) {
      if (notes.length >= MAX_CRITIQUES_PIECE) break;
      const report = critique({ plan: e.p, analysis: e.analysis, layout: e.layout, brief });
      notes.push({ e, bloquantes: nbBloquantes(report, room), oblig: e.oblig, score: Math.round(scorePiece(report, room, true) * 1000) / 1000 });
      if (notes.length >= MIN_CRITIQUES_SCORE && notes.some((n) => n.bloquantes === 0 && n.oblig === minOblig)) break;
    }
    if (!notes.some((n) => n.e.j === 0)) {
      const e = essais[0]!;
      const report = critique({ plan: e.p, analysis: e.analysis, layout: e.layout, brief });
      notes.push({ e, bloquantes: nbBloquantes(report, room), oblig: e.oblig, score: Math.round(scorePiece(report, room, true) * 1000) / 1000 });
    }
    notes.sort((a, b) => a.bloquantes - b.bloquantes || a.oblig - b.oblig || b.score - a.score || a.e.c.rangR3 - b.e.c.rangR3);
    const best = notes[0]!;
    choixIdx.set(room, best.e.j);
    courant = best.e.layout;
    choix.push({ roomId: room, rangR3: best.e.c.rangR3, admissibles: pc.admissibles, resolues: essais.length, critiquees: notes.length, evaluation: { bloquantes: best.bloquantes, obligatoiresNonPlaces: best.oblig, score: best.score } });
  }

  // Chaîne complète. Positions R3 d'origine, et, si au moins une gaine a changé, deux implantations des positions
  // retenues : la résolution complète (aléa enchaîné sur tout le logement) et la composition évaluée pièce par pièce
  // (celle qui a servi au choix). Comparaison sur la critique SANS style (clé : bloquantes, obligatoires non placés,
  // −score moyen hors style) ; une implantation n'est retenue que si elle bat strictement la précédente (ordre :
  // R3 d'origine, complète, composée). Seule l'implantation retenue est habillée (style) puis critiquée.
  let final: { plan: PlanInput; analysis: PlanAnalysis; programs: RoomProgram[]; layout: LayoutPlan } = { plan: planDefaut, analysis: anDefaut, programs: progDefaut, layout: brutDefaut };
  let optimise = false;
  if ([...choixIdx.values()].some((j) => j !== 0)) {
    const planOpt = avec(choixIdx);
    const anOpt = analyzePlan(planOpt);
    const progOpt = buildProgram(anOpt, brief);
    const options = [
      final,
      { plan: planOpt, analysis: anOpt, programs: progOpt, layout: solve(planOpt, anOpt, progOpt) },
      { plan: planOpt, analysis: anOpt, programs: progOpt, layout: courant },
    ];
    const cle = (c: (typeof options)[number]) => {
      const rep = critique({ plan: c.plan, analysis: c.analysis, layout: c.layout, brief });
      return [nbBloquantes(rep), obligatoiresNonPlaces(c.programs, c.layout), -Math.round(moyenne(rep.rooms.flatMap((r) => r.scores.filter((x) => x.family !== 'style').map((x) => x.score))) * 1000) / 1000];
    };
    let kf = cle(options[0]!);
    for (const c of options.slice(1)) {
      const k = cle(c);
      let bat = false;
      for (let i = 0; i < k.length; i++) if (k[i] !== kf[i]) { bat = k[i]! < kf[i]!; break; }
      if (bat) { final = c; kf = k; optimise = true; }
    }
  }
  const habille = chaine(final.plan, brief, seed, variant, final);
  const idxFinal = optimise ? choixIdx : new Map(pieces.map((p) => [p.roomId, 0]));
  if (!optimise) for (const c of choix) c.rangR3 = 0;

  const supposes: Fixture[] = [];
  const hypotheses: string[] = [];
  const parId = new Map(pieces.map((p) => [p.roomId, p]));
  for (const fx of habille.plan.fixtures) {
    if (!fx.supposed || !parId.has(fx.roomId)) continue;
    const pc = parId.get(fx.roomId)!;
    const c = pc.candidats[idxFinal.get(fx.roomId) ?? 0]!;
    supposes.push(fx);
    hypotheses.push(c.rangR3 === 0 ? c.hypothese
      : `${c.hypothese} Position retenue par évaluation de l'aménagement (${choix.find((x) => x.roomId === fx.roomId)?.resolues ?? pc.candidats.length} positions évaluées sur ${pc.admissibles} admissibles ; la position de préférence R3 donnait un moins bon résultat).`);
  }
  hypotheses.push(...cand.impossibles);
  return { ...habille, supposes, hypotheses, choix, optimise };
}
