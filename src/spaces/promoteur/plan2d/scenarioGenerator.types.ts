// src/spaces/promoteur/plan2d/scenarioGenerator.types.ts

import type { Building2D, Parking2D } from './editor2d.types';

export type ScenarioKey = 'balanced' | 'max_potential' | 'secured';

// ─── HYPOTHÈSES FINANCIÈRES ───────────────────────────────────────────

export interface ScenarioFinancialAssumptions {
  salePricePerM2:        number;  // €/m² de surface vendable
  constructionCostPerM2: number;  // €/m² de SDP totale
  floorEfficiencyPct:    number;  // % de SDP effectivement vendable (typique : 80-88%)
  averageLotSizeM2:      number;  // surface moyenne par logement (m²)
  estimatedLevels:       number;  // niveaux utilisés pour le calcul SDP
  landCostTotal?:        number;  // coût foncier total (€)
}

export const DEFAULT_FINANCIAL_ASSUMPTIONS: ScenarioFinancialAssumptions = {
  salePricePerM2:        5500,
  constructionCostPerM2: 2200,
  floorEfficiencyPct:    83,
  averageLotSizeM2:      62,
  estimatedLevels:       4,
  landCostTotal:         0,
};

// ─── RÉSULTATS FINANCIERS ─────────────────────────────────────────────

export interface ScenarioFinancialResult {
  sdpEstimatedM2:       number;   // Surface De Plancher estimée
  saleableAreaM2:       number;   // surface vendable nette
  estimatedLots:        number;   // nb de logements
  revenueEur:           number;   // CA brut
  constructionCostEur:  number;
  grossMarginEur:       number;
  grossMarginPct:       number;   // marge brute / CA
}

// ─── SCÉNARIO COMPLET ─────────────────────────────────────────────────

export interface ImplantationScenarioFull {
  id:          string;
  key:         ScenarioKey;
  title:       string;
  subtitle:    string;
  description: string;

  buildings: Building2D[];
  parkings:  Parking2D[];

  empriseM2:         number;
  cesPct:            number;
  totalFloorsAreaM2: number;
  buildingCount:     number;
  parkingRequired:   number;   // 0 si nbLogements non défini
  parkingProvided:   number;

  isConforme:        boolean;

  scoreGlobal:        number;
  scoreReglementaire: number;
  scoreFoncier:       number;
  scoreSimplicite:    number;

  deltaEmprisePct?:    number;
  deltaBuildingCount?: number;
  deltaParkingCount?:  number;
  deltaFloorAreaPct?:  number;

  notes:     string[];
  strengths: string[];
  vigilance: string[];

  /**
   * Nombre de logements fourni par l'utilisateur.
   * undefined = non défini → le contrôle parking n'est pas effectué.
   */
  nbLogements?: number;

  /**
   * Surface moyenne par logement (m²), telle que saisie par l'utilisateur.
   * undefined = non définie.
   */
  surfaceMoyLogementM2?: number;

  // Financier — calculé à partir des hypothèses passées à evaluateScenario
  financial?: ScenarioFinancialResult;
}