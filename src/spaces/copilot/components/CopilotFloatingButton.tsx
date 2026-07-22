// src/spaces/copilot/components/CopilotFloatingButton.tsx
import { useEffect } from 'react';
import { useCopilot } from '../hooks/useCopilot';

// Visuel FIXE de l'orbe (exporte dans /public). Bien plus net qu'une orbe
// "live" reduite a ~50px, dont les couches (halos, particules, anneaux)
// disparaissent en petit. Remplace le chemin par ton fichier reel.
const ORB_SRC = '/Orbe/orbe-mimmozia.png';

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
      aria-label="Ouvrir MimmozIA"
      data-print-hide
      style={{
        position: 'fixed', bottom: 24, right: 24, zIndex: 9998,
        height: 60, width: 60, borderRadius: 18,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 0, overflow: 'hidden',
        background: '#ffffff',
        border: '1px solid rgb(109 93 252 / 0.18)',
        boxShadow: '0 10px 30px rgb(76 29 149 / 0.20)',
        cursor: 'pointer',
        caretColor: 'transparent', userSelect: 'none',
        transition: 'transform .18s ease, box-shadow .18s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-2px) scale(1.05)';
        e.currentTarget.style.boxShadow = '0 14px 38px rgb(76 29 149 / 0.26)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'none';
        e.currentTarget.style.boxShadow = '0 10px 30px rgb(76 29 149 / 0.20)';
      }}
    >
      <img
        src={ORB_SRC}
        alt=""
        aria-hidden
        draggable={false}
        style={{
          width: '100%', height: '100%', objectFit: 'cover', display: 'block',
          pointerEvents: 'none', userSelect: 'none',
        }}
      />
    </button>
  );
}