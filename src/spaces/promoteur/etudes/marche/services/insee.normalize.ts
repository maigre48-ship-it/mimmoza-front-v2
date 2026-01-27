/**
 * Normalisation des données INSEE
 * Gère les différentes conventions de nommage des champs selon les sources
 */

import type { InseeData } from "../types/market.types";

/**
 * Normalise les données INSEE en gérant les différentes conventions de nommage
 * @param input - Données brutes (peut provenir de différentes sources API)
 * @returns Données normalisées au format InseeData, ou undefined si input falsy
 */
export function normalizeInseeData(input: any): InseeData | undefined {
  if (!input) {
    return undefined;
  }

  return {
    // Population
    population: input.population ?? null,
    densite: input.densite ?? input.densite_hab_km2 ?? input.densite_population ?? null,
    evolution_pop_5ans: input.evolution_pop_5ans ?? input.evol_pop_5ans ?? null,

    // Structure par âge (pourcentages)
    pct_moins_15: input.pct_moins_15 ?? input.pct_0_14 ?? null,
    pct_moins_25: input.pct_moins_25 ?? null,
    pct_15_29: input.pct_15_29 ?? null,
    pct_25_39: input.pct_25_39 ?? null,
    pct_30_44: input.pct_30_44 ?? null,
    pct_40_54: input.pct_40_54 ?? null,
    pct_45_59: input.pct_45_59 ?? null,
    pct_55_64: input.pct_55_64 ?? null,
    pct_plus_60: input.pct_plus_60 ?? input.pct_60_plus ?? null,
    pct_plus_65: input.pct_plus_65 ?? input.pct_65_plus ?? null,
    pct_plus_75: input.pct_plus_75 ?? input.pct_75_plus ?? null,
    pct_plus_85: input.pct_plus_85 ?? input.pct_85_plus ?? null,
    evolution_75_plus_5ans: input.evolution_75_plus_5ans ?? null,

    // Économie
    revenu_median: input.revenu_median ?? input.revenu_median_uc ?? input.rev_median ?? null,
    taux_chomage: input.taux_chomage ?? input.tx_chomage ?? null,
    taux_pauvrete: input.taux_pauvrete ?? input.tx_pauvrete ?? null,
    pct_proprietaires: input.pct_proprietaires ?? null,
    pct_locataires: input.pct_locataires ?? null,
    pension_retraite_moyenne: input.pension_retraite_moyenne ?? null,

    // Ménages
    nb_menages: input.nb_menages ?? null,
    taille_moyenne_menage: input.taille_moyenne_menage ?? null,
    pct_menages_1_personne: input.pct_menages_1_personne ?? null,
    pct_familles_monoparentales: input.pct_familles_monoparentales ?? null,

    // Éducation
    pct_diplome_superieur: input.pct_diplome_superieur ?? null,
    pct_sans_diplome: input.pct_sans_diplome ?? null,

    // Logement
    pct_logements_vacants: input.pct_logements_vacants ?? input.tx_vacance ?? null,
    pct_residences_secondaires: input.pct_residences_secondaires ?? null,

    // Localisation
    commune: input.commune ?? input.libelle_commune ?? input.nom_commune ?? null,
    code_commune: input.code_commune ?? input.commune_insee ?? input.code_insee ?? null,
    departement: input.departement ?? input.code_departement ?? null,
    region: input.region ?? input.code_region ?? null,
  };
}