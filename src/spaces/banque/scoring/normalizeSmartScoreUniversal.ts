// ============================================================================
// normalizeSmartScoreUniversal.ts
// src/spaces/banque/scoring/normalizeSmartScoreUniversal.ts
//
// Supprime le pilier Documentation du SmartScoreUniversalResult,
// renormalise score/grade/verdict sur les piliers restants.
// Utilisé par AnalysePage et ComitePage pour aligner la notation.
// ============================================================================

import type { SmartScoreUniversalResult } from "./banqueSmartScoreUniversal";

// ── Keys identifiant le pilier Documentation ──
const DOCUMENTATION_KEYS = new Set(["documentation", "doc", "docs", "documents"]);

// ── Grade & verdict — mêmes règles que AnalysePage ──

function computeGrade(score: number): string {
  if (score >= 90) return "A+";
  if (score >= 80) return "A";
  if (score >= 70) return "B";
  if (score >= 60) return "C";
  if (score >= 50) return "D+";
  if (score >= 40) return "D";
  if (score >= 30) return "E";
  return "F";
}

function computeVerdict(score: number): string {
  if (score >= 80) return "favorable";
  if (score >= 60) return "favorable_sous_conditions";
  if (score >= 40) return "réservé";
  return "défavorable";
}

// ── Grade legacy (A–E) pour compatibilité ComitePage / PDF ──
// SmartScoreUniversalResult.grade est typé Grade = "A"|"B"|"C"|"D"|"E"
// On mappe le grade étendu vers ce type.

function toLegacyGrade(extendedGrade: string): "A" | "B" | "C" | "D" | "E" {
  if (extendedGrade === "A+" || extendedGrade === "A") return "A";
  if (extendedGrade === "B") return "B";
  if (extendedGrade === "C") return "C";
  if (extendedGrade === "D+" || extendedGrade === "D") return "D";
  return "E"; // E, F → E
}

/**
 * Supprime les piliers Documentation du résultat SmartScore,
 * renormalise score = round(100 × Σpoints / ΣmaxPoints),
 * et recalcule grade + verdict.
 *
 * Si le résultat est null ou ne contient pas de piliers, retourne tel quel.
 */
export function normalizeSmartScoreUniversal<
  T extends SmartScoreUniversalResult | null,
>(result: T): T {
  if (!result || !result.pillars) return result;

  // Filtrer les piliers Documentation
  const filtered = result.pillars.filter(
    (p) => !DOCUMENTATION_KEYS.has(p.key)
  );

  // Si rien n'a été filtré, retourner tel quel
  if (filtered.length === result.pillars.length) return result;

  // Renormaliser
  let totalPoints = 0;
  let totalMax = 0;

  for (const p of filtered) {
    totalMax += p.maxPoints;
    if (p.hasData !== false) {
      totalPoints += p.points;
    }
  }

  const score = totalMax > 0 ? Math.round((totalPoints / totalMax) * 100) : 0;
  const extGrade = computeGrade(score);
  const verdict = computeVerdict(score);
  const grade = toLegacyGrade(extGrade);

  if (import.meta.env?.DEV) {
    const stripped = result.pillars.length - filtered.length;
    console.log(
      "[normalizeSmartScoreUniversal] Stripped " + stripped + " doc pillar(s). " +
        "Score: " + result.score + " -> " + score + ", Grade: " + result.grade + " -> " + grade
    );
  }

  return {
    ...result,
    pillars: filtered,
    score,
    grade,
    verdict,
  } as T;
}