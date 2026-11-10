// interior-architect-v1/pipeline.ts
// Chaîne de calcul PURE (aucune I/O, aucun réseau, aucune horloge hors mesure
// de durée injectable). Chaque variante est calculée par le point d'entrée
// unique du moteur 0.3.0, `amenager(plan, brief, { seed, maxCandidats })` :
// gaines supposées à la position optimale (évaluation de l'aménagement) →
// analyse → programme → solveur (graine de la variante) → style → critique.
// Le budget de calcul, le tri et le contrat de réponse sont ceux d'INT-10.

import { amenager, type ChoixGaine, type ResultatAmenager } from './moteur/pipeline.ts';
import type { Fixture, InteriorBrief, InteriorReport, LayoutPlan, PlanInput, Verdict } from './moteur/types.ts';
import type { StyleSheet } from './moteur/style/types.ts';

export const VERSION_MOTEUR = '0.3.0';
export const VERSION_FONCTION = 'interior-architect-v1 (INT-10b)';

/**
 * Budget de CALCUL par requête (ms). Les Edge Functions Supabase plafonnent le
 * temps CPU par requête (2 s annoncées dans la documentation, non mesuré ici) :
 * la première variante est toujours calculée, les suivantes seulement si la
 * moyenne observée (chaîne de base, hors recherche de gaine) laisse penser
 * qu'elles tiennent dans ce budget. Une variante non calculée est SIGNALÉE,
 * jamais masquée. Surcharge : secret INTERIOR_BUDGET_MS.
 * INT-10b : 1200 → 1500 ms (mesures du banc, README « Temps de calcul ») : la
 * recherche de gaine de la variante A doit laisser la place d'une variante B.
 */
export const BUDGET_CALCUL_MS_DEFAUT = 1500;

export interface PointEauSuppose {
  id: string;
  pieceId: string;
  piece: string;
  position: [number, number];
  raison: string;
  statut: 'a_confirmer';
}

export interface Variante {
  libelle: string;
  seed: number;
  verdict: Verdict;
  /** Score de TRI dérivé du rapport (moyenne des scores de famille des pièces, 0..100) — indicateur INT-10, pas une note du moteur. */
  score: number;
  layout: LayoutPlan;
  rapport: InteriorReport;
  feuilleDeStyle: StyleSheet;
  pointsEauSupposes: PointEauSuppose[];
  /**
   * Détail du choix de chaque gaine supposée (moteur 0.3.0, `ResultatAmenager.choix`) : rang R3 retenu, positions
   * admissibles, résolues et critiquées. Variante qui reprend les gaines de la variante A : choix de la variante A.
   */
  choixGaines: ChoixGaine[];
  /** Phrases d'hypothèse sur les points d'eau de CETTE variante (la position d'une gaine peut dépendre de la graine). */
  hypothesesPointsEau: string[];
  duree_ms: number;
}

export interface ResultatVariantes {
  variantes: Variante[];
  /** Graines demandées mais non retenues (doublon exact d'une autre graine, ou budget de calcul dépassé). */
  ecartees: Array<{ seed: number; motif: string }>;
  /** Hypothèses de points d'eau de la variante recommandée (la première après tri). */
  hypothesesPointsEau: string[];
  duree_ms: number;
}

const RANG_VERDICT: Record<Verdict, number> = { favorable: 0, reserve: 1, defavorable: 2 };

/** Score de tri : moyenne de tous les scores de famille de toutes les pièces (100 si aucune pièce évaluée). */
export function scoreDeTri(rapport: InteriorReport): number {
  const s = rapport.rooms.flatMap((r) => r.scores.map((f) => f.score));
  return s.length ? Math.round((s.reduce((a, b) => a + b, 0) / s.length) * 10) / 10 : 100;
}

const nbBloquantes = (v: Pick<Variante, 'rapport'>) => v.rapport.violations.filter((x) => x.severity === 'bloquante').length;

/**
 * Tri des variantes : verdict (favorable < réserve < défavorable), puis score décroissant,
 * puis moins de violations bloquantes, puis moins d'éléments non placés, puis graine croissante
 * (ordre total et déterministe).
 */
export function trierVariantes<T extends Pick<Variante, 'verdict' | 'score' | 'seed' | 'rapport' | 'layout'>>(vs: T[]): T[] {
  return [...vs].sort((a, b) =>
    RANG_VERDICT[a.verdict] - RANG_VERDICT[b.verdict]
    || b.score - a.score
    || nbBloquantes(a) - nbBloquantes(b)
    || a.layout.unplaced.length - b.layout.unplaced.length
    || a.seed - b.seed);
}

