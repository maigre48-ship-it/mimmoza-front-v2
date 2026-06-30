// src/spaces/apporteur/shared/apporteurDeals.store.ts

const STORAGE_KEY = "mimmoza.apporteur.deals.v1";

import { userStorage } from "@/lib/storage/userScopedStorage";

export type ApporteurDealStatus =
  | "depose"
  | "en_etude"
  | "qualifie"
  | "transmis_promoteur"
  | "refuse";

export type ApporteurDeal = {
  id: string;
  createdAt: string;
  updatedAt: string;
  source: "apporteur";
  apporteurName?: string;
  apporteurEmail?: string;
  apporteurPhone?: string;
  adresse: string;
  commune?: string;
  typeBien: "terrain" | "maison" | "immeuble" | "autre";
  surfaceTerrainM2?: number;
  prixVendeur?: number;
  commentaire?: string;
  status: ApporteurDealStatus;
  promoteurStudyId?: string;
};

// ✅ Fix : reformulé sur deux lignes pour éviter le bug esbuild avec > & {
type _ApporteurDealBase = Omit<ApporteurDeal, "id" | "createdAt" | "updatedAt" | "source" | "status">;
export type CreateApporteurDealInput = _ApporteurDealBase & { status?: ApporteurDealStatus };

function readAll(): ApporteurDeal[] {
  try {
    const raw = userStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as ApporteurDeal[];
  } catch {
    return [];
  }
}

function writeAll(deals: ApporteurDeal[]): void {
  try {
    userStorage.setItem(STORAGE_KEY, JSON.stringify(deals));
  } catch {
    console.error("[apporteurDeals.store] Impossible d'écrire dans localStorage");
  }
}

function generateId(): string {
  return "apporteur_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

export function createApporteurDeal(input: CreateApporteurDealInput): ApporteurDeal {
  const now = new Date().toISOString();
  const deal: ApporteurDeal = {
    ...input,
    id: generateId(),
    createdAt: now,
    updatedAt: now,
    source: "apporteur",
    status: input.status ?? "depose",
  };
  const deals = readAll();
  deals.unshift(deal);
  writeAll(deals);
  return deal;
}

export function listApporteurDeals(): ApporteurDeal[] {
  return readAll();
}

/** Récupère un deal par son id. Retourne null si introuvable. */
export function getApporteurDeal(id: string): ApporteurDeal | null {
  const deals = readAll();
  return deals.find((d) => d.id === id) ?? null;
}

export function updateApporteurDeal(
  id: string,
  patch: Partial<Omit<ApporteurDeal, "id" | "createdAt" | "source">>
): ApporteurDeal | null {
  const deals = readAll();
  const idx = deals.findIndex((d) => d.id === id);
  if (idx < 0) return null;
  const updated: ApporteurDeal = {
    ...deals[idx],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  deals[idx] = updated;
  writeAll(deals);
  return updated;
}

export function deleteApporteurDeal(id: string): boolean {
  const deals = readAll();
  const next = deals.filter((d) => d.id !== id);
  if (next.length === deals.length) return false;
  writeAll(next);
  return true;
}