// ============================================================================
// Builder — Valuation Graph
// Bien -> Comparables DVF -> Quartier -> Marché local -> Mobilité -> Risques
// Objectif : expliquer pourquoi la valorisation vaut X €.
// ============================================================================

import { buildKnowledgeSnapshot, createEdge, createNode } from '../knowledgeGraph.service';
import {
  KnowledgeGraphError,
  type KnowledgeGraphContext,
  type KnowledgeSnapshot,
} from '../knowledgeGraph.types';
import { ensureParcelSubgraph } from './parcelGraph.builder';

export async function buildValuationGraph(
  valuationKey: string,
  ctx: KnowledgeGraphContext,
): Promise<KnowledgeSnapshot> {
  const { client, providers } = ctx;

  const resolution = await providers.resolveValuation(valuationKey);
  if (!resolution) throw new KnowledgeGraphError('KG_VALUATION_NOT_RESOLVED');

  const { valuation, parcelKey } = resolution;

  // Sous-graphe parcelle (PLU / mobilité / risques) — idempotent.
  const parcelNode = await ensureParcelSubgraph(parcelKey, ctx);

  // Noeud valorisation (racine).
  const valuationNode = await createNode(client, {
    node_type: 'valuation',
    node_key: valuation.valuationKey,
    display_name: valuation.label ?? valuation.valuationKey,
    source: 'valuation_engine',
    metadata: {
      value: valuation.value ?? null,
      pricePerM2: valuation.pricePerM2 ?? null,
      ...(valuation.metadata ?? {}),
    },
  });

  // La valorisation porte sur la parcelle.
  await createEdge(client, {
    source_node_id: valuationNode.id,
    target_node_id: parcelNode.id,
    relation_type: 'BELONGS_TO',
  });

  // Comparables DVF (INFLUENCES la valorisation).
  const comparables = await providers.getComparables(parcelKey);
  for (const comp of comparables) {
    const compNode = await createNode(client, {
      node_type: 'transaction',
      node_key: comp.transactionKey,
      display_name: comp.label ?? comp.transactionKey,
      source: 'dvf',
      metadata: {
        pricePerM2: comp.pricePerM2 ?? null,
        date: comp.date ?? null,
        comparable: true,
        ...(comp.metadata ?? {}),
      },
    });
    await createEdge(client, {
      source_node_id: compNode.id,
      target_node_id: valuationNode.id,
      relation_type: 'INFLUENCES',
    });
  }

  // Quartier / marché local (INFLUENCES la valorisation).
  const marketArea = await providers.getMarketArea(parcelKey);
  if (marketArea) {
    const areaNode = await createNode(client, {
      node_type: 'market_area',
      node_key: marketArea.areaKey,
      display_name: marketArea.label,
      source: 'market',
      metadata: { label: marketArea.label, ...(marketArea.metadata ?? {}) },
    });
    await createEdge(client, {
      source_node_id: areaNode.id,
      target_node_id: valuationNode.id,
      relation_type: 'INFLUENCES',
    });
    await createEdge(client, {
      source_node_id: parcelNode.id,
      target_node_id: areaNode.id,
      relation_type: 'BELONGS_TO',
    });
  }

  return buildKnowledgeSnapshot(client, valuationNode.id, 'valuation');
}