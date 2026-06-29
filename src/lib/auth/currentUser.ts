// src/lib/auth/currentUser.ts
// Source synchrone du user_id du compte connecte.
// Alimente par onAuthStateChange (AppShell) + lecture initiale au boot.
// Le wrapper userScopedStorage lit ce module pour prefixer ses cles.

import { supabase } from "@/lib/supabase";

let currentUserId: string | null = null;

/** Lecture synchrone. Retourne null si personne n'est connecte. */
export function getCurrentUserId(): string | null {
  return currentUserId;
}

/** Pose l'id courant (appele par le listener auth). */
export function setCurrentUserId(id: string | null): void {
  currentUserId = id;
}

/**
 * Initialisation synchrone "best effort" au demarrage : lit le token Supabase
 * deja present dans localStorage pour eviter une fenetre ou l'id est null
 * pendant que getSession() (async) se resout. Le listener corrigera ensuite.
 */
export function bootCurrentUserIdSync(): void {
  try {
    const key = Object.keys(localStorage).find(
      (k) => k.startsWith("sb-") && k.endsWith("-auth-token"),
    );
    if (!key) return;
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { user?: { id?: string } };
    if (parsed?.user?.id) currentUserId = parsed.user.id;
  } catch {
    /* silencieux : le listener async posera l'id */
  }
}

/** Synchronise l'id depuis la session Supabase (async, fiable). */
export async function syncCurrentUserId(): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    currentUserId = data.session?.user?.id ?? null;
  } catch {
    currentUserId = null;
  }
}