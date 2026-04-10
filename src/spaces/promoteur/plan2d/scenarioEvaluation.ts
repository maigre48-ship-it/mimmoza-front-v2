// src/spaces/promoteur/plan2d/scenarioEvaluation.ts
// Moteur d'évaluation : calcule métriques, conformité, scores et textes métier
// pour un ensemble buildings + parkings + parcelle.
//
// Source de vérité géométrique :
//   Emprise bâtiment  = somme des volumes non-connecteurs du RDC (floorPlans[0])
//                       → cohérent avec le tooltip SURFACES — RDC du canvas
//   Places parking    = p.slotCount si > 0
//                       sinon computeParkingSlots() (fallback legacy)
//
// Aucune dépendance au store React — fonctions pures uniquement.

import type { Building2D, Parking2D }         from './editor2d.types';
import type { BuildingVolume2D }               from './buildingProgram.types';
import type {
  ImplantationScenarioFull,
  ScenarioKey,
  ScenarioFinancialAssumptions,
  ScenarioFinancialResult,
}                                              from './scenarioGenerator.types';
import { DEFAULT_FINANCIAL_ASSUMPTIONS as DEF_ASSUM } from './scenarioGenerator.types';
import { computeParkingSlots, genId }          from './editor2d.geometry';

// ─── CONSTANTES PLU SIMPLIFIÉES ───────────────────────────────────────

const CES_MAX      = 0.50;
const HEIGHT_MAX_M = 15.0;

// ─── VOLUMES RDC ─────────────────────────────────────────────────────
//
// Réplique la logique de getFloorVolumes(b, 0) sans importer le store.
// Source de vérité : floorPlans[levelIndex=0].volumes
// Fallback 1     : b.volumes (legacy pre-V4)
// Fallback 2     : volume synthétique centré sur b.rect

function getBuildingRdcVolumes(b: Building2D): BuildingVolume2D[] {
  if (b.floorPlans && b.floorPlans.length > 0) {
    const fp = b.floorPlans.find(p => p.levelIndex === 0);
    if (fp && fp.volumes.length > 0) return fp.volumes;
  }
  if (b.volumes && b.volumes.length > 0) return b.volumes;
  // Fallback : bâtiment sans volumes ni floorPlans
  return [{ id: `${b.id}-main`, rect: b.rect, role: 'main' as const }];
}

// ─── CALCUL SURFACES ──────────────────────────────────────────────────
//
// L'emprise est la somme des volumes non-connecteurs du RDC.
// Cohérent avec le tooltip "SURFACES — RDC" affiché dans le canvas,
// qui utilise la même logique de getFloorVolumes.
// Les connecteurs sont exclus : ils ne représentent pas de surface habitable.

function buildingEmpriseM2(b: Building2D): number {
  const vols = getBuildingRdcVolumes(b).filter(v => v.role !== 'connector');
  if (vols.length > 0) {
    return vols.reduce((s, v) => s + v.rect.width * v.rect.depth, 0);
  }
  // Fallback ultime : bounding box (ne devrait jamais être atteint
  // avec des bâtiments correctement migrés)
  return b.rect.width * b.rect.depth;
}

function buildingTotalFloorsM2(b: Building2D): number {
  // floorsAboveGround est le champ canonique V4 ; levels est déprécié.
  return buildingEmpriseM2(b) * (1 + (b.floorsAboveGround ?? b.levels ?? 0));
}

function buildingMaxHeightM(b: Building2D): number {
  return (b.groundFloorHeightM ?? 3.0) +
         (b.floorsAboveGround ?? b.levels ?? 0) * (b.typicalFloorHeightM ?? 2.8);
}

// ─── CALCUL PLACES PARKING ────────────────────────────────────────────
//
// Source de vérité : p.slotCount (calculé et maintenu par l'éditeur).
// Fallback géométrique pour les parkings migrés sans slotCount.

function parkingSlots(p: Parking2D): number {
  if (p.slotCount > 0) return p.slotCount;
  return computeParkingSlots(
    p.rect.width,
    p.rect.depth,
    p.slotWidth       ?? 2.5,
    p.slotDepth       ?? 5.0,
    p.driveAisleWidth ?? 6.0,
  );
}

// ─── SCORES ───────────────────────────────────────────────────────────

function scoreReglementaire(cesPct: number, maxH: number, isConforme: boolean): number {
  if (!isConforme) return 25;
  let s = 100;
  if (cesPct > CES_MAX * 0.95) s -= 10;
  if (cesPct > CES_MAX)        s -= 20;
  if (maxH > HEIGHT_MAX_M)     s -= 15;
  return Math.max(0, s);
}

