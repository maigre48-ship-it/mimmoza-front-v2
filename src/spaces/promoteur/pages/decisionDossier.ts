import type { OperatingInputs } from './operatingModel.ts';
import { calculateOperatingModel } from './operatingModel.ts';

export const GATE_KEYS = ['foncier', 'demande', 'concurrence', 'economie', 'operateur'] as const;
export type GateKey = typeof GATE_KEYS[number];
export type GateVerdict = 'inconnu' | 'favorable' | 'defavorable';
export type GateEvidence = { verdict: GateVerdict; source: string; date: string; finding: string };
export type DecisionRecord = {
  target: string;
  programme: string;
  units: string;
  grossAreaM2: string;
  totalCost: string;
  baseExitValue: string;
  downsideExitValue: string;
  durationMonths: string;
  requiredAnnualReturnPct: string;
  operating?: OperatingInputs;
  gates: Record<GateKey, GateEvidence>;
};
export type ScenarioDecision = { id: string; parcelId: string; programme: string; record: DecisionRecord };
export type DecisionAssessment = {
  status: 'a_documenter' | 'a_ecarter' | 'qualifie';
  missing: string[];
  adverse: string[];
  baseMarginPct: number | null;
  downsideMarginPct: number | null;
  downsideAnnualReturnPct: number | null;
  prudentOperatingSurplus: number | null;
};
export type ComparativeDecision = {
  status: 'a_documenter' | 'aucun_viable' | 'priorite_conditionnelle';
  winnerId: string | null;
  reason: string;
  assessments: Record<string, DecisionAssessment>;
};

const EMPTY_GATE = (): GateEvidence => ({ verdict: 'inconnu', source: '', date: '', finding: '' });
export function emptyDecisionRecord(): DecisionRecord {
  return { target: '', programme: '', units: '', grossAreaM2: '', totalCost: '', baseExitValue: '', downsideExitValue: '', durationMonths: '', requiredAnnualReturnPct: '',
    gates: { foncier: EMPTY_GATE(), demande: EMPTY_GATE(), concurrence: EMPTY_GATE(), economie: EMPTY_GATE(), operateur: EMPTY_GATE() } };
}

function positive(value: string): number | null {
  if (!value?.trim()) return null;
  const n = Number(value.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}
function nonNegative(value: string): number | null {
  if (!value?.trim()) return null;
  const n = Number(value.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function documented(e: GateEvidence | undefined): boolean {
  return !!e && e.verdict !== 'inconnu' && e.source.trim().length >= 4 && /^\d{4}-\d{2}-\d{2}$/.test(e.date)
    && !Number.isNaN(Date.parse(e.date)) && e.date <= new Date().toISOString().slice(0, 10) && e.finding.trim().length >= 12;
}

export function assessScenario(record: DecisionRecord): DecisionAssessment {
  const missing: string[] = [];
  const adverse: string[] = [];
  if (!record.target?.trim()) missing.push('Clientèle ou utilisateur cible');
  if (!record.programme?.trim()) missing.push('Programme de surfaces et services');
  if (positive(record.units) == null || !Number.isInteger(positive(record.units))) missing.push('Nombre d’unités');
  if (positive(record.grossAreaM2) == null) missing.push('Surface brute du bâtiment');
  for (const key of GATE_KEYS) {
    const gate = record.gates?.[key];
    if (!documented(gate)) missing.push(`Preuve ${key}`);
    else if (gate.verdict === 'defavorable') adverse.push(`Avis défavorable : ${key} — ${gate.finding.trim()}`);
  }
  const cost = positive(record.totalCost);
  const base = positive(record.baseExitValue);
  const downside = positive(record.downsideExitValue);
  const months = positive(record.durationMonths);
  const threshold = nonNegative(record.requiredAnnualReturnPct);
  if (cost == null) missing.push('Coût complet sourcé');
  if (base == null) missing.push('Valeur de sortie centrale sourcée');
  if (downside == null) missing.push('Valeur de sortie prudente sourcée');
  if (months == null) missing.push('Durée du projet');
  if (threshold == null) missing.push('Rentabilité annuelle minimale exigée');
  if (base != null && downside != null && downside > base) missing.push('La valeur prudente doit rester inférieure ou égale à la valeur centrale');
  const operatingStarted = !!record.operating && Object.entries(record.operating).some(([key, value]) => key !== 'period' && String(value).trim() !== '');
  const operating = operatingStarted && record.operating ? calculateOperatingModel(record.units, record.operating) : null;
  if (operatingStarted && !operating) missing.push('Hypothèses d’exploitation complètes et cohérentes');
  if (operating && operating.prudent.operatingSurplus <= 0) adverse.push('L’exploitation prudente ne couvre pas ses charges annuelles.');
  const baseMarginPct = cost != null && base != null ? (base / cost - 1) * 100 : null;
  const downsideMarginPct = cost != null && downside != null ? (downside / cost - 1) * 100 : null;
  const downsideAnnualReturnPct = cost != null && downside != null && months != null ? (Math.pow(downside / cost, 12 / months) - 1) * 100 : null;
  if (!missing.length && !adverse.length && downsideAnnualReturnPct != null && threshold != null && downsideAnnualReturnPct < threshold)
    adverse.push(`Scénario prudent : ${downsideAnnualReturnPct.toFixed(1)} %/an, sous le seuil exigé de ${threshold.toFixed(1)} %/an.`);
  return { status: adverse.length ? 'a_ecarter' : missing.length ? 'a_documenter' : 'qualifie', missing, adverse, baseMarginPct, downsideMarginPct, downsideAnnualReturnPct, prudentOperatingSurplus: operating?.prudent.operatingSurplus ?? null };
}

/** Ne classe que des variantes du même terrain, avec des preuves complètes. */
export function compareScenarios(items: ScenarioDecision[]): ComparativeDecision {
  const assessments = Object.fromEntries(items.map((item) => [item.id, assessScenario(item.record)]));
  if (items.length < 2) return { status: 'a_documenter', winnerId: null, reason: 'Étudier au moins deux programmes sur le même terrain pour choisir le meilleur.', assessments };
  if (!items[0].parcelId || items.some((item) => item.parcelId !== items[0].parcelId))
    return { status: 'a_documenter', winnerId: null, reason: 'Les scénarios doivent concerner la même référence cadastrale.', assessments };
  if (items.some((item) => assessments[item.id].status === 'a_documenter'))
    return { status: 'a_documenter', winnerId: null, reason: 'Au moins un scénario reste incomplet : aucune priorité finale n’est attribuée.', assessments };
  const variants = new Set(items.map((item) => `${item.programme.trim().toLowerCase()}|${item.record.target.trim().toLowerCase()}|${item.record.programme.trim().toLowerCase()}`));
  if (variants.size < 2) return { status: 'a_documenter', winnerId: null, reason: 'Comparer au moins deux programmes ou clientèles réellement distincts.', assessments };
  const viable = items.filter((item) => assessments[item.id].status === 'qualifie');
  if (!viable.length) return { status: 'aucun_viable', winnerId: null, reason: 'Aucun programme ne passe les conditions documentées et le seuil économique prudent.', assessments };
  viable.sort((a, b) => (assessments[b.id].downsideAnnualReturnPct ?? -Infinity) - (assessments[a.id].downsideAnnualReturnPct ?? -Infinity));
  return { status: 'priorite_conditionnelle', winnerId: viable[0].id,
    reason: `${viable[0].programme} pour ${viable[0].record.target} présente la meilleure rentabilité annuelle prudente parmi les programmes documentés sur ce terrain. La conclusion dépend de la validité des pièces saisies et des autorisations finales.`, assessments };
}
