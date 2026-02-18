/**
 * Snapshot store — Sourcing (v1)
 * - Source de vérité locale (localStorage) SCOPPÉE PAR dealId
 * - Réutilisable par d'autres modules (Banque, Marchand, etc.)
 *
 * ── Deal-scoped persistence ──
 * Toutes les clés LS sont suffixées par le dealId actif :
 *   mimmoza.sourcing.snapshot.v1.<dealId>
 *   mimmoza.sourcing.smartscore.v1.<dealId>
 *
 * Si aucun deal actif → retourne un snapshot vide (aucune donnée globale).
 *
 * ── Extensions Qualification ──
 * - SmartScore normalisé
 * - QualificationInput / QualificationResult persistés
 * - Système subscribe/notify pour rerender réactif
 */

import type {
  SourcingSmartScore,
  QualificationInput,
  QualificationResult,
} from "../qualification/qualification.types";

import { getActiveDealId } from "../../marchand/shared/marchandDealContext.store";

/* ═══════════════════════════════════════════
   TYPES (existant + extension)
   ═══════════════════════════════════════════ */

export type SourcingSnapshotV1 = {
  version: 1;
  updatedAt: string;
  lastDraft?: any;
  lastScore?: any;
  lastHints?: any;
  smartScore?: SourcingSmartScore | null;
  qualificationInput?: QualificationInput | null;
  qualificationResult?: QualificationResult | null;
};

/* ═══════════════════════════════════════════
   CONSTANTES & HELPERS
   ═══════════════════════════════════════════ */

const LS_KEY_PREFIX = "mimmoza.sourcing.snapshot.v1";
const SMARTSCORE_LS_KEY_PREFIX = "mimmoza.sourcing.smartscore.v1";

function scopedKey(prefix: string, dealId: string | null): string | null {
  if (!dealId) return null;
  return `${prefix}.${dealId}`;
}

function emptySnapshot(): SourcingSnapshotV1 {
  return { version: 1, updatedAt: new Date().toISOString() };
}

/* ═══════════════════════════════════════════
   FONCTIONS PRINCIPALES — scoppées par dealId
   ═══════════════════════════════════════════ */

/**
 * Lit le snapshot sourcing du deal actif.
 * Si aucun dealId ou clé absente → snapshot vide.
 */
export function readSourcingSnapshot(): SourcingSnapshotV1 {
  const dealId = getActiveDealId();
  const key = scopedKey(LS_KEY_PREFIX, dealId);
  if (!key) return emptySnapshot();

  try {
    const raw = localStorage.getItem(key);
    if (!raw) return emptySnapshot();
    const parsed = JSON.parse(raw) as SourcingSnapshotV1;
    if (!parsed || parsed.version !== 1) {
      return emptySnapshot();
    }
    return parsed;
  } catch {
    return emptySnapshot();
  }
}

/**
 * Variante qui accepte un dealId explicite (utile au mount quand
 * le composant connaît déjà l'id sans re-lire le bridge store).
 */
export function readSourcingSnapshotForDeal(dealId: string | null): SourcingSnapshotV1 {
  const key = scopedKey(LS_KEY_PREFIX, dealId);
  if (!key) return emptySnapshot();

  try {
    const raw = localStorage.getItem(key);
    if (!raw) return emptySnapshot();
    const parsed = JSON.parse(raw) as SourcingSnapshotV1;
    if (!parsed || parsed.version !== 1) return emptySnapshot();
    return parsed;
  } catch {
    return emptySnapshot();
  }
}

export function writeSourcingSnapshot(next: SourcingSnapshotV1) {
  const dealId = getActiveDealId();
  const key = scopedKey(LS_KEY_PREFIX, dealId);
  if (!key) return; // pas de deal actif → on n'écrit rien

  const payload: SourcingSnapshotV1 = {
    ...next,
    version: 1,
    updatedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    /* quota exceeded — silent */
  }
  notify();
}

export function patchSourcingSnapshot(patch: Partial<SourcingSnapshotV1>) {
  const prev = readSourcingSnapshot();
  writeSourcingSnapshot({ ...prev, ...patch });
}

export function clearSourcingSnapshot() {
  const dealId = getActiveDealId();
  const key = scopedKey(LS_KEY_PREFIX, dealId);
  if (!key) return;
  try {
    localStorage.removeItem(key);
  } catch {
    /* silent */
  }
  notify();
}

/* ═══════════════════════════════════════════
   EXTENSIONS — SmartScore (scoppé)
   ═══════════════════════════════════════════ */

function parseVerdict(
  v: unknown
): "GO" | "GO_AVEC_RESERVES" | "NO_GO" | undefined {
  if (v === "GO" || v === "GO_AVEC_RESERVES" || v === "NO_GO") return v;
  return undefined;
}

/**
 * Lit le smartscore brut depuis la clé LS scoppée par dealId.
 */
export function normalizeSmartScoreFromLS(overrideDealId?: string | null): SourcingSmartScore | null {
  const dealId = overrideDealId !== undefined ? overrideDealId : getActiveDealId();
  const key = scopedKey(SMARTSCORE_LS_KEY_PREFIX, dealId);
  if (!key) return null;

  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw) as Record<string, any>;

    const computed = data?.computed;
    if (!computed || typeof computed.globalScore !== "number") return null;

    return {
      score: computed.globalScore,
      grade: computed.grade ?? undefined,
      verdict: parseVerdict(computed.verdict),
      rationale:
        computed.globalRationale ?? computed.rationale ?? undefined,
      computedAt: data.savedAt ?? computed.computedAt ?? undefined,
      engineVersion: computed.engineVersion ?? undefined,
    };
  } catch {
    return null;
  }
}

export function loadSmartScore(): SourcingSmartScore | null {
  const snap = readSourcingSnapshot();
  if (snap.smartScore) return snap.smartScore;
  return normalizeSmartScoreFromLS();
}

/**
 * Variante avec dealId explicite.
 */
export function loadSmartScoreForDeal(dealId: string | null): SourcingSmartScore | null {
  if (!dealId) return null;
  const snap = readSourcingSnapshotForDeal(dealId);
  if (snap.smartScore) return snap.smartScore;
  return normalizeSmartScoreFromLS(dealId);
}

export function setSmartScore(ss: SourcingSmartScore | null): void {
  patchSourcingSnapshot({ smartScore: ss });
}

/* ═══════════════════════════════════════════
   EXTENSIONS — Qualification (scoppé)
   ═══════════════════════════════════════════ */

export function upsertQualification(
  input: QualificationInput,
  result: QualificationResult
): void {
  patchSourcingSnapshot({
    qualificationInput: input,
    qualificationResult: result,
  });
}

export function getQualification(): {
  input: QualificationInput | null;
  result: QualificationResult | null;
} {
  const snap = readSourcingSnapshot();
  return {
    input: snap.qualificationInput ?? null,
    result: snap.qualificationResult ?? null,
  };
}

/* ═══════════════════════════════════════════
   SUBSCRIBE / NOTIFY (réactivité)
   ═══════════════════════════════════════════ */

type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* listener error — silent */
    }
  });
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}