import { useCallback, useRef, useState } from "react";
import { searchPermisConstruire } from "../services/permisConstruire.service";
import type {
  PermisConstruireSearchParams,
  PermisConstruireState,
} from "../types/permisConstruire.types";

const INITIAL: PermisConstruireState = {
  loading: false,
  error: null,
  response: null,
  lastParams: null,
};

/**
 * Hook de recherche des permis de construire.
 * - gère loading / error / response / lastParams
 * - ignore les réponses de requêtes obsolètes (race conditions)
 */
export function usePermisConstruire() {
  const [state, setState] = useState<PermisConstruireState>(INITIAL);
  const reqIdRef = useRef(0);

  const run = useCallback(async (params: PermisConstruireSearchParams) => {
    const id = ++reqIdRef.current;
    setState((s) => ({ ...s, loading: true, error: null, lastParams: params }));
    try {
      const response = await searchPermisConstruire(params);
      if (id !== reqIdRef.current) return;
      setState({ loading: false, error: null, response, lastParams: params });
    } catch (e) {
      if (id !== reqIdRef.current) return;
      const message = e instanceof Error ? e.message : "Erreur inconnue";
      setState((s) => ({ ...s, loading: false, error: message }));
    }
  }, []);

  const reset = useCallback(() => {
    reqIdRef.current++;
    setState(INITIAL);
  }, []);

  return { state, run, reset };
}