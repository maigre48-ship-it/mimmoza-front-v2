// src/spaces/copilot/components/CopilotFloatingButton.tsx
import { useEffect } from 'react';
import { Sparkles } from 'lucide-react';
import { useCopilot } from '../hooks/useCopilot';
import { COPILOT_THEME as T } from './copilotTheme';

export function CopilotFloatingButton() {
  const { toggleCopilot, isOpen } = useCopilot();

  // Raccourci global Cmd/Ctrl+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        toggleCopilot();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleCopilot]);

  if (isOpen) return null;

  return (
    <button
      onClick={toggleCopilot}
      aria-label="Ouvrir Mimmoza Copilot"
      data-print-hide
      style={{
        position: 'fixed', bottom: 24, right: 24, zIndex: 9998,
        height: 56, width: 56, borderRadius: 18,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: `linear-gradient(135deg, ${T.accent}, rgb(79 70 229))`,
        border: `1px solid ${T.border}`,
        boxShadow: `0 8px 32px ${T.accentGlow}, 0 0 0 1px rgb(255 255 255 / 0.05) inset`,
        cursor: 'pointer', color: 'white',
        transition: 'transform .18s ease, box-shadow .18s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-2px) scale(1.04)';
        e.currentTarget.style.boxShadow = `0 12px 40px ${T.accentGlow}`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'none';
        e.currentTarget.style.boxShadow = `0 8px 32px ${T.accentGlow}, 0 0 0 1px rgb(255 255 255 / 0.05) inset`;
      }}
    >
      <Sparkles size={24} strokeWidth={2.2} />
    </button>
  );
}