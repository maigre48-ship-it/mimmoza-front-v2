import type {
  FinancialSnapshotV1,
  SnapshotSource,
  AssetClass,
  Stage,
  NumberOrNull,
} from "./financialSnapshot.types";

export type PromoteurSnapshot = Record<string, unknown>;

type MapOptions = {
  source?: SnapshotSource;
  dossierId: string;
  dossierName?: string;
  stage?: Stage;
};

const isoNow = () => new Date().toISOString();

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function n(v: unknown): NumberOrNull {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const x = Number(v.replace(/\u202F/g, " ").replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(x) ? x : null;
  }
  return null;
}

function clampPct(p: number): number {
  if (!Number.isFinite(p)) return 0;
  if (p < 0) return 0;
  if (p > 100) return 100;
  return p;
}

function pickFirstRecord(root: Record<string, unknown>, keys: string[]): Record<string, unknown> | null {
  for (const k of keys) {
    const v = root[k];
    if (isRecord(v)) return v;
  }
  return null;
}

function pickFirstAny(root: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (k in root) return root[k];
  }
  return undefined;
}

function deepGet(obj: unknown, path: string): unknown {
  if (!obj) return undefined;
  const parts = path.split(".");
  let cur: any = obj;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in cur) cur = cur[p];
    else return undefined;
  }
  return cur;
}

/**
 * Deep scan : cherche une valeur numérique en parcourant tout l'objet
 * en matchant des noms de clés (case-insensitive).
 */
function deepFindNumberByKey(obj: unknown, keyCandidates: string[], maxDepth = 10): number | null {
  const keysLower = keyCandidates.map((k) => k.toLowerCase());
  const seen = new Set<any>();

  const walk = (node: any, depth: number): number | null => {
    if (node == null) return null;
    if (depth > maxDepth) return null;
    if (typeof node !== "object") return null;
    if (seen.has(node)) return null;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const item of node) {
        const r = walk(item, depth + 1);
        if (r != null) return r;
      }
      return null;
    }

    // object
    for (const [k, v] of Object.entries(node)) {
      const kl = k.toLowerCase();
      if (keysLower.some((cand) => kl === cand || kl.includes(cand))) {
        const val = n(v);
        if (val != null) return val;
      }
    }

    // descend
    for (const v of Object.values(node)) {
      const r = walk(v, depth + 1);
      if (r != null) return r;
    }

    return null;
  };

  return walk(obj, 0);
}

// ---- Parsing fallback depuis bilan.summary
function parseBilanSummary(summary: unknown): { margePct?: number; ca?: number; cout?: number } {
  if (typeof summary !== "string") return {};
  const s = summary.replace(/\u202F/g, " ").replace(/\s+/g, " ").trim();
  const out: any = {};

  const mMarge = s.match(/Marge\s+([0-9]+(?:[.,][0-9]+)?)%/i);
  if (mMarge) out.margePct = Number(mMarge[1].replace(",", "."));

  const mCA = s.match(/\bCA\s+([0-9\s]+)€?/i);
  if (mCA) out.ca = Number(mCA[1].replace(/\s/g, ""));

  const mCout = s.match(/Co[uû]t\s+([0-9\s]+)€?/i);
  if (mCout) out.cout = Number(mCout[1].replace(/\s/g, ""));

  return out;
}

function computeCompleteness(fs: FinancialSnapshotV1): FinancialSnapshotV1["completeness"] {
  const missing: string[] = [];
  const warnings: string[] = [];

  const emplois = fs.usesSources?.emplois;
  const res = fs.usesSources?.ressources;

  const totalCost = emplois?.totalCost ?? null;
  const equity = res?.equity ?? null;
  const debt = res?.debt ?? null;

  if (totalCost == null) missing.push("financement.emplois.totalCost");
  if (equity == null) missing.push("financement.ressources.equity");
  if (debt == null) missing.push("financement.ressources.debt");

  const gmPct = fs.profitability?.grossMarginPct ?? null;
  if (gmPct == null) missing.push("rentabilite.grossMarginPct");

  const core = [
    "financement.emplois.totalCost",
    "financement.ressources.equity",
    "financement.ressources.debt",
    "rentabilite.grossMarginPct",
  ];
  const missingCore = core.filter((k) => missing.includes(k)).length;

  const percent = clampPct(Math.round(((core.length - missingCore) / core.length) * 100));
  return { percent, missing, warnings };
}

