// src/spaces/promoteur/plan2d/masterScenario.service.ts
//
// Service de construction du MasterScenario.
//
// Source de vérité géométrique :
//
//   EMPRISE BÂTIMENT = b.rect.width × b.rect.depth
//     → le rectangle avec handles visible dans le canvas.
//     → cohérent avec computeTotalFootprintArea (plan.plu.metrics.ts)
//        qui calcule l'aire du polygone des 4 coins du même rect.
//     → cohérent avec le diagnostic parcellaire et le PLU.
//
//   PLACES PARKING = p.slotCount si > 0, sinon computeParkingSlots (legacy).
//
// Repère : parcelleLocal (Y-down, espace éditeur, mètres).
//   buildMasterScenario reçoit parcelPolygon et buildings.rect
//   dans le même repère — aucune transformation n'est nécessaire.
//
// Fonction pure — aucune dépendance au store React.

import type { Building2D, Parking2D } from './editor2d.types';
import type { Point2D }               from './editor2d.types';
import { computeParkingSlots, genId } from './editor2d.geometry';
import type {
  MasterScenario,
  MasterScenarioGeometry,
  MasterScenarioProgram,
  MasterScenarioMetrics,
  MasterScenarioConformity,
  MasterScenarioEconomics,
  MasterScenarioScores,
  MasterScenarioNarrative,
  MasterEconomicAssumptions,
  MasterConformityStatus,
} from './plan.master.types';
import { DEFAULT_MASTER_ECONOMIC_ASSUMPTIONS } from './plan.master.types';

// ─── SEUILS PLU ───────────────────────────────────────────────────────

const CES_MAX      = 0.50;
const CES_WARN     = 0.46;
const HEIGHT_MAX_M = 15.0;

// ─── EMPRISE BÂTIMENT ────────────────────────────────────────────────
//
// Source de vérité : b.rect.width × b.rect.depth.
//
// Justification :
//   • b.rect est le rectangle affiché avec handles dans le canvas.
//   • C'est exactement ce que l'utilisateur voit et manipule.
//   • C'est la même grandeur que plan.plu.metrics.ts utilise via
//     le polygone de 4 coins (computeTotalFootprintArea).
//   • Simple, stable, sans dépendance au store ou aux floorPlans.

function buildingFootprintM2(b: Building2D): number {
  return b.rect.width * b.rect.depth;
}

function buildingTotalFloorsM2(b: Building2D): number {
  return buildingFootprintM2(b) * (1 + (b.floorsAboveGround ?? b.levels ?? 0));
}

function buildingMaxHeightM(b: Building2D): number {
  return (b.groundFloorHeightM ?? 3.0) +
         (b.floorsAboveGround ?? b.levels ?? 0) * (b.typicalFloorHeightM ?? 2.8);
}

// ─── PARKING ──────────────────────────────────────────────────────────

function parkingSlotCount(p: Parking2D): number {
  if (p.slotCount > 0) return p.slotCount;
  // Fallback legacy : parking migré sans slotCount
  return computeParkingSlots(
    p.rect.width, p.rect.depth,
    p.slotWidth ?? 2.5, p.slotDepth ?? 5.0, p.driveAisleWidth ?? 6.0,
  );
}

// ─── AIRE POLYGONE (shoelace) ─────────────────────────────────────────
//
// Fonctionne dans n'importe quel repère (Y-up ou Y-down) — l'abs
// neutralise le signe du produit vectoriel.

function polygonAreaM2(pts: Point2D[]): number {
  if (pts.length < 3) return 0;
  let area = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    area += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
  }
  return Math.abs(area / 2);
}

// ─── MÉTRIQUES ────────────────────────────────────────────────────────

