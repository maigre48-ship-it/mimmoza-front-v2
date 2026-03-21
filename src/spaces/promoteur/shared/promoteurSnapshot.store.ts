// src/spaces/promoteur/shared/promoteurSnapshot.store.ts
// Snapshot agrégé Promoteur (source de vérité cross-modules)
//
// API principale:
// - getSnapshot / getActiveStudyId / setActiveStudyId / clearActiveStudyId
// - patchProject / patchModule / resetSnapshot
// - clearAllPromoteurSessionKeys
//
// Aliases rétro-compatibilité (anciens imports):
// - getPromoteurSnapshot / patchPromoteurSnapshot / resetPromoteurSnapshot / patchProjectInfo

export type PromoteurSnapshot = Record<string, unknown>;

const LS_KEY = "mimmoza.promoteur.snapshot.v1";
const ACTIVE_STUDY_KEY = "mimmoza.promoteur.active_study_id";

// ── Toutes les clés de session globales à effacer entre deux études ──────────
// NE PAS inclure : mimmoza.promoteur.studies.v1 (liste des études)
//                  mimmoza.promoteur.terrain_selection.v1.${studyId} (par étude)
//                  mimmoza.promoteur.selected_parcels_v1.${studyId}  (par étude)
const GLOBAL_SESSION_KEYS: string[] = [
  // Session générique
  "mimmoza.session.parcel_id",
  "mimmoza.session.commune_insee",
  "mimmoza.session.address",
  "mimmoza.session.parcel_ids",
  "mimmoza.session.surface_m2",
  // Foncier (clés globales legacy)
  "mimmoza_promoteur_terrain_selection_v1",
  "mimmoza.promoteur.selected_parcels_v1",
  "mimmoza.promoteur.foncier.selected_v1",
  "mimmoza.promoteur.foncier.commune_v1",
  "mimmoza.promoteur.foncier.focus_v1",
  "mimmoza.foncier.selected_parcel_id",
  "mimmoza.foncier.last_parcel_id",
  // PLU
  "mimmoza.plu.last_commune_insee",
  "mimmoza.plu.last_commune_nom",
  "mimmoza.plu.last_address",
  "mimmoza.plu.last_parcel_id",
  "mimmoza.plu.selected_commune_insee",
  "mimmoza.plu.resolved_ruleset_v1",
  // Snapshot global
  LS_KEY,
];

// ── Helpers internes ─────────────────────────────────────────────────────────

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

// ── Active study ─────────────────────────────────────────────────────────────

/**
 * Retourne l'ID de l'étude active, ou null si aucune.
 */
export function getActiveStudyId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_STUDY_KEY);
  } catch {
    return null;
  }
}

/**
 * Définit l'étude active (appelé dans Dashboard.openStudy / createStudy).
 */
export function setActiveStudyId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_STUDY_KEY, id);
  } catch {}
}

/**
 * Supprime l'étude active (appelé dans Dashboard quand études = 0 ou delete).
 */
export function clearActiveStudyId(): void {
  try {
    localStorage.removeItem(ACTIVE_STUDY_KEY);
  } catch {}
}

// ── Session reset ────────────────────────────────────────────────────────────

/**
 * Efface toutes les clés de session globales Promoteur.
 * N'efface PAS : la liste des études, les clés per-study, l'active_study_id.
 * À appeler avant de démarrer une nouvelle étude ou si études = 0.
 */
export function clearAllPromoteurSessionKeys(): void {
  GLOBAL_SESSION_KEYS.forEach((key) => {
    try {
      localStorage.removeItem(key);
    } catch {}
  });
  console.log("[PromoteurSnapshot] Global session keys cleared");
}

// ── Snapshot CRUD ────────────────────────────────────────────────────────────

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
 * Patch un module : ex patchModule("bilan", {...})
 */
export function patchModule(moduleKey: string, payload: unknown): PromoteurSnapshot {
  if (!moduleKey || typeof moduleKey !== "string") {
    return read();
  }
  return patchProject({ [moduleKey]: payload });
}

/**
 * Reset snapshot uniquement (sans toucher aux autres clés).
 */
export function resetSnapshot(): void {
  localStorage.removeItem(LS_KEY);
}

// ── Rétro-compatibilité ──────────────────────────────────────────────────────

/** @deprecated use getSnapshot() */
export function getPromoteurSnapshot(): PromoteurSnapshot {
  return getSnapshot();
}

/** @deprecated use patchProject() */
export function patchPromoteurSnapshot(patch: PromoteurSnapshot): PromoteurSnapshot {
  return patchProject(patch);
}

/** @deprecated use resetSnapshot() */
export function resetPromoteurSnapshot(): void {
  resetSnapshot();
}

/** @deprecated use patchModule("projectInfo", {...}) */
export function patchProjectInfo(projectInfo: Record<string, unknown>): PromoteurSnapshot {
  return patchModule("projectInfo", projectInfo);
}