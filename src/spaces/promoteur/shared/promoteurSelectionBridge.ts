// src/spaces/promoteur/shared/promoteurSelectionBridge.ts
// ─────────────────────────────────────────────────────────────────────────────
// PONT DE SÉLECTION PARCELLAIRE
//
// Problème résolu : à la reprise d'un dossier (Dashboard → openStudy), aucune clé
// de handoff n'est repeuplée. Massing 3D voit la parcelle (il lit la clé scopée
// `mimmoza.parcelFeature.<studyId>`), mais Implantation 2D / PLU / Bilan lisent
// d'autres clés vides → "Aucune parcelle sélectionnée".
//
// Ce module reconstruit les clés de handoff à partir de la parcelle réellement
// présente : clé scopée par étude EN PRIORITÉ (autorité pour un studyId donné,
// survit à la reprise), puis store Zustand (étude couramment chargée).
//
// 100 % additif : ne modifie aucune logique existante, n'écrase jamais une
// valeur par du vide, et peut être appelé hors React (via getState()).
// ─────────────────────────────────────────────────────────────────────────────

import { usePromoteurProjectStore } from "../store/promoteurProject.store";
import {
  userStorage,
  baseKeyIfOwnedByCurrentUser,
} from "@/lib/storage/userScopedStorage";

// ── Clés (alignées sur Foncier / Implantation 2D / PluFaisabilite) ──────────

const LS_SELECTED_PARCELS_V1 = "mimmoza.promoteur.selected_parcels_v1";
const LS_TERRAIN_SELECTION = "mimmoza_promoteur_terrain_selection_v1";
const LS_SESSION_PARCEL_ID = "mimmoza.session.parcel_id";
const LS_SESSION_COMMUNE_INSEE = "mimmoza.session.commune_insee";
const LS_SESSION_ADDRESS = "mimmoza.session.address";

function parcelFeatureKey(studyId: string): string {
  return `mimmoza.parcelFeature.${studyId}`;
}

// ── Types minimaux ──────────────────────────────────────────────────────────

interface AnyFeature {
  type?: string;
  id?: string | number;
  properties?: Record<string, unknown> | null;
  geometry?: {
    type?: string;
    coordinates?: unknown;
  } | null;
}

export interface UnifiedSelection {
  parcelIds: string[];
  primaryParcelId: string | null;
  communeInsee: string | null;
  surfaceM2: number | null;
  address: string | null;
}

// ── Lecture de la parcelle courante (clé scopée → store) ─────────────────────

function getStudyParcelFeature(studyId: string | null): AnyFeature | null {
  // 1) Handoff scopé par étude : autorité pour CE studyId, survit à la reprise.
  if (studyId) {
    try {
      const raw = userStorage.getItem(parcelFeatureKey(studyId));
      if (raw) {
        const feat = JSON.parse(raw) as AnyFeature;
        if (feat?.geometry?.type) return feat;
      }
    } catch {
      /* parse échoué */
    }
  }
  // 2) Store Zustand (étude couramment chargée en mémoire).
  try {
    const parcel = usePromoteurProjectStore.getState().parcel as AnyFeature | null;
    if (parcel?.geometry?.type) return parcel;
  } catch {
    /* store indisponible */
  }
  return null;
}

// ── Extraction tolérante id / commune / surface ─────────────────────────────

function pickString(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

function extractParcelInfo(feature: AnyFeature): {
  parcelId: string | null;
  communeInsee: string | null;
  surfaceM2: number | null;
} {
  const p = feature.properties ?? {};

  // IDU cadastrale : id Feature ou propriété id/idu/IDU
  const parcelId = pickString(p["id"], p["idu"], p["IDU"], p["parcelle"], feature.id);

  // Commune INSEE : propriété explicite, sinon 5 premiers caractères de l'IDU
  let communeInsee = pickString(
    p["commune"],
    p["code_insee"],
    p["insee"],
    p["code_commune"],
  );
  if (!communeInsee && parcelId && /^\d{5}/.test(parcelId)) {
    communeInsee = parcelId.slice(0, 5);
  }

  // Surface : contenance cadastrale, sinon aire géodésique du polygone
  let surfaceM2: number | null = null;
  const contenance = p["contenance"];
  if (typeof contenance === "number" && contenance > 0) {
    surfaceM2 = Math.round(contenance);
  } else {
    surfaceM2 = geometryAreaM2(feature.geometry);
  }

  return { parcelId, communeInsee, surfaceM2 };
}

// ── Aire géodésique (sphérique) — sans dépendance turf/projection ───────────

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function ringAreaM2(ring: number[][]): number {
  const R = 6378137; // rayon terrestre WGS84 (m)
  const n = ring.length;
  if (n < 3) return 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[(i + 1) % n];
    total += toRad(lon2 - lon1) * (2 + Math.sin(toRad(lat1)) + Math.sin(toRad(lat2)));
  }
  return Math.abs((total * R * R) / 2);
}

