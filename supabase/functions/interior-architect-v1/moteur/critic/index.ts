/**
 * INT-06 — Critique : confronte une implantation (LayoutPlan) à la base de règles et produit un InteriorReport.
 *
 * PUR et DÉTERMINISTE : aucune horloge, aucun hasard, aucun réseau ni LLM ; les entrées ne sont pas modifiées.
 * Rien n'est inventé : un contrôle impossible faute de donnée va dans `rulesSkipped` avec sa raison.
 *
 * Applicabilité (avant tout calcul) : construction, kind, pmr (brief.constraints.pmr) et roles. Une règle non
 * applicable n'apparaît NI dans rulesChecked NI dans rulesSkipped (voir CHECKS.md, décision D1).
 *
 * Verdict (ABSORBANT) :
 * - pièce « defavorable » dès qu'elle porte une violation bloquante ;
 * - global « defavorable » si une pièce l'est OU s'il existe une violation bloquante de portée logement ;
 * - sinon « reserve » si le score dégradant (pièce, ou logement pour le global) est < SEUIL_RESERVE ;
 * - sinon « favorable ».
 */
import type {
  FamilyScore, FurnitureSpec, InteriorBrief, InteriorReport, LayoutPlan, PlanAnalysis, PlanInput, RoomVerdict, Rule,
  RuleFamily, Verdict, Violation,
} from '../types';
import { BLOCKING_FAMILIES } from '../types';
import { RULES } from '../data/rules';
import { getSpec } from '../data/catalog';
import { CHECK_KINDS, type CheckKind } from '../data/schemas';
import { CHECKS, construireScene, type RawViolation } from './checks';

export { CHECKS } from './checks';
export type { CheckFn, CheckContext, CheckOutcome, RawViolation, Scene } from './checks';

/**
 * Seuil de réserve (hypothèse Mimmoza, barème 2026) : une pièce sans violation bloquante est « reserve » si son
 * score dégradant — 100 × (1 − Σ poids des règles dégradantes en défaut / Σ poids des règles dégradantes évaluées) —
 * est strictement inférieur à 75. Même formule au niveau du logement pour le verdict global (règle en défaut si
 * elle a au moins une violation, quelle que soit sa portée).
 */
export const SEUIL_RESERVE = 75;

export const FAMILLES: RuleFamily[] = ['usage', 'circulation', 'technique', 'echelle', 'organisation', 'style'];
const DEGRADANTES = FAMILLES.filter((f) => !BLOCKING_FAMILIES.includes(f));

export interface CritiqueInput {
  plan: PlanInput;
  analysis: PlanAnalysis;
  layout: LayoutPlan;
  brief: InteriorBrief;
  rules?: Rule[];
}

/** Équipements valant point d'eau (même liste que l'analyseur, EQUIPEMENTS_EAU). */
const EAU: ReadonlySet<string> = new Set(['gaine', 'arrivee_eau', 'evacuation']);
const uniq = (xs: string[]) => [...new Set(xs)];
const r1 = (x: number) => Math.round(x * 10) / 10;

interface Trace { rule: Rule; evaluatedRoomIds: string[]; violations: Violation[] }

