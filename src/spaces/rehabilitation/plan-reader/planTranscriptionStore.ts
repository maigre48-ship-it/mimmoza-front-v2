// ─────────────────────────────────────────────────────────────────────────────
// planTranscriptionStore.ts
// Store de persistance localStorage pour les transcriptions de plans
// Pattern Mimmoza : getters/setters purs + event-driven React sync
// ─────────────────────────────────────────────────────────────────────────────

import type {
  PlanTranscriptionEntry,
  PlanTranscriptionResult,
  TranscriptionError,
  TranscriptionStatus,
} from './planTranscription.types';

// ── Clé de stockage ───────────────────────────────────────────────────────────

const STORAGE_KEY = 'mimmoza_rehab_transcriptions_v1' as const;

// ── Types internes du store ───────────────────────────────────────────────────

export interface PlanTranscriptionStoreState {
  entries: Record<string, PlanTranscriptionEntry>;
  active_plan_id: string | null;
  last_updated: string; // ISO 8601
}

// ── État initial ──────────────────────────────────────────────────────────────

function createInitialState(): PlanTranscriptionStoreState {
  return {
    entries: {},
    active_plan_id: null,
    last_updated: new Date().toISOString(),
  };
}

// ── Sérialisation / Désérialisation ──────────────────────────────────────────

function loadState(): PlanTranscriptionStoreState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialState();
    const parsed = JSON.parse(raw) as Partial<PlanTranscriptionStoreState>;
    return {
      entries: parsed.entries ?? {},
      active_plan_id: parsed.active_plan_id ?? null,
      last_updated: parsed.last_updated ?? new Date().toISOString(),
    };
  } catch {
    return createInitialState();
  }
}

function saveState(state: PlanTranscriptionStoreState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage peut être indisponible (mode privé strict, quota dépassé)
    console.warn('[planTranscriptionStore] Impossible de persister l\'état.');
  }
}

// ── Event bus interne pour React (sans Zustand) ───────────────────────────────
// Permet à usePlanTranscription d'écouter les changements du store.

type StoreListener = (state: PlanTranscriptionStoreState) => void;

const listeners = new Set<StoreListener>();

function notify(state: PlanTranscriptionStoreState): void {
  listeners.forEach((fn) => fn(state));
}

// ── État courant en mémoire (singleton) ───────────────────────────────────────

let currentState: PlanTranscriptionStoreState = loadState();

// ── API publique du store ─────────────────────────────────────────────────────

/**
 * S'abonner aux changements du store.
 * Retourne une fonction de désabonnement.
 */
export function subscribeToTranscriptionStore(listener: StoreListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Lire l'état courant (snapshot immutable).
 */
export function getTranscriptionStoreState(): Readonly<PlanTranscriptionStoreState> {
  return currentState;
}

// ── Mutations ─────────────────────────────────────────────────────────────────

function mutate(updater: (draft: PlanTranscriptionStoreState) => PlanTranscriptionStoreState): void {
  currentState = updater(currentState);
  currentState = { ...currentState, last_updated: new Date().toISOString() };
  saveState(currentState);
  notify(currentState);
}

/**
 * Enregistre un nouveau plan et initialise son entrée à l'état 'idle'.
 */
export function initPlanEntry(planId: string, fileName: string): void {
  mutate((state) => ({
    ...state,
    entries: {
      ...state.entries,
      [planId]: {
        plan_id: planId,
        status: 'idle' as TranscriptionStatus,
        result: null,
        error: null,
        started_at: null,
        completed_at: null,
      },
    },
    active_plan_id: planId,
  }));
}

/**
 * Passe un plan en cours d'upload.
 */
export function setPlanUploading(planId: string): void {
  mutate((state) => {
    const entry = state.entries[planId];
    if (!entry) return state;
    return {
      ...state,
      entries: {
        ...state.entries,
        [planId]: {
          ...entry,
          status: 'uploading' as TranscriptionStatus,
          started_at: new Date().toISOString(),
          error: null,
        },
      },
    };
  });
}

/**
 * Passe un plan en cours de traitement IA.
 */
export function setPlanProcessing(planId: string): void {
  mutate((state) => {
    const entry = state.entries[planId];
    if (!entry) return state;
    return {
      ...state,
      entries: {
        ...state.entries,
        [planId]: {
          ...entry,
          status: 'processing' as TranscriptionStatus,
        },
      },
    };
  });
}

/**
 * Enregistre le résultat d'une transcription réussie.
 */
export function setPlanCompleted(planId: string, result: PlanTranscriptionResult): void {
  mutate((state) => {
    const entry = state.entries[planId];
    if (!entry) return state;
    return {
      ...state,
      entries: {
        ...state.entries,
        [planId]: {
          ...entry,
          status: 'completed' as TranscriptionStatus,
          result,
          error: null,
          completed_at: new Date().toISOString(),
        },
      },
    };
  });
}

/**
 * Enregistre une erreur de transcription.
 */
export function setPlanError(planId: string, error: TranscriptionError): void {
  mutate((state) => {
    const entry = state.entries[planId];
    if (!entry) return state;
    return {
      ...state,
      entries: {
        ...state.entries,
        [planId]: {
          ...entry,
          status: 'error' as TranscriptionStatus,
          result: null,
          error,
          completed_at: new Date().toISOString(),
        },
      },
    };
  });
}

/**
 * Définit le plan actif (affiché dans l'UI).
 */
export function setActivePlan(planId: string | null): void {
  mutate((state) => ({ ...state, active_plan_id: planId }));
}

/**
 * Remet un plan à l'état initial (pour réessai).
 */
export function resetPlanEntry(planId: string): void {
  mutate((state) => {
    const entry = state.entries[planId];
    if (!entry) return state;
    return {
      ...state,
      entries: {
        ...state.entries,
        [planId]: {
          ...entry,
          status: 'idle' as TranscriptionStatus,
          result: null,
          error: null,
          started_at: null,
          completed_at: null,
        },
      },
    };
  });
}

/**
 * Supprime définitivement un plan du store.
 */
export function removePlanEntry(planId: string): void {
  mutate((state) => {
    const { [planId]: _removed, ...remaining } = state.entries;
    return {
      ...state,
      entries: remaining,
      active_plan_id: state.active_plan_id === planId ? null : state.active_plan_id,
    };
  });
}

/**
 * Efface toutes les transcriptions du store.
 */
export function clearAllTranscriptions(): void {
  mutate(() => createInitialState());
}

// ── Sélecteurs ────────────────────────────────────────────────────────────────

export function getPlanEntry(planId: string): PlanTranscriptionEntry | null {
  return currentState.entries[planId] ?? null;
}

export function getActivePlanEntry(): PlanTranscriptionEntry | null {
  const id = currentState.active_plan_id;
  if (!id) return null;
  return currentState.entries[id] ?? null;
}

export function getAllPlanEntries(): ReadonlyArray<PlanTranscriptionEntry> {
  return Object.values(currentState.entries);
}

export function getCompletedTranscriptions(): ReadonlyArray<PlanTranscriptionEntry> {
  return Object.values(currentState.entries).filter(
    (e) => e.status === 'completed' && e.result !== null
  );
}