function computeLtcPct(debt: NumberOrNull, totalCost: NumberOrNull): NumberOrNull {
  if (debt == null || totalCost == null) return null;
  if (totalCost <= 0) return null;
  return (debt / totalCost) * 100;
}

function mapAssetClassFromProjectInfo(pi: Record<string, unknown> | null): AssetClass {
  const raw = (pi?.assetClass ?? pi?.nature ?? pi?.projectNature ?? pi?.type) as unknown;
  const s = typeof raw === "string" ? raw.toLowerCase() : "";
  if (s.includes("log")) return "logistique";
  if (s.includes("sant") || s.includes("ehpad")) return "sante";
  if (s.includes("hot")) return "hotel";
  if (s.includes("tert") || s.includes("bure")) return "tertiaire";
  if (s.includes("mix")) return "mixte";
  if (s.includes("res") || s.includes("logement") || s.includes("hab")) return "residentiel";
  return "autre";
}

function extractAddress(pi: Record<string, unknown> | null): FinancialSnapshotV1["project"]["address"] | undefined {
  if (!pi) return undefined;

  const label = pickFirstAny(pi, ["addressLabel", "address", "adresse", "fullAddress"]);
  const communeInsee = pickFirstAny(pi, ["communeInsee", "insee", "codeInsee", "cityInsee"]);
  const lat = n(pickFirstAny(pi, ["lat", "latitude"]));
  const lon = n(pickFirstAny(pi, ["lon", "lng", "longitude"]));

  const out: FinancialSnapshotV1["project"]["address"] = {};
  if (typeof label === "string") out.label = label;
  if (typeof communeInsee === "string") out.communeInsee = communeInsee;
  if (lat != null) out.lat = lat;
  if (lon != null) out.lon = lon;

  return Object.keys(out).length ? out : undefined;
}

function extractBilan(root: Record<string, unknown>): Record<string, unknown> | null {
  return pickFirstRecord(root, ["bilan", "bilanPromoteur", "bilan_promoteur", "financial", "finance"]);
}

function mapUsesSourcesFromBilan(bilan: Record<string, unknown> | null): FinancialSnapshotV1["usesSources"] | undefined {
  if (!bilan) return undefined;

  const summaryParsed = parseBilanSummary(bilan.summary);

  const totalCost =
    n(pickFirstAny(bilan, ["coutTotal", "cout_total", "totalCost", "tdc"])) ??
    n(deepGet(bilan, "data.kpis.totalCost")) ??
    n(deepGet(bilan, "data.kpis.total_cost")) ??
    n(deepGet(bilan, "data.kpis.costTotal")) ??
    n(deepGet(bilan, "data.params.totalCost")) ??
    (typeof summaryParsed.cout === "number" ? summaryParsed.cout : null);

  // ✅ deep scan fallback (au cas où equity/debt sont planqués ailleurs)
  const equity =
    n(pickFirstAny(bilan, ["apport", "equity", "fondsPropres", "fonds_propres"])) ??
    n(deepGet(bilan, "data.kpis.equity")) ??
    n(deepGet(bilan, "data.params.equity")) ??
    n(deepGet(bilan, "data.params.apport")) ??
    deepFindNumberByKey(bilan.data, ["equity", "apport", "fondspropres", "fonds_propres", "fonds propres", "fp"]);

  const debt =
    n(pickFirstAny(bilan, ["dette", "debt", "pret", "seniorDebt", "detteSenior"])) ??
    n(deepGet(bilan, "data.kpis.debt")) ??
    n(deepGet(bilan, "data.params.debt")) ??
    n(deepGet(bilan, "data.params.dette")) ??
    deepFindNumberByKey(bilan.data, ["debt", "dette", "pret", "prêt", "loan", "senior", "seniorDebt", "detteSenior"]);

  return {
    currency: "EUR",
    emplois: { totalCost },
    ressources: { equity: equity ?? null, debt: debt ?? null },
  };
}

