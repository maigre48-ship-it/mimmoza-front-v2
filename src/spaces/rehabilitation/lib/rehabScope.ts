// src/spaces/rehabilitation/lib/rehabScope.ts
// Scope localStorage par projet de rehabilitation, isole par utilisateur.
// L'id du projet actif est pose par "Ouvrir" sur ProjetsPage.

import { userStorage } from "@/lib/storage/userScopedStorage";

const ACTIVE_KEY = "mimmoza.rehab.activeProjectId";

export function getActiveProjectId(): string | null {
  return userStorage.getItem(ACTIVE_KEY);
}

export function setActiveProjectId(id: string): void {
  userStorage.setItem(ACTIVE_KEY, id);
}

/** Construit une cle scopee au projet actif. Repli sur cle nue si aucun projet. */
export function scopedKey(base: string): string {
  const id = getActiveProjectId();
  return id ? `${base}_${id}` : base;
}