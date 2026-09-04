// ──────────────────────────────────────────────────────────────────────────────
// predictive.types.ts — RÉEXPORT du contrat partagé
// ──────────────────────────────────────────────────────────────────────────────
//
// Les types du moteur prédictif vivent désormais dans
//   supabase/functions/_shared/predictive/types.ts
// parce que le moteur tourne des DEUX côtés : dans le front (page Analyse
// prédictive) et dans les edge functions (outil get_analyse_predictive du
// copilote). Deux copies auraient divergé — c'est exactement ce qui s'était
// produit ailleurs dans ce projet, avec quatre médianes DVF différentes.
//
// Ce fichier ne subsiste que pour ne pas casser la trentaine d'imports
// existants en `@/spaces/investisseur/services/predictive/predictive.types`.
// N'y ajoute AUCUN type : le contrat se modifie dans le fichier partagé.
// ──────────────────────────────────────────────────────────────────────────────

export type {
  PredictiveMarketRegime,
  PredictiveDriverDirection,
  PredictivePoint,
  PredictiveScenario,
  PredictiveDriver,
  PredictiveDataSource,
  PredictiveAnalysisSnapshot,
  PredictivePlu,
  PredictiveGeorisques,
  PredictiveFiscalite,
  PredictiveEngineInput,
} from "@shared/predictive/types.ts";
