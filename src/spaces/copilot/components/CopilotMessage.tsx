// src/spaces/copilot/components/CopilotMessage.tsx
import type { ChatMessage } from '../types/copilot.types';
import { CopilotToolCallCard } from './CopilotToolCallCard';
import { CopilotActionCard } from './CopilotActionCard';
import { isActionTool, readAction, sameAction } from '../actions/copilotActions';
import { useCopilotStore } from '../store/copilotStore';
import { COPILOT_THEME as T } from './copilotTheme';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { exportCopilotResponseToPdf, markdownToSafeHtml } from '../utils/exportCopilotPdf';
import './CopilotMessage.css';

export function CopilotMessage({ message, question }: { message: ChatMessage; question?: string | null }) {
  const isUser = message.role === 'user';
  const actionRuns = useCopilotStore((s) => s.actionRuns);
  const messages = useCopilotStore((s) => s.messages);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const linkedQuestion = question ?? (() => {
    const index = messages.findIndex((item) => item.id === message.id);
    for (let i = index - 1; i >= 0; i--) if (messages[i].role === 'user') return messages[i].text;
    return null;
  })();

  const handleResponseExport = async () => {
    setExporting(true); setExportError(null);
    try {
      const result = await exportCopilotResponseToPdf({ response: message, question: linkedQuestion });
      if (result === 'popup_blocked') setExportError('Autorisez les fenêtres contextuelles pour exporter le PDF.');
    } catch {
      setExportError('Le rapport PDF n’a pas pu être préparé.');
    } finally { setExporting(false); }
  };

  if (isUser) {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '10px 0' }}>
        <div style={{
          maxWidth: '82%', padding: '10px 14px', borderRadius: '14px 14px 4px 14px',
          background: T.userBubble, border: `1px solid ${T.border}`,
          color: T.text, fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap',
        }}>
          {message.text}
        </div>
      </div>
    );
  }

  return (
    <div style={{ margin: '10px 0' }}>
      {message.toolCalls.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          {message.toolCalls.map((tc) => {
            // Un outil d'action ne raconte pas ce qu'il a lu : il propose de
            // faire quelque chose. Tant qu'il tourne, on garde la carte
            // technique ; dès qu'il a répondu, on rend la carte d'action.
            if (isActionTool(tc.name) && tc.status !== 'running') {
              const action = readAction(tc.output);
              if (action) {
                // Si cette action a déjà été tranchée, la carte affiche le
                // résultat au lieu de reproposer — et ne se relance pas.
                const past = actionRuns.find((r) => sameAction(r, message.id, action));
                return (
                  <CopilotActionCard
                    key={tc.id}
                    action={action}
                    messageId={message.id}
                    run={past}
                  />
                );
              }
            }
            return <CopilotToolCallCard key={tc.id} call={tc} />;
          })}
        </div>
      )}
      {message.text && (
        <div
          className="copilot-message-markdown"
          style={{ color: T.text, fontSize: 14, lineHeight: 1.6 }}
          dangerouslySetInnerHTML={{ __html: markdownToSafeHtml(message.text) }}
        />
      )}
      {message.status === 'complete' && message.text.trim() && (
        <div className="copilot-message-actions">
          <button type="button" onClick={() => void handleResponseExport()} disabled={exporting} aria-label="Exporter cette réponse en PDF" aria-busy={exporting}>
            <Download size={14} aria-hidden="true" /> {exporting ? 'Préparation…' : 'Exporter en PDF'}
          </button>
          {exportError && <span role="status">{exportError}</span>}
        </div>
      )}
      {message.status === 'streaming' && !message.text && message.toolCalls.length === 0 && (
        <div style={{ display: 'inline-flex', gap: 4, padding: '4px 0' }}>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{
              width: 6, height: 6, borderRadius: '50%', background: T.accent,
              animation: `copilot-bounce 1.2s ${i * 0.15}s infinite ease-in-out`,
            }} />
          ))}
        </div>
      )}
      {message.status === 'error' && (
        <div style={{ color: 'rgb(248 113 113)', fontSize: 13, marginTop: 6 }}>
          ⚠️ {message.error ?? 'Une erreur est survenue.'}
        </div>
      )}
    </div>
  );
}
