// src/lib/storage/userScopedStorage.ts
// Wrapper localStorage isole par utilisateur.
// Toute cle ecrite via ce module devient "u:{userId}:{base}".
// Deux comptes sur le meme navigateur n'ont jamais les memes cles.
// Repli sur cle nue si aucun utilisateur connecte (pages publiques).

import { getCurrentUserId } from "@/lib/auth/currentUser";

function scoped(base: string): string {
  const uid = getCurrentUserId();
  return uid ? `u:${uid}:${base}` : base;
}

export const userStorage = {
  getItem(base: string): string | null {
    try {
      return localStorage.getItem(scoped(base));
    } catch {
      return null;
    }
  },

  setItem(base: string, value: string): void {
    try {
      localStorage.setItem(scoped(base), value);
    } catch {
      /* quota ou acces refuse : silencieux */
    }
  },

  removeItem(base: string): void {
    try {
      localStorage.removeItem(scoped(base));
    } catch {
      /* silencieux */
    }
  },
};

/**
 * Purge toutes les cles scopees de l'utilisateur courant (utile au logout).
 * Ne touche pas aux cles d'autres comptes ni aux cles Supabase (sb-...).
 */
export function purgeCurrentUserStorage(): void {
  try {
    const uid = getCurrentUserId();
    if (!uid) return;
    const prefix = `u:${uid}:`;
    const toRemove = Object.keys(localStorage).filter((k) => k.startsWith(prefix));
    toRemove.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* silencieux */
  }
}