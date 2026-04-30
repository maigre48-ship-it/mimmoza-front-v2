import type { PredictiveAnalysisSnapshot } from "./predictive.types";

/**
 * Generates a markdown summary of the predictive analysis for integration
 * into the Synthèse IA narrative or PDF export.
 */
export function buildPredictiveSummaryMarkdown(
  snap: PredictiveAnalysisSnapshot
): string {
  const fmtEur = (v: number) =>
    v.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " €";
  const fmtPct = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(1) + " %";

  const lines: string[] = [
    "### Analyse prédictive — Synthèse",
    "",
    `**Verdict : ${snap.summary.verdict}**`,
    "",
    snap.summary.explanation,
    "",
    "#### Spot marché",
    "",
    `- Prix spot estimé : **${fmtEur(snap.spot.marketValue)}** (${snap.spot.pricePerSqm} €/m²)`,
    `- Fourchette : ${fmtEur(snap.spot.rangeLow)} — ${fmtEur(snap.spot.rangeHigh)}`,
    `- Confiance : ${snap.spot.confidenceScore}/100`,
    `- Régime marché : **${snap.market.regime}**`,
    "",
    "#### Projection centrale",
    "",
    `| Horizon | Prix/m² | Valeur | Delta |`,
    `|---------|---------|--------|-------|`,
    `| 6 mois  | ${snap.forecast.horizon6m.pricePerSqm} €/m² | ${fmtEur(snap.forecast.horizon6m.marketValue)} | ${fmtPct(snap.forecast.horizon6m.deltaPercent)} |`,
    `| 12 mois | ${snap.forecast.horizon12m.pricePerSqm} €/m² | ${fmtEur(snap.forecast.horizon12m.marketValue)} | ${fmtPct(snap.forecast.horizon12m.deltaPercent)} |`,
    `| 18 mois | ${snap.forecast.horizon18m.pricePerSqm} €/m² | ${fmtEur(snap.forecast.horizon18m.marketValue)} | ${fmtPct(snap.forecast.horizon18m.deltaPercent)} |`,
    `| 24 mois | ${snap.forecast.horizon24m.pricePerSqm} €/m² | ${fmtEur(snap.forecast.horizon24m.marketValue)} | ${fmtPct(snap.forecast.horizon24m.deltaPercent)} |`,
    "",
    "#### Impact opérationnel",
    "",
    `- Marge projetée (12m) : **${snap.operationImpact.projectedMargin.toFixed(1)} %**`,
    `- Profit net projeté : **${fmtEur(snap.operationImpact.projectedNetProfit)}**`,
    `- Break-even : ${fmtEur(snap.operationImpact.breakEvenPrice)}`,
    `- Stress downside : ${snap.operationImpact.stressDownsidePercent.toFixed(1)} %`,
    "",
  ];

  return lines.join("\n");
}