function geometryAreaM2(
  geometry: AnyFeature["geometry"] | null | undefined,
): number | null {
  if (!geometry?.coordinates) return null;
  try {
    // Heuristique : si les coordonnées ne ressemblent pas à du WGS84 (déjà en
    // mètres locaux), on ne calcule pas d'aire géodésique (résultat aberrant).
    if (geometry.type === "Polygon") {
      const coords = geometry.coordinates as number[][][];
      const ring = coords[0] ?? [];
      if (!looksLikeWgs84(ring)) return null;
      return Math.round(ringAreaM2(ring));
    }
    if (geometry.type === "MultiPolygon") {
      const coords = geometry.coordinates as number[][][][];
      const first = coords[0]?.[0] ?? [];
      if (!looksLikeWgs84(first)) return null;
      const sum = coords.reduce((acc, poly) => acc + ringAreaM2(poly[0] ?? []), 0);
      return Math.round(sum);
    }
  } catch {
    /* coordonnées inattendues */
  }
  return null;
}

function looksLikeWgs84(ring: number[][]): boolean {
  const c = ring[0];
  if (!c) return false;
  return Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90;
}

// ── Lecture unifiée (utilisable par n'importe quelle page) ───────────────────

export function readUnifiedSelection(studyId: string | null): UnifiedSelection | null {
  const feature = getStudyParcelFeature(studyId);
  if (!feature) return null;
  const { parcelId, communeInsee, surfaceM2 } = extractParcelInfo(feature);
  return {
    parcelIds: parcelId ? [parcelId] : [],
    primaryParcelId: parcelId,
    communeInsee,
    surfaceM2,
    address: readExistingAddress(),
  };
}

function readExistingAddress(): string | null {
  try {
    return userStorage.getItem(LS_SESSION_ADDRESS);
  } catch {
    return null;
  }
}

// ── Propagation vers les clés de handoff ─────────────────────────────────────

function writeJson(key: string, value: unknown): void {
  try {
    userStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / indispo */
  }
}
function writeStr(key: string, value: string | null): void {
  if (!value) return; // jamais écraser par du vide
  try {
    userStorage.setItem(key, value);
  } catch {
    /* indispo */
  }
}

function hasHandoff(): boolean {
  try {
    return !!userStorage.getItem(LS_SELECTED_PARCELS_V1);
  } catch {
    return false;
  }
}

/**
 * Reconstruit les clés de handoff à partir de la parcelle courante.
 *
 * @param studyId  identifiant d'étude (pour la clé parcelFeature scopée)
 * @param opts.force  true à la reprise d'un dossier (cette étude doit gagner).
 *                    false (défaut) n'écrit que si aucun handoff n'existe déjà,
 *                    pour ne jamais écraser une sélection Foncier toute fraîche.
 * @returns la sélection propagée, ou null si aucune parcelle exploitable.
 */
export function propagateSelectionFromStudy(
  studyId: string | null,
  opts?: { force?: boolean },
): UnifiedSelection | null {
  const force = opts?.force ?? false;

  if (!force && hasHandoff()) {
    // Un handoff existe déjà (probablement une sélection Foncier récente) → on respecte.
    return readUnifiedSelection(studyId);
  }

  const sel = readUnifiedSelection(studyId);
  if (!sel || !sel.primaryParcelId) return null;

  const updatedAt = new Date().toISOString();

  // 1) selected_parcels_v1 (clé lue par Implantation 2D / PLU / Bilan)
  writeJson(LS_SELECTED_PARCELS_V1, {
    parcel_ids: sel.parcelIds,
    primary_parcel_id: sel.primaryParcelId,
    commune_insee: sel.communeInsee,
    updated_at: updatedAt,
  });

  // 2) terrain_selection (surface, focus) — lue par Massing V2, Programmation…
  writeJson(LS_TERRAIN_SELECTION, {
    version: "v1",
    updated_at: updatedAt,
    commune_insee: sel.communeInsee ?? "",
    parcel_ids: sel.parcelIds,
    parcels: sel.parcelIds.map((id) => ({
      parcel_id: id,
      area_m2: sel.surfaceM2 ?? null,
    })),
    surface_totale_m2: sel.surfaceM2 ?? 0,
    focus_parcel_id: sel.primaryParcelId,
  });

  // 3) clés de session (lues par PluFaisabilite, usePromoteurParcelRestore…)
  writeStr(LS_SESSION_PARCEL_ID, sel.primaryParcelId);
  writeStr(LS_SESSION_COMMUNE_INSEE, sel.communeInsee);

  // Notifie les pages qui écoutent l'event `storage` (synchro live).
  try {
    window.dispatchEvent(new StorageEvent("storage", { key: LS_SELECTED_PARCELS_V1 }));
  } catch {
    /* environnement sans StorageEvent */
  }

  return sel;
}

