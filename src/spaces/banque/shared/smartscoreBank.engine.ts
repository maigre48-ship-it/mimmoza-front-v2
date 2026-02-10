import type { FinancialSnapshotV1, NumberOrNull } from "./financialSnapshot.types";
import type { SmartScoreResultV1, SmartScoreDecision } from "./smartscoreBank.types";

function clamp(n: number, min = 0, max = 100) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function avg(a: number, b: number) {
  return (a + b) / 2;
}

function scoreLtc(ltcPct: NumberOrNull, flags: string[], reasons: string[]): number | null {
  if (ltcPct == null) return null;

  if (ltcPct <= 55) {
    reasons.push(`LTC ${ltcPct.toFixed(1)}% : très solide`);
    return 100;
  }
  if (ltcPct <= 65) {
    reasons.push(`LTC ${ltcPct.toFixed(1)}% : correct`);
    return 80;
  }
  if (ltcPct <= 75) {
    reasons.push(`LTC ${ltcPct.toFixed(1)}% : tendu`);
    return 55;
  }
  if (ltcPct <= 85) {
    reasons.push(`LTC ${ltcPct.toFixed(1)}% : élevé`);
    flags.push("LTC_TOO_HIGH");
    return 30;
  }

  reasons.push(`LTC ${ltcPct.toFixed(1)}% : critique`);
  flags.push("LTC_TOO_HIGH");
  return 10;
}

function scoreMargin(margePct: NumberOrNull, flags: string[], reasons: string[]): number | null {
  if (margePct == null) return null;

  if (margePct >= 18) {
    reasons.push(`Marge ${margePct.toFixed(1)}% : confortable`);
    return 100;
  }
  if (margePct >= 12) {
    reasons.push(`Marge ${margePct.toFixed(1)}% : acceptable`);
    return 75;
  }
  if (margePct >= 8) {
    reasons.push(`Marge ${margePct.toFixed(1)}% : faible`);
    return 50;
  }
  if (margePct >= 5) {
    reasons.push(`Marge ${margePct.toFixed(1)}% : très faible`);
    flags.push("MARGIN_LOW");
    return 30;
  }

  reasons.push(`Marge ${margePct.toFixed(1)}% : insuffisante`);
  flags.push("MARGIN_TOO_LOW");
  return 10;
}

function bonusIrr(irrPct: NumberOrNull, reasons: string[]): number {
  if (irrPct == null) return 0;
  if (irrPct >= 15) {
    reasons.push(`TRI ${irrPct.toFixed(1)}% : bonus`);
    return 10;
  }
  if (irrPct >= 10) {
    reasons.push(`TRI ${irrPct.toFixed(1)}% : léger bonus`);
    return 5;
  }
  return 0;
}

function penaltyDuration(durationMonths: NumberOrNull, flags: string[], reasons: string[]): number {
  if (durationMonths == null) return 0;
  if (durationMonths > 36) {
    reasons.push(`Durée ${durationMonths} mois : très longue`);
    flags.push("DURATION_TOO_LONG");
    return 20;
  }
  if (durationMonths > 24) {
    reasons.push(`Durée ${durationMonths} mois : longue`);
    return 10;
  }
  return 0;
}

function decide(score: number, confidencePct: number, globalFlags: string[]): SmartScoreDecision {
  const hasBlocking =
    globalFlags.includes("LTC_TOO_HIGH") ||
    globalFlags.includes("MARGIN_TOO_LOW") ||
    globalFlags.includes("DURATION_TOO_LONG");

  if (hasBlocking) return "NO_GO";

  if (score >= 70 && confidencePct >= 60) return "GO";
  if (score >= 55) return "GO_CONDITIONS";
  return "NO_GO";
}

function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const x = Number(v.replace(/\u202F/g, " ").replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(x) ? x : null;
  }
  return null;
}

/**
 * Extraction robuste d'un score 0..100 depuis un payload schema-less.
 * Supporte:
 * - obj.score / obj.globalScore / obj.marketScore / obj.riskScore
 * - obj.summary: "Score: 40/100", "Score risque: 15/100", "Score marché: 40/100"
 * - obj.data.score / obj.data.globalScore / obj.data.smartscore
 * - obj.data.summary (même formats)
 */
function extractScore(payload: unknown): number | null {
  if (payload == null) return null;
  if (typeof payload !== "object") return null;

  const obj = payload as Record<string, unknown>;

  const direct =
    toNum(obj.score) ??
    toNum(obj.globalScore) ??
    toNum(obj.marketScore) ??
    toNum(obj.riskScore) ??
    null;

  if (direct != null) return direct;

  const trySummary = (summary: unknown): number | null => {
    if (typeof summary !== "string") return null;

    // ✅ support "Score:", "Score risque:", "Score risques:", "Score marché:" (accents tolérés)
    const m = summary.match(
      /Score(?:\s+(?:risque|risques|march[eé]))?\s*:\s*([0-9]{1,3})\s*\/\s*100/i
    );
    if (m) return Number(m[1]);
    return null;
  };

  const fromSummary = trySummary(obj.summary);
  if (fromSummary != null) return fromSummary;

  const data = obj.data;
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;

    const deep =
      toNum(d.score) ??
      toNum(d.globalScore) ??
      toNum(d.smartscore) ??
      null;

    if (deep != null) return deep;

    const fromDataSummary = trySummary(d.summary);
    if (fromDataSummary != null) return fromDataSummary;
  }

  return null;
}

