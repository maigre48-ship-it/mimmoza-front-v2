// massingBilanBridge.ts — pont Massing 3D → Bilan Promoteur (localStorage, par étude)
// ─────────────────────────────────────────────────────────────────────────────
// Même patron que le bridge terrassement (mimmoza.terrassement.export.{id}) :
//   • la page Massing 3D ÉCRIT un snapshot de métré à chaque changement,
//   • le Bilan le LIT (mount + focus + event) et verrouille/pré-remplit ses champs.
// Aucun couplage de store : le seul lien est cette clé localStorage scopée étude
// + un CustomEvent pour la mise à jour live quand le bilan est déjà monté.
//
// Le métré lui-même est calculé par deriveMassingMetrics (massingToBilan.ts),
// module pur. Ce fichier ne fait que transporter le résultat.
// ─────────────────────────────────────────────────────────────────────────────

import type { MassingMetrics } from "./massingToBilan";
import { userStorage } from "@/lib/storage/userScopedStorage";

export type { MassingMetrics } from "./massingToBilan";

/** Event de mise à jour live (bilan déjà monté). */
export const MASSING_METRICS_EVENT = "mimmoza:promoteur-massing-metrics-updated";

/** Clé localStorage scopée par étude. */
export function massingMetricsKey(studyId: string): string {
  return `mimmoza.massing.metrics.${studyId}`;
}

export interface MassingMetricsSnapshot {
  metrics:   MassingMetrics;
  updatedAt: string;        // ISO
  version:   1;
}

/**
 * Écrit le snapshot de métré + notifie le bilan (event live).
 * À appeler côté page Massing 3D à chaque changement des bâtiments.
 * No-op silencieux si studyId absent (étude non sauvegardée).
 */
export function writeMassingMetrics(studyId: string | null | undefined, metrics: MassingMetrics): void {
  if (!studyId) return;
  const snapshot: MassingMetricsSnapshot = { metrics, updatedAt: new Date().toISOString(), version: 1 };
  try {
    userStorage.setItem(massingMetricsKey(studyId), JSON.stringify(snapshot));
  } catch (e) {
    console.warn("[massingBilanBridge] écriture échouée:", e);
    return;
  }
  try {
    window.dispatchEvent(new CustomEvent<MassingMetricsSnapshot>(MASSING_METRICS_EVENT, { detail: snapshot }));
  } catch { /* SSR / pas de window */ }
}

/** Lit le snapshot de métré pour une étude. null si absent / invalide. */
export function readMassingMetrics(studyId: string | null | undefined): MassingMetricsSnapshot | null {
  if (!studyId) return null;
  try {
    const raw = userStorage.getItem(massingMetricsKey(studyId));
    if (!raw) return null;
    const snap = JSON.parse(raw) as MassingMetricsSnapshot;
    if (!snap?.metrics?.totaux) return null;
    return snap;
  } catch {
    return null;
  }
}

/** Efface le snapshot (ex. reset d'étude). */
export function clearMassingMetrics(studyId: string | null | undefined): void {
  if (!studyId) return;
  try { userStorage.removeItem(massingMetricsKey(studyId)); } catch { /* */ }
}