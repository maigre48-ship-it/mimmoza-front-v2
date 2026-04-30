// src/spaces/promoteur/services/promoteurSynthese.types.ts
// v4.1 — Ajout des champs DVF détaillés dans PromoteurRawInput.marche
//        pour remonter la richesse de market-study-promoteur-v1 vers la synthèse.

// ─── Types de base ────────────────────────────────────────────────────────────

export type RecommendationType = 'GO' | 'GO_CONDITION' | 'NO_GO' | 'ANALYSE_INSUFFISANTE';
export type RisqueNiveau = 'CRITIQUE' | 'ELEVE' | 'MODERE' | 'FAIBLE';
export type DataQualite = 'HAUTE' | 'MOYENNE' | 'FAIBLE' | 'INSUFFISANT';
export type ModuleStatut = 'COMPLET' | 'PARTIEL' | 'INSUFFISANT';
export type AnomalieNiveau = 'CRITIQUE' | 'ALERTE' | 'INFO';

// ─── Anomalie détectée ────────────────────────────────────────────────────────

export type AnomalieItem = {
  id: string;
  niveau: AnomalieNiveau;
  module: string;
  libelle: string;
  detail?: string;
  actionRequise?: string;
};

// ─── Qualité par module ───────────────────────────────────────────────────────

export type ModuleQualite = {
  module: string;
  statut: ModuleStatut;
  donneesManquantes: string[];
  donneesPresentes: string[];
};

// ─── Risque ───────────────────────────────────────────────────────────────────

export type RisqueItem = {
  id: string;
  niveau: RisqueNiveau;
  libelle: string;
  mitigation: string;
};

// ─── Scénario de sensibilité ──────────────────────────────────────────────────

export type Scenario = {
  id: string;
  type: 'OPTIMISTE' | 'BASE' | 'PESSIMISTE' | 'STRESS';
  libelle: string;
  resultat: {
    chiffreAffaires: number;
    coutTotal: number;
    margeNette: number;
    margeNettePercent: number;
    recommendation: RecommendationType;
  };
};

// ─── Contrainte technique ─────────────────────────────────────────────────────

export type ContrainteTechnique = {
  libelle: string;
  statut: 'CONFORME' | 'A_VERIFIER' | 'BLOQUANT';
  valeurProjet?: string;
  valeurPlu?: string;
};

// ─── PromoteurSynthese (output complet) ───────────────────────────────────────

export type PromoteurSynthese = {
  metadata: {
    generatedAt: string;
    dataQualite: DataQualite;
    analyseSuffisante: boolean;
    version: string;
  };

  projet: {
    adresse: string;
    commune: string;
    codePostal?: string;
    departement?: string;
    referenceParcellaire?: string;
    surfaceTerrain?: number;
    nbLogements: number;
    programmeType: string;
  };

  executiveSummary: {
    titreOperation: string;
    recommendation: RecommendationType;
    motifRecommandation: string;
    killSwitchesActifs: string[];
    pointsForts: string[];
    pointsVigilance: string[];
    scores: {
      global: number;
      financier: number;
      marche: number;
      technique: number;
      risque: number;
    };
  };

  /** Anomalies détectées (incohérences, manquants critiques) */
  anomalies: AnomalieItem[];

  /** Qualité des données par module */
  qualiteParModule: ModuleQualite[];

  financier: {
    chiffreAffairesTotal: number;
    chiffreAffairesM2: number;
    coutRevientTotal: number;
    coutRevientM2: number;
    coutFoncier: number;
    coutFoncierPresent: boolean;
    coutTravaux: number;
    coutTravauxM2: number;
    coutFinanciers: number;
    fraisCommercialisation: number;
    fraisGestion: number;
    margeNette: number;
    margeNettePercent: number;
    margeOperationnellePercent: number;
    trnRendement: number;
    bilancielRatio: number;
  };

  marche: {
    zoneMarche: string;
    prixNeufMoyenM2: number;
    prixProjetM2: number;
    positionPrix: number;
    primiumNeuf: number;
    offreConcurrente: number;
    delaiEcoulementMois: number | null;
    analyseFiable: boolean;
    notesMarcheLibre: string[];
  };

  technique: {
    faisabiliteTechnique: 'CONFIRME' | 'SOUS_RESERVE' | 'IMPOSSIBLE' | 'NON_DETERMINABLE';
    zonePlu: string;
    cub: number | null;
    hauteurMax: number | null;
    hauteurProjet: number | null;
    nbNiveaux: number | null;
    pleineTerre: number | null;
    contraintes: ContrainteTechnique[];
  };

  risques: RisqueItem[];

  scenarios: Scenario[];

  financement: {
    fondsPropresRequis: number;
    fondsPropresPercent: number;
    creditPromoteurMontant: number;
    creditPromoteurDuree: number;
    tauxCredit: number;
    prefinancementVentes: number;
    notesBancaires: string[];
  };

  syntheseIA: {
    texteExecutif: string;
    analyseMarche: string;
    analyseTechnique: string;
    analyseFinanciere: string;
    analyseRisques: string;
    conclusion: string;
  };
};

// ─── PromoteurRawInput (input depuis le Bilan) ────────────────────────────────

export type PromoteurRawInput = {
  foncier?: {
    adresse?: string;
    commune?: string;
    codePostal?: string;
    departement?: string;
    surfaceTerrain?: number;
    prixAcquisition?: number;
    fraisNotaire?: number;
    pollutionDetectee?: boolean;
  };
  plu?: {
    zone?: string;
    cub?: number;
    hauteurMax?: number;
    pleineTerre?: number;
  };
  conception?: {
    surfacePlancher?: number;
    nbLogements?: number;
    nbNiveaux?: number;
    hauteurProjet?: number;
    empriseBatie?: number;
    programmeType?: string;
  };
  marche?: {
    // Prix de référence (saisie utilisateur ou dérivés)
    prixNeufM2?: number;
    prixAncienM2?: number;

    // DVF — statistiques agrégées (depuis market-study-promoteur-v1 core.dvf)
    nbTransactionsDvf?: number;
    prixMoyenDvf?: number;
    /** v4.1 — prix min DVF sur la période (€/m²) */
    prixMinDvf?: number;
    /** v4.1 — prix max DVF sur la période (€/m²) */
    prixMaxDvf?: number;
    /** v4.1 — libellé de la période couverte par les transactions DVF (ex: "12 mois glissants") */
    periodeDvf?: string;

    // Marché local
    offreConcurrente?: number;
    absorptionMensuelle?: number;
  };
  risques?: {
    risquesIdentifies?: string[];
    zonageRisque?: string;
  };
  evaluation?: {
    prixVenteM2?: number;
    prixVenteTotal?: number;
    nbLogementsLibres?: number;
  };
  bilan?: {
    coutFoncier?: number;
    coutTravaux?: number;
    coutTravauxM2?: number;
    fraisFinanciers?: number;
    fraisCommercialisation?: number;
    fraisGestion?: number;
    chiffreAffaires?: number;
    margeNette?: number;
    margeNettePercent?: number;
    trnRendement?: number;
    fondsPropres?: number;
    creditPromoteur?: number;
  };
};