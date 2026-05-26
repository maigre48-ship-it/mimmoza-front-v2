// ─────────────────────────────────────────────────────────────────────────────
// usePlanTranscription.ts
// Hook React pour orchestrer la transcription vectorielle d'un plan
// Connecte service Supabase → store localStorage → état React
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react';
import { transcribePlanReal, generatePlanId } from '../services/transcribePlanReal';
import type {
  PlanTranscriptionEntry,
  PlanTranscriptionResult,
  TranscriptionError,
  TranscriptionOptions,
} from '../plan-reader/planTranscription.types';
import {
  subscribeToTranscriptionStore,
  getTranscriptionStoreState,
  getActivePlanEntry,
  getPlanEntry,
  getAllPlanEntries,
  getCompletedTranscriptions,
  initPlanEntry,
  setPlanUploading,
  setPlanProcessing,
  setPlanCompleted,
  setPlanError,
  setActivePlan,
  resetPlanEntry,
  removePlanEntry,
} from '../plan-reader/planTranscriptionStore';
import type { PlanTranscriptionStoreState } from '../plan-reader/planTranscriptionStore';

// ── Types exposés par le hook ─────────────────────────────────────────────────

export interface UsePlanTranscriptionReturn {
  // État courant
  readonly activeEntry: PlanTranscriptionEntry | null;
  readonly allEntries: ReadonlyArray<PlanTranscriptionEntry>;
  readonly completedTranscriptions: ReadonlyArray<PlanTranscriptionEntry>;
  readonly isProcessing: boolean;
  readonly lastError: TranscriptionError | null;

  // Actions
  readonly transcribe: (file: File, options?: Partial<TranscriptionOptions>) => Promise<void>;
  readonly selectPlan: (planId: string | null) => void;
  readonly retryTranscription: (planId: string, file: File, options?: Partial<TranscriptionOptions>) => Promise<void>;
  readonly removePlan: (planId: string) => void;
  readonly getEntryById: (planId: string) => PlanTranscriptionEntry | null;
}

// ── Sélecteur d'état dérivé (évite les re-renders inutiles) ──────────────────

interface DerivedState {
  readonly activeEntry: PlanTranscriptionEntry | null;
  readonly allEntries: ReadonlyArray<PlanTranscriptionEntry>;
  readonly completedTranscriptions: ReadonlyArray<PlanTranscriptionEntry>;
}

function deriveState(_store: PlanTranscriptionStoreState): DerivedState {
  return {
    activeEntry: getActivePlanEntry(),
    allEntries: getAllPlanEntries(),
    completedTranscriptions: getCompletedTranscriptions(),
  };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Hook principal de transcription de plan.
 *
 * Usage :
 * ```tsx
 * const { transcribe, activeEntry, isProcessing, lastError } = usePlanTranscription();
 *
 * // Dans un handler :
 * await transcribe(file, { detect_walls: true });
 * ```
 */
export function usePlanTranscription(): UsePlanTranscriptionReturn {
  // ── État React synchronisé avec le store ────────────────────────────────────
  const [derived, setDerived] = useState<DerivedState>(() =>
    deriveState(getTranscriptionStoreState())
  );

  useEffect(() => {
    // Sync initial (cas où le store a changé entre mount et effect)
    setDerived(deriveState(getTranscriptionStoreState()));

    // Abonnement aux mutations du store
    const unsubscribe = subscribeToTranscriptionStore((newState) => {
      setDerived(deriveState(newState));
    });

    return unsubscribe;
  }, []);

  // ── isProcessing : dérivé de l'entrée active ─────────────────────────────
  const isProcessing =
    derived.activeEntry?.status === 'uploading' ||
    derived.activeEntry?.status === 'processing';

  // ── lastError : erreur de l'entrée active ────────────────────────────────
  const lastError: TranscriptionError | null =
    derived.activeEntry?.error ?? null;

  // ── Action : lancer une transcription ────────────────────────────────────

  const transcribe = useCallback(
    async (file: File, options?: Partial<TranscriptionOptions>): Promise<void> => {
      const planId = generatePlanId(file.name);

      // 1. Créer l'entrée et passer en upload
      initPlanEntry(planId, file.name);
      setPlanUploading(planId);

      // 2. Appel service (base64 + Edge Function)
      //    On passe directement en "processing" une fois le fichier prêt
      //    (la conversion base64 + l'appel réseau sont couverts dans le service)
      setPlanProcessing(planId);

      const result = await transcribePlanReal(planId, file, options);

      // 3. Mise à jour du store selon le résultat
      if (result.success) {
        setPlanCompleted(planId, result.data);
      } else {
        setPlanError(planId, result.error);
      }
    },
    []
  );

  // ── Action : re-transcrire un plan existant ───────────────────────────────

  const retryTranscription = useCallback(
    async (
      planId: string,
      file: File,
      options?: Partial<TranscriptionOptions>
    ): Promise<void> => {
      resetPlanEntry(planId);
      setActivePlan(planId);
      setPlanUploading(planId);
      setPlanProcessing(planId);

      const result = await transcribePlanReal(planId, file, options);

      if (result.success) {
        setPlanCompleted(planId, result.data);
      } else {
        setPlanError(planId, result.error);
      }
    },
    []
  );

  // ── Action : sélectionner le plan actif ──────────────────────────────────

  const selectPlan = useCallback((planId: string | null): void => {
    setActivePlan(planId);
  }, []);

  // ── Action : supprimer un plan ────────────────────────────────────────────

  const removePlan = useCallback((planId: string): void => {
    removePlanEntry(planId);
  }, []);

  // ── Sélecteur ponctuel ────────────────────────────────────────────────────

  const getEntryById = useCallback(
    (planId: string): PlanTranscriptionEntry | null => getPlanEntry(planId),
    []
  );

  return {
    activeEntry: derived.activeEntry,
    allEntries: derived.allEntries,
    completedTranscriptions: derived.completedTranscriptions,
    isProcessing,
    lastError,
    transcribe,
    selectPlan,
    retryTranscription,
    removePlan,
    getEntryById,
  };
}

// ── Hook spécialisé : observer un plan précis ─────────────────────────────────

/**
 * Observe l'entrée d'un plan spécifique.
 * Utile pour les composants de détail qui connaissent déjà le planId.
 */
export function usePlanEntry(planId: string): PlanTranscriptionEntry | null {
  const [entry, setEntry] = useState<PlanTranscriptionEntry | null>(
    () => getPlanEntry(planId)
  );

  useEffect(() => {
    setEntry(getPlanEntry(planId));

    const unsubscribe = subscribeToTranscriptionStore(() => {
      setEntry(getPlanEntry(planId));
    });

    return unsubscribe;
  }, [planId]);

  return entry;
}

// ── Hook spécialisé : résultat complet d'un plan ─────────────────────────────

/**
 * Retourne uniquement le résultat de transcription d'un plan complété,
 * ou null si le plan n'est pas encore traité.
 */
export function usePlanResult(planId: string): PlanTranscriptionResult | null {
  const entry = usePlanEntry(planId);
  if (entry?.status !== 'completed') return null;
  return entry.result;
}