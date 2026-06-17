// src/services/massing/massingEconomics.service.ts
// ─────────────────────────────────────────────────────────────────────────────
// MASSING ECONOMICS
// Bilan promoteur synthétique par scénario.
//
//   CA            = surface vendable × prix de sortie
//   Coût travaux  = SDP × coût construction
//   Coût VRD      = emprise × coût VRD
//   Honoraires    = CA × honoraires%
//   Taxes         = SDP × taxe/m²
//   Frais fin.    = travaux × frais financiers%
//   Marge         = CA − (foncier + travaux + VRD + honoraires + taxes + frais)
//   landValueMax  = CA × (1 − marge cible) − coûts hors foncier
//                   = charge foncière admissible (compte à rebours promoteur)
//
// Le scénario qui MAXIMISE landValueMax est celui qui valorise le plus le foncier.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  EconomicsHypotheses,
  MassingScenario,
  ScenarioEconomics,
  ScenarioName,
} from "./massing.types";

// Hypothèses par défaut — valeurs d'ordre de grandeur, TOUTES éditables côté UI.
// Elles ne constituent pas des données de marché : ce sont des paramètres promoteur.
export const DEFAULT_HYPOTHESES: EconomicsHypotheses = {
  prixSortieM2: 0, // à renseigner / injecter depuis le Valuation Engine
  coutConstructionM2: 2200,
  coutVrdM2: 90,
  honorairesPct: 0.06,
  taxesM2Sdp: 120,
  fraisFinanciersPct: 0.03,
  margeCiblePct: 0.15,
  foncierTotal: null,
};

export function computeScenarioEconomics(
  scenario: MassingScenario,
  hyp: EconomicsHypotheses,
): ScenarioEconomics {
  const revenue = round2(scenario.saleableAreaM2 * hyp.prixSortieM2);

  const coutTravaux = round2(scenario.sdpM2 * hyp.coutConstructionM2);
  const coutVrd = round2(scenario.footprintM2 * hyp.coutVrdM2);
  const honoraires = round2(revenue * hyp.honorairesPct);
  const taxes = round2(scenario.sdpM2 * hyp.taxesM2Sdp);
  const fraisFinanciers = round2(coutTravaux * hyp.fraisFinanciersPct);

  const coutsHorsFoncier = round2(
    coutTravaux + coutVrd + honoraires + taxes + fraisFinanciers,
  );

  const foncier = hyp.foncierTotal ?? null;
  const totalCost = round2(coutsHorsFoncier + (foncier ?? 0));

  const margin = foncier != null ? round2(revenue - totalCost) : null;
  const marginPct =
    margin != null && revenue > 0 ? round4(margin / revenue) : null;

  // Compte à rebours : prix foncier max compatible avec la marge cible.
  const landValueMax = round2(
    revenue * (1 - hyp.margeCiblePct) - coutsHorsFoncier,
  );

  return {
    scenario: scenario.name,
    revenue,
    coutTravaux,
    coutVrd,
    honoraires,
    taxes,
    fraisFinanciers,
    coutsHorsFoncier,
    foncier,
    totalCost,
    margin,
    marginPct,
    landValueMax,
    viable: landValueMax > 0,
  };
}

export function computeAllEconomics(
  scenarios: MassingScenario[],
  hyp: EconomicsHypotheses,
): ScenarioEconomics[] {
  return scenarios.map((s) => computeScenarioEconomics(s, hyp));
}

/**
 * Scénario maximisant la valeur du foncier (charge foncière admissible la plus haute).
 * Répond à : "Quel scénario maximise la valeur du foncier ?"
 */
export function pickBestForLandValue(
  econ: ScenarioEconomics[],
): ScenarioName | null {
  if (econ.length === 0) return null;
  let best = econ[0];
  for (const e of econ) {
    if (e.landValueMax > best.landValueMax) best = e;
  }
  return best.scenario;
}

// ── Utils ─────────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}