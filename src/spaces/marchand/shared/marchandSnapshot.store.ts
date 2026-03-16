/* src/spaces/marchand/shared/marchandSnapshot.store.ts
 *
 * Snapshot localStorage (v1) pour l'espace Marchand.
 * 100% TypeScript: AUCUN JSX dans ce fichier.
 */

import type {
  TravauxSimulationV1,
  TravauxSimulationComputed,
} from "../modules/execution/services/travauxSimulation.types";

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

  premiumUnlocked?: boolean;
  premiumUnlockedAt?: string | null;
  premiumUnlockLedgerId?: string | null;

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

export type RentabiliteInputs = {
  travauxEstimes?: number;
  travauxSource?: "manual" | "simulation";
  [k: string]: unknown;
};

export type RentabiliteSaved = {
  inputs: RentabiliteInputs;
  taxRegime: TaxRegime;
  taxConfig: TaxConfig;
  computed?: unknown;
  travauxSource?: "manual" | "simulation";
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
  travaux?: {
    input: TravauxSimulationV1;
    computed: TravauxSimulationComputed;
    updatedAt: string;
    sourceMode?: "simple" | "expert";
  };
};

export type SortieSaved = {
  holdingMensuel: number;
  scenarios: unknown[];
};

export type DueDiligenceSaved = {
  state?: unknown;
  missingCritical?: string[];
  missingImportant?: string[];
  missingOptional?: string[];
  updatedAt?: string;
};

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

/**
 * Normalise les chaînes métier.
 * Important :
 * - ne jamais stocker de placeholder d'affichage ("—", "-", "ND", etc.)
 * - ne garder que des vraies valeurs utiles au métier
 */
