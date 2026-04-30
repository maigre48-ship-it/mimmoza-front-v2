// src/spaces/promoteur/shared/promoteurSnapshot.store.ts

import type { ReliefData } from "../terrain3d/components/SceneSvg3D";

export type PromoteurSnapshot = Record<string, unknown>;

const LS_KEY = "mimmoza.promoteur.snapshot.v1";
const ACTIVE_STUDY_KEY = "mimmoza.promoteur.active_study_id";

// ── Facade image — cache mémoire (survit aux remounts, pas au reload page) ───
// localStorage est inutilisable pour les images > ~500Ko (quota déjà consommé
// par le reste de l'app). Un module-level Map suffit : dans une SPA Vite, les
// modules sont des singletons qui persistent entre montages/démontages de
// composants — l'image reste donc disponible quand on change d'onglet.
const _facadeImageCache = new Map<string, string>();

const facadeImageKey = (studyId: string | null): string =>
  studyId ?? "__default__";

// ── Relief cache — même pattern que _facadeImageCache ───────────────────────
// Les données terrain (grille d'altimétrie) sont volumineuses (~50Ko JSON) et
// coûteuses à fetcher (Edge Function → IGN). On les garde en mémoire module
// pour les réutiliser sans nouveau fetch quand l'utilisateur change d'onglet
// et revient sur Massing 3D dans la même session SPA.
const _reliefCache = new Map<string, ReliefData>();

const reliefCacheKey = (studyId: string | null): string =>
  studyId ?? "__default__";

const GLOBAL_SESSION_KEYS: string[] = [
  "mimmoza.session.parcel_id",
  "mimmoza.session.commune_insee",
  "mimmoza.session.address",
  "mimmoza.session.parcel_ids",
  "mimmoza.session.surface_m2",
  "mimmoza_promoteur_terrain_selection_v1",
  "mimmoza.promoteur.selected_parcels_v1",
  "mimmoza.promoteur.foncier.selected_v1",
  "mimmoza.promoteur.foncier.commune_v1",
  "mimmoza.promoteur.foncier.focus_v1",
  "mimmoza.foncier.selected_parcel_id",
  "mimmoza.foncier.last_parcel_id",
  "mimmoza.plu.last_commune_insee",
  "mimmoza.plu.last_commune_nom",
  "mimmoza.plu.last_address",
  "mimmoza.plu.last_parcel_id",
  "mimmoza.plu.selected_commune_insee",
  "mimmoza.plu.resolved_ruleset_v1",
  "mimmoza.promoteur.captures.v1",
  "mimmoza.promoteur.synthese.rawInput.v1",
  "mimmoza.promoteur.synthese.autocomplete_done_v1",
  "mimmoza.bilan.land_price_eur.v1",
  "mimmoza.terrassement.export",
  LS_KEY,
];

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

export function getActiveStudyId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_STUDY_KEY);
  } catch {
    return null;
  }
}

export function setActiveStudyId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_STUDY_KEY, id);
  } catch {}
}

export function clearActiveStudyId(): void {
  try {
    localStorage.removeItem(ACTIVE_STUDY_KEY);
  } catch {}
}

// ── Facade image ─────────────────────────────────────────────────────────────

/**
 * Lit l'image façade depuis le cache mémoire.
 * Retourne null si aucune image n'a été générée dans cette session.
 */
export function getFacadeImage(studyId: string | null): string | null {
  return _facadeImageCache.get(facadeImageKey(studyId)) ?? null;
}

/**
 * Stocke l'image façade en mémoire (blob: ou data: URL).
 * Survit aux remounts de composant dans la même session SPA.
 */
export function setFacadeImage(studyId: string | null, imageData: string): void {
  _facadeImageCache.set(facadeImageKey(studyId), imageData);
  console.log(
    `[PromoteurSnapshot] Image façade cachée en mémoire — key=${facadeImageKey(studyId)} size=${Math.round(imageData.length / 1024)}Ko`,
  );
}

/**
 * Efface l'image façade du cache (régénération ou reset étude).
 */
export function clearFacadeImage(studyId: string | null): void {
  _facadeImageCache.delete(facadeImageKey(studyId));
}

// ── Relief terrain ────────────────────────────────────────────────────────────

/**
 * Lit les données de relief depuis le cache mémoire.
 * Retourne null si le terrain n'a pas encore été chargé dans cette session,
 * ou si l'étude a changé (clé différente).
 */
export function getReliefCache(studyId: string | null): ReliefData | null {
  return _reliefCache.get(reliefCacheKey(studyId)) ?? null;
}

/**
 * Stocke les données de relief en mémoire après un fetch Edge Function réussi.
 * Survit aux remounts de composant dans la même session SPA —
 * le retour sur Massing 3D ne déclenchera plus de nouveau fetch réseau.
 */
export function setReliefCache(studyId: string | null, data: ReliefData): void {
  _reliefCache.set(reliefCacheKey(studyId), data);
  console.debug(
    `[PromoteurSnapshot] Relief caché en mémoire — key=${reliefCacheKey(studyId)} nx=${data.nx} ny=${data.ny} ΔZ=${(data.maxZ - data.minZ).toFixed(1)}m`,
  );
}

/**
 * Efface le cache relief d'une étude (ex. reset ou changement de parcelle).
 */
export function clearReliefCache(studyId: string | null): void {
  _reliefCache.delete(reliefCacheKey(studyId));
  console.debug(
    `[PromoteurSnapshot] Relief cache effacé — key=${reliefCacheKey(studyId)}`,
  );
}

// ── Session reset ────────────────────────────────────────────────────────────

/**
 * Efface toutes les clés de session globales Promoteur.
 * N'efface PAS les clés per-study ni la liste des études.
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

export function getSnapshot(): PromoteurSnapshot {
  return read();
}

export function patchProject(patch: PromoteurSnapshot): PromoteurSnapshot {
  const prev = read();
  const next = { ...prev, ...patch };
  write(next);
  return next;
}

export function patchModule(moduleKey: string, payload: unknown): PromoteurSnapshot {
  if (!moduleKey || typeof moduleKey !== "string") return read();
  return patchProject({ [moduleKey]: payload });
}

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