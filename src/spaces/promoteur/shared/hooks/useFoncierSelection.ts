// src/spaces/promoteur/shared/hooks/useFoncierSelection.ts
// V2.1 — Fix régression boucle infinie Implantation2DPage
//
// CORRECTION CRITIQUE dans enrichParcelFeatures() :
//   prev.map() retourne toujours un nouveau tableau, même si aucun item n'a changé.
//   Sans bail-out, React setState déclenche un re-render → parcelIds useMemo recalcule
//   (nouveau tableau de même valeurs) → useEffect cadastre re-s'exécute → boucle infinie.
//   Fix : comparer changed flag et retourner `prev` (même référence) si rien n'a changé.
//   Idem pour enrichParcels() par cohérence.

import { useCallback, useEffect, useMemo, useState, useRef } from "react";

export type SelectedParcel = {
  id: string;
  feature?: any; // GeoJSON Feature<Polygon|MultiPolygon>
  area_m2?: number | null;
  commune_insee?: string | null;
  [k: string]: any;
};

type UseFoncierSelectionOptions = {
  studyId?: string | null;
  address?: string;
  fallbackParcelId?: string;
  autoPersist?: boolean;
  debounceMs?: number;
};

const LS_SELECTED = "mimmoza.promoteur.foncier.selected_v1";
const LS_FOCUS    = "mimmoza.promoteur.foncier.focus_v1";
const LS_COMMUNE  = "mimmoza.promoteur.foncier.commune_v1";

export function extractCommuneInsee(payload: any): string | null {
  const s = String(payload ?? "").trim();
  const m = s.match(/^(\d{5})/);
  return m?.[1] ?? null;
}

