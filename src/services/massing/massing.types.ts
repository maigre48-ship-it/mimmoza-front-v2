// src/services/massing/massing.types.ts
// ─────────────────────────────────────────────────────────────────────────────
// MASSING ENGINE V2 — Types core
//
// Objectif produit :
//   "Que puis-je construire sur cette parcelle ?"  → emprise / hauteur / SDP / niveaux / logements
//   "Quel scénario maximise la valeur du foncier ?" → 3 scénarios + charge foncière admissible
//
// Principe : ce module ne RECRÉE aucun moteur (PLU, Valuation, Opportunity…).
// Il CONSOMME leurs sorties via des structures d'entrée minimales et structurelles.
// Zéro dépendance externe (pas de Three.js, pas de turf, pas d'IA).
// ─────────────────────────────────────────────────────────────────────────────

// ── Entrée PLU (sous-ensemble structurel de ResolvedPluRulesetV1) ─────────────
// Volontairement permissif : tout objet conforme au PLU Engine est assignable.

export interface PluReculRuleInput {
  min_m: number | null;
  type?: "FIXED" | "DERIVED" | "UNKNOWN";
  note?: string | null;
}

export interface PluImplantationLimiteInput {
  autorisee: boolean | null;
  note?: string | null;
}

export interface PluReculsInput {
  voirie?: PluReculRuleInput | null;
  limites_separatives?: PluReculRuleInput | null;
  fond_parcelle?: PluReculRuleInput | null;
  implantation_en_limite?: PluImplantationLimiteInput | null;
}

export interface PluRulesetInput {
  zone_code?: string | null;
  zone_libelle?: string | null;
  confidence_score?: number | null; // 0..1 si fourni par le PLU Engine
  ces?: { max_ratio: number | null; note?: string | null } | null;
  hauteur?: { max_m: number | null; note?: string | null } | null;
  stationnement?: {
    par_logement: number | null;
    par_100m2: number | null;
    note?: string | null;
  } | null;
  reculs?: PluReculsInput | null;
  // Souvent absent du ruleset PLU : laissé nullable, jamais inventé.
  espaces_verts?: { min_ratio?: number | null; note?: string | null } | null;
  completeness?: { ok: boolean; missing: string[] } | null;
}

// ── Contexte parcelle = entrée du Massing Engine ──────────────────────────────

export interface ParcelContext {
  parcelId?: string | null;
  /** Assiette foncière en m² (cumul des parcelles sélectionnées). */
  surfaceM2: number;
  communeInsee?: string | null;
  zoneCode?: string | null;
  zoneLibelle?: string | null;
  /** Sortie du PLU Engine (ResolvedPluRulesetV1). null si indisponible. */
  plu: PluRulesetInput | null;
  /**
   * Anneau extérieur optionnel en WGS84 [[lng, lat], …] pour la géométrie future.
   * Typé en number[][] pour éviter toute dépendance geojson dans le moteur pur.
   */
  polygonWgs84?: number[][] | null;
  /**
   * Prix de sortie €/m² vendable, injecté depuis le Valuation Engine si dispo.
   * null = non renseigné (les économies seront masquées tant que non fourni).
   */
  prixSortieM2?: number | null;
  prixSortieSource?: string | null;
}

// ── Configuration (coefficients tous configurables) ───────────────────────────

export type ScenarioName = "prudent" | "central" | "optimise";

export interface MassingConfig {
  /** Hauteur du RDC en m (gabarit RDC souvent > étage courant). */
  groundFloorHeightM: number;
  /** Hauteur d'un étage courant en m. */
  typicalFloorHeightM: number;
  /** SDP → surface vendable (circulations, gaines, murs, communs). 0..1 */
  coefVendable: number;
  /** Surface moyenne d'un logement en m² vendable. */
  avgUnitSizeM2: number;
  /** Facteurs d'utilisation de la capacité (emprise) par scénario. */
  scenarioFactors: Record<ScenarioName, number>;
}

// ── Contraintes volumétriques (sortie du PLU Adapter) ─────────────────────────

