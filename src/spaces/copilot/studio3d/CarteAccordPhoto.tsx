// src/spaces/copilot/studio3d/CarteAccordPhoto.tsx
// =============================================================================
// FINITIONS DU 18/11/2026 — carte « Utiliser cette photo pour l'image ? » sous le parcours (extension ou maison neuve),
// affichée seulement quand le serveur la demande (mode d'accord « bouton »). Les deux boutons envoient au chat les
// réponses EXACTES reconnues par le serveur ; rien n'est décidé ici.
// =============================================================================
import { useState } from 'react';
import { ImageIcon } from 'lucide-react';
import type { DemandeAccordPhoto } from '@/lib/studio/accordPhoto';

export function CarteAccordPhoto({ demande, actif, onSend }: { demande: DemandeAccordPhoto; actif: boolean; onSend?: (texte: string) => void }) {
  const [repondu, setRepondu] = useState<string | null>(null);
  const cliquable = actif && !repondu && !!onSend;
  const bouton = (texte: string, principal: boolean) => (
    <button
      type="button"
      disabled={!cliquable}
      onClick={() => { setRepondu(texte); onSend?.(texte); }}
      style={{
        padding: '8px 14px', borderRadius: 8, fontSize: 14, cursor: cliquable ? 'pointer' : 'default',
        border: principal ? 'none' : '1px solid #cbd5e1', background: principal ? '#1e293b' : '#fff', color: principal ? '#fff' : '#1e293b',
        opacity: cliquable || repondu === texte ? 1 : 0.55,
      }}
    >{texte}</button>
  );
  return (
    <div role="group" aria-label={demande.titre} style={{ margin: '10px 0', padding: 14, border: '1px solid #e2e8f0', borderRadius: 12, background: '#f8fafc' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, marginBottom: 6 }}>
        <ImageIcon size={18} aria-hidden="true" />{demande.titre}
      </div>
      <p style={{ margin: '0 0 10px', fontSize: 14, lineHeight: 1.45, color: '#334155' }}>{demande.texte}</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {bouton(demande.oui, true)}
        {bouton(demande.non, false)}
      </div>
      {!actif && !repondu && <p style={{ margin: '8px 0 0', fontSize: 12, color: '#64748b' }}>Une réponse plus récente a été donnée plus bas dans la conversation.</p>}
    </div>
  );
}
