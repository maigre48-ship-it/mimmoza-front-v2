// src/spaces/promoteur/shared/hooks/useFoncierSelection.ts
import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Hook partagé de sélection foncier
 * Utilisé par Foncier.tsx et Implantation2DPage.tsx
 * Version SAFE : persistance locale + API minimale attendue
 */

type ParcelLike = {
  id: string;
  commune_insee?: string | null;
  [k: string]: any;
};

type UseFoncierSelectionOptions = {
  fallbackParcelId?: string;
};

const LS_SELECTED = "mimmoza.promoteur.foncier.selected_v1";
const LS_ACTIVE = "mimmoza.promoteur.foncier.active_v1";

/**
 * Extrait un code INSEE (5 chiffres) depuis un id ou une string quelconque
 */
export function extractCommuneInsee(payload: any): string | null {
  const s = String(payload ?? "").trim();
  const m = s.match(/(\d{5})/);
  return m?.[1] ?? null;
}

/**
 * Hook principal
 */
export function useFoncierSelection(options: UseFoncierSelectionOptions = {}) {
  const [selectedParcels, setSelectedParcelsState] = useState<ParcelLike[]>([]);
  const [activeParcelId, setActiveParcelIdState] = useState<string | null>(null);

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
      const act = localStorage.getItem(LS_ACTIVE);
      if (act) setActiveParcelIdState(act);
    } catch {
      // ignore
    }
  }, []);

  // -----------------------------
  // Fallback parcel id
  // -----------------------------
  useEffect(() => {
    if (!activeParcelId && options.fallbackParcelId) {
      setActiveParcelIdState(options.fallbackParcelId);
    }
  }, [options.fallbackParcelId, activeParcelId]);

  // -----------------------------
  // Persistance localStorage
  // -----------------------------
  useEffect(() => {
    try {
      localStorage.setItem(LS_SELECTED, JSON.stringify(selectedParcels));
    } catch {
      // ignore
    }
  }, [selectedParcels]);

  useEffect(() => {
    try {
      if (activeParcelId) localStorage.setItem(LS_ACTIVE, activeParcelId);
      else localStorage.removeItem(LS_ACTIVE);
    } catch {
      // ignore
    }
  }, [activeParcelId]);

  // -----------------------------
  // Actions
  // -----------------------------
  const setSelectedParcels = useCallback(
    (parcels: ParcelLike[]) => {
      const safe = Array.isArray(parcels) ? parcels : [];
      setSelectedParcelsState(safe);

      if (!activeParcelId && safe[0]?.id) {
        setActiveParcelIdState(safe[0].id);
      }
    },
    [activeParcelId]
  );

  const clearSelection = useCallback(() => {
    setSelectedParcelsState([]);
    setActiveParcelIdState(null);
  }, []);

  const setActiveParcelId = useCallback((id: string | null) => {
    setActiveParcelIdState(id);
  }, []);

  // -----------------------------
  // Derived state
  // -----------------------------
  const activeParcel = useMemo(
    () => selectedParcels.find((p) => p.id === activeParcelId) ?? null,
    [selectedParcels, activeParcelId]
  );

  const communeInsee = useMemo(() => {
    return (
      extractCommuneInsee(activeParcel?.commune_insee) ||
      extractCommuneInsee(activeParcel?.id) ||
      extractCommuneInsee(activeParcelId) ||
      null
    );
  }, [activeParcel, activeParcelId]);

  // -----------------------------
  // API exposée
  // -----------------------------
  return {
    selectedParcels,
    setSelectedParcels,
    clearSelection,

    activeParcelId,
    setActiveParcelId,
    activeParcel,

    communeInsee,
  };
}