// ─────────────────────────────────────────────────────────────────────────────
// PURGE — cycle de vie d'une étude
//
// `clearAllPromoteurSessionKeys()` n'efface QUE les clés globales et exclut
// volontairement les clés scopées par étude. À la SUPPRESSION d'un dossier, il
// faut donc purger explicitement ces clés scopées + vider le store Zustand,
// sinon Massing 3D (et les autres) continuent d'afficher la parcelle fantôme.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Collecte les parcelIds rattachés à une étude, pour pouvoir purger les caches
 * géométriques scopés PAR PARCELLE (`mimmoza:project:terrain:<parcelId>`,
 * `mimmoza:project:implantation:<parcelId>`), invisibles à un filtre par studyId.
 * Source : store projet courant (le plus fiable à la suppression de l'étude active).
 */
export function collectStudyParcelIds(studyId: string | null): string[] {
  const ids = new Set<string>();
  // Parcelle actuellement chargée en mémoire (étude active).
  try {
    const p = usePromoteurProjectStore.getState().parcel as AnyFeature | null;
    if (p) {
      const info = extractParcelInfo(p);
      if (info.parcelId) ids.add(info.parcelId);
    }
  } catch {
    /* store indisponible */
  }
  // Clé scopée parcelFeature de l'étude (si elle existe encore).
  if (studyId) {
    try {
      const raw = userStorage.getItem(`mimmoza.parcelFeature.${studyId}`);
      if (raw) {
        const feat = JSON.parse(raw) as AnyFeature;
        const info = extractParcelInfo(feat);
        if (info.parcelId) ids.add(info.parcelId);
      }
    } catch {
      /* parse échoué */
    }
  }
  return [...ids];
}

/**
 * Supprime les clés localStorage liées à une étude :
 *   • toute clé `mimmoza…` contenant le studyId (parcelFeature, editor2d.raw,
 *     parcelleLocal, captures…),
 *   • les caches géométriques `mimmoza:project:*` scopés par les parcelIds fournis
 *     (terrain / implantation), qui ne portent PAS le studyId.
 * @returns nombre de clés supprimées.
 */
export function purgeStudyScopedKeys(
  studyId: string | null,
  parcelIds: string[] = [],
): number {
  let removed = 0;
  const ids = parcelIds.filter(Boolean);
  try {
    for (const physicalKey of Object.keys(localStorage)) {
      // Ne considère que les clés de l'utilisateur courant ; `base` est la
      // clé logique sans le préfixe "u:{userId}:" (ou la clé nue si pas de scope).
      const base = baseKeyIfOwnedByCurrentUser(physicalKey);
      if (!base || !base.startsWith("mimmoza")) continue;

      const byStudy = studyId ? base.includes(studyId) : false;
      const byParcel =
        ids.length > 0 &&
        base.startsWith("mimmoza:project:") &&
        ids.some((id) => base.endsWith(id));

      if (byStudy || byParcel) {
        // Suppression via la clé PHYSIQUE réellement stockée.
        localStorage.removeItem(physicalKey);
        removed++;
      }
    }
  } catch {
    /* localStorage indisponible */
  }
  return removed;
}

/**
 * Vide le store projet Zustand (RAM) ET sa copie persistée.
 * Le store utilise le middleware `persist` (clé `mimmoza.promoteur.project.v2`),
 * il faut donc effacer la persistance, sinon il se réhydrate au reload.
 */
export function resetPromoteurProjectStore(): void {
  // 1) État en mémoire (les champs connus ; persist réécrit la copie disque).
  try {
    usePromoteurProjectStore.setState({
      projectId: null,
      parcel: null,
      buildings: [],
      parkings: [],
      implantation2d: null,
      lastUpdatedAt: null,
    } as never);
  } catch {
    /* store indisponible */
  }
  // 2) Copie persistée (API standard zustand/persist).
  try {
    (
      usePromoteurProjectStore as unknown as {
        persist?: { clearStorage?: () => void };
      }
    ).persist?.clearStorage?.();
  } catch {
    /* persist indisponible */
  }
}