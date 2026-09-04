// src/spaces/copilot/hooks/useCopilot.ts
// PATCH V1.5 : le `tier` (niveau de modele) est lu dans le store et transmis
//   dans le payload envoye a copilot-chat. Rappel : copilot-chat lit le PLAN
//   en base (billing_profiles.plan_code) et applique resolveTier — un tier hors
//   plan est silencieusement ramene au tier par defaut du plan. L'UI ne decide pas.
// PATCH V1.6 : pieces jointes (images + PDF). Les fichiers sont encodes en
//   base64 cote appelant et transmis dans `attachments`. Ils ne concernent QUE
//   le message courant : l'historique relu depuis copilot_messages est du texte,
//   donc une relance ulterieure ne "revoit" pas le fichier.
import { useCallback } from 'react';
import { useCopilotStore } from '../store/copilotStore';
import type {
  CopilotAttachment, ParcelContextRef, StudyContextRef,
  Vertical,
} from '../types/copilot.types';
import { useCopilotContext } from './useCopilotContext';
import { useCopilotStreaming } from './useCopilotStreaming';
import { track } from '@/lib/mimmozia/track';

interface SendOptions {
  vertical?: Vertical;
  parcel?: ParcelContextRef;
  study?: StudyContextRef;
  attachments?: CopilotAttachment[];
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
  const tier = useCopilotStore((s) => s.tier);
  const conversations = useCopilotStore((s) => s.conversations);
  const currentConversationId = useCopilotStore((s) => s.currentConversationId);
  const isOpen = useCopilotStore((s) => s.isOpen);
  const introMode = useCopilotStore((s) => s.introMode);
  const loadingConversations = useCopilotStore((s) => s.loadingConversations);
  const loadingMessages = useCopilotStore((s) => s.loadingMessages);

  // -- Actions store (references stables) --
  const setMode = useCopilotStore((s) => s.setMode);
  const setTier = useCopilotStore((s) => s.setTier);
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

    // — Apprentissage (fire-and-forget, opt-out aware). Centralisé ici pour
    //   couvrir TOUTES les surfaces copilot (page MimmozIA + drawer global).
    void track('search', options?.vertical ? { module: options.vertical } : {});
    if (options?.parcel) {
      // ⚠️ champs de ParcelContextRef supposés — à confirmer (insee / city).
      const p = options.parcel as unknown as Record<string, unknown>;
      void track('property_view', {
        insee: (p.insee ?? p.code_insee ?? p.commune_insee) as string | undefined,
        city: (p.city ?? p.commune ?? p.ville) as string | undefined,
      });
    }

    const context = buildContext(options);
    const wasNew = !st.currentConversationId;

    st.pushUserMessage(trimmed, st.mode);
    st.beginAssistantMessage(st.mode);

    await start({
      conversation_id: st.currentConversationId ?? undefined,
      message: trimmed,
      mode: st.mode,
      // V1.5 : niveau de modele demande. Revalide cote serveur par resolveTier
      // contre le plan de l'utilisateur — hors plan = ignore, jamais honore.
      tier: st.tier,
      // V1.6 : pieces jointes du message courant uniquement.
      ...(options?.attachments?.length ? { attachments: options.attachments } : {}),
      context,
    });

    // Conversation nouvellement creee -> on rafraichit la liste (sidebar)
    if (wasNew) useCopilotStore.getState().loadConversations();
  }, [buildContext, start]);

  return {
    // etat
    messages, status, isStreaming: status === 'streaming',
    credits, error, mode, tier, conversations, currentConversationId,
    isOpen, introMode, loadingConversations, loadingMessages,
    // actions
    sendMessage, cancel, setMode, setTier, setContextHints,
    openCopilot, closeCopilot, toggleCopilot, openIntro, exitIntro,
    refreshCredits, loadConversations, selectConversation, newConversation,
  };
}