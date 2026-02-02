/* src/spaces/marchand/shared/marchandSnapshot.store.ts
 *
 * Snapshot localStorage (v1) pour l'espace Marchand.
 * 100% TypeScript: AUCUN JSX dans ce fichier.
 */

export const LS_MARCHAND_SNAPSHOT_V1 = "mimmoza.marchand.snapshot.v1";
export const MARCHAND_SNAPSHOT_EVENT = "mimmoza:marchand:snapshot";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type MarchandDealStatus =
  | "Nouveau"
  | "Visite"
  | "Offre"
  | "Sous promesse"
  | "Travaux"
  | "En vente"
  | "Vendu";

export type MarchandDeal = {
  id: string;
  title: string;

  // Identité / sourcing léger
  address?: string; // "12 rue ..."
  zipCode?: string; // "44000"
  city?: string; // "Nantes"
  country?: string; // "FR"

  // Qualification rapide (optionnel)
  prixAchat?: number; // €
  surfaceM2?: number; // m²
  prixReventeCible?: number; // €
  note?: string;

  status: MarchandDealStatus;
  createdAt: string; // ISO
  updatedAt: string; // ISO
};

export type TaxRegime = "marchand" | "particulier" | "societe_is";

// Minimal TaxConfig (doit matcher ton taxEngine)
// Si ton taxEngine ajoute d'autres champs, ce type acceptera quand même via index signature.
export type TaxConfig = {
  vatMode: "none" | "margin" | "total";
  vatRatePct: number;
  vatRecoverablePct: number;
  dmtoEnabled: boolean;
  dmtoRatePct: number;
  dmtoFixed: number;
  irRatePct: number;
  socialRatePct: number;
  isRatePct: number;
  [k: string]: unknown;
};

export type RentabiliteSaved = {
  inputs: unknown; // ta page a un type Inputs local, on stocke tel quel
  taxRegime: TaxRegime;
  taxConfig: TaxConfig;
  computed?: unknown;
};

export type ExecutionSaved = {
  global?: {
    startDate: string; // YYYY-MM-DD
    bufferPct: number;
    dailyHoldingCost: number;
  };
  tasks?: unknown[];
  phases?: unknown[];
  planningMode?: "auto" | "manuel";
  stats?: unknown;
};

export type SortieSaved = {
  holdingMensuel: number;
  scenarios: unknown[];
};

export type MarchandSnapshotV1 = {
  version: 1;
  updatedAt: string; // ISO
  activeDealId: string | null;
  deals: MarchandDeal[];

  // modules par deal
  rentabiliteByDeal: Record<string, RentabiliteSaved | undefined>;
  executionByDeal: Record<string, ExecutionSaved | undefined>;
  sortieByDeal: Record<string, SortieSaved | undefined>;
};

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

const nowIso = () => new Date().toISOString();

const isBrowser = (): boolean =>
  typeof window !== "undefined" && typeof localStorage !== "undefined";

const defaultSnapshot = (): MarchandSnapshotV1 => ({
  version: 1,
  updatedAt: nowIso(),
  activeDealId: null,
  deals: [],
  rentabiliteByDeal: {},
  executionByDeal: {},
  sortieByDeal: {},
});

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

const normalizeString = (v: unknown): string | undefined =>
  isNonEmptyString(v) ? v.trim() : undefined;

const normalizeNumber = (v: unknown): number | undefined => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return undefined;
};

const isDealStatus = (v: unknown): v is MarchandDealStatus => {
  return (
    v === "Nouveau" ||
    v === "Visite" ||
    v === "Offre" ||
    v === "Sous promesse" ||
    v === "Travaux" ||
    v === "En vente" ||
    v === "Vendu"
  );
};

function sanitizeDeals(raw: unknown): MarchandDeal[] {
  if (!Array.isArray(raw)) return [];
  const out: MarchandDeal[] = [];

  for (const item of raw) {
    const d = item as Partial<MarchandDeal> | null;
    if (!d) continue;

    if (!isNonEmptyString(d.id)) continue;
    if (!isNonEmptyString(d.title)) continue;
    if (!isDealStatus(d.status)) continue;

    const createdAt = isNonEmptyString(d.createdAt) ? d.createdAt : nowIso();
    const updatedAt = isNonEmptyString(d.updatedAt) ? d.updatedAt : createdAt;

    const city = normalizeString(d.city) ?? "—";

    out.push({
      id: d.id,
      title: d.title,

      address: normalizeString(d.address),
      zipCode: normalizeString(d.zipCode),
      city,
      country: normalizeString(d.country) ?? "FR",

      prixAchat: normalizeNumber(d.prixAchat),
      surfaceM2: normalizeNumber(d.surfaceM2),
      prixReventeCible: normalizeNumber(d.prixReventeCible),
      note: normalizeString(d.note),

      status: d.status,
      createdAt,
      updatedAt,
    });
  }

  return out;
}

