// src/spaces/copilot/store/copilotStore.ts
// PATCH V1.2 : ajout de predictive_snapshot dans ContextHints (LOT 6)
// PATCH V1.3 : ajout de valuation_engine dans ContextHints (LOT 7)
// PATCH V1.4 : ajout du mode intro (presentation home, 0 credit, sans appel copilot-chat)
import { create } from 'zustand';
import {
  fetchBalance,
  fetchConversations,
  fetchMessages,
} from '../lib/copilotClient';
import type {
  ChatMessage,
  CopilotConversation,
  CopilotMode,
  CopilotStatus,
  CopilotStreamEvent,
  ListingContextRef,
  ParcelContextRef,
  PluContextRef,
  PredictiveSnapshotContext,
  StudyContextRef,
  ValuationEngineContext,
  Vertical,
} from '../types/copilot.types';

// -- V1.3 : valuation_engine ajoute --------------------------------------
interface ContextHints {
  vertical?: Vertical;
  parcel?: ParcelContextRef;
  study?: StudyContextRef;
  listing?: ListingContextRef;
  plu?: PluContextRef;
  // LOT 6 - snapshot des 17 sources du moteur predictif Mimmoza.
  // Injecte par AnalysePredictivePanel via setContextHints({ predictive_snapshot }).
  // Transmis tel quel dans MimmozaContext -> system prompt copilot-chat.
  predictive_snapshot?: PredictiveSnapshotContext | null;
  // LOT 7 - resultat complet du valuation engine Mimmoza.
  // Injecte par AnalysePage via setContextHints({ valuation_engine }).
  // Complete le predictive_snapshot avec valorisation, rendements et analyse quali.
  valuation_engine?: ValuationEngineContext | null;
}

interface CopilotStore {
  isOpen: boolean;
  // V1.4 - mode presentation (home, premiere visite). Quand true, le drawer
  // affiche CopilotIntroView au lieu du chat. Aucun appel reseau, 0 credit.
  introMode: boolean;
  mode: CopilotMode;

  contextHints: ContextHints;

  conversations: CopilotConversation[];
  currentConversationId: string | null;
  messages: ChatMessage[];
  credits: number | null;

  status: CopilotStatus;
  streamingId: string | null;
  error: string | null;

  loadingConversations: boolean;
  loadingMessages: boolean;

  openCopilot: () => void;
  closeCopilot: () => void;
  toggleCopilot: () => void;
  openIntro: () => void;
  exitIntro: () => void;
  setMode: (mode: CopilotMode) => void;
  setContextHints: (hints: Partial<ContextHints>) => void;
  clearContextHints: () => void;

  refreshCredits: () => Promise<void>;
  loadConversations: () => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  newConversation: () => void;

  pushUserMessage: (text: string, mode: CopilotMode) => void;
  beginAssistantMessage: (mode: CopilotMode) => string;
  handleStreamEvent: (event: CopilotStreamEvent) => void;
  failStreaming: (message: string) => void;
  cancelStreaming: () => void;
  reset: () => void;
}

const localId = (p: string) => `local-${p}-${crypto.randomUUID()}`;

