// src/spaces/promoteur/shared/useStudy.ts
// ============================================================
// HOOK CENTRAL — Charge + expose une étude Supabase
// Fallback transparent sur localStorage si Supabase indispo
// ============================================================

import { useState, useEffect, useCallback } from "react";
import { StudyService } from "./promoteurStudyService";
import type { PromoteurStudyRow } from "./promoteurStudyService";

export type StudyLoadState = "idle" | "loading" | "ready" | "error";

export function useStudy(studyId: string | null) {
  const [study, setStudy]       = useState<PromoteurStudyRow | null>(null);
  const [loadState, setLoad]    = useState<StudyLoadState>("idle");
  const [error, setError]       = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!studyId) return;
    setLoad("loading");
    const result = await StudyService.get(studyId);
    if (result.ok) {
      setStudy(result.data);
      setLoad("ready");
    } else {
      setError(result.error);
      setLoad("error");
    }
  }, [studyId]);

  useEffect(() => { load(); }, [load]);

  const refresh = useCallback(() => load(), [load]);

  return { study, loadState, error, refresh, setStudy };
}