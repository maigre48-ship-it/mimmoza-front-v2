// src/spaces/copilot/components/CopilotMessage.tsx
import type { ChatMessage } from '../types/copilot.types';
import { CopilotToolCallCard } from './CopilotToolCallCard';
import { COPILOT_THEME as T } from './copilotTheme';

// Rendu markdown minimal (gras, titres, listes) sans dépendance externe.
function renderLight(text: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let html = esc(text);
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/`(.+?)`/g, '<code style="background:rgb(255 255 255/0.08);padding:1px 5px;border-radius:4px;font-size:12px">$1</code>');
  html = html.replace(/^### (.+)$/gm, '<div style="font-weight:700;margin:10px 0 4px;font-size:14px">$1</div>');
  html = html.replace(/^## (.+)$/gm, '<div style="font-weight:700;margin:12px 0 6px;font-size:15px">$1</div>');
  html = html.replace(/^[-•] (.+)$/gm, '<div style="padding-left:14px;position:relative">• $1</div>');
  html = html.replace(/\n/g, '<br/>');
  return html;
}

export function CopilotMessage({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

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
          {message.toolCalls.map((tc) => <CopilotToolCallCard key={tc.id} call={tc} />)}
        </div>
      )}
      {message.text && (
        <div
          style={{ color: T.text, fontSize: 14, lineHeight: 1.6 }}
          dangerouslySetInnerHTML={{ __html: renderLight(message.text) }}
        />
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