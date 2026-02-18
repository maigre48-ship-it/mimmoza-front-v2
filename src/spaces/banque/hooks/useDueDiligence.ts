// src/spaces/banque/hooks/useDueDiligence.ts

import { useState, useCallback } from "react";

import type {
  DueDiligenceReport,
  DueDiligenceEvidence,
  DueDiligenceStatus,
} from "../types/dueDiligence.types";

import {
  getDueDiligenceReport,
  saveDueDiligenceReport,
} from "../store/dueDiligenceSnapshot.store";

import {
  updateDueDiligenceItemStatus,
  updateDueDiligenceItemValue,
  addDueDiligenceEvidence as mutateAddEvidence,
  removeDueDiligenceEvidence as mutateRemoveEvidence,
} from "../services/dueDiligence.mutate";

export interface UseDueDiligenceReturn {
  report: DueDiligenceReport;
  setStatus: (itemKey: string, status: DueDiligenceStatus, meta?: Record<string, unknown>) => void;
  setValue: (itemKey: string, value: unknown, comment?: string) => void;
  addEvidence: (
    itemKey: string,
    evidence: Omit<DueDiligenceEvidence, "id" | "addedAt"> & {
      id?: string;
      addedAt?: string;
    },
  ) => void;
  removeEvidence: (itemKey: string, evidenceId: string) => void;
  refresh: () => void;
}

export function useDueDiligence(dossierId: string): UseDueDiligenceReturn {
  const [report, setReport] = useState<DueDiligenceReport>(() =>
    getDueDiligenceReport(dossierId),
  );

  const persist = useCallback((updated: DueDiligenceReport) => {
    saveDueDiligenceReport(updated);
    setReport(updated);
  }, []);

  const setStatus = useCallback(
    (itemKey: string, status: DueDiligenceStatus, meta?: Record<string, unknown>) => {
      setReport((prev) => {
        const updated = updateDueDiligenceItemStatus(prev, itemKey, status, meta);
        saveDueDiligenceReport(updated);
        return updated;
      });
    },
    [],
  );

  const setValue = useCallback(
    (itemKey: string, value: unknown, comment?: string) => {
      setReport((prev) => {
        const updated = updateDueDiligenceItemValue(prev, itemKey, value, comment);
        saveDueDiligenceReport(updated);
        return updated;
      });
    },
    [],
  );

  const addEvidence = useCallback(
    (
      itemKey: string,
      evidence: Omit<DueDiligenceEvidence, "id" | "addedAt"> & {
        id?: string;
        addedAt?: string;
      },
    ) => {
      setReport((prev) => {
        const updated = mutateAddEvidence(prev, itemKey, evidence);
        saveDueDiligenceReport(updated);
        return updated;
      });
    },
    [],
  );

  const removeEvidence = useCallback(
    (itemKey: string, evidenceId: string) => {
      setReport((prev) => {
        const updated = mutateRemoveEvidence(prev, itemKey, evidenceId);
        saveDueDiligenceReport(updated);
        return updated;
      });
    },
    [],
  );

  const refresh = useCallback(() => {
    setReport(getDueDiligenceReport(dossierId));
  }, [dossierId]);

  return { report, setStatus, setValue, addEvidence, removeEvidence, refresh };
}