// ============================================================================
// investisseurSnapshot.store.ts
// src/spaces/investisseur/shared/investisseurSnapshot.store.ts
//
// Store CANONIQUE Investisseur (localStorage) — source de vérité unique.
// Key: mimmoza.investisseur.snapshot.v1
//
// Objectif:
// - Centraliser toutes les données Investisseur au même endroit.
// - Les pages Investisseur écrivent ici.
// - La synthèse IA Investisseur lit UNIQUEMENT ce snapshot.
//
// Migration douce (optionnelle):
// - Importe les anciennes clés mimmoza.investisseur.rentabilite.v1.* dans projects[*].
//
// NOTE: Pas de dépendance React — utilisable partout.
// ============================================================================

import type {
  TravauxSimulationV1,
  ComputedTravaux,
} from "./travauxSimulation.types";

export const INVESTISSEUR_SNAPSHOT_KEY = "mimmoza.investisseur.snapshot.v1";
export const INVESTISSEUR_LEGACY_RENTABILITE_PREFIX =
  "mimmoza.investisseur.rentabilite.v1.";
export const PENDING_OPPORTUNITY_STORAGE_KEY =
  "mimmoza.pendingOpportunityDeal";

export type InvestisseurAiSummary = {
  text: string;
  model?: string;
  promptVersion?: string;
  sourceHash?: string;
  generatedAt: string; // ISO
  warnings?: string[];
  sourcesUsed?: string[];
};

export type InvestisseurTravauxSnapshot = {
  input: TravauxSimulationV1;
  computed: ComputedTravaux;
  updatedAt: string; // ISO
};

export type InvestisseurExecutionSnapshot = {
  travaux?: InvestisseurTravauxSnapshot;
};

export type InvestisseurProject = {
  id: string;
  label?: string;

  asset?: {
    address?: string;
    city?: string;
    zip?: string;
    lat?: number;
    lng?: number;
    type?: string; // appart/maison/immeuble/...
    surfaceM2?: number;
  };

  acquisition?: {
    price?: number;
    notaryFees?: number;
    worksBudget?: number;
    furnished?: boolean;
  };

  financing?: {
    loanAmount?: number;
    ratePct?: number;
    durationMonths?: number;
    equity?: number;
    monthlyPayment?: number;
    insuranceMonthly?: number;
  };

  operation?: {
    rentMonthly?: number;
    rentAnnual?: number;
    occupancyRatePct?: number;
    chargesMonthly?: number;
    chargesAnnual?: number;
    taxFonciereAnnual?: number;
    insuranceAnnual?: number;
    propertyManagementPct?: number;
  };

  kpis?: {
    yieldGrossPct?: number;
    yieldNetPct?: number;
    cashflowMonthly?: number;
    roiPct?: number;
    irrPct?: number;
    dscr?: number;
    ltvPct?: number;
  };

  execution?: InvestisseurExecutionSnapshot;

  market?: Record<string, unknown>;
  risks?: Record<string, unknown>;

  ai?: {
    summary?: InvestisseurAiSummary;
    lastInputHash?: string;
  };

  updatedAt: string; // ISO
};

export type InvestisseurSnapshot = {
  version: "1.0.0";
  updatedAt: string; // ISO
  activeProjectId: string | null;
  projects: Record<string, InvestisseurProject>;
  events: Array<{ at: string; type: string; projectId?: string; message?: string }>;
};

