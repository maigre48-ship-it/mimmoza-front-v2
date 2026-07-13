// src/spaces/copilot/types/copilot.types.ts
// PATCH V1.1 : ajout PageContextRef + ActiveDealRef dans MimmozaContext
// PATCH V1.2 : ajout PredictiveSnapshotContext dans MimmozaContext (LOT 6)
// PATCH V1.3 : ajout ValuationEngineContext dans MimmozaContext (LOT 7)
// PATCH V1.4 : ajout TransportGtfsSnapshot + transport_gtfs dans PredictiveSnapshotContext (v4.4)
// PATCH V1.5 : ajout risk_study dans MimmozaContext (LOT 9 — etude de risques deja calculee)
// =============================================================

export type Vertical =
  | 'promoteur'
  | 'investisseur'
  | 'marchand'
  | 'apporteur'
  | 'particulier'
  | 'generique';

export const ALL_VERTICALS: Vertical[] = [
  'promoteur', 'investisseur', 'marchand',
  'apporteur', 'particulier', 'generique',
];

export type CopilotMode = 'quick' | 'advanced' | 'report';

export const CREDIT_COST: Record<CopilotMode, number> = {
  quick: 5,
  advanced: 15,
  report: 30,
};

export const V1_AVAILABLE_MODES: CopilotMode[] = ['quick', 'advanced'];
export const V1_MODES: CopilotMode[] = V1_AVAILABLE_MODES;

export interface PluContextRef {
  zone_code?: string;
  zone_libelle?: string;
  source?: string;
  ruleset?: unknown;
  oap?: unknown;
}

// ─── V1.1 — Contexte de page ──────────────────────────────────────────────────

export interface PageContextRef {
  pathname: string;
  space?: string;
  mode?: string;
  tab?: string;
}

export interface ActiveDealRef {
  id: string;
  title?: string;
  address?: string;
  parcelId?: string | null;
  surface?: number | null;
  purchasePrice?: number | null;
  resalePrice?: number | null;
  worksBudget?: number | null;
  status?: string;
}

// ─── V1.4 — Transport GTFS PostGIS ───────────────────────────────────────────
// Score de mobilité calculé depuis la table mobility_stops (56k stops).
// Plus précis que transport legacy (OSM/IDFM). Prioritaire pour le Copilot.
//
// Règle Copilot 4dodicies :
//   - Utiliser transport_gtfs.total plutôt que transport.score (legacy)
//   - Citer les pillars si pertinent : rail (RER/Métro/TGV/TER), urban, employment, multimodal
//   - Ne jamais confondre pillars.rail avec le SmartScore global (règle 4decies)
//   - Si is_urban=false ET pillars.rail > 0 → mentionner TER/TGV même hors agglo

export interface TransportGtfsSnapshot {
  /** Score global /100 */
  total: number;
  pillars: {
    /** Métro, RER, TGV, TER */
    rail:       number | null;
    /** Bus, tram, réseau urbain */
    urban:      number | null;
    /** Accessibilité bassins d'emploi */
    employment: number | null;
    /** Qualité des correspondances */
    multimodal: number | null;
  };
  /** Distance au stop le plus proche (mètres) */
  nearest_stop_m:  number | null;
  has_metro_train: boolean;
  has_tram:        boolean;
  /** false = zone rurale / péri-urbaine */
  is_urban:        boolean;
  /** Label humain ex. "Bien desservi" */
  label:   string;
  summary: string;
}

// ─── V1.2 — Snapshot prédictif (17 sources moteur Mimmoza) ───────────────────
// Transmis par le front depuis le localStorage (snapshot Marchand + Investisseur).
// Injecté directement dans le system prompt de copilot-chat — zéro appel réseau.

