// src/spaces/copilot/lib/copilotClient.ts
// =============================================================
// Client HTTP Copilot Mimmoza.
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
// buildEnrichedContext
// ─────────────────────────────────────────────────────────────
// CORRECTION CLÉE : les champs listing sont injectés à la RACINE
// de context (city, zip_code, price, surface, listing_id) ET
// sous context.listing — pour couvrir les deux conventions
// possibles côté backend Edge Function.
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
    zip_code:      active.zipCode,   // zipCode store → zip_code backend
    price:         active.price,
    surface:       active.surface,
    property_type: active.propertyType,
  };

  // Les valeurs explicites de la requête ont la priorité
  const mergedListing = {
    ...listingFromStore,
    ...(reqCtx.listing ?? {}),
  };

  const hasListingData = Object.values(mergedListing).some(
    (v) => v !== undefined && v !== null && v !== '',
  );

  const parcel =
    reqCtx.parcel ?? (active.parcelId ? { id: active.parcelId } : undefined);

  // ── Construction du context enrichi ────────────────────────
  // On spread les champs listing à DEUX niveaux :
  //   1. Racine du context  → ce que le backend attend dans context.city / context.zip_code
  //   2. context.listing    → convention objet imbriqué (pour d'éventuels futurs consumers)
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

  return {
    // Vertical et route : fallback store si absent
    vertical: reqCtx.vertical ?? active.vertical ?? 'generique',
    route:    reqCtx.route    ?? active.route    ?? window.location.pathname,

    // Spread du context appelant (study, user, plu…)
    ...reqCtx,

    // ── Champs listing à la RACINE (priorité sur le spread reqCtx) ──
    ...listingRootFields,

    // Parcel enrichi
    parcel,

    // Listing aussi en objet imbriqué (compatibilité future)
    ...(hasListingData ? { listing: mergedListing } : {}),
  };
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

  // Debug temporaire — à retirer une fois validé
  console.log('[Copilot] context enrichi envoyé:', JSON.stringify({
    city:       (enrichedRequest.context as any)?.city,
    zip_code:   (enrichedRequest.context as any)?.zip_code,
    price:      (enrichedRequest.context as any)?.price,
    surface:    (enrichedRequest.context as any)?.surface,
    listing_id: (enrichedRequest.context as any)?.listing_id,
  }));

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