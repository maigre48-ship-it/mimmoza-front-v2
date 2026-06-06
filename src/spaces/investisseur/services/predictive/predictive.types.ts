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

// V2 : horizons 36m / 60m optionnels (activés si horizonDetention >= 36 ou >= 60)
export type PredictiveScenario = {
  horizon6m: number;
  horizon12m: number;
  horizon18m: number;
  horizon24m: number;
  horizon36m?: number;
  horizon60m?: number;
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

  // V2 : horizon36m / horizon60m optionnels
  forecast: {
    horizon6m: PredictivePoint;
    horizon12m: PredictivePoint;
    horizon18m: PredictivePoint;
    horizon24m: PredictivePoint;
    horizon36m?: PredictivePoint;
    horizon60m?: PredictivePoint;
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

// ── V2 : Nouveaux types d'enrichissement ─────────────────────────────────────

export type PredictivePlu = {
  zone?: string;        // ex: "UA", "UB", "UC", "N", "A", "AU1"
  libelle?: string;     // libellé complet de la zone PLU
  hauteurMax?: number;  // hauteur maximale autorisée (m)
  empriseSol?: number;  // CES en % (0-100)
  cos?: number;         // Coefficient d'Occupation des Sols
};

export type PredictiveGeorisques = {
  inondation?: boolean;         // risque inondation (PPRi)
  sismique?: number;            // zone sismique 1 (très faible) à 5 (forte)
  retraitGonflement?: boolean;  // retrait-gonflement des argiles
  mouvementTerrain?: boolean;   // mouvement de terrain
  cavites?: boolean;            // cavités souterraines
  radon?: number;               // potentiel radon 1 (faible) à 3 (élevé)
};

export type PredictiveFiscalite = {
  regime?: "lmnp_reel" | "lmnp_micro" | "pinel" | "nu" | "sci_ir" | "sci_is";
  tauxMarginalImposition?: number;  // TMI : 0, 11, 30, 41 ou 45
  deficitFoncierEstime?: number;    // déficit foncier annuel estimé (€)
  amortissementAnnuel?: number;     // amortissement annuel LMNP réel (€)
};

// ── Input du moteur prédictif ─────────────────────────────────────────────────

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

  // ── V2 — Enrichissements ───────────────────────────────────────────────────

  /** DPE — Classe énergétique : "A" | "B" | "C" | "D" | "E" | "F" | "G" */
  dpe?: string;

  /** PLU — Zonage réglementaire (depuis FoncierPluPage) */
  plu?: PredictivePlu;

  /** Géorisques (depuis RisquesPage) */
  georisques?: PredictiveGeorisques;

  /** Loyer médian de zone en €/m²/mois */
  loyerMedianZone?: number;

  /** Score démographie INSEE 0-100 (depuis SmartScore V4) */
  demographieScore?: number;

  /** Score pression constructive Sitadel 0-100 (depuis SmartScore V4) */
  sitadelConcurrence?: number;

  /** Régime fiscal et paramètres associés */
  fiscalite?: PredictiveFiscalite;

  /** Horizon de détention en mois — active les projections 36m/60m si >= 36/60 */
  horizonDetention?: number;
};