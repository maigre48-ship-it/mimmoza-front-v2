import { useEffect, useState } from "react";
import type { SourcingSnapshotV1 } from "../sourcingSnapshot.store";
import { readSourcingSnapshot, subscribe } from "../sourcingSnapshot.store";

export function useSourcingSnapshotTick(): SourcingSnapshotV1 {
  const [snap, setSnap] = useState<SourcingSnapshotV1>(readSourcingSnapshot);

  useEffect(() => {
    const unsub = subscribe(() => {
      setSnap(readSourcingSnapshot());
    });
    return unsub;
  }, []);

  return snap;
}