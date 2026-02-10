// FILE: src/spaces/banque/services/dossier-committee-service.ts

import type {
  BanqueDossier,
  BanqueSnapshot,
  Condition,
  Decision,
  DossierDocument,
  DossierGuarantee,
  ProjectType,
} from "../types";

// ============================================================================
// CONSTANTES
// ============================================================================

const STORAGE_KEY = "mimmoza.banque.snapshot.v1";
const SNAPSHOT_VERSION = "1.0.0";

// ============================================================================
// HELPERS — Dossier vide
// ============================================================================

export function createEmptyDossier(
  id: string,
  nom: string,
  projectType: ProjectType,
): BanqueDossier {
  const now = new Date().toISOString();
  return {
    id,
    nom,
    projectType,
    montantDemande: 0,
    valeurProjet: 0,
    documents: [],
    guarantees: [],
    conditions: [],
    decision: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function createEmptySnapshot(): BanqueSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    updatedAt: new Date().toISOString(),
    dossiers: [],
    activeDossierId: null,
  };
}

// ============================================================================
// LOAD / SAVE — localStorage unique key
// ============================================================================

export function loadSnapshot(): BanqueSnapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createEmptySnapshot();
    const parsed = JSON.parse(raw) as BanqueSnapshot;
    // Basic shape validation
    if (!parsed.dossiers || !Array.isArray(parsed.dossiers)) {
      return createEmptySnapshot();
    }
    return parsed;
  } catch {
    console.warn("[BanqueService] Snapshot corrompu, reset.");
    return createEmptySnapshot();
  }
}

export function saveSnapshot(snapshot: BanqueSnapshot): void {
  const stamped: BanqueSnapshot = {
    ...snapshot,
    updatedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stamped));
    window.dispatchEvent(new CustomEvent("mimmoza:banque-snapshot-updated"));
  } catch (err) {
    console.error("[BanqueService] Erreur sauvegarde snapshot:", err);
  }
}

/** Charge, applique un transformateur, sauvegarde, et retourne le nouveau snapshot. */
export function updateAndPersist(
  transform: (snapshot: BanqueSnapshot) => BanqueSnapshot,
): BanqueSnapshot {
  const current = loadSnapshot();
  const next = transform(current);
  saveSnapshot(next);
  return next;
}

// ============================================================================
// ENSURE DOSSIER — création auto si absent
// ============================================================================

/**
 * Garantit qu'un dossier avec l'id donné existe dans le snapshot.
 * Si absent, le crée via createEmptyDossier et l'insère.
 * Retourne toujours le snapshot (éventuellement modifié) + le dossier.
 */
export function ensureDossier(
  snapshot: BanqueSnapshot,
  id: string,
  nom?: string,
  projectType?: ProjectType,
): { snapshot: BanqueSnapshot; dossier: BanqueDossier } {
  const existing = snapshot.dossiers.find((d) => d.id === id);
  if (existing) {
    return { snapshot, dossier: existing };
  }

  const newDossier = createEmptyDossier(
    id,
    nom ?? `Dossier ${id}`,
    projectType ?? "baseline",
  );

  const updatedSnapshot: BanqueSnapshot = {
    ...snapshot,
    dossiers: [...snapshot.dossiers, newDossier],
    activeDossierId: snapshot.activeDossierId ?? id,
  };

  return { snapshot: updatedSnapshot, dossier: newDossier };
}

// ============================================================================
// PATCH HELPERS — mettent à jour un dossier dans le snapshot
// ============================================================================

/**
 * Applique une transformation à un dossier spécifique dans le snapshot.
 * Si le dossier n'existe pas, il est créé automatiquement via ensureDossier.
 */
export function updateDossierInSnapshot(
  snapshot: BanqueSnapshot,
  dossierId: string,
  updater: (dossier: BanqueDossier) => BanqueDossier,
): BanqueSnapshot {
  const { snapshot: ensured } = ensureDossier(snapshot, dossierId);

  return {
    ...ensured,
    dossiers: ensured.dossiers.map((d) => {
      if (d.id !== dossierId) return d;
      return { ...updater(d), updatedAt: new Date().toISOString() };
    }),
  };
}

// ── Documents ───────────────────────────────────────────────────────────────

export function patchAddOrUpdateDocument(
  snapshot: BanqueSnapshot,
  dossierId: string,
  doc: DossierDocument,
): BanqueSnapshot {
  return updateDossierInSnapshot(snapshot, dossierId, (dossier) => {
    const idx = dossier.documents.findIndex((d) => d.id === doc.id);
    const documents =
      idx >= 0
        ? dossier.documents.map((d, i) => (i === idx ? doc : d))
        : [...dossier.documents, doc];
    return { ...dossier, documents };
  });
}

