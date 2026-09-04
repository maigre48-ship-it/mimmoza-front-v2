// src/spaces/promoteur/types/proprietairesParcelles.types.ts
//
// Propriétaires personnes morales des parcelles cadastrales (DGFiP).
//
// ⚠️ PÉRIMÈTRE, à rappeler partout où cette donnée s'affiche : cette source ne
// contient AUCUNE personne physique. Une absence de résultat ne signifie donc
// pas « parcelle sans propriétaire », mais « aucune personne morale connue » —
// le propriétaire est vraisemblablement un particulier, dont l'identité relève
// des fichiers fonciers, réservés aux acteurs publics et interdits de
// démarchage commercial.

/** Les quatre façons d'interroger la donnée. */
export type ModeRechercheProprietaire =
  | "parcelle"
  | "siren"
  | "denomination"
  | "commune";

export interface ProprietaireParcelleRow {
  idu: string;
  codeInsee: string;
  communeNom: string | null;
  prefixe: string | null;
  section: string;
  numeroParcelle: string;
  denomination: string;
  siren: string | null;
  formeJuridique: string | null;
  formeJuridiqueCode: string | null;
  codeDroit: string | null;
  numeroVoirie: string | null;
  nomVoie: string | null;
  millesime: number;
}

export interface RechercheProprietairesParams {
  mode: ModeRechercheProprietaire;
  /** mode « parcelle » : IDU complet à 14 caractères, ou les trois champs suivants. */
  idu?: string | null;
  codeInsee?: string | null;
  section?: string | null;
  numero?: string | null;
  prefixe?: string | null;
  /** mode « siren » : neuf chiffres, la ponctuation est tolérée. */
  siren?: string | null;
  /** mode « denomination » : trois caractères minimum. */
  denomination?: string | null;
  limite?: number;
}

export interface RechercheProprietairesResponse {
  rows: ProprietaireParcelleRow[];
  /**
   * Nombre de correspondances, qui peut dépasser la longueur de `rows`.
   *
   * Sature au plafond de la RPC : au-delà, le comptage exact coûterait des
   * secondes pour un chiffre que personne ne lit. Voir `totalPlafonne`.
   */
  total: number;
  /**
   * Vrai quand le plafond a été atteint : `total` est alors un minorant, et les
   * lignes affichées sont un extrait, pas les premières de l'ordre global. À
   * dire à l'utilisateur, sans quoi il croira avoir vu le début d'une liste
   * complète.
   */
  totalPlafonne: boolean;
  /** Vrai quand la limite d'affichage a écrêté le résultat. */
  tronque: boolean;
  /** Millésime effectivement interrogé. */
  millesime: number | null;
}

export type RechercheProprietairesStatus =
  | "idle"
  | "loading"
  | "success"
  | "empty"
  | "error";
