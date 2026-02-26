/**
 * strategy.types.ts
 * ─────────────────────────────────────────────────────────────────────
 * Types pour le module Investisseur > Analyse (Rentabilité + Due Diligence
 * + Marché/Risques + Synthèse IA).
 *
 * Points clés:
 * - Scenario = unité de simulation (financement, inflation, durée, régime)
 * - ScenarioResults = résultats calculés (TRI, VAN, cash-flows, stress)
 * - DueDiligence = checklist + pièces + risques non financiers
 * - MarketRiskData = données marché DVF + risques géo
 * - MacroRate = taux sans risque ECB depuis Supabase
 * ─────────────────────────────────────────────────────────────────────
 */

// ─── Stratégie globale ───────────────────────────────────────────────

export type StrategyType = "revente" | "location";

export type FiscalRegime =
  | "lmnp_reel"
  | "lmnp_micro"
  | "lmp"
  | "sci_is"
  | "sci_ir"
  | "nom_propre"
  | "defiscalisation";

// ─── Macro Rates (ECB / Supabase) ───────────────────────────────────

export interface MacroRate {
  seriesKey: string;
  valuePct: number;
  rateDate: string;
  source: string;
}

// ─── Financement ─────────────────────────────────────────────────────

export interface Financement {
  apportPct: number;        // % du coût total (achat + frais + travaux)
  tauxNominal: number;      // taux annuel nominal du prêt (ex: 3.5 = 3.5%)
  dureeMois: number;        // durée du prêt en mois
  assurancePct: number;     // taux assurance annuel (ex: 0.34%)
  differeMois: number;      // différé d'amortissement en mois (0 = sans)
}

// ─── Scénario ────────────────────────────────────────────────────────

export type DiscountRateMode = "auto" | "manual";

export interface Scenario {
  id: string;
  name: string;
  strategy: StrategyType;
  fiscalRegime: FiscalRegime;
  dureeAnnees: number;

  // Inflation annuelle (%)
  inflationMarche: number;   // appréciation/dépréciation du bien
  inflationLoyers: number;   // revalorisation annuelle des loyers
  inflationTravaux: number;  // dérive coûts travaux

  // Financement
  financement: Financement;

  // Rendement cible / taux d'actualisation
  discountRateMode: DiscountRateMode;
  discountRateManual: number;  // utilisé si mode = manual (%)

  // Primes de risque pour mode auto (%)
  primeRisqueScenario: number;
  primeIlliquidite: number;
  primeLevier: number;
}

// ─── Résultats de scénario ───────────────────────────────────────────

export interface ScenarioResults {
  scenarioId: string;
  discountRate: number;       // taux effectif utilisé (auto ou manual) (%)
  triEquity: number | null;   // TRI equity (%) – null si non calculable
  vanEquity: number;          // VAN equity (€)
  cashFlowCumule: number;     // cash-flow cumulé sur la période (€)
  multipleCapital: number;    // (total reçu) / (total investi)
  fluxEquity: number[];       // flux par année (t=0, t=1, ..., t=N)
  mensualite: number;         // mensualité du prêt (€)
  crdSortie: number;          // capital restant dû à la sortie (€)
  verdict: "excellent" | "bon" | "acceptable" | "insuffisant";
}

// ─── Stress test ─────────────────────────────────────────────────────

export interface StressTestResults {
  base: ScenarioResults;
  stress: ScenarioResults;   // travaux +15%, revente -8%, taux +1.5pts
  cash: ScenarioResults;     // scénario dégradé simplifié
}

// ─── Comparaison scénarios ───────────────────────────────────────────

export interface ScenarioComparison {
  scenarioId: string;
  name: string;
  triEquity: number | null;
  vanEquity: number;
  discountRate: number;
  verdict: string;
}

// ─── Négociation ─────────────────────────────────────────────────────

export interface NegotiationResult {
  prixMaxRecommande: number;
  zoneSecurity: number;       // prix max - 5%
  seuilDanger: number;        // prix au-delà duquel VAN < 0
  margeNego: number;          // % entre prix actuel et prix max
}

// ─── Deal inputs (mappé depuis snapshot existant) ────────────────────

export interface DealInputs {
  dealId: string;
  label: string;
  address: string;
  prixAchat: number;
  fraisNotaire: number;       // montant €
  fraisAgence: number;        // montant €
  montantTravaux: number;
  loyerMensuelBrut: number;   // pour stratégie location
  chargesAnnuelles: number;   // charges copro + TF + assurance PNO + gestion
  vacanceLocativePct: number; // % de vacance estimée
  prixReventeEstime: number;  // estimation revente (avant inflation)
  surfaceM2: number;
  dpeNote: string;
}

// ─── Due Diligence ───────────────────────────────────────────────────

export type ChecklistStatus = "todo" | "ok" | "blocked";

export interface ChecklistItem {
  id: string;
  category: ChecklistCategory;
  label: string;
  status: ChecklistStatus;
  note: string;
}

export type ChecklistCategory =
  | "juridique"
  | "technique"
  | "financement"
  | "copro_urbanisme"
  | "marche_locatif"
  | "risques";

export const CHECKLIST_CATEGORY_LABELS: Record<ChecklistCategory, string> = {
  juridique: "Juridique",
  technique: "Technique",
  financement: "Financement",
  copro_urbanisme: "Copro / Urbanisme",
  marche_locatif: "Marché locatif",
  risques: "Risques",
};

export type DocumentStatus = "manquant" | "recu";

export interface DocumentItem {
  id: string;
  label: string;
  status: DocumentStatus;
  note: string;
}

export interface DueDiligenceState {
  checklist: ChecklistItem[];
  documents: DocumentItem[];
  risquesNonFinanciers: string[];
}

// ─── Marché / Risques ────────────────────────────────────────────────

export type RiskLevel = "faible" | "modere" | "eleve";

export interface MarketDVFData {
  prixM2Median: number | null;
  prixM2Min: number | null;
  prixM2Max: number | null;
  nbVentes: number | null;
  tendancePct: number | null;     // % évolution annuelle (positif = hausse)
  periodeLabel: string | null;    // ex: "2023-2024"
}

export interface RiskItem {
  label: string;
  level: RiskLevel;
  detail?: string;
}

export interface RiskData {
  niveauGlobal: RiskLevel;
  items: RiskItem[];
  recommandations: string[];
}

export interface MarketRiskResponse {
  market: MarketDVFData | null;
  risk: RiskData | null;
  confidence: number | null;      // 0-100
  fetchedAt: string;              // ISO date
  error?: string;
}

// ─── Analyse state complet ───────────────────────────────────────────

export interface AnalyseState {
  strategy: StrategyType;
  fiscalRegime: FiscalRegime;
  scenarios: Scenario[];
  dueDiligence: DueDiligenceState;
}

// ─── Onglets Analyse ─────────────────────────────────────────────────

export type AnalyseTab = "rentabilite" | "due_diligence" | "marche_risques" | "synthese_ia";