// src/spaces/promoteur/plan2d/plan.scenarioScore.types.ts

export interface ScenarioScoreBreakdown {
  regulatory:          number;
  footprintEfficiency: number;
  simplicity:          number;
  overall:             number;
}

export interface ScenarioScoreResult {
  breakdown: ScenarioScoreBreakdown;
  rationale: string[];
  rank?:     number;
}