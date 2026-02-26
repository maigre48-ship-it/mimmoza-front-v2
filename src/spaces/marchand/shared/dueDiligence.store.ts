/**
 * dueDiligence.store.ts
 *
 * Store localStorage léger pour les items Due Diligence Marchand.
 * Clé: mimmoza.marchand.duediligence.v1
 * Structure: { byDossier: { [dossierId]: DueDiligenceItem[] } }
 *
 * Chaque item a un id unique (ex: "tension_locative"), une category
 * ("marche" | "risques_externes" | "juridique" | "technique" | "urbanisme"),
 * un status, une value, un commentaire.
 */

// ─── Constants ──────────────────────────────────────────────────────

export const LS_DD_KEY = "mimmoza.marchand.duediligence.v1";
export const DD_EVENT = "mimmoza:marchand:duediligence";

// ─── Types ──────────────────────────────────────────────────────────

export type DDStatus = "OK" | "WARNING" | "CRITICAL" | "MISSING" | "PENDING";

export type DDCategory =
  | "marche"
  | "risques_externes"
  | "juridique"
  | "technique"
  | "urbanisme"
  | "financier";

export interface DueDiligenceItem {
  id: string;
  category: DDCategory;
  label: string;
  status: DDStatus;
  value: string | null;
  comment: string;
  updatedAt: string;
}

export interface DDSnapshot {
  version: 1;
  updatedAt: string;
  byDossier: Record<string, DueDiligenceItem[]>;
}

// ─── Internal helpers ───────────────────────────────────────────────

const nowIso = () => new Date().toISOString();

function defaultSnapshot(): DDSnapshot {
  return { version: 1, updatedAt: nowIso(), byDossier: {} };
}

// ─── Public API ─────────────────────────────────────────────────────

export function readDDSnapshot(): DDSnapshot {
  try {
    const raw = localStorage.getItem(LS_DD_KEY);
    if (!raw) return defaultSnapshot();
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1) return defaultSnapshot();
    return parsed as DDSnapshot;
  } catch {
    return defaultSnapshot();
  }
}

export function writeDDSnapshot(snap: DDSnapshot): void {
  snap.updatedAt = nowIso();
  localStorage.setItem(LS_DD_KEY, JSON.stringify(snap));
  window.dispatchEvent(new CustomEvent(DD_EVENT));
}

/** Lit les items DD pour un dossier donné. */
export function readItemsForDossier(dossierId: string): DueDiligenceItem[] {
  return readDDSnapshot().byDossier[dossierId] ?? [];
}

/** Upsert une liste d'items dans un dossier (merge par id). */
export function upsertItemsForDossier(
  dossierId: string,
  items: DueDiligenceItem[]
): void {
  const snap = readDDSnapshot();
  const existing = snap.byDossier[dossierId] ?? [];

  // Merge: les nouveaux remplacent les anciens par id
  const map = new Map(existing.map((it) => [it.id, it]));
  for (const it of items) {
    map.set(it.id, it);
  }

  snap.byDossier[dossierId] = Array.from(map.values());
  writeDDSnapshot(snap);
}

/** Supprime tous les items d'un dossier. */
export function clearDossierItems(dossierId: string): void {
  const snap = readDDSnapshot();
  delete snap.byDossier[dossierId];
  writeDDSnapshot(snap);
}

/** Supprime un item spécifique. */
export function removeItem(dossierId: string, itemId: string): void {
  const snap = readDDSnapshot();
  const items = snap.byDossier[dossierId] ?? [];
  snap.byDossier[dossierId] = items.filter((it) => it.id !== itemId);
  writeDDSnapshot(snap);
}