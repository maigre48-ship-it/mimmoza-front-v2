// src/spaces/promoteur/services/promoteurSynthese.types.ts

export type RecommendationType = 'GO' | 'GO_CONDITION' | 'NO_GO';

export type RisqueNiveau = 'FAIBLE' | 'MODERE' | 'ELEVE' | 'CRITIQUE';

export type ZoneMarche = 'TENDU' | 'INTERMEDIAIRE' | 'DETENDU';
export type ReportType = 'banque' | 'investisseur' | 'technique';

export interface Scores {
  foncier: number;
  technique: number;
  marche: number;
  financier: number;
  risque: number;
  global: number;
}

export interface ProjetInfo {
  adresse: string;
  commune: string;
  codePostal: string;
  departement: string;
  surfaceTerrain: number;
  surfacePlancher: number;
  nbLogements: number;
  typologieMix: Record<string, number>;
  programmeType: string;
  dateEtude: string;
  promoteur?: string;
  referenceInterne?: string;
}

export interface ExecutiveSummary {
  titreOperation: string;
  recommendation: RecommendationType;
  motifRecommandation: string;
  pointsForts: string[];
  pointsVigilance: string[];
  killSwitchesActifs: string[];
  scores: Scores;
  margeNette: number;
  trnRendement: number;
  caTotal: number;
  resultatNet: number;
}

export interface PluConstrainte {
  libelle: string;
  valeur: string | number | null;
  statut: 'CONFORME' | 'LIMITE' | 'BLOQUANT';
  detail?: string;
}

export interface TechniqueAnalysis {
  zonePlu: string;
  cub: number | null;
  hauteurMax: number | null;
  reculs: {
    voirie: number | null;
    limitesSeparatives: number | null;
    fond: number | null;
  };
  pleineTerre: number | null;
  contraintes: PluConstrainte[];
  faisabiliteTechnique: 'CONFIRME' | 'SOUS_RESERVE' | 'IMPOSSIBLE';
  notesTechniques: string[];
  empriseBatie: number | null;
  hauteurProjet: number | null;
  nbNiveaux: number | null;
  parking: {
    nbPlacesRequises: number | null;
    nbPlacesPrevues: number | null;
    type: 'SURFACE' | 'SEMI_ENTERRE' | 'ENTERRE' | null;
  };
}

export interface PrixMarche {
  prixMoyenM2: number;
  prixMin: number;
  prixMax: number;
  nbTransactions: number;
  periode: string;
  source: string;
}

export interface DemographieIndicateur {
  label: string;
  valeur: number | string;
  evolution?: string;
  source: string;
}

export interface MarcheAnalysis {
  zoneMarche: ZoneMarche;
  prixNeufMoyenM2: number;
  prixProjetM2: number;
  positionPrix: number;
  prixAncienMoyenM2: number;
  primiumNeuf: number;
  prixParTypologie: Record<string, number>;
  offreConcurrente: number;
  demandeLocative: number | null;
  demographieIndicateurs: DemographieIndicateur[];
  transactionsRecentes: PrixMarche;
  absorptionMensuelle: number | null;
  delaiEcoulementMois: number | null;
  notesMarcheLibre: string[];
}

export interface CoutPoste {
  libelle: string;
  montantHT: number;
  pourcentageCA: number;
  detail?: string;
}

export interface FinancierAnalysis {
  chiffreAffairesTotal: number;
  chiffreAffairesM2: number;
  coutFoncier: number;
  coutTravaux: number;
  coutTravauxM2: number;
  coutFinanciers: number;
  fraisCommercialisation: number;
  fraisGestion: number;
  autresCouts: CoutPoste[];
  coutRevientTotal: number;
  coutRevientM2: number;
  margeNette: number;
  margeNettePercent: number;
  margeOperationnelle: number;
  margeOperationnellePercent: number;
  trnRendement: number;
  vatRecoverable: boolean;
  bilancielRatio: number;
}

