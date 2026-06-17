// ============================================================================
// committeeEngine.ts — Committee Decision Engine
// src/spaces/banque/committee/committeeEngine.ts
// ============================================================================
//
// Pure-logic engine: no React, no side effects, no API calls.
// All functions take a ReportInput and return deterministic results.
// ============================================================================

// ════════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════════

export interface ReportInput {
  programmeNom: string;
  adresse?: string;
  marketStudy?: {
    commune?: string;
    departement?: string;
    dvf: {
      prixM2Median?: number;
      nbTransactions?: number;
      evolution?: number;
    };
    insee: {
      population?: number;
      revenuMedian?: number;
      tauxChomage?: number;
      densitePopulation?: number;
    };
    bpe: {
      nbEquipements?: number;
    };
    transport: {
      nbStations?: number;
      distanceCentre?: number;
    };
    insights: Array<{
      label: string;
      value: string | number;
      sentiment: "positive" | "negative" | "neutral";
    }>;
  };
  smartscore?: {
    score: number;
    verdict: string;
    pillars: Array<{
      id: string;
      label: string;
      score: number;
    }>;
  };
  kpis: {
    ltv?: number;
    dscr?: number;
    loyerAnnuel?: number;
    coutTotal?: number;
    margeBrute?: number;
    tauxEndettement?: number;
  };
  missing: string[];
}

// ── Presentation ──

export interface CommitteePresentationSection {
  title: string;
  paragraphs: string[];
}

export interface CommitteePresentation {
  executiveSummary: string;
  sections: CommitteePresentationSection[];
  decisionLine: string;
  conditions: string[];
}

// ── Decision Scenarios ──

export interface DecisionScenario {
  key: "conservative" | "balanced" | "opportunistic";
  label: string;
  decision: string;
  confidence: number;
  pros: string[];
  cons: string[];
  conditions: string[];
  targets: string[];
}

// ── Acceptance Probability ──

export interface AcceptanceDriver {
  label: string;
  detail?: string;
  impact: number;
}

export interface AcceptanceProbability {
  score: number;
  drivers: AcceptanceDriver[];
}

// ── Risk/Return Matrix ──

export type DominantRiskKey =
  | "dscr_deficit"
  | "ltv_critical"
  | "liquidity_low"
  | "guarantees_missing"
  | "data_missing"
  | "none";

export interface RiskReturnMatrix {
  riskScore: number;
  returnScore: number;
  quadrant: string;
  dominantRisk: DominantRiskKey;
  dominantRiskLabel: string;
  commentary: string;
}

// ── Stress Tests ──

export type StressTestKey =
  | "base"
  | "rent_-10"
  | "rent_-20"
  | "value_-10"
  | "rate_+1";

export interface StressTestCase {
  key: StressTestKey;
  label: string;
  dscr: number | null;
  ltv: number | null;
  yieldPct: number | null;
  acceptanceScore: number | null;
  notes: string[];
}

export interface StressTestPack {
  base: StressTestCase;
  cases: StressTestCase[];
  summary: {
    worstCaseKey: StressTestKey;
    worstDscr: number | null;
    worstAcceptance: number | null;
    keyFindings: string[];
  };
}

// ════════════════════════════════════════════════════════════════════
// INTERNAL HELPERS
// ════════════════════════════════════════════════════════════════════

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Safe numeric coercion: returns null for NaN, Infinity, and values <= 0.
 */
