// src/spaces/copilot/agent/agentUi.store.ts
// État d'interface de l'agent : panneau ouvert, onglet, mission suivie.
// Séparé du store du chat (useCopilotStore) pour ne rien y ajouter.
import { create } from 'zustand';

export type OngletAgent = 'missions' | 'actions' | 'memoire';

interface AgentUiState {
  ouvert: boolean;
  onglet: OngletAgent;
  missionId: string | null;
  /** Nombre de panneaux montés : 0 = aucun écran capable d'afficher les missions. */
  hotes: number;
  /** Incrémenté quand une donnée de l'agent change : les listes se relisent. */
  version: number;
  ouvrir: (onglet: OngletAgent, missionId?: string | null) => void;
  fermer: () => void;
  choisirMission: (id: string | null) => void;
  signalerChangement: () => void;
  monterHote: () => () => void;
}

export const useAgentUi = create<AgentUiState>((set) => ({
  ouvert: false,
  onglet: 'missions',
  missionId: null,
  hotes: 0,
  version: 0,
  ouvrir: (onglet, missionId) => set((s) => ({
    ouvert: true, onglet, missionId: missionId === undefined ? s.missionId : missionId,
  })),
  fermer: () => set({ ouvert: false }),
  choisirMission: (id) => set({ missionId: id }),
  signalerChangement: () => set((s) => ({ version: s.version + 1 })),
  monterHote: () => {
    set((s) => ({ hotes: s.hotes + 1 }));
    return () => set((s) => ({ hotes: Math.max(0, s.hotes - 1) }));
  },
}));
