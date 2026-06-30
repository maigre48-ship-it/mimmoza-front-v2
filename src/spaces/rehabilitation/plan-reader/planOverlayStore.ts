// src/spaces/rehabilitation/plan-reader/planOverlayStore.ts
// ---------------------------------------------------------------------------
// Étape 6 du pipeline : persistance localStorage d'un snapshot unique
// partagé entre AnalysePage et CreationPlanPage.
//
// Clé : "mimmoza.rehabilitation.planOverlay.v1"
// ---------------------------------------------------------------------------

import type { LayerVisibility, PlanCalibration, PlanGeometry, PlanMetadata, PlanOverlaySnapshot, PlanSourceImage, RawAIResult, ValidationResult } from './types';
import { DEFAULT_LAYER_VISIBILITY, EMPTY_GEOMETRY, emptyCalibration, emptyMetadata, emptyValidation, PLAN_OVERLAY_STORAGE_KEY } from './types';
import { userStorage } from "@/lib/storage/userScopedStorage";

// ---------------------------------------------------------------------------
// Helpers safe-storage (SSR / mode privé)
// ---------------------------------------------------------------------------

const isBrowser = typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const safeGetItem = (key: string): string | null => {
  if (!isBrowser) return null;
  try { return userStorage.getItem(key); }
  catch { return null; }
};

const safeSetItem = (key: string, value: string): boolean => {
  if (!isBrowser) return false;
  try { userStorage.setItem(key, value); return true; }
  catch { return false; }
};

const safeRemoveItem = (key: string): void => {
  if (!isBrowser) return;
  try { userStorage.removeItem(key); } catch { /* noop */ }
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createEmptySnapshot = (projectId: string | null = null): PlanOverlaySnapshot => {
  const now = new Date().toISOString();
  return {
    version: 1,
    projectId,
    createdAt: now,
    updatedAt: now,
    sourceImage: {
      dataUrl: null,
      filename: null,
      mimeType: null,
      widthPx: 0,
      heightPx: 0,
    },
    metadata: emptyMetadata(),
    calibration: emptyCalibration(),
    detectedGeometry: EMPTY_GEOMETRY,
    aiHypothesis: null,
    generatedPlan: null,
    validation: emptyValidation(),
    layerVisibility: { ...DEFAULT_LAYER_VISIBILITY },
  };
};

// ---------------------------------------------------------------------------
// Lecture / écriture
// ---------------------------------------------------------------------------

export const loadSnapshot = (): PlanOverlaySnapshot | null => {
  const raw = safeGetItem(PLAN_OVERLAY_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PlanOverlaySnapshot;
    if (parsed.version !== 1) {
      // Versions incompatibles : on purge silencieusement
      safeRemoveItem(PLAN_OVERLAY_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

export const saveSnapshot = (snapshot: PlanOverlaySnapshot): boolean => {
  const next: PlanOverlaySnapshot = {
    ...snapshot,
    updatedAt: new Date().toISOString(),
  };
  return safeSetItem(PLAN_OVERLAY_STORAGE_KEY, JSON.stringify(next));
};

export const clearSnapshot = (): void => safeRemoveItem(PLAN_OVERLAY_STORAGE_KEY);

// ---------------------------------------------------------------------------
// Updates ciblés (évite de recharger / réécrire tout côté appelant)
// ---------------------------------------------------------------------------

const withUpdate = (
  patch: (snap: PlanOverlaySnapshot) => PlanOverlaySnapshot,
): PlanOverlaySnapshot => {
  const current = loadSnapshot() ?? createEmptySnapshot();
  const next = patch(current);
  saveSnapshot(next);
  return next;
};

export const setSourceImage = (image: PlanSourceImage): PlanOverlaySnapshot =>
  withUpdate(s => ({ ...s, sourceImage: image }));

export const setMetadata = (metadata: PlanMetadata): PlanOverlaySnapshot =>
  withUpdate(s => ({ ...s, metadata }));

export const setCalibration = (calibration: PlanCalibration): PlanOverlaySnapshot =>
  withUpdate(s => ({ ...s, calibration }));

export const setDetectedGeometry = (geometry: PlanGeometry): PlanOverlaySnapshot =>
  withUpdate(s => ({ ...s, detectedGeometry: geometry }));

export const setAIHypothesis = (hypothesis: RawAIResult | null): PlanOverlaySnapshot =>
  withUpdate(s => ({ ...s, aiHypothesis: hypothesis }));

export const setGeneratedPlan = (plan: PlanGeometry | null): PlanOverlaySnapshot =>
  withUpdate(s => ({ ...s, generatedPlan: plan }));

export const setValidation = (validation: ValidationResult): PlanOverlaySnapshot =>
  withUpdate(s => ({ ...s, validation }));

export const setLayerVisibility = (visibility: LayerVisibility): PlanOverlaySnapshot =>
  withUpdate(s => ({ ...s, layerVisibility: visibility }));

export const toggleLayer = (layer: keyof LayerVisibility): PlanOverlaySnapshot =>
  withUpdate(s => ({
    ...s,
    layerVisibility: { ...s.layerVisibility, [layer]: !s.layerVisibility[layer] },
  }));

// ---------------------------------------------------------------------------
// Hook React minimaliste pour s'abonner aux changements (cross-tab + local)
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from 'react';

export const usePlanOverlaySnapshot = (): [
  PlanOverlaySnapshot | null,
  (patch: (snap: PlanOverlaySnapshot) => PlanOverlaySnapshot) => void,
  () => void,
] => {
  const [snapshot, setSnapshot] = useState<PlanOverlaySnapshot | null>(() => loadSnapshot());

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === PLAN_OVERLAY_STORAGE_KEY) setSnapshot(loadSnapshot());
    };
    const onCustom = () => setSnapshot(loadSnapshot());
    window.addEventListener('storage', onStorage);
    window.addEventListener('mimmoza:plan-overlay-updated', onCustom);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('mimmoza:plan-overlay-updated', onCustom);
    };
  }, []);

  const update = useCallback(
    (patch: (snap: PlanOverlaySnapshot) => PlanOverlaySnapshot) => {
      const current = loadSnapshot() ?? createEmptySnapshot();
      const next = patch(current);
      saveSnapshot(next);
      setSnapshot(next);
      window.dispatchEvent(new Event('mimmoza:plan-overlay-updated'));
    },
    [],
  );

  const reset = useCallback(() => {
    clearSnapshot();
    setSnapshot(null);
    window.dispatchEvent(new Event('mimmoza:plan-overlay-updated'));
  }, []);

  return [snapshot, update, reset];
};