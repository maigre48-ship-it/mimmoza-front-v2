// src/spaces/investisseur/store/investisseurRentabilite.store.ts

import type { RentabiliteSnapshot } from '../types/rentabilite.types';

const PREFIX = 'mimmoza.investisseur.rentabilite.v1.';

type Listener = (snap: RentabiliteSnapshot | null) => void;

const listeners = new Map<string, Set<Listener>>();

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function lsKey(dealId: string): string {
  return `${PREFIX}${dealId}`;
}

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function notify(dealId: string, snap: RentabiliteSnapshot | null): void {
  const set = listeners.get(dealId);
  if (!set) return;
  set.forEach((fn) => {
    try {
      fn(snap);
    } catch {
      // silently ignore listener errors
    }
  });
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export function readRentabiliteSnapshot(dealId: string): RentabiliteSnapshot | null {
  if (!dealId) return null;
  return safeJsonParse<RentabiliteSnapshot>(localStorage.getItem(lsKey(dealId)));
}

export function writeRentabiliteSnapshot(dealId: string, snap: RentabiliteSnapshot): void {
  if (!dealId) return;
  localStorage.setItem(lsKey(dealId), JSON.stringify(snap));
  notify(dealId, snap);
}

export function patchRentabiliteSnapshot(
  dealId: string,
  patch: Partial<RentabiliteSnapshot>,
): RentabiliteSnapshot | null {
  if (!dealId) return null;
  const existing = readRentabiliteSnapshot(dealId);
  if (!existing) return null;
  const merged: RentabiliteSnapshot = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  writeRentabiliteSnapshot(dealId, merged);
  return merged;
}

export function clearRentabiliteSnapshot(dealId: string): void {
  if (!dealId) return;
  localStorage.removeItem(lsKey(dealId));
  notify(dealId, null);
}

export function subscribe(dealId: string, listener: Listener): () => void {
  if (!listeners.has(dealId)) {
    listeners.set(dealId, new Set());
  }
  listeners.get(dealId)!.add(listener);
  return () => {
    const set = listeners.get(dealId);
    if (set) {
      set.delete(listener);
      if (set.size === 0) listeners.delete(dealId);
    }
  };
}