/**
 * useTriggerAlerts.ts
 *
 * Hook léger pour déclencher le recalcul des alertes depuis les pages d'action.
 * Non-bloquant (try/catch), compatible avec un re-run partiel (onlyRules).
 *
 * Usage :
 *   const { triggerAlerts } = useTriggerAlerts();
 *   // après un save :
 *   triggerAlerts(["ltv_exceeded", "dscr_low"]);
 *   // ou full recalcul :
 *   triggerAlerts();
 */

import { useCallback } from "react";
import { runAndPersistAlerts } from "../services/banqueAlerts";

export function useTriggerAlerts() {
  const triggerAlerts = useCallback((onlyRules?: string[]) => {
    try {
      runAndPersistAlerts({ onlyRules });
    } catch (e) {
      console.warn("[banqueAlerts] trigger failed:", e);
    }
  }, []);

  return { triggerAlerts };
}