export function patchRemoveDocument(
  snapshot: BanqueSnapshot,
  dossierId: string,
  documentId: string,
): BanqueSnapshot {
  return updateDossierInSnapshot(snapshot, dossierId, (dossier) => ({
    ...dossier,
    documents: dossier.documents.filter((d) => d.id !== documentId),
  }));
}

// ── Garanties ───────────────────────────────────────────────────────────────

export function patchAddOrUpdateGuarantee(
  snapshot: BanqueSnapshot,
  dossierId: string,
  guarantee: DossierGuarantee,
): BanqueSnapshot {
  return updateDossierInSnapshot(snapshot, dossierId, (dossier) => {
    const idx = dossier.guarantees.findIndex((g) => g.id === guarantee.id);
    const guarantees =
      idx >= 0
        ? dossier.guarantees.map((g, i) => (i === idx ? guarantee : g))
        : [...dossier.guarantees, guarantee];
    return { ...dossier, guarantees };
  });
}

export function patchRemoveGuarantee(
  snapshot: BanqueSnapshot,
  dossierId: string,
  guaranteeId: string,
): BanqueSnapshot {
  return updateDossierInSnapshot(snapshot, dossierId, (dossier) => ({
    ...dossier,
    guarantees: dossier.guarantees.filter((g) => g.id !== guaranteeId),
  }));
}

// ── Conditions ──────────────────────────────────────────────────────────────

export function patchSetConditions(
  snapshot: BanqueSnapshot,
  dossierId: string,
  conditions: Condition[],
): BanqueSnapshot {
  return updateDossierInSnapshot(snapshot, dossierId, (dossier) => ({
    ...dossier,
    conditions,
  }));
}

export function patchToggleConditionMet(
  snapshot: BanqueSnapshot,
  dossierId: string,
  conditionId: string,
): BanqueSnapshot {
  return updateDossierInSnapshot(snapshot, dossierId, (dossier) => ({
    ...dossier,
    conditions: dossier.conditions.map((c) =>
      c.id === conditionId ? { ...c, met: !c.met } : c,
    ),
  }));
}

// ── Décision ────────────────────────────────────────────────────────────────

export function patchSetDecision(
  snapshot: BanqueSnapshot,
  dossierId: string,
  decision: Decision,
): BanqueSnapshot {
  return updateDossierInSnapshot(snapshot, dossierId, (dossier) => ({
    ...dossier,
    decision,
  }));
}

// ── Infos dossier ───────────────────────────────────────────────────────────

export function patchDossierInfo(
  snapshot: BanqueSnapshot,
  dossierId: string,
  info: Partial<Pick<BanqueDossier, "nom" | "projectType" | "montantDemande" | "valeurProjet">>,
): BanqueSnapshot {
  return updateDossierInSnapshot(snapshot, dossierId, (dossier) => ({
    ...dossier,
    ...info,
  }));
}

// ── Dossier actif ───────────────────────────────────────────────────────────

export function setActiveDossier(
  snapshot: BanqueSnapshot,
  dossierId: string,
): BanqueSnapshot {
  return { ...snapshot, activeDossierId: dossierId };
}

/** Retourne le dossier actif ou null. */
export function getActiveDossier(snapshot: BanqueSnapshot): BanqueDossier | null {
  if (!snapshot.activeDossierId) return null;
  return snapshot.dossiers.find((d) => d.id === snapshot.activeDossierId) ?? null;
}

// ── Suppression ─────────────────────────────────────────────────────────────

export function removeDossier(
  snapshot: BanqueSnapshot,
  dossierId: string,
): BanqueSnapshot {
  const dossiers = snapshot.dossiers.filter((d) => d.id !== dossierId);
  const activeDossierId =
    snapshot.activeDossierId === dossierId
      ? dossiers[0]?.id ?? null
      : snapshot.activeDossierId;

  return { ...snapshot, dossiers, activeDossierId };
}

// ── Reset ───────────────────────────────────────────────────────────────────

export function clearSnapshot(): void {
  localStorage.removeItem(STORAGE_KEY);
}// ---- Compat: addDossier (utilisé par Pipeline.tsx) ----
import type { BanqueDossier, BanqueSnapshot } from "../roles/types";

export function addDossier(snapshot: BanqueSnapshot, dossier: BanqueDossier): BanqueSnapshot {
  const now = new Date().toISOString();
  const next: BanqueSnapshot = {
    ...snapshot,
    dossiersById: {
      ...(snapshot as any).dossiersById,
      [dossier.id]: {
        ...dossier,
        updatedAt: now,
      },
    },
    activeDossierId: dossier.id,
    updatedAt: now,
  } as any;

  return next;
}
