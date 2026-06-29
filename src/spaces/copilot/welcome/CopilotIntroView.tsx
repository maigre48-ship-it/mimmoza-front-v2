// src/spaces/copilot/welcome/CopilotIntroView.tsx
// Bot scripte : l'utilisateur clique une question -> reponse predefinie. Aucun reseau, aucune IA.
import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { COPILOT_HOME, type ScriptedQA } from './copilotWelcome';
import { COPILOT_THEME as T } from '../components/copilotTheme';

interface Bubble { role: 'user' | 'bot'; text: string; }

export function CopilotIntroView() {
  const [thread, setThread] = useState<Bubble[]>([]);
  const [asked, setAsked] = useState<Set<string>>(new Set());

  const ask = (item: ScriptedQA) => {
    setThread((t) => [...t, { role: 'user', text: item.q }, { role: 'bot', text: item.a }]);
    setAsked((s) => new Set(s).add(item.key));
  };

  const remaining = COPILOT_HOME.qa.filter((x) => !asked.has(x.key));

  return (
    <div style={styles.wrap}>
      {/* En-tete presentation */}
      <div style={styles.hero}>
        <div style={styles.badge}>
          <Sparkles size={20} color="#fff" />
        </div>
        <div style={styles.heroTitle}>{COPILOT_HOME.title}</div>
        <div style={styles.heroIntro}>{COPILOT_HOME.intro}</div>
      </div>

      {/* Fil de discussion scripte */}
      {thread.length > 0 && (
        <div style={styles.thread}>
          {thread.map((b, i) => (
            <div
              key={i}
              style={{
                ...styles.bubble,
                ...(b.role === 'user' ? styles.bubbleUser : styles.bubbleBot),
              }}
            >
              {b.text}
            </div>
          ))}
        </div>
      )}

      {/* Questions restantes */}
      {remaining.length > 0 && (
        <div style={styles.chips}>
          {remaining.map((item) => (
            <button key={item.key} style={styles.chip} onClick={() => ask(item)}>
              {item.q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 16, padding: '20px 16px' },
  hero: { display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 10, padding: '8px 4px 4px' },
  badge: {
    height: 56, width: 56, borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: `linear-gradient(135deg, ${T.accent}, rgb(79 70 229))`,
    boxShadow: '0 8px 28px rgba(79,70,229,.45)',
  },
  heroTitle: { fontSize: 18, fontWeight: 800, color: T.text },
  heroIntro: { fontSize: 13.5, lineHeight: 1.55, color: T.textMuted, maxWidth: 330 },
  thread: { display: 'flex', flexDirection: 'column', gap: 8 },
  bubble: { padding: '10px 12px', borderRadius: 12, fontSize: 13, lineHeight: 1.5, maxWidth: '88%' },
  bubbleUser: {
    alignSelf: 'flex-end', color: '#fff',
    background: `linear-gradient(135deg, ${T.accent}, rgb(79 70 229))`,
    borderBottomRightRadius: 4,
  },
  bubbleBot: {
    alignSelf: 'flex-start', color: T.text,
    background: 'rgba(255,255,255,.06)', border: `1px solid ${T.borderSoft}`,
    borderBottomLeftRadius: 4,
  },
  chips: { display: 'flex', flexDirection: 'column', gap: 8 },
  chip: {
    textAlign: 'left', padding: '11px 13px', borderRadius: 11,
    border: `1px solid ${T.borderSoft}`, background: 'rgba(255,255,255,.04)',
    color: T.text, fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
};