export interface MassingConstraints {
  cesMax: number | null; // coefficient d'emprise au sol, ratio 0..1
  hauteurMaxM: number | null;
  stationnementParLogement: number | null;
  stationnementPar100m2: number | null;
  reculVoirieM: number | null;
  reculLimitesM: number | null;
  reculFondM: number | null;
  implantationLimiteAutorisee: boolean | null;
  espacesVertsMinRatio: number | null; // souvent null

  // Dérivés
  footprintMaxM2: number | null; // surfaceM2 × cesMax
  niveauxMax: number | null; // dérivé de la hauteur PLU

  completeness: { ok: boolean; missing: string[] };
  warnings: string[];
}

// ── Scénario de capacité (sortie du Massing Engine) ───────────────────────────

export interface MassingScenario {
  name: ScenarioName;
  label: string;
  /** Facteur d'utilisation de la capacité appliqué (0..1). */
  capacityFactor: number;

  footprintM2: number;
  levels: number;
  heightM: number;
  sdpM2: number;
  saleableAreaM2: number;
  estimatedUnits: number;
  parkingRequired: number;

  /** Indice de fiabilité 0..1 (complétude PLU + agressivité du scénario). */
  confidence: number;
  notes: string[];
}

export interface MassingResult {
  parcel: { surfaceM2: number; zoneCode: string | null; zoneLibelle: string | null };
  constraints: MassingConstraints;
  scenarios: MassingScenario[];
  config: MassingConfig;
  generatedAt: string;
  /** true si aucune capacité calculable (CES ou hauteur manquants). */
  blocked: boolean;
}

// ── Économie promoteur ────────────────────────────────────────────────────────

export interface EconomicsHypotheses {
  /** €/m² vendable (sortie commercialisation). Idéalement issu du Valuation Engine. */
  prixSortieM2: number;
  /** €/m² SDP. */
  coutConstructionM2: number;
  /** €/m² d'emprise au sol (proxy VRD / aménagements extérieurs). */
  coutVrdM2: number;
  /** % du CA. */
  honorairesPct: number;
  /** €/m² SDP (taxe d'aménagement & assimilés). */
  taxesM2Sdp: number;
  /** % des travaux. */
  fraisFinanciersPct: number;
  /** Marge cible (% du CA) servant au calcul de charge foncière admissible. */
  margeCiblePct: number;
  /** Prix d'acquisition du foncier si connu (sinon null → marge non calculable). */
  foncierTotal: number | null;
}

export interface ScenarioEconomics {
  scenario: ScenarioName;
  revenue: number;
  coutTravaux: number;
  coutVrd: number;
  honoraires: number;
  taxes: number;
  fraisFinanciers: number;
  coutsHorsFoncier: number;
  foncier: number | null;
  totalCost: number;
  margin: number | null; // null si foncier inconnu
  marginPct: number | null;
  /** Charge foncière admissible pour atteindre la marge cible. Peut être négative. */
  landValueMax: number;
  /** true si marge cible atteignable avec un foncier ≥ 0. */
  viable: boolean;
}

// ── Géométrie simplifiée (préparation visualisation, sans Three.js) ───────────

export interface Vec2 {
  x: number;
  y: number;
}

export interface MassingGeometry {
  scenario: ScenarioName;
  footprintM2: number;
  levels: number;
  heightM: number;
  /** Empreinte locale en mètres, centrée sur l'origine. */
  footprintPolygon: Vec2[];
  boundingBox: { widthM: number; depthM: number; heightM: number };
  /** Hauteur de chaque dalle, du RDC au dernier niveau. */
  levelHeightsM: number[];
}

// ── Rapport (préparation PDF, dépendance-free) ────────────────────────────────

export interface MassingReportSection {
  title: string;
  rows: Array<{ label: string; value: string }>;
}

export interface MassingReport {
  version: "massing_report_v1";
  generatedAt: string;
  parcelTitle: string;
  sections: MassingReportSection[];
  scenarioTable: { headers: string[]; rows: string[][] };
  recommendation: { bestScenario: ScenarioName; reason: string };
}