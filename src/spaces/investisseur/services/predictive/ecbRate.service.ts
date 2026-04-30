// ──────────────────────────────────────────────────────────────────────────────
// ecbRate.service.ts
// Service d'analyse des taux directeurs BCE pour le moteur prédictif Mimmoza.
//
// Ne sert PAS à afficher "Taux BCE = X%".
// Sert à produire : pression crédit, tendance, impact solvabilité,
// signal prédictif exploitable par le moteur et l'UI.
// ──────────────────────────────────────────────────────────────────────────────

// ── Types ────────────────────────────────────────────────────────────────────

export type RateTrend = "hausse" | "baisse" | "stable";

export type EcbRatePoint = {
  date: string;
  value: number;
};

export type EcbRatesAnalysis = {
  generatedAt: string;

  depositRate: number;
  refinancingRate: number;
  marginalRate: number;

  /** Historique refinancing (dernières observations disponibles) */
  refinancingHistory: EcbRatePoint[];

  /** Moyennes glissantes du taux de refinancement */
  avg3m: number;
  avg12m: number;

  trend: RateTrend;

  /** Score de pression crédit 0-100 (100 = très favorable) */
  pressureScore: number;

  pressureLabel: "très favorable" | "favorable" | "neutre" | "défavorable" | "très défavorable";

  /** Phrase métier exploitable directement dans l'UI */
  interpretation: string;

  source: "ecb" | "fallback";
};

// ── Constantes ───────────────────────────────────────────────────────────────

const ECB_BASE = "https://data-api.ecb.europa.eu/service/data";

const SERIES = {
  refinancing: "FM/B.U2.EUR.4F.KR.MRR_FR.LEV",
  deposit:     "FM/B.U2.EUR.4F.KR.DFR.LEV",
  marginal:    "FM/B.U2.EUR.4F.KR.MLFR.LEV",
} as const;

const CACHE_KEY = "mimmoza.ecb.rates_analysis";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h

const FETCH_TIMEOUT_MS = 10_000;

const FALLBACK_RATES: Pick<EcbRatesAnalysis, "depositRate" | "refinancingRate" | "marginalRate"> = {
  depositRate: 2.75,
  refinancingRate: 2.90,
  marginalRate: 3.15,
};

// ── Cache ────────────────────────────────────────────────────────────────────

interface CachedAnalysis {
  data: EcbRatesAnalysis;
  cachedAt: number;
}