export interface PredictiveSnapshotContext {
  // ── DVF ──────────────────────────────────────────────────────
  dvf?: {
    prix_m2_median?:     number | null;
    nb_transactions?:    number | null;
    evolution_prix_pct?: number | null;
    prix_m2_min?:        number | null;
    prix_m2_max?:        number | null;
  } | null;
  // ── Scores marché ─────────────────────────────────────────────
  market_scores?: {
    global?:          number | null;
    demande?:         number | null;
    offre?:           number | null;
    accessibilite?:   number | null;
    environnement?:   number | null;
    transport_exclu?: boolean;
  } | null;
  // ── INSEE / Démographie ───────────────────────────────────────
  insee?: {
    population?:    number | null;
    densite?:       number | null;
    revenu_median?: number | null;
    taux_chomage?:  number | null;
    taux_pauvrete?: number | null;
    pct_75_plus?:   number | null;
    pct_etudiants?: number | null;
    commune_nom?:   string | null;
    departement?:   string | null;
  } | null;
  // ── BPE — équipements ─────────────────────────────────────────
  bpe?: {
    score?:              number | null;
    total_equipements?:  number | null;
    nb_ecoles?:          number | null;
    nb_pharmacies?:      number | null;
    nb_supermarches?:    number | null;
    commerces_count?:    number | null;
    sante_count?:        number | null;
    education_count?:    number | null;
    loisirs_count?:      number | null;
  } | null;
  // ── Transport legacy (OSM/IDFM) — maintenu pour rétro-compat ─
  transport?: {
    score?:           number | null;
    has_metro_train?: boolean;
    has_tram?:        boolean;
    nearest_stop_m?:  number | null;
    is_urban?:        boolean;
  } | null;
  // ── Transport GTFS PostGIS (v4.4) — prioritaire pour le Copilot
  transport_gtfs?: TransportGtfsSnapshot | null;
  // ── Géorisques ───────────────────────────────────────────────
  georisques?: {
    nb_risques?:          number | null;
    inondation?:          boolean | null;
    sismique?:            number | null;
    retrait_gonflement?:  boolean | null;
    radon?:               number | null;
    cavites?:             boolean | null;
  } | null;
  // ── Rentabilité ───────────────────────────────────────────────
  rentabilite?: {
    rendement_brut?:     number | null;
    rendement_net?:      number | null;
    cashflow_mensuel?:   number | null;
    marge_brute?:        number | null;
    marge_brute_pct?:    number | null;
    prix_revente_cible?: number | null;
  } | null;
  // ── Sources individuelles ─────────────────────────────────────
  dpe?:               string | null;   // "A"–"G"
  dpe_source?:        string | null;   // "ademe" | "snap" | "manual"
  plu_zone?:          string | null;
  sitadel_score?:     number | null;
  demographie_score?: number | null;
  loyer_median_zone?: number | null;   // €/m²/mois
  travaux_budget?:    number | null;   // € TTC
  fiscal_regime?:     string | null;
  bce_rate?:          number | null;
  bce_pressure_label?: string | null;
  horizon_mois?:      number | null;
  // ── Méta ──────────────────────────────────────────────────────
  deal_id?:           string | null;
  deal_label?:        string | null;
  generated_at?:      string | null;
  sources_count?:     number | null;
}

// ─── V1.3 — Valuation Engine (moteur de valorisation Mimmoza) ────────────────
// Transmis par AnalysePage quand le valuation engine a produit un résultat.
// Complète predictive_snapshot avec les données financières et de valorisation.

export interface ValuationEngineContext {
  // ── Valorisation ──────────────────────────────────────────────
  estimatedValue?:    number;
  minEstimatedValue?: number;
  maxEstimatedValue?: number;

  marketPriceM2?:   number;
  valuationBasis?:  string;

  // ── Scores ────────────────────────────────────────────────────
  confidenceScore?:  number;
  opportunityScore?: number;
  marketPosition?:   string;
  securityScore?:    number;

  // ── Localisation ──────────────────────────────────────────────
  locationScore?:     number;
  locationBreakdown?: Record<string, number>;

  // ── Rendements ────────────────────────────────────────────────
  estimatedRent?: number;
  grossYield?:    number;
  netYield?:      number;

  // ── Contextes spécialisés ─────────────────────────────────────
  rehab?:    unknown;
  promoteur?: unknown;

  // ── Analyse qualitative ───────────────────────────────────────
  strengths?:  string[];
  weaknesses?: string[];
  warnings?:   string[];

  recommendation?: string;

  // ── Méta ──────────────────────────────────────────────────────
  meta?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────

export interface MimmozaContext {
  vertical: Vertical;
  route: string;
  parcel?: ParcelContextRef;
  study?: StudyContextRef;
  listing?: ListingContextRef;
  user?: UserContextRef;
  plu?: PluContextRef;
  // V1.1
  pageContext?: PageContextRef;
  activeDeal?: ActiveDealRef;
  // V1.2 — snapshot prédictif (17 sources, transmis par le front)
  predictive_snapshot?: PredictiveSnapshotContext | null;
  // V1.3 — résultat du valuation engine (valorisation + rendements + analyse)
  valuation_engine?: ValuationEngineContext | null;
  // V1.5 — étude de risques déjà calculée (risk-study), poussée par la page Risques.
  // Forme brute { meta, scores, data, categories, insights }. Injectée dans le
  // system prompt → le Copilot répond aux questions de risques sans appeler d'outil.
  risk_study?: Record<string, unknown> | null;
  // V1.6 — analyse de plan (Réhabilitation) : summary, pièces, surface, anomalies
  plan_analysis?: PlanAnalysisContext | null;
}

export interface PlanAnalysisContext {
  summary: string | null;
  surface_retenue_m2: number | null;
  room_count: number;
  rooms: Array<{ label: string; surfaceM2: number }>;
  anomalies: Array<{ severity?: string; title?: string; category?: string }>;
}

export interface ParcelContextRef {
  id: string;
  address?: string;
  commune?: string;
  code_postal?: string;
  code_insee?: string;
  cadastral_ref?: string;
  surface_m2?: number;
  plu_zone?: string;
  lat?: number;
  lng?: number;
}

export interface StudyContextRef {
  id: string;
  type: string;
  title?: string;
}

export interface ListingContextRef {
  listing_id?: string;
  url?: string;
  city?: string;
  zip_code?: string;
  price?: number;
  surface?: number;
  property_type?: string;
}

export interface UserContextRef {
  id: string;
  role?: string;
  plan?: 'free' | 'pro' | 'enterprise';
}

export type ContentBlock =
  | TextBlock
  | ToolUseBlock
  | ToolResultBlock
  | CitationBlock;

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: unknown;
  is_error?: boolean;
}

