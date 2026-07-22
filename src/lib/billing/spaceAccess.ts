// src/lib/billing/spaceAccess.ts
//
// Produit un état détaillé pour l’interface :
// - unlocked : l’espace est immédiatement accessible ;
// - selectable : l’abonné Pro peut le choisir comme module inclus.
//
// Les règles fondamentales restent définies dans planAccess.ts.

import type { Space } from "@/components/SpaceSync";

import {
  type PlanId,
  type ModuleSpace,
  MODULE_SPACES,
  allowedModules,
  canAccessSpace,
} from "./planAccess";

export type SpaceAccess = {
  /** L’utilisateur peut ouvrir immédiatement cet espace. */
  unlocked: boolean;

  /** L’abonné Pro peut sélectionner cet espace comme module inclus. */
  selectable: boolean;
};

/**
 * Retourne l’état détaillé d’accès à un espace.
 */
export function getSpaceAccess(
  space: Space,
  plan: PlanId,
  selectedModules: ModuleSpace[] = [],
): SpaceAccess {
  const unlocked = canAccessSpace(
    space,
    plan,
    selectedModules,
  );

  if (unlocked) {
    return {
      unlocked: true,
      selectable: false,
    };
  }

  const isModule = MODULE_SPACES.includes(
    space as ModuleSpace,
  );

  /*
   * Un abonné Pro peut sélectionner un module uniquement si :
   * - l’espace visé est un module métier ;
   * - aucun module n’a encore été sélectionné.
   *
   * Si un module est déjà actif, le changement doit être effectué depuis
   * la page d’abonnement.
   */
  const selectable =
    plan === "pro" &&
    isModule &&
    allowedModules(plan, selectedModules).length === 0;

  return {
    unlocked: false,
    selectable,
  };
}