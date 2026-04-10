// src/spaces/promoteur/plan2d/plan.bestSuggestion.ts

import type { ImplantationScenario } from "./plan.scenarios.types";
import type {
  BestImplantationSuggestion,
  SuggestionConfidence,
} from "./plan.bestSuggestion.types";

// ─── SCORING THRESHOLDS ───────────────────────────────────────────────

const MIN_SCORE_FOR_SOLIDE = 72;  // overall score ≥ 72 to warrant SOLIDE confidence
const MIN_SCORE_FOR_MODERE = 45;  // overall score ≥ 45 for MODERE
const SCORE_GAP_THRESHOLD  = 8;   // gap between best and runner-up required for clarity

// ─── CANDIDATE SELECTION ──────────────────────────────────────────────

/**
 * Selects the most promising scenario using a priority order:
 *
 *   1. Exclude BLOQUANT scenarios entirely.
 *   2. Among remaining, pick the highest overall score.
 *   3. Tie-break: lowest blockingCount, then lowest limitedCount.
 *
 * Returns null when all scenarios are BLOQUANT or the list is empty.
 */
function selectBestCandidate(
  scenarios: ImplantationScenario[],
): ImplantationScenario | null {
  const eligible = scenarios.filter(s => s.globalStatus !== "BLOQUANT");
  if (!eligible.length) return null;

  return eligible.reduce<ImplantationScenario>((best, s) => {
    const bScore = best.score?.breakdown.overall ?? 0;
    const sScore = s.score?.breakdown.overall    ?? 0;
    if (sScore > bScore) return s;
    if (sScore === bScore) {
      if (s.metrics.blockingCount < best.metrics.blockingCount) return s;
      if (s.metrics.limitedCount  < best.metrics.limitedCount)  return s;
    }
    return best;
  }, eligible[0]);
}

// ─── CONFIDENCE DERIVATION ────────────────────────────────────────────

function deriveConfidence(
  best:       ImplantationScenario,
  runnerUp:   ImplantationScenario | undefined,
): SuggestionConfidence {
  const bestScore = best.score?.breakdown.overall ?? 0;
  const gapScore  = runnerUp
    ? bestScore - (runnerUp.score?.breakdown.overall ?? 0)
    : 100; // single candidate → always clear

  if (
    best.globalStatus === "CONFORME" &&
    bestScore >= MIN_SCORE_FOR_SOLIDE &&
    gapScore >= SCORE_GAP_THRESHOLD &&
    best.metrics.blockingCount === 0 &&
    best.metrics.limitedCount  <= 1
  ) {
    return "SOLIDE";
  }

  if (
    bestScore >= MIN_SCORE_FOR_MODERE &&
    best.metrics.blockingCount === 0
  ) {
    return "MODERE";
  }

  return "PRUDENT";
}

// ─── TITLE ────────────────────────────────────────────────────────────

function deriveTitle(
  best:       ImplantationScenario,
  confidence: SuggestionConfidence,
): string {
  if (confidence === "SOLIDE") return "Variante suggérée — option la plus équilibrée";
  if (confidence === "MODERE") return "Variante préférable à ce stade — à affiner";
  return "Orientation préliminaire — lecture à confirmer";
}

// ─── SUMMARY ──────────────────────────────────────────────────────────

function deriveSummary(
  best:       ImplantationScenario,
  confidence: SuggestionConfidence,
  totalCount: number,
): string {
  const scoreStr  = best.score ? ` (score ${best.score.breakdown.overall}/100)` : "";
  const countStr  = totalCount > 1 ? ` parmi ${totalCount} scénarios analysés` : "";

  if (confidence === "SOLIDE") {
    return `Le scénario « ${best.label} »${scoreStr} est la variante la plus équilibrée${countStr} — conformité PLU satisfaisante et programme optimisé.`;
  }
  if (confidence === "MODERE") {
    return `Le scénario « ${best.label} »${scoreStr} se distingue${countStr} — recevable réglementairement, des ajustements ciblés renforceront la faisabilité.`;
  }
  return `Le scénario « ${best.label} »${scoreStr} est le mieux positionné${countStr} à ce stade, sans certitude — la prudence est recommandée avant tout engagement.`;
}

// ─── KEY REASONS ──────────────────────────────────────────────────────

function deriveKeyReasons(
  best:       ImplantationScenario,
  runnerUp:   ImplantationScenario | undefined,
): string[] {
  const reasons: string[] = [];

  if (best.globalStatus === "CONFORME") {
    reasons.push("Conformité PLU complète — aucun point bloquant identifié.");
  } else if (best.metrics.blockingCount === 0) {
    reasons.push("Absence de non-conformité bloquante — schéma instruisable en l'état.");
  }

  if (best.score) {
    const s = best.score.breakdown;
    if (s.regulatory >= 75) {
      reasons.push(`Qualité réglementaire solide (${s.regulatory}/100) — base fiable pour l'instruction.`);
    }
    if (s.footprintEfficiency >= 70) {
      reasons.push(`Efficience foncière satisfaisante (${s.footprintEfficiency}/100) — bon usage du gabarit disponible.`);
    }
    if (s.overall >= MIN_SCORE_FOR_SOLIDE) {
      reasons.push(`Score global de ${s.overall}/100 — meilleur équilibre entre conformité, densité et simplicité.`);
    }
  }

  if (runnerUp && best.score && runnerUp.score) {
    const gap = best.score.breakdown.overall - runnerUp.score.breakdown.overall;
    if (gap >= SCORE_GAP_THRESHOLD) {
      reasons.push(`Avance de ${gap} points sur la variante suivante — différenciation significative.`);
    }
  }

  if (best.metrics.limitedCount === 0 && best.metrics.blockingCount === 0) {
    reasons.push("Aucun seuil limite atteint — marge de manœuvre préservée pour les ajustements de programme.");
  }

  return reasons.slice(0, 4);
}

