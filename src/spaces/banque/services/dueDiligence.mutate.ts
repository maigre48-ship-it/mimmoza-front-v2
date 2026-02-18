// src/spaces/banque/services/dueDiligence.mutate.ts

import type {
  DueDiligenceReport,
  DueDiligenceEvidence,
  DueDiligenceStatus,
  DueDiligenceItem,
  DueDiligenceCategory,
} from "../types/dueDiligence.types";
import { computeDueDiligence } from "./dueDiligence.compute";

/* ---------- Internal helpers ---------- */

function generateEvidenceId(): string {
  return `dd_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Deep-map over categories/items to update a single item by key.
 * Returns a new report with updated categories and timestamps.
 */
function mapItem(
  report: DueDiligenceReport,
  itemKey: string,
  updater: (item: DueDiligenceItem) => DueDiligenceItem,
): DueDiligenceReport {
  const now = nowIso();

  const categories: DueDiligenceCategory[] = report.categories.map((cat) => {
    const hasTarget = cat.items.some((it) => it.key === itemKey);
    if (!hasTarget) return cat;

    return {
      ...cat,
      items: cat.items.map((it) => {
        if (it.key !== itemKey) return it;
        return updater({ ...it, updatedAt: now });
      }),
    };
  });

  const updated: DueDiligenceReport = {
    ...report,
    categories,
    updatedAt: now,
  };

  return { ...updated, computed: computeDueDiligence(updated) };
}

/* ---------- Public API ---------- */

export function updateDueDiligenceItemStatus(
  report: DueDiligenceReport,
  itemKey: string,
  status: DueDiligenceStatus,
  meta?: Record<string, unknown>,
): DueDiligenceReport {
  return mapItem(report, itemKey, (item) => ({
    ...item,
    status,
    meta: meta !== undefined ? { ...item.meta, ...meta } : item.meta,
  }));
}

export function updateDueDiligenceItemValue(
  report: DueDiligenceReport,
  itemKey: string,
  value: unknown,
  comment?: string,
): DueDiligenceReport {
  return mapItem(report, itemKey, (item) => ({
    ...item,
    value,
    comment: comment !== undefined ? comment : item.comment,
  }));
}

export function addDueDiligenceEvidence(
  report: DueDiligenceReport,
  itemKey: string,
  evidence: Omit<DueDiligenceEvidence, "id" | "addedAt"> & {
    id?: string;
    addedAt?: string;
  },
): DueDiligenceReport {
  const fullEvidence: DueDiligenceEvidence = {
    id: evidence.id ?? generateEvidenceId(),
    type: evidence.type,
    title: evidence.title,
    url: evidence.url,
    filePath: evidence.filePath,
    addedAt: evidence.addedAt ?? nowIso(),
  };

  return mapItem(report, itemKey, (item) => ({
    ...item,
    evidences: [...(item.evidences ?? []), fullEvidence],
  }));
}

export function removeDueDiligenceEvidence(
  report: DueDiligenceReport,
  itemKey: string,
  evidenceId: string,
): DueDiligenceReport {
  return mapItem(report, itemKey, (item) => ({
    ...item,
    evidences: (item.evidences ?? []).filter((e) => e.id !== evidenceId),
  }));
}