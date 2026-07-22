// src/lib/billing/planAccess.ts
//
// Règles d'accès aux modules métier selon l'abonnement MimmozIA.
// Fichier PUR (aucun appel réseau, aucun accès localStorage) : il ne fait QUE
// décider "a le droit / n'a pas le droit". Les deux sources de vérité (plan
// réel, module choisi d'un Pro) sont injectées par l'appelant — voir
// usePlanAccess() / getCurrentPlanState().

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

/** Libellés d'affichage (source unique — AppShell peut importer d'ici). */
export const PLAN_LABEL: Record<PlanId, string> = {
  basique: "Basique",
  avance: "Avancé",
  pro: "Pro",
  proplus: "Pro +",
};

/** Libellés courts des modules, pour les dialogues de choix. */
export const MODULE_LABEL: Record<ModuleSpace, string> = {
  marchand: "Investissement",
  promoteur: "Promotion",
  rehabilitation: "Réhabilitation",
};

/**
 * Comportement d'un Pro qui n'a PAS encore choisi son module :
 *   'choose' → aucun module tant qu'il n'a pas choisi (strict)
 *   'all'    → voit les 3 en attendant                (souple)
 *
 * ⚠️ Cette constante vit ICI et non dans usePlanAccess : la placer côté hook
 * obligeait à pré-remplir selectedModules avec les 3 modules, que
 * allowedModules() tronquait ensuite à 1 (le mode 'all' ne fonctionnait donc
 * pas). Ici, le slice(0,1) ne s'applique qu'aux choix réellement enregistrés.
 */
export const PRO_WITHOUT_SELECTION: "choose" | "all" = "choose";

/** État d'accès d'un espace, pour l'UI (onglets, gardes de route, upsell). */
export type SpaceAccess = {
  /** Accessible tel quel : on navigue directement. */
  unlocked: boolean;
  /** Plan Pro sans module choisi : le clic doit proposer d'activer celui-ci. */
  selectable: boolean;
  /** Hors formule : le clic doit renvoyer vers l'abonnement. */
  requiresUpgrade: boolean;
};

/** Un pathname n'est concerné par le gating que s'il vise un module métier. */
export function moduleSpaceForPath(pathname: string): ModuleSpace | null {
  if (pathname === "/marchand-de-bien" || pathname.startsWith("/marchand-de-bien/")) return "marchand";
  if (pathname === "/promoteur" || pathname.startsWith("/promoteur/")) return "promoteur";
  if (pathname === "/rehabilitation" || pathname.startsWith("/rehabilitation/")) return "rehabilitation";
  return null;
}

/** true si l'espace est un des 3 modules gatés. */
export function isModuleSpace(space: string): space is ModuleSpace {
  return MODULE_SPACES.includes(space as ModuleSpace);
}

/**
 * Modules réellement autorisés pour un plan donné.
 * @param plan            plan réel du compte
 * @param selectedModules module(s) choisi(s) par l'utilisateur (utile pour "pro")
 */
export function allowedModules(plan: PlanId, selectedModules: ModuleSpace[] = []): ModuleSpace[] {
  if (plan === "proplus") return [...MODULE_SPACES];

  if (plan === "pro") {
    const clean = selectedModules.filter((m) => MODULE_SPACES.includes(m));
    // Pas encore de choix : selon le mode, on n'ouvre rien ou on ouvre tout.
    if (clean.length === 0) return PRO_WITHOUT_SELECTION === "all" ? [...MODULE_SPACES] : [];
    // Choix enregistré : 1 module maximum, quoi qu'il y ait en stockage.
    return clean.slice(0, 1);
  }

  return []; // basique, avance : aucun module métier
}

/** Décide si un espace est accessible. Les non-modules restent libres. */
export function canAccessSpace(
  space: Space,
  plan: PlanId,
  selectedModules: ModuleSpace[] = [],
): boolean {
  if (ALWAYS_ALLOWED.includes(space)) return true;
  if (isModuleSpace(space)) {
    return allowedModules(plan, selectedModules).includes(space);
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

/**
 * État d'accès détaillé — ce dont l'UI a besoin pour distinguer trois cas :
 * ouvert / à activer (Pro sans choix) / à upgrader (Pro sur un autre module,
 * ou Basique-Avancé). C'est ce que consomment les onglets d'espaces.
 */
export function getSpaceAccess(
  space: Space,
  plan: PlanId,
  selectedModules: ModuleSpace[] = [],
): SpaceAccess {
  if (canAccessSpace(space, plan, selectedModules)) {
    return { unlocked: true, selectable: false, requiresUpgrade: false };
  }
  // À ce stade l'espace est forcément un module gaté et non autorisé.
  const noChoiceYet =
    plan === "pro" &&
    selectedModules.filter((m) => MODULE_SPACES.includes(m)).length === 0;

  if (noChoiceYet) return { unlocked: false, selectable: true, requiresUpgrade: false };
  return { unlocked: false, selectable: false, requiresUpgrade: true };
}

/** Nombre de modules restant à choisir (0 si formule sans choix à faire). */
export function remainingModuleChoices(plan: PlanId, selectedModules: ModuleSpace[] = []): number {
  if (plan !== "pro") return 0;
  const clean = selectedModules.filter((m) => MODULE_SPACES.includes(m));
  return Math.max(0, PLAN_MODULE_COUNT.pro - clean.length);
}