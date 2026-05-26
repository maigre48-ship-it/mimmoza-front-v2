// src/spaces/promoteur/shared/hooks/usePromoteurParcelRestore.ts
//
// V1.5 — Fix fusion MultiPolygon sans déformer la géométrie
//   • Après un union direct qui produit un MultiPolygon (2 sous-polygones),
//     on applique des buffers progressifs en cm sur CES 2 sous-polygones
//     (pas sur les 4 features originales). Les 2 sous-polygones sont déjà
//     partiellement fusionnés → ils partagent une frontière quasi-identique
//     → 1 cm de buffer suffit à combler le micro-écart de précision cadastrale
//     sans déformer la forme de la parcelle de manière perceptible.
//   • Aucun hull convexe/concave → la forme exacte est préservée.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as turf from "@turf/turf";
import type { Feature, Polygon, MultiPolygon } from "geojson";

import { useFoncierSelection, type SelectedParcel } from "./useFoncierSelection";
import { normalizeToGeoJSONFeature } from "../getCurrentPromoteurParcelSelection";
import { getSnapshot } from "../promoteurSnapshot.store";

const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// ── Types ──────────────────────────────────────────────────────────────────────
export type ParcelRestoreStatus =
  | "idle"
  | "loading"
  | "ready"
  | "missing"
  | "empty"
  | "error";

export interface UsePromoteurParcelRestoreOptions {
  studyId?: string | null;
  autoFetchMissingGeometry?: boolean;
}

export interface UsePromoteurParcelRestoreResult {
  selectedParcels:   SelectedParcel[];
  focusParcelId:     string | null;
  communeInsee:      string | null;
  totalAreaM2:       number | null;
  parcelFeatures:    Feature<Polygon | MultiPolygon>[];
  combinedFeature:   Feature<Polygon | MultiPolygon> | null;
  leafletBounds:     [[number, number], [number, number]] | null;
  center:            [number, number] | null;
  status:            ParcelRestoreStatus;
  isSettled:         boolean;
  isLoading:         boolean;
  isHydrated:        boolean;
  error:             string | null;
  refetch:           () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// parseParcelIdSegments
// ─────────────────────────────────────────────────────────────────────────────
function parseParcelIdSegments(
  parcelId: string,
): { section: string; numero: string } | null {
  const clean = parcelId.replace(/[-\s]/g, "").toUpperCase();
  if (clean.length < 10) return null;
  const after = clean.slice(5);
  const m     = after.match(/(?:\d{0,3})([A-Z]{1,2})(\d{1,4})$/);
  if (!m) return null;
  return { section: m[1], numero: m[2].padStart(4, "0") };
}

// ─────────────────────────────────────────────────────────────────────────────
// fetchParcelFromSupabase
// ─────────────────────────────────────────────────────────────────────────────
async function fetchParcelFromSupabase(
  parcelId: string,
  communeInsee: string,
): Promise<Feature<Polygon | MultiPolygon> | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/cadastre-parcelle-by-id`, {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        apikey:         SUPABASE_ANON_KEY,
        Authorization:  `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body:   JSON.stringify({ parcel_id: parcelId, commune_insee: communeInsee }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.debug(`[fetchParcelFromSupabase] HTTP ${res.status} pour ${parcelId}`);
      return null;
    }
    const data = await res.json();
    const raw  = data?.feature ?? data?.features?.[0] ?? null;
    if (!raw?.geometry) {
      console.debug(`[fetchParcelFromSupabase] Pas de géométrie pour ${parcelId}`);
      return null;
    }
    return normalizeToGeoJSONFeature(raw, parcelId);
  } catch (e) {
    console.debug(`[fetchParcelFromSupabase] Erreur pour ${parcelId}:`, e);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// fetchParcelFromIGN
// ─────────────────────────────────────────────────────────────────────────────
async function fetchParcelFromIGN(
  parcelId: string,
  communeInsee: string,
): Promise<Feature<Polygon | MultiPolygon> | null> {
  const seg = parseParcelIdSegments(parcelId);
  if (!seg) {
    console.debug(`[fetchParcelFromIGN] Impossible de parser: ${parcelId}`);
    return null;
  }
  const url =
    `https://apicarto.ign.fr/api/cadastre/parcelle` +
    `?code_insee=${communeInsee}` +
    `&section=${seg.section}` +
    `&numero=${seg.numero}` +
    `&_limit=1`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) {
      console.debug(`[fetchParcelFromIGN] HTTP ${res.status} pour ${parcelId}`);
      return null;
    }
    const data = await res.json();
    const raw  = data?.features?.[0] ?? null;
    if (!raw) {
      console.debug(`[fetchParcelFromIGN] Aucune feature IGN pour ${parcelId}`);
      return null;
    }
    return normalizeToGeoJSONFeature(raw, parcelId);
  } catch (e) {
    console.debug(`[fetchParcelFromIGN] Erreur pour ${parcelId}:`, e);
    return null;
  }
}

