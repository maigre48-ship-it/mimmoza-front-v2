// ============================================================================
// operationSummary.types.ts
// src/spaces/banque/types/operationSummary.types.ts
//
// Modèle canonique UNIVERSEL pour l'espace Banque.
// Tous les champs sont optionnels sauf meta.profile.
// Fonctionne pour: particulier / marchand / promoteur / entreprise.
//
// ✅ FIX #7: Ajout equity dans OperationBudget, ajout dsti/monthlyPayment/
//    projectCost/pricePerSqmMarket dans OperationKpis, ajout residence/locatif
//    dans RevenueStrategy pour couvrir les modes de revenus saisis.
// ============================================================================

// ── Profile types ──

export type OperationProfile =
  | "particulier"
  | "marchand"
  | "promoteur"
  | "entreprise";

export type OperationType =
  | "acquisition"
  | "construction"
  | "renovation"
  | "refinancement"
  | "promotion"
  | "marchand_de_biens"
  | "investissement_locatif"
  | "residence_principale"
  | "autre";

export type AssetType =
  | "logement"
  | "bureaux"
  | "commerce"
  | "hotel"
  | "ehpad"
  | "residence_senior"
  | "residence_etudiante"
  | "terrain"
  | "mixte"
  | "autre";

export type LoanType =
  | "amortissable"
  | "in_fine"
  | "relais"
  | "ptz"
  | "credit_bail"
  | "ligne_credit"
  | "autre";

export type RevenueStrategy =
  | "revente"
  | "location"
  | "exploitation"
  | "mixte"
  | "residence"
  | "locatif"
  | "autre";

export type MissingSeverity = "info" | "warn" | "blocker";

// ── Missing data item ──

export interface MissingDataItem {
  key: string;           // ex: "budget.purchasePrice"
  label: string;         // ex: "Prix d'achat"
  severity: MissingSeverity;
}

// ── Sub-blocks ──

export interface OperationMeta {
  profile: OperationProfile;
  createdAt?: string;    // ISO
  updatedAt?: string;    // ISO
  source?: "manual" | "promoteur_import" | "marchand_import" | "enriched";
}

export interface OperationProject {
  label?: string;
  operationType?: OperationType;
  assetType?: AssetType;
  address?: string;
  communeInsee?: string;
  departement?: string;
  lat?: number;
  lng?: number;
  surfaceM2?: number;
  surfaceTerrain?: number;
  lots?: number;
  etages?: number;
  anneeConstruction?: number;
  dpe?: string;
  description?: string;
}

export interface OperationBudget {
  purchasePrice?: number;
  notaryFees?: number;
  worksBudget?: number;
  softCosts?: number;          // honoraires, études, etc.
  holdingCosts?: number;       // frais portage (intérêts intercalaires)
  contingency?: number;        // aléas
  landCost?: number;           // coût foncier (promoteur)
  constructionCost?: number;   // coût construction (promoteur)
  totalCost?: number;          // calculé ou saisi
  equity?: number;             // apport personnel
  // Ratios pré-calculés
  costPerSqm?: number;
}

export interface OperationFinancing {
  loanAmount?: number;
  loanDurationMonths?: number;
  loanType?: LoanType;
  interestRate?: number;       // % annuel
  equity?: number;
  apportPersonnel?: number;
  coFinancers?: string[];
  insuranceCost?: number;
  monthlyPayment?: number;
}

export interface ScenarioValues {
  exitValue?: number;
  margin?: number;
  roi?: number;
  irr?: number;
  cashflow?: number;
  notes?: string;
}

export interface OperationRevenues {
  strategy?: RevenueStrategy;
  exitValue?: number;          // valeur de sortie / revente
  rentAnnual?: number;         // loyer annuel
  rentPerSqm?: number;
  occupancyRate?: number;      // taux d'occupation (%)
  revenueTotal?: number;       // CA total estimé (promoteur) ou revenu annuel (résidence)
  scenarios?: {
    base?: ScenarioValues;
    stress?: ScenarioValues;
    upside?: ScenarioValues;
  };
}

export interface MarketDataPoint {
  label: string;
  value: string | number;
  source?: string;
  date?: string;
}

export interface OperationMarket {
  pricePerSqm?: number;
  pricePerSqmMin?: number;
  pricePerSqmMax?: number;
  compsCount?: number;
  demandIndex?: number;        // 0-100
  supplyIndex?: number;        // 0-100
  absorptionMonths?: number;
  evolutionPct?: number;       // évolution prix %
  transactionsCount?: number;
  populationCommune?: number;
  populationEvolution?: number;
  revenueMedian?: number;      // revenu médian commune
  tensionLocative?: number;    // indice tension
  notes?: string;
  sources?: string[];
  dataPoints?: MarketDataPoint[];
}

export interface RiskItem {
  category: string;            // ex: "flood", "seismic", "radon"
  label: string;
  level: "faible" | "moyen" | "élevé" | "très élevé" | "inconnu";
  status: "absent" | "present" | "unknown";
  description?: string;
  source?: string;
}

export interface OperationRisks {
  geo?: RiskItem[];
  urbanism?: RiskItem[];       // PLU violations, servitudes
  execution?: RiskItem[];      // risques d'exécution
  environmental?: RiskItem[];
  score?: number;              // 0-100 (100 = pas de risque)
  globalLevel?: "faible" | "moyen" | "élevé" | "critique";
  notes?: string;
  sources?: string[];
}

export interface OperationKpis {
  margin?: number;             // marge brute (%)
  marginNet?: number;          // marge nette (%)
  roi?: number;                // retour sur investissement (%)
  irr?: number;                // TRI (%)
  ltv?: number;                // Loan-to-Value (%)
  ltc?: number;                // Loan-to-Cost (%)
  dscr?: number;               // Debt Service Coverage Ratio
  icr?: number;                // Interest Coverage Ratio
  cashOnCash?: number;         // rendement cash-on-cash (%)
  yieldGross?: number;         // rendement brut (%)
  yieldNet?: number;           // rendement net (%)
  paybackMonths?: number;      // délai de remboursement
  // ✅ FIX #7: Champs calculés par computeRatios / applyCreditInputsToOperation
  dsti?: number;               // Debt Service to Income (%)
  monthlyPayment?: number;     // Mensualité estimée (€)
  projectCost?: number;        // Coût total du projet (€)
  pricePerSqmMarket?: number;  // Prix marché au m² (€/m²)
}

// ── Main type ──

export interface OperationSummary {
  meta: OperationMeta;
  project?: OperationProject;
  budget?: OperationBudget;
  financing?: OperationFinancing;
  revenues?: OperationRevenues;
  market?: OperationMarket;
  risks?: OperationRisks;
  kpis?: OperationKpis;
  missing: MissingDataItem[];
}

// ── Factory ──

export function createEmptyOperation(
  profile: OperationProfile
): OperationSummary {
  return {
    meta: {
      profile,
      createdAt: new Date().toISOString(),
      source: "manual",
    },
    missing: [],
  };
}