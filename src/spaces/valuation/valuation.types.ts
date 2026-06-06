// ─────────────────────────────────────────────────────────────────────────────
// Mimmoza Valuation Engine — Types centraux
// ─────────────────────────────────────────────────────────────────────────────

export type QuickAnalysisVertical =
  | "investisseur"
  | "rehabilitateur"
  | "promoteur";

export type AssetType =
  | "bien"
  | "terrain"
  | "immeuble"
  | "local"
  | "unknown";

export type RiskLevel = "low" | "medium" | "high" | "unknown";

export type PropertyCondition =
  | "excellent"
  | "good"
  | "average"
  | "poor"
  | "unknown";

export type RentalTension = "low" | "medium" | "high" | "unknown";

export type SitadelTrend = "up" | "stable" | "down" | "unknown";

// ─────────────────────────────────────────────────────────────────────────────
// Entrée
// ─────────────────────────────────────────────────────────────────────────────

export interface DvfComparable {
  price: number;
  surface?: number | null;
  pricePerSqm?: number | null;
  date?: string | null;
  distanceMeters?: number | null;
  assetType?: string | null;
}

export interface PluInput {
  zone?: string | null;
  constructible?: boolean | null;
  maxHeight?: number | null;
  maxFootprintRatio?: number | null;
  estimatedSdp?: number | null;
  parkingRules?: string | null;
}

export interface GeorisquesInput {
  globalRiskLevel?: RiskLevel;
  flood?: boolean;
  clay?: boolean;
  ppr?: boolean;
  pollutedSoil?: boolean;
}

export interface SitadelInput {
  permitsNearbyCount?: number | null;
  housingUnitsAuthorizedNearby?: number | null;
  trend?: SitadelTrend;
}

export interface MarketInput {
  localPricePerSqm?: number | null;
  yearlyPriceEvolutionPct?: number | null;
  rentalTension?: RentalTension;
  vacancyRate?: number | null;
  medianRentPerSqm?: number | null;
}

export interface MimmozaValuationInput {
  vertical: QuickAnalysisVertical;
  assetType?: AssetType;

  address?: string;
  city?: string;
  postalCode?: string;
  parcelId?: string;

  askingPrice?: number | null;
  surface?: number | null;
  landSurface?: number | null;

  rooms?: number | null;
  propertyCondition?: PropertyCondition;

  estimatedWorksAmount?: number | null;
  resalePriceTarget?: number | null;

  expectedRent?: number | null;

  dvfComparables?: DvfComparable[];
  smartScore?: number | null;

  plu?: PluInput | null;
  georisques?: GeorisquesInput | null;
  sitadel?: SitadelInput | null;
  market?: MarketInput | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Résultat
// ─────────────────────────────────────────────────────────────────────────────

export type OpportunityBadge =
  | "Opportunité forte"
  | "Opportunité intéressante"
  | "À vérifier"
  | "Risqué";

export interface SourceStatus {
  dvf: boolean;
  plu: boolean;
  georisques: boolean;
  sitadel: boolean;
  marketData: boolean;
  smartScore: boolean;
}

export interface MimmozaValuationResult {
  assetType: AssetType;
  vertical: QuickAnalysisVertical;

  address?: string;
  city?: string;
  postalCode?: string;
  parcelId?: string;
  surface?: number;
  landSurface?: number;

  // Valorisation marché
  marketValue: number | null;
  lowEstimate: number | null;
  highEstimate: number | null;
  confidenceScore: number; // 0–100

  // Opportunité
  opportunityScore: number; // 0–100
  opportunityValue: number | null; // delta prix marché - prix demandé
  opportunityLabel: OpportunityBadge;

  // Valeurs par verticale
  investorValue?: number | null;
  merchantValue?: number | null;
  developerValue?: number | null;

  // Rendement locatif (investisseur)
  rentEstimate?: number | null;
  grossYield?: number | null;
  netYield?: number | null;

  // Prix au m²
  estimatedPricePerSqm?: number | null;
  localPricePerSqm?: number | null;

  // Risque & synthèse
  riskLevel: RiskLevel;
  recommendation: string;

  // Points forts / faibles / alertes
  strengths: string[];
  weaknesses: string[];
  warnings: string[];

  // Disponibilité des sources
  sources: SourceStatus;

  // Données brutes transmises (pour debug / affichage enrichi)
  raw?: {
    dvf?: unknown;
    plu?: unknown;
    georisques?: unknown;
    sitadel?: unknown;
    market?: unknown;
    smartScore?: unknown;
  };
}