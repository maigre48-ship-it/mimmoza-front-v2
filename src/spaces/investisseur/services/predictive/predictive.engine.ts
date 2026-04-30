import type {
  PredictiveEngineInput,
  PredictiveAnalysisSnapshot,
  PredictiveMarketRegime,
  PredictivePoint,
  PredictiveDriver,
  PredictiveDataSource,
} from "./predictive.types";

// ── Helpers ──────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function deptFromCp(cp: string): number {
  return parseInt(cp.slice(0, 2), 10) || 75;
}

function norm100(v: number | undefined): number | undefined {
  if (v == null || !Number.isFinite(v)) return undefined;
  if (v >= 0 && v <= 1) return Math.round(v * 100);
  return clamp(Math.round(v), 0, 100);
}

// ── Spot price : DVF réel > acquisition fallback ─────────────────────

function resolveSpotPsm(input: PredictiveEngineInput): {
  spotPsm: number;
  source: "dvf" | "acquisition";
  confidence: number;
} {
  const dvfMedian = input.dvf?.prixM2Median;
  if (dvfMedian != null && dvfMedian > 0) {
    return { spotPsm: Math.round(dvfMedian), source: "dvf", confidence: 85 };
  }
  const acqPsm = input.surfaceM2 > 0
    ? Math.round(input.acquisitionPrice / input.surfaceM2)
    : 0;
  return { spotPsm: acqPsm, source: "acquisition", confidence: 55 };
}

// ── Market regime from real scores ───────────────────────────────────

function resolveRegime(input: PredictiveEngineInput): PredictiveMarketRegime {
  const scores = input.marketScores;
  if (!scores?.global) {
    // fallback heuristic
    const dept = deptFromCp(input.codePostal);
    if ([75, 92, 69, 31, 33].includes(dept)) return "hausse";
    if ([93, 94, 78, 44, 67, 59, 34, 6, 13].includes(dept)) return "reprise";
    return "plateau";
  }
  const g = norm100(scores.global) ?? 50;
  if (g >= 75) return "hausse";
  if (g >= 60) return "reprise";
  if (g >= 40) return "plateau";
  return "correction";
}

// ── Market scores: real > fallback ───────────────────────────────────

function resolveMarketScores(input: PredictiveEngineInput): {
  pressureScore: number;
  liquidityScore: number;
  riskScore: number;
} {
  const ms = input.marketScores;
  const dept = deptFromCp(input.codePostal);

  // Pression = demande réelle ou heuristique
  const pressureScore = norm100(ms?.demande)
    ?? norm100(ms?.global)
    ?? clamp(Math.round(60 + (dept <= 75 ? 20 : dept <= 69 ? 10 : 0)), 30, 95);

  // Liquidité = score liquidité réel ou demande
  const liquidityScore = norm100(ms?.liquidite)
    ?? norm100(ms?.demande)
    ?? clamp(Math.round(55 + (dept <= 92 ? 15 : 0)), 25, 95);

  // Risque = pression risque réelle ou inverse du score global
  const riskScore = norm100(ms?.pressionRisque)
    ?? norm100(ms?.environnement)
    ?? clamp(Math.round(100 - pressureScore * 0.5 - liquidityScore * 0.2), 15, 75);

  return { pressureScore, liquidityScore, riskScore };
}

// ── Forecast rates: DVF evolution > scores > heuristic ───────────────

function resolveForecastRates(input: PredictiveEngineInput): {
  rate6: number; rate12: number; rate18: number; rate24: number;
  rateSource: "dvf_evolution" | "market_scores" | "heuristic";
} {
  // 1) DVF evolution annuelle réelle
  const dvfEvol = input.dvf?.evolutionPctAnnuelle;
  if (dvfEvol != null && Number.isFinite(dvfEvol)) {
    const annualRate = dvfEvol / 100;
    return {
      rate6: annualRate * 0.5,
      rate12: annualRate,
      rate18: annualRate * 1.4,
      rate24: annualRate * 1.75,
      rateSource: "dvf_evolution",
    };
  }

  // 2) Dérivé des scores marché réels
  const g = norm100(input.marketScores?.global);
  if (g != null) {
    // Score 0-100 → taux annuel entre -3% et +8%
    const annualRate = ((g - 40) / 60) * 0.08;
    return {
      rate6: annualRate * 0.5,
      rate12: annualRate,
      rate18: annualRate * 1.35,
      rate24: annualRate * 1.65,
      rateSource: "market_scores",
    };
  }

  // 3) Heuristique département
  const dept = deptFromCp(input.codePostal);
  const base = [75, 92].includes(dept) ? 0.035
    : [69, 31, 33, 44, 67, 59, 34, 6, 13, 93, 94].includes(dept) ? 0.025
    : 0.015;
  return {
    rate6: base * 0.5,
    rate12: base,
    rate18: base * 1.4,
    rate24: base * 1.75,
    rateSource: "heuristic",
  };
}