function safeNum(x: unknown): number | null {
  if (x === null || x === undefined) return null;
  const n = typeof x === "number" ? x : Number(x);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * Compute yield from loyer and cout, returning null if either is null.
 * Never returns 0 — only a real percentage or null.
 */
function safeYieldFrom(loyer: number | null, cout: number | null): number | null {
  if (loyer == null || cout == null) return null;
  return (loyer / cout) * 100;
}

function computeYield(loyerAnnuel?: number, coutTotal?: number): number | null {
  const loyer = safeNum(loyerAnnuel);
  const cout = safeNum(coutTotal);
  return safeYieldFrom(loyer, cout);
}

/**
 * Internal acceptance score calculator (reused by stress tests).
 * Returns a score 0-100 representing committee acceptance probability.
 */
function computeAcceptanceScore(
  dscr: number | null | undefined,
  ltv: number | null | undefined,
  smartScore: number | null | undefined,
  marketScore: number | null | undefined,
  missingCount: number,
): number {
  let score = 50; // baseline

  // DSCR impact
  if (dscr != null) {
    if (dscr >= 1.5) score += 18;
    else if (dscr >= 1.3) score += 14;
    else if (dscr >= 1.2) score += 10;
    else if (dscr >= 1.0) score += 2;
    else if (dscr >= 0.9) score -= 12;
    else score -= 25;
  }

  // LTV impact
  if (ltv != null) {
    if (ltv <= 40) score += 15;
    else if (ltv <= 50) score += 10;
    else if (ltv <= 60) score += 5;
    else if (ltv <= 70) score -= 2;
    else if (ltv <= 80) score -= 8;
    else score -= 18;
  }

  // SmartScore impact
  if (smartScore != null) {
    if (smartScore >= 75) score += 12;
    else if (smartScore >= 60) score += 7;
    else if (smartScore >= 45) score += 0;
    else if (smartScore >= 30) score -= 6;
    else score -= 14;
  }

  // Market impact
  if (marketScore != null) {
    if (marketScore >= 70) score += 8;
    else if (marketScore >= 50) score += 3;
    else if (marketScore >= 30) score -= 3;
    else score -= 10;
  }

  // Missing data penalty
  if (missingCount > 0) {
    score -= Math.min(missingCount * 3, 20);
  }

  return clamp(Math.round(score), 0, 100);
}

function getMarketGlobalScore(report: ReportInput): number | null {
  if (!report.marketStudy) return null;
  const insights = report.marketStudy.insights ?? [];
  const pos = insights.filter((i) => i.sentiment === "positive").length;
  const neg = insights.filter((i) => i.sentiment === "negative").length;
  const total = insights.length;
  if (total === 0) return null;
  return clamp(Math.round(((pos - neg * 0.7) / Math.max(total, 1)) * 100 + 50), 0, 100);
}

function getWeakPillars(report: ReportInput): string[] {
  if (!report.smartscore) return [];
  return report.smartscore.pillars
    .filter((p) => p.score < 40)
    .map((p) => p.label);
}

function getStrongPillars(report: ReportInput): string[] {
  if (!report.smartscore) return [];
  return report.smartscore.pillars
    .filter((p) => p.score >= 70)
    .map((p) => p.label);
}

// ════════════════════════════════════════════════════════════════════
// buildCommitteePresentation
// ════════════════════════════════════════════════════════════════════

export function buildCommitteePresentation(
  report: ReportInput,
): CommitteePresentation {
  const { kpis, missing, smartscore, marketStudy } = report;
  const sections: CommitteePresentationSection[] = [];
  const conditions: string[] = [];

  const dscr = kpis.dscr ?? null;
  const ltv = kpis.ltv ?? null;
  const marge = kpis.margeBrute ?? null;
  const yieldPct = computeYield(kpis.loyerAnnuel, kpis.coutTotal);
  const marketScore = getMarketGlobalScore(report);
  const score = smartscore?.score ?? null;
  const weakPillars = getWeakPillars(report);
  const strongPillars = getStrongPillars(report);

  // ── Executive Summary ──
  const summaryParts: string[] = [];
  summaryParts.push(
    `Le dossier "${report.programmeNom}" est presente en comite de credit pour analyse et decision.`,
  );
  if (report.adresse) summaryParts.push(`Le bien est situe ${report.adresse}.`);
  if (score != null)
    summaryParts.push(
      `Le SmartScore s'etablit a ${score}/100 (${smartscore!.verdict}).`,
    );
  if (dscr != null)
    summaryParts.push(`Le DSCR previsionnel est de ${dscr.toFixed(2)}.`);
  if (ltv != null)
    summaryParts.push(`Le ratio LTV se situe a ${ltv}%.`);
  const executiveSummary = summaryParts.join(" ");

  // ── Section: Marché ──
  {
    const paras: string[] = [];
    if (marketStudy) {
      const dvf = marketStudy.dvf;
      const insee = marketStudy.insee;
      if (dvf.prixM2Median != null && dvf.nbTransactions != null) {
        const liquidity =
          dvf.nbTransactions >= 50
            ? "un marche liquide"
            : dvf.nbTransactions >= 20
              ? "un volume correct"
              : "un marche etroit";
        paras.push(
          `L'analyse DVF fait ressortir un prix median de ${Math.round(dvf.prixM2Median)} EUR/m2 sur ${liquidity} (${dvf.nbTransactions} transactions).`,
        );
      }
      if (dvf.evolution != null) {
        if (dvf.evolution > 5)
          paras.push(
            `La tendance est haussiere (+${dvf.evolution.toFixed(1)}%), confortant la valorisation.`,
          );
        else if (dvf.evolution > 0)
          paras.push(
            `Les prix montrent une legere progression (+${dvf.evolution.toFixed(1)}%).`,
          );
        else if (dvf.evolution > -5)
          paras.push(
            `Les prix sont en leger recul (${dvf.evolution.toFixed(1)}%).`,
          );
        else
          paras.push(
            `Les prix reculent significativement (${dvf.evolution.toFixed(1)}%), facteur de risque sur la sortie.`,
          );
      }
      if (insee.revenuMedian != null) {
        if (insee.revenuMedian > 25000)
          paras.push(
            "Le bassin de population est solvable (revenu median eleve).",
          );
        else if (insee.revenuMedian < 19000)
          paras.push(
            "Le revenu median modeste peut limiter la demande.",
          );
      }
      if (insee.tauxChomage != null && insee.tauxChomage > 12) {
        paras.push(
          `Le taux de chomage local de ${insee.tauxChomage.toFixed(1)}% est preoccupant.`,
        );
      }
      if (marketStudy.commune)
        paras.push(`Commune : ${marketStudy.commune}.`);
    }
    if (paras.length === 0)
      paras.push(
        "Les donnees de marche disponibles sont insuffisantes pour une analyse approfondie.",
      );
    sections.push({ title: "Contexte de marché", paragraphs: paras });
  }

  // ── Section: Analyse financière ──
  {
    const paras: string[] = [];
    if (kpis.coutTotal != null && kpis.loyerAnnuel != null) {
      paras.push(
        `L'operation represente un cout total de ${Math.round(kpis.coutTotal / 1000)}k EUR.`,
      );
    }
    if (ltv != null) {
      if (ltv <= 50)
        paras.push(
          `Le LTV de ${ltv}% traduit une structure prudente avec un levier contenu.`,
        );
      else if (ltv <= 70)
        paras.push(
          `Le LTV de ${ltv}% reste dans les standards bancaires.`,
        );
      else
        paras.push(
          `Le LTV de ${ltv}% est eleve et necessite des garanties renforcees.`,
        );
    }
    if (dscr != null) {
      if (dscr >= 1.3)
        paras.push(
          `Le DSCR de ${dscr.toFixed(2)} offre une couverture confortable.`,
        );
      else if (dscr >= 1.0)
        paras.push(
          `Le DSCR de ${dscr.toFixed(2)} est juste suffisant pour couvrir la dette.`,
        );
      else
        paras.push(
          `Le DSCR de ${dscr.toFixed(2)} ne couvre pas le service de la dette — risque de defaut.`,
        );
    }
    if (yieldPct != null) {
      if (yieldPct >= 7)
        paras.push(
          `Le rendement brut implicite de ${yieldPct.toFixed(1)}% est attractif.`,
        );
      else if (yieldPct >= 4)
        paras.push(
          `Le rendement brut de ${yieldPct.toFixed(1)}% est dans la norme.`,
        );
      else
        paras.push(
          `Le rendement brut de ${yieldPct.toFixed(1)}% est faible.`,
        );
    }
    if (marge != null) {
      if (marge > 15)
        paras.push(`La marge brute de ${marge}% offre un coussin confortable.`);
      else if (marge > 5)
        paras.push(
          `La marge brute de ${marge}% laisse peu de place aux imprevus.`,
        );
      else
        paras.push(
          `La marge de ${marge}% est tres serree — risque en cas d'aleas.`,
        );
    }
    if (paras.length === 0)
      paras.push("Donnees financieres insuffisantes pour une analyse complete.");
    sections.push({ title: "Analyse financière", paragraphs: paras });
  }

  // ── Section: Risques & faiblesses ──
  {
    const paras: string[] = [];
    if (weakPillars.length > 0) {
      paras.push(
        `Les piliers faibles identifies sont : ${weakPillars.join(", ")}.`,
      );
    }
    if (missing.length > 0) {
      paras.push(
        `${missing.length} donnee(s) manquante(s) identifiee(s)${missing.length <= 5 ? ` : ${missing.join(", ")}` : ""}.`,
      );
    }
    if (dscr != null && dscr < 1) {
      paras.push(
        "Le deficit de couverture de la dette constitue un risque structurel majeur.",
      );
    }
    if (ltv != null && ltv > 80) {
      paras.push(
        "L'exposition bancaire est tres elevee (LTV > 80%).",
      );
    }
    if (paras.length === 0)
      paras.push("Aucun risque majeur identifie a ce stade.");
    sections.push({ title: "Risques et points d'attention", paragraphs: paras });
  }

  // ── Section: Forces ──
  if (strongPillars.length > 0) {
    sections.push({
      title: "Points forts",
      paragraphs: [
        `Les piliers solides du dossier sont : ${strongPillars.join(", ")}.`,
      ],
    });
  }

  // ── Decision line ──
  let decisionLine: string;
  if (dscr != null && dscr < 1) {
    decisionLine =
      "DECISION : NO GO en l'etat — Le DSCR est inferieur a 1, les revenus ne couvrent pas la dette.";
  } else if (missing.length >= 3 && ltv != null && ltv > 70) {
    decisionLine =
      "DECISION : Reserve — Donnees manquantes et levier eleve.";
  } else if (missing.length > 0) {
    decisionLine =
      "DECISION : GO sous conditions — Levee des donnees manquantes requise.";
  } else if (score != null && score >= 65) {
    decisionLine = `DECISION : GO — SmartScore ${score}/100, fondamentaux reunis.`;
  } else if (score != null && score >= 40) {
    decisionLine = `DECISION : GO sous conditions — SmartScore ${score}/100, suivi renforce recommande.`;
  } else {
    decisionLine =
      "DECISION : Reserve — Le dossier necessite des complements significatifs.";
  }

  // ── Conditions ──
  if (missing.length > 0) {
    for (const m of missing.slice(0, 8)) {
      conditions.push(`Fournir : ${m}`);
    }
  }
  if (dscr != null && dscr < 1.2 && dscr >= 1.0) {
    conditions.push("Suivi trimestriel du DSCR");
  }
  if (ltv != null && ltv > 70) {
    conditions.push("Renforcer les garanties ou reduire le LTV");
  }
  if (weakPillars.length > 0) {
    conditions.push(
      `Documenter / renforcer les piliers faibles (${weakPillars.join(", ")})`,
    );
  }

  return { executiveSummary, sections, decisionLine, conditions };
}

// ════════════════════════════════════════════════════════════════════
// buildDecisionScenarios
// ════════════════════════════════════════════════════════════════════

export function buildDecisionScenarios(
  report: ReportInput,
): DecisionScenario[] {
  const { kpis, missing, smartscore } = report;
  const dscr = kpis.dscr ?? null;
  const ltv = kpis.ltv ?? null;
  const score = smartscore?.score ?? 0;
  const marketScore = getMarketGlobalScore(report);
  const weakPillars = getWeakPillars(report);
  const strongPillars = getStrongPillars(report);
  const yieldPct = computeYield(kpis.loyerAnnuel, kpis.coutTotal);

  // Common pros/cons
  const commonPros: string[] = [];
  const commonCons: string[] = [];

  if (dscr != null && dscr >= 1.2)
    commonPros.push(`Couverture de dette satisfaisante (DSCR ${dscr.toFixed(2)})`);
  if (ltv != null && ltv <= 50)
    commonPros.push(`Levier contenu (LTV ${ltv}%)`);
  if (marketScore != null && marketScore >= 60)
    commonPros.push(`Marche porteur (score ${marketScore}/100)`);
  if (score >= 65)
    commonPros.push(`SmartScore solide (${score}/100)`);
  for (const p of strongPillars.slice(0, 2))
    commonPros.push(`Pilier fort : ${p}`);

  if (dscr != null && dscr < 1)
    commonCons.push(`DSCR insuffisant (${dscr.toFixed(2)})`);
  if (ltv != null && ltv > 70)
    commonCons.push(`LTV eleve (${ltv}%)`);
  if (marketScore != null && marketScore < 40)
    commonCons.push(`Marche defavorable (${marketScore}/100)`);
  if (missing.length > 0)
    commonCons.push(`${missing.length} donnee(s) manquante(s)`);
  for (const p of weakPillars.slice(0, 2))
    commonCons.push(`Pilier faible : ${p}`);

  // ── Conservative ──
  const conservative: DecisionScenario = (() => {
    const isNoGo =
      (dscr != null && dscr < 1) || missing.length >= 3;
    const isGoCondStrict =
      !isNoGo && (missing.length > 0 || (ltv != null && ltv > 60));
    const isGoCond = !isNoGo && !isGoCondStrict && score < 70;

    let decision: string;
    let confidence: number;
    const conditions: string[] = [];
    const targets: string[] = [];

    if (isNoGo) {
      decision = "NO GO";
      confidence = dscr != null && dscr < 0.8 ? 85 : 70;
      targets.push("Restructurer le plan de financement");
      if (dscr != null && dscr < 1) targets.push("Amener le DSCR au-dessus de 1.0");
      if (missing.length >= 3) targets.push("Completer les donnees manquantes");
    } else if (isGoCondStrict) {
      decision = "GO sous conditions strictes";
      confidence = 55;
      for (const m of missing.slice(0, 5)) conditions.push(m);
      if (ltv != null && ltv > 60)
        conditions.push("Reduire le LTV sous 60%");
      targets.push("Levee integrale des conditions avant engagement");
    } else if (isGoCond) {
      decision = "GO sous conditions";
      confidence = 60;
      conditions.push("Suivi trimestriel renforce");
      for (const m of missing.slice(0, 3)) conditions.push(m);
    } else {
      decision = "GO";
      confidence = 75;
    }

    return {
      key: "conservative" as const,
      label: "Conservateur",
      decision,
      confidence,
      pros: commonPros.length > 0 ? commonPros : ["Aucun point favorable majeur identifie"],
      cons: commonCons.length > 0 ? commonCons : ["Aucun point defavorable majeur"],
      conditions,
      targets,
    };
  })();

  // ── Balanced ──
  const balanced: DecisionScenario = (() => {
    const goFull =
      ltv != null &&
      ltv < 50 &&
      missing.length === 0 &&
      (dscr == null || dscr >= 1.2);
    const isNoGo =
      dscr != null && dscr < 1 && missing.length >= 3;

    let decision: string;
    let confidence: number;
    const conditions: string[] = [];
    const targets: string[] = [];

    if (goFull) {
      decision = "GO";
      confidence = 80;
    } else if (isNoGo) {
      decision = "NO GO";
      confidence = 75;
      targets.push("Revoir le plan de financement");
    } else {
      decision = "GO sous conditions";
      confidence = 65;
      for (const m of missing.slice(0, 4)) conditions.push(m);
      if (ltv != null && ltv > 70)
        conditions.push("Renforcer les garanties");
      if (dscr != null && dscr < 1.2)
        conditions.push("Suivi DSCR semestriel");
    }

    return {
      key: "balanced" as const,
      label: "Equilibre",
      decision,
      confidence,
      pros: commonPros.length > 0 ? commonPros : ["Aucun point favorable majeur"],
      cons: commonCons.length > 0 ? commonCons : ["Aucun point defavorable majeur"],
      conditions,
      targets,
    };
  })();

  // ── Opportunistic ──
  const opportunistic: DecisionScenario = (() => {
    const goPatri =
      ltv != null && ltv < 50 && (marketScore == null || marketScore > 50);

    let decision: string;
    let confidence: number;
    const conditions: string[] = [];
    const targets: string[] = [];

    if (goPatri) {
      decision = "GO patrimonial";
      confidence = 75;
      if (dscr != null && dscr < 1)
        conditions.push(
          "Reserve de couverture temporaire du service de la dette",
        );
    } else {
      decision = "GO sous conditions";
      confidence = 60;
      for (const m of missing.slice(0, 3)) conditions.push(m);
      if (ltv != null && ltv >= 50)
        conditions.push("Renforcer l'apport pour reduire le LTV");
    }

    targets.push("Valorisation patrimoniale long terme");
    if (yieldPct != null && yieldPct >= 6)
      targets.push("Capitaliser sur le rendement locatif");

    return {
      key: "opportunistic" as const,
      label: "Opportuniste",
      decision,
      confidence,
      pros: commonPros.length > 0 ? commonPros : ["Aucun point favorable majeur"],
      cons: commonCons.length > 0 ? commonCons : ["Aucun point defavorable majeur"],
      conditions,
      targets,
    };
  })();

  // Order: conservative first (used as dominant decision in PDF)
  return [conservative, balanced, opportunistic];
}

// ════════════════════════════════════════════════════════════════════
// buildAcceptanceProbability
// ════════════════════════════════════════════════════════════════════

export function buildAcceptanceProbability(
  report: ReportInput,
): AcceptanceProbability {
  const { kpis, missing, smartscore, marketStudy } = report;
  const dscr = kpis.dscr ?? null;
  const ltv = kpis.ltv ?? null;
  const marge = kpis.margeBrute ?? null;
  const score = smartscore?.score ?? null;
  const marketScore = getMarketGlobalScore(report);
  const yieldPct = computeYield(kpis.loyerAnnuel, kpis.coutTotal);

  const acceptanceScore = computeAcceptanceScore(
    dscr,
    ltv,
    score,
    marketScore,
    missing.length,
  );

  // Build drivers with impact reasoning
  const drivers: AcceptanceDriver[] = [];

  // DSCR driver
  if (dscr != null) {
    if (dscr >= 1.5)
      drivers.push({
        label: "DSCR",
        detail: `${dscr.toFixed(2)} — couverture tres confortable`,
        impact: 18,
      });
    else if (dscr >= 1.3)
      drivers.push({
        label: "DSCR",
        detail: `${dscr.toFixed(2)} — couverture solide`,
        impact: 14,
      });
    else if (dscr >= 1.2)
      drivers.push({
        label: "DSCR",
        detail: `${dscr.toFixed(2)} — acceptable`,
        impact: 10,
      });
    else if (dscr >= 1.0)
      drivers.push({
        label: "DSCR",
        detail: `${dscr.toFixed(2)} — juste suffisant`,
        impact: 2,
      });
    else
      drivers.push({
        label: "DSCR",
        detail: `${dscr.toFixed(2)} — deficit de couverture`,
        impact: dscr >= 0.9 ? -12 : -25,
      });
  }

  // LTV driver
  if (ltv != null) {
    if (ltv <= 40)
      drivers.push({
        label: "LTV",
        detail: `${ltv}% — structure tres prudente`,
        impact: 15,
      });
    else if (ltv <= 50)
      drivers.push({
        label: "LTV",
        detail: `${ltv}% — levier contenu`,
        impact: 10,
      });
    else if (ltv <= 60)
      drivers.push({
        label: "LTV",
        detail: `${ltv}% — standard`,
        impact: 5,
      });
    else if (ltv <= 70)
      drivers.push({
        label: "LTV",
        detail: `${ltv}% — fourchette haute`,
        impact: -2,
      });
    else if (ltv <= 80)
      drivers.push({
        label: "LTV",
        detail: `${ltv}% — eleve`,
        impact: -8,
      });
    else
      drivers.push({
        label: "LTV",
        detail: `${ltv}% — tres eleve`,
        impact: -18,
      });
  }

  // SmartScore driver
  if (score != null) {
    if (score >= 75)
      drivers.push({
        label: "SmartScore",
        detail: `${score}/100 — excellent`,
        impact: 12,
      });
    else if (score >= 60)
      drivers.push({
        label: "SmartScore",
        detail: `${score}/100 — bon`,
        impact: 7,
      });
    else if (score >= 45)
      drivers.push({
        label: "SmartScore",
        detail: `${score}/100 — moyen`,
        impact: 0,
      });
    else
      drivers.push({
        label: "SmartScore",
        detail: `${score}/100 — faible`,
        impact: score >= 30 ? -6 : -14,
      });
  }

  // Market driver
  if (marketScore != null) {
    if (marketScore >= 70)
      drivers.push({
        label: "Marche",
        detail: `Score ${marketScore}/100 — porteur`,
        impact: 8,
      });
    else if (marketScore >= 50)
      drivers.push({
        label: "Marche",
        detail: `Score ${marketScore}/100 — neutre`,
        impact: 3,
      });
    else if (marketScore >= 30)
      drivers.push({
        label: "Marche",
        detail: `Score ${marketScore}/100 — tendu`,
        impact: -3,
      });
    else
      drivers.push({
        label: "Marche",
        detail: `Score ${marketScore}/100 — defavorable`,
        impact: -10,
      });
  }

  // Marge driver
  if (marge != null) {
    if (marge > 15)
      drivers.push({
        label: "Marge brute",
        detail: `${marge}% — confortable`,
        impact: 5,
      });
    else if (marge < 5)
      drivers.push({
        label: "Marge brute",
        detail: `${marge}% — serree`,
        impact: -5,
      });
  }

  // Yield driver
  if (yieldPct != null) {
    if (yieldPct >= 7)
      drivers.push({
        label: "Rendement brut",
        detail: `${yieldPct.toFixed(1)}% — attractif`,
        impact: 4,
      });
    else if (yieldPct < 4)
      drivers.push({
        label: "Rendement brut",
        detail: `${yieldPct.toFixed(1)}% — faible`,
        impact: -4,
      });
  }

  // Missing data driver
  if (missing.length > 0) {
    const penalty = Math.min(missing.length * 3, 20);
    drivers.push({
      label: "Donnees manquantes",
      detail: `${missing.length} element(s)`,
      impact: -penalty,
    });
  }

  // Sort by absolute impact
  drivers.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));

  return { score: acceptanceScore, drivers };
}