// ── Geometry helpers ───────────────────────────────────────────────────────────

function computeLeafletBounds(
  features: Feature<Polygon | MultiPolygon>[],
): [[number, number], [number, number]] | null {
  if (!features.length) return null;
  try {
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    for (const f of features) {
      const [w, s, e, n] = turf.bbox(f);
      if (w < minLng) minLng = w; if (s < minLat) minLat = s;
      if (e > maxLng) maxLng = e; if (n > maxLat) maxLat = n;
    }
    return minLng === Infinity ? null : [[minLat, minLng], [maxLat, maxLng]];
  } catch { return null; }
}

/**
 * Buffer + union + unbuffer sur un ensemble de features.
 * Retourne un Polygon si la fusion réussit, null sinon.
 * Si l'unbuffer redonne un MultiPolygon (rare), on renvoie le polygon buffered
 * (légèrement élargi mais forme préservée).
 */
function tryBufferUnion(
  features: Feature<Polygon | MultiPolygon>[],
  bufferM: number,
): Feature<Polygon> | null {
  try {
    const buffered = features
      .map(f => turf.buffer(f, bufferM, { units: "meters" }))
      .filter((f): f is Feature<Polygon | MultiPolygon> => !!f);

    if (buffered.length !== features.length) return null;

    let merged: Feature<Polygon | MultiPolygon> = buffered[0];
    for (let i = 1; i < buffered.length; i++) {
      const u = turf.union(turf.featureCollection([merged, buffered[i]]));
      if (u) merged = u as Feature<Polygon | MultiPolygon>;
    }

    if (merged.geometry.type !== "Polygon") return null;

    const shrunk = turf.buffer(merged, -bufferM, { units: "meters" });
    if (shrunk?.geometry.type === "Polygon") return shrunk as Feature<Polygon>;

    // Unbuffer a produit un MultiPolygon → garder le buffered (shape correcte)
    return merged as Feature<Polygon>;
  } catch {
    return null;
  }
}