// ─── VIGILANCE POINTS ─────────────────────────────────────────────────

function deriveVigilancePoints(
  best:       ImplantationScenario,
  confidence: SuggestionConfidence,
): string[] {
  const points: string[] = [];

  if (best.metrics.limitedCount > 0) {
    points.push(
      `${best.metrics.limitedCount} règle${best.metrics.limitedCount > 1 ? "s" : ""} en situation limite — tout ajustement du programme devra être vérifié.`,
    );
  }

  const ces = best.metrics.coverageRatio;
  if (ces > 0.58) {
    points.push(`CES de ${(ces * 100).toFixed(0)} % — marge réduite, toute extension de gabarit est à proscrire.`);
  }

  if (confidence === "PRUDENT") {
    points.push("Suggestion préliminaire — à confirmer par une lecture réglementaire détaillée avant validation comité.");
  }

  if (best.globalStatus === "LIMITE") {
    points.push("Schéma en situation limite — valider avec le service instructeur avant dépôt.");
  }

  if (!points.length) {
    points.push("Conserver les paramètres actuels lors de tout ajustement du plan masse.");
  }

  return points.slice(0, 3);
}

// ─── NEXT ACTION ──────────────────────────────────────────────────────

function deriveNextAction(
  best:       ImplantationScenario,
  confidence: SuggestionConfidence,
): string {
  if (confidence === "SOLIDE") {
    return `Consolider le scénario « ${best.label} » avec l'architecte et initier le bilan promoteur détaillé.`;
  }
  if (confidence === "MODERE") {
    return `Approfondir l'analyse de la variante « ${best.label} » — affiner les seuils limites avant validation comité.`;
  }
  return `Affiner le programme et comparer les variantes en détail avant tout engagement sur la variante « ${best.label} ».`;
}

// ─── NO-CANDIDATE RESULT ──────────────────────────────────────────────

function buildNoCandidateResult(
  allBloquant: boolean,
): BestImplantationSuggestion {
  return {
    scenarioId:      null,
    title:           allBloquant
      ? "Aucune variante conforme — révision requise"
      : "Aucun scénario disponible",
    summary:         allBloquant
      ? "Tous les scénarios présentent des non-conformités bloquantes. Une révision du plan masse est indispensable avant toute poursuite de l'étude."
      : "Aucun scénario n'est disponible pour l'analyse. Positionnez des bâtiments sur le plan masse pour démarrer l'évaluation.",
    confidenceLabel: "PRUDENT",
    keyReasons:      [],
    vigilancePoints: allBloquant
      ? ["Corriger les points bloquants identifiés avant toute validation comité."]
      : [],
    nextAction: allBloquant
      ? "Réviser le plan masse pour corriger les non-conformités PLU avant de relancer l'analyse."
      : "Définir une parcelle et positionner des bâtiments pour générer une analyse d'implantation.",
  };
}

// ─── MAIN FUNCTION ────────────────────────────────────────────────────

/**
 * Builds a transparent best-implantation suggestion from a set of scenarios.
 *
 * Pure function — deterministic, no side-effects, no mutation.
 * Uses only fields already available on ImplantationScenario.
 * Wording is prudent and business-readable throughout.
 */
export function buildBestImplantationSuggestion(params: {
  scenarios: ImplantationScenario[];
}): BestImplantationSuggestion {
  const { scenarios } = params;

  if (!scenarios.length) return buildNoCandidateResult(false);

  const best = selectBestCandidate(scenarios);
  if (!best) {
    return buildNoCandidateResult(true); // all BLOQUANT
  }

  // Runner-up: second-highest scoring eligible scenario
  const others   = scenarios.filter(s => s.id !== best.id && s.globalStatus !== "BLOQUANT");
  const runnerUp = others.length > 0
    ? others.reduce((a, b) =>
        (b.score?.breakdown.overall ?? 0) > (a.score?.breakdown.overall ?? 0) ? b : a,
        others[0])
    : undefined;

  const confidence = deriveConfidence(best, runnerUp);

  return {
    scenarioId:      best.id,
    title:           deriveTitle(best, confidence),
    summary:         deriveSummary(best, confidence, scenarios.length),
    confidenceLabel: confidence,
    keyReasons:      deriveKeyReasons(best, runnerUp),
    vigilancePoints: deriveVigilancePoints(best, confidence),
    nextAction:      deriveNextAction(best, confidence),
  };
}