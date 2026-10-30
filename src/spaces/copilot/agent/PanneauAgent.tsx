// src/spaces/copilot/agent/PanneauAgent.tsx
// Panneau latéral droit de l'agent : onglets Missions / À valider / Mémoire.
// Monté UNE fois par la page MimmozIA ; s'ouvre via useAgentUi().ouvrir(…)
// (menu latéral, carte de devis, rapport). Rendu dans document.body pour ne
// dépendre d'aucun conteneur de la page.
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Bot, X } from 'lucide-react';
import { ActionsAValider } from './ActionsAValider';
import { MemoireProjet } from './MemoireProjet';
import { PanneauMissions } from './PanneauMissions';
import { PanneauConception } from './conception/PanneauConception';
import { useAgentUi, type OngletAgent } from './agentUi.store';
import { useCompteursAgent } from './useCompteursAgent';
import './agent.css';

const ONGLETS: { id: OngletAgent; label: string }[] = [
  { id: 'missions', label: 'Missions' },
  { id: 'actions', label: 'À valider' },
  { id: 'conception', label: 'Conception' },
  { id: 'memoire', label: 'Mémoire' },
];

export function PanneauAgent() {
  const ouvert = useAgentUi((s) => s.ouvert);
  const onglet = useAgentUi((s) => s.onglet);
  const compteurs = useCompteursAgent();
  const fermerRef = useRef<HTMLButtonElement | null>(null);

  // Déclare un « hôte » : la carte de devis sait qu'elle peut ouvrir le panneau.
  useEffect(() => useAgentUi.getState().monterHote(), []);

  useEffect(() => {
    if (!ouvert) return;
    const precedent = document.activeElement as HTMLElement | null;
    fermerRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') useAgentUi.getState().fermer(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); precedent?.focus?.(); };
  }, [ouvert]);

  if (!ouvert || typeof document === 'undefined') return null;

  const badge = (id: OngletAgent) =>
    id === 'missions' ? compteurs.enAttente || compteurs.actives : id === 'actions' ? compteurs.aValider : 0;

  return createPortal(
    <div className="mzag">
      <div className="mzag-voile" onClick={() => useAgentUi.getState().fermer()} aria-hidden />
      <aside className="mzag-panneau" role="dialog" aria-modal="true" aria-labelledby="mzag-panneau-titre">
        <div className="mzag-panneau__tete">
          <h2 id="mzag-panneau-titre" className="mzag-panneau__titre"><Bot size={18} aria-hidden /> Agent MimmozIA</h2>
          <button ref={fermerRef} type="button" className="mzag-iconbtn" onClick={() => useAgentUi.getState().fermer()} aria-label="Fermer le panneau"><X size={18} /></button>
        </div>
        <div className="mzag-onglets" role="tablist">
          {ONGLETS.map((o) => (
            <button key={o.id} type="button" role="tab" className="mzag-onglet" aria-selected={onglet === o.id}
              onClick={() => useAgentUi.getState().ouvrir(o.id, o.id === 'missions' && onglet === 'missions' ? null : undefined)}>
              {o.label}{badge(o.id) > 0 && <span className="mzag-compteur">{badge(o.id)}</span>}
            </button>
          ))}
        </div>
        <div className="mzag-panneau__corps" role="tabpanel">
          {!compteurs.disponible && <p className="mzag-info" style={{ marginTop: 0 }}>L’agent n’est pas encore activé sur votre espace. Il le sera très bientôt.</p>}
          {onglet === 'missions' && <PanneauMissions />}
          {onglet === 'actions' && <ActionsAValider />}
          {onglet === 'memoire' && <MemoireProjet />}
          {onglet === 'conception' && <PanneauConception />}
        </div>
      </aside>
    </div>,
    document.body,
  );
}
