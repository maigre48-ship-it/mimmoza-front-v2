// src/spaces/copilot/hooks/useCopilotStreaming.ts
import { useCallback, useRef } from 'react';
import { CopilotClientError, streamCopilotChat } from '../lib/copilotClient';
import { useCopilotStore } from '../store/copilotStore';
import type { CopilotChatRequest } from '../types/copilot.types';
import { track } from '@/lib/mimmozia/track';

/**
 * Journalise l'appel d'un outil copilot pour l'apprentissage MimmozIA.
 * Observe le flux SSE sans le perturber : fire-and-forget, opt-out géré dans
 * track(), et jamais d'exception propagée (appelé sous try/catch dans onEvent).
 *
 * On ne journalise que le DÉBUT d'un appel outil (pas son résultat) pour ne pas
 * compter deux fois. Les arguments de l'outil portent souvent l'insee/la ville
 * → signal géographique fort pour v_user_profile.
 *
 * ⚠️ COUTURE À CONFIRMER : la valeur réelle du discriminant `type` d'un
 *    événement d'outil dans copilot.types.ts. On matche les conventions les
 *    plus probables ci-dessous ; si ton flux utilise un autre nom (ou n'émet
 *    qu'un `tool_result`), dis-le-moi et j'ajuste la condition.
 */
function maybeTrackToolCall(event: unknown): void {
  if (!event || typeof event !== 'object') return;
  const e = event as Record<string, unknown>;
  const type = String(e.type ?? e.event ?? '');

  const isToolStart =
    type === 'tool_call' ||
    type === 'tool_use' ||
    type === 'tool_start' ||
    type === 'tool' ||
    type === 'tool.start';
  if (!isToolStart) return;

  const data = (e.data ?? {}) as Record<string, unknown>;
  const tool =
    (e.tool ?? e.name ?? e.tool_name ?? data.tool ?? data.name) as string | undefined;
  if (!tool) return;

  const args =
    (e.input ?? e.args ?? e.arguments ?? data.input ?? data.args ?? {}) as Record<string, unknown>;
  const insee = (args.insee ?? args.code_insee ?? args.commune_insee) as string | undefined;
  const city = (args.city ?? args.commune ?? args.ville) as string | undefined;

  void track('tool_call', { tool, insee, city });
}

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
        onEvent: (event) => {
          // Apprentissage : n'altère jamais le pipeline de streaming.
          try { maybeTrackToolCall(event); } catch { /* silencieux par conception */ }
          useCopilotStore.getState().handleStreamEvent(event);
        },
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