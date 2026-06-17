// src/spaces/promoteur/pages/useApporteurDealPrefill.ts

import {
  getApporteurDeal,
  type ApporteurDeal,
} from "@/spaces/apporteur/shared/apporteurDeals.store";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

export type PrefillResult =
  | { status: "idle" }
  | { status: "not_found" }
  | { status: "loaded"; deal: ApporteurDeal };

/**
 * Lit `?dealId=` dans l'URL et charge le deal apporteur correspondant.
 * Retourne un résultat stable (ne se réexécute pas si l'URL change).
 */
export function useApporteurDealPrefill(): PrefillResult {
  const [searchParams] = useSearchParams();
  const dealId = searchParams.get("dealId");
  const [result, setResult] = useState<PrefillResult>({ status: "idle" });
  // Garantit que le pré-remplissage ne se fait qu'une seule fois
  const done = useRef(false);

  useEffect(() => {
    if (done.current || !dealId) return;
    done.current = true;

    const deal = getApporteurDeal(dealId);
    if (!deal) {
      setResult({ status: "not_found" });
    } else {
      setResult({ status: "loaded", deal });
    }
  }, [dealId]);

  return result;
}