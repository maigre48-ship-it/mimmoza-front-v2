// src/spaces/copilot/types/copilot.types.ts

/* =============================================================
 * Mimmoza Copilot — Types V1 (fusion LOT 1 + LOT 7 + LOT 5)
 * ============================================================= */

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
  quick: 1,
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

export interface MimmozaContext {
  vertical: Vertical;
  route: string;
  parcel?: ParcelContextRef;
  study?: StudyContextRef;
  listing?: ListingContextRef;
  user?: UserContextRef;
  plu?: PluContextRef;
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

/**
 * Contexte annonce actif (investisseur / marchand — LOT 5).
 *
 * ⚠️ Nommage aligné sur le contrat backend `get_quick_market_insight` :
 *   - `listing_id`   (et non `id`) → colonne `id` de la vue v_quick_questions_mvp
 *   - `property_type`              → filtre optionnel type de bien
 */
export interface ListingContextRef {
  listing_id?: string;     // identifiant interne Mimmoza (= id dans v_quick_questions_mvp)
  url?: string;            // URL publique de l'annonce (priorité 2 après listing_id)
  city?: string;
  zip_code?: string;
  price?: number;          // Prix en euros
  surface?: number;        // Surface en m²
  property_type?: string;  // ex. "Appartement", "Maison", "Local"
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