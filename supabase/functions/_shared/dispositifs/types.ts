// supabase/functions/_shared/dispositifs/types.ts
//
// Types du moteur des dispositifs fiscaux d'investissement locatif.
// Zéro import : ce fichier est la racine de la dépendance, lisible aussi bien
// par Deno (edge functions) que par Vite (front, via l'alias @shared).

// ── Vocabulaire commun ───────────────────────────────────────────────────────

/** Zonage A/B/C, annexe I de l'arrêté du 1er août 2014 modifié (art. D. 304-1 CCH). */
export type ZoneAbc = "Abis" | "A" | "B1" | "B2" | "C";

/** Niveau de loyer conventionné. Détermine le taux et les plafonds. */
export type NiveauLoyer = "intermediaire" | "social" | "tres_social";

/** Dispositifs ouverts aux nouveaux investisseurs au 1er septembre 2026. */
export type DispositifCode =
  | "jeanbrun_neuf"
  | "jeanbrun_ancien"
  | "denormandie"
  | "loc_avantages";

/**
 * Mécanique fiscale. Trois familles distinctes qu'il ne faut jamais confondre :
 * l'amortissement réduit le revenu foncier imposable, la réduction d'impôt
 * s'impute sur l'impôt dû. À taux affiché égal, l'effet n'est pas le même.
 */
export type MecaniqueFiscale = "amortissement" | "reduction_impot";

// ── Entrées ──────────────────────────────────────────────────────────────────

export interface SituationFiscale {
  /** Taux marginal d'imposition, en pourcentage : 0, 11, 30, 41 ou 45. */
  tmiPct: number;
  /**
   * Prélèvements sociaux sur les revenus fonciers, en pourcentage.
   * 17,2 % au 01/09/2026. Paramétrable pour ne pas figer un taux qui bouge.
   */
  prelevementsSociauxPct?: number;
  /**
   * Réductions d'impôt déjà consommées dans l'année au titre du plafonnement
   * global des niches (CGI art. 200-0 A). Sert à signaler un dépassement.
   */
  nichesDejaConsommeesEur?: number;
  /** true si l'investissement est situé outre-mer (plafond de niches majoré). */
  outreMer?: boolean;
}

export interface LogementInput {
  /** Prix d'acquisition NET DE FRAIS, en euros (prix + frais d'acquisition). */
  prixAcquisitionNetFraisEur: number;
  /** Montant des travaux facturés par une entreprise, en euros. */
  travauxEur?: number;
  /** Surface habitable en m². */
  surfaceHabitableM2?: number;
  /** Surface des annexes en m² (balcons, caves…), pour la surface fiscale. */
  surfaceAnnexesM2?: number;
  zone?: ZoneAbc;
  /** Code INSEE, nécessaire aux plafonds communaux de Loc'Avantages. */
  codeInsee?: string;
  /** Loyer mensuel hors charges envisagé, en euros. */
  loyerMensuelHcEur?: number;
  /** Immeuble d'habitation collectif (exigé par Jeanbrun). */
  habitatCollectif?: boolean;
  /** Classe DPE après travaux, de "A" à "G". */
  dpeApresTravaux?: string;
  /** Date d'acquisition, au format ISO `YYYY-MM-DD`. */
  dateAcquisition?: string;
}

export interface JeanbrunInput {
  logement: LogementInput;
  situation: SituationFiscale;
  niveauLoyer: NiveauLoyer;
  /**
   * Part des revenus bruts des logements amortis affectée à la location
   * sociale, en pourcentage. Le plafond passe à 10 000 € au-delà de 50 %.
   */
  partRevenusSocialPct?: number;
  /** Idem pour le très social : plafond à 12 000 € au-delà de 50 %. */
  partRevenusTresSocialPct?: number;
  /** L'option n'est ouverte qu'au régime réel foncier. */
  regimeReelFoncier?: boolean;
}

export interface DenormandieInput {
  logement: LogementInput;
  situation: SituationFiscale;
  /** Engagement initial : 6 ou 9 ans. Il n'existe pas d'engagement de 12 ans. */
  dureeEngagementAns: 6 | 9;
  /** Périodes triennales de prorogation envisagées : 0, 1 ou 2. */
  prorogationsTriennales?: 0 | 1 | 2;
  /** La commune est-elle éligible (liste ministérielle, ORT, copropriété) ? */
  communeEligible?: boolean;
}

