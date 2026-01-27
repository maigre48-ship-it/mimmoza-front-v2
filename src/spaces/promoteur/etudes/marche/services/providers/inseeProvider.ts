// FILE: src/spaces/promoteur/etudes/marche/services/providers/inseeProvider.ts

import { DemographicsData } from "../../types";

export interface InseeProviderParams {
  codeInsee: string;
}

/**
 * Stub pour l'API INSEE
 * À implémenter avec les vrais endpoints INSEE/API Entreprise
 */
export async function fetchInseeData(params: InseeProviderParams): Promise<DemographicsData | null> {
  // TODO: Implémenter l'appel réel à l'API INSEE
  // Endpoints possibles:
  // - https://api.insee.fr/donnees-locales/V0.1/
  // - https://geo.api.gouv.fr/communes/{code}
  
  console.warn("[inseeProvider] Stub - données non implémentées pour:", params.codeInsee);
  return null;
}

/**
 * Récupère les données de population par tranche d'âge
 */
export async function fetchInseeAgeStructure(codeInsee: string): Promise<Record<string, number> | null> {
  // TODO: Implémenter avec données INSEE détaillées
  console.warn("[inseeProvider] fetchInseeAgeStructure - stub");
  return null;
}

/**
 * Récupère les données économiques (revenus, emploi)
 */
export async function fetchInseeEconomyData(codeInsee: string): Promise<Record<string, number> | null> {
  // TODO: Implémenter
  console.warn("[inseeProvider] fetchInseeEconomyData - stub");
  return null;
}