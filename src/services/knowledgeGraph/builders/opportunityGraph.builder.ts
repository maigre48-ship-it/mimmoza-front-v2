// ============================================================================
// Builder — Opportunity Graph
// Transforme une opportunité en réseau explicable :
// Opportunity -> Parcelle -> Zone PLU -> Marché DVF -> Mobilité -> Risques
// ============================================================================

import {
  KnowledgeGraphError,
  type KnowledgeGraphContext,
  type KnowledgeSnapshot,
} from '../knowledgeGraph.types';
import { createEdge, createNode, buildKnowledgeSnapshot } from '../knowledgeGraph.service';
import { ensureParcelSubgraph } from './parcelGraph.builder';

export async function buildOpportunityGraph(
  opportunityKey: string,
  ctx: KnowledgeGraphContext,
): Promise<KnowledgeSnapshot> {
  const { client, providers } = ctx;

  const resolution = await providers.resolveOpportunity(opportunityKey);
  if (!resolution) throw new KnowledgeGraphError('KG_OPPORTUNITY_NOT_RESOLVED');

  const { opportunity, parcelKey } = resolution;

  // Sous-graphe parcelle (PLU / DVF / mobilité / risques) — idempotent.
  const parcelNode = await ensureParcelSubgraph(parcelKey, ctx);

  // Noeud opportunité (racine du réseau).
  const opportunityNode = await createNode(client, {
    node_type: 'opportunity',
    node_key: opportunity.opportunityKey,
    display_name: opportunity.label ?? opportunity.opportunityKey,
    source: 'opportunity_engine',
    metadata: { score: opportunity.score ?? null, ...(opportunity.metadata ?? {}) },
  });

  // La parcelle a généré l'opportunité.
  await createEdge(client, {
    source_node_id: parcelNode.id,
    target_node_id: opportunityNode.id,
    relation_type: 'GENERATED',
  });

  return buildKnowledgeSnapshot(client, opportunityNode.id, 'opportunity');
}