function computeMetrics(
  buildings:    Building2D[],
  parkings:     Parking2D[],
  parcelAreaM2: number,
  nbLogements:  number | undefined,
): MasterScenarioMetrics {
  const buildingsFootprintM2 = buildings.reduce((s, b) => s + buildingFootprintM2(b), 0);
  const parkingsFootprintM2  = parkings.reduce((s, p) => s + p.rect.width * p.rect.depth, 0);
  const totalFootprintM2     = buildingsFootprintM2 + parkingsFootprintM2;
  const coverageRatio        = parcelAreaM2 > 0 ? buildingsFootprintM2 / parcelAreaM2 : 0;
  const maxHeightM           = buildings.length > 0
    ? buildings.reduce((m, b) => Math.max(m, buildingMaxHeightM(b)), 0)
    : 0;
  const totalFloorsAreaM2    = buildings.reduce((s, b) => s + buildingTotalFloorsM2(b), 0);
  const parkingProvided      = parkings.reduce((s, p) => s + parkingSlotCount(p), 0);
  const parkingRequired      = nbLogements !== undefined ? Math.ceil(nbLogements) : 0;

  return {
    parcelAreaM2,
    buildingsFootprintM2,
    parkingsFootprintM2,
    totalFootprintM2,
    coverageRatio,
    buildingCount:  buildings.length,
    maxHeightM,
    totalFloorsAreaM2,
    parkingProvided,
    parkingRequired,
    parkingDelta:   parkingProvided - parkingRequired,
  };
}

// ─── CONFORMITÉ ───────────────────────────────────────────────────────

function computeConformity(
  metrics:     MasterScenarioMetrics,
  nbLogements: number | undefined,
): MasterScenarioConformity {
  const cesOk    = metrics.buildingCount === 0 || metrics.coverageRatio <= CES_MAX;
  const heightOk = metrics.buildingCount === 0 || metrics.maxHeightM <= HEIGHT_MAX_M;
  const parkingOk = nbLogements === undefined
    ? true
    : metrics.parkingProvided >= metrics.parkingRequired;

  const isConforme = cesOk && heightOk && parkingOk;

  const parkingBlocking = nbLogements !== undefined && !parkingOk;
  let status: MasterConformityStatus;
  if (!isConforme && (!cesOk || parkingBlocking)) {
    status = 'BLOQUANT';
  } else if (!isConforme || metrics.coverageRatio > CES_WARN) {
    status = 'LIMITE';
  } else {
    status = 'CONFORME';
  }

  const messages: string[] = [];

  if (isConforme && metrics.buildingCount > 0) {
    messages.push('Implantation conforme aux règles PLU paramétrées.');
  }
  if (!cesOk) {
    messages.push(
      `CES de ${(metrics.coverageRatio * 100).toFixed(1)} % dépasse le seuil PLU de ${(CES_MAX * 100).toFixed(0)} %.`,
    );
  } else if (metrics.coverageRatio > CES_WARN) {
    messages.push(
      `CES de ${(metrics.coverageRatio * 100).toFixed(1)} % proche du maximum (${(CES_MAX * 100).toFixed(0)} %) — marge limitée.`,
    );
  }
  if (!heightOk) {
    messages.push(
      `Hauteur maximale de ${metrics.maxHeightM.toFixed(1)} m dépasse le seuil de ${HEIGHT_MAX_M} m.`,
    );
  }
  if (nbLogements === undefined) {
    messages.push('Nombre de logements non défini — conformité stationnement non évaluée.');
  } else if (!parkingOk) {
    const delta = Math.abs(metrics.parkingDelta);
    messages.push(
      `Stationnement insuffisant : ${metrics.parkingProvided} place${metrics.parkingProvided > 1 ? 's' : ''} ` +
      `fournie${metrics.parkingProvided > 1 ? 's' : ''} pour ${metrics.parkingRequired} ` +
      `requise${metrics.parkingRequired > 1 ? 's' : ''} (−${delta}).`,
    );
  } else {
    messages.push(
      `Stationnement conforme : ${metrics.parkingProvided}/${metrics.parkingRequired} ` +
      `place${metrics.parkingRequired > 1 ? 's' : ''}.`,
    );
  }

  return { cesOk, heightOk, parkingOk, isConforme, status, messages };
}

// ─── ÉCONOMIE ─────────────────────────────────────────────────────────

function computeEconomics(
  metrics:     MasterScenarioMetrics,
  program:     MasterScenarioProgram,
  assumptions: MasterEconomicAssumptions,
): MasterScenarioEconomics {
  const levels         = Math.max(1, (program.floorsAboveGround ?? 0) + 1);
  const sdpEstimatedM2 = metrics.buildingsFootprintM2 * levels;
  const saleableAreaM2 = sdpEstimatedM2 * (assumptions.floorEfficiencyPct / 100);
  const estimatedLots  = program.nbLogements ??
    Math.max(1, Math.floor(saleableAreaM2 / Math.max(1, assumptions.averageLotSizeM2)));
  const revenueEur          = saleableAreaM2 * assumptions.salePricePerM2;
  const constructionCostEur = sdpEstimatedM2 * assumptions.constructionCostPerM2;
  const landCostEur         = assumptions.landCostTotal;
  const grossMarginEur      = revenueEur - constructionCostEur - landCostEur;
  const grossMarginPct      = revenueEur > 0 ? grossMarginEur / revenueEur : 0;

  return {
    sdpEstimatedM2, saleableAreaM2, estimatedLots,
    revenueEur, constructionCostEur, landCostEur,
    grossMarginEur, grossMarginPct,
  };
}

