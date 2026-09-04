// =============================================================================
// SEUILS DE DÉCISION — barème unique pour les scores sur 100
// =============================================================================
//
// Ce que l'audit a trouvé
// -----------------------
// Six barèmes GO / NO-GO coexistaient pour des scores exprimés sur la même
// échelle de 0 à 100 :
//
//   components/sourcing/SmartScorePanel.tsx        GO ≥ 65,  conditions ≥ 40
//   spaces/sourcing/pages/SourcingHomePage.tsx     GO ≥ 65,  conditions ≥ 40
//   services/opportunity/opportunityEngine.ts      GO ≥ 65,  conditions ≥ 50
//   spaces/marchand/scoring/sourcingSmartScore     GO ≥ 70,  WATCH ≥ 50
//   deal-center/tabs/CommitteeReviewTab.tsx        GO ≥ 70,  NO_GO < 40
//   promoteur/etudes/marche/types/smartscore       GO ≥ 75,  réserves ≥ 60
//
// Un score de 68 était donc simultanément « GO » pour l'utilisateur du
// sourcing, « WATCH » pour le moteur marchand et « GO_AVEC_RESERVES » pour le
// promoteur — sur le même bien, dans la même session.
//
// Ce que ce module fige, et ce qu'il ne décide pas
// -----------------------------------------------
// Les valeurs retenues sont celles déjà MAJORITAIRES dans le code (GO ≥ 65,
// réserves ≥ 40) : aucune n'est inventée. Mais contrairement à un coefficient
// de surface, un seuil de décision est un ARBITRAGE MÉTIER, pas une constante
// physique. Aligner sur la valeur majoritaire assouplit mécaniquement les deux
// barèmes qui étaient à 70 et le seul qui était à 75.
//
// C'est un choix à valider par le métier. L'intérêt de ce module est qu'il
// devient révisable en un seul endroit : changer GO_SCORE ci-dessous
// repropage la décision sur tous les écrans, ce qui était impossible avant.
//
// Le vocabulaire des verdicts reste propre à chaque espace (GO / WATCH / NO_GO
// côté marchand, GO / GO_AVEC_RESERVES / NO_GO côté sourcing…) : seuls les
// SEUILS sont mutualisés, pas les libellés affichés.
// =============================================================================

/** Score à partir duquel une opportunité est recommandée sans réserve. */
export const GO_SCORE = 65;

/** Score à partir duquel elle reste envisageable, sous conditions. */
export const CONDITIONS_SCORE = 40;

/** Verdict canonique, indépendant du vocabulaire d'affichage de chaque espace. */
export type DecisionLevel = 'go' | 'conditions' | 'no_go';

/** Niveau de décision correspondant à un score sur 100. */
export function decisionLevel(score: number): DecisionLevel {
  const s = Number(score) || 0;
  if (s >= GO_SCORE) return 'go';
  if (s >= CONDITIONS_SCORE) return 'conditions';
  return 'no_go';
}

// ─── Grades ──────────────────────────────────────────────────────────────────
//
// L'échelle A/B/C/D/E était déjà cohérente entre les deux écrans qui
// l'affichaient (80 / 65 / 50 / 35). Elle est rapatriée ici pour qu'elle le
// reste, et parce que sa borne B coïncide avec GO_SCORE — ce n'est pas un
// hasard, un bien noté B ou mieux est un bien recommandé.

export type ScoreGrade = 'A' | 'B' | 'C' | 'D' | 'E';

export const GRADE_A_SCORE = 80;
export const GRADE_C_SCORE = 50;
export const GRADE_D_SCORE = 35;

/** Grade correspondant à un score sur 100. */
export function scoreGrade(score: number): ScoreGrade {
  const s = Number(score) || 0;
  if (s >= GRADE_A_SCORE) return 'A';
  if (s >= GO_SCORE) return 'B';
  if (s >= GRADE_C_SCORE) return 'C';
  if (s >= GRADE_D_SCORE) return 'D';
  return 'E';
}
