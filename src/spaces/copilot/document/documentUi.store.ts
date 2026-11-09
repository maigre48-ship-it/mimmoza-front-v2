// src/spaces/copilot/document/documentUi.store.ts
// LOT D1 — État du panneau « document » (réponse longue, ordre de mission,
// rapport de mission). Séparé des stores du chat et de l'agent.
import { create } from 'zustand';
import type { PropositionDevis } from '../agent/agent.types';

export type ContenuDocument =
  | { genre: 'reponse'; messageId: string; question: string | null }
  | { genre: 'ordre'; missionId: string | null; proposition: PropositionDevis; conversationId: string | null }
  | { genre: 'rapport'; missionId: string };

interface DocumentUiState {
  contenu: ContenuDocument | null;
  /** Nombre de panneaux montés : 0 = le chat garde l'affichage complet d'avant. */
  hotes: number;
  ouvrir: (contenu: ContenuDocument) => void;
  fermer: () => void;
  monterHote: () => () => void;
}

export const useDocumentUi = create<DocumentUiState>((set) => ({
  contenu: null,
  hotes: 0,
  ouvrir: (contenu) => set({ contenu }),
  fermer: () => set({ contenu: null }),
  monterHote: () => {
    set((s) => ({ hotes: s.hotes + 1 }));
    return () => set((s) => ({ hotes: Math.max(0, s.hotes - 1) }));
  },
}));
