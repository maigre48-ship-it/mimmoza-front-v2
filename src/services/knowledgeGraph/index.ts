// ============================================================================
// Knowledge Graph — API interne publique
// ============================================================================

import type { KnowledgeGraphContext, KnowledgeSnapshot, Explanation } from './knowledgeGraph.types';
import { buildParcelGraph } from './builders/parcelGraph.builder';
import { buildOpportunityGraph } from './builders/opportunityGraph.builder';
import { buildValuationGraph } from './builders/valuationGraph.builder';
import { explainParcel, explainOpportunity, explainValuation } from './knowledgeExplain.service';

// --- Exports directs (signature : (key, ctx)) --------------------------------
export { buildParcelGraph } from './builders/parcelGraph.builder';
export { buildOpportunityGraph } from './builders/opportunityGraph.builder';
export { buildValuationGraph } from './builders/valuationGraph.builder';
export { explainParcel, explainOpportunity, explainValuation } from './knowledgeExplain.service';

// --- Primitives bas niveau (optionnel) ---------------------------------------
export {
  createNode,
  getNode,
  findNode,
  createEdge,
  getOutgoingEdges,
  getIncomingEdges,
  buildKnowledgeSnapshot,
  buildCommuneGraph,
} from './knowledgeGraph.service';

// --- Types -------------------------------------------------------------------
export * from './knowledgeGraph.types';

// --- Factory ergonomique : lie le contexte une seule fois --------------------
export interface KnowledgeGraph {
  buildParcelGraph(parcelKey: string): Promise<KnowledgeSnapshot>;
  buildOpportunityGraph(opportunityKey: string): Promise<KnowledgeSnapshot>;
  buildValuationGraph(valuationKey: string): Promise<KnowledgeSnapshot>;
  explainParcel(parcelKey: string): Promise<Explanation>;
  explainOpportunity(opportunityKey: string): Promise<Explanation>;
  explainValuation(valuationKey: string): Promise<Explanation>;
}

export function createKnowledgeGraph(ctx: KnowledgeGraphContext): KnowledgeGraph {
  return {
    buildParcelGraph: (parcelKey) => buildParcelGraph(parcelKey, ctx),
    buildOpportunityGraph: (opportunityKey) => buildOpportunityGraph(opportunityKey, ctx),
    buildValuationGraph: (valuationKey) => buildValuationGraph(valuationKey, ctx),
    explainParcel: (parcelKey) => explainParcel(parcelKey, ctx),
    explainOpportunity: (opportunityKey) => explainOpportunity(opportunityKey, ctx),
    explainValuation: (valuationKey) => explainValuation(valuationKey, ctx),
  };
}