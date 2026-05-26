// ─────────────────────────────────────────────────────────────────────────────
// planAnalysis.types.ts
// Module : Analyse du plan — Mimmoza / Espace Réhabilitation
// ─────────────────────────────────────────────────────────────────────────────

// ---------------------------------------------------------------------------
// Enums & unions
// ---------------------------------------------------------------------------

export type BuildingType =
  | "ERP"
  | "Logement"
  | "Bureau"
  | "Commerce"
  | "Hôtel"
  | "Résidence senior";

/**
 * Catégories ERP selon le Code de la Construction et de l'Habitation.
 * J, M, N, O, R, U, W sont les types les plus courants en réhabilitation.
 */
export type ErpType = "J" | "M" | "N" | "O" | "R" | "U" | "W";

/** Catégorie ERP : 1 (> 1 500 pers.) → 5 (< 200 pers. / établissements scolaires 5e cat.) */
export type ErpCategory = 1 | 2 | 3 | 4 | 5;

export type FloorCount = "RDC" | "R+1" | "R+2" | "R+3" | "R+4+";

export type IssueSeverity = "non_conforme" | "a_verifier" | "conforme";

export type ComplianceLevel = "conforme" | "partiel" | "non_conforme" | "non_evalue";

export type RiskLevel = "faible" | "modere" | "eleve" | "critique";

// ---------------------------------------------------------------------------
// Types qualitatifs — lecture IA (v2/v3)
// ---------------------------------------------------------------------------

/** Fiabilité globale de la lecture IA sur le plan fourni */
export type ReadingReliability = "faible" | "moyenne" | "forte";

/** Qualité d'une lecture (géométrique, fonctionnelle, flux, zoning, modularité) */
export type ReadingQuality = "bonne" | "moyenne" | "faible";

/** Qualité spécifique de la lecture réglementaire */
export type RegulatoryReadingQuality = "bonne" | "partielle" | "faible";

/**
 * Niveau de preuve d'un élément détecté sur le plan :
 * - detected             : élément clairement visible (nom, symbole, cote)
 * - to_confirm           : supposé, visible mais non confirmé
 * - not_verifiable       : impossible à vérifier sur image
 * - regulatory_assumption: conclusion fondée sur les paramètres ERP, pas sur le plan
 */
export type EvidenceLevel =
  | "detected"
  | "to_confirm"
  | "not_verifiable"
  | "regulatory_assumption";

/** Niveau de confiance attribué à une issue */
export type ConfidenceLevel = "forte" | "moyenne" | "faible";

// ---------------------------------------------------------------------------
// Paramètres d'entrée
// ---------------------------------------------------------------------------

export interface BuildingParams {
  /** Type principal du bâtiment */
  buildingType: BuildingType;
  /** Usage cible libre (ex : "Centre de soin", "Crèche privée") */
  targetUsage: string;
  /** Établissement recevant du public */
  isErp: boolean;
  /** Type ERP si applicable */
  erpType: ErpType | null;
  /** Catégorie ERP si applicable */
  erpCategory: ErpCategory | null;
  /** Nombre de niveaux */
  floorCount: FloorCount;
  /** Surface plancher estimée en m² */
  estimatedSurface: number | null;
  /** Capacité d'accueil estimée en personnes */
  capacity: number | null;
}

export interface PlanUpload {
  file: File;
  /** URL locale générée via URL.createObjectURL — jamais uploadée */
  previewUrl: string;
}

export interface PlanAnalysisInput {
  plan: PlanUpload | null;
  building: BuildingParams;
}

// ---------------------------------------------------------------------------
// Résultats d'analyse
// ---------------------------------------------------------------------------

export interface PlanIssue {
  id: string;
  severity: IssueSeverity;
  category: IssueCategory;
  title: string;
  description: string;
  /** Référence réglementaire (ex : "Art. R4216-2 CCH", "ERP Titre II Ch. 2") */
  regulatoryRef: string | null;
  /** Zone ou repère sur le plan — sera utilisé pour l'annotation future */
  planZone: string | null;
  /** Niveau de preuve de la détection — v2 */
  evidenceLevel?: EvidenceLevel;
  /** Niveau de confiance de l'issue — v2 */
  confidence?: ConfidenceLevel;
}

export type IssueCategory =
  | "PMR"
  | "Sécurité incendie"
  | "Circulation"
  | "Sanitaires"
  | "Éclairage"
  | "Structure"
  | "Ventilation"
  | "Signalétique";

export interface PlanRecommendation {
  id: string;
  priority: RecommendationPriority;
  title: string;
  description: string;
  estimatedCost: CostRange | null;
  relatedIssueIds: string[];
}

export type RecommendationPriority = "urgente" | "importante" | "recommandee";

