// src/spaces/promoteur/plan2d/plan.scenarioNotes.ts

import type { ScenarioStatus } from "./plan.scenarios.types";
import type { ScenarioRecommendationLayer } from "./plan.scenarioNotes.types";

// ─── PARAMS ───────────────────────────────────────────────────────────

export interface BuildScenarioRecommendationLayerParams {
  label:         string;
  globalStatus:  ScenarioStatus;
  blockingCount: number;
  limitedCount:  number;
  coverageRatio?: number;
  scoreOverall?:  number;
  recommended?:   boolean;
}

// ─── TITLE ────────────────────────────────────────────────────────────

function deriveTitle(
  status:       ScenarioStatus,
  recommended:  boolean,
  scoreOverall: number | undefined,
): string {
  if (status === "BLOQUANT") return "Schéma à revoir";
  if (status === "LIMITE")   return recommended ? "Schéma viable, ajustements ciblés" : "Schéma limite — vigilance requise";
  // CONFORME
  if (recommended)           return "Schéma recommandé";
  if (scoreOverall !== undefined && scoreOverall >= 80) return "Schéma performant";
  return "Schéma conforme";
}

// ─── SUMMARY ──────────────────────────────────────────────────────────

function deriveSummary(
  status:        ScenarioStatus,
  blockingCount: number,
  limitedCount:  number,
  label:         string,
): string {
  if (status === "BLOQUANT") {
    return `Le schéma « ${label} » présente ${blockingCount} point${blockingCount > 1 ? "s" : ""} bloquant${blockingCount > 1 ? "s" : ""} nécessitant une révision du plan masse avant toute poursuite de l'étude.`;
  }
  if (status === "LIMITE") {
    return `Le schéma « ${label} » est réglementairement recevable mais atteint ${limitedCount} seuil${limitedCount > 1 ? "s" : ""} limite — des ajustements ciblés permettront de sécuriser la faisabilité.`;
  }
  return `Le schéma « ${label} » satisfait l'ensemble des règles PLU analysées et constitue une base solide pour la poursuite de l'étude de faisabilité.`;
}

// ─── STRENGTHS ────────────────────────────────────────────────────────

function deriveStrengths(
  status:        ScenarioStatus,
  blockingCount: number,
  limitedCount:  number,
  coverageRatio: number | undefined,
): string[] {
  if (status === "BLOQUANT") {
    // No meaningful strengths when the scenario is non-compliant
    return [];
  }

  const points: string[] = [];

  if (status === "CONFORME") {
    if (blockingCount === 0 && limitedCount === 0) {
      points.push("Conformité PLU complète — aucun point bloquant ni limite identifié.");
    } else {
      points.push("Absence de non-conformité bloquante — plan masse réglementairement défendable.");
    }
  }

  if (status === "LIMITE" && blockingCount === 0) {
    points.push("Aucun point bloquant — le schéma reste instruisable en l'état.");
  }

  if (coverageRatio !== undefined) {
    const pct = coverageRatio * 100;
    if (pct >= 40 && pct <= 65) {
      points.push(`Efficience foncière satisfaisante (CES ${pct.toFixed(0)} %) — bon équilibre entre densité et contraintes réglementaires.`);
    } else if (pct < 40 && pct > 0) {
      points.push(`Emprise mesurée (CES ${pct.toFixed(0)} %) — marge disponible pour un ajustement du programme.`);
    }
  }

  if (limitedCount === 0 && status !== "BLOQUANT") {
    points.push("Absence de règle en situation limite — schéma stable face aux ajustements de programme courants.");
  }

  return points.slice(0, 3);
}

// ─── VIGILANCE ────────────────────────────────────────────────────────

function deriveVigilance(
  status:        ScenarioStatus,
  blockingCount: number,
  limitedCount:  number,
  coverageRatio: number | undefined,
): string[] {
  const points: string[] = [];

  if (blockingCount > 0) {
    points.push(
      `${blockingCount} point${blockingCount > 1 ? "s" : ""} bloquant${blockingCount > 1 ? "s" : ""} identifié${blockingCount > 1 ? "s" : ""} — correction indispensable avant instruction.`,
    );
  }

  if (limitedCount > 0) {
    points.push(
      `${limitedCount} règle${limitedCount > 1 ? "s" : ""} en situation limite — toute modification du programme devra être vérifiée systématiquement.`,
    );
  }

  if (coverageRatio !== undefined) {
    const pct = coverageRatio * 100;
    if (pct > 70) {
      points.push(`Taux d'emprise élevé (${pct.toFixed(0)} %) — vérifier le CES autorisé par le règlement de zone avant validation comité.`);
    } else if (pct > 58 && status !== "BLOQUANT") {
      points.push(`CES proche du maximum (${pct.toFixed(0)} %) — anticiper l'impact de tout ajustement de gabarit.`);
    }
  }

  if (points.length === 0 && status === "CONFORME") {
    points.push("Maintenir les paramètres actuels lors de tout ajustement du programme ou du plan masse.");
  }

  return points.slice(0, 3);
}

// ─── NEXT ACTION ──────────────────────────────────────────────────────

function deriveNextAction(
  status:       ScenarioStatus,
  recommended:  boolean,
  blockingCount: number,
): string {
  if (status === "BLOQUANT") {
    return `Corriger les ${blockingCount} point${blockingCount > 1 ? "s" : ""} bloquant${blockingCount > 1 ? "s" : ""} identifié${blockingCount > 1 ? "s" : ""} (recul, gabarit, emprise) avant toute validation comité ou engagement financier.`;
  }
  if (status === "LIMITE") {
    return recommended
      ? "Affiner les paramètres limites avec l'architecte et valider la conformité avant soumission au service instructeur."
      : "Vérifier les seuils limites et comparer avec le scénario recommandé avant de poursuivre l'étude financière.";
  }
  // CONFORME
  return recommended
    ? "Poursuivre l'étude de faisabilité financière et initier le pré-dimensionnement architectural."
    : "Poursuivre l'analyse ou arbitrer avec le scénario recommandé selon les objectifs du programme.";
}

// ─── MAIN FUNCTION ────────────────────────────────────────────────────

/**
 * Builds a structured recommendation layer for a single implantation scenario.
 *
 * Pure function — deterministic, no side-effects, no mutation.
 * Uses only the fields explicitly provided in params.
 * Wording is prudent and business-readable — no legal certainty implied.
 */
export function buildScenarioRecommendationLayer(
  params: BuildScenarioRecommendationLayerParams,
): ScenarioRecommendationLayer {
  const {
    label,
    globalStatus,
    blockingCount,
    limitedCount,
    coverageRatio,
    scoreOverall,
    recommended = false,
  } = params;

  return {
    title:           deriveTitle(globalStatus, recommended, scoreOverall),
    summary:         deriveSummary(globalStatus, blockingCount, limitedCount, label),
    strengths:       deriveStrengths(globalStatus, blockingCount, limitedCount, coverageRatio),
    vigilancePoints: deriveVigilance(globalStatus, blockingCount, limitedCount, coverageRatio),
    nextAction:      deriveNextAction(globalStatus, recommended, blockingCount),
  };
}