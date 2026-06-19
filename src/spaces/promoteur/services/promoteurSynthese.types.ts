// src/spaces/promoteur/services/promoteurSynthese.types.ts
// v5.0 — Contrat de types reagligne sur la sortie reelle de promoteurSynthese.mapper.ts.
//        Le type precedent etait une version appauvrie ; il a diverge du mapper.
//        Source de verite = ce que le mapper calcule (livrable comite).

// ─── Types de base ──────────────────────────────────────────────────────────

export type RecommendationType = 'GO' | 'GO_CONDITION' | 'NO_GO' | 'ANALYSE_INSUFFISANTE';
export type ReportType = 'banque' | 'investisseur' | 'technique';
export type RisqueNiveau = 'CRITIQUE' | 'ELEVE' | 'MODERE' | 'FAIBLE';
export type RisqueCategorie =
  | 'FINANCIER'
  | 'MARCHE'
  | 'REGLEMENTAIRE'
  | 'ENVIRONNEMENTAL'
  | 'TECHNIQUE'
  | 'JURIDIQUE'
  | 'AUTRE';
export type DataQualite = 'HAUTE' | 'MOYENNE' | 'FAIBLE' | 'INSUFFISANT';
export type ModuleStatut = 'COMPLET' | 'PARTIEL' | 'INSUFFISANT';
export type AnomalieNiveau = 'CRITIQUE' | 'ALERTE' | 'INFO';

// ─── Anomalie detectee ────────────────────────────────────────────────────────

export type AnomalieItem = {
  id: string;
  niveau: AnomalieNiveau;
  module: string;
  libelle: string;
  detail?: string;
  actionRequise?: string;
};

// ─── Qualite par module ───────────────────────────────────────────────────────

export type ModuleQualite = {
  module: string;
  statut: ModuleStatut;
  donneesManquantes: string[];
  donneesPresentes: string[];
};

// ─── Risque ───────────────────────────────────────────────────────────────────
// Le mapper produit des objets riches (probabilite, impact, scoreCombine, etc.).

export type RisqueItem = {
  id: string;
  categorie: RisqueCategorie;
  libelle: string;
  niveau: RisqueNiveau;
  probabilite: number;
  impact: number;
  scoreCombine: number;
  mitigation: string;
  isKillSwitch: boolean;
};

// ─── Scenario de sensibilite ──────────────────────────────────────────────────
// resultat reagligne sur le mapper : margeNettePercent / resultatNet / trnRendement.

export type Scenario = {
  id: string;
  type: 'OPTIMISTE' | 'BASE' | 'PESSIMISTE' | 'STRESS';
  libelle: string;
  hypotheses: {
    prixVenteM2: number;
    coutTravauxM2: number;
    tauxAbsorption: number;
    tauxCredit: number;
  };
  resultat: {
    margeNettePercent: number;
    resultatNet: number;
    trnRendement: number;
    recommendation: RecommendationType;
  };
};

// ─── Contrainte technique (PLU) ───────────────────────────────────────────────
// statut inclut 'LIMITE' (utilise par le mapper pour deduire SOUS_RESERVE).

export type ContrainteTechnique = {
  libelle: string;
  valeur?: string | number;
  statut: 'CONFORME' | 'A_VERIFIER' | 'BLOQUANT' | 'LIMITE';
  detail?: string;
};

// ─── Prix de marche (transactions DVF agregees) ───────────────────────────────

export type PrixMarche = {
  prixMoyenM2: number;
  prixMin: number;
  prixMax: number;
  nbTransactions: number;
  periode: string;
  source: string;
};

// ─── Synthese IA (optionnelle : non generee par le mapper actuel) ─────────────

export type SyntheseIA = {
  texteExecutif: string;
  analyseMarche: string;
  analyseTechnique: string;
  analyseFinanciere: string;
  analyseRisques: string;
  conclusion: string;
};

// ─── PromoteurSynthese (output complet) ───────────────────────────────────────