export const useCopilotStore = create<CopilotStore>((set, get) => ({
  isOpen: false,
  introMode: false,
  mode: 'quick',

  contextHints: {},

  conversations: [],
  currentConversationId: null,
  messages: [],
  credits: null,

  status: 'idle',
  streamingId: null,
  error: null,

  loadingConversations: false,
  loadingMessages: false,

  // Ouverture "chat" classique : on sort toujours du mode intro.
  openCopilot: () => set({ isOpen: true, introMode: false }),
  closeCopilot: () => set({ isOpen: false, introMode: false }),
  toggleCopilot: () => set((s) => ({ isOpen: !s.isOpen, introMode: false })),

  // V1.4 : ouvre le drawer en mode presentation (statique).
  openIntro: () => set({ isOpen: true, introMode: true }),
  // V1.4 : bascule de l'intro vers le chat normal (bouton "j'ai une question").
  exitIntro: () => set({ introMode: false }),

  setMode: (mode) => set({ mode }),

  // V1.3 : Partial<ContextHints> accepte predictive_snapshot ET valuation_engine
  setContextHints: (hints) =>
    set((s) => ({
      contextHints: {
        ...s.contextHints,
        ...hints,
      },
    })),

  clearContextHints: () => set({ contextHints: {} }),

  refreshCredits: async () => {
    try {
      set({ credits: await fetchBalance() });
    } catch (e) {
      console.error('[copilot] refreshCredits', e);
    }
  },

  loadConversations: async () => {
    set({ loadingConversations: true });
    try {
      set({ conversations: await fetchConversations() });
    } catch (e) {
      console.error('[copilot] loadConversations', e);
    } finally {
      set({ loadingConversations: false });
    }
  },

  selectConversation: async (id) => {
    set({ loadingMessages: true, currentConversationId: id });
    try {
      set({ messages: await fetchMessages(id) });
    } catch (e) {
      console.error('[copilot] selectConversation', e);
    } finally {
      set({ loadingMessages: false });
    }
  },

  // "+" du header : nouvelle conversation -> on quitte aussi l'intro.
  newConversation: () =>
    set({
      introMode: false,
      currentConversationId: null,
      messages: [],
      status: 'idle',
      streamingId: null,
      error: null,
    }),

  pushUserMessage: (text, mode) =>
    set((s) => ({
      messages: [
        ...s.messages,
        {
          id: localId('u'),
          role: 'user',
          text,
          toolCalls: [],
          mode,
          status: 'complete',
          createdAt: new Date().toISOString(),
        },
      ],
    })),

  beginAssistantMessage: (mode) => {
    const id = localId('a');

    set((s) => ({
      messages: [
        ...s.messages,
        {
          id,
          role: 'assistant',
          text: '',
          toolCalls: [],
          mode,
          status: 'streaming',
          createdAt: new Date().toISOString(),
        },
      ],
      streamingId: id,
      status: 'streaming',
      error: null,
    }));

    return id;
  },

  handleStreamEvent: (event) => {
    const sid = get().streamingId;

    const mapStreaming = (fn: (m: ChatMessage) => ChatMessage) =>
      set((s) => ({
        messages: s.messages.map((m) => (m.id === sid ? fn(m) : m)),
      }));

    switch (event.type) {
      case 'reservation':
        set({ credits: event.remaining });
        break;

      case 'conversation':
        if (!get().currentConversationId) {
          set({ currentConversationId: event.conversation_id });
        }
        break;

      case 'token':
        mapStreaming((m) => ({
          ...m,
          text: m.text + event.delta,
        }));
        break;

      case 'tool_use_start':
        mapStreaming((m) => ({
          ...m,
          toolCalls: [
            ...m.toolCalls,
            {
              id: event.call.id,
              name: event.call.name,
              input: event.call.input,
              status: 'running',
            },
          ],
        }));
        break;

      case 'tool_use_end':
        mapStreaming((m) => ({
          ...m,
          toolCalls: m.toolCalls.map((tc) =>
            tc.id === event.call.id
              ? {
                  ...tc,
                  status: event.call.status,
                  output: event.call.output,
                  durationMs: event.call.duration_ms,
                  error: event.call.error,
                }
              : tc,
          ),
        }));
        break;

      case 'message_start': {
        const oldId = get().streamingId;

        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === oldId ? { ...m, id: event.message_id } : m,
          ),
          streamingId: event.message_id,
        }));
        break;
      }

      case 'done':
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === s.streamingId || m.id === event.message_id
              ? { ...m, id: event.message_id, status: 'complete' }
              : m,
          ),
          streamingId: null,
          status: 'idle',
        }));
        break;

      case 'error':
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === s.streamingId
              ? { ...m, status: 'error', error: event.error }
              : m,
          ),
          streamingId: null,
          status: 'error',
          error: event.error,
          credits:
            s.credits != null && event.refunded_credits
              ? s.credits + event.refunded_credits
              : s.credits,
        }));
        break;
    }
  },

  failStreaming: (message) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === s.streamingId
          ? { ...m, status: 'error', error: message }
          : m,
      ),
      streamingId: null,
      status: 'error',
      error: message,
    })),

  cancelStreaming: () =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === s.streamingId
          ? {
              ...m,
              status: 'complete',
              text:
                m.text +
                (m.text ? '\n\n_(interrompu)_' : '_(interrompu)_'),
            }
          : m,
      ),
      streamingId: null,
      status: 'idle',
    })),

  reset: () =>
    set({
      conversations: [],
      currentConversationId: null,
      messages: [],
      status: 'idle',
      streamingId: null,
      error: null,
    }),
}));