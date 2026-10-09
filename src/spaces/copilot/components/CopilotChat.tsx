// src/spaces/copilot/components/CopilotChat.tsx
import { useEffect, useRef, type ReactNode } from 'react';
import { useCopilot } from '../hooks/useCopilot';
import { useCopilotContext } from '../hooks/useCopilotContext';
import { getCopilotQuickQuestions } from '../utils/quickQuestions';
import { useLocation } from 'react-router-dom';
import { CopilotEmptyState } from './CopilotEmptyState';
import { CopilotInput } from './CopilotInput';
import { CopilotMessage } from './CopilotMessage';
import { COPILOT_THEME as T } from './copilotTheme';
import type { CopilotMode } from '../types/copilot.types';
import { FollowupPanel } from '../followup/FollowupPanel';

export function CopilotChat({
  forceMode,
  hideQuickQuestions,
  composerToolbar,
  onIntercept,
}: {
  forceMode?: CopilotMode;
  hideQuickQuestions?: boolean;
  /** Contrôles de l'écran hôte affichés au-dessus du composeur (cf. CopilotInput). */
  composerToolbar?: ReactNode;
  /** CH2 — l'écran hôte peut prendre en charge un message (ex. « génère la prévisualisation ») : true = ne pas l'envoyer. */
  onIntercept?: (text: string, options?: { attachments?: { mediaType: string; data: string; name?: string }[] }) => boolean;
} = {}) {
  const { messages, sendMessage, cancel, isStreaming, mode, setMode, loadingMessages, currentConversationId } = useCopilot();
  // `vertical` est désormais une valeur mémorisée exposée par le hook.
  // AVANT : `buildContext().vertical` était évalué à chaque rendu — donc à
  // chaque paquet de tokens pendant le streaming — pour lire un seul champ.
  // Chaque appel parcourait tout le localStorage deux fois, désérialisait deux
  // snapshots et imprimait douze lignes de trace. Voir useCopilotContext.
  const { vertical } = useCopilotContext();
  const { pathname } = useLocation();
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
    if (onIntercept?.(text, options as never)) return;
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
  const strategyQuestions = pathname === '/promoteur/strategie-projet'
    ? getCopilotQuickQuestions({ pathname, mode: effectiveMode === 'quick' ? 'quick' : 'advanced' }) : null;

  return (
    <div className="copilot-chat">
      <FollowupPanel conversationId={currentConversationId} onSend={handleSend} isStreaming={isStreaming} />
      <div ref={scrollRef} className="copilot-chat__messages">
        {empty ? (
          <CopilotEmptyState
            vertical={vertical}
            mode={effectiveMode}
            onPick={(s) => handleSend(s)}
            hideQuickQuestions={hideQuickQuestions}
          />
        ) : (
          messages.map((m) => <CopilotMessage key={m.id} message={m} conversationId={currentConversationId} onSend={handleSend} />)
        )}
      </div>
      {!empty && strategyQuestions && <div aria-label="Questions pour cette étude" style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '9px 12px', borderTop: `1px solid ${T.borderSoft}` }}>
        {strategyQuestions.map((question) => <button key={question.label} type="button" onClick={() => handleSend(question.prompt)} disabled={isStreaming}
          style={{ flexShrink: 0, border: `1px solid ${T.border}`, borderRadius: 999, background: T.accentSoft,
            color: T.text, padding: '6px 10px', fontSize: 11, cursor: isStreaming ? 'not-allowed' : 'pointer', opacity: isStreaming ? 0.5 : 1 }}>{question.label}</button>)}
      </div>}
      <CopilotInput
        mode={effectiveMode}
        onChangeMode={setMode}
        onSend={(t, options) => handleSend(t, options)}
        onCancel={cancel}
        isStreaming={isStreaming}
        hideModeSelector={Boolean(forceMode)}
        toolbar={composerToolbar}
      />
      <div className="copilot-chat__disclaimer" style={{ color: T.textMuted, borderTop: `1px solid ${T.borderSoft}` }}>
        ⚠️ MimmozIA peut commettre des erreurs. Les analyses doivent être vérifiées,
        notamment pour les données juridiques, urbanistiques, fiscales ou financières.
      </div>
    </div>
  );
}
