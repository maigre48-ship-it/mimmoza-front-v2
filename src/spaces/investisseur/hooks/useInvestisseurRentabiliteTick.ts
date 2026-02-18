// src/spaces/investisseur/hooks/useInvestisseurRentabiliteTick.ts

import { useState, useEffect, useCallback } from 'react';
import type { RentabiliteSnapshot } from '../types/rentabilite.types';
import {
  readRentabiliteSnapshot,
  writeRentabiliteSnapshot,
  clearRentabiliteSnapshot,
  subscribe,
} from '../store/investisseurRentabilite.store';

/**
 * Hook that subscribes to the rentabilite store for a given dealId.
 * Returns the current snapshot + helpers to write/clear.
 */
export function useInvestisseurRentabiliteTick(dealId: string | null) {
  const [snapshot, setSnapshot] = useState<RentabiliteSnapshot | null>(null);

  // Read initial + subscribe
  useEffect(() => {
    if (!dealId) {
      setSnapshot(null);
      return;
    }
    // Initial read
    setSnapshot(readRentabiliteSnapshot(dealId));

    // Subscribe to changes
    const unsub = subscribe(dealId, (snap) => {
      setSnapshot(snap);
    });

    return unsub;
  }, [dealId]);

  const save = useCallback(
    (snap: RentabiliteSnapshot) => {
      if (!dealId) return;
      writeRentabiliteSnapshot(dealId, snap);
    },
    [dealId],
  );

  const clear = useCallback(() => {
    if (!dealId) return;
    clearRentabiliteSnapshot(dealId);
  }, [dealId]);

  return { snapshot, save, clear };
}