function readCache(): EcbRatesAnalysis | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedAnalysis;
    if (!parsed?.data || !parsed?.cachedAt) return null;
    if (Date.now() - parsed.cachedAt > CACHE_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeCache(data: EcbRatesAnalysis): void {
  try {
    const entry: CachedAnalysis = { data, cachedAt: Date.now() };
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    /* quota exceeded — non-bloquant */
  }
}

// ── CSV Parsing ──────────────────────────────────────────────────────────────

function parseCsvToPoints(csv: string): EcbRatePoint[] {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return [];

  const header = lines[0].split(",").map((h) => h.trim().toUpperCase());
  const timeIdx = header.findIndex((h) => h === "TIME_PERIOD");
  const valueIdx = header.findIndex((h) => h === "OBS_VALUE");

  if (timeIdx < 0 || valueIdx < 0) return [];

  const points: EcbRatePoint[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const date = cols[timeIdx]?.trim();
    const value = parseFloat(cols[valueIdx]?.trim());
    if (date && Number.isFinite(value)) {
      points.push({ date, value });
    }
  }

  return points.sort((a, b) => a.date.localeCompare(b.date));
}

function latestValue(points: EcbRatePoint[]): number | null {
  if (points.length === 0) return null;
  return points[points.length - 1].value;
}

// ── Fetch ECB ────────────────────────────────────────────────────────────────

async function fetchSeries(seriesKey: string, lastN: number): Promise<EcbRatePoint[]> {
  const url = `${ECB_BASE}/${seriesKey}?lastNObservations=${lastN}&format=csvdata`;

  const resp = await fetch(url, {
    headers: { Accept: "text/csv" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!resp.ok) {
    throw new Error(`ECB API ${resp.status}: ${resp.statusText}`);
  }

  const csv = await resp.text();
  return parseCsvToPoints(csv);
}

async function fetchAllRates(): Promise<{
  refinancingHistory: EcbRatePoint[];
  depositRate: number;
  refinancingRate: number;
  marginalRate: number;
}> {
  // Fetch en parallèle — refinancing avec historique, les autres juste le dernier
  const [refinancingPoints, depositPoints, marginalPoints] = await Promise.all([
    fetchSeries(SERIES.refinancing, 24),
    fetchSeries(SERIES.deposit, 1),
    fetchSeries(SERIES.marginal, 1),
  ]);

  const refinancingRate = latestValue(refinancingPoints);
  const depositRate = latestValue(depositPoints);
  const marginalRate = latestValue(marginalPoints);

  if (refinancingRate == null) {
    throw new Error("Aucun taux de refinancement trouvé dans la réponse ECB.");
  }

  return {
    refinancingHistory: refinancingPoints,
    depositRate: depositRate ?? refinancingRate - 0.50,
    refinancingRate,
    marginalRate: marginalRate ?? refinancingRate + 0.25,
  };
}

// ── Calculs analytiques ──────────────────────────────────────────────────────

function computeAverage(points: EcbRatePoint[], monthsBack: number): number {
  if (points.length === 0) return 0;

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - monthsBack);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const filtered = points.filter((p) => p.date >= cutoffStr);

  if (filtered.length === 0) {
    // Pas assez de données, on prend les N derniers points disponibles
    const fallbackSlice = points.slice(-Math.min(points.length, 4));
    return fallbackSlice.reduce((s, p) => s + p.value, 0) / fallbackSlice.length;
  }

  return filtered.reduce((s, p) => s + p.value, 0) / filtered.length;
}

function computeTrend(points: EcbRatePoint[]): RateTrend {
  if (points.length < 3) return "stable";

  // Comparer les 3 dernières observations
  const recent = points.slice(-3);
  const first = recent[0].value;
  const last = recent[recent.length - 1].value;
  const delta = last - first;

  // Seuil de significativité : ±0.10 pp
  if (delta > 0.10) return "hausse";
  if (delta < -0.10) return "baisse";
  return "stable";
}

function computePressureScore(refinancingRate: number): number {
  // 0-100 : 100 = conditions très favorables, 0 = très restrictives
  if (refinancingRate <= 1.0) return 95;
  if (refinancingRate <= 1.5) return 88;
  if (refinancingRate <= 2.0) return 80;
  if (refinancingRate <= 2.5) return 70;
  if (refinancingRate <= 3.0) return 60;
  if (refinancingRate <= 3.5) return 50;
  if (refinancingRate <= 4.0) return 40;
  if (refinancingRate <= 4.5) return 30;
  if (refinancingRate <= 5.0) return 20;
  return 10;
}

function computePressureLabel(
  score: number
): EcbRatesAnalysis["pressureLabel"] {
  if (score >= 80) return "très favorable";
  if (score >= 60) return "favorable";
  if (score >= 40) return "neutre";
  if (score >= 20) return "défavorable";
  return "très défavorable";
}

function computeInterpretation(
  refinancingRate: number,
  trend: RateTrend,
  pressureLabel: EcbRatesAnalysis["pressureLabel"],
  avg3m: number,
  avg12m: number,
): string {
  const trendVerb =
    trend === "hausse"
      ? "en hausse"
      : trend === "baisse"
      ? "en baisse"
      : "stables";

  const momentumNote =
    avg3m < avg12m - 0.15
      ? " Dynamique récente favorable (moyenne 3m < 12m)."
      : avg3m > avg12m + 0.15
      ? " Resserrement récent (moyenne 3m > 12m)."
      : "";

  switch (pressureLabel) {
    case "très favorable":
      return (
        `Conditions de financement très favorables (refi ${refinancingRate.toFixed(2)}%, taux ${trendVerb}). ` +
        `Soutien fort à la demande solvable — environnement porteur pour la valorisation et la liquidité.` +
        momentumNote
      );

    case "favorable":
      return (
        `Conditions de crédit favorables (refi ${refinancingRate.toFixed(2)}%, taux ${trendVerb}). ` +
        `Soutien modéré à la demande — capacité d'emprunt préservée pour la majorité des profils.` +
        momentumNote
      );

    case "neutre":
      return (
        `Pression crédit neutre (refi ${refinancingRate.toFixed(2)}%, taux ${trendVerb}). ` +
        `Impact limité sur la demande — la solvabilité dépend principalement des conditions locales.` +
        momentumNote
      );

    case "défavorable":
      return (
        `Conditions de financement restrictives (refi ${refinancingRate.toFixed(2)}%, taux ${trendVerb}). ` +
        `Frein à la capacité d'emprunt — risque de compression des prix et d'allongement des délais de vente.` +
        momentumNote
      );

    case "très défavorable":
      return (
        `Conditions de crédit très restrictives (refi ${refinancingRate.toFixed(2)}%, taux ${trendVerb}). ` +
        `Pression forte sur la solvabilité — frein significatif à la demande et à la revente.` +
        momentumNote
      );
  }
}

// ── Assemblage ───────────────────────────────────────────────────────────────

function buildAnalysis(
  rates: {
    refinancingHistory: EcbRatePoint[];
    depositRate: number;
    refinancingRate: number;
    marginalRate: number;
  },
  source: "ecb" | "fallback",
): EcbRatesAnalysis {
  const { refinancingHistory, depositRate, refinancingRate, marginalRate } = rates;

  const avg3m = computeAverage(refinancingHistory, 3);
  const avg12m = computeAverage(refinancingHistory, 12);
  const trend = computeTrend(refinancingHistory);
  const pressureScore = computePressureScore(refinancingRate);
  const pressureLabel = computePressureLabel(pressureScore);
  const interpretation = computeInterpretation(
    refinancingRate, trend, pressureLabel, avg3m, avg12m,
  );

  return {
    generatedAt: new Date().toISOString(),
    depositRate,
    refinancingRate,
    marginalRate,
    refinancingHistory,
    avg3m: parseFloat(avg3m.toFixed(3)),
    avg12m: parseFloat(avg12m.toFixed(3)),
    trend,
    pressureScore,
    pressureLabel,
    interpretation,
    source,
  };
}

function buildFallbackAnalysis(): EcbRatesAnalysis {
  const { depositRate, refinancingRate, marginalRate } = FALLBACK_RATES;

  const fakeHistory: EcbRatePoint[] = [
    { date: "2024-06-12", value: 4.25 },
    { date: "2024-09-18", value: 3.65 },
    { date: "2024-10-23", value: 3.40 },
    { date: "2024-12-18", value: 3.15 },
    { date: "2025-01-30", value: 2.90 },
    { date: "2025-03-12", value: 2.65 },
    { date: "2025-04-23", value: refinancingRate },
  ];

  return buildAnalysis(
    { refinancingHistory: fakeHistory, depositRate, refinancingRate, marginalRate },
    "fallback",
  );
}

// ── API publique ─────────────────────────────────────────────────────────────

/**
 * Récupère et analyse les taux directeurs BCE.
 *
 * Cascade : cache localStorage (12h) → API ECB SDW → fallback.
 *
 * @returns Analyse exploitable par le moteur prédictif :
 *   pressureScore, trend, interpretation (phrase métier).
 */
export async function getEcbRatesAnalysis(): Promise<EcbRatesAnalysis> {
  // 1) Cache
  const cached = readCache();
  if (cached) return cached;

  // 2) Fetch ECB
  try {
    const rates = await fetchAllRates();
    const analysis = buildAnalysis(rates, "ecb");
    writeCache(analysis);
    return analysis;
  } catch {
    // 3) Fallback
    const fallback = buildFallbackAnalysis();
    writeCache(fallback);
    return fallback;
  }
}

/**
 * Lecture synchrone du cache uniquement.
 * Retourne null si rien en cache — appeler getEcbRatesAnalysis() d'abord.
 */
export function readEcbRatesAnalysisSync(): EcbRatesAnalysis | null {
  return readCache();
}