export type PromoteurSynthese = {
  id: string;
  version: string;
  createdAt: string;
  updatedAt: string;

  projet: {
    adresse: string;
    commune: string;
    codePostal: string;
    departement: string;
    referenceParcellaire?: string;
    surfaceTerrain: number;
    surfacePlancher: number;
    nbLogements: number;
    typologieMix: Record<string, number>;
    programmeType: string;
    dateEtude: string;
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
      foncier: number;
      financier: number;
      marche: number;
      technique: number;
      risque: number;
    };
    margeNette: number;
    trnRendement: number;
    caTotal: number;
    resultatNet: number;
  };

  technique: {
    faisabiliteTechnique: 'CONFIRME' | 'SOUS_RESERVE' | 'IMPOSSIBLE' | 'NON_DETERMINABLE';
    zonePlu: string;
    cub: number | null;
    hauteurMax: number | null;
    hauteurProjet: number | null;
    nbNiveaux: number | null;
    empriseBatie: number | null;
    pleineTerre: number | null;
    reculs: {
      voirie: number | null;
      limitesSeparatives: number | null;
      fond: number | null;
    };
    parking: {
      nbPlacesRequises: number | null;
      nbPlacesPrevues: number | null;
      type: string | null;
    };
    contraintes: ContrainteTechnique[];
    notesTechniques: string[];
  };

  marche: {
    zoneMarche: string;
    prixNeufMoyenM2: number;
    prixProjetM2: number;
    positionPrix: number;
    prixAncienMoyenM2: number;
    primiumNeuf: number;
    prixParTypologie: Record<string, number>;
    offreConcurrente: number;
    demandeLocative: number | null;
    demographieIndicateurs: unknown[];
    transactionsRecentes: PrixMarche;
    absorptionMensuelle: number | null;
    delaiEcoulementMois: number | null;
    notesMarcheLibre: string[];
  };

  financier: {
    chiffreAffairesTotal: number;
    chiffreAffairesM2: number;
    coutRevientTotal: number;
    coutRevientM2: number;
    coutFoncier: number;
    coutFoncierPresent?: boolean;
    coutTravaux: number;
    coutTravauxM2: number;
    coutFinanciers: number;
    fraisCommercialisation: number;
    fraisGestion: number;
    autresCouts: Array<{ libelle: string; montantHT: number; pourcentageCA: number }>;
    margeNette: number;
    margeNettePercent: number;
    margeOperationnelle: number;
    margeOperationnellePercent: number;
    trnRendement: number;
    vatRecoverable: boolean;
    bilancielRatio: number;
  };

  risques: RisqueItem[];

  scenarios: Scenario[];

  financement: {
    fondsPropresRequis: number;
    fondsPropresPercent: number;
    creditPromoteurMontant: number;
    creditPromoteurDuree: number;
    tauxCredit: number;
    garantiesRequises: string[];
    ratioFondsPropres: number;
    prefinancementVentes: number;
    notesBancaires: string[];
  };

  /** Genere par une couche IA optionnelle. Null tant que non produit. */
  syntheseIA: SyntheseIA | null;

  metadata: {
    sourceFoncier: string;
    sourcePlu: string;
    sourceMarche: string;
    dataQualite: DataQualite;
    avertissements: string[];
    generatedAt?: string;
    analyseSuffisante?: boolean;
    version?: string;
  };

  /** Optionnels : non produits par le mapper actuel. */
  anomalies?: AnomalieItem[];
  qualiteParModule?: ModuleQualite[];
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
    fraisDemolition?: number;
    pollutionDetectee?: boolean;
  };
  plu?: {
    zone?: string;
    cub?: number;
    hauteurMax?: number;
    pleineTerre?: number;
    reculs?: {
      voirie?: number;
      limitesSeparatives?: number;
      fond?: number;
    };
    reglesPlu?: Array<{
      libelle: string;
      valeur?: string | number;
      statut?: ContrainteTechnique['statut'];
    }>;
  };
  conception?: {
    surfacePlancher?: number;
    nbLogements?: number;
    nbNiveaux?: number;
    hauteurProjet?: number;
    empriseBatie?: number;
    programmeType?: string;
    typologieMix?: Record<string, number>;
    parking?: {
      nbPlacesRequises?: number;
      nbPlacesPrevues?: number;
      type?: string;
    };
  };
  marche?: {
    prixNeufM2?: number;
    prixAncienM2?: number;
    nbTransactionsDvf?: number;
    prixMoyenDvf?: number;
    prixMinDvf?: number;
    prixMaxDvf?: number;
    periodeDvf?: string;
    offreConcurrente?: number;
    absorptionMensuelle?: number;
    prixParTypologie?: Record<string, number>;
    demographieData?: unknown[];
  };
  risques?: {
    risquesIdentifies?: Array<{
      libelle: string;
      niveau?: RisqueNiveau;
      categorie?: RisqueCategorie;
      mitigation?: string;
    }>;
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
    autresCouts?: number;
    chiffreAffaires?: number;
    margeNette?: number;
    margeNettePercent?: number;
    trnRendement?: number;
    fondsPropres?: number;
    creditPromoteur?: number;
  };
};

// ─── Alias derives (compat promoteurSynthese.mapper.ts) ───────────────────────
// Reexposes par indexed access pour rester synchronises avec PromoteurSynthese.

export type ProjetInfo = PromoteurSynthese['projet'];
export type ExecutiveSummary = PromoteurSynthese['executiveSummary'];
export type Scores = PromoteurSynthese['executiveSummary']['scores'];
export type FinancierAnalysis = PromoteurSynthese['financier'];
export type MarcheAnalysis = PromoteurSynthese['marche'];
export type TechniqueAnalysis = PromoteurSynthese['technique'];
export type FinancementAnalysis = PromoteurSynthese['financement'];
export type PluConstrainte = ContrainteTechnique;