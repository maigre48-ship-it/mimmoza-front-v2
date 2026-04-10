// src/spaces/promoteur/plan2d/plan.scenarioScore.ts

import type { ImplantationScenarioMetrics, ScenarioStatus, ImplantationScenario } from "./plan.scenarios.types";
import type { ScenarioScoreBreakdown, ScenarioScoreResult } from "./plan.scenarioScore.types";

// ─── WEIGHTS ──────────────────────────────────────────────────────────

const W = {
  regulatory:          0.50,
  footprintEfficiency: 0.30,
  simplicity:          0.20,
} as const;

// ─── CLAMP ────────────────────────────────────────────────────────────

function clamp(v: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, v));
}

// ─── DIMENSION: REGULATORY ────────────────────────────────────────────
//
// CONFORME + no violations              → 100
// CONFORME + limited violations         →  80
// LIMITE + no blocking                  →  55
// BLOQUANT (any blocking)               →  [0, 30] depending on count

function scoreRegulatory(
  status:       ScenarioStatus,
  blockingCount: number,
  limitedCount:  number,
): number {
  if (status === "BLOQUANT") {
    // Each blocking issue cuts 10 points from a 30-point ceiling
    return clamp(30 - blockingCount * 10);
  }
  if (status === "LIMITE") {
    // Moderate penalty per limited rule
    return clamp(55 - limitedCount * 8);
  }
  // CONFORME — minor deduction for any limited rules
  return clamp(100 - limitedCount * 10);
}

// ─── DIMENSION: FOOTPRINT EFFICIENCY ──────────────────────────────────
//
// Rewards scenarios that use the buildable land well (high CES) without
// exceeding the PLU ceiling. A BLOQUANT scenario cannot score high here
// even if its raw CES would suggest it — the violation negates the gain.
//
// Ideal range: CES 40–65 %       → 80–100 pts
// Under-used:  CES < 25 %        → 30–50 pts
// Over-used:   CES > 70 %        → hard penalty

function scoreFootprintEfficiency(
  coverageRatio: number,
  status:        ScenarioStatus,
): number {
  const pct = coverageRatio * 100; // percentage

  // BLOQUANT scenarios: footprint over the legal limit — cap at 20
  if (status === "BLOQUANT") return clamp(20 - Math.max(0, pct - 70) * 1.5);

  // Piece-wise linear scoring
  if (pct >= 55 && pct <= 65)  return 100;
  if (pct >= 40 && pct < 55)   return clamp(80 + (pct - 40) * (20 / 15));
  if (pct > 65  && pct <= 70)  return clamp(100 - (pct - 65) * 8);
  if (pct > 70  && pct <= 80)  return clamp(60 - (pct - 70) * 3);
  if (pct > 80)                 return clamp(30 - (pct - 80) * 2);
  // pct < 40
  return clamp(30 + pct * (50 / 40));
}

// ─── DIMENSION: SIMPLICITY ────────────────────────────────────────────
//
// Fewer buildings → lower construction coordination risk → higher score.
// 1 building → 100, 2 → 85, 3 → 70, 4 → 55, 5+ → 40, 8+ → 20
// Zero buildings → 0 (degenerate scenario)

function scoreSimplicity(buildingCount: number): number {
  if (buildingCount === 0)  return 0;
  if (buildingCount === 1)  return 100;
  if (buildingCount === 2)  return 85;
  if (buildingCount === 3)  return 70;
  if (buildingCount === 4)  return 55;
  if (buildingCount <= 7)   return 40;
  return 20;
}

// ─── RATIONALE BUILDER ────────────────────────────────────────────────

function buildRationale(
  bd:           ScenarioScoreBreakdown,
  status:       ScenarioStatus,
  blockingCount: number,
  limitedCount:  number,
  coverageRatio: number,
  buildingCount: number,
): string[] {
  const lines: string[] = [];

  // Regulatory
  if (status === "CONFORME" && limitedCount === 0) {
    lines.push(`Conformité réglementaire complète (${Math.round(bd.regulatory)}/100) — aucun point bloquant ni limite identifié.`);
  } else if (status === "CONFORME") {
    lines.push(`Conformité générale satisfaisante (${Math.round(bd.regulatory)}/100) avec ${limitedCount} point${limitedCount > 1 ? "s" : ""} limite à surveiller.`);
  } else if (status === "LIMITE") {
    lines.push(`Conformité marginale (${Math.round(bd.regulatory)}/100) — ${limitedCount} règle${limitedCount > 1 ? "s" : ""} en limite, aucune non-conformité bloquante.`);
  } else {
    lines.push(`Non-conformité détectée (${Math.round(bd.regulatory)}/100) — ${blockingCount} point${blockingCount > 1 ? "s" : ""} bloquant${blockingCount > 1 ? "s" : ""} à corriger avant toute validation.`);
  }

  // Footprint efficiency
  const pct = (coverageRatio * 100).toFixed(1);
  if (bd.footprintEfficiency >= 85) {
    lines.push(`Efficience foncière optimale (${Math.round(bd.footprintEfficiency)}/100) — CES de ${pct} % dans la plage idéale de valorisation.`);
  } else if (bd.footprintEfficiency >= 60) {
    lines.push(`Efficience foncière correcte (${Math.round(bd.footprintEfficiency)}/100) — CES de ${pct} %, marge d'optimisation possible.`);
  } else if (coverageRatio < 0.30) {
    lines.push(`Sous-densification observée (${Math.round(bd.footprintEfficiency)}/100) — CES de ${pct} % laisse une réserve foncière significative.`);
  } else {
    lines.push(`Efficience foncière dégradée (${Math.round(bd.footprintEfficiency)}/100) — CES de ${pct} % proche ou au-delà du seuil réglementaire.`);
  }

  // Simplicity
  if (buildingCount <= 2) {
    lines.push(`Programme épuré (${Math.round(bd.simplicity)}/100) — ${buildingCount} bâtiment${buildingCount > 1 ? "s" : ""}, faible complexité de réalisation.`);
  } else if (buildingCount <= 4) {
    lines.push(`Complexité maîtrisée (${Math.round(bd.simplicity)}/100) — ${buildingCount} bâtiments, coordination standard.`);
  } else {
    lines.push(`Programme fragmenté (${Math.round(bd.simplicity)}/100) — ${buildingCount} bâtiments augmentent la complexité opérationnelle et les coûts de coordination.`);
  }

  return lines;
}

