// ─────────────────────────────────────────────────────────────────────────────
// planUserValidationEngine.ts
// Moteur de validation structurelle des murs par l'utilisateur
// Gère : confirmation porteur/cloison, rejet, verrouillage du plan
// Pattern Mimmoza : event bus + localStorage
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import type { DetectedWall, WallMaterial } from './planTranscription.types';
import type { WallCorrection } from '../shared/planValidation.types';

// ── Clé de stockage ───────────────────────────────────────────────────────────

const STORAGE_KEY = 'mimmoza_rehab_wall_validation_v1' as const;

// ── Statut de validation d'un mur (plus précis qu'ElementValidationStatus) ───

export type WallUserValidationStatus =
  | 'en_attente'         // IA a détecté, utilisateur n'a pas encore statué
  | 'porteur_confirmé'   // mur porteur — décision structurelle ferme
  | 'cloison_confirmée'  // mur de distribution non porteur
  | 'rejeté'             // faux positif IA — n'existe pas sur le plan réel
  | 'corrigé';           // propriétés modifiées manuellement avant confirmation

// ── Enregistrement de validation d'un mur ────────────────────────────────────

export interface WallValidationRecord {
  readonly wall_id: string;
  readonly status: WallUserValidationStatus;
  /**
   * true  = mur porteur confirmé
   * false = cloison confirmée
   * null  = rejeté (faux positif) ou en attente
   */
  readonly porteur_confirmed: boolean | null;
  readonly correction: WallCorrection | null;
  readonly notes: string;
  readonly validated_at: string | null; // ISO 8601
  readonly history: ReadonlyArray<WallValidationHistoryEntry>;
}

// ── Entrée d'historique ───────────────────────────────────────────────────────

export interface WallValidationHistoryEntry {
  readonly action: WallUserValidationStatus;
  readonly at: string;           // ISO 8601
  readonly previous_status: WallUserValidationStatus;
  readonly correction_snapshot: WallCorrection | null;
}

// ── Verrouillage du plan ──────────────────────────────────────────────────────

export interface PlanLockInfo {
  readonly is_locked: boolean;
  readonly locked_at: string | null;
  readonly locked_reason: string;
  readonly locked_wall_count: number;
}

// ── Progression de validation ─────────────────────────────────────────────────

export interface ValidationProgress {
  readonly total: number;
  readonly nb_porteur: number;
  readonly nb_cloison: number;
  readonly nb_rejete: number;
  readonly nb_corrige: number;
  readonly nb_pending: number;
  readonly completion_pct: number;  // 0–100
  readonly can_lock: boolean;       // true si nb_pending === 0
}

// ── État global du moteur ─────────────────────────────────────────────────────

export interface UserValidationEngineState {
  readonly plan_id: string | null;
  readonly wall_records: Record<string, WallValidationRecord>;
  readonly plan_lock: PlanLockInfo;
  readonly last_action_at: string | null;
}

// ── Payload exporté vers DXF / autres services ────────────────────────────────

export interface ValidatedWallExport {
  readonly wall_id: string;
  readonly status: WallUserValidationStatus;
  readonly porteur: boolean | null;
  readonly materiau: WallMaterial;
  readonly epaisseur_cm: number | null;
  readonly longueur_m: number | null;
  readonly start: { x: number; y: number };
  readonly end:   { x: number; y: number };
  readonly notes: string;
}

// ── État initial ──────────────────────────────────────────────────────────────

function createInitialState(): UserValidationEngineState {
  return {
    plan_id: null,
    wall_records: {},
    plan_lock: {
      is_locked: false,
      locked_at: null,
      locked_reason: '',
      locked_wall_count: 0,
    },
    last_action_at: null,
  };
}

function createWallRecord(wallId: string): WallValidationRecord {
  return {
    wall_id: wallId,
    status: 'en_attente',
    porteur_confirmed: null,
    correction: null,
    notes: '',
    validated_at: null,
    history: [],
  };
}

// ── Sérialisation / Désérialisation ──────────────────────────────────────────

function loadState(): UserValidationEngineState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialState();
    return JSON.parse(raw) as UserValidationEngineState;
  } catch {
    return createInitialState();
  }
}

