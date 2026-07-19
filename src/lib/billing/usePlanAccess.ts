// src/lib/billing/usePlanAccess.ts
//
// Lit le plan MimmozIA courant depuis la MÊME source que l'app utilise déjà :
// localStorage["mimmoza.user"] (écrit par AbonnementPage.savePlan / le menu
// d'abonnements). C'est un garde-fou d'INTERFACE, pas une sécurité serveur.
// Quand un vrai plan serveur existera (organisations.plan_code / copilot-chat),
// il suffira de remplacer readPlanState() par sa lecture.

import { useCallback, useEffect, useState } from "react";
import type { Space } from "@/components/SpaceSync";
import {
  type PlanId,
  type ModuleSpace,
  MODULE_SPACES,
  canAccessSpace,
  canAccessPath,
} from "./planAccess";

const USER_KEY = "mimmoza.user";
const UPDATED_EVENT = "mimmoza:user-updated";
const VALID: PlanId[] = ["basique", "avance", "pro", "proplus"];

// Comportement d'un Pro qui n'a PAS encore choisi son module :
//   'choose' → aucun module tant qu'il n'a pas choisi (strict, option c)
//   'all'    → voit les 3 en attendant                (souple, option b)
// (option a = vrai « 1 au choix » : un module est stocké → géré automatiquement)
const PRO_WITHOUT_SELECTION: "choose" | "all" = "choose";

export type PlanState = { plan: PlanId; selectedModules: ModuleSpace[] };

function readPlanState(): PlanState {
  try {
    const raw = localStorage.getItem(USER_KEY);
    const u = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const plan: PlanId = VALID.includes(u.plan as PlanId) ? (u.plan as PlanId) : "basique";

    const rawSel = (u.selectedModules ?? (u.selectedModule ? [u.selectedModule] : [])) as unknown;
    let selectedModules: ModuleSpace[] = Array.isArray(rawSel)
      ? (rawSel.filter((m) => MODULE_SPACES.includes(m as ModuleSpace)) as ModuleSpace[])
      : [];

    if (plan === "pro" && selectedModules.length === 0 && PRO_WITHOUT_SELECTION === "all") {
      selectedModules = [...MODULE_SPACES];
    }
    return { plan, selectedModules };
  } catch {
    return { plan: "basique", selectedModules: [] };
  }
}

/** Écrit le plan (et éventuellement le module choisi d'un Pro) dans localStorage. */
export function setPlan(plan: PlanId, selectedModule?: ModuleSpace): void {
  try {
    const raw = localStorage.getItem(USER_KEY);
    const u = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const next = { ...u, plan, ...(selectedModule ? { selectedModule } : {}) };
    localStorage.setItem(USER_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(UPDATED_EVENT));
  } catch {
    /* silencieux */
  }
}

/** Version non-hook (AppShell.buildAccountFromUser, gardes hors React, etc.). */
export function getCurrentPlanState(): PlanState {
  return readPlanState();
}

/** Hook réactif : se met à jour au changement de plan (même onglet ou autre). */
export function usePlanAccess() {
  const [state, setState] = useState<PlanState>(readPlanState);

  useEffect(() => {
    const refresh = () => setState(readPlanState());
    const onStorage = (e: StorageEvent) => { if (e.key === USER_KEY) refresh(); };
    const onVis = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("storage", onStorage);
    window.addEventListener(UPDATED_EVENT, refresh as EventListener);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(UPDATED_EVENT, refresh as EventListener);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const can = useCallback((space: Space) => canAccessSpace(space, state.plan, state.selectedModules), [state]);
  const canPath = useCallback((path: string) => canAccessPath(path, state.plan, state.selectedModules), [state]);

  return { plan: state.plan, selectedModules: state.selectedModules, canAccessSpace: can, canAccessPath: canPath };
}