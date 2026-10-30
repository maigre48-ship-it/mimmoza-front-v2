// src/spaces/copilot/agent/conception/conceptionUi.store.ts
// Ouverture de l'Atelier 3D en mode conception (une conception à la fois).
import { create } from 'zustand';
import type { PrecisionPlan } from '@/spaces/promoteur/shared/echangeStudio/conception';
import type { Conception } from './conceptionLogique';

export interface DemandeAtelier {
  /** Change à chaque ouverture : nouvelle session Studio. */
  cle: string;
  conception: Conception;
  voie: PrecisionPlan;
  planUrl: string | null;
  modeleUrl: string | null;
}

interface EtatAtelier {
  demande: DemandeAtelier | null;
  /** Conception à afficher à l'ouverture de l'onglet « Conception » (depuis un rapport). */
  aAfficher: string | null;
  afficher: (id: string | null) => void;
  ouvert: boolean;
  ouvrir: (d: Omit<DemandeAtelier, 'cle'>) => void;
  montrer: () => void;
  fermer: () => void;
}

export const useAtelierConception = create<EtatAtelier>((set) => ({
  demande: null,
  aAfficher: null,
  afficher: (id) => set({ aAfficher: id }),
  ouvert: false,
  ouvrir: (d) => set({ demande: { ...d, cle: `${d.conception.id}-${Date.now()}` }, ouvert: true }),
  montrer: () => set((s) => ({ ouvert: s.demande != null })),
  fermer: () => set({ ouvert: false }),
}));
