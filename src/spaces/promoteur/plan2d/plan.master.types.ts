// src/spaces/promoteur/plan2d/plan.master.types.ts
//
// Type central du pipeline d'implantation 2D.
//
// MasterScenario est la source de vérité unique pour :
//   - le panneau de droite (métriques, conformité, économie)
//   - l'export PDF (exportDrawnScenarioPdf.ts)
//   - la génération 3D (via geometry.buildings)
//
// Construit exclusivement par buildMasterScenario()
// dans masterScenario.service.ts.

import type { Building2D, Parking2D } from './editor2d.types';
import type { Point2D }               from './editor2d.types';

// ─── HYPOTHÈSES ÉCONOMIQUES ───────────────────────────────────────────

export interface MasterEconomicAssumptions {
  salePricePerM2:        number;   // €/m² surface vendable
  constructionCostPerM2: number;   // €/m² SDP
  floorEfficiencyPct:    number;   // % SDP → surface vendable (typique : 80-88)
  averageLotSizeM2:      number;   // m²/logement (pour estimation si nbLogements absent)
  estimatedLevels:       number;   // niveaux utilisés si floorsAboveGround = 0
  landCostTotal:         number;   // € coût foncier total
}

export const DEFAULT_MASTER_ECONOMIC_ASSUMPTIONS: MasterEconomicAssumptions = {
  salePricePerM2:        5500,
  constructionCostPerM2: 2200,
  floorEfficiencyPct:    83,
  averageLotSizeM2:      62,
  estimatedLevels:       4,
  landCostTotal:         0,
};

// ─── GÉOMÉTRIE ────────────────────────────────────────────────────────

export interface MasterScenarioGeometry {
  /** Polygone parcelle en coordonnées éditeur (SVG, Y-down). */
  parcelPolygon:             Point2D[];
  parcelAreaM2:              number;
  buildableEnvelopePolygon?: Point2D[];
  /** Bâtiments source — directement issus du store éditeur 2D. */
  buildings:                 Building2D[];
  /** Parkings source — directement issus du store éditeur 2D. */
  parkings:                  Parking2D[];
}

// ─── PROGRAMME ────────────────────────────────────────────────────────

export interface MasterScenarioProgram {
  buildingKind:          'INDIVIDUEL' | 'COLLECTIF';
  /** undefined = non défini → contrôle stationnement désactivé. */
  nbLogements?:          number;
  surfaceMoyLogementM2?: number;
  /** Étages au-dessus du RDC (valeur moyenne parmi les bâtiments). */
  floorsAboveGround:     number;
  groundFloorHeightM:    number;
  typicalFloorHeightM:   number;
}

// ─── MÉTRIQUES ────────────────────────────────────────────────────────

export interface MasterScenarioMetrics {
  parcelAreaM2:          number;
  /**
   * Emprise bâtie = somme des volumes RDC non-connecteurs.
   * Cohérente avec le tooltip SURFACES — RDC du canvas.
   */
  buildingsFootprintM2:  number;
  /** Emprise parking = somme rect.width × rect.depth. */
  parkingsFootprintM2:   number;
  totalFootprintM2:      number;
  /** coverageRatio = buildingsFootprintM2 / parcelAreaM2 ∈ [0, 1]. */
  coverageRatio:         number;
  buildingCount:         number;
  maxHeightM:            number;
  /** SDP totale estimée (emprise × niveaux). */
  totalFloorsAreaM2:     number;
  /** Places fournies — source : p.slotCount (éditeur). */
  parkingProvided:       number;
  /** Places requises — 0 si nbLogements non défini. */
  parkingRequired:       number;
  /** provided − required. Négatif = déficit. */
  parkingDelta:          number;
}

// ─── CONFORMITÉ ───────────────────────────────────────────────────────

export type MasterConformityStatus = 'CONFORME' | 'LIMITE' | 'BLOQUANT';

export interface MasterScenarioConformity {
  cesOk:      boolean;
  heightOk:   boolean;
  /** true si nbLogements non défini (parking non évalué → non bloquant). */
  parkingOk:  boolean;
  isConforme: boolean;
  status:     MasterConformityStatus;
  /** Messages métier en français, lisibles par un promoteur. */
  messages:   string[];
}

// ─── ÉCONOMIE ─────────────────────────────────────────────────────────

export interface MasterScenarioEconomics {
  sdpEstimatedM2:       number;
  saleableAreaM2:       number;
  estimatedLots:        number;
  revenueEur:           number;
  constructionCostEur:  number;
  landCostEur:          number;
  grossMarginEur:       number;
  grossMarginPct:       number;
}

// ─── SCORES ───────────────────────────────────────────────────────────

export interface MasterScenarioScores {
  regulatory:     number;   // 0–100
  landEfficiency: number;   // 0–100
  simplicity:     number;   // 0–100
  /** Pondéré 40 / 35 / 25. */
  overall:        number;   // 0–100
}

// ─── NARRATIF ─────────────────────────────────────────────────────────

export interface MasterScenarioNarrative {
  summary:         string;
  strengths:       string[];
  vigilancePoints: string[];
  nextAction?:     string;
}

// ─── SCÉNARIO MAÎTRE ──────────────────────────────────────────────────

/**
 * MasterScenario — source de vérité unique du pipeline d'implantation.
 *
 * Représente exactement le plan dessiné par l'utilisateur.
 * Construit par buildMasterScenario() dans masterScenario.service.ts.
 */
export interface MasterScenario {
  id:          string;
  generatedAt: string;   // ISO 8601

  geometry:    MasterScenarioGeometry;
  program:     MasterScenarioProgram;
  metrics:     MasterScenarioMetrics;
  conformity:  MasterScenarioConformity;
  economics:   MasterScenarioEconomics;
  scores:      MasterScenarioScores;
  narrative:   MasterScenarioNarrative;

  /** Hypothèses économiques utilisées pour ce calcul. */
  economicAssumptions: MasterEconomicAssumptions;
}