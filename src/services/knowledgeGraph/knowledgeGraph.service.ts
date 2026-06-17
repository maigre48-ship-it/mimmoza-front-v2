// ============================================================================
// Knowledge Graph — service central (primitives + snapshot + commune)
// Les builders lourds (parcel/opportunity/valuation) vivent dans builders/
// pour éviter un cycle d'import : builders -> service uniquement.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  KnowledgeGraphError,
  type CreateEdgeInput,
  type CreateNodeInput,
  type FindNodeCriteria,
  type KnowledgeEdge,
  type KnowledgeGraphContext,
  type KnowledgeNode,
  type KnowledgeSnapshot,
  type KnowledgeSnapshotPayload,
  type KnowledgeSnapshotType,
} from './knowledgeGraph.types';

function kgError(code: string): KnowledgeGraphError {
  return new KnowledgeGraphError(code);
}

const NODES = 'knowledge_nodes';
const EDGES = 'knowledge_edges';
const SNAPSHOTS = 'knowledge_snapshots';

// --- Nodes -------------------------------------------------------------------
export async function createNode(
  client: SupabaseClient,
  input: CreateNodeInput,
): Promise<KnowledgeNode> {
  const { data, error } = await client
    .from(NODES)
    .upsert(
      {
        node_type: input.node_type,
        node_key: input.node_key,
        display_name: input.display_name ?? null,
        source: input.source ?? null,
        metadata: input.metadata ?? {},
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'node_type,node_key' },
    )
    .select('*')
    .single();

  if (error || !data) throw kgError('KG_NODE_UPSERT_FAILED');
  return data as KnowledgeNode;
}

export async function getNode(
  client: SupabaseClient,
  nodeId: string,
): Promise<KnowledgeNode | null> {
  const { data, error } = await client
    .from(NODES)
    .select('*')
    .eq('id', nodeId)
    .maybeSingle();

  if (error) throw kgError('KG_NODE_FETCH_FAILED');
  return (data as KnowledgeNode | null) ?? null;
}

export async function findNode(
  client: SupabaseClient,
  criteria: FindNodeCriteria,
): Promise<KnowledgeNode | null> {
  const { data, error } = await client
    .from(NODES)
    .select('*')
    .eq('node_type', criteria.node_type)
    .eq('node_key', criteria.node_key)
    .maybeSingle();

  if (error) throw kgError('KG_NODE_FIND_FAILED');
  return (data as KnowledgeNode | null) ?? null;
}

// --- Edges -------------------------------------------------------------------
export async function createEdge(
  client: SupabaseClient,
  input: CreateEdgeInput,
): Promise<KnowledgeEdge> {
  const { data, error } = await client
    .from(EDGES)
    .upsert(
      {
        source_node_id: input.source_node_id,
        target_node_id: input.target_node_id,
        relation_type: input.relation_type,
        weight: input.weight ?? 1,
        metadata: input.metadata ?? {},
      },
      { onConflict: 'source_node_id,target_node_id,relation_type' },
    )
    .select('*')
    .single();

  if (error || !data) throw kgError('KG_EDGE_UPSERT_FAILED');
  return data as KnowledgeEdge;
}

export async function getOutgoingEdges(
  client: SupabaseClient,
  nodeId: string,
): Promise<KnowledgeEdge[]> {
  const { data, error } = await client
    .from(EDGES)
    .select('*')
    .eq('source_node_id', nodeId);

  if (error) throw kgError('KG_EDGE_OUT_FAILED');
  return (data as KnowledgeEdge[] | null) ?? [];
}

export async function getIncomingEdges(
  client: SupabaseClient,
  nodeId: string,
): Promise<KnowledgeEdge[]> {
  const { data, error } = await client
    .from(EDGES)
    .select('*')
    .eq('target_node_id', nodeId);

  if (error) throw kgError('KG_EDGE_IN_FAILED');
  return (data as KnowledgeEdge[] | null) ?? [];
}

// --- Snapshot ----------------------------------------------------------------
// Traversée non orientée, profondeur bornée, autour d'un noeud racine.
export async function buildKnowledgeSnapshot(
  client: SupabaseClient,
  rootNodeId: string,
  snapshotType: KnowledgeSnapshotType,
  maxDepth = 3,
): Promise<KnowledgeSnapshot> {
  const root = await getNode(client, rootNodeId);
  if (!root) throw kgError('KG_SNAPSHOT_ROOT_NOT_FOUND');

  const visited = new Set<string>([rootNodeId]);
  const edgeIds = new Set<string>();
  const edges: KnowledgeEdge[] = [];
  let frontier: string[] = [rootNodeId];

  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth += 1) {
    const [outRes, inRes] = await Promise.all([
      client.from(EDGES).select('*').in('source_node_id', frontier),
      client.from(EDGES).select('*').in('target_node_id', frontier),
    ]);
    if (outRes.error || inRes.error) throw kgError('KG_SNAPSHOT_EDGE_QUERY_FAILED');

    const batch = [
      ...((outRes.data as KnowledgeEdge[] | null) ?? []),
      ...((inRes.data as KnowledgeEdge[] | null) ?? []),
    ];

    const next: string[] = [];
    for (const edge of batch) {
      if (!edgeIds.has(edge.id)) {
        edgeIds.add(edge.id);
        edges.push(edge);
      }
      for (const nid of [edge.source_node_id, edge.target_node_id]) {
        if (!visited.has(nid)) {
          visited.add(nid);
          next.push(nid);
        }
      }
    }
    frontier = next;
  }

  const nodeIds = [...visited];
  let nodes: KnowledgeNode[] = [root];
  if (nodeIds.length > 0) {
    const { data, error } = await client.from(NODES).select('*').in('id', nodeIds);
    if (error) throw kgError('KG_SNAPSHOT_NODE_QUERY_FAILED');
    nodes = (data as KnowledgeNode[] | null) ?? [root];
  }

  const payload: KnowledgeSnapshotPayload = {
    root,
    nodes,
    edges,
    snapshot_type: snapshotType,
    generated_at: new Date().toISOString(),
  };

  const { data: snapData, error: snapErr } = await client
    .from(SNAPSHOTS)
    .insert({
      root_node_id: rootNodeId,
      snapshot_type: snapshotType,
      payload,
    })
    .select('*')
    .single();

  if (snapErr || !snapData) throw kgError('KG_SNAPSHOT_PERSIST_FAILED');
  return snapData as KnowledgeSnapshot;
}

// --- Commune graph (léger, hébergé dans le service) --------------------------
export async function buildCommuneGraph(
  inseeCode: string,
  ctx: KnowledgeGraphContext,
): Promise<KnowledgeSnapshot> {
  const { client } = ctx;

  const communeNode = await createNode(client, {
    node_type: 'commune',
    node_key: inseeCode,
    display_name: inseeCode,
    source: 'insee',
    metadata: {},
  });

  return buildKnowledgeSnapshot(client, communeNode.id, 'commune');
}