export type SnapshotSource = "mimmoza" | "external" | "manual" | "api";

export type AssetClass =
  | "residentiel"
  | "mixte"
  | "tertiaire"
  | "hotel"
  | "sante"
  | "logistique"
  | "autre";

export type Stage =
  | "origination"
  | "analyse"
  | "comite"
  | "accord"
  | "refus"
  | "suivi";

export type Currency = "EUR";

export type NumberOrNull = number | null;

export type Completeness = {
  percent: number;
  missing: string[];
  warnings: string[];
};

export type Provenance = {
  source: SnapshotSource;
  sourceRef?: string;
  importedAt?: string;
  updatedAt?: string;
  updatedBy?: string;
};

export type ProjectIdentity = {
  dossierId: string;
  name?: string;
  stage: Stage;
  assetClass: AssetClass;

  address?: {
    label?: string;
    communeInsee?: string;
    lat?: number;
    lon?: number;
  };

  sponsor?: {
    name?: string;
    legalForm?: string;
    experienceScore?: NumberOrNull;
    trackRecord?: {
      operationsDone?: NumberOrNull;
      defaults?: NumberOrNull;
    };
  };
};

export type Programme = {
  units?: NumberOrNull;
  surfaceSaleableM2?: NumberOrNull;
  sdpM2?: NumberOrNull;
  parkingSpots?: NumberOrNull;

  calendar?: {
    startDate?: string;
    durationMonths?: NumberOrNull;
  };

  strategy?: "promotion" | "marchand" | "locatif" | "autre";
};

export type Hypotheses = {
  pricePerM2?: NumberOrNull;
  salesPriceTotal?: NumberOrNull;
  worksCost?: NumberOrNull;
  landCost?: NumberOrNull;
  feesAndSoftCosts?: NumberOrNull;
  contingencyRatePct?: NumberOrNull;
  salesPaceUnitsPerMonth?: NumberOrNull;
};

export type UsesSources = {
  currency: Currency;

  emplois: {
    totalCost?: NumberOrNull;
    land?: NumberOrNull;
    works?: NumberOrNull;
    softCosts?: NumberOrNull;
    financingCosts?: NumberOrNull;
    taxes?: NumberOrNull;
    contingency?: NumberOrNull;
    other?: NumberOrNull;
  };

  ressources: {
    equity?: NumberOrNull;
    debt?: NumberOrNull;
    mezzanine?: NumberOrNull;
    subsidies?: NumberOrNull;
    presales?: NumberOrNull;
    other?: NumberOrNull;
  };
};

export type CreditMetrics = {
  ltvPct?: NumberOrNull;
  ltcPct?: NumberOrNull;
  dscr?: NumberOrNull;
  icr?: NumberOrNull;
  breakevenSalesPct?: NumberOrNull;
};

export type Profitability = {
  grossMarginEur?: NumberOrNull;
  grossMarginPct?: NumberOrNull;
  netMarginEur?: NumberOrNull;
  netMarginPct?: NumberOrNull;
  irrPct?: NumberOrNull;
  roiPct?: NumberOrNull;
};

export type Cashflow = {
  periodicity: "monthly" | "quarterly";
  series: Array<{
    t: number;
    inflow?: NumberOrNull;
    outflow?: NumberOrNull;
    net?: NumberOrNull;
    debtOutstanding?: NumberOrNull;
  }>;
};

export type ExternalDocs = {
  financialFileId?: string;
  riskFileId?: string;
  marketFileId?: string;
  other?: Array<{ label: string; fileId: string }>;
};

export type LinkedRiskStudy = {
  available: boolean;
  source: "mimmoza" | "external";
  summary?: string;
  payload?: unknown;
};

export type LinkedMarketStudy = {
  available: boolean;
  source: "mimmoza" | "external";
  summary?: string;
  payload?: unknown;
};

export type FinancialSnapshotV1 = {
  version: "financialSnapshot.v1";

  provenance: Provenance;
  completeness: Completeness;

  project: ProjectIdentity;
  programme?: Programme;

  hypotheses?: Hypotheses;
  usesSources?: UsesSources;

  creditMetrics?: CreditMetrics;
  profitability?: Profitability;
  cashflow?: Cashflow;

  docs?: ExternalDocs;

  risks?: LinkedRiskStudy;
  market?: LinkedMarketStudy;

  notes?: {
    analyst?: string;
    committee?: string;
  };
};