// ─── SCORES ───────────────────────────────────────────────────────────

function computeScores(
  metrics:    MasterScenarioMetrics,
  conformity: MasterScenarioConformity,
): MasterScenarioScores {
  let regulatory = conformity.isConforme ? 100 : 25;
  if (conformity.isConforme) {
    if (metrics.coverageRatio > CES_MAX * 0.95) regulatory -= 10;
    if (!conformity.heightOk)                   regulatory -= 15;
    regulatory = Math.max(0, regulatory);
  }

  const util = CES_MAX > 0 ? Math.min(metrics.coverageRatio / CES_MAX, 1.2) : 0;
  const landEfficiency = util > 1.0
    ? Math.max(30, 100 - (util - 1) * 200)
    : Math.round(60 + util * 40);

  let simplicity = 100;
  if (metrics.buildingCount > 2) simplicity -= (metrics.buildingCount - 2) * 12;
  simplicity = Math.max(20, simplicity);

  const overall = Math.round(regulatory * 0.40 + landEfficiency * 0.35 + simplicity * 0.25);

  return { regulatory, landEfficiency, simplicity, overall };
}

// ─── NARRATIF ─────────────────────────────────────────────────────────

function computeNarrative(
  metrics:    MasterScenarioMetrics,
  conformity: MasterScenarioConformity,
  program:    MasterScenarioProgram,
): MasterScenarioNarrative {
  const strengths: string[] = [];
  const vigilance: string[] = [];

  let summary: string;
  if (metrics.buildingCount === 0) {
    summary = 'Aucun bâtiment dessiné — dessinez au moins un bâtiment pour évaluer ce scénario.';
  } else if (conformity.isConforme) {
    summary =
      `Implantation conforme. ${metrics.buildingCount} bâtiment${metrics.buildingCount > 1 ? 's' : ''}, ` +
      `CES à ${(metrics.coverageRatio * 100).toFixed(1)} %, ` +
      `hauteur max ${metrics.maxHeightM.toFixed(1)} m.`;
  } else {
    const issues = conformity.messages.filter(m =>
      m.includes('dépasse') || m.includes('insuffisant'),
    );
    summary = issues.length > 0
      ? `Implantation à corriger : ${issues[0]}`
      : 'Implantation non conforme — voir points de vigilance.';
  }

  if (metrics.buildingCount > 0) {
    if (conformity.cesOk) {
      strengths.push(
        metrics.coverageRatio <= CES_WARN
          ? `CES à ${(metrics.coverageRatio * 100).toFixed(1)} % — marge de densification disponible.`
          : `CES à ${(metrics.coverageRatio * 100).toFixed(1)} % — conforme au PLU.`,
      );
    }
    if (conformity.parkingOk && program.nbLogements !== undefined) {
      strengths.push(
        `Stationnement conforme (${metrics.parkingProvided}/${metrics.parkingRequired} places).`,
      );
    }
    if (conformity.heightOk && metrics.maxHeightM > 0) {
      strengths.push(`Hauteur maximale de ${metrics.maxHeightM.toFixed(1)} m respectée.`);
    }
    if (metrics.buildingCount === 1) {
      strengths.push('Plan masse simple — lecture claire et défense facilitée.');
    }
    if (conformity.isConforme) {
      strengths.push('Implantation défendable en pré-instruction PLU.');
    }
  }

  if (!conformity.cesOk) {
    vigilance.push(
      `CES de ${(metrics.coverageRatio * 100).toFixed(1)} % à réduire sous ${(CES_MAX * 100).toFixed(0)} %.`,
    );
  } else if (metrics.coverageRatio > CES_WARN) {
    vigilance.push(
      `CES proche du maximum (${(metrics.coverageRatio * 100).toFixed(1)} %) — peu de marge.`,
    );
  }
  if (!conformity.heightOk) {
    vigilance.push(
      `Hauteur de ${metrics.maxHeightM.toFixed(1)} m à réduire sous ${HEIGHT_MAX_M} m.`,
    );
  }
  if (program.nbLogements === undefined) {
    vigilance.push('Définir le nombre de logements pour activer le contrôle stationnement.');
  } else if (!conformity.parkingOk) {
    const delta = Math.abs(metrics.parkingDelta);
    vigilance.push(
      `Ajouter ${delta} place${delta > 1 ? 's' : ''} de parking (déficit de ${delta}).`,
    );
  }
  if (metrics.buildingCount > 3) {
    vigilance.push('Fragmentation élevée — consolider si possible pour simplifier le dossier.');
  }

  const nextAction = !conformity.isConforme
    ? 'Corriger les points bloquants avant présentation en pré-instruction PLU.'
    : 'Préparer le dossier de faisabilité pour présentation en comité ou banque.';

  return { summary, strengths, vigilancePoints: vigilance, nextAction };
}