// ─── MAIN SCORING FUNCTION ────────────────────────────────────────────

export interface ScoreScenarioParams {
  globalStatus:  ScenarioStatus;
  metrics:       ImplantationScenarioMetrics;
}

/**
 * Computes a transparent, weighted score for a single implantation scenario.
 *
 * Scores are 0–100 per dimension. The overall score is a weighted sum.
 * All formulas are documented above — no black-box logic.
 *
 * Pure function — deterministic, no side-effects, no mutation.
 */
export function scoreScenario(params: ScoreScenarioParams): ScenarioScoreResult {
  const { globalStatus, metrics } = params;

  const regulatory          = scoreRegulatory(globalStatus, metrics.blockingCount, metrics.limitedCount);
  const footprintEfficiency = scoreFootprintEfficiency(metrics.coverageRatio, globalStatus);
  const simplicity          = scoreSimplicity(metrics.buildingCount);

  const overall = clamp(
    Math.round(
      regulatory          * W.regulatory +
      footprintEfficiency * W.footprintEfficiency +
      simplicity          * W.simplicity,
    ),
  );

  const breakdown: ScenarioScoreBreakdown = {
    regulatory:          Math.round(regulatory),
    footprintEfficiency: Math.round(footprintEfficiency),
    simplicity:          Math.round(simplicity),
    overall,
  };

  const rationale = buildRationale(
    breakdown,
    globalStatus,
    metrics.blockingCount,
    metrics.limitedCount,
    metrics.coverageRatio,
    metrics.buildingCount,
  );

  return { breakdown, rationale };
}

// ─── RANKING ──────────────────────────────────────────────────────────

/**
 * Sorts scenarios by descending overall score and attaches 1-based ranks.
 *
 * Ties are broken by regulatory score (higher = better), then by
 * footprintEfficiency. Stable sort within same score.
 *
 * Pure — returns a new array, never mutates input.
 */
export function rankScenarios(
  scores: { scenarioId: string; result: ScenarioScoreResult }[],
): { scenarioId: string; result: ScenarioScoreResult }[] {
  return [...scores]
    .sort((a, b) => {
      const da = a.result.breakdown;
      const db = b.result.breakdown;
      if (db.overall !== da.overall) return db.overall - da.overall;
      if (db.regulatory !== da.regulatory) return db.regulatory - da.regulatory;
      return db.footprintEfficiency - da.footprintEfficiency;
    })
    .map((item, i) => ({
      ...item,
      result: { ...item.result, rank: i + 1 },
    }));
}

/**
 * Attaches scores and ranks to a list of scenarios.
 *
 * Returns a new array — input scenarios are never mutated.
 *
 * Usage:
 *   const scored = applyScenarioScores(rawScenarios);
 */
export function applyScenarioScores(
  scenarios: ImplantationScenario[],
): ImplantationScenario[] {
  // Compute raw scores
  const rawScores = scenarios.map(s => ({
    scenarioId: s.id,
    result:     scoreScenario({ globalStatus: s.globalStatus, metrics: s.metrics }),
  }));

  // Rank them
  const ranked = rankScenarios(rawScores);
  const byId   = new Map(ranked.map(r => [r.scenarioId, r.result]));

  // Attach to scenarios
  return scenarios.map(s => ({
    ...s,
    score: byId.get(s.id),
  }));
}

/**
 * Returns the id of the highest-scoring scenario, or null for an empty list.
 */
export function getBestScoringScenarioId(
  scenarios: ImplantationScenario[],
): string | null {
  if (!scenarios.length) return null;
  const scored = applyScenarioScores(scenarios);
  const best   = scored.reduce<ImplantationScenario | null>((acc, s) => {
    if (!acc) return s;
    const aScore = acc.score?.breakdown.overall ?? -1;
    const bScore = s.score?.breakdown.overall   ?? -1;
    return bScore > aScore ? s : acc;
  }, null);
  return best?.id ?? null;
}