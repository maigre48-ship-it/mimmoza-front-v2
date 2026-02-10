/**
 * banqueSnapshot.store.ts
 * ────────────────────────────────────────────────────────────────────
 * Store centralisé Banque — source de vérité localStorage.
 *
 * Pattern identique à promoteurSnapshot.store.ts / marchandSnapshot.store.ts
 * mais avec patch helpers **dédiés par module** pour garantir la type-safety
 * et éviter la duplication de logique dans chaque page.
 *
 * Usage :
 *   import { patchRiskAnalysis, readBanqueSnapshot } from "../shared/store/banqueSnapshot.store";
 *   patchRiskAnalysis(dossierId, { globalLevel: "faible", items: [...] });
 *
 * Événement cross-composant :
 *   window.addEventListener(BANQUE_SNAPSHOT_EVENT, () => { // re-read });
 * ────────────────────────────────────────────────────────────────────
 */

import type {
  BanqueSnapshot,
  BanqueDossier,
  BanqueRiskAnalysis,
  BanqueGuarantees,
  BanqueDocuments,
  BanqueCommittee,
  BanqueMonitoring,
  BanqueSmartScore,
  BanqueMarketData,
  BanqueModuleKey,
  MonitoringAlert,
} from "../types/banque.types";

// ============================================================================
// Constants
// ============================================================================

export const LS_BANQUE_SNAPSHOT_V1 = "mimmoza.banque.snapshot.v1";
export const BANQUE_SNAPSHOT_EVENT = "mimmoza:banque:snapshot";
const CURRENT_VERSION = "1.0.0";

// ============================================================================
// Internal helpers
// ============================================================================

function now(): string {
  return new Date().toISOString();
}

/** Snapshot vide initial */
function emptySnapshot(): BanqueSnapshot {
  return {
    version: CURRENT_VERSION,
    updatedAt: now(),
  };
}

/** Lecture brute depuis localStorage */
function readRaw(): BanqueSnapshot {
  try {
    const raw = localStorage.getItem(LS_BANQUE_SNAPSHOT_V1);
    if (!raw) return emptySnapshot();
    const parsed = JSON.parse(raw) as BanqueSnapshot;
    // Migration check si besoin
    if (!parsed.version) parsed.version = CURRENT_VERSION;
    return parsed;
  } catch (e) {
    console.warn("[BanqueSnapshot] read error, returning empty", e);
    return emptySnapshot();
  }
}

/** Écriture + dispatch event pour réactivité intra-tab */
function writeSnapshot(next: BanqueSnapshot): void {
  try {
    next.updatedAt = now();
    localStorage.setItem(LS_BANQUE_SNAPSHOT_V1, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(BANQUE_SNAPSHOT_EVENT, { detail: next }));
  } catch (e) {
    console.error("[BanqueSnapshot] write error", e);
  }
}

/** Vérifie que le dossierId correspond au dossier actif (guard) */
function assertDossier(snap: BanqueSnapshot, dossierId: string): boolean {
  if (!snap.dossier || snap.dossier.id !== dossierId) {
    console.warn(
      `[BanqueSnapshot] dossierId mismatch: expected="${snap.dossier?.id}", got="${dossierId}". Patch ignoré.`
    );
    return false;
  }
  return true;
}

// ============================================================================
// Public — Selectors (compat contexts/hooks)
// ============================================================================

/**
 * Selector: retourne le dossier actif depuis un snapshot.
 * (Compat : certains hooks importent `selectDossier` depuis ce store)
 */
export function selectDossier(snap: BanqueSnapshot): BanqueDossier | null {
  return snap.dossier ?? null;
}

/** Selector: retourne l'id du dossier actif depuis un snapshot. */
export function selectActiveDossierId(snap: BanqueSnapshot): string | undefined {
  return snap.activeDossierId ?? snap.dossier?.id;
}

// ============================================================================
// Public — Lecture
// ============================================================================

/** Lire le snapshot complet */
export function readBanqueSnapshot(): BanqueSnapshot {
  return readRaw();
}