// ── Build forecast point ─────────────────────────────────────────────

function buildPoint(spotPsm: number, surface: number, rate: number, months: number, baseConfidence: number): PredictivePoint {
  const projected = spotPsm * (1 + rate);
  return {
    pricePerSqm: Math.round(projected),
    marketValue: Math.round(projected * surface),
    deltaPercent: parseFloat((rate * 100).toFixed(1)),
    confidenceScore: clamp(Math.round(baseConfidence - months * 2), 35, 95),
  };
}

// ── Drivers from real data ───────────────────────────────────────────

function buildDrivers(input: PredictiveEngineInput): PredictiveDriver[] {
  const ms = input.marketScores;
  const dvf = input.dvf;
  const bpe = input.bpe;
  const dept = deptFromCp(input.codePostal);
  const drivers: PredictiveDriver[] = [];

  // DVF dynamique
  if (dvf?.nbTransactions != null) {
    const active = dvf.nbTransactions >= 50;
    drivers.push({
      key: "dvf_volume",
      label: "Volume DVF",
      direction: active ? "positive" : "negative",
      impact: active ? 70 : 55,
      description: active
        ? `${dvf.nbTransactions} transactions récentes — marché actif, bonne liquidité.`
        : `${dvf.nbTransactions} transactions récentes — marché peu liquide, délai de vente allongé.`,
    });
  }

  if (dvf?.evolutionPctAnnuelle != null) {
    const evol = dvf.evolutionPctAnnuelle;
    drivers.push({
      key: "dvf_evolution",
      label: "Tendance prix DVF",
      direction: evol > 1 ? "positive" : evol < -1 ? "negative" : "neutral",
      impact: clamp(Math.round(Math.abs(evol) * 10), 20, 80),
      description: `Évolution annuelle des prix : ${evol >= 0 ? "+" : ""}${evol.toFixed(1)}% (source DVF).`,
    });
  }

  // DVF prix/m² vs acquisition
  if (dvf?.prixM2Median != null && input.surfaceM2 > 0) {
    const acqPsm = input.acquisitionPrice / input.surfaceM2;
    const ecartPct = ((dvf.prixM2Median - acqPsm) / acqPsm) * 100;
    if (Math.abs(ecartPct) > 3) {
      drivers.push({
        key: "dvf_ecart_prix",
        label: "Écart prix vs marché DVF",
        direction: ecartPct > 0 ? "positive" : "negative",
        impact: clamp(Math.round(Math.abs(ecartPct) * 3), 25, 85),
        description: ecartPct > 0
          ? `Prix d'achat ${Math.abs(ecartPct).toFixed(0)}% sous le marché DVF — potentiel de plus-value.`
          : `Prix d'achat ${Math.abs(ecartPct).toFixed(0)}% au-dessus du marché DVF — marge comprimée.`,
      });
    }
  }

  // Scores marché réels
  if (ms?.demande != null) {
    const d = norm100(ms.demande) ?? 50;
    drivers.push({
      key: "demande_marche",
      label: "Demande locative / achat",
      direction: d >= 65 ? "positive" : d >= 40 ? "neutral" : "negative",
      impact: clamp(d, 20, 85),
      description: `Score demande : ${d}/100 — ${d >= 65 ? "forte pression, délais courts" : d >= 40 ? "demande standard" : "demande faible, risque vacance"}.`,
    });
  }

  if (ms?.offre != null) {
    const o = norm100(ms.offre) ?? 50;
    drivers.push({
      key: "offre_marche",
      label: "Tension offre",
      direction: o >= 60 ? "positive" : o >= 40 ? "neutral" : "negative",
      impact: clamp(o, 20, 75),
      description: `Score offre : ${o}/100 — ${o >= 60 ? "offre restreinte, soutient les prix" : "offre suffisante"}.`,
    });
  }

  // BPE
  if (bpe?.score != null) {
    const b = norm100(bpe.score) ?? 50;
    drivers.push({
      key: "bpe_equipements",
      label: "Équipements & cadre de vie",
      direction: b >= 60 ? "positive" : b >= 40 ? "neutral" : "negative",
      impact: clamp(Math.round(b * 0.7), 15, 60),
      description: `BPE Score ${b}/100 — ${b >= 60 ? "cadre de vie attractif" : "équipements limités"}.`,
    });
  }

  // Travaux (seulement si un budget réel est renseigné via Simulation ou saisie)
  if (input.travauxEstime && input.travauxEstime > 1000) {
    const travauxPct = input.travauxEstime / input.acquisitionPrice;
    const fmtTravaux = input.travauxEstime.toLocaleString("fr-FR") + " €";
    drivers.push({
      key: "travaux",
      label: "Travaux de valorisation",
      direction: "positive",
      impact: clamp(Math.round(travauxPct * 180), 20, 75),
      description: `Budget travaux : ${fmtTravaux} (${Math.round(travauxPct * 100)}% du prix d'achat) — source : Exécution › Simulation.`,
    });
  }

  // Taux BCE — analyse pression crédit
  const ecb = input.ecbAnalysis;
  if (ecb) {
    const trendLabel = ecb.trend === "hausse" ? "en hausse" : ecb.trend === "baisse" ? "en baisse" : "stables";
    drivers.push({
      key: "pression_credit_bce",
      label: `Pression crédit BCE — ${ecb.pressureLabel}`,
      direction: ecb.pressureScore >= 60 ? "positive" : ecb.pressureScore >= 40 ? "neutral" : "negative",
      impact: Math.round(100 - ecb.pressureScore * 0.6),
      description: ecb.interpretation,
    });
  } else if (input.tauxBcePct != null) {
    const taux = input.tauxBcePct;
    const isHigh = taux >= 3;
    const isMedium = taux >= 2;
    drivers.push({
      key: "pression_credit_bce",
      label: `Pression crédit BCE — refi ${taux.toFixed(1)}%`,
      direction: isHigh ? "negative" : isMedium ? "neutral" : "positive",
      impact: isHigh ? 65 : isMedium ? 45 : 30,
      description: isHigh
        ? `Taux de refinancement à ${taux.toFixed(1)}% — freine la capacité d'emprunt et pèse sur la demande.`
        : isMedium
        ? `Taux de refinancement à ${taux.toFixed(1)}% — impact modéré sur la solvabilité.`
        : `Taux de refinancement à ${taux.toFixed(1)}% — conditions favorables, soutien à la demande.`,
    });
  }

  // Emploi local (heuristique si pas de score)
  if (!ms?.demande) {
    const dynamique = [75, 92, 69, 31, 44, 67, 59, 13].includes(dept);
    drivers.push({
      key: "emploi_local",
      label: "Bassin d'emploi",
      direction: dynamique ? "positive" : "neutral",
      impact: dynamique ? 50 : 30,
      description: dynamique
        ? "Bassin d'emploi dynamique — attractivité forte."
        : "Bassin d'emploi standard.",
    });
  }

  return drivers.sort((a, b) => b.impact - a.impact);
}

