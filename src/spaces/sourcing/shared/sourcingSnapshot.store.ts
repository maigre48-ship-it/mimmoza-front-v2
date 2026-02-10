// src/spaces/sourcing/shared/sourcingSnapshot.store.ts
/**
 * Snapshot store — Sourcing (v1)
 * - Source de vérité locale (localStorage)
 * - Réutilisable par d'autres modules (Banque, Marchand, etc.)
 */

export type SourcingSnapshotV1 = {
  version: 1;
  updatedAt: string; // ISO
  // On stocke ce qui sort du formulaire + résultats d'analyse
  lastDraft?: any;
  lastScore?: any;
  lastHints?: any;
};

const LS_KEY = "mimmoza.sourcing.snapshot.v1";

export function readSourcingSnapshot(): SourcingSnapshotV1 {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { version: 1, updatedAt: new Date().toISOString() };
    const parsed = JSON.parse(raw) as SourcingSnapshotV1;
    if (!parsed || parsed.version !== 1) {
      return { version: 1, updatedAt: new Date().toISOString() };
    }
    return parsed;
  } catch {
    return { version: 1, updatedAt: new Date().toISOString() };
  }
}

export function writeSourcingSnapshot(next: SourcingSnapshotV1) {
  const payload: SourcingSnapshotV1 = {
    ...next,
    version: 1,
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(LS_KEY, JSON.stringify(payload));
}

export function patchSourcingSnapshot(patch: Partial<SourcingSnapshotV1>) {
  const prev = readSourcingSnapshot();
  writeSourcingSnapshot({ ...prev, ...patch });
}

export function clearSourcingSnapshot() {
  localStorage.removeItem(LS_KEY);
}
