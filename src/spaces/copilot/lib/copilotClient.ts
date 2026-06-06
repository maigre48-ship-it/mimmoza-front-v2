// src/spaces/copilot/lib/copilotClient.ts
// PATCH V1.1 : buildEnrichedContext inclut activeDeal + pageContext
// PATCH V1.2 : predictive_snapshot transmis explicitement (LOT 6)
// PATCH V1.3 : valuation_engine transmis explicitement (LOT 7)
// =============================================================

import { supabase } from '@/lib/supabase';
import { SSEParser } from './streamParser';
import { getActiveCopilotContext } from '../store/activeCopilotContext.store';
import type {
  CopilotChatRequest,
  CopilotMimmozaContext,
  CopilotStreamEvent,
  CopilotConversation,
  ChatMessage,
} from '../types/copilot.types';

export class CopilotClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'CopilotClientError';
  }
}

function functionsBaseUrl(): string {
  const url = import.meta.env.VITE_SUPABASE_URL;
  if (!url) throw new CopilotClientError('CONFIG', 'VITE_SUPABASE_URL manquant');
  return `${url}/functions/v1`;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token)
    throw new CopilotClientError('UNAUTHORIZED', 'Aucune session active. Reconnecte-toi.');
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (anon) headers['apikey'] = anon;
  return headers;
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b && typeof b === 'object' && (b as { type?: string }).type === 'text')
      .map((b) => (b as { text?: string }).text ?? '')
      .join('\n');
  }
  return '';
}

// =============================================================
// buildEnrichedContext — V1.3
// ─────────────────────────────────────────────────────────────
// Injecte les données listing, deal actif, pageContext,
// le predictive_snapshot (LOT 6 — 17 sources prédictives) ET
// le valuation_engine (LOT 7 — valorisation + rendements + analyse).
// =============================================================
function buildEnrichedContext(
  requestContext: CopilotChatRequest['context'],
): CopilotMimmozaContext {
  const reqCtx = requestContext ?? {};
  const active = getActiveCopilotContext();

  // ── Données listing depuis le store ────────────────────────
  const listingFromStore = {
    listing_id:    active.activeListingId,
    url:           active.listingUrl,
    city:          active.city,
    zip_code:      active.zipCode,
    price:         active.price,
    surface:       active.surface,
    property_type: active.propertyType,
  };

  const mergedListing = {
    ...listingFromStore,
    ...(reqCtx.listing ?? {}),
  };

  const hasListingData = Object.values(mergedListing).some(
    (v) => v !== undefined && v !== null && v !== '',
  );

  const parcel =
    reqCtx.parcel ?? (active.parcelId ? { id: active.parcelId } : undefined);

  const listingRootFields = hasListingData
    ? {
        listing_id:    mergedListing.listing_id,
        url:           mergedListing.url,
        city:          mergedListing.city,
        zip_code:      mergedListing.zip_code,
        price:         mergedListing.price,
        surface:       mergedListing.surface,
        property_type: mergedListing.property_type,
      }
    : {};

  // ── V1.1 — Deal actif et contexte de page ─────────────────
  const activeDeal  = active.activeDeal;
  const pageContext = active.pageContext;

  // ── V1.2 — Snapshot prédictif (LOT 6) ─────────────────────
  // Transmis explicitement depuis reqCtx (buildContext l'a lu
  // depuis contextHints.predictive_snapshot du copilotStore).
  const predictiveSnapshot = reqCtx.predictive_snapshot ?? null;

  // ── V1.3 — Valuation Engine (LOT 7) ───────────────────────
  // Transmis explicitement depuis reqCtx (buildContext l'a lu
  // depuis contextHints.valuation_engine du copilotStore).
  const valuationEngine = reqCtx.valuation_engine ?? null;

  // ── Construction du contexte enrichi ──────────────────────
  const enriched: CopilotMimmozaContext = {
    vertical: reqCtx.vertical ?? active.vertical ?? 'generique',
    route:    reqCtx.route    ?? active.route    ?? window.location.pathname,

    // Spread du context appelant (study, user, plu…)
    ...reqCtx,

    // Champs listing à la racine (priorité sur le spread reqCtx)
    ...listingRootFields,

    // Parcel enrichi
    parcel,

    // Listing en objet imbriqué (compatibilité future)
    ...(hasListingData ? { listing: mergedListing } : {}),

    // V1.1 — Deal actif (donne le contexte projet au LLM)
    ...(activeDeal  ? { activeDeal }  : {}),

    // V1.1 — Page context (espace / mode / onglet)
    ...(pageContext ? { pageContext } : {}),

    // V1.2 — Snapshot prédictif : réaffecté APRÈS le spread pour
    // éviter tout écrasement par un champ homonyme dans reqCtx.
    predictive_snapshot: predictiveSnapshot,

    // V1.3 — Valuation Engine : réaffecté APRÈS le spread pour
    // éviter tout écrasement par un champ homonyme dans reqCtx.
    valuation_engine: valuationEngine,
  };

  // ── Debug LOT 6 — à retirer après validation ───────────────
  console.log('[Copilot] context enrichi envoyé:', JSON.stringify({
    city:                  (enriched as any)?.city,
    zip_code:              (enriched as any)?.zip_code,
    price:                 (enriched as any)?.price,
    surface:               (enriched as any)?.surface,
    listing_id:            (enriched as any)?.listing_id,
    activeDeal:            (enriched as any)?.activeDeal,
    pageContext:           (enriched as any)?.pageContext,
    // V1.2
    has_predictive_snapshot: !!predictiveSnapshot,
    predictive_sources_count: predictiveSnapshot?.sources_count ?? null,
    predictive_dvf_median:    predictiveSnapshot?.dvf?.prix_m2_median ?? null,
    predictive_score_global:  predictiveSnapshot?.market_scores?.global ?? null,
    predictive_dpe:           predictiveSnapshot?.dpe ?? null,
    predictive_sitadel:       predictiveSnapshot?.sitadel_score ?? null,
  }));

  // ── Debug LOT 7 — à retirer après validation ───────────────
  console.log('[Copilot] valuation engine:', {
    estimatedValue:  valuationEngine?.estimatedValue,
    confidence:      valuationEngine?.confidenceScore,
    opportunity:     valuationEngine?.opportunityScore,
    marketPosition:  valuationEngine?.marketPosition,
  });

  return enriched;
}

