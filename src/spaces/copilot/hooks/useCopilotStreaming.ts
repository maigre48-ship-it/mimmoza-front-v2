// src/spaces/copilot/hooks/useCopilotStreaming.ts
import { useCallback, useRef } from 'react';
import { streamCopilotChat, CopilotClientError } from '../lib/copilotClient';
import { useCopilotStore } from '../store/copilotStore';
import type { CopilotChatRequest } from '../types/copilot.types';

export function useCopilotStreaming() {
  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback(async (request: CopilotChatRequest): Promise<void> => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      await streamCopilotChat({
        request,
        signal: ac.signal,
        onEvent: (event) => useCopilotStore.getState().handleStreamEvent(event),
      });
    } catch (err) {
      if (ac.signal.aborted) return; // annulation utilisateur → déjà géré
      const message = err instanceof CopilotClientError
        ? err.message
        : err instanceof Error ? err.message : 'Erreur inconnue';
      useCopilotStore.getState().failStreaming(message);
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
    }
  }, []);

  const cancel = useCallback((): void => {
    abortRef.current?.abort();
    useCopilotStore.getState().cancelStreaming();
  }, []);

  return { start, cancel };
}