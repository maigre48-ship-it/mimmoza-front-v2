// src/spaces/copilot/components/CopilotInput.tsx
import { Send, Square } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { CopilotMode } from '../types/copilot.types';
import { CopilotModeSelector } from './CopilotModeSelector';
import { COPILOT_THEME as T } from './copilotTheme';

export function CopilotInput({
  mode, onChangeMode, onSend, onCancel, isStreaming,
}: {
  mode: CopilotMode;
  onChangeMode: (m: CopilotMode) => void;
  onSend: (text: string) => void;
  onCancel: () => void;
  isStreaming: boolean;
}) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = 'auto';
      ref.current.style.height = Math.min(ref.current.scrollHeight, 140) + 'px';
    }
  }, [value]);

  const submit = () => {
    const t = value.trim();
    if (!t || isStreaming) return;
    onSend(t);
    setValue('');
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  };

  return (
    <div style={{ padding: '10px 12px', borderTop: `1px solid ${T.borderSoft}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <CopilotModeSelector mode={mode} onChange={onChangeMode} disabled={isStreaming} />
      </div>
      <div style={{
        display: 'flex', gap: 8, alignItems: 'flex-end',
        background: 'rgb(255 255 255 / 0.04)', border: `1px solid ${T.border}`,
        borderRadius: 14, padding: 8,
      }}>
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKey}
          placeholder="Posez une question, ou demandez une analyse…"
          rows={1}
          style={{
            flex: 1, resize: 'none', border: 'none', outline: 'none',
            background: 'transparent', color: T.text, fontSize: 14,
            lineHeight: 1.5, fontFamily: 'inherit', maxHeight: 140,
          }}
        />
        {isStreaming ? (
          <button onClick={onCancel} title="Arrêter" style={btnStyle('rgb(248 113 113)')}>
            <Square size={16} fill="currentColor" />
          </button>
        ) : (
          <button onClick={submit} disabled={!value.trim()} title="Envoyer (Entrée)"
            style={{ ...btnStyle(T.accent), opacity: value.trim() ? 1 : 0.4 }}>
            <Send size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

function btnStyle(color: string): CSSProperties {
  return {
    height: 34, width: 34, flexShrink: 0, borderRadius: 10, border: 'none',
    background: color, color: 'white', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
}