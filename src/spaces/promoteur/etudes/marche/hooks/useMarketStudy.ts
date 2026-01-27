// FILE: src/spaces/promoteur/etudes/marche/hooks/useMarketStudy.ts

import { useState, useCallback } from "react";
import { MarketStudyResult, ProjectType } from "../types";
import { getMarketStudy, MarketStudyParams } from "../services";

interface UseMarketStudyReturn {
  data: MarketStudyResult | null;
  isLoading: boolean;
  error: string | null;
  fetchStudy: (params: Omit<MarketStudyParams, "useMock">) => Promise<void>;
  reset: () => void;
}

export function useMarketStudy(useMock: boolean = true): UseMarketStudyReturn {
  const [data, setData] = useState<MarketStudyResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStudy = useCallback(
    async (params: Omit<MarketStudyParams, "useMock">) => {
      setIsLoading(true);
      setError(null);
      setData(null);

      try {
        const result = await getMarketStudy({ ...params, useMock });
        setData(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Erreur lors de l'analyse";
        setError(message);
        console.error("[useMarketStudy] Erreur:", err);
      } finally {
        setIsLoading(false);
      }
    },
    [useMock]
  );

  const reset = useCallback(() => {
    setData(null);
    setError(null);
  }, []);

  return { data, isLoading, error, fetchStudy, reset };
}