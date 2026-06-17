// ============================================================================
// Knowledge Graph — types
// Aucune dépendance externe hors types @supabase/supabase-js.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js';

// --- JSON --------------------------------------------------------------------
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

// --- Enumérations ------------------------------------------------------------
export type KnowledgeNodeType =
  | 'parcel'
  | 'commune'
  | 'plu_zone'
  | 'oap'
  | 'dvf_cluster'
  | 'risk_zone'
  | 'mobility_zone'
  | 'opportunity'
  | 'valuation'
  | 'transaction'
  | 'transport'
  | 'market_area';

export type KnowledgeRelationType =
  | 'LOCATED_IN'
  | 'AFFECTED_BY'
  | 'CONNECTED_TO'
  | 'BELONGS_TO'
  | 'INTERSECTS'
  | 'GENERATED'
  | 'INFLUENCES'
  | 'NEAR';

export type KnowledgeSnapshotType = 'parcel' | 'opportunity' | 'valuation' | 'commune';

// --- Entités persistées ------------------------------------------------------
export interface KnowledgeNode {
  id: string;
  node_type: KnowledgeNodeType;
  node_key: string;
  display_name: string | null;
  source: string | null;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeEdge {
  id: string;
  source_node_id: string;
  target_node_id: string;
  relation_type: KnowledgeRelationType;
  weight: number;
  metadata: JsonObject;
  created_at: string;
}

export interface KnowledgeSnapshotPayload {
  root: KnowledgeNode;
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  snapshot_type: KnowledgeSnapshotType;
  generated_at: string;
}

export interface KnowledgeSnapshot {
  id: string;
  root_node_id: string;
  snapshot_type: KnowledgeSnapshotType | null;
  payload: KnowledgeSnapshotPayload;
  created_at: string;
}

// --- Inputs ------------------------------------------------------------------
export interface CreateNodeInput {
  node_type: KnowledgeNodeType;
  node_key: string;
  display_name?: string | null;
  source?: string | null;
  metadata?: JsonObject;
}

export interface CreateEdgeInput {
  source_node_id: string;
  target_node_id: string;
  relation_type: KnowledgeRelationType;
  weight?: number;
  metadata?: JsonObject;
}

export interface FindNodeCriteria {
  node_type: KnowledgeNodeType;
  node_key: string;
}

// --- Provenance géographique (ÉTAPE 2 / 6) -----------------------------------
export type GeoSource = 'parcel' | 'commune_centroid';
export type GeoConfidence = 'high' | 'medium' | 'low';

export interface GeoProvenance {
  source: GeoSource;
  confidence: GeoConfidence;
  latitude?: number;
  longitude?: number;
}

// --- Explainability ----------------------------------------------------------
export type ExplanationSentiment = 'positive' | 'negative' | 'neutral';

export interface ExplanationReason {
  type: ExplanationSentiment;
  label: string;
  source?: KnowledgeNodeType;
  weight?: number;
  detail?: string;
}

// ÉTAPE 4 — signal positif (DVF / PLU / mobilité), dérivé de données réelles.
export interface PositiveSignal {
  label: string;
  source?: KnowledgeNodeType;
  detail?: string;
}

// ÉTAPE 5 — contribution chiffrée au score (traçable).
export interface ScoreContribution {
  type: ExplanationSentiment;
  label: string;
  impact: number; // +15, -10, ...
  source?: KnowledgeNodeType;
  detail?: string;
}

export interface Explanation {
  root_node_id: string;
  subject: 'opportunity' | 'valuation' | 'parcel';
  score: number | null;
  reasons: ExplanationReason[];
  geo?: GeoProvenance; // ÉTAPE 6.1 / 6.2
  positiveSignals?: PositiveSignal[]; // ÉTAPE 4
  scoreBreakdown?: ScoreContribution[]; // ÉTAPE 5
  scoreBaseline?: number; // base avant impacts (traçabilité)
  generated_at: string;
}

// ============================================================================
// Providers — contrat d'accès aux moteurs existants de Mimmoza.
// ============================================================================

export interface ParcelData {
  key: string;
  displayName?: string;
  metadata?: JsonObject;
}

export interface CommuneData {
  inseeCode: string;
  name: string;
  metadata?: JsonObject;
}

export interface PluZoneData {
  zoneKey: string;
  label: string;
  buildable?: boolean;
  metadata?: JsonObject;
}

export interface OapData {
  oapKey: string;
  label: string;
  metadata?: JsonObject;
}

export interface RiskData {
  riskKey: string;
  riskType: string;
  severity?: 'faible' | 'moyen' | 'fort';
  metadata?: JsonObject;
}

export interface MobilityData {
  mobilityKey: string;
  label: string;
  mode?: string;
  distanceM?: number;
  score?: number;
  metadata?: JsonObject;
}

export interface TransactionData {
  transactionKey: string;
  label?: string;
  pricePerM2?: number;
  date?: string;
  metadata?: JsonObject;
}

export interface DvfClusterData {
  clusterKey: string;
  label: string;
  medianPricePerM2?: number;
  trend?: 'up' | 'down' | 'stable';
  sampleSize?: number;
  metadata?: JsonObject;
}

export interface OpportunityData {
  opportunityKey: string;
  label?: string;
  score?: number;
  metadata?: JsonObject;
}

export interface ValuationData {
  valuationKey: string;
  label?: string;
  value?: number;
  pricePerM2?: number;
  metadata?: JsonObject;
}

export interface MarketAreaData {
  areaKey: string;
  label: string;
  metadata?: JsonObject;
}

export interface OpportunityResolution {
  opportunity: OpportunityData;
  parcelKey: string;
}

export interface ValuationResolution {
  valuation: ValuationData;
  parcelKey: string;
}

export interface KnowledgeGraphProviders {
  // --- parcelle ---
  getParcel(parcelKey: string): Promise<ParcelData>;
  getCommune(parcelKey: string): Promise<CommuneData | null>;
  getPluZones(parcelKey: string): Promise<PluZoneData[]>;
  getOaps(parcelKey: string): Promise<OapData[]>;
  getRisks(parcelKey: string): Promise<RiskData[]>;
  getMobility(parcelKey: string): Promise<MobilityData[]>;
  getDvfCluster(parcelKey: string): Promise<DvfClusterData | null>;
  getDvfTransactions(parcelKey: string): Promise<TransactionData[]>;
  getOpportunity(parcelKey: string): Promise<OpportunityData | null>;
  // --- résolveurs racine ---
  resolveOpportunity(opportunityKey: string): Promise<OpportunityResolution | null>;
  resolveValuation(valuationKey: string): Promise<ValuationResolution | null>;
  // --- valorisation ---
  getComparables(parcelKey: string): Promise<TransactionData[]>;
  getMarketArea(parcelKey: string): Promise<MarketAreaData | null>;
}

export interface KnowledgeGraphContext {
  client: SupabaseClient;
  providers: KnowledgeGraphProviders;
}

// --- Erreurs (codes génériques, aucune fuite d'info) -------------------------
export class KnowledgeGraphError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = 'KnowledgeGraphError';
    this.code = code;
  }
}