// ── Data sources tracking ────────────────────────────────────────────

function trackSources(input: PredictiveEngineInput, rateSource: string): PredictiveDataSource[] {
  return [
    {
      key: "dvf_median",
      label: "DVF — prix médian /m²",
      available: input.dvf?.prixM2Median != null,
      detail: input.dvf?.prixM2Median
        ? `${input.dvf.prixM2Median.toLocaleString("fr-FR")} €/m²`
        : undefined,
    },
    {
      key: "dvf_transactions",
      label: "DVF — volume transactions",
      available: input.dvf?.nbTransactions != null,
      detail: input.dvf?.nbTransactions
        ? `${input.dvf.nbTransactions} transactions`
        : undefined,
    },
    {
      key: "dvf_evolution",
      label: "DVF — évolution annuelle",
      available: input.dvf?.evolutionPctAnnuelle != null,
      detail: input.dvf?.evolutionPctAnnuelle != null
        ? `${input.dvf.evolutionPctAnnuelle >= 0 ? "+" : ""}${input.dvf.evolutionPctAnnuelle.toFixed(1)}%`
        : undefined,
    },
    {
      key: "market_scores",
      label: "Scores marché (étude)",
      available: input.marketScores?.global != null,
      detail: input.marketScores?.global != null
        ? `Score global ${norm100(input.marketScores.global)}/100`
        : undefined,
    },
    {
      key: "bpe",
      label: "BPE — équipements locaux",
      available: input.bpe?.score != null,
    },
    {
      key: "rentabilite",
      label: "Rentabilité calculée",
      available: input.rentabilite?.rendementBrut != null
        || input.rentabilite?.margeBrute != null
        || input.rentabilite?.margeBrutePct != null,
      detail: input.rentabilite?.rendementBrut != null
        ? `Rdt brut ${input.rentabilite.rendementBrut.toFixed(1)}%`
        : input.rentabilite?.margeBrutePct != null
        ? `Marge brute ${input.rentabilite.margeBrutePct.toFixed(1)}%`
        : input.rentabilite?.margeBrute != null
        ? `Marge ${input.rentabilite.margeBrute.toLocaleString("fr-FR")} €`
        : undefined,
    },
    {
      key: "forecast_source",
      label: "Source projection",
      available: true,
      detail: rateSource === "dvf_evolution"
        ? "Tendance DVF réelle"
        : rateSource === "market_scores"
        ? "Scores marché"
        : "Heuristique locale",
    },
    {
      key: "taux_bce",
      label: "Pression crédit BCE",
      available: input.ecbAnalysis != null || input.tauxBcePct != null,
      detail: input.ecbAnalysis
        ? `${input.ecbAnalysis.pressureLabel} (${input.ecbAnalysis.refinancingRate.toFixed(2)}%, ${input.ecbAnalysis.source === "ecb" ? "API ECB" : "fallback"})`
        : input.tauxBcePct != null
        ? `${input.tauxBcePct.toFixed(1)} %`
        : undefined,
    },
    {
      key: "travaux",
      label: "Budget travaux (Simulation)",
      available: input.travauxEstime != null && input.travauxEstime > 1000,
      detail: input.travauxEstime != null && input.travauxEstime > 1000
        ? `${input.travauxEstime.toLocaleString("fr-FR")} €`
        : undefined,
    },
  ];
}

