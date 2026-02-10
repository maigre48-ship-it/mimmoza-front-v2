/**
 * useBanqueSnapshotTick.ts
 * ────────────────────────────────────────────────────────────────────
 * Hook utilitaire : force un re-render (tick) à chaque changement du snapshot Banque.
 *
 * Compatible :
 *   import { useBanqueSnapshotTick } from "...";
 *   import useBanqueSnapshotTick from "...";
 */

import { useEffect, useState } from "react";
import {
  onBanqueSnapshotChange,
  readBanqueSnapshot,
} from "../store/banqueSnapshot.store";

export function useBanqueSnapshotTick(): number {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    try {
      readBanqueSnapshot();
    } catch {}

    const cleanup = onBanqueSnapshotChange(() => {
      setTick((t) => t + 1);
    });

    return cleanup;
  }, []);

  return tick;
}

export default useBanqueSnapshotTick;
