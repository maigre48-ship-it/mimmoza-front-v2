// src/spaces/copilot/store/activeCopilotContext.store.ts

import { create } from 'zustand';

// ─── Type snapshot (défini AVANT l'interface pour pouvoir l'y référencer) ────
export interface ActiveCopilotSnapshot {
  activeListingId?: string;
  listingUrl?: string;
  city?: string;
  zipCode?: string;
  price?: number;
  surface?: number;
  propertyType?: string;
  parcelId?: string;
  route?: string;
  vertical?:
    | 'investisseur'
    | 'marchand'
    | 'promoteur'
    | 'apporteur'
    | 'particulier'
    | 'generique';
}

// ─── Interface store complète (actions + snapshot) ────────────────────────────
export interface ActiveCopilotContextState extends ActiveCopilotSnapshot {
  setActiveCopilotContext: (partial: Partial<ActiveCopilotSnapshot>) => void;
  clearActiveCopilotContext: () => void;
  getActiveCopilotContext: () => ActiveCopilotSnapshot;
}

const INITIAL_STATE: ActiveCopilotSnapshot = {
  activeListingId: undefined,
  listingUrl:      undefined,
  city:            undefined,
  zipCode:         undefined,
  price:           undefined,
  surface:         undefined,
  propertyType:    undefined,
  parcelId:        undefined,
  route:           undefined,
  vertical:        undefined,
};

export const useActiveCopilotContext = create<ActiveCopilotContextState>(
  (set, get) => ({
    ...INITIAL_STATE,

    setActiveCopilotContext(partial) {
      set((prev) => ({ ...prev, ...partial }));
    },

    clearActiveCopilotContext() {
      set(INITIAL_STATE);
    },

    getActiveCopilotContext(): ActiveCopilotSnapshot {
      const {
        setActiveCopilotContext,    // eslint-disable-line @typescript-eslint/no-unused-vars
        clearActiveCopilotContext,  // eslint-disable-line @typescript-eslint/no-unused-vars
        getActiveCopilotContext,    // eslint-disable-line @typescript-eslint/no-unused-vars
        ...rest
      } = get();
      return rest;
    },
  }),
);

// ─── Singletons fonctionnels (utilisables hors composant React) ───────────────
export function setActiveCopilotContext(partial: Partial<ActiveCopilotSnapshot>): void {
  useActiveCopilotContext.getState().setActiveCopilotContext(partial);
}

export function clearActiveCopilotContext(): void {
  useActiveCopilotContext.getState().clearActiveCopilotContext();
}

export function getActiveCopilotContext(): ActiveCopilotSnapshot {
  return useActiveCopilotContext.getState().getActiveCopilotContext();
}

export function hasActiveListing(): boolean {
  const ctx = getActiveCopilotContext();
  return !!(
    ctx.activeListingId ||
    ctx.listingUrl ||
    (ctx.city && ctx.price && ctx.surface)
  );
}