// ════════════════════════════════════════════════════════════════════
// buildRiskReturnMatrix
// ════════════════════════════════════════════════════════════════════

/**
 * Determine the dominant risk following the priority waterfall:
 *   1. DSCR < 1          → dscr_deficit
 *   2. LTV > 80%         → ltv_critical
 *   3. DVF transactions < 20 → liquidity_low
 *   4. Guarantees missing (pillar "Garanties" weak or absent) → guarantees_missing
 *   5. Missing data > 2  → data_missing
 *   6. none
 */
function resolveDominantRisk(
  report: ReportInput,
): { key: DominantRiskKey; label: string } {
  const dscr = report.kpis.dscr ?? null;
  const ltv = report.kpis.ltv ?? null;
  const nbTransactions = report.marketStudy?.dvf?.nbTransactions ?? null;
  const weakPillars = getWeakPillars(report);

  // Priority 1 — DSCR deficit
  if (dscr != null && dscr < 1) {
    return {
      key: "dscr_deficit",
      label: `Deficit de couverture de dette (DSCR ${dscr.toFixed(2)})`,
    };
  }

  // Priority 2 — LTV critical
  if (ltv != null && ltv > 80) {
    return {
      key: "ltv_critical",
      label: `Exposition bancaire critique (LTV ${ltv}%)`,
    };
  }

  // Priority 3 — Low liquidity
  if (nbTransactions != null && nbTransactions < 20) {
    return {
      key: "liquidity_low",
      label: `Marche peu liquide (${nbTransactions} transactions DVF)`,
    };
  }

  // Priority 4 — Guarantees missing / weak
  const hasGuaranteeWeakness = weakPillars.some(
    (p) => p.toLowerCase().includes("garantie") || p.toLowerCase().includes("surete"),
  );
  if (hasGuaranteeWeakness) {
    return {
      key: "guarantees_missing",
      label: "Garanties insuffisantes ou absentes",
    };
  }

  // Priority 5 — Missing data > 2
  if (report.missing.length > 2) {
    return {
      key: "data_missing",
      label: `Donnees manquantes significatives (${report.missing.length} elements)`,
    };
  }

  return { key: "none", label: "Aucun risque dominant identifie" };
}

