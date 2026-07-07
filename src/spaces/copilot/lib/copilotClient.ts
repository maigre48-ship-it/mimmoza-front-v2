// src/spaces/copilot/lib/copilotClient.ts
// PATCH V1.1 : buildEnrichedContext inclut activeDeal + pageContext
// PATCH V1.2 : predictive_snapshot transmis explicitement (LOT 6)
// PATCH V1.3 : valuation_engine transmis explicitement (LOT 7)
// PATCH V1.4 : pageSnapshot transmis explicitement (donnees visibles a l'ecran)
// =============================================================

import { supabase } from '@/lib/supabase';
import { getActiveCopilotContext } from '../store/activeCopilotContext.store';
import type {
  ChatMessage,
  CopilotChatRequest,
  CopilotConversation,
  CopilotMimmozaContext,
  CopilotStreamEvent,
} from '../types/copilot.types';
import { SSEParser } from './streamParser';

export class CopilotClientError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
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
// buildEnrichedContext — V1.4
// ─────────────────────────────────────────────────────────────
// Injecte les données listing, deal actif, pageContext,
// le predictive_snapshot (LOT 6 — 17 sources prédictives),
// le valuation_engine (LOT 7 — valorisation + rendements + analyse)
// ET le pageSnapshot (donnees visibles a l'ecran de la page courante).
// =============================================================
function buildEnrichedContext(
  requestContext: CopilotChatRequest['context'],
): CopilotMimmozaContext {
  const reqCtx = requestContext ?? {};
  const active = getActiveCopilotContext();

  // ── Données listing depuis le store ────────────────────────
  const listingFromStore = {
    listing_id: active.activeListingId,
    url: active.listingUrl,
    city: active.city,
    zip_code: active.zipCode,
    price: active.price,
    surface: active.surface,
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
        listing_id: mergedListing.listing_id,
        url: mergedListing.url,
        city: mergedListing.city,
        zip_code: mergedListing.zip_code,
        price: mergedListing.price,
        surface: mergedListing.surface,
        property_type: mergedListing.property_type,
      }
    : {};

  // ── V1.1 — Deal actif et contexte de page ─────────────────
  const activeDeal = active.activeDeal;
  const pageContext = active.pageContext;

  // ── V1.2 — Snapshot prédictif (LOT 6) ─────────────────────
  // Transmis explicitement depuis reqCtx (buildContext l'a lu
  // depuis contextHints.predictive_snapshot du copilotStore).
  const predictiveSnapshot = reqCtx.predictive_snapshot ?? null;

  // ── V1.3 — Valuation Engine (LOT 7) ───────────────────────
  // Transmis explicitement depuis reqCtx (buildContext l'a lu
  // depuis contextHints.valuation_engine du copilotStore).
  const valuationEngine = reqCtx.valuation_engine ?? null;

  // ── V1.4 — Snapshot libre de page ─────────────────────────
  // Donnees visibles a l'ecran de la page courante (ex : valorisation
  // rehabilitation). Pousse par la page via setActiveCopilotContext.
  const pageSnapshot = active.pageSnapshot ?? null;
  console.log("[copilotClient] active.pageSnapshot au moment de l'envoi:", JSON.stringify(active.pageSnapshot));

  // ── Construction du contexte enrichi ──────────────────────
  const enriched: CopilotMimmozaContext = {
    // Spread du context appelant (study, user, plu…)
    ...reqCtx,

    // Champs listing à la racine (priorité sur le spread reqCtx)
    ...listingRootFields,

    // vertical/route calculés AVEC fallback, réaffectés APRÈS le
    // spread reqCtx pour que le fallback ne soit pas écrasé.
    vertical: reqCtx.vertical ?? active.vertical ?? 'generique',
    route: reqCtx.route ?? active.route ?? window.location.pathname,

    // Parcel enrichi
    parcel,

    // Listing en objet imbriqué (compatibilité future)
    ...(hasListingData ? { listing: mergedListing } : {}),

    // V1.1 — Deal actif (donne le contexte projet au LLM)
    ...(activeDeal ? { activeDeal } : {}),

    // V1.1 — Page context (espace / mode / onglet)
    ...(pageContext ? { pageContext } : {}),

    // V1.4 — Snapshot libre de la page courante (donnees a l'ecran)
    ...(pageSnapshot ? { pageSnapshot } : {}),

    // V1.2 — Snapshot prédictif : réaffecté APRÈS le spread pour
    // éviter tout écrasement par un champ homonyme dans reqCtx.
    predictive_snapshot: predictiveSnapshot,

    // V1.3 — Valuation Engine : réaffecté APRÈS le spread pour
    // éviter tout écrasement par un champ homonyme dans reqCtx.
    valuation_engine: valuationEngine,
  };

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
      code = err.code ?? code;
      message = err.message ?? message;
    } catch {
      // corps non-JSON
    }

    throw new CopilotClientError(code, message, res.status);
  }

  if (!res.body) {
    throw new CopilotClientError('NO_BODY', 'Réponse sans flux');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SSEParser(onEvent);

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
  }

  parser.flush();
}

export async function fetchBalance(): Promise<number> {
  // Solde unifie : on lit credit_accounts.current_credits (le meme compteur
  // que "Mon compte" et l'Analyse rapide), pas l'ancien copilot_credits_balance.
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 0;

  const { data, error } = await supabase
    .from('credit_accounts')
    .select('current_credits')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error || !data) return 0;
  const credits = (data as { current_credits: number }).current_credits;
  return typeof credits === 'number' ? credits : 0;
}

export async function fetchConversations(limit = 50): Promise<CopilotConversation[]> {
  const { data, error } = await supabase
    .from('copilot_conversations')
    .select('*')
    .eq('archived', false)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) {
    throw new CopilotClientError('FETCH_CONVERSATIONS', error.message);
  }

  return (data ?? []) as CopilotConversation[];
}

export async function fetchMessages(conversationId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('copilot_messages')
    .select('id, role, content, mode, created_at')
    .eq('conversation_id', conversationId)
    .in('role', ['user', 'assistant'])
    .order('created_at', { ascending: true });

  if (error) {
    throw new CopilotClientError('FETCH_MESSAGES', error.message);
  }

  return (data ?? []).map(
    (row: Record<string, unknown>): ChatMessage => ({
      id: String(row.id),
      role: row.role as 'user' | 'assistant',
      text: extractText(row.content),
      toolCalls: [],
      mode: (row.mode as ChatMessage['mode']) ?? undefined,
      status: 'complete',
      createdAt: String(row.created_at),
    }),
  );
}