/** Signature d'un aménagement (sert à écarter deux graines qui donnent exactement le même résultat). */
export function signatureLayout(l: LayoutPlan): string {
  return JSON.stringify(l.placements.map((p) => [p.id, p.specId, p.roomId, p.center, p.rotationDeg, p.mirrored ?? false, p.finish?.materialId ?? null, p.finish?.color ?? null]));
}

const nomPiece = (plan: PlanInput, id: string) => plan.rooms.find((r) => r.id === id)?.name ?? id;

export function versPointsEau(plan: PlanInput, supposes: Fixture[]): PointEauSuppose[] {
  return supposes.map((f) => ({
    id: f.id, pieceId: f.roomId, piece: nomPiece(plan, f.roomId),
    position: [f.position[0], f.position[1]],
    raison: f.reason ?? 'point d\'eau supposé par Mimmoza',
    statut: 'a_confirmer' as const,
  }));
}

/**
 * Positions candidates évaluées par pièce humide lors d'une recherche de gaine (option `maxCandidats` d'`amenager`) :
 * 10 = valeur du moteur (MAX_CANDIDATS_PIECE). Surcharge : secret INTERIOR_MAX_CANDIDATS (1 = aucune recherche).
 */
export const MAX_CANDIDATS_DEFAUT = 10;
/**
 * Coût estimé d'une recherche de gaine = FACTEUR × coût de la chaîne de base de la même variante.
 * Rapport mesuré sur le banc INT-10b (plans dépouillés, conteneur) : 1,5 à 6,3 (p10). Une sous-estimation est rattrapée
 * par le contrôle de budget de la variante suivante (temps écoulé réel).
 */
export const FACTEUR_COUT_RECHERCHE = 6;

export interface OptionsVariantes {
  seed: number;
  nombre: number;
  budgetMs?: number;
  /** Positions candidates par pièce humide (défaut MAX_CANDIDATS_DEFAUT). */
  maxCandidats?: number;
  /** Horloge injectable (tests). */
  maintenant?: () => number;
}

/** Résultat retenu pour une variante (chaîne de base ou recherche de gaine). */
interface Retenu {
  layout: LayoutPlan; report: InteriorReport; feuilleDeStyle: StyleSheet;
  plan: PlanInput; supposes: Fixture[]; choix: ChoixGaine[]; hypotheses: string[];
}

const bloquantes = (r: InteriorReport) => r.violations.filter((x) => x.severity === 'bloquante').length;

/** Défaut qu'une meilleure position de gaine peut corriger : violation bloquante, ou équipement non placé dans une pièce à gaine supposée. */
function aCorriger(layout: LayoutPlan, rapport: InteriorReport, piecesSupposees: Set<string>): boolean {
  return bloquantes(rapport) > 0 || layout.unplaced.some((u) => piecesSupposees.has(u.roomId));
}

/** Strictement meilleur : moins de bloquantes, puis moins de non placés, puis meilleur score de tri. */
function meilleur(a: { layout: LayoutPlan; report: InteriorReport }, b: { layout: LayoutPlan; report: InteriorReport }): boolean {
  return bloquantes(a.report) - bloquantes(b.report) < 0
    || (bloquantes(a.report) === bloquantes(b.report) && (a.layout.unplaced.length < b.layout.unplaced.length
      || (a.layout.unplaced.length === b.layout.unplaced.length && scoreDeTri(a.report) > scoreDeTri(b.report))));
}

/**
 * Calcule 2 à 3 variantes (graines seed, seed+1, seed+2) avec `amenager` du moteur, triées. Le plan d'entrée n'est jamais modifié.
 *
 * Gaines supposées (pièces humides sans point d'eau), par variante :
 *  1. chaîne de base : variante A → `amenager(plan, { seed, maxCandidats: 1 })` (positions R3 d'origine) ;
 *     variantes suivantes → `amenager` sur le plan complété des gaines RETENUES pour la variante A (mêmes gaines
 *     « à confirmer » dans toutes les variantes, sans nouvelle recherche) ;
 *  2. recherche de la gaine optimale `amenager(plan, { seed, maxCandidats })` SEULEMENT si la base garde un défaut
 *     qu'une gaine peut corriger (violation bloquante, ou équipement non placé dans une pièce à gaine supposée) ET si
 *     le budget le permet (temps écoulé + FACTEUR_COUT_RECHERCHE × coût de la base, + une base de réserve pour la
 *     variante B quand on calcule A, ≤ budget). Le résultat de la recherche n'est retenu que s'il est meilleur.
 * Raison (mesures INT-10b) : une recherche coûte 1,5 à 6 fois la chaîne (jusqu'à 1,8 s pour un seul plan du banc),
 * incompatible avec 2 variantes sous 1,5 s si elle est lancée pour chaque variante ; sur le banc elle ne change le
 * résultat que pour p10 (2 bloquantes → 0).
 */
