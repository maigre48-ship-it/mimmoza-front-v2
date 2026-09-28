import { assessScenario, compareScenarios, emptyDecisionRecord, type DecisionRecord } from './decisionDossier.ts';
import { readSector, SCREENING_SECTORS, type SectorSnapshot } from './sectorScreening.ts';
import type { ProjectRecommendation } from './projectRecommendation.ts';
import { summarizeOperatorFollowups, type OperatorFollowUp } from './operatorFollowup.ts';

type ScenarioSummary = { id: string; parcelId: string; programme: string; candidates?: { siren: string; nom: string }[] };
type ScreeningSummary = { date: string; snapshots: SectorSnapshot[]; recommendation?: ProjectRecommendation | null };
type Input = { parcelId: string; address: string; insee: string; surfaceM2: string; pluZone?: string | null;
  screening: ScreeningSummary | null; screeningIsCurrent: boolean; scenarios: ScenarioSummary[]; decisions: Record<string, DecisionRecord>;
  operatorFollowups?: Record<string, Record<string, OperatorFollowUp>> };
type Snapshot = Record<string, string | number | null>;
const short = (value: string | undefined | null, max = 280) => value?.trim().slice(0, max) || null;

/** Données déjà affichées sur la page ; chaque constat garde sa source et son périmètre. */
export function buildStrategyCopilotSnapshot(input: Input): Snapshot {
  const snapshot: Snapshot = {
    page: 'Promoteur · Stratégie de projet', parcelle: short(input.parcelId), adresse: short(input.address),
    commune_insee: short(input.insee), surface_terrain_m2: Number(input.surfaceM2.replace(',', '.')) > 0 ? Number(input.surfaceM2.replace(',', '.')) : null,
    zone_plu_a_verifier: short(input.pluZone),
    regle_de_lecture: 'Les indicateurs communaux ou départementaux décrivent un contexte. Ils ne prouvent ni la demande du projet, ni sa constructibilité, ni sa rentabilité.',
  };
  if (input.screening && input.screeningIsCurrent) {
    snapshot.date_exploration = input.screening.date.slice(0, 10);
    const recommendation = input.screening.recommendation;
    if (recommendation) {
      snapshot.piste_a_instruire = recommendation.projectKey ? SCREENING_SECTORS.find((sector) => sector.key === recommendation.projectKey)?.label ?? null : null;
      snapshot.statut_recommandation = short(recommendation.status);
      snapshot.cible_a_tester = short(recommendation.target);
      snapshot.programme_initial = short(recommendation.programme);
      snapshot.raison_de_la_piste = short(recommendation.rationale, 500);
      snapshot.alternatives_a_etudier = short(recommendation.alternatives.map((item) => SCREENING_SECTORS.find((sector) => sector.key === item.key)?.label ?? item.key).join(', '));
      snapshot.conditions_de_validation = short(recommendation.conditions.slice(0, 4).join(' ; '), 500);
    }
    for (const sector of input.screening.snapshots) {
      const reading = readSector(sector);
      snapshot[`usage_${sector.key}`] = `${reading.label} : ${reading.facts.slice(0, 3).map((fact) => `${fact.label} ${fact.value} (${fact.scope} ; ${fact.source} ; ${fact.direct ? 'mesure sectorielle' : 'contexte'})`).join(' ; ') || 'aucune mesure exploitable'}. À prouver : ${reading.missing.slice(0, 2).join(' ; ')}`.slice(0, 650);
    }
  } else snapshot.exploration = 'Aucune exploration à jour pour les paramètres actuels du terrain.';
  const decisions = input.scenarios.map((scenario) => ({ ...scenario, record: input.decisions[scenario.id] ?? emptyDecisionRecord() }));
  for (const [index, scenario] of decisions.entries()) {
    const assessment = assessScenario(scenario.record);
    snapshot[`scenario_${index + 1}`] = `${scenario.programme} ; cible : ${short(scenario.record.target) ?? 'à définir'} ; programme : ${short(scenario.record.programme) ?? 'à définir'} ; unités : ${short(scenario.record.units) ?? 'à vérifier'} ; statut : ${assessment.status} ; preuves manquantes : ${assessment.missing.slice(0, 4).join(', ') || 'aucune'}`.slice(0, 600);
    const followups = input.operatorFollowups?.[scenario.id] ?? {};
    const summary = summarizeOperatorFollowups(followups, Object.keys(followups));
    snapshot[`operateurs_scenario_${index + 1}`] = `${scenario.candidates?.length ?? 0} entreprises repérées dans le registre (intérêt non vérifié) ; ${summary.contacted} contactés ; ${summary.interests.length} intérêts datés et sourcés ; ${summary.refusals} refus.`;
  }
  if (decisions.length) {
    const comparison = compareScenarios(decisions);
    snapshot.conclusion_comparative = `${comparison.status} : ${comparison.reason}`.slice(0, 500);
  }
  return snapshot;
}