function pruneMapToDeals<T>(
  map: Record<string, T | undefined>,
  dealIds: Set<string>
): Record<string, T | undefined> {
  const next: Record<string, T | undefined> = {};
  for (const k of Object.keys(map ?? {})) {
    if (dealIds.has(k)) next[k] = map[k];
  }
  return next;
}

/**
 * Normalize snapshot:
 * - prune module maps for deleted/unknown deals
 * - ensure activeDealId is either null or exists
 * - ensure deals are sanitized
 */
function normalizeSnapshot(s: MarchandSnapshotV1): MarchandSnapshotV1 {
  const deals = sanitizeDeals(s.deals);
  const ids = new Set(deals.map((d) => d.id));

  const activeDealId =
    s.activeDealId && ids.has(s.activeDealId) ? s.activeDealId : null;

  const rentabiliteByDeal = pruneMapToDeals(s.rentabiliteByDeal ?? {}, ids);
  const executionByDeal = pruneMapToDeals(s.executionByDeal ?? {}, ids);
  const sortieByDeal = pruneMapToDeals(s.sortieByDeal ?? {}, ids);

  return {
    version: 1,
    updatedAt: isNonEmptyString(s.updatedAt) ? s.updatedAt : nowIso(),
    activeDealId,
    deals,
    rentabiliteByDeal,
    executionByDeal,
    sortieByDeal,
  };
}

function safeParse(json: string | null): MarchandSnapshotV1 | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Partial<MarchandSnapshotV1>;
    if (!parsed || parsed.version !== 1) return null;

    const candidate: MarchandSnapshotV1 = {
      version: 1,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : nowIso(),
      activeDealId: (parsed.activeDealId ?? null) as string | null,
      deals: (parsed.deals ?? []) as MarchandDeal[],
      rentabiliteByDeal: (parsed.rentabiliteByDeal ?? {}) as Record<
        string,
        RentabiliteSaved | undefined
      >,
      executionByDeal: (parsed.executionByDeal ?? {}) as Record<
        string,
        ExecutionSaved | undefined
      >,
      sortieByDeal: (parsed.sortieByDeal ?? {}) as Record<
        string,
        SortieSaved | undefined
      >,
    };

    return normalizeSnapshot(candidate);
  } catch {
    return null;
  }
}

function readRaw(): MarchandSnapshotV1 {
  if (!isBrowser()) return defaultSnapshot();
  const fromLs = safeParse(localStorage.getItem(LS_MARCHAND_SNAPSHOT_V1));
  return fromLs ?? defaultSnapshot();
}