function computeCombined(
  features: Feature<Polygon | MultiPolygon>[],
): Feature<Polygon | MultiPolygon> | null {
  if (!features.length) return null;
  if (features.length === 1) return features[0];

  // ── Tentative 1 : union directe ─────────────────────────────────────────
  let combined: Feature<Polygon | MultiPolygon> | null = null;
  try {
    combined = features[0];
    for (let i = 1; i < features.length; i++) {
      const u = turf.union(turf.featureCollection([combined, features[i]]));
      if (u) combined = u as Feature<Polygon | MultiPolygon>;
    }
  } catch (e) {
    console.warn("[usePromoteurParcelRestore] union directe échouée:", e);
    combined = features[0];
  }

  if (combined?.geometry.type === "Polygon") return combined;

  // ── Tentative 2 : buffer 0.3 m sur les features originales ──────────────
  // Corrige les micro-écarts de précision < 30 cm entre bordures cadastrales.
  const result03 = tryBufferUnion(features, 0.3);
  if (result03) {
    console.debug(
      `[usePromoteurParcelRestore] Fusion via buffer 0.3 m (${features.length} parcelles → 1 polygon)`,
    );
    return result03;
  }

  // ── Tentative 3 : buffers microscopiques sur les sous-polygones ──────────
  //
  // Si l'union produit un MultiPolygon (ex: 4 parcelles → 2 sous-polygones),
  // les 2 sous-polygones sont DÉJÀ partiellement fusionnés et partagent une
  // frontière quasi-identique. Un buffer de 1 cm suffit à combler le micro-écart
  // restant sans déformer la géométrie de manière perceptible.
  //
  // On travaille sur les sous-polygones du résultat (pas sur les 4 features
  // originales) car ils sont beaucoup plus proches à relier.
  //
  // On n'utilise PAS de hull (convexe ou concave) : la forme exacte de la
  // parcelle doit être préservée.
  if (combined?.geometry.type === "MultiPolygon") {
    const subFeatures: Feature<Polygon>[] = (
      combined.geometry.coordinates as number[][][][]
    ).map(coords => turf.polygon(coords));

    for (const bufM of [0.01, 0.05, 0.1, 0.5, 1, 2]) {
      const result = tryBufferUnion(subFeatures, bufM);
      if (result) {
        console.debug(
          `[usePromoteurParcelRestore] Fusion sous-polygones via buffer ${bufM} m` +
          ` (${subFeatures.length} sous-polygones → 1 polygon)`,
        );
        return result;
      }
    }
  }

  // ── Dernier recours : MultiPolygon ──────────────────────────────────────
  // Les parcelles sont genuinement disjointes (aucun buffer ne les relie).
  // featureToPoint2D prendra le plus grand sous-polygone.
  console.warn(
    `[usePromoteurParcelRestore] Impossible de fusionner ${features.length} parcelles` +
    ` en un polygon unique — MultiPolygon conservé`,
  );
  return combined;
}

function computeCenter(
  features: Feature<Polygon | MultiPolygon>[],
): [number, number] | null {
  if (!features.length) return null;
  try {
    const c          = turf.center(turf.featureCollection(features));
    const [lng, lat] = c.geometry.coordinates;
    return [lat, lng];
  } catch { return null; }
}

function safeJSON<T>(key: string, fallback: T): T {
  try { const r = localStorage.getItem(key); return r ? (JSON.parse(r) as T) : fallback; }
  catch { return fallback; }
}

// ── Fallback helpers ───────────────────────────────────────────────────────────

interface FallbackSelection {
  parcels:  SelectedParcel[];
  focusId:  string | null;
  commune:  string | null;
  _source:  string;
}

function readFallbackFromSnapshot(): FallbackSelection | null {
  try {
    const snapshot = getSnapshot();
    const foncier  = snapshot.foncier as Record<string, unknown> | undefined;
    if (foncier) {
      const parcelIds = (foncier.parcelIds  as string[] | undefined) ?? [];
      const parcelId  = (foncier.parcelId   as string   | undefined) ?? null;
      const commune   = (foncier.communeInsee as string | undefined) ?? null;
      const ids = parcelIds.length > 0 ? parcelIds : (parcelId ? [parcelId] : []);
      if (ids.length > 0) return {
        parcels: ids.map(id => ({ id, area_m2: null })),
        focusId: parcelId ?? ids[0] ?? null,
        commune,
        _source: "snapshot.foncier",
      };
    }
    const implData = (snapshot.implantation2d as Record<string, unknown> | undefined)
      ?.data as Record<string, unknown> | undefined;
    if (implData && Array.isArray(implData.parcelIds) && (implData.parcelIds as string[]).length > 0) {
      const ids = implData.parcelIds as string[];
      return {
        parcels: ids.map(id => ({ id, area_m2: null })),
        focusId: (implData.primaryParcelId as string | undefined) ?? ids[0] ?? null,
        commune: (implData.communeInsee as string | undefined) ?? null,
        _source: "snapshot.implantation2d",
      };
    }
    const project = snapshot.project as Record<string, unknown> | undefined;
    if (project?.parcelId) {
      const id = String(project.parcelId);
      return {
        parcels: [{ id, area_m2: null }],
        focusId: id,
        commune: project.commune_insee ? String(project.commune_insee) : null,
        _source: "snapshot.project",
      };
    }
  } catch (e) { console.warn("[usePromoteurParcelRestore] snapshot read error:", e); }
  return null;
}

