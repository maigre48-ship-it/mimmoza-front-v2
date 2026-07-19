// src/lib/billing/planAccess.ts
//
// Règles d'accès aux modules métier selon l'abonnement MimmozIA.
// Fichier PUR (aucun appel réseau) : il ne fait QUE décider "a le droit / n'a pas
// le droit". Les deux sources de vérité (plan réel, module choisi d'un Pro) sont
// injectées par l'appelant — voir usePlanAccess()/getCurrentPlan() à brancher.

import type { Space } from "@/components/SpaceSync";

export type PlanId = "basique" | "avance" | "pro" | "proplus";

/** Espaces = modules métier soumis à l'abonnement. */
export type ModuleSpace = "marchand" | "promoteur" | "rehabilitation";

/** Les 3 modules gatés. (marchand = Investissement, promoteur = Promotion.) */
export const MODULE_SPACES: ModuleSpace[] = ["marchand", "promoteur", "rehabilitation"];

/** Toujours accessibles, quel que soit le plan (MimmozIA + Apport d'affaires). */
const ALWAYS_ALLOWED: Space[] = ["mimmozia", "agence", "none"];

/** Nombre de modules inclus par formule (pour l'affichage / la validation). */
export const PLAN_MODULE_COUNT: Record<PlanId, number> = {
  basique: 0,
  avance: 0,
  pro: 1,
  proplus: 3,
};

/** Un pathname n'est concerné par le gating que s'il vise un module métier. */
export function moduleSpaceForPath(pathname: string): ModuleSpace | null {
  if (pathname === "/marchand-de-bien" || pathname.startsWith("/marchand-de-bien/")) return "marchand";
  if (pathname === "/promoteur" || pathname.startsWith("/promoteur/")) return "promoteur";
  if (pathname === "/rehabilitation" || pathname.startsWith("/rehabilitation/")) return "rehabilitation";
  return null;
}

/**
 * Modules réellement autorisés pour un plan donné.
 * @param plan            plan réel du compte
 * @param selectedModules module(s) choisi(s) par l'utilisateur (utile pour "pro")
 */
export function allowedModules(plan: PlanId, selectedModules: ModuleSpace[] = []): ModuleSpace[] {
  if (plan === "proplus") return [...MODULE_SPACES];
  if (plan === "pro") return selectedModules.filter((m) => MODULE_SPACES.includes(m)).slice(0, 1);
  return []; // basique, avance : aucun module métier
}

/** Décide si un espace est accessible. Les non-modules restent libres. */
export function canAccessSpace(
  space: Space,
  plan: PlanId,
  selectedModules: ModuleSpace[] = [],
): boolean {
  if (ALWAYS_ALLOWED.includes(space)) return true;
  if (MODULE_SPACES.includes(space as ModuleSpace)) {
    return allowedModules(plan, selectedModules).includes(space as ModuleSpace);
  }
  return true; // dashboard, api, analyse-rapide, opportunités, etc.
}

/** Variante par URL (pour un garde de route). */
export function canAccessPath(
  pathname: string,
  plan: PlanId,
  selectedModules: ModuleSpace[] = [],
): boolean {
  const mod = moduleSpaceForPath(pathname);
  if (!mod) return true;
  return canAccessSpace(mod, plan, selectedModules);
}