export interface LocAvantagesInput {
  logement: LogementInput;
  situation: SituationFiscale;
  /** Loc1 = intermédiaire, Loc2 = social, Loc3 = très social. */
  niveauLoyer: NiveauLoyer;
  /** Passage par un organisme agréé : ouvre les taux majorés. */
  intermediationLocative?: boolean;
  /** Revenus bruts annuels du logement, en euros — assiette de la réduction. */
  revenusBrutsAnnuelsEur?: number;
  /** Plafond de loyer communal en €/m², si déjà lu en base. */
  plafondLoyerCommunalEurM2?: number;
}

// ── Sorties ──────────────────────────────────────────────────────────────────

/** Gravité d'un constat. `bloquant` = le dispositif ne s'applique pas. */
export type NiveauConstat = "bloquant" | "avertissement" | "information";

export interface Constat {
  niveau: NiveauConstat;
  message: string;
  /** Référence du texte applicable, pour que l'utilisateur puisse vérifier. */
  reference?: string;
}

export interface PlafondLoyerResultat {
  /** Plafond de base en €/m², avant coefficient de structure. */
  plafondBaseEurM2: number;
  /** Coefficient 0,7 + 19/S, arrondi à 2 décimales et plafonné à 1,2. */
  coefficientStructure: number;
  /** Surface retenue pour le coefficient, en m². */
  surfaceRetenueM2: number;
  /** Loyer mensuel maximal autorisé, hors charges, en euros. */
  loyerMensuelMaxEur: number;
  /** null si le loyer envisagé n'a pas été fourni. */
  respecte: boolean | null;
  source: string;
}

export interface PlafondRessourcesResultat {
  zone: ZoneAbc;
  /** Plafond annuel de RFR par composition de foyer, en euros. */
  parComposition: Array<{ composition: string; plafondEur: number }>;
  /** Majoration par personne à charge à partir de la cinquième. */
  majorationCinquiemePersonneEur: number;
  source: string;
}

export interface ProjectionAnnuelle {
  annee: number;
  /** Amortissement déduit du revenu foncier, en euros. */
  amortissementEur?: number;
  /** Réduction d'impôt imputée, en euros. */
  reductionImpotEur?: number;
  /** Gain d'impôt total de l'année, en euros. */
  gainImpotEur: number;
}

export interface DispositifResultat {
  code: DispositifCode;
  libelle: string;
  mecanique: MecaniqueFiscale;
  /** false si un constat bloquant a été relevé. */
  eligible: boolean;
  constats: Constat[];

  /** Assiette retenue après application des plafonds légaux, en euros. */
  baseEligibleEur: number;
  /** Taux applicable, en pourcentage. */
  tauxPct: number;
  /** Avantage de la première année, en euros. */
  avantageAnnuelEur: number;
  /** Avantage cumulé sur toute la durée, en euros. */
  avantageTotalEur: number;
  /** Durée de l'engagement de location, en années. */
  dureeEngagementAns: number;
  /** Année par année. */
  projection: ProjectionAnnuelle[];

  plafondLoyer?: PlafondLoyerResultat;
  plafondRessources?: PlafondRessourcesResultat;

  /** Millésime des barèmes utilisés (année des baux). */
  millesimeBaremes: number;
  /** Textes de référence, pour vérification par l'utilisateur. */
  sources: string[];
}

/** Descriptif pédagogique, servi au chat pour expliquer sans calculer. */
export interface DispositifFiche {
  code: DispositifCode;
  libelle: string;
  mecanique: MecaniqueFiscale;
  resume: string;
  conditions: string[];
  /** Date limite du dispositif, au format ISO. */
  dateLimite: string;
  /** Ce sur quoi porte la date limite : acquisition, demande de convention… */
  faitGenerateurDateLimite: string;
  plafondNichesEur: number;
  sources: string[];
  /** Confusions fréquentes, à démentir explicitement. */
  piegesCourants: string[];
}
