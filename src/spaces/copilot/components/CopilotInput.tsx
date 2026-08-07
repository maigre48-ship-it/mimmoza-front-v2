// src/spaces/copilot/components/CopilotInput.tsx
// V1.8 — Pièces jointes + dictée ajoutées au composeur.
//   Les deux fonctions existaient déjà mais uniquement dans l'écran d'ACCUEIL
//   de MimmozIA : dès qu'une conversation était ouverte, ce composeur prenait
//   le relais et le trombone comme le micro disparaissaient. La logique est
//   désormais partagée via useComposerTools (voir le hook pour le détail).
import { Send, Square, Paperclip, Mic, X } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { CopilotMode } from '../types/copilot.types';
import { CopilotModeSelector } from './CopilotModeSelector';
import { COPILOT_THEME as T } from './copilotTheme';
import { useComposerTools, ACCEPT_FILES, type CopilotAttachment } from '../hooks/useComposerTools';

export function CopilotInput({
  mode, onChangeMode, onSend, onCancel, isStreaming, hideModeSelector,
}: {
  mode: CopilotMode;
  onChangeMode: (m: CopilotMode) => void;
  /**
   * `options.attachments` est optionnel : les appelants qui ne le transmettent
   * pas continuent de fonctionner, le message part simplement sans pièce jointe.
   */
  onSend: (text: string, options?: { attachments?: CopilotAttachment[] }) => void;
  onCancel: () => void;
  isStreaming: boolean;
  hideModeSelector?: boolean;
}) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  const tools = useComposerTools({
    // La dictée s'ajoute à la fin du texte déjà saisi plutôt que de l'écraser.
    onTranscript: (t) => setValue((prev) => (prev ? `${prev} ${t}` : t)),
  });

  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = 'auto';
      ref.current.style.height = Math.min(ref.current.scrollHeight, 140) + 'px';
    }
  }, [value]);

  const submit = () => {
    const t = value.trim();
    if (!t || isStreaming) return;
    const files = tools.toPayload();
    onSend(t, files.length ? { attachments: files } : undefined);
    setValue('');
    tools.clearAttachments();
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  };

  return (
    <div style={{ padding: '10px 12px', borderTop: `1px solid ${T.borderSoft}` }}>
      {!hideModeSelector && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <CopilotModeSelector mode={mode} onChange={onChangeMode} disabled={isStreaming} />
        </div>
      )}

      {/* Pastilles des pièces jointes + message d'erreur (taille, micro refusé…) */}
      {(tools.attachments.length > 0 || tools.error) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {tools.attachments.map((a) => (
            <span
              key={a.id}
              title={a.name}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                maxWidth: 220, padding: '4px 6px 4px 8px', borderRadius: 8,
                border: `1px solid ${T.border}`, background: 'rgb(255 255 255 / 0.05)',
                color: T.text, fontSize: 12,
              }}
            >
              <Paperclip size={13} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {a.name}
              </span>
              <button
                type="button"
                onClick={() => tools.removeAttachment(a.id)}
                title="Retirer"
                style={{
                  display: 'grid', placeItems: 'center', width: 18, height: 18,
                  border: 'none', borderRadius: 5, background: 'transparent',
                  color: T.textMuted, cursor: 'pointer', flexShrink: 0,
                }}
              >
                <X size={12} />
              </button>
            </span>
          ))}
          {tools.error && (
            <span style={{ fontSize: 12, color: 'rgb(248 113 113)', alignSelf: 'center' }}>
              {tools.error}
            </span>
          )}
        </div>
      )}

      {/* Sélecteur de fichiers caché, déclenché par le trombone. On remet
          value='' après coup pour pouvoir rechoisir le même fichier. */}
      <input
        ref={tools.fileInputRef}
        type="file"
        hidden
        multiple
        accept={ACCEPT_FILES}
        onChange={(e) => { void tools.handleFiles(e.target.files); e.target.value = ''; }}
      />

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
          placeholder="Écrivez ou dictez votre message…"
          rows={1}
          style={{
            flex: 1, resize: 'none', border: 'none', outline: 'none',
            background: 'transparent', color: T.text, fontSize: 14,
            lineHeight: 1.5, fontFamily: 'inherit', maxHeight: 140,
          }}
        />

        <button
          type="button"
          onClick={tools.openFilePicker}
          disabled={isStreaming}
          title="Joindre un fichier (image ou PDF)"
          style={ghostBtnStyle(isStreaming)}
        >
          <Paperclip size={16} />
        </button>

        <button
          type="button"
          onClick={tools.toggleDictation}
          disabled={!tools.dictationSupported || isStreaming}
          title={tools.dictationSupported ? 'Dicter' : 'Dictée non prise en charge par ce navigateur'}
          style={{
            ...ghostBtnStyle(!tools.dictationSupported || isStreaming),
            // Enregistrement en cours : le bouton doit être lisible d'un coup d'œil,
            // sinon on ne sait pas si le micro écoute.
            ...(tools.recording
              ? { background: 'rgb(248 113 113)', color: 'white', borderColor: 'transparent' }
              : null),
          }}
        >
          <Mic size={16} />
        </button>

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

/** Bouton secondaire : discret au repos, pour ne pas concurrencer « Envoyer ». */
function ghostBtnStyle(disabled: boolean): CSSProperties {
  return {
    height: 34, width: 34, flexShrink: 0, borderRadius: 10,
    border: `1px solid ${T.border}`, background: 'transparent',
    color: T.textMuted, cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.4 : 1,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'background .15s ease, color .15s ease',
  };
}