function scoreFoncier(cesPct: number, cesPctMax = CES_MAX): number {
  const utilisation = Math.min(cesPct / cesPctMax, 1.2);
  if (utilisation > 1.0) return Math.max(30, 100 - (utilisation - 1) * 200);
  return Math.round(60 + utilisation * 40);
}

// Basé uniquement sur le nombre de bâtiments — sans dépendance au store.
function scoreSimplicite(buildingCount: number): number {
  let s = 100;
  if (buildingCount > 2) s -= (buildingCount - 2) * 12;
  return Math.max(20, s);
}

// ─── TEXTES MÉTIER DYNAMIQUES ─────────────────────────────────────────

const SCENARIO_STATIC: Record<ScenarioKey, { title: string; subtitle: string }> = {
  balanced:      { title: 'Version équilibrée',  subtitle: 'Bon compromis faisabilité / densité' },
  max_potential: { title: 'Max potentiel',        subtitle: 'Version la plus ambitieuse du programme' },
  secured:       { title: 'Version sécurisée',   subtitle: 'Priorité simplicité et robustesse' },
};

function buildTexts(
  key:             ScenarioKey,
  isConforme:      boolean,
  parkingRequired: number,
  parkingProvided: number,
  buildingCount:   number,
  nbLogements:     number | undefined,
): { description: string; strengths: string[]; vigilance: string[]; notes: string[] } {

  const parkingGap  = parkingProvided - parkingRequired;
  const isParkingOk = parkingGap >= 0;

  const parkingLabel = nbLogements === undefined
    ? 'Stationnement : nombre de logements non défini — vérification impossible'
    : isParkingOk
      ? `Stationnement conforme (${parkingProvided}/${parkingRequired} places)`
      : `Stationnement insuffisant : ${Math.abs(parkingGap)} place(s) manquante(s) (${parkingProvided}/${parkingRequired})`;

  const descriptions: Record<ScenarioKey, { ok: string; nok: string; unknown: string }> = {
    balanced: {
      ok:      'Implantation de référence, lisible et bien répartie. Exploite correctement le terrain sans excès. Bon point de départ pour une validation de faisabilité.',
      nok:     `Implantation de référence à ce stade. Non conforme PLU — ${parkingLabel}. À ajuster avant présentation.`,
      unknown: 'Implantation de référence. Conformité stationnement non vérifiable : préciser le nombre de logements pour activer ce contrôle.',
    },
    max_potential: {
      ok:      'Valorisation maximale du terrain tout en restant conforme. Plus de programme, plus de valeur, mais plus complexe à instruire.',
      nok:     `Scénario le plus ambitieux, actuellement non conforme. ${parkingLabel}. Le programme doit être calibré pour atteindre la conformité.`,
      unknown: 'Scénario le plus ambitieux. Conformité stationnement non vérifiable : préciser le nombre de logements.',
    },
    secured: {
      ok:      'Scénario simplifié et conforme, conçu pour une défense solide en comité, en banque ou en pré-instruction.',
      nok:     `Scénario simplifié, non encore conforme à ce stade. ${parkingLabel}. Réduire le programme ou augmenter le stationnement.`,
      unknown: 'Scénario simplifié. Conformité stationnement non vérifiable : préciser le nombre de logements.',
    },
  };

  const descKey = nbLogements === undefined ? 'unknown' : isConforme ? 'ok' : 'nok';

  const baseStrengths: Record<ScenarioKey, string[]> = {
    balanced:      ['Lecture du plan masse claire', 'Rapport densité/complexité maîtrisé', 'Base de référence stable'],
    max_potential: ['Surface de plancher maximisée', 'Potentiel commercial élevé', 'Retour sur investissement potentiellement élevé'],
    secured:       ['Exécution simplifiée', 'Meilleure lisibilité pour partenaires', 'Risques opérationnels réduits'],
  };

  const strengths = isConforme && nbLogements !== undefined
    ? ['Conformité PLU vérifiée', ...baseStrengths[key]]
    : baseStrengths[key];

  const vigilance: string[] = [];
  if (nbLogements === undefined) {
    vigilance.push('Nombre de logements non défini — stationnement non évalué');
  } else {
    if (!isParkingOk) vigilance.push(parkingLabel);
    if (!isConforme && isParkingOk) vigilance.push('Vérifier les autres règles PLU (CES, hauteur, reculs)');
  }
  if (key === 'max_potential') {
    vigilance.push('Complexité de conception plus élevée', "Risque d'instruction plus long");
  }
  if (key === 'secured' && !isConforme && nbLogements !== undefined) {
    vigilance.push('Réduire le programme ou augmenter le parking');
  }
  if (key === 'balanced' && buildingCount > 3) {
    vigilance.push('Fragmentation élevée : consolider si possible');
  }

  const conformityLabel =
    isConforme && nbLogements !== undefined ? ' : conforme' :
    nbLogements === undefined               ? ' : programme non défini' :
                                              ' : non conforme';

  return {
    description: descriptions[key][descKey],
    strengths,
    vigilance,
    notes: [`Scénario ${SCENARIO_STATIC[key].title}${conformityLabel}.`],
  };
}