/** Lire uniquement le dossier actif */
export function readActiveDossier(): BanqueDossier | null {
  const snap = readRaw();
  return snap.dossier ?? null;
}

/** Lire un module spécifique */
export function readModule<K extends BanqueModuleKey>(
  key: K
): BanqueSnapshot[K] | undefined {
  return readRaw()[key];
}

// ============================================================================
// Public — Écriture générique
// ============================================================================

/** Patch shallow du snapshot (1er niveau) */
export function patchBanqueSnapshot(patch: Partial<BanqueSnapshot>): void {
  const snap = readRaw();
  const next = { ...snap, ...patch };
  writeSnapshot(next);
}

/** Patch d'un module par clé */
export function patchModule<K extends BanqueModuleKey>(
  key: K,
  value: Partial<NonNullable<BanqueSnapshot[K]>>
): void {
  const snap = readRaw();
  const existing = snap[key] ?? {};
  // @ts-expect-error — shallow merge intentionnel
  snap[key] = { ...existing, ...value, updatedAt: now() };
  writeSnapshot(snap);
}

// ============================================================================
// Public — Dossier
// ============================================================================

/** Créer ou mettre à jour le dossier actif */
export function upsertDossier(dossier: BanqueDossier): void {
  const snap = readRaw();
  snap.dossier = {
    ...snap.dossier,
    ...dossier,
    dates: {
      ...snap.dossier?.dates,
      ...dossier.dates,
      derniereMaj: now(),
    },
  };
  snap.activeDossierId = dossier.id;
  writeSnapshot(snap);
}

/** Met à jour le statut du dossier */
export function updateDossierStatut(
  dossierId: string,
  statut: BanqueDossier["statut"]
): void {
  const snap = readRaw();
  if (!assertDossier(snap, dossierId)) return;
  snap.dossier!.statut = statut;
  snap.dossier!.dates.derniereMaj = now();
  writeSnapshot(snap);
}

/**
 * ✅ Compat: removeDossier
 * Utilisé par certaines pages (Dashboard) pour supprimer / réinitialiser le dossier actif.
 * - Si dossierId correspond au dossier actif : on purge dossier + modules liés
 */
export function removeDossier(dossierId: string): void {
  const snap = readRaw();
  if (!snap.dossier) return;

  // Si la page appelle removeDossier sur un autre id, on ne fait rien
  if (snap.dossier.id !== dossierId) return;

  // Purge dossier + modules associés
  delete snap.dossier;
  delete snap.activeDossierId;

  delete snap.riskAnalysis;
  delete snap.guarantees;
  delete snap.documents;
  delete snap.committee;
  delete snap.monitoring;
  delete snap.smartScore;
  delete snap.market;

  writeSnapshot(snap);
}

// ============================================================================
// Public — Patch helpers dédiés par module
// ============================================================================

/**
 * Patch l'analyse des risques.
 * Utilisé par la page Analyse après retour API Géorisques / scoring.
 */
export function patchRiskAnalysis(
  dossierId: string,
  payload: Partial<BanqueRiskAnalysis>
): void {
  const snap = readRaw();
  if (!assertDossier(snap, dossierId)) return;
  snap.riskAnalysis = {
    ...(snap.riskAnalysis as BanqueRiskAnalysis),
    ...payload,
    updatedAt: now(),
    lastComputedAt: payload.lastComputedAt ?? now(),
  };
  writeSnapshot(snap);
}

/**
 * Patch les documents du dossier.
 * Utilisé par la page Documents après upload / vérification.
 */
export function patchDocuments(
  dossierId: string,
  payload: Partial<BanqueDocuments>
): void {
  const snap = readRaw();
  if (!assertDossier(snap, dossierId)) return;
  snap.documents = {
    ...(snap.documents as BanqueDocuments),
    ...payload,
    updatedAt: now(),
  };
  // Recalcul automatique des manquants
  if (snap.documents.required && snap.documents.list) {
    const receivedTypes = new Set(snap.documents.list.map((d) => d.type));
    snap.documents.missing = snap.documents.required.filter(
      (r) => !receivedTypes.has(r)
    );
  }
  writeSnapshot(snap);
}