export async function streamCopilotChat(params: {
  request: CopilotChatRequest;
  signal?: AbortSignal;
  onEvent: (event: CopilotStreamEvent) => void;
}): Promise<void> {
  const { request, signal, onEvent } = params;
  const headers = await getAuthHeaders();

  const enrichedRequest: CopilotChatRequest = {
    ...request,
    context: buildEnrichedContext(request.context),
  };

  const res = await fetch(`${functionsBaseUrl()}/copilot-chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify(enrichedRequest),
    signal,
  });

  if (!res.ok) {
    let code = 'HTTP_ERROR';
    let message = `Erreur ${res.status}`;
    try {
      const err = await res.json();
      code    = err.code    ?? code;
      message = err.message ?? message;
    } catch { /* corps non-JSON */ }
    throw new CopilotClientError(code, message, res.status);
  }

  if (!res.body) throw new CopilotClientError('NO_BODY', 'Réponse sans flux');

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  const parser  = new SSEParser(onEvent);

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
  }
  parser.flush();
}

export async function fetchBalance(): Promise<number> {
  const { data, error } = await supabase.rpc('copilot_get_balance');
  if (error) {
    const { data: row } = await supabase
      .from('copilot_credits_balance')
      .select('balance')
      .maybeSingle();
    return (row?.balance as number) ?? 0;
  }
  return typeof data === 'number' ? data : 0;
}

export async function fetchConversations(limit = 50): Promise<CopilotConversation[]> {
  const { data, error } = await supabase
    .from('copilot_conversations')
    .select('*')
    .eq('archived', false)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new CopilotClientError('FETCH_CONVERSATIONS', error.message);
  return (data ?? []) as CopilotConversation[];
}

export async function fetchMessages(conversationId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('copilot_messages')
    .select('id, role, content, mode, created_at')
    .eq('conversation_id', conversationId)
    .in('role', ['user', 'assistant'])
    .order('created_at', { ascending: true });
  if (error) throw new CopilotClientError('FETCH_MESSAGES', error.message);

  return (data ?? []).map(
    (row: Record<string, unknown>): ChatMessage => ({
      id:        String(row.id),
      role:      row.role as 'user' | 'assistant',
      text:      extractText(row.content),
      toolCalls: [],
      mode:      (row.mode as ChatMessage['mode']) ?? undefined,
      status:    'complete',
      createdAt: String(row.created_at),
    }),
  );
}