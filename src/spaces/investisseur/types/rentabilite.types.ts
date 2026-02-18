// src/spaces/investisseur/types/rentabilite.types.ts

export type RentabiliteStrategy = 'revente' | 'location';

export type RentabiliteDecision = 'GO' | 'GO_AVEC_RESERVES' | 'NO_GO';

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
  // Fiscalité
  tmiPct: number;
  taxFlatPct: number;
  useFlatTax: boolean;
  // Option
  apport: number;
}

export interface RentabiliteResult {
  fraisNotaire: number;
  coutTotal: number;
  margeBrute: number;
  margePct: number;
  roiPct: number;
  triPct: number;
  cashflowMensuel: number;
  rendementBrutPct: number;
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
  loyerMensuel: string;
  chargesMensuelles: string;
  taxeFoncieresAnnuelle: string;
  tmiPct: string;
  taxFlatPct: string;
  useFlatTax: boolean;
  apport: string;
}

export const DEFAULT_FORM: RentabiliteFormStrings = {
  strategy: 'revente',
  prixAchat: '',
  fraisNotairePct: '8',
  budgetTravaux: '',
  fraisDivers: '',
  dureeMois: '12',
  surface: '',
  prixReventeCible: '',
  loyerMensuel: '',
  chargesMensuelles: '',
  taxeFoncieresAnnuelle: '',
  tmiPct: '30',
  taxFlatPct: '30',
  useFlatTax: true,
  apport: '',
};