/**
 * Patch les garanties.
 * Utilisé par la page Garanties après saisie / mise à jour.
 */
export function patchGuarantees(
  dossierId: string,
  payload: Partial<BanqueGuarantees>
): void {
  const snap = readRaw();
  if (!assertDossier(snap, dossierId)) return;
  snap.guarantees = {
    ...(snap.guarantees as BanqueGuarantees),
    ...payload,
    updatedAt: now(),
  };
  // Recalcul automatique des gaps
  if (snap.guarantees.requested && snap.guarantees.obtained) {
    const obtainedIds = new Set(snap.guarantees.obtained.map((g) => g.id));
    snap.guarantees.gaps = snap.guarantees.requested
      .filter((g) => !obtainedIds.has(g.id) || g.statut !== "obtenue")
      .map((g) => `${g.label} (${g.type}) — non obtenue`);
  }
  writeSnapshot(snap);
}

/**
 * Patch le comité / décision.
 * Utilisé par la page Décision après génération note IA ou saisie manuelle.
 */
export function patchCommittee(
  dossierId: string,
  payload: Partial<BanqueCommittee>
): void {
  const snap = readRaw();
  if (!assertDossier(snap, dossierId)) return;
  snap.committee = {
    ...(snap.committee as BanqueCommittee),
    ...payload,
    updatedAt: now(),
  };
  // Si une décision est rendue, mettre à jour le statut dossier
  if (payload.decision && payload.decision !== "en_attente") {
    snap.dossier!.statut = "decision_rendue";
    snap.dossier!.dates.decisionRendue = now();
    snap.dossier!.dates.derniereMaj = now();
  }
  writeSnapshot(snap);
}

/**
 * Patch le SmartScore.
 * Appelé après recalcul du score (rule engine ou IA).
 */
export function patchSmartScore(
  dossierId: string,
  payload: Partial<BanqueSmartScore>
): void {
  const snap = readRaw();
  if (!assertDossier(snap, dossierId)) return;
  snap.smartScore = {
    ...(snap.smartScore as BanqueSmartScore),
    ...payload,
    updatedAt: now(),
  };
  writeSnapshot(snap);
}

/**
 * Patch les données marché.
 * Appelé après analyse marché (DVF / INSEE).
 */
export function patchMarket(
  dossierId: string,
  payload: Partial<BanqueMarketData>
): void {
  const snap = readRaw();
  if (!assertDossier(snap, dossierId)) return;
  snap.market = {
    ...(snap.market as BanqueMarketData),
    ...payload,
    updatedAt: now(),
  };
  writeSnapshot(snap);
}

// ============================================================================
// Public — Monitoring (opérations spécialisées)
// ============================================================================

/**
 * Ajoute ou met à jour une alerte monitoring.
 * Upsert par id : si l'alerte existe, elle est remplacée.
 */
export function upsertAlert(dossierId: string, alert: MonitoringAlert): void {
  const snap = readRaw();
  if (!assertDossier(snap, dossierId)) return;

  if (!snap.monitoring) {
    snap.monitoring = {
      alerts: [],
      rulesConfig: [],
      updatedAt: now(),
    };
  }

  const idx = snap.monitoring.alerts.findIndex((a) => a.id === alert.id);
  if (idx >= 0) {
    snap.monitoring.alerts[idx] = { ...alert };
  } else {
    snap.monitoring.alerts.push({ ...alert });
  }
  snap.monitoring.updatedAt = now();
  writeSnapshot(snap);
}

/** Acquitter une alerte */
export function acknowledgeAlert(dossierId: string, alertId: string): void {
  const snap = readRaw();
  if (!assertDossier(snap, dossierId)) return;
  if (!snap.monitoring) return;

  const alert = snap.monitoring.alerts.find((a) => a.id === alertId);
  if (alert) {
    alert.acknowledgedAt = now();
    snap.monitoring.updatedAt = now();
    writeSnapshot(snap);
  }
}