// ─── CALCUL FINANCIER ─────────────────────────────────────────────────

function computeFinancial(
  empriseM2:   number,
  assumptions: ScenarioFinancialAssumptions,
): ScenarioFinancialResult {
  const sdpEstimatedM2      = empriseM2 * assumptions.estimatedLevels;
  const saleableAreaM2      = sdpEstimatedM2 * (assumptions.floorEfficiencyPct / 100);
  const estimatedLots       = Math.floor(saleableAreaM2 / Math.max(1, assumptions.averageLotSizeM2));
  const revenueEur          = saleableAreaM2 * assumptions.salePricePerM2;
  const constructionCostEur = sdpEstimatedM2 * assumptions.constructionCostPerM2;
  const landCost            = assumptions.landCostTotal ?? 0;
  const grossMarginEur      = revenueEur - constructionCostEur - landCost;
  const grossMarginPct      = revenueEur > 0 ? grossMarginEur / revenueEur : 0;
  return {
    sdpEstimatedM2, saleableAreaM2, estimatedLots,
    revenueEur, constructionCostEur, grossMarginEur, grossMarginPct,
  };
}

// ─── API PRINCIPALE ───────────────────────────────────────────────────

export interface EvaluateScenarioParams {
  key:          ScenarioKey;
  buildings:    Building2D[];
  parkings:     Parking2D[];
  parcelAreaM2: number;
  assumptions?: ScenarioFinancialAssumptions;
  refEmprise?:         number;
  refParkingProvided?: number;
  nbLogements?:        number;
  surfaceMoyLogementM2?: number;
}

export function evaluateScenario({
  key, buildings, parkings, parcelAreaM2,
  assumptions = DEF_ASSUM,
  refEmprise, refParkingProvided,
  nbLogements,
  surfaceMoyLogementM2,
}: EvaluateScenarioParams): ImplantationScenarioFull {

  // ── Géométrie ─────────────────────────────────────────────────────
  const empriseM2         = buildings.reduce((s, b) => s + buildingEmpriseM2(b), 0);
  const cesPct            = parcelAreaM2 > 0 ? empriseM2 / parcelAreaM2 : 0;
  const totalFloorsAreaM2 = buildings.reduce((s, b) => s + buildingTotalFloorsM2(b), 0);
  const buildingCount     = buildings.length;
  const maxH              = buildings.reduce((m, b) => Math.max(m, buildingMaxHeightM(b)), 0);

  // ── Parking ───────────────────────────────────────────────────────
  const parkingProvided = parkings.reduce((s, p) => s + parkingSlots(p), 0);
  const PARKING_RATIO   = 1.0;
  const parkingRequired = nbLogements !== undefined
    ? Math.ceil(nbLogements * PARKING_RATIO)
    : 0;

  // ── Conformité ────────────────────────────────────────────────────
  const parkingConforme = nbLogements === undefined
    ? true
    : parkingProvided >= parkingRequired;
  const isConforme = cesPct <= CES_MAX && maxH <= HEIGHT_MAX_M && parkingConforme;

  // ── Scores ────────────────────────────────────────────────────────
  const sReg  = scoreReglementaire(cesPct, maxH, isConforme);
  const sFonc = scoreFoncier(cesPct);
  const sSimp = scoreSimplicite(buildingCount);
  const sGlob = Math.round(sReg * 0.40 + sFonc * 0.35 + sSimp * 0.25);

  // ── Deltas ────────────────────────────────────────────────────────
  const deltaEmprisePct   = refEmprise && refEmprise > 0
    ? (empriseM2 - refEmprise) / refEmprise
    : undefined;
  const deltaParkingCount = refParkingProvided != null
    ? parkingProvided - refParkingProvided
    : undefined;

  const financial = computeFinancial(empriseM2, assumptions);

  const { title, subtitle } = SCENARIO_STATIC[key];
  const texts = buildTexts(
    key, isConforme, parkingRequired, parkingProvided, buildingCount, nbLogements,
  );

  return {
    id: genId(), key, title, subtitle, ...texts,
    buildings, parkings,
    empriseM2, cesPct, totalFloorsAreaM2, buildingCount,
    parkingRequired, parkingProvided, isConforme,
    scoreGlobal: sGlob, scoreReglementaire: sReg, scoreFoncier: sFonc, scoreSimplicite: sSimp,
    deltaEmprisePct, deltaBuildingCount: undefined, deltaParkingCount, deltaFloorAreaPct: undefined,
    financial,
    nbLogements,
    surfaceMoyLogementM2,
  };
}