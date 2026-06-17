// src/services/massing/massingReport.ts
// ─────────────────────────────────────────────────────────────────────────────
// MASSING REPORT
// Construit un objet MassingReport sérialisable, prêt à être branché plus tard
// sur le pipeline jsPDF existant (synthèses Promoteur).
//
// Aucune dépendance jsPDF ici : on ne fait que MODELISER le rapport.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  MassingReport,
  MassingResult,
  ScenarioEconomics,
  ScenarioName,
} from "./massing.types";
import { pickBestForLandValue } from "./massingEconomics.service";

const SCENARIO_LABELS: Record<ScenarioName, string> = {
  prudent: "Prudent",
  central: "Central",
  optimise: "Optimisé",
};

function eur(n: number | null): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
}

function m2(n: number): string {
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n)} m²`;
}

function pct(n: number | null): string {
  if (n == null) return "—";
  return `${(n * 100).toFixed(1)} %`;
}

export function buildMassingReport(
  result: MassingResult,
  economics: ScenarioEconomics[],
  parcelTitle = "Parcelle",
): MassingReport {
  const c = result.constraints;

  const parcelSection = {
    title: "Parcelle & contraintes PLU",
    rows: [
      { label: "Surface foncière", value: m2(result.parcel.surfaceM2) },
      { label: "Zone PLU", value: result.parcel.zoneCode ?? "—" },
      { label: "Libellé zone", value: result.parcel.zoneLibelle ?? "—" },
      { label: "CES max", value: c.cesMax != null ? pct(c.cesMax) : "—" },
      { label: "Hauteur max", value: c.hauteurMaxM != null ? `${c.hauteurMaxM} m` : "—" },
      { label: "Emprise max", value: c.footprintMaxM2 != null ? m2(c.footprintMaxM2) : "—" },
      { label: "Niveaux max", value: c.niveauxMax != null ? `R+${Math.max(0, c.niveauxMax - 1)}` : "—" },
      {
        label: "Stationnement",
        value:
          c.stationnementParLogement != null
            ? `${c.stationnementParLogement} / logement`
            : c.stationnementPar100m2 != null
              ? `${c.stationnementPar100m2} / 100 m² SDP`
              : "—",
      },
    ],
  };

  const econByScenario = new Map<ScenarioName, ScenarioEconomics>();
  economics.forEach((e) => econByScenario.set(e.scenario, e));

  const scenarioTable = {
    headers: [
      "Scénario",
      "Emprise",
      "Niveaux",
      "SDP",
      "Vendable",
      "Logements",
      "CA",
      "Marge",
      "Charge foncière max",
    ],
    rows: result.scenarios.map((s) => {
      const e = econByScenario.get(s.name);
      return [
        SCENARIO_LABELS[s.name],
        m2(s.footprintM2),
        s.levels > 0 ? `R+${s.levels - 1}` : "—",
        m2(s.sdpM2),
        m2(s.saleableAreaM2),
        String(s.estimatedUnits),
        e ? eur(e.revenue) : "—",
        e ? (e.margin != null ? `${eur(e.margin)} (${pct(e.marginPct)})` : "—") : "—",
        e ? eur(e.landValueMax) : "—",
      ];
    }),
  };

  const best = pickBestForLandValue(economics);
  const bestEcon = best ? econByScenario.get(best) : undefined;

  const recommendation = {
    bestScenario: best ?? "central",
    reason: best
      ? `Le scénario ${SCENARIO_LABELS[best]} maximise la charge foncière admissible` +
        (bestEcon ? ` (${eur(bestEcon.landValueMax)}).` : ".")
      : "Capacité non calculable — données PLU incomplètes.",
  };

  return {
    version: "massing_report_v1",
    generatedAt: new Date().toISOString(),
    parcelTitle,
    sections: [parcelSection],
    scenarioTable,
    recommendation,
  };
}