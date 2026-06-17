// ============================================================================
// Knowledge Graph — API interne publique
// ============================================================================

import { buildOpportunityGraph } from './builders/opportunityGraph.builder';
import { buildParcelGraph } from './builders/parcelGraph.builder';
import { buildValuationGraph } from './builders/valuationGraph.builder';
import { explainOpportunity, explainParcel, explainValuation } from './knowledgeExplain.service';
import type { Explanation, KnowledgeGraphContext, KnowledgeSnapshot } from './knowledgeGraph.types';

// --- Exports directs (signature : (key, ctx)) --------------------------------
export { buildOpportunityGraph } from './builders/opportunityGraph.builder';
export { buildParcelGraph } from './builders/parcelGraph.builder';
export { buildValuationGraph } from './builders/valuationGraph.builder';
export { explainOpportunity, explainParcel, explainValuation } from './knowledgeExplain.service';

// --- Primitives bas niveau (optionnel) ---------------------------------------
export {
  buildCommuneGraph, buildKnowledgeSnapshot, createEdge, createNode, findNode, getIncomingEdges, getNode, getOutgoingEdges
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