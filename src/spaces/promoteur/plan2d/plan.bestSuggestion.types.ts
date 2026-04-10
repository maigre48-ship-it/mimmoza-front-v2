// src/spaces/promoteur/plan2d/plan.bestSuggestion.types.ts

/**
 * Confidence level for the best-implantation suggestion.
 *
 * PRUDENT  — data is insufficient or scenarios are very similar.
 *             Wording emphasises that further study is required.
 * MODERE   — one scenario stands out but has some compliance issues.
 *             Wording is positive with clear caveats.
 * SOLIDE   — a scenario is clearly preferable across all dimensions.
 *             Wording is more affirmative, still prudent.
 *
 * Extensibility: add "FORT" for future cases with financial confirmation.
 */
export type SuggestionConfidence = "PRUDENT" | "MODERE" | "SOLIDE";

/**
 * The output of the best-implantation suggestion engine.
 *
 * All string fields are business-readable French, suitable for direct
 * display in panels, exports, and committee documents.
 *
 * Extensibility roadmap:
 *   financialSignal?    — "FAVORABLE" | "TENDU" from financial bridge
 *   competingScenarios? — string[] of close runner-ups
 *   scoreGap?           — score delta between best and second-best
 *   articleRef?         — PLU article driving the main compliance issue
 */
export interface BestImplantationSuggestion {
  /**
   * Id of the suggested scenario, or null when no scenario qualifies
   * (e.g. all BLOQUANT, or no scenarios provided).
   */
  scenarioId:      string | null;
  /** Short decision-oriented title (≤ 10 words). */
  title:           string;
  /** One-sentence synthesis of the suggestion rationale. */
  summary:         string;
  /** Confidence level — drives visual treatment and wording tone. */
  confidenceLabel: SuggestionConfidence;
  /** 2–4 concise reasons supporting this scenario choice. */
  keyReasons:      string[];
  /** 2–3 risk or vigilance points the reader must monitor. */
  vigilancePoints: string[];
  /** Concrete next step for the project team. */
  nextAction:      string;
}