// src/spaces/banque/store/dueDiligenceSnapshot.store.ts

import type { DueDiligenceReport } from "../types/dueDiligence.types";
import { createDefaultDueDiligenceReport } from "../types/dueDiligence.types";
import { computeDueDiligence } from "../services/dueDiligence.compute";

const KEY = "mimmoza.banque.duediligence.v1";

/* ---------- Internal helpers ---------- */

type StoreState = Record<string, DueDiligenceReport>;

function readStore(): StoreState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as StoreState;
  } catch {
    return {};
  }
}

function writeStore(state: StoreState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage full or unavailable — silently fail
  }
}

/* ---------- Public API ---------- */

export function getDueDiligenceReport(dossierId: string): DueDiligenceReport {
  const state = readStore();
  const existing = state[dossierId];

  if (existing) {
    return existing;
  }

  const report = createDefaultDueDiligenceReport({ dossierId });
  const withComputed: DueDiligenceReport = {
    ...report,
    computed: computeDueDiligence(report),
  };

  // Persist the newly created default report
  const updated = { ...state, [dossierId]: withComputed };
  writeStore(updated);

  return withComputed;
}

export function saveDueDiligenceReport(report: DueDiligenceReport): void {
  const state = readStore();
  state[report.dossierId] = report;
  writeStore(state);
}

export function clearDueDiligenceReport(dossierId: string): void {
  const state = readStore();
  delete state[dossierId];
  writeStore(state);
}

export function listDueDiligenceReports(): { dossierId: string; updatedAt: string }[] {
  const state = readStore();
  return Object.values(state).map((r) => ({
    dossierId: r.dossierId,
    updatedAt: r.updatedAt,
  }));
}