// ─── API PUBLIQUE ─────────────────────────────────────────────────────

export interface BuildMasterScenarioParams {
  buildings:                 Building2D[];
  parkings:                  Parking2D[];
  /** Polygone parcelle en repère éditeur (parcelleLocal, Y-down). */
  parcelPolygon:             Point2D[];
  /** Si absent, calculé depuis parcelPolygon (shoelace). */
  parcelAreaM2?:             number;
  buildingKind?:             'INDIVIDUEL' | 'COLLECTIF';
  nbLogements?:              number;
  surfaceMoyLogementM2?:     number;
  assumptions?:              MasterEconomicAssumptions;
  buildableEnvelopePolygon?: Point2D[];
}

/**
 * Construit le MasterScenario à partir du plan réellement dessiné.
 *
 * Repère unique : parcelleLocal (espace éditeur, Y-down, mètres).
 * buildings.rect.center et parcelPolygon sont dans ce même repère.
 *
 * Emprise = b.rect.width × b.rect.depth (rectangle visible dans le canvas).
 * Cohérent avec computeTotalFootprintArea (plan.plu.metrics.ts).
 *
 * Fonction pure — aucune dépendance au store React.
 */
export function buildMasterScenario(params: BuildMasterScenarioParams): MasterScenario {
  const {
    buildings,
    parkings,
    parcelPolygon,
    buildingKind               = 'COLLECTIF',
    nbLogements,
    surfaceMoyLogementM2,
    assumptions                = DEFAULT_MASTER_ECONOMIC_ASSUMPTIONS,
    buildableEnvelopePolygon,
  } = params;

  const parcelAreaM2 = params.parcelAreaM2 ?? polygonAreaM2(parcelPolygon);

  // Programme : moyennes parmi les bâtiments dessinés
  const n = buildings.length;
  const dominantFloors = n > 0
    ? Math.round(buildings.reduce((s, b) => s + (b.floorsAboveGround ?? b.levels ?? 0), 0) / n)
    : 0;
  const dominantGFH = n > 0
    ? buildings.reduce((s, b) => s + (b.groundFloorHeightM ?? 3.0), 0) / n
    : 3.0;
  const dominantTFH = n > 0
    ? buildings.reduce((s, b) => s + (b.typicalFloorHeightM ?? 2.8), 0) / n
    : 2.8;

  const program: MasterScenarioProgram = {
    buildingKind,
    nbLogements,
    surfaceMoyLogementM2,
    floorsAboveGround:   dominantFloors,
    groundFloorHeightM:  dominantGFH,
    typicalFloorHeightM: dominantTFH,
  };

  const geometry: MasterScenarioGeometry = {
    parcelPolygon,
    parcelAreaM2,
    buildableEnvelopePolygon,
    buildings,
    parkings,
  };

  const metrics    = computeMetrics(buildings, parkings, parcelAreaM2, nbLogements);
  const conformity = computeConformity(metrics, nbLogements);
  const economics  = computeEconomics(metrics, program, assumptions);
  const scores     = computeScores(metrics, conformity);
  const narrative  = computeNarrative(metrics, conformity, program);

  return {
    id:                  genId(),
    generatedAt:         new Date().toISOString(),
    geometry,
    program,
    metrics,
    conformity,
    economics,
    scores,
    narrative,
    economicAssumptions: assumptions,
  };
}