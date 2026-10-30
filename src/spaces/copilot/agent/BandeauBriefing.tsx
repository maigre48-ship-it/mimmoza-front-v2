// src/spaces/copilot/agent/BandeauBriefing.tsx
// Bandeau d'accueil « Pendant votre absence… » : dernier briefing non lu de
// la veille proactive. « C'est noté » le marque comme lu (RPC
// agent_briefing_marquer_lu). N'affiche rien s'il n'y a rien de neuf.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sunrise, X } from 'lucide-react';
import { dernierBriefingNonLu, marquerBriefingLu } from './agentApi';
import { dateCourte, LIBELLE_BRIEFING } from './agentLogique';
import type { Briefing } from './agent.types';
import { useAgentUi } from './agentUi.store';
import './agent.css';

export function BandeauBriefing() {
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [tout, setTout] = useState(false);

  useEffect(() => {
    let vivant = true;
    void (async () => {
      try { const b = await dernierBriefingNonLu(); if (vivant) setBriefing(b); }
      catch { /* pas encore installé ou hors ligne : rien à montrer */ }
    })();
    return () => { vivant = false; };
  }, []);

  if (!briefing) return null;

  const fermer = () => {
    const id = briefing.id;
    setBriefing(null);
    void marquerBriefingLu(id).catch(() => undefined);
  };
  const elements = tout ? briefing.elements : briefing.elements.slice(0, 4);

  return (
    <section className="mzag mzag-briefing" aria-label="Résumé de la veille">
      <div className="mzag-briefing__tete">
        <div>
          <span className="mzag-sur"><Sunrise size={14} aria-hidden /> Pendant votre absence… · {dateCourte(briefing.cree_le)}</span>
          <h2 className="mzag-briefing__titre">{briefing.titre}</h2>
          {briefing.resume && <p className="mzag-muet" style={{ margin: 0 }}>{briefing.resume}</p>}
        </div>
        <button type="button" className="mzag-iconbtn" onClick={fermer} aria-label="Masquer ce résumé" title="Masquer"><X size={16} /></button>
      </div>
      {elements.length > 0 && (
        <ul>
          {elements.map((e, i) => (
            <li key={`${e.titre}-${i}`}>
              <span className="mzag-briefing__genre">{LIBELLE_BRIEFING[e.genre] ?? 'Info'}</span>
              <span>
                <strong>{e.titre}</strong>
                {e.detail && <> — {e.detail}</>}
                {e.source && <span className="mzag-petit"> (source : {e.source})</span>}
                {e.lien && (e.lien.startsWith('/')
                  ? <> · <Link to={e.lien}>Voir</Link></>
                  : <> · <a href={e.lien} target="_blank" rel="noopener noreferrer">Voir</a></>)}
                {e.mission_id && <> · <button type="button" className="mzag-btn mzag-btn--discret mzag-btn--petit" style={{ padding: '0 4px' }} onClick={() => useAgentUi.getState().ouvrir('missions', e.mission_id)}>Voir l’analyse</button></>}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="mzag-actions" style={{ marginTop: 12 }}>
        {briefing.elements.length > 4 && !tout && <button type="button" className="mzag-btn mzag-btn--petit" onClick={() => setTout(true)}>Tout voir ({briefing.elements.length})</button>}
        {briefing.mission_id && <button type="button" className="mzag-btn mzag-btn--petit" onClick={() => useAgentUi.getState().ouvrir('missions', briefing.mission_id)}>Ouvrir l’analyse complète</button>}
        <button type="button" className="mzag-btn mzag-btn--plein mzag-btn--petit" onClick={fermer}>C’est noté</button>
      </div>
    </section>
  );
}
