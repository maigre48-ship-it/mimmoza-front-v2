import type { FinancialSnapshotV1 } from "./financialSnapshot.types";

const LS_PREFIX = "mimmoza.banque.financialSnapshot.v1.";

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function readBanqueFinancialSnapshot(dossierId: string): FinancialSnapshotV1 | null {
  if (!dossierId) return null;
  return safeParse<FinancialSnapshotV1 | null>(localStorage.getItem(LS_PREFIX + dossierId), null);
}

export function writeBanqueFinancialSnapshot(dossierId: string, fs: FinancialSnapshotV1): void {
  if (!dossierId) return;
  localStorage.setItem(LS_PREFIX + dossierId, JSON.stringify(fs));
}

export function resetBanqueFinancialSnapshot(dossierId: string): void {
  if (!dossierId) return;
  localStorage.removeItem(LS_PREFIX + dossierId);
}
