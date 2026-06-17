// Point d'entrée unique du moteur d'explication.
export * from "./explainability.types";
export {
  buildValuationExplanation,
  buildOpportunityExplanation,
  buildMimmozaDecision,
  selectPositive,
  selectNegative,
} from "./explainability.service";
export {
  knowledgeGraphFactors,
  explainFromKnowledgeGraph,
  mapKnowledgeGraphToSignals,
  type KnowledgeGraphSignal,
  type RawKnowledgeGraph,
} from "./knowledgeExplain.service";