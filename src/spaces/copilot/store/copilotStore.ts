// src/spaces/copilot/store/copilotStore.ts
// PATCH V1.2 : ajout de predictive_snapshot dans ContextHints (LOT 6)
// PATCH V1.3 : ajout de valuation_engine dans ContextHints (LOT 7)
// PATCH V1.4 : ajout du mode intro (presentation home, 0 credit, sans appel copilot-chat)
// PATCH V1.5 : ajout du `tier` (niveau de modele) — Standard / Approfondi / Expert.
//   Le tier est un CONFORT d'interface : copilot-chat le revalide via resolveTier
//   contre le plan lu en base (billing_profiles.plan_code + subscription_status).
//   Un tier hors plan est ignore cote serveur, jamais honore — l'UI n'est pas
//   la securite.
// PATCH V1.6 : le tier est PERSISTE dans localStorage. Le store n'utilise pas le
//   middleware `persist` de zustand : sans cette lecture/ecriture manuelle, le
//   choix revenait a 'sonnet' a CHAQUE rechargement de page (et le hot-reload de
//   Vite en declenche en permanence), si bien qu'un « Expert » selectionne
//   arrivait au serveur en 'sonnet' — cas reellement observe.
import { create } from 'zustand';
import {
  fetchActionRuns,
  fetchBalance,
  fetchConversations,
  fetchMessages,
} from '../lib/copilotClient';
import { isLocalMessageId, persistActionRun } from '../actions/copilotActions';
import type {
  ActionRun,
  ChatMessage,
  CopilotConversation,
  CopilotMode,
  CopilotStatus,
  CopilotStreamEvent,
  ListingContextRef,
  ModelTier,
  ParcelContextRef,
  PluContextRef,
  PredictiveSnapshotContext,
  StudyContextRef,
  ValuationEngineContext,
  Vertical,
} from '../types/copilot.types';

// -- V1.6 : persistance du niveau de modele ------------------------------
const TIER_KEY = 'mzia.copilot.tier';

/** Lecture defensive : toute valeur inconnue ou illisible retombe sur 'sonnet'. */
function readTier(): ModelTier {
  try {
    const v = localStorage.getItem(TIER_KEY);
    return v === 'haiku' || v === 'sonnet' || v === 'opus' ? v : 'sonnet';
  } catch {
    return 'sonnet';
  }
}

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
  // V1.5 - niveau de modele demande, V1.6 - restaure depuis localStorage.
  // Un compte basic sera de toute facon ramene a 'haiku' par resolveTier.
  tier: ModelTier;

  contextHints: ContextHints;

  conversations: CopilotConversation[];
  currentConversationId: string | null;
  messages: ChatMessage[];
  /** Ce que les actions de cette conversation sont devenues. */
  actionRuns: ActionRun[];
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
  setTier: (tier: ModelTier) => void;
  setContextHints: (hints: Partial<ContextHints>) => void;
  clearContextHints: () => void;

  refreshCredits: () => Promise<void>;
  loadConversations: () => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  newConversation: () => void;

  rememberActionRun: (run: ActionRun) => void;

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
  tier: readTier(),

  contextHints: {},

  conversations: [],
  currentConversationId: null,
  messages: [],
  actionRuns: [],
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

  // V1.5/V1.6 : selection du niveau de modele depuis MimmozIAModelPicker.
  // L'ecriture localStorage precede le set : le choix survit au rechargement.
  setTier: (tier) => {
    try { localStorage.setItem(TIER_KEY, tier); } catch { /* mode prive, quota… */ }
    set({ tier });
  },

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
    set({ loadingMessages: true, currentConversationId: id, actionRuns: [] });
    try {
      // Les deux ensemble : afficher les cartes d'action sans leur trace, même
      // un instant, ferait apparaître « action proposée » sur des choses déjà
      // faites — et en mode autonome, ça les relancerait.
      const [messages, actionRuns] = await Promise.all([
        fetchMessages(id),
        fetchActionRuns(id),
      ]);
      set({ messages, actionRuns });
    } catch (e) {
      console.error('[copilot] selectConversation', e);
    } finally {
      set({ loadingMessages: false });
    }
  },

  // Point d'entrée unique des traces d'action, et seul endroit qui décide où
  // les écrire.
  //
  // Une action lancée en mode autonome part dès l'arrivée de `tool_use_end` et
  // met parfois une seconde à revenir (création d'étude, patch du foncier). Or
  // `message_start` — qui apporte le vrai `message_id` — peut tomber pendant ce
  // temps. Selon qui gagne la course, la trace arrive avant ou après que l'id
  // réel soit connu. Faire dépendre la persistance de cet ordre revenait à
  // perdre silencieusement la trace une fois sur deux : au rechargement, la
  // carte se reproposait, et en mode autonome elle se relançait — exactement ce
  // que cette trace existe pour empêcher.
  //
  // On résout donc l'id ici, au moment d'enregistrer, quel que soit l'ordre.
  rememberActionRun: (run) => {
    const { streamingId, currentConversationId } = get();
    const resolved =
      isLocalMessageId(run.messageId) && streamingId && !isLocalMessageId(streamingId)
        ? { ...run, messageId: streamingId }
        : run;

    set((s) => ({ actionRuns: [...s.actionRuns, resolved] }));

    // Encore local : `message_start` n'est pas passé. Il rattachera et écrira.
    if (currentConversationId && !isLocalMessageId(resolved.messageId)) {
      void persistActionRun(resolved, currentConversationId);
    }
  },

  // "+" du header : nouvelle conversation -> on quitte aussi l'intro.
  // NB : le tier n'est PAS reinitialise — c'est une preference utilisateur,
  // pas un etat de conversation.
  newConversation: () =>
    set({
      introMode: false,
      currentConversationId: null,
      messages: [],
      actionRuns: [],
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
          // Les actions exécutées pendant le flux ont été tracées sous l'id
          // local du message — le vrai n'arrive qu'ici, après persistance
          // serveur. On les rattache, puis on les écrit.
          actionRuns: s.actionRuns.map((r) =>
            r.messageId === oldId ? { ...r, messageId: event.message_id } : r,
          ),
          streamingId: event.message_id,
        }));

        // Les traces arrivées avant cet événement portaient l'id local ; elles
        // viennent d'être rattachées, on les écrit maintenant. L'index unique
        // en base absorbe le cas où `rememberActionRun` les avait déjà écrites.
        const conversationId = get().currentConversationId;
        if (conversationId) {
          for (const r of get().actionRuns) {
            if (r.messageId !== event.message_id) continue;
            void persistActionRun(r, conversationId);
          }
        }
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
      actionRuns: [],
      status: 'idle',
      streamingId: null,
      error: null,
    }),
}));