export function calculerVariantes(planEntree: PlanInput, brief: InteriorBrief, o: OptionsVariantes): ResultatVariantes {
  const now = o.maintenant ?? (() => performance.now());
  const budget = o.budgetMs ?? BUDGET_CALCUL_MS_DEFAUT;
  const maxCandidats = Math.max(1, o.maxCandidats ?? MAX_CANDIDATS_DEFAUT);
  const t0 = now();

  const variantes: Variante[] = [];
  const ecartees: ResultatVariantes['ecartees'] = [];
  const signatures = new Map<string, number>();
  const durees: number[] = [];
  /** Gaines retenues pour la variante A (plan complété), réutilisées par les variantes suivantes. */
  let reference: Pick<Retenu, 'plan' | 'supposes' | 'choix' | 'hypotheses'> | null = null;

  for (let k = 0; k < o.nombre; k++) {
    const seed = o.seed + k;
    if (k > 0) {
      const ecoule = now() - t0;
      const moyenne = durees.reduce((a, b) => a + b, 0) / durees.length;
      if (ecoule + moyenne > budget) {
        ecartees.push({ seed, motif: `budget de calcul atteint (${Math.round(ecoule)} ms écoulées, budget ${budget} ms) : variante non calculée` });
        continue;
      }
    }
    const tv = now();
    // 1) Chaîne de base.
    const base: ResultatAmenager = reference
      ? amenager(reference.plan, brief, { seed })
      : amenager(planEntree, brief, { seed, maxCandidats: 1 });
    const cBase = now() - tv;
    durees.push(cBase);
    let res: Retenu = {
      layout: base.layout, report: base.report, feuilleDeStyle: base.feuilleDeStyle,
      plan: reference?.plan ?? base.plan, supposes: reference?.supposes ?? base.supposes,
      choix: reference?.choix ?? base.choix, hypotheses: reference?.hypotheses ?? base.hypotheses,
    };
    // 2) Recherche de la gaine optimale, si utile et si elle tient dans le budget.
    const pieces = new Set(res.supposes.map((f) => f.roomId));
    if (maxCandidats > 1 && pieces.size > 0 && aCorriger(base.layout, base.report, pieces)) {
      const estime = FACTEUR_COUT_RECHERCHE * cBase + (k === 0 && o.nombre > 1 ? cBase : 0);
      if (now() - t0 + estime <= budget) {
        const opt = amenager(planEntree, brief, { seed, maxCandidats });
        if (meilleur(opt, base)) {
          res = { layout: opt.layout, report: opt.report, feuilleDeStyle: opt.feuilleDeStyle, plan: opt.plan, supposes: opt.supposes, choix: opt.choix, hypotheses: opt.hypotheses };
        }
      }
    }
    if (k === 0) reference = { plan: res.plan, supposes: res.supposes, choix: res.choix, hypotheses: res.hypotheses };
    const d = now() - tv;
    const pointsEau = versPointsEau(res.plan, res.supposes);
    // Doublon : même aménagement ET mêmes gaines supposées.
    const sig = `${signatureLayout(res.layout)}|${JSON.stringify(pointsEau.map((p) => [p.pieceId, p.position]))}`;
    const doublon = signatures.get(sig);
    if (doublon !== undefined) {
      ecartees.push({ seed, motif: `aménagement identique à celui de la graine ${doublon} : non répété` });
      continue;
    }
    signatures.set(sig, seed);
    variantes.push({
      libelle: '', seed, verdict: res.report.verdict, score: scoreDeTri(res.report),
      layout: res.layout, rapport: res.report, feuilleDeStyle: res.feuilleDeStyle, pointsEauSupposes: pointsEau,
      choixGaines: res.choix, hypothesesPointsEau: res.hypotheses, duree_ms: Math.round(d),
    });
  }

  const triees = trierVariantes(variantes).map((v, i) => ({ ...v, libelle: `Variante ${String.fromCharCode(65 + i)}` }));
  return { variantes: triees, ecartees, hypothesesPointsEau: triees[0]?.hypothesesPointsEau ?? [], duree_ms: Math.round(now() - t0) };
}
