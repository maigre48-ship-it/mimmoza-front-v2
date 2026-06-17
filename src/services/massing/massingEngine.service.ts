// src/services/massing/massingEngine.service.ts
// ─────────────────────────────────────────────────────────────────────────────
// MASSING ENGINE
// Entrée  : ParcelContext (parcelle + sortie PLU Engine)
// Sortie  : MassingResult (contraintes + 3 scénarios prudent / central / optimisé)
//
// Le moteur est PUR (déterministe, sans effet de bord, sans IA).
// Tous les coefficients passent par MassingConfig (configurable).
// ─────────────────────────────────────────────────────────────────────────────

import type {
  MassingConfig,
  MassingConstraints,
  MassingResult,
  MassingScenario,
  ParcelContext,
  ScenarioName,
} from "./massing.types";
import { pluToMassingConstraints } from "./pluMassingAdapter";

// ── Configuration par défaut ──────────────────────────────────────────────────
// Valeurs d'usage promoteur collectif. À surcharger via configOverride.

export const DEFAULT_MASSING_CONFIG: MassingConfig = {
  groundFloorHeightM: 3.3,
  typicalFloorHeightM: 2.8,
  coefVendable: 0.82,
  avgUnitSizeM2: 62,
  scenarioFactors: {
    prudent: 0.7,
    central: 0.85,
    optimise: 1.0,
  },
};

const SCENARIO_LABELS: Record<ScenarioName, string> = {
  prudent: "Prudent",
  central: "Central",
  optimise: "Optimisé",
};

// Fiabilité relative par scénario : plus on pousse la capacité,
// plus le risque (permis, recours, faisabilité technique) augmente.
const SCENARIO_RELIABILITY: Record<ScenarioName, number> = {
  prudent: 1.0,
  central: 0.97,
  optimise: 0.9,
};

// ── Construction d'un scénario ────────────────────────────────────────────────

function computeParking(
  units: number,
  sdpM2: number,
  c: MassingConstraints,
): { parking: number; note: string | null } {
  if (c.stationnementParLogement != null) {
    return {
      parking: Math.ceil(units * c.stationnementParLogement),
      note: null,
    };
  }
  if (c.stationnementPar100m2 != null) {
    return {
      parking: Math.ceil((sdpM2 / 100) * c.stationnementPar100m2),
      note: null,
    };
  }
  return { parking: 0, note: "Stationnement non quantifié (règle PLU absente)." };
}

function computeConfidence(c: MassingConstraints, scenario: ScenarioName): number {
  // Base : confiance du PLU Engine si fournie, sinon 0.5.
  let conf = c.completeness.ok ? 0.8 : 0.5;

  // Pénalités sur données critiques manquantes.
  if (c.cesMax == null) conf *= 0.4;
  if (c.hauteurMaxM == null) conf *= 0.5;
  if (!c.completeness.ok) conf *= 0.9;

  // Agressivité du scénario.
  conf *= SCENARIO_RELIABILITY[scenario];

  return clamp01(round2(conf));
}

function buildScenario(
  name: ScenarioName,
  constraints: MassingConstraints,
  config: MassingConfig,
): MassingScenario {
  const factor = config.scenarioFactors[name];
  const notes: string[] = [];

  const footprintMax = constraints.footprintMaxM2 ?? 0;
  const levels = constraints.niveauxMax ?? 0;

  // Capacité : le facteur réduit l'emprise utilisée (jamais > CES).
  const footprintM2 = round2(footprintMax * factor);

  const heightM =
    levels > 0
      ? round2(
          config.groundFloorHeightM + (levels - 1) * config.typicalFloorHeightM,
        )
      : 0;

  const sdpM2 = round2(footprintM2 * levels);
  const saleableAreaM2 = round2(sdpM2 * config.coefVendable);
  const estimatedUnits =
    config.avgUnitSizeM2 > 0 ? Math.floor(saleableAreaM2 / config.avgUnitSizeM2) : 0;

  const { parking, note: parkingNote } = computeParking(
    estimatedUnits,
    sdpM2,
    constraints,
  );
  if (parkingNote) notes.push(parkingNote);

  if (footprintMax <= 0) notes.push("Emprise non calculable (CES manquant).");
  if (levels <= 0) notes.push("Niveaux non calculables (hauteur PLU manquante).");

  return {
    name,
    label: SCENARIO_LABELS[name],
    capacityFactor: factor,
    footprintM2,
    levels,
    heightM,
    sdpM2,
    saleableAreaM2,
    estimatedUnits,
    parkingRequired: parking,
    confidence: computeConfidence(constraints, name),
    notes,
  };
}

// ── Façades publiques par scénario (coefficients configurables) ───────────────

export function buildPrudentScenario(
  c: MassingConstraints,
  config: MassingConfig,
): MassingScenario {
  return buildScenario("prudent", c, config);
}

export function buildCentralScenario(
  c: MassingConstraints,
  config: MassingConfig,
): MassingScenario {
  return buildScenario("central", c, config);
}

export function buildOptimizedScenario(
  c: MassingConstraints,
  config: MassingConfig,
): MassingScenario {
  return buildScenario("optimise", c, config);
}

// ── Point d'entrée principal ──────────────────────────────────────────────────

export function runMassingEngine(
  ctx: ParcelContext,
  configOverride?: Partial<MassingConfig>,
): MassingResult {
  const config: MassingConfig = {
    ...DEFAULT_MASSING_CONFIG,
    ...configOverride,
    scenarioFactors: {
      ...DEFAULT_MASSING_CONFIG.scenarioFactors,
      ...(configOverride?.scenarioFactors ?? {}),
    },
  };

  const constraints = pluToMassingConstraints(ctx.plu, ctx.surfaceM2, config);

  const scenarios: MassingScenario[] = [
    buildPrudentScenario(constraints, config),
    buildCentralScenario(constraints, config),
    buildOptimizedScenario(constraints, config),
  ];

  const blocked =
    constraints.footprintMaxM2 == null || constraints.niveauxMax == null;

  return {
    parcel: {
      surfaceM2: ctx.surfaceM2,
      zoneCode: ctx.zoneCode ?? ctx.plu?.zone_code ?? null,
      zoneLibelle: ctx.zoneLibelle ?? ctx.plu?.zone_libelle ?? null,
    },
    constraints,
    scenarios,
    config,
    generatedAt: new Date().toISOString(),
    blocked,
  };
}

// ── Utils ─────────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}