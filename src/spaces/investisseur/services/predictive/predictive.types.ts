export type PredictiveMarketRegime =
  | "correction"
  | "plateau"
  | "reprise"
  | "hausse";

export type PredictiveDriverDirection =
  | "positive"
  | "negative"
  | "neutral";

export type PredictivePoint = {
  pricePerSqm: number;
  marketValue: number;
  deltaPercent: number;
  confidenceScore: number;
};

export type PredictiveScenario = {
  horizon6m: number;
  horizon12m: number;
  horizon18m: number;
  horizon24m: number;
};

export type PredictiveDriver = {
  key: string;
  label: string;
  direction: PredictiveDriverDirection;
  impact: number;
  description: string;
};

export type PredictiveDataSource = {
  key: string;
  label: string;
  available: boolean;
  detail?: string;
};

export type PredictiveAnalysisSnapshot = {
  assetId?: string;
  generatedAt: string;

  spot: {
    pricePerSqm: number;
    marketValue: number;
    rangeLow: number;
    rangeHigh: number;
    confidenceScore: number;
  };

  market: {
    regime: PredictiveMarketRegime;
    pressureScore: number;
    liquidityScore: number;
    riskScore: number;
  };

  forecast: {
    horizon6m: PredictivePoint;
    horizon12m: PredictivePoint;
    horizon18m: PredictivePoint;
    horizon24m: PredictivePoint;
  };

  scenarios: {
    prudent: PredictiveScenario;
    central: PredictiveScenario;
    optimistic: PredictiveScenario;
  };

  drivers: PredictiveDriver[];

  operationImpact: {
    targetResale6m: number;
    targetResale12m: number;
    targetResale18m: number;
    targetResale24m: number;
    projectedMargin: number;
    projectedNetProfit: number;
    breakEvenPrice: number;
    stressDownsidePercent: number;
  };

  summary: {
    verdict: string;
    explanation: string;
  };

  dataSources: PredictiveDataSource[];
};

export type PredictiveEngineInput = {
  surfaceM2: number;
  acquisitionPrice: number;
  codePostal: string;
  typeBien: "appartement" | "maison" | "immeuble" | "terrain" | "commerce";
  travauxEstime?: number;
  fraisAnnexes?: number;

  /** Données DVF réelles */
  dvf?: {
    prixM2Median?: number;
    nbTransactions?: number;
    evolutionPctAnnuelle?: number;
  };

  /** Scores marché réels */
  marketScores?: {
    global?: number;
    demande?: number;
    offre?: number;
    accessibilite?: number;
    environnement?: number;
    liquidite?: number;
    opportunity?: number;
    pressionRisque?: number;
  };

  /** Données rentabilité */
  rentabilite?: {
    rendementBrut?: number;
    rendementNet?: number;
    cashflowMensuel?: number;
    margeBrute?: number;
    margeBrutePct?: number;
    prixReventeCible?: number;
  };

  /** Données BPE */
  bpe?: {
    score?: number;
  };

  /** Taux directeur BCE réel (%) — depuis ecbRate.service */
  tauxBcePct?: number;

  /** Analyse BCE complète — pression crédit, tendance, interprétation */
  ecbAnalysis?: {
    pressureScore: number;
    pressureLabel: string;
    trend: "hausse" | "baisse" | "stable";
    interpretation: string;
    refinancingRate: number;
    source: "ecb" | "fallback";
  };
};