function mapProfitabilityFromBilan(bilan: Record<string, unknown> | null): FinancialSnapshotV1["profitability"] | undefined {
  if (!bilan) return undefined;

  const ok = bilan.ok === true;

  // ✅ si ok=false => marge/tri non fiables => null
  if (!ok) return undefined;

  const gm =
    n(pickFirstAny(bilan, ["margePct", "marge_pct", "grossMarginPct", "margeBrutePct"])) ??
    n(deepGet(bilan, "data.kpis.margePct")) ??
    n(deepGet(bilan, "data.kpis.marge_pct")) ??
    n(deepGet(bilan, "data.kpis.grossMarginPct")) ??
    null;

  const irr =
    n(pickFirstAny(bilan, ["triPct", "tri", "irrPct", "IRR"])) ??
    n(deepGet(bilan, "data.kpis.triPct")) ??
    n(deepGet(bilan, "data.kpis.irrPct")) ??
    null;

  const out: NonNullable<FinancialSnapshotV1["profitability"]> = {};
  if (gm != null) out.grossMarginPct = gm;
  if (irr != null) out.irrPct = irr;

  return Object.keys(out).length ? out : undefined;
}

function extractMarket(root: Record<string, unknown>): unknown {
  return pickFirstAny(root, ["market", "marche", "etudeMarche", "marketStudy", "market_context", "marketContext"]);
}

function extractRisks(root: Record<string, unknown>): unknown {
  return pickFirstAny(root, ["risks", "risques", "risk", "etudeRisques", "riskStudy"]);
}

export function mapPromoteurToFinancialSnapshot(
  promoteur: PromoteurSnapshot,
  opts: MapOptions
): FinancialSnapshotV1 {
  const source: SnapshotSource = opts.source ?? "mimmoza";
  const stage: Stage = opts.stage ?? "analyse";

  const root = isRecord(promoteur) ? promoteur : {};

  const projectInfo = pickFirstRecord(root, ["projectInfo", "project", "meta"]);
  const assetClass = mapAssetClassFromProjectInfo(projectInfo);

  const bilan = extractBilan(root);
  const usesSources = mapUsesSourcesFromBilan(bilan);
  const profitability = mapProfitabilityFromBilan(bilan);

  const totalCost = usesSources?.emplois.totalCost ?? null;
  const debt = usesSources?.ressources.debt ?? null;

  const creditMetrics: FinancialSnapshotV1["creditMetrics"] = {
    ltcPct: computeLtcPct(debt, totalCost),
  };

  const marketPayload = extractMarket(root);
  const risksPayload = extractRisks(root);

  const fs: FinancialSnapshotV1 = {
    version: "financialSnapshot.v1",
    provenance: {
      source,
      sourceRef: source === "mimmoza" ? "promoteurSnapshot" : undefined,
      importedAt: isoNow(),
      updatedAt: isoNow(),
    },
    completeness: { percent: 0, missing: [], warnings: [] },

    project: {
      dossierId: opts.dossierId,
      name: opts.dossierName,
      stage,
      assetClass,
      address: extractAddress(projectInfo),
    },

    programme: undefined,
    hypotheses: undefined,
    usesSources,
    creditMetrics,
    profitability,

    cashflow: undefined,
    docs: {},

    risks: risksPayload != null
      ? { available: true, source: "mimmoza", payload: risksPayload }
      : { available: false, source: "external" },

    market: marketPayload != null
      ? { available: true, source: "mimmoza", payload: marketPayload }
      : { available: false, source: "external" },

    notes: {},
  };

  fs.completeness = computeCompleteness(fs);
  return fs;
}
