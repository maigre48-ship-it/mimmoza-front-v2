// src/spaces/copilot/MimmozIAPage.tsx
import { useEffect } from 'react';
import { Bot } from 'lucide-react';
import { CopilotChat } from './components/CopilotChat';
import { CopilotCreditsPill } from './components/CopilotCreditsPill';
import { useCopilot } from './hooks/useCopilot';
import { COPILOT_THEME as T } from './components/copilotTheme';

export default function MimmozIAPage() {
  const { refreshCredits, loadConversations } = useCopilot();

  // À l'entrée dans l'espace : on rafraîchit crédits + liste de conversations.
  // Le store étant global, une conversation ouverte dans le drawer flottant
  // est reprise ici telle quelle (comportement voulu).
  useEffect(() => {
    void refreshCredits();
    void loadConversations();
  }, [refreshCredits, loadConversations]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        // header (2 lignes) ≈ 8rem ; on remplit le reste de la fenêtre.
        height: 'calc(100vh - 8rem)',
        minHeight: 0,
        background: '#ffffff',
        color: '#0f172a',
      }}
    >
      {/* En-tête de l'espace */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '16px 20px',
          borderBottom: `1px solid ${T.borderSoft}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 40,
              height: 40,
              borderRadius: 12,
              background:
                'linear-gradient(135deg, #4c1d95 0%, #7c3aed 55%, #d946ef 100%)',
              flexShrink: 0,
            }}
          >
            <Bot size={22} color="#fff" />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: T.textStrong }}>
              MimmozIA
            </div>
            <div style={{ fontSize: 12, color: T.textMuted }}>
              Assistant IA connecté à toutes vos sources immo
            </div>
          </div>
        </div>

        <CopilotCreditsPill />
      </div>

      {/* Corps de chat réutilisé tel quel, forcé en thème clair.
          Le composant est partagé avec le drawer (sombre) : on n'override
          donc PAS le thème global, seulement l'intérieur de cette page. */}
      <div className="mimmozia-light" style={{ flex: 1, minHeight: 0 }}>
        <CopilotChat />
      </div>

      <style>{`
        .mimmozia-light,
        .mimmozia-light * {
          color: #0f172a !important;
        }
        .mimmozia-light code {
          background: rgba(15, 23, 42, 0.06) !important;
          color: #0f172a !important;
        }
        /* Bulle utilisateur : fond indigo léger, texte foncé lisible */
        .mimmozia-light [style*="border-radius: 14px 14px 4px 14px"] {
          background: rgba(99, 102, 241, 0.10) !important;
          border-color: rgba(99, 102, 241, 0.25) !important;
        }
      `}</style>
    </div>
  );
}