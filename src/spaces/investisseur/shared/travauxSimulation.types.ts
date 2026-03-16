// src/spaces/investisseur/shared/travauxSimulation.types.ts
// Types “Travaux Simulation” (v1) — Mode C: Simple + Expert
// Objectif: une structure extensible, compatible devis pro (lots) + pièce par pièce.

export type TravauxRange = "eco" | "standard" | "premium";

export type RenovationLevel = "refresh" | "standard" | "heavy" | "full";

/**
 * Complexité chantier (0..4) :
 * 0 = facile, 4 = très complexe (accès, copro, évacuation, surprises)
 */
export type ChantierComplexity = 0 | 1 | 2 | 3 | 4;

export type QuantityUnit = "m2" | "ml" | "u" | "forfait" | "pct";

export type LotCode =
  | "prelim"
  | "demolition"
  | "gravats"
  | "maconnerie"
  | "isolation_thermique"
  | "isolation_phonique"
  | "plomberie"
  | "electricite"
  | "ventilation_chauffage"
  | "menuiseries"
  | "sols"
  | "murs_peinture"
  | "cuisine"
  | "sdb"
  | "divers"
  | "honoraires";

export type RiskFlag =
  | "copro_validation"
  | "porteur_risque"
  | "amiante_suspect"
  | "plomberie_colonne"
  | "electricite_normes";

export type TravauxTag =
  | "demolition"
  | "gravats"
  | "thermique"
  | "phonique"
  | "plomberie"
  | "electricite"
  | "chauffage"
  | "ventilation"
  | "menuiserie"
  | "sol"
  | "mur"
  | "cuisine"
  | "sdb"
  | "moe"
  | "risque";

export interface Price3 {
  eco: number;
  standard: number;
  premium: number;
}

export type PricingItemCode =
  | // Prelim
  "prelim_protection"
  | "prelim_nettoyage"
  | // Demolition / curage
  "demol_depose_sols"
  | "demol_depose_faience_sanitaires"
  | "demol_depose_cuisine"
  | "demol_depose_cloisons"
  | "demol_curage_complet"
  | // Gravats
  "gravats_evacuation"
  | "gravats_benne"
  | // Maconnerie / supports
  "macon_ragreage"
  | "macon_reprises_supports"
  | "macon_cloisons_placo"
  | "macon_doublage"
  | // Isolation thermique
  "isol_th_murs"
  | "isol_th_plafond"
  | "isol_th_sol_sous_couche"
  | // Isolation phonique
  "isol_ph_murs_mitoyens"
  | "isol_ph_plafond"
  | "isol_ph_sous_couche"
  | "isol_ph_portes_isophoniques"
  | // Plomberie
  "plomb_reseau_partiel"
  | "plomb_reseau_complet"
  | "plomb_deplacement_points_eau"
  | "plomb_chauffe_eau"
  | // Electricite
  "elec_mise_aux_normes_partielle"
  | "elec_reseau_complet"
  | "elec_tableau"
  | "elec_spots"
  | "elec_rj45"
  | // Ventilation / Chauffage
  "vent_vmc"
  | "chauff_radiateurs"
  | "chauff_seche_serviette"
  | // Menuiseries
  "menuis_portes_int"
  | "menuis_fenetres"
  | "menuis_placards"
  | // Sols
  "sol_parquet"
  | "sol_carrelage"
  | "sol_plinthes"
  | // Murs / peinture
  "mur_peinture_simple"
  | "mur_ratissage_complet"
  | "mur_faience"
  | // Cuisine
  "cuisine_pack"
  | "cuisine_pose"
  | // SDB
  "sdb_pack"
  | "sdb_spec_etancheite"
  | // Divers
  "divers_humidite"
  | "divers_petites_reparations"
  | // Honoraires
  "honoraires_moe_pct";

export interface PricingItem {
  code: PricingItemCode;
  label: string;
  unit: QuantityUnit;
  prices: Price3;
  tags?: TravauxTag[];
  riskFlags?: RiskFlag[];
  /**
   * For “expert mode” optional variants (not used in v1 calculator)
   * Example: parquet stratifié vs massif, etc.
   */
  variants?: {
    code: string;
    label: string;
    prices: Price3;
  }[];
}

export interface LotPricing {
  code: LotCode;
  label: string;
  items: PricingItem[];
}

export type PieceType =
  | "sejour"
  | "cuisine"
  | "chambre"
  | "sdb"
  | "wc"
  | "entree"
  | "couloir"
  | "bureau"
  | "balcon"
  | "autre";

/**
 * Expert mode selection: a line item referencing pricing code + qty
 * qty unit must match the PricingItem.unit.
 */
export interface ExpertLineItem {
  itemCode: PricingItemCode;
  qty: number;
  note?: string;
}

export interface PieceTravaux {
  id: string;
  type: PieceType;
  name: string;
  surfaceM2: number;
  items: ExpertLineItem[];
}

export type TriChoice = "none" | "partial" | "full";
export type BinaryChoice = "none" | "yes";

export interface TravauxOptionsSimple {
  cuisineRefaire: TriChoice; // none / partial / full
  sdbRefaire: TriChoice; // none / partial / full

  electricite: TriChoice; // ok / partial / full
  plomberie: TriChoice; // ok / partial / full
  menuiseries: TriChoice; // ok / partial / full

  isolationThermique: TriChoice; // none / partial / full
  isolationPhonique: TriChoice; // none / partial / full

  demolition: TriChoice; // light/partial/full (mapped)
  gravats: TriChoice; // light/partial/full (mapped)

  humiditeTraitement: BinaryChoice; // none/yes
  moe: BinaryChoice; // maîtrise d’œuvre (honoraires %)
}

/**
 * Simulation state stored (v1).
 * If mode = "simple": compute from surface + options.
 * If mode = "expert": compute from pieces + global items.
 */
export interface TravauxSimulationV1 {
  version: 1;

  mode: "simple" | "expert";
  range: TravauxRange;
  renovationLevel: RenovationLevel;

  surfaceTotalM2: number;

  options: TravauxOptionsSimple;

  complexity: ChantierComplexity;

  /**
   * If user overrides buffer (otherwise calculator picks default)
   */
  bufferPct?: number;

  /**
   * Expert mode:
   */
  pieces: PieceTravaux[];

  updatedAt: string; // ISO date
}

export interface ComputedLine {
  code: PricingItemCode;
  label: string;
  unit: QuantityUnit;
  qty: number;
  unitPrice: number;
  amount: number;
}

export interface ComputedLot {
  code: LotCode;
  label: string;
  amount: number;
  lines: ComputedLine[];
}

export interface ComputedTravaux {
  mode: "simple" | "expert";
  range: TravauxRange;
  surfaceTotalM2: number;

  total: number; // HT (assumption)
  bufferPct: number;
  bufferAmount: number;
  totalWithBuffer: number;
  costPerM2: number | null;

  complexityCoef: number;

  lots: ComputedLot[];
}