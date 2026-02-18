/**
 * marchandDealContext.store.ts
 * Bridge store — persiste le deal actif (id + métadonnées enrichies)
 * et notifie les autres pages/onglets via CustomEvent (same-tab) + StorageEvent (cross-tab).
 *
 * Les métadonnées servent de "seed" pour que Sourcing/Qualification puissent
 * pré-remplir leurs formulaires sans importer le snapshot Pipeline complet.
 */

const LS_KEY = "mimmoza.marchand.dealContext.v1";
const NOTIFY_EVENT = "mimmoza:marchand:dealContext";

/* ── Types ─────────────────────────────────────────────── */

export interface DealContextMeta {
  title?: string;
  stage?: string;
  address?: string;
  zipCode?: string;
  city?: string;
  purchasePrice?: number;
  surface?: number;
  resaleTarget?: number;
  note?: string;
}

export interface DealContextSnapshot {
  activeDealId: string | null;
  meta?: DealContextMeta;
  updatedAt: string;
}

/* ── Internal helpers ──────────────────────────────────── */

function safeParse(): DealContextSnapshot {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { activeDealId: null, updatedAt: new Date().toISOString() };
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) throw new Error("bad shape");

    // Compat ancien format plat { activeDealId, title, stage, updatedAt }
    if (parsed.title !== undefined && parsed.meta === undefined) {
      return {
        activeDealId: parsed.activeDealId ?? null,
        meta: { title: parsed.title, stage: parsed.stage },
        updatedAt: parsed.updatedAt ?? new Date().toISOString(),
      };
    }

    // Compat ancien meta.price → meta.purchasePrice
    if (parsed.meta && typeof parsed.meta === "object") {
      if (parsed.meta.price !== undefined && parsed.meta.purchasePrice === undefined) {
        parsed.meta.purchasePrice = parsed.meta.price;
        delete parsed.meta.price;
      }
    }

    return {
      activeDealId: parsed.activeDealId ?? null,
      meta: parsed.meta ?? undefined,
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    };
  } catch {
    return { activeDealId: null, updatedAt: new Date().toISOString() };
  }
}

function persist(snapshot: DealContextSnapshot): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(snapshot));
  } catch {
    /* quota exceeded — silent */
  }
}

function broadcastSnapshot(snapshot: DealContextSnapshot): void {
  window.dispatchEvent(new CustomEvent(NOTIFY_EVENT, { detail: snapshot }));
  try {
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: LS_KEY,
        newValue: JSON.stringify(snapshot),
        storageArea: localStorage,
      }),
    );
  } catch {
    /* certains navigateurs anciens ne supportent pas le constructeur StorageEvent */
  }
}

/* ── Public API ────────────────────────────────────────── */

export function getActiveDealId(): string | null {
  return safeParse().activeDealId;
}

export function getDealContextSnapshot(): DealContextSnapshot {
  return safeParse();
}

export function getDealContextMeta(): DealContextMeta | undefined {
  return safeParse().meta;
}

export function setActiveDealId(
  dealId: string | null,
  meta?: DealContextMeta,
): void {
  const snapshot: DealContextSnapshot = {
    activeDealId: dealId,
    meta: meta ?? undefined,
    updatedAt: new Date().toISOString(),
  };
  persist(snapshot);
  broadcastSnapshot(snapshot);
}

/**
 * Met à jour uniquement la meta sans changer l'activeDealId.
 * Utile pour patcher un champ (ex: city après géocodage zipCode)
 * sans re-déclencher un changement complet de deal.
 */
export function patchDealContextMeta(patch: Partial<DealContextMeta>): void {
  const current = safeParse();
  if (!current.activeDealId) return;
  const snapshot: DealContextSnapshot = {
    ...current,
    meta: { ...current.meta, ...patch },
    updatedAt: new Date().toISOString(),
  };
  persist(snapshot);
  broadcastSnapshot(snapshot);
}

/* ── Subscribe ─────────────────────────────────────────── */

type Listener = (snapshot: DealContextSnapshot) => void;

export function subscribe(listener: Listener): () => void {
  const onCustom = (e: Event) => {
    const detail = (e as CustomEvent<DealContextSnapshot>).detail;
    listener(detail);
  };
  window.addEventListener(NOTIFY_EVENT, onCustom);

  const onStorage = (e: StorageEvent) => {
    if (e.key === LS_KEY) listener(safeParse());
  };
  window.addEventListener("storage", onStorage);

  return () => {
    window.removeEventListener(NOTIFY_EVENT, onCustom);
    window.removeEventListener("storage", onStorage);
  };
}