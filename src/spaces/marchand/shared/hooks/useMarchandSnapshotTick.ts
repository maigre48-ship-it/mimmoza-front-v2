import { useEffect, useState } from "react";
import {
  LS_MARCHAND_SNAPSHOT_V1,
  MARCHAND_SNAPSHOT_EVENT,
} from "../marchandSnapshot.store";

/**
 * useMarchandSnapshotTick
 *
 * Hook utilitaire pour forcer un re-render React
 * dès que le snapshot Marchand change :
 * - même onglet (CustomEvent)
 * - autres onglets (StorageEvent)
 *
 * Usage:
 *   const snapTick = useMarchandSnapshotTick();
 *   const snapshot = useMemo(() => readMarchandSnapshot(), [snapTick]);
 */
export default function useMarchandSnapshotTick(): number {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const bump = () => setTick((x) => x + 1);

    const onStorage = (e: StorageEvent) => {
      if (e.key === LS_MARCHAND_SNAPSHOT_V1) {
        bump();
      }
    };

    const onCustom = () => {
      bump();
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener(MARCHAND_SNAPSHOT_EVENT, onCustom as EventListener);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(MARCHAND_SNAPSHOT_EVENT, onCustom as EventListener);
    };
  }, []);

  return tick;
}