export type PendingOpportunityDeal = {
  source: "veille-marche";
  canonicalKey: string;
  title: string;
  city: string | null;
  zipCode: string;
  price: number | null;
  surfaceM2: number | null;
  opportunityScore: number;
  opportunityBucket: "faible" | "moyenne" | "forte";
  pricePosition: string;
  priceDropInfo: string;
  diffusionInfo: string;
  createdAt: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Utils
// ─────────────────────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

function safeParseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function makeProjectId(prefix = "inv"): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${rand}`;
}

/**
 * Normalize an execution block read from raw JSON (localStorage).
 * Returns undefined if the input is not a valid object or has no valid travaux.
 */
function normalizeExecution(raw: unknown): InvestisseurExecutionSnapshot | undefined {
  if (!isObject(raw)) return undefined;

  const travauxRaw = raw["travaux"];
  if (!isObject(travauxRaw)) {
    // execution exists but no travaux — preserve the shell
    return {};
  }

  const inputRaw = travauxRaw["input"];
  const computedRaw = travauxRaw["computed"];

  if (!isObject(inputRaw) || !isObject(computedRaw)) return {};

  const updatedAt =
    typeof travauxRaw["updatedAt"] === "string"
      ? travauxRaw["updatedAt"]
      : nowIso();

  return {
    travaux: {
      input: inputRaw as unknown as TravauxSimulationV1,
      computed: computedRaw as unknown as ComputedTravaux,
      updatedAt,
    },
  };
}

function ensureSnapshotShape(input: unknown): InvestisseurSnapshot {
  const base: InvestisseurSnapshot = {
    version: "1.0.0",
    updatedAt: nowIso(),
    activeProjectId: null,
    projects: {},
    events: [],
  };

  if (!isObject(input)) return base;

  const projects = isObject(input["projects"])
    ? (input["projects"] as Record<string, unknown>)
    : {};
  const normalizedProjects: Record<string, InvestisseurProject> = {};

  for (const [pid, pRaw] of Object.entries(projects)) {
    if (!isObject(pRaw)) continue;
    const p = pRaw as Record<string, unknown>;
    const id = typeof p["id"] === "string" ? p["id"] : pid;

    normalizedProjects[id] = {
      id,
      label: typeof p["label"] === "string" ? p["label"] : undefined,
      asset: isObject(p["asset"]) ? (p["asset"] as InvestisseurProject["asset"]) : undefined,
      acquisition: isObject(p["acquisition"])
        ? (p["acquisition"] as InvestisseurProject["acquisition"])
        : undefined,
      financing: isObject(p["financing"])
        ? (p["financing"] as InvestisseurProject["financing"])
        : undefined,
      operation: isObject(p["operation"])
        ? (p["operation"] as InvestisseurProject["operation"])
        : undefined,
      kpis: isObject(p["kpis"]) ? (p["kpis"] as InvestisseurProject["kpis"]) : undefined,
      execution: normalizeExecution(p["execution"]),
      market: isObject(p["market"]) ? (p["market"] as Record<string, unknown>) : undefined,
      risks: isObject(p["risks"]) ? (p["risks"] as Record<string, unknown>) : undefined,
      ai: isObject(p["ai"]) ? (p["ai"] as InvestisseurProject["ai"]) : undefined,
      updatedAt: typeof p["updatedAt"] === "string" ? p["updatedAt"] : nowIso(),
    };
  }

  const activeProjectId =
    typeof input["activeProjectId"] === "string" ? input["activeProjectId"] : null;

  const eventsRaw = input["events"];
  const events = Array.isArray(eventsRaw)
    ? eventsRaw
        .filter(
          (e: unknown): e is Record<string, unknown> =>
            isObject(e) &&
            typeof (e as Record<string, unknown>)["at"] === "string" &&
            typeof (e as Record<string, unknown>)["type"] === "string"
        )
        .slice(-200)
        .map((e) => ({
          at: e["at"] as string,
          type: e["type"] as string,
          projectId: typeof e["projectId"] === "string" ? e["projectId"] : undefined,
          message: typeof e["message"] === "string" ? e["message"] : undefined,
        }))
    : [];

  return {
    version: "1.0.0",
    updatedAt: typeof input["updatedAt"] === "string" ? input["updatedAt"] : nowIso(),
    activeProjectId,
    projects: normalizedProjects,
    events,
  };
}

// Stable canonicalization for hash
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value).sort())
      out[k] = canonicalize((value as Record<string, unknown>)[k]);
    return out;
  }
  return value;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─────────────────────────────────────────────────────────────────────────────
// Load / Save
// ─────────────────────────────────────────────────────────────────────────────

export function getInvestisseurSnapshot(): InvestisseurSnapshot {
  const raw = localStorage.getItem(INVESTISSEUR_SNAPSHOT_KEY);
  const parsed = safeParseJson<unknown>(raw);
  const snap = ensureSnapshotShape(parsed);

  // Migration douce si snapshot vide
  if (Object.keys(snap.projects).length === 0) {
    const migrated = migrateLegacyRentabiliteKeysIntoSnapshot(snap);
    if (migrated.didMigrate) {
      saveInvestisseurSnapshot(migrated.snapshot);
      return migrated.snapshot;
    }
  }

  return snap;
}

export function saveInvestisseurSnapshot(next: InvestisseurSnapshot): void {
  const safe = ensureSnapshotShape(next);
  safe.updatedAt = nowIso();
  localStorage.setItem(INVESTISSEUR_SNAPSHOT_KEY, JSON.stringify(safe));
}

export function setActiveInvestisseurProjectId(projectId: string | null): void {
  const snap = getInvestisseurSnapshot();
  snap.activeProjectId = projectId;
  saveInvestisseurSnapshot(snap);
}

export function upsertInvestisseurProject(
  projectId: string,
  patch: Partial<InvestisseurProject>
): InvestisseurProject {
  const snap = getInvestisseurSnapshot();
  const prev = snap.projects[projectId];

  const mergedExecution: InvestisseurExecutionSnapshot | undefined =
    patch.execution !== undefined || prev?.execution !== undefined
      ? {
          ...(prev?.execution ?? {}),
          ...(patch.execution ?? {}),
        }
      : undefined;

  const merged: InvestisseurProject = {
    id: projectId,
    label: patch.label ?? prev?.label,
    asset: { ...(prev?.asset ?? {}), ...(patch.asset ?? {}) },
    acquisition: { ...(prev?.acquisition ?? {}), ...(patch.acquisition ?? {}) },
    financing: { ...(prev?.financing ?? {}), ...(patch.financing ?? {}) },
    operation: { ...(prev?.operation ?? {}), ...(patch.operation ?? {}) },
    kpis: { ...(prev?.kpis ?? {}), ...(patch.kpis ?? {}) },
    execution: mergedExecution,
    market: patch.market ?? prev?.market,
    risks: patch.risks ?? prev?.risks,
    ai: { ...(prev?.ai ?? {}), ...(patch.ai ?? {}) },
    updatedAt: nowIso(),
  };

  snap.projects[projectId] = merged;
  if (!snap.activeProjectId) snap.activeProjectId = projectId;
  saveInvestisseurSnapshot(snap);
  return merged;
}

export function addInvestisseurEvent(e: {
  type: string;
  projectId?: string;
  message?: string;
}): void {
  const snap = getInvestisseurSnapshot();
  snap.events.push({ at: nowIso(), type: e.type, projectId: e.projectId, message: e.message });
  snap.events = snap.events.slice(-300);
  saveInvestisseurSnapshot(snap);
}

// ─────────────────────────────────────────────────────────────────────────────
// Opportunity handoff (Veille → Acquisition)
// ─────────────────────────────────────────────────────────────────────────────

export function createInvestisseurProjectFromOpportunity(
  deal: PendingOpportunityDeal
): InvestisseurProject {
  const snap = getInvestisseurSnapshot();

  const existingEntry = Object.entries(snap.projects).find(([, project]) => {
    const marketCanonical =
      typeof project.market?.["canonicalKey"] === "string"
        ? (project.market["canonicalKey"] as string)
        : undefined;

    return marketCanonical === deal.canonicalKey;
  });

  const projectId = existingEntry?.[0] ?? makeProjectId("deal");

  const patch: Partial<InvestisseurProject> = {
    label: deal.title,
    asset: {
      ...(existingEntry?.[1]?.asset ?? {}),
      city: deal.city ?? undefined,
      zip: deal.zipCode,
      type: "appartement",
      surfaceM2: deal.surfaceM2 ?? undefined,
    },
    acquisition: {
      ...(existingEntry?.[1]?.acquisition ?? {}),
      price: deal.price ?? undefined,
    },
    market: {
      ...(existingEntry?.[1]?.market ?? {}),
      source: deal.source,
      canonicalKey: deal.canonicalKey,
      opportunityScore: deal.opportunityScore,
      opportunityBucket: deal.opportunityBucket,
      pricePosition: deal.pricePosition,
      priceDropInfo: deal.priceDropInfo,
      diffusionInfo: deal.diffusionInfo,
      importedFromVeilleAt: nowIso(),
    },
  };

  const project = upsertInvestisseurProject(projectId, patch);
  setActiveInvestisseurProjectId(projectId);
  addInvestisseurEvent({
    type: existingEntry ? "veille_update_project" : "veille_create_project",
    projectId,
    message: existingEntry
      ? `Projet mis à jour depuis la veille marché : ${deal.title}`
      : `Projet créé depuis la veille marché : ${deal.title}`,
  });

  return project;
}

export function consumePendingOpportunityDealIntoSnapshot():
  | { ok: true; project: InvestisseurProject }
  | { ok: false; reason: "missing" | "invalid" | "storage_unavailable" } {
  try {
    const raw = sessionStorage.getItem(PENDING_OPPORTUNITY_STORAGE_KEY);
    if (!raw) return { ok: false, reason: "missing" };

    const parsed = safeParseJson<unknown>(raw);
    if (!isObject(parsed)) {
      sessionStorage.removeItem(PENDING_OPPORTUNITY_STORAGE_KEY);
      return { ok: false, reason: "invalid" };
    }

    const deal: PendingOpportunityDeal = {
      source: "veille-marche",
      canonicalKey:
        typeof parsed["canonicalKey"] === "string" ? parsed["canonicalKey"] : "",
      title: typeof parsed["title"] === "string" ? parsed["title"] : "Bien détecté",
      city: typeof parsed["city"] === "string" ? parsed["city"] : null,
      zipCode: typeof parsed["zipCode"] === "string" ? parsed["zipCode"] : "",
      price: typeof parsed["price"] === "number" ? parsed["price"] : null,
      surfaceM2:
        typeof parsed["surfaceM2"] === "number" ? parsed["surfaceM2"] : null,
      opportunityScore:
        typeof parsed["opportunityScore"] === "number"
          ? parsed["opportunityScore"]
          : 0,
      opportunityBucket:
        parsed["opportunityBucket"] === "forte" ||
        parsed["opportunityBucket"] === "moyenne" ||
        parsed["opportunityBucket"] === "faible"
          ? parsed["opportunityBucket"]
          : "moyenne",
      pricePosition:
        typeof parsed["pricePosition"] === "string" ? parsed["pricePosition"] : "",
      priceDropInfo:
        typeof parsed["priceDropInfo"] === "string" ? parsed["priceDropInfo"] : "",
      diffusionInfo:
        typeof parsed["diffusionInfo"] === "string" ? parsed["diffusionInfo"] : "",
      createdAt:
        typeof parsed["createdAt"] === "string" ? parsed["createdAt"] : nowIso(),
    };

    if (!deal.canonicalKey || !deal.zipCode) {
      sessionStorage.removeItem(PENDING_OPPORTUNITY_STORAGE_KEY);
      return { ok: false, reason: "invalid" };
    }

    const project = createInvestisseurProjectFromOpportunity(deal);
    sessionStorage.removeItem(PENDING_OPPORTUNITY_STORAGE_KEY);

    return { ok: true, project };
  } catch {
    return { ok: false, reason: "storage_unavailable" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AI Input (canonique)
// ─────────────────────────────────────────────────────────────────────────────

export type InvestisseurAiInput = {
  projectId: string;
  label?: string;
  asset?: InvestisseurProject["asset"];
  acquisition?: InvestisseurProject["acquisition"];
  financing?: InvestisseurProject["financing"];
  operation?: InvestisseurProject["operation"];
  kpis?: InvestisseurProject["kpis"];
  execution?: InvestisseurProject["execution"];
  market?: Record<string, unknown>;
  risks?: Record<string, unknown>;
  updatedAt: string;
};

export function buildInvestisseurAiInput(project: InvestisseurProject): InvestisseurAiInput {
  return {
    projectId: project.id,
    label: project.label,
    asset: project.asset,
    acquisition: project.acquisition,
    financing: project.financing,
    operation: project.operation,
    kpis: project.kpis,
    execution: project.execution,
    market: project.market,
    risks: project.risks,
    updatedAt: project.updatedAt,
  };
}

export async function computeInvestisseurAiInputHash(input: InvestisseurAiInput): Promise<string> {
  return sha256Hex(JSON.stringify(canonicalize(input)));
}

export async function saveInvestisseurAiSummary(
  projectId: string,
  summary: InvestisseurAiSummary,
  aiInputHash?: string
): Promise<void> {
  const snap = getInvestisseurSnapshot();
  const p = snap.projects[projectId];
  if (!p) return;

  const nextAi = {
    ...(p.ai ?? {}),
    summary: { ...summary, generatedAt: summary.generatedAt ?? nowIso() },
    lastInputHash: aiInputHash ?? (p.ai?.lastInputHash ?? undefined),
  };

  snap.projects[projectId] = { ...p, ai: nextAi, updatedAt: nowIso() };
  saveInvestisseurSnapshot(snap);
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy migration: mimmoza.investisseur.rentabilite.v1.*
// ─────────────────────────────────────────────────────────────────────────────

function migrateLegacyRentabiliteKeysIntoSnapshot(
  snap: InvestisseurSnapshot
): { didMigrate: boolean; snapshot: InvestisseurSnapshot } {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(INVESTISSEUR_LEGACY_RENTABILITE_PREFIX)) keys.push(k);
    }
    if (keys.length === 0) return { didMigrate: false, snapshot: snap };

    const next: InvestisseurSnapshot = {
      ...snap,
      projects: { ...snap.projects },
      events: [...snap.events],
    };
    let did = false;

    for (const k of keys) {
      const projectId = k.substring(INVESTISSEUR_LEGACY_RENTABILITE_PREFIX.length);
      if (!projectId) continue;

      const raw = localStorage.getItem(k);
      const legacy = safeParseJson<Record<string, unknown>>(raw);
      if (!legacy || !isObject(legacy)) continue;

      const patch: Partial<InvestisseurProject> = {};

      patch.kpis = {
        yieldGrossPct:
          typeof legacy["yieldGrossPct"] === "number" ? legacy["yieldGrossPct"] : undefined,
        yieldNetPct:
          typeof legacy["yieldNetPct"] === "number" ? legacy["yieldNetPct"] : undefined,
        cashflowMonthly:
          typeof legacy["cashflowMonthly"] === "number" ? legacy["cashflowMonthly"] : undefined,
        roiPct: typeof legacy["roiPct"] === "number" ? legacy["roiPct"] : undefined,
        irrPct: typeof legacy["irrPct"] === "number" ? legacy["irrPct"] : undefined,
      };

      patch.acquisition = {
        price:
          typeof legacy["price"] === "number"
            ? legacy["price"]
            : typeof legacy["purchasePrice"] === "number"
              ? legacy["purchasePrice"]
              : undefined,
        notaryFees:
          typeof legacy["notaryFees"] === "number" ? legacy["notaryFees"] : undefined,
        worksBudget:
          typeof legacy["worksBudget"] === "number" ? legacy["worksBudget"] : undefined,
      };

      patch.operation = {
        rentMonthly:
          typeof legacy["rentMonthly"] === "number" ? legacy["rentMonthly"] : undefined,
        rentAnnual:
          typeof legacy["rentAnnual"] === "number" ? legacy["rentAnnual"] : undefined,
        chargesMonthly:
          typeof legacy["chargesMonthly"] === "number" ? legacy["chargesMonthly"] : undefined,
        chargesAnnual:
          typeof legacy["chargesAnnual"] === "number" ? legacy["chargesAnnual"] : undefined,
      };

      const prev = next.projects[projectId];
      next.projects[projectId] = {
        id: projectId,
        label: prev?.label,
        asset: prev?.asset,
        acquisition: { ...(prev?.acquisition ?? {}), ...(patch.acquisition ?? {}) },
        financing: prev?.financing,
        operation: { ...(prev?.operation ?? {}), ...(patch.operation ?? {}) },
        kpis: { ...(prev?.kpis ?? {}), ...(patch.kpis ?? {}) },
        execution: prev?.execution,
        market: prev?.market,
        risks: prev?.risks,
        ai: prev?.ai,
        updatedAt: nowIso(),
      };

      did = true;
      if (!next.activeProjectId) next.activeProjectId = projectId;
      next.events.push({
        at: nowIso(),
        type: "migrate_legacy_rentabilite",
        projectId,
        message: `Migrated from ${k}`,
      });
    }

    next.events = next.events.slice(-300);
    next.updatedAt = nowIso();
    return { didMigrate: did, snapshot: next };
  } catch {
    return { didMigrate: false, snapshot: snap };
  }
}