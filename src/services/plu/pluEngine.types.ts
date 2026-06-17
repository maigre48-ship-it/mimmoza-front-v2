// =============================================================
// Mimmoza · PLU Engine — Types
// Socle léger : aucun fichier brut, métadonnées + rulesets compactés.
// Convention :
//   - *Record  = forme exacte des lignes en base (snake_case)
//   - Input/Result = couche domaine (camelCase)
// =============================================================

/** Statut d'un document PLU dans le registry. */
export type PluRegistryStatus =
  | 'unknown'
  | 'available'
  | 'parsing'
  | 'parsed'
  | 'failed'
  | 'outdated';

/** Statut de fraîcheur (date du dernier contrôle vs source GPU). */
export type PluFreshnessStatus =
  | 'unknown'
  | 'fresh'
  | 'stale'
  | 'outdated'
  | 'needs_check';

/** Statut métier renvoyé par resolvePluContext (consommé par l'Opportunity Engine). */
export type PluContextStatus =
  | 'PLU_READY'
  | 'PLU_PENDING'
  | 'PLU_OUTDATED'
  | 'PLU_FAILED';

/** Niveau de confiance de la résolution PLU. */
export type PluConfidence = 'low' | 'medium' | 'high';

// -------------------------------------------------------------
// Lignes de base (snake_case)
// -------------------------------------------------------------

export interface PluRegistryRecord {
  id: string;
  code_insee: string;
  commune_name: string | null;
  document_type: string | null;
  source: string | null;
  source_url: string | null;
  gpu_document_id: string | null;
  version_key: string | null;
  published_at: string | null;
  approved_at: string | null;
  status: PluRegistryStatus;
  freshness_status: PluFreshnessStatus;
  active_ruleset_id: string | null;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PluRulesetRecord {
  id: string;
  registry_id: string | null;
  code_insee: string;
  parser_version: string;
  rules_json: Record<string, unknown>;
  zones_json: Record<string, unknown>;
  prescriptions_json: Record<string, unknown>;
  oap_json: Record<string, unknown>;
  compact_size_bytes: number | null;
  status: string;
  parsed_at: string;
  created_at: string;
}

export interface PluUpdateCheckRecord {
  id: string;
  code_insee: string;
  checked_at: string;
  previous_version_key: string | null;
  detected_version_key: string | null;
  has_changed: boolean;
  action_taken: string | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
}

export interface OpportunityPluCacheRecord {
  id: string;
  cache_key: string;
  code_insee: string;
  parcel_id: string | null;
  address: string | null;
  registry_id: string | null;
  ruleset_id: string | null;
  plu_status: string;
  zone_label: string | null;
  constraints_json: Record<string, unknown>;
  feasibility_json: Record<string, unknown>;
  confidence: PluConfidence;
  computed_at: string;
  expires_at: string | null;
}

// -------------------------------------------------------------
// Couche domaine (camelCase)
// -------------------------------------------------------------

export interface ResolvePluContextInput {
  codeInsee: string;
  parcelId?: string;
  address?: string;
}

export interface ResolvePluContextResult {
  codeInsee: string;
  communeName?: string;
  pluStatus: PluContextStatus;
  registryId?: string;
  rulesetId?: string;
  zoneLabel?: string;
  constraints: Record<string, unknown>;
  feasibility: Record<string, unknown>;
  confidence: PluConfidence;
  /** Code de raison stable (jamais un message d'erreur brut). */
  reason?: string;
}