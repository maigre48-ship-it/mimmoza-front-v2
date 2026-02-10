// src/spaces/promoteur/shared/hooks/useFoncierSelection.ts
import { useCallback, useEffect, useMemo, useState, useRef } from "react";

/**
 * Hook partagé de sélection foncier
 * Utilisé par Foncier.tsx et Implantation2DPage.tsx
 * Version complète avec tous les exports attendus
 */

export type SelectedParcel = {
  id: string;
  feature?: any;
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
const LS_FOCUS = "mimmoza.promoteur.foncier.focus_v1";
const LS_COMMUNE = "mimmoza.promoteur.foncier.commune_v1";

/**
 * Extrait un code INSEE (5 chiffres) depuis un id ou une string quelconque
 */
export function extractCommuneInsee(payload: any): string | null {
  const s = String(payload ?? "").trim();
  const m = s.match(/^(\d{5})/);
  return m?.[1] ?? null;
}

/**
 * Hook principal
 */
export function useFoncierSelection(options: UseFoncierSelectionOptions = {}) {
  const { autoPersist = true, debounceMs = 300 } = options;

  const [selectedParcels, setSelectedParcelsState] = useState<SelectedParcel[]>([]);
  const [focusParcelId, setFocusParcelIdState] = useState<string | null>(null);
  const [communeInsee, setCommuneInseeState] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // -----------------------------
  // Hydratation depuis localStorage
  // -----------------------------
  useEffect(() => {
    try {
      const sel = JSON.parse(localStorage.getItem(LS_SELECTED) || "[]");
      if (Array.isArray(sel)) setSelectedParcelsState(sel);
    } catch {
      // ignore
    }

    try {
      const focus = localStorage.getItem(LS_FOCUS);
      if (focus) setFocusParcelIdState(focus);
    } catch {
      // ignore
    }

    try {
      const commune = localStorage.getItem(LS_COMMUNE);
      if (commune) setCommuneInseeState(commune);
    } catch {
      // ignore
    }

    setIsHydrated(true);
  }, []);

  // -----------------------------
  // Fallback parcel id
  // -----------------------------
  useEffect(() => {
    if (!focusParcelId && options.fallbackParcelId) {
      setFocusParcelIdState(options.fallbackParcelId);
    }
  }, [options.fallbackParcelId, focusParcelId]);

  // -----------------------------
  // Persistance localStorage (debounced)
  // -----------------------------
  useEffect(() => {
    if (!autoPersist || !isHydrated) return;

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      try {
        localStorage.setItem(LS_SELECTED, JSON.stringify(selectedParcels));
      } catch {
        // ignore
      }
    }, debounceMs);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [selectedParcels, autoPersist, isHydrated, debounceMs]);

  useEffect(() => {
    if (!isHydrated) return;
    try {
      if (focusParcelId) localStorage.setItem(LS_FOCUS, focusParcelId);
      else localStorage.removeItem(LS_FOCUS);
    } catch {
      // ignore
    }
  }, [focusParcelId, isHydrated]);

  useEffect(() => {
    if (!isHydrated) return;
    try {
      if (communeInsee) localStorage.setItem(LS_COMMUNE, communeInsee);
      else localStorage.removeItem(LS_COMMUNE);
    } catch {
      // ignore
    }
  }, [communeInsee, isHydrated]);

  // -----------------------------
  // Computed: total area
  // -----------------------------
  const totalAreaM2 = useMemo(() => {
    const areas = selectedParcels
      .map((p) => p.area_m2)
      .filter((a): a is number => typeof a === "number" && !isNaN(a));
    if (areas.length === 0) return null;
    return areas.reduce((sum, a) => sum + a, 0);
  }, [selectedParcels]);

  // -----------------------------
  // Actions
  // -----------------------------
  const setSelectedParcels = useCallback(
    (parcelsOrUpdater: SelectedParcel[] | ((prev: SelectedParcel[]) => SelectedParcel[])) => {
      if (typeof parcelsOrUpdater === "function") {
        setSelectedParcelsState(parcelsOrUpdater);
      } else {
        const safe = Array.isArray(parcelsOrUpdater) ? parcelsOrUpdater : [];
        setSelectedParcelsState(safe);

        if (!focusParcelId && safe[0]?.id) {
          setFocusParcelIdState(safe[0].id);
        }
      }
    },
    [focusParcelId]
  );

  const setFocusParcelId = useCallback((id: string | null) => {
    setFocusParcelIdState(id);
  }, []);

  const setCommuneInsee = useCallback((insee: string | null) => {
    setCommuneInseeState(insee);
  }, []);

  const toggleParcel = useCallback(
    (parcelId: string, feature?: any, area_m2?: number | null) => {
      setSelectedParcelsState((prev) => {
        const exists = prev.some((p) => p.id === parcelId);
        if (exists) {
          // Remove
          const filtered = prev.filter((p) => p.id !== parcelId);
          // Update focus if needed
          if (focusParcelId === parcelId) {
            setFocusParcelIdState(filtered[0]?.id ?? null);
          }
          return filtered;
        } else {
          // Add
          const newParcel: SelectedParcel = { id: parcelId, feature, area_m2 };
          // Extract commune from parcel id
          const insee = extractCommuneInsee(parcelId);
          if (insee && !communeInsee) {
            setCommuneInseeState(insee);
          }
          return [...prev, newParcel];
        }
      });
    },
    [focusParcelId, communeInsee]
  );

  const clearSelection = useCallback(() => {
    setSelectedParcelsState([]);
    setFocusParcelIdState(null);
  }, []);

  const enrichParcels = useCallback(
    (updates: { id: string; area_m2: number | null }[]) => {
      setSelectedParcelsState((prev) => {
        return prev.map((p) => {
          const update = updates.find((u) => u.id === p.id);
          if (update && p.area_m2 == null) {
            return { ...p, area_m2: update.area_m2 };
          }
          return p;
        });
      });
    },
    []
  );

  const persistNow = useCallback(() => {
    try {
      localStorage.setItem(LS_SELECTED, JSON.stringify(selectedParcels));
      if (focusParcelId) localStorage.setItem(LS_FOCUS, focusParcelId);
      if (communeInsee) localStorage.setItem(LS_COMMUNE, communeInsee);
      return true;
    } catch {
      return false;
    }
  }, [selectedParcels, focusParcelId, communeInsee]);

  // -----------------------------
  // Aliases for backward compatibility
  // -----------------------------
  const activeParcelId = focusParcelId;
  const setActiveParcelId = setFocusParcelId;
  const activeParcel = useMemo(
    () => selectedParcels.find((p) => p.id === focusParcelId) ?? null,
    [selectedParcels, focusParcelId]
  );

  // -----------------------------
  // API exposée
  // -----------------------------
  return {
    // Core state
    selectedParcels,
    setSelectedParcels,
    clearSelection,

    // Focus parcel (new naming)
    focusParcelId,
    setFocusParcelId,

    // Backward compatibility (old naming)
    activeParcelId,
    setActiveParcelId,
    activeParcel,

    // Commune
    communeInsee,
    setCommuneInsee,

    // Computed
    totalAreaM2,

    // Actions
    toggleParcel,
    enrichParcels,
    persistNow,

    // Hydration status
    isHydrated,
  };
}