export function buildRiskReturnMatrix(
  report: ReportInput,
): RiskReturnMatrix {
  const { kpis, missing, smartscore, marketStudy } = report;
  const dscr = kpis.dscr ?? null;
  const ltv = kpis.ltv ?? null;
  const marge = kpis.margeBrute ?? null;
  const score = smartscore?.score ?? null;
  const marketScore = getMarketGlobalScore(report);

  // Safe yield computation — never 0, always null if indeterminate
  const loyerBase = safeNum(report.kpis?.loyerAnnuel);
  const coutBase = safeNum(report.kpis?.coutTotal);
  const yieldPct = safeYieldFrom(loyerBase, coutBase);

  // Stress yield -10% loyers (direct computation, no report clone)
  const yieldStress = safeYieldFrom(loyerBase != null ? loyerBase * 0.9 : null, coutBase);

  // ── Dominant Risk ──
  const { key: dominantRisk, label: dominantRiskLabel } = resolveDominantRisk(report);

  // ── Risk Score (0=low risk, 100=high risk) ──
  let risk = 50;
  if (ltv != null) {
    if (ltv > 80) risk += 20;
    else if (ltv > 70) risk += 10;
    else if (ltv > 60) risk += 3;
    else if (ltv <= 40) risk -= 15;
    else if (ltv <= 50) risk -= 10;
    else risk -= 3;
  }
  if (dscr != null) {
    if (dscr < 1) risk += 20;
    else if (dscr < 1.2) risk += 5;
    else if (dscr >= 1.5) risk -= 12;
    else risk -= 5;
  }
  if (score != null) {
    if (score < 30) risk += 10;
    else if (score >= 70) risk -= 10;
  }
  if (marketScore != null && marketScore < 30) risk += 8;
  if (missing.length > 3) risk += 8;
  else if (missing.length > 0) risk += 3;

  // Stress yield contributes to risk when it drops below 4%
  if (yieldStress != null && yieldStress < 4) risk += 5;

  risk = clamp(Math.round(risk), 0, 100);

  // ── Return Score (0=low return, 100=high return) ──
  let ret = 40;
  if (yieldPct != null) {
    if (yieldPct >= 8) ret += 25;
    else if (yieldPct >= 6) ret += 18;
    else if (yieldPct >= 4) ret += 8;
    else ret -= 5;
  }
  if (marge != null) {
    if (marge >= 20) ret += 18;
    else if (marge >= 10) ret += 10;
    else if (marge >= 5) ret += 3;
    else ret -= 5;
  }
  if (dscr != null && dscr >= 1.5) ret += 5;
  if (marketScore != null) {
    if (marketScore >= 70) ret += 8;
    else if (marketScore < 30) ret -= 5;
  }
  ret = clamp(Math.round(ret), 0, 100);

  // ── Quadrant ──
  let quadrant: string;
  if (risk <= 40 && ret >= 60) quadrant = "Optimal — Rendement eleve / Risque faible";
  else if (risk <= 40 && ret < 60)
    quadrant = "Prudent — Risque faible / Rendement modere";
  else if (risk > 60 && ret >= 60)
    quadrant = "Vigilance — Rendement eleve / Risque eleve";
  else if (risk > 60 && ret < 60)
    quadrant = "Defavorable — Risque eleve / Rendement faible";
  else quadrant = "Zone intermediaire — Attention requise";

  // ── Commentary (max 5 phrases) ──
  const parts: string[] = [];

  // 1. Quadrant overview
  if (risk <= 40 && ret >= 60) {
    parts.push(
      "Le dossier se positionne dans le cadran optimal avec un bon equilibre rendement/risque.",
    );
  } else if (risk > 60 && ret < 60) {
    parts.push(
      "Le profil risque/rendement est defavorable : le niveau de risque n'est pas compense par un rendement suffisant.",
    );
  } else if (risk > 60) {
    parts.push(
      "Le rendement est attractif mais le niveau de risque appelle a la vigilance et a des conditions renforcees.",
    );
  } else {
    parts.push(
      "Le profil risque/rendement se situe dans une zone intermediaire qui appelle a un examen attentif.",
    );
  }

  // 2. Specific risk/return drivers
  if (ltv != null && ltv > 70)
    parts.push(`Le LTV de ${ltv}% pese sur le score de risque.`);
  if (yieldPct != null && yieldPct >= 7)
    parts.push(
      `Le rendement brut de ${yieldPct.toFixed(1)}% est un atout majeur.`,
    );
  if (yieldStress != null && yieldPct != null && yieldStress < 4 && yieldPct >= 4)
    parts.push(
      `En stress loyers -10%, le rendement tombe a ${yieldStress.toFixed(1)}%, sous le seuil de confort.`,
    );
  if (marge != null && marge < 5)
    parts.push("La marge serree limite le potentiel de rendement.");

  // 3. Risk/return unfavorable coupling alert
  if (risk > 70 && ret < 50 && parts.length < 5) {
    parts.push(
      "Le couple rendement/risque est defavorable : le risque eleve (score " +
        risk +
        "/100) n'est pas compense par un rendement suffisant (score " +
        ret +
        "/100), rendant l'operation difficilement justifiable en l'etat.",
    );
  }

  // 4. DSCR stress phrase when DSCR < 1.2
  if (dscr != null && dscr < 1.2 && parts.length < 5) {
    const dscrStressed = Math.round(dscr * 0.9 * 100) / 100;
    if (dscrStressed < 1) {
      parts.push(
        `En stress taux +1% (DSCR estime a ${dscrStressed.toFixed(2)}), la couverture de dette passe sous 1 — le dossier ne resisterait pas a une hausse de taux.`,
      );
    } else {
      parts.push(
        `En stress taux +1% (DSCR estime a ${dscrStressed.toFixed(2)}), la couverture reste positive mais avec une marge tres reduite.`,
      );
    }
  }

  // Enforce max 5 phrases
  const trimmedParts = parts.slice(0, 5);

  return {
    riskScore: risk,
    returnScore: ret,
    quadrant,
    dominantRisk,
    dominantRiskLabel,
    commentary: trimmedParts.join(" "),
  };
}

