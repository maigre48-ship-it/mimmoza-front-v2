// src/spaces/copilot/components/CopilotChat.tsx
import { useEffect, useRef } from 'react';
import { useCopilot } from '../hooks/useCopilot';
import { useCopilotContext } from '../hooks/useCopilotContext';
import { CopilotEmptyState } from './CopilotEmptyState';
import { CopilotInput } from './CopilotInput';
import { CopilotMessage } from './CopilotMessage';
import { COPILOT_THEME as T } from './copilotTheme';

export function CopilotChat() {
  const { messages, sendMessage, cancel, isStreaming, mode, setMode, loadingMessages } = useCopilot();
  const { buildContext } = useCopilotContext();
  const scrollRef = useRef<HTMLDivElement>(null);

  const vertical = buildContext().vertical;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const empty = messages.length === 0 && !loadingMessages;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', minHeight: 0 }}>
        {empty ? (
          <CopilotEmptyState vertical={vertical} mode={mode} onPick={(s) => sendMessage(s)} />
        ) : (
          messages.map((m) => <CopilotMessage key={m.id} message={m} />)
        )}
      </div>

      <CopilotInput
        mode={mode}
        onChangeMode={setMode}
        onSend={(t) => sendMessage(t)}
        onCancel={cancel}
        isStreaming={isStreaming}
      />

      <div style={{ fontSize: 11, color: T.textMuted, padding: '8px 16px', borderTop: `1px solid ${T.borderSoft}`, lineHeight: 1.4 }}>
        ⚠️L'Analyste Mimmoza peut commettre des erreurs. Les analyses doivent être vérifiées,
        notamment pour les données juridiques, urbanistiques, fiscales ou financières.
      </div>
    </div>
  );
}