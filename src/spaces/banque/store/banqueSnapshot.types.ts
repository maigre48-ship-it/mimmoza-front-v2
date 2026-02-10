// ============================================================================
// banqueSnapshot.types.ts — Types for the Banque single source of truth
// ============================================================================

/** Statut d'avancement d'un dossier bancaire */
export type DossierStatus =
  | "brouillon"
  | "origination"
  | "analyse"
  | "comite"
  | "decision"
  | "monitoring"
  | "cloture";

/** Type de projet financé */
export type ProjectType =
  | "promotion_residentielle"
  | "promotion_commerciale"
  | "marchand_de_biens"
  | "ehpad"
  | "residence_etudiante"
  | "logistique"
  | "bureaux"
  | "autre";

// ---------------------------------------------------------------------------
// Sous-structures par onglet
// ---------------------------------------------------------------------------

export interface DossierOrigination {
  emprunteur?: string;
  siret?: string;
  montantDemande?: number;
  dureeEnMois?: number;
  typeProjet?: ProjectType;
  adresseProjet?: string;
  codePostal?: string;
  commune?: string;
  surfaceTerrain?: number;
  surfaceSDP?: number;
  dateReception?: string;
  notes?: string;
}

export interface DossierAnalyse {
  scoreCreditGlobal?: number;        // 0-100
  ratioLTV?: number;                  // %
  ratioDSCR?: number;
  tauxEndettement?: number;           // %
  fondsPropresPct?: number;           // %
  chiffreAffairesPrev?: number;
  margeBrutePrev?: number;
  triProjet?: number;                 // %
  commentaireAnalyste?: string;
  dateAnalyse?: string;
}

export interface RisqueItem {
  id: string;
  categorie: string;                  // "geo" | "marche" | "juridique" | "construction" | "financier"
  label: string;
  niveau: "faible" | "modere" | "eleve" | "critique";
  description?: string;
  mitigant?: string;
}

export interface DossierRisques {
  items: RisqueItem[];
  scoreRisqueGlobal?: number;         // 0-100
  dateEvaluation?: string;
  commentaire?: string;
}

export interface GarantieItem {
  id: string;
  type: string;                       // "hypotheque" | "nantissement" | "caution" | "gage" | "autre"
  description: string;
  valeurEstimee?: number;
  rang?: number;
  dateConstitution?: string;
}

export interface DossierGaranties {
  items: GarantieItem[];
  couvertureTotale?: number;          // montant €
  ratioGarantieSurPret?: number;      // %
  commentaire?: string;
}

export interface DossierDecision {
  avisComite?: "favorable" | "favorable_sous_conditions" | "defavorable" | "ajourne";
  conditionsSuspensives?: string[];
  dateComite?: string;
  membresPresents?: string[];
  commentaireComite?: string;
  montantAccorde?: number;
  tauxAccorde?: number;
  dureeAccordee?: number;
}

export interface DossierMonitoring {
  capitalRestantDu?: number;
  echeancesImpayees?: number;
  alertes?: string[];
  dateDernierSuivi?: string;
  commentaire?: string;
}

export interface DocumentItem {
  id: string;
  nom: string;
  type: string;                       // "kbis" | "bilan" | "permis" | "plan" | "attestation" | "autre"
  statut: "attendu" | "recu" | "valide" | "refuse";
  dateReception?: string;
  url?: string;
  commentaire?: string;
}

export interface DossierDocuments {
  items: DocumentItem[];
  completude?: number;                // 0-100 %
}

// ---------------------------------------------------------------------------
// Dossier complet
// ---------------------------------------------------------------------------

export interface BanqueDossier {
  id: string;
  reference: string;                  // ex: "DOSS-2026-001"
  label: string;                      // nom affiché
  status: DossierStatus;
  createdAt: string;                  // ISO
  updatedAt: string;                  // ISO

  // Données par onglet
  origination: DossierOrigination;
  analyse: DossierAnalyse;
  risques: DossierRisques;
  garanties: DossierGaranties;
  decision: DossierDecision;
  monitoring: DossierMonitoring;
  documents: DossierDocuments;
}

// ---------------------------------------------------------------------------
// Événement du journal d'activité
// ---------------------------------------------------------------------------

export interface BanqueEvent {
  id: string;
  timestamp: string;                  // ISO
  type: string;                       // "dossier_created" | "analyse_updated" | "risque_added" | …
  dossierId?: string;
  message: string;
  meta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Snapshot global — source de vérité unique
// ---------------------------------------------------------------------------

export interface BanqueSnapshot {
  version: number;                    // schema version for migration
  updatedAt: string;                  // ISO
  dossiersById: Record<string, BanqueDossier>;
  selectedDossierId: string | null;
  events: BanqueEvent[];
}

// ---------------------------------------------------------------------------
// Helpers pour creation de dossier
// ---------------------------------------------------------------------------

export function createEmptyDossier(id: string, label: string): BanqueDossier {
  const now = new Date().toISOString();
  const ref = `DOSS-${new Date().getFullYear()}-${String(Date.now() % 10000).padStart(4, "0")}`;
  return {
    id,
    reference: ref,
    label,
    status: "brouillon",
    createdAt: now,
    updatedAt: now,
    origination: {},
    analyse: {},
    risques: { items: [] },
    garanties: { items: [] },
    decision: {},
    monitoring: {},
    documents: { items: [] },
  };
}

export function createEmptySnapshot(): BanqueSnapshot {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    dossiersById: {},
    selectedDossierId: null,
    events: [],
  };
}