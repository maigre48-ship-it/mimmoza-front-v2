// src/spaces/promoteur/etudes/marche/engine/smartscore.base.ts

import type {
  SmartScoreResult,
  ScoreComponent,
  Verdict,
  VerdictThresholds,
  ProjectNature,
} from "../types/smartscore.types";
import { DEFAULT_THRESHOLDS } from "../types/smartscore.types";
import { clamp, weightedMean, roundScore } from "../utils/score.utils";

/**
 * Détermine le verdict selon les seuils.
 */
export function computeVerdict(score: number, thresholds: VerdictThresholds = DEFAULT_THRESHOLDS): Verdict {
  const s = clamp(score, 0, 100);
  if (s >= thresholds.go) return "GO";
  if (s >= thresholds.go_with_reserves) return "GO_AVEC_RESERVES";
  if (s >= thresholds.deepen) return "A_APPROFONDIR";
  return "NO_GO";
}

/**
 * Valide et normalise la liste des composants (poids, scores).
 * - weight doit être en 0..1
 * - score en 0..100
 */
export function normalizeComponents(components: ScoreComponent[]): ScoreComponent[] {
  return (components || []).map((c) => ({
    ...c,
    weight: Math.max(0, Math.min(1, c.weight ?? 0)),
    score: clamp(c.score ?? 0, 0, 100),
  }));
}

/**
 * Calcule le score global par agrégation pondérée.
 */
export function computeSmartScore(
  project_nature: ProjectNature,
  components: ScoreComponent[],
  options?: {
    thresholds?: VerdictThresholds;
    version?: string;
    opportunities?: string[];
    risks?: string[];
    recommendations?: string[];
  }
): SmartScoreResult {
  const normalized = normalizeComponents(components);

  const score = weightedMean(
    normalized.map((c) => ({ score: c.score, weight: c.weight }))
  );

  const finalScore = roundScore(score, 0);
  const verdict = computeVerdict(finalScore, options?.thresholds);

  return {
    project_nature,
    score: finalScore,
    verdict,
    components: normalized,
    opportunities: options?.opportunities ?? [],
    risks: options?.risks ?? [],
    recommendations: options?.recommendations ?? [],
    meta: {
      version: options?.version ?? "smartscore-base-v1",
      computed_at: new Date().toISOString(),
    },
  };
}
