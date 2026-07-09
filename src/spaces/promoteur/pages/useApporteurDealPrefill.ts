// src/spaces/promoteur/pages/useApporteurDealPrefill.ts

import {
  getApporteurDeal,
  type ApporteurDeal,
} from "@/spaces/apporteur/shared/apporteurDeals.store";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

export type PrefillResult =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "not_found" }
  | { status: "error"; message: string }
  | { status: "loaded"; deal: ApporteurDeal };

/**
 * Lit `?dealId=` dans l'URL et charge le deal apporteur correspondant.
 * Le pré-remplissage n'est tenté qu'une seule fois.
 */
export function useApporteurDealPrefill(): PrefillResult {
  const [searchParams] = useSearchParams();
  const dealId = searchParams.get("dealId");
  const [result, setResult] = useState<PrefillResult>({ status: "idle" });
  const done = useRef(false);

  useEffect(() => {
    if (done.current || !dealId) return;
    done.current = true;

    let cancelled = false;
    setResult({ status: "loading" });

    getApporteurDeal(dealId)
      .then((deal) => {
        if (cancelled) return;
        setResult(deal ? { status: "loaded", deal } : { status: "not_found" });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Erreur inconnue";
        setResult({ status: "error", message });
      });

    return () => { cancelled = true; };
  }, [dealId]);

  return result;
}