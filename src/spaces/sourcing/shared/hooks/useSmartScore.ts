// src/spaces/sourcing/shared/hooks/useSmartScore.ts

import { useCallback, useMemo, useState } from "react";
import {
  patchSourcingSnapshot,
  readSourcingSnapshot,
} from "../sourcingSnapshot.store";

type SmartScoreResult = {
  globalScore: number;
  globalRationale: string;
};

export function useSmartScore() {
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const snap = readSourcingSnapshot();

  const score = useMemo(() => snap.lastScore ?? null, [snap.updatedAt]); // simple trigger
  const hints = useMemo(() => snap.lastHints ?? [], [snap.updatedAt]);

  const analyzeAndComputeScore = useCallback(async (apiDraft: any) => {
    setErrors([]);
    setIsLoading(true);

    try {
      // 🔒 Version safe: scoring local minimal (tu brancheras l'edge function après)
      let s = 50;

      const price = Number(apiDraft?.input?.price || 0);
      const surface = Number(apiDraft?.input?.surface || 0);
      const ppm2 = surface > 0 ? price / surface : 0;

      if (ppm2 > 0) s += 5;
      if (apiDraft?.location?.codePostal) s += 10;
      if (apiDraft?.input?.dpe && ["A", "B", "C"].includes(apiDraft.input.dpe)) s += 10;
      if (apiDraft?.input?.etatGeneral && ["bon", "excellent"].includes(apiDraft.input.etatGeneral)) s += 10;

      s = Math.max(0, Math.min(100, Math.round(s)));

      const result: SmartScoreResult = {
        globalScore: s,
        globalRationale: "Score calculé localement (mode safe).",
      };

      patchSourcingSnapshot({
        lastDraft: apiDraft,
        lastScore: {
          score: result.globalScore,
          rationale: result.globalRationale,
        },
        lastHints: [],
      });

      return result;
    } catch (e: any) {
      setErrors([e?.message || "Erreur inconnue"]);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    isLoading,
    score,
    hints,
    errors,
    analyzeAndComputeScore,
  };
}
