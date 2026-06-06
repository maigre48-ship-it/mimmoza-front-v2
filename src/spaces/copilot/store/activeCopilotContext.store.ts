// src/spaces/copilot/store/activeCopilotContext.store.ts
// PATCH V1.1 : ajout de ActiveDealRef et PageContextRef dans le snapshot
// ─────────────────────────────────────────────────────────────────────────────

import { create } from 'zustand';

// ─── Nouveaux types V1.1 ──────────────────────────────────────────────────────

export interface ActiveDealRef {
  id: string;
  title?: string;
  address?: string;
  parcelId?: string | null;
  surface?: number | null;
  purchasePrice?: number | null;
  resalePrice?: number | null;
  worksBudget?: number | null;
  status?: string;
}

export interface PageContextRef {
  pathname: string;
  space?: string;   // 'marchand' | 'investisseur' | 'promoteur' | ...
  mode?: string;    // 'acquisition' | 'execution' | 'analyse'
  tab?: string;     // 'pipeline' | 'simulation' | 'travaux' | 'rentabilite' | ...
}

// ─── Type snapshot ─────────────────────────────────────────────────────────────
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
  // ── Travaux (simulateur) ─────────────────────────────────
  renovation_cost_total?: number;
  renovation_cost_per_m2?: number;
  renovation_level?: string;
  renovation_gamme?: string;
  // ── V1.1 — Deal actif et contexte de page ───────────────
  activeDeal?: ActiveDealRef;
  pageContext?: PageContextRef;
}

// ─── Interface store ───────────────────────────────────────────────────────────
export interface ActiveCopilotContextState extends ActiveCopilotSnapshot {
  setActiveCopilotContext: (partial: Partial<ActiveCopilotSnapshot>) => void;
  clearActiveCopilotContext: () => void;
  getActiveCopilotContext: () => ActiveCopilotSnapshot;
}

const INITIAL_STATE: ActiveCopilotSnapshot = {
  activeListingId:        undefined,
  listingUrl:             undefined,
  city:                   undefined,
  zipCode:                undefined,
  price:                  undefined,
  surface:                undefined,
  propertyType:           undefined,
  parcelId:               undefined,
  route:                  undefined,
  vertical:               undefined,
  renovation_cost_total:  undefined,
  renovation_cost_per_m2: undefined,
  renovation_level:       undefined,
  renovation_gamme:       undefined,
  // V1.1
  activeDeal:             undefined,
  pageContext:            undefined,
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

/** V1.1 — Retourne true si un deal est actif dans le contexte courant */
export function hasActiveDeal(): boolean {
  const ctx = getActiveCopilotContext();
  return !!(ctx.activeDeal?.id);
}