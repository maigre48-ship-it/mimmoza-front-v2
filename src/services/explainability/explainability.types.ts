// =============================================================================
// Mimmoza — Explainability Engine
// explainability.types.ts
//
// Moteur d'explication DÉTERMINISTE. Aucune IA. Aucun appel réseau.
// Aucune dépendance React / Supabase ici : logique pure, testable isolément.
// =============================================================================

export type FactorType = "positive" | "negative" | "neutral";

export type FactorCategory =
  | "market"
  | "dvf"
  | "location"
  | "mobility"
  | "risk"
  | "plu"
  | "opportunity";

/**
 * Facteur d'explication unitaire.
 * `impact` = MAGNITUDE dans [0..1]. Le SIGNE est porté par `type`.
 *   positive  -> contribution +impact
 *   negative  -> contribution -impact
 *   neutral   -> contribution 0 (affiché à titre informatif)
 */
export interface ExplanationFactor {
  id: string;
  type: FactorType;
  category: FactorCategory;
  label: string;
  description?: string;
  impact: number;
}

export interface ExplanationResult {
  score: number; // 0..100
  factors: ExplanationFactor[];
  recommendation: string;
}

// -----------------------------------------------------------------------------
// CONTRATS D'ENTRÉE NORMALISÉS
// -----------------------------------------------------------------------------
// Ce sont les SEULS points de couplage avec ton code existant.
// Tu mappes tes objets réels (résultat valuation, DVF, GTFS, géorisques, marché)
// vers ces shapes dans l'écran Analyse Rapide. Tous les champs sont optionnels :
// une donnée manquante ne produit jamais de crash, juste moins de facteurs.
// -----------------------------------------------------------------------------

export interface ValuationInput {
  estimatedValue?: number; // valeur estimée €
  pricePerSqm?: number; // €/m²
  askingPrice?: number; // prix demandé €
  confidence?: number; // 0..1
  /** Score déjà calculé en amont (locationScore / score Mimmoza). Si fourni,
   *  il est EXPLIQUÉ et non recalculé (cf. Phase 6 : ne pas dupliquer). */
  providedScore?: number; // 0..100
}

export interface DvfInput {
  comparablesCount?: number; // nb de comparables retenus
  recentCount?: number; // nb de transactions < 12 mois
  medianPricePerSqm?: number; // €/m² médian
  marketDepth?: "low" | "medium" | "high"; // profondeur de marché
}

export interface MobilityInput {
  score?: number; // 0..100 (transport-score-gtfs-v1)
  stopsNearby?: number;
}

export interface RiskInput {
  flood?: boolean; // inondation
  flags?: string[]; // libellés de risques identifiés
  severity?: "low" | "medium" | "high";
}

export interface MarketInput {
  dynamism?: number; // 0..100
  liquidity?: "low" | "medium" | "high";
  trend?: "up" | "stable" | "down";
}

export interface OpportunityInput {
  discountPct?: number; // décote % vs marché (positif = décote)
  yieldPct?: number; // rentabilité %
  worksCost?: number; // montant travaux €
  worksHeavy?: boolean; // travaux importants
  /** Score opportunité déjà calculé en amont. Si fourni, il est EXPLIQUÉ. */
  providedScore?: number; // 0..100
}

// -----------------------------------------------------------------------------
// ENTRÉES DES BUILDERS
// -----------------------------------------------------------------------------

export interface ValuationExplainInput {
  valuation: ValuationInput;
  dvf?: DvfInput;
  mobility?: MobilityInput;
  risk?: RiskInput;
  market?: MarketInput;
  /** Facteurs issus du Knowledge Graph (Phase 6). Fusionnés, jamais recalculés. */
  externalFactors?: ExplanationFactor[];
}

export interface OpportunityExplainInput {
  opportunity: OpportunityInput;
  market?: MarketInput;
  dvf?: DvfInput;
  externalFactors?: ExplanationFactor[];
}

// -----------------------------------------------------------------------------
// DÉCISION MIMMOZA (Phase 5)
// -----------------------------------------------------------------------------

export type DecisionVerdict =
  | "ACHAT_DECONSEILLE"
  | "NEGOCIATION_RECOMMANDEE"
  | "PRIX_COHERENT"
  | "POTENTIEL_INVESTISSEUR_FAIBLE"
  | "POTENTIEL_PROMOTEUR_LIMITE";

export interface MimmozaDecision {
  verdict: DecisionVerdict;
  message: string;
  /** Facteurs déterminants de la décision (pour affichage). */
  drivers: ExplanationFactor[];
}

export interface DecisionInput {
  estimatedValue?: number;
  askingPrice?: number;
  profile?: "investisseur" | "promoteur" | "auto";
  yieldPct?: number;
  worksHeavy?: boolean;
  riskSeverity?: "low" | "medium" | "high";
  valuation: ExplanationResult;
  opportunity: ExplanationResult;
}