export interface RisqueItem {
  id: string;
  categorie: 'TECHNIQUE' | 'MARCHE' | 'FINANCIER' | 'REGLEMENTAIRE' | 'ENVIRONNEMENTAL' | 'JURIDIQUE';
  libelle: string;
  niveau: RisqueNiveau;
  probabilite: number;
  impact: number;
  scoreCombine: number;
  mitigation: string;
  isKillSwitch: boolean;
}

export interface FinancementAnalysis {
  fondsPropresRequis: number;
  fondsPropresPercent: number;
  creditPromoteurMontant: number;
  creditPromoteurDuree: number;
  tauxCredit: number;
  garantiesRequises: string[];
  ratioFondsPropres: number;
  prefinancementVentes: number;
  notesBancaires: string[];
}

export interface Scenario {
  id: string;
  libelle: string;
  type: 'OPTIMISTE' | 'BASE' | 'PESSIMISTE' | 'STRESS';
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
}

export interface SyntheseIA {
  texteExecutif: string;
  analyseMarche: string;
  analyseTechnique: string;
  analyseFinanciere: string;
  analyseRisques: string;
  conclusion: string;
  generatedAt: string;
}

export interface PromoteurSynthese {
  id: string;
  version: string;
  createdAt: string;
  updatedAt: string;
  projet: ProjetInfo;
  executiveSummary: ExecutiveSummary;
  technique: TechniqueAnalysis;
  marche: MarcheAnalysis;
  financier: FinancierAnalysis;
  risques: RisqueItem[];
  financement: FinancementAnalysis;
  scenarios: Scenario[];
  syntheseIA: SyntheseIA | null;
  metadata: {
    sourceFoncier: string;
    sourcePlu: string;
    sourceMarche: string;
    dataQualite: 'HAUTE' | 'MOYENNE' | 'FAIBLE';
    avertissements: string[];
  };
}

export interface FoncierData {
  adresse?: string;
  commune?: string;
  codePostal?: string;
  departement?: string;
  surfaceTerrain?: number;
  prixAcquisition?: number;
  fraisNotaire?: number;
  fraisDemolition?: number;
  servitudes?: string[];
  pollutionDetectee?: boolean;
}

export interface PluData {
  zone?: string;
  cub?: number;
  hauteurMax?: number;
  reculs?: {
    voirie?: number;
    limitesSeparatives?: number;
    fond?: number;
  };
  pleineTerre?: number;
  reglesPlu?: Array<{
    code: string;
    libelle: string;
    valeur: string | number | null;
    statut?: 'CONFORME' | 'LIMITE' | 'BLOQUANT';
  }>;
}

export interface ConceptionData {
  surfacePlancher?: number;
  nbLogements?: number;
  typologieMix?: Record<string, number>;
  nbNiveaux?: number;
  hauteurProjet?: number;
  empriseBatie?: number;
  parking?: {
    nbPlacesRequises?: number;
    nbPlacesPrevues?: number;
    type?: 'SURFACE' | 'SEMI_ENTERRE' | 'ENTERRE';
  };
  programmeType?: string;
}

export interface MarcheData {
  prixNeufM2?: number;
  prixAncienM2?: number;
  nbTransactionsDvf?: number;
  prixMoyenDvf?: number;
  prixMinDvf?: number;
  prixMaxDvf?: number;
  periodeDvf?: string;
  demographieData?: DemographieIndicateur[];
  offreConcurrente?: number;
  absorptionMensuelle?: number;
  prixParTypologie?: Record<string, number>;
}

export interface RisquesData {
  risquesIdentifies?: Array<{
    libelle: string;
    niveau?: RisqueNiveau;
    categorie?: RisqueItem['categorie'];
    mitigation?: string;
  }>;
  georisguesScore?: number;
  zonageRisque?: string;
}

export interface EvaluationData {
  prixVenteM2?: number;
  prixVenteTotal?: number;
  nbLogementsLibres?: number;
  nbLogementsAidesSocial?: number;
  tauxLogementsAides?: number;
}

export interface BilanData {
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
}

export interface PromoteurRawInput {
  foncier: FoncierData;
  plu: PluData;
  conception: ConceptionData;
  marche: MarcheData;
  risques: RisquesData;
  evaluation: EvaluationData;
  bilan: BilanData;
}