export interface CitationBlock {
  type: 'citation';
  source: string;
  url?: string;
  snippet?: string;
}

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export interface CopilotMessage {
  id: string;
  conversation_id: string;
  user_id: string;
  role: MessageRole;
  content: ContentBlock[];
  mode?: CopilotMode;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  credits_cost: number;
  latency_ms?: number;
  finish_reason?: string;
  error?: string;
  created_at: string;
}

export interface CopilotConversation {
  id: string;
  user_id?: string;
  title: string;
  vertical: Vertical;
  context_parcel_id?: string | null;
  context_route?: string | null;
  context_study_id?: string | null;
  pinned: boolean;
  archived: boolean;
  last_message_at?: string | null;
  created_at: string;
  updated_at: string;
}

export type ToolCallStatus = 'pending' | 'success' | 'error';

export interface CopilotToolCall {
  id: string;
  message_id: string;
  conversation_id: string;
  tool_name: string;
  tool_input: unknown;
  tool_output?: unknown;
  status: ToolCallStatus;
  error?: string;
  duration_ms?: number;
  created_at: string;
}

export type AnalysisType =
  | 'parcel' | 'study' | 'market' | 'risk' | 'financial' | 'custom';

export interface CopilotAnalysis {
  id: string;
  user_id: string;
  conversation_id?: string;
  message_id?: string;
  type: AnalysisType;
  vertical: Vertical;
  title: string;
  parcel_id?: string;
  study_id?: string;
  payload: AnalysisPayload;
  pdf_url?: string;
  created_at: string;
}

export interface AnalysisPayload {
  sections: AnalysisSection[];
  scores?: Record<string, number>;
  recommendations?: string[];
  warnings?: string[];
}

export interface AnalysisSection {
  id: string;
  title: string;
  content: string;
  citations?: Array<{ source: string; url?: string }>;
}

export type CreditKind =
  | 'monthly_grant' | 'purchase' | 'admin_grant'
  | 'reservation' | 'settlement' | 'refund' | 'rollover';

export interface CopilotCreditLedgerEntry {
  id: string;
  user_id: string;
  amount: number;
  kind: CreditKind;
  reason?: string;
  conversation_id?: string;
  message_id?: string;
  reservation_id?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface CopilotCreditState {
  balance: number;
  monthly_grant: number;
  used_this_month: number;
  next_reset?: string;
}

export interface CopilotChatRequest {
  conversation_id?: string;
  message: string;
  mode: CopilotMode;
  context: MimmozaContext;
}

export type CopilotStreamEvent =
  | { type: 'reservation'; reserved_credits: number; remaining: number }
  | { type: 'conversation'; conversation_id: string }
  | { type: 'message_start'; message_id: string }
  | { type: 'token'; delta: string }
  | { type: 'tool_use_start'; call: { id: string; name: string; input: unknown } }
  | { type: 'tool_use_end'; call: { id: string; name: string; output: unknown; duration_ms: number; status: string; error?: string } }
  | { type: 'done'; message_id: string; final_credits: number }
  | { type: 'error'; error: string; refunded_credits?: number };

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  vertical_scope?: Vertical[];
  available_in_modes: CopilotMode[];
}

export type CopilotErrorCode =
  | 'INSUFFICIENT_CREDITS'
  | 'INVALID_MODE'
  | 'CONTEXT_REQUIRED'
  | 'TOOL_ERROR'
  | 'LLM_ERROR'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export interface CopilotError {
  code: CopilotErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export type ChatMessageStatus = 'streaming' | 'complete' | 'error';

export interface ActiveToolCall {
  id: string;
  name: string;
  input?: unknown;
  output?: unknown;
  status: 'running' | 'success' | 'error' | string;
  durationMs?: number;
  error?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  toolCalls: ActiveToolCall[];
  mode?: CopilotMode;
  status: ChatMessageStatus;
  error?: string;
  createdAt: string;
}

export type CopilotStatus = 'idle' | 'streaming' | 'error';

// ─── Alias pour copilotClient.ts ──────────────────────────────────────────────
export type CopilotMimmozaContext = MimmozaContext & {
  listing_id?: string;
  url?: string;
  city?: string;
  zip_code?: string;
  price?: number;
  surface?: number;
  property_type?: string;
};