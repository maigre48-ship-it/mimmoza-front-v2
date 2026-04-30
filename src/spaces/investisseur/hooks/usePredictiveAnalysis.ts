import { useState, useCallback, useMemo } from "react";
import type {
  PredictiveAnalysisSnapshot,
  PredictiveEngineInput,
} from "../services/predictive/predictive.types";
import { computePredictiveSnapshot } from "../services/predictive/predictive.engine";

type Status = "idle" | "computing" | "done" | "error";

interface UsePredictiveAnalysisReturn {
  snapshot: PredictiveAnalysisSnapshot | null;
  status: Status;
  error: string | null;
  compute: (input: PredictiveEngineInput) => void;
  reset: () => void;
}

/**
 * Hook React pour piloter le moteur prédictif.
 * V1 : synchrone (moteur local), prévu pour passer en async
 * quand un backend sera branché.
 */
export function usePredictiveAnalysis(): UsePredictiveAnalysisReturn {
  const [snapshot, setSnapshot] = useState<PredictiveAnalysisSnapshot | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const compute = useCallback((input: PredictiveEngineInput) => {
    try {
      setStatus("computing");
      setError(null);
      // Simulate a tiny async delay for future-proofing / UX
      requestAnimationFrame(() => {
        try {
          const result = computePredictiveSnapshot(input);
          setSnapshot(result);
          setStatus("done");
        } catch (e) {
          setError(e instanceof Error ? e.message : "Erreur moteur prédictif");
          setStatus("error");
        }
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur moteur prédictif");
      setStatus("error");
    }
  }, []);

  const reset = useCallback(() => {
    setSnapshot(null);
    setStatus("idle");
    setError(null);
  }, []);

  return useMemo(
    () => ({ snapshot, status, error, compute, reset }),
    [snapshot, status, error, compute, reset]
  );
}