export function computeSmartScoreBankV1(fs: FinancialSnapshotV1): SmartScoreResultV1 {
  const completenessPct = clamp(fs.completeness?.percent ?? 0);

  // Confiance: basée sur complétude, pénalisée si risques/marché absents
  let confidencePct = completenessPct;
  if (!fs.risks?.available) confidencePct -= 15;
  if (!fs.market?.available) confidencePct -= 10;
  confidencePct = clamp(confidencePct);

  const baseWeights = {
    financier: 0.45,
    risques: 0.25,
    marche: 0.20,
    sponsor: 0.10,
  } as const;

  const blocks: SmartScoreResultV1["blocks"] = [];
  const globalFlags: string[] = [];

  // FINANCIER
  {
    const reasons: string[] = [];
    const flags: string[] = [];

    const ltcPct = fs.creditMetrics?.ltcPct ?? null;
    const margePct = fs.profitability?.grossMarginPct ?? null;
    const irrPct = fs.profitability?.irrPct ?? null;
    const durationMonths = fs.programme?.calendar?.durationMonths ?? null;

    const s1 = scoreLtc(ltcPct, flags, reasons);
    const s2 = scoreMargin(margePct, flags, reasons);

    let score: number | null = null;
    if (s1 != null && s2 != null) score = avg(s1, s2);
    else if (s1 != null) score = s1;
    else if (s2 != null) score = s2;

    if (score != null) {
      score = clamp(score + bonusIrr(irrPct, reasons) - penaltyDuration(durationMonths, flags, reasons));
    } else {
      reasons.push("Données financières insuffisantes pour scorer.");
    }

    blocks.push({
      key: "financier",
      weight: baseWeights.financier,
      available: score != null,
      score,
      reasons,
      flags,
    });
    globalFlags.push(...flags);
  }

  // RISQUES
  {
    const reasons: string[] = [];
    const flags: string[] = [];

    let score: number | null = null;
    if (!fs.risks?.available) {
      reasons.push("Étude de risques absente.");
    } else {
      const riskScore = extractScore(fs.risks.payload);
      if (riskScore != null) {
        score = clamp(riskScore);
        reasons.push(`Score risques : ${score.toFixed(0)}/100`);
      } else {
        reasons.push("Étude de risques présente mais score non détecté (fallback prudent).");
        score = 55;
      }
    }

    blocks.push({
      key: "risques",
      weight: baseWeights.risques,
      available: score != null,
      score,
      reasons,
      flags,
    });
    globalFlags.push(...flags);
  }

  // MARCHÉ
  {
    const reasons: string[] = [];
    const flags: string[] = [];

    let score: number | null = null;
    if (!fs.market?.available) {
      reasons.push("Étude de marché absente.");
    } else {
      const marketScore = extractScore(fs.market.payload);
      if (marketScore != null) {
        score = clamp(marketScore);
        reasons.push(`Score marché : ${score.toFixed(0)}/100`);
      } else {
        reasons.push("Étude de marché présente mais score non détecté (fallback prudent).");
        score = 55;
      }
    }

    blocks.push({
      key: "marche",
      weight: baseWeights.marche,
      available: score != null,
      score,
      reasons,
      flags,
    });
    globalFlags.push(...flags);
  }

  // SPONSOR
  {
    const reasons: string[] = [];
    const flags: string[] = [];

    const exp = fs.project?.sponsor?.experienceScore ?? null;
    let score: number | null = null;

    if (exp == null) {
      reasons.push("Données sponsor absentes.");
    } else {
      score = clamp(exp);
      reasons.push(`Expérience sponsor : ${score.toFixed(0)}/100`);
    }

    const defaults = fs.project?.sponsor?.trackRecord?.defaults ?? null;
    if (defaults != null && defaults > 0) {
      flags.push("SPONSOR_DEFAULT_HISTORY");
      reasons.push(`Historique défauts déclaré : ${defaults}`);
      if (score != null) score = clamp(score - 20);
    }

    blocks.push({
      key: "sponsor",
      weight: baseWeights.sponsor,
      available: score != null,
      score,
      reasons,
      flags,
    });
    globalFlags.push(...flags);
  }

  // Agrégation: moyenne pondérée sur blocs scorés
  const scored = blocks.filter((b) => b.score != null);
  const wSum = scored.reduce((acc, b) => acc + b.weight, 0);
  const rawScore =
    wSum > 0
      ? scored.reduce((acc, b) => acc + (b.score as number) * b.weight, 0) / wSum
      : 0;

  const score = clamp(Math.round(rawScore));
  const decision = decide(score, confidencePct, globalFlags);

  const summary =
    decision === "GO"
      ? `GO — Score ${score}/100 (confiance ${confidencePct}%).`
      : decision === "GO_CONDITIONS"
      ? `GO sous conditions — Score ${score}/100 (confiance ${confidencePct}%).`
      : `NO GO — Score ${score}/100 (confiance ${confidencePct}%).`;

  return {
    version: "smartscore.banque.v1",
    score,
    decision,
    confidencePct,
    completenessPct,
    blocks,
    globalFlags: Array.from(new Set(globalFlags)),
    summary,
  };
}
