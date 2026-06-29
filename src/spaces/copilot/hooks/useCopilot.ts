// src/spaces/copilot/hooks/useCopilot.ts
import { useCallback } from 'react';
import { useCopilotStore } from '../store/copilotStore';
import type {
  ParcelContextRef, StudyContextRef,
  Vertical,
} from '../types/copilot.types';
import { useCopilotContext } from './useCopilotContext';
import { useCopilotStreaming } from './useCopilotStreaming';

interface SendOptions {
  vertical?: Vertical;
  parcel?: ParcelContextRef;
  study?: StudyContextRef;
}

export function useCopilot() {
  const { buildContext } = useCopilotContext();
  const { start, cancel } = useCopilotStreaming();

  // -- Selecteurs (primitives -> re-render cible) --
  const messages = useCopilotStore((s) => s.messages);
  const status = useCopilotStore((s) => s.status);
  const credits = useCopilotStore((s) => s.credits);
  const error = useCopilotStore((s) => s.error);
  const mode = useCopilotStore((s) => s.mode);
  const conversations = useCopilotStore((s) => s.conversations);
  const currentConversationId = useCopilotStore((s) => s.currentConversationId);
  const isOpen = useCopilotStore((s) => s.isOpen);
  const introMode = useCopilotStore((s) => s.introMode);
  const loadingConversations = useCopilotStore((s) => s.loadingConversations);
  const loadingMessages = useCopilotStore((s) => s.loadingMessages);

  // -- Actions store (references stables) --
  const setMode = useCopilotStore((s) => s.setMode);
  const setContextHints = useCopilotStore((s) => s.setContextHints);
  const openCopilot = useCopilotStore((s) => s.openCopilot);
  const closeCopilot = useCopilotStore((s) => s.closeCopilot);
  const toggleCopilot = useCopilotStore((s) => s.toggleCopilot);
  const openIntro = useCopilotStore((s) => s.openIntro);
  const exitIntro = useCopilotStore((s) => s.exitIntro);
  const refreshCredits = useCopilotStore((s) => s.refreshCredits);
  const loadConversations = useCopilotStore((s) => s.loadConversations);
  const selectConversation = useCopilotStore((s) => s.selectConversation);
  const newConversation = useCopilotStore((s) => s.newConversation);

  // -- Envoi d'un message --
  const sendMessage = useCallback(async (text: string, options?: SendOptions): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const st = useCopilotStore.getState();
    if (st.status === 'streaming') return; // garde anti double-envoi

    const context = buildContext(options);
    const wasNew = !st.currentConversationId;

    st.pushUserMessage(trimmed, st.mode);
    st.beginAssistantMessage(st.mode);

    await start({
      conversation_id: st.currentConversationId ?? undefined,
      message: trimmed,
      mode: st.mode,
      context,
    });

    // Conversation nouvellement creee -> on rafraichit la liste (sidebar)
    if (wasNew) useCopilotStore.getState().loadConversations();
  }, [buildContext, start]);

  return {
    // etat
    messages, status, isStreaming: status === 'streaming',
    credits, error, mode, conversations, currentConversationId,
    isOpen, introMode, loadingConversations, loadingMessages,
    // actions
    sendMessage, cancel, setMode, setContextHints,
    openCopilot, closeCopilot, toggleCopilot, openIntro, exitIntro,
    refreshCredits, loadConversations, selectConversation, newConversation,
  };
}