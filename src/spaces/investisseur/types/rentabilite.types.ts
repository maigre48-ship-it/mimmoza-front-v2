// src/spaces/investisseur/types/rentabilite.types.ts

export type RentabiliteStrategy = "revente" | "location";

export type RentabiliteDecision = "GO" | "GO_AVEC_RESERVES" | "NO_GO";

/**
 * Régime fiscal (v1 simplifiée) pour la location.
 * - Micro : base imposable = revenu net avant impôts * (1 - abattement)
 * - Réel simplifié : base imposable = revenu net avant impôts (sans amortissements v1)
 */
export type RegimeFiscalLocation =
  | "LMNP_MICRO_BIC"
  | "LMNP_REEL_SIMPLIFIE"
  | "NU_MICRO_FONCIER"
  | "NU_REEL_SIMPLIFIE";

export interface RentabiliteInput {
  strategy: RentabiliteStrategy;
  prixAchat: number;
  fraisNotairePct: number;
  budgetTravaux: number;
  fraisDivers: number;
  dureeMois: number;
  surface: number;
  prixReventeCible: number;

  // Location only
  loyerMensuel: number;
  chargesMensuelles: number;
  taxeFoncieresAnnuelle: number;

  // Régime location (nouveau)
  regimeFiscalLocation?: RegimeFiscalLocation;

  // Fiscalité (taux)
  tmiPct: number;
  taxFlatPct: number;
  useFlatTax: boolean;

  // Options
  apport: number;

  // Paramétrage abattements (v1: defaults constants)
  abattementMicroBicPct?: number; // default 50
  abattementMicroFoncierPct?: number; // default 30
}

export interface RentabiliteResult {
  fraisNotaire: number;
  coutTotal: number;
  margeBrute: number;
  margePct: number;
  roiPct: number;
  triPct: number;

  // Location
  cashflowMensuel: number;
  rendementBrutPct: number;

  // Nouveaux KPI fiscaux (location)
  revenuNetAvantImpotsAnnuel?: number;
  baseImposableAnnuel?: number;
  impotAnnuel?: number;

  decision: RentabiliteDecision;
  reasons: string[];
}

export interface RentabiliteScenarios {
  base: RentabiliteResult;
  optimiste: RentabiliteResult;
  pessimiste: RentabiliteResult;
}

export interface RentabiliteStressTests {
  reventeMoins5: RentabiliteResult;
  travauxPlus10: RentabiliteResult;
}

export interface RentabiliteSnapshot {
  input: RentabiliteInput;
  scenarios: RentabiliteScenarios;
  stressTests: RentabiliteStressTests;
  updatedAt: string;
}

export interface RentabiliteFormStrings {
  strategy: RentabiliteStrategy;
  prixAchat: string;
  fraisNotairePct: string;
  budgetTravaux: string;
  fraisDivers: string;
  dureeMois: string;
  surface: string;
  prixReventeCible: string;

  // Location
  loyerMensuel: string;
  chargesMensuelles: string;
  taxeFoncieresAnnuelle: string;

  // Nouveau
  regimeFiscalLocation: RegimeFiscalLocation;

  // Taux
  tmiPct: string;
  taxFlatPct: string;
  useFlatTax: boolean;

  // Option
  apport: string;
}

export const DEFAULT_FORM: RentabiliteFormStrings = {
  strategy: "revente",
  prixAchat: "",
  fraisNotairePct: "8",
  budgetTravaux: "",
  fraisDivers: "",
  dureeMois: "12",
  surface: "",
  prixReventeCible: "",

  loyerMensuel: "",
  chargesMensuelles: "",
  taxeFoncieresAnnuelle: "",

  // Par défaut, aligné avec ton UI screenshot
  regimeFiscalLocation: "LMNP_MICRO_BIC",

  tmiPct: "30",
  taxFlatPct: "30",
  useFlatTax: true,
  apport: "",
};