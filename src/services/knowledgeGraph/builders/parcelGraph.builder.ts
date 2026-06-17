// ============================================================================
// Builder — Parcel Graph
// Parcelle -> Commune -> Zone PLU -> OAP -> Risques -> Mobilité
//          -> Transactions DVF -> Opportunity
// ============================================================================

import {
  type KnowledgeGraphContext,
  type KnowledgeNode,
  type KnowledgeSnapshot,
} from '../knowledgeGraph.types';
import { createEdge, createNode, buildKnowledgeSnapshot } from '../knowledgeGraph.service';

// Construit (ou met à jour) le sous-graphe d'une parcelle et renvoie son noeud.
export async function ensureParcelSubgraph(
  parcelKey: string,
  ctx: KnowledgeGraphContext,
): Promise<KnowledgeNode> {
  const { client, providers } = ctx;

  // --- Parcelle ---
  const parcel = await providers.getParcel(parcelKey);
  const parcelNode = await createNode(client, {
    node_type: 'parcel',
    node_key: parcel.key,
    display_name: parcel.displayName ?? parcel.key,
    source: 'cadastre',
    metadata: parcel.metadata ?? {},
  });

  // --- Commune (LOCATED_IN) ---
  const commune = await providers.getCommune(parcelKey);
  if (commune) {
    const communeNode = await createNode(client, {
      node_type: 'commune',
      node_key: commune.inseeCode,
      display_name: commune.name,
      source: 'insee',
      metadata: commune.metadata ?? {},
    });
    await createEdge(client, {
      source_node_id: parcelNode.id,
      target_node_id: communeNode.id,
      relation_type: 'LOCATED_IN',
    });
  }

  // --- Zones PLU (AFFECTED_BY) ---
  const zones = await providers.getPluZones(parcelKey);
  for (const zone of zones) {
    const zoneNode = await createNode(client, {
      node_type: 'plu_zone',
      node_key: zone.zoneKey,
      display_name: zone.label,
      source: 'plu',
      metadata: { label: zone.label, buildable: zone.buildable ?? null, ...(zone.metadata ?? {}) },
    });
    await createEdge(client, {
      source_node_id: parcelNode.id,
      target_node_id: zoneNode.id,
      relation_type: 'AFFECTED_BY',
    });

    // --- OAP rattachées (OAP BELONGS_TO zone, parcelle AFFECTED_BY OAP) ---
    const oaps = await providers.getOaps(parcelKey);
    for (const oap of oaps) {
      const oapNode = await createNode(client, {
        node_type: 'oap',
        node_key: oap.oapKey,
        display_name: oap.label,
        source: 'plu',
        metadata: { label: oap.label, ...(oap.metadata ?? {}) },
      });
      await createEdge(client, {
        source_node_id: oapNode.id,
        target_node_id: zoneNode.id,
        relation_type: 'BELONGS_TO',
      });
      await createEdge(client, {
        source_node_id: parcelNode.id,
        target_node_id: oapNode.id,
        relation_type: 'AFFECTED_BY',
      });
    }
  }

  // --- Risques (AFFECTED_BY) ---
  const risks = await providers.getRisks(parcelKey);
  for (const risk of risks) {
    const riskNode = await createNode(client, {
      node_type: 'risk_zone',
      node_key: risk.riskKey,
      display_name: risk.riskType,
      source: 'georisques',
      metadata: { riskType: risk.riskType, severity: risk.severity ?? null, ...(risk.metadata ?? {}) },
    });
    await createEdge(client, {
      source_node_id: parcelNode.id,
      target_node_id: riskNode.id,
      relation_type: 'AFFECTED_BY',
      weight: risk.severity === 'fort' ? 3 : risk.severity === 'moyen' ? 2 : 1,
    });
  }

  // --- Mobilité / transport (NEAR) ---
  const mobility = await providers.getMobility(parcelKey);
  for (const mob of mobility) {
    const mobNode = await createNode(client, {
      node_type: 'mobility_zone',
      node_key: mob.mobilityKey,
      display_name: mob.label,
      source: 'gtfs',
      metadata: {
        label: mob.label,
        mode: mob.mode ?? null,
        distanceM: mob.distanceM ?? null,
        score: mob.score ?? null,
        ...(mob.metadata ?? {}),
      },
    });
    await createEdge(client, {
      source_node_id: parcelNode.id,
      target_node_id: mobNode.id,
      relation_type: 'NEAR',
      weight: typeof mob.score === 'number' ? mob.score : 1,
    });
  }

  // --- Marché DVF (cluster INFLUENCES parcelle ; transactions BELONGS_TO cluster) ---
  const cluster = await providers.getDvfCluster(parcelKey);
  if (cluster) {
    const clusterNode = await createNode(client, {
      node_type: 'dvf_cluster',
      node_key: cluster.clusterKey,
      display_name: cluster.label,
      source: 'dvf',
      metadata: {
        label: cluster.label,
        medianPricePerM2: cluster.medianPricePerM2 ?? null,
        trend: cluster.trend ?? null,
        sampleSize: cluster.sampleSize ?? null,
        ...(cluster.metadata ?? {}),
      },
    });
    await createEdge(client, {
      source_node_id: clusterNode.id,
      target_node_id: parcelNode.id,
      relation_type: 'INFLUENCES',
    });

    const transactions = await providers.getDvfTransactions(parcelKey);
    for (const tx of transactions) {
      const txNode = await createNode(client, {
        node_type: 'transaction',
        node_key: tx.transactionKey,
        display_name: tx.label ?? tx.transactionKey,
        source: 'dvf',
        metadata: {
          pricePerM2: tx.pricePerM2 ?? null,
          date: tx.date ?? null,
          ...(tx.metadata ?? {}),
        },
      });
      await createEdge(client, {
        source_node_id: txNode.id,
        target_node_id: clusterNode.id,
        relation_type: 'BELONGS_TO',
      });
    }
  }

  // --- Opportunity (parcelle GENERATED opportunity) ---
  const opportunity = await providers.getOpportunity(parcelKey);
  if (opportunity) {
    const opportunityNode = await createNode(client, {
      node_type: 'opportunity',
      node_key: opportunity.opportunityKey,
      display_name: opportunity.label ?? opportunity.opportunityKey,
      source: 'opportunity_engine',
      metadata: { score: opportunity.score ?? null, ...(opportunity.metadata ?? {}) },
    });
    await createEdge(client, {
      source_node_id: parcelNode.id,
      target_node_id: opportunityNode.id,
      relation_type: 'GENERATED',
    });
  }

  return parcelNode;
}

export async function buildParcelGraph(
  parcelKey: string,
  ctx: KnowledgeGraphContext,
): Promise<KnowledgeSnapshot> {
  const parcelNode = await ensureParcelSubgraph(parcelKey, ctx);
  return buildKnowledgeSnapshot(ctx.client, parcelNode.id, 'parcel');
}