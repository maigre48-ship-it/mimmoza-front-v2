// src/spaces/promoteur/shared/promoteurSnapshot.store.ts
// Snapshot agrégé Promoteur (source de vérité cross-modules)
//
// API principale:
// - getSnapshot
// - patchProject
// - patchModule
// - resetSnapshot
//
// Aliases rétro-compatibilité (anciens imports):
// - getPromoteurSnapshot
// - patchPromoteurSnapshot
// - resetPromoteurSnapshot
// - patchProjectInfo

export type PromoteurSnapshot = Record<string, unknown>;

const LS_KEY = "mimmoza.promoteur.snapshot.v1";

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function read(): PromoteurSnapshot {
  return safeParse<PromoteurSnapshot>(localStorage.getItem(LS_KEY), {});
}

function write(next: PromoteurSnapshot) {
  localStorage.setItem(LS_KEY, JSON.stringify(next));
}

/**
 * Retourne le snapshot complet (agrégé).
 */
export function getSnapshot(): PromoteurSnapshot {
  return read();
}

/**
 * Patch plusieurs champs (merge shallow).
 */
export function patchProject(patch: PromoteurSnapshot): PromoteurSnapshot {
  const prev = read();
  const next = { ...prev, ...patch };
  write(next);
  return next;
}

/**
 * Patch un module (recommandé) : ex patchModule("bilan", {...})
 */
export function patchModule(moduleKey: string, payload: unknown): PromoteurSnapshot {
  if (!moduleKey || typeof moduleKey !== "string") {
    // Ne pas throw pour éviter de casser l'app en prod
    return read();
  }
  return patchProject({ [moduleKey]: payload });
}

/**
 * Reset snapshot (debug/admin).
 */
export function resetSnapshot(): void {
  localStorage.removeItem(LS_KEY);
}

// =======================================================
// Rétro-compatibilité (anciens noms utilisés dans le front)
// =======================================================

/**
 * Alias: certains modules importent getPromoteurSnapshot
 */
export function getPromoteurSnapshot(): PromoteurSnapshot {
  return getSnapshot();
}

/**
 * Alias: certains modules importent patchPromoteurSnapshot
 * On le mappe sur patchProject (merge shallow).
 */
export function patchPromoteurSnapshot(patch: PromoteurSnapshot): PromoteurSnapshot {
  return patchProject(patch);
}

/**
 * Alias: certains modules importent resetPromoteurSnapshot
 */
export function resetPromoteurSnapshot(): void {
  resetSnapshot();
}

/**
 * Alias: certains modules importent patchProjectInfo
 * Convention: on stocke ces infos sous snapshot.projectInfo
 */
export function patchProjectInfo(projectInfo: Record<string, unknown>): PromoteurSnapshot {
  return patchModule("projectInfo", projectInfo);
}