function writeSnapshot(next: MarchandSnapshotV1) {
  if (!isBrowser()) return;

  const normalized = normalizeSnapshot(next);
  const toWrite: MarchandSnapshotV1 = {
    ...normalized,
    version: 1,
    updatedAt: nowIso(),
  };

  localStorage.setItem(LS_MARCHAND_SNAPSHOT_V1, JSON.stringify(toWrite));

  // Same-tab refresh: storage event ne fire pas dans l'onglet courant
  window.dispatchEvent(new CustomEvent(MARCHAND_SNAPSHOT_EVENT));
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export function readMarchandSnapshot(): MarchandSnapshotV1 {
  return readRaw();
}

/**
 * Reset total (utile quand tu veux "sortir du mock" et repartir clean)
 */
export function resetMarchandSnapshot(): void {
  writeSnapshot(defaultSnapshot());
}

export function upsertDeal(deal: MarchandDeal) {
  const snap = readRaw();
  const idx = snap.deals.findIndex((d) => d.id === deal.id);

  const createdAt = isNonEmptyString(deal.createdAt) ? deal.createdAt : nowIso();
  const updatedAt = isNonEmptyString(deal.updatedAt) ? deal.updatedAt : nowIso();

  const nextDeal: MarchandDeal = {
    ...deal,
    city: normalizeString(deal.city) ?? "—",
    country: normalizeString(deal.country) ?? "FR",
    address: normalizeString(deal.address),
    zipCode: normalizeString(deal.zipCode),
    note: normalizeString(deal.note),
    prixAchat: normalizeNumber(deal.prixAchat),
    surfaceM2: normalizeNumber(deal.surfaceM2),
    prixReventeCible: normalizeNumber(deal.prixReventeCible),
    createdAt,
    updatedAt,
  };

  let nextDeals: MarchandDeal[];
  if (idx === -1) {
    nextDeals = [...snap.deals, nextDeal];
  } else {
    nextDeals = snap.deals.map((d) => (d.id === deal.id ? { ...d, ...nextDeal } : d));
  }

  const next: MarchandSnapshotV1 = normalizeSnapshot({
    ...snap,
    deals: nextDeals,
    // si aucun actif, on met celui-ci
    activeDealId: snap.activeDealId ?? nextDeal.id,
  });

  writeSnapshot(next);
}

export function setActiveDeal(dealId: string) {
  const snap = readRaw();
  const exists = snap.deals.some((d) => d.id === dealId);

  const next: MarchandSnapshotV1 = normalizeSnapshot({
    ...snap,
    activeDealId: exists ? dealId : snap.activeDealId,
  });

  writeSnapshot(next);
}

export function ensureActiveDeal(): MarchandDeal | null {
  const snap = readRaw();

  if (snap.deals.length === 0) {
    if (snap.activeDealId !== null) {
      writeSnapshot({ ...snap, activeDealId: null });
    }
    return null;
  }

  // si actif absent → premier
  if (!snap.activeDealId) {
    const first = snap.deals[0];
    writeSnapshot({ ...snap, activeDealId: first.id });
    return first;
  }

  // si actif invalide → premier
  const found = snap.deals.find((d) => d.id === snap.activeDealId);
  if (!found) {
    const first = snap.deals[0];
    writeSnapshot({ ...snap, activeDealId: first.id });
    return first;
  }

  return found;
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete deal + toutes ses données associées
// ─────────────────────────────────────────────────────────────────────────────

export function deleteDeal(dealId: string): void {
  const snap = readRaw();

  // Retirer le deal de la liste
  const nextDeals = snap.deals.filter((d) => d.id !== dealId);

  // Copie des maps sans l'entrée du deal supprimé
  const nextRentabilite = { ...snap.rentabiliteByDeal };
  delete nextRentabilite[dealId];

  const nextExecution = { ...snap.executionByDeal };
  delete nextExecution[dealId];

  const nextSortie = { ...snap.sortieByDeal };
  delete nextSortie[dealId];

  // Gérer activeDealId
  let nextActiveDealId: string | null = snap.activeDealId;

  if (snap.activeDealId === dealId) {
    // Si le deal supprimé était actif, choisir le premier restant ou null
    nextActiveDealId = nextDeals.length > 0 ? nextDeals[0].id : null;
  }

  const next: MarchandSnapshotV1 = normalizeSnapshot({
    ...snap,
    deals: nextDeals,
    activeDealId: nextActiveDealId,
    rentabiliteByDeal: nextRentabilite,
    executionByDeal: nextExecution,
    sortieByDeal: nextSortie,
  });

  writeSnapshot(next);
}

// ─────────────────────────────────────────────────────────────────────────────
// Patch functions par module
// ─────────────────────────────────────────────────────────────────────────────

export function patchRentabiliteForDeal(dealId: string, patch: Partial<RentabiliteSaved>) {
  const snap = readRaw();
  const prev = snap.rentabiliteByDeal[dealId] ?? ({} as RentabiliteSaved);

  const next: MarchandSnapshotV1 = normalizeSnapshot({
    ...snap,
    rentabiliteByDeal: {
      ...snap.rentabiliteByDeal,
      [dealId]: { ...prev, ...patch } as RentabiliteSaved,
    },
  });

  writeSnapshot(next);
}

export function patchExecutionForDeal(dealId: string, patch: Partial<ExecutionSaved>) {
  const snap = readRaw();
  const prev = snap.executionByDeal[dealId] ?? ({} as ExecutionSaved);

  const next: MarchandSnapshotV1 = normalizeSnapshot({
    ...snap,
    executionByDeal: {
      ...snap.executionByDeal,
      [dealId]: { ...prev, ...patch } as ExecutionSaved,
    },
  });

  writeSnapshot(next);
}

export function patchSortieForDeal(dealId: string, patch: Partial<SortieSaved>) {
  const snap = readRaw();
  const prev = snap.sortieByDeal[dealId] ?? ({} as SortieSaved);

  const next: MarchandSnapshotV1 = normalizeSnapshot({
    ...snap,
    sortieByDeal: {
      ...snap.sortieByDeal,
      [dealId]: { ...prev, ...patch } as SortieSaved,
    },
  });

  writeSnapshot(next);
}
