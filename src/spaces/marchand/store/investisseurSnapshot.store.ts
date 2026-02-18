// src/spaces/marchand/store/investisseurSnapshot.store.ts

// ─── Types ───────────────────────────────────────────────────────────

export type PropertyType = "appartement" | "maison" | "terrain" | "immeuble" | "local";
export type Condition = "neuf" | "bon" | "a_renover" | "a_rehabiliter";
export type Strategie = "location" | "revente" | "patrimonial";
export type Financement = "cash" | "credit";
export type Grade = "A" | "B" | "C" | "D" | "E";
export type Verdict = "GO" | "GO_AVEC_RESERVES" | "NO_GO";
export type Severity = "info" | "warn" | "blocker";

export interface PropertyDraft {
  address?: string;
  city?: string;
  zipCode?: string;
  lat?: number;
  lng?: number;
  propertyType?: PropertyType;
  surfaceHabitable?: number;
  priceAsked?: number;
  rooms?: number;
  dpe?: string;
  condition?: Condition;
  chargesMensuelles?: number;
  taxeFonciere?: number;
  rawAdText?: string;
}

export interface Assumptions {
  travauxBudget?: number;
  loyerMensuelCible?: number;
  horizonMois?: number;
  strategie?: Strategie;
  apport?: number;
  financement?: Financement;
  tauxCredit?: number;
  dureeMois?: number;
}

export interface SmartScorePillar {
  key: string;
  label: string;
  score: number;
  max: number;
  details?: string[];
}

export interface SmartScoreResult {
  score: number;
  grade: Grade;
  verdict: Verdict;
  pillars: SmartScorePillar[];
}

export interface MissingDataItem {
  key: string;
  label: string;
  severity: Severity;
}

export interface InvestisseurSnapshot {
  propertyDraft: PropertyDraft;
  assumptions: Assumptions;
  enriched: {
    market?: any;
    insee?: any;
    risques?: any;
  };
  smartscore?: SmartScoreResult;
  missingData: MissingDataItem[];
  updatedAt: string;
}

// ─── Storage key ─────────────────────────────────────────────────────

const STORAGE_KEY = "mimmoza.investisseur.snapshot.v1";

// ─── Default state ───────────────────────────────────────────────────

export function createDefaultSnapshot(): InvestisseurSnapshot {
  return {
    propertyDraft: {},
    assumptions: {},
    enriched: {},
    smartscore: undefined,
    missingData: [],
    updatedAt: new Date().toISOString(),
  };
}

// ─── Read / Write ────────────────────────────────────────────────────

export function loadSnapshot(): InvestisseurSnapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultSnapshot();
    const parsed = JSON.parse(raw) as InvestisseurSnapshot;
    if (!parsed.propertyDraft || !parsed.assumptions) return createDefaultSnapshot();
    return parsed;
  } catch {
    return createDefaultSnapshot();
  }
}

export function saveSnapshot(snapshot: InvestisseurSnapshot): void {
  try {
    snapshot.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    // Dispatch un CustomEvent pour notifier le même onglet (storage event ne se déclenche pas intra-tab)
    window.dispatchEvent(new CustomEvent("mimmoza:investisseur-snapshot-updated"));
  } catch (e) {
    console.error("[investisseurSnapshot] save failed", e);
  }
}

export function resetSnapshot(): InvestisseurSnapshot {
  const fresh = createDefaultSnapshot();
  saveSnapshot(fresh);
  return fresh;
}

// ─── Partial updaters ────────────────────────────────────────────────

export function updatePropertyDraft(
  snapshot: InvestisseurSnapshot,
  patch: Partial<PropertyDraft>
): InvestisseurSnapshot {
  return {
    ...snapshot,
    propertyDraft: { ...snapshot.propertyDraft, ...patch },
    smartscore: undefined,
  };
}

export function updateAssumptions(
  snapshot: InvestisseurSnapshot,
  patch: Partial<Assumptions>
): InvestisseurSnapshot {
  return {
    ...snapshot,
    assumptions: { ...snapshot.assumptions, ...patch },
    smartscore: undefined,
  };
}

export function updateEnriched(
  snapshot: InvestisseurSnapshot,
  patch: Partial<InvestisseurSnapshot["enriched"]>
): InvestisseurSnapshot {
  return {
    ...snapshot,
    enriched: { ...snapshot.enriched, ...patch },
    smartscore: undefined,
  };
}

// ─── Minimum viable check ───────────────────────────────────────────

export function isMinimumViable(snapshot: InvestisseurSnapshot): boolean {
  const d = snapshot.propertyDraft;
  const a = snapshot.assumptions;
  const hasLocation = !!(d.address || (d.lat && d.lng));
  const hasSurface = !!(d.surfaceHabitable && d.surfaceHabitable > 0);
  const hasPriceOrLoyer = !!(
    (d.priceAsked && d.priceAsked > 0) ||
    (a.loyerMensuelCible && a.loyerMensuelCible > 0)
  );
  return hasLocation && hasSurface && hasPriceOrLoyer;
}