function saveState(state: UserValidationEngineState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    console.warn('[planUserValidationEngine] Impossible de persister l\'état.');
  }
}

// ── Event bus ─────────────────────────────────────────────────────────────────

type EngineListener = (state: UserValidationEngineState) => void;
const engineListeners = new Set<EngineListener>();

function notifyEngine(state: UserValidationEngineState): void {
  engineListeners.forEach((fn) => fn(state));
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let engineState: UserValidationEngineState = loadState();

function mutate(
  updater: (current: UserValidationEngineState) => UserValidationEngineState
): void {
  engineState = {
    ...updater(engineState),
    last_action_at: new Date().toISOString(),
  };
  saveState(engineState);
  notifyEngine(engineState);
}

// ── Garde : plan verrouillé ───────────────────────────────────────────────────

function assertNotLocked(): void {
  if (engineState.plan_lock.is_locked) {
    throw new Error(
      'Le plan est verrouillé. Déverrouillez-le avant d\'effectuer des modifications.'
    );
  }
}

// ── Helper : ajout entrée historique ─────────────────────────────────────────

function pushHistory(
  record: WallValidationRecord,
  newStatus: WallUserValidationStatus,
  correction: WallCorrection | null
): WallValidationHistoryEntry {
  return {
    action: newStatus,
    at: new Date().toISOString(),
    previous_status: record.status,
    correction_snapshot: correction,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// API PUBLIQUE
// ═══════════════════════════════════════════════════════════════════════════════

export function subscribeToValidationEngine(listener: EngineListener): () => void {
  engineListeners.add(listener);
  return () => engineListeners.delete(listener);
}

export function getValidationEngineState(): Readonly<UserValidationEngineState> {
  return engineState;
}

// ── Initialisation ────────────────────────────────────────────────────────────

/**
 * Initialise le moteur pour un plan donné.
 * Si des enregistrements existent déjà pour ce plan, ils sont conservés.
 * Les nouveaux murs (détectés après coup) sont ajoutés en 'en_attente'.
 */
export function initValidationForPlan(
  planId: string,
  walls: ReadonlyArray<DetectedWall>
): void {
  mutate((state) => {
    const isPlanChange = state.plan_id !== planId;
    const existingRecords = isPlanChange ? {} : state.wall_records;

    const mergedRecords: Record<string, WallValidationRecord> = { ...existingRecords };
    for (const wall of walls) {
      if (!mergedRecords[wall.id]) {
        mergedRecords[wall.id] = createWallRecord(wall.id);
      }
    }

    return {
      ...state,
      plan_id: planId,
      wall_records: mergedRecords,
      // Reset lock si changement de plan
      plan_lock: isPlanChange
        ? { is_locked: false, locked_at: null, locked_reason: '', locked_wall_count: 0 }
        : state.plan_lock,
    };
  });
}

// ── Actions de validation ─────────────────────────────────────────────────────

/**
 * Confirme un mur comme mur PORTEUR.
 * Décision structurelle forte — inscrite en historique.
 */
export function confirmWallAsPorteur(
  wallId: string,
  correction?: WallCorrection,
  notes?: string
): void {
  assertNotLocked();

  mutate((state) => {
    const record = state.wall_records[wallId] ?? createWallRecord(wallId);
    const resolvedCorrection = correction ?? record.correction ?? { porteur: true };
    const entry = pushHistory(record, 'porteur_confirmé', resolvedCorrection);

    return {
      ...state,
      wall_records: {
        ...state.wall_records,
        [wallId]: {
          ...record,
          status: 'porteur_confirmé',
          porteur_confirmed: true,
          correction: { ...resolvedCorrection, porteur: true },
          notes: notes ?? record.notes,
          validated_at: new Date().toISOString(),
          history: [...record.history, entry],
        },
      },
    };
  });
}

/**
 * Confirme un mur comme CLOISON (mur de distribution, non porteur).
 */
export function confirmWallAsCloison(
  wallId: string,
  correction?: WallCorrection,
  notes?: string
): void {
  assertNotLocked();

  mutate((state) => {
    const record = state.wall_records[wallId] ?? createWallRecord(wallId);
    const resolvedCorrection = correction ?? record.correction ?? { porteur: false };
    const entry = pushHistory(record, 'cloison_confirmée', resolvedCorrection);

    return {
      ...state,
      wall_records: {
        ...state.wall_records,
        [wallId]: {
          ...record,
          status: 'cloison_confirmée',
          porteur_confirmed: false,
          correction: { ...resolvedCorrection, porteur: false },
          notes: notes ?? record.notes,
          validated_at: new Date().toISOString(),
          history: [...record.history, entry],
        },
      },
    };
  });
}

/**
 * Rejette un mur comme faux positif de détection IA.
 * Le mur sera exclu des exports et du plan validé.
 */
export function rejectWall(wallId: string, notes?: string): void {
  assertNotLocked();

  mutate((state) => {
    const record = state.wall_records[wallId] ?? createWallRecord(wallId);
    const entry = pushHistory(record, 'rejeté', null);

    return {
      ...state,
      wall_records: {
        ...state.wall_records,
        [wallId]: {
          ...record,
          status: 'rejeté',
          porteur_confirmed: null,
          correction: null,
          notes: notes ?? record.notes,
          validated_at: new Date().toISOString(),
          history: [...record.history, entry],
        },
      },
    };
  });
}

/**
 * Modifie les propriétés d'un mur sans confirmer son rôle structurel.
 * Passe le statut à 'corrigé' si le mur était en attente.
 * Préserve le statut si déjà confirmé porteur/cloison.
 */
export function correctWall(
  wallId: string,
  correction: WallCorrection,
  notes?: string
): void {
  assertNotLocked();

  mutate((state) => {
    const record = state.wall_records[wallId] ?? createWallRecord(wallId);
    const newStatus: WallUserValidationStatus =
      record.status === 'en_attente' ? 'corrigé' : record.status;
    const entry = pushHistory(record, newStatus, correction);

    return {
      ...state,
      wall_records: {
        ...state.wall_records,
        [wallId]: {
          ...record,
          status: newStatus,
          correction: { ...record.correction, ...correction },
          notes: notes ?? record.notes,
          validated_at: record.validated_at ?? new Date().toISOString(),
          history: [...record.history, entry],
        },
      },
    };
  });
}

/**
 * Réinitialise un mur à 'en_attente' (efface la décision précédente).
 * L'historique est conservé.
 */
export function resetWallValidation(wallId: string): void {
  assertNotLocked();

  mutate((state) => {
    const record = state.wall_records[wallId];
    if (!record) return state;
    const entry = pushHistory(record, 'en_attente', null);

    return {
      ...state,
      wall_records: {
        ...state.wall_records,
        [wallId]: {
          ...record,
          status: 'en_attente',
          porteur_confirmed: null,
          correction: null,
          validated_at: null,
          history: [...record.history, entry],
        },
      },
    };
  });
}

// ── Verrouillage ──────────────────────────────────────────────────────────────

/**
 * Verrouille le plan validé.
 * Possible uniquement si aucun mur n'est en 'en_attente'.
 * Lève une erreur si la condition n'est pas remplie.
 */
export function lockPlan(reason?: string): void {
  const progress = getValidationProgress();
  if (!progress.can_lock) {
    throw new Error(
      `Impossible de verrouiller : ${progress.nb_pending} mur(s) en attente de validation.`
    );
  }

  mutate((state) => ({
    ...state,
    plan_lock: {
      is_locked: true,
      locked_at: new Date().toISOString(),
      locked_reason: reason ?? 'Plan validé',
      locked_wall_count: Object.keys(state.wall_records).length,
    },
  }));
}

/**
 * Déverrouille le plan pour autoriser des corrections ultérieures.
 */
export function unlockPlan(): void {
  mutate((state) => ({
    ...state,
    plan_lock: {
      ...state.plan_lock,
      is_locked: false,
    },
  }));
}

// ── Sélecteurs ────────────────────────────────────────────────────────────────

export function getWallValidationRecord(wallId: string): WallValidationRecord | null {
  return engineState.wall_records[wallId] ?? null;
}

export function getValidationProgress(): ValidationProgress {
  const records = Object.values(engineState.wall_records);
  const total = records.length;

  const nb_porteur  = records.filter((r) => r.status === 'porteur_confirmé').length;
  const nb_cloison  = records.filter((r) => r.status === 'cloison_confirmée').length;
  const nb_rejete   = records.filter((r) => r.status === 'rejeté').length;
  const nb_corrige  = records.filter((r) => r.status === 'corrigé').length;
  const nb_pending  = records.filter((r) => r.status === 'en_attente').length;

  const nb_decided  = nb_porteur + nb_cloison + nb_rejete + nb_corrige;
  const completion_pct = total === 0 ? 100 : Math.round((nb_decided / total) * 100);

  return {
    total,
    nb_porteur,
    nb_cloison,
    nb_rejete,
    nb_corrige,
    nb_pending,
    completion_pct,
    can_lock: nb_pending === 0 && total > 0,
  };
}

/**
 * Retourne les murs validés formatés pour export DXF ou autre service.
 * Exclut les murs rejetés si `includeRejected` est false (défaut).
 */
export function exportValidatedWalls(
  walls: ReadonlyArray<DetectedWall>,
  options: { includeRejected?: boolean; includePending?: boolean } = {}
): ReadonlyArray<ValidatedWallExport> {
  const { includeRejected = false, includePending = false } = options;

  return walls
    .map((wall): ValidatedWallExport | null => {
      const record = engineState.wall_records[wall.id];
      if (!record) return null;

      if (!includeRejected && record.status === 'rejeté') return null;
      if (!includePending && record.status === 'en_attente') return null;

      const effectiveMateriau =
        (record.correction?.materiau as WallMaterial | undefined) ?? wall.materiau;
      const effectiveEpaisseur = record.correction?.epaisseur_cm ?? wall.epaisseur_cm;
      const effectivePorteur   =
        record.porteur_confirmed !== null
          ? record.porteur_confirmed
          : wall.porteur;

      return {
        wall_id: wall.id,
        status: record.status,
        porteur: effectivePorteur,
        materiau: effectiveMateriau,
        epaisseur_cm: effectiveEpaisseur,
        longueur_m: wall.longueur_m,
        start: { x: wall.start.x, y: wall.start.y },
        end:   { x: wall.end.x,   y: wall.end.y   },
        notes: record.notes,
      };
    })
    .filter((v): v is ValidatedWallExport => v !== null);
}

/**
 * Efface toutes les validations du plan actif (sans toucher à l'ID du plan).
 * Uniquement si le plan n'est pas verrouillé.
 */
export function clearAllValidations(): void {
  assertNotLocked();
  mutate((state) => ({
    ...state,
    wall_records: Object.fromEntries(
      Object.keys(state.wall_records).map((id) => [id, createWallRecord(id)])
    ),
  }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// HOOK REACT
// ═══════════════════════════════════════════════════════════════════════════════

export interface UseValidationEngineReturn {
  readonly state: UserValidationEngineState;
  readonly progress: ValidationProgress;
  readonly isPlanLocked: boolean;
  readonly getRecord: (wallId: string) => WallValidationRecord | null;
  readonly confirmPorteur: (wallId: string, correction?: WallCorrection, notes?: string) => void;
  readonly confirmCloison: (wallId: string, correction?: WallCorrection, notes?: string) => void;
  readonly reject: (wallId: string, notes?: string) => void;
  readonly correct: (wallId: string, correction: WallCorrection, notes?: string) => void;
  readonly reset: (wallId: string) => void;
  readonly lock: (reason?: string) => void;
  readonly unlock: () => void;
}

export function useValidationEngine(): UseValidationEngineReturn {
  const [state, setState] = useState<UserValidationEngineState>(
    () => getValidationEngineState()
  );

  useEffect(() => {
    setState(getValidationEngineState());
    const unsub = subscribeToValidationEngine((s) => setState(s));
    return unsub;
  }, []);

  return {
    state,
    progress: getValidationProgress(),
    isPlanLocked: state.plan_lock.is_locked,
    getRecord: getWallValidationRecord,
    confirmPorteur: confirmWallAsPorteur,
    confirmCloison: confirmWallAsCloison,
    reject: rejectWall,
    correct: correctWall,
    reset: resetWallValidation,
    lock: lockPlan,
    unlock: unlockPlan,
  };
}