/** Supprimer une alerte */
export function removeAlert(dossierId: string, alertId: string): void {
  const snap = readRaw();
  if (!assertDossier(snap, dossierId)) return;
  if (!snap.monitoring) return;

  snap.monitoring.alerts = snap.monitoring.alerts.filter((a) => a.id !== alertId);
  snap.monitoring.updatedAt = now();
  writeSnapshot(snap);
}

/** Patch la config de monitoring (rules) */
export function patchMonitoringConfig(
  dossierId: string,
  rulesConfig: BanqueMonitoring["rulesConfig"]
): void {
  const snap = readRaw();
  if (!assertDossier(snap, dossierId)) return;

  if (!snap.monitoring) {
    snap.monitoring = {
      alerts: [],
      rulesConfig: [],
      updatedAt: now(),
    };
  }
  snap.monitoring.rulesConfig = rulesConfig;
  snap.monitoring.lastRunAt = now();
  snap.monitoring.updatedAt = now();
  writeSnapshot(snap);
}

// ============================================================================
// Public — Reset
// ============================================================================

/** Réinitialiser tout le snapshot */
export function clearBanqueSnapshot(): void {
  writeSnapshot(emptySnapshot());
}

/** Réinitialiser un module spécifique */
export function clearModule(key: BanqueModuleKey): void {
  const snap = readRaw();
  delete snap[key];
  writeSnapshot(snap);
}

// ============================================================================
// Public — Hook helper (React)
// ============================================================================

/**
 * Hook-friendly : retourne une fonction cleanup pour écouter les changements.
 * Usage dans un useEffect :
 *   useEffect(() => onBanqueSnapshotChange(() => setSnap(readBanqueSnapshot())), []);
 */
export function onBanqueSnapshotChange(
  callback: (snap: BanqueSnapshot) => void
): () => void {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<BanqueSnapshot>).detail;
    callback(detail ?? readRaw());
  };

  // Intra-tab (CustomEvent)
  window.addEventListener(BANQUE_SNAPSHOT_EVENT, handler);

  // Cross-tab (StorageEvent)
  const storageHandler = (e: StorageEvent) => {
    if (e.key === LS_BANQUE_SNAPSHOT_V1) {
      callback(readRaw());
    }
  };
  window.addEventListener("storage", storageHandler);

  return () => {
    window.removeEventListener(BANQUE_SNAPSHOT_EVENT, handler);
    window.removeEventListener("storage", storageHandler);
  };
}

// ============================================================================
// Compat — aliases (évite les erreurs d'import dans les pages existantes)
// ============================================================================

/**
 * Compat: certaines pages importent `addEvent` et l'appellent soit :
 *  - addEvent(dossierId, alert)
 *  - addEvent({ dossierId, type, message, ... })
 */
export function addEvent(arg1: any, arg2?: any): void {
  // Forme 1: addEvent(dossierId, alert)
  if (typeof arg1 === "string") {
    const dossierId = arg1;
    const alert = arg2 as MonitoringAlert;
    if (!alert) return;
    upsertAlert(dossierId, alert);
    return;
  }

  // Forme 2: addEvent({ dossierId, type, message, ... })
  const payload = arg1 as { dossierId?: string; type?: string; message?: string };
  const dossierId = payload?.dossierId;
  if (!dossierId) return;

  const alert: MonitoringAlert = {
    id: `evt-${Date.now()}`,
    dossierId,
    severity: "info",
    title: payload.type ?? "event",
    message: payload.message ?? "",
    ruleKey: payload.type ?? "event",
    createdAt: now(),
    updatedAt: now(),
  } as any;

  upsertAlert(dossierId, alert);
}

/** Compat: suppression d'event -> suppression d'alerte */
export function removeEvent(dossierId: string, alertId: string): void {
  removeAlert(dossierId, alertId);
}

/** Compat: acquittement d'event -> acquittement d'alerte */
export function acknowledgeEvent(dossierId: string, alertId: string): void {
  acknowledgeAlert(dossierId, alertId);
}
