// src/lib/billing/usePlanAccess.ts
//
// Lit le plan MimmozIA courant depuis la MÊME source que l'app utilise déjà :
// localStorage["mimmoza.user"] (écrit par AbonnementPage.savePlan / le menu
// d'abonnements). C'est un garde-fou d'INTERFACE, pas une sécurité serveur.
//
// Quand un vrai plan serveur existera (organisations.plan_code / copilot-chat),
// il suffira de remplacer readPlanState() par sa lecture.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Space } from "@/components/SpaceSync";

import {
  type PlanId,
  type ModuleSpace,
  MODULE_SPACES,
  canAccessSpace,
  canAccessPath,
  remainingModuleChoices,
} from "./planAccess";

import {
  type SpaceAccess,
  getSpaceAccess,
} from "./spaceAccess";

const USER_KEY = "mimmoza.user";
const UPDATED_EVENT = "mimmoza:user-updated";

const VALID: PlanId[] = [
  "basique",
  "avance",
  "pro",
  "proplus",
];

export type PlanState = {
  plan: PlanId;
  selectedModules: ModuleSpace[];
};

/**
 * Lecture brute et normalisation.
 *
 * Cette fonction ne décide pas des droits :
 * le contrôle des accès reste défini dans planAccess et spaceAccess.
 */
function readPlanState(): PlanState {
  try {
    const raw = localStorage.getItem(USER_KEY);

    const user = raw
      ? (JSON.parse(raw) as Record<string, unknown>)
      : {};

    const plan: PlanId = VALID.includes(user.plan as PlanId)
      ? (user.plan as PlanId)
      : "basique";

    /*
     * Format courant :
     * selectedModules: ModuleSpace[]
     *
     * Ancien format :
     * selectedModule: ModuleSpace
     */
    const rawSelectedModules = (
      user.selectedModules ??
      (user.selectedModule ? [user.selectedModule] : [])
    ) as unknown;

    const selectedModules: ModuleSpace[] = Array.isArray(rawSelectedModules)
      ? (
          rawSelectedModules.filter((module) =>
            MODULE_SPACES.includes(module as ModuleSpace),
          ) as ModuleSpace[]
        )
      : [];

    /*
     * Aucun préremplissage ici.
     *
     * Le comportement d'un abonnement Pro sans module sélectionné
     * doit être déterminé par les règles d'accès, pas par la lecture
     * du localStorage.
     */
    return {
      plan,
      selectedModules,
    };
  } catch {
    return {
      plan: "basique",
      selectedModules: [],
    };
  }
}

/**
 * Met à jour les informations locales de l'utilisateur puis avertit
 * les composants du même onglet.
 */
function writeUser(patch: Record<string, unknown>): void {
  try {
    const raw = localStorage.getItem(USER_KEY);

    const user = raw
      ? (JSON.parse(raw) as Record<string, unknown>)
      : {};

    localStorage.setItem(
      USER_KEY,
      JSON.stringify({
        ...user,
        ...patch,
      }),
    );

    window.dispatchEvent(new Event(UPDATED_EVENT));
  } catch {
    // Une erreur de localStorage ne doit pas bloquer l'interface.
  }
}

/**
 * Écrit le plan courant et, éventuellement, le module choisi
 * par un abonné Pro.
 */
export function setPlan(
  plan: PlanId,
  selectedModule?: ModuleSpace,
): void {
  const patch: Record<string, unknown> = {
    plan,
  };

  if (
    selectedModule &&
    MODULE_SPACES.includes(selectedModule)
  ) {
    /*
     * Écriture temporaire dans les deux formats pour rester compatible
     * avec les anciennes parties de l'application.
     */
    patch.selectedModules = [selectedModule];
    patch.selectedModule = selectedModule;
  }

  writeUser(patch);
}

/**
 * Enregistre le module métier choisi par un abonné Pro.
 *
 * Le choix précédent est remplacé afin de garantir qu'un abonnement
 * Pro standard ne possède qu'un seul module sélectionné.
 */
export function selectModule(module: ModuleSpace): void {
  if (!MODULE_SPACES.includes(module)) {
    return;
  }

  writeUser({
    selectedModules: [module],
    selectedModule: module,
  });
}

/**
 * Efface le choix du module métier.
 */
export function clearSelectedModules(): void {
  writeUser({
    selectedModules: [],
    selectedModule: null,
  });
}

/**
 * Version utilisable en dehors d'un composant React.
 */
export function getCurrentPlanState(): PlanState {
  return readPlanState();
}

/**
 * Hook réactif donnant accès au plan et aux droits associés.
 */
export function usePlanAccess() {
  const [state, setState] = useState<PlanState>(readPlanState);

  useEffect(() => {
    const refresh = (): void => {
      setState(readPlanState());
    };

    const handleStorage = (event: StorageEvent): void => {
      if (event.key === USER_KEY) {
        refresh();
      }
    };

    const handleVisibilityChange = (): void => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    };

    window.addEventListener("storage", handleStorage);

    window.addEventListener(
      UPDATED_EVENT,
      refresh as EventListener,
    );

    document.addEventListener(
      "visibilitychange",
      handleVisibilityChange,
    );

    return () => {
      window.removeEventListener("storage", handleStorage);

      window.removeEventListener(
        UPDATED_EVENT,
        refresh as EventListener,
      );

      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange,
      );
    };
  }, []);

  const can = useCallback(
    (space: Space): boolean =>
      canAccessSpace(
        space,
        state.plan,
        state.selectedModules,
      ),
    [state.plan, state.selectedModules],
  );

  const canPath = useCallback(
    (path: string): boolean =>
      canAccessPath(
        path,
        state.plan,
        state.selectedModules,
      ),
    [state.plan, state.selectedModules],
  );

  /**
   * Retourne l'état détaillé d'un espace :
   * accessible, sélectionnable ou nécessitant un autre abonnement.
   */
  const access = useCallback(
    (space: Space): SpaceAccess =>
      getSpaceAccess(
        space,
        state.plan,
        state.selectedModules,
      ),
    [state.plan, state.selectedModules],
  );

  /**
   * Enregistre le module choisi et rafraîchit immédiatement le hook.
   */
  const choose = useCallback(
    (module: ModuleSpace): void => {
      selectModule(module);
      setState(readPlanState());
    },
    [],
  );

  const remaining = useMemo(
    () =>
      remainingModuleChoices(
        state.plan,
        state.selectedModules,
      ),
    [state.plan, state.selectedModules],
  );

  return {
    plan: state.plan,
    selectedModules: state.selectedModules,
    canAccessSpace: can,
    canAccessPath: canPath,
    access,
    selectModule: choose,
    remainingModuleChoices: remaining,
  };
}