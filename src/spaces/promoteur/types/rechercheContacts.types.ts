/**
 * Types pour le module "Recherche contacts" (mairies / maires).
 * Module indépendant de Marché / Risques / Permis de construire.
 */

export interface MairieContactRow {
  /** Code INSEE de la commune (5 caractères, ex. "78646" pour Versailles). */
  codeInsee: string | null;
  commune: string;
  codePostal: string | null;
  civiliteMaire: string | null;
  prenomMaire: string | null;
  nomMaire: string | null;
  emailMairie: string | null;
  telephoneMairie: string | null;
  adresseMairie: string | null;
  source: string | null;
  /** Distance en km par rapport au centre de recherche si applicable. */
  distanceKm: number | null;
}

export interface RechercheContactsQuery {
  /**
   * Texte libre : département (numéro ou nom), code postal, ou commune.
   * Le backend se charge d'interpréter la valeur.
   */
  query: string;
  /**
   * Rayon de recherche en km autour du centre de la commune pivot.
   * Ignoré si query est un département (résultat déjà borné au département).
   * null ou 0 = pas de rayon appliqué.
   */
  radiusKm?: number | null;
}

export interface RechercheContactsResponse {
  rows: MairieContactRow[];
  total: number;
  source: string | null;
  /** Si la recherche a été centrée sur une commune, son nom est renvoyé ici. */
  centerCommune?: string | null;
  /** Rayon effectivement appliqué côté backend. */
  radiusKm?: number | null;
}

export type RechercheContactsStatus =
  | 'idle'
  | 'loading'
  | 'success'
  | 'empty'
  | 'error';