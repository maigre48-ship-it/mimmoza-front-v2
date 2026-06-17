// =============================================================
// Mimmoza · Opportunity Engine — Types (V1)
// Déterministe, typé, sans IA. Prêt à consommer plus tard :
// StreamEstate, DVF, valuation engine, PLU Engine, risques, mobilité.
// =============================================================

import type { ResolvePluContextResult } from '../plu/pluEngine.types';

export type OpportunityStrategy = 'investisseur' | 'rehabilitateur' | 'promoteur';

export type OpportunityAssetType =
  | 'appartement'
  | 'maison'
  | 'terrain'
  | 'immeuble'
  | 'local'
  | 'unknown';

export type OpportunityConfidence = 'low' | 'medium' | 'high';

export type OpportunitySignalSeverity = 'info' | 'positive' | 'warning';

export type OpportunityRecommendationAction = 'GO' | 'GO_CONDITIONAL' | 'WATCH' | 'PASS';

/** Clés des piliers de score (stables, utilisées dans le breakdown). */
export type OpportunityPillarKey =
  | 'market_discount'
  | 'location'
  | 'liquidity'
  | 'risk'
  | 'rentability'
  | 'future_potential'
  | 'promoteur_potential';

// -------------------------------------------------------------
// Entrée
// -------------------------------------------------------------

export interface OpportunityInput {
  id?: string;
  source?: string;
  address?: string;
  city?: string;
  postalCode?: string;
  codeInsee?: string;
  latitude?: number;
  longitude?: number;
  parcelId?: string;
  assetType: OpportunityAssetType;
  strategy: OpportunityStrategy;
  /** null autorisé en V1 (score réduit + confidence low). */
  askingPrice: number | null;
  livingArea?: number | null;
  landArea?: number | null;
  rooms?: number | null;
  description?: string;
  /** Score mobilité GTFS 0..100 (commune), injecté par le scanner. */
  mobilityScore?: number | null;
  /** Référence DVF €/m² de la zone (injectée par le scanner). */
  marketRefPriceM2?: number | null;
  /** Nombre de ventes DVF de la référence. */
  marketSampleSize?: number | null;
  createdAt?: string;
}

// -------------------------------------------------------------
// Sortie
// -------------------------------------------------------------

export interface OpportunityPillarScore {
  key: OpportunityPillarKey;
  label: string;
  /** 0..100, ou null si non calculable en V1 (source non branchée). */
  score: number | null;
  /** Poids du pilier pour la stratégie courante (0..1). */
  weight: number;
  /** Contribue au score total uniquement si true. */
  available: boolean;
  rationale: string;
}

export type OpportunityScoreBreakdown = OpportunityPillarScore[];

export interface OpportunitySignal {
  code: string;
  label: string;
  detail?: string;
  severity: OpportunitySignalSeverity;
}

export interface OpportunityRiskFlag {
  code: string;
  label: string;
  detail?: string;
}

export interface OpportunityRecommendation {
  action: OpportunityRecommendationAction;
  headline: string;
  rationale: string[];
  nextSteps: string[];
}

export interface OpportunityResult {
  input: OpportunityInput;
  scoreTotal: number; // 0..100
  scoreLabel: string;
  recommendation: OpportunityRecommendation;
  breakdown: OpportunityScoreBreakdown;
  signals: OpportunitySignal[];
  riskFlags: OpportunityRiskFlag[];
  pluContext?: ResolvePluContextResult;
  confidence: OpportunityConfidence;
  computedAt: string;
}