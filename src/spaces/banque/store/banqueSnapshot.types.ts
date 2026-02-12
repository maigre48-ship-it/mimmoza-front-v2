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

  // (legacy) champs parfois utilisés dans le front
  adresseProjet?: string;
  codePostal?: string;
  commune?: string;

  surfaceTerrain?: number;
  surfaceSDP?: number;

  dateReception?: string;
  notes?: string;

  // ── Champs projet explicites (priorité sur emprunteur) ──
  codePostalProjet?: string;
  communeProjet?: string;
  communeInseeProjet?: string;
  departementProjet?: string;

  parcelleCadastrale?: string;        // ex: "000 AB 0123"
  sectionCadastrale?: string;         // ex: "AB"
  prefixeCadastral?: string;          // ex: "000"

  latProjet?: number;
  lngProjet?: number;

  // Optionnel: si tu utilises "typePret" côté UI (vu dans snapshots)
  typePret?: string;
}

// ---------------------------------------------------------------------------
// OPTION B — Analyse crédit complète
// ---------------------------------------------------------------------------

export interface AnalyseBudget {
  /** Prix d'achat du bien (EUR) — blocker si absent */
  purchasePrice?: number;
  /** Travaux (EUR) */
  works?: number;
  /** Frais (notaire, divers) (EUR) */
  fees?: number;
  /** Apport / fonds propres (EUR) */
  equity?: number;

  /** Notes libres */
  notes?: string;
}

export interface AnalyseRevenus {
  /** Mode de calcul de capacité */
  mode?: "residence" | "locatif";

  // ── Résidence / Particulier ──
  /** Revenus mensuels nets (EUR) */
  incomeMonthlyNet?: number;
  /** Dettes mensuelles existantes (EUR) */
  otherDebtMonthly?: number;

  // ── Locatif ──
  /** Loyer mensuel (EUR) */
  rentMonthly?: number;
  /** Charges mensuelles (EUR) */
  chargesMonthly?: number;
  /** Vacance en % (0..100) */
  vacancyRatePct?: number;

  notes?: string;
}

export interface AnalyseBienEtat {
  /** Etat général */
  condition?: "neuf" | "bon" | "moyen" | "mauvais";
  /** Conformité / contraintes majeures */
  conformity?: "ok" | "incertain" | "ko";
  /** Notes / observations */
  notes?: string;
}

export interface AnalyseCalendrier {
  /** Date acquisition (prévue) ISO */
  acquisitionDate?: string;
  /** Durée travaux (mois) */
  worksMonths?: number;
  /** Date sortie (vente / mise en location) ISO */
  exitDate?: string;
  /** Risque d'exécution */
  executionRisk?: "faible" | "moyen" | "fort";
  notes?: string;
}

export interface DossierAnalyse {
  // ✅ Option B — nouvelles sections structurées
  budget?: AnalyseBudget;
  revenus?: AnalyseRevenus;
  bien?: AnalyseBienEtat;
  calendrier?: AnalyseCalendrier;

  // ─────────────────────────────────────────────
  // Champs "legacy" / compatibilité (déjà utilisés)
  // ─────────────────────────────────────────────
  scoreCreditGlobal?: number;         // 0-100 (override manuel éventuel)

  ratioLTV?: number;                  // % (legacy)
  ratioDSCR?: number;                 // legacy
  tauxEndettement?: number;           // % (legacy)
  fondsPropresPct?: number;           // % (legacy)

  chiffreAffairesPrev?: number;       // legacy (si tu fais du pro)
  margeBrutePrev?: number;            // legacy
  triProjet?: number;                 // % (legacy)

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
  ratioGarantieSurPret?: number;      // % (attention: dans certains snapshots tu sembles stocker "4" pour 4%)
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

  // (Optionnel) autres champs vus dans snapshots (compat)
  montant?: number;
  projectType?: string;
  sponsor?: string;
  nom?: string;
  statut?: string;
  emprunteur?: any;
  analysis?: any;
  report?: any;
  dates?: any;
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
