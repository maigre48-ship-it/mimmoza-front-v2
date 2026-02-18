// src/spaces/banque/services/dueDiligence.compute.ts

import type {
  DueDiligenceReport,
  DueDiligenceComputed,
  DueDiligenceStatus,
} from "../types/dueDiligence.types";

/* ---------- Helpers ---------- */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const PENALTY_MAP: Record<DueDiligenceStatus, number> = {
  OK: 0,
  NA: 0,
  MISSING: -2,
  WARNING: -8,
  CRITICAL: -20,
};

/* ---------- Main compute ---------- */

export function computeDueDiligence(report: DueDiligenceReport): DueDiligenceComputed {
  const byStatus: Record<DueDiligenceStatus, number> = {
    OK: 0,
    WARNING: 0,
    CRITICAL: 0,
    MISSING: 0,
    NA: 0,
  };

  let totalItems = 0;
  let completedItems = 0;
  let totalPenalty = 0;

  for (const category of report.categories) {
    for (const item of category.items) {
      totalItems++;
      byStatus[item.status]++;
      totalPenalty += PENALTY_MAP[item.status] ?? 0;

      if (item.status !== "MISSING") {
        completedItems++;
      }
    }
  }

  const completionRate = totalItems > 0 ? completedItems / totalItems : 0;
  const score = clamp(100 + totalPenalty, 0, 100);

  return {
    completedItems,
    totalItems,
    completionRate,
    score,
    byStatus,
    criticalCount: byStatus.CRITICAL,
    warningCount: byStatus.WARNING,
  };
}