export function critique(input: CritiqueInput, options: { spec?: (id: string) => FurnitureSpec | undefined } = {}): InteriorReport {
  const { plan, analysis, layout, brief } = input;
  const rules = input.rules ?? RULES;
  const scene = construireScene(plan, analysis, layout, brief, options.spec ?? getSpec);
  const kinds = new Set<string>(CHECK_KINDS);

  const violations: Violation[] = [];
  const rulesChecked: string[] = [];
  const rulesSkipped: InteriorReport['rulesSkipped'] = [];
  const assumptions: string[] = [...analysis.assumptions];
  const missing: string[] = [...analysis.missing];
  const recosPrises: string[] = [];
  const traces: Trace[] = [];
  const actions = new Map<string, string>();

  // INT-09b : un équipement supposé (absent du plan d'origine) est signalé, sans violation pour ce seul fait.
  for (const f of plan.fixtures) {
    if (f.supposed !== true) continue;
    const r = plan.rooms.find((x) => x.id === f.roomId);
    assumptions.push(`${EAU.has(f.kind) ? "Point d'eau supposé" : `Équipement supposé (${f.kind})`} dans ${r?.name ? `« ${r.name} » (${f.roomId})` : f.roomId} : à confirmer${f.reason ? ` (${f.reason})` : ''}.`);
  }

  for (const pl of scene.inconnus) missing.push(`placement ${pl.id} : spec « ${pl.specId} » inconnue, exclue des contrôles géométriques`);

  for (const rule of rules) {
    const a = rule.applicability;
    if (!a.construction.includes(plan.construction) || !a.kind.includes(plan.kind)) continue;
    if (a.pmr === 'si_pmr' && brief.constraints.pmr !== true) continue;
    if (!kinds.has(rule.check.kind)) { rulesSkipped.push({ ruleId: rule.id, reason: `contrôle « ${rule.check.kind} » non implémenté` }); continue; }
    const rooms = a.roles ? analysis.rooms.filter((r) => a.roles!.includes(r.role)) : analysis.rooms;
    const out = CHECKS[rule.check.kind as CheckKind]({ scene, rule, rooms }, rule.check.params);
    if (out.status === 'non_applicable') continue;
    if (out.status === 'skipped') { rulesSkipped.push({ ruleId: rule.id, reason: out.reason }); continue; }
    rulesChecked.push(rule.id);
    assumptions.push(...(out.assumptions ?? []));
    missing.push(...(out.missing ?? []));
    recosPrises.push(...(out.recommendations ?? []));
    const compteurs = new Map<string, number>();
    const vs = out.violations.map((rv: RawViolation): Violation => {
      const cle = rv.roomId ?? 'logement';
      const n = (compteurs.get(cle) ?? 0) + 1;
      compteurs.set(cle, n);
      const v: Violation = {
        id: `${rule.id}:${cle}:${String(n).padStart(2, '0')}`, ruleId: rule.id, family: rule.family, severity: rule.severity,
        roomId: rv.roomId, placementIds: [...rv.placementIds], message: `[${rule.id}] ${rv.message}`,
      };
      if (rv.measured !== undefined) v.measured = rv.measured;
      if (rv.expected !== undefined) v.expected = rv.expected;
      actions.set(v.id, `[${rule.id}] ${rv.action}`);
      return v;
    });
    violations.push(...vs);
    traces.push({ rule, evaluatedRoomIds: out.evaluatedRoomIds, violations: vs });
  }

  // ── Scores et verdicts par pièce ──
  const rooms: RoomVerdict[] = analysis.rooms.map((room) => {
    const scores: FamilyScore[] = FAMILLES.map((family) => {
      let total = 0, defaut = 0;
      for (const t of traces) {
        if (t.rule.family !== family || !t.evaluatedRoomIds.includes(room.id)) continue;
        total += t.rule.weight;
        if (t.violations.some((v) => v.roomId === room.id)) defaut += t.rule.weight;
      }
      return { family, score: total > 0 ? r1(100 * (1 - defaut / total)) : 100, violations: violations.filter((v) => v.family === family && v.roomId === room.id).map((v) => v.id) };
    });
    const bloquee = violations.some((v) => v.roomId === room.id && v.severity === 'bloquante');
    const sd = scoreDegradant(traces, (t) => t.evaluatedRoomIds.includes(room.id), (t) => t.violations.some((v) => v.roomId === room.id));
    const verdict: Verdict = bloquee ? 'defavorable' : sd < SEUIL_RESERVE ? 'reserve' : 'favorable';
    return { roomId: room.id, verdict, scores };
  });

  const bloquanteLogement = violations.some((v) => v.severity === 'bloquante');
  const sdLogement = scoreDegradant(traces, () => true, (t) => t.violations.length > 0);
  const verdict: Verdict = rooms.some((r) => r.verdict === 'defavorable') || bloquanteLogement ? 'defavorable'
    : rooms.some((r) => r.verdict === 'reserve') || sdLogement < SEUIL_RESERVE ? 'reserve' : 'favorable';

  assumptions.push(`Verdict : « reserve » si le score dégradant (échelle, organisation, style) est < ${SEUIL_RESERVE}/100 (hypothèse Mimmoza, barème 2026) ; toute violation bloquante rend le verdict défavorable.`);

  const recommendations = uniq([
    ...violations.filter((v) => v.severity === 'bloquante').map((v) => actions.get(v.id)!),
    ...violations.filter((v) => v.severity === 'degradante').map((v) => actions.get(v.id)!),
    ...recosPrises,
  ]);

  return {
    version: 1, planId: plan.id, variant: layout.variant, verdict, rooms, violations, rulesChecked, rulesSkipped,
    assumptions: uniq(assumptions), missing: uniq(missing),
    unplaced: layout.unplaced.map((u) => ({ ...u })), recommendations,
  };

  function scoreDegradant(ts: Trace[], concerne: (t: Trace) => boolean, enDefaut: (t: Trace) => boolean): number {
    let total = 0, defaut = 0;
    for (const t of ts) {
      if (!DEGRADANTES.includes(t.rule.family) || !concerne(t)) continue;
      total += t.rule.weight;
      if (enDefaut(t)) defaut += t.rule.weight;
    }
    return total > 0 ? 100 * (1 - defaut / total) : 100;
  }
}