const normalizeString = (v: unknown): string | undefined => {
  if (!isNonEmptyString(v)) return undefined;

  const s = v.trim();

  if (
    s === "—" ||
    s === "-" ||
    s === "--" ||
    s.toLowerCase() === "nd" ||
    s.toLowerCase() === "n/d" ||
    s.toLowerCase() === "non disponible" ||
    s.toLowerCase() === "non renseigne" ||
    s.toLowerCase() === "non renseigné" ||
    s.toLowerCase() === "null" ||
    s.toLowerCase() === "undefined"
  ) {
    return undefined;
  }

  return s;
};

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
      id: d.id.trim(),
      title: d.title.trim(),
      address: normalizeString(d.address),
      zipCode: normalizeString(d.zipCode),
      city: normalizeString(d.city),
      country: normalizeString(d.country) ?? "FR",
      prixAchat: normalizeNumber(d.prixAchat),
      surfaceM2: normalizeNumber(d.surfaceM2),
      prixReventeCible: normalizeNumber(d.prixReventeCible),
      note: normalizeString(d.note),
      premiumUnlocked:
        typeof d.premiumUnlocked === "boolean" ? d.premiumUnlocked : undefined,
      premiumUnlockedAt:
        typeof d.premiumUnlockedAt === "string" ? d.premiumUnlockedAt : null,
      premiumUnlockLedgerId:
        typeof d.premiumUnlockLedgerId === "string"
          ? d.premiumUnlockLedgerId
          : null,
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

    const candidate: MarchandSnapshotV1 = {
      version: 1,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : nowIso(),
      activeDealId: (parsed.activeDealId ?? null) as string | null,
      deals: (parsed.deals ?? []) as MarchandDeal[],
      rentabiliteByDeal:
        (parsed.rentabiliteByDeal ?? {}) as Record<
          string,
          RentabiliteSaved | undefined
        >,
      executionByDeal:
        (parsed.executionByDeal ?? {}) as Record<
          string,
          ExecutionSaved | undefined
        >,
      sortieByDeal:
        (parsed.sortieByDeal ?? {}) as Record<string, SortieSaved | undefined>,
      dueDiligenceByDeal:
        (parsed.dueDiligenceByDeal ?? {}) as Record<
          string,
          DueDiligenceSaved | undefined
        >,
      marcheRisquesByDeal:
        (parsed.marcheRisquesByDeal ?? {}) as Record<
          string,
          MarcheRisquesSaved | undefined
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

function writeSnapshot(next: MarchandSnapshotV1): void {
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

export function saveMarchandSnapshot(snapshot: MarchandSnapshotV1): void {
  writeSnapshot(snapshot);
}

export function resetMarchandSnapshot(): void {
  writeSnapshot(defaultSnapshot());
}

export function getMarchandDealById(dealId: string): MarchandDeal | null {
  const snap = readRaw();
  return snap.deals.find((d) => d.id === dealId) ?? null;
}

export function patchDeal(
  dealId: string,
  patch: Partial<Omit<MarchandDeal, "id" | "createdAt">>
): void {
  const snap = readRaw();
  const existing = snap.deals.find((d) => d.id === dealId);
  if (!existing) return;

  const nextDeal: MarchandDeal = {
    ...existing,
    ...patch,
    id: existing.id,
    title: normalizeString(patch.title ?? existing.title) ?? existing.title,
    address: normalizeString(patch.address ?? existing.address),
    zipCode: normalizeString(patch.zipCode ?? existing.zipCode),
    city: normalizeString(patch.city ?? existing.city),
    country: normalizeString(patch.country ?? existing.country) ?? "FR",
    note: normalizeString(patch.note ?? existing.note),
    prixAchat: normalizeNumber(
      patch.prixAchat !== undefined ? patch.prixAchat : existing.prixAchat
    ),
    surfaceM2: normalizeNumber(
      patch.surfaceM2 !== undefined ? patch.surfaceM2 : existing.surfaceM2
    ),
    prixReventeCible: normalizeNumber(
      patch.prixReventeCible !== undefined
        ? patch.prixReventeCible
        : existing.prixReventeCible
    ),
    premiumUnlocked:
      typeof patch.premiumUnlocked === "boolean"
        ? patch.premiumUnlocked
        : existing.premiumUnlocked,
    premiumUnlockedAt:
      patch.premiumUnlockedAt === undefined
        ? existing.premiumUnlockedAt
        : patch.premiumUnlockedAt,
    premiumUnlockLedgerId:
      patch.premiumUnlockLedgerId === undefined
        ? existing.premiumUnlockLedgerId
        : patch.premiumUnlockLedgerId,
    status: isDealStatus(patch.status) ? patch.status : existing.status,
    createdAt: existing.createdAt,
    updatedAt: nowIso(),
  };

  writeSnapshot({
    ...snap,
    deals: snap.deals.map((d) => (d.id === dealId ? nextDeal : d)),
  });
}

export function upsertDeal(deal: MarchandDeal): void {
  const snap = readRaw();
  const idx = snap.deals.findIndex((d) => d.id === deal.id);

  const createdAt = isNonEmptyString(deal.createdAt) ? deal.createdAt : nowIso();
  const updatedAt = isNonEmptyString(deal.updatedAt) ? deal.updatedAt : nowIso();

  const nextDeal: MarchandDeal = {
    ...deal,
    id: deal.id.trim(),
    title: deal.title.trim(),
    city: normalizeString(deal.city),
    country: normalizeString(deal.country) ?? "FR",
    address: normalizeString(deal.address),
    zipCode: normalizeString(deal.zipCode),
    note: normalizeString(deal.note),
    prixAchat: normalizeNumber(deal.prixAchat),
    surfaceM2: normalizeNumber(deal.surfaceM2),
    prixReventeCible: normalizeNumber(deal.prixReventeCible),
    premiumUnlocked:
      typeof deal.premiumUnlocked === "boolean" ? deal.premiumUnlocked : undefined,
    premiumUnlockedAt:
      typeof deal.premiumUnlockedAt === "string" ? deal.premiumUnlockedAt : null,
    premiumUnlockLedgerId:
      typeof deal.premiumUnlockLedgerId === "string"
        ? deal.premiumUnlockLedgerId
        : null,
    createdAt,
    updatedAt,
  };

  const nextDeals =
    idx === -1
      ? [...snap.deals, nextDeal]
      : snap.deals.map((d) => (d.id === deal.id ? { ...d, ...nextDeal } : d));

  writeSnapshot(
    normalizeSnapshot({
      ...snap,
      deals: nextDeals,
      activeDealId: snap.activeDealId ?? nextDeal.id,
    })
  );
}

export function setActiveDeal(dealId: string): void {
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

export function patchRentabiliteForDeal(
  dealId: string,
  patch: Partial<RentabiliteSaved>
): void {
  const snap = readRaw();

  const prev = snap.rentabiliteByDeal[dealId];

  const prevInputs: RentabiliteInputs =
    prev?.inputs && typeof prev.inputs === "object" && !Array.isArray(prev.inputs)
      ? prev.inputs
      : {};

  const patchInputs: RentabiliteInputs =
    patch.inputs && typeof patch.inputs === "object" && !Array.isArray(patch.inputs)
      ? patch.inputs
      : {};

  const mergedInputs: RentabiliteInputs = {
    ...prevInputs,
    ...patchInputs,
  };

  const next: RentabiliteSaved = {
    ...(prev ?? ({} as RentabiliteSaved)),
    ...patch,
    inputs: mergedInputs,
  };

  writeSnapshot(
    normalizeSnapshot({
      ...snap,
      rentabiliteByDeal: {
        ...snap.rentabiliteByDeal,
        [dealId]: next,
      },
    })
  );
}

export function patchExecutionForDeal(
  dealId: string,
  patch: Partial<ExecutionSaved>
): void {
  const snap = readRaw();
  const prev = snap.executionByDeal[dealId] ?? ({} as ExecutionSaved);

  writeSnapshot(
    normalizeSnapshot({
      ...snap,
      executionByDeal: {
        ...snap.executionByDeal,
        [dealId]: { ...prev, ...patch },
      },
    })
  );
}

export function patchSortieForDeal(
  dealId: string,
  patch: Partial<SortieSaved>
): void {
  const snap = readRaw();
  const prev = snap.sortieByDeal[dealId] ?? ({} as SortieSaved);

  writeSnapshot(
    normalizeSnapshot({
      ...snap,
      sortieByDeal: {
        ...snap.sortieByDeal,
        [dealId]: { ...prev, ...patch },
      },
    })
  );
}

export function patchDueDiligenceForDeal(
  dealId: string,
  patch: Partial<DueDiligenceSaved>
): void {
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

export function patchMarcheRisquesForDeal(
  dealId: string,
  patch: Partial<MarcheRisquesSaved>
): void {
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

// ─────────────────────────────────────────────────────────────────────────────
// Patch execution travaux (non destructif)
// ─────────────────────────────────────────────────────────────────────────────

export function patchExecutionTravaux(payload: {
  input: TravauxSimulationV1;
  computed: TravauxSimulationComputed;
  updatedAt?: string;
  sourceMode?: "simple" | "expert";
}): void {
  const snap = readRaw();
  const activeDealId = snap.activeDealId;
  if (!activeDealId) return;

  const prev = snap.executionByDeal[activeDealId] ?? ({} as ExecutionSaved);

  const nextExecution: ExecutionSaved = {
    ...prev,
    travaux: {
      input: payload.input,
      computed: payload.computed,
      updatedAt: payload.updatedAt ?? nowIso(),
      ...(payload.sourceMode ? { sourceMode: payload.sourceMode } : {}),
    },
  };

  writeSnapshot(
    normalizeSnapshot({
      ...snap,
      executionByDeal: {
        ...snap.executionByDeal,
        [activeDealId]: nextExecution,
      },
    })
  );
}