// src/spaces/copilot/agent/EntreeAgentSidebar.tsx
// Bloc « Agent » du menu latéral MimmozIA (thème sombre du menu) : ouvre le
// panneau de l'agent sur Missions, À valider ou Mémoire, avec compteurs.
import { Bot, Brain, ListChecks, MailCheck } from 'lucide-react';
import { useAgentUi, type OngletAgent } from './agentUi.store';
import { useCompteursAgent } from './useCompteursAgent';
import './agentSidebar.css';

export function EntreeAgentSidebar({ onCloseMobile }: { onCloseMobile?: () => void }) {
  const c = useCompteursAgent();
  const ouvrir = (o: OngletAgent) => { useAgentUi.getState().ouvrir(o, o === 'missions' ? null : undefined); onCloseMobile?.(); };
  return (
    <div className="mzag-side">
      <div className="mzia-side__sectionhead"><span>Agent</span></div>
      <button type="button" className="mzag-side__btn" onClick={() => ouvrir('missions')}>
        <ListChecks size={15} aria-hidden />
        <span className="mzag-side__label">Missions</span>
        {c.enAttente > 0
          ? <span className="mzag-side__badge mzag-side__badge--attente" title="Missions qui attendent votre réponse">{c.enAttente}</span>
          : c.actives > 0 && <span className="mzag-side__badge" title="Missions en cours">{c.actives}</span>}
      </button>
      <button type="button" className="mzag-side__btn" onClick={() => ouvrir('actions')}>
        <MailCheck size={15} aria-hidden />
        <span className="mzag-side__label">À valider</span>
        {c.aValider > 0 && <span className="mzag-side__badge" title="Brouillons à relire">{c.aValider}</span>}
      </button>
      <button type="button" className="mzag-side__btn" onClick={() => ouvrir('memoire')}>
        <Brain size={15} aria-hidden />
        <span className="mzag-side__label">Mémoire des projets</span>
      </button>
    </div>
  );
}

/** Icône seule pour le rail réduit du menu. */
export function BoutonAgentRail() {
  const c = useCompteursAgent();
  const n = c.enAttente + c.aValider;
  return (
    <button className="mzia-rail__btn mzag-rail" title="Agent : missions, brouillons, mémoire"
      onClick={() => useAgentUi.getState().ouvrir('missions', null)} aria-label="Ouvrir l’agent">
      <Bot size={18} />
      {n > 0 && <span className="mzag-rail__point" aria-hidden />}
    </button>
  );
}
