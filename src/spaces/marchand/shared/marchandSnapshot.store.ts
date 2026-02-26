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

  address?: string;
  zipCode?: string;
  city?: string;
  country?: string;

  prixAchat?: number;
  surfaceM2?: number;
  prixReventeCible?: number;
  note?: string;

  status: MarchandDealStatus;
  createdAt: string;
  updatedAt: string;
};

export type TaxRegime = "marchand" | "particulier" | "societe_is";

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
  inputs: unknown;
  taxRegime: TaxRegime;
  taxConfig: TaxConfig;
  computed?: unknown;
};

export type ExecutionSaved = {
  global?: {
    startDate: string;
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

/** v1: Due Diligence persisté par deal */
export type DueDiligenceSaved = {
  state?: unknown;
  missingCritical?: string[];
  missingImportant?: string[];
  missingOptional?: string[];
  updatedAt?: string;
};

/** v1: Marché/Risques persisté par deal */
export type MarcheRisquesSaved = {
  data?: unknown;
  scoreGlobal?: number;
  breakdown?: {
    demande?: number;
    offre?: number;
    accessibilite?: number;
    environnement?: number;
  };
  updatedAt?: string;
};

export type MarchandSnapshotV1 = {
  version: 1;
  updatedAt: string;
  activeDealId: string | null;
  deals: MarchandDeal[];

  rentabiliteByDeal: Record<string, RentabiliteSaved | undefined>;
  executionByDeal: Record<string, ExecutionSaved | undefined>;
  sortieByDeal: Record<string, SortieSaved | undefined>;
  dueDiligenceByDeal: Record<string, DueDiligenceSaved | undefined>;
  marcheRisquesByDeal: Record<string, MarcheRisquesSaved | undefined>;
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
  dueDiligenceByDeal: {},
  marcheRisquesByDeal: {},
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

    out.push({
      id: d.id,
      title: d.title,
      address: normalizeString(d.address),
      zipCode: normalizeString(d.zipCode),
      city: normalizeString(d.city) ?? "—",
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

function normalizeSnapshot(s: MarchandSnapshotV1): MarchandSnapshotV1 {
  const deals = sanitizeDeals(s.deals);
  const ids = new Set(deals.map((d) => d.id));

  const activeDealId =
    s.activeDealId && ids.has(s.activeDealId) ? s.activeDealId : null;

  return {
    version: 1,
    updatedAt: isNonEmptyString(s.updatedAt) ? s.updatedAt : nowIso(),
    activeDealId,
    deals,
    rentabiliteByDeal: pruneMapToDeals(s.rentabiliteByDeal ?? {}, ids),
    executionByDeal: pruneMapToDeals(s.executionByDeal ?? {}, ids),
    sortieByDeal: pruneMapToDeals(s.sortieByDeal ?? {}, ids),
    dueDiligenceByDeal: pruneMapToDeals(s.dueDiligenceByDeal ?? {}, ids),
    marcheRisquesByDeal: pruneMapToDeals(s.marcheRisquesByDeal ?? {}, ids),
  };
}

function safeParse(json: string | null): MarchandSnapshotV1 | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Partial<MarchandSnapshotV1>;
    if (!parsed || parsed.version !== 1) return null;

    // Backward compat: anciennes clés absentes → {}
    const candidate: MarchandSnapshotV1 = {
      version: 1,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : nowIso(),
      activeDealId: (parsed.activeDealId ?? null) as string | null,
      deals: (parsed.deals ?? []) as MarchandDeal[],
      rentabiliteByDeal: (parsed.rentabiliteByDeal ?? {}) as Record<string, RentabiliteSaved | undefined>,
      executionByDeal: (parsed.executionByDeal ?? {}) as Record<string, ExecutionSaved | undefined>,
      sortieByDeal: (parsed.sortieByDeal ?? {}) as Record<string, SortieSaved | undefined>,
      dueDiligenceByDeal: (parsed.dueDiligenceByDeal ?? {}) as Record<string, DueDiligenceSaved | undefined>,
      marcheRisquesByDeal: (parsed.marcheRisquesByDeal ?? {}) as Record<string, MarcheRisquesSaved | undefined>,
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
  window.dispatchEvent(new CustomEvent(MARCHAND_SNAPSHOT_EVENT));
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export function readMarchandSnapshot(): MarchandSnapshotV1 {
  return readRaw();
}

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

  writeSnapshot(
    normalizeSnapshot({
      ...snap,
      deals: nextDeals,
      activeDealId: snap.activeDealId ?? nextDeal.id,
    })
  );
}

export function setActiveDeal(dealId: string) {
  const snap = readRaw();
  const exists = snap.deals.some((d) => d.id === dealId);

  writeSnapshot(
    normalizeSnapshot({
      ...snap,
      activeDealId: exists ? dealId : snap.activeDealId,
    })
  );
}

export function ensureActiveDeal(): MarchandDeal | null {
  const snap = readRaw();

  if (snap.deals.length === 0) {
    if (snap.activeDealId !== null) {
      writeSnapshot({ ...snap, activeDealId: null });
    }
    return null;
  }

  if (!snap.activeDealId) {
    const first = snap.deals[0];
    writeSnapshot({ ...snap, activeDealId: first.id });
    return first;
  }

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

  const nextDeals = snap.deals.filter((d) => d.id !== dealId);

  const nextRentabilite = { ...snap.rentabiliteByDeal };
  delete nextRentabilite[dealId];
  const nextExecution = { ...snap.executionByDeal };
  delete nextExecution[dealId];
  const nextSortie = { ...snap.sortieByDeal };
  delete nextSortie[dealId];
  const nextDD = { ...snap.dueDiligenceByDeal };
  delete nextDD[dealId];
  const nextMR = { ...snap.marcheRisquesByDeal };
  delete nextMR[dealId];

  let nextActiveDealId: string | null = snap.activeDealId;
  if (snap.activeDealId === dealId) {
    nextActiveDealId = nextDeals.length > 0 ? nextDeals[0].id : null;
  }

  writeSnapshot(
    normalizeSnapshot({
      ...snap,
      deals: nextDeals,
      activeDealId: nextActiveDealId,
      rentabiliteByDeal: nextRentabilite,
      executionByDeal: nextExecution,
      sortieByDeal: nextSortie,
      dueDiligenceByDeal: nextDD,
      marcheRisquesByDeal: nextMR,
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Patch functions par module
// ─────────────────────────────────────────────────────────────────────────────

export function patchRentabiliteForDeal(dealId: string, patch: Partial<RentabiliteSaved>) {
  const snap = readRaw();
  const prev = snap.rentabiliteByDeal[dealId] ?? ({} as RentabiliteSaved);

  writeSnapshot(
    normalizeSnapshot({
      ...snap,
      rentabiliteByDeal: {
        ...snap.rentabiliteByDeal,
        [dealId]: { ...prev, ...patch } as RentabiliteSaved,
      },
    })
  );
}

export function patchExecutionForDeal(dealId: string, patch: Partial<ExecutionSaved>) {
  const snap = readRaw();
  const prev = snap.executionByDeal[dealId] ?? ({} as ExecutionSaved);

  writeSnapshot(
    normalizeSnapshot({
      ...snap,
      executionByDeal: {
        ...snap.executionByDeal,
        [dealId]: { ...prev, ...patch } as ExecutionSaved,
      },
    })
  );
}

export function patchSortieForDeal(dealId: string, patch: Partial<SortieSaved>) {
  const snap = readRaw();
  const prev = snap.sortieByDeal[dealId] ?? ({} as SortieSaved);

  writeSnapshot(
    normalizeSnapshot({
      ...snap,
      sortieByDeal: {
        ...snap.sortieByDeal,
        [dealId]: { ...prev, ...patch } as SortieSaved,
      },
    })
  );
}

export function patchDueDiligenceForDeal(dealId: string, patch: Partial<DueDiligenceSaved>) {
  const snap = readRaw();
  const prev = snap.dueDiligenceByDeal[dealId] ?? {};

  writeSnapshot(
    normalizeSnapshot({
      ...snap,
      dueDiligenceByDeal: {
        ...snap.dueDiligenceByDeal,
        [dealId]: { ...prev, ...patch },
      },
    })
  );
}

export function patchMarcheRisquesForDeal(dealId: string, patch: Partial<MarcheRisquesSaved>) {
  const snap = readRaw();
  const prev = snap.marcheRisquesByDeal[dealId] ?? {};

  writeSnapshot(
    normalizeSnapshot({
      ...snap,
      marcheRisquesByDeal: {
        ...snap.marcheRisquesByDeal,
        [dealId]: { ...prev, ...patch },
      },
    })
  );
}