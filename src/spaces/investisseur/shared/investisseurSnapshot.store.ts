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

export const INVESTISSEUR_SNAPSHOT_KEY = "mimmoza.investisseur.snapshot.v1";
export const INVESTISSEUR_LEGACY_RENTABILITE_PREFIX = "mimmoza.investisseur.rentabilite.v1.";

export type InvestisseurAiSummary = {
  text: string;
  model?: string;
  promptVersion?: string;
  sourceHash?: string;
  generatedAt: string; // ISO
  warnings?: string[];
  sourcesUsed?: string[];
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

  market?: any; // à typer plus tard
  risks?: any;  // à typer plus tard

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

// ─────────────────────────────────────────────────────────────────────────────
// Utils
// ─────────────────────────────────────────────────────────────────────────────

function nowIso() {
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

function isObject(v: unknown): v is Record<string, any> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function ensureSnapshotShape(input: any): InvestisseurSnapshot {
  const base: InvestisseurSnapshot = {
    version: "1.0.0",
    updatedAt: nowIso(),
    activeProjectId: null,
    projects: {},
    events: [],
  };

  if (!isObject(input)) return base;

  const projects = isObject(input.projects) ? (input.projects as Record<string, any>) : {};
  const normalizedProjects: Record<string, InvestisseurProject> = {};

  for (const [pid, p] of Object.entries(projects)) {
    if (!isObject(p)) continue;
    const id = typeof p.id === "string" ? p.id : pid;
    normalizedProjects[id] = {
      id,
      label: typeof p.label === "string" ? p.label : undefined,
      asset: isObject(p.asset) ? p.asset : undefined,
      acquisition: isObject(p.acquisition) ? p.acquisition : undefined,
      financing: isObject(p.financing) ? p.financing : undefined,
      operation: isObject(p.operation) ? p.operation : undefined,
      kpis: isObject(p.kpis) ? p.kpis : undefined,
      market: (p as any).market ?? undefined,
      risks: (p as any).risks ?? undefined,
      ai: isObject(p.ai) ? p.ai : undefined,
      updatedAt: typeof p.updatedAt === "string" ? p.updatedAt : nowIso(),
    };
  }

  const activeProjectId =
    typeof input.activeProjectId === "string" ? input.activeProjectId : null;

  const events = Array.isArray(input.events)
    ? input.events
        .filter((e: any) => isObject(e) && typeof e.at === "string" && typeof e.type === "string")
        .slice(-200)
        .map((e: any) => ({
          at: e.at,
          type: e.type,
          projectId: typeof e.projectId === "string" ? e.projectId : undefined,
          message: typeof e.message === "string" ? e.message : undefined,
        }))
    : [];

  return {
    version: "1.0.0",
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : nowIso(),
    activeProjectId,
    projects: normalizedProjects,
    events,
  };
}

// Stable canonicalization for hash
function canonicalize(value: any): any {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const k of Object.keys(value).sort()) out[k] = canonicalize((value as any)[k]);
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
  const parsed = safeParseJson<any>(raw);
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

export function upsertInvestisseurProject(projectId: string, patch: Partial<InvestisseurProject>): InvestisseurProject {
  const snap = getInvestisseurSnapshot();
  const prev = snap.projects[projectId];

  const merged: InvestisseurProject = {
    id: projectId,
    label: patch.label ?? prev?.label,
    asset: { ...(prev?.asset ?? {}), ...(patch.asset ?? {}) },
    acquisition: { ...(prev?.acquisition ?? {}), ...(patch.acquisition ?? {}) },
    financing: { ...(prev?.financing ?? {}), ...(patch.financing ?? {}) },
    operation: { ...(prev?.operation ?? {}), ...(patch.operation ?? {}) },
    kpis: { ...(prev?.kpis ?? {}), ...(patch.kpis ?? {}) },
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

export function addInvestisseurEvent(e: { type: string; projectId?: string; message?: string }): void {
  const snap = getInvestisseurSnapshot();
  snap.events.push({ at: nowIso(), type: e.type, projectId: e.projectId, message: e.message });
  snap.events = snap.events.slice(-300);
  saveInvestisseurSnapshot(snap);
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
  market?: any;
  risks?: any;
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
    market: project.market,
    risks: project.risks,
    updatedAt: project.updatedAt,
  };
}

export async function computeInvestisseurAiInputHash(input: InvestisseurAiInput): Promise<string> {
  return sha256Hex(JSON.stringify(canonicalize(input)));
}

export async function saveInvestisseurAiSummary(projectId: string, summary: InvestisseurAiSummary, aiInputHash?: string): Promise<void> {
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

    const next: InvestisseurSnapshot = { ...snap, projects: { ...snap.projects }, events: [...snap.events] };
    let did = false;

    for (const k of keys) {
      const projectId = k.substring(INVESTISSEUR_LEGACY_RENTABILITE_PREFIX.length);
      if (!projectId) continue;

      const raw = localStorage.getItem(k);
      const legacy = safeParseJson<any>(raw);
      if (!legacy) continue;

      const patch: Partial<InvestisseurProject> = {};

      if (isObject(legacy)) {
        patch.kpis = {
          yieldGrossPct: typeof (legacy as any).yieldGrossPct === "number" ? (legacy as any).yieldGrossPct : undefined,
          yieldNetPct: typeof (legacy as any).yieldNetPct === "number" ? (legacy as any).yieldNetPct : undefined,
          cashflowMonthly: typeof (legacy as any).cashflowMonthly === "number" ? (legacy as any).cashflowMonthly : undefined,
          roiPct: typeof (legacy as any).roiPct === "number" ? (legacy as any).roiPct : undefined,
          irrPct: typeof (legacy as any).irrPct === "number" ? (legacy as any).irrPct : undefined,
        };

        patch.acquisition = {
          price: typeof (legacy as any).price === "number"
            ? (legacy as any).price
            : typeof (legacy as any).purchasePrice === "number"
              ? (legacy as any).purchasePrice
              : undefined,
          notaryFees: typeof (legacy as any).notaryFees === "number" ? (legacy as any).notaryFees : undefined,
          worksBudget: typeof (legacy as any).worksBudget === "number" ? (legacy as any).worksBudget : undefined,
        };

        patch.operation = {
          rentMonthly: typeof (legacy as any).rentMonthly === "number" ? (legacy as any).rentMonthly : undefined,
          rentAnnual: typeof (legacy as any).rentAnnual === "number" ? (legacy as any).rentAnnual : undefined,
          chargesMonthly: typeof (legacy as any).chargesMonthly === "number" ? (legacy as any).chargesMonthly : undefined,
          chargesAnnual: typeof (legacy as any).chargesAnnual === "number" ? (legacy as any).chargesAnnual : undefined,
        };
      }

      const prev = next.projects[projectId];
      next.projects[projectId] = {
        id: projectId,
        label: prev?.label,
        asset: prev?.asset,
        acquisition: { ...(prev?.acquisition ?? {}), ...(patch.acquisition ?? {}) },
        financing: prev?.financing,
        operation: { ...(prev?.operation ?? {}), ...(patch.operation ?? {}) },
        kpis: { ...(prev?.kpis ?? {}), ...(patch.kpis ?? {}) },
        market: prev?.market,
        risks: prev?.risks,
        ai: prev?.ai,
        updatedAt: nowIso(),
      };

      did = true;
      if (!next.activeProjectId) next.activeProjectId = projectId;
      next.events.push({ at: nowIso(), type: "migrate_legacy_rentabilite", projectId, message: `Migrated from ${k}` });
    }

    next.events = next.events.slice(-300);
    next.updatedAt = nowIso();
    return { didMigrate: did, snapshot: next };
  } catch {
    return { didMigrate: false, snapshot: snap };
  }
}