// ════════════════════════════════════════════════════════════════════
// buildStressTests
// ════════════════════════════════════════════════════════════════════

export function buildStressTests(report: ReportInput): StressTestPack {
  const { kpis } = report;
  const baseDscr = kpis.dscr ?? null;
  const baseLtv = kpis.ltv ?? null;
  const loyerBase = safeNum(kpis.loyerAnnuel);
  const coutBase = safeNum(kpis.coutTotal);
  const baseYield = safeYieldFrom(loyerBase, coutBase);

  // ── Helper: compute notes for a given case ──
  function buildNotes(
    dscr: number | null,
    ltv: number | null,
    yieldPct: number | null,
    acceptance: number | null,
  ): string[] {
    const notes: string[] = [];
    if (dscr != null && dscr < 1)
      notes.push("Déficit de couverture");
    if (ltv != null && ltv > 80)
      notes.push("LTV > 80%");
    if (yieldPct != null && yieldPct < 4)
      notes.push("Rendement faible");
    if (acceptance != null && acceptance < 30)
      notes.push("Acceptation très improbable");
    return notes;
  }

  /**
   * Build a full report clone with stressed kpis and compute acceptance
   * via buildAcceptanceProbability. Preserves smartscore, marketStudy, missing.
   */
  function stressedAcceptance(
    dscr: number | null,
    ltv: number | null,
    loyerAnnuel?: number | null,
  ): number {
    const clone: ReportInput = {
      ...report,
      kpis: {
        ...report.kpis,
        ...(dscr != null ? { dscr } : {}),
        ...(ltv != null ? { ltv } : {}),
        ...(loyerAnnuel != null ? { loyerAnnuel } : {}),
      },
    };
    return buildAcceptanceProbability(clone).score;
  }

  // ── BASE case ──
  const baseAcceptance = stressedAcceptance(baseDscr, baseLtv);
  const base: StressTestCase = {
    key: "base",
    label: "Scénario de base",
    dscr: baseDscr,
    ltv: baseLtv,
    yieldPct: baseYield != null ? Math.round(baseYield * 100) / 100 : null,
    acceptanceScore: baseAcceptance,
    notes: buildNotes(baseDscr, baseLtv, baseYield, baseAcceptance),
  };

  // ── rent_-10: Loyers -10% ──
  const rent10Dscr = baseDscr != null ? Math.round(baseDscr * 0.9 * 100) / 100 : null;
  const rent10Loyer = loyerBase != null ? loyerBase * 0.9 : null;
  const rent10Yield = safeYieldFrom(rent10Loyer, coutBase);
  const rent10YieldRounded = rent10Yield != null ? Math.round(rent10Yield * 100) / 100 : null;
  const rent10Acceptance = stressedAcceptance(rent10Dscr, baseLtv, rent10Loyer);
  const rent10: StressTestCase = {
    key: "rent_-10",
    label: "Loyers -10%",
    dscr: rent10Dscr,
    ltv: baseLtv,
    yieldPct: rent10YieldRounded,
    acceptanceScore: rent10Acceptance,
    notes: buildNotes(rent10Dscr, baseLtv, rent10Yield, rent10Acceptance),
  };

  // ── rent_-20: Loyers -20% ──
  const rent20Dscr = baseDscr != null ? Math.round(baseDscr * 0.8 * 100) / 100 : null;
  const rent20Loyer = loyerBase != null ? loyerBase * 0.8 : null;
  const rent20Yield = safeYieldFrom(rent20Loyer, coutBase);
  const rent20YieldRounded = rent20Yield != null ? Math.round(rent20Yield * 100) / 100 : null;
  const rent20Acceptance = stressedAcceptance(rent20Dscr, baseLtv, rent20Loyer);
  const rent20: StressTestCase = {
    key: "rent_-20",
    label: "Loyers -20%",
    dscr: rent20Dscr,
    ltv: baseLtv,
    yieldPct: rent20YieldRounded,
    acceptanceScore: rent20Acceptance,
    notes: buildNotes(rent20Dscr, baseLtv, rent20Yield, rent20Acceptance),
  };

  // ── value_-10: Valeur du bien -10% => LTV augmente ──
  // If asset value drops 10%, the LTV = baseLtv / 0.9
  const value10Ltv =
    baseLtv != null
      ? Math.round((baseLtv / 0.9) * 100) / 100
      : null;
  const value10Acceptance = stressedAcceptance(baseDscr, value10Ltv);
  const value10: StressTestCase = {
    key: "value_-10",
    label: "Valeur du bien -10%",
    dscr: baseDscr,
    ltv: value10Ltv,
    yieldPct: baseYield != null ? Math.round(baseYield * 100) / 100 : null,
    acceptanceScore: value10Acceptance,
    notes: buildNotes(baseDscr, value10Ltv, baseYield, value10Acceptance),
  };

  // ── rate_+1: Taux +1% => DSCR impacté (~-10%) ──
  const rate1Dscr = baseDscr != null ? Math.round(baseDscr * 0.9 * 100) / 100 : null;
  const rate1Acceptance = stressedAcceptance(rate1Dscr, baseLtv);
  const rate1: StressTestCase = {
    key: "rate_+1",
    label: "Taux d'intérêt +1%",
    dscr: rate1Dscr,
    ltv: baseLtv,
    yieldPct: baseYield != null ? Math.round(baseYield * 100) / 100 : null,
    acceptanceScore: rate1Acceptance,
    notes: buildNotes(rate1Dscr, baseLtv, baseYield, rate1Acceptance),
  };

  // ── All stressed cases (excluding base) ──
  const cases: StressTestCase[] = [rent10, rent20, value10, rate1];

  // ── Summary ──
  const allCases = [base, ...cases];
  const withAcceptance = allCases.filter(
    (c) => c.acceptanceScore != null,
  ) as Array<StressTestCase & { acceptanceScore: number }>;

  const worstByAcceptance =
    withAcceptance.length > 0
      ? withAcceptance.reduce((prev, cur) =>
          cur.acceptanceScore < prev.acceptanceScore ? cur : prev,
        )
      : null;

  const worstDscrCase = allCases
    .filter((c) => c.dscr != null)
    .reduce<StressTestCase | null>(
      (prev, cur) =>
        prev == null || (cur.dscr != null && (prev.dscr == null || cur.dscr < prev.dscr))
          ? cur
          : prev,
      null,
    );

  // Key findings (max 3 bullets)
  const keyFindings: string[] = [];

  // 1. Worst case overview
  if (worstByAcceptance && worstByAcceptance.key !== "base") {
    keyFindings.push(
      `Le scenario le plus defavorable est "${worstByAcceptance.label}" avec une probabilite d'acceptation de ${worstByAcceptance.acceptanceScore}%.`,
    );
  }

  // 2. DSCR breach check
  const dscrBreachCases = cases.filter(
    (c) => c.dscr != null && c.dscr < 1,
  );
  if (dscrBreachCases.length > 0) {
    if (dscrBreachCases.length === cases.length) {
      keyFindings.push(
        "Le DSCR passe sous 1 dans tous les scenarios de stress — resilience insuffisante.",
      );
    } else {
      const labels = dscrBreachCases.map((c) => c.label).join(", ");
      keyFindings.push(
        `Le DSCR passe sous 1 dans ${dscrBreachCases.length} scenario(s) (${labels}).`,
      );
    }
  } else if (baseDscr != null && baseDscr >= 1) {
    keyFindings.push(
      "Le DSCR reste au-dessus de 1 dans tous les scenarios — bonne resilience.",
    );
  }

  // 3. LTV breach check
  const ltvBreachCases = cases.filter(
    (c) => c.ltv != null && c.ltv > 80,
  );
  if (ltvBreachCases.length > 0) {
    const labels = ltvBreachCases.map((c) => c.label).join(", ");
    keyFindings.push(
      `Le LTV depasse 80% en scenario "${labels}" — exposition bancaire critique.`,
    );
  }

  // Ensure max 3 findings
  const trimmedFindings = keyFindings.slice(0, 3);

  return {
    base,
    cases,
    summary: {
      worstCaseKey: worstByAcceptance?.key ?? "base",
      worstDscr: worstDscrCase?.dscr ?? null,
      worstAcceptance: worstByAcceptance?.acceptanceScore ?? null,
      keyFindings: trimmedFindings,
    },
  };
}