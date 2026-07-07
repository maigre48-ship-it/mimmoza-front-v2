// src/spaces/copilot/components/CopilotDrawer.tsx
import { Plus, Sparkles, X } from 'lucide-react';
import { useEffect, type CSSProperties } from 'react';
import { useLocation } from 'react-router-dom';
import { useCopilot } from '../hooks/useCopilot';
import { CopilotIntroView } from '../welcome/CopilotIntroView';
import { isLandingRoute } from '../welcome/copilotWelcome';
import { CopilotChat } from './CopilotChat';
import { CopilotCreditsPill } from './CopilotCreditsPill';
import { COPILOT_THEME as T } from './copilotTheme';

export function CopilotDrawer() {
  const { isOpen, closeCopilot, newConversation, credits, refreshCredits } = useCopilot();
  const { pathname } = useLocation();

  // Sur l'accueil : bot scripte uniquement, jamais l'IA. Hors accueil : chat normal.
  const scripted = isLandingRoute(pathname);

  // Pas d'appel reseau en mode scripte (0 credit).
  useEffect(() => { if (isOpen && !scripted) refreshCredits(); }, [isOpen, scripted, refreshCredits]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && isOpen) closeCopilot(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, closeCopilot]);

  return (
    <>
      {/* Styles d'animation (montes une fois) */}
      <style>{`
        @keyframes copilot-spin { to { transform: rotate(360deg); } }
        @keyframes copilot-bounce { 0%,80%,100% { transform: scale(0.6); opacity:.4 } 40% { transform: scale(1); opacity:1 } }
        @keyframes copilot-slide-in { from { transform: translateX(100%); } to { transform: translateX(0); } }
      `}</style>

      {/* Overlay */}
      {isOpen && (
        <div
          onClick={closeCopilot}
          style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgb(0 0 0 / 0.4)', backdropFilter: 'blur(2px)' }}
        />
      )}

      {/* Drawer */}
      {isOpen && (
        <aside style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 9999,
          width: 'min(440px, 100vw)', display: 'flex', flexDirection: 'column',
          background: T.bg, borderLeft: `1px solid ${T.border}`,
          boxShadow: '-12px 0 48px rgb(0 0 0 / 0.5)',
          animation: 'copilot-slide-in .26s cubic-bezier(.22,1,.36,1)',
        }}>
          {/* Header */}
          <header style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '14px 16px', borderBottom: `1px solid ${T.borderSoft}`,
          }}>
            <div style={{
              height: 30, width: 30, borderRadius: 9,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: `linear-gradient(135deg, ${T.accent}, rgb(79 70 229))`,
            }}>
              <Sparkles size={16} color="white" />
            </div>
            <div style={{ color: T.text, fontWeight: 700, fontSize: 15 }}>Analyste Mimmoza</div>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
              {/* En mode scripte : pas de credits ni "nouvelle conversation". */}
              {!scripted && (
                <>
                  <CopilotCreditsPill credits={credits} />
                  <button onClick={newConversation} title="Nouvelle conversation" style={iconBtn()}>
                    <Plus size={17} />
                  </button>
                </>
              )}
              <button onClick={closeCopilot} title="Fermer (Esc)" style={iconBtn()}>
                <X size={17} />
              </button>
            </div>
          </header>

          {/* Corps : bot scripte (accueil) OU chat IA */}
          <div style={{ flex: 1, minHeight: 0, overflowY: scripted ? 'auto' : undefined }}>
            {scripted ? <CopilotIntroView /> : <CopilotChat />}
          </div>
        </aside>
      )}
    </>
  );
}

function iconBtn(): CSSProperties {
  return {
    height: 30, width: 30, borderRadius: 8, border: `1px solid ${T.borderSoft}`,
    background: 'transparent', color: T.textMuted, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
}