export function useFoncierSelection(options: UseFoncierSelectionOptions = {}) {
  const { autoPersist = true, debounceMs = 300 } = options;

  const [selectedParcels, setSelectedParcelsState] = useState<SelectedParcel[]>([]);
  const [focusParcelId, setFocusParcelIdState]     = useState<string | null>(null);
  const [communeInsee, setCommuneInseeState]       = useState<string | null>(null);
  const [isHydrated, setIsHydrated]               = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Hydratation ───────────────────────────────────────────────────────────
  useEffect(() => {
    try {
      const sel = JSON.parse(localStorage.getItem(LS_SELECTED) || "[]");
      if (Array.isArray(sel)) setSelectedParcelsState(sel);
    } catch { /* ignore */ }
    try {
      const focus = localStorage.getItem(LS_FOCUS);
      if (focus) setFocusParcelIdState(focus);
    } catch { /* ignore */ }
    try {
      const commune = localStorage.getItem(LS_COMMUNE);
      if (commune) setCommuneInseeState(commune);
    } catch { /* ignore */ }
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (!focusParcelId && options.fallbackParcelId) setFocusParcelIdState(options.fallbackParcelId);
  }, [options.fallbackParcelId, focusParcelId]);

  // ── Persistance (debounced) ───────────────────────────────────────────────
  useEffect(() => {
    if (!autoPersist || !isHydrated) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      try { localStorage.setItem(LS_SELECTED, JSON.stringify(selectedParcels)); } catch { /* ignore */ }
    }, debounceMs);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [selectedParcels, autoPersist, isHydrated, debounceMs]);

  useEffect(() => {
    if (!isHydrated) return;
    try {
      if (focusParcelId) localStorage.setItem(LS_FOCUS, focusParcelId);
      else localStorage.removeItem(LS_FOCUS);
    } catch { /* ignore */ }
  }, [focusParcelId, isHydrated]);

  useEffect(() => {
    if (!isHydrated) return;
    try {
      if (communeInsee) localStorage.setItem(LS_COMMUNE, communeInsee);
      else localStorage.removeItem(LS_COMMUNE);
    } catch { /* ignore */ }
  }, [communeInsee, isHydrated]);

  // ── Computed ──────────────────────────────────────────────────────────────
  const totalAreaM2 = useMemo(() => {
    const areas = selectedParcels
      .map((p) => p.area_m2)
      .filter((a): a is number => typeof a === "number" && !isNaN(a));
    return areas.length > 0 ? areas.reduce((s, a) => s + a, 0) : null;
  }, [selectedParcels]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const setSelectedParcels = useCallback(
    (parcelsOrUpdater: SelectedParcel[] | ((prev: SelectedParcel[]) => SelectedParcel[])) => {
      if (typeof parcelsOrUpdater === "function") {
        setSelectedParcelsState(parcelsOrUpdater);
      } else {
        const safe = Array.isArray(parcelsOrUpdater) ? parcelsOrUpdater : [];
        setSelectedParcelsState(safe);
        if (!focusParcelId && safe[0]?.id) setFocusParcelIdState(safe[0].id);
      }
    },
    [focusParcelId]
  );

  const setFocusParcelId = useCallback((id: string | null) => setFocusParcelIdState(id), []);
  const setCommuneInsee  = useCallback((insee: string | null) => setCommuneInseeState(insee), []);

  const toggleParcel = useCallback(
    (parcelId: string, feature?: any, area_m2?: number | null) => {
      setSelectedParcelsState((prev) => {
        const exists = prev.some((p) => p.id === parcelId);
        if (exists) {
          const filtered = prev.filter((p) => p.id !== parcelId);
          if (focusParcelId === parcelId) setFocusParcelIdState(filtered[0]?.id ?? null);
          return filtered;
        }
        const insee = extractCommuneInsee(parcelId);
        if (insee && !communeInsee) setCommuneInseeState(insee);
        return [...prev, { id: parcelId, feature, area_m2 }];
      });
    },
    [focusParcelId, communeInsee]
  );

  const clearSelection = useCallback(() => {
    setSelectedParcelsState([]);
    setFocusParcelIdState(null);
  }, []);

  /**
   * Enrichit les parcelles avec leur surface (area_m2).
   * ✅ V2.1: bail-out si rien n'a changé → évite re-render inutile
   */
  const enrichParcels = useCallback(
    (updates: { id: string; area_m2: number | null }[]) => {
      setSelectedParcelsState((prev) => {
        let changed = false;
        const next = prev.map((p) => {
          const update = updates.find((u) => u.id === p.id);
          if (update && p.area_m2 == null) { changed = true; return { ...p, area_m2: update.area_m2 }; }
          return p;
        });
        return changed ? next : prev; // ✅ même référence si pas de changement
      });
    },
    []
  );

  /**
   * Enrichit les parcelles avec leur Feature GeoJSON (après chargement cadastre).
   *
   * ✅ V2.1 CORRECTION CRITIQUE — bail-out si rien n'a changé.
   *
   * Sans ce bail-out, la séquence suivante causait une boucle infinie dans Implantation2DPage :
   *   enrichParcelFeatures() → prev.map() → nouveau tableau (même contenu)
   *   → setSelectedParcelsState → re-render → foncierSelectedParcels change de référence
   *   → selectedParcels useMemo recalcule → parcelIds useMemo recalcule (nouveau tableau)
   *   → useEffect cadastre se ré-exécute → setIsLoadingGeometry(true) → boucle infinie
   *
   * Fix : si `changed === false`, retourner `prev` (même référence objet).
   * React compare setState par référence → identique → bail-out → pas de re-render.
   */
  const enrichParcelFeatures = useCallback(
    (updates: { id: string; feature: any }[]) => {
      setSelectedParcelsState((prev) => {
        let changed = false;
        const next = prev.map((p) => {
          const update = updates.find((u) => u.id === p.id);
          if (update?.feature && !p.feature) {
            changed = true;
            return { ...p, feature: update.feature };
          }
          return p; // ← même référence d'objet item
        });
        return changed ? next : prev; // ✅ même référence tableau si pas de changement
      });
    },
    []
  );

  const persistNow = useCallback(() => {
    try {
      localStorage.setItem(LS_SELECTED, JSON.stringify(selectedParcels));
      if (focusParcelId) localStorage.setItem(LS_FOCUS, focusParcelId);
      if (communeInsee)  localStorage.setItem(LS_COMMUNE, communeInsee);
      return true;
    } catch { return false; }
  }, [selectedParcels, focusParcelId, communeInsee]);

  // ── Backward-compat aliases ───────────────────────────────────────────────
  const activeParcelId    = focusParcelId;
  const setActiveParcelId = setFocusParcelId;
  const activeParcel      = useMemo(
    () => selectedParcels.find((p) => p.id === focusParcelId) ?? null,
    [selectedParcels, focusParcelId]
  );

  return {
    selectedParcels, setSelectedParcels, clearSelection,
    focusParcelId,   setFocusParcelId,
    activeParcelId,  setActiveParcelId,  activeParcel,
    communeInsee,    setCommuneInsee,
    totalAreaM2,
    toggleParcel, enrichParcels, enrichParcelFeatures,
    persistNow, isHydrated,
  };
}