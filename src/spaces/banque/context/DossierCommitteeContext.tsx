// context/DossierCommitteeContext.tsx
//
// THE GLUE — wraps your routes so Documents, Garanties, Comité
// all share the same reactive state.
//
// Usage in your router/layout:
//   <DossierCommitteeProvider dossierId="DOS-2025-0042">
//     <Outlet />   ← or your tab/page system
//   </DossierCommitteeProvider>

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { DossierCommitteeSlice, CommitteeCondition } from '../types/committee-workflow';
import { useCommitteeWorkflow } from '../hooks/useCommitteeWorkflow';
import type { CommitteeWorkflow } from '../hooks/useCommitteeWorkflow';

// ─── Context Shape ───────────────────────────

interface DossierCommitteeContextValue extends CommitteeWorkflow {
  dossier: DossierCommitteeSlice;
  isLoading: boolean;
  /** Call after Supabase save to keep local state in sync */
  refreshFromServer: (data: Partial<DossierCommitteeSlice>) => void;
}

const DossierCommitteeContext = createContext<DossierCommitteeContextValue | null>(null);

// ─── Hook for consuming pages ────────────────

export function useDossierCommittee(): DossierCommitteeContextValue {
  const ctx = useContext(DossierCommitteeContext);
  if (!ctx) {
    throw new Error(
      'useDossierCommittee() must be used inside <DossierCommitteeProvider>. ' +
      'Wrap your dossier routes/layout with this provider.'
    );
  }
  return ctx;
}

// ─── Provider ────────────────────────────────

interface ProviderProps {
  /** Pass initial dossier data (from your existing fetch/snapshot) */
  initialDossier?: DossierCommitteeSlice;
  /** Or pass a dossierId and we'll use a placeholder until you hydrate */
  dossierId?: string;
  children: React.ReactNode;
}

// Default empty dossier for dev / before hydration
const EMPTY_DOSSIER: DossierCommitteeSlice = {
  id: '',
  montantPret: 0,
  projectType: 'default',
  documents: [],
  guarantees: [],
  committee: {
    status: 'en_instruction',
    conditions: [],
    decision: null,
    dateComite: null,
  },
};

export function DossierCommitteeProvider({
  initialDossier,
  dossierId,
  children,
}: ProviderProps) {
  const [dossier, setDossier] = useState<DossierCommitteeSlice>(
    initialDossier ?? { ...EMPTY_DOSSIER, id: dossierId ?? '' }
  );
  const [isLoading, setIsLoading] = useState(!initialDossier);

  // ── Hydrate from props when they change (e.g. parent fetches from Supabase)
  useEffect(() => {
    if (initialDossier) {
      setDossier(initialDossier);
      setIsLoading(false);
    }
  }, [initialDossier]);

  // ── Merge server data into local state
  const refreshFromServer = useCallback((data: Partial<DossierCommitteeSlice>) => {
    setDossier((prev) => ({ ...prev, ...data }));
  }, []);

  // ── Compose the workflow hook (all the reactive logic)
  const workflow = useCommitteeWorkflow(dossier, setDossier);

  const value: DossierCommitteeContextValue = {
    dossier,
    isLoading,
    refreshFromServer,
    ...workflow,
  };

  return (
    <DossierCommitteeContext.Provider value={value}>
      {children}
    </DossierCommitteeContext.Provider>
  );
}

export default DossierCommitteeProvider;