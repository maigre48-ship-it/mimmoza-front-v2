// src/spaces/copilot/agent/useCompteursAgent.ts
// Petits compteurs affichés dans le menu : missions en cours, missions qui
// attendent une réponse, brouillons à valider. Relus toutes les 60 s et à
// chaque changement signalé. Silencieux si l'agent n'est pas encore installé.
import { useEffect, useState } from 'react';
import { compterActionsAValider, listerMissions } from './agentApi';
import { missionActive } from './agentLogique';
import { useAgentUi } from './agentUi.store';

export interface CompteursAgent { actives: number; enAttente: number; aValider: number; disponible: boolean }

export function useCompteursAgent(): CompteursAgent {
  const version = useAgentUi((s) => s.version);
  const [c, setC] = useState<CompteursAgent>({ actives: 0, enAttente: 0, aValider: 0, disponible: true });

  useEffect(() => {
    let vivant = true;
    const lire = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const [missions, aValider] = await Promise.all([listerMissions(20), compterActionsAValider()]);
        if (!vivant) return;
        setC({
          actives: missions.filter((m) => missionActive(m.statut)).length,
          enAttente: missions.filter((m) => m.statut === 'attente_utilisateur').length,
          aValider,
          disponible: true,
        });
      } catch (e) {
        if (vivant && (e as { nonInstalle?: boolean })?.nonInstalle) setC((x) => ({ ...x, disponible: false }));
      }
    };
    void lire();
    const t = window.setInterval(() => { void lire(); }, 60000);
    return () => { vivant = false; window.clearInterval(t); };
  }, [version]);

  return c;
}