function readFallbackFromSession(): FallbackSelection | null {
  try {
    const parcelId  = localStorage.getItem("mimmoza.session.parcel_id");
    const parcelIds = safeJSON<string[]>("mimmoza.session.parcel_ids", []);
    const commune   = localStorage.getItem("mimmoza.session.commune_insee");
    const ids       = parcelIds.length > 0 ? parcelIds : (parcelId ? [parcelId] : []);
    if (!ids.length) return null;
    return {
      parcels: ids.map(id => ({ id, area_m2: null })),
      focusId: parcelId ?? ids[0] ?? null,
      commune,
      _source: "session.*",
    };
  } catch { return null; }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function usePromoteurParcelRestore({
  studyId,
  autoFetchMissingGeometry = true,
}: UsePromoteurParcelRestoreOptions = {}): UsePromoteurParcelRestoreResult {

  const {
    selectedParcels:  foncierParcels,
    focusParcelId:    foncierFocusId,
    communeInsee:     foncierCommune,
    totalAreaM2:      foncierTotalArea,
    isHydrated,
    enrichParcelFeatures,
    setSelectedParcels,
    setCommuneInsee:  setFoncierCommune,
    setFocusParcelId: setFoncierFocusId,
  } = useFoncierSelection({ studyId });

  const enrichRef = useRef(enrichParcelFeatures);
  useEffect(() => { enrichRef.current = enrichParcelFeatures; }, [enrichParcelFeatures]);

  const [status, setStatus]     = useState<ParcelRestoreStatus>("idle");
  const [error, setError]       = useState<string | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  const fetchedRef          = useRef(false);
  const fallbackInjectedRef = useRef(false);

  const communeInsee = useMemo<string | null>(() => {
    if (foncierCommune) return foncierCommune;
    try {
      const sn = getSnapshot();
      const f  = sn.foncier as Record<string, unknown> | undefined;
      if (f?.communeInsee) return String(f.communeInsee);
      const p  = sn.project as Record<string, unknown> | undefined;
      if (p?.commune_insee) return String(p.commune_insee);
    } catch { /* ignore */ }
    return localStorage.getItem("mimmoza.session.commune_insee") ?? null;
  }, [foncierCommune]);

  useEffect(() => {
    if (!isHydrated) return;
    if (foncierParcels.length > 0) return;
    if (fallbackInjectedRef.current) return;
    fallbackInjectedRef.current = true;

    const fallback = readFallbackFromSnapshot() ?? readFallbackFromSession();
    if (!fallback) {
      console.debug("[usePromoteurParcelRestore] Aucune sélection dans aucune source → empty");
      return;
    }
    console.debug(
      `[usePromoteurParcelRestore] Fallback injecté — source=${fallback._source},` +
      ` parcelles=${fallback.parcels.length}, commune=${fallback.commune}`,
    );
    setSelectedParcels(fallback.parcels);
    if (fallback.focusId) setFoncierFocusId(fallback.focusId);
    if (fallback.commune) setFoncierCommune(fallback.commune);
  }, [isHydrated, foncierParcels.length, setSelectedParcels, setFoncierFocusId, setFoncierCommune]);

  const selectedParcels = foncierParcels;
  const focusParcelId   = foncierFocusId;
  const totalAreaM2     = foncierTotalArea;

  const parcelFeatures = useMemo<Feature<Polygon | MultiPolygon>[]>(() =>
    selectedParcels
      .map(p => p.feature ? normalizeToGeoJSONFeature(p.feature, p.id) : null)
      .filter((f): f is Feature<Polygon | MultiPolygon> => f !== null),
    [selectedParcels],
  );

  const combinedFeature = useMemo(() => computeCombined(parcelFeatures), [parcelFeatures]);
  const leafletBounds   = useMemo(() => computeLeafletBounds(parcelFeatures), [parcelFeatures]);
  const center          = useMemo(() => computeCenter(parcelFeatures), [parcelFeatures]);

  const missingFeatureIds = useMemo(
    () => selectedParcels.filter(p => !p.feature).map(p => p.id),
    [selectedParcels],
  );

  const fetchMissingGeometries = useCallback(async (
    idsToFetch: string[],
    commune: string,
  ) => {
    console.debug(
      `[usePromoteurParcelRestore] fetchMissingGeometries ×${idsToFetch.length}` +
      ` — [${idsToFetch.join(", ")}], commune=${commune}`,
    );
    setStatus("loading");
    setError(null);

    try {
      const settled = await Promise.allSettled(
        idsToFetch.map(async (pid): Promise<{ id: string; feature: Feature<Polygon | MultiPolygon> } | null> => {
          const fromSupa = await fetchParcelFromSupabase(pid, commune);
          if (fromSupa) {
            console.debug(`[usePromoteurParcelRestore] ${pid} → ✓ Supabase`);
            return { id: pid, feature: fromSupa };
          }
          const fromIGN = await fetchParcelFromIGN(pid, commune);
          if (fromIGN) {
            console.debug(`[usePromoteurParcelRestore] ${pid} → ✓ IGN`);
            return { id: pid, feature: fromIGN };
          }
          console.warn(`[usePromoteurParcelRestore] ${pid} → ✗ introuvable (Supabase + IGN)`);
          return null;
        }),
      );

      const updates: { id: string; feature: Feature<Polygon | MultiPolygon> }[] = [];
      const notFound: string[] = [];

      settled.forEach((r, i) => {
        if (r.status === "fulfilled" && r.value) updates.push(r.value);
        else notFound.push(idsToFetch[i]);
      });

      console.debug(
        `[usePromoteurParcelRestore] Fetch terminé — ` +
        `${updates.length} trouvé(s)/${idsToFetch.length}, notFound=[${notFound.join(", ")}]`,
      );

      if (updates.length > 0) {
        enrichRef.current(updates);
        setStatus("ready");
      } else {
        setStatus("missing");
        setError(
          `Géométrie cadastrale introuvable pour : ${idsToFetch.join(", ")}.\n` +
          `Vérifiez la connexion réseau ou retournez dans Foncier pour revalider.`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur inattendue";
      console.error("[usePromoteurParcelRestore] fetch crash:", err);
      setError(msg);
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    if (!isHydrated) return;

    if (selectedParcels.length === 0) { setStatus("empty"); return; }

    if (missingFeatureIds.length === 0) {
      console.debug(
        `[usePromoteurParcelRestore] Toutes features présentes` +
        ` (${parcelFeatures.length}/${selectedParcels.length}) → ready`,
      );
      setStatus("ready");
      return;
    }

    if (fetchedRef.current) {
      const s = parcelFeatures.length > 0 ? "ready" : "missing";
      console.debug(`[usePromoteurParcelRestore] Déjà fetché → ${s}`);
      setStatus(s);
      return;
    }

    if (autoFetchMissingGeometry && communeInsee) {
      fetchedRef.current = true;
      fetchMissingGeometries(missingFeatureIds, communeInsee);
    } else {
      const s = parcelFeatures.length > 0 ? "ready" : "missing";
      console.debug(`[usePromoteurParcelRestore] Pas de fetch → ${s}`);
      setStatus(s);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHydrated, selectedParcels.length, missingFeatureIds.length, communeInsee, fetchKey]);

  useEffect(() => {
    if (status === "idle" || status === "loading") return;
    console.debug(
      `[usePromoteurParcelRestore] ▶ SETTLED status=${status}` +
      ` | parcelles=${selectedParcels.length} features=${parcelFeatures.length}` +
      ` | hasCombined=${!!combinedFeature} | commune=${communeInsee}` +
      ` | error=${error ?? "—"}`,
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const refetch = useCallback(() => {
    fetchedRef.current          = false;
    fallbackInjectedRef.current = false;
    setStatus("idle");
    setError(null);
    setFetchKey(k => k + 1);
  }, []);

  return {
    selectedParcels, focusParcelId, communeInsee, totalAreaM2,
    parcelFeatures, combinedFeature, leafletBounds, center,
    status, isSettled: status !== "idle" && status !== "loading",
    isLoading: status === "loading",
    isHydrated, error, refetch,
  };
}