// ── Engine principal ─────────────────────────────────────────────────

export function computePredictiveSnapshot(
  input: PredictiveEngineInput
): PredictiveAnalysisSnapshot {
  const { surfaceM2, acquisitionPrice, travauxEstime = 0, fraisAnnexes = 0 } = input;
  const totalCost = acquisitionPrice + travauxEstime + fraisAnnexes;

  // ── Spot ────────────────────────────────────────────────────────
  const { spotPsm, source: spotSource, confidence: spotBaseConf } = resolveSpotPsm(input);
  const marketValue = Math.round(spotPsm * surfaceM2);

  // Fourchette : DVF = ±5%, acquisition = ±8% (moins fiable)
  const rangePct = spotSource === "dvf" ? 0.05 : 0.08;
  const rangeLow = Math.round(marketValue * (1 - rangePct));
  const rangeHigh = Math.round(marketValue * (1 + rangePct));

  // Confidence enrichie par nombre de sources disponibles
  let confidenceBonus = 0;
  if (input.dvf?.prixM2Median) confidenceBonus += 8;
  if (input.dvf?.nbTransactions && input.dvf.nbTransactions >= 30) confidenceBonus += 5;
  if (input.marketScores?.global) confidenceBonus += 5;
  if (input.bpe?.score) confidenceBonus += 2;
  const spotConfidence = clamp(spotBaseConf + confidenceBonus, 30, 98);

  // ── Market ─────────────────────────────────────────────────────
  const regime = resolveRegime(input);
  const { pressureScore, liquidityScore, riskScore } = resolveMarketScores(input);

  // ── Forecast ───────────────────────────────────────────────────
  const { rate6, rate12, rate18, rate24, rateSource } = resolveForecastRates(input);
  const forecastConf = rateSource === "dvf_evolution" ? 82
    : rateSource === "market_scores" ? 72
    : 58;

  const forecast = {
    horizon6m: buildPoint(spotPsm, surfaceM2, rate6, 6, forecastConf),
    horizon12m: buildPoint(spotPsm, surfaceM2, rate12, 12, forecastConf),
    horizon18m: buildPoint(spotPsm, surfaceM2, rate18, 18, forecastConf),
    horizon24m: buildPoint(spotPsm, surfaceM2, rate24, 24, forecastConf),
  };

  // ── Scénarios ──────────────────────────────────────────────────
  // Prudent : applique un stress négatif sur le central
  // Optimiste : amplifie le central
  const stressFactor = rateSource === "dvf_evolution" ? 0.6 : 0.8; // DVF = moins de variance
  const optimFactor = rateSource === "dvf_evolution" ? 1.4 : 1.6;

  const scenarioVal = (rate: number, factor: number) =>
    Math.round(spotPsm * (1 + rate * factor) * surfaceM2);

  const scenarios = {
    prudent: {
      horizon6m: scenarioVal(rate6, -stressFactor),
      horizon12m: scenarioVal(rate12, -stressFactor),
      horizon18m: scenarioVal(rate18, -stressFactor),
      horizon24m: scenarioVal(rate24, -stressFactor),
    },
    central: {
      horizon6m: forecast.horizon6m.marketValue,
      horizon12m: forecast.horizon12m.marketValue,
      horizon18m: forecast.horizon18m.marketValue,
      horizon24m: forecast.horizon24m.marketValue,
    },
    optimistic: {
      horizon6m: scenarioVal(rate6, optimFactor),
      horizon12m: scenarioVal(rate12, optimFactor),
      horizon18m: scenarioVal(rate18, optimFactor),
      horizon24m: scenarioVal(rate24, optimFactor),
    },
  };

  // ── Operation impact ───────────────────────────────────────────
  // Si prix revente cible renseigné, l'utiliser comme référence
  const resaleCible = input.rentabilite?.prixReventeCible;
  const target6 = resaleCible && resaleCible > 0
    ? Math.round(resaleCible * (1 + rate6 * 0.3))
    : scenarios.central.horizon6m;
  const target12 = resaleCible && resaleCible > 0
    ? resaleCible
    : scenarios.central.horizon12m;
  const target18 = resaleCible && resaleCible > 0
    ? Math.round(resaleCible * (1 + rate18 * 0.2))
    : scenarios.central.horizon18m;
  const target24 = resaleCible && resaleCible > 0
    ? Math.round(resaleCible * (1 + rate24 * 0.3))
    : scenarios.central.horizon24m;

  const margin = (resale: number) => resale - totalCost;
  const marginPct = (resale: number) => totalCost > 0 ? ((resale - totalCost) / totalCost) * 100 : 0;
  const projectedMargin = parseFloat(marginPct(target12).toFixed(1));
  const projectedNetProfit = margin(target12);
  const stressDownside = parseFloat(
    (((scenarios.prudent.horizon12m - totalCost) / totalCost) * 100).toFixed(1)
  );

  const operationImpact = {
    targetResale6m: target6,
    targetResale12m: target12,
    targetResale18m: target18,
    targetResale24m: target24,
    projectedMargin,
    projectedNetProfit,
    breakEvenPrice: totalCost,
    stressDownsidePercent: stressDownside,
  };

  // ── Drivers ────────────────────────────────────────────────────
  const drivers = buildDrivers(input);

  // ── Data sources ───────────────────────────────────────────────
  const dataSources = trackSources(input, rateSource);

  // ── Summary ────────────────────────────────────────────────────
  const nbRealSources = dataSources.filter((s) => s.available).length;
  const dataQualityNote = nbRealSources >= 5
    ? "Analyse basée sur des données réelles (DVF, scores marché, BPE)."
    : nbRealSources >= 3
    ? "Analyse partiellement alimentée par des données réelles."
    : "Analyse basée principalement sur des heuristiques — lancer l'étude Marché/Risques pour enrichir.";

  let verdict: string;
  let explanation: string;

  if (projectedMargin >= 12) {
    verdict = "Opportunité favorable — marge projetée confortable.";
    explanation = `La projection centrale à 12 mois affiche une marge de ${projectedMargin}% sur le coût total (${totalCost.toLocaleString("fr-FR")} €). Marché en régime « ${regime} ». ${dataQualityNote}`;
  } else if (projectedMargin >= 5) {
    verdict = "Opération viable — marge serrée, vigilance requise.";
    explanation = `Marge projetée à 12 mois : ${projectedMargin}%. Stress downside : ${stressDownside}%. ${dataQualityNote}`;
  } else if (projectedMargin >= 0) {
    verdict = "Opération tendue — marge faible, négociation recommandée.";
    explanation = `Marge projetée à 12 mois : ${projectedMargin}%. En scénario prudent, stress de ${stressDownside}%. Envisager une renégociation du prix ou une optimisation des travaux. ${dataQualityNote}`;
  } else {
    verdict = "Opération défavorable — risque de perte.";
    explanation = `Marge projetée négative (${projectedMargin}%). Le prix d'achat est supérieur aux projections de marché. ${dataQualityNote}`;
  }

  return {
    assetId: undefined,
    generatedAt: new Date().toISOString(),
    spot: { pricePerSqm: spotPsm, marketValue, rangeLow, rangeHigh, confidenceScore: spotConfidence },
    market: { regime, pressureScore, liquidityScore, riskScore },
    forecast,
    scenarios,
    drivers,
    operationImpact,
    summary: { verdict, explanation },
    dataSources,
  };
}