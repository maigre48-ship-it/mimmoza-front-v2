// src/spaces/copilot/agent/lancementMission.ts
// VIS-21 — branchement réel de `lancerMissionAvec` (carte du devis, panneau Espace 3D, carte du parcours) et de la
// reprise d'une mission mise en pause par une panne du fournisseur d'IA.
import { repondreMission, validerDevis } from './agentApi';
import type { Mission } from './agent.types';
import { useAgentUi } from './agentUi.store';
import { useCopilotStore } from '../store/copilotStore';
import { lancerMissionAvec } from './lancementMissionLogique';
import { REPONSE_REPRENDRE } from '../../../../supabase/functions/_shared/copilot-stream/fournisseurIA.ts';

/** « Lancer la mission » — LA fonction unique du lancement d'un devis de mission. */
export function lancerMissionDuDevis(missionId: string): Promise<Mission | null> {
  return lancerMissionAvec(missionId, {
    valider: validerDevis,
    signaler: () => useAgentUi.getState().signalerChangement(),
    rafraichirSolde: () => { void useCopilotStore.getState().refreshCredits?.(); },
    planifier: (fn, ms) => { window.setTimeout(fn, ms); },
    suiviDisponible: () => useAgentUi.getState().hotes > 0,
    ouvrirSuivi: (id) => useAgentUi.getState().ouvrir('missions', id),
  });
}

/** « Suivre la mission » : panneau Missions s'il est sur la page ; false sinon. */
export function suivreMissionUi(missionId: string): boolean {
  if (useAgentUi.getState().hotes <= 0) return false;
  useAgentUi.getState().ouvrir('missions', missionId);
  return true;
}

/** « Reprendre » une mission en pause (panne du fournisseur d'IA) : agent_mission_repondre la remet en cours. */
export async function reprendreMissionEnPause(missionId: string): Promise<Mission | null> {
  const m = await repondreMission(missionId, REPONSE_REPRENDRE);
  useAgentUi.getState().signalerChangement();
  return m;
}
