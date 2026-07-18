// src/spaces/copilot/components/CopilotChat.tsx
import { useEffect, useRef } from 'react';
import { useCopilot } from '../hooks/useCopilot';
import { useCopilotContext } from '../hooks/useCopilotContext';
import { CopilotEmptyState } from './CopilotEmptyState';
import { CopilotInput } from './CopilotInput';
import { CopilotMessage } from './CopilotMessage';
import { COPILOT_THEME as T } from './copilotTheme';
import type { CopilotMode } from '../types/copilot.types';

export function CopilotChat({
  forceMode,
  hideQuickQuestions,
}: {
  forceMode?: CopilotMode;
  hideQuickQuestions?: boolean;
} = {}) {
  const { messages, sendMessage, cancel, isStreaming, mode, setMode, loadingMessages } = useCopilot();
  const { buildContext } = useCopilotContext();
  const scrollRef = useRef<HTMLDivElement>(null);
  const vertical = buildContext().vertical;

  // Mode effectif : si forceMode est fourni (ex. MimmozIA en "advanced"),
  // il prime sur le mode global du store — sans jamais écrire dans le store,
  // pour ne pas impacter le drawer flottant partagé.
  const effectiveMode: CopilotMode = forceMode ?? mode;

  // Si le mode est forcé, on envoie toujours dans ce mode (setMode reste global,
  // donc on passe par un sendMessage qui garantit le bon mode à l'appel).
  const handleSend = (text: string) => {
    if (forceMode && mode !== forceMode) {
      setMode(forceMode);
    }
    sendMessage(text);
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  // Filet de sécurité : si on entre dans MimmozIA alors que le store est resté
  // sur "quick" (usage précédent du drawer), on aligne une fois sur le mode forcé.
  useEffect(() => {
    if (forceMode && mode !== forceMode) {
      setMode(forceMode);
    }
    // volontairement sur le montage / changement de forceMode uniquement
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceMode]);

  const empty = messages.length === 0 && !loadingMessages;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', minHeight: 0 }}>
        {empty ? (
          <CopilotEmptyState
            vertical={vertical}
            mode={effectiveMode}
            onPick={(s) => handleSend(s)}
            hideQuickQuestions={hideQuickQuestions}
          />
        ) : (
          messages.map((m) => <CopilotMessage key={m.id} message={m} />)
        )}
      </div>
      <CopilotInput
        mode={effectiveMode}
        onChangeMode={setMode}
        onSend={(t) => handleSend(t)}
        onCancel={cancel}
        isStreaming={isStreaming}
        hideModeSelector={Boolean(forceMode)}
      />
      <div style={{ fontSize: 11, color: T.textMuted, padding: '8px 16px', borderTop: `1px solid ${T.borderSoft}`, lineHeight: 1.4 }}>
        ⚠️ L'Analyste Mimmoza peut commettre des erreurs. Les analyses doivent être vérifiées,
        notamment pour les données juridiques, urbanistiques, fiscales ou financières.
      </div>
    </div>
  );
}