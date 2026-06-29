// src/spaces/rehabilitation/lib/rehabScope.ts
// Scope localStorage par projet de rehabilitation.
// L'id du projet actif est pose par "Ouvrir" sur ProjetsPage.

const ACTIVE_KEY = "mimmoza.rehab.activeProjectId";

export function getActiveProjectId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

/** Construit une cle scopee au projet actif. Repli sur cle nue si aucun projet. */
export function scopedKey(base: string): string {
  const id = getActiveProjectId();
  return id ? `${base}_${id}` : base;
}