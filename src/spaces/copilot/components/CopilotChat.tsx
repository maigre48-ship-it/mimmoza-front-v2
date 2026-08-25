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
  // `vertical` est désormais une valeur mémorisée exposée par le hook.
  // AVANT : `buildContext().vertical` était évalué à chaque rendu — donc à
  // chaque paquet de tokens pendant le streaming — pour lire un seul champ.
  // Chaque appel parcourait tout le localStorage deux fois, désérialisait deux
  // snapshots et imprimait douze lignes de trace. Voir useCopilotContext.
  const { vertical } = useCopilotContext();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Mode effectif : si forceMode est fourni (ex. MimmozIA en "advanced"),
  // il prime sur le mode global du store — sans jamais écrire dans le store,
  // pour ne pas impacter le drawer flottant partagé.
  const effectiveMode: CopilotMode = forceMode ?? mode;

  // Si le mode est forcé, on envoie toujours dans ce mode (setMode reste global,
  // donc on passe par un sendMessage qui garantit le bon mode à l'appel).
  // V1.8 : `options` relaie les pièces jointes du composeur. Sans ce paramètre,
  // les fichiers joints étaient silencieusement perdus à l'envoi.
  const handleSend = (
    text: string,
    options?: Parameters<typeof sendMessage>[1],
  ) => {
    if (forceMode && mode !== forceMode) {
      setMode(forceMode);
    }
    sendMessage(text, options);
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
    <div className="copilot-chat">
      <div ref={scrollRef} className="copilot-chat__messages">
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
        onSend={(t, options) => handleSend(t, options)}
        onCancel={cancel}
        isStreaming={isStreaming}
        hideModeSelector={Boolean(forceMode)}
      />
      <div className="copilot-chat__disclaimer" style={{ color: T.textMuted, borderTop: `1px solid ${T.borderSoft}` }}>
        ⚠️ MimmozIA peut commettre des erreurs. Les analyses doivent être vérifiées,
        notamment pour les données juridiques, urbanistiques, fiscales ou financières.
      </div>
    </div>
  );
}