export interface CostRange {
  min: number;
  max: number;
  unit: "€" | "€/m²";
}

// ---------------------------------------------------------------------------
// Scores et KPIs
// ---------------------------------------------------------------------------

export interface ComplianceScore {
  /** Score global de 0 à 100 */
  global: number;
  pmr: number;
  fireSafety: number;
  circulation: number;
  sanitaryFacilities: number;
}

// ---------------------------------------------------------------------------
// Lecture architecturale — v2
// ---------------------------------------------------------------------------

/**
 * Résultat des 3 lectures architecturales effectuées par l'IA :
 * géométrique, fonctionnelle, réglementaire.
 */
export interface ArchitecturalReading {
  /** Qualité de la lecture géométrique (pièces, cotes, organisation) */
  geometry: ReadingQuality;
  /** Qualité de la lecture fonctionnelle (flux, zoning, distribution) */
  functional: ReadingQuality;
  /** Qualité de la lecture réglementaire (PMR, incendie, ERP) */
  regulatory: RegulatoryReadingQuality;
  /** Synthèse narrative des 3 lectures */
  summary: string;
}

/**
 * Éléments spatiaux détectés sur le plan par l'IA.
 * Chaque tableau contient des descriptions textuelles ou est vide ([]).
 */
export interface DetectedSpatialElements {
  halls: string[];
  corridors: string[];
  rooms: string[];
  sanitarySpaces: string[];
  technicalRooms: string[];
  stairs: string[];
  exits: string[];
  receptionAreas: string[];
  therapyAreas: string[];
  careRooms: string[];
}

// ---------------------------------------------------------------------------
// Intelligence spatiale — v3
// ---------------------------------------------------------------------------

/**
 * Analyse approfondie de la qualité spatiale du plan :
 * flux, zoning, modularité, contraintes et opportunités de transformation.
 */
export interface SpatialIntelligence {
  /** Qualité des flux de circulation identifiés */
  flowQuality: ReadingQuality;
  /** Cohérence et lisibilité du découpage en zones */
  zoningQuality: ReadingQuality;
  /** Potentiel de reconfiguration du cloisonnement */
  modularity: ReadingQuality;
  /** Contraintes spatiales identifiées (noyaux porteurs, escaliers fixes…) */
  constraints: string[];
  /** Opportunités de transformation (surlargeurs, espaces modulables…) */
  opportunities: string[];
  /** Synthèse narrative de l'intelligence spatiale */
  summary: string;
}

// ---------------------------------------------------------------------------
// Résultat global d'analyse
// ---------------------------------------------------------------------------

export interface PlanAnalysisResult {
  id: string;
  analyzedAt: string; // ISO 8601
  /** Paramètres d'entrée utilisés */
  input: PlanAnalysisInput;

  // Scores
  complianceScore: ComplianceScore;
  riskLevel: RiskLevel;
  pmrLevel: ComplianceLevel;
  fireSafetyLevel: ComplianceLevel;

  // Détail
  issues: PlanIssue[];
  recommendations: PlanRecommendation[];

  /** Résumé narratif — généré par IA */
  summary: string;

  /** Métadonnées moteur */
  engineMeta: AnalysisEngineMeta;

  // ── Champs v2 — lecture architecturale ──────────────────────────────────

  /** Fiabilité globale de la lecture IA sur le plan fourni */
  reliability?: ReadingReliability;

  /** Résultat des 3 lectures architecturales (géométrique / fonctionnelle / réglementaire) */
  architecturalReading?: ArchitecturalReading;

  /** Éléments spatiaux détectés sur le plan */
  detectedSpatialElements?: DetectedSpatialElements;

  /** Observations fonctionnelles libres issues de la lecture fonctionnelle */
  functionalObservations?: string[];

  // ── Champs v3 — intelligence spatiale ───────────────────────────────────

  /** Analyse qualitative des flux, du zoning, de la modularité et du potentiel de transformation */
  spatialIntelligence?: SpatialIntelligence;
}

// ---------------------------------------------------------------------------
// Métadonnées moteur
// ---------------------------------------------------------------------------

export interface AnalysisEngineMeta {
  version: string;
  mode: "mock" | "ocr" | "ai_vision" | "regulatory_engine" | "real";
  processingTimeMs: number;
  /** Confiance globale du moteur : 0–1 */
  confidence: number | null;
  /** Modèle IA utilisé (ex : "gpt-4o") — v2 */
  model?: string;
}

// ---------------------------------------------------------------------------
// États UI
// ---------------------------------------------------------------------------

export type AnalysisStatus =
  | "idle"
  | "uploading"
  | "analyzing"
  | "done"
  | "error";

export interface AnalysisError {
  code: string;
  message: string;
}